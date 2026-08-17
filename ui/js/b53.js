/* ── b53 — 데이터 분석 모듈 ──
   ============================================================
   골격을 데이터 파이프라인 화면과 같게 맞춘다. 새 골격을 만들지 않는다.

       .page.flush
         .mod
           .mod-c
             .ptabs 탭 스트립 (첫 탭 = 목록, 이후 = 열린 대시보드)
             내용   목록 | 상세 | 마법사(b54)

   좌측 사이드바(.mod-l)는 없다 — 본문 목록 화면과 같은 목록을 두 번 보여주고
   있었다. 근거는 아래 «사이드바 없음» 절.

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
/* (S.anaSideOpen 은 사이드바와 함께 지웠다 — 접을 패널이 없다) */
S.anaAllDash = S.anaAllDash || false;
S.anaQuery = S.anaQuery || '';   // 대시보드 이름 검색

const ANA = { data: null, error: null, loading: false,
              hidden: {},
              /* 대시보드 id → iframe / 그 iframe 을 담은 상자.
                 둘 다 #app 바깥에 산다 — anaSyncFrames 참고. */
              frames: {}, boxes: {} };

/* 분석에 쓸 수 있는 데이터(DATA MART) 목록. 목록 화면이 「무엇으로 분석을
   시작할 수 있는가」를 보여주는 데 쓴다. 실패해도 화면이 죽지 않는다 —
   있으면 좋고 없어도 되는 섹션이다. */
async function anaLoadMarts() {
  if (ANA.marts || ANA.martsLoading) return;
  ANA.martsLoading = true;
  try {
    const r = await api('/analytics/build/options');
    ANA.marts = (r.models || []).filter(m => m.group === 'DATA MART');
  } catch (e) {
    ANA.marts = [];
  } finally {
    ANA.martsLoading = false;
    if (S.page === 'analytics') render();
  }
}

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
    if (btn) {
      btn.classList.toggle('on', next);
      /* 툴팁과 보조기술 상태도 같이 바꾼다 — 색만 바뀌면 다음에 누를 때
         무엇이 일어날지 알 수 없고, 스크린리더에는 아무것도 바뀌지 않는다. */
      btn.title = next ? '즐겨찾기 해제' : '즐겨찾기';
      btn.setAttribute('aria-pressed', next ? 'true' : 'false');
    }
    /* 즐겨찾기는 「전체 대시보드」 정렬의 기준이다(맨 위로 올라간다).
       목록에 있을 때만 다시 그린다 — 상세를 보는 중에 화면이 튀지 않게. */
    if (S.page === 'analytics' && S.anaTab === 'list' && !S.anaView) render();
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

/* ── 사이드바 없음 ───────────────────────────────────────────────
   대시보드 목록 사이드바(anaSidebar · anaSideRow)를 걷어냈다.

   같은 목록을 두 곳에서 보여주고 있었다 — 좌측 패널의 한 줄짜리 목록과, 본문
   목록 화면의 카드 그리드. 둘 다 누르면 anaOpenTab 으로 같은 탭을 열었으므로
   진입점이 둘이었을 뿐 하는 일이 같았다. 그러면서 240~264px 을 상시 차지해,
   임베드 대시보드가 눌리지 않는 최소 폭(--ana-frame-min 1100px)을 확보하기
   어려웠다.

   없애도 잃는 것이 없다는 근거
     · 대시보드 열기   → 목록 화면 카드가 같은 anaOpenTab 을 부른다.
     · 즐겨찾기        → 카드의 별 토글(anaFav)이 그대로이고, 「전체 대시보드」
                        섹션이 favorite 을 최상단으로 정렬한다.
     · 열린 대시보드 이동 → 탭 스트립(anaTabStrip)이 원래 그 역할이다.
   ─────────────────────────────────────────────────────────────── */

/* ── 탭 스트립 ──────────────────────────────────────────────── */

