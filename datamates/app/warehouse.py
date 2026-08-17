"""웨어하우스 직접 조회 — 화면이 기다릴 수 있는 시간 안에 답한다.

웨어하우스가 Iceberg + Spark 였을 때 `dbt show` 는 호출마다 JVM 과 Iceberg jar 를
새로 띄워 기동에만 15초 이상이 들었다. 미리보기처럼 눌렀을 때 바로 나와야 하는
조회에는 쓸 수 없어서, DuckDB 로 카탈로그에 직접 붙는 이 모듈이 생겼다.

DuckLake 로 옮긴 뒤로는 변환(dbt)도 같은 DuckDB 엔진을 쓰지만, 이 모듈은 그대로
남는다 — 조회는 **서버 프로세스 안에서** 끝나야 하고(별도 프로세스를 띄우면
그 왕복이 곧 화면 지연이다), 커넥션 수명·읽기 전용 규약도 여기서만 관리한다.

  측정 (fct_apt_trade 14만 행, 같은 머신)
    dbt show (Spark)      17.0 초
    DuckDB + Iceberg      0.014 초
    DuckDB + DuckLake     아래 preview() 참고

**읽기 전용이다.** 테이블을 만들고 바꾸는 것은 dbt(모델)와 ingest(수집)의 일이다.
여기로 쓰면 두 곳이 같은 테이블을 소유하게 되어 계보가 어긋난다.
"""

from __future__ import annotations

import threading
from typing import Any

from .config import dbt_env
from .errors import ApiError

_lock = threading.Lock()          # 커넥션 생성 보호
_con: Any = None

# 카탈로그 별칭. 이름이 `ice` 인 것은 Iceberg 시절의 잔재지만 그대로 둔다 —
# Superset 데이터셋이 `ice.analytics.<표>` 로 저장돼 있어서(store 의 superset_dataset
# 매핑), 별칭을 바꾸면 이미 만들어진 차트가 전부 끊긴다.
# 같은 이유로 superset_config.py 의 ICEBERG_ALIAS 와 항상 같아야 한다.
ALIAS = "ice"


def _endpoint(url: str) -> tuple[str, bool]:
    """http://host:port → (host:port, use_ssl). DuckDB 는 스킴을 빼고 받는다."""
    ssl = url.startswith("https://")
    return url.split("://", 1)[-1].rstrip("/"), ssl


def _ducklake_uri(env: dict[str, str]) -> str:
    """DuckLake 카탈로그 접속 URI. dbt 프로필의 attach 경로와 같은 값이어야 한다."""
    return ("ducklake:postgres:dbname=ducklake "
            f"host={env.get('POSTGRES_HOST', 'localhost')} "
            f"port={env.get('POSTGRES_PORT', '5432')} "
            f"user={env.get('POSTGRES_USER', 'datamates')} "
            f"password={env.get('POSTGRES_PASSWORD', 'datamates')}")


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

        # 시간대를 명시로 고정한다. 없으면 DuckDB 가 «호스트의 로컬 시간대» 를 쓰는데,
        # 그러면 같은 테이블의 timestamptz 컬럼이 개발자 맥(Asia/Seoul)과
        # 컨테이너(UTC)에서 다른 시각으로 보인다. 값은 같고 표기만 갈리므로
        # 테스트로는 잡히지 않고 화면에서만 드러난다.
        #
        # 분석 화면(Superset)도 같은 값으로 고정한다 —
        # docker/superset/superset_config.py 의 DUCKDB_TIMEZONE. 한쪽만 바꾸면 어긋난다.
        #
        # **GLOBAL 이 아니면 효과가 없다.** 이 모듈의 모든 조회는 cursor() 를 거치는데,
        # cursor() 는 별도 커넥션이라 세션 SET 이 전파되지 않는다(실측):
        #
        #   SET TimeZone='UTC'         → 루트 UTC / cursor 는 그대로 Asia/Seoul
        #   SET GLOBAL TimeZone='UTC'  → 루트·cursor 모두 UTC (기존 cursor 까지)
        #
        # 그래서 평범한 SET 을 넣으면 조용히 아무 일도 일어나지 않는다.
        con.execute(
            f"SET GLOBAL TimeZone = '{env.get('DATAMATES_DUCKDB_TIMEZONE', 'Asia/Seoul')}';")

        con.execute("INSTALL ducklake; INSTALL postgres; LOAD ducklake;")
        con.execute(
            "CREATE SECRET (TYPE s3, KEY_ID ?, SECRET ?, ENDPOINT ?, "
            "USE_SSL ?, URL_STYLE 'path', REGION 'us-east-1');",
            [env.get("MINIO_ROOT_USER", "minioadmin"),
             env.get("MINIO_ROOT_PASSWORD", "minioadmin"), host, ssl])
        # READ_ONLY 는 규약을 코드로 못박는 장치다. 이 모듈로 실수로 쓰기가 들어와도
        # 커넥션 단계에서 막힌다 — 모듈 docstring 의 «읽기 전용» 이 주석에만 있으면
        # 언젠가 깨진다.
        con.execute(
            f"ATTACH '{_ducklake_uri(env)}' AS {ALIAS} (READ_ONLY);")
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


def data_files(phys: str) -> list[str] | None:
    """지금 스냅샷이 가리키는 데이터 파일 경로.

    저장소가 «얼마나 차지하고 있나» 와 «지금 쓰이는 것은 얼마인가» 를 가르는 데 쓴다.
    덮어쓸 때 옛 파일을 지우지 않고 스냅샷만 새로 가리키므로, 버킷을 세면 지난 판본이
    전부 섞여 든다(실측: 카탈로그 402MB 중 현재 스냅샷은 70MB). 두 값을 나눠 보여줘야
    «정리하면 얼마가 빠지는지» 를 말할 수 있다.

    ducklake_list_files 는 현재 스냅샷의 파일만 돌려준다 — Iceberg 의 iceberg_metadata
    처럼 DELETE 매니페스트나 빠진 항목을 손으로 걸러낼 필요가 없다.
    """
    schema, _, table = phys.partition(".")
    if not table:
        return None
    try:
        cur = _execute(
            f"select data_file from ducklake_list_files('{ALIAS}', ?, schema => ?) "
            "where data_file is not null", [table, schema])
        return [r[0] for r in cur.fetchall()]
    except Exception:      # noqa: BLE001 — 못 읽으면 «모른다»(None) 로 남긴다
        return None


def file_sizes(phys: str) -> dict[str, int] | None:
    """데이터 파일 경로 → 바이트. DuckLake 가 메타데이터에 크기를 들고 있어서
    객체 목록과 대조하지 않고도 «현재 스냅샷이 쓰는 용량» 을 바로 셀 수 있다
    (Iceberg 시절에는 경로만 나와 storage.py 가 버킷 목록과 맞춰야 했다)."""
    schema, _, table = phys.partition(".")
    if not table:
        return None
    try:
        cur = _execute(
            f"select data_file, data_file_size_bytes from ducklake_list_files('{ALIAS}', ?, "
            "schema => ?) where data_file is not null", [table, schema])
        return {r[0]: int(r[1] or 0) for r in cur.fetchall()}
    except Exception:      # noqa: BLE001
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
