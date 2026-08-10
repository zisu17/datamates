/* ── b41 — ── b41 — ── v2.8 — 캔버스는 DAG task 로. 설명 문구 대신 실행 순서를 카드에 붙인다 ── (index.html 블록에서 기계적 추출, 동작 불변) */

/* ── v2.8 — 캔버스는 DAG task 로. 설명 문구 대신 실행 순서를 카드에 붙인다 ── */
let _seqCache = { sig: null, map: null };
function execSeq(pp) {
  const sig = gsig(pp);
  if (_seqCache.sig === sig) return _seqCache.map;
  const g = pgraph(pp), map = {};
  let i = 0;
  orderG(g).forEach(k => { const d = byId(nodeOf(g, k).id); if (d && d.kind !== 'source') map[k] = ++i; });
  _seqCache = { sig, map };
  return map;
}

pnodeEl = function (pp, n, runs, edit) {
  const d = byId(n.id), rn = runs ? (runs[n.key] || { st: 'wait' }) : null;
  const src = d.kind === 'source';
  const seq = execSeq(pp)[n.key];
  const e = el(`<div class="pn ${src ? 'src' : ''} ${S.pipeNodeK === n.key ? 'sel' : ''}" data-pk="${n.key}"
      title="${esc(d.name)}\n${esc(d.phys)}${src ? '\n참조 전용 · 실행하지 않음' : '\n실행 순서 ' + seq}"
      style="left:${n.x}px;top:${n.y}px">
    <div class="pn-t" style="background:${grpColor(d)}"></div>
    <div class="pn-b">
      <span class="pn-hd">
        <span class="pn-seq">${src ? 'S' : seq}</span>
        <span class="pn-n trunc">${esc(d.name)}</span></span>
      <span class="pn-p trunc">${esc(d.phys)}</span>
      <span class="pn-m">${layerTag(d.layer)}
        ${rn ? stBadge(rn.st) : (!src && d.mat !== '—' ? `<span class="tag" style="font-size:10px">${esc(matKo(d.mat))}</span>` : '')}
        ${rn && rn.dur && rn.dur !== '—' ? `<span class="t11 fnt">${esc(rn.dur)}</span>` : ''}</span></div>
    <span class="pport i"></span><span class="pport o" data-pport="${n.key}"></span>
    ${edit ? `<button class="pn-x" data-prm="${n.key}" title="캔버스에서 제거">${ic14('x')}</button>` : ''}</div>`);
  return e;
};

/* 캔버스 머리말에서 설명 문장을 뺀다 */
/* (pipeCanvas — 이후 정의가 값 캡처 없이 전면 교체. 죽은 층 제거) */
/* 순서는 카드에 있으므로 하단 순서 바는 없앤다 */
