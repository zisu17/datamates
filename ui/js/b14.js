/* ── b14 — ── b14 — v2.1 — 데이터 품질: 대시보드 · 규칙 · 위반 내역 ── (index.html 블록에서 기계적 추출, 동작 불변) */

/* ============================================================
   v2.1 — 데이터 품질: 대시보드 · 규칙 · 위반 내역
   규칙 객체(QRULES)는 데이터 모델링의 품질 규칙 탭과 같은 것을 쓴다.
   ============================================================ */
const QTABS = ['대시보드', '규칙', '위반 내역'];

pageQuality = function () {
  const r = R();
  const p = el('<div class="page"></div>');
  const act = S.qTab === '규칙' && r.canModel
    ? `<button class="btn pri sm" id="qAdd">${ic14('plus')}새 규칙</button>` : '';
  p.appendChild(el(`<div class="page-h">
    <div><h1 class="page-t">데이터 품질</h1></div>
    <div class="page-a">${act}${r.tech ? `<button class="btn sm" id="qRep">${ic14('doc')}결과 내려받기</button>` : ''}</div></div>`));
  const tabs = el(`<div class="qtabs">${QTABS.map(x => {
    const n = x === '위반 내역' ? QRULES.filter(q => q.active && q.status !== 'ok').length : 0;
    return `<button class="tab ${S.qTab === x ? 'on' : ''}" data-qt="${x}">${x}${n ? ` <span class="t11" style="color:var(--err)">${n}</span>` : ''}</button>`;
  }).join('')}</div>`);
  p.appendChild(tabs);
  const body = el('<div class="col g14"></div>');
  if (S.qTab === '규칙') qRules(body, r);
  else if (S.qTab === '위반 내역') qViolations(body, r);
  else qDash(body, r);
  p.appendChild(body);
  $$('[data-qt]', tabs).forEach(x => x.onclick = () => { S.qTab = x.dataset.qt; render(); });
  const a = $('#qAdd', p); if (a) a.onclick = () => ruleModal(null, null);
  // 결과 내려받기 — 서버가 CSV 를 만들어 준다
  const b2 = $('#qRep', p);
  if (b2) b2.onclick = () => { location.href = BASE + '/quality/report:export'; };
  setTimeout(() => wireToggles(p), 0);

  /* 대시보드 탭 — 최근 7일 품질 점수를 실측(/history)으로 채운다 */
  if (S.qTab === '대시보드') {
    if (!HIST.data && !HIST.error) loadHistory();
    const d = HIST.data;
    const host = $$('.card-t', p).find(x => x.textContent.trim() === '최근 7일 품질 점수');
    if (host) {
      const body = $('.card-b', host.closest('.card'));
      if (body) {
        const items = d && d.testDaily;
        if (!d) body.innerHTML = loadingHtml;
        else if (!items.length)
          body.innerHTML = '<div class="empty" style="padding:24px">아직 검사 이력이 없습니다.</div>';
        else body.innerHTML = `
        <div class="trend">${items.map(x => {
          const v = x.passRate == null ? 0 : x.passRate;
          return `<i class="${v >= 90 ? '' : v >= 80 ? 'w' : 'e'}" style="height:${Math.max(8, v)}%"
                     title="${x.date} · 통과율 ${v}% (${x.passes}/${x.runs}${x.warns ? ` · 주의 ${x.warns}` : ''}${x.fails ? ` · 실패 ${x.fails}` : ''})"></i>`;
        }).join('')}</div>
        <div class="row g6" style="margin-top:7px">${items.map(x =>
          `<span class="t11 fnt f1" style="text-align:center;max-width:52px">${mmdd(x.date)}</span>`).join('')}</div>`;
      }
    }
  }
  return p;
};

