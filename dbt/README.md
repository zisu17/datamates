# analytics — dbt 테스트 구축 프로젝트 (Spark / Iceberg)

dbt 의 데이터 테스트를 **로컬에서 실제로 돌려보면서** 붙여나가기 위한 프로젝트다.
로컬 PySpark 세션 + 로컬 Iceberg **REST 카탈로그**로 원격과 같은 구성을 재현하므로,
테스트를 쓰고 깨뜨려보는 개발 루프가 클러스터 의존 없이 돈다.
`DBT_TARGET=remote` 로 바꾸면 사내 Spark Thrift Server 에 그대로 붙는다.

테스트 결과 이력은 [Elementary](https://docs.elementary-data.com/) 로 적재해 HTML 리포트로 본다.

## 검증된 구성

| 구성요소 | 버전 |
| --- | --- |
| dbt-core | 1.12.0 |
| dbt-spark | 1.11.0 |
| dbt-utils | 1.4.1 |
| elementary (dbt 패키지) | 0.25.1 |
| elementary-data (`edr` CLI) | 0.25.1 |
| Python | 3.11.6 (`.venv`) |
| PySpark | **4.0.4** (Scala 2.13, Hadoop 3.4.1 번들) |
| Iceberg runtime | `iceberg-spark-runtime-4.0_2.13:1.10.1` |
| Iceberg AWS | `iceberg-aws-bundle:1.10.1` (S3FileIO) |
| Iceberg REST 카탈로그 | `apache/iceberg-rest-fixture:1.10.1` |
| 저장소 | MinIO (S3 호환) |
| Java | **17** (Spark 4.0 은 17/21 만 지원) |

`dbt build --full-refresh` 기준 **PASS=75, WARN=1, ERROR=0 / 총 76 노드**
(analytics 44 + elementary 32). WARN 1 건은 의도된 것이다 (severity 설명 참고).

## 시작하기

이미 구축된 환경에서 다시 띄울 때. **새 맥에 처음부터 올리는 절차는 [SETUP.md](SETUP.md)** 를 보라.

```bash
docker-compose up -d && ./scripts/bootstrap_catalog.sh
source ./env.sh
dbt build
```

최초 1회만 `dbt deps` 와 `dbt run --select elementary`(결과 적재 테이블 생성)가 추가로 필요하다.

`env.sh` 는 `DBT_PROFILES_DIR`, `JAVA_HOME`(Java 11), 웨어하우스 경로, REST 카탈로그 URI 를
잡고 `.venv/bin` 을 PATH 앞에 붙인다. 이후에는 그냥 `dbt` 로 쓰면 된다.

로컬 상태를 초기화할 때는 **디렉터리 자체를 지우지 말고 내용만** 지운다.
마운트된 디렉터리를 `rm -rf` 하면 colima 의 파일 공유가 깨져 컨테이너가 `SQLITE_CANTOPEN` 으로 죽는다.

```bash
docker-compose down
find .spark-warehouse .iceberg-rest -mindepth 1 -delete
docker-compose up -d && ./scripts/bootstrap_catalog.sh
```

## 데이터 모델

```
raw_events (seed)      ─┐
                        ├─→ stg_events ────┐
raw_event_types (seed) ─┴─→ stg_event_types ├─→ fct_events   (incremental / iceberg merge)
                                             └─→ dim_event_types
```

- `stg_events` 그레인은 **(event_id, batch_id)**. 한 이벤트가 뒤 배치에서 정정되어 다시 들어온다.
- `fct_events` 그레인은 **event_id**. event_id 당 최신 batch 만 남기고 Iceberg merge 로 갱신한다.

## 테스트 계층 — 5 종류를 모두 덮는다

| 종류 | 위치 | 이 프로젝트의 예 |
| --- | --- | --- |
| 내장 제네릭 | `models/**/_*__models.yml` | `not_null`, `unique`, `accepted_values`, `relationships` |
| 패키지 제네릭 | 같음 (dbt-utils) | `unique_combination_of_columns`, `expression_is_true`, `accepted_range` |
| 커스텀 제네릭 | `tests/generic/*.sql` | [`not_in_future`](tests/generic/not_in_future.sql) — 인자 `tolerance_days` 를 받는다 |
| 싱귤러 | `tests/*.sql` | [정정 반영 검증](tests/assert_fct_events_restatement_applied.sql), [건수 정합성](tests/assert_fct_events_row_count_matches_stg.sql) |
| 유닛 테스트 | `models/**/_*__unit_tests.yml` | [정규화 로직](models/staging/_staging__unit_tests.yml), [최신 배치 선택 로직](models/marts/_marts__unit_tests.yml) |

**데이터 테스트와 유닛 테스트의 차이**가 핵심이다.
데이터 테스트는 *실제 적재된 결과*가 규칙을 만족하는지 보고, 유닛 테스트는 *고정 입력*으로
모델 SQL 자체의 변환 로직을 검증한다. 유닛 테스트는 테이블을 읽지 않으므로 데이터가 없어도 돈다.

### 테스트 설정 노브

```yaml
# severity: 익명 이벤트는 정상이므로 error 가 아닌 warn 으로 두고, 실패 행은 테이블로 남긴다
- not_null:
    config:
      severity: warn
      store_failures: true

# where: 환불은 음수 금액이 정상이므로 검사 대상에서 뺀다
- dbt_utils.expression_is_true:
    arguments:
      expression: "amount >= 0"
    config:
      where: "event_type <> 'refund'"
```

`store_failures` 로 남은 실패 행 조회:

```bash
dbt show --inline "select * from analytics_test_failures.not_null_stg_events_user_id"
```

전역 `store_failures` 는 [dbt_project.yml](dbt_project.yml) 에서 꺼두었다. 켜면 테스트 수만큼
테이블이 생겨 빌드가 느려지므로, 사후 조회가 필요한 테스트에만 개별로 켜는 편이 낫다.

그 밖에 쓸 수 있는 것: `limit`, `error_if` / `warn_if`(예: `error_if: ">100"`), `tags`, `enabled`.

## 명령어

```bash
dbt build                              # 시드+모델+테스트를 DAG 순서로. 평소엔 이것만 쓰면 된다
dbt build --exclude elementary         # elementary 모델 빼고 우리 것만
dbt test --select stg_events           # 특정 모델의 테스트만
dbt test --select test_type:unit       # 유닛 테스트만
dbt test --select test_type:singular   # 싱귤러 테스트만
dbt build --select +fct_events         # fct_events 와 그 상류 전체
```

`dbt run` + `dbt test` 를 따로 돌리는 것보다 **`dbt build` 를 쓰는 편이 낫다**.
`dbt build` 는 테스트가 실패하면 그 하위 모델을 SKIP 해서 오염된 데이터가 하류로 퍼지는 것을 막는다.
실제로 미등록 `event_type` 한 건을 넣어보면 테스트 3 건이 FAIL 하고 하위 13 개 노드가 SKIP 된다.

## 증분 merge 시나리오

```bash
dbt build --full-refresh --vars '{max_batch_id: 1}'   # 배치 1 만 적재
dbt build --vars '{max_batch_id: 2}'                  # 배치 2 도착 → Iceberg merge
```

배치 2 이후 기대 결과:

- `event_id = 2` 가 **update** 된다 (amount 89.90 → 45.00, `PURCHASE` → `purchase` 로 정규화).
- `event_id` 6, 7, 8 이 **insert** 된다.
- 싱귤러 테스트 두 건이 update 누락과 중복 insert 를 각각 감시한다.

유닛 테스트는 `overrides.vars` 로 `max_batch_id` 를 고정해 두었다. 런타임 `--vars` 에
흔들리면 로직 검증이 아니라 실행 조건 검증이 되어버리기 때문이다.

## 테스트 결과 이력 — Elementary

dbt docs 는 정적 스냅샷이라 "테스트가 **언제부터** 깨졌는지"를 보여주지 못한다. 그 구멍을 메운다.

```bash
edr report --project-dir "$PWD" --profiles-dir "$PWD/profiles" --target-path "$PWD/edr_target"
open edr_target/elementary_report.html
```

리포트에는 테스트 결과 분포, 테이블 헬스, 실행별 실패/경고 시계열, 리니지가 들어간다.
`edr monitor` 로 Slack/Teams 알림도 보낼 수 있다.

동작 구조:

- **dbt 패키지**(`packages.yml`) — `on-run-start`/`on-run-end` 훅으로 실행·테스트 결과를
  `analytics_elementary` 스키마의 테이블에 적재한다. 훅은 패키지가 스스로 선언하므로
  우리 `dbt_project.yml` 에 따로 걸 필요가 없다.
- **`edr` CLI**(pip) — 그 테이블을 읽어 HTML 리포트를 만든다.
  `profiles.yml` 에서 **`elementary` 라는 이름의 프로필**을 찾으므로 반드시 있어야 한다
  (이 프로젝트는 YAML 머지 키로 `analytics` 프로필의 접속 정보를 재사용한다).

적재 이력 직접 조회:

```bash
dbt show --inline "
  select date_format(detected_at,'HH:mm:ss') as run_at, status, count(*) as cnt
  from {{ ref('elementary','elementary_test_results') }} group by 1,2 order by 1,2"
```

## Airflow

```bash
docker-compose up -d          # minio, iceberg-rest, airflow 전부
open http://localhost:8080    # admin / 아래 명령으로 비밀번호 확인
```

```bash
docker exec airflow cat /opt/airflow/simple_auth_manager_passwords.json.generated
```

DAG 은 [dags/](dags/) 에 넣으면 컨테이너에 바로 반영된다. 배관 확인용 [dbt_smoke](dags/dbt_smoke.py) 가 들어 있다.

### 구조

dbt 는 Airflow 이미지 안의 **별도 venv** 에 설치돼 있다. 같은 환경에 넣으면 jinja2·click
등에서 버전이 충돌하기 때문이다. DAG 에서는 절대경로로 호출한다.

```
/opt/dbt-venv/bin/dbt     # dbt 1.12.0 + dbt-spark 1.11.0 + pyspark 4.0.4
/opt/dbt-venv/bin/edr     # elementary-data 0.25.1
/opt/project              # 프로젝트 (읽기전용 마운트)
```

컨테이너가 `dbt_default` 네트워크에 있으므로 MinIO·Iceberg REST 를 **서비스 이름**으로
부른다. `profiles.yml` 의 엔드포인트가 `env_var` 로 파라미터화돼 있어서 프로필 파일은
손대지 않고 환경변수만 바꿔 끼운다.

| | 호스트 | Airflow 컨테이너 |
| --- | --- | --- |
| `ICEBERG_REST_URI` | `http://localhost:8181` | `http://iceberg-rest:8181` |
| `MINIO_ENDPOINT` | `http://localhost:9000` | `http://minio:9000` |

둘은 **같은 웨어하우스**를 본다. 컨테이너에서 `dbt build` 하면 호스트에서 그 결과가 보인다.

### DAG 작성 시 주의

- **컨테이너에서 `source env.sh` 를 하지 말 것.** `env.sh` 는 호스트용이라 `SPARK_HOME` 을
  macOS 경로로 덮어버린다. 컨테이너 환경변수는 compose 가 이미 주입한다.
- 프로젝트는 **읽기전용** 마운트다. dbt 산출물은 `DBT_TARGET_PATH` / `DBT_LOG_PATH` 로
  컨테이너 쪽에 쓴다. 호스트에서 돌린 `target/` 과 섞이지 않는다.
- `dbt deps` 는 호스트에서 미리 돌려 둔다 (`dbt_packages/` 를 그대로 읽는다).
- 메타DB 는 SQLite 라 태스크가 **순차 실행**된다. 병렬이 필요하면 Postgres 서비스를 추가하고
  executor 를 바꾼다.
- Iceberg jar 는 `ivy-cache` 볼륨에 남으므로 첫 태스크만 느리다.

## 원격 클러스터로 붙기

[env.sh](env.sh) 의 remote 블록 주석을 풀고:

```bash
export DBT_TARGET=remote
export SPARK_THRIFT_HOST="..."
export ICEBERG_REST_URI="http://your-iceberg-rest-catalog:8181"
dbt debug
```

원격에서도 스키마 3 개를 미리 만들어 둬야 한다 (아래 함정 2 번 참고):

```sql
CREATE SCHEMA IF NOT EXISTS analytics;
CREATE SCHEMA IF NOT EXISTS analytics_elementary;
CREATE SCHEMA IF NOT EXISTS analytics_test_failures;
```

> **`method: livy` 는 쓸 수 없다.**
> Python dbt Core 의 `dbt-spark` 어댑터가 지원하는 연결 방식은 `thrift` / `http` / `odbc` / `session`
> 네 가지뿐이다. Livy 는 dbt Fusion 문서에만 있는 것으로, dbt Core 에서는 `dbt debug` 부터 실패한다.
> Livy 가 필수라면 dbt Fusion CLI 로 가야 하고, dbt Core 를 유지한다면 Spark Thrift Server 를 띄워야 한다.
> (기존 `~/Documents/dbt` 프로필이 이 구성이었다.)

## 알아둘 함정

**1. Iceberg 파일 기반(hadoop) 카탈로그는 뷰를 지원하지 않는다.**

`Replacing a view is not supported by catalog` 로 죽는다. elementary 는 뷰 모델을 13 개 쓰기
때문에 통째로 깨진다. 그래서 로컬도 **REST 카탈로그**를 쓴다 — REST 카탈로그는 Iceberg 뷰
스펙을 지원한다. `materialized` 를 강제로 `table` 로 덮는 우회는 쓰지 않는 게 낫다.
elementary 의 결과 적재 테이블은 `incremental` 이라 함께 `table` 이 되면 이력이 매 실행 초기화된다.

**2. elementary 의 `on-run-start` 훅은 대상 스키마가 이미 있다고 가정한다.**

빈 웨어하우스에서 첫 실행 시 `NoSuchNamespaceException` 으로 모델 실행 전에 죽는다.
루트 프로젝트에 `on-run-start` 훅을 걸어도 소용없다 — **패키지 훅이 루트 훅보다 먼저 실행된다.**
그래서 dbt 바깥에서 [scripts/bootstrap_catalog.sh](scripts/bootstrap_catalog.sh) 로 미리 만든다.

**3. dbt-spark 의 `make_temp_relation` 은 스키마를 떼어낸다.**

`spark__make_temp_relation` 이 `include(database=false, schema=false)` 를 한다. Spark 의
`CREATE TEMPORARY VIEW` 는 세션 스코프 비수식 이름이라 맞는 동작이지만, elementary 는 이
relation 으로 **실제 테이블**을 만든다. Iceberg REST 카탈로그는 네임스페이스 없는 식별자를 거부해
`Invalid table identifier: dbt_models__tmp_...` 로 죽는다.
[macros/spark__edr_make_temp_relation.sql](macros/spark__edr_make_temp_relation.sql) 로 교체하고,
`dbt_project.yml` 의 `dispatch` 설정으로 우리 구현을 먼저 찾게 했다.

**4. `method: session` 은 seed 의 빈 셀을 NULL 이 아니라 문자열 `'None'` 으로 넣는다.**

`SessionConnectionWrapper._fix_binding()` 이 숫자·datetime 이 아닌 값을 전부 `f"'{value}'"`
로 감싸서 Python `None` 이 길이 4 의 문자열이 된다. 반면 `method: thrift` 는 PyHive 가
제대로 `NULL` 로 넘긴다. **같은 seed 가 로컬과 원격에서 다르게 들어온다.**
그래서 이 프로젝트는 seed 에 빈 셀을 두지 않고 `ANONYMOUS` 센티널을 쓰고, 스테이징에서
`nullif` 로 정규화한다.

**5. Spark OSS 는 `SELECT * EXCEPT (col)` 을 지원하지 않는다.** Databricks 전용 문법이다.
윈도우 함수 보조 컬럼을 떨궈낼 때는 컬럼을 명시해야 한다.

**6. dbt 1.10+ 는 제네릭 테스트 인자를 `arguments:` 아래에 둬야 한다.**

```yaml
- accepted_values:
    arguments:            # ← 없으면 MissingArgumentsPropertyInGenericTestDeprecation
      values: ["a", "b"]
    config:
      severity: warn
```

**7. Java 버전과 Spark 배포판 충돌.** Spark 4.0 은 Java 17/21 만 지원한다. 이 맥의 기본
`java` 는 23 이라 `env.sh` 가 brew 의 `openjdk@17` 을 명시적으로 잡는다.

더 까다로운 건 `SPARK_HOME` 이다. `~/.zshrc` 가 별도 Spark 3.3.2 배포판을 가리키고 있고,
PySpark 는 `SPARK_HOME` 이 있으면 그걸 우선한다. 그대로 두면
**Python 쪽 pyspark 4.0.4 + JVM 쪽 Spark 3.3.2** 조합이 되어
`py4j.Py4JException: Method sql([String, Object[]]) does not exist` 로 죽는다
(`sql(String, Object[])` 오버로드는 Spark 3.4 에서 추가됐다).
`env.sh` 가 `SPARK_HOME` 을 venv 의 pyspark 로 덮고 `HADOOP_CONF_DIR` 을 떼어낸다.
`~/.zshrc` 는 건드리지 않으므로 다른 프로젝트에는 영향이 없다.

**8. colima 는 마운트된 디렉터리를 `rm -rf` 하면 공유가 깨진다.** 위 "시작하기" 의 초기화 절차 참고.

## 다음 단계

- **소스와 freshness** — 원천이 실제 Iceberg 테이블이 되면 `sources:` 를 정의하고
  `loaded_at_field` + `freshness` 를 걸어 `dbt source freshness` 로 적재 지연을 감시한다.
  Elementary 리포트의 Freshness 패널도 그때부터 채워진다. 지금은 seed 기반이라 넣지 않았다.
- **CI** — `dbt build` 를 파이프라인에 걸고, PR 에서는 `dbt build --select state:modified+`
  로 변경분만 돌리면 빠르다 (`--defer` + 이전 `manifest.json` 필요).
- **알림** — `edr monitor --slack-webhook ...` 으로 테스트 실패 시 Slack 알림.
- **문서** — `dbt docs generate && dbt docs serve` 로 테스트가 붙은 계보를 브라우저에서 볼 수 있다.
