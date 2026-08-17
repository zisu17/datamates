-- Postgres 초기화 — 한 인스턴스에 DB 세 개.
--
-- 이 파일은 데이터 디렉터리가 **비어 있을 때 한 번만** 실행된다. 이미 초기화된
-- 볼륨에는 다시 돌지 않으므로, 나중에 DB 를 더하려면 여기에 적는 것만으로는
-- 부족하고 직접 CREATE DATABASE 를 해야 한다.
--
-- 인스턴스를 셋으로 나누지 않은 이유: 셋 다 같은 호스트에서 같은 수명으로 살고,
-- 컨테이너를 늘리는 비용이 격리 이득보다 크다. 실제로 분리해야 할 만큼 부하가
-- 갈리면 그때 나눈다 — 접속 문자열만 바꾸면 된다.

-- 플랫폼 메타스토어. dbt 가 모르는 것(파이프라인·수집기·이력·마트 지정)이 여기 들어간다.
CREATE DATABASE datamates;

-- Airflow 메타DB. LocalExecutor 로 태스크를 병렬로 돌리려면 SQLite 로는 안 된다.
CREATE DATABASE airflow;

-- Iceberg JDBC 카탈로그. 표는 iceberg_tables · iceberg_namespace_properties 둘뿐이고
-- Iceberg REST 카탈로그 데이터베이스.
CREATE DATABASE iceberg;

-- DuckLake 카탈로그. 웨어하우스의 진짜 메타데이터가 여기 있다 — 스냅샷·스키마·
-- 파일 목록 전부. 데이터 파일 자체는 s3://warehouse/ducklake/ 의 Parquet 이다.
-- 이미 초기화된 볼륨에는 이 파일이 다시 돌지 않으므로, 기존 설치에는
--   docker exec postgres psql -U datamates -d postgres -c "CREATE DATABASE ducklake"
CREATE DATABASE ducklake;
