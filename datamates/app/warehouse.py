"""웨어하우스 직접 조회 — Spark 를 거치지 않는다.

`dbt show` 는 호출할 때마다 JVM 과 Iceberg jar 를 새로 띄운다. 쿼리 자체는 1초도
안 걸리는데 기동에 15초 이상이 든다. 미리보기처럼 눌렀을 때 바로 나와야 하는
조회에는 쓸 수 없다.

Iceberg 는 REST 카탈로그 + S3 만 있으면 읽을 수 있으므로 Spark 가 필요 없다.
여기서는 DuckDB 의 iceberg 확장으로 카탈로그에 직접 붙는다.

  측정 (fct_events, 같은 머신)
    dbt show (Spark)   17.0 초
    DuckDB             0.035 초

**읽기 전용이다.** 테이블을 만들고 바꾸는 것은 여전히 dbt 와 Spark 의 일이다.
여기로 쓰기를 하면 dbt 가 관리하는 스냅샷·메타데이터와 어긋난다.
"""

from __future__ import annotations

import threading
from typing import Any

from .config import dbt_env
from .errors import ApiError

_lock = threading.Lock()          # 커넥션 생성 보호
_con: Any = None

# dbt 가 쓰는 카탈로그 이름과 구분하기 위해 다른 별칭을 쓴다.
ALIAS = "ice"


def _endpoint(url: str) -> tuple[str, bool]:
    """http://host:port → (host:port, use_ssl). DuckDB 는 스킴을 빼고 받는다."""
    ssl = url.startswith("https://")
    return url.split("://", 1)[-1].rstrip("/"), ssl


def connect() -> Any:
    """프로세스당 루트 커넥션 하나를 재사용한다.

    DuckDB 커넥션은 가볍지만, 매번 만들면 확장 로드와 ATTACH 를 다시 한다.
    서버가 떠 있는 동안 유지하면 조회는 순수 쿼리 시간만 든다.

    다만 이 객체로 직접 질의하면 안 된다 — cursor() 를 거쳐야 한다. 아래 참고.
    """
    global _con
    with _lock:
        if _con is not None:
            return _con
        try:
            import duckdb
        except ImportError as e:      # pragma: no cover
            raise ApiError("UPSTREAM_UNAVAILABLE",
                           "빠른 조회 엔진(duckdb)이 설치되어 있지 않습니다. "
                           "pip install duckdb 후 다시 시도해 주세요.",
                           status=503) from e

        env = dbt_env()
        host, ssl = _endpoint(env.get("MINIO_ENDPOINT", "http://localhost:9000"))
        con = duckdb.connect()
        con.execute("INSTALL iceberg; LOAD iceberg;")
        con.execute(
            "CREATE SECRET (TYPE s3, KEY_ID ?, SECRET ?, ENDPOINT ?, "
            "USE_SSL ?, URL_STYLE 'path', REGION 'us-east-1');",
            [env.get("MINIO_ROOT_USER", "minioadmin"),
             env.get("MINIO_ROOT_PASSWORD", "minioadmin"), host, ssl])
        # iceberg-rest-fixture 는 인증이 없다. 기본값(oauth2)으로 두면
        # «no secret was provided» 로 붙지 못한다.
        con.execute(
            f"ATTACH 'warehouse' AS {ALIAS} (TYPE iceberg, ENDPOINT ?, "
            "AUTHORIZATION_TYPE 'none');",
            [env.get("ICEBERG_REST_URI", "http://localhost:8181")])
        _con = con
        return _con


def cursor() -> Any:
    """질의용 커서. **모든 조회는 이걸로 한다.**

    DuckDB 커넥션은 결과 커서를 하나만 들고 있다. 여러 스레드가 같은 커넥션에
    execute() 하면 나중 것이 앞의 결과를 밀어내고, 앞 스레드의 fetchall() 이
    빈 값을 받는다. FastAPI 는 동기 엔드포인트를 스레드풀에서 돌리므로
    화면 하나가 이력 API 4개를 동시에 부르면 바로 걸린다.

      동시 8회 (같은 커넥션 공유)   성공 1~5 / 8
      동시 8회 (cursor() 사용)      성공 8 / 8

    cursor() 는 같은 DB 인스턴스에 붙은 별도 커넥션이라 ATTACH 된 카탈로그와
    SECRET 을 그대로 쓰면서 결과 커서만 따로 갖는다.
    """
    return connect().cursor()


