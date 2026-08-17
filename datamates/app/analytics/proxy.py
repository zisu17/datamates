"""Superset 리버스 프록시 — Superset 에 주소를 주지 않는다.

브라우저는 이 서버(8000)만 안다. 분석 화면의 iframe 도 이 서버를 부르고,
그 요청이 여기서 Superset 으로 중계된다. 결과적으로

  · 사용자에게 노출되는 접속점이 하나다 (설치형 전제)
  · iframe 이 같은 오리진이라 X-Frame-Options·쿠키 문제가 생기지 않는다
  · Superset 세션은 서버 쪽에만 있고 브라우저로 나가지 않는다

Superset이 생성하는 절대 경로와 동일한 경로로 요청을 중계한다. 이 서버가 Superset의 경로를
같은 이름으로
내보내므로 생성된 절대 경로가 저절로 맞는다. 대가는 URL 이름공간을 공유하는 것이고,
**플랫폼 라우트가 항상 우선한다**(등록 순서로 보장한다 — main.py 참고).

**보안 경계가 아니라 제품 경계다.** 이 플랫폼에는 사용자 인증이 없고(README 의
의도적 선택) Superset 도 서비스 계정 하나로 돈다. 아래 차단 목록은 침입을 막는
장치가 아니라, 분석 기능이 «노출된 Superset 관리 콘솔» 로 변하는 것과
카탈로그 이중 관리를 막는 장치다.
"""

from __future__ import annotations

import re
from typing import AsyncIterator

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import Response, StreamingResponse

from ..config import SUPERSET_BASE_URL
from ..errors import ApiError
from . import client

router = APIRouter(tags=["analytics"])

# Superset 으로 중계하는 경로 접두사. 플랫폼이 쓰지 않는 것만 골랐다.
#
# 여기 없는 경로는 Superset 화면이 필요해질 때 추가한다. 눈먼 catch-all 을 두지
# 않는 이유는 오타 난 플랫폼 경로가 조용히 Superset 으로 새는 것을 막기 위해서다.
FORWARD = (
    "/static/",                 # Superset · Flask-AppBuilder 자산
    "/superset/",               # 대시보드·welcome 등 (Superset 의 자기 경로)
    "/explore/", "/chart/", "/dashboard/", "/sqllab/", "/dataset/",
    "/datasource/", "/tablemodelview/", "/savedqueryview/",
    "/annotationlayer/", "/csstemplatemodelview/", "/alert/", "/report/",
    "/theme/", "/locale/", "/resources/", "/health", "/csrf_token/",
    "/embedded/",                # SDK 임베드 경로 (대시보드 iframe)
)

# API 는 접두사가 겹친다. 플랫폼도 /api/v1 을 쓰므로 **플랫폼 라우트 전부가
# 등록된 뒤**에 폴백으로 붙인다 (main.py). 플랫폼이 처리하지 않는 것만 여기로 온다.
API_FALLBACK = "/api/v1/"

# 중계하지 않는 경로.
#
# 세션·계정 관리 — 세션은 서버가 관리한다. 사용자가 로그아웃하면 서비스 계정
# 세션이 끊겨 다른 사용자의 화면까지 깨진다.
# 연결 관리 — 사람이 여기서 DB 연결을 만들면 dbt manifest 가 단일 원천이 아니게 된다.
# FORWARD 허용 목록에 없는 경로는 애초에 여기까지 오지 않는다(그쪽이 1차 방어다).
# 이 목록은 **/api/v1 폴백으로 열려 버리는 것**을 막는 2차 방어다.
BLOCKED = (
    "/logout", "/login", "/register", "/resetmypassword", "/userinfo",
    "/users/", "/roles/", "/permissions/", "/viewactivity/",
    "/databaseview/",
    "/api/v1/security/login", "/api/v1/security/guest_token",
)

# 읽기는 되지만 쓰기는 막는 경로. 카탈로그를 만드는 것은 플랫폼의 일이다 —
# 사람이 Superset 화면에서 DB 연결이나 데이터셋을 만들면 dbt manifest 가
# 단일 원천이 아니게 된다.
#
# 차트·대시보드는 막지 않는다. 그건 사용자가 만드는 것이 맞다.
READ_ONLY = ("/api/v1/database", "/api/v1/dataset")
WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}

# 브라우저↔서버 사이에서만 의미가 있는 헤더. 중계하면 안 된다.
HOP_BY_HOP = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailer", "transfer-encoding", "upgrade", "host", "content-length",
}

