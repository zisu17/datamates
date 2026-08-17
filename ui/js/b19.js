/* ── b19 — ── b19 — 좁은 화면에서 툴바가 접히면 감춰진 기능을 더보기로 넘긴다 ── (index.html 블록에서 기계적 추출, 동작 불변) */

/* 좁은 화면에서 툴바가 접히면 감춰진 기능을 더보기로 넘긴다 */
moreMenu = function (anchor, canEdit) {
  $$('.menu').forEach(x => x.remove());
  const r = anchor.getBoundingClientRect(), graph = S.mView === 'graph';
  const d = S.sel && byId(S.sel), tiny = barBudget() < 400;
  const items = [];
  if (tiny) {
    items.push(['plus', '새 모델', '', () => openNewModel(), !canEdit]);
    items.push(['sep']);
  }
  if (graph) {

    items.push(['eye', '화면에 맞추기', '', () => { const b = $('#linZFit'); if (b) b.click(); }, false]);
    items.push(['search', '배율 100%', '', () => { S.erdZoom = 1; render(); }, false]);
    items.push(['sep']);
    const owner = d && typeof PIPES !== 'undefined'
      && PIPES.find(pp => pp.__flow && (pp.__flow.order || []).includes(d.id));
    const delWhy = !d ? '모델을 선택해 주세요'
      : d.kind === 'source' ? '원천은 여기서 삭제하지 않습니다'
      : !isDeletable(d.id) ? '하류 모델이 있어 삭제할 수 없습니다'
      : owner ? `파이프라인 ${owner.name} 이(가) 실행 대상으로 쓰고 있습니다`
      : '모델 정의(.sql · yml)를 삭제합니다';
    items.push(['x', '데이터 모델 삭제', delWhy, () => confirmDeleteNode(S.sel),
      !canEdit || !d || d.kind === 'source' || !isDeletable(d.id) || !!owner]);
  } else {
    items.push(['flow', '전체 의존 관계 보기', '', () => { S.mView = 'graph'; render(); setTimeout(fitCanvasQuiet, 0); }, false]);
    items.push(['pipe', '파이프라인에서 사용', '', () => { if (d) usePipeline(d.id); else go('pipeline'); }, !d]);
    items.push(['sep']);
    items.push(['x', d && isDeletable(d.id) ? '데이터 모델 삭제' : '캔버스에서 제거', '', () => confirmDeleteNode(S.sel), !d]);
  }

  const m = el(`<div class="menu" style="top:${Math.round(r.bottom + 6)}px;left:${Math.round(Math.max(8, r.right - 224))}px;min-width:220px"></div>`);
  items.forEach(it => {
    if (it[0] === 'sep') { m.appendChild(el('<div class="menu-sep"></div>')); return; }
    const b = el(`<button ${it[4] ? 'disabled' : ''} title="${esc(it[2] || it[1])}">${ic14(it[0], 'fnt')}<span>${esc(it[1])}</span></button>`);
    if (!it[4]) b.onclick = () => { m.remove(); it[3](); };
    m.appendChild(b);
  });
  document.body.appendChild(m);
  setTimeout(() => { const c = (e) => { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('mousedown', c); } };
    document.addEventListener('mousedown', c); }, 0);
};
