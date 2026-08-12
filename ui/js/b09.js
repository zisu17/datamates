/* ── b09 — ── b09 — v1.3 — 개념 정리 · 동선 정리 ── (index.html 블록에서 기계적 추출, 동작 불변) */

/* ============================================================
   v1.3 — 개념 정리 · 동선 정리
   ============================================================ */
const EROLES = ['기준 데이터', '조인 데이터', '참조 데이터', '일반 입력 데이터'];
const EROLE_DEF = '일반 입력 데이터';
Object.assign(S, {
  laidOut: false, listPreview: null, dockAuto: false, homeBanner: true, pipeZoom: 1,
  soverOpen: false, tfOpen: false,
});
S.dockMin = false; S.dockTab = 'detail';
/* 하단 상세 패널의 처음 높이. 파이프라인의 실행 정보(자동 맞춤 상한 PDOCK_FIT=340)와
   같은 눈높이로 맞춘다 — 모델을 고르자마자 정의가 잘리지 않고 읽히는 정도다. */
S.dockH = 320;

/* 연결선: 역할만 갖는다 */
function edgeRole(e) { if (!e.cfg) e.cfg = {}; if (!e.cfg.role) e.cfg.role = EROLE_DEF; return e.cfg.role; }
edgeLabel = function (e) { const r = edgeRole(e); return r === EROLE_DEF ? '' : r; };
edgeTip = function (e) {
  const a = byId(e.from), b = byId(e.to), c = e.cfg || {};
  const L = [`${a ? a.name : e.from} → ${b ? b.name : e.to}`, `입력 역할: ${edgeRole(e)}`];
  if (c.desc) L.push(`설명: ${c.desc}`);
  L.push('변환 작업은 출력 데이터 모델에서 설정합니다.');
  return L.join('\n');
};
edgeDefaults = function () { return { role: EROLE_DEF, desc: '' }; };

/* 출력 모델의 변환 설정 */
function tf(d) {
  if (!d.tf) {
    const ins = S.edges.filter(e => e.to === d.id).map(e => e.from);
    d.tf = { base: ins[0] || '', joinType: 'left join', joinOn: '', cols: [], filter: '',
      groupBy: [], aggFn: '', clean: [], sql: d.sql || '', name: d.name, useSql: false };
  }
  return d.tf;
}
function inputsOf(id) { return S.edges.filter(e => e.to === id); }
function genModelSQL(d) {
  const t = tf(d), ins = inputsOf(d.id);
  if (!ins.length) return d.sql || '';
  const base = byId(t.base) || byId(ins[0].from);
  if (!base) return d.sql || '';
  const joins = ins.filter(e => e.from !== base.id);
  const pre = joins.length ? 'a.' : '';
  const cols = t.cols.length ? t.cols : (base.cols || []).slice(0, 4).map(c => c[0]);
  const sel = [];
  const group = t.aggFn ? (t.groupBy.length ? t.groupBy : cols.slice(0, 2)) : cols;
  group.forEach(c => sel.push(`    ${pre}${c}`));
  if (t.aggFn === 'count') sel.push('    count(*) as row_count');
  if (t.aggFn === 'sum') sel.push(`    sum(${pre}${cols[cols.length - 1]}) as total_value`);
  if (t.aggFn === 'avg') sel.push(`    avg(${pre}${cols[cols.length - 1]}) as avg_value`);
  const L = ['select', sel.join(',\n'), `from ${dbtRef(base)}${joins.length ? ' as a' : ''}`];
  joins.forEach((e, i) => {
    const j = byId(e.from); if (!j) return;
    const alias = 'j' + (i + 1);
    const key = t.joinOn || guessKey(base, j);
    L.push(`${t.joinType} ${dbtRef(j)} as ${alias}`);
    L.push(`    on ${alias}.${key} = a.${key}`);
  });
  const wh = [];
  if (t.filter.trim()) wh.push(t.filter.trim());
  if (t.clean.includes('필수값 없는 행 제외')) wh.push(`${pre}${cols[0]} is not null`);
  if (wh.length) L.push('where ' + wh.join('\n  and '));
  if (t.aggFn && group.length) L.push(`group by ${group.map((_, i) => i + 1).join(', ')}`);
  return L.join('\n');
}
/* 양쪽에 같은 이름으로 있는 컬럼을 연결 기준으로 추천한다.
   찾지 못하면 **비워 둔다.** 예전에는 특정 도메인의 컬럼명을 기본값으로 넣었는데,
   그 이름이 이 데이터에 없으면 사용자가 «있는 값» 으로 착각해 그대로 저장한다.
   빈 값이면 자리표시자가 무엇을 넣어야 하는지 말한다. */
