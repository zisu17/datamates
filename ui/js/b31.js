/* ── b31 — ── b31 — v2.5 — 데이터 모델(= SQL 하나) 과 데이터 파이프라인(= 흐름 구성) 의 역할 분리 ── (index.html 블록에서 기계적 추출, 동작 불변) */

/* ============================================================
   v2.5 — 데이터 모델(= SQL 하나) 과 데이터 파이프라인(= 흐름 구성) 의 역할 분리
   ============================================================ */

/* ── 1. 용어 : 객체는 SOURCE / DATA MODEL / DATA MART 세 가지 ──

   셋은 나란한 종류가 아니다. 데이터가 지나가는 순서이고, 마지막 하나는
   상태다.

     수집 → SOURCE → DATA MODEL → (지정) → DATA MART → 분석

   DATA MART 는 새 객체가 아니라 «최종 DATA MODEL 에 부여한 역할» 이다.
   그래도 카탈로그·계보·상세에서 한 칸을 차지하는 이유는, 사용자가 그 상태로
   무엇을 할 수 있는지(분석에서 고를 수 있다)가 완전히 달라지기 때문이다.
   화면에서 마트 · 데이터 마트 같은 흔들리는 표기를 쓰지 않는다 — DATA MART 다. */
const GRP = { SRC: 'SOURCE', MODEL: 'DATA MODEL', MART: 'DATA MART' };
const GRPS = [GRP.SRC, GRP.MODEL, GRP.MART];
const KINDC = { 'SOURCE': '#94A3B8', 'DATA MODEL': '#6366F1', 'DATA MART': '#0E9F6E' };
const isMart = (x) => { const d = typeof x === 'string' ? byId(x) : x; return !!(d && d.isMart); };
const grpOf = (x) => {
  const d = typeof x === 'string' ? byId(x) : x;
  if (!d) return GRP.MODEL;
  if (d.kind === 'source') return GRP.SRC;
  return d.isMart ? GRP.MART : GRP.MODEL;
};
const grpColor = (x) => KINDC[grpOf(x)];
/* 각 구분이 흐름의 어느 자리인지 — 상세·카탈로그가 같은 문장을 쓴다 */
const GRP_DESC = {
  'SOURCE': '수집기가 적재한 원천 데이터입니다. 데이터 모델의 입력으로 씁니다.',
  'DATA MODEL': '다른 모델이 이어서 쓰는 가공 데이터입니다. 분석에서는 직접 쓰지 않습니다.',
  'DATA MART': '분석에서 쓸 수 있는 최종 데이터입니다. 다른 모델의 입력으로는 쓸 수 없습니다.',
};
LAYER['원천'].color = KINDC['SOURCE'];
LAYER['정제'].color = LAYER['분석용'].color = KINDC['DATA MODEL'];
LAYER['마트'] = { key: 'mart', color: KINDC['DATA MART'], tag: 'ok', tech: 'model' };
LAYER['원천'].tech = 'source'; LAYER['정제'].tech = LAYER['분석용'].tech = 'model';
layerTag = function (l) {
  const g = l === '원천' ? GRP.SRC : l === '마트' ? GRP.MART : GRP.MODEL;
  return `<span class="kindt" style="background:${KINDC[g]}1F;color:${KINDC[g]}">${g}</span>`;
};
/* 구분 배지 — 목록·상세·계보가 같은 모양을 쓴다 */
function grpTag(x, style) {
  const g = typeof x === 'string' && GRPS.includes(x) ? x : grpOf(x);
  return `<span class="kindt" style="background:${KINDC[g]}1F;color:${KINDC[g]}${style ? ';' + style : ''}">${g}</span>`;
}

/* 메뉴 = 데이터 생애주기의 단계다. 순서가 곧 흐름이라 바꾸지 않는다.
   수집 → 모델링 → 파이프라인 → (품질) → 분석. 데이터 마트는 메뉴가 아니다 —
   별도의 화면을 두면 «마트를 또 만드는 곳» 처럼 읽히는데, 실제로는 모델에
   상태를 부여하는 일이라 데이터 모델 화면 안에 있어야 한다. */
