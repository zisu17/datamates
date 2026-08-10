"""경로·접속 설정.

dbt 프로젝트 파일이 단일 진실 원천(SSoT)이므로, 이 모듈이 잡는 경로가 곧
플랫폼이 다루는 세계의 경계다. 메타스토어(SQLite)는 dbt 가 모르는 것
— 파이프라인·폴더·소유자 — 만 담는다.

경로는 두 뿌리로 갈린다.
  PROJECT_DIR  저장소 루트. 플랫폼이 소유하는 것 — 화면·DAG·메타스토어·venv.
  DBT_DIR      그 안의 dbt 프로젝트. dbt 가 소유하는 것 — 모델·프로필·산출물.
manifest 가 돌려주는 경로(`models/...`)는 전부 DBT_DIR 기준이고,
dbt 서브프로세스도 DBT_DIR 에서 돌려야 dbt_project.yml 을 찾는다.
"""

from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path

# datamates/app/config.py → datamates/ → 저장소 루트
PROJECT_DIR = Path(__file__).resolve().parents[2]
DBT_DIR = PROJECT_DIR / "dbt"

MODELS_DIR = DBT_DIR / "models"
TARGET_DIR = DBT_DIR / "target"
PROFILES_DIR = DBT_DIR / "profiles"

DAGS_DIR = PROJECT_DIR / "dags"
DBT_BIN = PROJECT_DIR / ".venv" / "bin" / "dbt"

MANIFEST_PATH = TARGET_DIR / "manifest.json"
RUN_RESULTS_PATH = TARGET_DIR / "run_results.json"
# `dbt docs generate` 가 만든다. 컬럼의 실제 물리 타입이 여기 있다 — 없어도 동작한다.
CATALOG_PATH = TARGET_DIR / "catalog.json"

# 메타스토어. dbt 산출물과 섞이지 않도록 target/ 바깥에 둔다
# (dbt clean 이 target/ 을 통째로 지운다).
DATA_DIR = PROJECT_DIR / ".datamates"
DB_PATH = DATA_DIR / "datamates.db"

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

# 컨테이너 안에서 dbt 를 실행할 때 쓰는 경로. dags/ 가 생성하는 DAG 이 이 값을 쓴다.
CONTAINER_DBT_BIN = "/opt/dbt-venv/bin/dbt"

# 컨테이너에서 본 Data Mates API. 수집 DAG 이 이 주소로 적재를 시킨다
# (적재 엔진 pyiceberg 는 API 쪽에만 있고, Airflow 는 언제 돌릴지와
#  끝났다는 사실을 알리는 일만 맡는다).
CONTAINER_API_BASE = os.environ.get(
    "DATAMATES_CONTAINER_API", "http://host.docker.internal:8000/api/v1")
# 컨테이너는 저장소 루트를 /opt/project 로 마운트한다(docker-compose 참고).
# dbt 명령은 dbt_project.yml 이 있는 곳에서 돌아야 하므로 한 단계 들어간다.
CONTAINER_PROJECT_DIR = "/opt/project"
CONTAINER_DBT_DIR = CONTAINER_PROJECT_DIR + "/dbt"


def airflow_password() -> str:
    """standalone Airflow 가 생성한 admin 비밀번호를 읽는다.

    환경변수가 있으면 그쪽이 우선이다. 없으면 컨테이너가 기동할 때 만든
    simple_auth_manager_passwords.json.generated 를 docker exec 로 읽는다.
    비밀번호는 컨테이너를 다시 만들면 바뀌므로 파일에 박아두지 않는다.
    """
    env = os.environ.get("AIRFLOW_PASSWORD")
    if env:
        return env

    import subprocess

    out = subprocess.run(
        ["docker", "exec", "airflow", "cat",
         "/opt/airflow/simple_auth_manager_passwords.json.generated"],
        capture_output=True, text=True, timeout=15,
    )
    if out.returncode != 0:
        raise RuntimeError(
            "Airflow 비밀번호를 읽지 못했습니다. AIRFLOW_PASSWORD 를 직접 지정하거나 "
            "airflow 컨테이너가 떠 있는지 확인하세요."
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
    env.setdefault("ICEBERG_REST_URI", "http://localhost:8181")
    env.setdefault("MINIO_ENDPOINT", "http://localhost:9000")
    # 익명 통계 수집이 켜져 있으면 profiles 디렉터리에 .user.yml 을 쓰려 든다.
    env["DO_NOT_TRACK"] = "1"
    return env
