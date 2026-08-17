/* ── b35 — 파이프라인 하단 상세 — 빌드 정보 · 품질 결과 · 이력 · 로그 ── */

/* 하단 상세 독.
   v6.2 에서 역할을 갈랐다 — 위(실행 흐름 캔버스)는 파이프라인을 «보고 조작하는» 곳,
   아래(이 독)는 고른 것의 «결과를 읽는» 곳이다. 그래서 여기서는 아무것도 고치지 않는다.
   설정을 바꾸는 길은 흐름도의 파이프라인 노드 우클릭 → 실행 설정(모달) 하나뿐이다.

   탭은 보는 대상이 두 층위로 나뉜다 —
     파이프라인 단위 : 이력                 (모델을 고르지 않아도 보인다)
     모델 단위      : 빌드 정보 · 품질 결과 · 로그 (고른 모델이 있어야 한다)
   높이·접기·자동 맞춤은 pipeDockChrome 이 맡는다 (두 반환 지점 모두 거친다). */
const PDOCK_TABS = ['빌드 정보', '품질 결과', '이력', '로그'];
const PDOCK_MODEL_TABS = ['빌드 정보', '품질 결과', '로그'];

function pipeDock(pp) {
  const g = pgraph(pp), runs = runsG(pp), r = R();
  /* 위 한계는 dockMaxH(b45) 와 같은 규칙이다 — 흐름도 132px 만 남기고 올릴 수 있다.
     60% 로 묶여 있던 동안에는 그립을 끝까지 끌어도 절반쯤에서 멈췄다. */
  const p = el(`<div class="dock pdock" style="flex:0 1 auto;max-height:calc(100% - 132px)">
    <div class="grip-h" id="gripPH" title="높이 조절"></div></div>`);
  if (!PDOCK_TABS.includes(S.pipeTab)) S.pipeTab = '빌드 정보';
  const modelTab = PDOCK_MODEL_TABS.includes(S.pipeTab);

  const n = S.pipeNodeK && nodeOf(g, S.pipeNodeK);
  const d = n && byId(n.id);
  const rn = (n && runs[n.key]) || { st: 'wait' };

  /* 헤더 — 왼쪽 탭, 오른쪽은 «지금 보고 있는 모델» 과 그 모델에 대한 동작.
     파이프라인 단위 탭에서는 모델이 주어가 아니므로 오른쪽을 비운다. */
  const head = el(`<div class="dock-h">
    <div class="dock-tabs">${PDOCK_TABS.map(t =>
      `<button class="tab ${S.pipeTab === t ? 'on' : ''}" data-ptab="${esc(t)}">${esc(t)}</button>`).join('')}</div>
    <div class="dock-act">${modelTab && d ? `<span class="row g6 pd-who">
      <span class="swatch" style="background:${grpColor(d)}"></span>
      <span class="b6 t12 trunc" title="${esc(d.name)}">${esc(d.name)}</span></span>` : ''}</div></div>`);
  const act = $('.dock-act', head);
  if (modelTab && d) {
    /* 이름표를 span 으로 감싸 둔다 — 좁아지면 CSS 가 이것만 감추고 아이콘만 남긴다. */
    const actBtn = (cls, icon, label) =>
      el(`<button class="${cls}" title="${esc(label)}">${ic14(icon)}<span class="btn-l">${esc(label)}</span></button>`);
    if (r.canPipeEdit && rn.st !== 'wait') {
      const b1 = actBtn('btn pri', 'rot', '재실행');
      b1.onclick = () => rerunConfirm(pp, n);
      act.appendChild(b1);
    }
    const b2 = actBtn('btn', 'doc', '모델 열기');
    b2.onclick = () => { S.mView = 'def'; S.mTab = 'SQL'; go('modeling', n.id); };
    act.appendChild(b2);
    if (d.isMart) {
      const b3 = actBtn('btn', 'chart', '이 마트를 쓰는 분석');
      b3.onclick = () => go('analytics'); act.appendChild(b3);
    }
  }
  p.appendChild(head);

  const b = el('<div class="dock-b col g12"></div>');

  if (S.pipeTab === '이력') {
    /* 이력은 원래 상단 뷰였다. 파이프라인 단위 조회라 이 독으로 내렸다.
       historyView 는 api.js 가 정의한다 — 없으면 그 층이 아직 안 붙은 것이다. */
    if (typeof historyView === 'function') b.appendChild(historyView());
    else b.appendChild(el(`<div class="empty">${ic('clock')}<span class="empty-t">실행 이력을 불러올 수 없습니다.</span></div>`));
  } else if (!d) {
    b.appendChild(el(`<div class="empty">${ic('model')}
      <span class="empty-t">흐름도에서 모델을 선택해 주세요.</span></div>`));
  } else if (S.pipeTab === '빌드 정보') {
    /* 이 모델이 어떻게 만들어졌는가 — 결과(상태·시간·행 수)와 그것을 만든 SQL.
       예전에는 SQL 이 별도 탭이었는데, «이 모델의 빌드» 라는 한 가지 질문을
       탭 두 개로 갈라 놓은 것이라 여기로 합쳤다(SQL 은 접어 둔다). */
    b.style.display = 'grid'; b.style.gridTemplateColumns = 'repeat(auto-fit,minmax(240px,1fr))';
    /* 세 칸의 높이를 맞춘다(stretch) — 실행 SQL 상자가 그 높이를 채우고 스스로 스크롤해서,
       독 바깥으로 넘쳐 스크롤이 두 겹이 되는 것을 막는다. */
    b.style.gap = '12px 28px'; b.style.alignItems = 'stretch';
    b.appendChild(el(`<div class="kv pd-kv">
      ${kvRow('모델', `<span class="row g6"><span class="trunc" title="${esc(d.name)}">${esc(d.name)}</span>${grpTag(d)}</span>`)}
      ${kvRow('저장 위치', `<span class="mono t12 trunc" title="${esc(d.phys)}">${esc(d.phys)}</span>`)}
      ${kvRow('빌드 상태', stBadge(rn.st))}
      ${kvRow('빌드 시간', esc(rn.dur || '—'))}
      ${kvRow('처리 행 수', rn.st === 'ok' ? esc(rn.rows || '—') + '건' : rn.st === 'err' ? '0건 (품질 규칙 미통과)' : '—')}
      ${kvRow('생성 방식', d.mat === '—' ? 'SOURCE — 외부 적재' : esc(matKo(d.mat)))}
      </div>`));
    const ins = g.edges.filter(e => e.to === n.key).map(e => byId(nodeOf(g, e.from).id)).filter(Boolean);
    const dn = (d.down || []).map(byId).filter(Boolean);
    const stat = (x) => `<div class="statrow">
      <span class="swatch" style="background:${grpColor(x)}"></span>
      <span class="t12 f1 trunc" title="${esc(x.name)}">${esc(x.name)}</span>${grpTag(x)}</div>`;
    b.appendChild(el(`<div class="col g14 pd-side">
      <div class="col g6"><span class="sect-t">입력 ${ins.length}개</span>
        <div class="col g6">${ins.length ? ins.map(stat).join('')
          : '<span class="t12 fnt">이 카드는 흐름의 시작점입니다.</span>'}</div></div>
      <div class="col g6"><span class="sect-t">다음 단계</span>
        <div class="col g6">${dn.length ? dn.map(stat).join('')
          : d.isMart
            ? '<span class="t12 fnt">DATA MART 입니다 — 데이터 분석에서 사용합니다.</span>'
            : '<span class="t12 fnt">이어지는 모델이 없습니다. 최종 결과라면 데이터 모델에서 DATA MART 로 지정하세요.</span>'}</div></div></div>`));
    /* 실행 SQL — 오른쪽 칸에 펼쳐 둔다.
       접었다 펴는 링크를 두면 «이 모델이 무엇을 하는가» 를 볼 때마다 한 번 더 눌러야 했고,
       링크 글자가 통계(문장·CTE 수)까지 달고 있어 제목인지 버튼인지도 흐렸다.
       길이는 칸 안에서 감당한다 — .code 가 스스로 스크롤한다(가로·세로 모두). */
    const sqlWrap = el(`<div class="col g6 pd-sql"></div>`);
    sqlWrap.appendChild(el(`<span class="sect-t">실행 SQL</span>`));
    if (!d.sql) sqlWrap.appendChild(el(`<span class="t12 fnt">SOURCE 는 SQL 없이 그대로 들어옵니다.</span>`));
    else {
      sqlWrap.appendChild(el(`<div class="code pd-sqlbox">${esc(d.sql)}</div>`));
      sqlWrap.appendChild(el(`<span class="t11 fnt">내용을 바꾸려면 데이터 모델에서 수정하세요.</span>`));
    }
    b.appendChild(sqlWrap);
  } else if (S.pipeTab === '로그') {
    /* 본문은 api.js 가 서버에서 받아 채운다. 여기서는 자리만 잡는다.
       예전에는 그럴듯한 로그를 지어 그렸는데, 그러면 «실행하지 않았다» 와
       «로그를 받지 못했다» 를 구별할 수 없다. 받지 못했으면 받지 못했다고만 적는다. */
    const wait = rn.st === 'wait' ? '아직 실행하지 않았습니다.'
      : rn.st === 'skip' ? '앞 단계가 실패해 실행하지 않았습니다. (SKIP)'
      : '로그를 불러오는 중…';
    b.appendChild(el(`<div class="code" style="max-height:100%">${esc(wait)}</div>`));
    b.appendChild(el('<span class="t11 fnt" id="pdLogCap"></span>'));
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

/* (실행 정보 — 파이프라인 단위 조회 탭이었다. 제거.
   실행 대상·SOURCE·실행 방식·환경·예약은 흐름도 노드 우클릭 → 실행 설정에서 본다) */

/* 독의 틀 — 접기 · 높이 · 그립 · 자동 맞춤.
   원래 v2.9.1(접기·DOCK_MIN/MAX)과 v2.9.2(파이프라인 전용 높이·자동 맞춤)가
   같은 자리를 겹쳐 썼다. 뒤 층이 높이와 그립을 매번 다시 쓰므로 앞 층에서
   살아남는 것은 min 클래스 · 접기 버튼 · (접혔을 때) 그립 제거 뿐이었다.
   상수도 파이프라인 쪽(PDOCK_*)만 실제로 쓰인다. */
function pipeDockChrome(p) {
  p.classList.toggle('min', S.pdockMin);
  const head = $('.dock-h', p);
  if (head) {
    /* 동작 묶음이 있으면 접기 버튼도 그 안에 넣는다. 둘 다 margin-left:auto 로
       따로 서면 남는 폭을 나눠 가져서, 버튼 묶음이 가운데로 끌려 나온다. */
    const host = $('.dock-act', head);
    const t = el(`<button class="iconbtn ${host ? '' : 'sp'}" title="${S.pdockMin ? '상세 펼치기' : '상세 접기'}">${ic14(S.pdockMin ? 'chev' : 'chevd')}</button>`);
    t.onclick = () => { S.pdockMin = !S.pdockMin; render(); };
    (host || head).appendChild(t);
  }
  const grip = $('.grip-h', p);
  if (S.pdockMin) { if (grip) grip.remove(); p.style.height = ''; return p; }

  /* 저장된 높이가 지금 화면보다 크면(창을 줄였을 때) 흐름도가 0 이 된다 */
  p.style.height = Math.min(S.pdockH || 260, dockMaxH(p)) + 'px';
  /* (칸 나누기는 pipeDock 이 한 곳에서 정한다 — 여기서 224px 로 다시 쓰던 층은 제거.
     칸을 억지로 좁혀 두 줄을 유지하면 긴 경로가 옆 칸을 파고들었다.) */

  if (grip) grip.onmousedown = (ev) => {
    ev.preventDefault(); grip.classList.add('on');
    const prev = p.style.transition; p.style.transition = 'none';
    S.pdockUser = true;
    const move = (e) => { const r = p.getBoundingClientRect();
      S.pdockH = Math.max(PDOCK_MIN, Math.min(dockMaxH(p), r.bottom - e.clientY));
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

/* 실행 설정 — 하나의 파이프라인을 «읽고 고치는» 관리 화면.

   v6.1 재구성. 예전에는 큰 카드 안에 모델 카드가 12개 반복되고, 정작 바꾸는 값
   (일정·환경·재시도·알림)은 그 아래로 밀려 있었다. 설정 페이지인데 실행 대상
   목록이 화면의 주인이었다. 뒤집는다 —

     · 실행 대상 은 «구성이 정해 준 결과» 라 참고 정보다. 접어서 6줄만 보인다.
     · 실제로 바꾸는 값이 화면의 주인이다. 섹션 제목 + 구분선 + 설정 행.
     · 저장은 맨 위 오른쪽. 값을 고치고 아래까지 내려갈 일이 없어야 한다.

   뒤에 오는 층이 붙잡는 자리(계약)는 그대로 둔다 —
     #pcF #pcE #pcR #pcS #pcN #pcOk #pcGo 와, 각 층이 내용을 넣는 슬롯
     #pcSlotTrig(실행 방식) #pcSlotSched(예약) #pcSlotFail(실패 처리).
   버튼 순서는 CSS order 로 [구성 열기][삭제][설정 저장] 이다 — 삭제는 뒤 층이
   #pcOk 다음에 끼워 넣으므로 DOM 순서로는 맞출 수 없다. */
function pipeCfg(pp, r) {
  const c = pcfg2(pp), can = r.canPipeEdit;
  const g = pgraph(pp);
  const ord = orderG(g).filter(k => { const d = byId(nodeOf(g, k).id); return d && d.kind !== 'source'; });
  const srcs = [...new Set(g.nodes.map(n => n.id).filter(id => (byId(id) || {}).kind === 'source'))];
  const freqs = ['매일 04:30', '매일 05:00', '매일 06:00', '매주 월 06:00', '1시간마다', '수동 실행'];
  const w = el('<div class="def pcfg"><div class="def-in"></div></div>');
  const inn = $('.def-in', w);

  /* 머리 — 한 줄 안내와 페이지 동작. 예전의 파란 배너는 이미 파이프라인 안에
     들어와 있는 사람에게 SOURCE·DATA MODEL 을 다시 설명하고 있었다. */
  const head = el(`<div class="pcfg-top">
    <span class="pcfg-hint">${ic14('info', 'fnt')}저장하면 다음 실행부터 적용됩니다.</span>
    <div class="row g6 pcfg-act">
      <button class="btn" id="pcGo">구성 열기</button>
      ${can ? `<button class="btn pri" id="pcOk">설정 저장</button>` : ''}
    </div></div>`);
  inn.appendChild(head);
  $('#pcGo', head).onclick = () => { S.pipeView = 'build'; render(); };

  /* (실행 대상 목록 — v6.2 에서 하단 «실행 정보» 탭으로 옮겼다.
     설정 모달은 «바꾸는 값» 만 담는다. 실행 대상은 구성이 정한 결과라 조회 쪽이 맞다.
     뒤 층(api.js)의 조회 전용 표기는 #pcTgtN·[data-ordn] 가 없으면 그냥 넘어간다) */

  /* ── 실행 방식 — 내용은 뒤 층(api.js)이 이 슬롯에 넣는다 */
  inn.appendChild(el(`<section class="pcfg-s" id="pcSecTrig">
    <div class="pcfg-sh"><span class="pcfg-st">실행 방식</span></div>
    <div class="pcfg-b" id="pcSlotTrig"></div></section>`));

  /* ── 예약 실행 */
  const sched = el(`<section class="pcfg-s" id="pcSecSched">
    <div class="pcfg-sh"><span class="pcfg-st">예약 실행</span></div>
    <div class="pcfg-b" id="pcSlotSched">
      <div class="pcfg-f"><span class="pcfg-fl">실행 일정</span>
        <select class="inp" id="pcF" ${can ? '' : 'disabled'}>
          ${freqs.map(f => `<option ${c.freq === f ? 'selected' : ''}>${f}</option>`).join('')}</select>
        <span class="pcfg-fh"></span></div>
      <div class="pcfg-f"><span class="pcfg-fl">최근 실행</span>
        <span class="pcfg-fv">${esc(pp.last)}${pp.dur && pp.dur !== '—' ? ' · ' + esc(pp.dur) : ''}</span></div>
      <div class="pcfg-f"><span class="pcfg-fl">다음 실행</span>
        <span class="pcfg-fv">${esc(pp.next || '—')}</span></div>
    </div></section>`);
  inn.appendChild(sched);

  /* ── 실행 환경 */
  inn.appendChild(el(`<section class="pcfg-s">
    <div class="pcfg-sh"><span class="pcfg-st">실행 환경</span></div>
    <div class="pcfg-b">
      <div class="pcfg-f"><span class="pcfg-fl">실행 환경</span>
        <select class="inp" id="pcE" ${can ? '' : 'disabled'}>
          ${Object.entries(ENVS).map(([k, v]) => `<option value="${k}" ${c.env === k ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select>
        <span class="pcfg-fh">운영 환경은 승인된 사용자만 실행할 수 있습니다.</span></div>
    </div></section>`));

  /* ── 실패 처리 */
  inn.appendChild(el(`<section class="pcfg-s" id="pcSecFail">
    <div class="pcfg-sh"><span class="pcfg-st">실패 처리</span></div>
    <div class="pcfg-b" id="pcSlotFail">
      <div class="pcfg-f"><span class="pcfg-fl">재시도</span>
        <select class="inp" id="pcR" ${can ? '' : 'disabled'}>
          ${[0, 1, 2, 3].map(v => `<option value="${v}" ${c.retry === v ? 'selected' : ''}>${v === 0 ? '재시도하지 않음' : v + '회 (5분 간격)'}</option>`).join('')}</select>
        <span class="pcfg-fh"></span></div>
      <div class="pcfg-f"><span class="pcfg-fl">품질 규칙 미통과</span>
        <select class="inp" id="pcS" ${can ? '' : 'disabled'}>
          <option value="stop" ${c.onFail === 'stop' ? 'selected' : ''}>이후 단계 중단</option>
          <option value="go" ${c.onFail === 'go' ? 'selected' : ''}>기록만 남기고 계속</option></select>
        <span class="pcfg-fh"></span></div>
    </div></section>`));

  /* ── 알림 */
  inn.appendChild(el(`<section class="pcfg-s">
    <div class="pcfg-sh"><span class="pcfg-st">알림</span></div>
    <div class="pcfg-b">
      <label class="pcfg-f pcfg-chk"><span class="pcfg-fl">실행 실패</span>
        <span class="row g6"><input type="checkbox" class="chk" id="pcN" ${c.notify ? 'checked' : ''} ${can ? '' : 'disabled'}>
          <span>실패하면 알립니다</span></span>
        <span class="pcfg-fh"></span></label>
    </div></section>`));

  if (!can) inn.appendChild(el(`<p class="pcfg-note">설정을 바꾸려면 파이프라인 편집이 가능해야 합니다.</p>`));
  return w;
}

/* ── 재실행 범위 ──────────────────────────────────────────────
   **의존 관계로 계산한다.** 흐름도에서 오른쪽에 있다거나 목록에서 아래에 있다는
   이유로 «후속» 이 되지 않는다 — 화면 배치는 보기 좋으라고 정한 것이라, 그것을
   실행 범위의 근거로 삼으면 레이아웃이 바뀌는 순간 지워지는 대상이 달라진다.

   두 가지를 각각의 근거로 센다.
     · 후속 작업   — 이 파이프라인 안의 task 의존성(pgraph 의 edges)을 따라간다.
     · 후속 파이프라인 — 파이프라인 간 실행 의존성(«선행 파이프라인 완료 후»)을
                      따라간다. 여러 단계로 이어져 있으면 끝까지 따라간다. */
function rerunScope(pp, fromKey) {
  const g = pgraph(pp);
  const byKey = {};
  g.nodes.forEach(n => { byKey[n.key] = n; });

  /* 이 노드에서 도달할 수 있는 모든 하류 task. 폭 우선으로 끝까지 훑는다. */
  const seen = new Set([fromKey]);
  const queue = [fromKey];
  while (queue.length) {
    const cur = queue.shift();
    g.edges.forEach(e => {
      if (e.from !== cur || seen.has(e.to)) return;
      seen.add(e.to); queue.push(e.to);
    });
  }
  const tasks = [...seen].filter(k => k !== fromKey)
    .map(k => byId(byKey[k] && byKey[k].id))
    .filter(d => d && d.kind !== 'source')     // SOURCE 는 실행 대상이 아니다
    .map(d => d.name);

  /* 이 파이프라인이 끝나면 자동으로 시작하는 파이프라인 — 그리고 그 뒤까지. */
  const pipes = [];
  const walk = (id, guard) => {
    if (guard.has(id)) return;                 // 순환 방어
    guard.add(id);
    PIPES.forEach(x => {
      if (x.trigger !== 'upstream' || x.upstreamId !== id) return;
      if (!pipes.includes(x.name)) pipes.push(x.name);
      walk(x.id, guard);
    });
  };
  walk(pp.id, new Set());
  return { tasks, pipes };
}

/* 재실행 확인 — 누르는 즉시 돌리지 않는다. 재실행은 이 모델 하나로 끝나지 않고
   후속까지 함께 도는 일이라, 무엇이 같이 도는지 보고 확정하게 한다. */
function rerunConfirm(pp, n) {
  const d = byId(n.id);
  const { tasks, pipes } = rerunScope(pp, n.key);
  const list = (label, items) => items.length
    ? `<div class="col g4" style="margin-top:12px">
         <span class="t11 fnt b6">${label} ${items.length}개</span>
         <span class="t12" style="line-height:1.7;color:var(--text)">${
           items.map(esc).join(', ')}</span></div>`
    : '';

  const h = `<div class="modal-h"><span class="modal-t">재실행하시겠습니까?</span>
      <button class="iconbtn sp" data-close>${ic('x')}</button></div>
    <div class="modal-b">
      <p style="margin:0;line-height:1.7">선택한 모델부터 다시 실행합니다.
        이 모델에 의존하는 후속 작업과 연결된 후속 파이프라인도 함께 실행됩니다.</p>
      <div class="col g4" style="margin-top:12px">
        <span class="t11 fnt b6">시작 모델</span>
        <span class="t12" style="color:var(--text)">${esc(d ? d.name : n.id)}</span></div>
      ${list('후속 작업', tasks)}
      ${list('후속 파이프라인', pipes)}
      ${!tasks.length && !pipes.length
        ? `<div class="t12 fnt" style="margin-top:12px">이 모델 뒤에 이어지는 작업이 없습니다.</div>`
        : ''}
    </div>
    <div class="modal-f"><button class="btn sp" data-close>취소</button>
      <button class="btn pri" id="rrOk">${ic14('rot')}재실행</button></div>`;
  const { m, close } = modal(h, { sm: true });
  $('#rrOk', m).onclick = () => { close(); rerunG(pp, n.key); };
}
