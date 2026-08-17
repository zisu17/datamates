# Data Mates 설치

Data Mates는 Docker Compose로 애플리케이션, Airflow, DuckLake 저장소와 Superset을 실행합니다.

## 준비 사항

- Docker와 Docker Compose
- Git
- 연결할 dbt 프로젝트
- 호스트에서 개발 서버를 실행할 경우 Python 3.11

현재 배포 이미지는 `linux/arm64`를 지원합니다.

## dbt 프로젝트 연결

dbt 프로젝트 경로를 환경변수로 지정합니다. 지정하지 않으면 저장소의 `dbt/` 디렉터리를 사용합니다.

```bash
export DBT_PROJECT_DIR=/absolute/path/to/your-dbt-project
```

지정한 디렉터리에는 `dbt_project.yml`과 `profiles/`가 있어야 합니다.

## 전체 스택 실행

저장소 루트에서 실행합니다.

```bash
docker volume create iceberg-catalog
docker compose -f docker/compose.yml -f docker/compose.superset.yml up -d
./scripts/bootstrap_catalog.sh
```

주요 서비스 주소는 다음과 같습니다.

| 서비스 | 주소 |
| --- | --- |
| Data Mates | http://localhost:8000 |
| API 문서 | http://localhost:8000/docs |
| Airflow | http://localhost:8080 |
| MinIO 콘솔 | http://localhost:9001 |

`iceberg-catalog`는 Compose 파일에 외부 볼륨으로 선언되어 있어 최초 한 번 직접 생성해야 합니다.

상태와 로그는 다음 명령으로 확인합니다.

```bash
docker compose -f docker/compose.yml -f docker/compose.superset.yml ps
docker compose -f docker/compose.yml -f docker/compose.superset.yml logs -f
```

Airflow는 첫 실행 때 메타데이터 데이터베이스를 초기화하므로 준비에 시간이 걸릴 수 있습니다.

## dbt 초기화

처음 연결한 dbt 프로젝트는 의존성과 기본 테이블을 준비합니다.

```bash
source ./env.sh
dbt deps
dbt run --select elementary
dbt build --full-refresh
```

## 호스트에서 애플리케이션 개발

코드 변경을 자동으로 반영하려면 Data Mates 컨테이너만 중지하고 호스트 개발 서버를 실행합니다.

```bash
python3.11 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r requirements.txt -r datamates/requirements.txt
docker compose -f docker/compose.yml -f docker/compose.superset.yml stop datamates
./datamates/run.sh
```

`run.sh`는 `env.sh`를 읽고 `DBT_PROJECT_DIR`, 데이터베이스 연결 정보와 dbt 실행 환경을 설정합니다.

## 이미지 빌드

Data Mates, Airflow와 Superset은 같은 이미지를 서로 다른 명령으로 실행합니다.

```bash
docker build -f docker/datamates/Dockerfile -t zisu17/datamates:1.0.0 .
```

다중 아키텍처 이미지는 Buildx로 빌드합니다.

```bash
docker buildx create --name datamates --driver docker-container --bootstrap --use
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t zisu17/datamates:1.0.0 \
  --push \
  -f docker/datamates/Dockerfile .
```

## 종료

```bash
docker compose -f docker/compose.yml -f docker/compose.superset.yml down
```

데이터는 `minio-data`, `postgres-data`, `airflow-home` 등의 named volume에 유지됩니다.
볼륨까지 삭제하려면 데이터가 더 필요하지 않은지 확인한 뒤 `down -v`를 사용합니다.
