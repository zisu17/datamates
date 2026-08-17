/* ── b03 — ── b03 — 3. 데이터 모델링 — 캔버스 작업 공간 ── (index.html 블록에서 기계적 추출, 동작 불변) */

/* ============================================================
   3. 데이터 모델링 — 캔버스 작업 공간
   ============================================================ */
const NW = 186, NH = 74;

const MAT_KO = { 'View': '뷰', 'Table': '테이블', 'Incremental': '증분', 'Ephemeral': '임시' };
function matKo(m) { return MAT_KO[m] || m || '—'; }
function rebuildEdges() {
  const keep = {};                       // 연결 설정은 다시 만들어도 그대로 (v2.0)
  S.edges.forEach(e => { if (e.cfg) keep[edgeKey(e)] = e.cfg; });
  const ids = S.nodes.map(n => n.id);
  const auto = [];
  S.nodes.forEach(n => ((n.ref.up) || []).forEach(u => { if (ids.includes(u)) auto.push({ from: u, to: n.id }); }));
  const manual = S.edges.filter(e => e.manual && ids.includes(e.from) && ids.includes(e.to));
  const seen = new Set();
  S.edges = auto.concat(manual).filter(e => { const k = e.from + '>' + e.to; if (seen.has(k)) return false; seen.add(k); return true; });
  S.edges.forEach(e => { e.cfg = keep[edgeKey(e)] || edgeCfg(e); });
}
function nodeAt(id) { return S.nodes.find(n => n.id === id); }

/* (addNodeFromCatalog — 이후 정의가 값 캡처 없이 전면 교체. 죽은 층 제거) */
/* (pageModeling — 이후 정의가 값 캡처 없이 전면 교체. 죽은 층 제거) */
/* 툴바 더보기 — 보조 기능은 여기로 모은다 */
/* (moreMenu — 이후 정의가 값 캡처 없이 전면 교체. 죽은 층 제거) */
/* ── 캔버스 ── */
/* 모든 카드가 보이도록 배율·스크롤 조정 */
/* 선택한 카드를 화면 안으로 */
/* (afterModelingRender — 이후 정의가 값 캡처 없이 전면 교체. 죽은 층 제거) */
/* 패널 폭 · 도크 높이 드래그 조절 */
function wireGrips() {
  const start = (grip, apply) => {
    if (!grip) return;
    grip.onmousedown = (ev) => {
      ev.preventDefault(); grip.classList.add('on');
      const move = (e) => apply(e);
      const up = () => { grip.classList.remove('on'); document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up); render(); };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    };
  };
  const left = $('.mod-l'), dock = $('.dock');
  start($('#gripL'), (e) => {
    const r = left.getBoundingClientRect();
    S.leftW = Math.max(176, Math.min(360, e.clientX - r.left));
    left.style.width = S.leftW + 'px'; if (S.view === 'canvas') drawEdges();
  });
  /* (오른쪽 상세 패널 그립 #gripR — .panel 도 #gripR 도 만드는 곳이 없어졌다. 제거) */
  if (dock) dock.style.transition = 'none';

  /* 도크 높이 — v2.9.1 한계값(DOCK_MIN/MAX)과 transition 복원까지.
     원래는 여기서 한 번 연결한 뒤 v2.9.1 층이 통째로 다시 연결하고 있었다. */
  const g = $('#gripH');
  if (g && dock) g.onmousedown = (ev) => {
    ev.preventDefault(); g.classList.add('on');
    const prev = dock.style.transition; dock.style.transition = 'none';
    const move = (e) => { const r = dock.getBoundingClientRect();
      S.dockH = Math.max(DOCK_MIN, Math.min(dockMaxH(dock), r.bottom - e.clientY));
      dock.style.height = S.dockH + 'px'; };
    const up = () => { g.classList.remove('on'); dock.style.transition = prev;
      document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); render(); };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  };
}

function bez(x1, y1, x2, y2) {
  const dx = Math.max(40, Math.abs(x2 - x1) * 0.45);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}
