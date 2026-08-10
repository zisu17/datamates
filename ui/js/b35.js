/* ── b35 — ── b35 — 모델별 실행 상세 — 실행 정보 · 로그 · 실행 SQL · 품질 결과 ── (index.html 블록에서 기계적 추출, 동작 불변) */

/* 모델별 실행 상세 — 실행 정보 · 로그 · 실행 SQL · 품질 결과.
   높이·접기·자동 맞춤은 아래 pipeDockChrome 이 맡는다 (두 반환 지점 모두 거친다).
   높이는 여기서 정하지 않는다 — chrome 이 S.pdockH 로 다시 쓴다. */
function pipeDock(pp) {
  const g = pgraph(pp), runs = runsG(pp);
  const p = el(`<div class="dock" style="flex:0 1 auto;max-height:60%">
    <div class="grip-h" id="gripPH" title="높이 조절"></div></div>`);
  const n = S.pipeNodeK && nodeOf(g, S.pipeNodeK);
  if (!n || !byId(n.id)) {
    p.appendChild(el(`<div class="dock-h"><span class="b6 t13" style="padding:0 14px">모델 실행 정보</span></div>`));
    p.appendChild(el(`<div class="dock-b"><div class="empty">${ic('model')}
      <span class="empty-t">흐름도에서 모델을 선택해 주세요.</span></div></div>`));
    return pipeDockChrome(p);
  }
  const d = byId(n.id), rn = runs[n.key] || { st: 'wait' }, r = R();
  const TABS = ['실행 정보', '로그', '실행 SQL', '품질 결과'];
  if (!TABS.includes(S.pipeTab)) S.pipeTab = '실행 정보';
  p.appendChild(el(`<div class="dock-h">${TABS.map(t =>
    `<button class="tab ${S.pipeTab === t ? 'on' : ''}" data-ptab="${t}" style="height:36px">${t}</button>`).join('')}
    ${S.pipeTab === '실행 정보' ? '' : `<span class="row g6 sp" style="padding-right:14px">
      <span class="swatch" style="background:${grpColor(d)}"></span>
      <span class="b6 t12 trunc" style="max-width:220px">${esc(d.name)}</span></span>`}</div>`));
  const b = el('<div class="dock-b col g12"></div>');
  const ins = g.edges.filter(e => e.to === n.key).map(e => byId(nodeOf(g, e.from).id)).filter(Boolean);
  if (S.pipeTab === '실행 정보') {
    b.style.display = 'grid'; b.style.gridTemplateColumns = 'repeat(auto-fit,minmax(270px,1fr))';
    b.style.gap = '20px'; b.style.alignItems = 'start';
    b.appendChild(el(`<div class="kv">
      ${kvRow('모델', esc(d.name) + ' ' + layerTag(d.layer))}
      ${kvRow('저장 위치', `<span class="mono t12">${esc(d.phys)}</span>`)}
      ${kvRow('실행 상태', stBadge(rn.st))}
      ${kvRow('실행 시간', esc(rn.dur || '—'))}
      ${kvRow('처리 행 수', rn.st === 'ok' ? esc(rn.rows || '—') + '건' : rn.st === 'err' ? '0건 (품질 규칙 미통과)' : '—')}
      ${kvRow('생성 방식', d.mat === '—' ? 'SOURCE — 외부 적재' : esc(matKo(d.mat)))}
      ${kvRow('실행 환경', ENVS[pcfg2(pp).env].label)}
      </div>`));
    b.appendChild(el(`<div class="col g6"><span class="sect-t">입력 ${ins.length}개</span>
      <div class="col g4">${ins.length ? ins.map(x => `<div class="statrow">
        <span class="swatch" style="background:${grpColor(x)}"></span><span class="t12 f1 trunc">${esc(x.name)}</span>
        <span class="tag mono t11">${esc(grpOf(x))}</span></div>`).join('')
        : '<span class="t12 fnt">이 카드는 흐름의 시작점입니다.</span>'}</div>
      <span class="t11 fnt" style="margin-top:4px">가공 내용은 이 모델의 SQL에 들어 있습니다. 바꾸려면 데이터 모델에서 수정하세요.</span></div>`));
    const f = el('<div class="row g6" style="grid-column:1/-1"></div>');
    if (r.canPipeEdit && rn.st !== 'wait') { const b1 = el(`<button class="btn pri sm">${ic14('rot')}이 모델부터 다시 실행</button>`);
      b1.onclick = () => rerunG(pp, n.key); f.appendChild(b1); }
    const b2 = el(`<button class="btn sm">${ic14('doc')}모델 정의 열기</button>`);
    b2.onclick = () => { S.sel = n.id; S.mView = 'def'; S.mTab = 'SQL'; go('modeling'); };
    f.appendChild(b2);
    b.appendChild(f);
  } else if (S.pipeTab === '로그') {
    const log = rn.st === 'wait' ? ['아직 실행하지 않았습니다.']
      : rn.st === 'skip' ? ['앞 단계가 실패해 실행하지 않았습니다. (SKIP)']
      : rn.st === 'run' ? [`START model ${d.phys}`, '진행 중…']
      : rn.st === 'err' ? [`05:12:02  START model ${d.phys}`, `05:12:06  OK created ${d.phys}`,
          ...rulesOf(n.id).filter(t => t.active && t.status === 'err').map(t => `05:12:1${t.id.slice(-1)}  FAIL ${t.cnt}  ${t.cond} (${t.col})`),
          '05:12:13  품질 규칙 미통과로 이후 단계 중단', '05:12:13  Done. ERROR=' + rulesOf(n.id).filter(t => t.active && t.status === 'err').length]
      : [`05:12:02  START model ${d.phys}`, `05:12:0${(d.name.length % 8) + 1}  OK created ${d.phys} (${d.rows} rows)`,
         `05:12:12  Done. PASS=${rulesOf(n.id).length} ERROR=0`];
    b.appendChild(el(`<div class="code" style="max-height:100%">${esc(log.join('\n'))}</div>`));
    b.appendChild(el('<span class="t11 fnt">dbt 실행 로그 원본입니다.</span>'));
  } else if (S.pipeTab === '실행 SQL') {
    if (!d.sql) b.appendChild(el(`<div class="empty">${ic('db')}<span class="empty-t">SOURCE 는 SQL 없이 그대로 들어옵니다.</span></div>`));
    else {
      const a = sqlAudit(d.sql);
      b.appendChild(el(`<div class="rule q">${ic14('info')}<span>이 모델이 실행한 SQL입니다. 문장 ${a.stmts}개 · CTE ${a.cte}개 · 출력 1개.
        내용을 바꾸려면 데이터 모델에서 수정하세요.</span></div>`));
      b.appendChild(el(`<div class="code" style="max-height:100%;white-space:pre-wrap">${esc(d.sql)}</div>`));
    }
  } else {
    const rs = rulesOf(n.id).filter(x => x.active);
    if (!rs.length) b.appendChild(el(`<div class="empty">${ic('shield')}<span class="empty-t">등록된 품질 규칙이 없습니다.</span></div>`));
    else {
      const t = el(`<div class="tbl" style="--cols:minmax(0,1.4fr) minmax(0,1fr) 90px 84px;border:1px solid var(--line);border-radius:6px;overflow:hidden"></div>`);
      t.appendChild(el(`<div class="th"><span>규칙</span><span>검사 방식</span><span>위반</span><span>결과</span></div>`));
      rs.forEach(x => { const tr = el(`<div class="tr">
        <span class="c2"><span class="t13 trunc">${esc(x.name)}</span><span class="sub trunc">${esc(QTYPES[x.type].label)} · ${esc(x.col)}</span></span>
        <span class="t11 mono mut trunc">${esc(x.cond)}</span>
        <span class="t12 num">${x.cnt ? x.cnt + '건' : '—'}</span>
        <span>${x.status === 'ok' ? '<span class="bdg ok">통과</span>' : x.status === 'warn' ? '<span class="bdg warn">주의</span>' : '<span class="bdg err">실패</span>'}</span></div>`);
        tr.onclick = () => go('quality', x.id); t.appendChild(tr); });
      b.appendChild(t);
    }
  }
  p.appendChild(b);
  $$('[data-ptab]', p).forEach(x => x.onclick = () => { S.pipeTab = x.dataset.ptab; render(); });
  return pipeDockChrome(p);
}

