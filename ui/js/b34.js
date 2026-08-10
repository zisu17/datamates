/* ── b34 — ── b34 — 캔버스 (구성 = 편집, 흐름 = 읽기 전용) ── (index.html 블록에서 기계적 추출, 동작 불변) */

/* 캔버스 (구성 = 편집, 흐름 = 읽기 전용) */
function addPNode(pp, id, x, y) {
  const g = pgraph(pp);
  g.seq = (g.seq || g.nodes.length) + 1;
  const key = 'pn' + g.seq;
  const same = g.nodes.filter(n => n.id === id).length;
  g.nodes.push({ key, id, x: Math.max(0, x != null ? x : 40 + (g.nodes.length % 5) * 60), y: Math.max(0, y != null ? y : 40 + g.nodes.length * 26) });
  S.pipeNodeK = key;
  syncTargets(pp); render();
  toast(same ? `${byId(id).name} 을(를) 하나 더 놓았습니다.` : `${byId(id).name} 을(를) 캔버스에 놓았습니다.`);
}
