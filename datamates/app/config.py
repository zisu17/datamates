"""경로·접속 설정.

dbt 프로젝트 파일이 단일 진실 원천(SSoT)이므로, 이 모듈이 잡는 경로가 곧
플랫폼이 다루는 세계의 경계다. 메타스토어(Postgres)는 dbt 가 모르는 것만 담는다
— 파이프라인·수집 커넥터·폴더·마트 지정·변경 이력.

Postgres 인스턴스 하나가 DB 네 개를 나눠 쓴다:
  datamates  메타스토어        ducklake  웨어하우스 카탈로그(DuckLake)
  airflow    Airflow 메타DB    iceberg   이관 전 카탈로그(롤백용)

경로는 두 뿌리로 갈린다.
  PROJECT_DIR  저장소 루트. 플랫폼이 소유하는 것 — 화면·DAG·메타스토어·venv.
  DBT_DIR      dbt 프로젝트. dbt 가 소유하는 것 — 모델·프로필·산출물.
manifest 가 돌려주는 경로(`models/...`)는 전부 DBT_DIR 기준이고,
dbt 서브프로세스도 DBT_DIR 에서 돌려야 dbt_project.yml 을 찾는다.

DBT_DIR 은 이 저장소 안이 아니어도 된다. 콘솔은 제품이고 dbt 프로젝트는 그 제품이
다루는 데이터라, 한 저장소에 묶을 이유가 없다. 경계는 DBT_PROJECT_DIR 환경변수다
— dbt CLI 가 쓰는 것과 같은 변수라 따로 배울 것이 없다. 지정하지 않으면 관례상
저장소 안의 dbt/ 를 본다(거기에 두거나 심볼릭 링크를 걸어도 된다).
"""

from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path

# datamates/app/config.py → datamates/ → 저장소 루트
PROJECT_DIR = Path(__file__).resolve().parents[2]

# dbt 프로젝트 위치. 저장소 밖을 가리켜도 된다 (위 머리말 참고).
DBT_DIR = Path(os.environ.get("DBT_PROJECT_DIR") or (PROJECT_DIR / "dbt")).expanduser().resolve()

MODELS_DIR = DBT_DIR / "models"
TARGET_DIR = DBT_DIR / "target"
PROFILES_DIR = DBT_DIR / "profiles"

DAGS_DIR = PROJECT_DIR / "dags"

# dbt 실행 파일. 호스트에서는 저장소의 .venv 를 쓴다.
# 컨테이너에서는 이 값을 이미지 안의 dbt venv(/opt/dbt-venv/bin/dbt)로 갈아 끼운다 —
# 저장소를 통째로 마운트하므로 .venv 도 같이 들어오지만 그 안은 macOS 바이너리라
# 리눅스 컨테이너에서 실행되지 않는다. 조용히 «dbt 를 못 찾는다»로 끝나지 않도록
# 경로 자체를 환경변수로 분기한다.
DBT_BIN = Path(os.environ.get("DATAMATES_DBT_BIN")
               or PROJECT_DIR / ".venv" / "bin" / "dbt")

MANIFEST_PATH = TARGET_DIR / "manifest.json"
RUN_RESULTS_PATH = TARGET_DIR / "run_results.json"
# `dbt docs generate` 가 만든다. 컬럼의 실제 물리 타입이 여기 있다 — 없어도 동작한다.
CATALOG_PATH = TARGET_DIR / "catalog.json"

# 실행 산출물(수집 로그 등). dbt 산출물과 섞이지 않도록 target/ 바깥에 둔다
# (dbt clean 이 target/ 을 통째로 지운다).
DATA_DIR = PROJECT_DIR / ".datamates"

