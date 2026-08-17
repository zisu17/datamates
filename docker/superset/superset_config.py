"""Superset 설정 — Data Mates 분석 화면.

여기가 담는 것은 두 가지다.

  1. DuckDB 접속 초기화 — Iceberg REST 카탈로그를 접속마다 ATTACH 한다.
     이 설계에서 **직접 만들어야 하는 유일한 배관**이다.
  2. 임베드 준비 — 게스트 토큰과 프록시 뒤에서 도는 설정.

플랫폼 쪽 대응 코드는 datamates/app/warehouse.py 다. 같은 카탈로그에 같은 방식으로
붙으므로, 한쪽의 ATTACH 인자를 바꾸면 다른 쪽도 같이 바꿔야 한다.
"""

from __future__ import annotations

import logging
import os
from typing import Any

logger = logging.getLogger(__name__)


def _env(key: str, default: str = "") -> str:
    return os.environ.get(key, default)


# ─────────────────────────────────────────────────────────────
# 기본
# ─────────────────────────────────────────────────────────────

SECRET_KEY = _env("SUPERSET_SECRET_KEY", "datamates-dev-only-change-me")
SQLALCHEMY_DATABASE_URI = _env(
    "SUPERSET_METADB_URI",
    "postgresql+psycopg2://superset:superset@superset-db:5432/superset",
)

# 화면 언어·시간대를 플랫폼과 맞춘다. 차트 축의 날짜가 다르게 보이면
# 사용자는 두 화면 중 어느 쪽이 맞는지 알 수 없다.
BABEL_DEFAULT_LOCALE = "ko"
DEFAULT_FEATURE_FLAGS: dict[str, bool] = {}

_REDIS = _env("SUPERSET_REDIS_HOST", "superset-redis")
CACHE_CONFIG = {
    "CACHE_TYPE": "RedisCache",
    "CACHE_DEFAULT_TIMEOUT": 300,
    "CACHE_KEY_PREFIX": "superset_",
    "CACHE_REDIS_HOST": _REDIS,
    "CACHE_REDIS_PORT": 6379,
    "CACHE_REDIS_DB": 1,
}
DATA_CACHE_CONFIG = {**CACHE_CONFIG, "CACHE_REDIS_DB": 2, "CACHE_DEFAULT_TIMEOUT": 60}
FILTER_STATE_CACHE_CONFIG = {**CACHE_CONFIG, "CACHE_REDIS_DB": 3}
EXPLORE_FORM_DATA_CACHE_CONFIG = {**CACHE_CONFIG, "CACHE_REDIS_DB": 4}

# 차트 데이터 캐시를 60초로 짧게 둔다.
# 파이프라인이 돌면 값이 바뀌는데 기본값(24시간)이면 낡은 숫자가 오래 남는다.


# ─────────────────────────────────────────────────────────────
# 임베드
# ─────────────────────────────────────────────────────────────

FEATURE_FLAGS = {
    # 임베디드 SDK 와 게스트 토큰 엔드포인트를 켠다. 5.x 기본값은 False 다.
    "EMBEDDED_SUPERSET": _env("SUPERSET_EMBEDDED", "1") == "1",
    # 임베드된 화면에 로그아웃 버튼이 보이면 정체가 드러난다.
    "DISABLE_EMBEDDED_SUPERSET_LOGOUT": True,
}

GUEST_ROLE_NAME = "Gamma"

GUEST_TOKEN_JWT_SECRET = _env("SUPERSET_GUEST_TOKEN_SECRET", SECRET_KEY)
GUEST_TOKEN_JWT_EXP_SECONDS = 300      # SDK 가 자동 갱신한다

# FastAPI 리버스 프록시(/superset/*) 뒤에서 돌 때 리다이렉트 주소를 바로 만들게 한다.
ENABLE_PROXY_FIX = True

# Superset이 생성하는 절대 경로를 그대로 프록시한다.

# 같은 오리진으로 프록시하면 기본값(SAMEORIGIN)으로도 iframe 이 뜬다.
# 프록시 경로가 달라질 경우를 대비해 비워 둔다.
HTTP_HEADERS: dict[str, str] = {}
TALISMAN_ENABLED = False


# ─────────────────────────────────────────────────────────────
# DuckDB 접속 초기화 — 이 파일의 핵심
# ─────────────────────────────────────────────────────────────
#
# DuckDB 의 ATTACH 는 세션을 다시 열면 유지되지 않는다. 그리고 Superset 에는
# 접속마다 초기화 SQL 을 넣는 공식 설정이 없다(공식 문서는 URI 형식만 다룬다).
# 그래서 SQLAlchemy 의 connect 이벤트를 전역 등록한다.
#
# 가드가 중요하다. 전역 리스너는 **메타DB(Postgres) 접속에도 걸린다.**
# 거기서 ATTACH 를 실행하면 Superset 이 부팅부터 깨진다.
#
# duckdb-engine의 DBAPI 래퍼를 모듈 이름으로 판별한다.
#
#   type(dbapi_conn).__module__  ==  "duckdb_engine"
#   type(dbapi_conn).__name__    ==  "ConnectionWrapper"

