# 브랜치 전략

`main` 하나를 항상 도는 상태로 두고, 작업은 짧게 갈라 나갔다 바로 되돌아온다.
혼자 쓰는 저장소이고 배포 파이프라인이 없으므로 릴리스 브랜치·develop 은 두지 않는다.
갈래는 두 종류다 — **feature** 와 **hotfix**.

```
main  ──●────────●──────────●────────●──────▶  항상 도는 상태
         \      /            \      /
          ●──●─┘              ●────┘
       feature/ui-계보-검색   hotfix/api-부팅-500
```

---

## main

**불변식: 언제 체크아웃해도 앱이 뜬다.** 이것만 지킨다.

`main` 에 올리기 전에 통과해야 하는 것은 손댄 층에 따라 다르다 (아래 «완료 기준»).
통과하지 못한 것은 브랜치에 남긴다. `main` 에 «잠깐 깨진 상태» 를 두지 않는다 —
혼자 쓰는 저장소에서 그걸 두면 다음 주의 자신이 원인을 찾느라 하루를 쓴다.

직접 커밋해도 되는 것은 다음뿐이다.

- 오타·주석·문서 한 줄
- `.gitignore` 항목 추가

그 밖에는 전부 브랜치를 딴다. 한 줄 수정이라도 되돌릴 단위가 생기는 편이 낫다.

---

## feature/

새 기능, 리팩토링, 구조 변경. **살아 있는 기간은 며칠**로 잡는다.

```bash
git switch main
git switch -c feature/ui-계보-컬럼-검색
# ... 작업 · 커밋 ...
git switch main
git merge --no-ff feature/ui-계보-컬럼-검색
git branch -d feature/ui-계보-컬럼-검색
```

### 이름

`feature/<범위>-<한국어 요약>`

범위는 손대는 층을 그대로 쓴다. 저장소 구조와 같은 말이라 따로 외울 것이 없다.

| 범위 | 대상 |
| --- | --- |
| `dbt` | `dbt/` — 모델 · seed · macro · 테스트 |
| `api` | `datamates/app/` — FastAPI |
| `ui` | `ui/` — 화면 |
| `dag` | `dags/` · `daggen` — Airflow 연동 |
| `infra` | `docker-compose.yml` · `docker/` · `env.sh` · `scripts/` |
| `docs` | `README.md` · `SETUP.md` · 이 문서 |

두 층에 걸치면 **주된 쪽 하나**만 쓴다. `feature/api-ui-...` 처럼 붙이지 않는다.
세 층 이상에 걸치면 브랜치가 너무 크다는 신호다 — 갈라라.

### `--no-ff` 로 병합하는 이유

이 저장소의 커밋은 하나하나가 «판정 근거 + 검증 결과» 를 담은 단위다
(UI 평탄화 커밋들 참고). fast-forward 로 흘려보내면 그 단위는 남지만
어디까지가 한 덩어리였는지가 사라진다. `--no-ff` 는 병합 커밋 하나로 그 경계를 남긴다.

예외 — 「고쳤다 되돌렸다」 를 반복해 중간 커밋이 의미 없는 브랜치는 squash 한다.

```bash
git merge --squash feature/…  &&  git commit
```

---

## hotfix/

**`main` 이 지금 깨져 있을 때만.** 앞으로 좋아질 일이 아니라, 이미 나쁜 일을 되돌린다.

feature 브랜치가 진행 중이어도 hotfix 가 먼저 들어간다. 그래서 이름을 가른다 —
급한 것을 급하지 않은 것과 같은 접두사에 두면 무엇을 먼저 봐야 하는지 목록에서 안 보인다.

```bash
git switch main
git switch -c hotfix/api-부팅-500
# ... 최소 수정 + 재현 절차 확인 ...
git switch main
git merge --no-ff hotfix/api-부팅-500
git branch -d hotfix/api-부팅-500
```