function anaTabStrip() {
  const strip = tabStrip('doc');

  /* 첫 탭은 목록이며 닫을 수 없다 — 돌아올 자리가 항상 있어야 한다.
     이름이 화면이 정한 고정 문구라 폭도 글자에 맞춘다(.tab-fit) — 뒤에 붙는
     대시보드 탭들과 달리 사용자 데이터가 아니어서 길이를 예측할 수 있다. */
  const first = tabBtn({ label: '데이터 분석', icon: 'chart', on: S.anaTab === 'list',
    onClick: () => { S.anaTab = 'list'; S.anaView = ''; render(); } });
  first.classList.add('tab-fit');
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
/* 대시보드 카드 — 디자인 구조를 따른다.
   머리(이름·요약·즐겨찾기·더보기) / 몸통(데이터 태그 · 시각 2행) / 발(상태 · 열기).
   요약을 «차트 N» 으로 쓰지 않는 이유는 그 값이 대시보드마다 추가 요청을 부르기
   때문이다 — 목록 하나 그리려고 N 번을 더 부르게 된다. 이미 받아 온 모델 수를 쓴다. */
function anaCard(it) {
  const tags = String(it.desc || '').split(',').map(x => x.trim()).filter(Boolean);
  const hidden = Math.max(tags.length - 3, 0);
  const nModel = (it.models || []).length;
  const stale = !!it.needsRefresh;

  const c = el(`<div class="dc-card">
    <div class="dc-card-h">
      <div class="col f1" style="gap:2px;min-width:0">
        <span class="dc-ct trunc">${esc(it.name)}</span>
        <span class="dc-cs">${nModel ? `데이터 ${nModel}개` : '연결된 데이터 없음'}</span>
      </div>
      <div class="row" style="gap:2px;flex:none">
        <button class="iconbtn ana-fav ${it.favorite ? 'on' : ''}" data-fav
          title="${it.favorite ? '즐겨찾기 해제' : '즐겨찾기'}"
          aria-pressed="${it.favorite ? 'true' : 'false'}">${ic14('star')}</button>
        <button class="iconbtn" data-more title="더보기">${ic14('dots')}</button>
      </div>
    </div>
    <div class="dc-card-b">
      <div class="row g4" style="flex-wrap:wrap">
        ${tags.length
          ? tags.slice(0, 3).map(t => `<span class="ana-tag">${esc(t)}</span>`).join('')
            + (hidden ? `<span class="ana-tag more">+${hidden}</span>` : '')
          : '<span class="ana-tag">연결된 데이터 없음</span>'}
      </div>
      <div class="dc-kv">
        <span>마지막 업데이트</span><span>${esc(anaWhen(it.dataUpdated) || '—')}</span>
        <span>수정</span><span>${esc(anaWhen(it.changedAt) || '—')}</span>
      </div>
    </div>
    <div class="dc-card-f">
      <span class="dc-state ${stale ? 'warn' : 'ok'}">
        <span class="dc-dot"></span>${stale ? '갱신 필요' : '최신 상태'}</span>
      <button class="btn sm">열기</button>
    </div>
  </div>`);

  /* 순서로 집지 않는다 — 버튼이 하나 늘거나 순서가 바뀌면 조용히 엉뚱한 것을
     집게 된다. 실제로 즐겨찾기 자리에서 더보기가 열리는 식으로 어긋난다. */
  const fav = $('[data-fav]', c), more = $('[data-more]', c), open = $('.btn', c);
  c.onclick = () => anaOpenAsset(it);
  open.onclick = (e) => { e.stopPropagation(); anaOpenAsset(it); };
  fav.onclick = (e) => { e.stopPropagation(); anaToggleFav(it, fav); };
  more.onclick = (e) => { e.stopPropagation(); anaAssetMenu(it, more); };
  return c;
}

/* 「새 대시보드 만들기」 — 그리드의 마지막 칸. 카드가 하나뿐일 때 그 옆이
   비어 보이던 자리를 다음 행동이 채운다. */
function anaNewCard() {
  const b = el(`<button class="dc-new">
    ${ic14('plus')}
    <span class="t1">새 대시보드 만들기</span>
    <span class="t2">분석을 만들어 대시보드에 담습니다.</span></button>`);
  b.onclick = () => { buildReset(''); S.anaView = 'pick'; render(); };
  return b;
}

/* 분석 대상 데이터 — 카드가 아니라 표다.
   마트는 «고르는 것» 이 아니라 «훑어보고 고르는 것» 이라, 설명을 나란히 읽을 수
   있어야 한다. 카드로 늘어놓으면 설명이 잘리고 서로 비교되지 않는다.
   행 수 대신 컬럼 수를 쓴다 — 행 수는 서버가 주지 않고(run.rows 가 null),
   따로 세려면 마트마다 질의를 돌려야 한다. */
function anaMartTable(marts, used) {
  const wrap = el(`<div class="dc-table">
    <table><thead><tr>
      <th style="width:300px">데이터명</th>
      <th>설명</th>
      <th class="num" style="width:96px">컬럼</th>
      <th class="ctr" style="width:120px">사용 대시보드</th>
      <th style="width:110px"></th>
    </tr></thead><tbody></tbody></table></div>`);
  const tb = $('tbody', wrap);
  marts.forEach(m => {
    const n = used[m.id] || 0;
    const tr = el(`<tr>
      <td class="vt">
        <span class="dc-mname">${ic14('tbl')}${esc(m.name || m.id)}</span>
        <span class="dc-mphys">${esc(m.phys || '')}</span>
      </td>
      <td class="vt desc">${esc((m.desc || '').split('\n')[0] || '설명이 없습니다.')}</td>
      <td class="vt num">${m.cols == null ? '—' : m.cols}</td>
      <td class="vt ctr">${n ? `${n}곳` : '—'}</td>
      <td class="vt" style="text-align:right">
        <button class="btn sm">분석</button></td>
    </tr>`);
    $('.btn', tr).onclick = () => {
      buildReset(m.id);
      if (typeof buildLoadColumns === 'function') buildLoadColumns(m.id);
      S.anaView = 'build'; render();
    };
    tb.appendChild(tr);
  });
  return wrap;
}

function anaListView(host) {
  const top = el(`<div class="ana-top inset row" style="align-items:flex-end">
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

  /* ── 전체 대시보드 ── 검색은 이름만 본다. 대시보드가 몇 개 없을 때도 두는 이유는,
     늘어난 뒤에 자리가 생기는 것보다 자리가 늘 같은 편이 찾기 쉽기 때문이다. */
  const q = (S.anaQuery || '').trim().toLowerCase();
  const all = (ANA.data.dashboards || []).slice()
    .sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0));
  const hit = q ? all.filter(d => String(d.name).toLowerCase().includes(q)) : all;

  const s1 = el(`<div class="ana-sec">
    <div class="dc-sec-h">
      <span class="row" style="align-items:baseline">
        <span class="t">전체 대시보드</span><span class="n">${all.length}</span></span>
      <span class="dc-srch">${ic14('search', 'fnt')}
        <input placeholder="대시보드 이름 검색" value="${esc(S.anaQuery || '')}"></span>
    </div></div>`);
  const g1 = el('<div class="ana-grid"></div>');
  hit.forEach(it => g1.appendChild(anaCard(it)));
  if (!q) g1.appendChild(anaNewCard());
  if (q && !hit.length) {
    g1.appendChild(el(`<div class="ana-empty" style="grid-column:1/-1">
      「${esc(S.anaQuery)}」 와 맞는 대시보드가 없습니다. 검색어를 줄여 보세요.</div>`));
  }
  s1.appendChild(g1);
  inner.appendChild(s1);

  const srch = $('.dc-srch input', s1);
  srch.oninput = (e) => {
    S.anaQuery = e.target.value;
    const at = e.target.selectionStart;
    render();
    const again = $('.dc-srch input');
    if (again) { again.focus(); again.setSelectionRange(at, at); }
  };

  /* ── 분석 대상 데이터 ── 이 화면의 일은 «분석 선택 → 데이터 선택» 의 첫 칸인데,
     정작 고를 수 있는 데이터가 어디에도 없었다. 「새 분석」을 눌러야 알 수 있었다. */
  anaLoadMarts();
  const marts = ANA.marts || [];
  const used = {};
  (ANA.data.dashboards || []).forEach(d =>
    (d.models || []).forEach(m => { used[m.id] = (used[m.id] || 0) + 1; }));

  const s2 = el(`<div class="ana-sec">
    <div class="dc-sec-h">
      <span class="row" style="align-items:baseline">
        <span class="t">분석 대상 데이터</span>
        ${marts.length ? `<span class="n">${marts.length}</span>` : ''}</span>
      <span class="t12 fnt">DATA MART 로 지정된 데이터 모델만 표시</span>
    </div></div>`);
  if (!ANA.marts) {
    s2.appendChild(el('<div class="ana-empty">불러오는 중…</div>'));
  } else if (!marts.length) {
    s2.appendChild(el(`<div class="ana-empty">분석에 쓸 수 있는 데이터가 없습니다.
      데이터 모델 화면에서 최종 모델을 「DATA MART 로 지정」해 주세요.</div>`));
  } else {
    s2.appendChild(anaMartTable(marts, used));
  }
  inner.appendChild(s2);
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

  /* .mod 은 좌측 패널과 본문을 나란히 두던 그릇이다. 패널이 없어져 본문 하나만
     남지만, .mod-c 의 배경·경계가 이 안에 있을 때를 전제로 잡혀 있어 그릇은 둔다. */
  const row = el('<div class="mod f1" style="min-height:0"></div>');
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

/* 프레임은 **상자 안에** 만든다. 상자가 자리표시자 크기로 잘라 내고, 그 안에서
   프레임은 최소 폭(--ana-frame-min)을 지킨다.

   최소 폭이 필요한 이유. 분석 엔진의 대시보드는 좁아지면 칸을 접는 것이 아니라
   **칸을 눌러서** 담는다. 그러면 「78,0」 처럼 숫자가 중간에서 끊기고, 표의 값도
   잘린다 — 화면은 멀쩡해 보이는데 숫자만 틀린 셈이라 가장 나쁜 실패다.
   최소 폭 아래로는 눌리는 대신 상자가 가로로 스크롤된다. 좁은 화면 방침
   (app.css «지원 폭»)과 같은 선택이다 — 접지 않고 훑는다.

   상자와 프레임은 한 번 만들고 부모를 바꾸지 않는다. 옮기면 재로드되기 때문이다. */
function anaFrameFor(dashId, name) {
  if (ANA.frames[dashId]) return ANA.frames[dashId];
  const box = el('<div class="ana-frame-box"></div>');
  const f = el(`<iframe class="ana-frame" src="${esc(anaEmbedUrl(dashId))}"
    title="${esc(name || '')}"></iframe>`);
  box.appendChild(f);
  anaFrameLayer().appendChild(box);
  ANA.frames[dashId] = f;
  ANA.boxes[dashId] = box;
  return f;
}

function anaDropFrame(dashId) {
  const box = ANA.boxes[dashId];
  if (box) box.remove();            // 탭을 닫으면 문서도 버린다
  delete ANA.frames[dashId];
  delete ANA.boxes[dashId];
}

/* 자리표시자 위에 프레임을 맞춘다. 보이지 않아야 할 프레임은 감춘다.
   좌표를 쓰는 대신 자리표시자를 그대로 부모로 삼을 수 없는 이유는 위 주석 참고. */
function anaSyncFrames() {
  const layer = document.getElementById('anaFrames');
  if (!layer) return;
  const slot = S.page === 'analytics' ? $('.ana-frame-slot') : null;
  const active = slot ? slot.dataset.dash : null;

  Object.keys(ANA.boxes).forEach(id => {
    const box = ANA.boxes[id];
    if (String(id) !== String(active)) { box.style.display = 'none'; return; }
    const r = slot.getBoundingClientRect();
    /* 폭·높이가 0 이면 아직 배치 전이다. 그 값으로 맞추면 상자가 접혔다가
       다시 펴지면서 깜빡인다 — 다음 프레임에 다시 시도한다. */
    if (r.width < 2 || r.height < 2) { requestAnimationFrame(anaSyncFrames); return; }
    box.style.display = 'block';
    box.style.top = `${Math.round(r.top)}px`;
    box.style.left = `${Math.round(r.left)}px`;
    box.style.width = `${Math.round(r.width)}px`;
    box.style.height = `${Math.round(r.height)}px`;
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

/* 창 크기 변화에 따라붙는다. 한 번만 맞추면 배치가 끝나기 전 값을 잡을 수 있어
   다음 프레임에 한 번 더 맞춘다. visualViewport 도 함께 듣는 이유는, 브라우저가
   창 크기를 바꾸는 방식(개발자 도구·에뮬레이션 등)에 따라 window 의 resize 가
   오지 않는 경우가 있어서다 — 그때 프레임만 옛 크기로 남아 대시보드가 잘린다. */
function anaResync() {
  anaSyncFrames();
  requestAnimationFrame(anaSyncFrames);
}
window.addEventListener('resize', anaResync);
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', anaResync);
}

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
