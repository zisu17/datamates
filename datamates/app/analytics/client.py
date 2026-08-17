"""Superset REST 클라이언트 — 서비스 계정 세션 하나를 계속 쓴다.

권한 모델이 없으므로 계정은 하나다. 그래서 사용자별 토큰 위임이 필요 없고,
세션 하나를 서버가 들고 있으면서 목록 조회와 프록시가 함께 쓴다.

세션에는 세 조각이 필요하다.
  · access_token — REST API 호출용 Bearer
  · csrf_token   — POST/PUT/DELETE 에 X-CSRFToken 으로 붙는다
  · 세션 쿠키    — 화면(HTML) 요청용. CSRF 토큰을 발급한 세션과 짝이어야 한다.

세 개가 짝이므로 하나가 만료하면 함께 다시 받는다. 만료 시각을 추적하지 않고
401/403 이 나면 한 번 재발급하는 방식은 airflow_client.py 와 같다.
"""

from __future__ import annotations

import threading
from typing import Any

import httpx

from ..config import (SUPERSET_BASE_URL, SUPERSET_PREFIX, SUPERSET_USER,
                      superset_password)
from ..errors import ApiError

TIMEOUT = httpx.Timeout(60.0, connect=10.0)

_lock = threading.Lock()
_client: httpx.Client | None = None
_token: str = ""
_csrf: str = ""


# follow_redirects=False — 프록시가 Location 을 직접 고쳐야 하므로
# 따라가면 안 된다(따라가면 접두사 없는 주소로 새 나간다).
_KW: dict[str, Any] = {"base_url": SUPERSET_BASE_URL, "timeout": TIMEOUT,
                       "follow_redirects": False}

_LOGIN_JSON = {"provider": "db", "refresh": True}


def _login_json() -> dict[str, Any]:
    return {**_LOGIN_JSON, "username": SUPERSET_USER,
            "password": superset_password()}


def _form_login_data(csrf: str) -> dict[str, str]:
    """화면(HTML) 요청용 세션 쿠키를 심는 폼 로그인 값.

    REST 는 Bearer 로 되지만 Superset 화면은 세션 쿠키로 인증한다.
    프록시가 HTML 을 가져오려면 이 쿠키가 있어야 한다.
    """
    return {"username": SUPERSET_USER, "password": superset_password(),
            "csrf_token": csrf}


def _upstream_error(what: str, status: int, body: str = "") -> ApiError:
    return ApiError("UPSTREAM_UNAVAILABLE", f"분석 엔진{what}",
                    {"status": status, "body": body[:300]}, status=503)


def _login(c: httpx.Client) -> tuple[str, str]:
    """access_token 과 csrf_token 을 같은 세션으로 받는다."""
    r = c.post("/api/v1/security/login", json=_login_json())
    if r.status_code >= 400:
        raise _upstream_error("에 로그인하지 못했습니다.", r.status_code, r.text)
    token = r.json()["access_token"]

    r = c.get("/api/v1/security/csrf_token/",
              headers={"Authorization": f"Bearer {token}"})
    if r.status_code >= 400:
        raise _upstream_error("의 CSRF 토큰을 받지 못했습니다.", r.status_code, r.text)
    csrf = r.json()["result"]

    # 실패해도 REST 는 동작하므로 예외를 올리지 않는다 — 프록시 쪽에서 드러난다.
    try:
        c.post("/login/", data=_form_login_data(csrf),
               headers={"Referer": SUPERSET_BASE_URL + "/login/"})
    except Exception:      # noqa: BLE001, S110
        pass
    return token, csrf


