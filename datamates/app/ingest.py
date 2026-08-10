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
from typing import Any

from . import dbtproj, store
from .config import dbt_env
from .errors import ApiError

# 수집이 적재하는 네임스페이스. analytics 는 dbt 소유, raw 는 수집 소유다.
RAW_SCHEMA = "raw"

# 표본 조회에서 읽을 최대 행수. 스키마 추론과 미리보기에만 쓴다.
SAMPLE_LIMIT = 50

_NAME_RE = re.compile(r"^[a-z][a-z0-9_]{1,62}$")


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
    """data.items 같은 경로로 응답 안의 레코드 배열을 찾아 들어간다."""
    cur = obj
    for part in (path or "").split("."):
        if not part:
            continue
        if not isinstance(cur, dict) or part not in cur:
            raise ApiError("INVALID_ARGUMENT",
                           f"응답에서 {path} 경로를 찾지 못했습니다. "
                           f"현재 위치의 키: {', '.join(list(cur)[:8]) if isinstance(cur, dict) else '(객체가 아님)'}")
        cur = cur[part]
    return cur


def fetch_api(cfg: dict[str, Any], limit: int = SAMPLE_LIMIT) -> list[dict[str, Any]]:
    """API 한 번 호출해서 레코드 목록을 얻는다.

    페이지네이션은 여기서 돌지 않는다 — 표본과 단순 수집에는 필요 없고,
    페이지를 도는 것은 실행기(run_job)의 일이다.
    """
    import httpx

    url = (cfg.get("url") or "").strip()
    if not url:
        raise ApiError("INVALID_ARGUMENT", "요청 주소를 입력해 주세요.")

    headers = dict(cfg.get("headers") or {})
    auth = cfg.get("auth") or {}
    kind = auth.get("kind")
    if kind == "bearer" and auth.get("token"):
        headers["Authorization"] = f"Bearer {auth['token']}"
    elif kind == "header" and auth.get("name"):
        headers[auth["name"]] = auth.get("value", "")

    try:
        r = httpx.request(cfg.get("method", "GET"), url,
                          headers=headers, params=cfg.get("params") or None,
                          timeout=30.0, follow_redirects=True)
    except httpx.HTTPError as e:
        raise ApiError("UPSTREAM_UNAVAILABLE",
                       f"요청에 실패했습니다: {str(e)[:200]}", status=503) from e
    if r.status_code >= 400:
        raise ApiError("UPSTREAM_UNAVAILABLE",
                       f"응답이 실패입니다 (HTTP {r.status_code}). {r.text[:200]}", status=503)
    try:
        body = r.json()
    except ValueError as e:
        raise ApiError("INVALID_ARGUMENT",
                       "JSON 응답이 아닙니다. 파일 수집을 쓰거나 주소를 확인해 주세요.") from e

    rows = _walk(body, cfg.get("record_path") or "")
    if isinstance(rows, dict):
        rows = [rows]
    if not isinstance(rows, list):
        raise ApiError("INVALID_ARGUMENT",
                       "레코드 목록을 찾지 못했습니다. 응답 안의 배열 경로를 레코드 경로 칸에 적어 주세요.")
    out = [x for x in rows if isinstance(x, dict)]
    if not out and rows:
        raise ApiError("INVALID_ARGUMENT",
                       "레코드가 객체 배열이 아닙니다. 이 형태는 아직 지원하지 않습니다.")
    return out[:limit] if limit else out


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


def to_arrow(rows: list[dict[str, Any]], columns: list[dict[str, str]]) -> Any:
    """레코드를 Arrow 테이블로. 모든 값은 문자열로 눕힌다.

    중첩 객체·배열은 JSON 문자열 그대로 넣는다 — 펼치는 것은 dbt 의 일이다.
    """
    import pyarrow as pa

    names = [c["name"] for c in columns]
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
    arrow = to_arrow(rows, columns)

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

    행이 0이면 적재하지 않고 rows=0 으로 돌려준다. 호출자(수집 DAG)는 이때
    태스크를 건너뛰어 Asset 이벤트가 나가지 않게 한다 — 바뀐 게 없는데
    후행 파이프라인을 깨우면 빈 실행만 쌓인다.
    """
    if job["kind"] == "api":
        rows = fetch_api(job["config"], limit=0)
    else:
        rows = parse_file(text or "", job["config"], limit=0)

    if not rows:
        return {"table": f"{RAW_SCHEMA}.{job['target']}", "rows": 0,
                "mode": job["mode"], "created": False}

    # 컬럼은 작업에 저장된 것을 쓴다. 저장 시점에 사용자가 확인한 목록이라
    # 이번 응답에 낯선 필드가 끼어들어도 테이블 모양이 흔들리지 않는다.
    columns = job.get("columns") or infer_columns(rows)
    return load(job["target"], rows, columns, job["mode"])


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
            "columns": j.get("columns") or [],
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