# Superset 화면 요소 감추기.
#
# standalone 파라미터가 네비게이션 대부분을 없애 주지만 로고·푸터 같은 것이 남는다.
# 선택자는 Superset 버전에 묶이므로 **여기 한 곳에 모아 둔다** — 업그레이드 때
# 육안으로 확인하고 이 문자열만 고친다(설계서 리스크 5).
# standalone=3 이 대시보드 헤더까지 없애 주므로 여기서 할 일은 많지 않다.
# 그래도 남겨 두는 이유: standalone 의 의미가 버전에 따라 바뀌면 헤더가 다시
# 나타나는데, 그때 이 규칙이 완충이 된다.
CHROME_CSS = """
<style id="datamates-chrome">
  /* 감출 것 — 전역 네비게이션 · 중복 제목 · 브랜드 요소 */
  #app-menu, .navbar, nav.navbar, #main-menu, .superset-logo,
  .dashboard-header, [data-test="dashboard-header"],
  footer, .footer { display: none !important; }
  body.datamates-embedded { background: #FFFFFF !important; }

  /* 플랫폼 디자인 기준에 맞춘다 — 토큰 값을 그대로 쓴다.
     그림자를 쓰지 않고 경계선으로만 구분한다. */
  .dashboard, .grid-content, [data-test="grid-content"] {
    background: #FFFFFF !important; padding: 0 !important;
  }
  .dashboard-component-chart-holder,
  [data-test="dashboard-component-chart-holder"] {
    border: 1px solid #E1E1E1 !important; border-radius: 8px !important;
    box-shadow: none !important; background: #FFFFFF !important;
    padding: 20px !important;
  }
  /* 카드 간 세로 간격 16px */
  .grid-row, [data-test="grid-row"] { margin-bottom: 16px !important; }
  .grid-row:last-child { margin-bottom: 0 !important; }
  /* 카드 헤더 — 제목 16px/600, 하단 경계선 없음 */
  .chart-header, [data-test="slice-header"] {
    border-bottom: 0 !important; padding: 0 0 12px !important;
  }
  .chart-header .header-title, [data-test="editable-title"] {
    font-size: 16px !important; font-weight: 600 !important;
    color: #333333 !important; letter-spacing: -0.5px !important;
  }
  /* 상세 화면의 필터 바는 사용자 입력에 필요하므로 유지한다. */

  /* 로딩 표시 전용 훅에 Skeleton을 적용한다. */
  [data-test="loading-indicator"] {
    min-height: 240px !important; background: #F7F8FA !important;
    border-radius: 8px !important;
    animation: dm-skel 1.4s ease-in-out infinite !important;
  }
  [data-test="loading-indicator"] > * { visibility: hidden !important; }

  /* 표가 카드보다 넓으면 가로 스크롤을 제공한다. */
  .superset-chart-table > div { overflow-x: auto !important; }
  @keyframes dm-skel { 0%,100% { opacity: 1 } 50% { opacity: .55 } }
</style>
"""

_BODY_OPEN = re.compile(rb"<body([^>]*)>", re.IGNORECASE)


def forwarded(path: str) -> bool:
    """이 경로를 Superset 으로 넘기는가."""
    return any(path == p.rstrip("/") or path.startswith(p) for p in FORWARD)


def _blocked(path: str) -> bool:
    p = path.lower()
    return any(p == b.rstrip("/") or p.startswith(b) for b in BLOCKED)


# 브라우저 → Superset 으로 넘기는 헤더. **허용 목록이다.**
#
# 처음에는 «hop-by-hop 과 쿠키만 빼고 다 넘긴다» 였고 POST 가 깨졌다.
# 브라우저가 보내는 것 중 넘기면 안 되는 것이 여럿이다:
#   · referer / origin — localhost:8000 을 가리켜 Superset 의 CSRF 검사를 통과 못 한다
#   · accept-encoding  — 브라우저가 요구하는 인코딩(zstd 등)을 그대로 넘기면
#                        httpx 가 못 푸는 응답을 받는다. 협상은 httpx 에 맡긴다
#   · cookie           — 이 플랫폼의 쿠키다. Superset 세션은 서버가 들고 있다
#   · sec-fetch-* 등   — 브라우저↔이 서버 사이의 맥락이라 의미가 없다
#
# 필요한 헤더가 생기면 여기 추가한다. 목록이 곧 «무엇에 의존하는가» 의 문서다.
PASS_THROUGH = {
    "accept", "accept-language", "content-type", "user-agent",
    "x-requested-with", "range", "if-none-match", "if-modified-since",
    "cache-control",
}


