/* ── b43 — ── b43 — v2.9 — 실행 흐름은 모델 task 만 · 의존 모델을 전부 끌어온다 ── (index.html 블록에서 기계적 추출, 동작 불변) */

/* ============================================================
   v2.9 — 실행 흐름은 모델 task 만 · 의존 모델을 전부 끌어온다
   ============================================================ */

/* 1) DAG 구성 : 실행 대상의 상류 모델을 재귀적으로 포함한다 */
pgraph = function (pp) {
  if (pp.graph) return pp.graph;
  const all = [];
  const visit = (id) => {
    if (all.includes(id) || !byId(id)) return;
    modelDeps(id).forEach(visit);          /* 상류 먼저 — 위상 순서가 자연히 맞는다 */
    all.push(id);
  };
  (pp.targets || []).filter(byId).forEach(visit);
  const dep = {}; all.forEach(id => dep[id] = modelDeps(id).filter(x => all.includes(x)));
  const depth = {};
  const walk = (id, g) => { if (depth[id] != null) return depth[id]; if (g.has(id)) return 0; g.add(id);
    const v = dep[id].length ? Math.max(...dep[id].map(x => walk(x, g))) + 1 : 0; g.delete(id); return depth[id] = v; };
  all.forEach(id => walk(id, new Set()));
  const cols = {}; all.forEach(id => (cols[depth[id]] = cols[depth[id]] || []).push(id));
  const nodes = [], keyOf = {};
  let seq = 0;
  Object.keys(cols).map(Number).sort((a, b) => a - b).forEach(k => {
    cols[k].forEach((id, i) => { seq++; const key = 'pn' + seq; keyOf[id] = key;
      nodes.push({ key, id, x: 40 + k * (PW + 96), y: 40 + i * (PH + 40) }); });
  });
  const edges = [];
  all.forEach(id => dep[id].forEach(f => edges.push({ from: keyOf[f], to: keyOf[id] })));
  pp.graph = { nodes, edges, seq };
  return pp.graph;
};
PIPES.forEach(pp => { pp.graph = null; pp.rg = null; pp.__rsig = null; });

/* 2) 실행 흐름용 그래프 — SOURCE 를 빼고 모델 task 만 남긴다 */
function taskCount(pp) {
  const order = pp.__flow && pp.__flow.order;
  if (order) return order.length;
  return pgraph(pp).nodes.filter(n => { const d = byId(n.id); return d && d.kind !== 'source'; }).length;
}

function taskGraph(pp) {
  const g = pgraph(pp);
  /* 실행 흐름 = 이 DAG 안의 Task. 서버 flow.order 가 Task 목록의 정본이다
     (원천도, 다른 파이프라인이 적재하는 조회 전용 입력도 Task 가 아니다 —
     그건 데이터 모델 관계이지 실행 관계가 아니다).
     S.pipeUp 이 켜지면 그 상류까지 함께 그린다 — 데이터가 어디서 오는지
     확인할 때만 잠깐 펼치는 용도라 기본은 꺼둔다. */
  if (S.pipeUp) return g;
  const order = (pp.__flow && pp.__flow.order) || null;
  const nodes = g.nodes.filter(n => order
    ? order.includes(n.id)
    : (() => { const d = byId(n.id); return d && d.kind !== 'source'; })());
  if (!nodes.length) return { nodes: [], edges: [], seq: g.seq };
  const keys = new Set(nodes.map(n => n.key));
  const minX = Math.min(...nodes.map(n => n.x)), minY = Math.min(...nodes.map(n => n.y));
  return {
    nodes: nodes.map(n => ({ key: n.key, id: n.id, x: n.x - minX + 40, y: n.y - minY + 40 })),
    edges: g.edges.filter(e => keys.has(e.from) && keys.has(e.to)),
    seq: g.seq,
  };
}

/* 3) 연결선은 넘겨받은 그래프를 그린다 */
drawPEdges = function (pp, host, svg, edit, gOv) {
  svg.innerHTML = `<defs><marker id="pah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
    <path d="M 0 0 L 10 5 L 0 10 z" fill="#A8B2C6"/></marker>
    <marker id="pahg" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
    <path d="M 0 0 L 10 5 L 0 10 z" fill="#0E9F6E"/></marker></defs>`;
  const g = gOv || pgraph(pp), runs = edit ? null : runsG(pp);
  g.edges.forEach(e => {
    const a = nodeOf(g, e.from), b = nodeOf(g, e.to); if (!a || !b) return;
    const x1 = a.x + PW, y1 = a.y + PH / 2, x2 = b.x, y2 = b.y + PH / 2;
    const dd = bez(x1, y1, x2, y2);
    const done = runs && ['ok', 'srcok', 'srcwarn'].includes((runs[e.from] || {}).st) && ['ok', 'err'].includes((runs[e.to] || {}).st);
    if (edit) {
      const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      hit.setAttribute('d', dd); hit.setAttribute('fill', 'none');
      hit.setAttribute('stroke', 'transparent'); hit.setAttribute('stroke-width', '16');
      hit.style.pointerEvents = 'stroke'; hit.style.cursor = 'pointer';
      hit.onclick = (ev) => { ev.stopPropagation();
        confirmBox({ title: '연결 삭제', ok: '삭제', danger: true,
          body: `${byId(a.id).name} → ${byId(b.id).name} 연결을 삭제하시겠습니까?\n\n실행 순서가 다시 계산됩니다.` },
          () => { const gr = pgraph(pp); const i = gr.edges.findIndex(x => x.from === e.from && x.to === e.to);
            if (i >= 0) gr.edges.splice(i, 1); syncTargets(pp); render(); }); };
      svg.appendChild(hit);
    }
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', dd); p.setAttribute('fill', 'none');
    p.setAttribute('stroke', done ? '#0E9F6E' : '#A8B2C6');
    p.setAttribute('stroke-width', done ? '2.4' : '1.7');
    if (!done && runs) p.setAttribute('stroke-dasharray', '6 4');
    p.setAttribute('marker-end', done ? 'url(#pahg)' : 'url(#pah)');
    svg.appendChild(p);
  });
};

