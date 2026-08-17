/* ── b08 — ── b08 — 3. 데이터 모델링 → 데이터 파이프라인 ── (index.html 블록에서 기계적 추출, 동작 불변) */

/* ============================================================
   3. 데이터 모델링 → 데이터 파이프라인
   ============================================================ */
const RUNST = {
  wait: { label: '대기', icon: 'clock', tone: 'mute' },
  run:  { label: '실행 중', icon: 'clock', tone: 'info' },
  ok:   { label: '성공', icon: 'checkc', tone: 'ok' },
  err:  { label: '실패', icon: 'xc', tone: 'err' },
  skip: { label: '건너뜀', icon: 'x', tone: 'wait' },
};
function stBadge(st) { const s = RUNST[st] || RUNST.wait; return `<span class="bdg ${s.tone}">${ic14(s.icon)}${s.label}</span>`; }

/* 실행 순서 = 연결 관계 기준 위상 정렬 */
/* 파이프라인 노드별 실행 결과 생성 */
/* 캔버스 없이 만들어진 기본 파이프라인은 실행 대상으로 흐름을 만든다 */
/* ── 파이프라인 목록 (모델 수 추가) ── */
/* (pagePipeline + 별칭 _pagePipelineBase — 감싸던 원본이 뒤에서 전면 교체됐다. 죽은 층 제거) */
/* ── 파이프라인 상세 — 실행 흐름도 ── */
/* (pipeFlow — 이후 정의가 값 캡처 없이 전면 교체. 죽은 층 제거) */
