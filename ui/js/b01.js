/* ── b01 — ── b01 — 앱 셸 · 라우팅 ── (index.html 블록에서 기계적 추출, 동작 불변) */

/* ============================================================
   앱 셸 · 라우팅
   ============================================================ */
function go(page, arg) {
  // 다른 파이프라인으로 옮기면 보던 스크롤 위치는 무의미하다
  if (page === 'pipeline' && arg && arg !== S.pipe) S.pipeScroll = null;

  if (page === 'catalog' || (page === 'modeling' && arg)) {

    /* 관계도를 먼저 채우고 나서 «있는가» 를 본다.
       seedCanvas 는 첫 호출에 카탈로그 전체를 올리는데, 그 전에 물어보면 항상
       «없다» 가 나와 addNodeFromCatalog 가 상류까지 다시 올리려 든다. 그러면
       이미 올라온 카드마다 «이미 캔버스에 있습니다» 토스트가 한 줌씩 뜬다 —
       화면 이동은 조용해야 한다. */
    if (arg && byId(arg)) {
      seedCanvas();
      if (!nodeAt(arg)) addNodeFromCatalog(arg);
      S.sel = arg; S.mTab = '기본 정보';
    }
    page = 'modeling'; arg = null;
  } else if (page === 'settings') { settingsModal(); return; }
  else if (page === 'quality' && arg) {
    /* 품질 화면의 인자는 두 가지 모양으로 들어온다.
         dbt 테스트 id  — 데이터 모델 화면의 품질 규칙 탭, 홈 알림이 준다
         묶음 규칙 id   — 주소(#/quality/R-1234)가 준다
       둘 다 «그 규칙의 상세를 열어라» 는 뜻이다. dbt 테스트 id 로 들어오면
       그 테스트가 속한 묶음을 찾아 열고, 그 테스트를 오류 행의 기본 대상으로
       잡아 둔다(qOpenRule). */
    if (ruleById(arg)) qOpenRule(arg);
    else if (qGroupOf(arg)) { S.qSel = arg; S.qView = 'detail'; S.qDTab = '적용 대상'; }
  }
  if (page === 'pipeline' && !arg) S.pipeNode = null;

  const r = R();
  if (!r.menus.includes(page)) { toast('이 역할에서는 사용할 수 없는 화면입니다.', 'warn'); return; }
  S.page = page;
  if (page === 'pipeline') S.pipe = arg || null;
  if (page === 'quality') S.quality = arg || null;
  render();
}

function render() {
  $$('.menu').forEach(x => x.remove());   // 떠 있는 드롭다운은 앵커를 잃으므로 렌더마다 정리
  const r = R();
  if (!r.menus.includes(S.page)) S.page = 'home';
  const app = $('#app');
  const t = widthTier();
  app.classList.toggle('nar', t.nar);
  app.classList.toggle('xnar', t.xnar);
  app.innerHTML = '';
  app.appendChild(topbar());
  const shell = el('<div class="shell"></div>');
  shell.appendChild(sidebar());
  const main = el('<div class="main"></div>');
  main.appendChild(pageView());
  shell.appendChild(main);
  app.appendChild(shell);
  if (S.page === 'modeling') afterModelingRender();
  fixTerms(app);          // 화면 용어 통일(데이터 모델링→데이터 모델 등)은 항상 마지막 DOM 에

  /* 홈 — 제목줄(.page-h)을 탭 줄에 합쳐 한 줄을 아낀다.
     .page-a 는 그릇이라 안엣것만 옮긴다(노드 이동이라 클릭 핸들러가 따라간다).
     품질도 여기 있었으나 빠졌다 — 새 품질 화면은 DS 셸(.wc-shell__head)을 쓰고
     .page-h 를 만들지 않는다. */
  if (S.page === 'home') {
    const ph = $('#app .main .page-h');
    if (ph) {
      const strip = ph.nextElementSibling;
      const pa = $('.page-a', ph), pd = $('.page-d', ph);
      if (strip && /\btabs\b|\bqtabs\b/.test(strip.className) && (pa || pd)) {
        const box = el('<span class="tabs-a"></span>');
        if (pa) while (pa.firstChild) box.appendChild(pa.firstChild);
        else box.appendChild(pd);
        strip.appendChild(box);
      }
      ph.remove();
    }
  }
  // 파이프라인 목록의 고정폭을 카탈로그와 같은 값으로
  if (S.page === 'pipeline') {
    const l = $('#app .mod-l');
    if (l && !l.classList.contains('closed')) l.style.width = S.leftW + 'px';
  }
  // 화면별 배경 층 — 계보·파이프라인·수집은 헤더/캔버스가 회색 층을 쓴다
  app.classList.toggle('lin-view', S.page === 'modeling' && S.mView === 'graph');
  app.classList.toggle('pipe-view', S.page === 'pipeline' || S.page === 'ingest');
  // 다시 그린 캔버스에 보던 위치를 되돌린다 (DOM 에 붙은 뒤라야 한다)
  if (S.page === 'modeling' && S.__linScroll) {
    const w2 = $('#erdWrap');
    if (w2) { w2.scrollLeft = S.__linScroll.l; w2.scrollTop = S.__linScroll.t; }
  }
  if (S.page === 'pipeline' && S.openPipe === 'deps' && S.__pfScroll) {
    const w3 = $('#pdagWrap');
    if (w3) { w3.scrollLeft = S.__pfScroll.l; w3.scrollTop = S.__pfScroll.t; }
  }
}

