/* ── b14 — 데이터 품질 ──────────────────────────────────────────────────
   ============================================================
   claude.ai/design 프로젝트 «데이터 품질 진단» 을 그대로 옮긴다.
   화면 일곱 개가 좌측 하위 내비 하나를 공유한다 —

       품질현황   품질 대시보드 (dash)   품질 리포트 (report)
       검증관리   검증 규칙   (rules)   검증 결과   (runs)
       (내비에 없는 하위 화면)  규칙 상세 (detail) · 규칙 등록 (form) · 오류 행 (errors)

   마크업은 DS 컴포넌트 층(.wc-*, ds/components.css)을 그대로 쓴다. 이 화면이
   쓰는 부품(스크롤 표·페이지네이션·체크박스·토글·빵가루)이 앱 어휘에 없어서,
   앱 클래스로 다시 만들면 DS 를 복제하게 된다. 아이콘만은 예외로 앱 스프라이트
   (#i-*)를 쓴다 — 원본은 Tabler CDN 마스크인데, 그러면 한 화면에 아이콘 소스가
   두 벌이 되고 오프라인에서 아이콘만 사라진다.

   ── 규칙 = dbt 제네릭 테스트 + 인자 ──────────────────────────
   원본 디자인은 «규칙 하나에 적용 대상 여러 개» 를 전제한다. dbt 에서 재사용되는
   단위가 정확히 그것이다 — 제네릭 테스트(not_null · accepted_values …)와 그 인자가
   규칙이고, 그것이 걸린 (모델, 컬럼) 하나하나가 적용 대상이다. 서버는 이미 그 키를
   내려준다: rule.cond = «유형(인자=값 · 인자=값)» (state.rules 의 _kw_text).

   그래서 이 화면은 QRULES(dbt 테스트 목록)를 (cond, 심각도) 로 묶어 규칙을 만들고,
   묶이기 전의 각 항목을 적용 대상으로 다룬다. 규칙 목록·상세는 묶음 단위로,
   사용 여부 토글·삭제는 여전히 개별 dbt 테스트 단위로 동작한다 — 데이터 모델
   화면의 «품질 규칙» 탭과 단위가 갈라지지 않게.

   싱귤러 테스트(tests/*.sql)는 예외다. 인자가 없어 cond 가 전부 «singular» 로
   같아지므로 테스트 이름을 키로 쓴다. 파일 하나가 규칙 하나다.

   ── 서버에 근거가 없는 자리 ──────────────────────────────────
   원본에는 있지만 이 플랫폼에 아직 개념이 없는 것들 — 오류 행 조치 상태
   (미조치·조치중·조치완료·예외승인), 미리 검증 1,000행, 월별 조치 완료 추이,
   판정 기준 건수·알림·오류 행 보관 설정. **숫자를 지어내지 않는다.** 자리는 두고
   qSoon() 으로 «무엇이 없어서 비었는지» 를 적는다. 실데이터로 대신할 수 있는
   자리는 대신한다(예: 「미조치 오류 행」 → 실제 위반 행 합계).
   ============================================================ */

/* ── 좌측 하위 내비 ── */
const QNAV = [
  { group: '품질현황', items: [
    { view: 'dash', label: '품질 대시보드', icon: 'chart' },
    { view: 'report', label: '품질 리포트', icon: 'doc' },
  ] },
  { group: '검증관리', items: [
    { view: 'rules', label: '검증 규칙', icon: 'shield' },
    { view: 'runs', label: '검증 결과', icon: 'checkc' },
  ] },
];
/* 하위 화면이 열려 있을 때 내비에서 켜 둘 상위 항목 */
/* 오류 행 화면은 «이 규칙이 이 대상에서 걸러낸 행» 이라 검증 규칙 아래다 —
   검증 결과에서 들어와도 그렇다. 빵가루도 검증 규칙 / 규칙ID / 대상 순이므로
   내비를 검증 결과로 켜면 화면 안에서 두 갈래 길이 보인다. */
const QNAV_PARENT = { detail: 'rules', form: 'rules', errors: 'rules' };

/* 검사 유형 → 품질지표. 원본의 6종에 dbt 의 최신성(source freshness)을 더해
   「적시성」 으로 둔다 — 유형이 일곱인데 지표를 여섯으로 접으면 최신성 검사가
   커스텀으로 잘못 분류된다. */
const QMETRIC = {
  notnull: '완전성', accepted: '유효성', rel: '일관성',
  range: '정확성', unique: '유일성', fresh: '적시성', sql: '커스텀 규칙',
};
const QMETRICS = ['완전성', '유효성', '일관성', '정확성', '유일성', '적시성', '커스텀 규칙'];
/* 대시보드의 「지표별 품질 점수」 에서는 커스텀 규칙을 뺀다(원본 디자인도 그렇다).
   완전성·유효성·일관성·정확성·유일성·적시성 은 데이터 품질의 «차원» 이지만
   커스텀 규칙은 그 어디에도 안 들어가는 «나머지» 다. 차원 점수와 나란히 두면
   같은 층의 지표로 읽혀, 사용자 정의 검사 하나가 통과했다는 사실이 품질 차원
   하나를 충족했다는 말처럼 보인다. 리포트의 모델×지표 매트릭스에는 남긴다 —
   그쪽은 «어떤 검사가 걸려 있나» 를 빠짐없이 보여주는 표다. */
const QMETRICS_DIM = QMETRICS.filter(m => m !== '커스텀 규칙');

/* 묶음 규칙의 이름. dbt 는 테스트에 사람 이름을 붙이지 않으므로(이름을 자동
   생성한다) 유형에서 만든다. 같은 유형의 규칙이 둘 이상일 때는 인자로 가른다. */
const QRULE_NAME = {
  notnull: '필수 항목 누락 검증', unique: '키 중복 검증',
  accepted: '허용값 목록 검증', rel: '참조 무결성 검증',
  range: '값 범위 검증', fresh: '적재 최신성 검증', sql: '사용자 정의 검증',
};

/* 기간 — 원본의 7·30·90일. /history/* 의 days 파라미터로 그대로 넘어간다. */
const QDAYS = { '7일': 7, '30일': 30, '90일': 90 };

/* 상태 표기. 색·농도는 app.css 의 상태 토큰을 쓴다(DS Badge 의 값과 같다) —
   여기서 새 rgba 를 적으면 화면마다 농도가 갈리는 시작점이 된다. */
const QST = {
  '실패':   { fg: 'var(--w-danger)',  bg: 'var(--err-soft)' },
  '경고':   { fg: 'var(--w-warning)', bg: 'var(--warn-soft)' },
  '통과':   { fg: 'var(--w-success)', bg: 'var(--ok-soft)' },
  '미실행': { fg: 'var(--w-text-2)',  bg: 'var(--w-hover)' },
  '비활성': { fg: 'var(--w-text-2)',  bg: 'var(--w-hover)' },
};

/* 화면 상태. 기존 키(qSel · qQuery)는 주소 라우팅과 다른 화면이 이미 쓰므로 그대로 쓴다. */
Object.assign(S, {
  qView: S.qView || 'dash',
  qPeriod: S.qPeriod || '7일',
  qModel: S.qModel || '전체', qMetric: S.qMetric || '전체', qStatus: S.qStatus || '전체',
  qPage: S.qPage || 1, qPick: S.qPick || {},
  qDTab: S.qDTab || '적용 대상', qResTab: S.qResTab || '전체',
  qTgt: S.qTgt || null,          // 오류 행 화면이 보고 있는 적용 대상(dbt 테스트 id)
  qErrQ: S.qErrQ || '',
  qForm: S.qForm || null,        // 규칙 등록 폼 입력값
});

/* ============================================================
   1. 데이터
   ============================================================
   규칙 자체는 부팅이 채운 QRULES 를 쓴다(설계서 8.1 의 단일 리소스 — 여기서 다시
   조립하면 홈·모델 화면의 숫자와 갈린다). 이력 통계만 이 화면에서 받는다.

   한 번에 받아 한 번에 그린다. 카드마다 따로 부르면 카드가 하나씩 늦게 채워져
   화면이 덜컹거린다. 기간을 바꾸면 그 기간으로 다시 받는다. */
const QUAL = {
  days: null, dash: null, daily: null, tests: null,
  loading: false, error: null,
  rows: {}, rowsErr: {},        // 오류 행 — 적용 대상 id → 서버 응답
  hist: {}, histLoading: {},    // 실행 이력 — 규칙 rid → 대상별 실행 목록
};

async function qLoad(force) {
  const days = QDAYS[S.qPeriod] || 30;
  if (QUAL.loading) return;
  if (!force && QUAL.days === days && QUAL.dash) return;
  QUAL.loading = true;
  try {
    /* 이력 두 개는 Elementary 를 집계하므로 저장소가 없으면 실패한다. 대시보드는
       manifest 만 보므로 살아 있다 — 하나가 실패해도 나머지는 그린다. */

    const [dash, daily, tests] = await Promise.all([
      api('/quality/dashboard'),
      api(`/quality/trend?days=${days}`).catch(() => null),
      api(`/history/tests?days=${days}&limit=500`).catch(() => null),
    ]);
    QUAL.dash = dash;
    QUAL.daily = daily ? daily.items : null;
    QUAL.tests = tests ? tests.items : null;
    QUAL.days = days;
    QUAL.error = null;
  } catch (e) {
    QUAL.error = e.message || '품질 현황을 불러오지 못했습니다.';
  } finally {
    QUAL.loading = false;
    if (S.page === 'quality') render();
  }
}

/* 규칙별 검사 이력 — /history/tests 를 dbt 테스트 이름으로 찾아 쓴다 */
const qHist = (testId) => (QUAL.tests || []).find(t => t.testName === testId) || null;

/* ============================================================
   2. 규칙 묶기
   ============================================================ */

/* cond 의 인자 부분을 되읽는다. 서버가 만드는 형식이 고정이라(_kw_text)
   «유형(키=값 · 키=값)» 만 다룬다. 값 안에 ', ' 는 있어도 ' · ' 는 없다. */
function qArgs(cond) {
  const s = String(cond || '');
  const i = s.indexOf('(');
  if (i < 0 || s[s.length - 1] !== ')') return {};
  const out = {};
  s.slice(i + 1, -1).split(' · ').forEach(part => {
    const j = part.indexOf('=');
    if (j > 0) out[part.slice(0, j).trim()] = part.slice(j + 1).trim();
  });
  return out;
}

const qTrunc = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));

/* 묶음 규칙의 이름. 같은 유형이 여러 규칙으로 갈릴 때(범위 검사 세 개 등)
   인자로 구별해 준다 — 이름이 같으면 목록에서 어느 것인지 알 수 없다. */
function qRuleTitle(type, cond, singular, testId) {
  if (singular) return testId;                       // 싱귤러는 파일 이름이 곧 규칙 이름이다
  const base = QRULE_NAME[type] || (QTYPES[type] || {}).label || type;
  const a = qArgs(cond);
  if (type === 'range' && (a.min_value != null || a.max_value != null))
    return `${base} · ${a.min_value == null ? '' : a.min_value}~${a.max_value == null ? '' : a.max_value}`;
  if (type === 'accepted' && a.values) return `${base} · ${qTrunc(a.values, 26)}`;
  if (type === 'rel' && (a.to || a.field)) {
    const to = String(a.to || '').replace(/^ref\(\s*'?|'?\s*\)$/g, '');
    return `${base} · ${[to, a.field].filter(Boolean).join('.')}`;
  }
  /* dbt_utils 의 매크로 검사(expression_is_true · not_in_future …)는 매크로 이름이
     곧 규칙이다. 유형 라벨만 쓰면 목록에서 서로 구별되지 않는다. */
  const macro = String(cond).split('(')[0].trim().replace('dbt_utils.', '');
  if (type === 'sql' && macro) return `${base} · ${macro}`;
  /* 그 밖에 인자가 붙은 검사(unique_combination_of_columns 등)는 첫 인자로 가른다 */
  const k = Object.keys(a)[0];
  return k ? `${base} · ${qTrunc(a[k], 26)}` : base;
}

/* 적용 대상 하나의 상태. dbt 테스트의 결과를 그대로 읽는다. */
function qTgtStatus(t) {
  if (!t.active) return '비활성';
  if (t.__notRun) return '미실행';
  return t.status === 'err' ? '실패' : t.status === 'warn' ? '경고' : '통과';
}

/* 품질 점수 — 하나의 산식만 쓴다.
   «활성이고 결과가 있는 적용 대상 중 통과한 대상의 비율». /quality/dashboard 의
   score 와 같은 식이라 화면 안에서 숫자가 갈리지 않는다. */