MENUS.forEach(m => { if (m.id === 'modeling') m.label = '데이터 모델'; });
/* 각 단계의 한 줄 정의 — 홈의 흐름 레일과 도움말이 함께 쓴다 */
const FLOW_STEPS = [
  { id: 'ingest', label: '데이터 수집', icon: 'down',
    made: 'SOURCE', desc: '외부 데이터 소스를 수집기로 가져와 SOURCE 로 적재합니다.' },
  { id: 'modeling', label: '데이터 모델', icon: 'model',
    made: 'DATA MODEL', desc: 'SOURCE 나 기존 모델로 새 DATA MODEL 을 정의합니다.' },
  { id: 'pipeline', label: '데이터 파이프라인', icon: 'pipe',
    made: '실행', desc: '모델의 의존관계대로 언제·어떤 순서로 실행할지 정합니다.' },
  { id: 'quality', label: '데이터 품질', icon: 'shield',
    made: '검증', desc: '모델에 규칙을 걸어 값이 기대대로인지 검사합니다.' },
  { id: 'analytics', label: '데이터 분석', icon: 'chart',
    made: '분석', desc: 'DATA MART 를 골라 차트·지표·대시보드를 만듭니다.' },
];
/* 홈 상단의 흐름 레일.
   메뉴만 놓아 두면 다섯 화면이 각자 다른 관리도구처럼 보인다. 실제로는 앞
   단계가 만든 것을 다음 단계가 이어 쓰는 하나의 생애주기라, 그 순서와 지금
   각 단계에 무엇이 몇 개 있는지를 첫 화면이 먼저 말해 준다.

   뒤에 로드되는 파일의 값(ING·ANA)을 try 로 감싸는 이유 — b49 가 로드 도중
   render() 를 한 번 부르는데, 그 시점에 api.js·b53 은 아직 실행 전이라
   const 가 TDZ 다. 참조하면 ReferenceError 가 나면서 그 뒤 파일이 통째로 죽는다. */
function flowRail() {
  const tryN = (fn) => { try { const v = fn(); return v == null ? null : v; } catch (e) { return null; } };
  const nSrc = D.filter(d => d.kind === 'source').length;
  const nModel = D.filter(d => d.kind === 'model' && !d.isMart).length;
  const nIng = tryN(() => ING.length);
  const nPipe = PIPES.length;
  /* 대시보드 수만 분석 엔진 쪽 값이다. 아직 안 받았으면 여기서 한 번 부른다 —
     도착하면 anaLoad 가 홈을 다시 그린다.

     error 를 함께 보는 것이 중요하다. anaLoad 는 실패해도 finally 에서 홈을 다시
     그리는데, 그 조건이 «데이터가 없으면 부른다» 뿐이면 실패 → 렌더 → 다시 호출
     → 실패 … 로 무한히 돈다. 한 번 실패했으면 더 부르지 않고 «—» 로 남긴다. */
  const nAna = tryN(() => {
    if (!ANA.data) {
      if (!ANA.error && !ANA.loading) anaLoad(false);
      return null;
    }
    return (ANA.data.dashboards || []).length;
  });

  /* 품질 단계는 «걸려 있는 규칙 수» 를 보여준다. 통과율이 아니라 규칙 수인 이유는,
     레일이 말하는 것이 «각 단계가 지금 갖고 있는 것» 이기 때문이다. */
  const nRule = QRULES.filter(q => q.active).length;
  const COUNTS = [
    { n: nIng, unit: '수집기' }, { n: nSrc, unit: 'SOURCE' },
    { n: nModel, unit: 'DATA MODEL' }, { n: nPipe, unit: '파이프라인' },
    { n: nRule, unit: '규칙' }, { n: nAna, unit: '대시보드' },
  ];
  /* 단계별로 «그 단계가 지금 갖고 있는 것» 을 하나씩 고른다.
     수집은 수집기 수가 아니라 그것이 만든 SOURCE 수가 다음 단계로 넘어가는 값이다. */
  const PICK = [[0, 1], [2], [3], [4], [5]];

  const rail = el(`<div class="row g6" style="align-items:stretch;flex-wrap:nowrap;
    overflow-x:auto;padding:2px 0 14px"></div>`);

  FLOW_STEPS.forEach((st, i) => {
    if (i) rail.appendChild(el(`<span class="row" style="align-items:center;flex:none;
      color:var(--faint);padding:0 2px">${ic14('chev')}</span>`));
    const cells = PICK[i].map(k => COUNTS[k])
      .map(c => `<span class="row g4" style="align-items:baseline">
        <span class="b6 t13">${c.n == null ? '—' : c.n}</span>
        <span class="t11 fnt">${esc(c.unit)}</span></span>`).join('');
    const cur = S.page === st.id;
    const b = el(`<button class="col g6" title="${esc(st.desc)}"
      style="flex:1 1 0;min-width:132px;text-align:left;cursor:pointer;
      padding:10px 12px;border:1px solid var(--line);border-radius:8px;
      background:var(--surface);${cur ? 'border-color:var(--pri)' : ''}">
      <span class="row g6" style="align-items:center;color:var(--muted)">
        ${ic14(st.icon, 'fnt')}<span class="t12 b6" style="color:var(--ink)">${esc(st.label)}</span></span>
      <span class="row g10" style="flex-wrap:wrap">${cells}</span></button>`);
    b.onclick = () => go(st.id);
    rail.appendChild(b);
  });
  return rail;
}

