/* ── b53 — 데이터 분석 모듈 ──
   ============================================================
   골격을 데이터 파이프라인 화면과 같게 맞춘다. 새 골격을 만들지 않는다.

       .page.flush
         .mod
           .mod-l   사이드바 (대시보드 목록, 전체 높이)
           .mod-c
             .ptabs 탭 스트립 (첫 탭 = 목록, 이후 = 열린 대시보드)
             내용   목록 | 상세 | 마법사(b54)

   **스크롤은 한 겹이다.** .page.flush 가 overflow:hidden 이고, 목록 화면은
   .ana-scroll 하나만, 상세 화면은 iframe 안쪽만 움직인다.

   상세 화면은 분석 엔진 대시보드를 **그대로 띄운다.** 예전에는 저장된 차트의
   query_context 를 읽어 플랫폼이 SVG 로 직접 그렸는데, 그러면 우리가 구현한
   다섯 가지 시각화만 나오고 나머지는 빈칸이 됐다. 편집 화면과 서비스 화면이
   달라 보이는 것이 디자인 통일보다 큰 문제였다. 자세한 근거는 anaDetailView.

   사용자가 아는 단위는 두 개다 — **대시보드** 와 **분석**.
   화면 문자열에 엔진 제품명이 나오지 않는다.
   ============================================================ */
'use strict';

if (!MENUS.some(m => m.id === 'analytics')) {
  MENUS.push({ id: 'analytics', label: '데이터 분석', icon: 'chart' });
}
if (!CAPS.menus.includes('analytics')) CAPS.menus.push('analytics');

S.anaTab = S.anaTab || 'list';       // 'list' | 대시보드 id
S.anaTabs = S.anaTabs || [];         // 열린 대시보드 id (탭 순서)
S.anaView = S.anaView || '';         // '' | 'pick' | 'build' — b54 마법사
S.anaSideOpen = S.anaSideOpen === undefined ? true : S.anaSideOpen;
S.anaAllDash = S.anaAllDash || false;

const ANA = { data: null, error: null, loading: false,
              hidden: {},
              /* 대시보드 id → iframe. #app 바깥에 산다 — anaSyncFrames 참고. */
              frames: {} };

async function anaLoad(force) {
  if (ANA.loading) return;
  if (!force && ANA.data) return;
  ANA.loading = true;
  try {
    const st = await api('/analytics/status');
    if (!st.ok) { ANA.error = '분석 엔진이 응답하지 않습니다.'; ANA.data = null; return; }
    ANA.data = await api('/analytics/assets');
    ANA.error = null;
  } catch (e) {
    ANA.error = (e && e.message) || '분석 목록을 불러오지 못했습니다.';
  } finally {
    ANA.loading = false;
    // 홈의 흐름 레일도 대시보드 수를 쓴다 — 늦게 도착하면 그 자리에 «—» 가
    // 남으므로 홈에서도 다시 그린다.
    if (S.page === 'analytics' || S.page === 'home') render();
  }
}

/* 시각 표시는 공통 규칙을 따른다 — fmtDT(b00.js), KST · 2026-08-12 14:45:08 */
const anaWhen = fmtDT;

const anaDash = (id) => ((ANA.data && ANA.data.dashboards) || []).find(d => d.id === id);

/* 탭 — 같은 대시보드를 다시 열면 새 탭을 만들지 않고 기존 탭을 활성화한다. */
function anaOpenTab(id) {
  if (!S.anaTabs.includes(id)) S.anaTabs.push(id);
  S.anaTab = id; S.anaView = '';
  render();
}

/* 활성 탭을 닫으면 마지막 탭으로, 탭이 없으면 목록으로 돌아간다. */
function anaCloseTab(id) {
  const i = S.anaTabs.indexOf(id);
  if (i >= 0) S.anaTabs.splice(i, 1);
  anaDropFrame(id);                 // 닫은 대시보드의 문서는 들고 있지 않는다
  if (S.anaTab === id) {
    S.anaTab = S.anaTabs.length ? S.anaTabs[S.anaTabs.length - 1] : 'list';
  }
  render();
}

