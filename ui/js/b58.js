/* ── b58 — 메타 관리: Semantic Model · Metric · Business Glossary ── */
'use strict';

const META = {
  tab: 'models', summary: null, models: null, metrics: null, glossary: null,
  selectedModel: null, model: null, selectedMetric: null, selectedGlossary: null,
  query: '', loading: false,
};

function metaInvalidate() {
  META.summary = META.models = META.metrics = META.glossary = null;
  META.model = null;
}

async function metaLoad() {
  if (META.loading || (META.summary && META.models && META.metrics && META.glossary)) return;
  META.loading = true;
  try {
    const [summary, models, metrics, glossary] = await Promise.all([
      api('/semantic/summary'), api('/semantic/models'), api('/semantic/metrics'),
      api('/semantic/glossary'),
    ]);
    META.summary = summary; META.models = models.items || [];
    META.metrics = metrics.items || []; META.glossary = glossary.items || [];
    if (S.metadataModel && META.models.some(m => m.modelId === S.metadataModel)) {
      META.selectedModel = S.metadataModel; S.metadataModel = null;
    }
    if (!META.models.some(m => m.modelId === META.selectedModel))
      META.selectedModel = (META.models[0] || {}).modelId || null;
    if (!META.metrics.some(m => m.id === META.selectedMetric))
      META.selectedMetric = (META.metrics[0] || {}).id || null;
    if (!META.glossary.some(g => g.id === META.selectedGlossary))
      META.selectedGlossary = (META.glossary[0] || {}).id || null;
    if (META.selectedModel) await metaLoadModel(META.selectedModel, false);
  } catch (e) { fail(e); }
  finally { META.loading = false; if (S.page === 'metadata') render(); }
}

async function metaLoadModel(id, redraw) {
  try { META.model = await api(`/semantic/models/${enc(id)}`); }
  catch (e) { META.model = null; fail(e); }
  if (redraw !== false && S.page === 'metadata') render();
}

async function metaRefresh() {
  metaInvalidate();
  await metaLoad();
}

function metaKpis() {
  const s = META.summary || {};
  const box = el('<div class="meta-kpis"></div>');
  [
    ['DATA MART', s.dataMartCount, '시멘틱 정의 대상'],
    ['시멘틱 모델', s.semanticModelCount, '정의 완료'],
    ['등록 지표', s.metricCount, 'Simple Metric'],
    ['비즈니스 용어', s.glossaryCount, 'Glossary'],
    ['미정의 DATA MART', s.undefinedMartCount, '정의 필요'],
  ].forEach(([label, val, sub]) => box.appendChild(kpi(label, val == null ? '—' : val, sub,
    label === '미정의 DATA MART' && val ? 'warn' : null)));
  return box;
}

function pageMetadata() {
  metaLoad();
  const p = el('<div class="page meta-page"></div>');
  p.appendChild(el(`<div class="page-h"><div><h1 class="page-t">메타 관리</h1>
    <p class="page-d">기술 메타데이터에 비즈니스 의미를 더하고 분석 지표로 연결합니다.</p></div></div>`));
  p.appendChild(metaKpis());
  const tabs = tabStrip('sec');
  [['models', '시멘틱 모델'], ['metrics', '지표'], ['glossary', '비즈니스 용어']].forEach(([id, label]) => {
    const b = el(`<button class="tab ${META.tab === id ? 'on' : ''}">${label}</button>`);
    b.onclick = () => { META.tab = id; render(); }; tabs.appendChild(b);
  });
  p.appendChild(tabs);
  if (!META.summary) {
    p.appendChild(el('<div class="meta-empty">메타 정보를 불러오는 중…</div>'));
  } else if (META.tab === 'models') p.appendChild(metaModelsView());
  else if (META.tab === 'metrics') p.appendChild(metaMetricsView());
  else p.appendChild(metaGlossaryView());
  return p;
}