/* ── 대시보드 ── */
function qDash(p, r) {
  const on = QRULES.filter(q => q.active);
  const okN = on.filter(q => q.status === 'ok').length;
  const errN = on.filter(q => q.status === 'err').length;
  const warnN = on.filter(q => q.status === 'warn').length;
  const rate = on.length ? Math.round(okN / on.length * 100) : 100;
  const models = [...new Set(on.filter(q => q.status !== 'ok').map(q => q.model))];

  const kp = el('<div class="kpis" style="grid-template-columns:repeat(4,1fr)"></div>');
  kp.appendChild(kpi('품질 점수', rate + '점', `규칙 ${on.length}개 중 ${okN}개 통과`, rate >= 90 ? 'ok' : rate >= 70 ? 'warn' : 'err'));
  kp.appendChild(kpi('실패', errN + '건', '바로 확인이 필요합니다', 'err', () => { S.qTab = '위반 내역'; render(); }));
  kp.appendChild(kpi('주의', warnN + '건', '영향은 작지만 확인하세요', 'warn', () => { S.qTab = '위반 내역'; render(); }));
  kp.appendChild(kpi('영향받는 데이터', models.length + '개', models.map(m => (byId(m) || {}).name).filter(Boolean).join(' · ') || '없음'));
  p.appendChild(kp);

  const days = ['07.31', '08.01', '08.02', '08.03', '08.04', '08.05', '08.06'];
  const vals = [100, 100, 88, 100, 75, 88, rate];
  const tr = el(`<section class="card"><div class="card-h"><span class="card-t">최근 7일 품질 점수</span>
    <span class="t11 fnt sp">매일 05:00 검사 기준</span></div>
    <div class="card-b"><div class="trend">${vals.map(v => `<i class="${v >= 90 ? '' : v >= 80 ? 'w' : 'e'}" style="height:${Math.max(8, v)}%" title="${v}점"></i>`).join('')}</div>
      <div class="row g6" style="margin-top:7px">${days.map(d => `<span class="t11 fnt f1" style="text-align:center;max-width:52px">${d}</span>`).join('')}</div>
    </div></section>`);
  p.appendChild(tr);

  const bad = on.filter(q => q.status !== 'ok');
  p.appendChild(el(`<div class="row"><span class="b6 t15">확인이 필요한 규칙 ${bad.length}건</span></div>`));
  if (!bad.length) p.appendChild(el(`<div class="card"><div class="empty" style="padding:34px 20px">${ic('checkc')}
    <span class="empty-t">모든 규칙이 통과했습니다.</span></div></div>`));
  const wrap = el('<div class="col g12"></div>');
  bad.forEach(q => wrap.appendChild(ruleCard(q, r.tech)));
  p.appendChild(wrap);

  p.appendChild(el(`<div class="row"><span class="b6 t15">데이터별 품질</span></div>`));
  const card = el(`<section class="card"><div class="card-b tight">
    <div class="tbl" style="--cols:minmax(0,1.4fr) 96px 96px 96px 88px"></div></div></section>`);
  const t = $('.tbl', card);
  t.appendChild(el(`<div class="th"><span>데이터</span><span>규칙</span><span>통과</span><span>확인 필요</span><span>상태</span></div>`));
  [...new Set(QRULES.map(q => q.model))].forEach(mid => {
    const d = byId(mid); if (!d) return;
    const rs = QRULES.filter(q => q.model === mid && q.active);
    const ok = rs.filter(q => q.status === 'ok').length;
    const st = qStatusOf(mid);
    const row = el(`<div class="tr">
      <span class="c2"><span class="b6 trunc">${esc(d.name)}</span><span class="sub mono trunc">${esc(d.phys)}</span></span>
      <span class="t12 mut num">${rs.length}개</span><span class="t12 mut num">${ok}개</span>
      <span class="t12 num" ${rs.length - ok ? 'style="color:var(--err)"' : ''}>${rs.length - ok}개</span>
      <span>${st === 'ok' ? '<span class="bdg ok">정상</span>' : st === 'warn' ? '<span class="bdg warn">주의</span>' : '<span class="bdg err">실패</span>'}</span></div>`);
    row.onclick = () => { S.qQuery = d.name; S.qTab = '규칙'; render(); };
    t.appendChild(row);
  });
  p.appendChild(card);
}