진행 중인 feature 브랜치가 있으면 병합 뒤 그쪽으로 옮겨 준다.

```bash
git switch feature/…
git rebase main          # 커밋이 아직 공유되지 않았으므로 rebase 가 안전하다
```

### hotfix 의 규칙 세 가지

1. **범위를 넓히지 않는다.** 옆에 보이는 다른 문제는 손대지 말고 기억만 해 둔다.
   («이왕 여는 김에» 가 hotfix 를 feature 로 만들고, 그러면 급한 게 급하지 않아진다.)
2. **재현을 먼저 고정한다.** 무엇을 눌렀을 때 어떻게 깨지는지 커밋 본문에 적는다.
   고친 뒤에 그 절차를 다시 밟아 확인한 결과도 함께 적는다.
3. **원인을 적는다.** 증상만 덮으면 같은 것이 다시 온다.
   부팅 때마다 콘솔 에러가 찍히던 것을 지운 커밋처럼, 왜 그 자리가 그랬는지를 남긴다.

---

## 완료 기준 — 손댄 층에 따라

병합 전에 이걸 통과하고, **통과했다는 사실을 커밋 본문에 적는다.**
적지 않으면 다음에 이 커밋을 의심할 때 다시 전부 돌려야 한다.

### `ui/` 를 만졌다

```bash
# 1) 문법
for f in ui/js/*.js; do node --check "$f" || echo "FAIL $f"; done
# 2) 사슬이 늘지 않았는지
NODE_PATH=tools/ui-refactor/node_modules node tools/ui-refactor/inventory.js | head -1
NODE_PATH=tools/ui-refactor/node_modules node tools/ui-refactor/loadorder.js
# 3) 브라우저에서 tools/ui-refactor/checklist.js 본문을 실행해 baseline.json 과 대조
# 4) 콘솔 에러 0  ← 반드시 새 탭에서. 콘솔 버퍼는 이전 로드 것까지 들고 있다
```

`baseline.json` 이 회귀 계약이다. 값이 달라졌으면 둘 중 하나다 —
회귀를 냈거나, 의도한 변화다. **의도한 변화면 baseline 을 갱신하고 커밋 본문에
무엇이 왜 달라졌는지 적는다.** 조용히 갱신하면 계약이 사라진다.

### `dbt/` 를 만졌다

```bash
source ./env.sh
dbt build                 # 기준: PASS=75 WARN=1 ERROR=0 / 76 노드
```

WARN 1 건은 의도된 것이다 (`dbt/README.md` 의 severity 설명 참고).
모델을 추가·삭제했으면 기준 숫자가 바뀐다 — 새 숫자를 커밋 본문에 적어 다음 기준으로 삼는다.

### `datamates/app/` 을 만졌다

```bash
./datamates/run.sh
curl -s localhost:8000/api/v1/health | python3 -m json.tool   # airflowOk: true
curl -s -o /dev/null -w '%{http_code}\n' localhost:8000/api/v1/bootstrap   # 200
```

### 경로·구조를 만졌다

`config.PROJECT_DIR` / `config.DBT_DIR` 의 경계를 건드렸다면 **쓰기 경로까지** 확인한다.
읽기만 확인하면 «화면은 뜨는데 저장이 엉뚱한 데로 간다» 를 놓친다.

```bash
curl -s -X PATCH localhost:8000/api/v1/models/<모델> \
  -H 'Content-Type: application/json' -d '{"description":"<원래 값>"}'
# touched 가 models/... 로 나오는지, 그 파일이 실제로 dbt/ 안에 써졌는지
git status --short dbt/
```

---

## 브랜치를 옮길 때 — 이 저장소만의 함정

**git 이 관리하지 않는 상태가 셋 있다.** 브랜치를 따라오지 않으므로, 옮긴 뒤에는
직전 브랜치의 상태가 남아 있다고 생각하고 봐야 한다.

