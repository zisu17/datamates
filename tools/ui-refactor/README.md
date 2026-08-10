# UI 평탄화 도구 — 덮어쓰기 사슬을 단일 정의로

`ui/js/` 는 원래 index.html 의 버전 블록들을 순서 그대로 파일로 뗀 것이다.
같은 이름이 여러 번 정의되면 **로드 순서상 마지막이 이긴다** (b00→b52→api.js).
이 도구들은 그 사슬을 안전하게 접기 위한 것이다. 전부 acorn(실파서) 기반이라
정규식 구간 실수(템플릿 리터럴·주석)가 없다.

## 도구

```bash
node tools/ui-refactor/inventory.js          # 다중 정의 이름 전체 목록 (남은 작업량)
node tools/ui-refactor/chain.js <이름>       # 그 이름의 모든 정의를 본문째 출력 (판독용)
node tools/ui-refactor/prefix.js [이름]      # «마지막 전면 교체» 앞의 죽은 접두 층 보고 (삭제 안 함)
node tools/ui-refactor/delDef.js <파일> <이름> <n번째>   # 정의 하나를 acorn 구간으로 정확히 삭제
node tools/ui-refactor/sweep.js              # «뒤에서 값 캡처 없이 전면 교체된» 죽은 층 자동 삭제
node tools/ui-refactor/marksweep.js          # 로드 시 실행되는 코드에서 도달 불가한 이름 자동 삭제
node tools/ui-refactor/loadorder.js          # 로드 순서 위반 검사 (지우고 나면 반드시 돌릴 것)
```

`prefix.js` 는 sweep 보다 멀리 본다 — sweep 은 바로 다음 정의 하나만 보므로
사이에 호출이 한 번이라도 있으면 판정을 포기하지만, prefix 는 사슬 전체를 보고
«호출은 실행 시점에 최종 정의로 풀리니 캡처가 아니다» 까지 구분한다. 판정 창에서
주석은 지운다 — 앞선 정리가 남긴 자취가 값 캡처로 잘못 잡히기 때문.
자동 삭제는 하지 않으니 목록을 보고 delDef 로 지운다.

sweep/marksweep 은 삭제 후 불변식을 검사하지만, 그래도 **돌린 뒤 반드시 브라우저
체크리스트를 통과시키고 커밋**할 것. NODE_PATH 는 이 디렉터리의 node_modules 를 쓴다:

```bash
NODE_PATH=tools/ui-refactor/node_modules node tools/ui-refactor/inventory.js
```

## 사슬 하나를 접는 절차 (검증된 루프)

1. `chain.js <이름>` 으로 전 층을 읽는다. 래퍼의 실행 순서는 **바깥(나중 정의)부터**다.
2. 층별로 판정한다 — 자주 나오는 무효 패턴:
   - 뒤 층이 같은 요소를 매번 덮어씀 (예: onclick 재배정)
   - 조건이 영원히 거짓 (예: 강제된 S.mView 때문에)
   - 대상 요소를 앞 층이 더 이상 만들지 않음
3. 살아있는 동작을 실행 순서대로 한 함수에 접는다. **이유 주석은 해당 자리로 옮겨 보존.**
4. 별칭 캡처(`const _xV52 = x;`)와 래퍼 문을 지운다. 큰 본문은 `delDef.js` 로.
5. api.js 는 strict — 새 정의는 배정이 아니라 **선언(function)** 으로 (선언이 없으면
   ReferenceError 로 파일 전체가 죽는다. 실제로 한 번 밟은 함정).
6. `node --check` → 브라우저에서 `checklist.js` 본문 실행 → `baseline.json` 과 비교 → 커밋.

## 함정 기록 (전부 실제로 밟음)

- `\b`(정규식 word boundary)는 `$`/`$$` 에 안 걸린다 — 식별자 경계는 `[\w$]` 기준으로.
- 함수 선언은 호이스팅되어 **선언보다 앞의 코드**도 옛 값을 캡처할 수 있다.
- 손으로 만든 구간 스캐너는 반드시 어딘가에서 폭주한다 — acorn 을 쓸 것.
- 브라우저 패널이 백그라운드면 `window.innerWidth === 0` — tiny 분기로 렌더된다.
  측정 전에 스크린샷 등으로 패널을 앞으로 가져올 것.
- **앞 정의를 지우면 로드 순서를 깬다.** 어떤 이름의 정의가 api.js 하나에만 남았는데
  앞 파일이 로드 중에 그걸 부르고 있으면 ReferenceError 로 그 파일 나머지가 통째로
  죽는다. 화면은 멀쩡해 보이고 콘솔에만 찍힌다 — 지운 뒤 `loadorder.js` 를 돌릴 것.
- **콘솔 확인은 새 탭에서.** 브라우저 도구가 돌려주는 콘솔 버퍼는 이전 로드 것까지
  들고 있어서, 고친 뒤에도 옛 에러가 그대로 보인다. 실제로 두 번 속았다.
- 로드 중 최상위 `render()`·`seedCanvas()` 같은 «자기 반영» 호출은 전부 헛일이다 —
  api.js 의 boot 가 실데이터로 다시 그리고 `S.nodes`/`S.edges` 도 비운다.
- **«도달 불가» 는 정적으로만 보면 놓친다.** 조건이 영원히 거짓인 층(예: 실행 흐름의
  SOURCE 선택, mpBody 의 기본 정보 탭)은 마크앤스윕에 안 걸린다. 의심되면 브라우저에서
  그 함수를 감싸 인자를 찍어 보는 게 가장 빠르다:
  `const o = mpBody; window.mpBody = (...a) => { log.push(S.mTab); return o(...a); };`

## 남은 사슬 (2026-08-10 기준 16개)

시작할 때 60개였고, 화면 코드끼리 겹쳐 있던 사슬은 대체로 정리했다.
`inventory.js` 로 현재 목록을 보면 남은 것은 두 갈래다.

- **접을 수 있는 것** — `pipeCfg`(b35·b38 + api 5층) · `sqlView` · `openNewModel` ·
  `buildModel` · `removeNode` · `addNodeFromCatalog`(b10 안에서 두 번 정의).
- **접지 않는 것** — `pgraph` · `taskGraph` · `execSeq` · `pnodeEl` · `pipeBody` ·
  `refreshRun` · `syncTargets` · `ruleModal` · `pipeDock` · `api`.
  «화면 함수 + api.js 의 서버 연결 층» 형태로, 이 저장소가 의도한 층이다
  (api.js 머리말: “화면 코드는 건드리지 않고 … 서버 호출로 갈아끼운다”).
  api.js 안에서 같은 이름이 여러 번 겹치는 것(pipeCfg 5층)은 접을 여지가 있다.