/* ── 규칙 목록 ── */
function qRules(p, r) {
  const types = ['전체', ...Object.keys(QTYPES).map(k => QTYPES[k].label)];
  const bar = el(`<div class="row g8" style="flex-wrap:wrap">
    <div class="srch" style="flex:1 1 240px;max-width:340px">${ic14('search')}
      <input class="inp" id="qQ" placeholder="규칙 · 데이터 · 컬럼 검색" value="${esc(S.qQuery)}" style="height:32px;padding-left:28px"></div>
    <select class="inp" id="qT" style="height:32px;width:150px;flex:none">
      ${types.map(x => `<option ${S.qType === x ? 'selected' : ''}>${x}</option>`).join('')}</select>
    <span class="t12 fnt sp">모델링 화면의 품질 규칙 탭과 같은 규칙입니다.</span></div>`);
  p.appendChild(bar);

  const q = S.qQuery.trim().toLowerCase();
  const list = QRULES.filter(x => {
    if (S.qType !== '전체' && QTYPES[x.type].label !== S.qType) return false;
    if (!q) return true;
    const d = byId(x.model) || {};
    return (x.name + ' ' + x.col + ' ' + (d.name || '') + ' ' + (d.phys || '') + ' ' + x.cond).toLowerCase().includes(q);
  });

  const card = el(`<section class="card"><div class="card-b tight">
    <div class="tbl" style="--cols:minmax(0,1.5fr) minmax(0,1.1fr) 92px 78px 84px 56px"></div></div></section>`);
  const t = $('.tbl', card);
  t.appendChild(el(`<div class="th"><span>규칙</span><span>대상 데이터</span><span>검사 유형</span><span>심각도</span><span>최근 결과</span><span>사용</span></div>`));
  if (!list.length) t.appendChild(el(`<div class="tr static" style="grid-template-columns:1fr">
    <span class="t12 fnt" style="padding:18px 0;text-align:center">조건에 맞는 규칙이 없습니다.</span></div>`));
  list.forEach(x => {
    const d = byId(x.model) || {};
    const row = el(`<div class="tr">
      <span class="c2"><span class="b6 trunc" title="${esc(x.name)}">${esc(x.name)}</span>
        <span class="sub mono trunc" title="${esc(x.cond)}">${esc(x.cond)}</span></span>
      <span class="c2"><span class="t12 trunc">${esc(d.name || x.model)}</span><span class="sub mono trunc">${esc(x.col)}</span></span>
      <span class="t12 mut">${esc(QTYPES[x.type].label)}</span>
      <span><span class="sevb sev-${x.sev}">${x.sev === 'error' ? '오류' : '주의'}</span></span>
      <span>${!x.active ? '<span class="bdg wait">사용 안 함</span>'
        : x.status === 'ok' ? '<span class="bdg ok">통과</span>' : x.status === 'warn' ? '<span class="bdg warn">주의</span>' : '<span class="bdg err">실패</span>'}</span>
      <span><span class="tgl ${x.active ? 'on' : ''}" data-tg="${x.id}"><i></i></span></span></div>`);
    row.onclick = (ev) => { if (ev.target.closest('[data-tg]')) return; ruleModal(x.id, null); };
    $('[data-tg]', row).onclick = (ev) => { ev.stopPropagation(); x.active = !x.active; render(); };
    t.appendChild(row);
  });
  p.appendChild(card);

  const qq = $('#qQ', bar);
  qq.oninput = (e) => { S.qQuery = e.target.value; };
  qq.onchange = () => render();
  qq.onkeydown = (e) => { if (e.key === 'Enter') render(); };
  $('#qT', bar).onchange = (e) => { S.qType = e.target.value; render(); };
}