| 상태 | 위치 | 옮긴 뒤 |
| --- | --- | --- |
| dbt manifest | `dbt/target/` (git 제외) | 다시 파싱해야 화면이 그 브랜치의 모델을 본다 — 서버 기동은 파싱하지 않는다 |
| 메타스토어 | `.datamates/datamates.db` (git 제외) | 파이프라인·수집 작업·변경 이력이 **브랜치와 무관하게 그대로 남는다** |
| 생성 DAG | `dags/datamates_*.py` (git 제외) | API 가 기동할 때 메타스토어를 보고 다시 쓴다 |

manifest 는 서버를 내리지 않고도 갱신할 수 있다. 이 용도의 엔드포인트가 있다
(«dbt 프로젝트를 밖에서 손댔을 때» 가 곧 브랜치를 옮긴 상황이다).

```bash
curl -s -X POST localhost:8000/api/v1/reparse | python3 -m json.tool
```

가장 헷갈리는 것은 메타스토어다. A 브랜치에서 만든 파이프라인이 B 브랜치에도 그대로
보이는데, B 에는 그 모델이 없으면 화면에 없는 모델을 가리키는 항목이 남는다.
모델을 추가·삭제하는 브랜치를 오래 들고 있을 거면 메타스토어를 갈라 둔다.

```bash
cp .datamates/datamates.db .datamates/datamates.db.main   # 옮기기 전에
```

그리고 **dbt 프로젝트의 파일 경로가 바뀐 브랜치로 옮긴 직후 한 번은**
컨테이너 dbt 가 «depends on a node named … which was not found» 로 죽는다.
부분 파싱 캐시가 옛 경로 기준인데 dbt 가 스스로 무효화하지 않는다. 한 번만 무시해 준다.

```bash
docker exec -w /opt/project/dbt airflow /opt/dbt-venv/bin/dbt parse --no-partial-parse
```

---

## 커밋 메시지

이미 쓰고 있는 형식을 그대로 유지한다.

```
<무엇을 했는지 한 줄 — 한국어, 수치가 있으면 넣는다>

<왜 그렇게 판정했는지. 무효·죽은 코드라면 그 근거.>
<의도적으로 바꾼 동작이 있으면 «의도한 변화» 로 따로 적는다.>

검증: <실제로 돌린 것과 그 결과>
```

- 제목에 접두사(`feat:` 등)를 붙이지 않는다. 범위는 브랜치 이름이 이미 말한다.
- **판정 근거를 적는다.** 「죽은 코드라 지웠다」가 아니라 「뒤 층이 값 캡처 없이 전면
  교체하므로 죽었다」처럼. 6개월 뒤에 그 판단을 다시 못 하면 지운 것을 되살릴 수도 없다.
- 검증 줄을 비우지 않는다. 안 돌렸으면 «안 돌렸다» 고 적는다.

---

## 지금 정리할 것

- **`refactor-ui`** — `main` 보다 21커밋 앞서 있고 전부 검증을 통과한 상태다.
  성격상 feature 브랜치이므로 `main` 에 병합하고 지운다.

  ```bash
  git switch main && git merge --no-ff refactor-ui && git branch -d refactor-ui
  ```

- **`claude/*`** — 백그라운드 작업이 워크트리로 만든 브랜치다. 사람이 딴 것이 아니므로
  작업이 끝나 병합했으면 지운다. 남아 있는 것을 실제 작업 브랜치로 착각하지 말 것.

- **리모트가 없다.** 지금은 이 맥의 디스크가 유일한 사본이다. 원격을 붙이면
  `main` 만 보호하고(force push 금지) feature·hotfix 는 자유롭게 지워도 된다.

- **태그가 없다.** hotfix 는 «`main` 이 깨졌을 때» 로 정의해 두었으므로 태그 없이도
  돈다. 설치형으로 남에게 주는 시점이 오면 그때 `v0.1` 부터 붙이고, hotfix 의 기준을
  «`main`» 에서 «직전 태그» 로 바꾼다.
