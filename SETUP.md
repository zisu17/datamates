# 다른 맥에서 처음부터 구축하기

이 프로젝트를 새 맥에 그대로 올리는 절차. Apple Silicon / Intel 모두 동작하도록
경로는 전부 동적으로 잡히게 해두었다.

전체 구성은 [README.md](README.md) 를 보면 된다. 여기는 **설치 절차만** 다룬다.

---

## 0. 옮길 것과 옮기지 말 것

프로젝트 디렉터리를 복사하거나 git clone 한다. 아래는 **절대 옮기지 않는다** —
전부 현재 맥 전용이거나 재생성되는 것들이다 ([.gitignore](.gitignore) 에 이미 들어 있다).

```
.venv/            macOS 바이너리. 새 맥에서 다시 만든다
.iceberg-rest/    카탈로그 sqlite
.spark-warehouse/ 구 로컬 웨어하우스 (지금은 MinIO 를 쓴다)
.spark-events/    Spark 이벤트 로그
dbt/dbt_packages/ dbt deps 로 재생성
dbt/target/ logs/ 빌드 산출물
edr_target/       Elementary 리포트
.datamates/runs/  dbt 실행 산출물. 수백 MB 인데 다시 실행하면 쌓인다
```

옮겨야 하는 것은 dbt 프로젝트 전체인 `dbt/`(그 안의 `models/ seeds/ tests/ macros/
profiles/ dbt_project.yml packages.yml package-lock.yml`), 화면·API 인 `datamates/ ui/`,
그리고 `dags/ scripts/ docker/ requirements.txt env.sh docker-compose.yml`.

`.datamates/datamates.db` 는 **선택**이다. 파이프라인 정의·수집 작업·폴더 배치·변경 이력이
들어 있는 메타스토어라, 가져가면 그 화면들이 그대로 이어지고 안 가져가면 빈 화면에서
시작한다. `dags/datamates_*.py` 는 안 옮겨도 된다 — API 서버가 기동할 때 메타스토어를
보고 다시 만든다.

---

## 1. 전제 도구

```bash
brew install python@3.11 openjdk@17 colima docker docker-compose
```

| 도구 | 왜 |
| --- | --- |
| **python@3.11** | dbt-core 1.12 + pyspark 4.0 이 지원하는 버전. 3.12 도 되지만 검증한 건 3.11 |
| **openjdk@17** | Spark 4.0 은 Java **17/21 만** 지원. 23 이면 기동 실패 |
| **colima** | macOS 용 컨테이너 런타임 (Docker Desktop 대체) |
| **docker / docker-compose** | CLI. colima 가 데몬 역할 |

`openjdk@17` 은 `/Library/Java/JavaVirtualMachines` 에 심볼릭 링크를 만들지 않는다
(그건 sudo 가 필요하다). 그래서 `/usr/libexec/java_home` 에 안 잡히는데, `env.sh` 가
brew 경로를 직접 찾으므로 링크를 만들 필요 없다.

---

## 2. Python 환경

프로젝트 루트에서:

```bash
python3.11 -m venv .venv && .venv/bin/pip install --upgrade pip
```

```bash
.venv/bin/pip install -r requirements.txt -r datamates/requirements.txt
```

`requirements.txt` 는 dbt 실행에 필요한 상위 패키지만 고정해 둔다. 나머지는 pip 이 해결한다.

```
dbt-core==1.12.0
dbt-spark==1.11.0
elementary-data==0.25.1
pyspark==4.0.4
sqlglot==30.14.0        # 컬럼 계보를 SQL AST 로 뽑는다
```

`datamates/requirements.txt` 는 화면·API 쪽이다. `pyiceberg`/`pyarrow` 는 데이터 수집이
Spark 를 띄우지 않고 Iceberg 에 직접 쓰는 데 필요하고(호출마다 JVM 기동 15초를 안 낸다),
`python-multipart` 는 파일 올리기의 multipart 파싱에 필요하다 — 없으면 서버가
`RuntimeError: Form data requires "python-multipart"` 로 **기동 자체를 못 한다**.

> **pyspark 를 4.0.x 로 고정한 이유** — 최신은 4.2 지만 Iceberg 는 **Spark 4.0 용 런타임만**
> 배포한다. `iceberg-spark-runtime-4.1_2.13` / `4.2_2.13` 은 Maven Central 에 없다.
> 4.2 를 쓰면 Iceberg 를 못 붙인다.

