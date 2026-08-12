/* ── b11 — ── b11 — 카탈로그 · 파이프라인 · 홈 정리 ── (index.html 블록에서 기계적 추출, 동작 불변) */

/* ============================================================
   카탈로그 · 파이프라인 · 홈 정리
   ============================================================ */
/* 좁은 화면에서 상세는 슬라이드 오버 */
/* ── 파이프라인 목록 단순화 ── */
/* (pagePipeline — 이후 정의가 값 캡처 없이 전면 교체. 죽은 층 제거) */
/* ── 실행 흐름도 ── */
/* 실패 파이프라인 진입 시 실패 모델 자동 선택 */
/* (pagePipeDetail — 이후 정의가 값 캡처 없이 전면 교체. 죽은 층 제거) */
/* 로그 탭에서 오류 줄 강조 */
/* ── 홈 정리 ── */
pageHome = function () {
  const r = R();
  const errPipes = PIPES.filter(x => x.status === 'err');
  const stale = D.filter(d => d.stale);
  const failTests = TESTS.filter(t => t.status === 'err');
  const p = el('<div class="page"></div>');
  /* 워크 스페이스 탭을 걷어내 홈은 한 화면이다. 탭이 하나뿐이면 탭 줄은 고르는
     자리가 아니라 장식이라 함께 없앤다.

     대신 이 화면이 무엇인지 제목으로 말한다. 탭 이름(「데이터셋 현황」)이 유일한
     설명이었는데 탭 줄과 함께 사라져, 들어온 사람이 아래 카드들이 무엇의 현황인지
     알 수 없었다. 기준 시각은 그 줄 오른쪽에 둔다 — 이 화면 숫자가 언제 것인지
     말하는 값이라 제목과 같은 줄에 있어야 함께 읽힌다.
     제목줄(.page-h)은 b01 이 홈에서 걷어가므로 여기서 직접 그린다. */
  p.appendChild(el(`<div class="home-h">
    <h1 class="page-t">데이터셋 현황</h1>
    <span class="home-when">${esc(nowLabel())} 기준</span></div>`));
  /* 데이터 생애주기 — 이 서비스가 다섯 개의 도구가 아니라 하나의 흐름이라는 것을
     첫 화면이 먼저 말한다. (flowRail 은 b31 이 정의한다 — 호출은 렌더 시점이라
     로드 순서와 무관하다) */
  p.appendChild(flowRail());

  /* ── 대시보드 그래프 ── */
  const okPipes = PIPES.filter(x => x.status === 'ok').length;
  const warnTests = TESTS.filter(t => t.status === 'warn').length;
  const passTests = TESTS.filter(t => t.status === 'ok').length;
  const card = (title, sub, onclick) => {
    const c = el(`<section class="card" style="${onclick ? 'cursor:pointer' : ''}">
      <div class="card-h"><span class="card-t">${esc(title)}</span>
        <span class="t11 fnt sp">${esc(sub || '')}</span></div>
      <div class="card-b" style="padding:14px 16px 16px"></div></section>`);
    if (onclick) c.onclick = onclick;
    return c;
  };
  const grid = el('<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px;margin-bottom:16px"></div>');

  /* 1. 최근 7일 파이프라인 실행 결과 */
  const days = ['7/29', '7/30', '7/31', '8/1', '8/2', '8/3', '8/4'];
  const runsOk = [12, 12, 11, 12, 12, 11, 11];
  const runsErr = [0, 0, 1, 0, 0, 1, 1];
  const maxRun = Math.max(...runsOk.map((v, i) => v + runsErr[i]));
  const c1 = card('파이프라인 실행 결과', '최근 7일', () => go('pipeline'));
  $('.card-b', c1).appendChild(el(`<div class="col g10">
    <div class="row g10" style="align-items:flex-end;height:132px">
      ${days.map((d0, i) => {
        const tot = runsOk[i] + runsErr[i], hh = Math.round(112 * tot / maxRun);
        const eh = Math.round(hh * runsErr[i] / tot);
        return `<div class="col f1" style="gap:6px;align-items:center;min-width:0">
          <div style="width:100%;max-width:34px;height:${hh}px;display:flex;flex-direction:column;justify-content:flex-end;
            border-radius:5px;overflow:hidden;background:var(--surface-3)" title="${d0} · 성공 ${runsOk[i]}건${runsErr[i] ? ' · 실패 ' + runsErr[i] + '건' : ''}">
            ${eh ? `<div style="height:${eh}px;background:var(--err)"></div>` : ''}
            <div style="flex:1;background:var(--ok)"></div></div>
          <span class="t11 fnt">${d0}</span></div>`; }).join('')}
    </div>
    <div class="row g12" style="border-top:1px solid var(--line-2);padding-top:10px">
      <span class="row g6 t12"><span style="width:9px;height:9px;border-radius:2px;background:var(--ok);display:inline-block"></span>성공</span>
      <span class="row g6 t12"><span style="width:9px;height:9px;border-radius:2px;background:var(--err);display:inline-block"></span>실패</span>
      <span class="t12 mut sp">오늘 실패 <b style="color:var(--err)">${errPipes.length}건</b>${errPipes.length ? ' · ' + esc(errPipes[0].name) : ''}</span>
    </div></div>`));
  grid.appendChild(c1);

  /* 2. 데이터 검증 결과 도넛 */
  const totT = passTests + warnTests + failTests.length || 1;
  const R0 = 52, C0 = 2 * Math.PI * R0;
  const segErr = C0 * failTests.length / totT, segWarn = C0 * warnTests / totT, segOk = C0 * passTests / totT;
  const c2 = card('데이터 검증 결과', `규칙 ${totT}개`, () => go('quality'));
  $('.card-b', c2).appendChild(el(`<div class="row g16" style="align-items:center">
    <svg viewBox="0 0 140 140" style="width:140px;height:140px;flex:none">
      <g transform="rotate(-90 70 70)">
        <circle cx="70" cy="70" r="${R0}" fill="none" stroke="var(--err)" stroke-width="18"
          stroke-dasharray="${segErr} ${C0 - segErr}" stroke-dashoffset="0"></circle>
        <circle cx="70" cy="70" r="${R0}" fill="none" stroke="var(--warn)" stroke-width="18"
          stroke-dasharray="${segWarn} ${C0 - segWarn}" stroke-dashoffset="${-segErr}"></circle>
        <circle cx="70" cy="70" r="${R0}" fill="none" stroke="var(--ok)" stroke-width="18"
          stroke-dasharray="${segOk} ${C0 - segOk}" stroke-dashoffset="${-(segErr + segWarn)}"></circle>
      </g>
      <text x="70" y="66" text-anchor="middle" font-size="26" font-weight="700" fill="var(--ink)">${Math.round(passTests / totT * 100)}%</text>
      <text x="70" y="86" text-anchor="middle" font-size="11" fill="var(--faint)">통과율</text>
    </svg>
    <div class="col g8 f1" style="min-width:0">
      <div class="statrow"><span style="width:9px;height:9px;border-radius:2px;background:var(--err)"></span>
        <span class="t12 f1">실패</span><span class="b6 t13">${failTests.length}건</span></div>
      <div class="statrow"><span style="width:9px;height:9px;border-radius:2px;background:var(--warn)"></span>
        <span class="t12 f1">주의</span><span class="b6 t13">${warnTests}건</span></div>
      <div class="statrow"><span style="width:9px;height:9px;border-radius:2px;background:var(--ok)"></span>
        <span class="t12 f1">통과</span><span class="b6 t13">${passTests}건</span></div>
      <span class="t11 fnt trunc">${failTests.length ? '실패 · ' + esc((byId(failTests[0].target) || {}).name || '') : '모든 규칙 통과'}</span>
    </div></div>`));
  grid.appendChild(c2);

  /* 3. 원천 데이터 업데이트 지연 */
  const sourceRows = D.filter(d => d.kind === 'source').slice(0, 5).map(d => ({
    name: d.name, late: d.stale ? 186 : [12, 24, 8, 31][d.name.length % 4] }));
  const maxLate = Math.max(...sourceRows.map(x => x.late), 60);
  const c3 = card('원천 데이터 수집 지연', '기준 주기 대비 경과(분)', () => go('quality'));
  $('.card-b', c3).appendChild(el(`<div class="col g8">
    ${sourceRows.map(x => `<div class="col" style="gap:4px">
      <div class="row g8"><span class="t12 f1 trunc">${esc(x.name)}</span>
        <span class="t12 ${x.late > 120 ? '' : 'mut'}" style="${x.late > 120 ? 'color:var(--warn);font-weight:650' : ''}">${x.late}분</span></div>
      <div style="height:8px;border-radius:4px;background:var(--surface-3);overflow:hidden">
        <div style="width:${Math.round(100 * x.late / maxLate)}%;height:100%;background:${x.late > 120 ? 'var(--warn)' : 'var(--pri)'}"></div></div>
    </div>`).join('')}
    <span class="t11 fnt" style="padding-top:2px">지연 ${stale.length}개${stale.length ? ' · ' + esc(stale.map(x => x.name).join(' · ')) : ''}</span>
  </div>`));
  grid.appendChild(c3);

  p.appendChild(grid);

  const g = el(`<div style="display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:14px;align-items:stretch"></div>`);
  const left = el('<div class="col g14" style="min-width:0"></div>');

  const rc = el(`<section class="card f1" style="display:flex;flex-direction:column"><div class="card-h"><span class="card-t">최근 실행</span>
    <button class="lnk sp" id="hAllPipe">전체 보기</button></div>
    <div class="card-b tight"><div class="tbl" style="--cols:minmax(0,1.5fr) 92px 96px 88px"></div></div></section>`);
  const rt = $('.tbl', rc);
  rt.appendChild(el(`<div class="th"><span>파이프라인</span><span>상태</span><span>실행 시간</span><span>소요</span></div>`));
  PIPES.slice(0, 4).forEach(pp => {
    const tr = el(`<div class="tr">
      <span class="c2"><span class="b6 trunc" title="${esc(pp.name)}">${esc(pp.name)}</span>
        </span>
      <span>${pipeBadge(pp.status)}</span><span class="t12 mut">${esc(pp.last)}</span><span class="t12 mut">${esc(pp.dur)}</span></div>`);
    tr.onclick = () => go('pipeline', pp.id);
    rt.appendChild(tr);
  });
  left.appendChild(rc);
  g.appendChild(left);

  const right = el('<div class="col g14" style="min-width:0"></div>');
  // 예제 id 를 박아두면 실제 카탈로그에 없는 모델을 가리켜 렌더가 죽는다.
  // 분석용 모델을 앞에 두고 최대 4개만 보여준다.
  const recent = D.filter(d => d.kind === 'model')
    .sort((a, b) => (a.layer === '분석용' ? 0 : 1) - (b.layer === '분석용' ? 0 : 1))
    .slice(0, 4);
  const dc = el(`<section class="card f1" style="display:flex;flex-direction:column"><div class="card-h"><span class="card-t">최근 사용한 데이터</span>
    <button class="lnk sp" id="hAllCat">카탈로그</button></div>
    <div class="card-b col g4" style="padding:8px"></div></section>`);
  const db = $('.card-b', dc);
  recent.forEach(d => {
    /* 워크 스페이스가 있던 시절에는 «그 모델이 속한 사용자 워크 스페이스 이름» 을
       먼저 보여주고 없으면 층으로 떨어졌다. 워크 스페이스를 걷어냈으니 층만 쓴다. */
    const b = el(`<button class="list-i taskline" title="${esc(d.name)} · ${esc(d.desc)}">
      <span class="ic-lead"><span class="swatch" style="background:${LAYER[d.layer].color};width:9px;height:9px;display:block"></span></span>
      <span class="tl-b"><span class="row g6"><span class="tl-t trunc">${esc(d.name)}</span></span>
        <span class="tl-d trunc">${esc(d.layer)} · ${esc(d.updated)} 업데이트</span></span>
      ${qBadge(d.quality)}</button>`);
    b.onclick = () => go('catalog', d.id);
    db.appendChild(b);
  });
  right.appendChild(dc);
  g.appendChild(right);
  p.appendChild(g);

  $('#hAllPipe', p).onclick = () => go('pipeline');

  /* 카탈로그 화면이 데이터 모델로 합쳐진 뒤(v2.1) 링크 이름·행선지를 맞춘다 */
  const aCat = $('#hAllCat', p);
  if (aCat) { aCat.textContent = '모델 전체'; aCat.onclick = () => go('modeling'); }

  /* 실측 이력 카드(v4.x) — 서버 /history 를 처음 한 번 받아 와 예제 카드를 바꾼다 */
  if (!HIST.data && !HIST.error) { loadHistory(); }
  const d = HIST.data;
  swapCard(p, '파이프라인 실행 결과', !d ? loadingHtml : `
        <div class="col g10">
          ${bars(d.daily, { total: x => x.nodeRuns || 0, bad: x => x.nodeFails || 0,
            tip: x => `${x.date} · 실행 ${x.nodeRuns}건${x.nodeFails ? ` · 실패 ${x.nodeFails}건` : ''} · ${x.buildSeconds}초` })}
          <div class="row g12" style="border-top:1px solid var(--line-2);padding-top:10px">
            <span class="row g6 t12"><span style="width:9px;height:9px;border-radius:2px;background:var(--ok);display:inline-block"></span>성공</span>
            <span class="row g6 t12"><span style="width:9px;height:9px;border-radius:2px;background:var(--err);display:inline-block"></span>실패</span>
            <span class="t12 mut sp">${d.daily.length ? `누적 ${d.daily.reduce((a, x) => a + (x.buildSeconds || 0), 0).toFixed(0)}초` : ''}</span>
          </div></div>`);

  /* 원천 최신성 데이터가 아직 없어(원천이 seed) 그 카드는
     실제로 아는 것 — 모델별 빌드 시간 비중 — 으로 바꾼다.
     위쪽 예제 카드도 이름이 c3 이었는데, 홈 탭을 걷어내며 두 이름이 같은 스코프에
     놓였다. 가리키는 것이 다르므로(예제 카드 / 갈아끼운 카드) 여기를 cBuild 로 나눈다. */
  const cBuild = swapCard(p, '원천 데이터 수집 지연', !d ? loadingHtml : `
        <div class="col g8">
          ${!d.slowest.length ? '<div class="empty" style="padding:24px">아직 실행 이력이 없습니다.</div>'
            : d.slowest.map(x => `<div class="col" style="gap:4px">
              <div class="row g8"><span class="t12 f1 trunc" title="${esc(x.name)}">${esc(x.name)}</span>
                <span class="t12 mut">${x.totalSeconds}초</span>
                <span class="t12" style="width:44px;text-align:right">${x.share}%</span></div>
              <div style="height:8px;border-radius:4px;background:var(--surface-3);overflow:hidden">
                <div style="width:${Math.min(100, x.share)}%;height:100%;background:var(--pri)"></div></div>
            </div>`).join('')}
          <span class="t11 fnt" style="padding-top:2px">최근 7일 기준 · 총 소요가 큰 순서</span>
        </div>`);
  if (cBuild) {
    const t = $('.card-t', cBuild);
    if (t) t.textContent = '모델별 빌드 시간 비중';
    const sub = t && t.nextElementSibling;
    if (sub && sub.classList.contains('t12')) sub.textContent = '최근 7일';
  }

  return p;
};

