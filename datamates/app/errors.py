"""오류 규약 — 설계서 2.4.

응답 본문은 code · message · details · requestId 네 필드로 고정한다.
message 는 화면 토스트에 그대로 나가므로 **서버가 한국어 완성 문장으로** 만든다.
클라이언트가 문자열을 조합하면 같은 오류가 화면마다 다르게 보인다.
"""

from __future__ import annotations

from typing import Any

from fastapi import Request
from fastapi.responses import JSONResponse

# HTTP 상태 → 기본 code. 도메인 코드가 있으면 그쪽이 우선한다.
DEFAULT_CODE = {
    400: "INVALID_ARGUMENT", 401: "UNAUTHENTICATED", 403: "PERMISSION_DENIED",
    404: "NOT_FOUND", 409: "CONFLICT", 422: "VALIDATION_FAILED",
    500: "INTERNAL", 503: "UPSTREAM_UNAVAILABLE", 504: "UPSTREAM_UNAVAILABLE",
}

# 설계서 2.4 «도메인 오류 코드» — 화면이 클라이언트 검증으로 막는 규칙들이고,
# 서버도 같은 규칙을 독립적으로 검증한다.
DOMAIN_STATUS = {
    "SQL_MULTI_STATEMENT": 422,
    "SQL_DDL_NOT_ALLOWED": 422,
    "SQL_UNKNOWN_REF": 422,
    "SQL_NO_SELECT": 422,
    "GRAPH_CYCLE": 409,
    "GRAPH_DUPLICATE_EDGE": 409,
    "GRAPH_SOURCE_INPUT": 409,
    "FOLDER_GROUP_MISMATCH": 422,
    "MODEL_IN_USE": 409,
}


class ApiError(Exception):
    """도메인 오류. status 를 주지 않으면 code 에서 정한다."""

    # 표준 code → HTTP 상태. DEFAULT_CODE 의 역방향이다.
    _STATUS_BY_CODE = {v: k for k, v in DEFAULT_CODE.items()}

    def __init__(self, code: str, message: str,
                 details: dict[str, Any] | None = None, status: int | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}
        # 우선순위: 명시한 status → 도메인 코드의 상태 → 표준 코드의 상태 → 400
        self.status = (status
                       or DOMAIN_STATUS.get(code)
                       or self._STATUS_BY_CODE.get(code)
                       or 400)


def not_found(what: str) -> ApiError:
    return ApiError("NOT_FOUND", f"{what} 을(를) 찾을 수 없습니다.", status=404)


def bad_request(message: str, details: dict[str, Any] | None = None) -> ApiError:
    return ApiError("INVALID_ARGUMENT", message, details, status=400)


def forbidden(message: str) -> ApiError:
    return ApiError("PERMISSION_DENIED", message, status=403)


def body(code: str, message: str, details: dict[str, Any] | None,
         request: Request | None) -> dict[str, Any]:
    out: dict[str, Any] = {"code": code, "message": message, "details": details or {}}
    rid = request.headers.get("X-Request-Id") if request else None
    if rid:
        out["requestId"] = rid
    return out


def install(app: Any) -> None:
    """예외 핸들러를 붙인다. FastAPI 기본 형식({"detail": ...})을 규약 형식으로 바꾼다."""
    from fastapi.exceptions import RequestValidationError
    from starlette.exceptions import HTTPException as StarletteHTTPException

    from .airflow_client import AirflowError
    from .dbtproj import DbtError

    @app.exception_handler(ApiError)
    def _api_error(request: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse(status_code=exc.status,
                            content=body(exc.code, exc.message, exc.details, request))

    @app.exception_handler(StarletteHTTPException)
    def _http(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        detail = exc.detail
        if isinstance(detail, dict) and "message" in detail:
            return JSONResponse(status_code=exc.status_code, content=body(
                detail.get("code") or DEFAULT_CODE.get(exc.status_code, "ERROR"),
                detail["message"], detail.get("details") or
                {k: v for k, v in detail.items() if k not in ("code", "message")},
                request))
        return JSONResponse(status_code=exc.status_code, content=body(
            DEFAULT_CODE.get(exc.status_code, "ERROR"), str(detail), None, request))

    @app.exception_handler(RequestValidationError)
    def _validation(request: Request, exc: RequestValidationError) -> JSONResponse:
        first = (exc.errors() or [{}])[0]
        loc = " → ".join(str(x) for x in (first.get("loc") or [])[1:])
        return JSONResponse(status_code=400, content=body(
            "INVALID_ARGUMENT",
            f"요청 값이 올바르지 않습니다{f' ({loc})' if loc else ''}: {first.get('msg', '')}",
            {"errors": exc.errors()[:5]}, request))

    @app.exception_handler(DbtError)
    def _dbt(request: Request, exc: DbtError) -> JSONResponse:
        return JSONResponse(status_code=422, content=body(
            "VALIDATION_FAILED", str(exc),
            {"output": exc.output, "command": exc.command}, request))

    @app.exception_handler(AirflowError)
    def _airflow(request: Request, exc: AirflowError) -> JSONResponse:
        return JSONResponse(status_code=503, content=body(
            "UPSTREAM_UNAVAILABLE",
            "오케스트레이션 서버(Airflow)에 연결하지 못했습니다. 컨테이너가 떠 있는지 확인해 주세요.",
            {"status": exc.status, "body": exc.body[:500]}, request))
