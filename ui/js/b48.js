/* ── b48 — ── b48 — 카탈로그 — 폴더 트리 · 이름만 표시 ── (index.html 블록에서 기계적 추출, 동작 불변) */

/* 카탈로그 — 폴더 트리 · 이름만 표시 */
function catRow(d, graph, opt) {
  const on = !!nodeAt(d.id), st = qStatusOf(d.id);
  const row = el(`<div class="lp in-f ${graph && on ? 'added' : ''} ${S.sel === d.id ? 'on' : ''}"
      draggable="true" title="${esc(d.name)}\n${esc(d.phys)}\n${esc(d.desc || '')}">
    <span class="swatch" style="background:${grpColor(d)}"></span>
    <span class="lp-n">${esc(d.name)}</span>
    ${st !== 'ok' ? `<span title="품질 ${st === 'err' ? '실패' : '주의'}" style="color:var(--${st === 'err' ? 'err' : 'warn'});display:flex;flex:none">${ic14(st === 'err' ? 'xc' : 'alert')}</span>` : ''}
    <button class="fdr-m" data-mv="${d.id}" title="폴더 이동">${ic14('dots')}</button>
    ${graph ? (on ? `<button class="lp-add" data-rm="${d.id}" title="관계도에서 제거">${ic14('minus')}</button>`
       : `<button class="lp-add" data-add="${d.id}" title="관계도에 추가">${ic14('plus')}</button>`) : ''}</div>`);
  row.onclick = (ev) => { if (ev.target.closest('[data-add],[data-rm],[data-mv]')) return;
    S.sel = d.id; if (graph && !nodeAt(d.id)) addNodeFromCatalog(d.id); render(); };
  row.addEventListener('dragstart', (ev) => { ev.dataTransfer.setData('text/plain', d.id);
    ev.dataTransfer.effectAllowed = 'copyMove'; row.classList.add('dragging'); });
  row.addEventListener('dragend', () => row.classList.remove('dragging'));
  $('[data-mv]', row).onclick = (ev) => { ev.stopPropagation(); moveModal(d.id); };
  return row;
}
function folderRow(f, count, host, graph) {
  const open = fdrOpen(f.id);
  const row = el(`<div class="fdr ${open ? 'open' : ''}" data-fdr="${f.id || ''}">
    <span class="fdr-c">${ic14('chev')}</span>
    <span class="fdr-i">${ic14(f.id ? 'folder' : 'doc')}</span>
    <span class="fdr-n">${esc(f.name)}</span>
    <span class="fdr-k">${count}</span>
    ${f.id ? `<button class="fdr-m" data-fm="${f.id}" title="이름 변경 · 삭제">${ic14('dots')}</button>` : ''}</div>`);
  row.onclick = (ev) => { if (ev.target.closest('[data-fm]')) return;
    S.fdrOpen[f.id] = !open; render(); };
  const mm = $('[data-fm]', row);
  if (mm) mm.onclick = (ev) => { ev.stopPropagation(); folderModal(f.id); };
  /* 모델을 끌어다 놓으면 이 폴더로 옮긴다 */
  row.addEventListener('dragover', (ev) => { ev.preventDefault(); ev.dataTransfer.dropEffect = 'move'; row.classList.add('over'); });
  row.addEventListener('dragleave', () => row.classList.remove('over'));
  row.addEventListener('drop', (ev) => {
    ev.preventDefault(); ev.stopPropagation(); row.classList.remove('over');
    const id = ev.dataTransfer.getData('text/plain'); const d = byId(id);
    if (!d) return;
    if (f.id && grpOf(d) !== f.grp) { toast(`${f.name} 은(는) ${f.grp} 폴더입니다.`, 'warn'); return; }
    d.folder = f.id || null; render();
    toast(f.id ? `${d.name} 을(를) ${f.name} 으로 옮겼습니다.` : `${d.name} 을(를) 폴더에서 꺼냈습니다.`);
  });
  return row;
}