function anaMenuAt(anchor, items) {
  $$('.menu').forEach(x => x.remove());
  const r = anchor.getBoundingClientRect();
  const m = el(`<div class="menu" style="top:${Math.round(r.bottom + 6)}px;`
    + `left:${Math.round(Math.max(8, r.right - 184))}px;min-width:176px"></div>`);
  items.forEach(it => {
    const b = el(`<button class="${it.danger ? 'dngr' : ''}">${ic14(it.icon, 'fnt')}`
      + `<span>${esc(it.label)}</span></button>`);
    b.onclick = () => { m.remove(); it.run(); };
    m.appendChild(b);
  });
  document.body.appendChild(m);
  setTimeout(() => {
    const close = (e) => {
      if (m.contains(e.target) || anchor.contains(e.target)) return;
      m.remove(); document.removeEventListener('mousedown', close);
    };
    document.addEventListener('mousedown', close);
  }, 0);
}

async function anaToggleFav(it, btn) {
  const next = !it.favorite;
  try {
    await api(`/analytics/assets/${it.kind}/${it.id}/favorite`,
      { method: 'POST', body: JSON.stringify({ on: next }) });
    it.favorite = next;
    if (btn) btn.classList.toggle('on', next);
  } catch (e) { toast((e && e.message) || '즐겨찾기에 실패했습니다.', 'err'); }
}

function anaAssetMenu(it, anchor) {
  const items = [{ icon: 'eye', label: '열기', run: () => anaOpenAsset(it) }];
  if (it.kind === 'dashboard') {
    items.push({ icon: 'ext', label: '편집', run: () => window.open(it.editUrl, '_blank') });
  } else if (it.modelId) {
    items.push({ icon: 'model', label: '데이터 모델 보기', run: () => go('modeling', it.modelId) });
  }
  items.push({ icon: 'trash', label: '삭제', danger: true, run: async () => {
    if (!window.confirm(`「${it.name}」 을 삭제할까요? 데이터는 지워지지 않습니다.`)) return;
    try {
      await api(`/analytics/assets/${it.kind}/${it.id}`, { method: 'DELETE' });
      toast(`「${it.name}」 삭제됨`);
      if (it.kind === 'dashboard') anaCloseTab(it.id);
      ANA.data = null; anaLoad(true);
    } catch (e) { toast((e && e.message) || '삭제에 실패했습니다.', 'err'); }
  } });
  anaMenuAt(anchor, items);
}

/* 분석(차트)을 열면 그 분석이 올라간 대시보드 탭을 연다.
   차트 단독 화면을 만들지 않는다 — 사용자가 보는 단위는 대시보드다. */
function anaOpenAsset(it) {
  if (it.kind === 'dashboard') { anaOpenTab(it.id); return; }
  const d = ((ANA.data && ANA.data.dashboards) || []).find(x =>
    (x.models || []).some(m => m.id === it.modelId));
  if (d) { anaOpenTab(d.id); return; }
  toast('이 분석이 올라간 대시보드가 없습니다.');
}

/* ── 사이드바 ───────────────────────────────────────────────── */

function anaSidebar() {
  const open = S.anaSideOpen;
  const aside = el(`<aside class="mod-l ${open ? '' : 'closed'}"
      style="${open ? `width:${S.leftW}px` : ''}">
    <div class="mod-l-head"><span class="b6 t13">대시보드</span>
      <button class="iconbtn sp" id="alTgl" title="${open ? '목록 접기' : '목록 펼치기'}">
        ${ic14(open ? 'chevl' : 'menu')}</button></div>
    <div class="mod-l-body f1 col" style="min-height:0">
      <div class="f1 col g4" style="overflow:auto;padding:0 8px 8px" id="alList"></div>
    </div></aside>`);
  $('#alTgl', aside).onclick = () => { S.anaSideOpen = !S.anaSideOpen; render(); };
  if (!open) return aside;

  const host = $('#alList', aside);
  const items = (ANA.data && ANA.data.dashboards) || [];
  const secHead = (icon, title, n) => el(`<div class="row g6"
      style="padding:9px 4px 3px;position:sticky;top:0;background:var(--surface);z-index:1">
      ${ic14(icon, 'fnt')}<span class="t11 b6">${title}</span>
      <span class="t11 fnt">${n}개</span></div>`);

  const favs = items.filter(d => d.favorite);
  if (favs.length) {
    host.appendChild(secHead('star', '즐겨찾기', favs.length));
    favs.forEach(d => host.appendChild(anaSideRow(d)));
  }
  host.appendChild(secHead('chart', '전체', items.length));
  if (!items.length) {
    host.appendChild(el('<div class="t12 fnt" style="padding:8px 4px">대시보드가 없습니다.</div>'));
  }
  items.forEach(d => host.appendChild(anaSideRow(d)));
  return aside;
}