# 메타스토어 접속. 예전에는 이 자리에 SQLite 파일 경로(DB_PATH)가 있었다.
#
# Postgres 로 옮긴 이유는 동시 쓰기다 — SQLite 는 writer 가 하나뿐이라 수집·파이프라인이
# 겹치면 뒤에 온 쪽이 기다린다. Airflow 메타DB·Iceberg 카탈로그와 같은 인스턴스를 쓴다
# (docker-compose.yml 의 postgres 서비스, DB 이름만 다르다).
#
# 서버는 호스트에서 도는데(datamates/run.sh) 컨테이너 안에서 돌릴 때도 있어서
# 호스트 이름을 환경변수로 뺀다 — 컨테이너에서는 postgres, 호스트에서는 localhost.
DATABASE_URL = os.environ.get(
    "DATAMATES_DATABASE_URL",
    "postgresql://{u}:{p}@{h}:{port}/datamates".format(
        u=os.environ.get("POSTGRES_USER", "datamates"),
        p=os.environ.get("POSTGRES_PASSWORD", "datamates"),
        h=os.environ.get("POSTGRES_HOST", "localhost"),
        port=os.environ.get("POSTGRES_PORT", "5432")))

# dbt 프로젝트 이름. manifest 의 다른 패키지(elementary 등)와 구분하는 기준이다.
DBT_PROJECT_NAME = "analytics"

# API 가 만든 모델이 들어갈 디렉터리. 손으로 쓴 모델과 섞이지 않게 분리한다.
# dbt 는 models/ 아래면 어디에 있든 같게 취급하므로 동작에는 차이가 없다.
AUTHORED_SUBDIR = "marts"

# 생성한 DAG 파일 접두사. 이 접두사가 붙은 파일만 API 가 지우고 다시 쓴다.
# 손으로 만든 DAG(dbt_smoke.py 등)을 건드리지 않기 위한 안전장치다.
DAG_PREFIX = "datamates_"

AIRFLOW_BASE_URL = os.environ.get("AIRFLOW_BASE_URL", "http://localhost:8080")
AIRFLOW_USER = os.environ.get("AIRFLOW_USER", "admin")

# ── 분석(Superset) ─────────────────────────────────────────────
#
# 사용자는 Superset 주소를 모른다. 브라우저는 이 서버의 /superset/* 만 부르고,
# 그 요청을 analytics/proxy.py 가 아래 주소로 중계한다.
#
# 기본값이 localhost 인 것은 **이 서버가 호스트에서 돌기 때문**이다(datamates/run.sh).
# 그래서 compose 는 8088 을 127.0.0.1 에만 묶어 둔다 — 다른 기기에서는 닿지 않지만
# 같은 기기에서는 닿는다. 이 서버까지 컨테이너로 옮기면
# SUPERSET_BASE_URL=http://superset:8088 로 바꾸고 포트 바인딩을 지울 수 있다.
SUPERSET_BASE_URL = os.environ.get("SUPERSET_BASE_URL", "http://localhost:8088")
SUPERSET_USER = os.environ.get("SUPERSET_ADMIN_USER", "admin")

# 프록시가 브라우저에게 노출하는 접두사. Superset 이 만드는 절대 경로도
# 이 값이 붙어 나오도록 X-Forwarded-Prefix 로 함께 넘긴다.
SUPERSET_PREFIX = "/superset"


def superset_password() -> str:
    """서비스 계정 비밀번호. 권한 모델이 없으므로 계정은 이 하나뿐이다."""
    return os.environ.get("SUPERSET_ADMIN_PASSWORD", "admin")

# 컨테이너 안에서 dbt 를 실행할 때 쓰는 경로. dags/ 가 생성하는 DAG 이 이 값을 쓴다.
CONTAINER_DBT_BIN = "/opt/dbt-venv/bin/dbt"

# 컨테이너에서 본 Data Mates API. 수집 DAG 이 이 주소로 적재를 시킨다
# (적재 엔진 DuckDB 는 API 쪽에만 있고, Airflow 는 언제 돌릴지와
#  끝났다는 사실을 알리는 일만 맡는다).
CONTAINER_API_BASE = os.environ.get(
    "DATAMATES_CONTAINER_API", "http://host.docker.internal:8000/api/v1")
