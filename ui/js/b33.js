/* ── b33 — ── b33 — ── 5. 데이터 파이프라인 : SOURCE · DATA MODEL 을 놓고 연결한다 ── (index.html 블록에서 기계적 추출, 동작 불변) */

/* ── 5. 데이터 파이프라인 : SOURCE · DATA MODEL 을 놓고 연결한다 ── */
const PW = 212, PH = 84;
const PIPE_RULE = 'SOURCE와 DATA MODEL을 연결해 데이터 가공 흐름을 구성합니다.';
S.pipeView = ['build', 'flow', 'cfg'].includes(S.pipeView) ? S.pipeView : 'flow';
S.pipeNodeK = S.pipeNodeK || null;

const nodeOf = (g, k) => g.nodes.find(n => n.key === k);
function gsig(pp) { const g = pgraph(pp);
  return g.nodes.map(n => n.key + ':' + n.id).join(',') + '|' + g.edges.map(e => e.from + '>' + e.to).join(','); }
function pcfg2(pp) {
  if (!pp.cfg2) pp.cfg2 = { env: pp.env || 'prod', freq: pp.freq, onFail: 'stop', retry: 1, notify: true };
  return pp.cfg2;
}

/* 카드 · 연결선 그리기 (구성 / 실행 흐름 공용) */
/* (pnodeEl — 이후 정의가 값 캡처 없이 전면 교체. 죽은 층 제거) */
/* (drawPEdges — 이후 정의가 값 캡처 없이 전면 교체. 죽은 층 제거) */
function syncTargets(pp) {
  const g = pgraph(pp);
  const ord = orderG(g);
  pp.targets = [...new Set(ord.map(k => nodeOf(g, k).id).filter(id => byId(id) && byId(id).kind !== 'source'))];
  pp.canvas = null; pp.runs = null; pp.__flowKey = null;
}
/* (orderBar — 이후 정의가 값 캡처 없이 전면 교체. 죽은 층 제거) */
