# Data Mates — 데이터 모델 · 파이프라인

dbt 를 실행 엔진으로, Airflow 를 오케스트레이션으로, Iceberg/MinIO 를 저장소로 쓰는
설치형 데이터 플랫폼이다. 화면과 API 를 한 서버가 함께 내보낸다.

```bash
docker-compose up -d
./datamates/run.sh          # http://localhost:8000  (화면)  ·  /docs (API)
```

## 설계 원칙 하나

**dbt 프로젝트 파일이 단일 진실 원천(SSoT)이다.**

모델의 SQL·컬럼·설명·의존관계는 `models/` 아래 파일에만 있다. API 는 그 파일을 쓰고,
`dbt parse` 가 만든 `target/manifest.json` 을 읽어 화면 모양으로 바꿔 줄 뿐이다.
메타스토어(SQLite, `.datamates/datamates.db`)에는 dbt 가 모르는 것 — 파이프라인 정의, 카탈로그
폴더, 실행 트리거 기록 — 만 둔다.

같은 사실을 두 곳에 두지 않는 것이 요점이다. 카탈로그·컬럼·계보·테스트를 메타DB 에
옮겨 적으면 사람이 손으로 고친 dbt 모델과 반드시 어긋난다.

```
ui/ (화면) ─→ Data Mates API ─┬─→ models/**.sql, schema.yml   (쓰기)
                              ├─→ target/manifest.json         (읽기: 카탈로그·계보·컬럼)
                              ├─→ dags/datamates_*.py              (생성)
                              └─→ Airflow REST v2              (실행·상태·로그)
                                             └─→ dbt build ─→ Spark ─→ Iceberg ─→ MinIO
```

`run.sh` 가 `env.sh` 를 먼저 읽는다. 이 서버가 `dbt parse` 를 서브프로세스로 부르기
때문에 `DBT_PROFILES_DIR` / `JAVA_HOME` / `SPARK_HOME` 이 필요하다.

Airflow 비밀번호는 컨테이너에서 자동으로 읽는다. 직접 주려면 `AIRFLOW_PASSWORD` 를 쓴다.

## 화면 — `ui/`

```
ui/index.html   화면 골격(마크업·svg 심볼)과 로드 순서만 — 199줄
ui/app.css      스타일 전부 (원래 블록 순서 그대로 이어붙임)
ui/js/b00~54.js 화면 코드 — 원래 index.html 의 인라인 블록을 순서 그대로 파일로 뗀 것
ui/js/api.js    서버 연결 + v4.x 이후 화면 코드
```

이 앱은 원래 **버전 블록을 뒤에 덧붙여 앞의 함수를 덮어쓰는** 방식으로 자라 왔고
(v2.1 이 v1.0 을 덮어썼다), 2026-08 리팩토링에서 그 사슬을 걷어내는 중이다.
로드 중 실행되던 흔적 호출과 죽은 세대(~7,000줄)는 제거했고, 코어(render·boot·go·
pageView·topbar 등)와 홈·품질·모델링·독은 **한 함수 = 한 정의**가 됐다.
**파이프라인 군집(pagePipeline 12겹 등)과 ERD 군집(erdView·wireErd 등)은 아직
덮어쓰기 사슬로 남아 있다.**

같은 이름의 정의가 여럿 보이면 **실행 순서상 마지막(파일 번호가 큰 쪽, api.js 가 최후)**
이 이긴다. 수정 전에는 `rg -n '\b<이름>\b' ui/js` 로 정의와 호출을 모두 확인하고,
수정 후에는 모든 파일에 `node --check` 를 실행해 로드 순서와 문법을 함께 검증한다.

부팅은 `GET /bootstrap` 한 번이다. 화면 렌더가 동기라 «다 있는 상태»에서 시작해야 하고,
화면마다 따로 부르면 모델 수만큼 요청이 나간다(N+1).

API 주소는 기본이 화면을 내보낸 origin 이다. 화면만 따로 열어 볼 때는:

