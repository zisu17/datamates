"""데이터 수집 — 바깥 데이터를 raw 네임스페이스로 들인다.

경계가 이 모듈의 전부다: **가공하지 않는다.** 원본을 그대로 raw 테이블에 넣고,
정제는 dbt 모델이 한다. 타입 캐스팅조차 하지 않고 문자열로 두는 것이 기본이다.
여기서 한 줄이라도 변환하면 가공 로직이 두 군데로 갈라져 계보가 끊긴다.

적재 엔진은 Spark 가 아니라 pyiceberg 다. dbt-spark 경로는 호출마다 JVM 을 띄워
약 15초가 고정으로 드는데(이 프로젝트 측정값), 수집은 잦고 양이 작은 일이라
그 비용을 감당할 이유가 없다. REST 카탈로그에 직접 붙어 쓴다.

주의 — Iceberg REST 카탈로그가 SQLite 라 동시 커밋이 반드시 깨진다.
수집 태스크는 dbt 빌드 태스크와 같은 Airflow 풀(iceberg_write)에 넣어
전역으로 직렬화해야 한다. daggen 참고.
"""

from __future__ import annotations

import csv
import io
import json
import re
import time
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta
from typing import Any
from urllib.parse import parse_qsl, quote, unquote, urlencode, urlsplit, urlunsplit

from . import dbtproj, store
from .config import dbt_env
from .errors import ApiError

# 수집이 적재하는 네임스페이스. analytics 는 dbt 소유, raw 는 수집 소유다.
RAW_SCHEMA = "raw"

# 표본 조회에서 읽을 최대 행수. 스키마 추론과 미리보기에만 쓴다.
SAMPLE_LIMIT = 50

# 적재 시각을 담는 메타 컬럼. 원본 필드와 부딪히지 않도록 밑줄로 시작한다.
#
# 원본을 가공하지 않는다는 원칙과 어긋나지 않는다 — 값을 바꾸는 것이 아니라
# «언제 들어온 행인지» 를 기록하는 것이다. 덧붙이기로 쌓는 테이블에서 같은 키가
# 여러 번 들어왔을 때 어느 것이 최신인지 정하려면 순서를 매길 값이 있어야 하고,
# 원천이 그런 값을 주지 않는 경우가 많다(실거래가·시세처럼 스냅샷만 주는 API).
# fct_events 가 batch_id 로 하는 일을 raw 에서 할 수 있게 하는 자리다.
INGESTED_AT = "_ingested_at"

_NAME_RE = re.compile(r"^[a-z][a-z0-9_]{1,62}$")

# 요청 주소의 날짜 자리표시자. 이것이 없으면 예약 실행이 매번 저장할 때 박아둔
# 그 구간을 다시 가져온다 — 1시간마다 돌리면 같은 자료가 하루 24벌 쌓인다.
_PLACEHOLDER_RE = re.compile(r"\{\{\s*(ymd|ym|date)\s*([+-]\d+)?\s*\}\}")
_LEFTOVER_RE = re.compile(r"\{\{[^{}]*\}\}")
_PLACEHOLDER_HELP = (
    "쓸 수 있는 자리표시자: {{ ymd }}→20260811, {{ ym }}→202608, {{ date }}→2026-08-11. "
    "뒤에 -1 을 붙이면 하루 전이고, ym 은 한 달 전입니다. 예) DEAL_YMD={{ ym-1 }}")

# 다시 걸어 볼 만한 응답. 4xx 는 몇 번을 걸어도 같은 답이 오므로 넣지 않는다.
RETRY_STATUS = {408, 425, 429, 500, 502, 503, 504}
RETRY_ATTEMPTS = 3
RETRY_BACKOFF = 0.8        # 0.8 → 1.6 초. 지수로 물린다.

# 한 지점에서 넘길 수 있는 최대 페이지. 원천이 totalCount 를 틀리게 주거나
# 마지막 페이지를 계속 되돌려주는 경우에 무한 반복을 끊는다.
MAX_PAGES = 500


def check_table_name(name: str) -> None:
    if not _NAME_RE.match(name or ""):
        raise ApiError("INVALID_ARGUMENT",
                       "테이블 이름은 소문자로 시작하고 소문자·숫자·밑줄만 쓸 수 있습니다 "
                       "(2~63자). 예: raw_orders")


# ---------------------------------------------------------------- 카탈로그

def catalog() -> Any:
    """Iceberg REST 카탈로그. dbt 가 쓰는 것과 같은 카탈로그다."""
    try:
        from pyiceberg.catalog.rest import RestCatalog
    except ImportError as e:      # pragma: no cover
        raise ApiError("UPSTREAM_UNAVAILABLE",
                       "적재 엔진(pyiceberg)이 설치되어 있지 않습니다.",
                       status=503) from e
    env = dbt_env()
    return RestCatalog("datamates",
                       uri=env.get("ICEBERG_REST_URI", "http://localhost:8181"),
                       warehouse="warehouse",
                       **{"s3.endpoint": env.get("MINIO_ENDPOINT", "http://localhost:9000"),
                          "s3.access-key-id": env.get("MINIO_ROOT_USER", "minioadmin"),
                          "s3.secret-access-key": env.get("MINIO_ROOT_PASSWORD", "minioadmin")})


def ensure_namespace(cat: Any) -> None:
    if (RAW_SCHEMA,) not in cat.list_namespaces():
        cat.create_namespace(RAW_SCHEMA)


# ---------------------------------------------------------------- 표본 읽기