/* 좁은 화면에서는 좌우 패널을 접어 캔버스를 확보한다 */
function applyTierDefaults() {
  const w = window.innerWidth, t = widthTier();
  if (t.xnar) { S.leftOpen = false; S.rightOpen = false; }      // 상세는 오버레이로 열림
  else if (w < 1340) { S.leftOpen = false; S.rightOpen = true; } // 데이터 목록은 필요할 때 펼침
  else { S.leftOpen = true; S.rightOpen = true; }
  S.mPanelOpen = true;
}
/* 캔버스 폭이 부족하면 보조 버튼을 더보기로 넘긴다 */

function barBudget() {
  const left = S.leftOpen ? S.leftW : 44;
  return window.innerWidth - left;
}

/* 창 크기가 바뀌면 폭 단계와 연결선 위치를 다시 맞춘다 */
let _rzT = null;
window.addEventListener('resize', () => {
  clearTimeout(_rzT);
  _rzT = setTimeout(() => {
    const app = $('#app'); if (!app) return;
    const t = widthTier();
    const sig = (t.xnar ? 'x' : t.nar ? 'n' : window.innerWidth < 1340 ? 'm' : 'w');
    app.classList.toggle('nar', t.nar);
    app.classList.toggle('xnar', t.xnar);
    if (sig !== window.__tier) { window.__tier = sig; applyTierDefaults(); render(); return; }
    if (S.page === 'modeling') { render(); }
  }, 90);
});

function topbar() {
  /* 전역 네비게이션 — 브랜드와 페이지 이동이 한 줄이다.
     Data Mates(브랜드) = 홈 버튼이고, 나머지 페이지가 그 옆에 순서대로 붙는다.
     드롭다운·사이드바 없이 이 줄이 서비스 전체 이동의 유일한 통로다. */
  const t = el(`<header class="top">
    <button class="brand" id="brandHome" title="홈으로">
      <svg class="brand-m" viewBox="0 0 64 64" aria-hidden="true"><use href="#dm-mark"/></svg
      ><span class="brand-l"><span class="brand-w1">DATA</span><span class="brand-w2"> MATES</span></span></button>
    <nav class="gnav" aria-label="전체 페이지 이동"></nav>
    <button class="iconbtn" id="btnHelp" title="현재 메뉴 사용법" style="margin-left:auto">${ic('help')}</button>
    <button class="iconbtn" id="btnNoti" title="알림">${ic('bell')}<span class="dot-n"></span></button>
    <button class="iconbtn" id="btnMe" title="환경 설정">${ic('set')}</button>
  </header>`);
  $('#brandHome', t).onclick = () => { if (S.page !== 'home') go('home'); };
  $('#btnHelp', t).onclick = openHelp;
  $('#btnNoti', t).onclick = notiModal;
  $('#btnMe', t).onclick = settingsModal;

  const nav = $('.gnav', t);
  MENUS.filter(m => m.id !== 'home' && R().menus.includes(m.id)).forEach(m => {
    const badge = navBadge(m.id);
    const b = el(`<button class="gnav-i ${S.page === m.id ? 'on' : ''}" title="${esc(m.label)}">
      ${esc(m.label)}${badge ? `<span class="nav-b">${badge}</span>` : ''}</button>`);
    b.onclick = () => { if (S.page !== m.id) go(m.id); };
    nav.appendChild(b);
  });
  return t;
}