function metaModelsView() {
  const wrap = el('<div class="meta-work"></div>');
  const left = el(`<section class="meta-left"><div class="meta-left-h">
    <span class="b6 t13">DATA MART / Semantic Model</span>
    <span class="t11 fnt">${(META.models || []).length}개</span></div>
    <div class="srch meta-search">${ic14('search')}<input class="inp sm" placeholder="모델 검색"></div>
    <div class="meta-list"></div></section>`);
  const q = META.query.toLowerCase();
  const items = (META.models || []).filter(m => !q ||
    `${m.technicalName} ${m.businessName} ${m.physicalTable}`.toLowerCase().includes(q));
  const list = $('.meta-list', left);
  items.forEach(m => {
    const row = el(`<button class="meta-item ${META.selectedModel === m.modelId ? 'on' : ''}">
      <span class="c2 f1"><span class="b6 trunc">${esc(m.businessName || m.technicalName)}</span>
      <span class="sub trunc">${esc(m.technicalName)}</span></span>
      <span class="bdg ${m.defined ? 'ok' : 'wait'}">${m.defined ? '정의 완료' : '미정의'}</span></button>`);
    row.onclick = async () => { META.selectedModel = m.modelId; META.model = null; render();
      await metaLoadModel(m.modelId); };
    list.appendChild(row);
  });
  $('input', left).value = META.query;
  $('input', left).oninput = e => { META.query = e.target.value; render(); };
  wrap.appendChild(left);
  const right = el('<section class="meta-detail"></section>');
  if (!META.selectedModel) right.appendChild(el('<div class="meta-empty">DATA MART가 없습니다.</div>'));
  else if (!META.model || META.model.modelId !== META.selectedModel) {
    right.appendChild(el('<div class="meta-empty">정의를 불러오는 중…</div>'));
    metaLoadModel(META.selectedModel);
  } else right.appendChild(metaModelEditor(META.model));
  wrap.appendChild(right);
  return wrap;
}

function metaModelEditor(m) {
  const box = el(`<div class="meta-editor"><div class="meta-detail-h">
    <div class="c2 f1"><span class="meta-detail-t">${esc(m.businessName || m.technicalName)}</span>
    <span class="sub">${esc(m.technicalName)} · ${esc(m.physicalTable)}</span></div>
    ${m.defined ? '<span class="bdg ok">시멘틱 정의됨</span>' : '<span class="bdg wait">미정의</span>'}
    ${m.defined ? '<button class="btn sm dngr" id="metaModelDelete">정의 삭제</button>' : ''}
    <button class="btn pri sm" id="metaModelSave">저장</button></div>
    <div class="meta-form-grid">
      <label><span>기술 모델명</span><input class="inp mono" value="${esc(m.technicalName)}" disabled></label>
      <label><span>비즈니스 표시명</span><input class="inp" id="sBusiness" value="${esc(m.businessName || '')}"></label>
      <label class="wide"><span>설명</span><textarea class="inp" id="sDesc" rows="2">${esc(m.description || '')}</textarea></label>
      <label><span>물리 테이블명</span><input class="inp mono" value="${esc(m.physicalTable)}" disabled></label>
      <label><span>기본 시간 차원</span><select class="inp" id="sDefault"><option value="">선택 안 함</option></select></label>
    </div><div id="metaFields"></div></div>`);
  const timeDims = (m.dimensions || []).filter(d => d.dimensionType === 'time');
  timeDims.forEach(d => $('#sDefault', box).appendChild(
    el(`<option value="${esc(d.column)}" ${m.defaultTimeDimension === d.column ? 'selected' : ''}>${esc(d.businessName)} (${esc(d.column)})</option>`)));
  const host = $('#metaFields', box);
  [['entities', 'Entity', 'ID 역할 컬럼'], ['dimensions', 'Dimension', '분석 기준 컬럼'],
   ['measures', 'Measure', '집계할 값']].forEach(([key, title, desc]) =>
    host.appendChild(metaFieldSection(m, key, title, desc)));
  $('#metaModelSave', box).onclick = async () => {
    try {
      const body = { businessName: $('#sBusiness', box).value.trim(),
        description: $('#sDesc', box).value.trim(), defaultTimeDimension: $('#sDefault', box).value || null,
        entities: m.entities, dimensions: m.dimensions, measures: m.measures };
      META.model = await api(`/semantic/models/${enc(m.modelId)}`,
        { method: 'PUT', body: JSON.stringify(body) });
      toast('Semantic Model을 저장했습니다.'); await metaRefresh();
    } catch (e) { fail(e); }
  };
  if ($('#metaModelDelete', box)) $('#metaModelDelete', box).onclick = () => confirmModal({
    title: 'Semantic Model 정의 삭제',
    body: '이 정의와 연결된 지표 및 비즈니스 용어 연결이 함께 정리됩니다.',
    ok: '정의 삭제', danger: true,
  }).then(async ok => { if (!ok) return; try {
    const r = await api(`/semantic/models/${enc(m.modelId)}`, { method: 'DELETE' });
    toast(r.message); await metaRefresh();
  } catch (e) { fail(e); } });
  return box;
}