`dbt-spark` 는 `[session]` extra 없이도 pyspark 를 위에서 따로 설치하므로 동작한다.

확인:

```bash
source ./env.sh
```

이렇게 나와야 한다.

```
dbt env ready  |  target=local  schema=analytics  java=openjdk.jdk
               |  spark=4.0.4  SPARK_HOME=.venv/lib/python3.11/site-packages/pyspark
```

`java=` 가 17 이 아니거나 `spark=` 가 4.0.x 가 아니면 3번 항목(함정)을 보라.

---

## 3. 컨테이너 런타임

```bash
colima start --cpu 6 --memory 8
```

측정 기준 전체 스택 피크가 **3.4 GB / 8 GiB (41%)** 이므로 8 GiB 로 충분하다.
BI 나 Airflow 병렬 실행을 추가하면 12 GiB 이상으로 올린다.

`docker compose` 플러그인이 없으면 standalone 바이너리를 쓴다. 이 문서의 명령은
전부 하이픈 형태(`docker-compose`)로 적었다.

```bash
docker compose version || which docker-compose
```

---

## 4. 스택 기동

**반드시 프로젝트 루트에서** 실행한다. `docker-compose.yml` 이 `${PWD}` 로 경로를 잡는다.

먼저 카탈로그 볼륨을 만든다. **이걸 빼면 다음 명령이 바로 실패한다.**

```bash
docker volume create iceberg-catalog
```

`iceberg-catalog` 만 `external: true` 다 — compose 가 알아서 만들지 않는다. 없는 상태로
올리면 `external volume "iceberg-catalog" not found` 로 스택이 통째로 안 뜬다.
이 볼륨이 named volume 인 이유는 Iceberg 카탈로그가 SQLite 이고, 호스트 디렉터리를
바인드하면 virtiofs 위에서 POSIX 파일 락이 제대로 안 걸려 `SQLITE_BUSY` 가 풀리지 않기 때문이다.

```bash
docker-compose up -d
```

MinIO, Iceberg REST, Airflow 세 개가 올라온다. Airflow 이미지는 첫 실행 때 빌드된다
(JDK 17 + dbt venv 설치로 몇 분 걸린다).

네임스페이스 부트스트랩:

```bash
./scripts/bootstrap_catalog.sh
```

> **왜 별도 스크립트인가** — elementary 패키지의 `on-run-start` 훅이 대상 스키마가
> 이미 있다고 가정하고 `listTables` 를 호출한다. 빈 웨어하우스에서는 dbt 가 모델 실행
> 전에 죽는다. 루트 프로젝트에 훅을 걸어도 안 되는데, **패키지 훅이 루트 훅보다 먼저**
> 실행되기 때문이다. 그래서 dbt 바깥에서 미리 만든다.

상태 확인:

```bash
docker ps --format '{{.Names}}\t{{.Status}}'
```

---

## 5. dbt 초기화

```bash
dbt deps
```

```bash
dbt run --select elementary
```

Elementary 의 결과 적재 테이블을 먼저 만든다. 이걸 건너뛰면 `on-run-end` 훅이 쓸 대상이
없어서 실패한다. **최초 1회만** 필요하다.

```bash
dbt build --full-refresh
```

기대 결과:

```
Done. PASS=75 WARN=1 ERROR=0 SKIP=0 TOTAL=76
```

`WARN=1` 은 의도한 것이다 — 익명 이벤트의 `user_id` null 을 error 가 아닌 warn 으로 두었다.

---

## 6. Data Mates 화면 기동

여기까지는 dbt 와 Airflow 다. 콘솔은 별도 프로세스로 띄운다.

```bash
./datamates/run.sh
```

http://localhost:8000 이 화면, `/docs` 가 API 다. `run.sh` 가 `env.sh` 를 먼저 읽는다 —
이 서버가 `dbt parse` 를 서브프로세스로 부르기 때문에 `DBT_PROFILES_DIR` / `JAVA_HOME` /
`SPARK_HOME` 이 필요하다.

기동할 때 서버가 두 가지를 스스로 맞춘다. 손으로 할 일은 없다.