function qScore(targets) {
  const on = targets.filter(t => t.active && !t.__notRun);
  if (!on.length) return { n: 0, score: null };
  return { n: on.length, score: on.filter(t => t.status === 'ok').length / on.length * 100 };
}

/* QRULES → 묶음 규칙 배열. 매 렌더마다 계산한다 — QRULES 는 부팅에서만 바뀌고
   건수가 수십~수백이라 캐시가 벌어 주는 것보다 어긋날 위험이 크다. */
function qGroups() {
  const by = new Map();
  QRULES.forEach(t => {
    const key = t.__singular ? 'S:' + t.id : 'G:' + t.cond + '|' + t.sev;
    if (!by.has(key)) by.set(key, []);
    by.get(key).push(t);
  });

  /* id 채번 — dbt 에는 묶음이라는 개념이 없어 화면이 만들어야 한다. 키에서 만든
     해시라 새로고침해도 같은 값이고(주소에 실린다), 규칙이 늘거나 줄어도
     남은 규칙의 id 가 밀리지 않는다. */
  const groups = [...by.entries()].map(([key, targets]) => {
    const head = targets[0];
    const models = [...new Set(targets.map(t => t.model))];
    const on = targets.filter(t => t.active);
    const failed = targets.filter(t => ['실패', '경고'].includes(qTgtStatus(t)));
    const status = !on.length ? '비활성'
      : on.some(t => t.status === 'err') ? '실패'
      : on.some(t => t.status === 'warn') ? '경고'
      : on.every(t => t.__notRun) ? '미실행' : '통과';
    return {
      key, rid: 'R-' + qHash(key), targets, models, status,
      type: head.type, cond: head.cond, sev: head.sev, singular: !!head.__singular,
      metric: QMETRIC[head.type] || '커스텀 규칙',
      kind: (QTYPES[head.type] || {}).label || head.type,
      name: qRuleTitle(head.type, head.cond, head.__singular, head.id),
      active: on.length > 0,
      failTargets: failed.length,
      errRows: targets.reduce((s, t) => s + (t.active ? (t.cnt || 0) : 0), 0),
      score: qScore(targets),
    };
  });

  /* 확인할 것이 먼저 온다 — 실패 → 경고 → 미실행 → 통과 → 비활성, 그다음 이름 */
  const rank = { '실패': 0, '경고': 1, '미실행': 2, '통과': 3, '비활성': 4 };
  groups.sort((a, b) => (rank[a.status] - rank[b.status]) || a.name.localeCompare(b.name, 'ko'));

  /* 해시가 겹치면(확률은 낮지만 0 이 아니다) 뒤에 온 것에 접미를 붙여 갈라 둔다.
     겹친 채로 두면 규칙 상세가 엉뚱한 규칙을 연다. */
  const used = new Set();
  groups.forEach(g => {
    let id = g.rid, n = 1;
    while (used.has(id)) id = g.rid + '-' + (++n);
    used.add(id); g.rid = id;
  });
  return groups;
}

/* FNV-1a 32bit → 네 자리 십진수. 원본의 R-0142 표기를 따른다. */
function qHash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
  return String(1000 + (h % 9000));
}

const qGroupOf = (rid) => qGroups().find(g => g.rid === rid) || null;

/* 지금 보고 있는 규칙. 없으면 첫 규칙으로 떨어뜨린다 — 주소로 들어온 낯선 rid,
   방금 지운 규칙 둘 다 여기로 온다. */
function qCurrent() {
  const gs = qGroups();
  return gs.find(g => g.rid === S.qSel) || gs[0] || null;
}

/* 다른 화면(모델 화면의 품질 규칙 탭, 홈 알림)이 dbt 테스트 id 로 들어온다.
   그 테스트가 속한 묶음 규칙의 상세를 연다. */
function qOpenRule(testId) {
  const g = qGroups().find(x => x.targets.some(t => t.id === testId));
  if (!g) return false;
  S.qSel = g.rid; S.qView = 'detail'; S.qDTab = '적용 대상'; S.qTgt = testId;
  return true;
}

/* ============================================================
   3. 공통 조각
   ============================================================ */

/* 크기를 지정하는 아이콘. 체크 표시(12)·빵가루 화살표(14)처럼 ic/ic14 의
   16·14 가 맞지 않는 자리에 쓴다. */
const qic = (n, px, w) => `<svg class="ic" width="${px}" height="${px}" viewBox="0 0 24 24"`
  + ` fill="none" stroke="currentColor" stroke-width="${w || 2}" stroke-linecap="round"`
  + ` stroke-linejoin="round"><use href="#i-${n}"/></svg>`;

const qn = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString('ko-KR'));
const qpct = (v, d) => (v == null ? '—' : Number(v).toFixed(d == null ? 1 : d) + '%');

/* 점수 색 — 70/90 경계. **이 화면에서 빨강·주황은 실패·경고 하나만 뜻한다.**

   원본 디자인은 기준을 넘긴 점수에 순위별 차트 팔레트를 돌려 썼다
   (scoreColor(v, i) → --w-chart-(i+1)). 그 목업에는 실패가 하나도 없어서 무지개가
   «범주 팔레트» 로 읽혔지만, 실제로 실패·경고가 생기면 그 팔레트가 상태 색과
   부딪힌다 — 팔레트 2번이 주황(경고 색), 6번이 핑크 rgb(255,45,85) 로 실패 색
   rgb(255,56,60) 과 구분되지 않는다. 통과율 100% 인 모델이 목록 여섯째 줄에
   있다는 이유만으로 빨갛게 나왔다. 그래서 순위 색을 쓰지 않는다.

     qsc(v)   막대·미터 — 기준 미달만 색으로 말하고, 넘기면 accent 하나로
     qscT(v)  숫자 글자 — 넘기면 색을 아예 쓰지 않는다(본문 색). 100% 를 파랗게
              칠하면 «파랑 = 좋다» 와 «파랑 = 누를 수 있다» 가 한 화면에서 겹친다.

   범주 팔레트(--w-chart-*)는 상태와 무관한 구성 비율에만 쓴다 — 「검증 유형별
   오류 행 구성」 처럼 모든 조각이 이미 오류라 색이 심각도를 오해시킬 수 없는 자리. */
const qsc = (v) => (v == null ? 'var(--w-text-3)' : v < 70 ? 'var(--w-danger)'
  : v < 90 ? 'var(--w-warning)' : 'var(--w-chart-1)');
const qscT = (v) => (v == null ? 'var(--w-text-3)' : v < 70 ? 'var(--w-danger)'
  : v < 90 ? 'var(--w-warning)' : 'var(--w-text)');

function qBadgeHtml(status) {
  const c = QST[status] || QST['미실행'];
  return `<span class="wc-badge" style="background:${c.bg};color:${c.fg}">`
    + `<span class="wc-badge__dot"></span>${esc(status)}</span>`;
}

/* 서버에 근거가 없는 자리. 지어낸 숫자를 넣는 대신 무엇이 없어서 비었는지 적는다. */
const qSoon = (msg) => `<div class="q-soon">${ic('clock')}<span>${esc(msg)}</span></div>`;

/* 화면 껍데기 — 제목줄 + 본문. o = {crumbs, title, badge, sub, actions} */
function qHead(main, o) {
  const head = el('<div class="wc-shell__head"></div>');
  if (o.crumbs) {
    const c = el('<div class="wc-crumbs"></div>');
    o.crumbs.forEach((x, i) => {
      if (i) c.appendChild(el(`<span class="wc-crumbs__sep">${qic('chev', 12)}</span>`));
      if (x.go) { const a = el(`<a>${esc(x.label)}</a>`); a.onclick = x.go; c.appendChild(a); }
      else c.appendChild(el(`<span class="wc-crumbs__cur">${esc(x.label)}</span>`));
    });
    head.appendChild(c);
  }
  const row = el('<div class="wc-shell__titlerow"></div>');
  row.appendChild(el(`<div><div class="q-titleline"><h1 class="w-h1">${esc(o.title)}</h1>`
    + (o.badge || '') + '</div>'
    + (o.sub ? `<p class="w-caption" style="margin-top:4px">${o.sub}</p>` : '') + '</div>'));
  const act = el('<div class="q-acts"></div>');
  (o.actions || []).filter(Boolean).forEach(b => act.appendChild(b));
  row.appendChild(act);
  head.appendChild(row);
  main.appendChild(head);
  const body = el('<div class="wc-shell__content q-content"></div>');
  main.appendChild(body);
  return body;
}

function qBtn(label, kind, onclick, o) {
  const b = el(`<button type="button" class="wc-btn wc-btn--${kind || 'secondary'} wc-btn--${(o && o.size) || 'md'}`
    + `${o && o.off ? ' wc-btn--disabled' : ''}"${o && o.title ? ` title="${esc(o.title)}"` : ''}>`
    + `${o && o.icon ? ic14(o.icon) : ''}<span>${esc(label)}</span></button>`);
  if (onclick && !(o && o.off)) b.onclick = onclick;
  return b;
}

/* 기간 세그먼트 — 대시보드·리포트가 같은 것을 쓴다 */
function qPeriodTabs() {
  const t = el('<div class="wc-tabs wc-tabs--segment"></div>');
  Object.keys(QDAYS).forEach(p => {
    const b = el(`<button type="button" class="wc-tab ${S.qPeriod === p ? 'is-active' : ''}">${p}</button>`);
    b.onclick = () => { S.qPeriod = p; qLoad(true); render(); };
    t.appendChild(b);
  });
  return t;
}

function qKpi(label, value, sub, o) {
  const t = (o && o.tone) ? ` style="color:${o.tone}"` : '';
  const st = (o && o.subTone) ? ` style="color:${o.subTone}"` : '';
  const c = el(`<div class="wc-card"${o && o.go ? ' style="cursor:pointer"' : ''}>
    <div class="wc-card__body q-kpi">
      <div class="w-caption">${esc(label)}</div>
      <div class="w-display"${t}>${esc(value)}</div>
      <div class="w-sm ${o && o.subTone ? '' : 'w-text-3'}"${st}>${esc(sub || '')}</div>
    </div></div>`);
  if (o && o.go) c.onclick = o.go;
  return c;
}

function qCard(title, sub, right) {
  const c = el(`<div class="wc-card">
    <div class="wc-card__head"><div><div class="wc-card__title">${esc(title)}</div>
      ${sub ? `<div class="wc-card__sub">${esc(sub)}</div>` : ''}</div></div>
    <div class="wc-card__body"></div></div>`);
  if (right) $('.wc-card__head', c).appendChild(right);
  return c;
}

/* 표 껍데기. cols = [{label, w, num, check}]

   fixed = true 면 table-layout:fixed 다. 열이 많은 표는 이것이 있어야 한다 —
   기본(auto)에서는 셀의 최소 내용 폭이 지정한 width 를 밀어내, 폭을 아무리 좁혀도
   표가 가로로 넘친다(규칙 목록에서 161px 넘쳤다). fixed 면 지정한 폭이 그대로
   지켜지고 남은 폭이 폭 없는 열(규칙 이름)에 돌아가며, td 의 말줄임이 실제로 작동한다.
   컬럼이 데이터에 따라 달라지는 표(오류 행)는 auto 가 맞다 — 값 길이가 제각각이라
   균등 분배하면 짧은 열에 빈 칸이 남는다. */
function qTable(cols, density, fixed) {
  const t = el(`<div class="wc-table wc-table--${density || 'compact'}${fixed ? ' q-fixed' : ''}">
    <div class="wc-table__scroll"><table><thead><tr>${cols.map(c =>
      `<th${c.w ? ` style="width:${c.w}px"` : ''} class="${c.num ? 'wc-table__num' : ''}${c.check ? ' wc-table__check' : ''}">${c.label == null ? '' : esc(c.label)}</th>`
    ).join('')}</tr></thead><tbody></tbody></table></div></div>`);
  return t;
}
const qBody = (t) => $('tbody', t);
function qEmpty(t, msg) {
  $('.wc-table__scroll', t).appendChild(el(`<div class="wc-table__empty">${esc(msg)}</div>`));
}

/* 체크박스 — DS 는 상태를 클래스로 표현한다(실제 input 이 아니다) */
function qCheck(on, onclick, sm) {
  const c = el(`<span class="wc-check ${sm === false ? '' : 'wc-check--sm'} ${on ? 'wc-check--on' : ''}">
    <span class="wc-check__box">${qic('check', 12, 3)}</span></span>`);
  c.onclick = (ev) => { ev.stopPropagation(); onclick(); };
  return c;
}

