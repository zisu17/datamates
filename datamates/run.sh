#!/usr/bin/env bash
# Data Mates API 기동.
#
#   ./datamates/run.sh              # http://localhost:8000  (문서: /docs)
#
# 서버가 호출하는 dbt의 프로젝트와 실행 환경을 env.sh에서 설정한다.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

# shellcheck source=/dev/null
source ./env.sh

exec .venv/bin/uvicorn datamates.app.main:app \
  --host 0.0.0.0 --port "${DATUM_PORT:-8000}" --reload --reload-dir datamates
