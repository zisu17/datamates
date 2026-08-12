FROM apache/airflow:3.2.2-python3.11

# ---------------------------------------------------------------------------
# Java 17 — Spark 4.0 이 요구한다.
# 아키텍처마다 JDK 경로가 달라서(arm64/amd64) 하드코딩하지 않고 심볼릭 링크로 고정한다.
# ---------------------------------------------------------------------------
USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      openjdk-17-jre-headless \
      procps \
 && rm -rf /var/lib/apt/lists/* \
 && ln -sfn "$(dirname "$(dirname "$(readlink -f "$(command -v java)")")")" /opt/java-home \
 && mkdir -p /opt/dbt-venv /opt/spark-events /home/airflow/.ivy2.5.2 \
 && chown airflow:root /opt/dbt-venv /opt/spark-events /home/airflow/.ivy2.5.2

ENV JAVA_HOME=/opt/java-home

# .ivy2.5.2 를 여기서 미리 만들어 두는 이유:
# Docker Compose가 이 경로에 named volume을 건다. 이미지에 디렉터리가 없으면
# Docker 가 root 소유로 만들어 버리고, airflow 사용자가 못 써서 spark-submit 이
# JAVA_GATEWAY_EXITED 로 죽는다. 경로의 2.5.2 는 Spark 4.0 번들 Ivy 의 버전이다
# (Ivy 는 캐시를 ~/.ivy2 가 아니라 ~/.ivy2.<버전> 에 만든다).

# ---------------------------------------------------------------------------
# dbt 는 Airflow 와 **별도 venv** 에 설치한다.
# 같은 환경에 넣으면 jinja2 / click / pydantic 등에서 버전 충돌이 난다.
# DAG 에서는 /opt/dbt-venv/bin/dbt 를 직접 호출한다.
# ---------------------------------------------------------------------------
USER airflow
ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1

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

# 호스트 venv 와 헷갈리지 않도록 컨테이너 안 경로를 명시해 둔다.
ENV DBT_BIN=/opt/dbt-venv/bin/dbt \
    EDR_BIN=/opt/dbt-venv/bin/edr
