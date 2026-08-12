# Data Mates — 스택 전체가 쓰는 **단일 이미지**.
#
#   docker build -f docker/datamates/Dockerfile -t zisu17/datamates:1.0.0 .
#
# 컨텍스트가 저장소 루트다(requirements 파일 두 개를 읽어야 한다). 그래서 -f 로 지정한다.
#
# 이미지 하나를 세 서비스가 서로 다른 command 로 실행한다 — Airflow, Data Mates,
# Superset. 받을 것이 하나뿐이고, 세 서비스의 dbt·DuckDB 버전이 구조적으로 어긋날 수 없다.
#
#   airflow    (기본 ENTRYPOINT) standalone
#   datamates  /opt/datamates-venv/bin/uvicorn ...
#   superset   /opt/superset-venv/bin/gunicorn ...
#
# 앱 코드와 dbt 프로젝트는 이미지에 넣지 않고 런타임에 마운트한다. 이 앱이 하는 일이 곧
# dbt 프로젝트 파일을 쓰는 것이고(SSoT), 그 결과물은 저장소에 남아 Airflow 쪽에도 **같은
# 파일로** 보여야 한다. 이미지에 사본을 두면 두 컨테이너가 다른 세계를 보고, 사용자가 만든
# 모델은 컨테이너를 지우는 순간 사라진다.

# ---------------------------------------------------------------------------
# 왜 venv 를 네 개로 가르는가.
#
# Airflow 3 은 자기 API 서버를 FastAPI 로 만들어 fastapi·pydantic 을 고정한다.
# Superset 은 Flask 계열 전체를 고정한다. Data Mates 는 또 다른 fastapi 를 고정한다.
# 한 환경에 넣으면 반드시 하나가 깨진다 — 타협이 아니라 물리적 제약이다.
# 세 쪽이 서로를 import 하지 않고 프로세스로만 갈라져 있으므로 잃는 것은 없다.
#
#   (base)               Airflow 3.2.2
#   /opt/dbt-venv        dbt-core · dbt-spark · PySpark · Elementary
#   /opt/datamates-venv  FastAPI · PyIceberg · DuckDB · sqlglot
#   /opt/superset-venv   Superset · duckdb-engine · psycopg2
# ---------------------------------------------------------------------------

# === 빌더 =================================================================
# Superset 의 의존성 중 일부는 arm64 휠이 없어 소스에서 컴파일된다. 툴체인을 최종
# 이미지에 남기지 않으려고 별도 스테이지에서 venv 를 만들어 복사한다.
# venv 의 bin/ 스크립트에는 절대경로가 박히므로 **두 스테이지의 경로가 같아야 한다.**
FROM apache/airflow:3.2.2-python3.11 AS superset-build

USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      build-essential libpq-dev pkg-config libssl-dev \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /opt/superset-venv && chown airflow:root /opt/superset-venv

USER airflow
ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1

COPY docker/superset/requirements-local.txt /tmp/requirements-superset.txt

# python-geohash 를 0.8.5 로 못 박는 이유:
# 0.9.x 부터 빌드에 Rust 툴체인이 필요한데, Debian 의 cargo(1.65)는 그 패키지의
# Cargo.lock v4 를 읽지 못한다 — `lock file version 4 was found, but this version of
# Cargo does not understand` 로 죽는다. Rust 를 따로 올리는 대신 마지막 C 구현인
# 0.8.5 를 쓴다. Superset 5.0.0 은 버전을 고정하지 않으므로 이 핀으로도 정상 해석된다.
#
# gunicorn 은 핀하지 않는다 — apache-superset 이 자기 제약으로 함께 끌어온다.
RUN python -m venv /opt/superset-venv \
 && /opt/superset-venv/bin/pip install --upgrade pip \
 && /opt/superset-venv/bin/pip install \
      "apache-superset==5.0.0" \
      "python-geohash==0.8.5" \
      -r /tmp/requirements-superset.txt \
 && find /opt/superset-venv -type d -name __pycache__ -prune -exec rm -rf '{}' + \
 && find /opt/superset-venv -type f \( -name '*.pyc' -o -name '*.pyo' \) -delete

# === 최종 =================================================================
FROM apache/airflow:3.2.2-python3.11