def session() -> tuple[httpx.Client, str, str]:
    """(클라이언트, access_token, csrf_token). 없으면 만든다.

    로그인이 실패하면 만든 클라이언트를 반드시 버린다. 남겨 두면 토큰이 빈
    채로 _client 가 살아 있어서, 이후 모든 호출이 그 클라이언트를 재사용하며
    다시 로그인하지 않는다 — 엔진이 늦게 떠도 플랫폼은 계속 실패한 상태로
    남는다(앱을 재시작해야 풀린다). 실패는 다음 호출에서 새로 시도되어야 한다.
    """
    global _client, _token, _csrf
    with _lock:
        if _client is None:
            c = httpx.Client(**_KW)
            try:
                _token, _csrf = _login(c)
            except Exception:
                try:
                    c.close()
                except Exception:      # noqa: BLE001, S110
                    pass
                _token, _csrf = "", ""
                raise
            _client = c
        return _client, _token, _csrf


def reset() -> None:
    """세션을 버린다. 다음 호출이 다시 로그인한다."""
    global _client, _token, _csrf
    with _lock:
        if _client is not None:
            try:
                _client.close()
            except Exception:      # noqa: BLE001, S110
                pass
        _client, _token, _csrf = None, "", ""


# ─────────────────────────────────────────────────────────────
# 비동기 세션 — 프록시 전용
# ─────────────────────────────────────────────────────────────
#
# 프록시는 브라우저 트래픽의 통로라 요청이 잦고 응답이 크다(JS 번들 수 MB).
# 동기 클라이언트로 받으면 그 시간만큼 워커 스레드를 물고 있으므로 async 로 둔다.
# REST 목록 조회(위쪽)는 다른 라우터들과 같은 동기 스타일을 유지한다.
#
# 세션이 둘이지만 같은 서비스 계정이고 각자 로그인해 토큰·쿠키가 짝을 이룬다.

_alock: Any = None
_aclient: httpx.AsyncClient | None = None
_acsrf: str = ""


async def _alogin(c: httpx.AsyncClient) -> str:
    r = await c.post("/api/v1/security/login", json=_login_json())
    if r.status_code >= 400:
        raise _upstream_error("에 로그인하지 못했습니다.", r.status_code, r.text)
    token = r.json()["access_token"]

    r = await c.get("/api/v1/security/csrf_token/",
                    headers={"Authorization": f"Bearer {token}"})
    if r.status_code >= 400:
        raise _upstream_error("의 CSRF 토큰을 받지 못했습니다.", r.status_code, r.text)
    csrf = r.json()["result"]

    try:
        await c.post("/login/", data=_form_login_data(csrf),
                     headers={"Referer": SUPERSET_BASE_URL + "/login/"})
    except Exception:      # noqa: BLE001, S110
        pass
    return csrf


async def asession() -> tuple[httpx.AsyncClient, str]:
    """(비동기 클라이언트, csrf_token)."""
    global _alock, _aclient, _acsrf
    if _alock is None:
        import asyncio
        _alock = asyncio.Lock()
    async with _alock:
        if _aclient is None:
            _aclient = httpx.AsyncClient(**_KW)
            _acsrf = await _alogin(_aclient)
        return _aclient, _acsrf


async def areset() -> None:
    global _aclient, _acsrf
    if _aclient is not None:
        try:
            await _aclient.aclose()
        except Exception:      # noqa: BLE001, S110
            pass
    _aclient, _acsrf = None, ""


def _headers(token: str, csrf: str, method: str) -> dict[str, str]:
    h = {"Authorization": f"Bearer {token}"}
    if method.upper() not in ("GET", "HEAD", "OPTIONS"):
        h["X-CSRFToken"] = csrf
        h["Referer"] = SUPERSET_BASE_URL
    return h