function guessKey(a, b) {
  const k = (a.cols || []).map(x => x[0]).find(x => (b.cols || []).some(y => y[0] === x));
  return k || '';
}
/* ── 연결선 설정: 역할만 ── */
openEdgeCfg = function (key) {
  const e = findEdge(key); if (!e) return;
  const a = byId(e.from), b = byId(e.to);
  if (!e.cfg) e.cfg = edgeDefaults();
  const h = `<div class="modal-h"><span class="modal-t">연결 설정</span>
      <span class="t12 fnt">데이터 모델 사이의 입력 관계</span>
      <button class="iconbtn sp" data-close>${ic('x')}</button></div>
    <div class="modal-b"><div class="frm">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="fr"><span class="fr-l">입력 모델</span>
          <div class="statrow"><span class="swatch" style="background:${a ? LAYER[a.layer].color : '#ccc'}"></span>
            <span class="col f1" style="gap:0;min-width:0"><span class="t13 trunc">${esc(a ? a.name : e.from)}</span>
              <span class="sub trunc">${esc(a ? a.phys : '')}</span></span></div></div>
        <div class="fr"><span class="fr-l">출력 모델</span>
          <div class="statrow"><span class="swatch" style="background:${b ? LAYER[b.layer].color : '#ccc'}"></span>
            <span class="col f1" style="gap:0;min-width:0"><span class="t13 trunc">${esc(b ? b.name : e.to)}</span>
              <span class="sub trunc">${esc(b ? b.phys : '')}</span></span></div></div>
      </div>
      <div class="fr"><span class="fr-l">입력 역할</span>
        <div class="row g6" style="flex-wrap:wrap">${EROLES.map(r => `<button class="chip ${edgeRole(e) === r ? 'on' : ''}" data-er="${esc(r)}">${esc(r)}</button>`).join('')}</div>
</div>
      <div class="fr"><span class="fr-l">설명 <span class="fr-h">(선택)</span></span>
        <input class="inp" id="erD" placeholder="예) 연령대를 채우기 위해 붙입니다." value="${esc(e.cfg.desc || '')}"></div>
    </div></div>
    <div class="modal-f"><button class="btn sm dngr" id="erDel">${ic14('x')}연결 삭제</button>
      <button class="btn sm sp" id="erTf">${ic14('set')}변환 설정 열기</button>
      <button class="btn" data-close>취소</button><button class="btn pri" id="erOk">저장</button></div>`;
  const { m, close } = modal(h, { sm: false });
  let role = edgeRole(e);
  $$('[data-er]', m).forEach(x => x.onclick = () => { role = x.dataset.er;
    $$('[data-er]', m).forEach(y => y.classList.toggle('on', y === x)); });
  $('#erDel', m).onclick = () => { close(); confirmDeleteEdge(key); };
  $('#erTf', m).onclick = () => { close(); S.sel = e.to; S.selEdge = null; render(); openTransform(e.to); };
  $('#erOk', m).onclick = () => {
    e.cfg.role = role; e.cfg.desc = $('#erD', m).value;
    if (role === '기준 데이터' && byId(e.to)) tf(byId(e.to)).base = e.from;
    S.dirty = true; close(); render(); toast('연결 설정을 저장했습니다.');
  };
};
confirmDeleteEdge = function (key) {
  const e = findEdge(key); if (!e) return;
  const a = byId(e.from), b = byId(e.to);
  confirmBox({ title: '연결 삭제', ok: '삭제', danger: true,
    body: `${a ? a.name : e.from} → ${b ? b.name : e.to} 입력 관계를 삭제하시겠습니까?` },
    () => { S.edges = S.edges.filter(x => edgeKey(x) !== key);
      if (S.selEdge === key) S.selEdge = null; S.dirty = true; render(); toast('연결을 삭제했습니다.'); });
};

/* ============================================================
   데이터 모델 변환 설정
   ============================================================ */