/* ── 위반 내역 ── */
function qViolations(p, r) {
  const bad = QRULES.filter(q => q.active && q.status !== 'ok');
  if (!bad.length) { p.appendChild(el(`<div class="card"><div class="empty" style="padding:44px 20px">${ic('checkc')}
    <span class="empty-t">위반 내역이 없습니다.</span><span>모든 규칙이 통과했습니다.</span></div></div>`)); return; }
  p.appendChild(el(`<div class="row"><span class="b6 t15">위반 ${bad.length}건</span>
    <span class="t12 fnt sp">최근 검사 오늘 05:19 기준</span></div>`));
  bad.forEach(q => {
    const d = byId(q.model) || {};
    const open = S.vSel === q.id;
    const c = el(`<section class="card"><div class="card-b col g10">
      <div class="row g10" style="align-items:flex-start">
        <span class="sevb sev-${q.sev}" style="margin-top:2px">${q.sev === 'error' ? '오류' : '주의'}</span>
        <span class="col f1" style="gap:3px;min-width:0">
          <span class="b6 t14 trunc">${esc(q.name)}</span>
          <span class="t12 mut">${esc(q.plain)}</span>
          <span class="t11 fnt">대상 ${esc(d.name || q.model)} · 컬럼 ${esc(q.col)} · ${esc(q.cnt)}건 · 처음 발견 ${esc(q.firstSeen)}</span>
          ${r.tech ? `<span class="t11 fnt mono">${esc(q.cond)}</span>` : ''}</span>
        <button class="btn sm" data-tgv="${q.id}">${open ? '접기' : '자세히'}</button></div>
      ${q.impact ? `<div class="note warn">${ic('alert')}<span>${esc(q.impact)}</span></div>` : ''}
    </div></section>`);
    const body = $('.card-b', c);
    if (open) {
      if (q.rows.length) {
        const t = el(`<div class="tbl" style="--cols:repeat(${q.rows[0].length},minmax(96px,1fr));border:1px solid var(--line);border-radius:var(--r-m);overflow:hidden"></div>`);
        t.appendChild(el(`<div class="th">${(d.cols || []).slice(0, q.rows[0].length).map(cc => `<span>${esc(cc[1])}</span>`).join('') || q.rows[0].map((_, i) => `<span>값 ${i + 1}</span>`).join('')}</div>`));
        q.rows.forEach(rw => t.appendChild(el(`<div class="tr static" style="min-height:34px">${rw.map(v => `<span class="mono t12 trunc">${esc(v)}</span>`).join('')}</div>`)));
        body.appendChild(t);
        body.appendChild(el(`<span class="t11 fnt">위반 ${q.cnt}건 중 ${q.rows.length}건을 표시합니다.</span>`));
      } else body.appendChild(el('<span class="t12 fnt">표시할 상세 행이 없습니다.</span>'));
    }
    const f = el('<div class="row g6"></div>');
    const b1 = el(`<button class="btn sm">${ic14('model')}데이터 모델링에서 열기</button>`);
    b1.onclick = () => { S.sel = q.model; S.mTab = '품질 규칙'; S.mPanelOpen = true; go('modeling'); };
    f.appendChild(b1);
    if (q.pipe) { const b2 = el(`<button class="btn sm">${ic14('pipe')}파이프라인 보기</button>`);
      b2.onclick = () => go('pipeline', q.pipe); f.appendChild(b2); }
    const b3 = el(`<button class="btn sm sp">${ic14('set')}규칙 설정</button>`);
    b3.onclick = () => ruleModal(q.id, null);
    body.appendChild(f);
    $(`[data-tgv="${q.id}"]`, c).onclick = () => { S.vSel = open ? null : q.id; render(); };
    p.appendChild(c);
  });
}

function ruleCard(q, tech) {
  const d = byId(q.model) || {};
  const c = el(`<section class="card"><div class="card-b col g8">
    <div class="row g10" style="align-items:flex-start">
      <span class="sevb sev-${q.sev}" style="margin-top:2px">${q.sev === 'error' ? '오류' : '주의'}</span>
      <span class="col f1" style="gap:3px;min-width:0">
        <span class="b6 t14 trunc">${esc(q.name)}</span>
        <span class="t12 mut">${esc(q.plain)}</span>
        <span class="t11 fnt">대상 ${esc(d.name || q.model)}${tech ? ` · ${esc(q.cond)}` : ''}</span></span>
      <span class="t12 num" style="color:var(--err)">${q.cnt ? q.cnt + '건' : ''}</span></div>
  </div></section>`);
  c.style.cursor = 'pointer';
  c.onclick = () => { S.vSel = q.id; S.qTab = '위반 내역'; render(); };
  return c;
}