# ---------------------------------------------------------------------------
# Java 17 — Spark 4.0 이 요구한다.
# 아키텍처마다 JDK 경로가 달라서(arm64/amd64) 하드코딩하지 않고 심볼릭 링크로 고정한다.
# libpq5 는 Superset 이 Postgres 메타DB 에 붙는 데 필요하다(런타임 라이브러리만).
# ---------------------------------------------------------------------------
USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      openjdk-17-jre-headless \
      procps \
      libpq5 \
 && rm -rf /var/lib/apt/lists/* \
 && ln -sfn "$(dirname "$(dirname "$(readlink -f "$(command -v java)")")")" /opt/java-home \
 && mkdir -p /opt/dbt-venv /opt/datamates-venv /opt/spark-events \
             /opt/datamates/runs /opt/superset/pythonpath \
             /home/airflow/.ivy2.5.2 \
 && chown airflow:root /opt/dbt-venv /opt/datamates-venv /opt/spark-events \
                       /opt/datamates/runs /opt/superset/pythonpath \
                       /home/airflow/.ivy2.5.2

ENV JAVA_HOME=/opt/java-home

# .ivy2.5.2 를 여기서 미리 만들어 두는 이유:
# Docker Compose가 이 경로에 named volume을 건다. 이미지에 디렉터리가 없으면
# Docker 가 root 소유로 만들어 버리고, airflow 사용자가 못 써서 spark-submit 이
# JAVA_GATEWAY_EXITED 로 죽는다. 경로의 2.5.2 는 Spark 4.0 번들 Ivy 의 버전이다
# (Ivy 는 캐시를 ~/.ivy2 가 아니라 ~/.ivy2.<버전> 에 만든다).

# 빌더에서 만든 Superset venv 를 그대로 가져온다.
COPY --from=superset-build --chown=airflow:root /opt/superset-venv /opt/superset-venv

USER airflow
ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1

# --- dbt ------------------------------------------------------------------
RUN python -m venv /opt/dbt-venv \
 && /opt/dbt-venv/bin/pip install --upgrade pip \
 && /opt/dbt-venv/bin/pip install \
      "dbt-core==1.12.0" \
      "dbt-spark[session]==1.11.0" \
      "pyspark==4.0.4" \
      "elementary-data[spark]==0.25.1" \
 # 런타임에는 패키지 설치 도구가 필요 없다. 같은 레이어에서 제거해야
 # Docker 이미지의 이전 레이어에도 pip 파일이 남지 않는다.
 && /opt/dbt-venv/bin/python -m pip uninstall -y pip \
 && find /opt/dbt-venv -type d -name __pycache__ -prune -exec rm -rf '{}' + \
 && find /opt/dbt-venv -type f \( -name '*.pyc' -o -name '*.pyo' \) -delete \
 # 정리 과정에서 실제 실행 파일까지 손상되지 않았는지 빌드 중 확인한다.
 && /opt/dbt-venv/bin/dbt --version \
 && /opt/dbt-venv/bin/edr --version \
 && /opt/dbt-venv/bin/python -c 'import pyspark; assert pyspark.__version__ == "4.0.4"'

# --- Data Mates -----------------------------------------------------------
COPY datamates/requirements.txt /tmp/requirements-app.txt

RUN python -m venv /opt/datamates-venv \
 && /opt/datamates-venv/bin/pip install --upgrade pip \
 && /opt/datamates-venv/bin/pip install -r /tmp/requirements-app.txt \
 # DuckDB 확장은 첫 조회 때 인터넷에서 받아 온다. 빌드 시점에 받아 이미지에 넣어야
 # 폐쇄망에서도 미리보기가 뜨고, 첫 조회만 유난히 느려지는 일도 없다.
 # httpfs 는 warehouse.py 가 명시적으로 INSTALL 하지 않지만 s3:// 를 읽을 때
 # DuckDB 가 자동 로드하므로 같이 받아 둔다. Superset 쪽 DuckDB 도 같은 캐시를 쓴다.
 && /opt/datamates-venv/bin/python -c "import duckdb; c = duckdb.connect(); \
c.execute('INSTALL iceberg'); c.execute('INSTALL httpfs'); \
c.execute('LOAD iceberg'); c.execute('LOAD httpfs')" \
 && /opt/datamates-venv/bin/python -m pip uninstall -y pip \
 && find /opt/datamates-venv -type d -name __pycache__ -prune -exec rm -rf '{}' + \
 # 세 venv 가 실제로 살아 있는지 빌드 중 한 번에 확인한다. DuckDB 는 앱과 Superset 에
 # 같은 버전이어야 한다 — 다르면 같은 테이블에서 타임존·소수 정밀도가 어긋난다.
 && /opt/datamates-venv/bin/python -c \
      'import fastapi, uvicorn, pyiceberg, pyarrow, duckdb, sqlglot, ruamel.yaml' \
 && /opt/superset-venv/bin/python -c \
      'import superset, duckdb_engine, psycopg2, duckdb; print("superset venv OK")' \
 && test "$(/opt/datamates-venv/bin/python -c 'import duckdb;print(duckdb.__version__)')" \
       = "$(/opt/superset-venv/bin/python -c 'import duckdb;print(duckdb.__version__)')"

# 컨테이너 안에서의 경로. 각 값의 의미는 datamates/app/config.py 에 적혀 있다.
#
# DATAMATES_DBT_BIN 이 핵심이다. 저장소를 마운트하면 호스트의 .venv 도 같이 들어오는데
# 그 안은 macOS 바이너리라 실행되지 않는다. 이미지 안의 dbt 를 쓰도록 갈아 끼운다.
ENV DBT_BIN=/opt/dbt-venv/bin/dbt \
    EDR_BIN=/opt/dbt-venv/bin/edr \
    DATAMATES_DBT_BIN=/opt/dbt-venv/bin/dbt \
    PYTHONPATH=/opt/project \
    DBT_SPARK_EVENTLOG=/opt/spark-events \
    DO_NOT_TRACK=1

# 저장소를 여기 마운트한다. config.py 의 PROJECT_DIR 은 자기 소스 위치에서 유도되므로
# (config.py → datamates/ → 루트) 이 경로가 곧 앱이 보는 저장소 루트가 된다.
#
# WORKDIR 을 바꾸지 않는다 — 베이스의 /opt/airflow 를 그대로 둬야 airflow 서비스가
# 자기 홈에서 뜬다. datamates 서비스는 compose 에서 working_dir 로 덮는다.

EXPOSE 8000 8080 8088

# ENTRYPOINT 를 손대지 않는다.
# 베이스의 /entrypoint 는 airflow 하위 명령(standalone 등)을 해석하므로 airflow 서비스가
# 그것을 그대로 쓴다. Airflow 가 아닌 두 서비스는 compose 에서 entrypoint 를
# dumb-init 으로 덮는다 — 그래야 uvicorn·gunicorn 이 PID 1 의 좀비 수거 없이 돌지 않는다.
#
# HEALTHCHECK 도 굽지 않는다. 한 이미지가 세 역할을 하므로 무엇을 확인해야 하는지가
# 서비스마다 다르다. compose 의 각 서비스에 둔다.