/* 4) 캔버스 — 이 DAG 의 Task 만 그린다.
   상류 원천·조회 전용 입력은 데이터 모델 관계라 계보 화면의 몫이다.
   여기서 답할 질문은 «이 DAG 이 무엇을 어떤 순서로 실행하나» 하나다. */
pipeCanvas = function (pp, edit) {
  const g = taskGraph(pp);
  const runs = edit ? null : runsG(pp);
  const w = Math.max(760, ...g.nodes.map(n => n.x + PW + 60), 0) || 760;
  const h = Math.max(420, ...g.nodes.map(n => n.y + PH + 60), 0) || 420;
  const z0 = S.pipeZoom || 1;
  /* 머리말 수 — Task 수는 언제나 taskCount 기준이고, 상류를 펼쳤을 때만
     실제로 더 그려진 만큼을 덧붙인다 (없으면 상류 0개 라고 쓰지 않는다).
     예전에는 이 문구를 뒤 층이 다시 덮어쓰고 있었다 — 여기가 유일한 자리다. */
  const nTask = taskCount(pp), nShown = g.nodes.length;
  const headLabel = S.pipeUp && nShown > nTask
    ? `Task ${nTask}개 · 상류 ${nShown - nTask}개`
    : `Task ${nTask}개`;
  const holder = el(`<div class="f1" style="min-width:0;min-height:0;position:relative;display:flex;flex-direction:column">
    <div class="row g8" style="padding:9px 16px;border-bottom:1px solid var(--line-2);background:var(--surface);flex:none">
      <span class="b6 t13">${edit ? '가공 흐름 구성' : '실행 흐름'}</span>
      ${edit ? '' : `<span class="t11 fnt">${headLabel}</span>
        <button class="iconbtn" id="pfUp" style="flex:none;width:24px;height:24px"
          title="${S.pipeUp ? '상류 닫기' : '상류 보기 — 이 Task 들이 읽는 원천·입력'}">${ic14(S.pipeUp ? 'minus' : 'plus')}</button>`}
      <span class="row g6 sp">${edit ? '' : ['ok', 'run', 'err', 'skip', 'wait'].map(s => stBadge(s)).join('')}</span></div>
    <div class="canvas-wrap" id="pfWrap" style="background-color:#F4F6FB">
      <div id="pfSizer" style="position:relative">
        <div class="canvas" id="pf" style="width:${w}px;height:${h}px">
          <svg class="edges" id="pfEdges" style="pointer-events:${edit ? 'auto' : 'none'};overflow:visible"></svg>
        </div></div></div>
    <div class="zoomlbl">
      <button class="lnk" id="pfFit">화면에 맞추기</button>
      <span style="margin:0 6px;color:var(--line)">|</span>
      <button class="lnk" id="pfZ1">배율 ${Math.round(z0 * 100)}%</button></div>
  </div>`);
  const upBtn = $('#pfUp', holder);
  if (upBtn) upBtn.onclick = () => { S.pipeUp = !S.pipeUp; S.pipeScroll = null; render(); };
  const c = $('#pf', holder), svg = $('#pfEdges', holder);
  if (!g.nodes.length) c.appendChild(el(`<div class="empty" style="position:absolute;left:50%;top:90px;transform:translateX(-50%)">
    ${ic('pipe')}<span class="empty-t">${edit ? '왼쪽 카탈로그에서 SOURCE·DATA MODEL을 추가하세요.' : '실행할 모델이 없습니다.'}</span></div>`));
  g.nodes.forEach(n => {
    const card = pnodeEl(pp, n, runs, edit);
    card.onclick = (ev) => { if (ev.target.closest('[data-prm],[data-pport]')) return;
      S.pipeNodeK = n.key; S.pipeTab = S.pipeTab || '실행 정보'; render(); };
    c.appendChild(card);
  });
  setTimeout(() => drawPEdges(pp, c, svg, edit, g), 0);

  const wrap = $('#pfWrap', holder), sizer = $('#pfSizer', holder);
  wireZoomPan({
    key: 'pf', wrap, sizer, canvas: c, w, h,
    get: () => S.pipeZoom || 1, set: (z) => { S.pipeZoom = z; },
    onZoom: (z) => { const lb = $('#pfZ1', holder); if (lb) lb.textContent = `배율 ${Math.round(z * 100)}%`; },
    onDragBox: edit ? {
      start: (k, box) => { S.pipeNodeK = k; $$('.pn', c).forEach(x => x.classList.toggle('sel', x === box)); },
      move: (k, x, y) => { const n = nodeOf(g, k); n.x = x; n.y = y; drawPEdges(pp, c, svg, edit, g); },
    } : null,
  });
  keepScroll(wrap, 'pipeScroll', () => { const z = S.pipeZoom || 1; return { x: ZPAD, y: ZPAD, w: w * z, h: h * z }; });
  $('#pfZ1', holder).onclick = () => { S.pipeZoom = 1; S.pipeScroll = null; render(); };
  $('#pfFit', holder).onclick = () => {
    const z = Math.max(0.3, Math.min(1, (wrap.clientWidth - 56) / w, (wrap.clientHeight - 56) / h));
    S.pipeZoom = Math.round(z * 100) / 100; S.pipeScroll = { l: ZPAD - 24, t: ZPAD - 24 }; render();
  };

  if (edit) {
    $$('[data-prm]', c).forEach(b => b.onclick = (ev) => { ev.stopPropagation();
      const k = b.dataset.prm, d = byId(nodeOf(g, k).id);
      confirmBox({ title: '캔버스에서 제거', ok: '제거', danger: true,
        body: `${d.name} 을(를) 캔버스에서 제거합니다.\n\n연결도 함께 사라지고 실행 순서가 다시 계산됩니다.\n데이터 모델 자체는 삭제되지 않습니다.` },
        () => { g.nodes.splice(g.nodes.indexOf(nodeOf(g, k)), 1);
          for (let i = g.edges.length - 1; i >= 0; i--) if (g.edges[i].from === k || g.edges[i].to === k) g.edges.splice(i, 1);
          if (S.pipeNodeK === k) S.pipeNodeK = null;
          syncTargets(pp); render(); }); });
    let link = null;
    c.addEventListener('mousedown', (ev) => {
      const port = ev.target.closest('[data-pport]'); if (!port) return;
      ev.preventDefault(); ev.stopPropagation();
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('stroke', '#0E9F6E'); path.setAttribute('stroke-width', '2.2');
      path.setAttribute('fill', 'none'); path.setAttribute('stroke-dasharray', '5 4');
      svg.appendChild(path);
      link = { from: port.dataset.pport, path };
    }, true);
    const mv = (ev) => {
      if (!link) return;
      const z = S.pipeZoom || 1, cr = c.getBoundingClientRect(), a = nodeOf(g, link.from);
      link.path.setAttribute('d', bez(a.x + PW, a.y + PH / 2, (ev.clientX - cr.left) / z, (ev.clientY - cr.top) / z));
      const over = document.elementFromPoint(ev.clientX, ev.clientY);
      const tn = over && over.closest('[data-pk]');
      $$('.pn', c).forEach(x => x.classList.toggle('linking', tn === x && x.dataset.pk !== link.from));
    };
    const up = (ev) => {
      if (!link) return;
      const over = document.elementFromPoint(ev.clientX, ev.clientY);
      const tn = over && over.closest('[data-pk]');
      link.path.remove(); $$('.pn', c).forEach(x => x.classList.remove('linking'));
      const from = link.from; link = null;
      if (!tn || tn.dataset.pk === from) return;
      const to = tn.dataset.pk;
      if (g.edges.some(e => e.from === from && e.to === to)) { toast('이미 연결되어 있습니다.', 'warn'); return; }
      if (byId(nodeOf(g, to).id).kind === 'source') { toast('SOURCE 는 다른 데이터를 입력으로 받지 않습니다.', 'warn'); return; }
      g.edges.push({ from, to });
      const ord = orderG(g);
      if (ord.indexOf(to) < ord.indexOf(from)) { g.edges.pop(); toast('순환 연결은 만들 수 없습니다.', 'err'); return; }
      syncTargets(pp); render();
      toast(`${byId(nodeOf(g, from).id).name} → ${byId(nodeOf(g, to).id).name} 연결을 추가했습니다.`);
    };
    if (window.__plmv) { window.removeEventListener('mousemove', window.__plmv); window.removeEventListener('mouseup', window.__plmu); }
    window.__plmv = mv; window.__plmu = up;
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
    wrap.addEventListener('dragover', (ev) => ev.preventDefault());
    wrap.addEventListener('drop', (ev) => {
      ev.preventDefault();
      const id = ev.dataTransfer.getData('text/plain'); if (!byId(id)) return;
      const z = S.pipeZoom || 1, cr = c.getBoundingClientRect();
      addPNode(pp, id, (ev.clientX - cr.left) / z - PW / 2, (ev.clientY - cr.top) / z - PH / 2);
    });
  }
  return holder;
};

/* 5) 실행 흐름에서는 SOURCE 를 고를 수 없으므로 선택을 정리한다 */
/* (pagePipeDetail — 이후 정의가 값 캡처 없이 전면 교체. 죽은 층 제거) */