def _walk(obj: Any, path: str) -> Any:
    """data.items 같은 경로로 응답 안의 레코드 배열을 찾아 들어간다.

    «경로가 틀린 것» 과 «자료가 0건인 것» 을 갈라야 한다. 조회 결과가 없을 때 남은
    경로를 통째로 비워 보내는 API 가 있다 — 공공데이터포털은 items 자리에 빈 문자열을
    넣는다({"body": {"items": "", "totalCount": 0}}). 이걸 경로 오류로 보고하면,
    설정은 멀쩡한데 「경로를 찾지 못했습니다」가 뜨고 사용자는 맞는 값을 계속 고친다.
    거래가 드문 지역·월을 도는 수집에서는 이 상황이 예외가 아니라 일상이다.

    빈 값에서 멈추면 «자료 없음»(None), 값이 있는데 들어갈 수 없으면 경로 오류다.
    """
    cur = obj
    for part in (path or "").split("."):
        if not part:
            continue
        if cur is None or cur == "" or cur == {} or cur == []:
            return None
        if not isinstance(cur, dict) or part not in cur:
            raise ApiError("INVALID_ARGUMENT",
                           f"응답에서 {path} 경로를 찾지 못했습니다. "
                           f"현재 위치의 키: {', '.join(list(cur)[:8]) if isinstance(cur, dict) else '(객체가 아님)'}")
        cur = cur[part]
    return cur


def _now() -> datetime:
    """지금 — 로컬 시간대를 붙여 돌려준다.

    자리표시자의 «오늘» 과 적재 시각이 같은 기준을 쓰게 하려는 것이다. 시간대를
    붙이는 이유는 적재 시각이 출처 기록이라서다 — 나중에 이 값만 보고도 언제인지
    다투지 않아야 한다.
    """
    return datetime.now().astimezone()