function sidebar() { return el('<nav class="side" aria-hidden="true"></nav>'); }

function pageView() {
  switch (S.page) {
    case 'home': return pageHome();
    case 'ingest': return pageIngest();
    case 'modeling': return pageModeling();

    case 'pipeline': return pagePipeline();
    case 'quality': return pageQuality();
    /* 분석은 b53.js 가 정의한다 — 파일이 없으면 메뉴도 없으므로 여기 오지 않는다 */
    case 'analytics': return pageAnalytics();
  }
}

/* 알림 모달 */
function modal(html, opts) {
  const scrim = el(`<div class="scrim"></div>`);
  const m = el(`<div class="modal ${opts && opts.sm ? 'sm' : ''}">${html}</div>`);
  scrim.appendChild(m);

  // 바깥을 눌러 닫기 — click 이 아니라 누른 곳과 놓은 곳을 함께 본다.
  // click 의 타깃은 mousedown 과 mouseup 의 «공통 조상» 이라, 입력칸에서 글자를
  // 끌어 선택하다 스크림 위에서 손을 떼면 타깃이 스크림이 된다. click 만 보면
  // 그 순간 창이 닫혀 작성하던 내용이 통째로 날아간다.
  let downOnScrim = false;
  scrim.onmousedown = (e) => { downOnScrim = e.target === scrim; };
  scrim.onmouseup = (e) => {
    const bg = downOnScrim && e.target === scrim;
    downOnScrim = false;
    if (!bg) return;
    scrim.remove();
    if (opts && opts.onBackdrop) opts.onBackdrop();
  };

  document.body.appendChild(scrim);
  $$('[data-close]', m).forEach(b => b.onclick = () => scrim.remove());
  fixTerms(scrim);
  return { scrim, m, close: () => scrim.remove() };
}

function notiModal() {
  const h = `<div class="modal-h"><span class="modal-t">알림</span><span class="bdg err">${NOTIS.filter(n=>n.k==='err').length}</span>
      <button class="iconbtn sp" data-close>${ic('x')}</button></div>
    <div class="modal-b"><div class="col g10">
      ${NOTIS.map((n, i) => `<button class="card" data-n="${i}" style="text-align:left;cursor:pointer;padding:12px 14px;flex-direction:row;gap:10px;align-items:flex-start">
        <span style="margin-top:1px;color:var(--${n.k === 'err' ? 'err' : n.k === 'warn' ? 'warn' : 'ok'})">${ic(n.k === 'err' ? 'xc' : n.k === 'warn' ? 'alert' : 'checkc')}</span>
        <span class="col f1" style="gap:2px"><span class="b6">${esc(n.t)}</span><span class="t12 mut">${esc(n.d)}</span></span>
        ${ic14('chev', 'fnt')}</button>`).join('')}
    </div></div>`;
  const { m, close } = modal(h, { sm: false });
  $$('[data-n]', m).forEach(b => b.onclick = () => { const n = NOTIS[+b.dataset.n]; close(); go(n.go[0], n.go[1]); });
}

/* ============================================================
   1. 홈
   ============================================================ */
function kpi(label, val, sub, tone, onclick) {
  const c = el(`<div class="kpi ${onclick ? 'act' : ''}">
    <span class="kpi-l">${esc(label)}</span>
    <span class="kpi-v" ${tone ? `style="color:var(--${tone})"` : ''}>${esc(val)}</span>
    <span class="kpi-s">${esc(sub)}</span></div>`);
  if (onclick) c.onclick = onclick;
  return c;
}
function pipeBadge(s) {
  if (s === 'ok') return `<span class="bdg ok">${ic14('checkc')}성공</span>`;
  if (s === 'run') return `<span class="bdg info">${ic14('clock')}실행 중</span>`;
  if (s === 'err') return `<span class="bdg err">${ic14('xc')}실패</span>`;
  return `<span class="bdg wait">대기</span>`;
}
