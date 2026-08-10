/* ── b42 — ── b42 — 동시에 실행 가능한 노드는 캔버스 왼쪽 → 위쪽 순으로 번호를 매긴다 ── (index.html 블록에서 기계적 추출, 동작 불변) */

/* 동시에 실행 가능한 노드는 캔버스 왼쪽 → 위쪽 순으로 번호를 매긴다 */
orderG = function (g) {
  const inc = {}; g.nodes.forEach(n => inc[n.key] = 0);
  g.edges.forEach(e => { if (inc[e.to] != null) inc[e.to]++; });
  const pos = {}; g.nodes.forEach(n => pos[n.key] = n);
  const cmp = (a, b) => (pos[a].x - pos[b].x) || (pos[a].y - pos[b].y);
  const q = g.nodes.filter(n => !inc[n.key]).map(n => n.key).sort(cmp), out = [];
  while (q.length) {
    const k = q.shift(); out.push(k);
    g.edges.filter(e => e.from === k).forEach(e => { if (--inc[e.to] === 0) q.push(e.to); });
    q.sort(cmp);
  }
  g.nodes.forEach(n => { if (!out.includes(n.key)) out.push(n.key); });
  return out;
};
