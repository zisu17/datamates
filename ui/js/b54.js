/* ── b54 — 데이터 분석: 데이터 선택 · 분석/시각화 ──
   ============================================================
   정보 구조의 2·3단계다.

       분석 선택(b53) →  **데이터 선택**  →  **분석/시각화**

   데이터 선택을 앞에 두는 이유는 하나다 — 플랫폼에서 만든 데이터가 분석으로
   이어진다는 흐름이 보여야 한다. 「새 분석」이 곧바로 차트 편집기를 열면
   분석 기능이 데이터 플랫폼과 무관한 별개 도구처럼 느껨진다.

   분석 엔진의 편집 화면을 복제하지 않는다. 옵션은 수백 개지만 사용자가
   이해해야 하는 것은 다섯 가지다 — 데이터 · 시각화 · 차원 · 측정값 · 조건.
   그 이상을 화면에 두지 않는다. 화면은 엔진의 어휘를 모르고, 번역은
   서버(analytics/query.py)가 한다.
   ============================================================ */
'use strict';

const BUILD = {
  opts: null, cols: null, loading: false,
  spec: { modelId: '', viz: 'table', dimensions: [], metrics: [], filters: [], limit: 100 },
  result: null, error: null, running: false, saving: false, name: '',
};

function buildReset(modelId) {
  BUILD.spec = { modelId: modelId || '', viz: 'table', dimensions: [], metrics: [],
                 filters: [], limit: 100 };
  BUILD.result = null; BUILD.error = null; BUILD.cols = null; BUILD.name = '';
}

async function buildLoadOptions() {
  if (BUILD.opts || BUILD.loading) return;
  BUILD.loading = true;
  try { BUILD.opts = await api('/analytics/build/options'); }
  catch (e) { BUILD.error = (e && e.message) || '분석 준비에 실패했습니다.'; }
  finally { BUILD.loading = false; if (S.page === 'analytics') render(); }
}

async function buildLoadColumns(modelId) {
  if (!modelId) return;
  try {
    BUILD.cols = await api(`/analytics/build/models/${encodeURIComponent(modelId)}/columns`);
  } catch (e) { BUILD.error = (e && e.message) || '컬럼을 불러오지 못했습니다.'; }
  if (S.page === 'analytics') render();
}

function buildRule() {
  const v = ((BUILD.opts && BUILD.opts.viz) || []).find(x => x.key === BUILD.spec.viz);
  return v || { dims: [0, 8], metrics: [0, 8] };
}
const buildCols = () => (BUILD.cols && BUILD.cols.columns) || [];
const buildLabel = (n) => (buildCols().find(c => c.name === n) || {}).label || n;

/* 지금 실행할 수 있는가. 못 하면 이유를 돌려준다 — 버튼만 흐리게 두면
   사용자는 무엇이 모자란지 모른다. */
function buildBlocked() {
  const s = BUILD.spec, r = buildRule();
  if (!s.modelId) return '분석할 데이터를 선택해 주세요.';
  if (s.dimensions.length < r.dims[0]) return `무엇으로 나눌지 ${r.dims[0]}개 이상 골라 주세요.`;
  if (s.metrics.length < r.metrics[0]) return `무엇을 볼지 ${r.metrics[0]}개 이상 골라 주세요.`;
  if (s.metrics.some(m => !m.col && m.agg !== 'COUNT')) return '측정값의 컬럼을 골라 주세요.';
  const ops = (BUILD.opts && BUILD.opts.ops) || [];
  const bad = s.filters.find(f => {
    if (!f.col) return false;
    const o = ops.find(x => x.key === f.op);
    return o && o.needsValue && !String(f.val ?? '').length;
  });
  if (bad) return `조건 「${buildLabel(bad.col)}」 의 값을 입력해 주세요.`;
  return '';
}