modelList = function (r) {
  const graph = S.mView === 'graph';
  const left = el(`<aside class="mod-l ${S.leftOpen ? '' : 'closed'}" style="${S.leftOpen ? `width:${S.leftW}px` : ''}">
    <div class="mod-l-head">
      <span class="b6 t13">카탈로그</span>
      <span style="display:flex;align-items:center;gap:2px;margin-left:auto;flex:0 0 auto">
        <button class="iconbtn" id="mFdr" title="새 폴더 만들기">${ic14('folderp')}</button>
        <button class="iconbtn" id="mLTgl" title="${S.leftOpen ? '접기' : '펼치기'}">${ic14(S.leftOpen ? 'chevl' : 'chev')}</button></span></div>
    <div class="mod-l-body f1 col" style="min-height:0">
      <div style="padding:8px 10px"><div class="srch">${ic14('search')}
        <input class="inp sm" id="mQ" placeholder="이름으로 검색" style="padding-left:28px"></div></div>
      <div class="f1" style="overflow:auto;padding:0 6px 8px" id="mList"></div>
      <div style="padding:9px 11px;border-top:1px solid var(--line-2)">
        <div class="t11 fnt">SOURCE ${D.filter(d => d.kind === 'source').length} · DATA MODEL ${D.filter(d => d.kind !== 'source').length} · 폴더 ${FOLDERS.length}</div></div>
    </div>
    ${S.leftOpen ? '<div class="grip l" id="gripL" title="폭 조절"></div>' : ''}</aside>`);
  const ml = $('#mList', left);
  const paint = (q) => {
    ml.innerHTML = '';
    ['SOURCE', 'DATA MODEL'].forEach(g => {
      const all = D.filter(d => grpOf(d) === g && (!q || (d.name + d.phys + (d.desc || '')).toLowerCase().includes(q)));
      ml.appendChild(el(`<div class="grp-h"><i style="background:${KINDC[g]}"></i>${g}<span class="sp t11 fnt">${all.length}</span></div>`));
      foldersOf(g).forEach(f => {
        const items = inFolder(f.id, all);
        if (q && !items.length) return;
        ml.appendChild(folderRow(f, items.length, ml, graph));
        if (fdrOpen(f.id) || q) items.forEach(d => ml.appendChild(catRow(d, graph)));
      });
      const loose = inFolder(null, all);
      if (loose.length || (!q && foldersOf(g).length === 0)) {
        ml.appendChild(folderRow({ id: '', name: '폴더 없음', grp: g }, loose.length, ml, graph));
        if (fdrOpen('') || q) loose.forEach(d => ml.appendChild(catRow(d, graph)));
      }
      if (q && !all.length) ml.appendChild(el('<div class="t11 fnt" style="padding:6px 10px">일치하는 항목이 없습니다. 검색어를 줄여 보세요.</div>'));
      const add = el(`<button class="fdr-add" data-newf="${g}">${ic14('plus')}폴더 추가</button>`);
      add.onclick = () => folderModal(null, g);
      ml.appendChild(add);
    });
    $$('[data-add]', ml).forEach(b => b.onclick = (ev) => { ev.stopPropagation(); addNodeFromCatalog(b.dataset.add); render(); });
    $$('[data-rm]', ml).forEach(b => b.onclick = (ev) => { ev.stopPropagation(); removeNode(b.dataset.rm, false); });
  };
  paint('');
  const mq = $('#mQ', left); if (mq) mq.oninput = (e) => paint(e.target.value.trim().toLowerCase());
  $('#mLTgl', left).onclick = () => { S.leftOpen = !S.leftOpen; render(); };
  $('#mFdr', left).onclick = () => folderModal(null, 'DATA MODEL');
  return left;
};

