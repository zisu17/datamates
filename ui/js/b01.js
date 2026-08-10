/* ── b01 — ── b01 — 앱 셸 · 라우팅 ── (index.html 블록에서 기계적 추출, 동작 불변) */

/* ============================================================
   앱 셸 · 라우팅
   ============================================================ */
function go(page, arg) {
  // 다른 파이프라인으로 옮기면 보던 스크롤 위치는 무의미하다
  if (page === 'pipeline' && arg && arg !== S.pipe) S.pipeScroll = null;

  if (page === 'catalog') {
    // 카탈로그 화면은 v2.1 에서 데이터 모델로 합쳐졌다 — 항목만 얹고 넘어간다
    if (arg && byId(arg)) { addNodeFromCatalog(arg); S.sel = arg; S.mTab = '기본 정보'; }
    page = 'modeling'; arg = null;
  } else if (page === 'settings') { settingsModal(); return; }
  else if (page === 'quality' && arg && ruleById(arg)) {
    const q = ruleById(arg);
    S.qSel = q.id; S.vSel = q.id; S.qTab = q.status === 'ok' ? '규칙' : '위반 내역';
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

  /* 홈·품질 — 제목줄(.page-h)을 탭 줄에 합쳐 한 줄을 아낀다.
     .page-a 는 그릇이라 안엣것만 옮긴다(노드 이동이라 클릭 핸들러가 따라간다). */
  if (S.page === 'home' || S.page === 'quality') {
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
  S.mPanelOpen = true;                                          // v2.1 이 덧붙이던 한 줄
}
/* 캔버스 폭이 부족하면 보조 버튼을 더보기로 넘긴다 */
/* 툴바 여유폭 — 좁으면 보조 버튼이 더보기로 넘어간다.
   사이드바(v4.6)와 우측 상세(v4.x)가 사라져 이제 왼쪽 목록만 차지한다. */
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
  const t = el(`<header class="top">
    <div class="brand"><span class="brand-m" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 20a2.4 2.4 0 0 0 2 1a2.4 2.4 0 0 0 2 -1a2.4 2.4 0 0 1 2 -1a2.4 2.4 0 0 1 2 1a2.4 2.4 0 0 0 2 1a2.4 2.4 0 0 0 2 -1a2.4 2.4 0 0 1 2 -1a2.4 2.4 0 0 1 2 1a2.4 2.4 0 0 0 2 1a2.4 2.4 0 0 0 2 -1"/><path d="M4 18l-1 -5h18l-2 4"/><path d="M5 13v-6h8l4 6"/><path d="M7 7v-4h-1"/></svg></span>Data Mates</div>
    <button class="iconbtn" id="btnNoti" title="알림">${ic('bell')}<span class="dot-n"></span></button>
    <button class="iconbtn" id="btnMe" title="환경 설정">${ic('set')}</button>
  </header>`);
  $('#btnNoti', t).onclick = notiModal;
  $('#btnMe', t).onclick = settingsModal;

  /* GNB — 전역 사이드바를 없애고(v4.6) 현재 메뉴 드롭다운을 브랜드 옆에 둔다 */
  const cur = MENUS.find(x => x.id === S.page) || MENUS[0];
  const g = el(`<button class="gnb" title="메뉴 이동">${ic(cur.icon)}` +
    `<span class="gnb-t">${esc(navLabel(cur))}</span>` +
    `<span class="gnb-c">${ic14('chevd')}</span></button>`);
  g.onclick = () => navMenuAt(g);
  $('.brand', t).insertAdjacentElement('afterend', g);

  /* 도움말 — 알림 아이콘 왼쪽. 오른쪽 묶음을 여기서부터 민다 */
  const noti = $('#btnNoti', t);
  const hb = el(`<button class="iconbtn" title="현재 메뉴 사용법">${ic('help')}</button>`);
  hb.onclick = openHelp;
  hb.style.marginLeft = 'auto';
  t.insertBefore(hb, noti);
  return t;
}

/* 전역 사이드바는 v4.6 에서 헤더 GNB 드롭다운으로 접었다.
   레이아웃 골격(.shell 첫 칸)은 남아야 해서 빈 자리 표시자만 그린다. */
function sidebar() { return el('<nav class="side" aria-hidden="true"></nav>'); }

function pageView() {
  switch (S.page) {
    case 'home': return pageHome();
    case 'ingest': return pageIngest();
    case 'modeling': return pageModeling();
    /* 상세(pagePipeDetail)는 v5.4 부터 파이프라인 탭이 대신한다 — 같은 함수였다 */
    case 'pipeline': return pagePipeline();
    case 'quality': return pageQuality();
  }
}

/* 알림 모달 */
function modal(html, opts) {
  const scrim = el(`<div class="scrim"></div>`);
  const m = el(`<div class="modal ${opts && opts.sm ? 'sm' : ''}">${html}</div>`);
  scrim.appendChild(m);
  scrim.onclick = (e) => { if (e.target === scrim) scrim.remove(); };
  document.body.appendChild(scrim);
  $$('[data-close]', m).forEach(b => b.onclick = () => scrim.remove());
  fixTerms(scrim);                       // 용어 통일(데이터 모델링→데이터 모델 등)은 모달에도 (v2.5)
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