async function buildRun() {
  const why = buildBlocked();
  if (why) { toast(why, 'warn'); return; }
  BUILD.running = true; BUILD.error = null; render();
  try {
    BUILD.result = await api('/analytics/build/run',
      { method: 'POST', body: JSON.stringify(BUILD.spec) });
  } catch (e) {
    BUILD.result = null; BUILD.error = (e && e.message) || '실행에 실패했습니다.';
  } finally { BUILD.running = false; render(); }
}

/* ── 화면 2 — 데이터 선택 ───────────────────────────────────── */

function anaPickData(p) {
  buildLoadOptions();

  /* 헤더는 스크롤 밖에 둔다 — 세로로 움직이는 것은 .ana-scroll 하나뿐이다. */
  const band = el(`<div class="ana-top inset row" style="align-items:center">
    <button class="iconbtn" id="pkBack" title="데이터 분석으로">${ic14('chevl')}</button>
    <div class="f1" style="min-width:0">
      <h1 class="tt" style="font-size:var(--fs-page)">새 분석</h1>
      <p class="td">분석할 DATA MART 를 선택하세요.</p>
    </div>
    <button class="btn" id="pkAdv" ${BUILD.spec.modelId ? '' : 'disabled'}>
      ${ic14('ext')}엔진에서 직접 만들기</button>
    <button class="btn pri" id="pkGo" ${BUILD.spec.modelId ? '' : 'disabled'}>
      분석 시작${ic14('chev')}</button>
  </div>`);
  p.appendChild(band);
  /* 마법사는 다섯 가지 시각화만 다룬다 — 흐름을 이해시키는 것이 목적이라 그 이상을
     화면에 두지 않는다. 그런데 히트맵·이중축 콤보처럼 여기서 못 만드는 것이 분명히
     있고, 그때 «여기서는 안 된다» 로 끝나면 사용자는 길이 막힌다. 엔진의 편집 화면을
     같은 데이터로 열어 주면 마법사는 좁게 두면서도 막다른 길이 되지 않는다.
     주소는 프록시를 거치므로 사용자가 엔진 주소를 따로 알 필요는 없다. */
  $('#pkAdv', band).onclick = () => {
    const ds = (BUILD.cols && BUILD.cols.datasetId)
      || ((BUILD.opts.models || []).find(m => m.id === BUILD.spec.modelId) || {}).datasetId;
    if (!ds) { toast('이 데이터는 아직 분석 엔진에 동기화되지 않았습니다.', 'warn'); return; }
    // 경로에 /superset 을 붙이지 않는다. 프록시는 경로를 그대로 넘기고,
    // 엔진의 /superset/explore/ 는 구 경로라 새 경로로 302 를 내며 되돌아온다.
    window.open(`${ORIGIN}/explore/?datasource_type=table&datasource_id=${ds}`, '_blank');
  };
  const scroll = el('<div class="ana-scroll"></div>');
  const wrap = el('<div class="ana-inner"></div>');
  scroll.appendChild(wrap); p.appendChild(scroll);
  p = wrap;
  $('#pkBack', band).onclick = () => { S.anaView = ''; render(); };
  $('#pkGo', band).onclick = () => {
    if (!BUILD.spec.modelId) { toast('분석할 DATA MART 를 선택해 주세요.', 'warn'); return; }
    S.anaView = 'build'; render();
  };

  if (!BUILD.opts) {
    p.appendChild(el(`<div class="ana-empty">${BUILD.error ? esc(BUILD.error) : '불러오는 중…'}</div>`));
    return;
  }

  /* 고를 수 있는 것은 DATA MART 뿐이다 (서버 /analytics/build/options 가 이미
     걸러 준다). SOURCE 나 중간 DATA MODEL 을 여기서 고를 수 있게 두면 분석마다
     가공 단계가 달라져 같은 지표가 화면마다 다른 값이 된다. 무엇을 분석에
     내보낼지는 데이터 모델 화면의 «DATA MART 지정» 한 번으로 정한다. */
  const models = (BUILD.opts.models || []).filter(m => m.group === 'DATA MART');
  if (!models.length) {
    const empty = el(`<div class="ana-empty" style="line-height:1.8">
      아직 DATA MART 가 없습니다.<br>
      분석에는 <b>DATA MART 로 지정된 데이터 모델</b>만 쓸 수 있습니다.<br>
      데이터 모델 화면에서 최종 모델을 골라 「DATA MART 지정」을 눌러 주세요.
      <div style="margin-top:14px"><button class="btn pri" id="pkToModel">
        ${ic14('model')}데이터 모델로 이동</button></div></div>`);
    p.appendChild(empty);
    $('#pkToModel', empty).onclick = () => go('modeling');
    return;
  }

  const sec = el(`<div class="ana-sec">
    <div class="ana-sec-h"><span class="t">DATA MART</span>
      <span class="n">${models.length}</span>
      <span class="t11 fnt sp">분석에 쓸 수 있는 최종 데이터입니다</span></div></div>`);
  const grid = el('<div class="ana-opts"></div>');
  models.forEach(m => {
    const on = BUILD.spec.modelId === m.id;
    /* 설명은 첫 줄만 — 모델 설명은 여러 줄짜리 문서라 카드에 통째로 들어가면
       무엇을 고르는 화면인지 읽히지 않는다. */
    const line = String(m.desc || '').split('\n')[0].trim();
    const b = el(`<button class="ana-opt ${on ? 'on' : ''}" data-m="${esc(m.id)}"
      title="${esc(m.name || m.id)}\n${esc(m.phys || '')}">
      <span class="on1 trunc">${esc(m.name || m.id)}</span>
      <span class="on2 trunc">${esc(line || m.phys || '')}</span></button>`);
    grid.appendChild(b);
  });
  sec.appendChild(grid);
  p.appendChild(sec);

  $$('[data-m]', p).forEach(b => b.onclick = () => {
    buildReset(b.dataset.m);
    buildLoadColumns(b.dataset.m);
    render();
  });
}