/* 파이프라인 카탈로그도 같은 폴더 구조로 · 이름만 */
pipeCatalog = function (pp) {
  const left = el(`<aside class="mod-l ${S.pipeLeftOpen ? '' : 'closed'}" style="${S.pipeLeftOpen ? 'width:250px' : ''}">
    <div class="mod-l-head"><span class="b6 t13">카탈로그</span>
      <button class="iconbtn sp" id="pLTgl" title="${S.pipeLeftOpen ? '접기' : '펼치기'}">${ic14(S.pipeLeftOpen ? 'chevl' : 'chev')}</button></div>
    <div class="mod-l-body f1 col" style="min-height:0">
      <div style="padding:8px 10px"><div class="srch">${ic14('search')}
        <input class="inp sm" id="pQ" placeholder="이름으로 검색" style="padding-left:28px"></div></div>
      <div class="f1" style="overflow:auto;padding:0 6px 8px" id="pcList"></div>
      <div style="padding:9px 11px;border-top:1px solid var(--line-2)">
        <div class="t11 fnt">카드를 끌어다 놓거나 + 를 누르세요. 같은 모델을 여러 번 놓을 수 있습니다.</div></div>
    </div></aside>`);
  const host = $('#pcList', left);
  const paint = (q) => {
    host.innerHTML = '';
    const g0 = pgraph(pp);
    const item = (d) => {
      const used = g0.nodes.filter(n => n.id === d.id).length;
      const row = el(`<div class="lp in-f" draggable="true" title="${esc(d.name)}\n${esc(d.phys)}">
        <span class="swatch" style="background:${grpColor(d)}"></span>
        <span class="lp-n">${esc(d.name)}</span>
        ${used ? `<span class="tag t11" style="flex:none" title="캔버스에 ${used}개">${used}</span>` : ''}
        <button class="lp-add" data-padd="${d.id}" title="캔버스에 놓기">${ic14('plus')}</button></div>`);
      row.addEventListener('dragstart', (ev) => { ev.dataTransfer.setData('text/plain', d.id);
        ev.dataTransfer.effectAllowed = 'copy'; row.classList.add('dragging'); });
      row.addEventListener('dragend', () => row.classList.remove('dragging'));
      return row;
    };
    ['SOURCE', 'DATA MODEL'].forEach(grp => {
      const all = D.filter(d => grpOf(d) === grp && (!q || (d.name + d.phys).toLowerCase().includes(q)));
      host.appendChild(el(`<div class="grp-h"><i style="background:${KINDC[grp]}"></i>${grp}<span class="sp t11 fnt">${all.length}</span></div>`));
      foldersOf(grp).forEach(f => {
        const items = inFolder(f.id, all);
        if (!items.length) return;
        const fr = el(`<div class="fdr ${fdrOpen(f.id) ? 'open' : ''}">
          <span class="fdr-c">${ic14('chev')}</span><span class="fdr-i">${ic14('folder')}</span>
          <span class="fdr-n">${esc(f.name)}</span><span class="fdr-k">${items.length}</span></div>`);
        fr.onclick = () => { S.fdrOpen[f.id] = !fdrOpen(f.id); render(); };
        host.appendChild(fr);
        if (fdrOpen(f.id) || q) items.forEach(d => host.appendChild(item(d)));
      });
      const loose = inFolder(null, all);
      if (loose.length) {
        const fr = el(`<div class="fdr ${fdrOpen('') ? 'open' : ''}">
          <span class="fdr-c">${ic14('chev')}</span><span class="fdr-i">${ic14('doc')}</span>
          <span class="fdr-n">폴더 없음</span><span class="fdr-k">${loose.length}</span></div>`);
        fr.onclick = () => { S.fdrOpen[''] = !fdrOpen(''); render(); };
        host.appendChild(fr);
        if (fdrOpen('') || q) loose.forEach(d => host.appendChild(item(d)));
      }
    });
    $$('[data-padd]', host).forEach(b => b.onclick = (ev) => { ev.stopPropagation(); addPNode(pp, b.dataset.padd); });
  };
  paint('');
  const q = $('#pQ', left); if (q) q.oninput = (e) => paint(e.target.value.trim().toLowerCase());
  $('#pLTgl', left).onclick = () => { S.pipeLeftOpen = !S.pipeLeftOpen; render(); };
  return left;
};

/* 새 모델은 폴더 없음에서 시작 */
const _addRuleFolderGuard = openNewModel;
openNewModel = function () { _addRuleFolderGuard(); D.forEach(d => { if (d.folder === undefined) d.folder = null; }); };

HELP.modeling.items[1] = '왼쪽 카탈로그 는 SOURCE 와 DATA MODEL 로 나뉘고, 그 안에서 폴더로 정리합니다.';
HELP.modeling.items.splice(2, 0, '폴더 추가 로 폴더를 만들고, 항목을 끌어다 놓거나 ⋯ 메뉴로 옮깁니다.');
