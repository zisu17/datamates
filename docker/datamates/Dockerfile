# Data Mates 애플리케이션 — FastAPI 백엔드 + 화면(ui/).
#
#   docker build -f docker/datamates/Dockerfile -t zisu17/datamates-app:1.0.0 .
#
# 컨텍스트가 저장소 루트다(requirements 파일을 읽어야 한다). docker/airflow 쪽과 달리
# -f 로 Dockerfile 을 지정해야 하는 이유가 이것이다.
#
# 앱 코드와 dbt 프로젝트는 이미지에 넣지 않고 런타임에 마운트한다.
# 이 앱이 하는 일이 곧 dbt 프로젝트 파일을 쓰는 것이고(SSoT), 그 결과물은 저장소에
# 남아서 Airflow 컨테이너에도 **같은 파일로** 보여야 한다. 이미지 안에 사본을 두면
# 두 컨테이너가 서로 다른 세계를 보게 되고, 사용자가 만든 모델은 컨테이너를 지우는
# 순간 사라진다.

# ---------------------------------------------------------------------------
# 베이스를 Airflow 이미지로 두는 이유.
#
# 이 앱은 dbt 를 서브프로세스로 부른다 — dbt parse(모델 저장), dbt seed(카탈로그),
# dbt test(품질 검증). 그래서 Java 17 과 pyspark 4.0.4, dbt-core 1.12.0 이 그대로
# 필요한데 그게 전부 저 이미지에 이미 들어 있다. 얻는 것이 두 가지다.
#
#   1. 레이어를 공유한다. 이 이미지를 새로 받는 비용이 200MB 대로 줄어든다
#      (python:3.11-slim 에서 새로 쌓으면 1.6GB 를 통째로 더 받는다).
#   2. 두 컨테이너의 dbt 버전이 어긋날 수 없다. 같은 dbt 프로젝트를 두고 앱은 parse 를,
#      Airflow 는 build 를 하므로 버전이 갈리면 manifest 가 미묘하게 틀어진다.
# ---------------------------------------------------------------------------
FROM zisu17/datamates-airflow:3.2.2

USER root
RUN mkdir -p /opt/datamates-venv /opt/datamates/runs \
 && chown airflow:root /opt/datamates-venv /opt/datamates/runs

# ---------------------------------------------------------------------------
# 앱 의존성은 **세 번째 venv** 에 넣는다.
# 이미지에는 이미 두 개가 있다 — Airflow 본체와 /opt/dbt-venv.
#
# Airflow 3 은 자기 API 서버를 FastAPI 로 만들었기 때문에 fastapi 와 pydantic 을
# 자기 버전으로 고정해 두고 있다. 거기에 앱의 fastapi 0.121.2 를 얹으면 둘 중 하나가
# 깨진다. 앱은 dbt 를 import 하지 않고 프로세스로 부르므로 venv 를 갈라도 잃는 것이 없다
# (같은 이유로 베이스 이미지가 dbt 를 /opt/dbt-venv 로 떼어 놓았다).
# ---------------------------------------------------------------------------
USER airflow
ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1

COPY datamates/requirements.txt /tmp/requirements-app.txt

RUN python -m venv /opt/datamates-venv \
 && /opt/datamates-venv/bin/pip install --upgrade pip \
 && /opt/datamates-venv/bin/pip install -r /tmp/requirements-app.txt \
 # DuckDB 확장은 첫 조회 때 인터넷에서 받아 온다. 빌드 시점에 받아 이미지에 넣어야
 # 폐쇄망에서도 미리보기가 뜨고, 첫 조회만 유난히 느려지는 일도 없다.
 # httpfs 는 warehouse.py 가 명시적으로 INSTALL 하지 않지만 s3:// 를 읽을 때
 # DuckDB 가 자동 로드하므로 같이 받아 둔다.
 && /opt/datamates-venv/bin/python -c "import duckdb; c = duckdb.connect(); \
c.execute('INSTALL iceberg'); c.execute('INSTALL httpfs'); \
c.execute('LOAD iceberg'); c.execute('LOAD httpfs')" \
 # 런타임에는 패키지 설치 도구가 필요 없다. 베이스 이미지가 dbt venv 에 한 것과 같다.
 && /opt/datamates-venv/bin/python -m pip uninstall -y pip \
 && find /opt/datamates-venv -type d -name __pycache__ -prune -exec rm -rf '{}' + \
 # 정리 과정에서 실제로 import 가 깨지지 않았는지 빌드 중 확인한다.
 && /opt/datamates-venv/bin/python -c \
      'import fastapi, uvicorn, pyiceberg, pyarrow, duckdb, sqlglot, ruamel.yaml'

# 컨테이너 안에서의 경로. 각 값의 의미는 datamates/app/config.py 에 적혀 있다.
#
# DATAMATES_DBT_BIN 이 핵심이다. 저장소를 마운트하면 호스트의 .venv 도 같이 들어오는데
# 그 안은 macOS 바이너리라 실행되지 않는다. 이미지 안의 dbt 를 쓰도록 갈아 끼운다.
ENV DATAMATES_DBT_BIN=/opt/dbt-venv/bin/dbt \
    PYTHONPATH=/opt/project \
    DBT_SPARK_EVENTLOG=/opt/spark-events \
    DO_NOT_TRACK=1

# 저장소를 여기 마운트한다. config.py 의 PROJECT_DIR 은 자기 소스 위치에서 유도되므로
# (config.py → datamates/ → 루트) 이 경로가 곧 앱이 보는 저장소 루트가 된다.
WORKDIR /opt/project

EXPOSE 8000

# 베이스의 ENTRYPOINT 는 Airflow 기동 스크립트(/entrypoint)다 — 메타DB 연결을 기다리고
# airflow 하위 명령을 해석한다. 이 컨테이너는 Airflow 를 돌리지 않으므로 떼어낸다.
# dumb-init 은 남긴다. uvicorn 이 PID 1 로 뜨면 자식 프로세스(dbt) 의 좀비를
# 거둘 주체가 없어진다 — dbt 를 호출마다 새로 띄우는 구조라 그냥 두면 쌓인다.
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# --reload 는 쓰지 않는다. 배포 이미지에서는 필요 없고, 기동할 때 DAG 파일을 다시 쓰는
# 구조(main.py 의 _regenerate_dags)와 겹치면 재기동이 꼬일 여지가 있다.
CMD ["/opt/datamates-venv/bin/uvicorn", "datamates.app.main:app", \
     "--host", "0.0.0.0", "--port", "8000"]

# curl 대신 앱 venv 의 httpx 를 쓴다. 의존성이 이미 있고, 베이스가 바뀌어도 안 깨진다.
# Airflow 가 아직 안 떠 있어도 /health 는 200 을 준다(airflowOk: false 로 알린다) —
# 그래야 «앱은 살아 있고 Airflow 만 없다»를 구분할 수 있다.
HEALTHCHECK --interval=10s --timeout=5s --start-period=40s --retries=5 \
  CMD ["/opt/datamates-venv/bin/python", "-c", \
       "import httpx; httpx.get('http://localhost:8000/api/v1/health', timeout=4).raise_for_status()"]