def _shift(d: date, unit: str, n: int) -> date:
    """자리표시자의 오프셋. ym 은 달 단위, 나머지는 날 단위다."""
    if unit != "ym":
        return d + timedelta(days=n)
    # 달을 밀 때 일자는 1 로 둔다. 8월 31일에서 한 달을 빼면 «7월 31일» 이 없는
    # 달이 생기는데, ym 은 연·월만 쓰므로 일자를 붙들 이유가 없다.
    m = d.month - 1 + n
    return date(d.year + m // 12, m % 12 + 1, 1)


def _fill_placeholders(text: str, today: date) -> str:
    """주소 안의 날짜 자리표시자를 실행 시점 값으로 바꾼다."""
    def one(m: "re.Match[str]") -> str:
        unit, off = m.group(1), int(m.group(2) or 0)
        d = _shift(today, unit, off)
        if unit == "ymd":
            return d.strftime("%Y%m%d")
        if unit == "ym":
            return d.strftime("%Y%m")
        return d.strftime("%Y-%m-%d")
    return _PLACEHOLDER_RE.sub(one, text)


def _check_leftover(url: str) -> None:
    """바뀌지 않고 남은 자리표시자는 오타다. 그대로 보내면 원천이 400 을 주거나,
    더 나쁘게는 자리표시자를 값으로 읽어 엉뚱한 자료를 준다."""
    left = _LEFTOVER_RE.search(url)
    if left:
        raise ApiError("INVALID_ARGUMENT",
                       f"주소의 {left.group(0)} 은(는) 알 수 없는 자리표시자입니다. "
                       + _PLACEHOLDER_HELP)


# ---------------------------------------------------------------- 수집 범위
#
# 전체 수집은 저장된 주소를 그대로 한 번 부른다. 증분 수집은 «어디까지 가져왔는지»
# (워터마크)부터 지금까지를 스스로 채운다. 원천이 구간을 받는 방식이 둘로 갈린다:
#
#   range  시작·종료 파라미터를 함께 받는다 → 한 번에 부른다
#   point  시점 한 칸만 받는다(DEAL_YMD 같은) → 구간을 단위로 쪼개 여러 번 부른다
#
# 워터마크는 «덮은 구간의 끝» 이지 «실행한 시각» 이 아니다. 한 번에 다 돌지 못하고
# 끊긴 경우, 실행 시각을 적어 두면 못 가져온 구간이 조용히 사라진다.

MAX_STEPS = 120          # point 형이 한 번에 도는 최대 횟수. 넘으면 실패시킨다.

# 한 번의 실행이 보낼 수 있는 최대 요청 수(팬아웃·시간 칸을 모두 곱한 값).
# MAX_STEPS 와 따로 두는 이유 — 24칸이라도 지역 25곳을 곱하면 600번이다.
# 시간 축만 세면 «괜찮아 보이는» 설정이 실제로는 원천을 수천 번 두드린다.
MAX_CALLS = 5000

_FORMATS = {
    "YYYYMMDD": "%Y%m%d",
    "YYYY-MM-DD": "%Y-%m-%d",
    "YYYYMM": "%Y%m",
    "YYYY-MM": "%Y-%m",
}


def _fmt_point(d: date, fmt: str) -> str:
    return d.strftime(_FORMATS.get(fmt) or _FORMATS["YYYY-MM-DD"])


def _step(d: date, unit: str, n: int) -> date:
    return _shift(d, "ym" if unit == "month" else "ymd", n)


def _parse_day(s: str, fallback: date) -> date:
    """ISO 문자열에서 날짜만 뽑는다. 워터마크·초기 시작일이 둘 다 들어온다."""
    try:
        return datetime.fromisoformat((s or "").strip()).date()
    except ValueError:
        pass
    try:
        return date.fromisoformat((s or "").strip()[:10])
    except ValueError:
        return fallback


def window(scope: dict[str, Any], watermark: str | None, now: datetime) -> tuple[date, date]:
    """이번 실행이 덮을 구간 (시작, 끝). 끝은 포함이다.

    워터마크가 없으면 «초기 수집 시작일» 부터다. 겹침(overlap)은 워터마크를 그만큼
    뒤로 물린다 — 원천이 늦게 고치는 자료(실거래 해제 건처럼)를 놓치지 않으려면
    이미 가져온 구간을 조금 다시 훑어야 한다.
    """
    unit = scope.get("unit") or "day"
    today = now.date()
    start = _parse_day(watermark or scope.get("initial_start") or "", today)
    overlap = int(scope.get("overlap") or 0)
    if watermark:
        # 워터마크는 «덮은 구간의 끝» 이다. 겹침을 두지 않았으면 그 **다음** 칸부터가
        # 맞다. 워터마크 칸에서 다시 시작하면 이미 가져온 구간을 실행마다 한 번 더
        # 부른다 — 반복 파라미터가 25개면 실행마다 25번이 그대로 버려지고,
        # 24개월 백필이 12회가 아니라 24회로 늘어난다(실측).
        start = _step(start, unit, -overlap if overlap else 1)
    if start > today:
        start = today
    return start, today


def _steps(start: date, end: date, unit: str) -> list[date]:
    """구간을 단위로 쪼갠다. month 는 1일로 맞춘다 — 연·월만 쓰기 때문이다."""
    if unit == "month":
        cur, last = start.replace(day=1), end.replace(day=1)
    else:
        cur, last = start, end
    out = []
    while cur <= last and len(out) <= MAX_STEPS:
        out.append(cur)
        cur = _step(cur, unit, 1)
    return out


def scope_calls(scope: dict[str, Any], watermark: str | None,
                now: datetime) -> list[tuple[dict[str, str], date]]:
    """이번 실행이 보낼 시간 축 파라미터들. (파라미터, 그 칸이 덮는 끝) 의 목록이다.

    끝 날짜를 칸마다 따로 달고 다니는 이유는 워터마크 때문이다. 구간 전체의 끝만
    돌려주면, 중간에 멈췄을 때 «어디까지 실제로 덮었는지» 를 호출자가 알 수 없다.
    """
    start, end = window(scope, watermark, now)
    fmt = scope.get("format") or "YYYY-MM-DD"
    unit = scope.get("unit") or "day"

    if (scope.get("shape") or "range") == "range":
        sp, ep = (scope.get("start_param") or "").strip(), (scope.get("end_param") or "").strip()
        if not sp or not ep:
            raise ApiError("INVALID_ARGUMENT",
                           "증분 수집의 시작일·종료일 파라미터 이름을 입력해 주세요.")
        return [({sp: _fmt_point(start, fmt), ep: _fmt_point(end, fmt)}, end)]

    param = (scope.get("param") or "").strip()
    if not param:
        raise ApiError("INVALID_ARGUMENT", "증분 수집의 기준 파라미터 이름을 입력해 주세요.")
    steps = _steps(start, end, unit)
    if len(steps) > MAX_STEPS:
        raise ApiError(
            "INVALID_ARGUMENT",
            f"가져올 구간이 {MAX_STEPS}회를 넘습니다 ({start} ~ {end}). "
            f"초기 수집 시작일을 뒤로 옮기거나, 먼저 짧은 구간으로 한 번 돌려 "
            f"기준 시점을 만든 뒤 이어서 실행해 주세요.")
    if not steps:
        return [({param: _fmt_point(end, fmt)}, end)]
    # 마지막 칸은 «그 칸» 까지 덮은 것이다. 다음 실행의 시작점이 된다.
    return [({param: _fmt_point(d, fmt)}, d) for d in steps]


# ---------------------------------------------------------------- 반복 파라미터
#
# 시간만으로 다 부를 수 없는 원천이 있다. 국토부 실거래가는 (지역, 계약월) 두
# 칸을 모두 받아야 하고, 지역은 시간처럼 «다음 값» 을 계산할 수 없는 목록이다.
# 이것이 없으면 지역 수만큼 수집 작업을 따로 만들어야 하는데, 한 raw 테이블의
# 적재는 작업 하나만 맡는다는 규칙과 정면으로 부딪힌다 — 즉 만들 수가 없다.

def fanout_values(scope: dict[str, Any]) -> list[str]:
    """반복 파라미터의 값 목록. 줄바꿈·쉼표·공백 아무거나로 나눠 적어도 된다."""
    fan = scope.get("fanout") or {}
    raw = fan.get("values")
    if isinstance(raw, str):
        raw = re.split(r"[\s,]+", raw)
    out: list[str] = []
    seen: set[str] = set()
    for v in raw or []:
        s = str(v).strip()
        # 같은 값을 두 번 부르면 그만큼 같은 행이 겹쳐 쌓인다. 순서는 지킨다.
        if s and s not in seen:
            seen.add(s)
            out.append(s)
    return out


def call_plan(scope: dict[str, Any], watermark: str | None,
              now: datetime) -> list[dict[str, Any]]:
    """이번 실행이 돌 «묶음» 목록.

    묶음 하나 = 시간 축의 한 칸이고, 그 안에 반복 파라미터 값마다 요청이 하나씩
    들어 있다. 요청을 평평하게 늘어놓지 않고 묶어 두는 이유는 워터마크다 —
    지역 25곳 중 7곳까지 부르고 끊겼는데 그 달을 덮었다고 적으면, 남은 18곳은
    다시 가져올 방법이 없어진다. 워터마크는 **끝까지 돈 묶음** 까지만 올린다.

    반환: [{"covered": date|None, "calls": [{파라미터: 값}, ...]}, ...]
    """
    fan = scope.get("fanout") or {}
    fan_param = (fan.get("param") or "").strip()
    values = fanout_values(scope)
    if fan_param and not values:
        raise ApiError("INVALID_ARGUMENT",
                       f"반복 파라미터 {fan_param} 의 값 목록이 비어 있습니다. "
                       f"부를 값을 한 줄에 하나씩 적어 주세요.")
    if values and not fan_param:
        raise ApiError("INVALID_ARGUMENT", "반복 파라미터의 이름을 입력해 주세요.")

    if (scope.get("mode") or "full") == "incremental":
        points = scope_calls(scope, watermark, now)
    else:
        points = [({}, None)]      # type: ignore[list-item]

    plan = [{"covered": covered,
             "calls": ([{**params, fan_param: v} for v in values]
                       if values else [dict(params)])}
            for params, covered in points]

    total = sum(len(g["calls"]) for g in plan)
    if total > MAX_CALLS:
        raise ApiError(
            "INVALID_ARGUMENT",
            f"이번 실행이 원천을 {total:,}번 부르게 됩니다 (최대 {MAX_CALLS:,}번). "
            f"반복 파라미터 값을 줄이거나, 초기 수집 시작일을 뒤로 옮겨 "
            f"나눠서 가져와 주세요.")
    return plan


def _no_double_encode(v: str) -> str:
    """이미 퍼센트 인코딩된 값이면 한 번 풀어서 돌려준다.

    공공데이터포털 인증키처럼 **인코딩된 상태로 발급되는** 값이 흔하다. 그대로
    질의 문자열에 실으면 인코딩이 한 번 더 걸려 %2F 가 %252F 가 되고, 원천은
    「등록되지 않은 서비스키」로 거절한다. 반대로 사람이 친 평문(공백·한글)은
    반드시 인코딩해야 한다.

    구분 기준은 되돌려 보기다 — 풀었다가 다시 인코딩했을 때 원래 문자열과 똑같으면
    그것은 인코딩된 값이고, 아니면 평문이므로 손대지 않는다. 「100%」 같은 값이
    잘못 풀리지 않는 것도 이 검사 덕분이다.
    """
    if "%" not in v:
        return v
    plain = unquote(v)
    return plain if quote(plain, safe="") == v else v


def _with_params(url: str, *layers: dict[str, str]) -> str:
    """주소의 질의 문자열을 한 곳에서 조립한다. 뒤 layer 가 앞을 덮는다.

    **httpx 의 params= 를 쓰지 않는다.** httpx 는 params 를 주면 주소에 이미 있던
    질의 문자열을 통째로 갈아치운다(0.28 확인). 주소에 LAWD_CD 를 적어 두고 인증키만
    파라미터 칸으로 옮기면 LAWD_CD 가 조용히 사라져, 원천은 엉뚱한 자료를 준다.
    오류도 나지 않아 알아채기 어렵다.

    직접 이어 붙이는 것도 답이 아니다 — 주소에 이미 있는 같은 이름이 지워지지 않고
    둘 다 실려 간다(DEAL_YMD=202407&DEAL_YMD=202408). 어느 쪽을 읽을지는 원천 마음이다.
    """
    over: dict[str, str] = {}
    for layer in layers:
        for k, v in (layer or {}).items():
            over[k] = _no_double_encode(str(v))
    if not over:
        return url
    parts = urlsplit(url)
    # parse_qsl 은 값을 풀어서 주고 urlencode 가 다시 감는다 — 주소에 원래 있던
    # 인코딩 값은 이 왕복을 그대로 통과한다.
    q = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True)
         if k not in over]
    q += list(over.items())
    return urlunsplit(parts._replace(query=urlencode(q)))