# 컨테이너는 저장소 루트를 /opt/project 로 마운트한다(docker-compose 참고).
# dbt 명령은 dbt_project.yml 이 있는 곳에서 돌아야 하므로 한 단계 들어간다.
CONTAINER_PROJECT_DIR = "/opt/project"
CONTAINER_DBT_DIR = CONTAINER_PROJECT_DIR + "/dbt"


# standalone Airflow 가 기동할 때 admin 비밀번호를 적어 두는 파일. Airflow 홈 안이다.
PASSWORD_FILE = os.environ.get(
    "AIRFLOW_PASSWORD_FILE",
    "/opt/airflow/simple_auth_manager_passwords.json.generated")


def airflow_password() -> str:
    """standalone Airflow 가 생성한 admin 비밀번호를 읽는다.

    환경변수 → 파일 → docker exec 순으로 찾는다.
    파일이 중간에 끼는 이유: 컨테이너 안에는 docker CLI 가 없어서 마지막 수단을 쓸 수
    없다. compose 가 airflow-home 볼륨을 읽기전용으로 걸어 주면 Airflow 가 쓴 파일을
    그대로 읽으면 된다. 호스트에서 띄웠을 때는 그 경로가 없으니 docker exec 로 내려간다.
    비밀번호는 컨테이너를 다시 만들면 바뀌므로 어느 경로에서도 파일에 박아두지 않는다.
    """
    env = os.environ.get("AIRFLOW_PASSWORD")
    if env:
        return env

    path = Path(PASSWORD_FILE)
    if path.exists():
        return json.loads(path.read_text())[AIRFLOW_USER]

    import subprocess

    out = subprocess.run(
        ["docker", "exec", "airflow", "cat", PASSWORD_FILE],
        capture_output=True, text=True, timeout=15,
    )
    if out.returncode != 0:
        raise RuntimeError(
            "Airflow 비밀번호를 읽지 못했습니다. AIRFLOW_PASSWORD 를 직접 지정하거나, "
            f"airflow 컨테이너가 떠서 {PASSWORD_FILE} 을 만들었는지 확인하세요."
        )
    return json.loads(out.stdout)[AIRFLOW_USER]


@lru_cache(maxsize=1)
def dbt_env() -> dict[str, str]:
    """dbt 서브프로세스에 넘길 환경변수.

    env.sh 를 source 한 셸에서 서버를 띄우면 대부분 이미 들어와 있다.
    그렇지 않은 경우에도 최소한 파싱은 되도록 기본값을 채운다
    (Spark 세션이 필요한 명령은 JAVA_HOME/SPARK_HOME 이 있어야 한다).
    """
    env = dict(os.environ)
    env.setdefault("DBT_PROFILES_DIR", str(PROFILES_DIR))
    env.setdefault("DBT_TARGET", "local")
    env.setdefault("DBT_SCHEMA", "analytics")
    env.setdefault("MINIO_ENDPOINT", "http://localhost:9000")
    # DuckLake 카탈로그(Postgres) 접속. dbt 프로필의 attach 경로와 warehouse.py ·
    # ingest.py 가 모두 이 값들을 읽으므로 한 곳에서 기본값을 준다.
    env.setdefault("POSTGRES_HOST", "localhost")
    env.setdefault("POSTGRES_PORT", "5432")
    env.setdefault("POSTGRES_USER", "datamates")
    env.setdefault("POSTGRES_PASSWORD", "datamates")
    # 롤백 타깃(spark_local/local_heavy)이 쓰는 Iceberg REST 카탈로그.
    env.setdefault("ICEBERG_REST_URI", "http://localhost:8181")
    # 익명 통계 수집이 켜져 있으면 profiles 디렉터리에 .user.yml 을 쓰려 든다.
    env["DO_NOT_TRACK"] = "1"
    return env
