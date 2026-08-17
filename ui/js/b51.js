/* ── b51 — ── b51 — v3.2 — 카탈로그 좌측을 논리 폴더 탐색기 로 ── (index.html 블록에서 기계적 추출, 동작 불변) */

/* ============================================================
   v3.2 — 카탈로그 좌측을 논리 폴더 탐색기 로
   · 폴더는 사용자가 분류·탐색하려고 만든 논리 폴더다.
     데이터베이스 스키마·테이블 경로·저장 위치와는 무관하며,
     폴더를 옮기거나 이름을 바꿔도 데이터와 모델은 그대로다.
   · 폴더별 표시/숨김을 개인 설정으로 저장한다 (브라우저 저장).
   ============================================================ */
(function () {
  const LSK = 'datamates.catalog.tree.v1';

  /* 폴더는 서버가 준다 — api.js 가 부팅 때 /bootstrap 의 folders 로 FOLDERS 를
     통째로 교체하고, 모델의 folder 값도 서버 값을 그대로 쓴다.
     예전에는 여기서 예시 트리를 넣고 모델마다 폴더를 붙였는데, 그러면
     ① 서버가 폴더를 주기 전 한 프레임 동안 없는 폴더가 보였다 사라지고
     ② `D.forEach(d => d.folder = SEED_A[d.id] || null)` 이 서버가 준 폴더까지
        null 로 덮어쓸 위험이 있었다. 지금은 손대지 않는다. */

  let HID = new Set(), FAV = new Set();
  S.fdrOpen = {}; S.grpOpen = { SOURCE: true, 'DATA MODEL': true, 'DATA MART': true };
  S.showHidden = false; S.tgSel = [];

  /* ── 개인 설정 저장 ── */
  function save() {
    try {
      localStorage.setItem(LSK, JSON.stringify({
        folders: FOLDERS, assign: D.reduce((o, d) => (o[d.id] = d.folder || null, o), {}),
        open: S.fdrOpen, gopen: S.grpOpen, hidden: [...HID], fav: [...FAV], showHidden: !!S.showHidden,
      }));
    } catch (e) {}
  }
  function load() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(LSK) || 'null'); } catch (e) {}
    if (!raw) return;
    if (Array.isArray(raw.folders)) { FOLDERS.splice(0, FOLDERS.length); raw.folders.forEach(f => FOLDERS.push(f)); }
    if (raw.assign) D.forEach(d => { if (raw.assign[d.id] !== undefined) d.folder = raw.assign[d.id]; });
    S.fdrOpen = raw.open || {};
    S.grpOpen = raw.gopen || S.grpOpen;
    HID = new Set(raw.hidden || []); FAV = new Set(raw.fav || []);
    S.showHidden = false;
  }
  load();
  S.showHidden = false;

  /* ── 도우미 ── */
  const F = (id) => FOLDERS.find(f => f.id === id) || null;
  const kidsOf = (grp, parent) => FOLDERS.filter(f => f.grp === grp && (f.parent || null) === (parent || null))
    .sort((a, b) => (FAV.has(b.id) - FAV.has(a.id)) || a.name.localeCompare(b.name, 'ko'));
  function subtree(fid) { const out = [fid]; for (let i = 0; i < out.length; i++)
    FOLDERS.forEach(f => { if ((f.parent || null) === out[i]) out.push(f.id); }); return out; }
  /* 항목이 실제로 놓이는 폴더.
     구분(SOURCE·DATA MODEL·DATA MART)은 상태에 따라 바뀐다 — 모델을 DATA MART 로
     지정하면 그 순간 영역이 옮겨진다. 그런데 폴더는 예전 영역(DATA MODEL)의
     것이라 그대로 두면 새 영역의 어느 폴더에도 속하지 않아 트리에서 사라진다.
     맞지 않는 폴더는 «미분류» 로 본다 — 배치는 지우지 않으므로 마트 지정을
     해제하면 원래 폴더로 돌아온다. */
  const folderOf = (d) => {
    if (!d.folder) return null;
    const f = F(d.folder);
    return f && f.grp === grpOf(d) ? d.folder : null;
  };
  const rollup = (fid) => { const s = new Set(subtree(fid)); return D.filter(d => s.has(folderOf(d))).length; };
  const pathOf = (fid) => { const n = []; let f = F(fid); while (f) { n.unshift(f.name); f = f.parent ? F(f.parent) : null; } return n; };
  const openF = (id) => S.fdrOpen[id] !== false;
  const isHidden = (fid) => { let f = F(fid); while (f) { if (HID.has(f.id)) return true; f = f.parent ? F(f.parent) : null; } return false; };
  const esc2 = (s) => esc(String(s == null ? '' : s));
  const hit = (s, q) => { if (!q) return esc2(s); const i = s.toLowerCase().indexOf(q);
    return i < 0 ? esc2(s) : esc2(s.slice(0, i)) + '<span class="tg-hit">' + esc2(s.slice(i, i + q.length)) + '</span>' + esc2(s.slice(i + q.length)); };
  const selKeys = () => S.tgSel || [];
  const selFolders = () => selKeys().filter(k => k[0] === 'f').map(k => k.slice(2));

  /* ── 팝업 메뉴 ── */
  function popMenu(x, y, items) {
    document.querySelectorAll('.tg-pop').forEach(p => p.remove());
    const pop = el('<div class="tg-pop"></div>');
    items.forEach(it => {
      if (it === '-') { pop.appendChild(el('<div class="sepp"></div>')); return; }
      const b = el('<button class="' + (it.danger ? 'dngr' : '') + '">' + ic14(it.icon || 'doc')
        + '<span>' + esc2(it.label) + '</span></button>');
      b.onclick = () => { pop.remove(); it.run(); };
      pop.appendChild(b);
    });
    pop.style.left = '-9999px'; document.body.appendChild(pop);
    const w = pop.offsetWidth, h = pop.offsetHeight;
    pop.style.left = Math.min(x, innerWidth - w - 8) + 'px';
    pop.style.top = Math.min(y, innerHeight - h - 8) + 'px';
    setTimeout(() => document.addEventListener('mousedown', function off(e) {
      if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('mousedown', off); } }), 0);
  }

  /* ── 폴더 만들기 · 이름 변경 · 이동 · 삭제 ── */
  function newFolder(grp, parent) {
    const h = '<div class="modal-h"><span class="modal-t">' + (parent ? '하위 폴더 만들기' : '새 폴더') + '</span>'
      + '<button class="iconbtn sp" data-close>' + ic('x') + '</button></div>'
      + '<div class="modal-b"><div class="frm">'
      + '<div class="fr"><span class="fr-l">폴더 이름</span><input class="inp" id="nfN"></div>'
      + '<span class="fr-h">최상위에 만들어집니다. 만든 뒤 끌어다 놓아 위치를 옮길 수 있습니다.</span>'
      + '</div></div><div class="modal-f"><button class="btn sp" data-close>취소</button>'
      + '<button class="btn pri" id="nfOk">폴더 만들기</button></div>';
    const { m, close } = modal(h, { sm: true });
    const inp = $('#nfN', m); setTimeout(() => inp.focus(), 0);
    const ok = () => {
      const nm = inp.value.trim();
      if (!nm) { toast('폴더 이름을 입력해 주세요.', 'warn'); return; }
      const id = 'fd' + Date.now();
      FOLDERS.push({ id: id, name: nm, grp: grp, parent: null });
      close(); save(); render(); toast('' + nm + ' 폴더를 만들었습니다.');
    };
    $('#nfOk', m).onclick = ok;
    inp.onkeydown = (e) => { if (e.key === 'Enter') ok(); };
  }
  function whereOpts(grp, sel, skip) {
    return GRPS.map(g => {
      let s = '<option value="' + g + '" ' + (g === grp && !sel ? 'selected' : '') + '>' + g + ' (최상위)</option>';
      FOLDERS.filter(f => f.grp === g && (!skip || !subtree(skip).includes(f.id))).forEach(f => {
        const p = pathOf(f.id);
        s += '<option value="' + g + '|' + f.id + '" ' + (f.id === sel ? 'selected' : '') + '>'
          + g + ' / ' + esc2(p.join(' / ')) + '</option>';
      });
      return s;
    }).join('');
  }
  function moveFolder(f) {
    const h = '<div class="modal-h"><span class="modal-t">폴더 이동</span>'
      + '<button class="iconbtn sp" data-close>' + ic('x') + '</button></div>'
      + '<div class="modal-b"><div class="frm"><div class="fr"><span class="fr-l">' + esc2(f.name) + '</span>'
      + '<select class="inp" id="mfP">' + whereOpts(f.grp, f.parent, f.id) + '</select>'
      + '<span class="fr-h">' + f.grp + ' 안에서만 옮길 수 있습니다.</span></div></div></div>'
      + '<div class="modal-f"><button class="btn sp" data-close>취소</button><button class="btn pri" id="mfOk">이동</button></div>';
    const { m, close } = modal(h, { sm: true });
    $('#mfOk', m).onclick = () => {
      const v = $('#mfP', m).value.split('|');
      if (v[0] !== f.grp) { toast('다른 영역으로는 옮길 수 없습니다.', 'warn'); return; }
      f.parent = v[1] || null; if (v[1]) S.fdrOpen[v[1]] = true;
      close(); save(); render(); toast('' + f.name + ' 을(를) 옮겼습니다.');
    };
  }
  function delFolder(f) {
    const ids = subtree(f.id);
    const n = D.filter(d => ids.includes(d.folder)).length;
    const subs = ids.length - 1;
    confirmBox({ title: '폴더 삭제', ok: '폴더만 삭제', danger: true,
      body: '' + f.name + ' 폴더를 삭제하시겠습니까?\n\n'
        + (subs ? '하위 폴더 ' + subs + '개도 함께 사라집니다.\n' : '')
        + (n ? '안에 있던 ' + n + '개 항목은 미분류 로 이동합니다.\n' : '')
        + '분류만 없어지고 원천 데이터·데이터 모델은 그대로 남습니다.' },
      () => {
        D.forEach(d => { if (ids.includes(d.folder)) d.folder = null; });
        ids.forEach(id => { const i = FOLDERS.findIndex(x => x.id === id); if (i >= 0) FOLDERS.splice(i, 1);
          HID.delete(id); FAV.delete(id); });
        save(); render(); toast('폴더를 삭제했습니다. 항목은 미분류 에 있습니다.');
      });
  }
  function moveItem(d) {
    const grp = grpOf(d);
    const opts = FOLDERS.filter(f => f.grp === grp).map(f => { const p = pathOf(f.id);
      return '<option value="' + f.id + '" ' + (folderOf(d) === f.id ? 'selected' : '') + '>'
        + '　'.repeat(p.length - 1) + esc2(p[p.length - 1]) + '</option>'; }).join('');
    const h = '<div class="modal-h"><span class="modal-t">폴더 이동</span>'
      + '<button class="iconbtn sp" data-close>' + ic('x') + '</button></div>'
      + '<div class="modal-b"><div class="frm"><div class="fr"><span class="fr-l">' + esc2(d.name) + '</span>'
      + '<select class="inp" id="miF"><option value="">미분류</option>' + opts + '</select>'
      + '<span class="fr-h">분류만 바뀝니다. 테이블 위치는 그대로입니다.</span></div></div></div>'
      + '<div class="modal-f"><button class="btn sp" data-close>취소</button><button class="btn pri" id="miOk">이동</button></div>';
    const { m, close } = modal(h, { sm: true });
    $('#miOk', m).onclick = () => {
      d.folder = $('#miF', m).value || null;
      if (d.folder) S.fdrOpen[d.folder] = true;
      close(); save(); render();
      toast(d.folder ? '' + pathOf(d.folder).join(' / ') + ' 으로 옮겼습니다.' : '미분류 로 옮겼습니다.');
    };
  }
  moveModal = (id) => moveItem(byId(id));

  function setHidden(ids, hide) {
    ids.forEach(id => hide ? HID.add(id) : HID.delete(id));
    save(); render();
    toast(hide ? '폴더 ' + ids.length + '개를 숨겼습니다. 상단 눈 아이콘으로 다시 볼 수 있습니다.'
               : '폴더 ' + ids.length + '개를 다시 표시합니다.');
  }

  /* ── 트리 행 목록 ── */
  function buildRows(q) {
    const rows = [];
    if (q) {
      const res = D.filter(d => (d.name + ' ' + d.phys + ' ' + (d.desc || '')).toLowerCase().includes(q))
        .filter(d => S.showHidden || !folderOf(d) || !isHidden(folderOf(d)));
      GRPS.forEach(g => {
        const list = res.filter(d => grpOf(d) === g);
        if (!list.length) return;
        rows.push({ k: 'g', id: g, depth: 0, count: list.length, flat: true });
        list.forEach(d => rows.push({ k: 'i', id: d.id, d: d, depth: 1, path: folderOf(d) ? pathOf(folderOf(d)).join(' / ') : '미분류' }));
      });
      return rows;
    }
    GRPS.forEach(g => {
      const all = D.filter(d => grpOf(d) === g);
      const gopen = S.grpOpen[g] !== false;
      rows.push({ k: 'g', id: g, depth: 0, count: all.length, open: gopen });
      if (!gopen) return;
      (function walk(parent, depth, under) {
        kidsOf(g, parent).forEach(f => {
          const own = HID.has(f.id), hid = own || under;
          if (hid && !S.showHidden) return;
          const open = openF(f.id);
          rows.push({ k: 'f', id: f.id, f: f, depth: depth, count: rollup(f.id), open: open, hidden: hid, own: own });
          if (!open) return;
          walk(f.id, depth + 1, hid);
          all.filter(d => folderOf(d) === f.id).forEach(d => rows.push({ k: 'i', id: d.id, d: d, depth: depth + 1, dim: hid }));
          if (!kidsOf(g, f.id).length && !all.some(d => folderOf(d) === f.id))
            rows.push({ k: 'e', id: 'e:' + f.id, f: f, depth: depth + 1, dim: hid });
        });
      })(null, 1, false);
      // 미분류를 가짜 폴더로 두지 않는다. 폴더에 담기지 않은 항목은 그룹(=루트) 바로 아래다.
      // 그룹 머리말이 이미 드롭 대상이라(dropInto(node, null, grp)) 끌어다 놓으면 루트로 빠진다.
      all.filter(d => !folderOf(d)).forEach(d => rows.push({ k: 'i', id: d.id, d: d, depth: 1 }));
    });
    return rows;
  }

  /* ── 드롭 처리 ── */
  function dropInto(node, target, grp) {   /* target: 폴더 id | null(미분류/최상위) */
    node.addEventListener('dragover', (ev) => {
      const drag = window.__tgDrag; if (!drag) return;
      if (drag.grp !== grp) { ev.dataTransfer.dropEffect = 'none'; return; }
      if (drag.kind === 'f' && target && subtree(drag.id).includes(target)) { ev.dataTransfer.dropEffect = 'none'; return; }
      ev.preventDefault(); ev.stopPropagation();
      ev.dataTransfer.dropEffect = 'move'; node.classList.add('over');
    });
    node.addEventListener('dragleave', () => node.classList.remove('over'));
    node.addEventListener('drop', (ev) => {
      ev.preventDefault(); ev.stopPropagation(); node.classList.remove('over');
      const drag = window.__tgDrag; if (!drag || drag.grp !== grp) return;
      if (drag.kind === 'f') {
        const f = F(drag.id); if (!f || (target && subtree(f.id).includes(target))) return;
        f.parent = target || null;
      } else {
        const d = byId(drag.id); if (!d) return;
        d.folder = target || null;
      }
      if (target) S.fdrOpen[target] = true;
      save(); render();
      toast(target ? '' + pathOf(target).join(' / ') + ' 으로 옮겼습니다.' : '미분류 로 옮겼습니다.');
    });
  }

  /* ── 트리 그리기 ── */
  function paintTree(host, q, opts) {
    host.innerHTML = ''; host.classList.add('tg');
    const rows = buildRows(q);
    if (!rows.length) { host.appendChild(el('<div class="tg-note">일치하는 항목이 없습니다. 검색어를 줄여 보세요.</div>')); return; }
    if (q) host.appendChild(el('<div class="tg-res">검색 결과 ' + rows.filter(r => r.k === 'i').length + '건 · 폴더 경로를 함께 표시합니다</div>'));

    const nodes = [];
    rows.forEach((r, idx) => {
      const pad = 6 + r.depth * 13;
      let node;

      if (r.k === 'g') {
        node = el('<div class="tg-r g ' + (r.open ? 'open' : '') + '" tabindex="0" style="padding-left:' + pad + 'px">'
          + '<span class="tg-c">' + (r.flat ? '' : ic14('chev')) + '</span>'
          + '<span class="tg-sw" style="background:' + KINDC[r.id] + '"></span>'
          + '<span class="tg-n">' + r.id + '</span><span class="tg-k">' + r.count + '</span>'
          + (opts.edit ? '<button class="tg-b" data-nf title="이 영역에 새 폴더">' + ic14('folderp') + '</button>' : '') + '</div>');
        if (!r.flat) node.onclick = (ev) => { if (ev.target.closest('button')) return;
          S.grpOpen[r.id] = !r.open; save(); render(); };
        const nf = $('[data-nf]', node);
        if (nf) nf.onclick = (ev) => { ev.stopPropagation(); newFolder(r.id, null); };
        if (opts.edit) dropInto(node, null, r.id);
        if (opts.edit) node.oncontextmenu = (ev) => { ev.preventDefault();
          popMenu(ev.clientX, ev.clientY, [{ icon: 'folderp', label: '새 폴더', run: () => newFolder(r.id, null) }]); };
      }

      else if (r.k === 'f') {
        const f = r.f, fav = FAV.has(f.id);
        node = el('<div class="tg-r f ' + (r.open ? 'open' : '') + ' ' + (r.hidden ? 'dim' : '') + ' '
          + (selKeys().includes('f:' + f.id) ? 'sel' : '') + '" tabindex="0" draggable="' + (opts.edit ? 'true' : 'false') + '"'
          + ' style="padding-left:' + pad + 'px" title="' + esc2(pathOf(f.id).join(' / ')) + ' · ' + r.count + '개">'
          + '<span class="tg-c">' + ic14('chev') + '</span>'
          + '<span class="tg-i">' + ic14(r.open ? 'folderopen' : 'folder') + '</span>'
          + '<span class="tg-n">' + esc2(f.name) + '</span>'
          + (fav ? '<span class="tg-fav" title="즐겨찾기">' + ic14('star') + '</span>' : '')
          + '<span class="tg-k">' + r.count + '</span>'
          + (opts.edit ? (r.hidden && !r.own ? '<span class="tg-b eye" style="display:grid;color:var(--faint)" title="상위 폴더가 숨겨져 함께 숨김">' + ic14('eyeoff') + '</span>'
              : '<button class="tg-b eye" data-eye title="' + (r.own ? '다시 표시' : '숨기기') + '">' + ic14(r.own ? 'eyeoff' : 'eye') + '</button>')
            + '<button class="tg-b" data-menu title="더보기">' + ic14('dots') + '</button>' : '') + '</div>');
        node.onclick = (ev) => {
          if (ev.target.closest('button')) return;
          if (ev.metaKey || ev.ctrlKey) { toggleSel('f:' + f.id); return; }
          if (ev.shiftKey) { rangeSel(idx); return; }
          S.tgSel = []; S.fdrOpen[f.id] = !r.open; save(); render();
        };
        node.ondblclick = (ev) => { if (!ev.target.closest('button') && opts.edit) { ev.preventDefault(); rename(node, f); } };
        if (opts.edit) {
          const eye = $('[data-eye]', node);
          if (eye) eye.onclick = (ev) => { ev.stopPropagation(); setHidden([f.id], !r.own); };
          $('[data-menu]', node).onclick = (ev) => { ev.stopPropagation();
            const b = node.getBoundingClientRect(); folderMenu(f, r, node, b.right - 8, b.bottom + 2); };
          node.oncontextmenu = (ev) => { ev.preventDefault(); folderMenu(f, r, node, ev.clientX, ev.clientY); };
          node.addEventListener('dragstart', (ev) => { window.__tgDrag = { kind: 'f', id: f.id, grp: f.grp };
            ev.dataTransfer.setData('text/plain', 'f:' + f.id); ev.dataTransfer.effectAllowed = 'move'; node.classList.add('dragging'); });
          node.addEventListener('dragend', () => { window.__tgDrag = null; node.classList.remove('dragging'); });
          dropInto(node, f.id, f.grp);
        }
      }

      else if (r.k === 'e') {
        node = el('<div class="tg-r e ' + (r.dim ? 'dim' : '') + '" style="padding-left:' + (pad + 17) + 'px"><span class="tg-e">비어 있음 — 여기로 끌어다 놓으세요</span></div>');
        if (opts.edit) dropInto(node, r.f.id, r.f.grp);
      }

      else {
        const d = r.d;
        node = opts.item(d, q, pad, r.path);
        if (r.dim) node.classList.add('dim');
        if (opts.edit) {
          node.addEventListener('dragstart', (ev) => { window.__tgDrag = { kind: 'i', id: d.id, grp: grpOf(d) };
            ev.dataTransfer.setData('text/plain', d.id); ev.dataTransfer.effectAllowed = 'copyMove'; node.classList.add('dragging'); });
          node.addEventListener('dragend', () => { window.__tgDrag = null; node.classList.remove('dragging'); });
          node.oncontextmenu = (ev) => { ev.preventDefault(); popMenu(ev.clientX, ev.clientY, [
            { icon: 'move', label: '폴더 이동', run: () => moveItem(d) },
            { icon: 'star', label: FAV.has(d.id) ? '즐겨찾기 해제' : '즐겨찾기', run: () => { FAV.has(d.id) ? FAV.delete(d.id) : FAV.add(d.id); save(); render(); } },
            '-',
            { icon: 'book', label: '카탈로그에서 보기', run: () => go('catalog', d.id) },
          ]); };
        }
      }
      nodes.push(node); host.appendChild(node);
    });

    function toggleSel(key) {
      const i = S.tgSel.indexOf(key);
      if (i >= 0) S.tgSel.splice(i, 1); else S.tgSel.push(key);
      render();
    }
    function rangeSel(to) {
      const first = rows.findIndex(x => x.k === 'f' && S.tgSel.includes('f:' + x.id));
      const a = first < 0 ? to : Math.min(first, to), b = Math.max(first < 0 ? to : first, to);
      S.tgSel = rows.slice(a, b + 1).filter(x => x.k === 'f').map(x => 'f:' + x.id);
      render();
    }
    function rename(node, f) {
      const n = $('.tg-n', node); if (!n) return;
      const inp = el('<input class="tg-ren" value="' + esc2(f.name) + '">');
      n.replaceWith(inp); inp.focus(); inp.select();
      let done = false;
      const fin = (ok) => { if (done) return; done = true;
        const v = inp.value.trim();
        if (ok && v && v !== f.name) { f.name = v; save(); render(); toast('폴더 이름을 바꿨습니다. 데이터에는 영향이 없습니다.'); }
        else render(); };
      inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') fin(true); else if (e.key === 'Escape') fin(false); };
      inp.onblur = () => fin(true);
      inp.onclick = (e) => e.stopPropagation();
    }
    function folderMenu(f, r, node, x, y) {
      const sel = selFolders();
      const many = sel.length > 1 && sel.includes(f.id);
      popMenu(x, y, [
        { icon: 'folderp', label: '하위 폴더 만들기', run: () => newFolder(f.grp, f.id) },
        { icon: 'plus', label: '같은 위치에 새 폴더', run: () => newFolder(f.grp, f.parent) },
        '-',
        { icon: 'pen', label: '이름 변경', run: () => rename(node, f) },
        { icon: 'move', label: '이동', run: () => moveFolder(f) },
        { icon: r.own ? 'eye' : 'eyeoff',
          label: many ? (r.own ? '선택한 폴더 ' + sel.length + '개 표시' : '선택한 폴더 ' + sel.length + '개 숨기기')
                      : (r.own ? '다시 표시' : (r.hidden ? '상위 폴더가 숨김 — 여기서 숨기기' : '숨기기')),
          run: () => setHidden(many ? sel : [f.id], !r.own) },
        { icon: 'star', label: FAV.has(f.id) ? '즐겨찾기 해제' : '즐겨찾기',
          run: () => { FAV.has(f.id) ? FAV.delete(f.id) : FAV.add(f.id); save(); render(); } },
        '-',
        { icon: 'trash', label: '폴더 삭제', danger: true, run: () => delFolder(f) },
      ]);
    }
  }

  /* ── 항목 행 (모델링 화면) ── */
  function itemRow(d, q, pad, path) {
    const st = qStatusOf(d.id);
    const fav = FAV.has(d.id);
    /* 데이터 맵에서 제외했는가. − 를 누르면 맵에서 빠지고 + 로 되돌린다.
       카탈로그에서는 계속 보인다 — 지우는 것이 아니라 맵에서만 가리는 것이다. */
    const off = linHidden(d.id);
    /* 「폴더 이동」 버튼(data-mv)은 없앴다. 행 자체가 draggable 이고 폴더가 드롭
       대상이라(dropInto) 끌어다 놓으면 그대로 옮겨진다 — 같은 일을 하는 버튼이
       행마다 붙어 이름·품질 배지가 들어갈 자리를 먹고 있었다.
       오른쪽 클릭 메뉴의 「폴더 이동」도 그대로 남아 있어 길이 둘이다. */
    const row = el('<div class="tg-r i ' + (S.sel === d.id ? 'on' : '') + (off ? ' off' : '')
      + '" tabindex="0" draggable="true"'
      + ' style="padding-left:' + (pad + 13) + 'px"'
      + ' title="' + esc2(d.name) + '\n' + esc2(d.phys) + (d.desc ? '\n' + esc2(d.desc) : '')
      + (off ? '\n\n데이터 맵에서 제외됨' : '') + '">'
      + '<span class="tg-i" style="color:' + grpColor(d) + '">' + ic14(d.kind === 'source' ? 'tbl' : 'cube') + '</span>'
      + '<span class="tg-n">' + hit(d.name, q) + '</span>'
      + (fav ? '<span class="tg-fav">' + ic14('star') + '</span>' : '')
      + (st !== 'ok' ? '<span style="color:var(--' + (st === 'err' ? 'err' : 'warn') + ');display:flex;flex:none" title="품질 '
          + (st === 'err' ? '실패' : '주의') + '">' + ic14(st === 'err' ? 'xc' : 'alert') + '</span>' : '')
      + (path ? '<span class="tg-path">' + esc2(path) + '</span>' : '')
      + (off ? '<button class="tg-b" data-mapon title="데이터 맵에 다시 넣기">' + ic14('plus') + '</button>'
             : '<button class="tg-b" data-mapoff title="데이터 맵에서 제외">' + ic14('minus') + '</button>')
      + '</div>');
    row.onclick = (ev) => { if (ev.target.closest('button')) return;
      /* 맵에서 빠진 모델을 고르면 볼 것이 없다 — 누르면 다시 넣고 고른다. */
      if (linHidden(d.id)) { linToggleHide(d.id); S.sel = d.id; render(); return; }
      S.sel = d.id; render(); };
    const mo = $('[data-mapoff]', row);
    if (mo) mo.onclick = (ev) => { ev.stopPropagation(); linToggleHide(d.id); };
    const mn = $('[data-mapon]', row);
    if (mn) mn.onclick = (ev) => { ev.stopPropagation(); linToggleHide(d.id); };
    return row;
  }

  /* ── 표시할 폴더 고르기 (N of M) ── */
  function visPop(anchor) {
    document.querySelectorAll('.tg-pop,.vis-pop').forEach(p => p.remove());
    const pop = el('<div class="vis-pop" style="position:fixed;z-index:90;width:256px;max-height:60vh;overflow:auto;'
      + 'background:var(--surface);border:1px solid var(--line);border-radius:var(--r-s);'
      + 'box-shadow:0 12px 32px rgba(17,21,31,.18);padding:4px 0"></div>');
    const rowCss = 'display:flex;align-items:center;gap:7px;width:100%;background:none;border:0;'
      + 'font:inherit;color:inherit;text-align:left;padding:5px 10px;cursor:pointer';

    function paint() {
      pop.innerHTML = '';
      GRPS.forEach((g, gi) => {
        if (gi) pop.appendChild(el('<div style="height:1px;background:var(--line-2);margin:4px 0"></div>'));
        const all = FOLDERS.filter(f => f.grp === g).map(f => f.id);
        const onN = all.filter(id => !HID.has(id)).length;
        const gh = el('<button style="' + rowCss + ';font-weight:600">'
          + '<span style="width:13px;height:13px;flex:none;border-radius:3px;border:1px solid var(--line);'
          + 'display:grid;place-items:center;background:' + (onN ? 'var(--pri)' : 'transparent') + ';'
          + 'color:#fff">' + (onN ? (onN === all.length ? ic14('check') : '<span style="width:7px;height:2px;background:#fff"></span>') : '') + '</span>'
          + '<span style="flex:1">' + g + '</span>'
          + '<span class="t11 fnt">' + onN + ' / ' + all.length + '</span></button>');
        gh.onclick = () => { const hide = onN === all.length;
          all.forEach(id => hide ? HID.add(id) : HID.delete(id)); save(); render(); paint(); };
        pop.appendChild(gh);

        (function walk(parent, depth) {
          kidsOf(g, parent).forEach(f => {
            const own = HID.has(f.id), par = f.parent && isHidden(f.parent);
            const on = !own && !par;
            const r = el('<button style="' + rowCss + ';padding-left:' + (14 + depth * 15) + 'px;'
              + (par ? 'opacity:.45' : '') + '">'
              + '<span style="width:13px;height:13px;flex:none;border-radius:3px;border:1px solid var(--line);'
              + 'display:grid;place-items:center;background:' + (on ? 'var(--pri)' : 'transparent') + ';color:#fff">'
              + (on ? ic14('check') : '') + '</span>'
              + '<span style="color:' + (par ? 'var(--faint)' : 'inherit') + '">' + esc2(f.name) + '</span>'
              + '<span class="t11 fnt sp">' + rollup(f.id) + '</span></button>');
            r.onclick = () => { if (par) return; own ? HID.delete(f.id) : HID.add(f.id); save(); render(); paint(); };
            pop.appendChild(r);
            walk(f.id, depth + 1);
          });
        })(null, 0);
        if (!all.length) pop.appendChild(el('<div class="t11 fnt" style="padding:5px 14px">폴더가 없습니다. 아래에서 만들 수 있습니다.</div>'));
      });
    }
    paint();
    document.body.appendChild(pop);
    const b = anchor.getBoundingClientRect();
    pop.style.left = Math.min(b.left, innerWidth - pop.offsetWidth - 8) + 'px';
    pop.style.top = Math.min(b.bottom + 4, innerHeight - pop.offsetHeight - 8) + 'px';
    setTimeout(() => document.addEventListener('mousedown', function off(e) {
      if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('mousedown', off); } }), 0);
  }

  /* ── 좌측 패널 ── */
  modelList = function () {
    const totF = FOLDERS.length, onF = FOLDERS.filter(f => !isHidden(f.id)).length;
    const sel = selFolders();
    const left = el('<aside class="mod-l ' + (S.leftOpen ? '' : 'closed') + '" style="' + (S.leftOpen ? 'width:' + S.leftW + 'px' : '') + '">'
      + '<div class="mod-l-head"><span class="b6 t13">카탈로그</span>'
      + '<button class="iconbtn sp" id="mLTgl" title="' + (S.leftOpen ? '카탈로그 접기' : '카탈로그 펼치기') + '">' + ic14(S.leftOpen ? 'chevl' : 'menu') + '</button></div>'
      + '<div class="mod-l-body f1 col" style="min-height:0">'
      + '<div class="tg-bar">'
      + '<button class="iconbtn" id="tgNew" title="새 폴더">' + ic14('folderp') + '</button>'
      + '<span class="sp"></span>'
      + '<button class="t11" id="tgVis" title="카탈로그에 표시할 폴더 고르기"'
      + ' style="display:flex;align-items:center;gap:4px;padding:2px 7px;border:1px solid var(--line);'
      + 'border-radius:999px;background:var(--surface-2);color:var(--muted);cursor:pointer">'
      + onF + ' of ' + totF + ic14('chevd') + '</button>'
      + '</div>'
      + '<div class="tg-srch"><div class="srch">' + ic14('search')
      + '<input class="inp" id="tgQ" placeholder="이름으로 검색" value="' + esc2(S.ctQ || '') + '"></div></div>'
      + (sel.length ? '<div class="tg-sel"><span>폴더 ' + sel.length + '개 선택</span>'
          + '<button id="tgBH">숨기기</button><button id="tgBS">표시</button>'
          + '<button id="tgBX" class="sp">선택 해제</button></div>' : '')
      + '<div class="f1" style="overflow:auto" id="mList"></div>'
      + '</div>' + (S.leftOpen ? '<div class="grip l" id="gripL" title="폭 조절"></div>' : '') + '</aside>');

    const ml = $('#mList', left);
    const q = () => (S.ctQ || '').trim().toLowerCase();
    paintTree(ml, q(), { edit: true, item: itemRow });
    $('#tgQ', left).oninput = (e) => { S.ctQ = e.target.value; paintTree(ml, q(), { edit: true, item: itemRow }); };
    $('#mLTgl', left).onclick = () => { S.leftOpen = !S.leftOpen; render(); };
    $('#tgNew', left).onclick = () => newFolder('DATA MODEL', null);
    $('#tgVis', left).onclick = (ev) => { ev.stopPropagation(); visPop(ev.currentTarget); };
    if (sel.length) {
      $('#tgBH', left).onclick = () => { setHidden(sel, true); S.tgSel = []; };
      $('#tgBS', left).onclick = () => { setHidden(sel, false); S.tgSel = []; };
      $('#tgBX', left).onclick = () => { S.tgSel = []; render(); };
    }
    return left;
  };

  /* ── 파이프라인 좌측도 같은 트리 (폴더 편집 없음) ── */
  pipeCatalog = function (pp) {
    const left = el('<aside class="mod-l ' + (S.pipeLeftOpen ? '' : 'closed') + '" style="' + (S.pipeLeftOpen ? 'width:250px' : '') + '">'
      + '<div class="mod-l-head"><span class="b6 t13">카탈로그</span>'
      + '<button class="iconbtn sp" id="pLTgl" title="' + (S.pipeLeftOpen ? '접기' : '펼치기') + '">' + ic14(S.pipeLeftOpen ? 'chevl' : 'chev') + '</button></div>'
      + '<div class="mod-l-body f1 col" style="min-height:0">'
      + '<div class="tg-srch"><div class="srch">' + ic14('search')
      + '<input class="inp" id="pQ" placeholder="이름으로 검색" value="' + esc2(S.ctPQ || '') + '"></div></div>'
      + '<div class="f1" style="overflow:auto" id="pcList"></div>'
      + '<div style="padding:7px 10px;border-top:1px solid var(--line-2)">'
      + '<div class="t11 fnt">카드를 끌어다 놓거나 + 를 누르세요.</div></div></div></aside>');
    const host = $('#pcList', left);
    const mk = (d, q, pad) => {
      const used = pgraph(pp).nodes.filter(n => n.id === d.id).length;
      const row = el('<div class="tg-r i" draggable="true" style="padding-left:' + (pad + 13) + 'px"'
        + ' title="' + esc2(d.name) + '\n' + esc2(d.phys) + '">'
        + '<span class="tg-i" style="color:' + grpColor(d) + '">' + ic14(d.kind === 'source' ? 'tbl' : 'cube') + '</span>'
        + '<span class="tg-n">' + hit(d.name, q) + '</span>'
        + (used ? '<span class="tg-k">' + used + '</span>' : '')
        + '<button class="tg-b" data-padd title="캔버스에 놓기">' + ic14('plus') + '</button></div>');
      row.addEventListener('dragstart', (ev) => { ev.dataTransfer.setData('text/plain', d.id);
        ev.dataTransfer.effectAllowed = 'copy'; row.classList.add('dragging'); });
      row.addEventListener('dragend', () => row.classList.remove('dragging'));
      $('[data-padd]', row).onclick = (ev) => { ev.stopPropagation(); addPNode(pp, d.id); };
      return row;
    };
    const q = () => (S.ctPQ || '').trim().toLowerCase();
    paintTree(host, q(), { edit: false, item: mk });
    $('#pQ', left).oninput = (e) => { S.ctPQ = e.target.value; paintTree(host, q(), { edit: false, item: mk }); };
    $('#pLTgl', left).onclick = () => { S.pipeLeftOpen = !S.pipeLeftOpen; render(); };
    return left;
  };

  /* 앞선 층들이 items[1] 만 갈아끼워 와서 목록이 뒤섞여 있었다.
     여기가 마지막 층이므로 전체를 한 번에 확정한다. */
  HELP.modeling.items = [
    '하나의 SQL로 하나의 데이터 모델을 정의합니다. 출력 테이블도 하나입니다.',
    '입력은 데이터 수집이 만든 SOURCE 또는 앞서 만든 DATA MODEL 입니다.',
    '왼쪽 카탈로그 는 데이터가 흐르는 순서 그대로 SOURCE · DATA MODEL · DATA MART 로 나뉩니다.',
    '모델 사이의 실행 순서는 SQL 의 ref() 가 정합니다 — 따로 잇지 않습니다.',
    '여러 모델을 거친 최종 모델만 DATA MART 로 지정합니다. 중간 모델은 내부 가공용입니다.',
    'DATA MART 로 지정하면 데이터 분석에서 고를 수 있고, 다른 모델의 입력으로는 쓸 수 없습니다.',
    '폴더 위에서 마우스 오른쪽 버튼 — 하위 폴더·이름 변경·이동·숨기기·즐겨찾기·삭제.',
    '실행은 하지 않습니다. 언제 돌릴지는 데이터 파이프라인에서 정합니다.'];
})();