function anaSideRow(d) {
  const on = S.anaTab === d.id;
  const row = el(`<button class="list-i ${on ? 'on' : ''}" style="width:100%;text-align:left">
    ${ic14('chart', on ? '' : 'fnt')}
    <span class="t12 trunc f1">${esc(d.name)}</span>
    ${d.favorite ? ic14('star', 'ana-fav on') : ''}</button>`);
  row.onclick = () => anaOpenTab(d.id);
  return row;
}

/* ── 탭 스트립 ──────────────────────────────────────────────── */

function anaTabStrip() {
  const strip = tabStrip('doc');

  /* 첫 탭은 목록이며 닫을 수 없다 — 돌아올 자리가 항상 있어야 한다. */
  const first = tabBtn({ label: '데이터 분석', icon: 'chart', on: S.anaTab === 'list',
    onClick: () => { S.anaTab = 'list'; S.anaView = ''; render(); } });
  strip.appendChild(first);

  S.anaTabs.forEach(id => {
    const d = anaDash(id);
    if (!d) return;
    const t = tabBtn({ label: d.name, icon: 'tbl', on: S.anaTab === id, closable: true,
      onClick: () => anaOpenTab(id), onClose: () => anaCloseTab(id) });
    strip.appendChild(t);
  });
  return strip;
}

/* ── 목록 화면 ──────────────────────────────────────────────── */

/* 카드에 소유자를 두지 않는다. 대시보드를 고를 때 쓰는 정보는
   이름 · 어떤 데이터인지 · 언제 바뀌었는지, 이 셋이다. */
function anaCard(it) {
  const tags = String(it.desc || '').split(',').map(x => x.trim()).filter(Boolean);
  const c = el(`<div class="ana-c">
    <div class="cacts">
      <button class="iconbtn ana-fav ${it.favorite ? 'on' : ''}"
        title="즐겨찾기">${ic14('star')}</button>
      <button class="iconbtn" title="더보기">${ic14('dots')}</button>
    </div>
    <span class="ct">${esc(it.name)}</span>
    <span class="cd">${tags.length
      ? tags.slice(0, 2).map(t => `<span class="ana-tag">${esc(t)}</span>`).join('')
      : '<span class="ana-tag">연결된 데이터 없음</span>'}</span>
    <span class="cfoot">${esc(anaWhen(it.changedAt) || '—')}</span>
  </div>`);
  const [fav, more] = $$('.iconbtn', c);
  c.onclick = () => anaOpenAsset(it);
  fav.onclick = (e) => { e.stopPropagation(); anaToggleFav(it, fav); };
  more.onclick = (e) => { e.stopPropagation(); anaAssetMenu(it, more); };
  return c;
}

function anaListView(host) {
  const top = el(`<div class="ana-top row" style="align-items:flex-start">
    <div class="f1">
      <h1 class="tt">데이터 분석</h1>
      <p class="td">DATA MART 로 지정된 데이터 모델을 골라 차트·지표·대시보드를 만듭니다.</p>
    </div>
    <button class="btn pri" id="anaNew">${ic14('plus')}새 분석</button>
  </div>`);
  host.appendChild(top);
  $('#anaNew', top).onclick = () => { buildReset(''); S.anaView = 'pick'; render(); };

  const scroll = el('<div class="ana-scroll"></div>');
  const inner = el('<div class="ana-inner"></div>');
  scroll.appendChild(inner); host.appendChild(scroll);

  if (ANA.error) {
    inner.appendChild(el(`<div class="ana-empty">${esc(ANA.error)}<br>
      잠시 후 다시 시도해 주세요.</div>`));
    return;
  }
  if (!ANA.data) { inner.appendChild(el('<div class="ana-empty">불러오는 중…</div>')); return; }

  /* 섹션 1 — 최근 사용한 분석. 카드 3개만. 건수·전체보기를 두지 않는다. */
  const recent = (ANA.data.recent || []).slice(0, 3);
  const s1 = el(`<div class="ana-sec">
    <div class="ana-sec-h"><span class="t">최근 사용한 분석</span></div></div>`);
  if (!recent.length) {
    s1.appendChild(el(`<div class="ana-empty">아직 만든 분석이 없습니다.
      「새 분석」으로 시작해 보세요.</div>`));
  } else {
    const g = el('<div class="ana-grid"></div>');
    recent.forEach(it => g.appendChild(anaCard(it)));
    s1.appendChild(g);
  }
  inner.appendChild(s1);

  /* 섹션 2 — 전체 대시보드. 즐겨찾기가 최상단. */
  const all = (ANA.data.dashboards || []).slice()
    .sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0));
  const shown = S.anaAllDash ? all : all.slice(0, 6);
  const s2 = el(`<div class="ana-sec">
    <div class="ana-sec-h"><span class="t">전체 대시보드</span>
      <span class="n">${all.length}</span>
      ${all.length > 6 ? `<button class="ana-txt sp" id="anaAll">${
        S.anaAllDash ? '접기' : '전체보기'}</button>` : ''}</div></div>`);
  if (!all.length) {
    s2.appendChild(el(`<div class="ana-empty">대시보드가 없습니다.
      분석을 만들고 대시보드에 추가하면 여기에 나타납니다.</div>`));
  } else {
    const g = el('<div class="ana-grid"></div>');
    shown.forEach(it => g.appendChild(anaCard(it)));
    s2.appendChild(g);
  }
  inner.appendChild(s2);
  const allBtn = $('#anaAll', s2);
  if (allBtn) allBtn.onclick = () => { S.anaAllDash = !S.anaAllDash; render(); };
}