HELP.modeling.t = '데이터 모델';
HELP.modeling.items = [
  '하나의 SQL로 하나의 데이터 모델을 정의합니다. 출력 테이블도 하나입니다.',
  '입력은 데이터 수집이 만든 SOURCE 또는 앞서 만든 DATA MODEL 입니다.',
  '모델 사이의 실행 순서는 SQL 의 ref() 가 정합니다 — 따로 잇지 않습니다.',
  '여러 모델을 거친 최종 모델만 DATA MART 로 지정합니다. 중간 모델은 내부 가공용입니다.',
  'DATA MART 로 지정하면 데이터 분석에서 고를 수 있고, 다른 모델의 입력으로는 쓸 수 없습니다.',
  '실행은 하지 않습니다. 언제 돌릴지는 데이터 파이프라인에서 정합니다.'];
HELP.pipeline.t = '데이터 파이프라인';
HELP.pipeline.items = [
  '데이터 모델에서 정의한 모델들을 실행하고 운영하는 화면입니다.',
  '모델을 여기서 다시 정의하지 않습니다 — 실행 순서는 모델의 ref() 가 정합니다.',
  '실행 설정 에서 예약·수동 실행·선행 파이프라인 트리거를 정합니다.',
  '실행 흐름 에서 성공·실패와 모델별 실행 로그를 확인합니다.',
  '데이터 수집의 예약된 수집기도 같은 화면에서 함께 모니터링합니다.',
  '새 가공 로직이 필요하면 데이터 모델 화면에서 모델을 만들어 가져옵니다.'];
/* 수집·분석은 도움말이 없어 홈 것이 대신 떠 있었다. 두 화면 모두 흐름의
   양 끝이라 «앞뒤로 무엇이 이어지는가» 를 여기서 말해 준다. */
HELP.ingest = { t: '데이터 수집', items: [
  '외부 데이터 소스에 연결해 수집기를 만듭니다. 흐름의 시작점입니다.',
  '수집 대상·적재 방식(덧붙이기·전체 교체)·실행 방식(예약·수동)을 정합니다.',
  '가공은 하지 않습니다 — 원본 그대로 넣고, 정제는 데이터 모델이 맡습니다.',
  '적재된 데이터는 SOURCE 가 되어 데이터 모델 화면에서 입력으로 쓸 수 있습니다.',
  '수집 상세의 다음 단계 에서 SOURCE 확인 · 데이터 모델 만들기로 바로 넘어갑니다.',
  '예약 실행을 켠 수집기는 데이터 파이프라인 화면에서 함께 모니터링합니다.'] };
