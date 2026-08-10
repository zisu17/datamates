#!/usr/bin/env bash
# Data Mates API 기동.
#
#   ./datamates/run.sh              # http://localhost:8000  (문서: /docs)
#
# env.sh 를 먼저 읽는 이유: 이 서버가 dbt 를 서브프로세스로 부르기 때문이다.
# DBT_PROFILES_DIR / JAVA_HOME / SPARK_HOME 이 없으면 dbt parse 가 실패한다.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

# shellcheck source=/dev/null
source ./env.sh

exec .venv/bin/uvicorn datamates.app.main:app \
  --host 0.0.0.0 --port "${DATUM_PORT:-8000}" --reload --reload-dir datamates