const CLEAN_RULES = ['필수값 없는 행 제외', '중복 행 제거', '문자 공백 제거', '코드 대문자 통일'];
function openTransform(id) {
  const d = byId(id); if (!d) return;
  if (d.kind === 'source') { toast('원천 데이터는 변환 설정이 없습니다.', 'warn'); return; }
  const t = tf(d), ins = inputsOf(id);
  if (!ins.length) { toast('먼저 입력 데이터를 연결해 주세요.', 'warn'); return; }
  if (!t.base || !ins.some(e => e.from === t.base)) t.base = ins[0].from;
  const w = JSON.parse(JSON.stringify(t));
  const colsOf = () => (byId(w.base) || {}).cols || [];

  const h = `<div class="modal-h"><span class="modal-t">변환 설정</span>
      <span class="t12 fnt">${esc(d.name)}</span><button class="iconbtn sp" data-close>${ic('x')}</button></div>
    <div class="modal-b"><div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px">
      <div class="col g12" id="tfL"></div>
      <div class="col g12" id="tfR"></div>
    </div></div>
    <div class="modal-f"><button class="btn sp" data-close>취소</button><button class="btn pri" id="tfOk">저장</button></div>`;
  const { m, close } = modal(h);
  const L = $('#tfL', m), Rr = $('#tfR', m);

  const paint = () => {
    L.innerHTML = ''; Rr.innerHTML = '';
    // 입력 데이터
    const sec1 = el(`<div class="tfsec"><span class="tfsec-t">${ic14('link', 'fnt')}입력 데이터 ${ins.length}개</span>
      <div class="col g6" id="tfIns"></div>
</div>`);
    const box = $('#tfIns', sec1);
    ins.forEach(e => {
      const s = byId(e.from);
      const row = el(`<div class="statrow"><span class="swatch" style="background:${LAYER[s.layer].color}"></span>
        <span class="col f1" style="gap:0;min-width:0"><span class="t12 trunc">${esc(s.name)}</span>
          <span class="sub trunc">${esc(s.phys)}</span></span>
        <button class="chip ${w.base === e.from ? 'on' : ''}" data-base="${e.from}" style="height:24px;font-size:var(--fs-cap)">${w.base === e.from ? '기준 데이터' : '기준으로'}</button>
        <span class="tag">${esc(edgeRole(e))}</span></div>`);
      box.appendChild(row);
    });
    L.appendChild(sec1);

    const joins = ins.filter(e => e.from !== w.base);
    const sec2 = el(`<div class="tfsec" ${joins.length ? '' : 'style="opacity:.55"'}>
      <span class="tfsec-t">${ic14('flow', 'fnt')}조인</span>
      ${joins.length ? `<div class="row g6">
        <select class="inp" id="tfJT" style="width:150px">${['left join', 'inner join', 'full outer join'].map(x => `<option ${w.joinType === x ? 'selected' : ''}>${x}</option>`).join('')}</select>
        <input class="inp mono f1" id="tfJO" placeholder="양쪽에 공통으로 있는 컬럼 이름" value="${esc(w.joinOn || guessKey(byId(w.base) || {}, byId(joins[0].from) || {}))}"></div>
        <span class="t11 fnt">${joins.map(e => esc(byId(e.from).name)).join(' · ')} 와(과) 연결합니다.</span>`
      : '<span class="t12 fnt">조인할 입력이 없습니다. 입력을 하나 더 연결하면 설정할 수 있습니다.</span>'}</div>`);
    L.appendChild(sec2);

    const sec3 = el(`<div class="tfsec"><span class="tfsec-t">${ic14('table', 'fnt')}사용할 컬럼</span>
      <div class="pick" style="max-height:120px">${colsOf().map(c => `<button class="pk ${w.cols.includes(c[0]) ? 'on' : ''}" data-c="${esc(c[0])}">${esc(c[1])}</button>`).join('') || '<span class="t12 fnt">컬럼 정보가 없습니다.</span>'}</div>
</div>`);
    L.appendChild(sec3);

    const sec4 = el(`<div class="tfsec"><span class="tfsec-t">${ic14('filter', 'fnt')}필터 · 정제</span>
      <input class="inp mono" id="tfF" placeholder="예) examination_date >= '2026-01-01'" value="${esc(w.filter)}">
      <div class="col" style="gap:2px">${CLEAN_RULES.map(r => `<label class="chkrow" style="font-size:var(--fs-sm)">
        <input type="checkbox" class="chk" data-cl="${esc(r)}" ${w.clean.includes(r) ? 'checked' : ''}> ${esc(r)}</label>`).join('')}</div></div>`);
    Rr.appendChild(sec4);

    const sec5 = el(`<div class="tfsec"><span class="tfsec-t">${ic14('chart', 'fnt')}그룹 · 집계</span>
      <select class="inp" id="tfAgg">
        <option value="">집계 안 함</option>
        ${[['count', '건수 세기'], ['sum', '합계'], ['avg', '평균']].map(([v, x]) => `<option value="${v}" ${w.aggFn === v ? 'selected' : ''}>${x}</option>`).join('')}</select>
      <div class="pick" style="max-height:96px;display:${w.aggFn ? 'flex' : 'none'}" id="tfGB">
        ${colsOf().map(c => `<button class="pk ${w.groupBy.includes(c[0]) ? 'on' : ''}" data-g="${esc(c[0])}">${esc(c[1])}</button>`).join('')}</div></div>`);
    Rr.appendChild(sec5);

    const sec6 = el(`<div class="tfsec"><span class="tfsec-t">${ic14('doc', 'fnt')}결과</span>
      <div class="fr"><span class="fr-l">결과 데이터 이름</span><input class="inp" id="tfN" value="${esc(w.name || d.name)}"></div>
      <div class="fr"><span class="fr-l">데이터 검증 규칙</span>
        <div class="col" style="gap:2px">
          <label class="chkrow" style="font-size:var(--fs-sm)"><input type="checkbox" class="chk" id="tfT1" checked> 필수값 검사</label>
          <label class="chkrow" style="font-size:var(--fs-sm)"><input type="checkbox" class="chk" id="tfT2" checked> 중복 검사</label>
          <label class="chkrow" style="font-size:var(--fs-sm)"><input type="checkbox" class="chk" id="tfT3"> 참조 무결성 검사</label>
        </div></div></div>`);
    Rr.appendChild(sec6);

    const sec7 = el(`<div class="tfsec"><span class="tfsec-t">${ic14('code', 'fnt')}만들어질 SQL
        <label class="chkrow sp" style="font-size:var(--fs-cap)"><input type="checkbox" class="chk" id="tfUse" ${w.useSql ? 'checked' : ''}> 직접 작성</label></span>
      <div class="code" id="tfSql" style="max-height:170px;display:${w.useSql ? 'none' : 'block'}">${hlSQL(preview())}</div>
      <textarea class="inp mono" id="tfSqlE" rows="8" spellcheck="false" style="display:${w.useSql ? 'block' : 'none'};font-size:var(--fs-sm)">${esc(w.sql || preview())}</textarea></div>`);
    Rr.appendChild(sec7);

    // 이벤트
    $$('[data-base]', L).forEach(b => b.onclick = () => { w.base = b.dataset.base; w.cols = []; w.groupBy = []; paint(); });
    $$('[data-c]', L).forEach(b => b.onclick = () => { const c = b.dataset.c, i = w.cols.indexOf(c);
      if (i >= 0) w.cols.splice(i, 1); else w.cols.push(c); b.classList.toggle('on'); sync(); });
    $$('[data-g]', Rr).forEach(b => b.onclick = () => { const c = b.dataset.g, i = w.groupBy.indexOf(c);
      if (i >= 0) w.groupBy.splice(i, 1); else w.groupBy.push(c); b.classList.toggle('on'); sync(); });
    $$('[data-cl]', Rr).forEach(b => b.onchange = () => { const r = b.dataset.cl, i = w.clean.indexOf(r);
      if (b.checked && i < 0) w.clean.push(r); if (!b.checked && i >= 0) w.clean.splice(i, 1); sync(); });
    const jt = $('#tfJT', L); if (jt) jt.onchange = (e2) => { w.joinType = e2.target.value; sync(); };
    const jo = $('#tfJO', L); if (jo) jo.oninput = (e2) => { w.joinOn = e2.target.value; sync(); };
    $('#tfF', Rr).oninput = (e2) => { w.filter = e2.target.value; sync(); };
    $('#tfAgg', Rr).onchange = (e2) => { w.aggFn = e2.target.value; paint(); };
    $('#tfUse', Rr).onchange = (e2) => { w.useSql = e2.target.checked;
      $('#tfSql', Rr).style.display = w.useSql ? 'none' : 'block';
      $('#tfSqlE', Rr).style.display = w.useSql ? 'block' : 'none';
      if (w.useSql && !w.sql) $('#tfSqlE', Rr).value = preview(); };
  };
  function preview() { const save = d.tf; d.tf = w; const s = genModelSQL(d); d.tf = save; return s; }
  function sync() { const box = $('#tfSql', m); if (box) box.innerHTML = hlSQL(preview()); }
  paint();

  $('#tfOk', m).onclick = () => {
    w.name = ($('#tfN', m) || {}).value || d.name;
    if (w.useSql) w.sql = ($('#tfSqlE', m) || {}).value || '';
    d.tf = w; d.name = w.name;
    d.sql = w.useSql ? w.sql : genModelSQL(d);
    if (w.useSql) syncRefsFromSQL(d);
    S.dirty = true; close(); render();
    toast('변환 설정을 저장했습니다. SQL 이 함께 갱신되었습니다.');
  };
}
/* SQL 에서 ref() 를 읽어 캔버스 입력 관계에 반영 */
function syncRefsFromSQL(d) {
  const refs = parseRefs(d.sql || '');
  let added = 0;
  refs.forEach(rid => {
    if (rid === d.id || !nodeAt(rid)) return;
    if (!S.edges.some(e => e.from === rid && e.to === d.id)) {
      S.edges.push({ from: rid, to: d.id, manual: true, cfg: { role: EROLE_DEF, desc: 'SQL 에서 자동 인식' } });
      added++;
    }
  });
  if (added) toast(`SQL 에서 입력 ${added}개를 찾아 연결했습니다.`);
}