def api(method: str, path: str, *, retry: bool = True, **kw: Any) -> Any:
    """REST 호출. 401/403 이면 한 번 다시 로그인하고 재시도한다."""
    c, token, csrf = session()
    try:
        r = c.request(method, path, headers=_headers(token, csrf, method), **kw)
    except httpx.HTTPError as e:
        raise ApiError("UPSTREAM_UNAVAILABLE",
                       "분석 엔진에 연결하지 못했습니다. 컨테이너가 떠 있는지 확인해 주세요.",
                       {"error": str(e)[:300], "target": SUPERSET_BASE_URL},
                       status=503) from e

    if r.status_code in (401, 403) and retry:
        reset()
        return api(method, path, retry=False, **kw)

    if r.status_code >= 400:
        raise ApiError("UPSTREAM_UNAVAILABLE",
                       "분석 엔진이 요청을 거부했습니다.",
                       {"status": r.status_code, "path": path, "body": r.text[:300]},
                       status=503)
    if not r.content:
        return None
    return r.json()


# ─────────────────────────────────────────────────────────────
# 목록 — 화면 A 가 쓴다
# ─────────────────────────────────────────────────────────────

def _rison_columns(cols: list[str]) -> str:
    return "!(" + ",".join(cols) + ")"


# 작성자·수정 시각은 화면 목록이 그대로 쓴다 — 「누가 · 언제」 는 목록의 기본 정보다.
_DASH_COLS = ['id', 'dashboard_title', 'status', 'changed_on_delta_humanized',
              'changed_on_utc', 'url',
              'changed_by.first_name', 'changed_by.last_name',
              'created_by.first_name', 'created_by.last_name']
_CHART_COLS = ['id', 'slice_name', 'viz_type', 'description', 'datasource_id',
               'changed_on_delta_humanized', 'changed_on_utc', 'url',
               'changed_by.first_name', 'changed_by.last_name',
               'created_by.first_name', 'created_by.last_name']


def dashboards() -> list[dict[str, Any]]:
    q = ("(order_column:changed_on_delta_humanized,order_direction:desc,page_size:100,"
         f"columns:{_rison_columns(_DASH_COLS)})")
    out = api("GET", f"/api/v1/dashboard/?q={q}")
    return out.get("result", []) if out else []


def charts() -> list[dict[str, Any]]:
    q = ("(order_column:changed_on_delta_humanized,order_direction:desc,page_size:100,"
         f"columns:{_rison_columns(_CHART_COLS)})")
    out = api("GET", f"/api/v1/chart/?q={q}")
    return out.get("result", []) if out else []


# ── 즐겨찾기 ────────────────────────────────────────────────────
# 사용자 신원이 없으므로 «서비스 계정의 즐겨찾기» 다. 지금은 설치 전체가
# 하나의 즐겨찾기 목록을 공유한다 — 권한 모델이 생기면 사용자별로 갈린다.

def favorites(kind: str, ids: list[int]) -> dict[int, bool]:
    if not ids:
        return {}
    q = "!(" + ",".join(str(i) for i in ids) + ")"
    try:
        out = api("GET", f"/api/v1/{kind}/favorite_status/?q={q}")
    except ApiError:
        return {}
    return {int(r["id"]): bool(r.get("value"))
            for r in (out or {}).get("result", [])}


def set_favorite(kind: str, obj_id: int, on: bool) -> None:
    api("POST" if on else "DELETE", f"/api/v1/{kind}/{obj_id}/favorites/")


def datasets() -> list[dict[str, Any]]:
    q = ("(page_size:200,"
         f"columns:{_rison_columns(['id', 'table_name', 'schema', 'database.id'])})")
    out = api("GET", f"/api/v1/dataset/?q={q}")
    return out.get("result", []) if out else []


def dashboard_datasets(dash_id: int) -> list[dict[str, Any]]:
    """그 대시보드가 쓰는 데이터셋. 화면 B 의 «쓰는 데이터 모델» 줄이 이걸 쓴다."""
    out = api("GET", f"/api/v1/dashboard/{dash_id}/datasets")
    return out.get("result", []) if out else []