HELP.analytics = { t: '데이터 분석', items: [
  'DATA MART 로 지정된 데이터 모델만 분석 데이터로 고를 수 있습니다.',
  'SOURCE 와 중간 DATA MODEL 은 목록에 나오지 않습니다 — 분석마다 가공 단계가 달라지지 않게 하기 위해서입니다.',
  '고를 데이터가 없다면 데이터 모델 화면에서 최종 모델을 DATA MART 로 지정하세요.',
  '데이터를 고른 뒤 시각화·차원·측정값·조건을 정하고 실행해 결과를 확인합니다.',
  '저장하면 분석이 되고, 대시보드에 올려 함께 볼 수 있습니다.',
  '대시보드 제목줄에서 이 분석이 어떤 DATA MART 를 쓰는지, 그 데이터가 언제 적재됐는지 확인합니다.'] };
HELP.home.t = '홈';
HELP.home.items = [
  '서비스는 하나의 흐름입니다 — 데이터 수집 → 데이터 모델 → 데이터 파이프라인 → 데이터 품질 → 데이터 분석.',
  '상단 흐름 레일에서 각 단계의 현재 개수를 보고 그 화면으로 바로 이동합니다.',
  '요약 카드에서 실행 실패·검증 실패·수집 지연 건수를 확인합니다.',
  '어느 화면에서든 지금 보고 있는 객체의 이전 단계와 다음 단계를 함께 볼 수 있습니다.'];

/* 흔들리던 표기를 한 번에 정리한다.
   데이터 모델링 → 데이터 모델, 그리고 마트 · 데이터마트 → DATA MART.
   (「데이터 마트」는 단계 이름으로 쓰므로 그대로 둔다 — 바꾸는 것은 객체 표기다) */
/* [찾을 문자열, 바꿀 문자열]. 정규식을 쓰지 않는 이유는 g 플래그 정규식의
   test() 가 lastIndex 를 들고 다녀 두 번째 호출부터 어긋나기 때문이다. */
const TERM_FIX = [
  ['데이터 모델링', '데이터 모델'],
  ['데이터마트', 'DATA MART'],
  ['마트 모델', 'DATA MART'],
];
function fixTerms(root) {
  if (!root) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const hit = [];
  while (w.nextNode()) {
    if (TERM_FIX.some(([from]) => w.currentNode.nodeValue.includes(from))) hit.push(w.currentNode);
  }
  hit.forEach(n => {
    TERM_FIX.forEach(([from, to]) => { n.nodeValue = n.nodeValue.split(from).join(to); });
  });
  $$('[title*="데이터 모델링"]', root).forEach(n => n.title = n.title.replace(/데이터 모델링/g, '데이터 모델'));
}
/* (modal — fixTerms(scrim) 한 줄을 b01 본체 return 앞으로 옮겼다. 제거) */
/* ── 2. 모델 = SQL 하나 ── */
const MODEL_RULE = '하나의 SQL로 하나의 데이터 모델을 정의합니다.';
function sqlAudit(sql) {
  const s = String(sql || '');
  const body = s.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
  const stmts = body.split(';').map(x => x.trim()).filter(Boolean);
  const cte = (body.match(/\bwith\b|\)\s*,\s*[a-z_][\w]*\s+as\s*\(/gi) || []).length;
  const cteNames = [...body.matchAll(/(?:with|,)\s+([a-z_][\w]*)\s+as\s*\(/gi)].map(m => m[1]);
  const ddl = /\b(insert\s+into|create\s+table|create\s+view|drop\s+|merge\s+into|update\s+\w+\s+set|delete\s+from)\b/i.exec(body);
  const selects = (body.match(/\bselect\b/gi) || []).length;
  return { stmts: stmts.length, cte: cteNames.length, cteNames, ddl: ddl && ddl[0].trim(), selects };
}
/* (checkSql — 이후 정의가 값 캡처 없이 전면 교체. 죽은 층 제거) */
/* ── 3. 카탈로그 : SOURCE / DATA MODEL ── */
/* (modelList — 이후 정의가 값 캡처 없이 전면 교체. 죽은 층 제거) */
/* 정의 화면 머리말에 규칙 한 줄 */
/* 구분 을 SOURCE / DATA MODEL 로 */