/* 막대 하나 — 지표별 점수·모델별 통과율이 같은 것을 쓴다 */
const qMeter = (w, color, h) =>
  `<div style="height:${h || 6}px;border-radius:${(h || 6) / 2}px;background:var(--w-hover);flex:1">
     <div style="height:100%;border-radius:${(h || 6) / 2}px;width:${w}%;background:${color}"></div></div>`;

/* ============================================================
   4. 사이드바
   ============================================================
   접기·펼치기와 폭 조절은 데이터 모델·파이프라인의 좌측 패널(.mod-l)과 **같은
   상태를 쓴다** — S.leftOpen · S.leftW. 값을 따로 두면 메뉴를 오갈 때 왼쪽 경계가
   어긋나고 접힌 상태도 갈린다(app.css 의 «좌측 패널 폭 통일» 절과 같은 판단).
   그래서 여기서 접으면 데이터 모델에서도 접혀 있고, 폭을 끌면 그쪽도 함께 넓어진다.

   접힌 모양은 DS 의 .wc-sidebar--collapsed 를 그대로 쓴다(라벨·개수·그룹 라벨을
   감추고 아이콘을 가운데로). 폭만 앱의 레일 폭(--rail-w)으로 맞춘다. */
function qSidebar() {
  const gs = qGroups();
  const targets = QRULES.filter(t => t.active).length;
  const count = { rules: gs.length, runs: targets };
  const cur = QNAV_PARENT[S.qView] || S.qView;
  const open = S.leftOpen;

  /* 접힘 아이콘은 햄버거다 — 데이터 모델 사이드바와 같은 규약(b51 의 mLTgl).
     접힌 레일에서 왼쪽 화살표(chevl)의 반대인 오른쪽 화살표(chev)를 쓰면 «다음으로
     넘어간다» 로 읽힌다. 햄버거는 «가려진 메뉴를 펼친다» 를 뜻한다. */
  const s = el(`<aside class="wc-sidebar q-side ${open ? '' : 'wc-sidebar--collapsed'}"${open ? ` style="width:${S.leftW}px"` : ''}>
    <div class="q-sidehead">
      <span class="b6 t13">데이터 품질</span>
      <button class="iconbtn sp" id="qSideTgl" title="${open ? '데이터 품질 접기' : '데이터 품질 펼치기'}">${ic14(open ? 'chevl' : 'menu')}</button>
    </div>
    <div class="wc-sidebar__body"></div>
    ${open ? '<div class="grip l" id="qGripL" title="폭 조절"></div>' : ''}</aside>`);

  const body = $('.wc-sidebar__body', s);
  QNAV.forEach(sec => {
    body.appendChild(el(`<div class="wc-sidebar__group">${esc(sec.group)}</div>`));
    sec.items.forEach(it => {
      /* 접혔을 때는 아이콘만 남으므로 title 이 유일한 이름표다 */
      const b = el(`<button type="button" class="wc-sidebar__item ${cur === it.view ? 'is-active' : ''}"
        title="${esc(it.label)}">
        <span class="wc-sidebar__icon">${ic(it.icon)}</span>
        <span class="wc-sidebar__label">${esc(it.label)}</span>
        ${count[it.view] != null ? `<span class="wc-sidebar__count">${count[it.view]}</span>` : ''}</button>`);
      b.onclick = () => { S.qView = it.view; render(); };
      body.appendChild(b);
    });
  });

  $('#qSideTgl', s).onclick = () => { S.leftOpen = !S.leftOpen; render(); };
  qWireGrip(s);
  return s;
}

/* 폭 조절 — b03 의 wireGrips 와 같은 방식이다(누르고 끌어 놓으면 렌더).
   그쪽 함수를 그대로 부르지 않는 이유는 #gripL 하나만 찾도록 되어 있어서,
   품질 화면에서 부르면 캔버스 전용 처리(drawEdges)까지 따라오기 때문이다. */
function qWireGrip(aside) {
  const g = $('.grip.l', aside);
  if (!g) return;
  g.onmousedown = (ev) => {
    ev.preventDefault();
    g.classList.add('on');
    const prev = aside.style.transition;
    aside.style.transition = 'none';          // 끄는 동안 폭이 뒤따라오면 손과 어긋난다
    const move = (e) => {
      const r = aside.getBoundingClientRect();
      S.leftW = Math.max(176, Math.min(360, e.clientX - r.left));
      aside.style.width = S.leftW + 'px';
    };
    const up = () => {
      g.classList.remove('on');
      aside.style.transition = prev;
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      render();
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };
}

/* ============================================================
   5. 품질 대시보드
   ============================================================ */
function qDashView(main) {
  qLoad();
  const gs = qGroups();
  const d = QUAL.dash;
  const all = QRULES;
  const models = [...new Set(all.map(t => t.model))].filter(m => byId(m));
  const noRule = D.filter(x => x.kind !== 'source' && !models.includes(x.id)).length;
  /* (errRows · errRuleN · overall — 화면이 QRULES 로 따로 세던 값이다.
     KPI 가 전부 서버 값을 쓰게 되면서 쓰는 곳이 없어졌다. 두 벌을 남겨 두면
     다음 사람이 어느 쪽을 고쳐야 하는지 알 수 없다.) */

  const body = qHead(main, {
    title: '품질 대시보드',
    sub: `${esc(S.qPeriod)} 기준 · ${esc(nowLabel())}`,
    actions: [qPeriodTabs(), qBtn('CSV 내려받기', 'secondary', qExport, { icon: 'down' })],
  });

  if (QUAL.error) body.appendChild(el(`<div class="note err">${ic('xc')}<span>${esc(QUAL.error)}</span></div>`));

  /* ── KPI 4장 ── */

  const kp = el('<div class="q-grid4"></div>');
  const measured = d ? d.measured : null;
  kp.appendChild(qKpi('검증 통과율',
    // 잰 규칙이 하나도 없으면 100% 가 아니라 «모름» 이다.
    d && d.score != null ? qpct(d.score, 1) : '—',
    d ? (d.notRunCount
          ? `규칙 ${d.ruleTotal}개 중 ${measured}개 측정 · 미실행 ${d.notRunCount}개`
          : `규칙 ${d.ruleTotal}개 전부 측정`)
      : '불러오는 중…',
    { tone: qscT(d ? d.score : null) }));
  kp.appendChild(qKpi('검증 대상 모델', qn(models.length),
    noRule ? `검증 미적용 ${noRule}개` : '모든 모델에 규칙이 걸려 있습니다'));
  kp.appendChild(qKpi('실패 규칙', qn(d ? d.errCount : 0),
    `경고 ${d ? d.warnCount : 0}건`,
    { tone: 'var(--w-danger)', subTone: 'var(--w-warning)',
      go: () => { S.qView = 'rules'; S.qStatus = '실패'; S.qPage = 1; render(); } }));
  kp.appendChild(qKpi('오류 행', qn(d ? d.errRows : 0),
    `규칙 ${d ? d.errRuleCount : 0}건에서 검출`,
    { tone: (d && d.errRows) ? 'var(--w-danger)' : null,
      go: () => { S.qView = 'runs'; S.qResTab = '실패'; render(); } }));
  body.appendChild(kp);

  /* ── 통과율 추이 + 지표별 점수 ── */
  const r1 = el('<div class="q-grid21"></div>');
  r1.appendChild(qTrendCard());
  r1.appendChild(qMetricCard(all));
  body.appendChild(r1);

  /* ── 모델별 통과율 + 실패 상위 규칙 ── */
  const r2 = el('<div class="q-grid12"></div>');
  r2.appendChild(qModelCard(all));
  r2.appendChild(qTopFailCard(gs));
  body.appendChild(r2);
}


function qTrendCard() {
  const c = qCard('검증 통과율 추이', `${S.qPeriod} · 일자별`);
  const b = $('.wc-card__body', c);
  const items = QUAL.daily;
  if (items == null) {
    b.appendChild(el(QUAL.loading
      ? `<div class="empty" style="padding:34px">${ic('clock')}<span>이력을 불러오는 중…</span></div>`
      : `<div class="empty" style="padding:34px">${ic('info')}<span class="empty-t">검사 이력을 읽을 수 없습니다.</span>
           <span>실행 이력은 저장소(Elementary)에 쌓입니다.</span></div>`));
    return c;
  }
  if (!items.length) {
    b.appendChild(el(`<div class="empty" style="padding:34px">${ic('info')}
      <span class="empty-t">아직 검사 이력이 없습니다.</span>
      <span>파이프라인을 한 번 실행하면 이 자리에 쌓입니다.</span></div>`));
    return c;
  }
  b.appendChild(qTrendPlot(items));
  return c;
}

/* 실행이 없는 날을 빈 구간으로 남기려면 x 를 «몇 번째 항목» 이 아니라 날짜로 잡아야
   한다. 하루를 1 로 두고 첫날부터의 경과일을 좌표로 쓴다. 항목이 하나면 폭이 0 이
   되므로 그때는 가운데 한 점만 찍는다. */
function qTrendPlot(items) {
  const day = (v) => Date.parse(String(v).slice(0, 10) + 'T00:00:00Z') / 86400000;
  const t0 = day(items[0].date), t1 = day(items[items.length - 1].date);
  const span = Math.max(1, t1 - t0);
  const xOf = (v) => (items.length === 1 ? 50 : (day(v) - t0) / span * 100);

  const vals = items.map(x => (x.passRate == null ? 0 : x.passRate));
  /* 축 아래끝 — 최솟값보다 낮은 5의 배수. 100 에 붙어 있는 날만 있으면 95 까지만
     내린다(축이 한 점으로 눌리지 않게). */
  const lo = Math.min(95, Math.floor(Math.min(...vals) / 5) * 5);
  const yOf = (v) => (100 - (v - lo) / (100 - lo) * 100);

  const pts = items.map((x, i) => ({ x: xOf(x.date), y: yOf(vals[i]), v: vals[i], d: x }));
  const first = pts[0], last = pts[pts.length - 1];
  const poly = pts.map(p => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(' ');
  /* 면은 선 아래를 채운다 — 첫 점에서 바닥으로 내려가고 마지막 점에서 바닥으로 올라온다 */
  const areaPts = `${first.x},100 ${poly} ${last.x},100`;

  const mid = Math.round((lo + 100) / 2);
  const dt = (v) => String(v || '').slice(5).replace('-', '.');

  const TICKS = [[0, 100], [50, mid], [100, lo]];   // [플롯 위에서의 %, 값]
  const w = el(`<div class="q-trend">
    <div class="q-trend-y">${TICKS.map(t =>
      `<span style="top:${t[0]}%">${t[1]}%</span>`).join('')}</div>
    <div class="q-trend-plot">
      <div class="q-trend-grid">${TICKS.map(t => `<i style="top:${t[0]}%"></i>`).join('')}</div>
      <svg class="q-trend-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <polygon points="${areaPts}" fill="var(--w-chart-1)" fill-opacity="0.1"></polygon>
        <polyline points="${poly}" fill="none" stroke="var(--w-chart-1)" stroke-width="2"
                  stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"></polyline>
      </svg>
      <div class="q-trend-dots"></div>
      <div class="q-trend-cross" hidden></div>
      <div class="q-trend-hit" tabindex="0" role="img"
           aria-label="검증 통과율 추이 ${esc(dt(items[0].date))} ~ ${esc(dt(items[items.length - 1].date))}"></div>
      <div class="chart-tip" hidden></div>
    </div>
    <div class="q-trend-x"><span>${esc(dt(items[0].date))}</span>
      <span>${esc(dt(items[items.length - 1].date))}</span></div>
  </div>`);

  /* 점 — 계열 색 하나로 찍고, 실패가 있었던 날만 상태 색으로 바꾼다. 그 사실은
     도움말에 글자로도 나오므로 색만으로 말하지 않는다. */
  const dots = $('.q-trend-dots', w);
  pts.forEach(p => {
    const bad = (p.d.fails || 0) > 0;
    dots.appendChild(el(`<i class="q-trend-dot${bad ? ' bad' : ''}"
      style="left:${p.x}%;top:${p.y}%"></i>`));
  });
  /* 마지막 값만 선 끝에 직접 적는다 — 점마다 숫자를 붙이면 축이 하는 일을 빼앗는다 */
  dots.appendChild(el(`<b class="q-trend-last${last.x > 92 ? ' end' : ''}"
    style="left:${last.x}%;top:${last.y}%">${qpct(last.v)}</b>`));

  /* 십자선이 x 를 찾는다 — 읽는 사람은 날짜를 겨누고, 2px 선을 겨누지 않는다 */
  const hit = $('.q-trend-hit', w), cross = $('.q-trend-cross', w), tip = $('.chart-tip', w);
  let cur = pts.length - 1;
  const showAt = (n) => {
    cur = Math.max(0, Math.min(pts.length - 1, n));
    const p = pts[cur], d = p.d;
    cross.hidden = false; cross.style.left = p.x + '%';
    tip.hidden = false;
    tip.textContent = `${d.date} · 통과율 ${qpct(p.v)}`
      + ` · 검사 ${qn(d.runs)}건 · 통과 ${qn(d.passes || 0)}`
      + (d.warns ? ` · 경고 ${qn(d.warns)}` : '') + (d.fails ? ` · 실패 ${qn(d.fails)}` : '');
    /* 도움말이 오른쪽 밖으로 나가면 왼쪽에 붙인다 */
    tip.style.left = p.x + '%';
    tip.style.top = p.y + '%';
    tip.classList.toggle('flip', p.x > 60);
  };
  const hide = () => { cross.hidden = true; tip.hidden = true; };
  /* 마우스는 가장 가까운 날짜를 찾아 준다 — 읽는 사람은 2px 선을 겨누지 않는다 */
  hit.addEventListener('pointermove', (ev) => {
    const r = hit.getBoundingClientRect();
    if (!r.width) return;
    const at = (ev.offsetX / r.width) * 100;
    let n = 0;
    pts.forEach((p, i) => { if (Math.abs(p.x - at) < Math.abs(pts[n].x - at)) n = i; });
    showAt(n);
  });
  hit.addEventListener('pointerleave', hide);
  /* 키보드 — 좌우로 날짜를 옮긴다. 이게 없으면 각 날짜의 값을 읽는 길이 마우스뿐이다. */
  hit.addEventListener('focus', () => showAt(cur));
  hit.addEventListener('blur', hide);
  hit.addEventListener('keydown', (ev) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, Home: -pts.length, End: pts.length }[ev.key];
    if (step === undefined) return;
    ev.preventDefault();
    showAt(cur + step);
  });
  return w;
}