- **`iceberg_write` 풀 생성** (슬롯 1). Iceberg 카탈로그가 SQLite 라 동시 커밋이 반드시
  깨지는데, 수집과 파이프라인은 **서로 다른 DAG** 이라 `max_active_tasks` 로는 못 막는다.
  DAG 을 가로질러 직렬화하는 수단은 풀뿐이다.
- **DAG 파일 재생성**. 메타스토어의 파이프라인·수집 작업을 보고 `dags/datamates_*.py` 를
  다시 쓴다. 그래서 `.datamates/datamates.db` 만 가져오면 DAG 은 따라온다.

Airflow 가 아직 안 떠 있으면 풀 생성만 건너뛰고 기동은 계속한다. 그 상태로 파이프라인을
돌리면 태스크가 큐에서 안 나오니, Airflow 를 올린 뒤 서버를 한 번 다시 띄운다.

---

## 7. 확인

**데이터가 MinIO 에 들어갔는지**

```bash
docker run --rm --network dbt_default --entrypoint sh minio/mc:latest -c "mc alias set L http://minio:9000 minioadmin minioadmin >/dev/null && mc du L/warehouse"
```

**Airflow**

```bash
open http://localhost:8080
```

```bash
docker exec airflow cat /opt/airflow/simple_auth_manager_passwords.json.generated
```

배관 확인용 DAG `dbt_smoke` 를 UI 에서 돌려보거나:

```bash
docker exec airflow airflow dags test dbt_smoke
```

**컨테이너와 호스트가 같은 웨어하우스를 보는지** — 가장 중요한 검증이다.

```bash
docker exec -w /opt/project/dbt airflow /opt/dbt-venv/bin/dbt build
```

> **dbt 프로젝트를 옮긴 직후 한 번은** 컨테이너가 «depends on a node named ... which was
> not found» 로 죽는다. 컨테이너의 `DBT_TARGET_PATH`(/opt/airflow/dbt/target) 에 남은
> 부분 파싱 캐시(partial_parse.msgpack)가 옛 경로 기준이고, dbt 가 이걸 스스로
> 무효화하지 않기 때문이다. 한 번만 캐시를 무시해 주면 다시 써지고 이후로는 정상이다.
>
> ```bash
> docker exec -w /opt/project/dbt airflow /opt/dbt-venv/bin/dbt parse --no-partial-parse
> ```

그다음 호스트에서 같은 결과가 나오면 성공이다.

```bash
dbt show --inline "select count(*) as rows from {{ ref('fct_events') }}"
```

**MinIO 콘솔** — http://localhost:9001 (minioadmin / minioadmin)

---

## 이미 쌓인 데이터까지 옮기려면

위 절차는 **빈 웨어하우스에서 시작**한다. `dbt build` 가 seed 로 테이블을 다시 만들기
때문에 대개 그걸로 충분하다. 원래 맥의 데이터를 그대로 가져가려면 볼륨 두 개를 함께
옮긴다 — **반드시 둘 다** 다. 카탈로그는 테이블이 어디 있는지를 가리키는 포인터라,
한쪽만 옮기면 없는 파일을 가리키게 된다.

| 볼륨 | 무엇 | 크기(예) |
| --- | --- | --- |
| `dbt_minio-data` | Iceberg 데이터 파일 본체 | 113M |
| `iceberg-catalog` | 네임스페이스·테이블 포인터 (SQLite) | 36K |
| `dbt_airflow-home` | 실행 이력·Airflow 비밀번호 (선택) | 37M |

내보내기 — 원래 맥에서, **스택을 내린 뒤에** 한다. 켜 둔 채로 뜨면 쓰다 만 SQLite 를 뜬다.

```bash
docker-compose down
```

```bash
for v in dbt_minio-data iceberg-catalog; do docker run --rm -v $v:/src:ro -v "$HOME/dm-backup:/out" alpine tar czf /out/$v.tgz -C /src .; done
```

> 내보낼 위치는 **홈 디렉터리 아래**여야 한다. colima 는 `/Users/<사용자>` 만 VM 에
> 물려주므로 `/tmp` 같은 경로를 주면 tar 가 VM 안에만 쓰고 끝나 — 오류 없이
> 호스트에 파일이 안 생긴다.

가져오기 — 새 맥에서, `docker-compose up` **전에** 한다.

```bash
docker volume create iceberg-catalog && docker volume create dbt_minio-data
```