function metaFieldSection(model, key, title, desc) {
  const sec = el(`<div class="meta-fields"><div class="meta-fields-h"><div class="c2 f1">
    <span class="b6 t13">${title}</span><span class="t11 fnt">${desc}</span></div>
    <button class="btn sm">${ic14('plus')}추가</button></div><div class="meta-field-list"></div></div>`);
  const list = $('.meta-field-list', sec);
  (model[key] || []).forEach((f, i) => list.appendChild(metaFieldRow(model, key, f, i)));
  if (!(model[key] || []).length) list.appendChild(el(`<div class="meta-field-empty">정의된 ${title}가 없습니다.</div>`));
  $('.btn', sec).onclick = () => {
    const first = (model.columns || [])[0] || {};
    const f = { column: first.name || null, businessName: '', description: '',
      dimensionType: 'general', granularities: [], aggregation: key === 'measures' ? 'SUM' : null,
      displayFormat: 'number' };
    model[key].push(f); render();
  };
  return sec;
}

function metaFieldRow(model, key, f, idx) {
  const isDim = key === 'dimensions', isMeasure = key === 'measures';
  const colOptions = (isMeasure ? [{name:'', label:'COUNT(*)용 컬럼 없음'}] : []).concat(model.columns || []);
  const row = el(`<div class="meta-field-row">
    <select class="inp mono" data-k="column">${colOptions.map(c =>
      `<option value="${esc(c.name)}" ${String(f.column || '') === c.name ? 'selected' : ''}>${esc(c.name || '—')} ${c.type ? `· ${esc(c.type)}` : ''}</option>`).join('')}</select>
    <input class="inp" data-k="businessName" value="${esc(f.businessName || '')}" placeholder="비즈니스 표시명">
    <input class="inp" data-k="description" value="${esc(f.description || '')}" placeholder="설명">
    ${isDim ? `<select class="inp" data-k="dimensionType"><option value="general">일반</option>
      <option value="time" ${f.dimensionType === 'time' ? 'selected' : ''}>시간</option></select>` : ''}
    ${isMeasure ? `<select class="inp" data-k="aggregation">${['SUM','AVG','MIN','MAX','COUNT','COUNT_DISTINCT'].map(a =>
      `<option ${f.aggregation === a ? 'selected' : ''}>${a}</option>`).join('')}</select>
      <select class="inp" data-k="displayFormat">${['number','currency','percent','decimal','integer'].map(a =>
      `<option ${f.displayFormat === a ? 'selected' : ''}>${a}</option>`).join('')}</select>` : ''}
    <button class="iconbtn meta-field-x" title="삭제">${ic14('trash')}</button>
    ${isDim && f.dimensionType === 'time' ? `<div class="meta-grans">${['day','week','month','quarter','year'].map(g =>
      `<label><input type="checkbox" value="${g}" ${(f.granularities || []).includes(g) ? 'checked' : ''}>${g}</label>`).join('')}</div>` : ''}</div>`);
  $$('[data-k]', row).forEach(input => input.onchange = input.oninput = e => {
    f[e.target.dataset.k] = e.target.value;
    if (e.target.dataset.k === 'dimensionType') { if (e.target.value !== 'time') f.granularities = []; render(); }
  });
  $$('.meta-grans input', row).forEach(ch => ch.onchange = () => {
    f.granularities = $$('.meta-grans input:checked', row).map(x => x.value);
  });
  $('.meta-field-x', row).onclick = () => { model[key].splice(idx, 1); render(); };
  return row;
}

