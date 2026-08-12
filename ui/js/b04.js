/* ── b04 — ── b04 — 데이터 모델 추가 — 화면에서 만들기 / SQL로 만들기 ── (index.html 블록에서 기계적 추출, 동작 불변) */

/* ============================================================
   데이터 모델 추가 — 화면에서 만들기 / SQL로 만들기
   ============================================================ */
let NEWN = 0;
function openNewModel() {
  seedCanvas();
  if (!R().canModel) { toast('이 역할에서는 데이터 모델을 만들 수 없습니다.', 'warn'); return; }
  /* DATA MART 는 입력 후보에서 뺀다. 마트는 «분석으로 내보내는 최종 결과» 라
     다른 모델이 이어 쓰지 못한다(서버도 ref() 를 거절한다). 목록에 두고 저장할
     때 거절하면, 사용자는 폼을 다 채운 뒤에야 안 된다는 것을 알게 된다. */
  const pool = S.nodes.map(n => n.ref).filter(d => d && !d.isMart);
  if (!pool.length) {
    toast('입력으로 쓸 SOURCE 나 데이터 모델을 관계도에 먼저 올려 주세요. '
        + '(DATA MART 는 다른 모델의 입력으로 쓸 수 없습니다)', 'warn');
    return;
  }
  const cfg = { mode: 'form', base: pool[pool.length - 1].id, cols: [], filter: '', join: '', joinOn: '',
    group: [], agg: 'count', aggCol: '', name: '', phys: '' };
  const b0 = byId(cfg.base); cfg.cols = b0.cols.slice(0, 3).map(c => c[0]);

  const h = `<div class="modal-h"><span class="modal-t">데이터 모델 추가</span>
      <span class="t12 fnt">새로 만들 데이터를 정의합니다</span>
      <button class="iconbtn sp" data-close>${ic('x')}</button></div>
    <div class="tabs" style="padding:0 18px">
      <button class="tab on" data-nm="form">${ic14('table')}화면에서 만들기</button>
      <button class="tab" data-nm="sql">${ic14('code')}SQL로 만들기</button></div>
    <div class="modal-b" id="nmBody"></div>
    <div class="modal-f"><span class="t12 fnt" id="nmHint">SQL은 입력한 설정에 따라 자동으로 만들어집니다.</span>
      <button class="btn sp" data-close>취소</button>
      <button class="btn pri" id="nmOk">${ic14('plus')}캔버스에 추가</button></div>`;
  const { m, close } = modal(h);
  const body = $('#nmBody', m);

  const paint = () => {
    body.innerHTML = '';
    if (cfg.mode === 'form') body.appendChild(formMode(cfg, paint, pool));
    else body.appendChild(sqlMode(cfg));
    $('#nmHint', m).textContent = cfg.mode === 'form'
      ? 'SQL은 입력한 설정에 따라 자동으로 만들어집니다.'
      : 'ref() 로 부른 데이터는 캔버스에 연결선으로 자동 표시됩니다.';
  };
  $$('[data-nm]', m).forEach(b => b.onclick = () => {
    cfg.mode = b.dataset.nm;
    $$('[data-nm]', m).forEach(x => x.classList.toggle('on', x === b));
    paint();
  });
  paint();

  $('#nmOk', m).onclick = () => {
    let sql, name, phys, ups;
    if (cfg.mode === 'form') {
      name = ($('#nmName', body) || {}).value || cfg.name;
      phys = ($('#nmPhys', body) || {}).value || cfg.phys;
      if (!name) { toast('결과 데이터 이름을 입력해 주세요.', 'warn'); return; }
      // 전체 해제가 한 번에 되니 컬럼 없이 저장되는 길이 생겼다. 그대로 두면
      // select 절이 빈 SQL 이 만들어진다.
      if (!cfg.cols.length) { toast('사용할 컬럼을 하나 이상 선택해 주세요.', 'warn'); return; }
      sql = genSQL(cfg);
      ups = [cfg.base].concat(cfg.join ? [cfg.join] : []);
    } else {
      name = $('#nmSName', body).value.trim();
      phys = $('#nmSPhys', body).value.trim();
      sql = $('#nmSql', body).value;
      if (!name) { toast('데이터 모델 이름을 입력해 주세요.', 'warn'); return; }
      ups = parseRefs(sql);
      if (!ups.length) { toast('SQL 안에서 ref() 로 부른 데이터를 찾지 못했습니다.', 'warn'); return; }
    }
    /* 마트를 입력으로 부르면 서버가 거절한다(MART_AS_INPUT). 저장을 눌러 배우게
       하지 않고 여기서 먼저 막는다 — 서버 규칙과 같은 문장으로. */
    const martUps = ups.filter(id => (byId(id) || {}).isMart);
    if (martUps.length) {
      toast(`${martUps.join(', ')} 은(는) DATA MART 라 다른 모델의 입력으로 쓸 수 없습니다. `
          + '그 마트의 입력 모델을 참조하거나, 먼저 DATA MART 지정을 해제해 주세요.', 'warn');
      return;
    }
    const nd = buildModel({ name, phys, sql, ups, cfg });
    close();
    S.view = 'canvas'; S.dockTab = 'preview'; render();
    toast(`${name} 데이터 모델을 캔버스에 추가했습니다.`);
  };
}