/* 지표별 품질 점수 — 규칙이 하나도 없는 지표는 줄을 만들지 않는다 */
function qMetricCard(all) {
  const c = qCard('지표별 품질 점수', '기준 충족 대상 비율');
  const b = $('.wc-card__body', c);
  b.className = 'wc-card__body q-stack14';
  let drawn = 0;
  QMETRICS_DIM.forEach(m => {
    const mine = all.filter(t => QMETRIC[t.type] === m);
    if (!mine.length) return;
    drawn++;
    const s = qScore(mine);
    const v = s.score == null ? 0 : s.score;
    const row = el(`<div class="q-meterrow" style="cursor:pointer">
      <div class="q-meterhead"><span class="w-sm">${esc(m)}</span>
        <span class="w-sm w-num" style="font-weight:590;color:${qscT(s.score)}">${qpct(s.score)}</span></div>
      <div style="display:flex">${qMeter(v, qsc(s.score))}</div></div>`);
    row.title = `적용 대상 ${s.n}개 중 통과 ${Math.round(v / 100 * s.n)}개`;
    row.onclick = () => { S.qView = 'rules'; S.qMetric = m; S.qPage = 1; render(); };
    b.appendChild(row);
  });
  if (!drawn) b.appendChild(el(`<div class="empty" style="padding:24px">${ic('info')}
    <span class="empty-t">등록된 검증 규칙이 없습니다.</span></div>`));
  return c;
}

/* 데이터 모델별 통과율 — 낮은 것부터 */
function qModelCard(all) {
  const stats = [...new Set(all.map(t => t.model))]
    .map(id => ({ id, d: byId(id), s: qScore(all.filter(t => t.model === id)) }))
    .filter(x => x.d && x.s.n > 0)
    .sort((a, b) => a.s.score - b.s.score);
  const c = qCard('데이터 모델별 통과율', `규칙 적용 모델 ${stats.length}개 · 하위 ${Math.min(6, stats.length)}개`);
  const b = $('.wc-card__body', c);
  b.className = 'wc-card__body q-stack12';
  if (!stats.length) {
    b.appendChild(el(`<div class="empty" style="padding:24px">${ic('info')}
      <span class="empty-t">아직 실행된 검사가 없습니다.</span></div>`));
    return c;
  }
  stats.slice(0, 6).forEach(x => {
    const v = x.s.score;
    const row = el(`<div class="q-modelrow" style="cursor:pointer" title="${esc(x.d.phys || x.d.name)}">
      <span class="w-caption q-modelname">${esc(x.d.name)}</span>
      <div style="display:flex;flex:1">${qMeter(v, qsc(v), 8)}</div>
      <span class="w-sm w-num q-modelscore" style="color:${qscT(v)}">${qpct(v)}</span></div>`);
    row.onclick = () => { S.qView = 'rules'; S.qModel = x.id; S.qPage = 1; render(); };
    b.appendChild(row);
  });
  b.appendChild(el(`<div class="q-footrow"><span class="w-caption">기준 미달 모델 (90% 미만)</span>
    <span class="w-sm w-num" style="color:var(--w-danger);font-weight:590">${stats.filter(x => x.s.score < 90).length}개</span></div>`));
  return c;
}

/* 실패 상위 규칙 */
function qTopFailCard(gs) {
  const right = el('<div></div>');
  right.appendChild(qBtn('전체 보기', 'text', () => { S.qView = 'rules'; S.qStatus = '전체'; S.qPage = 1; render(); }, { size: 'sm' }));
  const c = qCard('실패 상위 규칙', '오류 행 기준 · 상위 6건', right);
  const b = $('.wc-card__body', c);
  b.className = 'wc-card__body wc-card__body--flush';
  const t = qTable([
    { label: '규칙' }, { label: '지표', w: 80 }, { label: '검증 유형', w: 96 },
    { label: '적용 대상', w: 80, num: true }, { label: '오류 행', w: 88, num: true },
    { label: '상태', w: 88 },
  ], 'compact', true);
  t.classList.add('q-flushtable');
  const bad = gs.filter(g => g.errRows > 0).sort((a, b2) => b2.errRows - a.errRows).slice(0, 6);
  bad.forEach(g => {
    const tr = el(`<tr style="cursor:pointer"><td>${esc(g.name)}</td>
      <td class="w-text-2">${esc(g.metric)}</td><td class="w-text-2">${esc(g.kind)}</td>
      <td class="wc-table__num">${g.targets.length}</td>
      <td class="wc-table__num" style="font-weight:590;color:var(--w-danger)">${qn(g.errRows)}</td>
      <td>${qBadgeHtml(g.status)}</td></tr>`);
    tr.onclick = () => { S.qSel = g.rid; S.qView = 'detail'; S.qDTab = '적용 대상'; render(); };
    qBody(t).appendChild(tr);
  });
  if (!bad.length) qEmpty(t, gs.length ? '오류 행이 검출된 규칙이 없습니다.' : '등록된 검증 규칙이 없습니다.');
  b.appendChild(t);
  return c;
}

/* ============================================================
   6. 품질 리포트
   ============================================================ */
function qReportView(main) {
  qLoad();
  const all = QRULES;
  const stats = [...new Set(all.map(t => t.model))]
    .map(id => ({ id, d: byId(id), s: qScore(all.filter(t => t.model === id)) }))
    .filter(x => x.d && x.s.n > 0)
    .sort((a, b) => a.s.score - b.s.score);
  /* 규칙이 하나도 없는 지표는 열을 만들지 않는다 — 전부 «—» 인 열이 남는다 */
  const metrics = QMETRICS.filter(m => all.some(t => QMETRIC[t.type] === m));

  const body = qHead(main, {
    title: '품질 리포트',
    sub: `${esc(S.qPeriod)} 기준 · 지표 ${metrics.length}종 · 규칙 적용 모델 ${stats.length}개`,
    actions: [qPeriodTabs(), qBtn('CSV 내려받기', 'secondary', qExport, { icon: 'down' })],
  });

  /* ── 모델 × 지표 매트릭스 ── */
  const c1 = qCard('데이터 모델별 지표 품질 점수', '셀을 누르면 해당 조건의 검증 규칙으로 이동합니다.');
  const b1 = $('.wc-card__body', c1);
  b1.className = 'wc-card__body wc-card__body--flush';
  const t1 = qTable([{ label: '데이터 모델', w: 200 }]
    .concat(metrics.map(m => ({ label: m, num: true })))
    .concat([{ label: '종합', w: 92, num: true }]), 'compact', true);
  t1.classList.add('q-flushtable');
  stats.forEach(x => {
    const tr = el(`<tr><td style="font-weight:510" title="${esc(x.d.phys || '')}">${esc(x.d.name)}</td></tr>`);
    metrics.forEach(m => {
      const s = qScore(all.filter(t => t.model === x.id && QMETRIC[t.type] === m));
      if (!s.n) { tr.appendChild(el('<td class="wc-table__num" style="color:var(--w-text-3)">—</td>')); return; }
      const td = el(`<td class="wc-table__num" style="cursor:pointer;color:${qscT(s.score)}">${qpct(s.score)}</td>`);
      td.onclick = () => { S.qView = 'rules'; S.qModel = x.id; S.qMetric = m; S.qPage = 1; render(); };
      tr.appendChild(td);
    });
    tr.appendChild(el(`<td class="wc-table__num" style="font-weight:590;color:${qscT(x.s.score)}">${qpct(x.s.score)}</td>`));
    qBody(t1).appendChild(tr);
  });
  if (!stats.length) qEmpty(t1, '아직 실행된 검사가 없습니다.');
  b1.appendChild(t1);
  body.appendChild(c1);

  /* ── 검증 유형별 오류 행 구성 + 개선 추이 ── */
  const r = el('<div class="q-grid11"></div>');
  r.appendChild(qMixCard(all));
  const c3 = qCard('개선 추이', '월별 신규 오류 행과 조치 완료');
  $('.wc-card__body', c3).appendChild(el(qSoon(
    '조치 이력이 아직 서버에 없습니다 — 오류 행을 «조치 완료» 로 기록하는 자리가 생기면 여기서 월별 추이를 그립니다.')));
  r.appendChild(c3);
  body.appendChild(r);
}

/* 검증 유형별 오류 행 구성 */
function qMixCard(all) {
  const kinds = Object.keys(QTYPES)
    .map(k => ({ k, label: QTYPES[k].label,
                 n: all.filter(t => t.type === k && t.active).reduce((s, t) => s + (t.cnt || 0), 0) }))
    .filter(x => x.n > 0)
    .sort((a, b) => b.n - a.n);
  const total = kinds.reduce((s, x) => s + x.n, 0);
  const c = qCard('검증 유형별 오류 행 구성', `전체 오류 행 ${qn(total)}건 기준`);
  const b = $('.wc-card__body', c);
  b.className = 'wc-card__body q-stack14';
  if (!total) {
    b.appendChild(el(`<div class="empty" style="padding:24px">${ic('checkc')}
      <span class="empty-t">검출된 오류 행이 없습니다.</span></div>`));
    return c;
  }
  const color = (i) => `var(--w-chart-${(i % 12) + 1})`;
  b.appendChild(el(`<div class="q-mixbar">${kinds.map((x, i) =>
    `<div style="background:${color(i)};width:${x.n / total * 100}%" title="${esc(x.label)} ${qn(x.n)}건"></div>`).join('')}</div>`));
  const list = el('<div class="q-stack10"></div>');
  kinds.forEach((x, i) => {
    const row = el(`<div class="q-mixrow" style="cursor:pointer">
      <span class="q-dot" style="background:${color(i)}"></span>
      <span class="w-sm" style="flex:1">${esc(x.label)}</span>
      <span class="w-sm w-num w-text-2">${qn(x.n)}</span>
      <span class="w-sm w-num w-text-3 q-mixpct">${qpct(x.n / total * 100)}</span></div>`);
    row.onclick = () => { S.qView = 'rules'; S.qMetric = QMETRIC[x.k]; S.qPage = 1; render(); };
    list.appendChild(row);
  });
  b.appendChild(list);
  return c;
}

/* ============================================================
   7. 검증 규칙 목록
   ============================================================ */
const QPER = 10;