```js
localStorage.setItem('datamates.api', 'http://localhost:8000')
```

### 화면에서 서버로 나가는 동작

| 화면 | 동작 | 호출 |
| --- | --- | --- |
| 데이터 모델 | 새 모델 | `POST /models` |
| | SQL 저장 · SQL 검사 | `POST /models/validate` → `PATCH /models/{id}` |
| | 설명 저장 | `PATCH /models/{id}` |
| | 모델 삭제 | `DELETE /models/{id}` |
| | 데이터 미리보기 탭 | `GET /catalog/{id}/preview` |
| 데이터 품질 | 새 규칙 · 저장 · 삭제 | `POST·PUT·DELETE /quality/rules` |
| | 사용 여부 토글 | `PATCH /quality/rules/{id}/active` |
| | 결과 내려받기 | `GET /quality/report:export` |
| 파이프라인 | 파이프라인으로 등록 | `POST /pipelines` |
| | 구성(카드 추가·제거) | `PUT /pipelines/{id}` (0.8초 모았다 한 번) |
| | 실행 설정 저장 | `PUT /pipelines/{id}` |
| | 전체 실행 | `POST /pipelines/{id}/runs` |
| | 이 모델부터 다시 실행 | `POST /pipelines/{id}/runs/{run}/rerun` |
| | 로그 탭 | `GET .../nodes/{model}/log` |

실행을 걸면 5초 간격으로 `runs/latest` 를 폴링해 카드 상태를 갱신하고, 끝나면 멈춘다.

### 화면 쪽 제약

- **논리 폴더는 브라우저에 저장된다.** v3.2 가 «개인 설정»으로 설계한 것을 그대로 뒀다.
  팀이 공유하는 폴더로 바꾸려면 서버에 `/folders` 가 이미 있으니 그때 옮기면 된다.
- **모델 이름은 «저장 위치»의 테이블명에서 온다.** 화면은 id·이름·저장 위치를 따로
  두지만 dbt 는 모델 이름 하나가 파일명이자 식별자다. `marts.agg_daily` 로 적으면
  모델 이름은 `agg_daily` 가 되고, 입력한 한글 이름은 설명으로 남는다.
- **데이터 미리보기는 탭을 열 때만 조회한다.** Spark 조회라 한 번에 15초쯤 걸려서,
  화면을 그릴 때마다 부르지 않고 «데이터 미리보기» 탭을 처음 열 때 한 번만 가져온다.
- **홈의 일부 위젯은 아직 예제 값이다** — «파이프라인 실행 결과(최근 7일)»,
  «원천 데이터 수집 지연», 품질 화면의 «최근 7일 품질 점수». 서버에는
  `/pipelines/{id}/trend` 와 `/quality/trend` 가 있으니 화면만 연결하면 된다.

## 엔드포인트

「API 인터페이스 설계서」(2026-08-07)를 따른다. 접두사는 `/api/v1`, 전체 102개.
목록은 http://localhost:8000/docs 에서 볼 수 있다.

| 도메인 | 개수 | 주요 경로 |
| --- | --- | --- |
| 세션·컨텍스트 | 6 | `/me` `/roles` `/orgs` `/me/context` `/me/settings` |
| 홈·알림 | 8 | `/home/summary` `/home/my-tasks` `/notifications` |
| 카탈로그·폴더 | 12 | `/catalog` `/catalog/{id}/preview` `/folders` `/access-requests` |
| 데이터 모델 | 22 | `/models/*` `/models/graph` `/sql:parse-refs` |
| 파이프라인 | 23 | `/pipelines/*` `/exec-order` `/runs` `/runs/{id}/events`(SSE) |
| 품질 | 14 | `/quality/rules` `/quality/dashboard` `/quality/violations` |
| VCS·관리자 | 12 | `/vcs/*` `/admin/*` `/help/{page}` |
| 부팅·상태 | 3 | `/bootstrap` `/health` `/reparse` |

