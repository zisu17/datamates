/* ── b10 — ── b10 — 모델링 화면 재구성 ── (index.html 블록에서 기계적 추출, 동작 불변) */

/* ============================================================
   모델링 화면 재구성
   ============================================================ */
const LORDER = { '원천': 0, '정제': 1, '분석용': 2 };
function autoLayout() {
  const cols = [[], [], []];
  S.nodes.forEach(n => cols[LORDER[n.ref.layer] || 0].push(n));
  cols.forEach((list, ci) => list.forEach((n, ri) => { n.x = 48 + ci * 272; n.y = 40 + ri * 116; }));
}
function addNodeAt(id, x, y) {
  if (nodeAt(id)) { S.sel = id; toast('이미 캔버스에 있습니다.'); return; }
  seedCanvas();
  S.nodes.push({ id, x: Math.max(8, Math.min(1800 - NW - 8, x)), y: Math.max(8, Math.min(1100 - NH - 8, y)), ref: byId(id) });
  rebuildEdges(); S.sel = id; S.selEdge = null; S.dirty = true;
  toast(`${byId(id).name} 을(를) 캔버스에 추가했습니다.`);
}
addNodeFromCatalog = function (id) {
  if (nodeAt(id)) { S.sel = id; toast('이미 캔버스에 있습니다.'); return; }
  seedCanvas();
  const xs = S.nodes.map(n => n.x + NW), ys = S.nodes.map(n => n.y);
  addNodeAt(id, Math.min(1400, Math.max(48, Math.max(...xs) + 86)), Math.max(...ys) + 116);
};

/* 의존성 강제 — 하위 모델은 상위(원천·정제) 데이터 없이 캔버스에 존재할 수 없다 */
const _addCat = addNodeFromCatalog;
addNodeFromCatalog = function (id) {
  if (nodeAt(id)) { S.sel = id; toast('이미 캔버스에 있습니다.'); return; }
  const need = [];
  (function up(x) { ((byId(x) || {}).up || []).forEach(u => {
    if (!nodeAt(u) && !need.includes(u)) { need.push(u); up(u); } }); })(id);
  need.slice().reverse().forEach(u => _addCat(u));
  _addCat(id);
  if (need.length) toast(`${byId(id).name} 은(는) 상위 데이터가 필요해 ${need.length}개를 함께 추가했습니다.`);
};

const _rmNode = removeNode;
removeNode = function (id, hard) {
  const down = [];
  (function dn(x) { S.nodes.forEach(n => {
    if (((n.ref && n.ref.up) || []).includes(x) && !down.includes(n.id)) { down.push(n.id); dn(n.id); } }); })(id);
  if (down.length) {
    const nm = byId(id).name, names = down.map(x => (byId(x) || {}).name).filter(Boolean);
    confirmBox({ title: '하위 모델도 함께 제거', ok: '함께 제거', danger: true,
      body: `${nm} 은(는) 아래 모델의 입력 데이터입니다.\n\n${names.map(x => '· ' + x).join('\n')}\n\n입력 없이는 만들 수 없으므로 함께 캔버스에서 제거됩니다.` },
      () => { const q = window.toast; window.toast = () => {};
        down.slice().reverse().forEach(x => _rmNode(x, false));
        window.toast = q;
        _rmNode(id, hard); });
    return;
  }
  _rmNode(id, hard);
};

/* 카드 더보기 메뉴 */
/* 하단 결과 패널 */
/* (dockView — 이후 정의가 값 캡처 없이 전면 교체. 죽은 층 제거) */
/* 실행·검증·미리보기 시 하단 패널 자동 열기 */
/* 우측 상세 패널 */
confirmDeleteNode = function (id) {
  const d = byId(id); if (!d) return;
  const links = S.edges.filter(e => e.from === id || e.to === id).length;
  if (!isDeletable(id)) {
    confirmBox({ title: '캔버스에서 제거', ok: '캔버스에서 제거',
      body: `${d.name} 을(를) 캔버스에서만 제거합니다.\n\n입력 관계 ${links}개도 함께 사라집니다.\n원본 데이터는 삭제되지 않으며 왼쪽 목록에서 다시 추가할 수 있습니다.` },
      () => removeNode(id, false));
    return;
  }
  confirmBox({ title: '데이터 모델 삭제', ok: '삭제', danger: true,
    body: `${d.name} 데이터 모델을 삭제하시겠습니까?\n\n연결된 입력 관계 ${links}개도 함께 삭제됩니다.` },
    () => removeNode(id, true));
};