MINIO_ENDPOINT = _env("MINIO_ENDPOINT", "http://minio:9000")
MINIO_ROOT_USER = _env("MINIO_ROOT_USER", "minioadmin")
MINIO_ROOT_PASSWORD = _env("MINIO_ROOT_PASSWORD", "minioadmin")

# DuckLake 카탈로그(Postgres). 데이터 파일은 s3://warehouse/ducklake/ 의 Parquet 이고
# 스냅샷·스키마·파일 목록은 이 DB 에 있다.
POSTGRES_HOST = _env("POSTGRES_HOST", "postgres")
POSTGRES_PORT = _env("POSTGRES_PORT", "5432")
POSTGRES_USER = _env("POSTGRES_USER", "datamates")
POSTGRES_PASSWORD = _env("POSTGRES_PASSWORD", "datamates")

# 카탈로그 별칭은 warehouse.py의 ALIAS와 같아야 한다.
ICEBERG_ALIAS = "ice"
ICEBERG_DEFAULT_SCHEMA = _env("DBT_SCHEMA", "analytics")

# 플랫폼과 Superset의 timestamptz 표시를 맞추기 위해 세션 시간대를 고정한다.
DUCKDB_TIMEZONE = _env("DATAMATES_DUCKDB_TIMEZONE", "Asia/Seoul")


def _split_endpoint(url: str) -> tuple[str, bool]:
    """http://host:port → (host:port, use_ssl). DuckDB 는 스킴을 빼고 받는다."""
    ssl = url.startswith("https://")
    return url.split("://", 1)[-1].rstrip("/"), ssl


def _attach_sql() -> list[str]:
    """카탈로그를 붙이는 부분. 모두 멱등이어야 한다 — 커넥션마다 다시 돈다.

    값을 문자열로 박아 넣는다. warehouse.py 는 `?` 바인딩을 쓰지만,
    duckdb-engine 의 ConnectionWrapper 를 거치면 파라미터 처리 경로가 하나 더
    끼어 실패 지점이 늘어난다. 여기 들어가는 값은 전부 우리 환경변수이고
    사용자 입력이 아니므로 박아 넣는 편이 안전하다.
    """
    host, ssl = _split_endpoint(MINIO_ENDPOINT)
    ducklake = (f"ducklake:postgres:dbname=ducklake host={POSTGRES_HOST} "
                f"port={POSTGRES_PORT} user={POSTGRES_USER} password={POSTGRES_PASSWORD}")
    return [
        "INSTALL ducklake",
        "INSTALL postgres",
        "LOAD ducklake",
        (
            f"CREATE OR REPLACE SECRET datamates_s3 ("
            f"TYPE s3, KEY_ID '{MINIO_ROOT_USER}', SECRET '{MINIO_ROOT_PASSWORD}', "
            f"ENDPOINT '{host}', USE_SSL {'true' if ssl else 'false'}, "
            f"URL_STYLE 'path', REGION 'us-east-1')"
        ),
        # READ_ONLY: 분석 화면은 웨어하우스를 읽기만 한다. 쓰기는 dbt(모델)와
        # ingest(수집)의 일이라, 여기서 막아 두면 프록시가 놓친 경로로도 쓸 수 없다.
        f"ATTACH IF NOT EXISTS '{ducklake}' AS {ICEBERG_ALIAS} (READ_ONLY)",
        f"SET GLOBAL TimeZone = '{DUCKDB_TIMEZONE}'",
    ]


# Superset이 데이터셋 스키마를 조회할 수 있도록 기본 카탈로그와 스키마를 선택한다.

RESOLVE_SCHEMAS = [s.strip() for s in
                   _env("DATAMATES_RESOLVE_SCHEMAS", ICEBERG_DEFAULT_SCHEMA).split(",")
                   if s.strip()]


def _resolve_columns(cur: Any) -> None:      # noqa: ANN401
    cur.execute(f"USE {ICEBERG_ALIAS}.{RESOLVE_SCHEMAS[0]}")


def _register_duckdb_init() -> None:
    from sqlalchemy import event
    from sqlalchemy.engine import Engine

    @event.listens_for(Engine, "connect")
    def _on_connect(dbapi_conn, connection_record):  # noqa: ANN001, ARG001
        if type(dbapi_conn).__module__.split(".")[0] != "duckdb_engine":
            return          # 메타DB(Postgres) 등 다른 드라이버는 건드리지 않는다

        cur = dbapi_conn.cursor()
        for stmt in _attach_sql():
            try:
                cur.execute(stmt)
            except Exception:      # noqa: BLE001
                # 한 문장이 실패해도 나머지를 시도한다. 여기서 예외를 올리면
                # 커넥션 생성 자체가 실패해 화면이 통째로 500 이 된다.
                # 실패한 초기화 문장은 로그로 남긴다.
                logger.exception("DuckDB ATTACH 실패: %s", stmt[:80])
        try:
            _resolve_columns(cur)
        except Exception:      # noqa: BLE001
            logger.exception("DuckDB 컬럼 메타데이터 해석 실패")


_register_duckdb_init()