def embed_uuid(dash_id: int) -> str:
    """대시보드의 임베드 uuid. 없으면 등록하고 받는다(멱등).

    등록은 «이 대시보드를 iframe 에 넣어도 된다» 는 표시다. 사용자가 목록에서
    대시보드를 처음 열 때 자동으로 되므로 별도 관리 화면이 필요 없다.
    """
    try:
        out = api("GET", f"/api/v1/dashboard/{dash_id}/embedded")
        got = (out or {}).get("result") or []
        # 등록돼 있으면 리스트로 온다. 없으면 빈 리스트다.
        if isinstance(got, list) and got and got[0].get("uuid"):
            return got[0]["uuid"]
        if isinstance(got, dict) and got.get("uuid"):
            return got["uuid"]
    except ApiError:
        pass          # 조회 실패는 «아직 등록 안 됨» 으로 보고 등록을 시도한다

    out = api("POST", f"/api/v1/dashboard/{dash_id}/embedded",
              json={"allowed_domains": []})
    return ((out or {}).get("result") or {})["uuid"]


def guest_token(uuid: str) -> str:
    """그 대시보드만 볼 수 있는 게스트 토큰.

    RLS 규칙을 넣지 않는다 — 이 플랫폼에는 사용자 신원이 없어서 걸러 낼 기준이 없다.
    권한 모델이 생기면 rls 인자가 그 자리다.
    """
    out = api("POST", "/api/v1/security/guest_token/", json={
        "user": {"username": "datamates", "first_name": "Data", "last_name": "Mates"},
        "resources": [{"type": "dashboard", "id": uuid}],
        "rls": [],
    })
    return (out or {})["token"]


# ─────────────────────────────────────────────────────────────
# 분석 실행 · 차트 저장 · 대시보드 배치 — 화면 C 가 쓴다
# ─────────────────────────────────────────────────────────────

def run_query(payload: dict[str, Any]) -> dict[str, Any]:
    """분석 실행. Superset 이 SQL 을 만들고 DuckDB 가 돈다.

    화면은 SQL 을 보지 않는다 — 컬럼과 행만 받는다.
    """
    out = api("POST", "/api/v1/chart/data", json=payload)
    res = ((out or {}).get("result") or [{}])[0]
    if res.get("error"):
        raise ApiError("INVALID_ARGUMENT", "분석을 실행하지 못했습니다.",
                       {"error": str(res["error"])[:400]})
    data = res.get("data") or []
    cols = res.get("colnames") or (list(data[0].keys()) if data else [])
    return {"columns": cols,
            "rows": [[r.get(c) for c in cols] for r in data],
            "rowCount": res.get("rowcount", len(data)),
            # 만들어진 SQL. 화면에는 접어 둔다 — 필요할 때만 열어 본다.
            "sql": res.get("query") or ""}


def create_chart(name: str, dataset_id: int, params: dict[str, Any],
                 dashboard_ids: list[int] | None = None,
                 query_context: dict[str, Any] | None = None) -> int:
    """차트를 저장한다.

    query_context 를 함께 넣는 이유가 중요하다. 이게 없으면
    GET /api/v1/chart/<id>/data/ 가 «Chart has no query context saved» 로 거절한다.
    그 엔드포인트가 **플랫폼이 차트를 직접 그리는 근거**다 — 저장된 차트를
    Superset 이 실행해 주고, 그림은 우리가 그린다.
    스펙을 따로 저장하지 않아도 되므로 원천이 하나로 유지된다.
    """
    import json as _json
    body: dict[str, Any] = {
        "slice_name": name,
        "viz_type": params["viz_type"],
        "datasource_id": int(dataset_id),
        "datasource_type": "table",
        "params": _json.dumps(params, ensure_ascii=False),
    }
    if query_context:
        body["query_context"] = _json.dumps(query_context, ensure_ascii=False)
    if dashboard_ids:
        body["dashboards"] = dashboard_ids
    return api("POST", "/api/v1/chart/", json=body)["id"]