/* ── 상세 화면 — 분석 엔진 화면을 그대로 띄운다 ──────────────────

   예전에는 저장된 차트의 query_context 를 읽어 **플랫폼이 SVG 로 직접 그렸다.**
   그리는 쪽을 우리가 쥐면 디자인 기준을 그대로 입힐 수 있다는 것이 근거였는데,
   실제로 쓰면서 값이 더 큰 쪽이 반대라는 것이 드러났다.

   직접 그리면 **우리가 구현한 시각화만 나온다.** 막대·선·원·숫자·표 다섯 가지가
   전부라, 엔진에서 만든 히트맵·이중축 콤보·가로 막대는 자리만 잡고 비어 있었다.
   편집 버튼으로 엔진에 들어가면 멀쩡히 보이는 차트가 서비스 화면에서는 사라지니,
   사용자 입장에서는 «같은 대시보드가 두 개» 다.

   필터도 마찬가지였다. 좌측 레일에 필터 아이콘이 있었지만 누를 데가 없었다 —
   대시보드 필터는 엔진이 관리하는데 그 상태를 우리 캔버스가 알 방법이 없어서다.

   그래서 엔진 화면을 iframe 으로 그대로 띄운다. 시각화 종류·상단 필터·교차 필터·
   툴팁·CSV 내려받기가 전부 엔진 것이라 **편집 화면과 서비스 화면이 어긋나지 않는다.**
   주소는 프록시를 거치므로 사용자는 엔진 주소를 알지 못하고, standalone=1 이
   엔진의 전역 네비게이션을 걷어내 우리 골격 안에 들어앉는다.                       */

function anaEmbedUrl(dashId) {
  // standalone=2 — 엔진의 전역 네비게이션과 **대시보드 제목 헤더**를 걷어낸다.
  // 제목·편집 버튼은 우리 화면이 이미 갖고 있어서, 1 로 두면 같은 제목이 두 번 나온다.
  // 3 은 리포트 모드라 필터 바까지 사라지므로 쓰지 않는다.
  // show_filters·expand_filters 로 상단 필터를 펼친 채 연다.
  return `${ORIGIN}/superset/dashboard/${encodeURIComponent(dashId)}/`
    + '?standalone=2&show_filters=1&expand_filters=1';
}

/* ── 상세 화면 ──────────────────────────────────────────────── */

/* 원천이 마트보다 새것이면 알린다.
   숫자가 안 나오는 것보다 **오래된 숫자가 아무 표시 없이 그려지는 것** 이 위험하다.
   화면은 멀쩡해 보이는데 값만 어제 것이라, 보는 사람이 알아챌 방법이 없다.
   판정은 서버가 한다(analytics.py 의 _upstream_load) — 상류를 뿌리까지 훑어
   가장 최근 적재 시각과 마트의 적재 시각을 견준다. */