_OK_CODES = {"0", "00", "000", "0000", "OK"}


def _api_error(body: Any) -> str | None:
    """원천이 HTTP 200 에 실어 보내는 «실패» 를 찾아낸다.

    공공데이터포털 계열은 인증 오류·트래픽 초과를 200 으로 돌려준다. 그러면
    레코드 경로가 없는 응답이 되어 「경로를 찾지 못했습니다」로 보고되는데,
    실제 원인은 경로가 아니라 인증키다 — 사용자는 멀쩡한 설정을 계속 고치게 된다.

    모양이 정확히 맞을 때만 오류로 본다. 아무 dict 나 넘겨짚으면 정상 응답을
    실패로 뒤집는 쪽이 훨씬 위험하다.
    """
    if not isinstance(body, dict):
        return None

    env = body.get("OpenAPI_ServiceResponse")
    if isinstance(env, dict):
        h = env.get("cmmMsgHeader")
        if isinstance(h, dict):
            msg = str(h.get("returnAuthMsg") or h.get("errMsg") or "").strip()
            code = str(h.get("returnReasonCode") or "").strip()
            return f"{msg} (코드 {code})" if code else (msg or "원천이 오류를 돌려주었습니다.")

    for key in ("response", "Response"):
        r = body.get(key)
        h = r.get("header") if isinstance(r, dict) else None
        if not isinstance(h, dict):
            continue
        code = str(h.get("resultCode", h.get("returnReasonCode", ""))).strip()
        if code and code not in _OK_CODES:
            msg = str(h.get("resultMsg") or h.get("returnAuthMsg") or "").strip()
            return f"{msg} (코드 {code})" if msg else f"결과 코드 {code}"
    return None