/* ── 규칙 설정 모달 (모델링·품질 공용) ── */
function ruleModal(ruleId, modelId) {
  const q = ruleId ? ruleById(ruleId) : null;
  const isNew = !q;
  const cur = q || { name: '', type: 'notnull', model: modelId || (D.find(d => d.kind === 'model') || {}).id, col: '', sev: 'error', active: true, cond: '' };
  const models = D.filter(d => d.kind !== 'source' || d.id === cur.model);
  const colsOf = (mid) => ((byId(mid) || {}).cols || []);
  const h = `<div class="modal-h"><span class="modal-t">${isNew ? '새 검사 규칙' : '규칙 설정'}</span>
      <button class="iconbtn sp" data-close>${ic('x')}</button></div>
    <div class="modal-b"><div class="frm">
      <div class="fr"><span class="fr-l">규칙 이름</span>
        <input class="inp" id="rNm" value="${esc(cur.name)}" placeholder="예) 주문번호 필수값"></div>
      <div class="fr"><span class="fr-l">검사 유형</span>
        <select class="inp" id="rTp">${Object.entries(QTYPES).map(([k, v]) =>
          `<option value="${k}" ${cur.type === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select>
        <span class="fr-h" id="rTpH"></span></div>
      <div class="fr"><span class="fr-l">대상 데이터</span>
        <select class="inp" id="rMd">${models.map(d => `<option value="${d.id}" ${cur.model === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select></div>
      <div class="fr"><span class="fr-l">대상 컬럼</span>
        <select class="inp" id="rCl"></select></div>
      <div class="fr"><span class="fr-l">심각도</span>
        <select class="inp" id="rSv">
          <option value="error" ${cur.sev === 'error' ? 'selected' : ''}>오류 — 이후 단계를 멈춥니다</option>
          <option value="warn" ${cur.sev === 'warn' ? 'selected' : ''}>주의 — 기록만 남깁니다</option></select></div>
      <div class="fr"><span class="fr-l">사용</span>
        <label class="chkrow"><input type="checkbox" class="chk" id="rAc" ${cur.active ? 'checked' : ''}> 이 규칙을 사용합니다</label></div>
      ${!isNew ? `<div class="fr"><span class="fr-l">최근 결과</span>
        <div class="info2" style="border-radius:6px">
          <div><span>결과</span><span>${q.status === 'ok' ? '통과' : q.status === 'warn' ? '주의 ' + q.cnt + '건' : '실패 ' + q.cnt + '건'}</span></div>
          <div><span>검사 시각</span><span>${esc(q.lastRun)}</span></div>
          </div></div>` : ''}
    </div></div>
    <div class="modal-f">${!isNew && R().canModel ? '<button class="btn sm dngr" id="rDel">규칙 삭제</button>' : ''}
      <button class="btn sp" data-close>취소</button>
      <button class="btn pri" id="rOk">${isNew ? '규칙 추가' : '저장'}</button></div>`;
  const { m, close } = modal(h, { sm: true });
  const md = $('#rMd', m), cl = $('#rCl', m), tp = $('#rTp', m);
  const paintCols = () => { cl.innerHTML = colsOf(md.value).map(c =>
    `<option value="${esc(c[0])}" ${cur.col === c[0] ? 'selected' : ''}>${esc(c[1])} (${esc(c[0])})</option>`).join(''); };
  const paintHint = () => { $('#rTpH', m).textContent = '검사 방식 · ' + QTYPES[tp.value].dbt; };
  paintCols(); paintHint();
  md.onchange = paintCols; tp.onchange = paintHint;
  $('#rOk', m).onclick = () => {
    const o = { name: $('#rNm', m).value.trim() || (QTYPES[tp.value].label + ' 검사'), type: tp.value,
      model: md.value, col: cl.value, sev: $('#rSv', m).value, active: $('#rAc', m).checked };
    if (isNew) { addRule(Object.assign(o, { cond: QTYPES[o.type].dbt })); toast('검사 규칙을 추가했습니다.'); }
    else { Object.assign(q, o); if (!ruleId) q.cond = QTYPES[o.type].dbt; toast('규칙을 저장했습니다.'); }
    close(); render();
  };
  const del = $('#rDel', m);
  if (del) del.onclick = () => { close(); confirmBox({ title: '규칙 삭제', danger: true, ok: '삭제',
    body: `${q.name} 규칙을 삭제하시겠습니까?\n\n데이터 모델링의 품질 규칙 탭에서도 사라집니다.` },
    () => { const i = QRULES.indexOf(q); if (i >= 0) QRULES.splice(i, 1); render(); toast('규칙을 삭제했습니다.'); }); };
}

/* ── 남은 카탈로그 연결 정리 ── */
/* (nodeMenu — 이후 정의가 값 캡처 없이 전면 교체. 죽은 층 제거) */
/* 홈 — 카탈로그 링크를 데이터 모델링으로 */

/* 파이프라인 — 워크스페이스는 묶음 필터로만 남긴다 */
/* (pagePipeline — 이후 정의가 값 캡처 없이 전면 교체. 죽은 층 제거) */