function formMode(cfg, paint, pool) {
  const base = byId(cfg.base);
  const joinable = pool.filter(d => d.id !== cfg.base);
  const w = el(`<div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:18px"></div>`);
  const L = el(`<div class="frm"></div>`);
  L.appendChild(el(`<div class="fr"><span class="fr-l">기준 데이터</span>
    <select class="inp" id="fBase">${pool.map(d => `<option value="${d.id}" ${d.id === cfg.base ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>
    <span class="fr-h">새로 만들 데이터의 출발점이 되는 데이터입니다. SOURCE 와 DATA MODEL 만 고를 수 있습니다 — DATA MART 는 최종 모델이라 입력이 될 수 없습니다.</span></div>`));
  /* 컬럼은 칩이 아니라 목록으로 둔다. 칩은 이름이 길거나 개수가 많아지면 줄바꿈이
     들쭉날쭉해 무엇이 켜져 있는지 한눈에 안 들어온다. 목록은 한 줄에 하나씩이라
     체크 상태·컬럼명·타입이 세로로 정렬돼 훑기 쉽다. */
  // 설명과 타입은 있을 때만 붙인다. dbt manifest 로 들어온 모델은 한글명 자리에
  // 컬럼명이 그대로 들어와 있어서, 그대로 찍으면 같은 이름이 두 번 나온다.
  const colRow = (c) => {
    const label = c[1] && c[1] !== c[0] ? c[1] : '';
    return `<label class="chkrow" data-c="${esc(c[0])}" style="font-size:var(--fs-sm);gap:8px">
      <input type="checkbox" class="chk" ${cfg.cols.includes(c[0]) ? 'checked' : ''}>
      <span class="${label ? 'f1' : 'f1 mono'} trunc">${esc(label || c[0])}</span>
      ${label ? `<span class="t12 fnt mono trunc" style="max-width:46%">${esc(c[0])}</span>` : ''}
      ${c[2] ? `<span class="t11 fnt" style="flex:none">${esc(c[2])}</span>` : ''}</label>`;
  };

  L.appendChild(el(`<div class="fr"><span class="fr-l">사용할 컬럼</span>
    <div style="border:1px solid var(--line);border-radius:var(--r-s);overflow:hidden">
      <div class="row g10" style="padding:6px 10px;border-bottom:1px solid var(--line-2);background:var(--surface-2)">
        <label class="chkrow f1" style="font-size:var(--fs-sm);gap:8px">
          <input type="checkbox" class="chk" id="fColAll"><b>전체 선택</b></label>
        <span class="t12 fnt" id="fColN" style="flex:none">${cfg.cols.length} / ${base.cols.length}</span></div>
      <div id="fCols" style="max-height:198px;overflow:auto;padding:3px 10px 5px">
        ${base.cols.map(colRow).join('')}</div></div>
    <span class="fr-h">체크한 컬럼만 새 데이터에 들어갑니다.</span></div>`));
  L.appendChild(el(`<div class="fr"><span class="fr-l">필터 조건 <span class="fr-h">(선택)</span></span>
    <input class="inp mono" id="fFilter" placeholder="예) examination_date >= '2026-01-01'" value="${esc(cfg.filter)}"></div>`));
  L.appendChild(el(`<div class="fr"><span class="fr-l">연결할 데이터 <span class="fr-h">(선택)</span></span>
    <select class="inp" id="fJoin"><option value="">연결 안 함</option>
      ${joinable.map(d => `<option value="${d.id}" ${cfg.join === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select></div>`));
  L.appendChild(el(`<div class="fr" ${cfg.join ? '' : 'style="display:none"'} id="fJoinOnW"><span class="fr-l">연결 조건</span>
    <input class="inp mono" id="fJoinOn" value="${esc(cfg.joinOn)}"></div>`));
  const R2 = el(`<div class="frm"></div>`);
  R2.appendChild(el(`<div class="fr"><span class="fr-l">그룹 기준 <span class="fr-h">(집계할 때)</span></span>
    <div class="pick" id="fGroup">${cfg.cols.map(c => { const cc = base.cols.find(x => x[0] === c) || [c, c];
      return `<button class="pk ${cfg.group.includes(c) ? 'on' : ''}" data-g="${c}">${esc(cc[1])}</button>`; }).join('') || '<span class="t12 fnt">먼저 컬럼을 선택하세요.</span>'}</div></div>`));
  R2.appendChild(el(`<div class="fr"><span class="fr-l">집계 방식</span>
    <select class="inp" id="fAgg">
      <option value="">집계 안 함 (그대로 조회)</option>
      <option value="count" ${cfg.agg === 'count' ? 'selected' : ''}>건수 세기</option>
      <option value="sum" ${cfg.agg === 'sum' ? 'selected' : ''}>합계</option>
      <option value="avg" ${cfg.agg === 'avg' ? 'selected' : ''}>평균</option>
    </select></div>`));
  R2.appendChild(el(`<div class="fr" ${cfg.agg === 'sum' || cfg.agg === 'avg' ? '' : 'style="display:none"'} id="fAggColW">
    <span class="fr-l">집계 대상 컬럼</span>
    <select class="inp" id="fAggCol">${base.cols.map(c => `<option value="${c[0]}" ${cfg.aggCol === c[0] ? 'selected' : ''}>${esc(c[1])}</option>`).join('')}</select></div>`));
  R2.appendChild(el(`<div class="fr"><span class="fr-l">결과 데이터 이름</span>
    <input class="inp" id="nmName" placeholder="예) 유형별 일별 건수" value="${esc(cfg.name)}"></div>`));
  R2.appendChild(el(`<div class="fr"><span class="fr-l">저장 이름 <span class="fr-h">실제 테이블명</span></span>
    <input class="inp mono" id="nmPhys" value="${esc(cfg.phys || 'marts.agg_custom_' + (NEWN + 1))}"></div>`));
  R2.appendChild(el(`<div class="fr"><span class="fr-l">만들어질 SQL</span>
    <div class="code" id="fSql" style="max-height:190px">${hlSQL(genSQL(cfg))}</div>
    <span class="fr-h">저장하면 이 SQL이 데이터 모델로 등록됩니다.</span></div>`));
  w.appendChild(L); w.appendChild(R2);

  const sync = () => { $('#fSql', w).innerHTML = hlSQL(genSQL(cfg)); };
  $('#fBase', w).onchange = (e) => { cfg.base = e.target.value; const nb = byId(cfg.base);
    cfg.cols = nb.cols.slice(0, 3).map(c => c[0]); cfg.group = []; cfg.aggCol = '';
    cfg.colScroll = 0;      // 다른 데이터의 컬럼 목록이니 스크롤도 처음부터
    paint(); };
  const colBox = $('#fCols', w), allBox = $('#fColAll', w);

  // 컬럼을 하나 켤 때마다 폼을 통째로 다시 그리므로(그룹 기준·SQL 이 함께 바뀐다)
  // 목록이 길면 스크롤이 맨 위로 튄다. 위치를 들고 다니며 되돌린다.
  colBox.scrollTop = cfg.colScroll || 0;
  colBox.onscroll = () => { cfg.colScroll = colBox.scrollTop; };

  const syncAll = () => {
    const n = cfg.cols.length, all = base.cols.length;
    allBox.checked = n > 0 && n === all;
    // 일부만 고른 상태를 «전체 선택» 이 켜진 것으로 보이게 두면 안 된다.
    allBox.indeterminate = n > 0 && n < all;
    $('#fColN', w).textContent = `${n} / ${all}`;
  };
  syncAll();

  colBox.onchange = (e) => {
    const row = e.target.closest('[data-c]');
    if (!row) return;
    const c = row.dataset.c, i = cfg.cols.indexOf(c);
    // 그룹 기준은 고른 컬럼 중에서만 고를 수 있다. 컬럼을 빼면 같이 빠져야
    // group by 에 select 에 없는 컬럼이 남는 일이 없다.
    if (i >= 0) { cfg.cols.splice(i, 1); cfg.group = cfg.group.filter(g => g !== c); }
    else cfg.cols.push(c);
    paint();
  };
  allBox.onchange = () => {
    if (allBox.checked) cfg.cols = base.cols.map(c => c[0]);
    else { cfg.cols = []; cfg.group = []; }
    paint();
  };
  $$('[data-g]', w).forEach(b => b.onclick = () => {
    const c = b.dataset.g; const i = cfg.group.indexOf(c);
    if (i >= 0) cfg.group.splice(i, 1); else cfg.group.push(c);
    b.classList.toggle('on'); sync();
  });
  $('#fFilter', w).oninput = (e) => { cfg.filter = e.target.value; sync(); };
  $('#fJoin', w).onchange = (e) => {
    cfg.join = e.target.value;
    if (cfg.join) { const j = byId(cfg.join);
      /* 양쪽에 같은 이름으로 있는 컬럼을 기준으로 추천한다. 없으면 비워 둔다 —
         실재하지 않는 컬럼명을 채워 두면 그대로 저장돼 실행 때 깨진다. */
      const key = (base.cols.map(c => c[0]).filter(c => j.cols.some(x => x[0] === c))[0]) || '';
      cfg.joinOn = key ? `j.${key} = b.${key}` : ''; }
    paint();
  };
  const jo = $('#fJoinOn', w); if (jo) jo.oninput = (e) => { cfg.joinOn = e.target.value; sync(); };
  $('#fAgg', w).onchange = (e) => { cfg.agg = e.target.value; paint(); };
  const ac = $('#fAggCol', w); if (ac) ac.onchange = (e) => { cfg.aggCol = e.target.value; sync(); };
  $('#nmName', w).oninput = (e) => { cfg.name = e.target.value; };
  $('#nmPhys', w).oninput = (e) => { cfg.phys = e.target.value; };
  return w;
}

function genSQL(cfg) {
  const base = byId(cfg.base); if (!base) return '';
  const nm = (c) => (base.cols.find(x => x[0] === c) || [c])[0];
  const j = cfg.join ? byId(cfg.join) : null;
  const pre = j ? 'b.' : '';
  const lines = [];
  const sel = [];
  const groupCols = cfg.agg ? (cfg.group.length ? cfg.group : cfg.cols.slice(0, 2)) : cfg.cols;
  groupCols.forEach(c => sel.push(`    ${pre}${nm(c)}`));
  if (cfg.agg === 'count') sel.push(`    count(*) as row_count`);
  if (cfg.agg === 'sum') sel.push(`    sum(${pre}${cfg.aggCol || base.cols[0][0]}) as total_amount`);
  if (cfg.agg === 'avg') sel.push(`    avg(${pre}${cfg.aggCol || base.cols[0][0]}) as avg_value`);
  lines.push('select');
  lines.push(sel.join(',\n'));
  lines.push(`from ${dbtRef(base)}${j ? ' as b' : ''}`);
  if (j) {
    lines.push(`left join ${dbtRef(j)} as j`);
    /* 기준 컬럼을 아직 못 정했으면 자리를 비우고 무엇을 채워야 하는지 적는다.
       그럴듯한 컬럼명을 지어 넣으면 사용자가 맞는 값으로 착각한다. */
    lines.push(`    on ${cfg.joinOn || '/* 연결 기준 컬럼을 지정하세요 */'}`);
  }
  if (cfg.filter.trim()) lines.push(`where ${cfg.filter.trim()}`);
  if (cfg.agg && groupCols.length) lines.push(`group by ${groupCols.map((_, i) => i + 1).join(', ')}`);
  return lines.join('\n');
}

function sqlMode(cfg) {
  const sample = `select
    examination_date,
    examination_code,
    count(*) as examination_count
from {{ ref('stg_examination_result') }}
group by
    examination_date,
    examination_code`;
  const w = el(`<div class="frm">
    <div class="note info">${ic('info')}<span>SQL 안에서 <b class="mono">ref('데이터모델')</b> 또는 <b class="mono">source('스키마','테이블')</b> 로 다른 데이터를 부르면,
      캔버스에 연결선이 자동으로 그려지고 실행 순서도 그에 맞춰 정해집니다.</span></div>
    <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px">
      <div class="fr"><span class="fr-l">데이터 모델 이름</span><input class="inp" id="nmSName" placeholder="예) 일별 집계"></div>
      <div class="fr"><span class="fr-l">저장 이름 <span class="fr-h">실제 테이블명</span></span>
        <input class="inp mono" id="nmSPhys" value="marts.agg_custom_${NEWN + 1}"></div>
    </div>
    <div class="fr"><span class="fr-l">SQL</span>
      <textarea class="inp mono" id="nmSql" rows="12" spellcheck="false" style="font-size:var(--fs-sm);line-height:1.7">${esc(sample)}</textarea></div>
    <div class="fr"><span class="fr-l">함께 등록되는 정보</span>
      <div class="col g4 t12 mut" style="border:1px solid var(--line);border-radius:6px;padding:10px">
  
        <div class="row g6">${ic14('link', 'fnt')}연결된 이전 데이터 · <span id="nmRefs" class="mono">확인 중</span></div>
        <div class="row g6">${ic14('shield', 'fnt')}데이터 검증 규칙 · 필수값, 중복 검사 기본 등록</div>
        <div class="row g6">${ic14('code', 'fnt')}생성 방식 · <span class="mono">Materialization: Table</span></div>
      </div></div>
  </div>`);
  const upd = () => {
    const refs = parseRefs($('#nmSql', w).value);
    $('#nmRefs', w).textContent = refs.length ? refs.map(r => byId(r).name).join(', ') : '아직 없음';
  };
  $('#nmSql', w).oninput = upd; upd();
  return w;
}

function buildModel({ name, phys, sql, ups, cfg }) {
  NEWN++;
  const id = 'custom_' + NEWN;
  const base = ups.length ? byId(ups[0]) : null;
  let cols, prev;
  if (cfg && cfg.mode === 'form' && base) {
    const groupCols = cfg.agg ? (cfg.group.length ? cfg.group : cfg.cols.slice(0, 2)) : cfg.cols;
    cols = groupCols.map(c => base.cols.find(x => x[0] === c) || [c, c, 'STRING', '선택']);
    if (cfg.agg === 'count') cols = cols.concat([['row_count', '건수', 'INT', '필수']]);
    if (cfg.agg === 'sum') cols = cols.concat([['total_amount', '합계', 'DECIMAL', '선택']]);
    if (cfg.agg === 'avg') cols = cols.concat([['avg_value', '평균', 'DECIMAL', '선택']]);
    const idx = groupCols.map(c => base.cols.findIndex(x => x[0] === c));
    const seen = new Map();
    (base.prev || []).forEach(row => {
      const key = idx.map(i => row[i]).join('|');
      seen.set(key, (seen.get(key) || 0) + 1);
    });
    prev = [...seen.entries()].map(([k, v]) => k.split('|').concat(cfg.agg === 'count' ? [String(v)] : cfg.agg ? ['—'] : []));
    if (!cfg.agg) prev = (base.prev || []).map(row => idx.map(i => row[i]));
  } else {
    cols = [['examination_date', '검사일자', 'DATE', '필수'], ['examination_code', '검사코드', 'STRING', '필수'], ['examination_count', '검사건수', 'INT', '필수']];
    prev = [['2026-08-04', 'L3021', '1,204'], ['2026-08-04', 'L1102', '942'], ['2026-08-03', 'L3021', '1,188']];
  }
  const d = { id, name, phys: phys || ('marts.agg_custom_' + NEWN), layer: '분석용', kind: 'model',
    desc: `${cfg && cfg.mode === 'form' ? '화면 설정으로' : 'SQL로'} 만든 데이터 모델입니다.`,
    owner: '', team: '', updated: '방금 전', freq: '아직 예약 없음', rows: '—',
    quality: 'ok', certified: false, usable: true, mat: 'Table', tags: ['새 모델'],
    up: ups.slice(), cols, prev, sql, made: cfg && cfg.mode === 'form' ? '화면 설정으로 생성' : 'SQL 직접 작성' };
  D.push(d);
  const xs = S.nodes.map(n => n.x), maxX = xs.length ? Math.max(...xs) : 0;
  S.nodes.push({ id, x: Math.min(maxX + 250, 1500), y: 420 + (NEWN % 3) * 110, ref: d, changed: true });
  rebuildEdges();
  ups.forEach(u => { if (!S.edges.some(e => e.from === u && e.to === id)) S.edges.push({ from: u, to: id, manual: true }); });
  S.sel = id; S.dirty = true;
  return d;
}