/* ── 화면 3 — 분석/시각화 ───────────────────────────────────── */

/* ── 분석 만들기 ─────────────────────────────────────────────────
   구성은 받은 디자인(데이터 분석.dc.html)을 따른다.

     상단 바   ← · 이름 · DATA MART/물리명 · 대시보드 선택 · 실행 · 저장
     좌 360px  보기 형식 5종 · 세 개의 담는 자리(기준/값/조건) · 요약·초기화
     우        결과 — 실행 전에는 체크리스트, 실행 후에는 표 또는 막대

   담는 자리에 컬럼 목록을 늘어놓지 않고 **모달로 고른다.** 예전에는 컬럼을
   전부 칩으로 깔았는데, 마트 하나가 12~18개라 패널이 그 목록으로 가득 찼다.
   무엇을 담았는지가 목록에 묻혀 «지금 무엇을 만들고 있는가» 가 보이지 않았다. */

S.bPick = S.bPick || null;      // 'dim' | 'val' | 'cond' — 열린 선택 모달
S.bQuery = S.bQuery || '';      // 모달 안 검색어

const B_ZONES = [
  { key: 'dim',  label: '무엇으로 나눌까요', icon: 'tbl',
    hint: '기준이 될 항목을 담습니다. 예: 자치구, 면적대' },
  { key: 'val',  label: '무엇을 볼까요', icon: 'spark',
    hint: '숫자 항목을 담습니다. 예: 전세가율, 갭' },
  { key: 'cond', label: '조건', icon: 'filter',
    hint: '조회 범위를 좁힙니다. 담지 않으면 전체 조회' },
];

/* 담긴 것 — 자리마다 저장 위치가 다르다. */
function bItems(key) {
  const s = BUILD.spec;
  if (key === 'dim') return s.dimensions.map(n => ({ name: buildLabel(n), raw: n, role: '기준' }));
  if (key === 'val') return s.metrics.map((m, i) => ({
    name: m.col ? buildLabel(m.col) : '(컬럼 미선택)', raw: m.col, role: m.agg, idx: i }));
  return s.filters.map((f, i) => ({
    name: f.col ? buildLabel(f.col) : '(컬럼 미선택)', raw: f.col,
    role: `${f.op} ${f.val ?? ''}`.trim(), idx: i }));
}

