#!/usr/bin/env bash
# 사용법:  source ./env.sh
#
# 로컬(local) 타깃으로 dbt 를 실행하는 환경변수를 설정한다.

_ENV_SH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"

# dbt 프로젝트 위치. 지정하지 않으면 저장소 안의 dbt/ 를 사용한다.
export DBT_PROJECT_DIR="${DBT_PROJECT_DIR:-${_ENV_SH_DIR}/dbt}"
export DBT_PROFILES_DIR="${DBT_PROJECT_DIR}/profiles"

# 경로가 비어 있으면 dbt·콘솔이 «dbt_project.yml 없음» 으로 죽는다. 미리 말해 준다.
if [ ! -f "${DBT_PROJECT_DIR}/dbt_project.yml" ]; then
  echo "경고: dbt 프로젝트가 없습니다 — ${DBT_PROJECT_DIR}" >&2
  echo "      DBT_PROJECT_DIR 로 dbt 프로젝트를 가리키세요 (docs/SETUP.md 참고)." >&2
fi

# Spark 호환 타깃은 Java 17을 사용한다.
if [ -z "${JAVA_HOME:-}" ] || ! "${JAVA_HOME}/bin/java" -version 2>&1 | grep -q '"17\.'; then
  _brew_j17="$(brew --prefix openjdk@17 2>/dev/null)/libexec/openjdk.jdk/Contents/Home"
  if [ -x "${_brew_j17}/bin/java" ]; then
    export JAVA_HOME="${_brew_j17}"
  elif /usr/libexec/java_home -v 17 >/dev/null 2>&1; then
    export JAVA_HOME="$(/usr/libexec/java_home -v 17)"
  else
    echo "경고: Java 17 을 찾지 못했습니다. brew install openjdk@17" >&2
  fi
  unset _brew_j17
fi

# Spark 호환 타깃이 항상 가상환경의 PySpark를 사용하도록 경로를 고정한다.
export SPARK_HOME="$("${_ENV_SH_DIR}/.venv/bin/python" -c 'import pyspark, os; print(os.path.dirname(pyspark.__file__))' 2>/dev/null)"

# 외부 Hadoop 설정이 섞이지 않도록 현재 셸에서 해제한다.
unset HADOOP_CONF_DIR
# -------------------------------------------------------------------------

export DBT_TARGET="${DBT_TARGET:-local}"
export DBT_SCHEMA="${DBT_SCHEMA:-analytics}"
# Spark 이벤트 로그. profiles.yml 은 이 변수가 있을 때만 로깅을 켠다.
# 디렉터리가 없으면 SparkContext 초기화가 실패하므로 여기서 만들어 둔다.
export DBT_SPARK_EVENTLOG="${DBT_SPARK_EVENTLOG:-${_ENV_SH_DIR}/.spark-events}"
mkdir -p "${DBT_SPARK_EVENTLOG}"
export SPARK_EVENTLOG_ENABLED="${SPARK_EVENTLOG_ENABLED:-true}"

# DuckLake 카탈로그(Postgres). 웨어하우스의 메타데이터가 여기 있고,
# 데이터 파일은 s3://warehouse/ducklake/ 의 Parquet 이다.
# dbt · warehouse.py · ingest.py 가 모두 이 값들로 같은 카탈로그에 붙는다.
export POSTGRES_HOST="${POSTGRES_HOST:-localhost}"
export POSTGRES_PORT="${POSTGRES_PORT:-5432}"
export POSTGRES_USER="${POSTGRES_USER:-datamates}"
export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-datamates}"

# Spark 호환 타깃이 사용하는 Iceberg REST 카탈로그.
export ICEBERG_REST_URI="${ICEBERG_REST_URI:-http://localhost:8181}"

# 로컬 Spark 드라이버는 루프백 주소에 바인딩한다.
export SPARK_LOCAL_IP=127.0.0.1

# 가상환경의 dbt와 Spark 실행 파일을 우선한다.
export PATH="${SPARK_HOME}/bin:${_ENV_SH_DIR}/.venv/bin:${PATH}"

echo "dbt env ready  |  target=${DBT_TARGET}  schema=${DBT_SCHEMA}  java=$(basename "$(dirname "$(dirname "${JAVA_HOME}")")")"
echo "               |  spark=$("${_ENV_SH_DIR}/.venv/bin/python" -c 'import pyspark;print(pyspark.__version__)' 2>/dev/null)  SPARK_HOME=${SPARK_HOME#${_ENV_SH_DIR}/}"
unset _ENV_SH_DIR
