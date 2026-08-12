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
  const band = el(`<div class="ana-top row" style="align-items:center">
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

function bSec(title, extra) {
  return el(`<div class="ana-sec"><span class="sect-t">${esc(title)}`
    + `${extra || ''}</span></div>`);
}

function bViz(host) {
  const sec = bSec('어떻게 볼까요');
  sec.appendChild(el(`<div class="row g6" style="flex-wrap:wrap">${
    (BUILD.opts.viz || []).map(v =>
      `<button class="pk ${BUILD.spec.viz === v.key ? 'on' : ''}" data-v="${esc(v.key)}">`
      + `${esc(v.label)}</button>`).join('')}</div>`));
  host.appendChild(sec);
  $$('[data-v]', sec).forEach(b => b.onclick = () => {
    BUILD.spec.viz = b.dataset.v; BUILD.result = null; render();
  });
}

function bDims(host) {
  const r = buildRule();
  if (r.dims[1] === 0) return;
  const sec = bSec('무엇으로 나눌까요',
    ` <span class="mt" style="text-transform:none;font-weight:400">${
      BUILD.spec.dimensions.length}/${r.dims[1]}</span>`);
  sec.appendChild(el(`<div class="row g6" style="flex-wrap:wrap">${
    buildCols().map(c =>
      `<button class="pk ${BUILD.spec.dimensions.includes(c.name) ? 'on' : ''}"
        data-d="${esc(c.name)}" title="${esc(c.desc || c.type || '')}">${esc(c.label)}</button>`
    ).join('')}</div>`));
  host.appendChild(sec);
  $$('[data-d]', sec).forEach(b => b.onclick = () => {
    const n = b.dataset.d, a = BUILD.spec.dimensions, i = a.indexOf(n);
    if (i >= 0) a.splice(i, 1);
    else if (a.length < r.dims[1]) a.push(n);
    else { toast(`${r.dims[1]}개까지 고를 수 있습니다.`, 'warn'); return; }
    BUILD.result = null; render();
  });
}

function bMetrics(host) {
  const r = buildRule();
  const sec = bSec('무엇을 볼까요',
    ` <span class="mt" style="text-transform:none;font-weight:400">${
      BUILD.spec.metrics.length}/${r.metrics[1]}</span>`);
  const cols = buildCols();

  BUILD.spec.metrics.forEach((m, i) => {
    sec.appendChild(el(`<div class="row g6">
      <select class="inp f1" data-mc="${i}">
        <option value="">컬럼 선택</option>
        ${cols.map(c => `<option value="${esc(c.name)}" ${m.col === c.name ? 'selected' : ''}>`
          + `${esc(c.label)}</option>`).join('')}
      </select>
      <select class="inp" data-ma="${i}" style="max-width:116px">
        ${(BUILD.opts.agg || []).map(a =>
          `<option value="${esc(a.key)}" ${m.agg === a.key ? 'selected' : ''}>${esc(a.label)}</option>`
        ).join('')}
      </select>
      <button class="iconbtn" data-mx="${i}" title="지우기">${ic14('x')}</button>
    </div>`));
  });
  if (BUILD.spec.metrics.length < r.metrics[1]) {
    sec.appendChild(el(`<button class="btn gho sm" id="bAddM">${ic14('plus')}추가</button>`));
  }
  host.appendChild(sec);

  const add = $('#bAddM', sec);
  if (add) add.onclick = () => {
    BUILD.spec.metrics.push({ col: '', agg: 'SUM' }); BUILD.result = null; render();
  };
  $$('[data-mc]', sec).forEach(s => s.onchange = (e) => {
    BUILD.spec.metrics[+s.dataset.mc].col = e.target.value; BUILD.result = null; render();
  });
  $$('[data-ma]', sec).forEach(s => s.onchange = (e) => {
    BUILD.spec.metrics[+s.dataset.ma].agg = e.target.value; BUILD.result = null; render();
  });
  $$('[data-mx]', sec).forEach(b => b.onclick = () => {
    BUILD.spec.metrics.splice(+b.dataset.mx, 1); BUILD.result = null; render();
  });
}

/* 조건은 구조화해서 받는다. 자유 SQL 을 받지 않는 이유는 조회 전용 보장이
   문자열 검사로 내려가면 무의미해지기 때문이다. */
function bFilters(host) {
  const cols = buildCols(), ops = BUILD.opts.ops || [];
  const sec = bSec('조건');
  BUILD.spec.filters.forEach((f, i) => {
    const op = ops.find(o => o.key === f.op) || ops[0] || {};
    sec.appendChild(el(`<div class="row g6">
      <select class="inp f1" data-fc="${i}">
        <option value="">컬럼 선택</option>
        ${cols.map(c => `<option value="${esc(c.name)}" ${f.col === c.name ? 'selected' : ''}>`
          + `${esc(c.label)}</option>`).join('')}
      </select>
      <select class="inp" data-fo="${i}" style="max-width:100px">
        ${ops.map(o => `<option value="${esc(o.key)}" ${f.op === o.key ? 'selected' : ''}>`
          + `${esc(o.label)}</option>`).join('')}
      </select>
      ${op.needsValue === false ? ''
        : `<input class="inp" data-fv="${i}" style="max-width:132px" placeholder="값"
             value="${esc(f.val ?? '')}">`}
      <button class="iconbtn" data-fx="${i}" title="지우기">${ic14('x')}</button>
    </div>`));
  });
  sec.appendChild(el(`<button class="btn gho sm" id="bAddF">${ic14('plus')}추가</button>`));
  host.appendChild(sec);

  $('#bAddF', sec).onclick = () => {
    BUILD.spec.filters.push({ col: '', op: '==', val: '' }); BUILD.result = null; render();
  };
  $$('[data-fc]', sec).forEach(s => s.onchange = (e) => {
    BUILD.spec.filters[+s.dataset.fc].col = e.target.value; BUILD.result = null; render();
  });
  $$('[data-fo]', sec).forEach(s => s.onchange = (e) => {
    BUILD.spec.filters[+s.dataset.fo].op = e.target.value; BUILD.result = null; render();
  });
  $$('[data-fv]', sec).forEach(s => s.oninput = (e) => {
    BUILD.spec.filters[+s.dataset.fv].val = e.target.value; BUILD.result = null;
  });
  $$('[data-fx]', sec).forEach(b => b.onclick = () => {
    BUILD.spec.filters.splice(+b.dataset.fx, 1); BUILD.result = null; render();
  });
}

/* 결과 — P4-1 은 표다. 최종 UX 가 아니다. P4-2 에서 같은 결과로 차트를 그린다. */
function bResult(host) {
  const sec = bSec('결과', BUILD.result
    ? ` <span class="mt" style="text-transform:none;font-weight:400">${BUILD.result.rowCount}행</span>` : '');
  if (BUILD.error) {
    sec.appendChild(el(`<div class="ana-empty">${esc(BUILD.error)}</div>`));
  } else if (BUILD.running) {
    sec.appendChild(el('<div class="ana-empty">실행 중…</div>'));
  } else if (!BUILD.result) {
    sec.appendChild(el(`<div class="ana-empty">${
      esc(buildBlocked() || '「실행」을 눌러 결과를 확인하세요.')}</div>`));
  } else if (!BUILD.result.rows.length) {
    sec.appendChild(el('<div class="ana-empty">조건에 맞는 데이터가 없습니다.</div>'));
  } else {
    /* 플랫폼의 표 문법 — .tbl 은 CSS grid 이고 --cols 로 열을 정한다.
       데이터 미리보기 탭과 같은 모양이어야 다른 도구처럼 느껴지지 않는다. */
    const h = BUILD.result.headers || BUILD.result.columns;
    const wrap = el(`<div style="overflow:auto;max-height:420px">
      <div class="tbl" style="--cols:${h.map(() => 'minmax(120px,1fr)').join(' ')};min-width:100%"></div>
    </div>`);
    const t = $('.tbl', wrap);
    t.appendChild(el(`<div class="th">${h.map(x => `<span>${esc(x)}</span>`).join('')}</div>`));
    BUILD.result.rows.forEach(r => t.appendChild(el(
      `<div class="tr static" style="min-height:34px">${r.map(v =>
        `<span class="mono t12 trunc">${v === null || v === undefined ? '—' : esc(v)}</span>`
      ).join('')}</div>`)));
    sec.appendChild(wrap);
  }
  host.appendChild(sec);
}

function anaBuild(p) {
  buildLoadOptions();
  const model = ((BUILD.opts && BUILD.opts.models) || [])
    .find(m => m.id === BUILD.spec.modelId);

  const band = el(`<div class="ana-top row" style="align-items:center">
    <button class="iconbtn" id="bBack" title="데이터 선택으로">${ic14('chevl')}</button>
    <div class="f1 col g4" style="min-width:0">
      <input class="ana-name" id="bName" placeholder="분석 이름"
        style="font-size:var(--fs-page)" value="${esc(BUILD.name || '')}">
      <p class="td row g6" style="margin:0;align-items:center">
        ${model ? grpTag('DATA MART') : ''}
        ${model ? `<a class="lnk" id="bToModel" style="font-size:var(--fs-body)"
          title="이 분석이 쓰는 데이터 모델을 봅니다">${esc(model.name || model.id)}</a>` : ''}</p>
    </div>
      <select class="inp sm" id="bDash" style="max-width:168px">
        <option value="">대시보드에 넣지 않음</option>
        ${((ANA.data && ANA.data.dashboards) || []).map(d =>
          `<option value="${d.id}">${esc(d.name)}</option>`).join('')}
        <option value="__new">＋ 새 대시보드…</option>
      </select>
      <input class="inp sm" id="bNewDash" placeholder="새 대시보드 이름"
        style="max-width:160px;display:none">
      <button class="btn sm" id="bRun" ${BUILD.running ? 'disabled' : ''}>
        ${ic14('play')}${BUILD.running ? '실행 중…' : '실행'}</button>
      <button class="btn pri sm" id="bSave" ${BUILD.saving ? 'disabled' : ''}>
        ${ic14('save')}${BUILD.saving ? '저장 중…' : '저장'}</button>
  </div>`);
  p.appendChild(band);
  /* 분석에서 그 데이터가 어디서 왔는지로 되돌아가는 통로. 흐름의 마지막
     화면에서도 앞 단계를 볼 수 있어야 서비스가 한 덩어리로 읽힌다. */
  const toModel = $('#bToModel', band);
  if (toModel) toModel.onclick = () => go('modeling', BUILD.spec.modelId);
  const scroll = el('<div class="ana-scroll"></div>');
  const wrap = el('<div class="ana-inner"></div>');
  scroll.appendChild(wrap); p.appendChild(scroll);
  p = wrap;

  if (!BUILD.opts) {
    p.appendChild(el(`<div class="ana-empty">${BUILD.error ? esc(BUILD.error) : '불러오는 중…'}</div>`));
    $('#bBack', band).onclick = () => { S.anaView = 'pick'; render(); };
    return;
  }

  /* 왼쪽은 설정, 오른쪽은 결과. 흐름이 왼→오 로 읽히게 둔다.
     둘 다 박스를 두지 않는다 — 섹션 제목과 컨트롤만 있다. */
  const cols = el('<div class="row t g14" style="align-items:flex-start"></div>');
  const left = el('<div class="col" style="width:320px;flex:none"></div>');
  const right = el('<div class="col f1" style="min-width:0"></div>');
  cols.appendChild(left); cols.appendChild(right);
  p.appendChild(cols);

  bViz(left); bDims(left); bMetrics(left); bFilters(left);
  bResult(right);

  const sel = $('#bDash', band), nd = $('#bNewDash', band);
  sel.onchange = () => { nd.style.display = sel.value === '__new' ? '' : 'none'; };
  $('#bName', band).oninput = (e) => { BUILD.name = e.target.value; };
  $('#bBack', band).onclick = () => { S.anaView = 'pick'; render(); };
  $('#bRun', band).onclick = buildRun;

  $('#bSave', band).onclick = async () => {
    const name = (BUILD.name || '').trim();
    if (!name) { toast('분석 이름을 입력해 주세요.', 'warn'); $('#bName', band).focus(); return; }
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
      ANA.data = null; await anaLoad(true);
      S.anaView = '';
      if (r.dashboardId) {
        anaOpenTab(r.dashboardId);
      }
    } catch (e) {
      toast((e && e.message) || '저장에 실패했습니다.', 'err');
    } finally { BUILD.saving = false; render(); }
  };
}
