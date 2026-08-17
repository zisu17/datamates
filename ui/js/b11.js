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
/* ── 홈 ────────────────────────────────────────────────────────
   구성은 claude.ai/design 의 «DW Studio 홈» 을 따른다 —
   KPI 4장 · 모델별 빌드 시간(도넛) · 적재 현황 · 최근 실행(표).

   **그림만 가져오고 숫자는 전부 서버에서 온다.** 예제 배열로 카드를 그려 두고
   나중에 갈아끼우던 방식(api.js 의 swapCard)을 걷어냈다 — 갈아끼우기 전 한 프레임
   동안 지어낸 숫자가 보였고, 요청이 실패하면 그대로 남아 있었다. 지금은 값이
   없으면 «불러오는 중» 이고, 실패하면 실패라고 말한다.

   DS 어휘(.wc-card · .w-h1 …)는 쓰지 않는다. 이 앱은 자체 클래스(.card · .kpi ·
   .tbl · .seg)를 쓰고 app.css 가 그것을 DS 토큰으로 다시 표현한다 —
   ds/tokens.css 머리말의 «복제하지 않고 재해석한다» 를 그대로 따른다. */

/* 큰 수는 만·억으로 접는다. 카드 한 줄에 들어가야 옆의 설명과 함께 읽힌다. */
function fmtRows(n) {
  if (n == null) return '—';
  if (n >= 1e8) return String((n / 1e8).toFixed(1)).replace(/\.0$/, '') + '억';
  if (n >= 1e4) return Math.round(n / 1e4).toLocaleString('ko-KR') + '만';
  return n.toLocaleString('ko-KR');
}
/* 바이트 → 사람이 읽는 단위. 1024 진법(KiB)이지만 표기는 KB 로 둔다 —
   MinIO 콘솔·mc 가 같은 방식이라 두 화면의 숫자가 어긋나지 않는다. */
function fmtBytes(b) {
  if (b == null) return '—';
  const U = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let v = Math.max(0, b), i = 0;
  while (v >= 1024 && i < U.length - 1) { v /= 1024; i++; }
  // 세 자리를 넘으면 소수점이 자리만 차지한다(560 MB / 70.5 MB)
  return `${!i || v >= 100 ? Math.round(v) : v.toFixed(1)} ${U[i]}`;
}
/* 초 → m:ss (한 시간을 넘으면 h:mm:ss). 빌드 시간은 분 단위로 읽는 값이다. */
function fmtDur(s) {
  if (s == null) return '—';
  const t = Math.max(0, Math.round(s));
  const p2 = (x) => String(x).padStart(2, '0');
  const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60);
  return h ? `${h}:${p2(m)}:${p2(t % 60)}` : `${m}:${p2(t % 60)}`;
}
/* 표의 완료 칸은 시:분만 쓴다 — 한 칸에 날짜까지 넣으면 읽히지 않는다.
   시간대 고정은 fmtDT 가 하므로(KST) 그 결과에서 잘라 쓴다. */
function hhmm(v) { const s = fmtDT(v); return s ? s.slice(11, 16) : '—'; }

/* 툴팁을 «가리킨 것» 바로 위에 놓는다.
   디자인은 막대 툴팁을 한쪽 끝(left:0 · right:0)에 고정해 두었는데, 가리킨 조각이
   반대쪽 끝에 있으면 툴팁이 엉뚱한 자리에 떠서 무엇을 말하는지 알 수 없다.
   카드 밖으로 나가지 않게 양끝에서 잡아 준다. 폭을 재야 하므로 **보이게 한 뒤**
   부른다 — 숨은 요소는 offsetWidth 가 0 이다. */
function tipAt(tip, target) {
  const host = tip.offsetParent || tip.parentElement;
  if (!host) return;
  const hr = host.getBoundingClientRect(), tr = target.getBoundingClientRect();
  const half = tip.offsetWidth / 2;
  const x = Math.min(Math.max(tr.left + tr.width / 2 - hr.left, half), Math.max(half, hr.width - half));
  tip.style.left = `${Math.round(x)}px`;
  tip.style.right = 'auto';
  tip.style.transform = 'translate(-50%,-100%)';
}

/* 데이터 계층. 도넛 범례의 둘째 줄에 쓴다 — 물리 스키마(analytics)는 거의 다
   같은 값이라 구분이 안 되고, 이 앱이 모델을 나누는 기준은 계층이다. */