```bash
for v in dbt_minio-data iceberg-catalog; do docker run --rm -v $v:/dst -v "$HOME/dm-backup:/src:ro" alpine tar xzf /src/$v.tgz -C /dst; done
```

이 경로로 가면 5번(dbt 초기화)의 `dbt build --full-refresh` 는 건너뛰어도 된다.
`dbt deps` 만 하면 된다 — `dbt_packages/` 는 어차피 안 옮긴다.

---

## 함정

여기서 막히는 경우가 대부분이다.

### 1. `~/.zshrc` 의 SPARK_HOME 충돌

다른 Spark 배포판을 쓰는 맥이면 `~/.zshrc` 에 `SPARK_HOME` 이 있을 수 있다. PySpark 는
그걸 우선하므로 **Python 쪽 4.0.4 + JVM 쪽 다른 버전** 조합이 되어 이렇게 죽는다.

```
py4j.Py4JException: Method sql([String, Object[]]) does not exist
```

`env.sh` 가 `SPARK_HOME` 을 venv 의 pyspark 로 덮고 `HADOOP_CONF_DIR` 을 떼어내므로,
**항상 `source ./env.sh` 를 먼저** 하면 된다. `~/.zshrc` 는 건드리지 않으니 다른
프로젝트에는 영향이 없다.

### 2. Java 버전

Spark 4.0 은 Java 17/21 만 지원한다. 기본 `java` 가 23 이어도 `env.sh` 가 17 을 찾아
바꿔준다. 못 찾으면 경고가 뜨니 `brew install openjdk@17` 을 하면 된다.

### 3. 컨테이너 안에서 `source env.sh` 금지

`env.sh` 는 호스트용이다. 컨테이너에서 실행하면 `SPARK_HOME` 을 macOS 경로로 덮어
Spark 가 안 뜬다. 컨테이너 환경변수는 `docker-compose.yml` 이 이미 주입한다.
DAG 에서는 `/opt/dbt-venv/bin/dbt` 를 절대경로로 부른다.

### 4. 이미지 pull 실패 (사내망/VPN)

colima VM 안에서 DNS 가 안 풀리면 이렇게 실패한다.

```
dial tcp: lookup registry-1.docker.io on 192.168.5.1:53: i/o timeout
```

호스트 리졸버를 찾아 물려준다.

```bash
scutil --dns | grep -m4 'nameserver\[' | awk '{print $3}' | sort -u
```

```bash
colima stop && colima start --dns <위에서 나온 주소>
```

이 설정은 lima 인스턴스 설정에 저장되므로 이후 `colima start` 만으로 유지된다.
**네트워크를 옮기면 그 리졸버에 못 닿을 수 있으니** 그때 다시 잡아야 한다.

### 5. 마운트된 디렉터리를 `rm -rf` 하지 말 것

colima 는 호스트 디렉터리를 통째로 지우고 다시 만들면 파일 공유가 깨져
`SQLITE_CANTOPEN` 같은 에러가 난다. 초기화할 때는 **내용만** 지운다.

```bash
docker-compose down && find .iceberg-rest -mindepth 1 -delete
```

### 6. `docker compose` vs `docker-compose`

colima 환경에서 `docker compose` 플러그인이 안 잡히는 경우가 있다. 그때는
standalone `docker-compose` 를 쓴다. 기능은 같다.

---

## 정리 (전체 순서)

```bash
brew install python@3.11 openjdk@17 colima docker docker-compose
```

```bash
python3.11 -m venv .venv && .venv/bin/pip install --upgrade pip && .venv/bin/pip install -r requirements.txt -r datamates/requirements.txt
```

```bash
colima start --cpu 6 --memory 8
```

```bash
docker volume create iceberg-catalog
```

```bash
docker-compose up -d && ./scripts/bootstrap_catalog.sh
```

```bash
source ./env.sh && dbt deps && dbt run --select elementary && dbt build --full-refresh
```

```bash
./datamates/run.sh
```

## 종료

```bash
docker-compose down
```

```bash
colima stop
```

데이터는 named volume(`minio-data`, `airflow-home`, `ivy-cache`, `spark-events`)에 남으므로
다시 올리면 그대로 이어진다. 완전히 지우려면 `docker-compose down -v` 를 쓴다.