function bDrop(key, it) {
  const s = BUILD.spec;
  if (key === 'dim') s.dimensions = s.dimensions.filter(n => n !== it.raw);
  else if (key === 'val') s.metrics.splice(it.idx, 1);
  else s.filters.splice(it.idx, 1);
  BUILD.result = null; render();
}

function bAdd(key, colName) {
  const s = BUILD.spec, r = buildRule();
  if (key === 'dim') {
    if (s.dimensions.includes(colName)) return;
    if (s.dimensions.length >= r.dims[1]) { toast(`${r.dims[1]}개까지 담을 수 있습니다.`, 'warn'); return; }
    s.dimensions.push(colName);
  } else if (key === 'val') {
    if (s.metrics.length >= r.metrics[1]) { toast(`${r.metrics[1]}개까지 담을 수 있습니다.`, 'warn'); return; }
    s.metrics.push({ col: colName, agg: 'SUM' });
  } else {
    s.filters.push({ col: colName, op: '==', val: '' });
  }
  BUILD.result = null; render();
}

/* 담는 자리 하나 */
function bZone(z) {
  const items = bItems(z.key);
  const r = buildRule();
  const cap = z.key === 'dim' ? r.dims[1] : z.key === 'val' ? r.metrics[1] : null;
  const box = el(`<div class="dcb-zone">
    <div class="dcb-zh">
      <span class="row g6" style="align-items:center">
        ${ic14(z.icon, 'fnt')}<span class="t">${z.label}</span>
        <span class="n">${cap ? `${items.length}/${cap}` : items.length}</span></span>
      <button class="btn gho sm dcb-add">${ic14('plus')}추가</button>
    </div>
    <div class="dcb-items"></div>
  </div>`);
  const host = $('.dcb-items', box);
  if (!items.length) {
    const e = el(`<button class="dcb-empty">${esc(z.hint)}</button>`);
    e.onclick = () => { S.bPick = z.key; S.bQuery = ''; render(); };
    host.appendChild(e);
  }
  items.forEach(it => {
    const chip = el(`<div class="dcb-chip">
      <span class="nm trunc">${esc(it.name)}</span>
      <span class="rl">${esc(it.role)}</span>
      <button class="iconbtn xs" title="빼기">${ic14('x')}</button></div>`);
    $('.iconbtn', chip).onclick = () => bDrop(z.key, it);
    host.appendChild(chip);
  });
  $('.dcb-add', box).onclick = () => { S.bPick = z.key; S.bQuery = ''; render(); };
  return box;
}