function metaMetricsView() {
  const wrap = el('<div class="meta-tab-body"></div>');
  const head = el(`<div class="meta-tab-head"><div><span class="b6">등록 지표 ${(META.metrics || []).length}개</span>
    <p class="page-d">하나의 Measure를 기반으로 계산하는 Simple Metric입니다.</p></div>
    <button class="btn pri sm">${ic14('plus')}지표 등록</button></div>`);
  $('.btn', head).onclick = () => metaMetricModal(); wrap.appendChild(head);
  const grid = el('<div class="meta-two"></div>');
  const tbl = el('<div class="card tight tbl meta-metric-table"><div class="th"><span>지표</span><span>설명</span><span>기준 모델</span><span>계산</span><span>형식</span></div></div>');
  (META.metrics || []).forEach(m => {
    const row = el(`<button class="tr ${META.selectedMetric === m.id ? 'on' : ''}">
      <span class="c2"><b class="trunc">${esc(m.displayName)}</b><span class="sub">${esc(m.metricKey)}</span></span>
      <span class="trunc">${esc(m.description || '—')}</span><span class="trunc">${esc(m.semanticModelName)}</span>
      <span class="mono trunc">${esc(m.calculation)}</span><span>${esc(m.displayFormat)}</span></button>`);
    row.onclick = () => { META.selectedMetric = m.id; render(); }; tbl.appendChild(row);
  });
  grid.appendChild(tbl);
  const m = (META.metrics || []).find(x => x.id === META.selectedMetric);
  grid.appendChild(m ? metaMetricDetail(m) : el('<div class="card meta-empty">등록된 지표가 없습니다.</div>'));
  wrap.appendChild(grid); return wrap;
}

function metaMetricDetail(m) {
  const d = el(`<div class="card meta-side-detail"><div class="card-h"><span class="card-t f1">${esc(m.displayName)}</span>
    <button class="btn sm" id="metricEdit">수정</button><button class="iconbtn" id="metricDelete" title="삭제">${ic14('trash')}</button></div>
    <div class="card-b col g14"><div><span class="meta-label">metric key</span><div class="mono">${esc(m.metricKey)}</div></div>
    <div><span class="meta-label">설명</span><div>${esc(m.description || '—')}</div></div>
    <div class="meta-tech"><span>${esc(m.semanticModelName)}</span><span>${ic14('chev')}</span>
      <span class="mono">${esc(m.column || '*')}</span><span>${ic14('chev')}</span><b class="mono">${esc(m.aggregation)}</b></div>
    <div><span class="meta-label">표시</span><div>${esc(m.displayFormat)}${m.unit ? ` · ${esc(m.unit)}` : ''}</div></div>
    <button class="btn pri" id="metricAnalyze">${ic14('chart')}분석에서 사용</button></div></div>`);
  $('#metricEdit', d).onclick = () => metaMetricModal(m);
  $('#metricDelete', d).onclick = () => confirmModal({ title:'지표 삭제', body:`${esc(m.displayName)} 지표를 삭제합니다.`, ok:'삭제', danger:true })
    .then(async ok => { if (!ok) return; try { const r = await api(`/semantic/metrics/${enc(m.id)}`, {method:'DELETE'});
      toast(r.message); await metaRefresh(); } catch (e) { fail(e); } });
  $('#metricAnalyze', d).onclick = () => {
    buildReset(m.semanticModel); BUILD.spec.viz = 'kpi';
    BUILD.spec.metrics = [{ col: m.column, agg: m.aggregation }];
    S.anaView = 'build'; go('analytics'); buildLoadColumns(m.semanticModel);
  };
  return d;
}