function anaStaleTag(d) {
  if (!d.needsRefresh) return '';
  const which = (d.staleModels || []).join(', ');
  return `<span class="ana-stale" title="${esc(which)} 의 원천이 더 최근에 적재됐습니다.
가공 파이프라인을 실행하면 최신 값으로 바뀝니다.">${ic14('alert')}마트 데이터 갱신 필요</span>`;
}

function anaDetailView(host, d) {
  /* 이 대시보드가 어떤 DATA MART 를 보고 있는지. 눌러서 그 모델로 되돌아간다 —
     분석은 흐름의 끝이지만 막다른 길은 아니다. */
  const links = (d.models || []).map(m =>
    `<a class="lnk" data-model="${esc(m.id)}" style="font-size:var(--fs-body)"
      title="이 분석이 쓰는 데이터 모델을 봅니다">${esc(m.name)}</a>`)
    .join('<span style="color:var(--faint)">,</span> ');
  const when = anaWhen(d.dataUpdated);

  const top = el(`<div class="ana-top row" style="align-items:center;padding:12px 24px">
    <div class="f1 col g4" style="min-width:0">
      <span class="trunc" style="font-size:var(--fs-page);font-weight:700;color:var(--ink);
        letter-spacing:-0.5px">${esc(d.name)}</span>
      <span class="row g6" style="flex-wrap:wrap;font-size:var(--fs-body);color:var(--muted)">
        ${links ? grpTag('DATA MART') : ''}
        ${links || '<span>연결된 데이터를 찾지 못했습니다.</span>'}
        ${when ? `<span>·</span><span>마지막 업데이트 ${esc(when)}</span>` : ''}
        ${anaStaleTag(d)}</span>
    </div>
    <button class="btn sm" id="anaRefresh">${ic14('rot')}새로고침</button>
    <button class="btn pri sm" id="anaEdit">${ic14('pen')}편집</button>
  </div>`);
  host.appendChild(top);
  $$('[data-model]', top).forEach(a => a.onclick = () => go('modeling', a.dataset.model));

  /* 여기에는 **자리만** 놓는다. 진짜 iframe 은 #app 바깥의 고정 층에 살고,
     이 자리의 좌표에 맞춰 겹쳐 놓인다. 이유는 anaFrames 주석에 있다.
     스크롤은 iframe 안에서 한 겹으로 일어난다 — 바깥에 스크롤 컨테이너를 두면
     대시보드가 길어질 때 스크롤바가 두 개 생긴다. */
  const slot = el('<div class="ana-frame-slot f1" data-dash="' + esc(d.id) + '"></div>');
  host.appendChild(slot);

  // 새로고침은 프레임을 다시 띄운다 — 엔진이 질의를 다시 돌린다.
  $('#anaRefresh', top).onclick = () => {
    const f = ANA.frames[d.id];
    if (f) f.src = anaEmbedUrl(d.id);
  };
  $('#anaEdit', top).onclick = () => window.open(d.editUrl, '_blank');
}

/* ── 진입 ───────────────────────────────────────────────────── */

function pageAnalytics() {
  const page = el('<div class="page flush" style="display:flex;'
    + 'flex-direction:column;min-height:0"></div>');
  anaLoad(false);

  /* 지워진 대시보드의 탭은 정리한다 */
  if (ANA.data) {
    S.anaTabs = S.anaTabs.filter(id => anaDash(id));
    if (S.anaTab !== 'list' && !anaDash(S.anaTab)) S.anaTab = 'list';
  }

  const row = el('<div class="mod f1" style="min-height:0"></div>');
  row.appendChild(anaSidebar());
  const body = el('<div class="mod-c f1" style="min-width:0;min-height:0"></div>');
  body.appendChild(anaTabStrip());

  const inner = el('<div class="f1 col" style="min-height:0"></div>');
  if (S.anaView === 'pick') anaPickData(inner);          // b54.js
  else if (S.anaView === 'build') anaBuild(inner);       // b54.js
  else if (S.anaTab === 'list') anaListView(inner);
  else {
    const d = anaDash(S.anaTab);
    if (d) anaDetailView(inner, d); else anaListView(inner);
  }
  body.appendChild(inner);
  row.appendChild(body);
  page.appendChild(row);
  return page;
}