function homeLayerOf(name) {
  const d = D.find(x => x.name === name);
  if (d && d.layer) return d.layer;
  if (d && d.phys) return String(d.phys).split('.')[0];
  return '카탈로그에 없음';       // 지워진 모델의 이력이 남아 있는 경우
}

/* 아직 아무 것도 등록되지 않았을 때. 숫자 대신 다음에 할 일을 말한다. */
function homeEmpty() {
  const box = el(`<section class="card"><div class="card-b" style="padding:44px 36px;
      display:flex;flex-direction:column;gap:26px;align-items:flex-start">
    <div>
      <div class="page-t" style="font-size:var(--fs-page)">아직 연결된 데이터가 없습니다.</div>
      <p class="t13 mut" style="margin:6px 0 0;max-width:520px">데이터를 수집하면 카탈로그와
        적재 현황이 이 화면에 나타납니다.</p>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));
         gap:14px;width:100%">
      ${[['01', '데이터 수집', 'API · 데이터베이스 · 파일에서 원천을 가져옵니다.'],
         ['02', '데이터 모델링', '가져온 원천을 정제·결합해 모델을 만듭니다.'],
         ['03', '파이프라인 등록', '만든 모델을 주기적으로 다시 만들도록 겁니다.']]
        .map(([n, t, d]) => `<div style="border:1px solid var(--line);border-radius:var(--r-s);
          padding:18px;display:flex;flex-direction:column;gap:5px">
          <div class="t11 b6" style="color:var(--pri)">${n}</div>
          <div class="t13 b6">${t}</div>
          <p class="t12 mut" style="margin:0">${d}</p></div>`).join('')}
    </div>
    <button class="btn pri" id="hStart">${ic14('plus')}데이터 수집 시작</button>
  </div></section>`);
  $('#hStart', box).onclick = () => go('ingest');
  return box;
}