/* 필드 선택 모달 — 자리마다 고를 수 있는 항목이 다르다. */
function bPicker() {
  const key = S.bPick;
  if (!key) return null;
  const cols = buildCols();
  const q = (S.bQuery || '').trim().toLowerCase();
  const match = (c) => !q || String(c.label).toLowerCase().includes(q)
    || String(c.name).toLowerCase().includes(q);

  const groups = key === 'dim'
    ? [{ label: '구분 항목', items: cols.filter(c => c.role !== 'measure') }]
    : key === 'val'
      ? [{ label: '숫자 항목', items: cols.filter(c => c.role === 'measure') }]
      : [{ label: '구분 항목', items: cols.filter(c => c.role !== 'measure') },
         { label: '숫자 항목', items: cols.filter(c => c.role === 'measure') }];

  const picked = new Set([
    ...BUILD.spec.dimensions,
    ...BUILD.spec.metrics.map(m => m.col),
    ...BUILD.spec.filters.map(f => f.col)].filter(Boolean));

  /* 앞서 띄운 것을 먼저 걷는다. render() 는 #app 만 비우고 모달 스크림은
     document.body 에 남으므로, 그냥 두면 렌더마다 한 겹씩 쌓인다 —
     위에 덮인 옛 모달이 보이면서 «다른 자리를 골랐는데 같은 목록» 처럼 보였다. */
  $$('.scrim').forEach(sc => { if ($('.dcb-pmodal', sc)) sc.remove(); });

  const title = key === 'dim' ? '나눌 기준 선택' : key === 'val' ? '볼 값 선택' : '조건 항목 선택';
  const hint = key === 'cond' ? '담은 항목마다 조건값을 지정합니다.' : '담은 항목은 아래 자리에 쌓입니다.';

  const h = `<div class="modal-h"><span class="modal-t">${title}</span>
      <button class="iconbtn sp" data-close>${ic('x')}</button></div>
    <div class="dcb-psrch">${ic14('search', 'fnt')}
      <input placeholder="필드 검색" value="${esc(S.bQuery || '')}"></div>
    <div class="modal-b dcb-plist"></div>
    <div class="modal-f" style="justify-content:space-between">
      <span class="t12 fnt">${hint}</span>
      <button class="btn" data-close>닫기</button></div>`;
  const { m, close } = modal(h, { sm: true });
  m.classList.add('dcb-pmodal');

  const list = $('.dcb-plist', m);
  groups.forEach(g => {
    const hit = g.items.filter(match);
    if (!hit.length) return;
    list.appendChild(el(`<div class="dcb-pgrp">${g.label}
      <span class="n">${hit.length}</span></div>`));
    hit.forEach(c => {
      const on = picked.has(c.name);
      const b = el(`<button class="dcb-pitem ${on ? 'on' : ''}">
        ${ic14(c.role === 'measure' ? 'spark' : 'code', 'fnt')}
        <span class="nm trunc">${esc(c.label)}</span>
        <span class="st">${on ? '담김' : ''}</span></button>`);
      b.onclick = () => { bAdd(key, c.name); };
      list.appendChild(b);
    });
  });
  if (!list.children.length) {
    list.appendChild(el('<div class="ana-empty">맞는 필드가 없습니다. 검색어를 줄여 보세요.</div>'));
  }

  const srch = $('.dcb-psrch input', m);
  srch.oninput = (e) => {
    S.bQuery = e.target.value;
    const at = e.target.selectionStart; render();
    const again = $('.dcb-psrch input');
    if (again) { again.focus(); again.setSelectionRange(at, at); }
  };
  $$('[data-close]', m).forEach(b => b.onclick = () => { S.bPick = null; S.bQuery = ''; close(); render(); });
  setTimeout(() => srch.focus(), 0);
  return m;
}

/* 결과 — 실행 전에는 체크리스트, 실행 후에는 표 또는 막대.
   체크리스트를 두는 이유는, 실행이 안 될 때 «왜» 를 버튼 흐림만으로 알 수 없어서다.
   무엇이 채워졌고 무엇이 비었는지를 한 줄씩 보여준다. */