/* 연결선 — 역할이 설정된 경우에만 라벨 */
drawEdges = function () {
  const svg = $('#edges'); if (!svg) return;
  svg.innerHTML = `<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
    <path d="M 0 0 L 10 5 L 0 10 z" fill="#A8B2C6"/></marker>
    <marker id="ahs" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
    <path d="M 0 0 L 10 5 L 0 10 z" fill="#4356E0"/></marker></defs>`;
  const cv = $('#cv'); if (!cv) return;
  let lay = $('#elabels');
  if (!lay) { lay = el('<div id="elabels" style="position:absolute;inset:0;pointer-events:none"></div>'); cv.appendChild(lay); }
  lay.innerHTML = '';
  const used = [];
  S.edges.forEach(e => {
    const a = nodeAt(e.from), b = nodeAt(e.to); if (!a || !b) return;
    const key = edgeKey(e), sel = S.selEdge === key;
    const hot = sel || S.sel === e.from || S.sel === e.to;
    const x1 = a.x + NW, y1 = a.y + NH / 2, x2 = b.x, y2 = b.y + NH / 2;
    const d0 = bez(x1, y1, x2, y2);
    const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    hit.setAttribute('d', d0); hit.setAttribute('fill', 'none');
    hit.setAttribute('stroke', 'transparent'); hit.setAttribute('stroke-width', '16');
    hit.style.pointerEvents = 'stroke'; hit.style.cursor = 'pointer';
    hit.onclick = (ev) => { ev.stopPropagation(); S.selEdge = key; S.sel = null; render(); };
    hit.ondblclick = (ev) => { ev.stopPropagation(); openEdgeCfg(key); };
    svg.appendChild(hit);
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d0); p.setAttribute('fill', 'none');
    p.setAttribute('stroke', sel ? '#4356E0' : hot ? '#7C8AF0' : '#A8B2C6');
    p.setAttribute('stroke-width', sel ? '2.6' : hot ? '2.2' : '1.6');
    p.setAttribute('marker-end', sel ? 'url(#ahs)' : 'url(#ah)');
    svg.appendChild(p);
    const txt = edgeLabel(e);
    if (!txt && !sel) return;
    let lx = (x1 + x2) / 2, ly = (y1 + y2) / 2;
    while (used.some(u => Math.abs(u.x - lx) < 96 && Math.abs(u.y - ly) < 20)) ly -= 20;
    used.push({ x: lx, y: ly });
    const lb = el(`<button class="elabel ${sel ? 'on' : ''}" style="left:${lx}px;top:${ly}px;pointer-events:auto"
      title="${esc(edgeTip(e))}">${esc(txt || '연결 설정')}</button>`);
    lb.onclick = (ev) => { ev.stopPropagation(); S.selEdge = key; S.sel = null; openEdgeCfg(key); };
    lay.appendChild(lb);
  });
};

/* (pageModeling — 이후 정의가 값 캡처 없이 전면 교체. 죽은 층 제거) */
function fitCanvasQuiet() {
  const wrap = $('#cvWrap'); if (!wrap || !S.nodes.length) return;
  const xs = S.nodes.map(n => n.x), ys = S.nodes.map(n => n.y);
  const bw2 = Math.max(...xs) + NW - Math.min(...xs), bh = Math.max(...ys) + NH - Math.min(...ys);
  const z = Math.max(0.5, Math.min(1, (wrap.clientWidth - 56) / bw2, (wrap.clientHeight - 56) / bh));
  S.zoom = Math.round(z * 100) / 100;
  render();
  const w2 = $('#cvWrap');
  if (w2) { w2.scrollLeft = Math.max(0, Math.min(...xs) * S.zoom - 20); w2.scrollTop = Math.max(0, Math.min(...ys) * S.zoom - 20); }
}

/* (moreMenu — 이후 정의가 값 캡처 없이 전면 교체. 죽은 층 제거) */