/* ── SQL 보기 ── */
function sqlView(node) {
  const n = node || (S.sel && nodeAt(S.sel));
  if (!n) return el(`<div class="f1" style="display:grid;place-items:center"><div class="empty">${ic('code')}
    <span class="empty-t">데이터 모델을 선택해 주세요.</span></div></div>`);
  const d = n.ref;
  if (!d.sql) return el(`<div class="f1" style="display:grid;place-items:center"><div class="empty">${ic('db')}
    <span class="empty-t">${esc(d.name)}은(는) 원천 데이터입니다.</span><span>원천 데이터는 SQL 없이 그대로 들어옵니다.</span></div></div>`);
  const w = el(`<div class="f1 col" style="min-height:0;background:var(--surface)">
    <div class="row g8" style="padding:9px 14px;border-bottom:1px solid var(--line-2)">
      <span class="b6 t13">${esc(d.name)}</span><span class="sub">${esc(d.phys)}</span>
      <span class="t11 fnt sp">${ic14('info')} <b>ref()</b> 로 다른 데이터를 부르면 캔버스에 연결선이 자동으로 그려집니다.</span>
    </div>
    <textarea class="inp mono" id="sqlBox" spellcheck="false"
      style="flex:1;min-height:0;border:0;border-radius:0;font-size:var(--fs-sm);line-height:1.7;resize:none">${esc(d.sql)}</textarea>
    <div class="row g6" style="padding:9px 14px;border-top:1px solid var(--line-2)">
      <span class="t11 fnt">저장하면 연결 관계와 데이터 검증 규칙이 함께 등록됩니다.</span>
      <button class="btn sm sp" id="sqlFmt">정렬</button>
      <button class="btn pri sm" id="sqlSave">${ic14('save')}저장하고 연결 반영</button>
    </div></div>`);
  $('#sqlSave', w).onclick = () => {
    const v = $('#sqlBox', w).value;
    d.sql = v;
    const refs = parseRefs(v);
    refs.forEach(rid => { if (nodeAt(rid) && !S.edges.some(e => e.from === rid && e.to === d.id)) S.edges.push({ from: rid, to: d.id, manual: true }); });
    n.changed = true; S.dirty = false;
    toast(`SQL을 저장했습니다. 연결 ${refs.length}건을 반영했습니다.`);
    render();
  };
  $('#sqlFmt', w).onclick = () => toast('SQL을 정렬했습니다.');
  return w;
}
/* SQL 안에서 이 데이터를 부르는 표현. parseRefs 의 역함수다.

   수집이 적재한 원천은 dbt source 라서 source('스키마','테이블') 로 불러야 한다.
   ref() 는 모델과 seed 만 가리키므로, 원천에 ref() 를 쓰면
   «depends on a node named 'apt_trade' which was not found» 로 parse 가 통째로
   깨진다.

   seed 도 화면에서는 원천(kind=source)으로 보이지만 dbt 노드라서 ref() 가 맞다
   (stg_events 참고). 둘을 가르는 것은 manifest 가 알려주는 __dbtType 이다 —
   화면용 mat 은 둘 다 «—» 로 뭉개져 쓸 수 없다. __dbtType 이 없는 예시 데이터는
   kind 로 판단한다. */
function dbtRef(d) {
  const isSource = d && (d.__dbtType ? d.__dbtType === 'source' : d.kind === 'source');
  if (isSource) {
    const i = (d.phys || '').indexOf('.');
    if (i > 0) return `{{ source('${d.phys.slice(0, i)}', '${d.phys.slice(i + 1)}') }}`;
  }
  return `{{ ref('${d.id}') }}`;
}

function parseRefs(sql) {
  const out = [];
  const re = /\{\{\s*ref\(\s*['"]([^'"]+)['"]\s*\)\s*\}\}/g;
  let m; while ((m = re.exec(sql))) { if (byId(m[1])) out.push(m[1]); }
  const rs = /\{\{\s*source\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)\s*\}\}/g;
  while ((m = rs.exec(sql))) { const f = D.find(d => d.phys === m[1] + '.' + m[2]); if (f) out.push(f.id); }
  return [...new Set(out)];
}

/* ── 미리보기 보기 ── */
/* ── 하단 도크 ── */
/* (dockView — 이후 정의가 값 캡처 없이 전면 교체. 죽은 층 제거) */
/* ── 오른쪽 상세 패널 ── */
/* ── 실행 ── */
