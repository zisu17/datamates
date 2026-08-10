/* ── b32 — ── b32 — ── 4. 관계 화면 : 참조 관계 · 계보 · 영향 범위 ── (index.html 블록에서 기계적 추출, 동작 불변) */

/* ── 4. 관계 화면 : 참조 관계 · 계보 · 영향 범위 ── */
function lineage(id) {
  const up = new Set(), down = new Set();
  const walk = (x, dir, set) => S.edges.forEach(e => {
    const a = dir === 'up' ? e.to : e.from, b = dir === 'up' ? e.from : e.to;
    if (a === x && !set.has(b)) { set.add(b); walk(b, dir, set); }
  });
  walk(id, 'up', up); walk(id, 'down', down);
  up.delete(id); down.delete(id);
  return { up, down };
}
/* 참조 관계를 따라 왼쪽 → 오른쪽으로 배치 */
/* 선택한 모델을 기준으로 계보(상류) · 영향 범위(하류) 를 칠한다 */
/* 관계 화면의 하단은 모델 정보 부터 */
/* 관계 화면에서 상자를 고르면 하단이 모델 정보로 */