function bResult(host) {
  const s = BUILD.spec;
  const why = buildBlocked();
  const card = el(`<div class="dcb-res">
    <div class="dcb-rh">
      <span class="row" style="align-items:baseline">
        <span class="t">결과</span>
        <span class="n">${BUILD.result
          ? `${BUILD.result.rowCount}행` : (BUILD.running ? '실행 중…' : '실행 전')}</span></span>
    </div></div>`);

  if (BUILD.error) {
    card.appendChild(el(`<div class="ana-empty">${esc(BUILD.error)}</div>`));
    host.appendChild(card); return;
  }

  if (!BUILD.result) {
    const chk = (label, ok, val, need) => `<div class="dcb-chk">
      ${ic14(ok ? 'checkc' : (need ? 'alert' : 'minus'), ok ? 'ok' : 'fnt')}
      <span class="lb">${label}</span>
      <span class="vl trunc">${esc(val)}</span></div>`;
    const dims = s.dimensions.map(buildLabel);
    const vals = s.metrics.map(m => m.col ? buildLabel(m.col) : '(컬럼 미선택)');
    const conds = s.filters.map(f => f.col ? buildLabel(f.col) : '(컬럼 미선택)');
    const vizLabel = ((BUILD.opts && BUILD.opts.viz) || [])
      .find(v => v.key === s.viz);

    const box = el(`<div class="dcb-empty-wrap">
      <div class="col g6" style="align-items:center">
        <span class="t1">${why ? '볼 항목을 먼저 담아 주세요.' : '실행하면 결과가 나옵니다.'}</span>
        <span class="t2">${esc(why || '설정은 저장할 때 함께 보관됩니다.')}</span>
      </div>
      <div class="dcb-chks">
        ${chk('보기 형식', true, (vizLabel && vizLabel.label) || s.viz, false)}
        ${chk('나눌 기준', dims.length > 0, dims.join(', ') || '선택 필요', true)}
        ${chk('볼 값', vals.length > 0, vals.join(', ') || '선택 필요', true)}
        ${chk('조건', conds.length > 0, conds.join(', ') || '없음', false)}
      </div></div>`);
    const run = el(`<button class="btn pri" ${BUILD.running ? 'disabled' : ''}>
      ${ic14('play')}${BUILD.running ? '실행 중…' : '실행'}</button>`);
    run.onclick = buildRun;
    box.appendChild(run);
    card.appendChild(box); host.appendChild(card); return;
  }

  /* 표 — 데이터 미리보기와 같은 문법을 쓴다. 다른 도구처럼 느껴지지 않게. */
  const h = BUILD.result.headers || BUILD.result.columns;
  const wrap = el(`<div class="dcb-rbody">
    <div class="tbl" style="--cols:${h.map(() => 'minmax(120px,1fr)').join(' ')};min-width:100%"></div>
  </div>`);
  const t = $('.tbl', wrap);
  t.appendChild(el(`<div class="th">${h.map(x => `<span>${esc(x)}</span>`).join('')}</div>`));
  BUILD.result.rows.forEach(r => t.appendChild(el(
    `<div class="tr static" style="min-height:34px">${r.map(v =>
      `<span class="mono t12 trunc">${v === null || v === undefined ? '—' : esc(v)}</span>`
    ).join('')}</div>`)));
  card.appendChild(wrap);
  host.appendChild(card);
}