### 공통 규약

오류 응답은 `code · message · details · requestId` 네 필드로 고정한다.
**message 는 서버가 한국어 완성 문장으로** 내려주고 화면 토스트가 그대로 쓴다 —
클라이언트에서 문자열을 조합하면 같은 오류가 화면마다 다르게 보인다.

```json
{ "code": "SQL_MULTI_STATEMENT",
  "message": "SQL 문장이 2개입니다. 모델 하나는 SQL 하나여야 합니다.",
  "details": { "statements": 2, "cte": 0, "ddl": null } }
```

도메인 코드 9종: `SQL_MULTI_STATEMENT` `SQL_DDL_NOT_ALLOWED` `SQL_UNKNOWN_REF`
`SQL_NO_SELECT` `GRAPH_CYCLE` `GRAPH_DUPLICATE_EDGE` `GRAPH_SOURCE_INPUT`
`FOLDER_GROUP_MISMATCH` `MODEL_IN_USE`.

컨텍스트 헤더(`X-Org-Id` `X-Project-Id` `X-Env` `X-Request-Id`)를 받는다.
조직·프로젝트가 아직 단일이라 범위를 좁히는 데 쓰이지는 않지만, 지금부터 받아 두면
멀티 테넌트로 갈 때 화면을 고치지 않아도 된다. `X-Request-Id` 는 응답에 되돌려준다.

### 품질 규칙 = dbt 테스트

규칙을 메타DB에 따로 두지 않는다. 실제로 검사를 돌리는 것이 dbt 이므로,
따로 두면 «화면에는 있는데 실행되지 않는 규칙»이 생긴다. 규칙 추가는
`schema.yml` 의 `data_tests` 를 쓰는 일이고, 규칙 id 는 dbt 가 정한 테스트 이름이다.

화면에서 만들 수 있는 것은 5종 — 필수값(`not_null`) · 중복(`unique`) ·
허용값(`accepted_values`) · 참조 무결성(`relationships`) · 범위(`accepted_range`).
최신성은 source 설정이고 사용자 정의 SQL 은 `tests/` 폴더의 파일이라 yml 쓰기로
만들 수 없다 — 화면이 그 이유를 안내한다.

끄기(`active: false`)는 삭제가 아니라 `enabled: false` 다. 이때 dbt 는 그 테스트를
manifest 의 `disabled` 로 옮기므로, 로더가 그쪽도 읽어야 «잠시 꺼둔 규칙»이
화면에서 사라지지 않는다.

## 알아둘 것

**모델 저장은 `dbt parse` 까지가 한 번이다.** parse 가 실패하면 방금 쓴 파일을 되돌린다
— 되돌리지 않으면 프로젝트 전체가 파싱 불가가 되어 카탈로그도 못 읽는다.

**API 가 만든 모델은 `models/marts/_datamates__models.yml` 에 모인다.** 손으로 쓴
`_marts__models.yml` 은 건드리지 않는다. 이미 yml 에 등재된 모델을 고칠 때만 그
파일을 열고, 이때도 ruamel 라운드트립이라 주석이 보존된다.

**SQL 검증은 두 겹이다.** 저장 전 정규식 검사(문장 1개 · DDL 금지 · 출력 1개 ·
ref 존재)로 즉답하고, 정확한 의존관계는 저장 후 manifest 가 확정한다.

**seed 는 SOURCE 로 보이지만 실행 대상이다.** dbt 가 CSV 를 적재해야 하류가 최신이
된다. 실행에서 빠지는 것은 `source`(외부 테이블)뿐이다.

**실행 순서는 편집할 수 없다.** 모델의 `ref()` 관계에서 계산해 Airflow 태스크 의존성으로
옮긴다. 순서를 바꾸려면 모델 SQL 을 고쳐야 한다.

## 알려진 제약

### 파이프라인 태스크는 직렬로만 돈다