def _xml_to_obj(el: ET.Element) -> Any:
    """XML 엘리먼트를 JSON 과 같은 모양의 dict/list 로 바꾼다.

    자식이 없으면 텍스트, 같은 태그가 여러 번 나오면 배열이다. 속성은 버린다 —
    이 자리에서 다루는 자료는 값을 엘리먼트에 담지 속성에 담지 않는다.
    """
    children = list(el)
    if not children:
        return (el.text or "").strip()
    out: dict[str, Any] = {}
    for c in children:
        v = _xml_to_obj(c)
        if c.tag not in out:
            out[c.tag] = v
            continue
        cur = out[c.tag]
        out[c.tag] = cur if isinstance(cur, list) else [cur]
        out[c.tag].append(v)
    return out


def _parse_body(content: bytes) -> Any:
    """응답 본문을 dict 로. JSON 을 먼저 보고, 아니면 XML 로 읽는다.

    XML 도 받는 이유는 같은 자료를 XML 로만 주는 API 가 흔해서다(공공데이터포털 계열).
    Content-Type 을 믿지 않고 실제로 파싱해 보는 이유도 같다 — XML 을 주면서
    text/html 로 표시하는 곳이 있다.

    루트 태그를 그대로 최상위 키로 두므로 record_path 는 두 형식이 같다.
    예를 들어 <response><body><items><item>… 은 JSON 과 똑같이
    response.body.items.item 으로 짚는다.
    """
    try:
        return json.loads(content)
    except ValueError:
        pass
    try:
        root = ET.fromstring(content)
    except ET.ParseError as e:
        raise ApiError("INVALID_ARGUMENT",
                       "JSON 도 XML 도 아닌 응답입니다. "
                       "파일 수집을 쓰거나 주소를 확인해 주세요.") from e
    return {root.tag: _xml_to_obj(root)}


def _send(cfg: dict[str, Any], url: str, headers: dict[str, str]) -> Any:
    """요청 한 번 — 실패하면 지수 백오프로 다시 건다.

    다시 걸 만한 실패만 다시 건다. 네트워크가 끊기거나 원천이 5xx·429 를 주는 것은
    잠깐 뒤에 되는 일이지만, 400·404 는 몇 번을 걸어도 같은 답이 온다. 구분하지
    않고 재시도하면 잘못된 설정을 고치는 데 세 배의 시간이 든다.
    """
    import httpx

    last: ApiError | None = None
    for attempt in range(RETRY_ATTEMPTS):
        if attempt:
            time.sleep(RETRY_BACKOFF * (2 ** (attempt - 1)))
        try:
            r = httpx.request(cfg.get("method", "GET"), url, headers=headers,
                              timeout=30.0, follow_redirects=True)
        except httpx.HTTPError as e:
            last = ApiError("UPSTREAM_UNAVAILABLE",
                            f"요청에 실패했습니다: {str(e)[:200]}", status=503)
            continue
        if r.status_code in RETRY_STATUS:
            last = ApiError("UPSTREAM_UNAVAILABLE",
                            f"응답이 실패입니다 (HTTP {r.status_code}). {r.text[:200]}",
                            status=503)
            continue
        if r.status_code >= 400:
            raise ApiError("UPSTREAM_UNAVAILABLE",
                           f"응답이 실패입니다 (HTTP {r.status_code}). {r.text[:200]}",
                           status=503)
        return r
    raise last          # type: ignore[misc]


def _records(body: Any, record_path: str) -> list[dict[str, Any]]:
    """응답 본문에서 레코드 배열을 꺼낸다."""
    rows = _walk(body, record_path or "")
    if rows is None or rows == "":
        # 조회 결과가 없을 때 <items/> 처럼 빈 자리만 오는 API 가 있다. 경로가 틀린
        # 경우는 _walk 가 이미 걸러냈으므로, 여기까지 왔다면 «자료 없음» 이다.
        return []
    if isinstance(rows, dict):
        # 결과가 한 건이면 배열이 아니라 객체로 오는 API 가 흔하다(공공데이터포털).
        rows = [rows]
    if not isinstance(rows, list):
        raise ApiError("INVALID_ARGUMENT",
                       "레코드 목록을 찾지 못했습니다. 응답 안의 배열 경로를 레코드 경로 칸에 적어 주세요.")
    out = [x for x in rows if isinstance(x, dict)]
    if not out and rows:
        raise ApiError("INVALID_ARGUMENT",
                       "레코드가 객체 배열이 아닙니다. 이 형태는 아직 지원하지 않습니다.")
    return out


def _call(cfg: dict[str, Any], extra: dict[str, str] | None) -> tuple[list[dict[str, Any]], Any]:
    """API 한 번 호출 — (레코드, 응답 본문) 을 돌려준다.

    본문까지 함께 주는 이유는 페이지네이션이 totalCount 를 읽어야 해서다.
    """
    url = (cfg.get("url") or "").strip()
    if not url:
        raise ApiError("INVALID_ARGUMENT", "요청 주소를 입력해 주세요.")

    today = _now().date()
    url = _fill_placeholders(url, today)
    _check_leftover(url)
    params = {k: (_fill_placeholders(v, today) if isinstance(v, str) else v)
              for k, v in (cfg.get("params") or {}).items()}

    headers = dict(cfg.get("headers") or {})
    auth = cfg.get("auth") or {}
    kind = auth.get("kind")
    if kind == "bearer" and auth.get("token"):
        headers["Authorization"] = f"Bearer {auth['token']}"
    elif kind == "header" and auth.get("name"):
        headers[auth["name"]] = auth.get("value", "")
    elif kind == "param" and auth.get("name"):
        # 인증키를 질의 문자열로 받는 원천(공공데이터포털 계열)이 많다. 주소에
        # 직접 적으면 목록 응답과 상세 화면에 그대로 실려 나가므로 여기로 받는다 —
        # auth 는 내보낼 때 가려지는 자리다(routers/ingest.py 의 _mask).
        params[auth["name"]] = auth.get("value", "")

    # 순서가 곧 우선순위다 — 주소의 고정값 < 파라미터 칸 < 이번 실행이 정한 값.
    url = _with_params(url, params, extra or {})

    r = _send(cfg, url, headers)

    pause = float(cfg.get("pause") or 0)
    if pause > 0:
        # 원천에 대한 예의이자 자기 방어다. 공공 API 는 초당 호출 수를 넘기면
        # 트래픽 초과로 하루치를 통째로 막는 경우가 있다.
        time.sleep(min(pause, 5.0))

    body = _parse_body(r.content)
    err = _api_error(body)
    if err:
        raise ApiError("UPSTREAM_UNAVAILABLE",
                       f"원천이 조회를 거절했습니다 — {err}", status=503)
    return _records(body, cfg.get("record_path") or ""), body


