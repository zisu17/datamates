#!/usr/bin/env bash
#
# 로컬 Iceberg REST 카탈로그가 뜰 때까지 기다린 뒤 필요한 네임스페이스를 만든다.
#
#   docker-compose up -d && ./scripts/bootstrap_catalog.sh
#
# 왜 필요한가:
#   elementary 패키지의 on-run-start 훅은 대상 스키마들이 이미 존재한다고 가정하고
#   listTables 를 호출한다. 웨어하우스가 완전히 빈 상태에서는
#       NoSuchNamespaceException: Namespace does not exist: analytics
#   로 dbt 가 모델 실행 전에 죽는다.
#
#   루트 프로젝트의 on-run-start 훅으로는 해결되지 않는다 — 패키지 훅이 루트 훅보다
#   **먼저** 실행되기 때문이다. 그래서 dbt 바깥에서 미리 만들어 둔다.
#
# 원격(remote) 타깃에서는 이 스크립트 대신 Spark SQL 로 같은 일을 하면 된다:
#   CREATE SCHEMA IF NOT EXISTS analytics;
#   CREATE SCHEMA IF NOT EXISTS analytics_elementary;
#   CREATE SCHEMA IF NOT EXISTS analytics_test_failures;

set -euo pipefail

REST_URI="${ICEBERG_REST_URI:-http://localhost:8181}"
SCHEMA="${DBT_SCHEMA:-analytics}"

# store_failures 스키마와 elementary 스키마는 dbt 가 접미사를 붙여 만든다.
NAMESPACES=("${SCHEMA}" "${SCHEMA}_elementary" "${SCHEMA}_test_failures")

echo "REST 카탈로그 대기: ${REST_URI}"
for _ in $(seq 1 40); do
    if curl -sf --max-time 3 "${REST_URI}/v1/config" >/dev/null 2>&1; then
        break
    fi
    sleep 2
done

if ! curl -sf --max-time 3 "${REST_URI}/v1/config" >/dev/null 2>&1; then
    echo "REST 카탈로그에 접속할 수 없습니다: ${REST_URI}" >&2
    echo "  docker-compose up -d 로 먼저 기동했는지 확인하세요." >&2
    exit 1
fi

for ns in "${NAMESPACES[@]}"; do
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 \
        -X POST "${REST_URI}/v1/namespaces" \
        -H 'Content-Type: application/json' \
        -d "{\"namespace\":[\"${ns}\"],\"properties\":{}}")
    case "${code}" in
        200|201) echo "  생성: ${ns}" ;;
        409)     echo "  이미 있음: ${ns}" ;;
        *)       echo "  실패(${code}): ${ns}" >&2; exit 1 ;;
    esac
done

echo "부트스트랩 완료."