# 커넥션 자체가 끊긴 경우에만 재접속한다. 질의가 틀려서 난 오류(구문·바인딩·
# 카탈로그)로 커넥션을 닫으면, 같은 커넥션을 쓰던 다른 요청까지 같이 죽는다.
_FATAL = ("ConnectionException", "IOException", "HTTPException", "FatalException")


def _is_fatal(e: Exception) -> bool:
    return type(e).__name__ in _FATAL


def reset() -> None:
    """카탈로그가 재시작되면 붙어 있던 커넥션이 낡는다. 다음 조회에서 다시 붙는다."""
    global _con
    with _lock:
        if _con is not None:
            try:
                _con.close()
            except Exception:      # noqa: BLE001 — 이미 끊긴 커넥션이면 무시한다
                pass
        _con = None


def _qualified(phys: str) -> str:
    """analytics.fct_events → ice.analytics.fct_events"""
    parts = [p for p in phys.split(".") if p]
    if len(parts) != 2:
        raise ApiError("INVALID_ARGUMENT",
                       f"{phys} 는 스키마.테이블 형식이 아닙니다.")
    schema, table = parts
    return f'{ALIAS}."{schema}"."{table}"'


def _execute(sql: str, params: list[Any] | None = None) -> Any:
    """모든 조회의 단일 진입점. 반드시 cursor() 로 실행한다 — 이유는 cursor() 주석 참고."""
    return cursor().execute(sql, params or [])


def _rows(cur: Any) -> dict[str, Any]:
    cols = [d[0] for d in cur.description]
    out = []
    for row in cur.fetchall():
        out.append([_json_safe(v) for v in row])
    return {"columns": cols, "rows": out}


def _json_safe(v: Any) -> Any:
    """Decimal·date·datetime 을 그대로 내보내면 JSON 직렬화에서 막힌다."""
    import datetime
    import decimal
    if isinstance(v, decimal.Decimal):
        return float(v)
    if isinstance(v, (datetime.date, datetime.datetime, datetime.time)):
        return v.isoformat()
    if isinstance(v, (bytes, bytearray)):
        return v.hex()
    return v


def preview(phys: str, limit: int = 20) -> dict[str, Any]:
    """상위 N행. 컬럼 목록은 결과에서 그대로 가져온다."""
    try:
        out = _rows(_execute(f"select * from {_qualified(phys)} limit ?", [int(limit)]))
    except ApiError:
        raise
    except Exception as e:      # noqa: BLE001
        if _is_fatal(e):        # 카탈로그 재시작 등 커넥션 문제일 때만 끊는다
            reset()
        raise ApiError(
            "UPSTREAM_UNAVAILABLE",
            f"{phys} 를 읽지 못했습니다. 아직 한 번도 생성되지 않았을 수 있습니다.",
            {"error": str(e)[:400]}, status=503) from e
    return {**out, "totalRows": len(out["rows"]), "phys": phys, "engine": "duckdb"}


def count(phys: str) -> int | None:
    try:
        return int(_execute(f"select count(*) from {_qualified(phys)}").fetchone()[0])
    except Exception:      # noqa: BLE001 — 건수는 있으면 좋고 없어도 되는 정보다
        return None


def query(sql: str, params: list[Any] | None = None) -> dict[str, Any]:
    """임의 SELECT. 이력 통계 집계에 쓴다.

    쓰기를 막는 것은 호출부 책임이 아니라 여기서 한다 — 실수로라도 이 경로로
    테이블을 바꾸면 dbt 가 관리하는 상태와 어긋난다.
    """
    low = sql.strip().lower()
    if not (low.startswith("select") or low.startswith("with")):
        raise ApiError("INVALID_ARGUMENT",
                       "이 경로는 조회 전용입니다. SELECT 만 실행할 수 있습니다.")
    try:
        return _rows(_execute(sql, params))
    except Exception as e:      # noqa: BLE001
        if _is_fatal(e):
            reset()
        raise ApiError("UPSTREAM_UNAVAILABLE", "조회에 실패했습니다.",
                       {"error": str(e)[:400]}, status=503) from e