def fetch_api(cfg: dict[str, Any], limit: int = SAMPLE_LIMIT,
              extra: dict[str, str] | None = None) -> list[dict[str, Any]]:
    """API 를 불러 레코드 목록을 얻는다. 페이지가 나뉘어 있으면 끝까지 돈다.

    extra 는 실행기가 계산한 구간·반복 파라미터다. 주소에 같은 이름이 이미 있으면
    덮어쓴다 — 사람이 적어 둔 고정값보다 이번 실행이 정한 값이 우선이다.

    limit 이 있으면(미리보기) 첫 페이지만 본다. 표본을 보려고 원천을 수십 번
    두드릴 이유가 없다.
    """
    if limit:
        rows, _ = _call(cfg, extra)
        return rows[:limit]
    return fetch_all(cfg, extra)[0]


def _page_cfg(cfg: dict[str, Any]) -> dict[str, Any]:
    p = cfg.get("page") or {}
    return p if (p.get("param") or "").strip() else {}


def _total_of(body: Any, path: str) -> int | None:
    """응답이 알려주는 전체 건수. 못 읽으면 None — 그때는 페이지 길이로 판단한다."""
    if not path:
        return None
    try:
        v = _walk(body, path)
    except ApiError:
        return None
    try:
        return int(str(v).strip())
    except (TypeError, ValueError):
        return None


def fetch_all(cfg: dict[str, Any], extra: dict[str, str] | None = None
              ) -> tuple[list[dict[str, Any]], int]:
    """한 지점(지역·월 하나)의 레코드 전부. (레코드, 부른 페이지 수) 를 돌려준다.

    **페이지를 돌지 않으면 조용히 잘린다.** numOfRows=1000 으로 부른 강남구
    2026-05 전월세는 totalCount 가 1,887 인데 1,000건만 온다 — 오류도 경고도 없이
    887건이 사라지고, 그 위에서 계산한 중위값은 그냥 틀린 값이 된다.

    멈추는 조건은 셋이고, 하나라도 걸리면 끝이다.
      · 전체 건수를 알 수 있으면 그만큼 모았을 때
      · 한 페이지가 요청한 크기보다 적게 왔을 때 (마지막 페이지)
      · 빈 페이지가 왔을 때
    셋 다 판단할 수 없으면(크기도 전체 건수도 모르면) 한 페이지로 끝낸다 —
    끝을 모르는 채로 도는 것이 가장 위험하다.
    """
    page_cfg = _page_cfg(cfg)
    if not page_cfg:
        rows, _ = _call(cfg, extra)
        return rows, 1

    param = page_cfg["param"].strip()
    size_param = (page_cfg.get("size_param") or "").strip()
    size = int(page_cfg.get("size") or 0)
    start = int(page_cfg.get("start") or 1)
    total_path = (page_cfg.get("total_path") or "").strip()

    out: list[dict[str, Any]] = []
    page, pages = start, 0
    while True:
        call_extra = dict(extra or {})
        call_extra[param] = str(page)
        if size_param and size:
            call_extra[size_param] = str(size)
        rows, body = _call(cfg, call_extra)
        out.extend(rows)
        pages += 1

        total = _total_of(body, total_path)
        if total is not None and len(out) >= total:
            break
        if not rows:
            break
        if size and len(rows) < size:
            break
        if total is None and not size:
            break
        if pages >= MAX_PAGES:
            raise ApiError(
                "UPSTREAM_UNAVAILABLE",
                f"페이지를 {MAX_PAGES}번 넘겼는데 끝이 보이지 않습니다. "
                f"페이지 크기나 전체 건수 경로를 확인해 주세요.", status=503)
        page += 1
    return out, pages


def parse_file(text: str, cfg: dict[str, Any], limit: int = SAMPLE_LIMIT) -> list[dict[str, Any]]:
    """파일 내용을 레코드 목록으로. CSV 와 JSON Lines 만 다룬다."""
    fmt = cfg.get("format") or "csv"
    if fmt == "csv":
        delim = cfg.get("delimiter") or ","
        rd = csv.DictReader(io.StringIO(text), delimiter=delim)
        rows = []
        for i, row in enumerate(rd):
            if limit and i >= limit:
                break
            rows.append({(k or "").strip(): v for k, v in row.items() if k})
        if not rows:
            raise ApiError("INVALID_ARGUMENT", "읽을 행이 없습니다. 머리글 줄과 구분자를 확인해 주세요.")
        return rows
    if fmt in ("json", "jsonl"):
        rows = []
        for i, line in enumerate(text.splitlines()):
            line = line.strip()
            if not line:
                continue
            if limit and len(rows) >= limit:
                break
            try:
                obj = json.loads(line)
            except ValueError as e:
                raise ApiError("INVALID_ARGUMENT",
                               f"{i + 1}번째 줄이 JSON 이 아닙니다. JSON Lines 형식인지 확인해 주세요.") from e
            if isinstance(obj, dict):
                rows.append(obj)
        if not rows:
            raise ApiError("INVALID_ARGUMENT", "읽을 레코드가 없습니다.")
        return rows
    raise ApiError("INVALID_ARGUMENT", f"{fmt} 형식은 아직 지원하지 않습니다.")