/* 독의 틀 — 접기 · 높이 · 그립 · 자동 맞춤.
   원래 v2.9.1(접기·DOCK_MIN/MAX)과 v2.9.2(파이프라인 전용 높이·자동 맞춤)가
   같은 자리를 겹쳐 썼다. 뒤 층이 높이와 그립을 매번 다시 쓰므로 앞 층에서
   살아남는 것은 min 클래스 · 접기 버튼 · (접혔을 때) 그립 제거 뿐이었다.
   상수도 파이프라인 쪽(PDOCK_*)만 실제로 쓰인다. */
function pipeDockChrome(p) {
  p.classList.toggle('min', S.pdockMin);
  const head = $('.dock-h', p);
  if (head) {
    const t = el(`<button class="iconbtn sp" title="${S.pdockMin ? '상세 펼치기' : '상세 접기'}">${ic14(S.pdockMin ? 'chev' : 'chevd')}</button>`);
    t.onclick = () => { S.pdockMin = !S.pdockMin; render(); };
    head.appendChild(t);
  }
  const grip = $('.grip-h', p);
  if (S.pdockMin) { if (grip) grip.remove(); p.style.height = ''; return p; }

  p.style.height = (S.pdockH || 260) + 'px';
  /* 좁은 폭에서도 두 칸으로 배치되게 해 세로로 길어지지 않도록 */
  const bd0 = $('.dock-b', p);
  if (bd0 && bd0.style.display === 'grid') bd0.style.gridTemplateColumns = 'repeat(auto-fit,minmax(224px,1fr))';

  if (grip) grip.onmousedown = (ev) => {
    ev.preventDefault(); grip.classList.add('on');
    const prev = p.style.transition; p.style.transition = 'none';
    S.pdockUser = true;
    const move = (e) => { const r = p.getBoundingClientRect();
      S.pdockH = Math.max(PDOCK_MIN, Math.min(PDOCK_MAX, r.bottom - e.clientY));
      p.style.height = S.pdockH + 'px'; };
    const up = () => { grip.classList.remove('on'); p.style.transition = prev;
      document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); render(); };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  };

  /* 아직 직접 조절한 적이 없으면 내용 높이에 맞춘다 */
  if (!S.pdockUser) {
    const fit = () => {
      if (S.page !== 'pipeline' || S.pipeView !== 'flow' || S.pdockUser || S.pdockMin) return;
      const dock = $('.dock'); if (!dock || !dock.parentElement) return;
      const bd = $('.dock-b', dock), hd = $('.dock-h', dock);
      if (!bd || !hd || !bd.scrollHeight) return;
      const cs = getComputedStyle(bd);
      const need = hd.offsetHeight + bd.scrollHeight
        + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + 6;
      const room = Math.round(dock.parentElement.getBoundingClientRect().height * 0.45);
      const hgt = Math.max(PDOCK_MIN, Math.min(need, PDOCK_FIT, room));
      if (Math.abs(hgt - (S.pdockH || 260)) < 4) return;
      S.pdockH = hgt;                       /* 상태에 담아 다음 렌더에도 유지 */
      const prev = dock.style.transition;
      dock.style.transition = 'none';
      dock.style.height = hgt + 'px';
      void dock.offsetHeight;               /* 값이 튀지 않게 즉시 반영 */
      dock.style.transition = prev;
    };
    setTimeout(fit, 0); setTimeout(fit, 80);
  }
  return p;
}

