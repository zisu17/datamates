"""Superset 설정 — Data Mates 분석 화면.

여기가 담는 것은 두 가지다.

  1. DuckDB 접속 초기화 — Iceberg REST 카탈로그를 접속마다 ATTACH 한다.
     이 설계에서 **직접 만들어야 하는 유일한 배관**이다.
  2. 임베드 준비 — 게스트 토큰과 프록시 뒤에서 도는 설정.
     P0 에서는 쓰지 않지만, 값이 없으면 P2 에서 다시 뒤져야 하므로 미리 둔다.

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
# 근본 대응은 파이프라인 완료 시 캐시 무효화지만, 그건 P2 이후다.


# ─────────────────────────────────────────────────────────────
# 임베드 — P2 에서 사용. 지금 켜 두어도 P0 검증에 영향이 없다.
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

# ── 서브패스 배포는 쓰지 않는다 ─────────────────────────────────
#
# 처음에는 /superset 접두사로 붙이려 했고 두 가지를 시도했다. 둘 다 5.0.0 에서
# 실패했다 — Superset 이 만드는 절대 경로 27개 전부 접두사가 붙지 않았다.
#
#   X-Forwarded-Prefix 헤더  → 효과 없음
#   SUPERSET_APP_ROOT 설정   → 효과 없음 (5.0 에서 BETA 이고 알려진 버그가 있다)
#
# 그래서 접두사를 포기하고 **경로를 바꾸지 않는 프록시**로 갔다.
# 플랫폼 서버가 Superset 의 경로(/static/… · /superset/… · /explore/…)를 같은
# 이름으로 중계하므로 생성된 절대 경로가 그대로 맞는다. 자세히는
# datamates/app/analytics/proxy.py 의 FORWARD 주석.
#
# 6.0 에서 서브패스가 안정화되면 접두사 방식으로 되돌리는 것을 검토한다 —
# 그때는 플랫폼과 Superset 의 URL 이름공간이 겹치지 않게 할 수 있다.

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
# 판별 기준은 실측으로 정했다. duckdb-engine 이 넘기는 DBAPI 객체는
# duckdb.DuckDBPyConnection 이 **아니라** duckdb_engine.ConnectionWrapper 다.
# 클래스 이름으로 거르면 조용히 건너뛰어 ATTACH 가 안 걸린다(증상: 테이블 0개).
# 모듈 최상위 이름으로 판별한다.
#
#   type(dbapi_conn).__module__  ==  "duckdb_engine"
#   type(dbapi_conn).__name__    ==  "ConnectionWrapper"

ICEBERG_REST_URI = _env("ICEBERG_REST_URI", "http://iceberg-rest:8181")
MINIO_ENDPOINT = _env("MINIO_ENDPOINT", "http://minio:9000")
MINIO_ROOT_USER = _env("MINIO_ROOT_USER", "minioadmin")
MINIO_ROOT_PASSWORD = _env("MINIO_ROOT_PASSWORD", "minioadmin")

# dbt 가 쓰는 카탈로그 이름과 구분한다. warehouse.py 의 ALIAS 와 같은 값이어야
# 두 화면에서 같은 테이블 참조(ice.analytics.fct_events)를 쓸 수 있다.
ICEBERG_ALIAS = "ice"
ICEBERG_DEFAULT_SCHEMA = _env("DBT_SCHEMA", "analytics")

# 세션 TimeZone 을 고정한다. 리스크 2 의 실체가 여기다.
#
# 컨테이너의 기본 TimeZone 은 UTC 이고, 개발자 맥에서 도는 플랫폼은 호스트 로컬
# (예: Asia/Seoul) 이다. 같은 DuckDB 라이브러리를 쓰더라도 이 값이 다르면
# timestamptz 컬럼이 두 화면에서 다른 시각을 가리킨다 — 값은 같지만 표기가 갈린다.
#
# 플랫폼 쪽(datamates/app/warehouse.py 의 connect())도 같은 값으로 고정돼 있다.
# 한쪽만 바꾸면 어긋난다 — 검증은 scripts/p0_duckdb_check.py 의 ⑤-0 이 한다.
#
# GLOBAL 로 건다. 플랫폼 쪽에서는 cursor() 가 별도 커넥션이라 세션 SET 이 전파되지
# 않아 GLOBAL 이 필수였고, 여기서도 같은 문장을 쓰는 편이 두 곳을 대조하기 쉽다.
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
    return [
        "INSTALL iceberg",
        "LOAD iceberg",
        (
            f"CREATE OR REPLACE SECRET datamates_s3 ("
            f"TYPE s3, KEY_ID '{MINIO_ROOT_USER}', SECRET '{MINIO_ROOT_PASSWORD}', "
            f"ENDPOINT '{host}', USE_SSL {'true' if ssl else 'false'}, "
            f"URL_STYLE 'path', REGION 'us-east-1')"
        ),
        (
            f"ATTACH IF NOT EXISTS 'warehouse' AS {ICEBERG_ALIAS} ("
            f"TYPE iceberg, ENDPOINT '{ICEBERG_REST_URI}', AUTHORIZATION_TYPE 'none')"
        ),
        f"SET GLOBAL TimeZone = '{DUCKDB_TIMEZONE}'",
    ]


# ── 왜 DESCRIBE 를 한 바퀴 돌리는가 — P0 에서 찾은 것 ────────────
#
# ATTACH 만으로는 Superset 이 데이터셋을 만들 수 없다. ATTACH 직후 Iceberg 테이블의
# 컬럼 메타데이터가 **아직 해석되지 않은 상태**여서 information_schema 에
# «__ / UNKNOWN» 컬럼 하나만 들어 있다:
#
#   ATTACH 직후 → information_schema.columns  = 1컬럼 ('__', UNKNOWN)
#   DESCRIBE 후 → information_schema.columns  = 9컬럼, 타입 정확
#
# Superset 은 SQLAlchemy reflection(= information_schema)으로 데이터셋 컬럼을 잡으므로,
# 해석 전에 데이터셋을 만들면 «__» 하나만 가진 껍데기가 된다. 시간 컬럼이 없으니
# 시계열 차트도 못 만든다. 질의는 되는데 차트를 못 만드는 상태라 원인을 찾기 어렵다.
#
# 테이블을 한 번 건드리면 DuckDB 가 스키마를 해석해 카탈로그에 채운다.
# 세 방법을 재봤고 비용이 사실상 같았다(테이블 10개 기준):
#
#   SELECT * ... LIMIT 0 로 건드리기   109ms
#   DESCRIBE                           105ms
#   memory 카탈로그에 뷰 만들기        113ms
#
# DESCRIBE 를 쓴다. 가장 싸고, 순수 메타데이터 연산이며, **카탈로그가 하나로 유지된다.**
# 뷰 방식은 memory.analytics 가 ice.analytics 를 가리는 두 번째 네임스페이스를 만들어
# 모델 변경 시 갱신 책임이 생기고, Superset 의 selectStar 도 실제 테이블을 가리키지 않는다.
#
# ── 비용의 성질 ────────────────────────────────────────────────
# 이 비용은 커넥션 × 테이블 수에 비례하고, Iceberg REST 카탈로그가
# CATALOG_JDBC_POOL__MAX__SIZE=1 로 직렬화돼 있어 동시 접속에서 더 늘어난다
# (동시 10 커넥션 × 10테이블에서 커넥션당 1초 수준까지 올라갔다).
# 그래서 커넥션 풀 재사용은 최적화가 아니라 **전제**다 — 설계서 리스크 1·4 참고.
# 모델이 수백 개로 늘면 RESOLVE_SCHEMAS 를 좁혀야 한다.

RESOLVE_SCHEMAS = [s.strip() for s in
                   _env("DATAMATES_RESOLVE_SCHEMAS", ICEBERG_DEFAULT_SCHEMA).split(",")
                   if s.strip()]


def _resolve_columns(cur: Any) -> None:      # noqa: ANN401
    for schema in RESOLVE_SCHEMAS:
        cur.execute(
            "select table_name from information_schema.tables "
            f"where table_catalog = '{ICEBERG_ALIAS}' and table_schema = '{schema}'")
        for (name,) in cur.fetchall():
            cur.execute(f'DESCRIBE {ICEBERG_ALIAS}.{schema}."{name}"')
            cur.fetchall()
    # 기본 카탈로그·스키마를 옮긴다. 이걸 빼면 Superset 의 스키마 목록에
    # 붙은 카탈로그가 나오지 않아 데이터셋을 만들 수 없다.
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
                # 무엇이 실패했는지는 로그로 남겨 P0 에서 잡는다.
                logger.exception("DuckDB ATTACH 실패: %s", stmt[:80])
        try:
            _resolve_columns(cur)
        except Exception:      # noqa: BLE001
            logger.exception("DuckDB 컬럼 메타데이터 해석 실패")


_register_duckdb_init()