/* (워크 스페이스 — 홈의 두 번째 탭이었다. 기본 4개는 층 필터, 내 워크 스페이스 4개는
   의료 데모 시절 테이블 id 를 들고 있어 어느 것도 실제 데이터에 닿지 않았다.
   홈을 한 화면으로 정리하면서 wsPipesOf · homeWsCard · homeWsView 를 걷어냈다.
   묶음 정의(WS_BASE/WS_USER)는 b06, 만들기 모달은 b07 에서 함께 제거) */

/* 화면 전환 시 상태 정리 */

/* ============================================================
   v1.4 — 도움말 · 문구 정리
   ============================================================ */
const HELP = {
  home: { t: '홈', items: [
    '상단 요약 카드에서 실행 실패, 검증 실패, 업데이트 지연 건수를 한눈에 확인합니다.',
    '요약 카드를 선택하면 해당 파이프라인이나 품질 화면으로 이동합니다.',
    '최근 사용한 데이터에서 자주 쓰는 데이터를 다시 열 수 있습니다.'] },
  catalog: { t: '데이터 카탈로그', items: [
    '기본 또는 사용자 워크 스페이스를 선택합니다.',
    '워크 스페이스에서 필요한 테이블을 검색합니다.',
    '테이블을 선택하면 오른쪽에서 메타데이터를 확인할 수 있습니다.',
    '필요한 테이블은 데이터 모델링에 추가할 수 있습니다.',
    '사용자 워크 스페이스를 만들어 자주 사용하는 테이블을 모을 수 있습니다.'] },
  modeling: { t: '데이터 모델링', items: [
    '왼쪽 목록의 + 버튼을 누르거나 데이터를 캔버스로 끌어 추가합니다.',
    '카드를 끌어 위치를 변경합니다.',
    '카드의 연결점을 다른 카드로 끌어 입력 관계를 만듭니다.',
    '모델을 선택하면 아래 모델 상세에서 입력 데이터와 변환 작업을 확인·설정할 수 있습니다.',
    'SQL 보기에서 생성된 SQL을 확인하거나 직접 수정할 수 있습니다.',
    '미리보기와 검증을 완료한 후 파이프라인으로 등록합니다.',
    '사용자가 만든 모델은 삭제할 수 있고, 기존 데이터는 캔버스에서만 제거할 수 있습니다.'] },
  pipeline: { t: '데이터 파이프라인', items: [
    '데이터 모델링에서 등록한 파이프라인 목록을 확인합니다.',
    '파이프라인을 선택하면 모델별 실행 흐름과 상태를 볼 수 있습니다.',
    '실패한 모델을 선택하면 오류 원인과 로그를 확인할 수 있습니다.',
    '필요한 경우 실패한 모델부터 다시 실행할 수 있습니다.',
    '실행 일정과 알림은 권한이 있는 사용자만 변경할 수 있습니다.'] },
  quality: { t: '데이터 품질', items: [
    '필수값 누락, 중복, 연결 오류, 업데이트 지연을 확인합니다.',
    '항목을 선택하면 문제가 발생한 데이터와 영향 범위를 볼 수 있습니다.',
    '기술 정보와 실패 데이터 예시는 상세 영역에서 확인합니다.',
    '조치가 끝난 뒤 다시 검증할 수 있습니다.'] },
  settings: { t: '설정', items: [
    '개인 알림과 기본 환경을 설정합니다.',
    '관리자는 사용자, 권한, 프로젝트와 데이터 연결을 관리할 수 있습니다.',
    '역할에 따라 표시되는 설정 항목이 달라집니다.'] },
};
function openHelp() {
  const h = HELP[S.page] || HELP.home;
  const body = `<div class="modal-h"><span class="modal-t">${esc(h.t)} 도움말</span>
      <button class="iconbtn sp" data-close>${ic('x')}</button></div>
    <div class="modal-b">
      <ol style="margin:0;padding-left:20px;display:flex;flex-direction:column;gap:10px">
        ${h.items.map(x => `<li style="font-size:var(--fs-body);line-height:1.65;color:var(--text)">${esc(x)}</li>`).join('')}
      </ol></div>
    <div class="modal-f"><button class="btn pri sp" data-close>확인</button></div>`;
  const { close } = modal(body, { sm: true });
  const esckey = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esckey); } };
  document.addEventListener('keydown', esckey);
}

