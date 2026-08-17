
(function () {

  /* ============================================================
     1. 공통 조각
     ============================================================ */


  const CK = {
    api:  { label: 'REST API',    icon: 'link', unit: '커넥터' },
    file: { label: '파일 업로드', icon: 'doc',  unit: '커넥터' },
  };
  const CKINDS = ['api', 'file'];
  const ckOf = (j) => CK[j.kind] || CK.api;

  /* 적재 방식과 수집 범위는 다른 축이다.
       적재 방식(mode)   증분 적재 · 전체 적재  — 가져온 행을 테이블에 어떻게 넣나
       수집 범위(scope)  증분 수집 · 전체 수집  — 원천에서 얼마나 끌어오나
     둘을 한 줄로 합치면 «전체 적재 + 증분 수집» 같은 실제 조합을 적을 수 없다.
     이름이 비슷해 헷갈리므로 화면에서는 항상 «적재 방식» · «수집 범위» 라는
     제목을 함께 달아 어느 축인지 먼저 보이게 한다. */
  const LOAD_MODE  = { append: '증분 적재', overwrite: '전체 적재' };
  const SCOPE_MODE = { full: '전체 수집', incremental: '증분 수집' };
  const AUTH_LABEL = { '': '없음', bearer: 'Bearer 토큰', header: '헤더 키', param: '쿼리 파라미터' };

  /* 상태. 원본의 정상 · 확인 필요 · 실패 에 이 앱이 실제로 아는 두 가지를 더한다
     (실행 중 · 예약 꺼짐). 색은 파이프라인 화면(b56)과 같은 값이라 메뉴를 오가도
     같은 점이 같은 뜻으로 읽힌다. */
  const CST = {
    ok:   { label: '정상',      fg: 'var(--w-success)', bg: 'rgba(52,199,89,.14)' },
    run:  { label: '실행 중',   fg: 'var(--w-info)',    bg: 'rgba(0,192,232,.12)' },
    err:  { label: '실패',      fg: 'var(--w-danger)',  bg: 'rgba(255,56,60,.10)' },
    warn: { label: '확인 필요', fg: 'var(--w-warning)', bg: 'rgba(255,141,40,.16)' },
    off:  { label: '예약 꺼짐', fg: 'var(--w-text-3)',  bg: 'var(--w-hover)' },
  };
  const CSTS = ['ok', 'run', 'err', 'warn', 'off'];

  /* «예약이 꺼져 있다» 고 말할 수 있는 경우.

     j.paused 는 Airflow DAG 의 pause 플래그를 그대로 내린 값이라, 수동 실행으로
     만든 커넥터도 늘 true 다(예약이 없으니 DAG 을 꺼 두는 것이 정상이다).
     그것을 그대로 «예약 꺼짐» 이라고 적으면, 사용자가 수동으로 고른 설정이
     고장난 상태처럼 보인다. 예약 실행으로 정해 둔 커넥터가 꺼졌을 때만 그렇게 말한다. */
  const cnPaused = (j) => j.kind === 'api' && j.trigger_type === 'schedule' && j.paused === true;

  /* 이 커넥터는 지금 어떤가.

     «확인 필요» 는 실패가 아니다 — 한 번도 적재된 적이 없어서 정말로 붙는지
     아무도 모르는 상태다. 원본이 아파트 전월세(«확인 이력 없음»)에 준 색이 그것이고,
     그 커넥터가 해야 할 다음 행동은 «고치기» 가 아니라 «연결 확인» 이다. */
  function cnState(j) {
    const chk = CHECK[j.id];
    if (chk && chk.state === 'err') return 'err';
    if (j.kind === 'file') {
      // 파일 커넥터에는 예약 실행이 없다. 적재된 적이 있으면(SOURCE 가 생겼으면) 정상이다.
      if (cnSource(j)) return 'ok';
      return chk && chk.state === 'ok' ? 'ok' : 'warn';
    }
    const st = RUN_ST[(j.lastRun || {}).state];
    if (st === 'run') return 'run';
    if (st === 'err') return 'err';
    if (st === 'ok') return cnPaused(j) ? 'off' : 'ok';
    // 행이 0건이어도 «붙는다» 는 확인된 것이다. 그 조건에 자료가 없는 것과
    // 커넥터가 고장난 것을 같은 색으로 칠하면 확인 자체가 쓸모없어진다.
    if (chk && (chk.state === 'ok' || chk.state === 'empty')) return cnPaused(j) ? 'off' : 'ok';
    return cnPaused(j) ? 'off' : 'warn';
  }

  const cnDot = (st) => `<span class="cn-dot" style="background:${CST[st].fg}"></span>`;
  const cnBadge = (st) => `<span class="wc-badge" style="background:${CST[st].bg};color:${CST[st].fg}">`
    + `<span class="wc-badge__dot"></span>${CST[st].label}</span>`;
  const cnTag = (t) => `<span class="wc-tag cn-tag">${esc(t)}</span>`;

  function cnBtn(label, kind, icon, onclick, o) {
    const b = el(`<button type="button" class="wc-btn wc-btn--${kind} wc-btn--${(o && o.size) || 'sm'}"`
      + `${o && o.title ? ` title="${esc(o.title)}"` : ''}>`
      + `${icon ? ic14(icon) : ''}<span>${esc(label)}</span></button>`);
    if (o && o.off) b.disabled = true;
    else if (onclick) b.onclick = onclick;
    return b;
  }

  /* 속성 표 — 상세의 왼쪽 2열. rows = [[라벨, 값HTML]]. 값이 없는 줄은 넣지 않는다. */
  function cnKv(rows) {
    const t = el('<div class="cn-kv"></div>');
    rows.filter(Boolean).forEach(([k, v]) => t.appendChild(el(
      `<div class="cn-kv-r"><span class="cn-kv-k">${esc(k)}</span>`
      + `<span class="cn-kv-v">${v}</span></div>`)));
    return t;
  }

  /* 카드 틀 — DS 의 .wc-card 를 쓰되 머리·바닥을 여기서 한 번만 조립한다 */
  function cnCard(title, o) {
    const c = el(`<div class="wc-card cn-card">
      <div class="wc-card__head"><div style="min-height:0;justify-content:center">
        <span class="wc-card__title">${esc(title)}</span>
        ${o && o.sub ? `<span class="wc-card__sub">${esc(o.sub)}</span>` : ''}</div></div>
      <div class="wc-card__body ${o && o.flush ? 'wc-card__body--flush' : ''}"></div></div>`);
    if (o && o.right) $('.wc-card__head', c).appendChild(o.right);
    return c;
  }

  const cnBody = (card) => $('.wc-card__body', card);

  /* 시각. 서버가 주는 값이 두 갈래다 — 실행 시각은 ISO 문자열(시간대 포함),
     만든·고친 시각은 epoch 초(float)다. 한 곳에서 흡수한다. */
  const cnAt = (v) => (v == null || v === '' ? ''
    : shortTime(typeof v === 'number' ? new Date(v * 1000) : v));

  /* ============================================================
     2. 파생 사실 — 커넥터 → SOURCE → 데이터 모델 → 파이프라인
     ------------------------------------------------------------
     원본의 «파이프라인 N개에서 사용» 은 커넥터가 파이프라인을 직접 안다고
     전제하는데, 실제 사슬은 한 칸 더 길다. 커넥터가 적재한 테이블이 SOURCE 가
     되고, 그 SOURCE 를 참조하는 데이터 모델이 생기고, 그 모델을 만드는
     파이프라인이 따로 있다. 그 사슬을 그대로 따라간다.
     ============================================================ */

  function cnSource(j) {
    return D.find(d => d.kind === 'source' && (d.id === j.target || d.phys === j.phys)) || null;
  }

  function cnModels(j) {
    const src = cnSource(j);
    return src ? D.filter(d => (d.up || []).includes(src.id)) : [];
  }

  /* 그 모델들을 만드는 파이프라인. 한 모델을 여러 파이프라인이 만들지는 않지만
     («한 모델의 적재는 파이프라인 하나»), 커넥터 하나가 여러 모델을 먹이면
     파이프라인도 여럿이 된다. */
  function cnPipes(j) {
    const ids = new Set(cnModels(j).map(m => m.id));
    if (!ids.size) return [];
    return PIPES.filter(p => (p.targets || []).some(t => ids.has(t)));
  }

  /* ---------------------------------------------------------- 수집 데이터

     적재된 결과를 웨어하우스에서 직접 읽는다(/catalog/{id}/preview). 원본이
     «원본 응답에서 앞 4건» 이라고 한 자리인데, 응답 표본보다 **실제로 들어간
     값**이 이 화면에서 더 쓸모 있다 — 연결이 되는지는 위저드의 연결 테스트가
     답하고, 상세가 답해야 할 것은 «지금 저 테이블에 무엇이 들어 있는가» 다. */
  const PREV = {};

  function cnPreview(j) {
    const src = cnSource(j);
    if (!src) return null;
    const c = PREV[j.id];
    if (c) return c;
    const box = PREV[j.id] = { loading: true, cols: null, rows: null, err: null, total: null };
    api(`/catalog/${enc(src.id)}/preview?limit=5`)
      .then(r => {
        box.cols = r.columns || [];
        box.rows = r.rows || [];
        box.total = r.totalRows;
      })
      .catch(e => { box.err = e.message; })
      .finally(() => { box.loading = false; if (S.page === 'ingest') render(); });
    return box;
  }

  /* ---------------------------------------------------------- 버전 이력

     커넥터의 정의는 이 DB 에만 있다(모델은 SQL 파일이 원천이라 되돌릴 근거가 밖에
     있지만, 커넥터는 없다). 그래서 서버가 저장할 때마다 그때의 정의를 통째로
     남긴다 — 화면은 그것을 읽기만 한다. */
  const VERS = {};

  function cnVersions(j) {
    const c = VERS[j.id];
    if (c) return c;
    const box = VERS[j.id] = { loading: true, items: null, err: null };
    api(`/ingest/jobs/${enc(j.id)}/versions?limit=6`)
      .then(r => { box.items = r.items || []; })
      .catch(e => { box.err = e.message; })
      .finally(() => { box.loading = false; if (S.page === 'ingest') render(); });
    return box;
  }

  /* ---------------------------------------------------------- 자격증명

     비밀 값은 커넥터가 아니라 여기에 산다. 커넥터는 참조(credential_id)만 들고,
     서버가 요청을 보낼 때 펼친다 — 같은 키를 쓰는 커넥터가 여럿이어도 사본이
     생기지 않고, 키를 갈 때 한 곳만 고치면 된다. 만료일도 키의 속성이라 여기 있다. */
  const CREDS = [];

  async function loadCreds() {
    try {
      const r = await api('/credentials');
      CREDS.splice(0, CREDS.length, ...(r.items || []));
    } catch (e) { console.warn('[Data Mates] 자격증명을 불러오지 못했습니다.', e); }
  }
  loadCreds();

  const credById = (id) => CREDS.find(c => c.id === id) || null;

  /* 만료 한 줄. 서버가 정한 state(ok · soon · expired · none)를 그대로 읽는다 —
     «며칠 남으면 주의» 를 화면이 다시 정하면 목록과 상세가 다른 색을 칠한다. */
  function credExpiry(c) {
    if (!c || !c.expiresAt) return '<span class="cn-mute">만료 없음</span>';
    const d = String(c.expiresAt).slice(0, 10).replace(/-/g, '.');
    if (c.state === 'expired') {
      return `<span style="color:var(--w-danger)">${esc(d)} 만료됨</span>`;
    }
    if (c.state === 'soon') {
      return `<span style="color:var(--w-warning)">${esc(d)} 만료 · ${c.daysLeft}일 남음</span>`;
    }
    return `<span class="cn-mute">${esc(d)} 만료</span>`;
  }

  /* ---------------------------------------------------------- 연결 확인

     서버에 «마지막으로 언제 붙어 봤는가» 를 남기는 자리가 없다. 그래서 확인은
     기록을 읽는 일이 아니라 **지금 두드리는 일**이다. 결과는 이 세션 동안만
     기억하고, 화면에도 그렇게 적는다(«이번 세션»). */
  const CHECK = {};

  async function cnCheck(j) {
    if (j.kind === 'file') {
      // 파일 커넥터는 붙을 원천이 없다 — 파일을 올릴 때 그 자리에서 읽는다.
      CHECK[j.id] = { state: 'skip', at: nowLabel(), msg: '파일 커넥터는 올릴 때 읽습니다.' };
      return CHECK[j.id];
    }
    const t0 = Date.now();
    try {
      const r = await api('/ingest/preview', {
        method: 'POST',
        body: JSON.stringify({ kind: 'api', config: j.config || {}, job_id: j.id }),
      });
      const cols = (r.columns || []).length;

      CHECK[j.id] = { state: cols ? 'ok' : 'empty', at: nowLabel(), ms: Date.now() - t0,
                      rows: r.sampled, cols, probe: r.probe || null };
    } catch (e) {
      CHECK[j.id] = { state: 'err', at: nowLabel(), ms: Date.now() - t0,
                      msg: e.message || '요청이 실패했습니다.' };
    }
    return CHECK[j.id];
  }

  /* 일괄 확인이 도는 중인가. 버튼의 DOM 이 아니라 여기에 담는다 —
     render() 가 페이지를 통째로 다시 만들어 버튼 노드가 매번 갈리기 때문이다.
     («버튼이 아직 화면에 붙어 있나» 로 중단을 판단하면 첫 한 건만 확인하고 멈춘다.) */
  let CHECKING = null;                        // null | { done, total }

  /* 연결 일괄 확인 — API 커넥터를 하나씩 두드린다. 동시에 던지지 않는다:
     같은 공공 API 를 여러 커넥터가 쓰는 경우가 흔해서, 한꺼번에 나가면
     초당 호출 제한에 걸려 «실패» 가 원천 탓인지 우리 탓인지 알 수 없게 된다. */
  async function cnCheckAll() {
    if (CHECKING) return;
    const list = ING.filter(j => j.kind === 'api');
    if (!list.length) { toast('확인할 REST API 커넥터가 없습니다.'); return; }
    CHECKING = { done: 0, total: list.length };
    render();
    let bad = 0, empty = 0;
    for (let i = 0; i < list.length; i++) {
      const r = await cnCheck(list[i]);
      // 0건은 «못 쓴다» 가 아니다 — 붙었고 인증도 통했고, 그 조건에 자료가 없을 뿐이다.
      if (r.state === 'err') bad++;
      else if (r.state === 'empty') empty++;
      CHECKING.done = i + 1;
      if (S.page !== 'ingest') break;         // 화면을 떠났으면 그만둔다
      render();
    }
    CHECKING = null;
    const n = list.length;
    toast(bad ? `${n}개 중 ${bad}개가 연결에 실패했습니다.`
          : empty ? `${n}개 모두 연결됩니다. ${empty}개는 지금 조건에 자료가 없습니다.`
          : `${n}개 모두 연결됩니다.`,
          bad ? 'warn' : '');
    render();
  }

  /* 카드·상세가 함께 쓰는 «연결 확인» 한 줄 */
  /* 확인에 쓴 조건을 사람이 읽는 한 줄로. 0건일 때 «어떤 조건으로 0건인가» 가
     곧 다음 단서라, 숨기면 사용자가 주소부터 다시 뒤지게 된다. */
  function cnProbeLine(c) {
    const p = c && c.probe;
    if (!p || !Object.keys(p).length) return '';
    return ' ' + Object.entries(p).map(([k, v]) => `${k}=${v}`).join(' · ');
  }

  function cnCheckLine(j) {
    const c = CHECK[j.id];
    if (!c) return '<span class="cn-mute">확인한 적 없음</span>';
    if (c.state === 'skip') return `<span class="cn-mute">${esc(c.msg)}</span>`;
    const when = ` <span class="cn-mute">· ${esc(c.at)} (이번 세션)</span>`;
    if (c.state === 'err') return `<span style="color:var(--w-danger)">연결 실패</span>${when}`;
    if (c.state === 'empty') {
      return '<span style="color:var(--w-success)">연결됨</span>'
        + `<span class="cn-mute"> · 이 조건에는 자료 없음${esc(cnProbeLine(c))}`
        + ` · ${esc(c.at)} (이번 세션)</span>`;
    }
    return '<span style="color:var(--w-success)">연결됨</span>'
      + ` <span class="cn-mute">· 컬럼 ${c.cols}개 · ${esc(c.at)} (이번 세션)</span>`;
  }

  /* 최근 실행 한 줄 — 예약 실행은 파이프라인이 돌린다. 여기서는 결과만 읽는다. */
  function cnRunLine(j) {
    if (j.kind === 'file') return '<span class="cn-mute">파일을 올릴 때 적재합니다.</span>';
    const r = j.lastRun;
    if (!r || !(r.end || r.start)) return '<span class="cn-mute">실행 이력 없음</span>';
    const st = RUN_ST[r.state] || 'wait';
    const when = cnAt(r.end || r.start);
    const took = r.seconds != null ? ' · ' + durLabel(r.seconds) : '';
    if (st === 'err') return `<span style="color:var(--w-danger)">실패</span> <span class="cn-mute">· ${esc(when)}</span>`;
    if (st === 'run') return `<span style="color:var(--w-info)">실행 중</span>`;
    return `<span class="cn-mute">${esc(when)}${esc(took)}</span>`;
  }


  /* ============================================================
     3. 탭 줄 — 목록 · 커넥터 · 위저드
     ------------------------------------------------------------
     좌측 사이드바는 두지 않는다. 데이터 모델·파이프라인은 항목끼리 관계가 있어
     («이 모델의 원천은 무엇인가») 목록을 늘 곁에 두고 오가야 하지만, 커넥터끼리는
     아무 관계가 없다 — 하나를 보는 동안 다른 것을 함께 봐야 할 일이 없다.
     같은 목록을 사이드바와 「커넥터 목록」 탭 두 군데에 두면 검색칸도 두 개가 되고,
     둘 중 어느 것이 지금 거른 결과인지 알 수 없어진다. 목록은 한 곳에만 둔다.
     ============================================================ */

  ingTabStrip = function () {
    const strip = el('<div class="ptabs"></div>');
    const l = tabBtn({ label: '커넥터 목록', icon: 'tbl', on: S.openIng === 'list' });
    l.classList.add('tab-fit');
    l.onclick = () => { S.openIng = 'list'; render(); };
    strip.appendChild(l);

    S.openIngs.forEach(jid => {
      const j = ingById(jid);
      if (!j) return;
      const t = tabBtn({ label: j.name, on: S.openIng === jid, closable: true });
      /* 아이콘 자리에 상태 점을 둔다 — 탭이 여럿 열린 채로 훑을 때 어느 커넥터가
         확인이 필요한지 탭 줄에서 바로 읽혀야 한다(b56 의 파이프라인 탭과 같다). */
      t.insertBefore(el(cnDot(cnState(j))), t.firstChild);
      t.onclick = (ev) => {
        if (ev.target.closest('.ptab-x')) { closeIngTab(jid); return; }
        S.openIng = jid; render();
      };
      strip.appendChild(t);
    });

    if (WIZ) {
      const t = tabBtn({ label: WIZ.job ? `${WIZ.job.name} 수정` : '새 커넥터',
                         icon: WIZ.job ? 'pen' : 'plus',
                         on: S.openIng === 'wiz', closable: true });
      t.onclick = (ev) => {
        if (ev.target.closest('.ptab-x')) { closeWizard(); return; }
        S.openIng = 'wiz'; render();
      };
      strip.appendChild(t);
    }
    return strip;
  };


  /* ============================================================
     4. 커넥터 목록
     ============================================================ */

  S.cnFKind = S.cnFKind || 'all';
  S.cnFStat = S.cnFStat || 'all';
  S.cnMenu = S.cnMenu || null;
  S.cnNotice = S.cnNotice !== false;

  /* 거르기 드롭다운. 열려 있는 동안 바깥을 누르면 닫는다 — 메뉴를 두 개 둔 화면에서
     하나를 열어 둔 채 다른 곳을 누르면 그대로 떠 있는 것이 가장 흔한 불만이다. */
  function cnMenuBtn(key, label, options, cur, pick) {
    const wrap = el('<div class="cn-mwrap"></div>');
    const b = el(`<button type="button" class="wc-btn wc-btn--secondary wc-btn--md cn-mbtn">
      <span>${esc(label)}</span>${ic14('chevd', 'fnt')}</button>`);
    b.onclick = (ev) => {
      ev.stopPropagation();
      S.cnMenu = S.cnMenu === key ? null : key;
      render();
    };
    wrap.appendChild(b);
    if (S.cnMenu !== key) return wrap;

    const pop = el('<div class="cn-menu"></div>');
    options.forEach(o => {
      const it = el(`<button type="button" class="cn-menu-i ${o.v === cur ? 'on' : ''}">
        <span class="cn-menu-c">${o.v === cur ? ic14('check') : ''}</span>
        <span class="f1">${esc(o.label)}</span>
        <span class="cn-menu-n">${o.count}</span></button>`);
      it.onclick = (ev) => { ev.stopPropagation(); S.cnMenu = null; pick(o.v); };
      pop.appendChild(it);
    });
    wrap.appendChild(pop);
    setTimeout(() => {
      const off = () => { if (S.cnMenu === key) { S.cnMenu = null; render(); } };
      document.addEventListener('click', off, { once: true });
    }, 0);
    return wrap;
  }

  /* 목록 카드 — 머리(이름·적재 대상·상태) / 본문(적재·연결·최근 실행) / 바닥(쓰임·수정) */
  function cnListCard(j) {
    const st = cnState(j);
    const cfg = j.config || {};
    const models = cnModels(j);
    const pipes = cnPipes(j);
    const cols = (j.columns || []).length;

    const secondRow = j.kind === 'api'
      ? ['인증', `${esc(AUTH_LABEL[(cfg.auth || {}).kind || ''] || '없음')}`
          + ((cfg.auth || {}).kind ? ` <span class="cn-mute">· 저장됨</span>` : '')]
      : ['파일 형식', `${cfg.format === 'jsonl' ? 'JSON Lines' : 'CSV'}`
          + (cfg.format === 'jsonl' ? '' : ` <span class="cn-mute">· 구분자 «${esc(cfg.delimiter || ',')}»</span>`)];

    const card = el(`<div class="wc-card cn-lc">
      <div class="wc-card__head">
        <div style="min-height:0">
          <span class="wc-card__title trunc">${esc(j.name)}</span>
          <span class="wc-card__sub mono trunc">${esc(j.phys)}</span></div>
        ${cnBadge(st)}</div>
      <div class="wc-card__body cn-lc-b">
        <span class="cn-lc-k">적재 방식</span>
        <span class="cn-lc-v">${esc(LOAD_MODE[j.mode] || j.mode)}
          <span class="cn-mute">· 컬럼 ${cols}개</span></span>
        <span class="cn-lc-k">${esc(secondRow[0])}</span><span class="cn-lc-v">${secondRow[1]}</span>
        <span class="cn-lc-k">연결 확인</span><span class="cn-lc-v">${cnCheckLine(j)}</span>
        <span class="cn-lc-k">최근 실행</span><span class="cn-lc-v">${cnRunLine(j)}</span>
      </div>
      <div class="wc-card__foot cn-lc-f">
        <span class="cn-mute">${models.length
          ? `데이터 모델 <b style="color:var(--w-accent)">${models.length}</b>개가 사용`
            + (pipes.length ? ` · 파이프라인 <b style="color:var(--w-accent)">${pipes.length}</b>개` : '')
          : '아직 쓰는 데이터 모델이 없습니다'}</span>
        <span class="cn-mute">${j.updated_at ? esc(cnAt(j.updated_at).slice(0, 10)) + ' 수정' : ''}</span>
      </div></div>`);
    card.onclick = () => openIngTab(j.id);
    return card;
  }

  ingListView = function () {
    const wrap = el(`<div class="f1 col cn-scroll"><div class="cn-page"></div></div>`);
    const page = $('.cn-page', wrap);

    /* ── 머리 ── */
    const head = el(`<div class="cn-head">
      <div class="cn-head-t">
        <div><h1 class="page-t">수집 커넥터</h1>
          <p class="page-d">전체 ${ING.length}개 · 원본을 그대로 <span class="mono">raw</span> 스키마에 적재합니다.</p></div>
        <div class="row g6" style="flex:none"></div></div></div>`);
    const acts = $('.cn-head-t .row', head);
    acts.appendChild(CHECKING
      ? cnBtn(`확인 중… ${CHECKING.done}/${CHECKING.total}`, 'secondary', 'rot', null,
              { size: 'md', off: true })
      : cnBtn('연결 일괄 확인', 'secondary', 'link', () => cnCheckAll(), { size: 'md' }));
    acts.appendChild(cnBtn('커넥터 만들기', 'primary', 'plus', () => openWizard(null), { size: 'md' }));
    page.appendChild(head);

    const body = el('<div class="cn-body"></div>');
    page.appendChild(body);

    /* ── 빈 화면 ── */
    if (!ING.length) {
      const empty = el(`<div class="wc-card cn-empty">
        <span class="cn-empty-i">${ic('link')}</span>
        <div class="t13 b6">아직 커넥터가 없습니다.</div>
        <div class="t12 fnt cn-empty-d">
          외부 데이터에 연결해 커넥터를 만들면, 적재된 테이블이 <b>SOURCE</b> 가 됩니다.<br>
          그 SOURCE 를 입력으로 데이터 모델을 만드는 것이 다음 단계입니다.<br>
          커넥터는 가공하지 않습니다 — 원본 그대로 넣고, 정제는 데이터 모델이 맡습니다.</div>
      </div>`);
      empty.appendChild(cnBtn('커넥터 만들기', 'primary', 'plus', () => openWizard(null), { size: 'md' }));
      body.appendChild(empty);
      return wrap;
    }

    /* ── 안내 줄 — 이 화면과 파이프라인의 경계 ── */
    if (S.cnNotice) {
      const note = el(`<div class="cn-note">
        ${ic14('info')}
        <span class="f1">커넥터는 연결과 적재 규칙만 정의합니다.
          수집 주기와 실행은 데이터 파이프라인에서 관리합니다.</span></div>`);
      const gotoPipe = cnBtn('파이프라인으로 이동', 'text', null, () => go('pipeline'));
      note.appendChild(gotoPipe);
      const x = el(`<button class="iconbtn" title="이 안내 접기">${ic14('x')}</button>`);
      x.onclick = () => { S.cnNotice = false; render(); };
      note.appendChild(x);
      body.appendChild(note);
    }

    /* ── 거르기 ── */
    const q = (S.cnQ || '').trim().toLowerCase();
    const byQ = (j) => !q || j.name.toLowerCase().includes(q)
      || String(j.phys || '').toLowerCase().includes(q);
    const shown = ING.filter(j => byQ(j)
      && (S.cnFKind === 'all' || j.kind === S.cnFKind)
      && (S.cnFStat === 'all' || cnState(j) === S.cnFStat));

    const bar = el(`<div class="cn-filter">
      <div class="wc-input wc-input--md cn-fsrch">
        <span class="wc-input__affix">${ic14('search', 'fnt')}</span>
        <input class="wc-input__el" id="cnQ" placeholder="커넥터명 또는 적재 대상 검색"
          value="${esc(S.cnQ || '')}"></div></div>`);

    const kindCounts = { all: ING.length };
    CKINDS.forEach(k => { kindCounts[k] = ING.filter(j => j.kind === k).length; });
    bar.appendChild(cnMenuBtn('kind',
      S.cnFKind === 'all' ? '유형 전체' : CK[S.cnFKind].label,
      [{ v: 'all', label: '유형 전체', count: kindCounts.all }]
        .concat(CKINDS.map(k => ({ v: k, label: CK[k].label, count: kindCounts[k] }))),
      S.cnFKind, (v) => { S.cnFKind = v; render(); }));

    const statCounts = { all: ING.length };
    CSTS.forEach(s => { statCounts[s] = ING.filter(j => cnState(j) === s).length; });
    bar.appendChild(cnMenuBtn('stat',
      S.cnFStat === 'all' ? '연결 상태 전체' : CST[S.cnFStat].label,
      [{ v: 'all', label: '연결 상태 전체', count: statCounts.all }]
        .concat(CSTS.filter(s => statCounts[s]).map(s => ({ v: s, label: CST[s].label, count: statCounts[s] }))),
      S.cnFStat, (v) => { S.cnFStat = v; render(); }));

    body.appendChild(bar);
    const inp2 = $('#cnQ', bar);
    inp2.oninput = (e) => {
      S.cnQ = e.target.value;
      const c = e.target.selectionStart;
      render();
      const i2 = $('#cnQ');
      if (i2) { i2.focus(); i2.setSelectionRange(c, c); }
    };

    /* ── 유형별 구획 ── */
    if (!shown.length) {
      body.appendChild(el(`<div class="cn-none">${ic('search')}
        <span class="t13 b6">조건에 맞는 커넥터가 없습니다.</span>
        <span class="t12 fnt">검색어나 거르기를 바꿔 보세요.</span></div>`));
      return wrap;
    }

    CKINDS.forEach(kind => {
      const items = shown.filter(j => j.kind === kind).sort((a, b) => a.name.localeCompare(b.name));
      if (!items.length) return;
      body.appendChild(el(`<div class="cn-sec">
        ${ic14(CK[kind].icon, 'fnt')}<h2 class="cn-sec-t">${CK[kind].label}</h2>
        <span class="cn-sec-n">${items.length}개</span>
        <span class="cn-sec-l"></span></div>`));
      const grid = el('<div class="cn-grid"></div>');
      items.forEach(j => grid.appendChild(cnListCard(j)));
      body.appendChild(grid);
    });
    return wrap;
  };


  /* ============================================================
     5. 자격증명 관리
     ------------------------------------------------------------
     원본 «연결 정보» 카드의 «자격증명 관리» 가 여는 곳이다. 목록 한 장에서
     더하고 고치고 지운다 — 항목이 보통 한둘이라 별도 화면을 만들 이유가 없다.

     비밀 값은 저장 뒤 다시 내려오지 않는다(서버가 응답에 싣지 않는다).
     그래서 수정할 때 인증 값 칸은 «저장됨» 으로 비워 두고, 비운 채로 저장하면
     기존 값이 그대로 남는다.
     ============================================================ */

  const CRED_KIND = { param: '쿼리 파라미터', header: '헤더 키', bearer: 'Bearer 토큰' };

  function credModal(onPick) {
    const { m, close } = modal(`<div class="modal-h">
        <span class="modal-t">자격증명 관리</span>
        <button class="iconbtn sp" data-close>${ic('x')}</button></div>
      <div class="modal-b"><div class="col g12" id="crBody"></div></div>
      <div class="modal-f"><button class="btn sp" data-close>닫기</button></div>`);

    const body = $('#crBody', m);
    let editing = null;                       // null | 'new' | credential id

    function paint() {
      body.innerHTML = '';

      body.appendChild(el(`<div class="t12 fnt" style="line-height:1.7">
        커넥터는 여기 등록한 자격증명을 <b>가리키기만</b> 합니다. 값은 커넥터에
        복사되지 않으므로, 키를 새로 받으면 이곳만 고치면 그 키를 쓰는 커넥터가
        모두 함께 바뀝니다.</div>`));

      if (!CREDS.length) {
        body.appendChild(el(`<div class="t12 fnt" style="padding:14px 0">등록된 자격증명이 없습니다.</div>`));
      } else {
        const list = el('<div class="wc-list wc-list--divided" style="border:1px solid var(--line);border-radius:var(--r-m)"></div>');
        CREDS.forEach(c => {
          const row = el(`<div class="wc-list__item cn-li" style="align-items:center">
            <div class="wc-list__main">
              <div class="wc-list__title trunc">${esc(c.name)}</div>
              <div class="wc-list__desc">${esc(CRED_KIND[c.kind] || c.kind)}${
                c.param ? ` · <span class="mono">${esc(c.param)}</span>` : ''} · ${credExpiry(c)}</div>
              ${c.usedBy.length ? `<div class="wc-list__desc cn-mute">커넥터 ${c.usedBy.length}개가 사용 — ${esc(c.usedBy.slice(0, 3).join(', '))}</div>`
                : '<div class="wc-list__desc cn-mute">쓰는 커넥터 없음</div>'}
            </div>
            <span class="row g4" style="flex:none"></span></div>`);
          const acts = $('.row.g4', row);
          if (onPick) {
            acts.appendChild(cnBtn('고르기', 'primary', null, () => { close(); onPick(c); }));
          }
          acts.appendChild(cnBtn('수정', 'secondary', null, () => { editing = c.id; paint(); }));
          const del = el(`<button class="iconbtn" title="지우기">${ic14('trash')}</button>`);
          del.onclick = async () => {
            const ok = await confirmModal({
              title: '자격증명 삭제',
              body: `${c.name} 을(를) 지웁니다.`
                + (c.usedBy.length ? ` 지금 커넥터 ${c.usedBy.length}개가 쓰고 있어 지울 수 없습니다.` : ''),
              ok: '삭제', danger: true, tone: 'warn',
            });
            if (!ok) return;
            try {
              await api(`/credentials/${enc(c.id)}`, { method: 'DELETE' });
              toast(`${c.name} 을(를) 지웠습니다.`);
              await loadCreds(); paint(); render();
            } catch (e) { fail(e); }
          };
          acts.appendChild(del);
          list.appendChild(row);
        });
        body.appendChild(list);
      }

      if (!editing) {
        const add = cnBtn('자격증명 추가', 'secondary', 'plus',
                          () => { editing = 'new'; paint(); }, { size: 'md' });
        body.appendChild(add);
        return;
      }

      /* ── 편집 폼 ── */
      const cur = editing === 'new' ? null : credById(editing);
      const form = el(`<div class="wz-form" style="border-top:1px solid var(--line-2);padding-top:14px">
        ${fld('이름', inp('crName', cur ? cur.name : '', '예) 공공데이터포털 서비스 키'), { req: true,
          msg: '어떤 계정의 키인지 알아볼 수 있는 이름으로 적어 주세요.' })}
        <div class="wz-row" style="grid-template-columns:200px minmax(0,1fr)">
          ${fld('인증 방식', sel('crKind', cur ? cur.kind : 'param',
            [['param', '쿼리 파라미터'], ['header', '헤더 키'], ['bearer', 'Bearer 토큰']]))}
          <div id="crParamBox" style="${(cur ? cur.kind : 'param') === 'bearer' ? 'display:none' : ''}">
            ${fld('파라미터·헤더 이름', inp('crParam', cur ? cur.param : '', 'serviceKey', 'mono'), { req: true })}</div>
        </div>
        <div class="wz-row" style="grid-template-columns:minmax(0,1fr) 200px">
          ${fld('인증 값', `<div class="wc-input wc-input--md"><input class="wc-input__el" type="password"
            id="crSecret" placeholder="${cur ? '저장됨 — 바꿀 때만 입력' : '인증 값'}"></div>`, {
            req: !cur, msg: '저장 뒤에는 화면과 API 응답에서 가려집니다.' })}
          ${fld('만료일', `<div class="wc-input wc-input--md"><input class="wc-input__el" type="date"
            id="crExp" value="${esc(cur && cur.expiresAt ? String(cur.expiresAt).slice(0, 10) : '')}"></div>`, {
            msg: '없으면 비워 두세요.' })}
        </div>
        <div class="row g6"></div></div>`);
      $('#crKind', form).onchange = (e) => {
        $('#crParamBox', form).style.display = e.target.value === 'bearer' ? 'none' : '';
      };
      const acts = $('.row.g6', form);
      acts.appendChild(cnBtn(cur ? '저장' : '추가', 'primary', null, async function () {
        const payload = {
          name: $('#crName', form).value.trim(),
          kind: $('#crKind', form).value,
          param: $('#crParam', form) ? $('#crParam', form).value.trim() : '',
          secret: $('#crSecret', form).value,
          expires_at: $('#crExp', form).value || null,
        };
        if (!payload.name) { toast('자격증명 이름을 입력해 주세요.', 'warn'); return; }
        if (!cur && !payload.secret) { toast('인증 값을 입력해 주세요.', 'warn'); return; }
        this.disabled = true;
        try {
          if (cur) await api(`/credentials/${enc(cur.id)}`, { method: 'PATCH', body: JSON.stringify(payload) });
          else await api('/credentials', { method: 'POST', body: JSON.stringify(payload) });
          toast(cur ? `${payload.name} 을(를) 저장했습니다.` : `${payload.name} 을(를) 등록했습니다.`);
          await loadCreds();
          editing = null; paint(); render();
        } catch (e) { fail(e); this.disabled = false; }
      }, { size: 'md' }));
      acts.appendChild(cnBtn('취소', 'ghost', null, () => { editing = null; paint(); }, { size: 'md' }));
      body.appendChild(form);
    }

    paint();
    return { m, close };
  }


  /* ============================================================
     6. 커넥터 상세
     ============================================================ */
  /* ── 연결된 파이프라인 ──────────────────────────────────────
     원본은 이 카드에 «쓰는 쪽» 과 «읽는 쪽» 을 함께 담는다(pipesWrite + pipesRead).
     둘은 커넥터와의 관계가 반대다:

       쓰는 쪽 — 이 커넥터를 실제로 돌려 raw 에 넣는 실행. 커넥터마다 하나뿐이고,
                예약을 켜면 Airflow DAG 으로 선다.
       읽는 쪽 — 그렇게 들어간 원천을 참조하는 모델을 만드는 파이프라인들.

     한 카드에 두는 이유는 «이걸 건드리면 무엇이 흔들리는가» 가 한눈에 보여야
     해서다. 대신 줄마다 어느 쪽인지 적는다 — 섞어 놓고 구분이 없으면
     읽는 쪽 파이프라인을 «이 커넥터를 돌리는 것» 으로 오해한다. */
  function cnPipeRows(j) {
    const out = [];
    out.push({
      id: j.kind === 'api' ? j.id : null,
      name: `${j.name} 수집`,
      desc: j.kind === 'file'
        ? '적재 · 파일을 올릴 때 실행'
        : `적재 · ${j.trigger_type === 'manual' ? '수동 실행'
            : `${j.freq || '예약 실행'}${cnPaused(j) ? ' (꺼짐)' : ''}`}`,
      write: true,
    });
    const models = cnModels(j);
    cnPipes(j).forEach(p => {
      const mine = (p.targets || []).filter(t => models.some(m => m.id === t));
      out.push({
        id: p.id, name: p.name,
        desc: `조회 · ${mine.slice(0, 2).join(', ')}${mine.length > 2 ? ` 외 ${mine.length - 2}개` : ''} 생성`,
        write: false, status: p.status,
      });
    });
    return out;
  }

  function cnPipeCard(j) {
    const rows = cnPipeRows(j);
    const card = cnCard('연결된 파이프라인', {
      flush: true,
      right: el(`<span class="t12 fnt">${rows.length}개</span>`),
    });
    const list = el('<div class="wc-list wc-list--clickable wc-list--divided"></div>');
    rows.forEach(p => {
      const it = el(`<div class="wc-list__item cn-li">
        <span class="wc-list__lead">${ic14(p.write ? 'down' : 'flow', 'fnt')}</span>
        <div class="wc-list__main"><div class="wc-list__title trunc">${esc(p.name)}</div>
          <div class="wc-list__desc trunc">${esc(p.desc)}</div></div>
        ${p.status ? pipeBadge(p.status) : ''}</div>`);
      if (p.id) it.onclick = () => { openPipeTab(p.id); go('pipeline'); };
      else it.style.cursor = 'default';
      list.appendChild(it);
    });
    cnBody(card).appendChild(list);

    const foot = el(`<div class="wc-card__foot cn-cf">
      <span class="cn-mute">수집 주기·실행은 파이프라인에서 설정합니다.</span></div>`);
    foot.appendChild(cnBtn('파이프라인 열기', 'text', null, () => {
      if (j.kind === 'api') openPipeTab(j.id);
      go('pipeline');
    }));
    card.appendChild(foot);
    return card;
  }

  /* ── 버전 이력 ──────────────────────────────────────────────
     서버가 저장할 때마다 그때의 정의를 통째로 남긴다(ingest_version). 여기서는
     번호·요약·시각만 읽는다. 요약은 서버가 «무엇이 달라졌는지» 를 비교해 만든
     문장이라(_change_note), «2026-08-11 수정» 이 아니라 «컬럼 2개 추가 (…)» 다. */
  function cnVersionCard(j) {
    const box = cnVersions(j);
    const card = cnCard('버전 이력', {
      flush: true,
      right: el(`<span class="t12 fnt">v${j.version || 1}</span>`),
    });
    const b = cnBody(card);

    if (box.loading) { b.appendChild(el('<div class="cn-list-empty">불러오는 중…</div>')); return card; }
    if (box.err) { b.appendChild(el(`<div class="cn-list-empty">읽지 못했습니다 — ${esc(box.err)}</div>`)); return card; }
    if (!box.items.length) { b.appendChild(el('<div class="cn-list-empty">이력이 없습니다.</div>')); return card; }

    const list = el('<div class="wc-list wc-list--divided"></div>');
    box.items.forEach(v => {
      list.appendChild(el(`<div class="wc-list__item cn-li" style="align-items:flex-start">
        <span class="wc-list__lead cn-ver">v${v.ver}</span>
        <div class="wc-list__main">
          <div class="wc-list__title" style="font-weight:var(--fw-reg);white-space:normal">${esc(v.note)}</div>
          <div class="wc-list__desc cn-mute">${esc(cnAt(v.at))}</div></div></div>`));
    });
    b.appendChild(list);

    const foot = el(`<div class="wc-card__foot cn-cf">
      <span class="cn-mute">저장할 때마다 그때의 정의를 함께 남깁니다.</span></div>`);
    card.appendChild(foot);
    return card;
  }

  /* ── 더보기 메뉴 — 자주 쓰지 않는 조작 ── */
  function cnMoreMenu(j, anchor) {
    const pop = el('<div class="cn-menu cn-more"></div>');
    const item = (icon, label, fn, danger) => {
      const b = el(`<button type="button" class="cn-menu-i ${danger ? 'dngr' : ''}">
        <span class="cn-menu-c">${ic14(icon)}</span><span class="f1">${esc(label)}</span></button>`);
      b.onclick = () => { pop.remove(); fn(); };
      return b;
    };
    pop.appendChild(item('flow', '파이프라인에서 보기', () => {
      if (j.kind === 'api') openPipeTab(j.id);
      go('pipeline');
    }));
    pop.appendChild(item('rot', '수집 데이터 다시 읽기', () => { delete PREV[j.id]; render(); }));
    pop.appendChild(item('trash', '커넥터 삭제', () => ingDelete(j), true));
    anchor.appendChild(pop);
    setTimeout(() => document.addEventListener('click', () => pop.remove(), { once: true }), 0);
  }

  ingDetailView = function (j) {
    const st = cnState(j);
    const cfg = j.config || {};
    const sc = j.scope || {};
    const cols = j.columns || [];
    const src = cnSource(j);

    const wrap = el(`<div class="f1 col" style="min-height:0">
      <div class="f1 col cn-scroll"><div class="cn-page"></div></div></div>`);
    const page = $('.cn-page', wrap);

    /* ── 머리 ── */
    const head = el(`<div class="cn-head">
      <div class="cn-head-t">
        <div style="min-width:0">
          <div class="row g8" style="align-items:center;flex-wrap:wrap">
            <h1 class="cn-h2 trunc">${esc(j.name)}</h1>
            <span class="wc-badge cn-kb">${esc(ckOf(j).label)}</span>
            ${cnBadge(st)}</div>
          <p class="page-d mono">${esc(j.phys)}</p></div>
        <div class="row g6" style="flex:none;position:relative"></div></div></div>`);
    const acts = $('.cn-head-t .row.g6', head);

    acts.appendChild(cnBtn(j.kind === 'file' ? '파일 올리기' : '지금 실행',
      'secondary', j.kind === 'file' ? 'save' : 'play', () => ingRunNow(j), { size: 'md' }));

    const testBtn = cnBtn('연결 테스트', 'secondary', 'link', async function () {
      const b = this;
      b.disabled = true;
      const label = b.querySelector('span');
      const prev = label.textContent;
      label.textContent = '확인 중…';
      const r = await cnCheck(j);
      delete PREV[j.id];
      if (b.isConnected) { b.disabled = false; label.textContent = prev; }
      toast(r.state === 'ok' ? `연결됩니다 — 컬럼 ${r.cols}개 · 표본 ${r.rows}건`
            : r.state === 'skip' ? r.msg
            : r.state === 'empty'
              ? `연결됩니다 — 다만 이 조건(${cnProbeLine(r).trim() || '조건 없음'})에는 자료가 없습니다.`
              : `연결하지 못했습니다 — ${r.msg}`,
            r.state === 'err' ? 'err' : '');
      render();
    }, { size: 'md', off: j.kind === 'file' });
    if (j.kind === 'file') testBtn.title = '파일 커넥터는 붙을 원천이 없습니다 — 올릴 때 그 자리에서 읽습니다.';
    acts.appendChild(testBtn);

    acts.appendChild(cnBtn('수정', 'secondary', 'pen', () => openWizard(j), { size: 'md' }));
    const more = el(`<button type="button" class="wc-iconbtn wc-iconbtn--md wc-iconbtn--outlined"
      title="더보기">${ic14('dots')}</button>`);
    more.onclick = (ev) => { ev.stopPropagation(); cnMoreMenu(j, acts); };
    acts.appendChild(more);
    page.appendChild(head);

    /* ── 본문 2단 ── */
    const body = el('<div class="cn-body cn-2col"></div>');
    const main = el('<div class="cn-main"></div>');
    const rail = el('<div class="cn-rail"></div>');
    body.appendChild(main);
    body.appendChild(rail);
    page.appendChild(body);

    /* ① 연결 정보 — 원본의 «자격증명 관리» 가 여기 붙는다 */
    const credBtn = cnBtn('자격증명 관리', 'ghost', null, () => credModal(null));
    const c1 = cnCard('연결 정보', { right: j.kind === 'api' ? credBtn : null });
    const cred = j.credential;
    const authKind = (cfg.auth || {}).kind || '';
    const params = cfg.params || {};
    const secrets = new Set(cfg.secret_params || []);


    const authCell = !authKind
      ? '없음'
      : cred
        ? `${esc(AUTH_LABEL[authKind])} ${cnTag(cred.name)} ${credExpiry(cred)}`
        : `${esc(AUTH_LABEL[authKind])} ${cnTag((cfg.auth || {}).name || 'Authorization')}`
          + ' <span class="cn-mute">· 커넥터에 직접 입력됨 — 수정에서 자격증명으로 옮길 수 있습니다</span>';

    cnBody(c1).appendChild(cnKv(j.kind === 'api'
      ? [
          ['요청 주소', `<span class="mono cn-break">${esc(cfg.method || 'GET')} ${esc(cfg.url || '—')}</span>`],
          ['레코드 경로', `<span class="mono">${esc(cfg.record_path || '(응답 전체)')}</span>`],
          ['인증', authCell],
          Object.keys(params).length
            ? ['요청 파라미터', Object.keys(params).map(k =>
                `<span class="cn-p">${cnTag(k)}<span class="mono cn-mute">${
                  secrets.has(k) ? '••••••' : esc(String(params[k]))}</span></span>`).join('')]
            : null,
          (cfg.page || {}).param
            ? ['페이지 나눔', `<span class="mono">${esc(cfg.page.param)}</span>`
                + ` <span class="cn-mute">· 한 번에 ${esc(String(cfg.page.size || '—'))}건</span>`]
            : ['페이지 나눔', '<span class="cn-mute">쓰지 않음 · 한 번만 부릅니다</span>'],
          ['연결 확인', cnCheckLine(j)],
        ]
      : [
          ['파일 형식', cfg.format === 'jsonl' ? 'JSON Lines' : 'CSV'],
          ['시트·구분자', cfg.format === 'jsonl'
            ? '<span class="cn-mute">한 줄에 JSON 하나 · 헤더 없음</span>'
            : `<span class="mono">${esc(cfg.delimiter || ',')}</span> 구분 · 헤더 1행`],
          ['올리는 방법', '<span class="cn-mute">위 «파일 올리기» 로 그 자리에서 적재합니다. 원본 파일은 보관하지 않습니다.</span>'],
        ]));
    main.appendChild(c1);

    /* ② 적재 설정 */
    const c2 = cnCard('적재 설정');
    const fan = sc.fanout || {};
    const dedupeCell = j.dedupe
      ? `<span class="mono">${esc(j.dedupe)}</span> 기준 마지막 값 유지`
        + (j.mode === 'append'
          ? ' <span class="cn-mute">· 한 번의 적재 안에서만 봅니다</span>'
          : ' <span class="cn-mute">· 전체 적재라 테이블 전체에 적용됩니다</span>')
      : '없음 <span class="cn-mute">· 원본 그대로 적재</span>';
    cnBody(c2).appendChild(cnKv([
      ['적재 대상', `<span class="mono b6">${esc(j.phys)}</span>`],
      ['적재 방식', `${esc(LOAD_MODE[j.mode] || j.mode)}`
        + ` <span class="cn-mute">· ${j.mode === 'append' ? '가져온 만큼 뒤에 쌓습니다'
            : '기존 데이터를 지우고 새로 넣습니다'}</span>`],
      ['중복 기준', dedupeCell],
      j.kind === 'api' ? ['수집 범위', `${esc(SCOPE_MODE[sc.mode || 'full'])}`
        + (sc.mode === 'incremental'
          ? ` <span class="cn-mute">· ${esc(sc.unit === 'month' ? '월' : '일')} 단위 · ${esc(sc.format || 'YYYY-MM-DD')}`
            + `${sc.overlap ? ` · 겹침 ${sc.overlap}` : ''}</span>`
          : '')] : null,
      (sc.mode === 'incremental' && j.watermark)
        ? ['마지막 수집 지점', `<span class="mono">${esc(j.watermark)}</span>`
            + ' <span class="cn-mute">· 다음 실행은 여기부터 이어갑니다</span>'] : null,
      fan.param ? ['반복 파라미터', `<span class="mono">${esc(fan.param)}</span>`
        + ` <span class="cn-mute">· 값 ${(fan.values || []).length}개</span>`] : null,
      j.kind === 'api' ? ['실행 방식', j.trigger_type === 'manual' ? '수동 실행'
        : `예약 실행 <span class="cn-mute">· ${esc(j.freq || '')}</span>`
          + (cnPaused(j) ? ' <span style="color:var(--w-warning)">· 지금은 꺼져 있습니다</span>' : '')] : null,
      ['최근 실행', cnRunLine(j)],
    ]));
    main.appendChild(c2);

    /* ③ 적재 컬럼 */
    const c3 = cnCard('적재 컬럼', { right: el(`<span class="t12 fnt">${cols.length}개</span>`) });
    const b3 = cnBody(c3);
    b3.appendChild(el(`<div class="cn-cols">${cols.length
      ? cols.map(c => `<span class="wc-tag cn-tag mono">${esc(c.name)}</span>`).join('')
      : '<span class="t12 fnt">없음</span>'}</div>`));
    b3.appendChild(el(`<p class="cn-hint">모두 문자열로 넣습니다.
      타입을 정하고 값을 다듬는 일은 데이터 모델이 맡습니다 —
      수집은 원본을 그대로 넣어 언제든 다시 해석할 수 있게 둡니다.</p>`));
    main.appendChild(c3);

    /* ④ 수집 데이터 미리보기 — 적재된 결과를 웨어하우스에서 직접 읽는다 */
    const rf = el(`<button class="iconbtn" title="다시 읽기">${ic14('rot')}</button>`);
    rf.onclick = () => { delete PREV[j.id]; render(); };
    const p = src ? cnPreview(j) : null;
    const note = el(`<span class="t12 fnt">${!src ? '적재 이력 없음'
      : p.loading ? '읽는 중…'
      : p.err ? '읽지 못함'
      : `${esc(j.phys)} 기준`}</span>`);
    const c4 = el(`<div class="wc-card cn-card">
      <div class="wc-card__head">
        <div style="min-height:0;justify-content:center;flex-direction:row;align-items:center;gap:4px">
          <span class="wc-card__title">수집 데이터 미리보기</span></div></div>
      <div class="wc-card__body wc-card__body--flush"></div></div>`);
    const c4h = $('.wc-card__head > div', c4);
    if (src) c4h.appendChild(rf);
    $('.wc-card__head', c4).appendChild(note);
    const b4 = $('.wc-card__body', c4);

    if (!src) {
      b4.appendChild(el(`<div class="cn-list-empty">아직 적재된 적이 없습니다.
        ${j.kind === 'file' ? '파일을 올리면' : '«지금 실행» 을 누르면'} 여기에 들어간 값이 보입니다.</div>`));
    } else if (p.loading) {
      b4.appendChild(el('<div class="cn-list-empty">불러오는 중…</div>'));
    } else if (p.err) {
      b4.appendChild(el(`<div class="cn-list-empty">읽지 못했습니다 — ${esc(p.err)}</div>`));
    } else if (!p.rows.length) {
      b4.appendChild(el('<div class="cn-list-empty">테이블이 비어 있습니다.</div>'));
    } else {
      b4.appendChild(el(`<div class="wc-table wc-table--compact cn-tbl">
        <div class="wc-table__scroll"><table>
          <thead><tr>${p.cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
          <tbody>${p.rows.map(r => `<tr>${r.map(v =>
            `<td class="mono">${esc(fmtCell(v))}</td>`).join('')}</tr>`).join('')}</tbody>
        </table></div></div>`));
    }
    /* 원본의 바닥 문장 — «여기 보이는 것이 전부가 아니다» 와 «전체는 어디서 보나» 다.
       뒤쪽을 글자로만 두지 않고 실제로 그 자리로 가는 단추를 붙인다. */
    const f4 = el(`<div class="wc-card__foot cn-cf"><span class="cn-mute">${src && p && p.rows && p.rows.length
      ? `앞 ${p.rows.length}행만 보여줍니다${p.total != null ? ` · 전체 ${Number(p.total).toLocaleString()}행` : ''}. 전체 값은 데이터 모델에서 확인합니다.`
      : '적재된 값은 데이터 모델에서 확인합니다.'}</span></div>`);
    f4.appendChild(cnBtn(src ? '데이터 모델에서 보기' : '데이터 모델 만들기', 'text', null, () => {
      if (!src) return;
      go('modeling', src.id); S.dockTab = 'preview'; S.dockMin = false; render();
    }, { off: !src }));
    c4.appendChild(f4);
    main.appendChild(c4);

    /* ── 오른쪽: 연결된 파이프라인 · 버전 이력 (원본과 같은 두 장) ── */
    rail.appendChild(cnPipeCard(j));
    rail.appendChild(cnVersionCard(j));

    return wrap;
  };


  /* ============================================================
     7. 커넥터 만들기 · 수정 — 4단계 위저드
     ------------------------------------------------------------
     모달을 탭 화면으로 옮긴다. 옮기면서 지켜야 하는 것 두 가지:

     ① **입력 상태는 렌더를 넘어 살아남아야 한다.** 이 앱의 render() 는 페이지를
        통째로 다시 만든다. 위저드를 매번 다시 그리면 글자를 치는 동안 포커스와
        캐럿이 날아간다. 그래서 위저드의 DOM 은 한 번만 만들고(WIZ.node) 렌더마다
        같은 노드를 다시 붙인다 — 모달이 그랬던 것처럼 자기 안은 자기가 갱신한다.
     ② **모든 값의 원천은 WIZ.st 하나다.** 단계를 넘길 때 지금 단계의 입력을
        st 로 걷어 들이고(readStep), 되돌아오면 st 에서 다시 그린다. 그래야 3단계에
        갔다 2단계로 돌아와도 값이 남는다.

     서버 규약은 모달과 완전히 같다 — 미리보기(/ingest/preview)로 컬럼을 확정하고,
     저장은 POST/PATCH /ingest/jobs 하나다. 마스킹된 인증 값을 그대로 돌려보내면
     서버가 저장된 값을 되살린다(_keep_secrets).
     ============================================================ */

  let WIZ = null;

  const STEPS = [
    { key: 'kind', label: '유형 선택' },
    { key: 'conn', label: '연결 정보' },
    { key: 'load', label: '적재 설정' },
    { key: 'done', label: '확인' },
  ];

  function openWizard(job) {
    WIZ = { key: job ? job.id : 'new', job: job || null, node: null, st: wizInit(job) };
    S.openIng = 'wiz';
    render();
  }

  function closeWizard() {
    if (WIZ && WIZ.abort) WIZ.abort();
    const back = WIZ && WIZ.job ? WIZ.job.id : 'list';
    WIZ = null;
    S.openIng = (back !== 'list' && S.openIngs.includes(back)) ? back : 'list';
    render();
  }

  function wizInit(job) {
    const cfg = Object.assign({ method: 'GET', format: 'csv', delimiter: ',' },
                              job ? (job.config || {}) : {});
    const sc = (job && job.scope) || {};
    return {
      step: job ? 1 : 0,                    // 수정은 유형을 바꿀 수 없어 연결 정보부터
      edit: !!job,
      name: job ? job.name : '',
      kind: job ? job.kind : 'api',
      target: job ? job.target : '',
      mode: job ? job.mode : 'append',
      /* 중복 기준은 컬럼 이름의 목록이다. 문자열로 들고 있다가 오타가 나면
         («regoin_cd») 그 기준으로는 모든 행이 같은 키가 되어 테이블이 1행으로
         줄어든다 — 오류도 나지 않는다. 그래서 화면은 감지된 컬럼에서 고르게만 한다. */
      dedupe: (job && job.dedupe ? String(job.dedupe).split(',').map(s => s.trim()).filter(Boolean) : []),
      trigger: job ? (job.trigger_type || 'schedule') : 'schedule',
      freq: (job && job.freq && job.freq !== '수동 실행') ? job.freq
            : FREQS.filter(f => f !== '수동 실행')[0],
      cfg,
      /* 요청 파라미터는 객체가 아니라 줄의 배열로 들고 있는다 — 객체로 두면
         이름을 지우는 동안(빈 키) 줄이 서로 합쳐진다. */
      params: Object.keys(cfg.params || {}).map(k => ({
        k, v: String((cfg.params || {})[k]),
        secret: (cfg.secret_params || []).includes(k),
      })),
      scope: {
        mode: sc.mode || 'full', shape: sc.shape || 'range', unit: sc.unit || 'day',
        format: sc.format || 'YYYY-MM-DD', initial_start: sc.initial_start || '',
        overlap: Number(sc.overlap || 0),
        start_param: sc.start_param || '', end_param: sc.end_param || '', param: sc.param || '',
        fanoutParam: (sc.fanout || {}).param || '',
        fanoutValues: ((sc.fanout || {}).values || []).join('\n'),
        maxCalls: sc.max_calls_per_run || '',
      },
      cols: job ? (job.columns || []).slice() : [],
      rows: [], sampled: null, file: null,
      prev: { state: job ? 'idle' : 'idle' },
    };
  }

  /* ---------------------------------------------------------- 설정 조립 */

  /* st → 서버가 받는 config. 모달의 readCfg 와 같은 모양이어야 한다. */
  function wizCfg(st) {
    if (st.kind === 'file') {
      return { format: st.cfg.format || 'csv', delimiter: st.cfg.delimiter || ',' };
    }
    const cfg = { url: (st.cfg.url || '').trim(), method: st.cfg.method || 'GET',
                  record_path: (st.cfg.record_path || '').trim() };
    const a = st.cfg.auth || {};
    if (a.credential_id) {
      /* 참조만 보낸다. 이름·값·만료는 자격증명이 들고 있고, 서버가 요청을 보낼 때
         펼친다(ingest.resolve_auth). 여기서 값을 함께 실어 보내면 사본이 생긴다. */
      const c = credById(a.credential_id);
      cfg.auth = { kind: (c && c.kind) || a.kind || 'param', credential_id: a.credential_id };
    } else if (a.kind === 'bearer') cfg.auth = { kind: 'bearer', token: a.token || '' };
    else if (a.kind === 'header' || a.kind === 'param')
      cfg.auth = { kind: a.kind, name: (a.name || '').trim(), value: a.value || '' };

    const rows = st.params.filter(p => (p.k || '').trim());
    if (rows.length) {
      cfg.params = {};
      rows.forEach(p => { cfg.params[p.k.trim()] = p.v; });
      const sec = rows.filter(p => p.secret).map(p => p.k.trim());
      if (sec.length) cfg.secret_params = sec;
    }
    const pg = st.cfg.page || {};
    if ((pg.param || '').trim()) {
      cfg.page = { param: pg.param.trim(), size_param: (pg.size_param || '').trim(),
                   size: Number(pg.size) || 0, total_path: (pg.total_path || '').trim() };
    }
    if (Number(st.cfg.pause) > 0) cfg.pause = Number(st.cfg.pause);
    return cfg;
  }

  function wizScope(st) {
    if (st.kind === 'file') return { mode: 'full' };
    const s = st.scope;
    const out = s.mode === 'incremental'
      ? { mode: 'incremental', shape: s.shape, unit: s.unit, format: s.format,
          initial_start: s.initial_start, overlap: Number(s.overlap) || 0 }
      : { mode: 'full' };
    if (s.mode === 'incremental') {
      if (s.shape === 'range') {
        out.start_param = (s.start_param || '').trim();
        out.end_param = (s.end_param || '').trim();
      } else {
        out.param = (s.param || '').trim();
      }
    }
    const fp = (s.fanoutParam || '').trim();
    if (fp) out.fanout = { param: fp, values: wizFanValues(s.fanoutValues) };
    const mx = Number(s.maxCalls);
    if (mx > 0) out.max_calls_per_run = mx;
    return out;
  }

  const wizFanValues = (text) =>
    String(text || '').split(/[\s,]+/).map(x => x.trim()).filter(Boolean);

  /* ---------------------------------------------------------- 미리보기(=연결 테스트)

     모달의 자동 미리보기를 그대로 옮긴다 — 디바운스 · 이전 요청 취소 · 느릴 때 안내.
     위저드에서는 결과가 오른쪽 레일에 고정돼 입력과 나란히 보인다. */

  const SLOW_MS = 2500, DEBOUNCE_MS = 700;

  function wizAbort() {
    if (!WIZ) return;
    clearTimeout(WIZ.slowTimer);
    if (WIZ.ctrl) { WIZ.ctrl.abort(); WIZ.ctrl = null; }
  }

  function wizCanPrev(st) {
    if (st.kind === 'file') return !!st.file;
    return /^https?:\/\/\S+/i.test((st.cfg.url || '').trim());
  }

  function wizSig(st) {
    return st.kind === 'api'
      ? JSON.stringify(wizCfg(st))
      : `${st.file ? st.file.name + ' ' + st.file.size : ''}|${st.cfg.format}|${st.cfg.delimiter}`;
  }

  function wizSchedule(delay) {
    if (!WIZ) return;
    clearTimeout(WIZ.timer);
    WIZ.timer = setTimeout(() => wizRunPrev(), delay == null ? DEBOUNCE_MS : delay);
  }

  async function wizRunPrev(force) {
    const w = WIZ;
    if (!w || !w.node || !w.node.isConnected) return;
    const st = w.st;
    if (!wizCanPrev(st)) {
      wizAbort();
      st.cols = []; st.rows = []; st.sampled = null; w.sig = '';
      if (st.prev.state !== 'canceled') st.prev = { state: 'idle' };
      wizPaint();
      return;
    }
    const sig = wizSig(st);
    if (!force && sig === w.sig && st.prev.state === 'ok') return;
    w.sig = sig;

    wizAbort();
    const ctrl = new AbortController();
    w.ctrl = ctrl;
    st.prev = { state: 'loading', slow: false };
    wizPaint();
    w.slowTimer = setTimeout(() => {
      if (w.ctrl === ctrl && st.prev.state === 'loading') { st.prev.slow = true; wizPaint(); }
    }, SLOW_MS);

    try {
      const cfg = wizCfg(st);
      let r;
      if (st.kind === 'api') {
        // 수정 화면은 비밀 값이 마스킹되어 내려온다. job_id 를 함께 보내야
        // 서버가 저장된 인증키를 채워 넣어 원천에 붙을 수 있다.
        r = await api('/ingest/preview', { method: 'POST', signal: ctrl.signal,
          body: JSON.stringify({ kind: 'api', config: cfg, job_id: w.job ? w.job.id : null }) });
      } else {
        const fd = new FormData(); fd.append('file', st.file);
        r = await apiForm(`/ingest/preview/file?format=${enc(cfg.format)}&delimiter=${enc(cfg.delimiter)}`,
                          fd, ctrl.signal);
      }
      if (ctrl.signal.aborted || !w.node.isConnected) return;
      const got = r.columns || [];
      st.rows = r.rows || []; st.sampled = r.sampled;
      if (got.length) {
        st.cols = got;
        st.prev = { state: 'ok', at: nowLabel() };
      } else {
        /* 붙기는 했는데 행이 하나도 오지 않았다.

           이것을 «성공» 이라고 부르면 안 된다 — 컬럼을 하나도 못 봤으니 적재할
           것을 아직 모르는 상태다. 그리고 **이미 알던 컬럼을 지우지 않는다.**
           수정 화면에서 조회 조건이 마침 빈 구간을 가리키면(공공 API 는 흔하다)
           저장돼 있던 컬럼이 통째로 날아가고, 그 상태로는 저장도 막혀서
           «이름 한 글자 고치기» 조차 못 하게 된다. */
        st.prev = { state: 'empty', at: nowLabel(), kept: st.cols.length };
      }
      // 대상 이름을 비워 뒀으면 파일 이름에서 하나 지어 준다
      if (!st.target.trim() && st.kind === 'file' && st.file) {
        st.target = 'raw_' + st.file.name.replace(/\.[^.]+$/, '')
          .toLowerCase().replace(/[^a-z0-9_]/g, '_');
      }
    } catch (e) {
      if (e.name === 'AbortError' || ctrl.signal.aborted) return;   // 끊은 것은 실패가 아니다

      st.rows = []; st.sampled = null;
      w.sig = '';                                  // 같은 설정으로 다시 시도할 수 있게 둔다
      st.prev = { state: 'error', error: e.message || '요청이 실패했습니다.',
                  kept: st.cols.length };
    } finally {
      clearTimeout(w.slowTimer);
      if (w.ctrl === ctrl) w.ctrl = null;
      if (w.node.isConnected) wizPaint();
    }
  }

  /* ---------------------------------------------------------- 위저드 그리기 */

  /* 지금 단계의 입력을 st 로 걷어 들인다. 단계를 넘기기 전에 반드시 부른다. */
  function wizRead() {
    const w = WIZ, n = w && w.node;
    if (!n) return;
    const st = w.st;
    const v = (id) => { const x = $('#' + id, n); return x ? x.value : null; };
    const setIf = (key, id) => { const x = v(id); if (x != null) st[key] = x; };

    setIf('name', 'wzName');
    setIf('target', 'wzTarget');
    setIf('mode', 'wzMode');
    setIf('trigger', 'wzTrig');
    setIf('freq', 'wzFreq');

    if (st.kind === 'api') {
      ['method', 'url', 'record_path'].forEach(k => {
        const x = v('wz_' + k); if (x != null) st.cfg[k] = x;
      });
      const ak = v('wzAuthK');
      if (ak != null) {
        const a = st.cfg.auth || (st.cfg.auth = {});
        a.kind = ak;
        const byCred = $('#wzAuthSrc button.on', n)
          && $('#wzAuthSrc button.on', n).dataset.v === 'cred';
        if (byCred) {
          const cv = v('wzCred');
          if (cv != null) a.credential_id = cv;
          const c = credById(a.credential_id);
          if (c) a.kind = c.kind;
        } else {
          delete a.credential_id;
          const an = v('wzAuthN'), av = v('wzAuthV');
          if (an != null) a.name = an;
          if (av != null) { if (ak === 'bearer') a.token = av; else a.value = av; }
        }
      }
      // 중복 기준 — 칩으로 고른 것만 들어온다(자유 입력 없음)
      const chips = $$('.wz-dd.on', n);
      if ($('.wz-dd', n)) st.dedupe = chips.map(c => c.dataset.col);
      const pg = st.cfg.page || (st.cfg.page = {});
      [['param', 'wzPgP'], ['size_param', 'wzPgS'], ['size', 'wzPgN'], ['total_path', 'wzPgT']]
        .forEach(([k, id]) => { const x = v(id); if (x != null) pg[k] = x; });
      const ps = v('wzPause'); if (ps != null) st.cfg.pause = ps;

      const s = st.scope;
      [['shape', 'wzScShape'], ['unit', 'wzScUnit'], ['format', 'wzScFmt'],
       ['initial_start', 'wzScInit'], ['overlap', 'wzScOv'],
       ['start_param', 'wzScSp'], ['end_param', 'wzScEp'], ['param', 'wzScP'],
       ['fanoutParam', 'wzFoP'], ['fanoutValues', 'wzFoV'], ['maxCalls', 'wzMaxCalls']]
        .forEach(([k, id]) => { const x = v(id); if (x != null) s[k] = x; });

      // 요청 파라미터 — 줄 단위로 읽는다
      const rows = $$('.wz-prow', n);
      if (rows.length) {
        st.params = rows.map(r => ({
          k: $('.wz-pk', r).value,
          v: $('.wz-pv', r).value,
          secret: $('.wz-ps', r).classList.contains('on'),
        }));
      }
    } else {
      ['format', 'delimiter'].forEach(k => {
        const x = v('wz_' + k); if (x != null) st.cfg[k] = x;
      });
    }
  }

  /* 오른쪽 레일(연결 테스트)만 다시 그린다 — 입력 칸은 건드리지 않는다 */
  function wizPaint() {
    const w = WIZ;
    if (!w || !w.node) return;
    const host = $('#wzRail', w.node);
    if (host) { host.innerHTML = ''; host.appendChild(wizTestCard()); }
    const foot = $('#wzFoot', w.node);
    if (foot) wizFoot(foot);
    // 확인 단계는 미리보기 결과가 본문이라 통째로 다시 그린다
    if (w.st.step === 3) wizStepBody();
  }

  /* 단계 표시줄 */
  function wizSteps() {
    const st = WIZ.st;
    const bar = el('<div class="wz-steps"></div>');
    STEPS.forEach((s, i) => {
      if (i) bar.appendChild(el('<span class="wz-steps-l"></span>'));
      const done = i < st.step, cur = i === st.step;
      const b = el(`<button type="button" class="wz-step ${cur ? 'on' : ''} ${done ? 'done' : ''}"
        ${st.edit && i === 0 ? 'disabled title="수정에서는 유형을 바꿀 수 없습니다."' : ''}>
        <span class="wz-step-n">${done ? ic14('check') : `<span class="mono">${i + 1}</span>`}</span>
        <span class="wz-step-l">${esc(s.label)}</span></button>`);
      // 이미 지난 단계로는 되돌아갈 수 있다 — 앞으로는 «다음» 이 검사를 거친다
      if (done && !(st.edit && i === 0)) b.onclick = () => wizGo(i);
      bar.appendChild(b);
    });
    return bar;
  }

  function wizGo(to) {
    const st = WIZ.st;
    if (to > st.step) { if (!wizValidate(st.step)) return; }
    else wizRead();
    st.step = to;
    wizStepBody();
    wizPaint();
    const sc = $('.wz-scroll', WIZ.node);
    if (sc) sc.scrollTop = 0;
  }

  /* 앞으로 넘어가기 전 검사. 못 넘어가는 이유를 그 자리에서 말한다. */
  function wizValidate(step) {
    wizRead();
    const st = WIZ.st;
    if (step === 1) {
      if (!st.name.trim()) { toast('커넥터 이름을 입력해 주세요.', 'warn'); return false; }
      if (st.kind === 'api' && !/^https?:\/\/\S+/i.test((st.cfg.url || '').trim())) {
        toast('요청 주소를 http:// 또는 https:// 로 시작하게 입력해 주세요.', 'warn'); return false;
      }
      if (!st.cols.length) {
        toast(st.prev.state === 'empty'
          ? '가져온 행이 없어 적재할 컬럼을 아직 모릅니다. 레코드 경로와 조회 조건을 확인해 주세요.'
          : '연결 테스트로 컬럼을 먼저 확인해야 다음으로 갈 수 있습니다.', 'warn');
        return false;
      }
    }
    if (step === 2) {
      if (!st.target.trim()) { toast('적재 대상 테이블 이름을 입력해 주세요.', 'warn'); return false; }
      if (!/^[a-z][a-z0-9_]*$/.test(st.target.trim())) {
        toast('테이블 이름은 소문자로 시작하고 소문자·숫자·밑줄만 씁니다.', 'warn'); return false;
      }
      const sc = wizScope(st);
      if (sc.mode === 'incremental') {
        const missing = sc.shape === 'range'
          ? (!sc.start_param || !sc.end_param) && '시작일·종료일 파라미터 이름'
          : !sc.param && '기준 파라미터 이름';
        if (missing) { toast(`증분 수집의 ${missing}을(를) 입력해 주세요.`, 'warn'); return false; }
        if (!sc.initial_start) { toast('초기 수집 시작일을 골라 주세요.', 'warn'); return false; }
      }
      if (sc.fanout && !sc.fanout.values.length) {
        toast('반복 파라미터의 부를 값을 한 줄에 하나씩 적어 주세요.', 'warn'); return false;
      }
      if (!sc.fanout && String(st.scope.fanoutValues || '').trim()) {
        toast('반복 파라미터의 이름을 입력해 주세요.', 'warn'); return false;
      }
    }
    return true;
  }

  /* ---------------------------------------------------------- 입력 조각 */

  const fld = (label, inner, o) => `<div class="wz-f ${(o && o.cls) || ''}">
    <span class="wz-f-l">${esc(label)}${o && o.req ? '<b class="wz-req">*</b>' : ''}</span>
    ${inner}${o && o.msg ? `<span class="wz-f-m">${o.msg}</span>` : ''}</div>`;

  const inp = (id, val, ph, cls) => `<div class="wc-input wc-input--md">
    <input class="wc-input__el ${cls || ''}" id="${id}" value="${esc(val == null ? '' : String(val))}"
      placeholder="${esc(ph || '')}"></div>`;

  const sel = (id, val, opts) => `<div class="wc-input wc-select wc-input--md">
    <select class="wc-select__el" id="${id}">${opts.map(([v, l]) =>
      `<option value="${esc(v)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
    <span class="wc-select__caret">${ic14('chevd', 'fnt')}</span></div>`;

  /* ---------------------------------------------------------- 단계별 본문 */

  function wizStepBody() {
    const w = WIZ;
    const host = $('#wzBody', w.node);
    if (!host) return;
    host.innerHTML = '';
    host.appendChild(wizSteps());
    const cols = el(`<div class="wz-cols ${w.st.step === 0 ? 'one' : ''}"></div>`);
    host.appendChild(cols);

    const main = el('<div class="wz-main"></div>');
    cols.appendChild(main);
    if (w.st.step !== 0) {
      const rail = el('<div class="wz-rail" id="wzRail"></div>');
      rail.appendChild(wizTestCard());
      cols.appendChild(rail);
    }

    ({ 0: wizKindStep, 1: wizConnStep, 2: wizLoadStep, 3: wizDoneStep })[w.st.step](main);

    const foot = el('<div class="wz-foot" id="wzFoot"></div>');
    main.appendChild(foot);
    wizFoot(foot);
  }

  /* ── 단계 1 — 유형 선택 ── */
  function wizKindStep(main) {
    const st = WIZ.st;
    const card = el(`<div class="wc-card cn-card"><div class="wc-card__head">
      <div style="min-height:0"><span class="wc-card__title">어디에서 가져오나요?</span>
      <span class="wc-card__sub">유형에 따라 다음 단계에서 물어보는 것이 달라집니다.</span></div></div>
      <div class="wc-card__body"><div class="wz-kinds"></div></div></div>`);
    const host = $('.wz-kinds', card);
    [['api', 'REST API', 'HTTP 로 부르는 주소에서 가져옵니다. 예약 실행으로 주기적으로 받을 수 있습니다.'],
     ['file', '파일 업로드', 'CSV · JSON Lines 파일을 올려 그 자리에서 적재합니다. 예약 실행은 없습니다.']]
      .forEach(([k, label, desc]) => {
        const b = el(`<button type="button" class="wz-kind ${st.kind === k ? 'on' : ''}">
          <span class="wz-kind-i">${ic(CK[k].icon)}</span>
          <span class="col g4" style="min-width:0;text-align:left">
            <span class="t13 b6">${esc(label)}</span>
            <span class="t12 fnt" style="line-height:1.6">${esc(desc)}</span></span>
          <span class="wz-kind-c">${st.kind === k ? ic14('checkc') : ''}</span></button>`);
        b.onclick = () => {
          if (st.kind !== k) {
            st.kind = k;
            // 유형이 바뀌면 앞서 잡은 컬럼은 뜻이 없다 — 다시 확인해야 한다.
            st.cols = []; st.rows = []; st.sampled = null; st.file = null;
            st.prev = { state: 'idle' };
            WIZ.sig = '';
          }
          wizStepBody();
        };
        host.appendChild(b);
      });
    main.appendChild(card);
  }

  /* ── 단계 2 — 연결 정보 ── */
  function wizConnStep(main) {
    const st = WIZ.st;
    const a = st.cfg.auth || {};
    const card = el(`<div class="wc-card cn-card">
      <div class="wc-card__head"><div style="min-height:0">
        <span class="wc-card__title">연결 정보</span>
        <span class="wc-card__sub">${esc(CK[st.kind].label)}</span></div></div>
      <div class="wc-card__body wz-form"></div></div>`);
    const f = $('.wz-form', card);
    if (!st.edit) {
      const chg = cnBtn('유형 변경', 'ghost', null, () => wizGo(0));
      $('.wc-card__head', card).appendChild(chg);
    }

    f.appendChild(el(fld('커넥터명', inp('wzName', st.name, '예) 아파트 매매 실거래'), { req: true })));

    if (st.kind === 'api') {
      f.appendChild(el(`<div class="wz-row" style="grid-template-columns:110px minmax(0,1fr)">
        ${fld('메서드', sel('wz_method', st.cfg.method, [['GET', 'GET'], ['POST', 'POST']]))}
        ${fld('요청 주소', inp('wz_url', st.cfg.url, 'https://apis.data.go.kr/...', 'mono'), {
          req: true,
          msg: `날짜 자리표시자를 쓸 수 있습니다 — <span class="mono">{{ ymd }}</span> ·
                <span class="mono">{{ ym }}</span> · <span class="mono">{{ date }}</span>,
                뒤에 <span class="mono">-1</span> 을 붙이면 하루(ym 은 한 달) 전입니다.`,
        })}</div>`));

      f.appendChild(el(`<div class="wz-row" style="grid-template-columns:minmax(0,1fr) 200px">
        ${fld('레코드 경로', inp('wz_record_path', st.cfg.record_path, '예) response.body.items.item', 'mono'), {
          msg: '응답에서 배열이 시작되는 위치입니다. 응답 자체가 배열이면 비워 두세요.' })}
        ${fld('인증', sel('wzAuthK', a.kind || '', [['', '없음'], ['bearer', 'Bearer 토큰'],
          ['header', '헤더 키'], ['param', '쿼리 파라미터']]))}</div>`));

      /* 인증 값을 어디에 둘 것인가 — 저장된 자격증명을 가리키거나, 이 커넥터
         안에 직접 넣거나. 자격증명 쪽이 기본이다: 같은 키를 여러 커넥터가 쓸 때
         사본이 생기지 않고, 만료일을 한 곳에서 관리할 수 있다. 직접 입력은
         자격증명이 생기기 전에 만든 커넥터를 그대로 열 수 있게 남겨 둔다. */
      const auth = el(`<div class="wz-auth" id="wzAuthBox" style="${a.kind ? '' : 'display:none'}">
        <div class="wz-seg" id="wzAuthSrc" style="margin-bottom:14px">
          <button type="button" data-v="cred" class="${a.credential_id || !st.edit ? 'on' : ''}">저장된 자격증명</button>
          <button type="button" data-v="inline" class="${a.credential_id || !st.edit ? '' : 'on'}">직접 입력</button>
        </div>
        <div id="wzCredBox" style="${a.credential_id || !st.edit ? '' : 'display:none'}">
          <div class="wz-row" style="grid-template-columns:minmax(0,1fr) auto;align-items:end">
            ${fld('자격증명', sel('wzCred', a.credential_id || '',
              [['', '— 고르세요 —']].concat(CREDS.map(c =>
                [c.id, `${c.name}${c.expiresAt ? ` (${String(c.expiresAt).slice(0, 10).replace(/-/g, '.')} 만료)` : ''}`]))), {
              msg: '값은 커넥터에 복사되지 않습니다 — 키를 갈면 이 자격증명을 쓰는 커넥터가 모두 함께 바뀝니다.' })}
            <div id="wzCredMng"></div>
          </div>
        </div>
        <div id="wzInlineBox" style="${a.credential_id || !st.edit ? 'display:none' : ''}">
          <div class="wz-row" style="grid-template-columns:200px minmax(0,1fr)">
            <div id="wzAuthNBox" style="${['header', 'param'].includes(a.kind) ? '' : 'display:none'}">
              ${fld(a.kind === 'param' ? '파라미터 이름' : '헤더 이름',
                    inp('wzAuthN', a.name, a.kind === 'param' ? 'serviceKey' : 'Authorization', 'mono'))}</div>
            ${fld('인증 값', `<div class="wc-input wc-input--md"><input class="wc-input__el" type="password"
              id="wzAuthV" value="${esc(a.token || a.value || '')}"
              placeholder="${st.edit ? '저장됨 — 바꿀 때만 입력' : '인증 값'}"></div>`, {
              msg: `인증 값은 저장 뒤 화면과 API 응답에서 가려집니다. 주소에 직접 적으면 가려지지 않으니
                    인증키는 이 칸에 넣어 주세요. 이미 URL 인코딩된 키(<span class="mono">%2F</span>·<span
                    class="mono">%3D</span> 가 섞인)를 그대로 붙여 넣어도 다시 인코딩하지 않습니다.` })}
          </div>
        </div></div>`);
      f.appendChild(auth);

      $('#wzCredMng', auth).appendChild(cnBtn('관리', 'secondary', null, () => {
        wizRead();
        // 관리 창에서 «고르기» 를 누르면 그대로 이 칸에 꽂는다 — 새로 만들고 나서
        // 목록을 다시 찾아 고르게 하면 방금 만든 것이 어느 것인지 헷갈린다.
        credModal((c) => {
          st.cfg.auth = Object.assign({}, st.cfg.auth, { credential_id: c.id, kind: c.kind });
          wizStepBody();
          wizSchedule(0);
        });
      }, { size: 'md' }));

      $$('#wzAuthSrc button', auth).forEach(b => b.onclick = () => {
        wizRead();
        const v = b.dataset.v;
        $$('#wzAuthSrc button', auth).forEach(x => x.classList.toggle('on', x === b));
        $('#wzCredBox', auth).style.display = v === 'cred' ? '' : 'none';
        $('#wzInlineBox', auth).style.display = v === 'inline' ? '' : 'none';
        const au = st.cfg.auth || (st.cfg.auth = {});
        if (v === 'inline') delete au.credential_id;
        else au.credential_id = $('#wzCred', auth) ? $('#wzCred', auth).value : '';
        wizSchedule(0);
      });
      const credSel = $('#wzCred', auth);
      if (credSel) credSel.onchange = (e) => {
        const au = st.cfg.auth || (st.cfg.auth = {});
        au.credential_id = e.target.value;
        const c = credById(e.target.value);
        if (c) au.kind = c.kind;               // 방식은 자격증명이 정한다
        wizSchedule(0);
      };


      const pbox = el(`<div class="wz-params">
        <div class="wz-params-h"><span class="wz-f-l">요청 파라미터</span></div>
        <div class="wz-prows" id="wzPRows"></div>
        <p class="wz-f-m">이름·값을 넣으면 요청에 붙습니다. 값에도 주소와 같은 날짜 자리표시자를
          쓸 수 있고, <b>비밀</b>로 표시한 값은 저장 뒤 화면과 응답에서 가려집니다.</p></div>`);
      const prows = $('#wzPRows', pbox);
      const drawParams = () => {
        prows.innerHTML = '';
        if (!st.params.length) {
          prows.appendChild(el('<div class="t12 fnt" style="padding:2px 0 6px">없음</div>'));
        }
        st.params.forEach((p, i) => {
          const r = el(`<div class="wz-prow">
            <div class="wc-input wc-input--md"><input class="wc-input__el mono wz-pk"
              value="${esc(p.k)}" placeholder="LAWD_CD"></div>
            <div class="wc-input wc-input--md"><input class="wc-input__el mono wz-pv"
              value="${esc(p.v)}" placeholder="11680"></div>
            <button type="button" class="wz-ps ${p.secret ? 'on' : ''}"
              title="${p.secret ? '비밀 — 저장 뒤 가려집니다' : '비밀로 표시'}">${ic14(p.secret ? 'eyeoff' : 'eye')}</button>
            <button type="button" class="iconbtn wz-pd" title="이 줄 지우기">${ic14('trash')}</button></div>`);
          $('.wz-ps', r).onclick = () => { wizRead(); st.params[i].secret = !st.params[i].secret; drawParams(); wizSchedule(0); };
          $('.wz-pd', r).onclick = () => { wizRead(); st.params.splice(i, 1); drawParams(); wizSchedule(0); };
          $$('.wc-input__el', r).forEach(x => x.addEventListener('input', () => wizSchedule()));
          prows.appendChild(r);
        });
      };
      drawParams();
      const add = cnBtn('추가', 'ghost', 'plus', () => {
        wizRead(); st.params.push({ k: '', v: '', secret: false }); drawParams();
      });
      $('.wz-params-h', pbox).appendChild(add);
      f.appendChild(pbox);

      /* 인증 방식이 바뀌면 딸린 칸을 여닫는다 */
      $('#wzAuthK', f).onchange = (e) => {
        const k = e.target.value;
        $('#wzAuthBox', f).style.display = k ? '' : 'none';
        $('#wzAuthNBox', f).style.display = ['header', 'param'].includes(k) ? '' : 'none';
        const n = $('#wzAuthN', f);
        if (n) n.placeholder = k === 'param' ? 'serviceKey' : 'Authorization';
        const lb = $('#wzAuthNBox .wz-f-l', f);
        if (lb) lb.textContent = k === 'param' ? '파라미터 이름' : '헤더 이름';
        wizSchedule(0);
      };
    } else {
      f.appendChild(el(`<div class="wz-row" style="grid-template-columns:200px 160px">
        ${fld('파일 형식', sel('wz_format', st.cfg.format, [['csv', 'CSV'], ['jsonl', 'JSON Lines']]))}
        <div id="wzDelBox" style="${st.cfg.format === 'csv' ? '' : 'display:none'}">
          ${fld('구분자', inp('wz_delimiter', st.cfg.delimiter || ',', ',', 'mono'))}</div></div>`));
      const pick = el(`<div class="wz-file">
        <span class="wz-file-n t12 ${st.file ? 'b6' : 'fnt'}">${esc(st.file ? st.file.name : '선택한 파일 없음')}</span></div>`);
      pick.insertBefore(cnBtn('파일 선택', 'secondary', 'doc', async () => {
        const file = await pickFile('.csv,.json,.jsonl,.txt');
        if (!file) return;
        wizRead();
        st.file = file;
        wizStepBody();
        wizSchedule(0);
      }, { size: 'md' }), pick.firstChild);
      f.appendChild(el(fld('표본 파일', '<div id="wzFileSlot"></div>', {
        msg: '여기서 고른 파일은 컬럼을 확인하는 데만 씁니다. 실제 적재는 저장한 뒤 «파일 올리기» 로 합니다.',
      })));
      $('#wzFileSlot', f).appendChild(pick);
      $('#wz_format', f).onchange = (e) => {
        $('#wzDelBox', f).style.display = e.target.value === 'csv' ? '' : 'none';
        wizSchedule(0);
      };
    }

    /* 값이 바뀌면 연결 테스트를 다시 — 고르는 것은 바로, 치는 것은 잠깐 기다렸다 */
    $$('input.wc-input__el', f).forEach(x => x.addEventListener('input', () => wizSchedule()));
    $$('select.wc-select__el', f).forEach(x => x.addEventListener('change', () => wizSchedule(0)));

    main.appendChild(card);
    // 열자마자 지금 상태를 보여준다(수정 화면·되돌아온 경우)
    if (wizCanPrev(st) && st.prev.state === 'idle') wizSchedule(250);
  }

  /* ── 단계 3 — 적재 설정 ── */
  function wizLoadStep(main) {
    const st = WIZ.st;
    const s = st.scope;

    /* 적재 대상 */
    const c1 = el(`<div class="wc-card cn-card">
      <div class="wc-card__head"><div style="min-height:0">
        <span class="wc-card__title">적재 대상</span>
        <span class="wc-card__sub">가져온 원본을 그대로 넣을 자리입니다.</span></div></div>
      <div class="wc-card__body wz-form">
        <div class="wz-row" style="grid-template-columns:minmax(0,1fr) 220px">
          ${fld('대상 테이블', `<div class="wc-input wc-input--md">
            <span class="wc-input__affix mono">raw.</span>
            <input class="wc-input__el mono" id="wzTarget" value="${esc(st.target)}"
              placeholder="apt_trade"></div>`, {
            req: true, msg: '소문자로 시작하고 소문자·숫자·밑줄만 씁니다.' })}
          ${fld('적재 방식', sel('wzMode', st.mode,
            [['append', '증분 적재'], ['overwrite', '전체 적재']]), {
            msg: '<b>증분 적재</b>는 가져온 만큼 뒤에 쌓고, <b>전체 적재</b>는 기존 데이터를 지우고 새로 넣습니다.' })}
        </div>
        <div class="wz-f"><span class="wz-f-l">중복 기준</span>
          <div class="cn-cols" id="wzDedupe"></div>
          <span class="wz-f-m" id="wzDedupeHint"></span></div>
      </div></div>`);
    main.appendChild(c1);

    /* 중복 기준 — 감지된 컬럼에서만 고르게 한다.
       자유 입력으로 두면 오타 하나에 모든 행이 같은 키가 되어 테이블이 1행으로
       줄어드는데, 오류도 경고도 나지 않는다(엔진의 apply_dedupe 는 없는 컬럼을
       빈 값으로 읽는다). 고를 것이 없으면 «없음» 만 남는다. */
    const ddHost = $('#wzDedupe', c1);
    const drawDedupe = () => {
      ddHost.innerHTML = '';
      if (!st.cols.length) {
        ddHost.appendChild(el('<span class="t12 fnt">연결 테스트로 컬럼을 확인하면 고를 수 있습니다.</span>'));
      }
      st.cols.forEach(c => {
        const on = st.dedupe.includes(c.name);
        const chip = el(`<button type="button" class="wc-tag cn-tag mono wz-dd ${on ? 'on' : ''}"
          data-col="${esc(c.name)}">${esc(c.name)}</button>`);
        chip.onclick = () => {
          const i = st.dedupe.indexOf(c.name);
          if (i >= 0) st.dedupe.splice(i, 1); else st.dedupe.push(c.name);
          drawDedupe();
        };
        ddHost.appendChild(chip);
      });
      const h = $('#wzDedupeHint', c1);
      h.innerHTML = !st.dedupe.length
        ? '고르지 않으면 원본 그대로 넣습니다. 같은 행이 두 번 와도 두 번 쌓입니다.'
        : `<b>${esc(st.dedupe.join(', '))}</b> 이(가) 같으면 마지막 값만 남깁니다.`
          + (st.mode === 'overwrite'
            ? ' 전체 적재라 테이블 전체에 적용됩니다.'
            : ' <b>증분 적재에서는 한 번의 적재 안에서만</b> 봅니다 —'
              + ' 이미 테이블에 있는 행과는 비교하지 않습니다.');
    };
    drawDedupe();
    $('#wzMode', c1).addEventListener('change', () => { wizRead(); drawDedupe(); });

    if (st.kind === 'file') {
      main.appendChild(el(`<div class="cn-note" style="margin:0">
        ${ic14('info')}<span class="f1">파일 커넥터는 예약 실행이 없습니다.
        저장한 뒤 상세에서 «파일 올리기» 를 누르면 그 자리에서 적재합니다.</span></div>`));
      return;
    }

    /* 수집 범위 */
    const c2 = el(`<div class="wc-card cn-card">
      <div class="wc-card__head"><div style="min-height:0">
        <span class="wc-card__title">수집 범위</span>
        <span class="wc-card__sub">원천에서 한 번에 얼마나 끌어올지입니다.</span></div></div>
      <div class="wc-card__body wz-form">
        <div class="wz-seg" id="wzScMode">
          <button type="button" data-v="full" class="${s.mode !== 'incremental' ? 'on' : ''}">전체 수집</button>
          <button type="button" data-v="incremental" class="${s.mode === 'incremental' ? 'on' : ''}">증분 수집</button>
        </div>
        <div id="wzInc" class="wz-inc" style="${s.mode === 'incremental' ? '' : 'display:none'}">
          <div class="wz-row" style="grid-template-columns:repeat(3,minmax(0,1fr))">
            ${fld('요청 형태', sel('wzScShape', s.shape,
              [['range', '시작·종료 파라미터'], ['point', '시점 파라미터 1개']]))}
            ${fld('증분 단위', sel('wzScUnit', s.unit, [['day', '일'], ['month', '월']]))}
            ${fld('날짜 형식', sel('wzScFmt', s.format,
              ['YYYY-MM-DD', 'YYYYMMDD', 'YYYY-MM', 'YYYYMM'].map(x => [x, x])))}
          </div>
          <div id="wzScRange" style="${s.shape === 'range' ? '' : 'display:none'}">
            <div class="wz-row" style="grid-template-columns:repeat(2,minmax(0,1fr))">
              ${fld('시작일 파라미터', inp('wzScSp', s.start_param, 'start_date', 'mono'))}
              ${fld('종료일 파라미터', inp('wzScEp', s.end_param, 'end_date', 'mono'))}</div></div>
          <div id="wzScPoint" style="${s.shape === 'point' ? '' : 'display:none'}">
            ${fld('기준 파라미터', inp('wzScP', s.param, 'DEAL_YMD', 'mono'), {
              msg: '시작·종료를 못 받는 원천입니다. 구간을 단위로 쪼개 한 칸씩 여러 번 부릅니다.' })}</div>
          <div class="wz-row" style="grid-template-columns:repeat(2,minmax(0,1fr))">
            ${fld('초기 수집 시작일', `<div class="wc-input wc-input--md">
              <input class="wc-input__el" type="date" id="wzScInit" value="${esc(s.initial_start)}"></div>`)}
            ${fld('겹쳐 다시 가져올 구간', sel('wzScOv', s.overlap,
              [0, 1, 2, 3, 6].map(n => [n, n === 0 ? '없음' : n + ' 단위 전부터'])))}</div>
          <p class="wz-f-m" id="wzScHint"></p>
        </div></div></div>`);
    main.appendChild(c2);

    /* 반복 파라미터 · 페이지 나눔 */
    const c3 = el(`<div class="wc-card cn-card">
      <div class="wc-card__head"><div style="min-height:0">
        <span class="wc-card__title">여러 번 부르기</span>
        <span class="wc-card__sub">한 번의 요청으로 다 오지 않을 때 씁니다.</span></div></div>
      <div class="wc-card__body wz-form">
        <div class="wz-row" style="grid-template-columns:220px minmax(0,1fr)">
          ${fld('반복 파라미터', inp('wzFoP', s.fanoutParam, '예) LAWD_CD', 'mono'), {
            msg: '비워 두면 쓰지 않습니다.' })}
          ${fld('부를 값', `<div class="wc-input wc-input--md" style="height:auto;padding:0">
            <textarea class="wc-input__el mono" id="wzFoV" rows="3"
              style="resize:vertical;padding:8px 10px;line-height:1.6"
              placeholder="11680&#10;11110&#10;11170">${esc(s.fanoutValues)}</textarea></div>`, {
            msg: '한 줄에 하나씩(쉼표도 됩니다). 시간 한 칸마다 이 값들을 모두 부릅니다 — '
               + '지역처럼 «다음 값» 을 계산할 수 없는 축에 씁니다.' })}
        </div>
        <p class="wz-f-m" id="wzFoHint" style="margin-top:-4px"></p>
        <div class="wz-row" style="grid-template-columns:repeat(3,minmax(0,1fr))">
          ${fld('페이지 번호 파라미터', inp('wzPgP', (st.cfg.page || {}).param, '예) pageNo', 'mono'))}
          ${fld('페이지 크기 파라미터', inp('wzPgS', (st.cfg.page || {}).size_param, '예) numOfRows', 'mono'))}
          ${fld('페이지 크기', `<div class="wc-input wc-input--md"><input class="wc-input__el"
            type="number" min="1" id="wzPgN" value="${esc(String((st.cfg.page || {}).size || ''))}"
            placeholder="1000"></div>`)}
        </div>
        <div class="wz-row" style="grid-template-columns:repeat(3,minmax(0,1fr))">
          ${fld('전체 건수 경로', inp('wzPgT', (st.cfg.page || {}).total_path, '예) response.body.totalCount', 'mono'))}
          ${fld('호출 간 간격', `<div class="wc-input wc-input--md"><input class="wc-input__el"
            type="number" min="0" max="5" step="0.1" id="wzPause"
            value="${esc(String(st.cfg.pause == null ? '' : st.cfg.pause))}" placeholder="0.2"></div>`, {
            msg: '초. 원천이 초당 호출 수를 제한할 때 씁니다.' })}
          ${fld('한 번에 최대 요청 수', `<div class="wc-input wc-input--md"><input class="wc-input__el"
            type="number" min="0" id="wzMaxCalls" value="${esc(String(s.maxCalls || ''))}"
            placeholder="제한 없음"></div>`, {
            msg: '넘으면 돈 데까지 적재하고 남은 구간은 다음 실행이 이어갑니다.' })}
        </div>
        <p class="wz-f-m">페이지 번호 파라미터를 비우면 한 번만 부릅니다.
          <b>한 번에 다 오지 않는 원천에서 이것을 비워 두면 나머지가 조용히 사라집니다</b> —
          오류도 경고도 나지 않고, 그 위에서 계산한 값만 틀립니다.</p>
      </div></div>`);
    main.appendChild(c3);

    /* 실행 방식 — 정하는 것은 여기지만 돌리는 것은 파이프라인이다 */
    const c4 = el(`<div class="wc-card cn-card">
      <div class="wc-card__head"><div style="min-height:0">
        <span class="wc-card__title">실행 방식</span>
        <span class="wc-card__sub">저장하면 데이터 파이프라인 화면에서 함께 보입니다.</span></div></div>
      <div class="wc-card__body wz-form">
        <div class="wz-row" style="grid-template-columns:repeat(2,minmax(0,1fr))">
          ${fld('실행 방식', sel('wzTrig', st.trigger, [['schedule', '예약 실행'], ['manual', '수동 실행']]))}
          <div id="wzFreqBox" style="${st.trigger === 'schedule' ? '' : 'display:none'}">
            ${fld('실행 주기', sel('wzFreq', st.freq, FREQS.filter(f => f !== '수동 실행').map(x => [x, x])))}</div>
        </div></div></div>`);
    main.appendChild(c4);

    /* ── 연동 ── */
    const host = main;
    $$('#wzScMode button', host).forEach(b => b.onclick = () => {
      wizRead();
      s.mode = b.dataset.v;
      $$('#wzScMode button', host).forEach(x => x.classList.toggle('on', x === b));
      $('#wzInc', host).style.display = s.mode === 'incremental' ? '' : 'none';
      scopeHint();
    });
    $('#wzScShape', host).onchange = (e) => {
      $('#wzScRange', host).style.display = e.target.value === 'range' ? '' : 'none';
      $('#wzScPoint', host).style.display = e.target.value === 'point' ? '' : 'none';
      scopeHint();
    };
    ['wzScUnit', 'wzScFmt', 'wzScOv', 'wzScInit'].forEach(id => {
      const x = $('#' + id, host); if (x) x.addEventListener('change', scopeHint);
    });
    ['wzFoP', 'wzFoV'].forEach(id => {
      const x = $('#' + id, host); if (x) x.addEventListener('input', scopeHint);
    });
    $('#wzTrig', host).onchange = (e) => {
      $('#wzFreqBox', host).style.display = e.target.value === 'schedule' ? '' : 'none';
    };

    /* 기준 시점·조회 범위는 사람이 고르는 값이 아니라 계산 결과다.
       다음 실행이 실제로 무엇을 가져올지 그대로 적는다. */
    function scopeHint() {
      wizRead();
      const h = $('#wzScHint', host);
      const sc2 = wizScope(st);
      const fan = (sc2.fanout && sc2.fanout.values.length) || 0;
      if (h) {
        if (sc2.mode !== 'incremental') h.textContent = '';
        else {
          const wm = WIZ.job ? WIZ.job.watermark : null;
          const unit = sc2.unit === 'month' ? '개월' : '일';
          const from = wm
            ? `${wm}${sc2.overlap ? ` (겹침 ${sc2.overlap}${unit} 적용하면 그 이전부터)` : ''}`
            : (sc2.initial_start || '초기 수집 시작일');
          h.innerHTML = `기준 시점: ${wm
            ? `마지막으로 <b>${esc(wm)}</b> 까지 가져왔습니다.`
            : '아직 가져온 적이 없어 <b>초기 수집 시작일</b>부터 시작합니다.'}
            조회 범위: <b>${esc(from)}</b> ~ <b>실행 시점</b>.
            ${sc2.shape === 'point' ? '단위마다 한 번씩 나눠 부릅니다(최대 120칸).' : '한 번에 부릅니다.'}`;
        }
      }
      /* 팬아웃이 붙으면 실제 호출 수가 시간 칸 수 × 값 개수로 늘어난다.
         그 곱을 적어 두지 않으면 «24개월» 만 보고 600번을 부르게 된다. */
      const fh = $('#wzFoHint', host);
      if (fh) {
        const steps = sc2.mode === 'incremental' && sc2.shape === 'point' ? null : 1;
        fh.innerHTML = !fan ? ''
          : steps === 1 ? `값 <b>${fan}개</b> → 실행마다 <b>${fan}번</b> 부릅니다.`
          : `값 <b>${fan}개</b> → 시간 한 칸마다 ${fan}번씩 부릅니다.
             24칸이면 <b>${(fan * 24).toLocaleString()}번</b>입니다.`;
      }
    }
    scopeHint();
  }

  /* ── 단계 4 — 확인 ── */
  function wizDoneStep(main) {
    const st = WIZ.st;
    const cfg = wizCfg(st), sc = wizScope(st);

    const c1 = cnCard('이대로 저장합니다', { sub: '저장하면 raw 원천으로 등록되어 데이터 모델에서 고를 수 있습니다.' });
    cnBody(c1).appendChild(cnKv([
      ['커넥터명', esc(st.name || '—')],
      ['유형', esc(CK[st.kind].label)],
      st.kind === 'api' ? ['요청 주소', `<span class="mono cn-break">${esc(cfg.method)} ${esc(cfg.url || '—')}</span>`] : null,
      st.kind === 'api' ? ['레코드 경로', `<span class="mono">${esc(cfg.record_path || '(응답 전체)')}</span>`] : null,
      st.kind === 'api' ? ['인증', (() => {
        const au = cfg.auth || {};
        if (!au.kind) return '없음';
        const c2 = credById(au.credential_id);
        return esc(AUTH_LABEL[au.kind]) + (c2 ? ` ${cnTag(c2.name)} ${credExpiry(c2)}`
          : ' <span class="cn-mute">· 커넥터에 직접 입력</span>');
      })()] : null,
      st.kind === 'api' && cfg.params
        ? ['요청 파라미터', Object.keys(cfg.params).map(k =>
            `<span class="cn-p">${cnTag(k)}<span class="mono cn-mute">${
              (cfg.secret_params || []).includes(k) ? '••••••' : esc(String(cfg.params[k]))}</span></span>`).join('')]
        : null,
      st.kind === 'file' ? ['파일 형식', cfg.format === 'jsonl' ? 'JSON Lines' : `CSV · 구분자 «${esc(cfg.delimiter)}»`] : null,
      ['적재 대상', `<span class="mono b6">raw.${esc(st.target || '—')}</span>`],
      ['적재 방식', esc(LOAD_MODE[st.mode])],
      ['중복 기준', st.dedupe.length
        ? `<span class="mono">${esc(st.dedupe.join(', '))}</span> 기준 마지막 값 유지`
        : '없음 <span class="cn-mute">· 원본 그대로 적재</span>'],
      st.kind === 'api' ? ['수집 범위', esc(SCOPE_MODE[sc.mode])
        + (sc.mode === 'incremental' ? ` <span class="cn-mute">· ${esc(sc.unit === 'month' ? '월' : '일')} 단위</span>` : '')] : null,
      sc.fanout ? ['반복 파라미터', `<span class="mono">${esc(sc.fanout.param)}</span>`
        + ` <span class="cn-mute">· 값 ${sc.fanout.values.length}개</span>`] : null,
      st.kind === 'api' ? ['실행 방식', st.trigger === 'schedule'
        ? `예약 실행 <span class="cn-mute">· ${esc(st.freq)}</span>` : '수동 실행'] : null,
    ]));
    main.appendChild(c1);

    const c2 = cnCard('적재 컬럼', { right: el(`<span class="t12 fnt">${st.cols.length}개</span>`) });
    const b2 = cnBody(c2);
    b2.appendChild(el(`<div class="cn-cols">${st.cols.length
      ? st.cols.map(c => `<span class="wc-tag cn-tag mono">${esc(c.name)}</span>`).join('')
      : '<span class="t12 fnt">연결 테스트로 컬럼을 확인해 주세요.</span>'}</div>`));
    b2.appendChild(el(`<p class="cn-hint">모두 문자열로 넣습니다 —
      타입을 정하고 값을 다듬는 일은 데이터 모델이 맡습니다.</p>`));
    main.appendChild(c2);

    if (st.rows.length) {
      const c3 = cnCard('가져온 표본', { flush: true,
        right: el(`<span class="t12 fnt">${st.sampled}건 중 앞 ${Math.min(5, st.rows.length)}건</span>`) });
      cnBody(c3).appendChild(el(`<div class="wc-table wc-table--compact cn-tbl">
        <div class="wc-table__scroll"><table>
          <thead><tr>${st.cols.map(c => `<th>${esc(c.name)}</th>`).join('')}</tr></thead>
          <tbody>${st.rows.slice(0, 5).map(r => `<tr>${st.cols.map(c =>
            `<td class="mono">${esc(fmtCell(r[c.name]))}</td>`).join('')}</tr>`).join('')}</tbody>
        </table></div></div>`));
      main.appendChild(c3);
    }

    main.appendChild(el(`<div class="cn-note" style="margin:0">${ic14('info')}
      <span class="f1">저장하면 <span class="mono">raw.${esc(st.target || '…')}</span> 이(가)
      SOURCE 로 등록됩니다. 수집 주기와 실행 상태는 데이터 파이프라인 화면에서 봅니다.</span></div>`));
  }

  /* ── 오른쪽 레일 — 연결 테스트 ── */
  function wizTestCard() {
    const st = WIZ.st;
    const p = st.prev;
    const stateBadge = p.state === 'ok' ? cnBadge('ok')
      : p.state === 'error' ? cnBadge('err')
      : p.state === 'empty' ? cnBadge('warn')
      : p.state === 'loading' ? `<span class="wc-badge" style="background:${CST.run.bg};color:${CST.run.fg}">
          <span class="wc-badge__dot"></span>확인 중</span>`
      : `<span class="wc-badge" style="background:${CST.off.bg};color:${CST.off.fg}">대기</span>`;

    const card = el(`<div class="wc-card cn-card">
      <div class="wc-card__head"><div style="min-height:0;justify-content:center">
        <span class="wc-card__title">연결 테스트</span></div>${stateBadge}</div>
      <div class="wc-card__body" id="wzTestB"></div></div>`);
    const b = $('#wzTestB', card);

    if (p.state === 'ok') {
      b.appendChild(cnKv([
        ['감지 컬럼', `${st.cols.length}개`],
        ['감지 레코드', `${st.sampled}건`],
        ['확인 시각', `<span class="cn-mute">${esc(p.at || '')}</span>`],
      ]));
      const f = el('<div class="row g6" style="margin-top:10px;flex-wrap:wrap"></div>');
      f.appendChild(cnBtn('다시 확인', 'secondary', 'rot', () => wizRunPrev(true)));
      b.appendChild(f);
      const foot = el('<div class="wc-card__foot cn-cf"></div>');
      foot.appendChild(el('<span class="cn-mute">이 컬럼 그대로 저장됩니다.</span>'));
      card.appendChild(foot);
    } else if (p.state === 'empty') {
      b.appendChild(el(`<div class="t12" style="line-height:1.7">
        <b>연결은 됐지만 가져온 행이 없습니다.</b><br>
        <span class="cn-mute">주소는 응답했는데 레코드가 비어 있습니다. 레코드 경로가
        맞는지, 조회 조건(요청 파라미터·수집 범위)이 값이 있는 구간을 가리키는지 확인해 주세요.</span></div>`));
      b.appendChild(cnKv([
        ['감지 컬럼', '0개'],
        ['확인 시각', `<span class="cn-mute">${esc(p.at || '')}</span>`],
        p.kept ? ['저장된 컬럼', `${p.kept}개 <span class="cn-mute">· 그대로 둡니다</span>`] : null,
      ]));
      const f = el('<div class="row g6" style="margin-top:10px"></div>');
      f.appendChild(cnBtn('다시 확인', 'secondary', 'rot', () => wizRunPrev(true)));
      b.appendChild(f);
    } else if (p.state === 'error') {
      b.appendChild(el(`<div class="wz-err">${esc(p.error)}</div>`));
      if (p.kept) {
        b.appendChild(el(`<p class="wz-f-m" style="margin-top:10px">저장돼 있던 컬럼
          <b>${p.kept}개</b>는 그대로 둡니다 — 설정을 되돌려 저장할 수 있습니다.</p>`));
      }
      const f = el('<div class="row g6" style="margin-top:10px"></div>');
      f.appendChild(cnBtn('다시 시도', 'secondary', 'rot', () => wizRunPrev(true)));
      b.appendChild(f);
    } else if (p.state === 'loading') {
      b.appendChild(el(`<div class="t12 fnt">${p.slow
        ? '원천이 아직 응답하지 않습니다. 기다리거나 끊을 수 있습니다.'
        : '표본을 가져오는 중…'}</div>`));
      if (p.slow) {
        const f = el('<div class="row g6" style="margin-top:10px"></div>');
        f.appendChild(cnBtn('요청 취소', 'secondary', 'x', () => {
          wizAbort(); WIZ.st.prev = { state: 'canceled' }; wizPaint();
        }));
        b.appendChild(f);
      }
    } else {
      b.appendChild(el(`<div class="t12 fnt" style="line-height:1.6">${p.state === 'canceled'
        ? '요청을 취소했습니다.'
        : st.kind === 'api'
          ? '요청 주소를 입력하면 자동으로 한 번 붙어 보고, 그 응답의 컬럼이 곧 적재 컬럼이 됩니다.'
          : '파일을 선택하면 자동으로 표본을 읽습니다.'}</div>`));
      if (p.state === 'canceled' || wizCanPrev(st)) {
        const f = el('<div class="row g6" style="margin-top:10px"></div>');
        f.appendChild(cnBtn('지금 확인', 'secondary', 'link', () => wizRunPrev(true)));
        b.appendChild(f);
      }
    }

    const note = el(`<div class="wz-rail-note">${ic14('info', 'fnt')}
      <span>${WIZ.st.step === 1
        ? '연결이 되면 다음 단계에서 적재 대상과 방식을 정합니다.'
        : '설정을 고치면 이 결과도 다시 확인해 주세요.'}</span></div>`);
    const box = el('<div class="col g12"></div>');
    box.appendChild(card);
    box.appendChild(note);
    return box;
  }

  /* ── 바닥 — 이전 / 다음 · 저장 ── */
  function wizFoot(foot) {
    foot.innerHTML = '';
    const st = WIZ.st;
    const first = st.edit ? 1 : 0;

    const prev = cnBtn('이전', 'secondary', null, () => wizGo(st.step - 1),
                       { size: 'md', off: st.step <= first });
    foot.appendChild(prev);
    foot.appendChild(el('<span class="f1"></span>'));

    foot.appendChild(cnBtn('취소', 'ghost', null, () => closeWizard(), { size: 'md' }));

    if (st.step < 3) {
      foot.appendChild(cnBtn('다음', 'primary', null, () => wizGo(st.step + 1), { size: 'md' }));
    } else {
      const save = cnBtn(st.edit ? '저장' : '커넥터 만들기', 'primary', st.edit ? 'save' : 'plus',
        function () { wizSave(this); }, { size: 'md' });
      foot.appendChild(save);
    }
  }

  async function wizSave(btn) {
    const w = WIZ;
    const st = w.st;
    if (!st.name.trim()) { toast('커넥터 이름을 입력해 주세요.', 'warn'); return; }
    if (!st.target.trim()) { toast('적재 대상 테이블 이름을 입력해 주세요.', 'warn'); return; }
    if (!st.cols.length) { toast('연결 테스트로 컬럼을 먼저 확인해야 저장할 수 있습니다.', 'warn'); return; }

    const payload = {
      name: st.name.trim(), kind: st.kind, target: st.target.trim(),
      mode: st.mode, scope: wizScope(st), config: wizCfg(st), columns: st.cols,
      dedupe: st.dedupe.join(','),
      trigger_type: st.kind === 'api' ? st.trigger : 'manual',
      freq: st.kind === 'api' && st.trigger === 'schedule' ? st.freq : '수동 실행',
    };
    btn.disabled = true;
    try {
      const saved = w.job
        ? await api(`/ingest/jobs/${enc(w.job.id)}`, { method: 'PATCH', body: JSON.stringify(payload) })
        : await api('/ingest/jobs', { method: 'POST', body: JSON.stringify(payload) });
      toast(w.job ? `${payload.name} 을(를) 저장했습니다.`
                  : `${payload.name} 을(를) 만들었습니다. ${saved.phys} 원천이 데이터 모델에 등록됩니다.`);
      wizAbort();
      WIZ = null;
      delete PREV[saved.id];
      await loadIngest();
      await boot({ keep: true });
      openIngTab(saved.id);
    } catch (e) { fail(e); btn.disabled = false; }
  }

  /* 위저드 화면 — 한 번만 만들고 렌더마다 같은 노드를 되붙인다 */
  function wizView() {
    if (WIZ.node) return WIZ.node;
    const st = WIZ.st;
    const node = el(`<div class="f1 col" style="min-height:0">
      <div class="f1 col cn-scroll wz-scroll"><div class="cn-page">
        <div class="cn-head"><div class="cn-head-t"><div>
          <h1 class="cn-h2">${st.edit ? '커넥터 수정' : '커넥터 만들기'}</h1>
          <p class="page-d">연결과 적재 규칙만 정의합니다. 수집 주기와 실행은 데이터 파이프라인에서 설정합니다.</p>
        </div></div></div>
        <div class="cn-body" id="wzBody"></div>
      </div></div></div>`);
    WIZ.node = node;
    wizStepBody();
    return node;
  }


  ingestModal = function (job) { openWizard(job || null); };


  /* ============================================================
     8. 페이지 조립
     ============================================================ */

  pageIngest = function () {
    S.openIngs = S.openIngs.filter(id => ingById(id));
    if (S.openIng === 'wiz' && !WIZ) S.openIng = 'list';
    if (S.openIng !== 'list' && S.openIng !== 'wiz' && !S.openIngs.includes(S.openIng)) S.openIng = 'list';

    /* 좌측 사이드바 없이 탭 줄 + 내용 한 벌이다(위 3절). .mod-c 를 그대로 쓰는
       이유는 그 클래스가 이 화면들의 본문 배경(--bg)과 세로 흐름을 정하기
       때문이다 — 여기서 다시 만들면 파이프라인과 배경이 어긋난다. */
    const page = el('<div class="page flush" style="display:flex;flex-direction:column;min-height:0"></div>');
    const row = el('<div class="mod f1" style="min-height:0"></div>');
    const main = el('<div class="mod-c f1" style="min-width:0;min-height:0"></div>');
    main.appendChild(ingTabStrip());
    if (S.openIng === 'wiz') main.appendChild(wizView());
    else {
      const j = S.openIng === 'list' ? null : ingById(S.openIng);
      main.appendChild(j ? ingDetailView(j) : ingListView());
    }
    row.appendChild(main);
    page.appendChild(row);
    return page;
  };

  /* 실행·삭제 뒤에는 이 화면이 들고 있던 파생 값도 버린다 — 적재가 끝났는데
     «테이블이 비어 있습니다» 가 그대로 남아 있으면 방금 한 일이 실패로 읽힌다. */
  const _run = ingRunNow;
  ingRunNow = async function (j) {
    await _run(j);
    delete PREV[j.id];
    render();
  };

  /* ── 보던 자리 지키기 ────────────────────────────────────────
     render() 는 페이지를 통째로 다시 만든다. 스크롤 상자(.cn-scroll)도 새 노드라
     맨 위에서 시작하고, 그래서 상세 아래쪽에서 «수집 데이터 다시 읽기» 를 누르면
     화면이 최상단으로 튀었다. 누른 버튼은 그대로 있는데 보던 자리만 사라진다.

     새로고침 버튼만의 문제가 아니다 — 연결 테스트, 미리보기 응답 도착,
     연결 일괄 확인의 매 건마다 render() 가 돈다. 그래서 버튼 하나를 고치지 않고
     이 화면의 render() 를 감싼다. 모델·파이프라인 화면이 S.__linScroll ·
     S.__pfScroll 로 하는 것과 같은 일이고, 다만 저장 위치를 여기 두었다.

     **되돌리는 조건은 «같은 것을 계속 보고 있을 때» 다.** 탭을 옮기거나 목록에서
     커넥터를 열면 다른 화면이므로 맨 위에서 시작해야 한다 — 그때까지 되돌리면
     새 화면이 엉뚱한 데서 열린다. 그래서 위치와 함께 무엇을 보고 있었는지(key)를
     적어 두고, 렌더 앞뒤로 그것이 같을 때만 되돌린다. */
  const cnViewKey = () => (S.page === 'ingest' ? 'ing:' + S.openIng : null);

  const _render = render;
  render = function () {
    const before = cnViewKey();
    const box = before && $('.cn-scroll');
    const top = box ? box.scrollTop : 0;

    _render();

    if (!before || !top || cnViewKey() !== before) return;
    const now = $('.cn-scroll');
    if (now) now.scrollTop = top;
  };


  /* ============================================================
     9. 도움말 — 바뀐 어휘와 조작을 반영한다
     ============================================================ */
  if (typeof HELP === 'object' && HELP.ingest) {
    HELP.ingest.t = '데이터 수집';
    HELP.ingest.items = [
      '커넥터는 «어디에 붙어 무엇을 raw 어디로 넣는가» 만 정합니다. 수집 주기와 실행 상태는 데이터 파이프라인 화면에서 봅니다.',
      '「커넥터 목록」 탭이 전체 목록입니다. 이름·적재 대상으로 검색하고 유형·연결 상태로 거를 수 있습니다.',
      '카드를 누르면 탭으로 열립니다. 탭 앞의 점이 그 커넥터의 연결 상태입니다.',
      '연결 일괄 확인 을 누르면 REST API 커넥터를 하나씩 실제로 두드려 봅니다. 결과는 이 세션 동안 기억합니다.',
      '커넥터 만들기 는 4단계입니다 — 유형 선택 → 연결 정보 → 적재 설정 → 확인. 연결 테스트가 찾아낸 컬럼이 곧 적재 컬럼이 됩니다.',
      '인증키는 반드시 인증 칸이나 요청 파라미터의 «비밀» 로 넣어 주세요. 주소에 직접 적으면 가려지지 않습니다.',
      '수집은 가공하지 않습니다 — 원본 그대로 문자열로 넣고, 타입과 정제는 데이터 모델이 맡습니다.',
    ];
  }
})();