/* 실행 설정 — 일정 · 환경 · 재시도 · 알림 */
function pipeCfg(pp, r) {
  const c = pcfg2(pp), can = r.canPipeEdit;
  const g = pgraph(pp);
  const ord = orderG(g).filter(k => { const d = byId(nodeOf(g, k).id); return d && d.kind !== 'source'; });
  const srcs = [...new Set(g.nodes.map(n => n.id).filter(id => (byId(id) || {}).kind === 'source'))];
  const freqs = ['매일 04:30', '매일 05:00', '매일 06:00', '매주 월 06:00', '1시간마다', '수동 실행'];
  const w = el('<div class="def"><div class="def-in"></div></div>');
  const inn = $('.def-in', w);
  inn.appendChild(el(`<div class="rule">${ic14('info')}<span>${PIPE_RULE}
    실행 대상과 순서는 구성 탭의 연결 관계에서 자동으로 정해집니다.</span></div>`));
  inn.appendChild(el(`<div class="sec" style="background:var(--surface)">
    <span class="sec-t">${ic14('flow', 'fnt')}실행 대상 모델 <span class="t11 fnt">${ord.length}개</span></span>
    <div class="col g6">${ord.length ? ord.map((k, i) => { const d = byId(nodeOf(g, k).id);
      const ins = g.edges.filter(e => e.to === k).map(e => esc(byId(nodeOf(g, e.from).id).name));
      return `<div class="ordn"><b>${i + 1}</b>
        <span class="col f1" style="gap:1px;min-width:0"><span class="t12 b6 trunc">${esc(d.name)}</span>
          <span class="t11 fnt trunc">${ins.length ? '입력 ' + ins.join(' · ') : '입력 없음'}</span></span>
        ${layerTag(d.layer)}</div>`; }).join('')
      : '<span class="t12 fnt">구성 탭에서 DATA MODEL 을 놓고 연결하세요.</span>'}</div>
    ${srcs.length ? `<div class="ro">${ic14('db')}<span>참조 SOURCE ${srcs.length}개 — ${srcs.map(x => esc((byId(x) || {}).name)).join(' · ')}.
      실행하지 않으며 최신성 검사만 합니다.</span></div>` : ''}</div>`));
  inn.appendChild(el(`<div class="g2">
    <div class="sec" style="background:var(--surface)">
      <span class="sec-t">${ic14('cal', 'fnt')}실행 일정</span>
      <select class="inp" id="pcF" ${can ? '' : 'disabled'}>
        ${freqs.map(f => `<option ${c.freq === f ? 'selected' : ''}>${f}</option>`).join('')}</select>
      <div class="info2" style="border-radius:6px">
        <div><span>다음 실행</span><span>${esc(pp.next)}</span></div>
        <div><span>최근 실행</span><span>${esc(pp.last)} · ${esc(pp.dur)}</span></div></div></div>
    <div class="sec" style="background:var(--surface)">
      <span class="sec-t">${ic14('db', 'fnt')}실행 환경</span>
      <select class="inp" id="pcE" ${can ? '' : 'disabled'}>
        ${Object.entries(ENVS).map(([k, v]) => `<option value="${k}" ${c.env === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select>
      <span class="fr-h">운영 환경은 승인된 사용자만 실행할 수 있습니다.</span></div></div>`));
  inn.appendChild(el(`<div class="g2">
    <div class="sec" style="background:var(--surface)">
      <span class="sec-t">${ic14('rot', 'fnt')}실패 시 재시도</span>
      <select class="inp" id="pcR" ${can ? '' : 'disabled'}>
        ${[0, 1, 2, 3].map(v => `<option value="${v}" ${c.retry === v ? 'selected' : ''}>${v === 0 ? '재시도하지 않음' : v + '회 재시도 (5분 간격)'}</option>`).join('')}</select>
      <span class="sec-t" style="margin-top:4px">${ic14('alert', 'fnt')}품질 규칙 미통과 시</span>
      <select class="inp" id="pcS" ${can ? '' : 'disabled'}>
        <option value="stop" ${c.onFail === 'stop' ? 'selected' : ''}>이후 단계를 중단합니다</option>
        <option value="go" ${c.onFail === 'go' ? 'selected' : ''}>기록만 남기고 계속합니다</option></select></div>
    <div class="sec" style="background:var(--surface)">
      <span class="sec-t">${ic14('bell', 'fnt')}알림</span>
      <label class="chkrow"><input type="checkbox" class="chk" id="pcN" ${c.notify ? 'checked' : ''} ${can ? '' : 'disabled'}>
        실패하면 알립니다</label>
      <div class="info2" style="border-radius:6px"></div></div></div>`));
  if (can) {
    const f = el(`<div class="row g6"><button class="btn pri" id="pcOk">${ic14('save')}설정 저장</button>
      <button class="btn" id="pcGo">${ic14('flow')}구성 열기</button>
      <span class="t11 fnt sp">저장하면 다음 실행부터 적용됩니다.</span></div>`);
    $('#pcOk', f).onclick = () => {
      c.freq = $('#pcF', w).value; c.env = $('#pcE', w).value;
      c.retry = +$('#pcR', w).value; c.onFail = $('#pcS', w).value; c.notify = $('#pcN', w).checked;
      pp.freq = c.freq; pp.env = c.env;
      toast('실행 설정을 저장했습니다.'); render();
    };
    $('#pcGo', f).onclick = () => { S.pipeView = 'build'; render(); };
    inn.appendChild(f);
  } else inn.appendChild(el(`<div class="ro">${ic14('info')}<span>설정을 바꾸려면 파이프라인 편집이 가능해야 합니다.</span></div>`));
  return w;
}