`daggen.MAX_ACTIVE_TASKS = 1`. Iceberg 카탈로그가 SQLite
(`apache/iceberg-rest-fixture`)라서, dbt 두 개가 동시에 테이블을 커밋하면 반드시
`SQLITE_BUSY` 로 깨진다.

측정값:

| 조건 | 결과 |
| --- | --- |
| 순차 3회 연속 | 오류 0건 |
| 병렬 2개 | 매번 `SQLITE_BUSY` 14건, 태스크 실패 |

`busy_timeout` 과 커넥션 풀 축소(compose 에 반영)로 완화되지만 없어지지는 않는다.
가끔 병렬이 성공하는데 타이밍 운이므로 근거로 삼으면 안 된다.

**푸는 방법**: 카탈로그 백엔드를 Postgres 로 바꾸고 `MAX_ACTIVE_TASKS` 를 올린다.
그때도 상한은 자원 쪽이다 — colima VM 이 6 CPU / 8GB 이고 태스크마다 Spark JVM 이
하나씩 뜨므로 2~3 정도가 현실적이다.

### 모델별 태스크는 Spark 기동 비용을 모델 수만큼 낸다

`method: session` 이라 dbt 호출마다 JVM 이 새로 뜬다(약 15초 고정).

| 방식 | 7노드 파이프라인 |
| --- | --- |
| 모델별 태스크 (`task_mode: per_model`, 기본) | 약 151초 |
| 파이프라인 통째 (`task_mode: single`) | 약 25초 |

`per_model` 이 기본인 이유는 Airflow 에서 모델별 상태·재시도·부분 재실행이 그대로
보이기 때문이다. 속도가 우선이면 파이프라인마다 `task_mode: "single"` 로 바꾼다
(모델별 상태는 두 경우 모두 `run_results.json` 에서 읽으므로 화면은 동일하다).
근본적으로 줄이려면 Spark Thrift Server 를 띄우고 `remote` 타깃을 쓰면 된다 —
프로필에 이미 정의돼 있다.

### 그 밖

- **행 수(`rows`)는 seed 에만 나온다.** dbt-spark 어댑터가 모델 머티리얼라이즈에
  `rows_affected` 를 채우지 않는다. 어댑터 한계라 API 쪽에서 메울 수 없다.
- **새 파이프라인의 첫 실행은 최대 15초 지연된다.** Airflow DAG 프로세서가 폴더를
  다시 훑어야 한다(`AIRFLOW__DAG_PROCESSOR__REFRESH_INTERVAL`). API 가 대기해 준다.
- **품질 규칙의 «위반 데이터 예시»는 store_failures 가 켜진 규칙만 볼 수 있다.**
  dbt 가 실패 행을 테이블로 남기지 않으면 조회할 것이 없다. 화면이 그 사실을 안내한다.
- **인증이 없다.** 역할은 메타스토어에 저장된 값 하나이고, 서버는 아직 토큰을 검사하지
  않는다. 설계서 3.2 의 역할별 인가를 실제로 걸려면 인증부터 붙여야 한다.

## 이 작업에서 함께 고친 스택 문제

`docker-compose.yml` / `docker/runtime/Dockerfile` 에 반영했다. 원인과 근거는 각
파일의 주석에 남겼다.

1. **ivy 캐시 볼륨이 빈 경로에 붙어 있었다** — Spark 4.0 의 Ivy 는 `~/.ivy2` 가 아니라
   `~/.ivy2.5.2` 를 쓴다. 태스크마다 Iceberg jar 210MB 를 다시 받고 있었고, 동시
   다운로드가 경합해 실패하기도 했다. 파이프라인 전체가 393초 → 151초가 됐다.
2. **Iceberg 카탈로그 DB 가 virtiofs 바인드 마운트 위에 있었다** — named volume
   (`iceberg-catalog`)으로 옮겼다. 기존 `catalog.db` 는 복사해 넣어 무손실이다.
3. **DAG 프로세서 주기가 300초(Airflow 3 기본값)였다** — 15초로 낮췄다.