/* 사이드바 하단 — 도움말 · 접기 */
/* (sidebar — 이후 정의가 값 캡처 없이 전면 교체. 죽은 층 제거) */
/* 목록·카드 정보 밀도 축소 — 설명은 상세 패널에서 */
/* 빈 목록 안내 */
/* (pagePipeline — 이후 정의가 값 캡처 없이 전면 교체. 죽은 층 제거) */
/* ── 파이프라인: 모델링과 동일한 3분할 구조 ── */
S.pipeLeftOpen = S.pipeLeftOpen !== false;
/* (pagePipeDetail — 이후 정의가 값 캡처 없이 전면 교체. 죽은 층 제거) */
/* 시작 */
S.showTech = R().tech;
applyTierDefaults();
window.__tier = (() => { const t = widthTier(); return t.xnar ? 'x' : t.nar ? 'n' : window.innerWidth < 1340 ? 'm' : 'w'; })();
/* (로드 중 seedCanvas() · 간선 기본값 · seedRoles — 예제 데이터로 캔버스를 한 번
   심던 자리다. api.js 의 boot 가 실데이터를 받으면 S.nodes/S.edges 를 빈 배열로
   되돌리므로(“노드가 예전 D 객체를 참조하고 있으므로 캔버스를 다시 만든다”)
   여기서 한 일은 전부 버려진다. 제거) */
/* 시작은 v2.1 블록 끝에서 */
