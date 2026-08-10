#!/usr/bin/env bash
# 사용법:  source ./env.sh
#
# 로컬(local) 타깃으로 dbt 를 돌리기 위한 환경변수를 잡는다.
# 원격 클러스터로 붙을 때는 아래 remote 블록의 주석을 풀고 DBT_TARGET 을 remote 로 바꾼다.

_ENV_SH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"

# dbt 프로젝트는 저장소 루트가 아니라 dbt/ 안에 있다.
# DBT_PROJECT_DIR 을 잡아두면 어느 디렉터리에서 `dbt build` 를 쳐도 여기를 찾으므로,
# 구조를 바꾸기 전과 똑같이 저장소 루트에서 dbt 명령을 쓸 수 있다.
export DBT_PROJECT_DIR="${_ENV_SH_DIR}/dbt"
export DBT_PROFILES_DIR="${DBT_PROJECT_DIR}/profiles"

# Spark 4.0 은 Java 17/21 만 지원한다. 기본 java 가 그보다 높으면 기동이 실패한다.
# brew 의 openjdk@17 은 /Library/Java/JavaVirtualMachines 에 심볼릭 링크가 없어서
# /usr/libexec/java_home 으로 안 잡히는 경우가 많다. 그래서 brew 경로를 먼저 찾고,
# 없으면 시스템에 등록된 17 을 쓴다. (Apple Silicon=/opt/homebrew, Intel=/usr/local)
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

# --- Spark 배포판 고정 (중요) -------------------------------------------
# ~/.zshrc 가 SPARK_HOME 을 별도 Spark 3.3.2 배포판으로 잡고 있다.
# PySpark 는 SPARK_HOME 이 있으면 그걸 우선하므로, 그대로 두면
#   Python 쪽 pyspark 3.5.3  +  JVM 쪽 Spark 3.3.2
# 라는 조합이 되어 다음처럼 죽는다:
#   py4j.Py4JException: Method sql([String, Object[]]) does not exist
#   (sql(String, Object[]) 오버로드는 Spark 3.4 에서 추가됐다)
# 그래서 이 프로젝트에서는 venv 의 pyspark 를 SPARK_HOME 으로 강제한다.
# 파이썬 버전에 상관없이 venv 의 pyspark 위치를 직접 물어본다.
export SPARK_HOME="$("${_ENV_SH_DIR}/.venv/bin/python" -c 'import pyspark, os; print(os.path.dirname(pyspark.__file__))' 2>/dev/null)"

# HADOOP_CONF_DIR 이 남아 있으면 Spark 가 그쪽 *-site.xml 을 읽어 파일시스템 설정이
# 섞인다. 이 셸에서만 떼어낸다 (~/.zshrc 는 건드리지 않는다).
unset HADOOP_CONF_DIR
# -------------------------------------------------------------------------

export DBT_TARGET="${DBT_TARGET:-local}"
export DBT_SCHEMA="${DBT_SCHEMA:-analytics}"
# Spark 이벤트 로그. profiles.yml 은 이 변수가 있을 때만 로깅을 켠다.
# 디렉터리가 없으면 SparkContext 초기화가 실패하므로 여기서 만들어 둔다.
export DBT_SPARK_EVENTLOG="${DBT_SPARK_EVENTLOG:-${_ENV_SH_DIR}/.spark-events}"
mkdir -p "${DBT_SPARK_EVENTLOG}"
export SPARK_EVENTLOG_ENABLED="${SPARK_EVENTLOG_ENABLED:-true}"

# 로컬 Iceberg REST 카탈로그. docker-compose up -d 로 띄운다.
export ICEBERG_REST_URI="${ICEBERG_REST_URI:-http://localhost:8181}"

# --- 원격 Spark Thrift Server 로 붙을 때 ---------------------------------
# export DBT_TARGET=remote
# export SPARK_THRIFT_HOST="your-thrift-host"
# export SPARK_THRIFT_PORT="10000"
# export SPARK_USER="$USER"
# export SPARK_AUTH="NOSASL"
# export ICEBERG_CATALOG="rest_prod"
# export ICEBERG_REST_URI="http://your-iceberg-rest-catalog:8181"
# export ICEBERG_WAREHOUSE="hdfs:///warehouse/iceberg"
# -------------------------------------------------------------------------

# Spark 드라이버 바인드 주소 — 호스트명으로 두면 네트워크(와이파이/VPN)가
# 바뀔 때 스테일 IP 로 해석돼 «Can't assign requested address: sparkDriver» 로
# 모든 로컬 Spark 기동이 죽는다. 로컬 모드만 쓰므로 루프백에 고정한다.
export SPARK_LOCAL_IP=127.0.0.1

# venv 의 dbt 와 SPARK_HOME 의 spark-submit 계열을 PATH 맨 앞에 둔다.
# ~/.zshrc 가 3.3.2 의 bin 을 PATH 에 넣어두었으므로 앞에 와야 이긴다.
export PATH="${SPARK_HOME}/bin:${_ENV_SH_DIR}/.venv/bin:${PATH}"

echo "dbt env ready  |  target=${DBT_TARGET}  schema=${DBT_SCHEMA}  java=$(basename "$(dirname "$(dirname "${JAVA_HOME}")")")"
echo "               |  spark=$("${_ENV_SH_DIR}/.venv/bin/python" -c 'import pyspark;print(pyspark.__version__)' 2>/dev/null)  SPARK_HOME=${SPARK_HOME#${_ENV_SH_DIR}/}"
unset _ENV_SH_DIR