def chart_data(chart_id: int) -> dict[str, Any]:
    """저장된 차트를 실행해 결과를 받는다. 그림은 플랫폼이 그린다."""
    out = api("GET", f"/api/v1/chart/{chart_id}/data/?format=json&type=results")
    res = ((out or {}).get("result") or [{}])[0]
    data = res.get("data") or []
    cols = res.get("colnames") or (list(data[0].keys()) if data else [])
    return {"columns": cols,
            "rows": [[r.get(c) for c in cols] for r in data]}


def dashboard_charts(dash_id: int) -> list[dict[str, Any]]:
    out = api("GET", f"/api/v1/dashboard/{dash_id}/charts")
    return (out or {}).get("result", [])


# 대시보드 격자에서 폭은 12칼럼, 높이 1단위는 8px 다.
# 폭 8 은 12칼럼의 2/3 라 카드 오른쪽이 비어 보인다 — 12(전체 폭)로 둔다.
# 높이는 시각화별로 콘텐츠에 맞춘다: 막대·선 320px · 원 280px · 숫자 160px.
GRID_WIDTH = 12
GRID_HEIGHT = {"echarts_timeseries_bar": 40, "echarts_timeseries_line": 40,
               "pie": 35, "big_number_total": 20, "table": 40}


def place_on_dashboard(dash_id: int, chart_id: int, name: str,
                       viz: str = "table") -> None:
    """대시보드 맨 아래에 한 줄을 더해 차트를 놓는다.

    position_json은 Superset이 대시보드 배치를 담는 트리다. 차트 관계와 화면 배치를
    함께 저장해야 대시보드에 표시된다.

    사용자가 Superset 화면에서 위치를 옮기면 그 결과가 이 트리에 남고,
    다음 추가는 그 아래에 붙는다. 여기서 재배치하지 않는다.
    """
    import json as _json
    d = api("GET", f"/api/v1/dashboard/{dash_id}")["result"]
    pos = _json.loads(d.get("position_json") or "{}") or {}

    if "ROOT_ID" not in pos:
        pos = {"DASHBOARD_VERSION_KEY": "v2",
               "ROOT_ID": {"type": "ROOT", "id": "ROOT_ID", "children": ["GRID_ID"]},
               "GRID_ID": {"type": "GRID", "id": "GRID_ID", "children": [],
                           "parents": ["ROOT_ID"]}}

    n = 1
    while f"ROW-dm{n}" in pos or f"CHART-dm{n}" in pos:
        n += 1
    row, chart = f"ROW-dm{n}", f"CHART-dm{n}"

    pos["GRID_ID"]["children"] = list(pos["GRID_ID"].get("children") or []) + [row]
    pos[row] = {"type": "ROW", "id": row, "children": [chart],
                "parents": ["ROOT_ID", "GRID_ID"],
                "meta": {"background": "BACKGROUND_TRANSPARENT"}}
    pos[chart] = {"type": "CHART", "id": chart, "children": [],
                  "parents": ["ROOT_ID", "GRID_ID", row],
                  "meta": {"chartId": int(chart_id), "width": GRID_WIDTH,
                           "height": GRID_HEIGHT.get(viz, 40), "sliceName": name}}

    api("PUT", f"/api/v1/dashboard/{dash_id}",
        json={"position_json": _json.dumps(pos, ensure_ascii=False)})


def create_dashboard(title: str) -> int:
    return api("POST", "/api/v1/dashboard/",
               json={"dashboard_title": title, "published": True})["id"]


def health() -> dict[str, Any]:
    """분석 엔진이 살아 있는지. 화면이 메뉴를 흐리게 처리하는 데 쓴다."""
    try:
        c = httpx.Client(base_url=SUPERSET_BASE_URL, timeout=httpx.Timeout(5.0))
        try:
            ok = c.get("/health").status_code == 200
        finally:
            c.close()
        return {"ok": ok, "prefix": SUPERSET_PREFIX}
    except Exception as e:      # noqa: BLE001
        return {"ok": False, "prefix": SUPERSET_PREFIX, "error": str(e)[:200]}