pageHome = function () {
  const p = el('<div class="page"></div>');
  /* 이 화면이 무엇인지 제목으로 말하고, 기준 시각을 같은 줄 오른쪽에 둔다 —
     화면의 숫자가 언제 것인지 말하는 값이라 제목과 함께 읽혀야 한다.
     제목줄(.page-h)은 b01 이 홈에서 걷어가므로 여기서 직접 그린다. */
  p.appendChild(el(`<div class="home-h">
    <h1 class="page-t">데이터셋 현황</h1>
    <span class="home-when">${esc(nowLabel())} 기준</span></div>`));
  /* (흐름 레일 — 「데이터 수집 › 데이터 모델 › … 」 을 제목 밑에 깔던 줄이다.
     같은 이동을 상단 메뉴가 이미 하고 있어 걷어냈다. 되살리려면 b31 의
     flowRail() 을 여기에 다시 붙이면 된다.) */

  /* 카탈로그가 비어 있으면 셀 것이 없다. 숫자 0 을 네 장 늘어놓는 대신
     다음에 할 일을 말한다(디자인의 «빈 상태»). */
  if (!D.length) { p.appendChild(homeEmpty()); return p; }

  if (!HOME.data) {
    p.appendChild(el(HOME.error
      ? `<div class="empty" style="padding:56px">${ic('alert')}
          <span class="empty-t">현황을 불러오지 못했습니다.</span>
          <span>${esc(HOME.error)}</span></div>`
      : `<div class="empty" style="padding:56px">${ic('clock')}<span>현황을 불러오는 중…</span></div>`));
    // 실패했으면 다시 부르지 않는다 — 렌더가 호출을, 호출이 렌더를 부르며 돈다.
    if (!HOME.error) loadHome();
    return p;
  }

  const H = HOME.data;
  const vol = H.vol;
  const s7 = H.span['7d'].sum;
  const CH = (i) => `var(--w-chart-${(i % 12) + 1})`;

  /* ── KPI 4장 ───────────────────────────────────────────────── */
  const nSrc = D.filter(d => d.kind === 'source').length;
  const nMart = D.filter(d => d.isMart).length;
  const nModel = D.length - nSrc - nMart;

  /* 네 장은 **읽는 값이다.** 누르는 자리가 아니다 — onclick 을 주지 않으므로
     kpi() 가 .act(커서·호버)를 붙이지 않고, 화면 이동도 일어나지 않는다.
     이동은 상단 메뉴가 맡는다. */
  const kpis = el('<div class="kpis home4" style="margin-bottom:14px"></div>');
  kpis.appendChild(kpi('등록 데이터', String(D.length),
    `원천 ${nSrc} · 모델 ${nModel} · 마트 ${nMart}`));
  /* 적재 행 수는 웨어하우스를 직접 센 값이다(/catalog/volume). 아직 만들어지지
     않은 테이블이 있으면 합계가 작은 이유를 함께 말한다. */
  kpis.appendChild(kpi('적재 행 수', fmtRows(vol.totalRows),
    vol.unknown ? `테이블 ${vol.total}개 · ${vol.unknown}개 미생성` : `테이블 ${vol.total}개`));
  kpis.appendChild(kpi('모델 실행', (s7.nodeRuns || 0).toLocaleString('ko-KR'),
    s7.successRate == null ? '최근 7일' : `최근 7일 · 성공률 ${s7.successRate}%`));
  kpis.appendChild(kpi('실행 실패', String(s7.nodeFails || 0),
    s7.nodeFails ? '확인 필요' : '최근 7일 이상 없음',
    s7.nodeFails ? 'err' : null));
  p.appendChild(kpis);

  /* ── 모델별 빌드 시간 · 적재 현황 ──────────────────────────── */
  const g = el(`<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));
    gap:14px;margin-bottom:14px;align-items:stretch"></div>`);

  /* 1) 모델별 빌드 시간 — 도넛.
     24시간 / 7일 두 벌을 미리 받아 두었으므로 전환은 다시 그리기만 한다. */
  const spanKey = S.homeSpan === '7d' ? '7d' : '24h';
  const sp = H.span[spanKey];
  const total = sp.sum.buildSeconds || 0;
  const top = sp.slow.slice(0, 5);
  const restN = Math.max(0, sp.slow.length - top.length);
  const restSec = Math.max(0, total - top.reduce((a, x) => a + (x.totalSeconds || 0), 0));
  const pct = (v) => total ? Math.round(v / total * 100) : 0;

  /* 조각 하나가 곧 범례 한 줄이다. 두 벌로 나눠 만들면 색과 순서가 어긋난다. */
  const SEGS = [
    ...top.map((x, i) => ({ color: CH(i), sec: x.totalSeconds || 0,
                            name: x.name, sub: homeLayerOf(x.name) })),
    ...(restN ? [{ color: 'var(--surface-3)', sec: restSec,
                   name: `기타 ${restN}개 모델`, sub: '합계' }] : []),
  ];

  /* 도넛은 conic-gradient 가 아니라 SVG 원호다. 조각마다 요소가 있어야 «그 조각에
     들어왔다» 를 알 수 있다(그라디언트는 한 덩어리라 가리킬 수가 없다).
     둘레를 dasharray 로 잘라 쓴다 — 시작점을 -90° 로 돌려 12시에서 시작한다.
     크기는 디자인의 152 를 196 으로 키운 비율(1.29)로 r·두께를 함께 늘린 값이다. */
  const DN = 196, DR = 71, DSW = 31, DSW_ON = 39, DIN = 34;
  const DC = 2 * Math.PI * DR;
  let acc = 0;
  const arcs = SEGS.map((s, i) => {
    const len = total ? s.sec / total * DC : 0;
    const off = -acc; acc += len;
    return `<circle class="donut-seg" data-seg="${i}" cx="${DN / 2}" cy="${DN / 2}" r="${DR}"
      fill="none" stroke="${s.color}" stroke-width="${DSW}"
      stroke-dasharray="${len.toFixed(2)} ${(DC - len).toFixed(2)}"
      stroke-dashoffset="${off.toFixed(2)}"></circle>`;
  }).join('');

  /* 범례 한 줄. 도넛을 키운 만큼 오른쪽 고정 칸(소요·비중)을 좁혀 이름 칸이
     먼저 줄지 않게 한다 — 잘려서 못 읽히면 곤란한 것은 모델 이름 쪽이다. */
  const legend = (s, i) =>
    `<div class="dn-row" data-row="${i}" style="display:grid;
      grid-template-columns:8px minmax(0,1fr) 52px 38px;align-items:center;gap:8px">
      <span class="swatch" style="background:${s.color}"></span>
      <span class="col" style="min-width:0"><span class="t12 trunc" title="${esc(s.name)}">${esc(s.name)}</span>
        <span class="t11 fnt trunc">${esc(s.sub)}</span></span>
      <span class="t12 num" style="text-align:right">${fmtDur(s.sec)}</span>
      <span class="t11 fnt num" style="text-align:right">${pct(s.sec)}%</span></div>`;

  const cBuild = el(`<section class="card" style="display:flex;flex-direction:column">
    <div class="card-h"><span class="card-t">모델별 빌드 시간</span>
      <span class="t11 fnt">전체 ${sp.slow.length}개 모델</span>
      <div class="seg sp">
        <button data-span="24h" class="${spanKey === '24h' ? 'on' : ''}">24시간</button>
        <button data-span="7d" class="${spanKey === '7d' ? 'on' : ''}">7일</button></div></div>
    <div class="card-b f1" style="padding:16px">
      ${!total ? `<div class="empty" style="padding:34px">${ic('clock')}<span>이 기간에는 실행이 없습니다.</span></div>`
      : `<div class="row" style="align-items:center;gap:18px">
        <!-- 크기는 카드 폭을 따라간다. px 로 못 박으면 넓은 화면에서는 작아 보이고
             좁은 화면에서는 범례 이름이 «int_gap…» 으로 뭉개진다. 도형 자체는
             viewBox 196 좌표계에 그대로 두고 CSS 로만 늘린다 — 선 두께도 같이
             비례해 커지므로 두께를 따로 계산할 필요가 없다. -->
        <div style="position:relative;width:clamp(190px,42%,280px);aspect-ratio:1;flex:none">
          <svg viewBox="0 0 ${DN} ${DN}" style="width:100%;height:100%;
               display:block;transform:rotate(-90deg);overflow:visible">
            <circle cx="${DN / 2}" cy="${DN / 2}" r="${DR}" fill="none"
                    stroke="var(--surface-3)" stroke-width="${DSW}"></circle>
            ${arcs}
          </svg>
          <!-- 가운데 글자는 가리킨 조각을 따라 바뀐다. pointer-events 를 끄지 않으면
               글자 위에서 조각의 mouseleave 가 떠서 툴팁이 깜빡인다.
               구멍도 비율로 잡는다(34/196 ≈ 17%) — 도넛이 커지면 같이 커진다. -->
          <div style="position:absolute;inset:${(DIN / DN * 100).toFixed(1)}%;display:flex;
               flex-direction:column;align-items:center;justify-content:center;gap:2px;
               pointer-events:none;text-align:center;padding:0 6px">
            <span class="b6 num" id="dnT" style="font-size:var(--fs-display);letter-spacing:-0.4px">${fmtDur(total)}</span>
            <span class="t11 fnt trunc" id="dnS" style="max-width:100%">총 빌드 시간</span></div>
          <div class="chart-tip" id="dnTip" hidden
               style="left:50%;top:-10px;transform:translate(-50%,-100%)"></div>
        </div>
        <div class="col g10 f1" style="min-width:0">${SEGS.map(legend).join('')}</div></div>`}
    </div></section>`);
  $$('[data-span]', cBuild).forEach(b => b.onclick = () => {
    S.homeSpan = b.dataset.span; render();
  });

  /* 호버는 DOM 을 직접 고친다. render() 를 부르면 홈 전체를 다시 만들어
     마우스가 조각 위에 있는 동안 요소가 갈려 나가 호버가 끊긴다. */
  if (total) {
    const dnTip = $('#dnTip', cBuild), dnT = $('#dnT', cBuild), dnS = $('#dnS', cBuild);
    const arcEls = $$('[data-seg]', cBuild), rowEls = $$('[data-row]', cBuild);
    const paint = (i) => {
      const on = i != null;
      arcEls.forEach((c, k) => c.setAttribute('stroke-width', on && k === i ? DSW_ON : DSW));
      rowEls.forEach((r, k) => { r.style.opacity = !on || k === i ? '1' : '.45'; });
      dnT.textContent = on ? fmtDur(SEGS[i].sec) : fmtDur(total);
      dnS.textContent = on ? SEGS[i].sub : '총 빌드 시간';
      if (on) dnTip.textContent = `${SEGS[i].name} · ${fmtDur(SEGS[i].sec)} · ${pct(SEGS[i].sec)}%`;
      dnTip.hidden = !on;
    };
    // 조각과 범례 줄 어느 쪽을 가리켜도 같이 반응한다 — 얇은 조각은 겨누기 어렵다.
    arcEls.concat(rowEls).forEach((e, n) => {
      const i = n % SEGS.length;
      e.onmouseenter = () => paint(i);
      e.onmouseleave = () => paint(null);
    });
    rowEls.forEach(r => { r.style.transition = 'opacity var(--w-dur) var(--w-ease)'; });
  }
  g.appendChild(cBuild);

  /* 2) 저장소 — 디자인의 «스토리지» 자리. 객체 저장소를 실측한 값이다(/storage).
     막대를 스키마가 아니라 «성격» 으로 나눈다. 여기서 사람이 할 일이 갈리기
     때문이다 — 카탈로그는 쓰는 것, 관측·임시·잔여는 정리 대상이다.
     그 밑에 «현재 스냅샷 / 회수 가능» 을 붙여 정리하면 얼마가 빠지는지 말한다. */
  const st = H.storage;
  const stTotal = st ? st.totalBytes || 0 : 0;
  /* 네임스페이스가 축이다. 이 플랫폼이 관리하는 것(dbt 가 만든 테이블이 있는
     네임스페이스)만 이름으로 세우고, 남의 것 — 관측(Elementary) 스키마와
     지워진 테이블의 잔여 — 은 «기타» 한 줄로 접는다. 네임스페이스를 전부
     늘어놓으면 정작 내 데이터가 어디 있는지가 묻힌다. */
  const NS = st ? (st.bySchema || []).filter(s => s.primary) : [];
  const etcBytes = st ? Math.max(0, stTotal - NS.reduce((a, s) => a + s.bytes, 0)) : 0;
  const etcTables = st ? (st.bySchema || []).filter(s => !s.primary)
    .reduce((a, s) => a + s.tables, 0) : 0;
  const ROWS = st ? [
    ...NS.map((s, i) => ({ color: CH(i), label: s.schema, sub: `테이블 ${s.catalogTables}개`,
                           bytes: s.bytes,
                           tip: `${s.schema} · 점유 ${fmtBytes(s.bytes)}`
                                + (s.liveBytes == null ? '' : ` · 현재 ${fmtBytes(s.liveBytes)}`) })),
    ...(etcBytes ? [{ color: 'var(--w-text-3)', label: '기타', sub: `${etcTables}개 경로`,
                      bytes: etcBytes,
                      tip: '관측(Elementary) 이력 · 임시 테이블 · 지워진 테이블의 잔여 파일' }] : []),
  ] : [];
  const maxRun = Math.max(1, ...H.daily.map(d => d.nodeRuns || 0));
  const failDays = H.daily.reduce((a, d) => a + (d.nodeFails || 0), 0);

  const cVol = el(`<section class="card" style="display:flex;flex-direction:column">
    <div class="card-h"><span class="card-t">저장소</span>
      <span class="t11 fnt sp">${st ? `네임스페이스 ${NS.length}개 · 객체 ${st.objects.toLocaleString('ko-KR')}개`
                                    : '객체 저장소'}</span></div>
    <div class="card-b f1 col g14" style="padding:16px">
      ${!st ? `<div class="empty" style="padding:28px">${ic('alert')}
          <span class="empty-t">저장소 용량을 읽지 못했습니다.</span>
          <span>${esc(H.storageError || 'MinIO 응답 없음')}</span></div>`
      : `<div class="row" style="align-items:baseline;gap:6px">
        <span class="b6 num" style="font-size:var(--fs-display);letter-spacing:-0.4px">${fmtBytes(stTotal)}</span>
        <span class="t13 mut">점유</span>
        <span class="t12 fnt sp">현재 스냅샷 ${fmtBytes(st.liveBytes)}</span></div>
      <div style="position:relative">
        <div style="display:flex;height:12px;border-radius:var(--w-r-pill);overflow:hidden;
             background:var(--surface-3)">
          ${ROWS.map((r, i) => `<div class="bar-seg" data-vol="${i}" data-volbar="${i}"
            style="width:${(r.bytes / (stTotal || 1) * 100).toFixed(1)}%;background:${r.color}"></div>`).join('')}
        </div>
        <div class="chart-tip" id="volTip" hidden style="left:0;top:-8px;transform:translateY(-100%)"></div>
      </div>
      <div class="col g10">
        ${ROWS.map((r, i) => `<div class="row bar-seg" data-vol="${i}" style="gap:8px">
          <span class="swatch" style="background:${r.color}"></span>
          <span class="t12 f1 trunc">${esc(r.label)}</span>
          <span class="t11 fnt">${esc(r.sub)}</span>
          <span class="t12 num" style="min-width:68px;text-align:right">${fmtBytes(r.bytes)}</span>
        </div>`).join('')}
        <!-- (회수 안내 — «정리하면 N MB 회수» 한 줄이 여기 있었다. 카드가
             말할 것은 지금 얼마나 쓰고 있나이지 정리 권유가 아니라 걷어냈다.
             값 자체는 /storage 의 reclaimable 로 계속 나온다.) -->
      </div>`}
      <div class="col g6" style="border-top:1px solid var(--line-2);padding-top:12px;position:relative">
        <div class="row"><span class="t12 mut f1">최근 14일 실행 추이</span>
          <span class="t12" style="color:${failDays ? 'var(--err)' : 'var(--ok)'}">
            ${failDays ? `실패 ${failDays}건` : '실패 없음'}</span></div>
        ${!H.daily.length ? '<span class="t12 fnt">아직 실행 이력이 없습니다.</span>'
        /* 막대를 감싸는 칸이 따로 있다. 막대는 높이가 제각각이라 낮은 날은
           겨눌 자리가 몇 픽셀뿐인데, 칸을 가리키면 그 날이 잡힌다. */
        : `<div style="display:flex;align-items:flex-end;gap:4px;height:56px">
            ${H.daily.map((d, i) => {
              const tot = d.nodeRuns || 0, bad = d.nodeFails || 0;
              const hh = Math.max(8, Math.round(56 * tot / maxRun));
              const eh = tot ? Math.round(hh * bad / tot) : 0;
              const last = i === H.daily.length - 1;
              return `<div class="bar-seg" data-day="${i}" style="flex:1;height:100%;
                display:flex;align-items:flex-end;opacity:${last ? 1 : .45}">
                <div style="width:100%;height:${hh}px;display:flex;flex-direction:column;
                  justify-content:flex-end;border-radius:3px 3px 0 0;overflow:hidden;
                  background:var(--surface-3)">
                  ${eh ? `<div style="height:${eh}px;background:var(--err)"></div>` : ''}
                  <div style="flex:1;background:var(--pri)"></div></div></div>`;
            }).join('')}</div>
          <div class="row"><span class="t11 fnt f1">${esc(mmdd(H.daily[0].date))}</span>
            <span class="t11 fnt">${esc(mmdd(H.daily[H.daily.length - 1].date))}</span></div>
          <div class="chart-tip" id="dayTip" hidden style="right:0;top:-8px;transform:translateY(-100%)"></div>`}
      </div>
    </div></section>`);

  /* 용량 막대 — 가리킨 조각만 남기고 나머지를 흐린다. 막대와 범례가 한 쌍이다. */
  if (st && ROWS.length) {
    const volTip = $('#volTip', cVol);
    const volEls = $$('[data-vol]', cVol);
    volEls.forEach(e => {
      const i = +e.dataset.vol;
      e.onmouseenter = () => {
        volEls.forEach(x => { x.style.opacity = +x.dataset.vol === i ? '1' : '.4'; });
        volTip.textContent = ROWS[i].tip;
        volTip.hidden = false;
        /* 범례 줄을 가리켰어도 툴팁은 **막대의 그 조각 위**에 뜬다 —
           이름만 보고는 막대 어디를 말하는지 알 수 없기 때문이다. */
        tipAt(volTip, $(`[data-volbar="${i}"]`, cVol) || e);
      };
      e.onmouseleave = () => {
        volEls.forEach(x => { x.style.opacity = '1'; });
        volTip.hidden = true;
      };
    });
  }

  /* 추이 막대 — 가리킨 날은 진하게, 나머지는 더 흐리게. 아무 데도 없을 때는
     마지막 날만 진하다(디자인의 «오늘이 기준» 표시). */
  if (H.daily.length) {
    const dayTip = $('#dayTip', cVol);
    const dayEls = $$('[data-day]', cVol);
    const restore = () => dayEls.forEach((x, k) => {
      x.style.opacity = k === dayEls.length - 1 ? '1' : '.45';
    });
    dayEls.forEach(e => {
      const i = +e.dataset.day, d = H.daily[i];
      e.onmouseenter = () => {
        dayEls.forEach((x, k) => { x.style.opacity = k === i ? '1' : '.25'; });
        const bad = d.nodeFails || 0;
        dayTip.textContent = `${mmdd(d.date)} · 실행 ${(d.nodeRuns || 0).toLocaleString('ko-KR')}건`
          + (bad ? ` · 실패 ${bad}건` : '') + ` · ${fmtDur(d.buildSeconds)}`;
        dayTip.hidden = false;
        tipAt(dayTip, e);
      };
      e.onmouseleave = () => { restore(); dayTip.hidden = true; };
    });
  }
  g.appendChild(cVol);
  p.appendChild(g);

  /* ── 최근 실행 ─────────────────────────────────────────────
     dbt 호출 단위다(파이프라인 한 번에 여러 번 잡힐 수 있다 — 모델마다 태스크를
     나누는 설정이면 그렇다). 디자인의 «행 수» 칸은 이 플랫폼에서 채울 수 없어
     («rows_affected» 를 Spark/Iceberg 어댑터가 보고하지 않는다) 소요 시간으로 바꿨다. */
  const rc = el(`<section class="card">
    <div class="card-h"><span class="card-t">최근 실행</span>
      <span class="t11 fnt">최근 24시간 · ${H.runs.length}건</span>
      <button class="lnk sp" id="hAllRun">전체 보기</button></div>
    <div class="card-b tight"></div></section>`);
  const rb = $('.card-b', rc);
  if (!H.runs.length) {
    rb.appendChild(el(`<div class="empty" style="padding:34px">${ic('clock')}
      <span>최근 24시간 안에 실행된 기록이 없습니다.</span></div>`));
  } else {
    const t = el(`<div class="tbl" style="--cols:minmax(0,1.6fr) 104px 88px 92px 96px"></div>`);
    t.appendChild(el(`<div class="th"><span>실행 대상</span><span>명령</span>
      <span style="text-align:right">소요</span><span>완료</span><span>상태</span></div>`));
    H.runs.forEach(x => {
      let sel = [];
      try { sel = JSON.parse(x.selected || '[]'); } catch (e) { sel = x.selected ? [x.selected] : []; }
      const name = sel.length ? sel.join(', ') : '전체';
      const bad = (x.fails || 0) > 0;
      const tr = el(`<div class="tr">
        <span class="col" style="gap:0;min-width:0"><span class="b6 t13 trunc" title="${esc(name)}">${esc(name)}</span>
          <span class="t11 fnt trunc">노드 ${x.nodes || 0}개${x.targetSchema ? ' · ' + esc(x.targetSchema) : ''}</span></span>
        <span class="t12 mut trunc">${esc(x.command || '—')}</span>
        <span class="t12 mut num" style="text-align:right">${x.execSeconds == null ? '—' : x.execSeconds + '초'}</span>
        <span class="t12 mut num">${esc(hhmm(x.completedAt))}</span>
        <span>${bad ? `<span class="bdg err">${ic14('xc')}실패 ${x.fails}</span>`
                    : `<span class="bdg ok">${ic14('checkc')}정상</span>`}</span></div>`);
      /* 카탈로그에 있는 모델이면 그 모델을 연다. 지워진 모델의 이력도 남아 있으므로
         확인하고 나서 손댈 수 있게 한다. */
      const hit = sel.length === 1 && byId(sel[0]) ? sel[0] : null;
      if (hit) tr.onclick = () => go('modeling', hit);
      else tr.classList.add('static');
      t.appendChild(tr);
    });
    rb.appendChild(t);
  }
  $('#hAllRun', rc).onclick = () => go('pipeline');
  p.appendChild(rc);

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
    '위쪽 네 장에서 등록된 데이터 수, 실제 적재된 행 수, 최근 7일 실행과 실패 건수를 확인합니다.',
    '카드를 선택하면 해당 데이터 모델이나 파이프라인 화면으로 이동합니다.',
    '모델별 빌드 시간에서 어느 모델이 시간을 많이 쓰는지 봅니다. 24시간과 7일을 바꿔 볼 수 있습니다.',
    '적재 현황은 스키마별로 실제 들어 있는 행 수와 최근 14일 실행 추이를 보여줍니다.',
    '최근 실행에서 지난 24시간의 실행 기록을 보고, 실행 대상을 선택하면 그 모델을 엽니다.'] },
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