# ---------------------------------------------------------------- 스키마

def infer_columns(rows: list[dict[str, Any]]) -> list[dict[str, str]]:
    """표본에서 컬럼 목록을 뽑는다.

    타입은 전부 string 이다. 수집은 원본을 그대로 넣는 일이고, 타입을 정하는 것은
    정제 계층(dbt)의 판단이다. 여기서 추론하면 표본에 없던 값 하나로 적재가
    깨지거나(숫자 컬럼에 'N/A'), 조용히 정보가 잘린다.
    """
    cols: list[str] = []
    for r in rows:
        for k in r:
            if k not in cols:
                cols.append(k)
    return [{"name": c, "type": "string"} for c in cols]


def to_arrow(rows: list[dict[str, Any]], columns: list[dict[str, str]],
             ingested_at: str) -> Any:
    """레코드를 Arrow 테이블로. 모든 값은 문자열로 눕힌다.

    중첩 객체·배열은 JSON 문자열 그대로 넣는다 — 펼치는 것은 dbt 의 일이다.
    맨 뒤에 적재 시각 컬럼을 붙인다. 이것도 문자열이다 — 표 전체가 문자열인데
    한 컬럼만 타입을 정하면 «타입은 dbt 가 정한다» 는 경계가 흐려진다.
    """
    import pyarrow as pa

    names = [c["name"] for c in columns]
    if INGESTED_AT in names:
        raise ApiError("VALIDATION_FAILED",
                       f"원본에 {INGESTED_AT} 컬럼이 있습니다. 적재 시각을 담는 자리라 "
                       f"겹칠 수 없습니다. 레코드 경로를 확인하거나 원천에서 이름을 "
                       f"바꿔 주세요.")
    data = {}
    for n in names:
        col = []
        for r in rows:
            v = r.get(n)
            if v is None:
                col.append(None)
            elif isinstance(v, (dict, list)):
                col.append(json.dumps(v, ensure_ascii=False))
            elif isinstance(v, bool):
                col.append("true" if v else "false")
            else:
                col.append(str(v))
        data[n] = pa.array(col, pa.string())
    data[INGESTED_AT] = pa.array([ingested_at] * len(rows), pa.string())
    return pa.table(data)


# ---------------------------------------------------------------- 적재

def load(table_name: str, rows: list[dict[str, Any]],
         columns: list[dict[str, str]], mode: str) -> dict[str, Any]:
    """raw 네임스페이스에 적재하고 결과를 돌려준다.

    mode — append(덧붙임) · overwrite(전체 교체)
    스키마가 이미 있는 테이블과 다르면 «컬럼이 늘어난 경우»만 허용하지 않고
    실패시킨다. 조용히 맞추면 어긋난 데이터가 그대로 쌓인다.
    """
    cat = catalog()
    ensure_namespace(cat)
    full = f"{RAW_SCHEMA}.{table_name}"
    # 한 번의 적재는 같은 시각을 갖는다. 행마다 다시 찍으면 같은 배치가 초 단위로
    # 갈라져, 최신 행을 고를 때 배치가 아니라 행 순서를 따르게 된다.
    arrow = to_arrow(rows, columns, _now().isoformat(timespec="seconds"))

    exists = True
    try:
        tbl = cat.load_table(full)
    except Exception:      # noqa: BLE001 — 없으면 만든다
        exists = False

    if not exists:
        tbl = cat.create_table(full, schema=arrow.schema)
    else:
        have = set(tbl.schema().column_names)
        want = set(arrow.schema.names)
        if want != have:
            raise ApiError(
                "VALIDATION_FAILED",
                f"{full} 의 컬럼이 기존 테이블과 다릅니다. "
                f"새로 생긴 컬럼: {', '.join(sorted(want - have)) or '없음'} / "
                f"사라진 컬럼: {', '.join(sorted(have - want)) or '없음'}. "
                f"스키마를 확인하고 다시 저장해 주세요.")

    if mode == "overwrite":
        tbl.overwrite(arrow)
    else:
        tbl.append(arrow)

    return {"table": full, "rows": len(rows), "mode": mode, "created": not exists}


# ---------------------------------------------------------------- 실행

def sample(kind: str, cfg: dict[str, Any], text: str | None = None) -> list[dict[str, Any]]:
    """미리보기·스키마 확인용 표본. 저장도 적재도 하지 않는다."""
    if kind == "api":
        return fetch_api(cfg)
    if kind == "file":
        return parse_file(text or "", cfg)
    raise ApiError("INVALID_ARGUMENT", f"{kind} 수집 방식은 아직 지원하지 않습니다.")


