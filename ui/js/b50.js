


(function () {
  if (!FOLDERS.some(f => f.id === 'm_exam_agg')) {
    FOLDERS.push({ id: 'm_exam_agg', name: '집계', grp: 'DATA MODEL', parent: 'm_exam' });
    const agg = byId('agg_daily_examination'); if (agg) agg.folder = 'm_exam_agg';
  }
  const F = (id) => FOLDERS.find(f => f.id === id) || null;
  const kidsOf = (grp, parent) => FOLDERS.filter(f => f.grp === grp && (f.parent || null) === (parent || null));
  function subtree(fid) { const out = [fid]; for (let i = 0; i < out.length; i++)
    FOLDERS.forEach(f => { if ((f.parent || null) === out[i]) out.push(f.id); }); return out; }
  const rollup = (fid, all) => { const s = new Set(subtree(fid)); return all.filter(d => s.has(d.folder)).length; };
  const pathOf = (fid) => { const n = []; let f = F(fid); while (f) { n.unshift(f.name); f = f.parent ? F(f.parent) : null; } return n; };
  const openF = (id) => S.fdrOpen[id] !== false;
  const hit = (s, q) => { if (!q) return esc(s); const i = s.toLowerCase().indexOf(q);
    return i < 0 ? esc(s) : esc(s.slice(0, i)) + '<span class="ct-hit">' + esc(s.slice(i, i + q.length)) + '</span>' + esc(s.slice(i + q.length)); };

  window.CT = { F, kidsOf, subtree, rollup, pathOf, openF };

  /* 드롭 대상 공통 처리 — el 에 놓으면 fid 폴더로 옮긴다 */
  function dropZone(node, fid, grp) {
    node.addEventListener('dragover', (ev) => {
      const d = byId(window.__ctDrag || ''); if (!d) return;
      if (grp && grpOf(d) !== grp) { ev.dataTransfer.dropEffect = 'none'; return; }
      ev.preventDefault(); ev.stopPropagation();
      ev.dataTransfer.dropEffect = 'move'; node.classList.add('over');
    });
    node.addEventListener('dragleave', (ev) => { if (!node.contains(ev.relatedTarget)) node.classList.remove('over'); });
    node.addEventListener('drop', (ev) => {
      ev.preventDefault(); ev.stopPropagation(); node.classList.remove('over');
      const d = byId(ev.dataTransfer.getData('text/plain')); if (!d) return;
      if (grp && grpOf(d) !== grp) return;
      if ((d.folder || null) === (fid || null)) return;
      d.folder = fid || null; render();
      toast(fid ? '' + d.name + ' 을(를) ' + pathOf(fid).join(' / ') + ' 으로 옮겼습니다.'
                : '' + d.name + ' 을(를) 폴더에서 꺼냈습니다.');
    });
  }

  function startRename(row, f) {
    const nameEl = $('.ct-f-n', row); if (!nameEl) return;
    const inp = el('<input class="ct-ren" value="' + esc(f.name) + '">');
    nameEl.replaceWith(inp); inp.focus(); inp.select();
    let done = false;
    const fin = (save) => { if (done) return; done = true;
      const v = inp.value.trim();
      if (save && v && v !== f.name) { f.name = v; render(); toast('폴더 이름을 바꿨습니다.'); }
      else render(); };
    inp.onkeydown = (e) => { if (e.key === 'Enter') fin(true); else if (e.key === 'Escape') fin(false); e.stopPropagation(); };
    inp.onblur = () => fin(true);
    inp.onclick = (e) => e.stopPropagation();
  }

  /* 폴더 한 칸 (하위 폴더까지 재귀) */
  function folderNode(f, all, mkItem, host, editable) {
    const open = openF(f.id);
    const n = rollup(f.id, all);
    const row = el('<div class="ct-f ' + (open ? 'open' : '') + '" tabindex="0" role="treeitem"'
      + ' aria-expanded="' + open + '" title="' + esc(f.name) + ' · ' + n + '개">'
      + '<span class="ct-f-c">' + ic14('chev') + '</span>'
      + '<span class="ct-f-i">' + ic14('folder') + '</span>'
      + '<span class="ct-f-n">' + esc(f.name) + '</span>'
      + '<span class="ct-f-k">' + n + '</span>'
      + (editable ? '<button class="ct-f-m" title="이름 변경 · 하위 폴더 · 삭제">' + ic14('dots') + '</button>' : '') + '</div>');
    const toggle = () => { S.fdrOpen[f.id] = !open; render(); };
    row.onclick = (ev) => { if (ev.target.closest('button')) return; toggle(); };
    row.ondblclick = (ev) => { if (editable && !ev.target.closest('button')) { ev.preventDefault(); S.fdrOpen[f.id] = open; startRename(row, f); } };
    row.onkeydown = (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle(); }
      else if (ev.key === 'ArrowRight' && !open) { ev.preventDefault(); toggle(); }
      else if (ev.key === 'ArrowLeft' && open) { ev.preventDefault(); toggle(); }
      else if (ev.key === 'F2' && editable) { ev.preventDefault(); startRename(row, f); }
    };
    const mb = $('.ct-f-m', row);
    if (mb) mb.onclick = (ev) => { ev.stopPropagation(); fdrMenu(f, row); };
    dropZone(row, f.id, f.grp);
    host.appendChild(row);

    if (!open) return;
    const kids = el('<div class="ct-kids"></div>');
    dropZone(kids, f.id, f.grp);
    kidsOf(f.grp, f.id).forEach(sub => folderNode(sub, all, mkItem, kids, editable));
    const items = all.filter(d => d.folder === f.id);
    items.forEach(d => kids.appendChild(mkItem(d)));
    if (!kids.children.length) {
      const e0 = el('<div class="ct-empty">비어 있음 — 여기로 끌어다 놓으세요</div>');
      dropZone(e0, f.id, f.grp); kids.appendChild(e0);
    }
    host.appendChild(kids);
  }

  function fdrMenu(f, anchor) {
    const items = [
      ['pen', '이름 변경', () => startRename(anchor, f)],
      ['folderp', '하위 폴더 만들기', () => newFolder(f.grp, f.id)],
      ['sep'],
      ['x', '폴더 삭제', () => delFolder(f)],
    ];
    if (typeof ctxMenu === 'function') { ctxMenu(anchor, items); return; }
    /* 이 문서에 공용 메뉴가 없으면 작은 팝오버를 직접 띄운다 */
    $$('.ct-pop').forEach(x => x.remove());
    const r = anchor.getBoundingClientRect();
    const pop = el('<div class="ct-pop" style="position:fixed;z-index:90;left:' + Math.round(r.right - 168) + 'px;top:' + Math.round(r.bottom + 4)
      + 'px;width:168px;background:var(--surface);border:1px solid var(--line);border-radius:9px;'
      + 'box-shadow:0 10px 28px rgba(16,24,40,.16);padding:4px"></div>');
    items.forEach(it => {
      if (it[0] === 'sep') { pop.appendChild(el('<div style="height:1px;background:var(--line-2);margin:4px 6px"></div>')); return; }
      const b = el('<button class="row g8" style="width:100%;padding:7px 9px;border:0;background:none;cursor:pointer;'
        + 'border-radius:6px;font-size:var(--fs-sm);color:' + (it[0] === 'x' ? 'var(--err)' : 'var(--text)') + ';text-align:left">'
        + ic14(it[0] === 'x' ? 'trash' : it[0]) + '<span>' + it[1] + '</span></button>');
      b.onmouseenter = () => b.style.background = 'var(--surface-3)';
      b.onmouseleave = () => b.style.background = 'none';
      b.onclick = () => { pop.remove(); it[2](); };
      pop.appendChild(b);
    });
    document.body.appendChild(pop);
    setTimeout(() => document.addEventListener('mousedown', function off(e) {
      if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('mousedown', off); } }), 0);
  }

  function newFolder(grp, parent) {
    const h = '<div class="modal-h"><span class="modal-t">새 폴더</span>'
      + '<button class="iconbtn sp" data-close>' + ic('x') + '</button></div>'
      + '<div class="modal-b"><div class="frm">'
      + '<div class="fr"><span class="fr-l">폴더 이름</span>'
      + '<input class="inp" id="fdName" placeholder="예) 매출 · 고객 · 재고"></div>'
      + '<div class="fr"><span class="fr-l">만들 위치</span><select class="inp" id="fdWhere">'
      + ['SOURCE', 'DATA MODEL'].map(g => '<option value="' + g + '" ' + (g === grp && !parent ? 'selected' : '') + '>' + g + '</option>'
          + FOLDERS.filter(f => f.grp === g).map(f => {
              const p = pathOf(f.id);
              return '<option value="' + g + '|' + f.id + '" ' + (f.id === parent ? 'selected' : '') + '>'
                + g + ' / ' + esc(p.join(' / ')) + '</option>'; }).join('')).join('')
      + '</select><span class="fr-h">폴더 안에 폴더를 만들 수 있습니다.</span></div>'
      + '</div></div>'
      + '<div class="modal-f"><button class="btn sp" data-close>취소</button>'
      + '<button class="btn pri" id="fdOk">폴더 만들기</button></div>';
    const { m, close } = modal(h, { sm: true });
    const inp = $('#fdName', m); setTimeout(() => inp.focus(), 0);
    const ok = () => {
      const nm = inp.value.trim();
      if (!nm) { toast('폴더 이름을 입력해 주세요.', 'warn'); return; }
      const v = $('#fdWhere', m).value.split('|');
      const id = 'fd' + Date.now();
      FOLDERS.push({ id: id, name: nm, grp: v[0], parent: v[1] || null });
      S.fdrOpen[id] = true; if (v[1]) S.fdrOpen[v[1]] = true;
      close(); render(); toast('' + nm + ' 폴더를 만들었습니다.');
    };
    $('#fdOk', m).onclick = ok;
    inp.onkeydown = (e) => { if (e.key === 'Enter') ok(); };
  }

  function delFolder(f) {
    const ids = subtree(f.id);
    const n = D.filter(d => ids.includes(d.folder)).length;
    const subs = ids.length - 1;
    confirmBox({ title: '폴더 삭제', ok: '삭제', danger: true,
      body: '' + f.name + ' 폴더를 삭제하시겠습니까?\n\n'
        + (subs ? '하위 폴더 ' + subs + '개도 함께 사라집니다.\n' : '')
        + (n ? '안에 있는 ' + n + '개는 폴더 밖으로 나옵니다.\n' : '')
        + '데이터는 삭제되지 않습니다.' },
      () => {
        D.forEach(d => { if (ids.includes(d.folder)) d.folder = f.parent || null; });
        ids.forEach(id => { const i = FOLDERS.findIndex(x => x.id === id); if (i >= 0) FOLDERS.splice(i, 1); });
        render(); toast('폴더를 삭제했습니다.');
      });
  }

  /* 트리 그리기 — 검색 중이면 평면 결과 */
  function paintTree(host, q, mkItem, editable) {
    host.innerHTML = '';
    host.classList.add('ct');
    const match = (d) => !q || (d.name + ' ' + d.phys + ' ' + (d.desc || '')).toLowerCase().includes(q);

    if (q) {
      const res = D.filter(match);
      host.appendChild(el('<div class="ct-res">검색 결과 ' + res.length + '건</div>'));
      if (!res.length) { host.appendChild(el('<div class="ct-none">일치하는 항목이 없습니다. 검색어를 줄여 보세요.</div>')); return; }
      ['SOURCE', 'DATA MODEL'].forEach(g => {
        const list = res.filter(d => grpOf(d) === g);
        if (!list.length) return;
        host.appendChild(el('<div class="ct-grp"><i style="background:' + KINDC[g] + '"></i>'
          + '<span class="ct-grp-n">' + g + '</span><span class="ct-grp-k">' + list.length + '</span></div>'));
        list.forEach(d => {
          const row = mkItem(d, q);
          const p = d.folder ? pathOf(d.folder).join(' / ') : '폴더 없음';
          const add = row.querySelector('.lp-add, .ct-f-m');
          const tag = el('<span class="ct-path">' + esc(p) + '</span>');
          if (add) row.insertBefore(tag, add); else row.appendChild(tag);
          host.appendChild(row);
        });
      });
      return;
    }

    ['SOURCE', 'DATA MODEL'].forEach(g => {
      const all = D.filter(d => grpOf(d) === g);
      const gh = el('<div class="ct-grp"><i style="background:' + KINDC[g] + '"></i>'
        + '<span class="ct-grp-n">' + g + '</span><span class="ct-grp-k">' + all.length + '</span></div>');
      dropZone(gh, null, g);
      host.appendChild(gh);
      kidsOf(g, null).forEach(f => folderNode(f, all, mkItem, host, editable));
      all.filter(d => !d.folder).forEach(d => host.appendChild(mkItem(d)));
      if (editable) {
        const add = el('<button class="ct-new">' + ic14('plus') + '새 폴더</button>');
        add.onclick = () => newFolder(g, null);
        host.appendChild(add);
      }
    });
  }

  /* 항목 한 칸 — 모델링 화면 */
  function itemRow(d, q) {
    const graph = S.mView === 'graph';
    const on = !!nodeAt(d.id), st = qStatusOf(d.id);
    const row = el('<div class="lp ct-i ' + (graph && on ? 'added' : '') + ' ' + (S.sel === d.id ? 'on' : '') + '"'
      + ' draggable="true" title="' + esc(d.name) + '\n' + esc(d.phys) + (d.desc ? '\n' + esc(d.desc) : '') + '">'
      + '<span class="swatch" style="background:' + grpColor(d) + '"></span>'
      + '<span class="lp-n">' + hit(d.name, q) + '</span>'
      + (st !== 'ok' ? '<span title="품질 ' + (st === 'err' ? '실패' : '주의') + '" style="color:var(--'
          + (st === 'err' ? 'err' : 'warn') + ');display:flex;flex:none">' + ic14(st === 'err' ? 'xc' : 'alert') + '</span>' : '')
      + '<button class="ct-f-m" data-mv="' + d.id + '" title="폴더 이동">' + ic14('dots') + '</button>'
      + (graph ? (on ? '<button class="lp-add" data-rm="' + d.id + '" title="관계도에서 제거">' + ic14('minus') + '</button>'
                    : '<button class="lp-add" data-add="' + d.id + '" title="관계도에 추가">' + ic14('plus') + '</button>') : '') + '</div>');
    row.onclick = (ev) => { if (ev.target.closest('button')) return;
      S.sel = d.id; if (graph && !nodeAt(d.id)) addNodeFromCatalog(d.id); render(); };
    row.addEventListener('dragstart', (ev) => { window.__ctDrag = d.id;
      ev.dataTransfer.setData('text/plain', d.id); ev.dataTransfer.effectAllowed = 'copyMove'; row.classList.add('dragging'); });
    row.addEventListener('dragend', () => { window.__ctDrag = null; row.classList.remove('dragging'); });
    $('[data-mv]', row).onclick = (ev) => { ev.stopPropagation(); moveModal(d.id); };
    const a = $('[data-add]', row); if (a) a.onclick = (ev) => { ev.stopPropagation(); addNodeFromCatalog(d.id); render(); };
    const rm = $('[data-rm]', row); if (rm) rm.onclick = (ev) => { ev.stopPropagation(); removeNode(d.id, false); };
    return row;
  }

  modelList = function () {
    const allOpen = FOLDERS.some(f => openF(f.id));
    const left = el('<aside class="mod-l ' + (S.leftOpen ? '' : 'closed') + '" style="' + (S.leftOpen ? 'width:' + S.leftW + 'px' : '') + '">'
      + '<div class="mod-l-head"><span class="b6 t13">카탈로그</span>'
      + '<span style="display:flex;align-items:center;gap:2px;margin-left:auto;flex:0 0 auto">'
      + '<button class="iconbtn" id="mFdr" title="새 폴더">' + ic14('folderp') + '</button>'
      + '<button class="iconbtn" id="mColl" title="' + (allOpen ? '폴더 모두 접기' : '폴더 모두 펼치기') + '">'
      + ic14(allOpen ? 'minus' : 'plus') + '</button>'
      + '<button class="iconbtn" id="mLTgl" title="' + (S.leftOpen ? '접기' : '펼치기') + '">' + ic14(S.leftOpen ? 'chevl' : 'chev') + '</button>'
      + '</span></div>'
      + '<div class="mod-l-body f1 col" style="min-height:0">'
      + '<div style="padding:8px 10px"><div class="srch">' + ic14('search')
      + '<input class="inp sm" id="mQ" placeholder="이름으로 검색" value="' + esc(S.ctQ || '') + '" style="padding-left:28px"></div></div>'
      + '<div class="f1" style="overflow:auto" id="mList"></div>'
      + '<div style="padding:9px 11px;border-top:1px solid var(--line-2)">'
      + '<div class="t11 fnt">SOURCE ' + D.filter(d => d.kind === 'source').length
      + ' · DATA MODEL ' + D.filter(d => d.kind !== 'source').length + ' · 폴더 ' + FOLDERS.length + '</div></div>'
      + '</div>' + (S.leftOpen ? '<div class="grip l" id="gripL" title="폭 조절"></div>' : '') + '</aside>');

    const ml = $('#mList', left);
    paintTree(ml, (S.ctQ || '').trim().toLowerCase(), itemRow, true);
    const mq = $('#mQ', left);
    if (mq) mq.oninput = (e) => { S.ctQ = e.target.value; paintTree(ml, S.ctQ.trim().toLowerCase(), itemRow, true); };
    $('#mLTgl', left).onclick = () => { S.leftOpen = !S.leftOpen; render(); };
    $('#mFdr', left).onclick = () => newFolder('DATA MODEL', null);
    $('#mColl', left).onclick = () => { FOLDERS.forEach(f => S.fdrOpen[f.id] = !allOpen); render(); };
    return left;
  };

  /* 파이프라인 카탈로그도 같은 트리를 쓴다 (폴더 편집은 하지 않는다) */
  pipeCatalog = function (pp) {
    const left = el('<aside class="mod-l ' + (S.pipeLeftOpen ? '' : 'closed') + '" style="' + (S.pipeLeftOpen ? 'width:250px' : '') + '">'
      + '<div class="mod-l-head"><span class="b6 t13">카탈로그</span>'
      + '<button class="iconbtn sp" id="pLTgl" title="' + (S.pipeLeftOpen ? '접기' : '펼치기') + '">' + ic14(S.pipeLeftOpen ? 'chevl' : 'chev') + '</button></div>'
      + '<div class="mod-l-body f1 col" style="min-height:0">'
      + '<div style="padding:8px 10px"><div class="srch">' + ic14('search')
      + '<input class="inp sm" id="pQ" placeholder="이름으로 검색" value="' + esc(S.ctPQ || '') + '" style="padding-left:28px"></div></div>'
      + '<div class="f1" style="overflow:auto" id="pcList"></div>'
      + '<div style="padding:9px 11px;border-top:1px solid var(--line-2)">'
      + '<div class="t11 fnt">카드를 끌어다 놓거나 + 를 누르세요. 같은 모델을 여러 번 놓을 수 있습니다.</div></div>'
      + '</div></aside>');
    const host = $('#pcList', left);
    const mk = (d, q) => {
      const used = pgraph(pp).nodes.filter(n => n.id === d.id).length;
      const row = el('<div class="lp ct-i" draggable="true" title="' + esc(d.name) + '\n' + esc(d.phys) + '">'
        + '<span class="swatch" style="background:' + grpColor(d) + '"></span>'
        + '<span class="lp-n">' + hit(d.name, q) + '</span>'
        + (used ? '<span class="tag t11" style="flex:none" title="캔버스에 ' + used + '개">' + used + '</span>' : '')
        + '<button class="lp-add" data-padd="' + d.id + '" title="캔버스에 놓기">' + ic14('plus') + '</button></div>');
      row.addEventListener('dragstart', (ev) => { ev.dataTransfer.setData('text/plain', d.id);
        ev.dataTransfer.effectAllowed = 'copy'; row.classList.add('dragging'); });
      row.addEventListener('dragend', () => row.classList.remove('dragging'));
      $('[data-padd]', row).onclick = (ev) => { ev.stopPropagation(); addPNode(pp, d.id); };
      return row;
    };
    paintTree(host, (S.ctPQ || '').trim().toLowerCase(), mk, false);
    const q = $('#pQ', left);
    if (q) q.oninput = (e) => { S.ctPQ = e.target.value; paintTree(host, S.ctPQ.trim().toLowerCase(), mk, false); };
    $('#pLTgl', left).onclick = () => { S.pipeLeftOpen = !S.pipeLeftOpen; render(); };
    return left;
  };

  /* 폴더 이동 모달 — 하위 폴더까지 경로로 보여준다 */
  moveModal = function (id) {
    const d = byId(id), grp = grpOf(d);
    const opts = FOLDERS.filter(f => f.grp === grp).map(f => {
      const p = pathOf(f.id);
      return '<option value="' + f.id + '" ' + (d.folder === f.id ? 'selected' : '') + '>'
        + '　'.repeat(p.length - 1) + esc(p[p.length - 1]) + '</option>'; }).join('');
    const h = '<div class="modal-h"><span class="modal-t">폴더 이동</span>'
      + '<button class="iconbtn sp" data-close>' + ic('x') + '</button></div>'
      + '<div class="modal-b"><div class="frm"><div class="fr"><span class="fr-l">' + esc(d.name) + '</span>'
      + '<select class="inp" id="mvF"><option value="">폴더 없음</option>' + opts + '</select>'
      + '<span class="fr-h">' + grp + ' 안의 폴더로만 옮길 수 있습니다.</span></div></div></div>'
      + '<div class="modal-f"><button class="btn sp" data-close>취소</button>'
      + '<button class="btn pri" id="mvOk">이동</button></div>';
    const { m, close } = modal(h, { sm: true });
    $('#mvOk', m).onclick = () => {
      d.folder = $('#mvF', m).value || null;
      if (d.folder) S.fdrOpen[d.folder] = true;
      close(); render();
      toast(d.folder ? '' + pathOf(d.folder).join(' / ') + ' 으로 옮겼습니다.' : '폴더에서 꺼냈습니다.');
    };
  };

  HELP.modeling.items[1] = '왼쪽 카탈로그 는 SOURCE 와 DATA MODEL 로 나뉘고, 그 안에서 폴더·하위 폴더로 정리합니다.';
  HELP.modeling.items[2] = '항목을 끌어다 폴더에 놓으면 옮겨집니다. 그룹 머리말에 놓으면 폴더 밖으로 나옵니다.';
})();