def _forward_headers(request: Request, csrf: str) -> dict[str, str]:
    out = {k: v for k, v in request.headers.items()
           if k.lower() in PASS_THROUGH}
    # Superset 이 자기 오리진으로 보게 한다 — CSRF referer 검사를 통과해야 한다.
    out["Referer"] = SUPERSET_BASE_URL + request.url.path
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        out["X-CSRFToken"] = csrf
    return out


def _response_headers(r: httpx.Response, *, drop_encoding: bool) -> dict[str, str]:
    out = {}
    for k, v in r.headers.items():
        kl = k.lower()
        if kl in HOP_BY_HOP:
            continue
        if kl == "content-encoding" and drop_encoding:
            continue          # 본문을 디코딩해서 넘기므로 이 헤더는 거짓이 된다
        if kl == "set-cookie":
            continue          # Superset 쿠키는 브라우저로 내보내지 않는다
        if kl == "location":
            v = _rewrite_location(v)
        out[k] = v
    return out


def _rewrite_location(loc: str) -> str:
    """리다이렉트 주소에서 Superset 오리진만 벗긴다.

    **경로에 접두사를 덧붙이지 않는다.** 이 프록시는 경로를 그대로 넘긴다 —
    SUPERSET_PREFIX 는 벗겨 낼 접두사가 아니라 Superset 자신의 경로 하나(/superset/*)일
    뿐이고, FORWARD 목록의 다른 경로(/explore/ · /chart/ …)는 접두사 없이 그대로 오간다.
    여기서 붙이면 Superset 의 구 경로(/superset/explore/)로 되돌아가고, 그 경로가 다시
    새 경로로 302 를 내면서 무한 루프가 된다 — 실제로 그렇게 깨뜨려 봤다.
    """
    if loc.startswith(SUPERSET_BASE_URL):
        return loc[len(SUPERSET_BASE_URL):] or "/"
    return loc


def _inject_chrome_css(body: bytes) -> bytes:
    if b"datamates-chrome" in body:
        return body
    m = _BODY_OPEN.search(body)
    if not m:
        return body
    attrs = m.group(1)
    if b"class=" in attrs:
        attrs = attrs.replace(b'class="', b'class="datamates-embedded ', 1)
    else:
        attrs = attrs + b' class="datamates-embedded"'
    return (body[:m.start()] + b"<body" + attrs + b">"
            + CHROME_CSS.encode() + body[m.end():])


async def _send(request: Request, path: str, body: bytes) -> httpx.Response:
    c, csrf = await client.asession()
    req = c.build_request(request.method, path,
                          headers=_forward_headers(request, csrf),
                          params=dict(request.query_params), content=body)
    try:
        return await c.send(req, stream=True)
    except httpx.HTTPError as e:
        # 예외 «종류» 를 반드시 남긴다. str(e) 가 빈 문자열인 httpx 예외가 있어서,
        # 메시지만 넣으면 details 가 {"error": ""} 로 나오고 원인을 알 수 없다.
        raise ApiError("UPSTREAM_UNAVAILABLE",
                       "분석 엔진에 연결하지 못했습니다.",
                       {"kind": type(e).__name__, "error": str(e)[:200],
                        "path": path, "target": SUPERSET_BASE_URL},
                       status=503) from e


def _is_login_redirect(r: httpx.Response) -> bool:
    return (r.status_code in (301, 302, 303, 307, 308)
            and "/login" in r.headers.get("location", ""))


async def _needs_relogin(r: httpx.Response) -> tuple[bool, bool]:
    """(다시 로그인해야 하는가, 본문을 이미 읽었는가).

    401/403 과 로그인 리다이렉트 말고 **400 + CSRF 무효**도 포함해야 한다.
    Superset 은 세션을 회전시키면서 CSRF 토큰을 갈아 치우고, 그때 저장해 둔
    토큰으로 POST 하면 401 이 아니라 400 이 온다. 이 경우를 빼면 화면이
    «CSRF token is invalid» 로 멈추고 사용자는 이유를 알 수 없다.

    본문을 읽었는지 함께 돌려주는 이유 — 판별하려고 400 응답을 aread() 하면
    스트림이 소진된다. 그 사실을 호출부가 알아야 aiter_raw() 로 빈 응답을
    내보내지 않는다(재로그인이 아닌 400 은 그대로 브라우저에 전달해야 한다).
    """
    if r.status_code in (401, 403) or _is_login_redirect(r):
        return True, False
    if r.status_code != 400:
        return False, False
    try:
        await r.aread()
    except Exception:      # noqa: BLE001
        return False, False
    return (b"CSRF" in r.content or b"csrf" in r.content), True