def run_job(job: dict[str, Any], text: str | None = None) -> dict[str, Any]:
    """수집 작업 한 번 실행 — 읽고, 그대로 적재한다.

    **묶음 단위로 읽고 적재한다.** 묶음 하나는 시간 축의 한 칸(과 그 칸에서 도는
    모든 반복 파라미터 값)이다. 예전에는 구간 전체를 메모리에 모아 마지막에 한 번
    적재했는데, 지역 25곳 × 24개월처럼 팬아웃이 붙는 순간 그 방식은 성립하지 않는다 —
    수십만 행을 통째로 들고 있어야 하고, 도중에 끊기면 한 행도 남지 않는다.

    워터마크는 **끝까지 돈 묶음** 뒤에만 올린다. 그래서 중간에 끊겨도 다음 실행이
    그 다음 칸부터 이어 간다. 빠진 구간이 조용히 사라지지 않는 것이 이 순서의 전부다.

    한 번에 다 돌지 못할 만큼 크면(max_calls_per_run) 돈 데까지만 하고
    remaining=true 로 알린다. 호출자가 다시 부르면 이어서 간다.

    행이 0이면 적재하지 않고 rows=0 으로 돌려준다. 호출자(수집 DAG)는 이때
    태스크를 건너뛰어 Asset 이벤트가 나가지 않게 한다 — 바뀐 게 없는데
    후행 파이프라인을 깨우면 빈 실행만 쌓인다.
    """
    if job["kind"] != "api":
        rows = parse_file(text or "", job["config"], limit=0)
        if not rows:
            return {"table": f"{RAW_SCHEMA}.{job['target']}", "rows": 0,
                    "mode": job["mode"], "created": False}
        columns = job.get("columns") or infer_columns(rows)
        return load(job["target"], rows, columns, job["mode"])

    scope = job.get("scope") or {}
    plan = call_plan(scope, job.get("watermark"), _now())
    budget = int(scope.get("max_calls_per_run") or 0)      # 0 = 제한 없음

    # 전체 교체는 «첫 적재만» 교체다. 묶음마다 교체하면 마지막 묶음만 남는다.
    mode = job["mode"]
    total_rows = total_calls = total_pages = 0
    created = False
    covered: date | None = None
    remaining = False

    for group in plan:
        # 예산이 묶음 하나보다 작아도 첫 묶음은 끝까지 돈다(total_calls 가 0이면 통과).
        # 묶음을 쪼개면 그 칸이 반쪽만 들어온 채로 남는데, 워터마크는 그걸 표현할
        # 수 없어서 영영 못 채우는 구간이 된다. 한 칸은 통째로 돌거나 아예 안 돈다.
        if budget and total_calls and total_calls + len(group["calls"]) > budget:
            remaining = True
            break

        rows = []
        for extra in group["calls"]:
            got, pages = fetch_all(job["config"], extra)
            rows.extend(got)
            total_calls += 1
            total_pages += pages

        if rows:
            # 컬럼은 작업에 저장된 것을 쓴다. 저장 시점에 사용자가 확인한 목록이라
            # 이번 응답에 낯선 필드가 끼어들어도 테이블 모양이 흔들리지 않는다.
            columns = job.get("columns") or infer_columns(rows)
            res = load(job["target"], rows, columns, mode)
            created = created or res["created"]
            total_rows += len(rows)
            mode = "append"

        if group["covered"] is not None:
            # 가져올 것이 없었어도 구간은 덮은 것이다. 여기서 올리지 않으면 빈 구간을
            # 영원히 다시 훑는다.
            covered = group["covered"]
            store.ingest_mark(job["id"], covered.isoformat())

    out: dict[str, Any] = {
        "table": f"{RAW_SCHEMA}.{job['target']}", "rows": total_rows,
        "mode": job["mode"], "created": created,
        "calls": total_calls, "pages": total_pages, "groups": len(plan),
    }
    if covered is not None:
        out["covered"] = covered.isoformat()
    if remaining:
        out["remaining"] = True
    return out


def source_tables(jobs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """수집 작업 → dbt source 등록 항목.

    대상이 같은 작업은 하나로 접는다(저장 시 검증하지만 목록 기준으로 한 번 더).
    yml 을 쓰는 곳(sync_sources, 기동 시 재생성)이 모두 이걸 쓴다 — 설명 문구가
    두 군데서 따로 자라면 파일이 부를 때마다 달라진다.
    """
    uniq: dict[str, dict[str, Any]] = {}
    for j in jobs:
        uniq.setdefault(j["target"], {
            "name": j["target"],
            "description": f"{j['name']} — 데이터 수집이 적재하는 원천 테이블입니다.",
            # 적재 시각은 작업에 저장된 컬럼 목록에 없다(원천이 준 것이 아니므로).
            # 그래도 테이블에는 있으니 source 에도 적어야 모델이 참조할 수 있다.
            "columns": [*(j.get("columns") or []), {"name": INGESTED_AT, "type": "string"}],
        })
    return list(uniq.values())


def sync_sources(jobs: list[dict[str, Any]] | None = None) -> None:
    """수집 작업 목록 → dbt source 등록 → manifest 갱신.

    작업을 저장하거나 지울 때마다 부른다. dbt 가 알아야 모델이 참조할 수 있고,
    카탈로그·계보 화면에도 원천으로 나타난다.

    파싱이 실패하면 파일을 되돌린다. 깨진 등록을 남기면 그 뒤의 모든 저장이
    같은 오류로 막히고, 화면에서는 손댈 방법이 없다.
    """
    jobs = store.ingest_jobs() if jobs is None else jobs

    path = dbtproj.SOURCES_PATH
    prev = path.read_text() if path.exists() else None
    dbtproj.write_sources(source_tables(jobs))
    try:
        dbtproj.reparse()
    except Exception:
        if prev is None:
            path.unlink(missing_ok=True)
        else:
            path.write_text(prev)
        dbtproj.reparse()          # manifest 를 되돌린 상태로 다시 맞춘다
        raise