/* ── 임베드 프레임 층 ─────────────────────────────────────────
   iframe 을 화면 트리 안에 두지 않고 **#app 바깥의 고정 층**에 두고,
   자리표시자(.ana-frame-slot)의 좌표에 맞춰 겹쳐 놓는다.

   이유. render() 는 `app.innerHTML = ''` 로 화면을 통째로 다시 만든다.
   그 안에 iframe 이 있으면 사이드바를 접는 것 같은 사소한 조작에도 iframe 이
   새로 생기고, 브라우저는 새 iframe 을 새 문서로 보므로 대시보드 HTML·번들·
   차트 질의까지 전부 다시 받아온다. 토글 한 번에 요청이 여섯 건 나갔다.

   «만들어 둔 iframe 을 옮겨 붙이면 되지 않나» 는 이 브라우저에서 성립하지
   않는다. 실측하니 제거 후 재삽입은 물론 **부모만 바꾸는 이동도 재로드**를
   일으켰다(로드 이벤트 1→2→3). 그래서 옮기지 않는다 — DOM 상의 부모를 한 번
   정하고 끝까지 그대로 두고, 위치만 좌표로 맞춘다.

   층은 z-index 50 이다. 헤더(60)보다 아래라 헤더를 가리지 않고,
   모달 스크림(100)보다 아래라 모달이 정상적으로 덮는다. */
function anaFrameLayer() {
  let layer = document.getElementById('anaFrames');
  if (!layer) {
    layer = el('<div id="anaFrames"></div>');
    document.body.appendChild(layer);
  }
  return layer;
}

function anaFrameFor(dashId, name) {
  if (ANA.frames[dashId]) return ANA.frames[dashId];
  const f = el(`<iframe class="ana-frame" src="${esc(anaEmbedUrl(dashId))}"
    title="${esc(name || '')}"></iframe>`);
  anaFrameLayer().appendChild(f);
  ANA.frames[dashId] = f;
  return f;
}

function anaDropFrame(dashId) {
  const f = ANA.frames[dashId];
  if (!f) return;
  f.remove();                       // 탭을 닫으면 문서도 버린다
  delete ANA.frames[dashId];
}

/* 자리표시자 위에 프레임을 맞춘다. 보이지 않아야 할 프레임은 감춘다.
   좌표를 쓰는 대신 자리표시자를 그대로 부모로 삼을 수 없는 이유는 위 주석 참고. */
function anaSyncFrames() {
  const layer = document.getElementById('anaFrames');
  if (!layer) return;
  const slot = S.page === 'analytics' ? $('.ana-frame-slot') : null;
  const active = slot ? slot.dataset.dash : null;

  Object.keys(ANA.frames).forEach(id => {
    const f = ANA.frames[id];
    if (String(id) !== String(active)) { f.style.display = 'none'; return; }
    const r = slot.getBoundingClientRect();
    /* 폭·높이가 0 이면 아직 배치 전이다. 그 값으로 맞추면 프레임이 접혔다가
       다시 펴지면서 깜빡인다 — 다음 프레임에 다시 시도한다. */
    if (r.width < 2 || r.height < 2) { requestAnimationFrame(anaSyncFrames); return; }
    f.style.display = 'block';
    f.style.top = `${Math.round(r.top)}px`;
    f.style.left = `${Math.round(r.left)}px`;
    f.style.width = `${Math.round(r.width)}px`;
    f.style.height = `${Math.round(r.height)}px`;
  });

  /* 자리표시자의 크기가 바뀌면(사이드바 접기의 width 전환 포함) 따라 움직인다.
     전환 중에도 계속 불리므로 프레임이 사이드바와 함께 미끄러진다. */
  if (slot && ANA.__ro !== slot) {
    if (ANA.__obs) ANA.__obs.disconnect();
    ANA.__obs = new ResizeObserver(() => anaSyncFrames());
    ANA.__obs.observe(slot);
    ANA.__ro = slot;
  } else if (!slot && ANA.__obs) {
    ANA.__obs.disconnect(); ANA.__obs = null; ANA.__ro = null;
  }
}

window.addEventListener('resize', () => anaSyncFrames());

/* render() 뒤에 위치를 맞춘다. 화면을 다시 그려도 프레임은 그대로 살아 있고
   좌표만 새 배치에 맞춰진다. */
render = (function (base) {
  return function () {
    base.apply(this, arguments);
    if (S.page === 'analytics') {
      const slot = $('.ana-frame-slot');
      if (slot) {
        const d = anaDash(Number(slot.dataset.dash)) || anaDash(slot.dataset.dash);
        anaFrameFor(slot.dataset.dash, d && d.name);
      }
    }
    anaSyncFrames();
  };
})(render);