function qRulesView(main) {
  qLoad();                                 // 최근 실행 열이 /history/tests 를 쓴다
  const gs = qGroups();
  const body = qHead(main, {
    title: '검증 규칙',
    sub: `전체 ${gs.length}건 · 사용중 ${gs.filter(g => g.active).length}건 · dbt 테스트 ${QRULES.length}개`,
    actions: [
      qBtn('CSV 내려받기', 'secondary', qExport, { icon: 'down' }),
      R().canModel ? qBtn('규칙 등록', 'primary', () => qFormOpen(null), { icon: 'plus' }) : null,
    ],
  });

  /* ── 필터 ── */
  const models = [...new Set(QRULES.map(t => t.model))].filter(m => byId(m))
    .sort((a, b) => byId(a).name.localeCompare(byId(b).name, 'ko'));
  const f = el(`<div class="wc-card"><div class="wc-card__body q-stack12">
    <div class="q-filters">
      <div class="wc-field"><label class="wc-field__label">검색어</label>
        <div class="wc-input wc-input--md"><span class="wc-input__affix">${ic14('search')}</span>
          <input class="wc-input__el" id="qfQ" placeholder="규칙 · 대상 컬럼 · 조건" value="${esc(S.qQuery)}"></div></div>
      <div class="wc-field"><label class="wc-field__label">데이터 모델</label>
        <div class="wc-input wc-input--md wc-select"><select class="wc-select__el" id="qfM">
          <option value="전체">전체</option>
          ${models.map(m => `<option value="${esc(m)}" ${S.qModel === m ? 'selected' : ''}>${esc(byId(m).name)}</option>`).join('')}
        </select><span class="wc-select__caret">${qic('chevd', 14)}</span></div></div>
      <div class="wc-field"><label class="wc-field__label">품질지표</label>
        <div class="wc-input wc-input--md wc-select"><select class="wc-select__el" id="qfK">
          ${['전체'].concat(QMETRICS).map(x => `<option ${S.qMetric === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}
        </select><span class="wc-select__caret">${qic('chevd', 14)}</span></div></div>
      <div class="wc-field"><label class="wc-field__label">실행 상태</label>
        <div class="wc-input wc-input--md wc-select"><select class="wc-select__el" id="qfS">
          ${['전체', '통과', '경고', '실패', '미실행', '비활성'].map(x => `<option ${S.qStatus === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}
        </select><span class="wc-select__caret">${qic('chevd', 14)}</span></div></div>
    </div>
    <div class="q-chiprow"><div class="q-chips"></div><div class="q-acts" id="qfAct"></div></div>
  </div></div>`);
  body.appendChild(f);

  const chips = $('.q-chips', f);
  const chip = (label, clear) => {
    const c = el(`<span class="wc-tag" style="background:var(--pri-soft);color:var(--w-accent)">${esc(label)}
      <button type="button" class="wc-tag__x">${qic('x', 12, 2.6)}</button></span>`);
    $('.wc-tag__x', c).onclick = clear;
    chips.appendChild(c);
  };
  if (S.qQuery) chip(S.qQuery, () => { S.qQuery = ''; S.qPage = 1; render(); });
  if (S.qModel !== '전체') chip((byId(S.qModel) || {}).name || S.qModel, () => { S.qModel = '전체'; S.qPage = 1; render(); });
  if (S.qMetric !== '전체') chip(S.qMetric, () => { S.qMetric = '전체'; S.qPage = 1; render(); });
  if (S.qStatus !== '전체') chip(S.qStatus, () => { S.qStatus = '전체'; S.qPage = 1; render(); });
  if (!chips.children.length) chips.appendChild(el('<span class="w-caption">조건을 지정하지 않으면 전체를 보여줍니다.</span>'));
  $('#qfAct', f).appendChild(qBtn('초기화', 'ghost', () => {
    S.qQuery = ''; S.qModel = '전체'; S.qMetric = '전체'; S.qStatus = '전체'; S.qPage = 1; render();
  }));

  const qq = $('#qfQ', f);
  qq.oninput = (e) => { S.qQuery = e.target.value; };
  qq.onchange = () => { S.qPage = 1; render(); };
  qq.onkeydown = (e) => { if (e.key === 'Enter') { S.qPage = 1; render(); } };
  $('#qfM', f).onchange = (e) => { S.qModel = e.target.value; S.qPage = 1; render(); };
  $('#qfK', f).onchange = (e) => { S.qMetric = e.target.value; S.qPage = 1; render(); };
  $('#qfS', f).onchange = (e) => { S.qStatus = e.target.value; S.qPage = 1; render(); };

  /* ── 걸러내기 ── */
  const needle = S.qQuery.trim().toLowerCase();
  const list = gs.filter(g => {
    if (S.qModel !== '전체' && !g.models.includes(S.qModel)) return false;
    if (S.qMetric !== '전체' && g.metric !== S.qMetric) return false;
    if (S.qStatus !== '전체' && g.status !== S.qStatus) return false;
    if (!needle) return true;
    const hay = g.rid + ' ' + g.name + ' ' + g.cond + ' ' + g.kind + ' '
      + g.targets.map(t => t.col + ' ' + ((byId(t.model) || {}).name || t.model)).join(' ');
    return hay.toLowerCase().includes(needle);
  });
  const pages = Math.max(1, Math.ceil(list.length / QPER));
  const page = Math.min(S.qPage, pages);
  const rows = list.slice((page - 1) * QPER, page * QPER);
  const picked = Object.keys(S.qPick).filter(k => S.qPick[k] && list.some(g => g.rid === k));

  /* ── 조회 건수 + 일괄 작업 ── */
  const bar = el(`<div class="q-listbar">
    <div class="q-listcount"><span class="w-sm w-text-2">조회 <b class="w-num">${list.length}</b>건</span>
      <span class="w-sm w-text-3">·</span>
      <span class="w-sm w-text-2">선택 <b class="w-num">${picked.length}</b>건</span></div>
    <div class="q-acts" id="qBulk"></div></div>`);
  const bulk = $('#qBulk', bar);
  bulk.appendChild(qBtn('즉시 검증', 'secondary', () => qRunGroups(picked.map(qGroupOf).filter(Boolean)),
    { size: 'sm', off: !picked.length, icon: 'rot' }));
  bulk.appendChild(qBtn('사용중지', 'secondary', () => qSuspend(picked.map(qGroupOf).filter(Boolean)),
    { size: 'sm', off: !picked.length || !R().canModel }));
  body.appendChild(bar);

  /* ── 표 ── */
  const t = qTable([
    { label: '', check: true }, { label: '규칙ID', w: 84 }, { label: '규칙' },
    { label: '검증 유형', w: 120 }, { label: '지표', w: 88 }, { label: '심각도', w: 72 },
    { label: '적용 대상', w: 76, num: true }, { label: '실행 시점', w: 96 },
    { label: '최근 실행', w: 176 }, { label: '오류 행', w: 80, num: true }, { label: '상태', w: 88 },
  ], 'comfortable', true);
  const allOn = rows.length > 0 && rows.every(g => S.qPick[g.rid]);
  $('thead .wc-table__check', t).appendChild(qCheck(allOn, () => {
    rows.forEach(g => { S.qPick[g.rid] = !allOn; }); render();
  }));

  rows.forEach(g => {
    const on = !!S.qPick[g.rid];
    const tr = el(`<tr class="${on ? 'is-selected' : ''}">
      <td class="wc-table__check"></td>
      <td class="w-num w-text-2">${esc(g.rid)}</td>
      <td><div class="q-rulename"><a title="${esc(g.name)}">${esc(g.name)}</a></div>
        <div class="q-ruledesc mono" title="${esc(g.cond)}">${esc(g.cond)}</div></td>
      <td class="w-text-2" title="${esc(g.kind)}">${esc(g.kind)}</td>
      <td title="${esc(g.metric)}">${esc(g.metric)}</td>
      <td><span class="wc-badge" style="background:${g.sev === 'error' ? 'var(--err-soft)' : 'var(--warn-soft)'};color:${g.sev === 'error' ? 'var(--w-danger)' : 'var(--w-warning)'}">${g.sev === 'error' ? '오류' : '경고'}</span></td>
      <td class="wc-table__num">${g.targets.length}개</td>
      <td class="w-text-2">${esc(qCycleOf(g))}</td>
      <td class="w-num w-text-2">${esc(qLastRunOf(g))}</td>
      <td class="wc-table__num" style="font-weight:590;color:${g.errRows ? 'var(--w-danger)' : 'var(--w-text-2)'}">${g.status === '비활성' ? '—' : qn(g.errRows)}</td>
      <td>${qBadgeHtml(g.status)}</td></tr>`);
    $('.wc-table__check', tr).appendChild(qCheck(on, () => { S.qPick[g.rid] = !on; render(); }));
    const open = () => { S.qSel = g.rid; S.qView = 'detail'; S.qDTab = '적용 대상'; render(); };
    $('.q-rulename a', tr).onclick = (ev) => { ev.stopPropagation(); open(); };
    tr.style.cursor = 'pointer';
    tr.onclick = (ev) => { if (ev.target.closest('.wc-check')) return; open(); };
    qBody(t).appendChild(tr);
  });
  if (!list.length) qEmpty(t, gs.length ? '조건에 맞는 규칙이 없습니다.' : '등록된 검증 규칙이 없습니다.');
  body.appendChild(t);

  /* ── 페이지 ── */
  if (list.length) {
    const pg = el(`<div class="q-pagerow">
      <span class="wc-page__info">${list.length}건 중 ${(page - 1) * QPER + 1} – ${Math.min(page * QPER, list.length)}</span>
      <div class="wc-page"></div></div>`);
    const nav = $('.wc-page', pg);
    const btn = (html, to, cls) => {
      const b = el(`<button type="button" class="wc-page__btn ${cls || ''}">${html}</button>`);
      if (to) b.onclick = () => { S.qPage = to; render(); }; else b.disabled = true;
      nav.appendChild(b);
    };
    btn(qic('chevl', 16), page > 1 ? page - 1 : 0);
    for (let i = 1; i <= pages; i++) btn(String(i), i, page === i ? 'is-active' : '');
    btn(qic('chev', 16), page < pages ? page + 1 : 0);
    body.appendChild(pg);
  }
}

/* 실행 시점 — dbt 테스트는 그 모델을 만드는 파이프라인에 붙어 돌아간다.
   그러므로 «실행 시점» 은 규칙 설정이 아니라 파이프라인의 실행 주기다. */
function qCycleOf(g) {
  const fq = [...new Set(g.targets.map(t => (PIPES.find(p => p.id === t.pipe) || {}).freq).filter(Boolean))];
  if (!fq.length) return '파이프라인 미연결';
  return fq.length === 1 ? fq[0] : `파이프라인 ${g.targets.length}개`;
}

/* 최근 실행 — /history/tests 의 lastRunAt. 이력을 못 읽으면 규칙의 실행 여부만 말한다. */
function qLastRunOf(g) {
  const at = g.targets.map(t => (qHist(t.id) || {}).lastRunAt).filter(Boolean).sort();
  if (at.length) return fmtDT(at[at.length - 1]);
  return g.targets.every(t => t.__notRun) ? '실행 전' : '—';
}

/* ============================================================
   8. 규칙 상세
   ============================================================ */
function qDetailView(main) {
  qLoad();
  const g = qCurrent();
  if (!g) { qRulesView(main); return; }
  S.qSel = g.rid;

  const runs = g.targets.reduce((s, t) => s + ((qHist(t.id) || {}).runs || 0), 0);
  const body = qHead(main, {
    crumbs: [{ label: '검증관리', go: () => { S.qView = 'rules'; render(); } },
             { label: '검증 규칙', go: () => { S.qView = 'rules'; render(); } },
             { label: g.rid }],
    title: g.name,
    badge: qBadgeHtml(g.status),
    sub: `${esc(g.rid)} · ${esc(g.kind)} · ${esc(g.metric)} · 심각도 ${g.sev === 'error' ? '오류' : '경고'} · ${esc(qCycleOf(g))}`,
    actions: [
      qBtn('즉시 검증', 'secondary', () => qRunGroups([g]), { icon: 'rot' }),
      R().canModel ? qBtn('대상 추가', 'primary', () => qFormOpen(g), { icon: 'plus' }) : null,
    ],
  });

  const kp = el('<div class="q-grid4"></div>');
  kp.appendChild(qKpi('적용 대상', qn(g.targets.length), `모델 ${g.models.length}개`));
  kp.appendChild(qKpi('오류 행', g.status === '비활성' ? '—' : qn(g.errRows),
    g.sev === 'error' ? '오류 급 — 적재를 멈춥니다' : '경고 급 — 기록만 남깁니다',
    { tone: g.errRows ? 'var(--w-danger)' : null }));
  kp.appendChild(qKpi('실패 대상', qn(g.failTargets), `전체 ${g.targets.length}개 중`,
    { tone: g.failTargets ? 'var(--w-danger)' : null }));
  kp.appendChild(qKpi(`${S.qPeriod} 검사`, QUAL.tests ? qn(runs) : '—',
    QUAL.tests ? `통과율 ${qpct(g.score.score)}` : '검사 이력을 읽을 수 없습니다'));
  body.appendChild(kp);

  const tabs = el('<div class="wc-tabs wc-tabs--underline"></div>');
  [['적용 대상', String(g.targets.length)], ['실행 이력', ''], ['규칙 정보', '']].forEach(([label, n]) => {
    const b = el(`<button type="button" class="wc-tab ${S.qDTab === label ? 'is-active' : ''}">${label}
      ${n ? `<span class="wc-tab__badge">${n}</span>` : ''}</button>`);
    b.onclick = () => { S.qDTab = label; render(); };
    tabs.appendChild(b);
  });
  body.appendChild(tabs);

  if (S.qDTab === '실행 이력') qDetailHistory(body, g);
  else if (S.qDTab === '규칙 정보') qDetailInfo(body, g);
  else qDetailTargets(body, g);
}

/* 적용 대상 — dbt 테스트 하나가 한 줄이다. 사용 여부·삭제는 여기서만 개별로 다룬다. */
function qDetailTargets(body, g) {
  const t = qTable([
    { label: '데이터 모델', w: 192 }, { label: '대상 컬럼', w: 170 },
    { label: '검사 이름' }, { label: '오류 행', w: 88, num: true },
    { label: '최근 실행', w: 176 }, { label: '상태', w: 88 },
    { label: '사용', w: 60 }, { label: '', w: 68 },
  ], 'default', true);
  g.targets.forEach(tg => {
    const d = byId(tg.model) || { name: tg.model };
    const st = qTgtStatus(tg);
    const h = qHist(tg.id) || {};
    const tr = el(`<tr>
      <td><a class="q-tgtmodel" title="${esc(d.phys || '')}">${esc(d.name)}</a></td>
      <td>${esc(tg.col || '(모델 전체)')}</td>
      <td class="w-text-2 mono" title="${esc(tg.id)}">${esc(tg.id)}</td>
      <td class="wc-table__num" style="font-weight:590;color:${tg.cnt ? 'var(--w-danger)' : 'var(--w-text-2)'}">${st === '비활성' ? '—' : qn(tg.cnt)}</td>
      <td class="w-num w-text-2">${esc(h.lastRunAt ? fmtDT(h.lastRunAt) : (tg.__notRun ? '실행 전' : '—'))}</td>
      <td>${qBadgeHtml(st)}</td>
      <td><span class="wc-toggle wc-toggle--sm ${tg.active ? 'wc-toggle--on' : ''}" data-tg="${esc(tg.id)}"
        title="${tg.active ? '사용 중 — 눌러 사용중지' : '사용중지 — 눌러 사용'}">
        <span class="wc-toggle__track"><span class="wc-toggle__knob"></span></span></span></td>
      <td></td></tr>`);
    /* 데이터 모델 이름 → 그 모델의 품질 규칙 탭 */
    $('.q-tgtmodel', tr).onclick = (ev) => {
      ev.stopPropagation();
      S.sel = tg.model; S.mTab = '품질 규칙'; S.mPanelOpen = true; go('modeling', tg.model);
    };
    /* 오류 행 화면 */
    tr.style.cursor = 'pointer';
    tr.onclick = (ev) => {
      if (ev.target.closest('[data-tg]') || ev.target.closest('a') || ev.target.closest('button')) return;
      S.qTgt = tg.id; S.qView = 'errors'; S.qErrQ = ''; render();
    };
    if (R().canModel) {
      const del = qBtn('삭제', 'text', (ev) => { ev.stopPropagation(); qDeleteTarget(tg); }, { size: 'sm' });
      $('td:last-child', tr).appendChild(del);
    }
    qBody(t).appendChild(tr);
  });
  if (!g.targets.length) qEmpty(t, '적용 대상이 없습니다.');
  body.appendChild(t);
  setTimeout(() => wireToggles(body), 0);
}

/* 실행 이력 — 적용 대상별 실행을 한 줄기로 합쳐 최근 것부터 */
function qDetailHistory(body, g) {
  const days = QDAYS[S.qPeriod] || 30;
  const key = g.rid + '@' + days;
  if (!QUAL.hist[key] && !QUAL.histLoading[key]) {
    QUAL.histLoading[key] = true;
    Promise.all(g.targets.map(t =>
      api(`/history/tests/${enc(t.id)}?days=${days}&limit=200`)
        .then(r => (r.items || []).map(x => Object.assign({ __t: t }, x)))
        .catch(() => [])))
      .then(all => { QUAL.hist[key] = [].concat(...all).sort((a, b) => String(b.ranAt).localeCompare(String(a.ranAt))); })
      .finally(() => { QUAL.histLoading[key] = false; if (S.page === 'quality') render(); });
  }
  const items = QUAL.hist[key];
  if (!items) {
    body.appendChild(el(`<div class="wc-card"><div class="wc-card__body">
      <div class="empty" style="padding:34px">${ic('clock')}<span>실행 이력을 불러오는 중…</span></div></div></div>`));
    return;
  }
  const t = qTable([
    { label: '실행일시', w: 176 }, { label: '대상', w: 260 }, { label: '검사 이름' },
    { label: '오류 행', w: 88, num: true }, { label: '심각도', w: 76 }, { label: '상태', w: 88 },
  ], 'compact', true);
  items.forEach(x => {
    const d = byId(x.__t.model) || { name: x.__t.model };
    const st = String(x.status || '').toLowerCase();
    const label = st === 'pass' ? '통과' : st === 'warn' ? '경고' : (st === 'fail' || st === 'error') ? '실패' : '미실행';
    qBody(t).appendChild(el(`<tr>
      <td class="w-num w-text-2">${esc(fmtDT(x.ranAt))}</td>
      <td>${esc(d.name)}<span class="w-text-3"> · ${esc(x.__t.col || '(모델 전체)')}</span></td>
      <td class="w-text-2 mono">${esc(x.__t.id)}</td>
      <td class="wc-table__num" style="font-weight:590;color:${x.failures ? 'var(--w-danger)' : 'var(--w-text-2)'}">${qn(x.failures || 0)}</td>
      <td class="w-text-2">${esc(String(x.severity || '').toLowerCase() === 'warn' ? '경고' : '오류')}</td>
      <td>${qBadgeHtml(label)}</td></tr>`));
  });
  if (!items.length) qEmpty(t, `${S.qPeriod} 안에 이 규칙의 실행 기록이 없습니다.`);
  body.appendChild(t);
}

/* 규칙 정보 */
function qDetailInfo(body, g) {
  const a = qArgs(g.cond);
  const argText = Object.keys(a).length
    ? Object.keys(a).map(k => `${k} = ${a[k]}`).join('   ')
    : '(인자 없음)';
  const c = el(`<div class="wc-card"><div class="wc-card__body">
    <div class="wc-form q-form3">
      <div class="wc-field wc-field--readonly"><label class="wc-field__label">규칙ID</label>
        <div class="wc-input wc-input--md"><input class="wc-input__el w-num" value="${esc(g.rid)}" readonly></div>
        <span class="wc-field__msg">dbt 에는 묶음 개념이 없어 조건에서 만든 값입니다.</span></div>
      <div class="wc-field wc-field--readonly"><label class="wc-field__label">검증 유형</label>
        <div class="wc-input wc-input--md"><input class="wc-input__el" value="${esc(g.kind)}" readonly></div></div>
      <div class="wc-field wc-field--readonly"><label class="wc-field__label">품질지표</label>
        <div class="wc-input wc-input--md"><input class="wc-input__el" value="${esc(g.metric)}" readonly></div></div>
      <div class="wc-field wc-field--readonly"><label class="wc-field__label">심각도</label>
        <div class="wc-input wc-input--md"><input class="wc-input__el" value="${g.sev === 'error' ? '오류 — 적재를 멈춥니다' : '경고 — 기록만 남깁니다'}" readonly></div></div>
      <div class="wc-field wc-field--readonly"><label class="wc-field__label">적용 대상</label>
        <div class="wc-input wc-input--md"><input class="wc-input__el" value="${g.targets.length}개 · 모델 ${g.models.length}개" readonly></div></div>
      <div class="wc-field wc-field--readonly"><label class="wc-field__label">실행 시점</label>
        <div class="wc-input wc-input--md"><input class="wc-input__el" value="${esc(qCycleOf(g))}" readonly></div>
        <span class="wc-field__msg">dbt 테스트는 그 모델을 만드는 파이프라인에 붙어 돌아갑니다.</span></div>
      <div class="wc-field wc-form__full wc-field--readonly"><label class="wc-field__label">검증 조건</label>
        <div class="wc-input wc-input--md"><input class="wc-input__el mono" value="${esc(g.cond)}" readonly></div>
        <span class="wc-field__msg">${esc(argText)}</span></div>
    </div></div></div>`);
  body.appendChild(c);
  const note = el('<div class="wc-card"><div class="wc-card__body"></div></div>');
  $('.wc-card__body', note).appendChild(el(qSoon(
    '판정 기준 건수 · 알림 · 오류 행 보관(store_failures) 은 아직 화면에서 설정할 수 없습니다 — '
    + 'dbt 테스트의 심각도와 사용 여부만 서버가 쓰고 읽습니다.')));
  body.appendChild(note);
}

/* ============================================================
   9. 검증 결과
   ============================================================ */
function qRunsView(main) {
  qLoad();
  const gs = qGroups();
  /* 한 줄 = 적용 대상 하나의 최근 실행 */
  const all = [];
  gs.forEach(g => g.targets.forEach(t => all.push({ g, t, st: qTgtStatus(t), h: qHist(t.id) || {} })));

  const body = qHead(main, {
    title: '검증 결과',
    sub: `${esc(nowLabel())} 기준 · 적용 대상 ${all.length}개 · `
      + `실패 ${all.filter(x => x.st === '실패').length}건 · 경고 ${all.filter(x => x.st === '경고').length}건`,
    actions: [qBtn('CSV 내려받기', 'secondary', qExport, { icon: 'down' })],
  });

  const bar = el('<div class="q-listbar"><div class="wc-tabs wc-tabs--segment"></div><div id="qrc"></div></div>');
  const tabs = $('.wc-tabs', bar);
  ['전체', '실패', '경고', '통과', '미실행', '비활성'].forEach(x => {
    const n = x === '전체' ? all.length : all.filter(y => y.st === x).length;
    const b = el(`<button type="button" class="wc-tab ${S.qResTab === x ? 'is-active' : ''}">${x}
      <span class="wc-tab__badge">${n}</span></button>`);
    b.onclick = () => { S.qResTab = x; render(); };
    tabs.appendChild(b);
  });
  const rows = all.filter(x => S.qResTab === '전체' || x.st === S.qResTab);
  $('#qrc', bar).appendChild(el(`<span class="w-sm w-text-2">조회 <b class="w-num">${rows.length}</b>건</span>`));
  body.appendChild(bar);

  const t = qTable([
    { label: '규칙ID', w: 80 }, { label: '규칙', w: 220 }, { label: '대상' },
    { label: '검증 유형', w: 100 }, { label: '최근 실행', w: 168 },
    { label: `${S.qPeriod} 통과율`, w: 100, num: true },
    { label: '오류 행', w: 80, num: true }, { label: '상태', w: 88 },
  ], 'compact', true);
  rows.forEach(x => {
    const d = byId(x.t.model) || { name: x.t.model };
    const tr = el(`<tr style="cursor:pointer">
      <td class="w-num w-text-2">${esc(x.g.rid)}</td>
      <td style="color:var(--w-accent)">${esc(x.g.name)}</td>
      <td class="w-text-2">${esc(d.name)} · ${esc(x.t.col || '(모델 전체)')}</td>
      <td class="w-text-2">${esc(x.g.kind)}</td>
      <td class="w-num w-text-2">${esc(x.h.lastRunAt ? fmtDT(x.h.lastRunAt) : (x.t.__notRun ? '실행 전' : '—'))}</td>
      <td class="wc-table__num" style="color:${qscT(x.h.passRate)}">${x.h.passRate == null ? '—' : qpct(x.h.passRate)}</td>
      <td class="wc-table__num" style="font-weight:590;color:${x.t.cnt ? 'var(--w-danger)' : 'var(--w-text-2)'}">${x.st === '비활성' ? '—' : qn(x.t.cnt)}</td>
      <td>${qBadgeHtml(x.st)}</td></tr>`);
    tr.onclick = () => { S.qSel = x.g.rid; S.qTgt = x.t.id; S.qView = 'errors'; S.qErrQ = ''; render(); };
    qBody(t).appendChild(tr);
  });
  if (!rows.length) qEmpty(t, all.length ? '조건에 맞는 결과가 없습니다.' : '등록된 검증 규칙이 없습니다.');
  body.appendChild(t);
}

/* ============================================================
   10. 오류 행
   ============================================================
   실제 위반 행은 dbt 의 store_failures 가 켜진 검사만 남는다. 꺼져 있으면 서버가
   그 사실을 문장으로 내려주므로(routers/quality.violation_rows) 그대로 보여준다 —
   빈 표를 그리면 «위반이 없다» 로 읽힌다. */
function qErrorsView(main) {
  qLoad();
  const g = qCurrent();
  const tg = g && (g.targets.find(t => t.id === S.qTgt) || g.targets[0]);
  if (!g || !tg) { qRunsView(main); return; }
  S.qSel = g.rid; S.qTgt = tg.id;
  const d = byId(tg.model) || { name: tg.model };
  const st = qTgtStatus(tg);
  const h = qHist(tg.id) || {};

  const body = qHead(main, {
    crumbs: [{ label: '검증 규칙', go: () => { S.qView = 'rules'; render(); } },
             { label: g.rid, go: () => { S.qView = 'detail'; S.qDTab = '적용 대상'; render(); } },
             { label: `${d.name} · ${tg.col || '(모델 전체)'}` }],
    title: `${d.name} · ${tg.col || '(모델 전체)'}`,
    badge: qBadgeHtml(st),
    sub: `${esc(g.rid)} ${esc(g.name)} · ${esc(g.kind)} · ${esc(g.metric)}`
      + (h.lastRunAt ? ` · 실행 ${esc(fmtDT(h.lastRunAt))}` : ''),
    actions: [
      qBtn('재실행', 'secondary', () => qRunGroups([{ name: g.name, targets: [tg] }]), { icon: 'rot' }),
      qBtn('CSV 내려받기', 'primary', qExport, { icon: 'down' }),
    ],
  });

  const kp = el('<div class="q-grid4"></div>');
  kp.appendChild(qKpi('오류 행', st === '비활성' ? '—' : qn(tg.cnt), '최근 실행 기준',
    { tone: tg.cnt ? 'var(--w-danger)' : null }));
  kp.appendChild(qKpi(`${S.qPeriod} 검사`, h.runs == null ? '—' : qn(h.runs),
    h.runs == null ? '검사 이력을 읽을 수 없습니다' : `실패 ${h.fails || 0} · 경고 ${h.warns || 0}`));
  kp.appendChild(qKpi(`${S.qPeriod} 통과율`, h.passRate == null ? '—' : qpct(h.passRate),
    h.lastIssueAt ? `마지막 문제 ${fmtDT(h.lastIssueAt)}` : '기간 내 문제 없음',
    { tone: qscT(h.passRate) }));
  const soon = el('<div class="wc-card"><div class="wc-card__body q-kpi"></div></div>');
  $('.wc-card__body', soon).appendChild(el(`<div class="w-caption">조치 현황</div>`));
  $('.wc-card__body', soon).appendChild(el(qSoon('오류 행을 조치완료·예외승인으로 기록하는 자리가 아직 서버에 없습니다.')));
  kp.appendChild(soon);
  body.appendChild(kp);

  /* ── 검색 · 조치 도구 ── */
  const bar = el(`<div class="q-listbar">
    <div class="wc-input wc-input--sm" style="width:260px"><span class="wc-input__affix">${ic14('search')}</span>
      <input class="wc-input__el" id="qeQ" placeholder="행 안의 값 검색" value="${esc(S.qErrQ)}"></div>
    <div id="qeSoon" style="min-width:0"></div></div>`);
  $('#qeSoon', bar).appendChild(el(qSoon('조치완료 · 예외 승인 처리는 준비 중입니다.')));
  body.appendChild(bar);

  /* ── 위반 행 ── */
  const key = tg.id;
  if (QUAL.rows[key] === undefined && QUAL.rowsErr[key] === undefined) {
    QUAL.rows[key] = null;
    api(`/quality/violations/${enc(tg.id)}/rows?limit=200`)
      .then(r => { QUAL.rows[key] = r; })
      .catch(e => { QUAL.rowsErr[key] = e.message || '위반 행을 불러오지 못했습니다.'; })
      .finally(() => { if (S.page === 'quality') render(); });
  }
  const res = QUAL.rows[key];
  if (QUAL.rowsErr[key]) {
    body.appendChild(el(`<div class="note err">${ic('xc')}<span>${esc(QUAL.rowsErr[key])}</span></div>`));
    return;
  }
  if (!res) {
    body.appendChild(el(`<div class="wc-card"><div class="wc-card__body">
      <div class="empty" style="padding:44px">${ic('clock')}<span>위반 행을 불러오는 중…</span></div></div></div>`));
    return;
  }
  if (res.message) {
    /* 통과한 규칙에 대한 안내를 경고로 칠하면 «문제가 있다» 로 읽힌다.
       보관 설정이 꺼져 있어 볼 수 없는 경우만 주의 색이다. */
    const tone = st === '통과' ? 'ok' : st === '미실행' ? 'info' : 'warn';
    body.appendChild(el(`<div class="note ${tone}">${ic(tone === 'ok' ? 'checkc' : 'info')}<span>${esc(res.message)}</span></div>`));
  }
  if (!res.columns.length) return;

  const needle = S.qErrQ.trim().toLowerCase();
  const rows = res.rows.filter(r => !needle || r.some(v => String(v == null ? '' : v).toLowerCase().includes(needle)));
  const t = qTable(res.columns.map(cn => ({ label: cn })));
  rows.forEach(r => qBody(t).appendChild(el('<tr>'
    + r.map(v => `<td class="${typeof v === 'number' ? 'wc-table__num w-num' : ''}"${v == null ? ' style="color:var(--w-text-3)"' : ''}>${esc(v == null ? '(NULL)' : v)}</td>`).join('')
    + '</tr>')));
  if (!rows.length) qEmpty(t, res.rows.length ? '검색 조건에 맞는 행이 없습니다.' : '저장된 위반 행이 없습니다.');
  body.appendChild(t);
  body.appendChild(el(`<span class="w-caption">오류 행 ${qn(tg.cnt)}건 중 서버가 보관한 ${qn(res.rows.length)}건을 보여줍니다.</span>`));

  const qe = $('#qeQ', bar);
  qe.oninput = (e) => { S.qErrQ = e.target.value; };
  qe.onchange = () => render();
  qe.onkeydown = (e) => { if (e.key === 'Enter') render(); };
}

/* ============================================================
   11. 규칙 등록
   ============================================================
   원본은 규칙명을 입력받지만 dbt 는 테스트 이름을 «유형_모델_컬럼» 으로 스스로
   정한다(dbtproj.add_test). 그래서 이름 칸은 만들어질 이름을 미리 보여 주는
   읽기 전용 칸이다 — 입력받아 놓고 버리면 저장 뒤에 이름이 바뀌어 보인다. */
const QCREATABLE = ['notnull', 'unique', 'accepted', 'rel', 'range'];
const QARGSPEC = {
  accepted: [{ k: 'values', label: '허용값 목록', ph: '예: 완제품, 반제품, 원자재',
               hint: '쉼표로 구분합니다. 목록에 없는 값을 오류로 판정합니다.', wide: true }],
  rel: [{ k: 'to', label: '기준 모델', ph: 'item_dim', hint: '값이 존재해야 하는 모델' },
        { k: 'field', label: '기준 컬럼', ph: 'item_id', hint: '비교 대상 컬럼' }],
  range: [{ k: 'min_value', label: '하한', ph: '0', hint: '이 값 미만이면 오류' },
          { k: 'max_value', label: '상한', ph: '1000000', hint: '이 값 초과면 오류' }],
};
const QKINDHINT = {
  notnull: '값이 비어 있는 행을 오류로 판정합니다.',
  unique: '같은 값이 두 번 이상 나타나는 행을 오류로 판정합니다.',
  accepted: '지정한 목록에 없는 값을 오류로 판정합니다.',
  rel: '기준 모델에 없는 값을 오류로 판정합니다.',
  range: '지정한 범위를 벗어난 값을 오류로 판정합니다.',
  fresh: '최신성은 원천(source) 설정으로 관리합니다. 화면에서 만들 수 없습니다.',
  sql: '사용자 정의 SQL 은 tests/ 폴더의 SQL 파일로 관리합니다. 화면에서 만들 수 없습니다.',
};

/* g 를 주면 그 규칙에 적용 대상을 더하는 모드다(유형·인자·심각도가 고정된다).
   qFormInit 은 상태만 만든다 — 그리는 중에 부를 수 있어야 한다(주소로 바로
   #/quality?v=form 에 들어오면 폼 상태 없이 qFormView 가 먼저 돈다). */
const QNEEDCOL = ['notnull', 'unique', 'accepted', 'rel', 'range'];
function qFormInit(g) {
  const first = D.find(x => x.kind !== 'source') || D[0] || {};
  S.qForm = {
    base: g ? g.rid : null,
    type: g ? g.type : 'notnull',
    args: g ? qArgs(g.cond) : {},
    sev: g ? g.sev : 'error',
    model: first.id || null, col: '', active: true,
  };
  qFormPickCol();
}
/* 컬럼이 필요한 검사인데 아직 고르지 않았으면 첫 컬럼을 잡아 둔다 —
   «(모델 전체)» 로 두면 저장을 눌러서야 컬럼을 고르라는 말을 듣는다. */
function qFormPickCol() {
  const f = S.qForm; if (!f) return;
  if (!QNEEDCOL.includes(f.type)) return;
  const cols = ((byId(f.model) || {}).cols) || [];
  if (!f.col && cols.length) f.col = cols[0][0];
}
function qFormOpen(g) { qFormInit(g); S.qView = 'form'; render(); }

function qFormView(main) {
  if (!S.qForm) qFormInit(null);
  const f = S.qForm;
  const base = f.base ? qGroupOf(f.base) : null;
  const models = D.filter(x => x.kind !== 'source');
  const cur = byId(f.model) || models[0] || null;
  const cols = (cur && cur.cols) || [];
  const spec = QARGSPEC[f.type] || [];
  const creatable = QCREATABLE.includes(f.type);
  const dbtName = (QTYPES[f.type] || {}).dbt || f.type;

  const body = qHead(main, {
    crumbs: [{ label: '검증관리', go: () => { S.qView = 'rules'; render(); } },
             { label: '검증 규칙', go: () => { S.qView = 'rules'; render(); } },
             { label: base ? '대상 추가' : '규칙 등록' }],
    title: base ? `대상 추가 — ${base.name}` : '검증 규칙 등록',
    sub: base
      ? `${esc(base.rid)} 규칙에 적용 대상을 하나 더 붙입니다. 유형과 조건은 규칙을 따릅니다.`
      : '규칙 이름은 dbt 가 «유형_모델_컬럼» 으로 자동 채번합니다.',
    actions: [
      qBtn('취소', 'ghost', () => { S.qView = base ? 'detail' : 'rules'; render(); }),
      qBtn('임시저장', 'secondary', null, { off: true,
        title: '임시저장은 아직 서버에 없습니다 — 규칙은 저장하는 즉시 dbt schema.yml 에 씁니다.' }),
      qBtn('저장', 'primary', () => qFormSave(), { off: !creatable || !R().canModel }),
    ],
  });
  body.classList.add('q-formgrid');

  const left = el('<div class="q-formcol"></div>');
  body.appendChild(left);

  /* ── 검증 대상 ── */
  const c1 = qCard('검증 대상');
  $('.wc-card__body', c1).appendChild(el(`<div class="wc-form q-form2">
    <div class="wc-field wc-form__full wc-field--readonly"><label class="wc-field__label">규칙 이름</label>
      <div class="wc-input wc-input--md"><input class="wc-input__el mono" readonly
        value="${esc(dbtName.replace('dbt_utils.', '') + '_' + (f.model || '모델') + (f.col ? '_' + f.col : ''))}"></div>
      <span class="wc-field__msg">dbt 가 확정한 이름을 저장 뒤에 그대로 씁니다.</span></div>
    <div class="wc-field"><label class="wc-field__label">데이터 모델<span class="wc-field__req">*</span></label>
      <div class="wc-input wc-input--md wc-select"><select class="wc-select__el" id="qnM">
        ${models.map(m => `<option value="${esc(m.id)}" ${f.model === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}
      </select><span class="wc-select__caret">${qic('chevd', 14)}</span></div>
      <span class="wc-field__msg">${cur ? esc([cur.phys, cur.layer].filter(Boolean).join(' · ')) : ''}</span></div>
    <div class="wc-field"><label class="wc-field__label">대상 컬럼${f.type === 'unique' || f.type === 'notnull' ? '<span class="wc-field__req">*</span>' : ''}</label>
      <div class="wc-input wc-input--md wc-select"><select class="wc-select__el" id="qnC">
        <option value="">(모델 전체)</option>
        ${cols.map(c => `<option value="${esc(c[0])}" ${f.col === c[0] ? 'selected' : ''}>${esc(c[1])} (${esc(c[0])})</option>`).join('')}
      </select><span class="wc-select__caret">${qic('chevd', 14)}</span></div>
      <span class="wc-field__msg">모델의 컬럼 목록에서 고릅니다.</span></div>
  </div>`));
  left.appendChild(c1);
  $('#qnM', c1).onchange = (e) => { f.model = e.target.value; f.col = ''; qFormPickCol(); render(); };
  $('#qnC', c1).onchange = (e) => { f.col = e.target.value; render(); };

  /* ── 검증 조건 ── */
  const c2 = qCard('검증 조건');
  const b2 = $('.wc-card__body', c2);
  b2.className = 'wc-card__body q-stack20';
  const kinds = el('<div class="wc-field"><label class="wc-field__label">검증 유형<span class="wc-field__req">*</span></label>'
    + '<div class="q-kinds"></div>'
    + `<span class="wc-field__msg"${creatable ? '' : ' style="color:var(--w-warning)"'}>`
    + `${esc(QKINDHINT[f.type] || '')} 품질지표는 ${esc(QMETRIC[f.type])}으로 집계합니다.</span></div>`);
  const kb = $('.q-kinds', kinds);
  Object.keys(QTYPES).forEach(k => {
    const on = f.type === k;
    const b = el(`<button type="button" class="wc-btn wc-btn--sm ${on ? 'wc-btn--primary' : 'wc-btn--secondary'}">${esc(QTYPES[k].label)}</button>`);
    if (base) b.classList.add('wc-btn--disabled');
    else b.onclick = () => { f.type = k; f.args = {}; qFormPickCol(); render(); };
    kb.appendChild(b);
  });
  b2.appendChild(kinds);

  if (spec.length) {
    const grid = el('<div class="wc-form q-form2"></div>');
    spec.forEach(a => {
      const fd = el(`<div class="wc-field ${a.wide ? 'wc-form__full' : ''}">
        <label class="wc-field__label">${esc(a.label)}</label>
        <div class="wc-input wc-input--md"><input class="wc-input__el" placeholder="${esc(a.ph)}"
          value="${esc(f.args[a.k] == null ? '' : f.args[a.k])}"${base ? ' readonly' : ''}></div>
        <span class="wc-field__msg">${esc(a.hint)}</span></div>`);
      if (base) fd.classList.add('wc-field--readonly');
      else $('input', fd).oninput = (e) => { f.args[a.k] = e.target.value; };
      grid.appendChild(fd);
    });
    b2.appendChild(grid);
  }
  b2.appendChild(el(qSoon('검증 범위 조건(예: 최근 30일 적재분)은 준비 중입니다 — dbt 테스트에 where 를 쓰려면 서버가 config.where 를 함께 써야 합니다.')));
  left.appendChild(c2);

  /* ── 판정 및 실행 ── */
  const c3 = qCard('판정 및 실행');
  const b3 = $('.wc-card__body', c3);
  b3.className = 'wc-card__body q-stack20';
  const grid = el(`<div class="wc-form q-form3">
    <div class="wc-field"><label class="wc-field__label">심각도</label>
      <div class="wc-input wc-input--md wc-select"><select class="wc-select__el" id="qnS"${base ? ' disabled' : ''}>
        <option value="error" ${f.sev === 'error' ? 'selected' : ''}>오류</option>
        <option value="warn" ${f.sev === 'warn' ? 'selected' : ''}>경고</option>
      </select><span class="wc-select__caret">${qic('chevd', 14)}</span></div>
      <span class="wc-field__msg">오류는 이후 단계를 멈추고, 경고는 기록만 남깁니다.</span></div>
    <div class="wc-field"><label class="wc-field__label">사용 여부</label>
      <div class="q-togglebox"><span class="wc-toggle ${f.active ? 'wc-toggle--on' : ''}" id="qnA">
        <span class="wc-toggle__track"><span class="wc-toggle__knob"></span></span>${f.active ? '사용' : '미사용'}</span></div></div>
    <div class="wc-field"><label class="wc-field__label">실행 시점</label>
      <div class="wc-input wc-input--md wc-field--readonly"><input class="wc-input__el" value="파이프라인 실행 시" readonly></div>
      <span class="wc-field__msg">dbt 테스트는 그 모델을 만드는 파이프라인에 붙어 돌아갑니다.</span></div>
  </div>`);
  b3.appendChild(grid);
  b3.appendChild(el(qSoon('경고·오류 판정 기준 건수, 알림(메일·배너·적재 중단), 오류 행 보관(store_failures) 은 준비 중입니다 — 서버가 지금 쓰고 읽는 것은 심각도와 사용 여부뿐입니다.')));
  left.appendChild(c3);
  const sv = $('#qnS', c3); if (sv && !base) sv.onchange = (e) => { f.sev = e.target.value; render(); };
  $('#qnA', c3).onclick = () => { if (!base) { f.active = !f.active; render(); } };

  /* ── 미리 검증 ── */
  const side = qCard('미리 검증', '최근 1,000행 대상');
  side.classList.add('q-sticky');
  $('.wc-card__body', side).appendChild(el(qSoon(
    '저장 전에 표본으로 미리 돌려 보는 자리입니다. 서버에 «규칙 초안으로 조회» 하는 통로가 아직 없습니다 — '
    + '저장한 뒤 규칙 상세의 «즉시 검증» 으로 실제 검사를 돌릴 수 있습니다.')));
  body.appendChild(side);
}

async function qFormSave() {
  const f = S.qForm;
  if (!f) return;
  if (!QCREATABLE.includes(f.type)) { toast(QKINDHINT[f.type], 'warn'); return; }
  if (!f.model) { toast('데이터 모델을 고르세요.', 'warn'); return; }
  if ((f.type === 'notnull' || f.type === 'unique' || f.type === 'accepted' || f.type === 'range' || f.type === 'rel') && !f.col) {
    toast('대상 컬럼을 고르세요.', 'warn'); return;
  }
  const args = {};
  (QARGSPEC[f.type] || []).forEach(a => {
    const v = String(f.args[a.k] == null ? '' : f.args[a.k]).trim();
    if (!v) return;
    args[a.k] = a.k === 'values' ? v.split(',').map(x => x.trim()).filter(Boolean) : v;
  });
  /* 참조 무결성의 기준 모델은 dbt 문법으로 넘겨야 한다 — 모델 이름만 오면 감싼다 */
  if (f.type === 'rel' && args.to && !/^ref\s*\(/.test(args.to)) args.to = `ref('${args.to}')`;
  const need = { accepted: ['values'], rel: ['to', 'field'] }[f.type] || [];
  const miss = need.filter(k => args[k] == null || args[k] === '' || (Array.isArray(args[k]) && !args[k].length));
  if (miss.length) { toast(`${QTYPES[f.type].label} 검사에는 ${miss.join(' · ')} 값이 필요합니다.`, 'warn'); return; }

  try {
    await api('/quality/rules', { method: 'POST', body: JSON.stringify({
      modelId: f.model, type: f.type, col: f.col, sev: f.sev, active: f.active, arguments: args }) });
    toast('검증 규칙을 저장했습니다.');
    await boot({ keep: true });
    /* 방금 만든 테스트가 속한 묶음을 열어 준다 — 목록으로 떨어뜨리면 어디에
       들어갔는지 알 수 없다(같은 유형의 규칙이 여럿일 수 있다). */
    const made = QRULES.find(t => t.model === f.model && t.col === f.col && t.type === f.type);
    if (made && qOpenRule(made.id)) { S.qForm = null; render(); return; }
    S.qForm = null; S.qView = 'rules'; render();
  } catch (e) { fail(e); }
}

/* ============================================================
   12. 동작 — 즉시 검증 · 사용중지 · 삭제 · 내려받기
   ============================================================ */

/* 즉시 검증. 서버의 scope 는 값 하나라(모델 id 또는 규칙 id) 여러 모델에 걸친
   규칙은 모델별로 나눠 부른다. dbt 를 동시에 여러 번 돌리면 같은 프로젝트
   디렉터리에서 target/ 을 두고 다투므로 **차례로** 부른다. */
async function qRunGroups(groups) {
  const scopes = [...new Set([].concat(...groups.map(g => g.targets.map(t => t.model))))];
  if (!scopes.length) return;
  toast(`검증을 실행합니다 — 모델 ${scopes.length}개`);
  let ok = 0;
  for (const s of scopes) {
    try {
      const r = await api('/quality/runs', { method: 'POST', body: JSON.stringify({ scope: s }) });
      if (r.ok) ok++;
    } catch (e) { fail(e); return; }
  }
  toast(ok === scopes.length ? '검증을 마쳤습니다.' : `검증을 마쳤습니다 — ${scopes.length - ok}개 모델에서 문제가 있었습니다.`,
        ok === scopes.length ? '' : 'warn');
  QUAL.hist = {}; QUAL.rows = {}; QUAL.rowsErr = {};
  await boot({ keep: true });
  qLoad(true);
}

/* 사용중지 — 묶음 안의 dbt 테스트를 하나씩 끈다 */
async function qSuspend(groups) {
  const targets = [].concat(...groups.map(g => g.targets)).filter(t => t.active);
  if (!targets.length) { toast('이미 사용중지된 규칙입니다.'); return; }
  if (!await confirmModal({ title: '검증 규칙 사용중지', tone: 'warn', ok: '사용중지',
        body: `규칙 ${groups.length}건 · 적용 대상 ${targets.length}개를 사용중지합니다.<br>`
          + '데이터 모델의 품질 규칙 탭에도 함께 반영됩니다.' })) return;
  try {
    for (const t of targets) {
      await api(`/quality/rules/${enc(t.id)}/active`, { method: 'PATCH', body: JSON.stringify({ active: false }) });
    }
    toast(`${targets.length}개를 사용중지했습니다.`);
    S.qPick = {};
    await boot({ keep: true });
  } catch (e) { fail(e); }
}

/* 적용 대상 삭제 = dbt 테스트를 schema.yml 에서 지운다. «해제» 라 쓰지 않는 이유는
   붙였다 떼는 것이 아니라 정의가 사라지기 때문이다. */
async function qDeleteTarget(t) {
  const d = byId(t.model) || { name: t.model };
  if (!await confirmModal({ title: '적용 대상 삭제', tone: 'warn', danger: true, ok: '삭제',
        body: `${esc(d.name)} 의 ${esc(t.col || '모델 전체')} 검사를 지웁니다.<br>`
          + 'dbt schema.yml 에서 사라지고, 데이터 모델의 품질 규칙 탭에도 반영됩니다.' })) return;
  try {
    await api('/quality/rules/' + enc(t.id), { method: 'DELETE' });
    toast('적용 대상을 삭제했습니다.');
    await boot({ keep: true });
  } catch (e) { fail(e); }
}

/* 결과 내려받기 — 서버가 CSV 를 만든다(엑셀에서 한글이 깨지지 않게 BOM 포함) */
function qExport() { location.href = BASE + '/quality/report:export'; }

/* ============================================================
   13. 화면 조립
   ============================================================ */
const QVIEWS = { dash: qDashView, report: qReportView, rules: qRulesView,
                 detail: qDetailView, form: qFormView, runs: qRunsView, errors: qErrorsView };

function pageQuality() {
  const p = el('<div class="page flush"></div>');
  const row = el('<div class="wc-shell__row q-shell"></div>');
  row.appendChild(qSidebar());
  const main = el('<main class="wc-shell__main"></main>');
  row.appendChild(main);
  p.appendChild(row);
  (QVIEWS[S.qView] || qDashView)(main);
  return p;
}

/* ── 규칙 설정 모달 (데이터 모델 화면의 품질 규칙 탭이 쓴다) ──────────────
   품질 화면은 이제 전체 화면 폼(qFormView)을 쓰지만, 모델 화면의 «품질 규칙» 탭은
   모델을 보면서 규칙을 손대는 자리라 모달이 맞다. api.js 가 이 함수를 감싸
   서버 저장을 붙인다 — 여기서 구조를 바꾸면 그 겹이 어긋난다. */
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
    body: `${q.name} 규칙을 삭제하시겠습니까?\n\n데이터 모델의 품질 규칙 탭에서도 사라집니다.` },
    () => { const i = QRULES.indexOf(q); if (i >= 0) QRULES.splice(i, 1); render(); toast('규칙을 삭제했습니다.'); }); };
}
