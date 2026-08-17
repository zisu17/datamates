# Data Mates 애플리케이션

Data Mates는 dbt 프로젝트를 기반으로 데이터 모델, 계보, 파이프라인, 품질 규칙과 분석 자산을 관리하는 FastAPI 애플리케이션입니다. 화면과 API를 한 서버에서 제공합니다.

```bash
docker compose -f docker/compose.yml -f docker/compose.superset.yml up -d
```

호스트에서 개발 서버를 실행할 때는 다음 명령을 사용합니다.

```bash
./datamates/run.sh
```

화면은 http://localhost:8000, OpenAPI 문서는 http://localhost:8000/docs 에서 확인할 수 있습니다.

## 데이터와 메타데이터

dbt 프로젝트 파일은 모델 SQL, 컬럼, 설명, 의존관계와 품질 테스트의 기준입니다. 애플리케이션은 파일을 수정한 뒤 `dbt parse`로 `target/manifest.json`을 갱신하고, 이를 카탈로그와 계보 화면에 사용합니다.

PostgreSQL 메타스토어에는 dbt가 관리하지 않는 다음 정보를 저장합니다.

- 파이프라인과 수집 작업 정의
- 자격증명과 변경 이력
- 카탈로그 폴더와 DATA MART 지정
- Superset 데이터셋 매핑
- 실행 트리거 기록

```text
ui/ -> Data Mates API -> dbt 프로젝트 -> dbt build -> DuckLake -> MinIO
                         |                |
                         |                -> Airflow 실행 상태와 로그
                         -> manifest.json -> 카탈로그와 계보
```

## 주요 디렉터리

| 경로 | 역할 |
| --- | --- |
| `app/main.py` | FastAPI 애플리케이션과 라우터 구성 |
| `app/routers/` | 도메인별 API 엔드포인트 |
| `app/analytics/` | Superset 연동과 데이터셋 동기화 |
| `app/dbtproj.py` | dbt 명령 실행과 manifest 갱신 |
| `app/daggen.py` | 파이프라인 DAG 생성 |
| `app/ingest.py` | 원천 데이터 수집과 DuckLake 적재 |
| `app/store.py` | PostgreSQL 메타스토어 |
| `app/warehouse.py` | DuckLake 조회 |
| `../ui/` | 정적 웹 UI |

## 실행 흐름

애플리케이션 시작 시 메타스토어를 준비하고, 저장된 파이프라인과 수집 작업을 기준으로 DAG 파일을 갱신합니다. Airflow와 Superset이 아직 준비되지 않은 경우 해당 연동 작업은 다음 요청에서 다시 시도할 수 있도록 애플리케이션 기동을 계속합니다.

파이프라인 실행은 모델의 `ref()` 의존관계를 Airflow 태스크 의존성으로 변환합니다. 실행 결과의 모델별 상태, 처리 시간과 행 수는 dbt의 `run_results.json`에서 읽습니다.

## 모델과 품질 규칙

모델 저장은 파일 수정과 `dbt parse`를 하나의 작업으로 처리합니다. 파싱에 실패하면 파일을 이전 상태로 복원합니다.

화면에서 생성한 모델 메타데이터는 `models/marts/_datamates__models.yml`에 저장합니다. 기존 YAML 파일을 수정할 때는 주석과 서식을 보존합니다.

품질 규칙은 별도 메타데이터가 아니라 dbt의 `schema.yml` 테스트로 관리합니다. 지원하는 규칙은 다음과 같습니다.

- 필수값 (`not_null`)
- 중복 (`unique`)
- 허용값 (`accepted_values`)
- 참조 무결성 (`relationships`)
- 범위 (`accepted_range`)

규칙을 비활성화하면 삭제하지 않고 `enabled: false`로 저장합니다. 위반 데이터 예시는 dbt 테스트에 실패 행 저장이 설정된 경우에 제공됩니다.

## UI 개발

`ui/index.html`은 화면 골격과 스크립트 로드 순서를 정의하고, `ui/app.css`와 `ui/ds/`는 스타일과 디자인 토큰을 관리합니다. 화면 로직은 `ui/js/`에 있습니다.

JavaScript를 수정한 뒤 문법을 확인합니다.

```bash
for file in ui/js/*.js; do node --check "$file"; done
```

API 기본 주소는 화면을 제공한 origin입니다. UI만 별도로 실행할 때는 브라우저 저장소에 API 주소를 지정할 수 있습니다.

```js
localStorage.setItem('datamates.api', 'http://localhost:8000')
```

## API 규약

API 접두사는 `/api/v1`입니다. 오류 응답은 `code`, `message`, `details`, `requestId` 필드를 사용하며 사용자 메시지는 서버에서 완성된 문장으로 반환합니다.

요청 컨텍스트에는 `X-Org-Id`, `X-Project-Id`, `X-Env`, `X-Request-Id` 헤더를 사용할 수 있습니다. 전체 엔드포인트와 스키마는 실행 중인 서버의 `/docs`에서 확인합니다.