async def relay(request: Request, path: str) -> Response:
    """경로를 그대로 Superset 에 넘기고 응답을 돌려준다."""
    if _blocked(path):
        raise ApiError(
            "PERMISSION_DENIED",
            "분석 엔진의 관리 화면은 플랫폼에서 열 수 없습니다.",
            {"path": path, "reason": "세션과 데이터 연결은 플랫폼이 관리합니다."},
            status=403)

    if request.method in WRITE_METHODS and any(path.startswith(p) for p in READ_ONLY):
        raise ApiError(
            "PERMISSION_DENIED",
            "데이터 연결과 데이터셋은 분석 화면에서 만들 수 없습니다. "
            "데이터 모델을 추가하면 플랫폼이 자동으로 만듭니다.",
            {"path": path, "method": request.method},
            status=403)

    body = await request.body()
    r = await _send(request, path, body)

    # 세션이 만료·회전하면 한 번 다시 붙는다.
    relogin, consumed = await _needs_relogin(r)
    if relogin:
        await r.aclose()
        await client.areset()
        r = await _send(request, path, body)
        consumed = False

    ctype = r.headers.get("content-type", "")

    # 판별하느라 이미 읽어 버린 응답은 스트리밍할 수 없다 — 버퍼로 돌려준다.
    if consumed:
        hdrs = _response_headers(r, drop_encoding=True)
        out = r.content
        await r.aclose()
        return Response(content=out, status_code=r.status_code, headers=hdrs,
                        media_type=ctype)

    # HTML 만 버퍼링해서 CSS 를 주입한다. 나머지(정적 자산·JSON)는 흘려보낸다 —
    # Superset 의 JS 번들이 수 MB 라 통째로 메모리에 올릴 이유가 없다.
    if "text/html" in ctype:
        try:
            await r.aread()
            out = _inject_chrome_css(r.content)
            hdrs = _response_headers(r, drop_encoding=True)
        finally:
            await r.aclose()
        return Response(content=out, status_code=r.status_code, headers=hdrs,
                        media_type=ctype)

    hdrs = _response_headers(r, drop_encoding=False)

    async def stream() -> AsyncIterator[bytes]:
        try:
            async for chunk in r.aiter_raw():
                yield chunk
        finally:
            await r.aclose()

    return StreamingResponse(stream(), status_code=r.status_code, headers=hdrs,
                             media_type=ctype)


METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]


# 접두사마다 라우트를 하나씩 등록한다.
#
# catch-all(/{path:path}) 을 두면 안 된다 — Starlette 은 «먼저 매칭된 라우트»
# 하나만 실행하고 그 안에서 404 를 던져도 다음 핸들러로 넘어가지 않는다.
# 그러면 UI 정적 파일 요청까지 이 핸들러에 먹혀 화면이 뜨지 않는다.
# 담당할 경로만 명시로 잡는 편이 안전하고, FORWARD 목록이 곧 문서가 된다.

async def _relay_sub(sub: str, request: Request) -> Response:
    return await relay(request, request.url.path)


for _p in FORWARD:
    if _p.endswith("/"):
        router.add_api_route(f"{_p}{{sub:path}}", _relay_sub, methods=METHODS,
                             include_in_schema=False)
    else:
        router.add_api_route(_p, _relay_sub, methods=METHODS,
                             include_in_schema=False)


# ── /api/v1 폴백 ────────────────────────────────────────────────
# Superset 프런트엔드는 /api/v1/chart/data 같은 자기 API 를 부른다. 플랫폼도
# /api/v1 을 쓰므로 접두사가 겹친다. **플랫폼 라우트 전부가 등록된 뒤**에
# 이 라우터를 붙이면(main.py), 플랫폼이 처리하지 않는 경로만 여기로 온다.
api_fallback = APIRouter(tags=["analytics"])


@api_fallback.api_route(f"{API_FALLBACK}{{sub:path}}", methods=METHODS,
                        include_in_schema=False)
async def superset_api_fallback(sub: str, request: Request) -> Response:
    return await relay(request, request.url.path)