function metaMetricModal(metric) {
  const defined = (META.models || []).filter(m => m.defined);
  if (!defined.length) { toast('먼저 Semantic Model을 정의해 주세요.', 'warn'); return; }
  const current = metric ? metric.semanticModel : defined[0].modelId;
  const { m, close } = modal(`<div class="modal-h"><span class="modal-t">${metric ? '지표 수정' : '지표 등록'}</span>
    <button class="iconbtn sp" data-close>${ic('x')}</button></div><div class="modal-b" id="metricForm">불러오는 중…</div>
    <div class="modal-f"><button class="btn sp" data-close>취소</button><button class="btn pri" id="metricOk">저장</button></div>`, {sm:false});
  let detail = null;
  const values = Object.assign({ metricKey:'', displayName:'', description:'', semanticModel:current,
    measureId:'', displayFormat:'number', unit:'' }, metric || {});
  const draw = async mid => {
    detail = await api(`/semantic/models/${enc(mid)}`); values.semanticModel = mid;
    if (!(detail.measures || []).some(x => x.id === values.measureId)) values.measureId = (detail.measures[0] || {}).id || '';
    const f = $('#metricForm', m); f.innerHTML = `<div class="meta-modal-form">
      <label><span>metric key</span><input class="inp mono" id="fmKey" value="${esc(values.metricKey)}"></label>
      <label><span>표시명</span><input class="inp" id="fmName" value="${esc(values.displayName)}"></label>
      <label class="wide"><span>설명</span><textarea class="inp" id="fmDesc" rows="2">${esc(values.description)}</textarea></label>
      <label><span>Semantic Model</span><select class="inp" id="fmModel">${defined.map(x => `<option value="${esc(x.modelId)}" ${x.modelId === mid ? 'selected' : ''}>${esc(x.businessName || x.technicalName)}</option>`).join('')}</select></label>
      <label><span>Measure</span><select class="inp" id="fmMeasure">${(detail.measures || []).map(x => `<option value="${esc(x.id)}" ${x.id === values.measureId ? 'selected' : ''}>${esc(x.businessName)} · ${esc(x.aggregation)}(${esc(x.column || '*')})</option>`).join('')}</select></label>
      <label><span>표시 형식</span><select class="inp" id="fmFormat">${['number','currency','percent','decimal','integer'].map(x => `<option ${x === values.displayFormat ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      <label><span>단위</span><input class="inp" id="fmUnit" value="${esc(values.unit)}" placeholder="원, 명, 건 등"></label></div>`;
    $('#fmModel', f).onchange = e => { pull(); draw(e.target.value).catch(fail); };
  };
  const pull = () => { const f = $('#metricForm', m); if (!$('#fmKey', f)) return;
    values.metricKey=$('#fmKey',f).value; values.displayName=$('#fmName',f).value;
    values.description=$('#fmDesc',f).value; values.measureId=$('#fmMeasure',f).value;
    values.displayFormat=$('#fmFormat',f).value; values.unit=$('#fmUnit',f).value; };
  draw(current).catch(fail);
  $('#metricOk', m).onclick = async () => { pull(); try {
    await api(metric ? `/semantic/metrics/${enc(metric.id)}` : '/semantic/metrics',
      { method: metric ? 'PATCH' : 'POST', body: JSON.stringify(values) });
    close(); toast('지표를 저장했습니다.'); await metaRefresh();
  } catch (e) { fail(e); } };
}

function metaGlossaryView() {
  const wrap = el('<div class="meta-tab-body"></div>');
  const head = el(`<div class="meta-tab-head"><div><span class="b6">비즈니스 용어 ${(META.glossary || []).length}개</span>
    <p class="page-d">기술 모델·컬럼·시멘틱 정의·지표에 공통 언어를 연결합니다.</p></div>
    <button class="btn pri sm">${ic14('plus')}용어 등록</button></div>`);
  $('.btn', head).onclick = () => metaGlossaryModal(); wrap.appendChild(head);
  const grid = el('<div class="meta-two glossary"></div>');
  const tbl = el('<div class="card tight tbl meta-glossary-table"><div class="th"><span>용어</span><span>정의</span><span>분류/도메인</span><span>연결</span></div></div>');
  (META.glossary || []).forEach(g => {
    const row = el(`<button class="tr ${META.selectedGlossary === g.id ? 'on' : ''}"><span class="c2"><b class="trunc">${esc(g.term)}</b>
      <span class="sub trunc">${esc((g.synonyms || []).join(', '))}</span></span><span class="trunc">${esc(g.definition)}</span>
      <span>${esc(g.domain || '—')}</span><span>${(g.links || []).length}개</span></button>`);
    row.onclick = () => { META.selectedGlossary = g.id; render(); }; tbl.appendChild(row);
  }); grid.appendChild(tbl);
  const g = (META.glossary || []).find(x => x.id === META.selectedGlossary);
  grid.appendChild(g ? metaGlossaryDetail(g) : el('<div class="card meta-empty">등록된 용어가 없습니다.</div>'));
  wrap.appendChild(grid); return wrap;
}

function metaGlossaryDetail(g) {
  const d = el(`<div class="card meta-side-detail"><div class="card-h"><span class="card-t f1">${esc(g.term)}</span>
    <button class="btn sm" id="glEdit">수정</button><button class="iconbtn" id="glDelete">${ic14('trash')}</button></div>
    <div class="card-b col g14"><div><span class="meta-label">정의</span><div class="meta-definition">${esc(g.definition)}</div></div>
    <div><span class="meta-label">동의어</span><div>${esc((g.synonyms || []).join(', ') || '—')}</div></div>
    <div><span class="meta-label">분류/도메인</span><div>${esc(g.domain || '—')}</div></div>
    <div><span class="meta-label">연결 대상</span><div class="meta-links">${(g.links || []).map(l =>
      `<span class="tag"><b>${esc(metaLinkType(l.type))}</b> ${esc(l.label)}</span>`).join('') || '<span class="fnt">연결 없음</span>'}</div></div></div></div>`);
  $('#glEdit', d).onclick = () => metaGlossaryModal(g);
  $('#glDelete', d).onclick = () => confirmModal({title:'비즈니스 용어 삭제', body:`${esc(g.term)} 용어를 삭제합니다.`, ok:'삭제', danger:true})
    .then(async ok => { if (!ok) return; try { const r=await api(`/semantic/glossary/${enc(g.id)}`,{method:'DELETE'});
      toast(r.message); await metaRefresh(); } catch(e){fail(e);} });
  return d;
}

const metaLinkType = t => ({model:'모델', column:'컬럼', dimension:'Dimension', measure:'Measure', metric:'Metric'}[t] || t);

function metaGlossaryModal(item) {
  const {m, close} = modal(`<div class="modal-h"><span class="modal-t">${item ? '비즈니스 용어 수정':'비즈니스 용어 등록'}</span>
    <button class="iconbtn sp" data-close>${ic('x')}</button></div><div class="modal-b" id="glForm">연결 대상을 불러오는 중…</div>
    <div class="modal-f"><button class="btn sp" data-close>취소</button><button class="btn pri" id="glOk">저장</button></div>`);
  let options=[];
  Promise.all((META.models || []).filter(x=>x.defined).map(x=>api(`/semantic/models/${enc(x.modelId)}`))).then(details => {
    D.filter(d=>d.kind==='model').forEach(d => {
      options.push({type:'model', id:d.id, label:`모델 · ${d.name}`});
      (d.cols||[]).forEach(c=>options.push({type:'column',id:`${d.id}.${c[0]}`,label:`컬럼 · ${d.id}.${c[0]}`}));
    });
    details.forEach(sm => {
      (sm.dimensions||[]).forEach(f=>options.push({type:'dimension',id:f.id,label:`Dimension · ${sm.businessName} · ${f.businessName}`}));
      (sm.measures||[]).forEach(f=>options.push({type:'measure',id:f.id,label:`Measure · ${sm.businessName} · ${f.businessName}`}));
    });
    (META.metrics||[]).forEach(x=>options.push({type:'metric',id:x.id,label:`Metric · ${x.displayName}`}));
    const selected=new Set((item&&item.links||[]).map(l=>`${l.type}:${l.targetId}`));
    const f=$('#glForm',m); f.innerHTML=`<div class="meta-modal-form">
      <label><span>용어명</span><input class="inp" id="fgTerm" value="${esc(item&&item.term||'')}"></label>
      <label><span>분류/도메인</span><input class="inp" id="fgDomain" value="${esc(item&&item.domain||'')}"></label>
      <label class="wide"><span>정의</span><textarea class="inp" id="fgDef" rows="3">${esc(item&&item.definition||'')}</textarea></label>
      <label class="wide"><span>동의어 <small>(쉼표로 구분)</small></span><input class="inp" id="fgSyn" value="${esc((item&&item.synonyms||[]).join(', '))}"></label>
      <label class="wide"><span>연결 대상 <small>(여러 개 선택 가능)</small></span><select class="inp meta-link-select" id="fgLinks" multiple size="10">${options.map(o=>{
        const v=`${o.type}:${o.id}`; return `<option value="${esc(v)}" ${selected.has(v)?'selected':''}>${esc(o.label)}</option>`;}).join('')}</select></label></div>`;
  }).catch(fail);
  $('#glOk',m).onclick=async()=>{ const f=$('#glForm',m); if(!$('#fgTerm',f))return;
    const links=Array.from($('#fgLinks',f).selectedOptions).map(o=>{const i=o.value.indexOf(':');return{type:o.value.slice(0,i),targetId:o.value.slice(i+1)}});
    const body={term:$('#fgTerm',f).value,definition:$('#fgDef',f).value,domain:$('#fgDomain',f).value,
      synonyms:$('#fgSyn',f).value.split(',').map(x=>x.trim()).filter(Boolean),links};
    try{await api(item?`/semantic/glossary/${enc(item.id)}`:'/semantic/glossary',{method:item?'PATCH':'POST',body:JSON.stringify(body)});
      close();toast('비즈니스 용어를 저장했습니다.');await metaRefresh();}catch(e){fail(e);}};
}