function anaBuild(p) {
  buildLoadOptions();
  const model = ((BUILD.opts && BUILD.opts.models) || [])
    .find(m => m.id === BUILD.spec.modelId);

  /* 상단 바 — 이름과 출처가 한 줄, 동작이 오른쪽. */
  const bar = el(`<div class="dcb-bar">
    <div class="row g12" style="min-width:0;align-items:center">
      <button class="iconbtn" id="bBack" title="목록으로">${ic14('chevl')}</button>
      <div class="col" style="gap:2px;min-width:0">
        <input class="dcb-name" id="bName" placeholder="분석 이름"
          value="${esc(BUILD.name || '')}">
        <span class="row g6" style="align-items:center;min-width:0">
          ${grpTag('DATA MART')}
          <span class="fnt">/</span>
          <span class="dcb-src trunc">${esc(model ? (model.phys || model.id) : '데이터 미선택')}</span>
        </span>
      </div>
    </div>
    <div class="row" style="flex:none;align-items:center">
      <select class="inp sm" id="bDash" style="max-width:190px">
        <option value="">대시보드에 넣지 않음</option>
        ${((ANA.data && ANA.data.dashboards) || []).map(d =>
          `<option value="${d.id}">${esc(d.name)}</option>`).join('')}
        <option value="__new">＋ 새 대시보드…</option>
      </select>
      <input class="inp sm" id="bNewDash" placeholder="새 대시보드 이름"
        style="max-width:170px;display:none">
      <button class="btn sm" id="bRun" ${BUILD.running ? 'disabled' : ''}>
        ${ic14('play')}${BUILD.running ? '실행 중…' : '실행'}</button>
      <button class="btn pri sm" id="bSave" ${BUILD.saving ? 'disabled' : ''}>
        ${ic14('save')}${BUILD.saving ? '저장 중…' : '저장'}</button>
    </div>
  </div>`);
  p.appendChild(bar);

  const scroll = el('<div class="ana-scroll"></div>');
  const grid = el('<div class="dcb-grid"></div>');
  scroll.appendChild(grid); p.appendChild(scroll);

  if (!BUILD.opts) {
    grid.appendChild(el(`<div class="ana-empty">${
      BUILD.error ? esc(BUILD.error) : '불러오는 중…'}</div>`));
    $('#bBack', bar).onclick = () => { S.anaView = 'pick'; render(); };
    return;
  }

  /* 좌 — 설정 패널 */
  const panel = el('<div class="dcb-panel"></div>');
  const viz = el(`<div class="dcb-viz">
    <span class="lb">어떻게 볼까요</span>
    <div class="tiles"></div></div>`);
  const tiles = $('.tiles', viz);
  (BUILD.opts.viz || []).forEach(v => {
    const on = BUILD.spec.viz === v.key;
    const b = el(`<button class="dcb-tile ${on ? 'on' : ''}">
      ${ic14({ table: 'tbl', bar: 'chart', line: 'spark', pie: 'cube', kpi: 'code' }[v.key] || 'chart')}
      <span>${esc(v.label)}</span></button>`);
    b.onclick = () => { BUILD.spec.viz = v.key; BUILD.result = null; render(); };
    tiles.appendChild(b);
  });
  panel.appendChild(viz);
  B_ZONES.forEach(z => panel.appendChild(bZone(z)));
  const foot = el(`<div class="dcb-pfoot">
    <span class="t12 fnt">${esc(BUILD.spec.viz)} · 기준 ${BUILD.spec.dimensions.length} · 값 ${BUILD.spec.metrics.length} · 조건 ${BUILD.spec.filters.length}</span>
    <button class="lnk" id="bReset">초기화</button></div>`);
  $('#bReset', foot).onclick = () => {
    buildReset(BUILD.spec.modelId);
    buildLoadColumns(BUILD.spec.modelId); render();
  };
  panel.appendChild(foot);
  grid.appendChild(panel);

  /* 우 — 결과 */
  const right = el('<div class="col" style="min-width:0"></div>');
  bResult(right);
  grid.appendChild(right);

  /* 동작 */
  const sel = $('#bDash', bar), nd = $('#bNewDash', bar);
  sel.onchange = () => { nd.style.display = sel.value === '__new' ? '' : 'none'; };
  $('#bName', bar).oninput = (e) => { BUILD.name = e.target.value; };
  $('#bBack', bar).onclick = () => { S.anaView = ''; S.bPick = null; render(); };
  $('#bRun', bar).onclick = buildRun;
  $('#bSave', bar).onclick = async () => {
    const name = (BUILD.name || '').trim();
    if (!name) { toast('분석 이름을 입력해 주세요.', 'warn'); $('#bName', bar).focus(); return; }
    const why = buildBlocked();
    if (why) { toast(why, 'warn'); return; }
    const body = { name, spec: BUILD.spec };
    if (sel.value === '__new') {
      const t = (nd.value || '').trim();
      if (!t) { toast('새 대시보드 이름을 입력해 주세요.', 'warn'); return; }
      body.newDashboardTitle = t;
    } else if (sel.value) body.dashboardId = Number(sel.value);

    BUILD.saving = true; render();
    try {
      const r = await api('/analytics/build/save',
        { method: 'POST', body: JSON.stringify(body) });
      toast(`「${r.name}」 저장됨` + (r.dashboardId ? ' · 대시보드에 추가' : ''));
      S.anaView = ''; ANA.data = null; await anaLoad(true);
      if (r.dashboardId) { delete ANA.frames[r.dashboardId]; anaOpenTab(r.dashboardId); }
    } catch (e) {
      toast((e && e.message) || '저장에 실패했습니다.', 'err');
    } finally { BUILD.saving = false; render(); }
  };

  if (S.bPick) bPicker();
}
