/* ── b56 — 데이터 파이프라인 개편 (v2) ───────────────────────────────────
   ============================================================
   claude.ai/design 프로젝트 «데이터 파이프라인 페이지 리디자인» 의 v2
   (데이터 파이프라인 v2.dc.html)를 옮긴다. v1 은 이미 화면에 들어와 있었고
   (좌측 두 영역 · 카드 + 배지 · 상태 요약 줄), v2 가 바꾼 것만 여기서 갈아끼운다.

   ── v1 → v2 로 달라진 것 ─────────────────────────────────────
   ① 좌측 목록 — 수집/가공 → INGEST/TRANSFORM. 한 줄에 이름 하나와 상태 점만 둔다.
      예약 스위치·요약 문장·배지를 뺐다. 목록은 «무엇이 있고 지금 어떤가» 만 답하고,
      조작은 고른 뒤 아래 상세에서 한다. 대신 이름 검색과 영역 접기를 새로 둔다.
   ② 흐름도 — 카드의 색 띠가 «상태» 가 아니라 «단계» 를 뜻한다(수집 초록 · 가공 남색).
      상태는 점과 오른쪽 문구가 말한다. v1 은 띠도 배지도 상태여서 같은 말을 두 번
      했고, 그래서 «이게 수집인가 가공인가» 는 부제를 읽어야 알 수 있었다.
   ③ 선택 ≠ 열기 — 카드를 누르면 아래 상세가 열린다. 탭으로 여는 것은 «상세 열기» 다.
      v1 은 한 번 누르면 곧바로 탭이 열려서, 훑어보는 동안 탭이 쌓였다.
   ④ 연결 편집 — 포트와 연결 라벨을 상시 노출하지 않는다. «연결 편집» 을 켠 동안만
      끌어 잇고 끊을 수 있다. 읽는 화면이 기본이고, 고치는 것은 들어가는 모드다.
   ⑤ 상세 — 수집은 실패 안내 + 실행 이력 표, 가공은 모델 카드 + 빌드 결과 + 추이.

   ── 마크업 규칙 ──────────────────────────────────────────────
   데이터 품질 화면(b14)과 같다. 레이아웃 골격은 앱 어휘(.mod · .mod-l · .dock)를
   그대로 쓰고, 잎사귀 부품만 DS 컴포넌트 층(.wc-btn · .wc-badge · .wc-table)을 쓴다.
   아이콘은 원본의 Tabler CDN 마스크 대신 앱 스프라이트(#i-*, ic/ic14)다 — 한 화면에
   아이콘 소스가 두 벌이 되고 오프라인에서 아이콘만 사라지는 것을 막는다.

   ── 지어내지 않은 자리 ───────────────────────────────────────
   · «오늘 실행 28» — 수집과 가공을 합쳐 하루치 실행 횟수를 세는 곳이 서버에 없다
     (/history 는 dbt 호출 단위라 수집이 빠지고, 파이프라인별 실행 목록을 다 훑으면
     요약 한 줄에 요청이 N개 나간다). 아는 것만 적는다 — 전체·실패·실행 중 개수와
     이 흐름을 받아온 시각.
   · 폴더 «+ · 0 of 0» — 파이프라인에는 폴더가 없다(카탈로그의 논리 폴더는 카탈로그
     항목의 개인 설정이다). 원본의 값도 0 of 0 이라 근거가 없는 자리다. 같은 줄에서
     실제로 쓸 수 있는 것 — 이름 검색과 영역 접기 — 만 가져왔다.
   ============================================================ */
(function () {

  /* ============================================================
     1. 공통 조각
     ============================================================ */

  /* 단계. **색이 뜻하는 것은 상태가 아니라 이것이다** (v2 의 핵심 변경). */
  const STAGE = {
    ingest:    { label: 'INGEST',    color: 'var(--accents-green)',  icon: 'tbl',  word: '수집' },
    transform: { label: 'TRANSFORM', color: 'var(--accents-indigo)', icon: 'cube', word: '가공' },
  };
  const stageOf = (n) => (n.kind === 'ingest' ? STAGE.ingest : STAGE.transform);
  /* 예약이 꺼져 아직 돈 적 없는 항목 — 단계 색을 쓰면 «곧 돌 것» 처럼 읽힌다 */
  const OFF = 'var(--w-border-strong)';

  const TONE = {
    ok:   { label: '성공',    fg: 'var(--w-success)', bg: 'rgba(52,199,89,.12)' },
    err:  { label: '실패',    fg: 'var(--w-danger)',  bg: 'rgba(255,56,60,.10)' },
    run:  { label: '실행 중', fg: 'var(--w-info)',    bg: 'rgba(0,192,232,.12)' },
    wait: { label: '대기',    fg: 'var(--w-text-2)',  bg: 'var(--w-hover)' },
  };
  const tone = (st) => TONE[st] || TONE.wait;
  const plDot = (st, off) => `<span class="pl-dot" style="background:${off && st === 'wait' ? OFF : tone(st).fg}"></span>`;
  const plBadge = (st) => {
    const t = tone(st);
    return `<span class="wc-badge" style="background:${t.bg};color:${t.fg}">`
      + `<span class="wc-badge__dot"></span>${t.label}</span>`;
  };
  const plSq = (color) => `<span class="pl-sq" style="background:${color}"></span>`;

  /* 최근 실행 — 수집과 가공이 필드 이름을 달리 준다(/pipelines/flow).
       수집 : state · start · end · seconds
       가공 : status · startedAt · endedAt
     여기서 한 모양으로 흡수한다. 두 갈래를 화면 곳곳에서 각각 보면 언젠가 한쪽만
     고쳐져 같은 실행이 자리마다 다르게 보인다. */
  const plSpan = (a, b) => {
    if (!a || !b) return null;
    const s = (new Date(b) - new Date(a)) / 1000;
    return isFinite(s) && s >= 0 ? s : null;
  };
  function plLast(n) {
    const r = n && n.latestRun;
    if (!r) return null;
    const start = r.startedAt || r.start || null;
    const end = r.endedAt || r.end || null;
    return { at: end || start, sec: r.seconds != null ? r.seconds : plSpan(start, end) };
  }

  /* 카드 오른쪽에 붙는 «지금 어떤가» 한 조각.
     시각 표기는 앱 공통 규칙(fmtDT · KST · 초까지)을 따른다 — 원본은 «오전 9:41» 이지만
     그 표기는 b00 이 금지한다(보는 사람의 시간대와 기준이 갈린다). */
  function plWhen(n, st) {
    if (st === 'run') return { text: '실행 중', tone: 'var(--w-info)' };
    const l = plLast(n);
    if (n.paused && !l) return { text: '예약 꺼짐', tone: 'var(--w-text-3)' };
    if (!l || !l.at) return { text: '실행 이력 없음', tone: 'var(--w-text-3)' };
    const when = shortTime(l.at);
    const took = l.sec != null ? ' · ' + durLabel(l.sec) : '';
    if (st === 'err') return { text: '실패 · ' + when, tone: 'var(--w-danger)' };
    return { text: when + took, tone: 'var(--w-text-3)' };
  }

  /* 카드 가운데 줄 — 이 항목이 만드는 것. 수집은 적재할 테이블, 가공은 모델 수. */
  const plWhat = (n) => (n.kind === 'ingest' ? (n.phys || '') : `모델 ${n.modelCount || 0}개`);

  /* 실행 방식 한 줄 */
  function plTrigger(n) {
    if (n.paused) return '예약 꺼짐';
    const nx = nextRunLabel(n.nextRun);
    const base = n.kind === 'ingest'
      ? (n.freq || '수동 실행')
      : (TRIG_LABEL[n.triggerType] || n.freq || '수동 실행');
    return nx ? `${base} · ${nx}` : base;
  }

  /* 저장 위치 칩. 누르면 그 데이터를 데이터 모델에서 연다 — 원본의 ↗ 가 그 뜻이다. */
  function plChip(text, goId) {
    const c = el(`<button class="pl-chip" type="button" title="${esc(text)}">`
      + `<span class="mono trunc">${esc(text)}</span>${ic14('ext', 'fnt')}</button>`);
    if (goId && byId(goId)) c.onclick = () => go('modeling', goId);
    else c.disabled = true;
    return c;
  }

  function plBtn(label, kind, icon, onclick, o) {
    const b = el(`<button type="button" class="wc-btn wc-btn--${kind} wc-btn--${(o && o.size) || 'sm'}"`
      + `${o && o.title ? ` title="${esc(o.title)}"` : ''}>`
      + `${icon ? ic14(icon) : ''}<span>${esc(label)}</span></button>`);
    if (o && o.off) { b.disabled = true; return b; }
    if (onclick) b.onclick = onclick;
    return b;
  }

  /* 접힌 탭 줄 — 원본의 «실행 정보 / 알림 N / 연결» 처럼 밑줄로 현재를 표시한다.
     items = [{key, label, badge, badgeTone}] */
  function plTabs(items, cur, pick) {
    const row = el('<div class="pl-tabs"></div>');
    items.forEach(it => {
      const b = el(`<button type="button" class="pl-tab ${it.key === cur ? 'on' : ''}">`
        + esc(it.label)
        + (it.badge != null ? `<span class="pl-tab-b" style="color:${it.badgeTone || 'var(--w-text-3)'}">${esc(it.badge)}</span>` : '')
        + '</button>');
      b.onclick = () => pick(it.key);
      row.appendChild(b);
    });
    return row;
  }

  /* ── 독의 틀 — 접기 · 높이 · 그립 · 자동 맞춤 ────────────────────
     b35 의 pipeDockChrome 과 같은 규칙이지만, 이 화면의 독은 탭 줄 위에 «무엇을
     보고 있는가» 줄(.dk-head)이 하나 더 있다. 그쪽 함수는 그 높이를 세지 않아
     자동 맞춤이 늘 머리 높이만큼 모자랐다(내용이 잘려 보였다). 여기서 다시 쓴다 —
     상태(S.pdockH · S.pdockMin · S.pdockUser)와 한계(dockMaxH)는 그대로 공유한다. */
  function plChrome(p) {
    p.classList.toggle('min', S.pdockMin);
    const tabs = $('.dock-h', p);
    if (tabs) {
      const t = el(`<button class="iconbtn sp" title="${S.pdockMin ? '상세 펼치기' : '상세 접기'}">`
        + ic14(S.pdockMin ? 'chev' : 'chevd') + '</button>');
      t.onclick = () => { S.pdockMin = !S.pdockMin; render(); };
      tabs.appendChild(t);
    }
    const grip = $('.grip-h', p);
    if (S.pdockMin) { if (grip) grip.remove(); p.style.height = ''; return p; }

    /* 첫 진입 높이는 데이터 맵과 같은 규칙을 쓴다(dockInitH — b09).
       두 화면이 각자 상수를 들고 있으면 화면을 옮길 때마다 상세가 위아래로
       튄다. 사용자가 그립으로 조절하면 그 값(S.pdockH)이 이긴다. */
    p.style.height = Math.min(S.pdockH || dockInitH(), dockMaxH(p)) + 'px';
    if (grip) grip.onmousedown = (ev) => {
      ev.preventDefault(); grip.classList.add('on');
      const prev = p.style.transition; p.style.transition = 'none';
      S.pdockUser = true;
      const move = (e) => {
        const r = p.getBoundingClientRect();
        S.pdockH = Math.max(PDOCK_MIN, Math.min(dockMaxH(p), r.bottom - e.clientY));
        p.style.height = S.pdockH + 'px';
      };
      const up = () => {
        grip.classList.remove('on'); p.style.transition = prev;
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        render();
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    };

    if (!S.pdockUser) {
      const fit = () => {
        if (S.page !== 'pipeline' || S.pdockUser || S.pdockMin) return;
        const dock = $('.pl-dock');
        if (!dock || !dock.parentElement) return;
        const hd = $('.dk-head', dock), tb = $('.dock-h', dock), bd = $('.dock-b', dock);
        if (!bd || !tb || !bd.scrollHeight) return;
        const cs = getComputedStyle(bd);
        const need = (hd ? hd.offsetHeight : 0) + tb.offsetHeight + bd.scrollHeight
          + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + 6;
        const room = Math.round(dock.parentElement.getBoundingClientRect().height * 0.52);
        const hgt = Math.max(PDOCK_MIN, Math.min(need, 420, room));
        if (Math.abs(hgt - (S.pdockH || dockInitH())) < 4) return;
        S.pdockH = hgt;
        const prev = dock.style.transition;
        dock.style.transition = 'none';
        dock.style.height = hgt + 'px';
        void dock.offsetHeight;
        dock.style.transition = prev;
      };
      setTimeout(fit, 0); setTimeout(fit, 80);
    }
    return p;
  }

  /* 속성 표 — 원본의 왼쪽 2열 표. rows = [[라벨, 값HTML]] */
  function plKv(rows, o) {
    const t = el('<div class="pl-kv"></div>');
    if (o && o.title) {
      const h = el(`<div class="pl-kv-h"><span class="f1">${esc(o.title)}</span></div>`);
      if (o.edit) {
        const a = el('<button class="lnk" type="button">편집</button>');
        a.onclick = o.edit; h.appendChild(a);
      }
      t.appendChild(h);
    }
    rows.forEach(([k, v]) => t.appendChild(el(
      `<div class="pl-kv-r"><span class="pl-kv-k">${esc(k)}</span><span class="pl-kv-v">${v}</span></div>`)));
    return t;
  }

  /* ── 최근 실행 막대 ──────────────────────────────────────────
     높이는 소요 시간, 색은 결과다. 왼쪽이 과거 — 실행 목록은 최신이 먼저 오므로
     뒤집어 그린다. 실행이 없는 자리는 채우지 않는다(0 으로 채우면 전부 실패로 읽힌다). */
  const BAR_H = 44, BAR_MIN = 10;
  const barColor = (st) => ({ ok: 'rgba(52,199,89,.8)', err: 'rgba(255,56,60,.75)',
                              run: 'rgba(0,192,232,.8)' }[st] || 'var(--w-hover)');

  function plBars(runs) {
    /* 빈 상태는 막대 칸을 만들지 않는다 — .pl-bars 안의 span 은 막대로 취급돼
       (flex:1 · max-width:44) 글자가 세로로 접힌다. */
    if (!runs || !runs.length) return el('<span class="t12 fnt">실행 이력이 없습니다.</span>');
    const box = el('<div class="pl-bars"></div>');
    const max = Math.max(...runs.map(r => r.sec || 0), 1);
    runs.slice().reverse().forEach(r => {
      const h = r.sec ? Math.max(BAR_MIN, Math.round(r.sec / max * BAR_H)) : BAR_MIN;
      box.appendChild(el(`<span title="${esc(r.id)}\n${esc(tone(r.st).label)}`
        + `${r.start ? '\n' + esc(shortTime(r.start)) : ''}${r.sec != null ? '\n' + esc(durLabel(r.sec)) : ''}"`
        + ` style="height:${h}px;background:${barColor(r.st)}"></span>`));
    });
    return box;
  }

  /* 실행 목록 캐시. 노드를 옮겨 다닐 때마다 같은 목록을 다시 받지 않는다.
     실행이 끝나면(refreshRun) 통째로 비운다 — 아래 5절 참고. */
  const RUNS = {};
  const plNormRun = (r) => ({
    id: r.runId || r.run_id || '',
    st: RUN_ST[r.state] || RUN_ST[r.status] || (r.status === 'ok' ? 'ok' : 'wait'),
    start: r.start || r.startedAt || null,
    end: r.end || r.endedAt || null,
    type: r.type || String(r.runId || r.run_id || '').split('__')[0] || '',
    sec: r.seconds != null ? r.seconds : plSpan(r.start || r.startedAt, r.end || r.endedAt),
  });

  /* 노드의 최근 실행 N건. 받아 오면 화면을 다시 그린다(호출부는 캐시만 읽는다). */
  function plRuns(id, kind, limit) {
    const key = id + '/' + (limit || 10);
    const c = RUNS[key];
    if (c) return c;
    const box = RUNS[key] = { loading: true, items: null, err: null };
    const path = kind === 'ingest'
      ? `/ingest/jobs/${enc(id)}/runs?limit=${limit || 10}`
      : `/pipelines/${enc(id)}/runs?limit=${limit || 10}`;
    api(path).then(r => {
      const items = Array.isArray(r) ? r : (r.items || []);
      box.items = items.map(plNormRun);
    }).catch(e => { box.err = e.message; })
      .finally(() => {
        box.loading = false;
        if (S.page === 'pipeline') render();
      });
    return box;
  }

  /* ============================================================
     2. 좌측 목록 — INGEST · TRANSFORM
     ============================================================ */

  S.plQ = S.plQ || '';
  S.plOpen = S.plOpen || { ingest: true, transform: true };

  function plSideRow(item, kind) {
    const st = kind === 'ingest' ? runState(item.lastRun) : item.status;
    const on = item.id === S.openPipe || item.id === S.plSel;
    const sub = kind === 'ingest' ? (item.phys || '') : `모델 ${taskCount(item)}개`;
    const row = el(`<div class="pl-r ${on ? 'on' : ''}" title="${esc(item.name)}\n${esc(sub)}">
      <span class="pl-r-i">${ic14(STAGE[kind].icon, 'fnt')}</span>
      <span class="pl-r-n trunc">${esc(item.name)}</span>
      ${plDot(st, item.paused)}</div>`);
    /* 목록에서 고르면 흐름도의 선택이 된다 — 탭을 열지 않는다(v2 ③).
       이미 탭으로 열어 둔 항목이면 그 탭으로 옮긴다. */
    row.onclick = () => {
      if (S.openPipes.includes(item.id)) { S.openPipe = item.id; S.pipe = item.id; render(); return; }
      S.openPipe = 'deps'; S.plSel = item.id; render();
    };
    row.ondblclick = () => openPipeTab(item.id);
    return row;
  }

  pipeSidebar = function () {
    const open = S.pipeSideOpen;
    const aside = el(`<aside class="mod-l pl-side ${open ? '' : 'closed'}" style="${open ? `width:${S.leftW}px` : ''}">
      <div class="mod-l-head"><span class="b6 t13">파이프라인</span>
        <button class="iconbtn sp" id="plTgl" title="${open ? '목록 접기' : '목록 펼치기'}">
          ${ic14(open ? 'chevl' : 'menu')}</button></div>
      <div class="mod-l-body f1 col" style="min-height:0">
        <div class="pl-srch"><div class="srch">${ic14('search')}
          <input class="inp" id="plQ" placeholder="이름으로 검색" value="${esc(S.plQ)}"></div></div>
        <div class="f1 col" style="overflow:auto;padding:2px 8px 12px" id="plList"></div>
      </div>${open ? '<div class="grip l" title="폭 조절"></div>' : ''}</aside>`);
    $('#plTgl', aside).onclick = () => { S.pipeSideOpen = !S.pipeSideOpen; render(); };
    if (!open) return aside;

    const host = $('#plList', aside);
    const q = S.plQ.trim().toLowerCase();
    const hit = (x) => !q || x.name.toLowerCase().includes(q)
      || String(x.phys || '').toLowerCase().includes(q);

    const section = (kind, items) => {
      const s = STAGE[kind];
      const opened = S.plOpen[kind] !== false;
      const head = el(`<div class="pl-g ${opened ? '' : 'off'}">
        ${ic14('chevd', 'fnt')}${plSq(s.color)}
        <span class="pl-g-l f1">${s.label}</span>
        <span class="pl-g-n">${items.length}</span></div>`);
      head.onclick = () => { S.plOpen[kind] = !opened; render(); };
      head.title = `${s.label} — ${s.word} ${items.length}개 (${opened ? '접기' : '펼치기'})`;
      host.appendChild(head);
      if (!opened) return;
      if (!items.length) host.appendChild(sideEmpty(q ? '검색 결과가 없습니다.'
        : kind === 'ingest' ? '등록된 수집 작업이 없습니다.' : '등록된 파이프라인이 없습니다.'));
      items.forEach(x => host.appendChild(plSideRow(x, kind)));
    };

    section('ingest', ingsByNextRun().filter(hit));
    section('transform', pipesByNextRun().filter(hit));

    const inp = $('#plQ', aside);
    inp.oninput = (e) => {
      S.plQ = e.target.value;
      const c = e.target.selectionStart;
      render();
      const i2 = $('#plQ');
      if (i2) { i2.focus(); i2.setSelectionRange(c, c); }
    };
    /* 폭 조절 — 품질 화면과 같은 그립을 쓴다(S.leftW 공유). 카탈로그·품질에서 접거나
       넓힌 것이 여기서도 그대로여야 메뉴를 오갈 때 왼쪽 경계가 튀지 않는다. */
    if (typeof qWireGrip === 'function') qWireGrip(aside);
    return aside;
  };

  /* ============================================================
     3. 탭 줄 — 아이콘 대신 상태 점
     ============================================================ */

  pipeTabStrip = function () {
    const strip = el('<div class="ptabs"></div>');
    /* 첫 탭은 이름이 고정이라 폭도 글자에 맞춘다 — 뒤에 열리는 파이프라인 탭들과
       달리 사용자 데이터가 아니므로, 176px 을 잡아 두면 남는 자리가 그대로 빈다. */
    const dep = tabBtn({ label: '파이프라인 흐름', icon: 'flow', on: S.openPipe === 'deps' });
    dep.classList.add('tab-fit');
    dep.onclick = () => { S.openPipe = 'deps'; render(); };
    strip.appendChild(dep);
    S.openPipes.forEach(pid => {
      const ig = ingById(pid);
      const pp = ig || PIPES.find(x => x.id === pid);
      if (!pp) return;
      const st = ig ? runState(pp.lastRun) : pp.status;
      const t = tabBtn({ label: pp.name, on: S.openPipe === pid, closable: true });
      /* 아이콘 자리에 상태 점을 끼운다 — 탭이 여럿 열린 채로 훑을 때 어느 것이
         실패했는지가 탭 줄에서 바로 읽혀야 한다(원본 v2 의 변경). */
      t.insertBefore(el(plDot(st, pp.paused)), t.firstChild);
      t.onclick = (ev) => {
        if (ev.target.closest('.ptab-x')) { closePipeTab(pid); return; }
        S.openPipe = pid; S.pipe = pid; render();
      };
      strip.appendChild(t);
    });
    return strip;
  };

  /* ============================================================
     4. 파이프라인 흐름 — 두 단계를 열로 나눈 DAG + 하단 상세
     ============================================================ */

  S.plEdit = !!S.plEdit;                 /* 연결 편집 모드 (v2 ④) */
  S.plDockTab = S.plDockTab || 'info';   /* info | alert | link */

  /* 상자 크기. 원본은 270 · 290 인데 그 폭은 «오전 9:41» 같은 짧은 시각을 전제한다.
     이 앱의 시각 표기는 초까지 있는 절대 시각이라(b00 의 공통 규칙) 한 줄에
     저장 위치와 함께 넣으면 테이블 이름이 잘린다 — 이름은 식별자라 잘리면 안 된다.
     그래서 폭만 306 으로 넓히고 간격을 줄여 전체 너비는 원본과 같게 둔다.
     NH 는 실제로 그려지는 높이(68)와 같아야 한다 — 연결선이 이 값으로 상자의
     세로 가운데를 잡으므로 어긋나면 선이 카드 위쪽에 붙는다. */
  const NW_I = 306, NW_T = 306, NH = 68, GAPX = 150, STEP = 104, TOP = 76;

  /* 배치 — 수집 한 열, 가공은 파이프라인 사이 실행 의존성의 깊이만큼 열.
     가공 카드의 세로 위치는 «선행들의 평균» 이다. 그래야 연결선이 짧고, 어느
     수집이 어느 마트로 가는지가 선을 눈으로 따라가지 않아도 읽힌다. */
  function plLayout(d) {
    const ing = d.nodes.filter(n => n.kind === 'ingest');
    const tr = d.nodes.filter(n => n.kind !== 'ingest');
    const byId2 = {}; d.nodes.forEach(n => { byId2[n.id] = n; });
    const upOf = {}; d.nodes.forEach(n => { upOf[n.id] = []; });
    d.edges.forEach(e => { if (upOf[e.to]) upOf[e.to].push(e.from); });

    /* 열 = 가공끼리의 선행 깊이. 수집은 열을 만들지 않는다(항상 맨 왼쪽). */
    const depth = {};
    const dep = (id, guard) => {
      if (depth[id] != null) return depth[id];
      if (guard.has(id)) return 0;
      guard.add(id);
      const ups = upOf[id].filter(u => byId2[u] && byId2[u].kind !== 'ingest');
      depth[id] = ups.length ? Math.max(...ups.map(u => dep(u, guard))) + 1 : 0;
      return depth[id];
    };
    tr.forEach(n => dep(n.id, new Set()));

    const pos = {};
    ing.forEach((n, i) => { pos[n.id] = { x: 20, y: TOP + i * STEP, w: NW_I }; });

    const cols = {};
    tr.forEach(n => (cols[depth[n.id]] = cols[depth[n.id]] || []).push(n));
    Object.keys(cols).map(Number).sort((a, b) => a - b).forEach(c => {
      const x = 20 + NW_I + GAPX + c * (NW_T + GAPX);
      const want = cols[c].map(n => {
        const ys = upOf[n.id].map(u => pos[u] && pos[u].y).filter(v => v != null);
        return { n, y: ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : TOP };
      }).sort((a, b) => a.y - b.y);
      let prev = -Infinity;
      want.forEach(({ n, y }) => {
        const yy = Math.max(TOP, Math.round(Math.max(y, prev + STEP)));
        pos[n.id] = { x, y: yy, w: NW_T };
        prev = yy;
      });
    });

    const maxCol = Object.keys(cols).length ? Math.max(...Object.keys(cols).map(Number)) : 0;
    /* 마지막 열의 오른쪽 끝 + 여백. 열 간격을 한 번 더 더하면 오른쪽에 빈 칸이
       한 칸 생겨 «화면에 맞추기» 가 실제보다 작게 줄인다. */
    const w = Math.max(820, 20 + NW_I + GAPX + maxCol * (NW_T + GAPX) + NW_T + 20);
    const h = Math.max(420, ...d.nodes.map(n => pos[n.id].y + NH + 40));
    return { ing, tr, pos, w, h, maxCol, upOf };
  }

  /* 연결선 색 — 고른 카드를 기준으로 상류(선행)와 하류(후속)를 가른다.
     v1 은 성공/실패로 칠했는데, 그건 카드가 이미 말하고 있었다. 흐름도에서 선이
     답해야 할 질문은 «이것이 무엇을 기다리고, 무엇을 깨우나» 다. */
  const E_UP = 'rgba(52,199,89,.8)', E_DOWN = 'rgb(255,141,40)', E_OFF = 'var(--w-border)';
  const edgeColor = (e, sel) => (sel && e.from === sel ? E_DOWN : sel && e.to === sel ? E_UP : E_OFF);

  pdagView = function () {
    const box = el('<div class="f1 col pl-flow" style="min-height:0;position:relative"></div>');
    if (!PF.data) {
      if (!PF.loading && !PF.err) pdagLoad();
      box.appendChild(el(`<div class="empty" style="margin:auto">${ic(PF.err ? 'alert' : 'clock')}
        <span class="empty-t">${PF.err ? '흐름을 불러오지 못했습니다.' : '파이프라인 흐름을 불러오는 중…'}</span>
        ${PF.err ? `<span>${esc(PF.err)}</span>` : ''}</div>`));
      return box;
    }
    const d = PF.data;
    const L = plLayout(d);
    const edit = S.plEdit && R().canPipeEdit;

    /* 고른 카드 정리. 고른 것은 S.plSel 에 둔다 — wirePdagZoom 이 «빈 곳을 누르면
       선택 해제» 로 S.pdagSel 을 지우는데, 이 화면은 아래 상세가 늘 무언가를
       보여주므로 해제라는 상태가 없다. 지워지면 보던 것으로 되돌린다.
       (S.pdagSel 은 그 함수와의 계약이라 함께 맞춰 둔다.) */
    if (!d.nodes.some(n => n.id === S.plSel)) S.plSel = null;
    if (!S.plSel) {
      const bad = d.nodes.find(n => n.status === 'err');
      S.plSel = (bad || d.nodes[0] || {}).id || null;
    }
    S.pdagSel = S.plSel;
    const sel = S.plSel;
    const selNode = d.nodes.find(n => n.id === sel) || null;

    /* ── 요약 줄 ── */
    const fails = d.nodes.filter(n => n.status === 'err').length;
    const runs = d.nodes.filter(n => n.status === 'run').length;
    const bar = el(`<div class="mod-bar pl-bar">
      <span class="pl-sum">
        <span class="t12 fnt">전체</span>
        <span class="b6 num">${d.nodes.length}</span>
        <span class="num ${fails ? 'is-err' : 'fnt'}">실패 ${fails}</span>
        <span class="num ${runs ? 'is-run' : 'fnt'}">실행 중 ${runs}</span>
        <span class="t12 fnt">·</span>
        <span class="t12 fnt">기준 ${esc(PF.__at || nowLabel())}</span></span>
      <div class="row g6" style="flex:none">
        ${R().canPipeEdit ? `<button type="button" class="wc-btn wc-btn--sm wc-btn--${edit ? 'primary' : 'secondary'}" id="plEdit"
          title="켜면 카드의 연결점을 끌어 «선행 완료 후» 를 잇고, 연결 라벨을 눌러 끊을 수 있습니다.">
          ${ic14('link')}<span>연결 편집</span></button>` : ''}
        ${R().canPipeEdit ? `<button type="button" class="wc-btn wc-btn--sm wc-btn--secondary" id="plRunAll">
          ${ic14('play')}<span>전체 실행</span></button>` : ''}
      </div></div>`);
    box.appendChild(bar);

    /* ── 캔버스 ── */
    const z0 = S.pdagZoom || 1;
    const wrap = el(`<div class="erd-wrap f1" id="pdagWrap">
      <div id="pdagSizer" style="position:relative;width:${Math.round(L.w * z0)}px;height:${Math.round(L.h * z0)}px">
      <div id="pdagC" style="position:relative;width:${L.w}px;height:${L.h}px;transform:scale(${z0});transform-origin:0 0">
        <svg style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible"></svg>
      </div></div></div>`);
    const c = $('#pdagC', wrap), svg = $('svg', wrap);

    /* 열 머리말 */
    const laneHead = (x, s, n) => el(`<div class="pl-lane" style="left:${x}px">
      ${plSq(s.color)}<span class="pl-lane-l">${s.label}</span><span class="pl-lane-n">${n}</span></div>`);
    if (L.ing.length) c.appendChild(laneHead(20, STAGE.ingest, L.ing.length));
    if (L.tr.length) c.appendChild(laneHead(20 + NW_I + GAPX, STAGE.transform, L.tr.length));

    /* 연결선. 편집 모드에서만 라벨(= 끊는 자리)을 단다. */
    svg.innerHTML = d.edges.map(e => {
      const a = L.pos[e.from], b = L.pos[e.to];
      if (!a || !b) return '';
      const x0 = a.x + a.w, y0 = a.y + NH / 2, x1 = b.x, y1 = b.y + NH / 2;
      const dx = Math.max(40, (x1 - x0) / 2);
      const src = d.nodes.find(n => n.id === e.from) || {};
      const dst = d.nodes.find(n => n.id === e.to) || {};
      const dim = src.paused || dst.paused;
      const col = edgeColor(e, sel);
      const hot = col !== E_OFF;
      const path = `<path d="M ${x0} ${y0} C ${x0 + dx} ${y0}, ${x1 - dx} ${y1}, ${x1} ${y1}"
        fill="none" style="stroke:${col}" stroke-width="${hot ? 2.2 : 1.8}"
        ${dim ? 'stroke-dasharray="5 5"' : ''}></path>`;
      if (!edit) return path;
      const asset = e.cond === 'asset';
      const lw = asset ? 78 : 52, mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      return path + `<g transform="translate(${mx},${my})"
          ${asset ? '' : `data-edel="${esc(e.to)}" data-efrom="${esc(e.from)}"`}
          style="pointer-events:auto;cursor:${asset ? 'default' : 'pointer'}">
          <rect x="${-lw / 2}" y="-9" width="${lw}" height="18" rx="5"
            fill="var(--w-surface)" style="stroke:${col}"/>
          <text text-anchor="middle" dominant-baseline="central" font-size="10"
            style="fill:var(--w-text-2)">${asset ? '적재 완료 시' : '성공 시'}</text>
          <title>${asset
            ? '수집이 이 원천을 채우면 실행됩니다. 모델이 참조해 생긴 연결이라 여기서 끊을 수 없습니다.'
            : '누르면 연결을 해제합니다'}</title></g>`;
    }).join('');

    /* 카드 */
    d.nodes.forEach(n => {
      const p = L.pos[n.id];
      if (!p) return;
      const s = stageOf(n), st = n.status || 'wait';
      const off = !!n.paused && st === 'wait';
      const w = plWhen(n, st);
      /* 띠는 단계를 뜻하지만 실패한 것만은 붉게 올린다(원본 v2 도 그렇다).
         목록을 훑을 때 «어느 단계인가» 보다 «무엇이 깨졌나» 를 먼저 찾기 때문이다. */
      const card = el(`<div class="pl-n pf-n ${n.id === sel ? 'sel' : ''} ${off ? 'off' : ''} ${st === 'err' ? 'bad' : ''}"
          data-pf="${esc(n.id)}" style="left:${p.x}px;top:${p.y}px;width:${p.w}px"
          title="${esc(n.name)}\n${esc(plWhat(n))}\n${esc(plTrigger(n))}">
        <div class="pl-n-band" style="background:${off ? OFF : st === 'err' ? 'var(--w-danger)' : s.color}"></div>
        <div class="pl-n-b">
          <div class="pl-n-t"><span class="f1 trunc">${esc(n.name)}</span>${plDot(st, n.paused)}</div>
          <div class="pl-n-m">
            <span class="mono trunc">${esc(plWhat(n))}</span>
            <span class="pl-n-w" style="color:${w.tone}">${esc(w.text)}</span></div>
        </div>
        <span class="pl-port i"></span>
        ${edit ? `<span class="pl-port o" data-pconn="${esc(n.id)}" title="끌어서 후행 파이프라인에 연결"></span>` : ''}
      </div>`);
      card.onclick = () => { S.plSel = n.id; S.plDockTab = 'info'; render(); };
      card.ondblclick = () => openPipeTab(n.id);
      card.oncontextmenu = (ev) => {
        const pp = PIPES.find(x => x.id === n.id);
        if (!pp) return;
        ev.preventDefault(); ev.stopPropagation();
        pipeNodeMenu(pp, ev.clientX, ev.clientY);
      };
      c.appendChild(card);
    });

    wrap.addEventListener('scroll', () => { S.__pfScroll = { l: wrap.scrollLeft, t: wrap.scrollTop }; },
                          { passive: true });

    /* 범례·배율은 캔버스 위에 떠 있어야 한다 — 아래 상세가 붙으므로 흐름 전체가
       아닌 캔버스 칸(.pl-stage)을 좌표계로 잡는다. */
    const stage = el('<div class="pl-stage"></div>');
    stage.appendChild(wrap);
    stage.appendChild(el(`<div class="pl-leg">
      <span>${plSq(STAGE.ingest.color)}수집</span>
      <span>${plSq(STAGE.transform.color)}가공</span>
      <i></i>
      <span><em style="background:${E_UP}"></em>선행</span>
      <span><em style="background:${E_DOWN}"></em>후속</span>
      <i></i>
      <span>${plDot('ok')}성공</span>
      <span>${plDot('run')}실행 중</span>
      <span>${plDot('err')}실패</span></div>`));
    stage.appendChild(el(`<div class="zoomlbl">
      <button class="lnk" id="pdagFit" title="전체가 보이도록 배율을 맞춥니다.">화면에 맞추기</button>
      <span style="margin:0 6px;color:var(--line)">|</span>
      <button class="lnk" id="pdagZ1" title="배율을 100% 로 되돌립니다.">배율 ${Math.round(z0 * 100)}%</button></div>`));
    box.appendChild(stage);
    $('#pdagZ1', stage).onclick = () => { S.pdagZoom = 1; render(); };
    $('#pdagFit', stage).onclick = () => {
      const z = Math.max(0.3, Math.min(1, (wrap.clientWidth - 48) / L.w, (wrap.clientHeight - 48) / L.h));
      S.pdagZoom = Math.round(z * 100) / 100;
      S.__pfScroll = { l: 0, t: 0 };
      render();
    };
    wirePdagZoom(wrap, L.w, L.h);

    /* ── 하단 상세 ── */
    if (selNode) box.appendChild(plFlowDock(selNode, d));

    /* ── 요약 줄의 동작 ── */
    const eb = $('#plEdit', bar);
    if (eb) eb.onclick = () => { S.plEdit = !S.plEdit; render(); };
    const ra = $('#plRunAll', bar);
    if (ra) ra.onclick = () => plRunAll(d);

    if (edit) plWireEdit(wrap, c, svg, d, L);

    /* 돌고 있으면 상태를 따라간다 — 화면은 그대로 두고 값만 바꿔 끼운다(pdagTick) */
    if (d.nodes.some(n => n.status === 'run') && !PF.__t) pdagTick();
    return box;
  };

  /* 전체 실행 — 여러 DAG 을 한꺼번에 깨우는 동작이라 무엇이 도는지 먼저 보여준다. */
  async function plRunAll(d) {
    const pipes = PIPES.filter(pp => !pp.paused);
    const jobs = ING.filter(j => j.kind === 'api' && !j.paused);
    if (!pipes.length && !jobs.length) {
      toast('실행할 수 있는 항목이 없습니다. 예약이 모두 꺼져 있습니다.', 'warn');
      return;
    }
    const list = [...jobs.map(j => j.name), ...pipes.map(p => p.name)];
    const ok = await confirmModal({
      title: '전체 실행',
      ok: '전체 실행',
      body: `아래 ${list.length}개를 지금 실행합니다.<br>`
        + `<b>${esc(list.slice(0, 8).join(', '))}${list.length > 8 ? ` 외 ${list.length - 8}개` : ''}</b><br>`
        + '예약이 꺼진 항목은 실행하지 않습니다. 가공은 선행 수집이 끝나는 대로 이어서 돕니다.',
    });
    if (!ok) return;
    let done = 0;
    for (const j of jobs) {
      try { await api(`/ingest/jobs/${enc(j.id)}/runs`, { method: 'POST' }); done++; }
      catch (e) { fail(e); }
    }
    for (const pp of pipes) {
      try { await api(`/pipelines/${enc(pp.id)}/runs`, { method: 'POST', body: JSON.stringify({ triggered_by: '' }) }); done++; }
      catch (e) { fail(e); }
    }
    toast(`${done}개를 실행했습니다. 잠시 후 상태가 갱신됩니다.`);
    PF.data = null;
    await boot({ keep: true });
    render();
  }

  /* 연결 편집 — 포트를 끌어 «선행 완료 후», 라벨을 눌러 해제. v1 의 동작 그대로다. */
  function plWireEdit(wrap, c, svg, d, L) {
    const setTrigger = async (pid, body, msg) => {
      try {
        await api(`/pipelines/${enc(pid)}/config`, { method: 'PUT', body: JSON.stringify(body) });
        PF.data = null; toast(msg); await boot({ keep: true }); render();
      } catch (e) { fail(e); }
    };

    $$('g[data-edel]', svg).forEach(g => {
      g.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const to = g.dataset.edel;
        const pp = PIPES.find(x => x.id === to) || {};
        const from = PIPES.find(x => x.id === g.dataset.efrom) || {};
        const nx = (pp.freq && pp.freq !== '수동 실행') ? 'schedule' : 'manual';
        const ok = await confirmModal({
          title: '파이프라인 연결 해제', tone: 'warn', ok: '연결 해제',
          body: `${esc(from.name)} → ${esc(pp.name)} 트리거 연결을 해제합니다.<br>`
            + `해제하면 ${esc(pp.name)} 은(는) <b>${nx === 'schedule' ? esc(pp.freq) + ' 예약' : '수동'}</b> 실행으로 돌아갑니다.<br>`
            + '모델 사이의 데이터 의존성은 바뀌지 않습니다.',
        });
        if (!ok) return;
        setTrigger(to, { trigger_type: nx, clear_upstream: true },
                   `연결을 해제했습니다 — ${pp.name} 은(는) 이제 독립 실행됩니다.`);
      });
    });

    $$('[data-pconn]', c).forEach(port => {
      port.addEventListener('mousedown', (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        const from = port.dataset.pconn;
        const zz = S.pdagZoom || 1;
        const r0 = c.getBoundingClientRect(), p0 = port.getBoundingClientRect();
        const x0 = (p0.left - r0.left + 4) / zz, y0 = (p0.top - r0.top + 4) / zz;
        const tmp = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        tmp.setAttribute('fill', 'none');
        tmp.setAttribute('stroke-width', '2.2');
        tmp.setAttribute('stroke-dasharray', '5 4');
        tmp.style.stroke = E_DOWN;
        svg.appendChild(tmp);
        const mv = (e2) => {
          const x1 = (e2.clientX - r0.left) / zz, y1 = (e2.clientY - r0.top) / zz;
          const dx = Math.max(30, (x1 - x0) / 2);
          tmp.setAttribute('d', `M ${x0} ${y0} C ${x0 + dx} ${y0}, ${x1 - dx} ${y1}, ${x1} ${y1}`);
          const hit = document.elementFromPoint(e2.clientX, e2.clientY);
          const node = hit && hit.closest('.pl-n');
          $$('.pl-n', c).forEach(nn => nn.classList.toggle('drop', nn === node && nn.dataset.pf !== from));
        };
        const up = (e2) => {
          document.removeEventListener('mousemove', mv);
          document.removeEventListener('mouseup', up);
          tmp.remove();
          const hit = document.elementFromPoint(e2.clientX, e2.clientY);
          const node = hit && hit.closest('.pl-n');
          $$('.pl-n', c).forEach(nn => nn.classList.remove('drop'));
          if (!node || node.dataset.pf === from) return;
          const to = node.dataset.pf;
          const pp = PIPES.find(x => x.id === to);
          if (!pp) { toast('수집 작업은 다른 것의 후행이 될 수 없습니다.', 'warn'); return; }
          if (!PIPES.some(x => x.id === from)) {
            toast('수집이 가공을 깨우는 연결은 모델이 그 원천을 참조해서 생깁니다 — 여기서 잇지 않습니다.', 'warn');
            return;
          }
          setTrigger(to, { trigger_type: 'upstream', upstream_pipeline_id: from },
                     `${(PIPES.find(x => x.id === from) || {}).name} 성공 후 ${pp.name} 이(가) 실행됩니다.`);
        };
        document.addEventListener('mousemove', mv);
        document.addEventListener('mouseup', up);
      });
    });
  }

  /* ── 흐름 하단 상세 ─────────────────────────────────────────── */
  function plFlowDock(n, d) {
    const s = stageOf(n), st = n.status || 'wait';
    const isIng = n.kind === 'ingest';
    const pp = isIng ? null : PIPES.find(x => x.id === n.id);
    const job = isIng ? ingById(n.id) : null;
    const downs = d.edges.filter(e => e.from === n.id)
      .map(e => (d.nodes.find(x => x.id === e.to) || {}).name).filter(Boolean);
    const ups = d.edges.filter(e => e.to === n.id)
      .map(e => (d.nodes.find(x => x.id === e.from) || {}).name).filter(Boolean);
    const badUp = d.edges.filter(e => e.to === n.id)
      .map(e => d.nodes.find(x => x.id === e.from)).filter(x => x && x.status === 'err');

    const p = el(`<div class="dock pdock pl-dock" style="flex:0 1 auto;max-height:calc(100% - 132px)">
      <div class="grip-h" id="gripPH" title="높이 조절"></div>
      <div class="dock-scroll"></div></div>`);
    const scroll = $('.dock-scroll', p);

    /* 머리 — 무엇을 보고 있는가 + 그것에 대한 동작. 탭 위에 두어, 탭을 옮겨도
       «지금 무엇을 보고 있는지» 가 같은 자리에 남는다(모델 상세와 같은 규칙). */
    const head = el(`<div class="dk-head pl-head-w">
      <div class="pl-dock-h">
        ${plSq(st === 'wait' && n.paused ? OFF : s.color)}
        <span class="pl-dock-t trunc" title="${esc(n.name)}">${esc(n.name)}</span>
        <span class="pl-dock-k">${s.label}</span>
        ${plBadge(st)}
        <span class="pl-chip-h"></span>
        <div class="pl-act"></div></div></div>`);
    $('.pl-chip-h', head).appendChild(
      plChip(isIng ? (n.phys || '—') : plSchemaOf(pp), isIng ? (job && job.target) : null));
    const act = $('.pl-act', head);
    act.appendChild(plBtn('상세 열기', 'secondary', null, () => openPipeTab(n.id),
                          { size: 'md', title: '탭으로 열어 실행 이력과 모델을 봅니다.' }));
    if (R().canPipeEdit) {
      act.appendChild(plBtn(st === 'err' ? '다시 실행' : '지금 실행', 'primary',
        st === 'err' ? 'rot' : 'play', () => plRunOne(n), { size: 'md', off: !!(isIng && job && job.kind === 'file') }));
    }
    /* 설명 — 서버가 준 것만. 없으면 그 줄을 두지 않는다. */
    const desc = isIng ? plIngDesc(job, n) : (pp && pp.desc) || '';
    if (desc) head.appendChild(el(`<p class="pl-desc">${esc(desc)}</p>`));
    scroll.appendChild(head);

    const alerts = badUp.length || st === 'err' ? 1 : 0;
    const tabrow = el('<div class="dock-h pl-tabrow"></div>');
    tabrow.appendChild(plTabs([
      { key: 'info', label: '실행 정보' },
      { key: 'alert', label: '알림', badge: String(alerts),
        badgeTone: alerts ? 'var(--w-danger)' : 'var(--w-text-3)' },
      { key: 'link', label: '연결' },
    ], S.plDockTab, (k) => { S.plDockTab = k; render(); }));
    scroll.appendChild(tabrow);

    const b = el('<div class="dock-b pl-dock-b"></div>');
    const grid = el('<div class="pl-dock-g"></div>');
    b.appendChild(grid);
    scroll.appendChild(b);

    if (S.plDockTab === 'link') {
      const list = (title, names, empty) => `<div class="col g6">
        <span class="sect-t">${esc(title)}</span>
        ${names.length ? names.map(x => `<div class="pl-linkrow">${ic14('flow', 'fnt')}<span class="t12 trunc">${esc(x)}</span></div>`).join('')
          : `<span class="t12 fnt">${esc(empty)}</span>`}</div>`;
      grid.classList.add('one');
      grid.appendChild(el(`<div class="pl-links">
        ${list('선행 ' + ups.length + '개', ups, '기다리는 것이 없습니다 — 흐름의 시작입니다.')}
        ${list('후속 ' + downs.length + '개', downs, '이어지는 것이 없습니다.')}</div>`));
      return plChrome(p);
    }

    if (S.plDockTab === 'alert') {
      grid.classList.add('one');
      grid.appendChild(plAlertBox(n, st, badUp, true));
      return plChrome(p);
    }

    /* 실행 정보 — 왼쪽 속성, 오른쪽 최근 실행 */
    const l = plLast(n);
    grid.appendChild(plKv([
      ['실행 방식', esc(plTrigger(n))],
      ['최근 실행', `<span class="num">${esc(l && l.at ? shortTime(l.at) : '실행 이력 없음')}</span>`],
      ['소요', `<span class="num">${esc(l && l.sec != null ? durLabel(l.sec) : '—')}</span>`],
      ['다음 단계', esc(downs.length ? downs.join(' · ') : '이어지는 것이 없습니다.')],
    ], {
      title: '속성',
      edit: R().canPipeEdit && pp ? () => pipeCfgModal(pp)
        : R().canPipeEdit && job ? () => ingestModal(job) : null,
    }));

    const right = el('<div class="col g10" style="min-width:0"></div>');
    right.appendChild(el(`<div class="row g8">
      <span class="sect-t f1">최근 실행</span>
      <span class="t11 fnt">최근 10회 · 왼쪽이 과거</span></div>`));
    const rr = plRuns(n.id, n.kind, 10);
    if (rr.loading) right.appendChild(el('<span class="t12 fnt">실행 이력을 불러오는 중…</span>'));
    else if (rr.err) right.appendChild(el(`<span class="t12 fnt">실행 이력을 불러오지 못했습니다: ${esc(rr.err)}</span>`));
    else right.appendChild(plBars(rr.items));
    right.appendChild(plAlertBox(n, st, badUp, false));
    grid.appendChild(right);
    return plChrome(p);
  }

  /* 알림 상자 — 실패했거나 선행이 실패해 대기 중일 때만 붉은 상자다.
     아무 문제가 없으면 그렇다고 한 줄로 말한다(빈 자리로 두면 «못 받았나» 로 읽힌다). */
  function plAlertBox(n, st, badUp, full) {
    const l = plLast(n);
    if (st === 'err') {
      const w = el(`<div class="pl-alert">${ic('alert')}
        <div class="f1 col g4">
          <span class="b6 t13">마지막 실행이 실패했습니다${l && l.at ? ` (${esc(shortTime(l.at))})` : ''}.</span>
          <span class="t12">${esc(n.kind === 'ingest'
            ? '실행 이력에서 실패한 실행을 누르면 원천이 무엇을 돌려줬는지 로그로 볼 수 있습니다.'
            : '실패한 모델을 고르면 그 모델의 dbt 로그가 열립니다.')}</span>
        </div></div>`);
      const b = plBtn('이력 보기', 'secondary', null, () => openPipeTab(n.id));
      w.appendChild(b);
      return w;
    }
    if (badUp.length) {
      const w = el(`<div class="pl-alert">${ic('alert')}
        <div class="f1 col g4">
          <span class="b6 t13">선행 실패로 대기 중입니다.</span>
          <span class="t12">${esc(badUp.map(x => x.name).join(' · '))} 이(가) 실패해 이 단계가 시작되지 않았습니다.</span>
        </div></div>`);
      const b = plBtn('선행 보기', 'secondary', null, () => { S.plSel = badUp[0].id; render(); });
      w.appendChild(b);
      return w;
    }
    const msg = st === 'run' ? '지금 실행 중입니다.'
      : n.paused ? '예약이 꺼져 있습니다. 지금 실행 버튼으로만 돕니다.'
      : !l || !l.at ? '아직 실행한 적이 없습니다.'
      : '마지막 실행이 정상으로 끝났습니다.';
    return el(`<div class="pl-ok ${full ? 'full' : ''}">${ic14('checkc')}<span>${esc(msg)}</span></div>`);
  }

  /* 가공 파이프라인이 쓰는 스키마 — 실행 대상 모델의 저장 위치에서 뽑는다 */
  function plSchemaOf(pp) {
    if (!pp) return 'analytics.*';
    const first = (pp.targets || []).map(byId).find(Boolean);
    const phys = first && first.phys ? String(first.phys) : '';
    return phys.includes('.') ? phys.split('.')[0] + '.*' : 'analytics.*';
  }

  /* 수집 작업의 설명 — 서버가 설명 칸을 주지 않으므로 원천·대상으로 한 줄을 만든다 */
  function plIngDesc(job, n) {
    if (!job) return '';
    const src = job.kind === 'file' ? '올린 파일' : (ingUrl(job) ? '원천 API' : '외부 원천');
    return `${src}에서 받아 ${n.phys || job.phys || ''} 에 적재합니다.`
      + (job.kind === 'file' ? ' 파일을 올릴 때 그 자리에서 적재합니다.' : '');
  }

  async function plRunOne(n) {
    try {
      if (n.kind === 'ingest') {
        await api(`/ingest/jobs/${enc(n.id)}/runs`, { method: 'POST' });
        toast(`${n.name} 을(를) 실행했습니다. 잠시 후 이력에 나타납니다.`);
      } else {
        await api(`/pipelines/${enc(n.id)}/runs`, { method: 'POST', body: JSON.stringify({ triggered_by: '' }) });
        toast(`${n.name} 을(를) 실행합니다.`);
      }
      Object.keys(RUNS).forEach(k => { if (k.startsWith(n.id + '/')) delete RUNS[k]; });
      PF.data = null;
      await boot({ keep: true });
      render();
    } catch (e) { fail(e); }
  }

  /* ============================================================
     5. 수집 작업 탭
     ============================================================ */

  S.plIngTab = S.plIngTab || 'runs';    /* runs | cfg | log */

  ingTabBody = function (j, r) {
    const st = runState(j.lastRun);
    const s = STAGE.ingest;
    const center = el('<div class="mod-c col pl-ing" style="min-height:0"></div>');
    const body = el('<div class="f1 col" style="overflow:auto"></div>');

    /* 머리 — 원본의 제목줄 그대로. 이름·단계·상태·저장 위치·동작이 한 줄이다. */
    const head = el(`<div class="pl-head">
      ${plSq(st === 'wait' && j.paused ? OFF : s.color)}
      <span class="pl-head-t trunc" title="${esc(j.name)}">${esc(j.name)}</span>
      <span class="pl-dock-k">${s.label}</span>
      ${plBadge(st)}
      <span class="pl-chip-h"></span>
      <div class="row g6" style="margin-left:auto;flex:none"></div></div>`);
    $('.pl-chip-h', head).appendChild(plChip(j.phys || '—', j.target));
    const act = $('.row.g6', head);
    if (r.canPipeEdit) {
      act.appendChild(plBtn('설정', 'secondary', null, () => ingestModal(j), { size: 'md' }));
      if (j.kind === 'api') {
        act.appendChild(plBtn(st === 'err' ? '다시 실행' : '지금 실행', 'primary',
          st === 'err' ? 'rot' : 'play', () => plRunOne({ id: j.id, kind: 'ingest', name: j.name }), { size: 'md' }));
      }
    }
    body.appendChild(head);

    /* 실패 안내 — 무엇이 실패했고 여기서 무엇을 할 수 있는지 */
    if (st === 'err') {
      const lr = j.lastRun || {};
      const w = el(`<div class="pl-alert big">${ic('alert')}
        <div class="f1 col g6">
          <span class="b6 t14">마지막 수집이 실패했습니다${lr.start ? ` (${esc(shortTime(lr.start))})` : ''}.</span>
          <span class="t13">원천이 무엇을 돌려줬는지는 실행 로그에 남아 있습니다.
            인증·주소·응답 형식이 바뀌면 여기서 먼저 드러납니다.</span>
          <div class="row g6"></div>
        </div></div>`);
      const row = $('.row.g6', w);
      row.appendChild(plBtn('로그 보기', 'secondary', null, () => {
        S.plIngTab = 'log'; S.plLogRun = lr.runId || null; render();
      }));
      if (r.canPipeEdit) row.appendChild(plBtn('수집 설정 열기', 'secondary', null, () => ingestModal(j)));
      body.appendChild(w);
    }

    body.appendChild(plTabs([
      { key: 'runs', label: '실행 이력' },
      { key: 'cfg', label: '수집 설정' },
      { key: 'log', label: '로그' },
    ], S.plIngTab, (k) => { S.plIngTab = k; render(); }));

    const pane = el('<div class="pl-pane"></div>');
    body.appendChild(pane);
    center.appendChild(body);

    if (S.plIngTab === 'cfg') { pane.appendChild(plIngCfg(j, r)); return center; }
    if (S.plIngTab === 'log') { pane.appendChild(plIngLog(j)); return center; }

    /* 실행 이력 — 왼쪽 최근 실행·속성, 오른쪽 표 */
    const grid = el('<div class="pl-dock-g"></div>');
    pane.appendChild(grid);

    const left = el('<div class="col g10"></div>');
    left.appendChild(el('<span class="sect-t">최근 실행</span>'));
    const rr = plRuns(j.id, 'ingest', 10);
    if (rr.loading) left.appendChild(el('<span class="t12 fnt">불러오는 중…</span>'));
    else if (rr.err) left.appendChild(el(`<span class="t12 fnt">${esc(rr.err)}</span>`));
    else left.appendChild(plBars(rr.items));
    const okRun = (rr.items || []).find(x => x.st === 'ok');
    left.appendChild(plKv([
      ['실행 방식', esc(j.paused ? '예약 꺼짐' : (nextRunLabel(j.nextRun) || j.freq || '수동 실행'))],
      ['최근 성공', `<span class="num">${esc(okRun && okRun.start ? shortTime(okRun.start) : '없음')}</span>`],
      ['적재 대상', `<span class="mono t12">${esc(j.phys || '—')}</span>`],
    ]));
    grid.appendChild(left);

    const right = el('<div class="col g8" style="min-width:0"></div>');
    if (j.kind === 'file') {
      right.appendChild(el('<span class="t12 fnt">파일 수집은 파일을 올릴 때 그 자리에서 적재합니다. 예약 실행 이력이 없습니다.</span>'));
    } else {
      const t = el(`<div class="wc-table wc-table--compact"><div class="wc-table__scroll">
        <table><thead><tr><th>실행</th><th style="width:96px">상태</th>
        <th style="width:180px">시작</th><th style="width:88px" class="wc-table__num">소요</th></tr></thead>
        <tbody></tbody></table></div></div>`);
      const tb = $('tbody', t);
      const rows = plRuns(j.id, 'ingest', 20);
      if (rows.loading) $('.wc-table__scroll', t).appendChild(el('<div class="wc-table__empty">불러오는 중…</div>'));
      else if (rows.err) $('.wc-table__scroll', t).appendChild(el(`<div class="wc-table__empty">${esc(rows.err)}</div>`));
      else if (!(rows.items || []).length) $('.wc-table__scroll', t).appendChild(el('<div class="wc-table__empty">아직 실행한 적이 없습니다.</div>'));
      else rows.items.forEach(x => {
        const tr = el(`<tr style="cursor:pointer" title="누르면 로그가 열립니다">
          <td><span class="mono t12 trunc">${esc(x.id)}</span></td>
          <td>${plBadge(x.st)}</td>
          <td class="num" style="color:var(--w-text-2)">${esc(x.start ? shortTime(x.start) : '—')}</td>
          <td class="wc-table__num num">${esc(x.sec != null ? durLabel(x.sec) : '—')}</td></tr>`);
        tr.onclick = () => { S.plIngTab = 'log'; S.plLogRun = x.id; render(); };
        tb.appendChild(tr);
      });
      right.appendChild(t);
      right.appendChild(el('<span class="t11 fnt">실행을 누르면 로그 탭에서 그 실행의 로그를 엽니다.</span>'));
    }
    grid.appendChild(right);
    return center;
  };

  /* 수집 설정 — 읽기 전용 요약. 값을 고치는 곳은 기존 설정 모달 하나다.
     원천 주소는 config 안에 있다(인증 키는 서버가 이미 가려서 준다). */
  const ingUrl = (j) => (j && j.config && j.config.url) || '';

  function plIngCfg(j, r) {
    const url = ingUrl(j);
    const w = el('<div class="col g12" style="max-width:720px"></div>');
    w.appendChild(plKv([
      ['수집 방식', esc(ING_KIND[j.kind] || j.kind || '—')],
      ['원천', url ? `<span class="mono t12 trunc" title="${esc(url)}">${esc(url)}</span>` : '—'],
      ['적재 대상', `<span class="mono t12">${esc(j.phys || '—')}</span>`],
      ['적재 방식', esc(j.mode === 'replace' ? '전체 적재' : j.mode === 'append' ? '증분 적재' : j.mode || '—')],
      ['실행 방식', esc(j.paused ? '예약 꺼짐' : (j.freq || '수동 실행'))],
      ['다음 실행', esc(nextRunLabel(j.nextRun) || '—')],
    ], { title: '수집 설정', edit: r.canPipeEdit ? () => ingestModal(j) : null }));
    w.appendChild(el('<span class="t11 fnt">수집은 «가져와서 그대로 넣기» 만 합니다. 컬럼을 고르거나 값을 바꾸는 것은 데이터 모델의 일입니다.</span>'));
    return w;
  }

  /* 로그 — 고른 실행 하나. 고르지 않았으면 가장 최근 실행. */
  function plIngLog(j) {
    const w = el('<div class="col g8" style="min-width:0"></div>');
    const rr = plRuns(j.id, 'ingest', 20);
    if (rr.loading) { w.appendChild(el('<span class="t12 fnt">불러오는 중…</span>')); return w; }
    const items = rr.items || [];
    if (!items.length) { w.appendChild(el('<span class="t12 fnt">아직 실행한 적이 없습니다.</span>')); return w; }
    const cur = items.find(x => x.id === S.plLogRun) || items.find(x => x.st === 'err') || items[0];

    const pick = el(`<div class="row g8"><span class="sect-t">실행</span>
      <select class="inp" style="max-width:420px">${items.map(x =>
        `<option value="${esc(x.id)}" ${x.id === cur.id ? 'selected' : ''}>${esc(x.id)} — ${esc(tone(x.st).label)}</option>`).join('')}</select>
      </div>`);
    $('select', pick).onchange = (e) => { S.plLogRun = e.target.value; render(); };
    w.appendChild(pick);

    const box = el('<div class="code" style="max-height:340px;overflow:auto;white-space:pre-wrap">로그를 가져오는 중…</div>');
    w.appendChild(box);
    api(`/ingest/jobs/${enc(j.id)}/runs/${enc(cur.id)}/log`).then(r2 => {
      const t = (r2.log || '').trim() || '(로그가 비어 있습니다)';
      box.textContent = t.length > 20000 ? '…\n' + t.slice(-20000) : t;
    }).catch(e => { box.textContent = (e && e.message) || '로그를 가져오지 못했습니다.'; });
    return w;
  }

  /* ============================================================
     6. 가공 파이프라인 탭 — 모델 카드 + 빌드 결과
     ============================================================ */

  /* 모델 카드. 원본 v2 는 색 띠 + 이름(mono) + 저장 위치 + 소요다.
     띠 색은 구분(SOURCE·DATA MODEL·DATA MART)이고, 상태는 점이 말한다.
     상자 크기(PW·PH)는 서버가 계산한 좌표(graph.py COL_W·ROW_H)와 짝이라 그대로 둔다. */
  pnodeEl = function (pp, n, runs, edit) {
    const md = byId(n.id);
    const marker = n.kind === 'marker';
    const d = md || {
      name: n.name || n.id,
      phys: marker ? '이 위의 Task 가 모두 성공하면 완료됩니다' : ((n.models || []).join(' · ') || '—'),
      kind: n.kind || 'task', mat: '—', layer: '', group: 'DATA MODEL',
    };
    const rn = runs ? (runs[n.key] || { st: 'wait' }) : null;
    const src = d.kind === 'source';
    const seq = n.seq != null ? n.seq : execSeq(pp)[n.key];
    const st = rn ? rn.st : 'wait';
    /* 조회 전용 — 적재는 이 모델을 소유한 다른 파이프라인이 한다. 여기서는 읽기만
       하므로 상태·소요를 달지 않는다(남의 실행 상태를 내 카드에 적지 않는다).
       예전에는 api.js 가 이 함수를 감싸 표시를 입혔는데, 이 파일이 본체를 갈아끼우고
       마크업도 달라져 그 래퍼가 붙을 자리가 없다 — 여기서 함께 그린다. */
    const ro = !!n.ro;
    const owner = ro ? PIPES.find(x => x.id !== pp.id && x.__flow
      && (x.__flow.order || []).includes(n.id)) : null;
    const e = el(`<div class="pn pl-pn ${src ? 'src' : ''} ${marker ? 'done' : ''} ${ro ? 'pn-ro' : ''} ${S.pipeNodeK === n.key ? 'sel' : ''}"
        data-pk="${n.key}"
        title="${esc(d.name)}\n${esc(d.phys)}${ro ? '\n조회 전용 — 적재는 원래 담당 파이프라인이 맡습니다'
          + (owner ? '\n적재 담당: ' + esc(owner.name) : '')
          : src ? '\n참조 전용 · 실행하지 않음' : marker ? '' : '\n실행 순서 ' + seq}"
        style="left:${n.x}px;top:${n.y}px">
      <div class="pn-t" style="background:${marker ? 'var(--accents-mint)' : ro ? OFF
        : st === 'err' ? 'var(--w-danger)' : grpColor(d)}"></div>
      <div class="pl-pn-b">
        <div class="pl-pn-h">
          <span class="pl-pn-n mono trunc">${esc(d.name)}</span>
          ${marker ? ic14('checkc', 'fnt') : ro ? '' : plDot(st)}</div>
        <div class="pl-pn-m">
          <span class="mono trunc">${esc(d.phys)}</span>
          <span class="pl-pn-d num">${ro ? '조회 전용'
            : esc(rn && rn.dur && rn.dur !== '—' ? rn.dur
              : src ? '참조' : marker ? '' : tone(st).label)}</span></div>
      </div>
      <span class="pport i"></span><span class="pport o" data-pport="${n.key}"></span>
      ${edit ? `<button class="pn-x" data-prm="${n.key}" title="캔버스에서 제거">${ic14('x')}</button>` : ''}</div>`);
    return e;
  };

  /* 하단 상세 — 고른 모델의 빌드 결과. 원본의 탭 순서를 따른다.
     이력(dbt 호출 단위 전체 이력)은 원본에 그려지지 않았지만 다른 자리에 갈 곳이
     없는 실제 기능이라 마지막 탭으로 남긴다. */
  const MTABS = [['result', '실행 결과'], ['quality', '품질 결과'], ['log', '로그'], ['hist', '이력']];
  const MTAB_KO = { '빌드 정보': 'result', '품질 결과': 'quality', '로그': 'log', '이력': 'hist' };

  pipeDock = function (pp) {
    const g = pgraph(pp), runs = runsG(pp), r = R();
    /* 옛 상태(한글 탭 이름)가 남아 있으면 옮겨 준다 — 주소(?tab=)로도 들어온다 */
    if (MTAB_KO[S.pipeTab]) S.pipeTab = MTAB_KO[S.pipeTab];
    if (!MTABS.some(([k]) => k === S.pipeTab)) S.pipeTab = 'result';

    const n = S.pipeNodeK && nodeOf(g, S.pipeNodeK);
    const d = n && byId(n.id);
    const rn = (n && runs[n.key]) || { st: 'wait' };

    const p = el(`<div class="dock pdock pl-dock" style="flex:0 1 auto;max-height:calc(100% - 132px)">
      <div class="grip-h" id="gripPH" title="높이 조절"></div>
      <div class="dock-scroll"></div></div>`);
    const scroll = $('.dock-scroll', p);

    const head = el(`<div class="dk-head pl-head-w">
      <div class="pl-dock-h">
        ${plSq(d ? grpColor(d) : 'var(--w-border-strong)')}
        <span class="pl-dock-t mono trunc" title="${esc(d ? d.name : '')}">${esc(d ? d.name : '모델을 고르세요')}</span>
        ${d ? `<span class="pl-dock-k">${esc(grpOf(d))}</span>${plBadge(rn.st)}` : ''}
        <span class="pl-chip-h"></span>
        <div class="pl-act"></div></div></div>`);
    if (d) $('.pl-chip-h', head).appendChild(plChip(d.phys || '—', d.id));
    const act = $('.pl-act', head);
    if (d) {
      if (r.canPipeEdit && rn.st !== 'wait') {
        act.appendChild(plBtn('재실행', 'secondary', 'rot', () => rerunConfirm(pp, n), { size: 'md' }));
      }
      act.appendChild(plBtn('모델 열기', 'secondary', 'doc', () => {
        S.mView = 'def'; S.mTab = 'SQL'; go('modeling', n.id);
      }, { size: 'md' }));
    }
    scroll.appendChild(head);

    const qn = d ? rulesOf(n.id).filter(x => x.active).length : 0;
    const tabrow = el('<div class="dock-h pl-tabrow"></div>');
    tabrow.appendChild(plTabs(MTABS.map(([k, label]) => ({
      key: k, label,
      badge: k === 'quality' && d ? String(qn) : null,
    })), S.pipeTab, (k) => { S.pipeTab = k; render(); }));
    scroll.appendChild(tabrow);

    const b = el('<div class="dock-b pl-dock-b"></div>');
    const pane = el('<div class="pl-pane"></div>');
    b.appendChild(pane);
    scroll.appendChild(b);

    if (S.pipeTab === 'hist') {
      pane.appendChild(typeof historyView === 'function' ? historyView()
        : el(`<div class="empty">${ic('clock')}<span class="empty-t">실행 이력을 불러올 수 없습니다.</span></div>`));
    } else if (!d) {
      pane.appendChild(el(`<div class="empty">${ic('model')}
        <span class="empty-t">흐름도에서 모델을 선택해 주세요.</span></div>`));
    } else if (S.pipeTab === 'result') {
      const grid = el('<div class="pl-dock-g"></div>');
      pane.appendChild(grid);
      const ord = n.seq != null ? n.seq : execSeq(pp)[n.key];
      const left = el('<div class="col g8"></div>');
      left.appendChild(plKv([
        ['빌드 시간', `<span class="num">${esc(rn.dur || '—')}</span>`],
        ['처리 행 수', `<span class="num">${rn.st === 'ok' && rn.rows != null ? esc(Number(rn.rows).toLocaleString('ko-KR')) + '건'
          : rn.st === 'err' ? '0건 (실패)' : '—'}</span>`],
        ['실행 순서', `<span class="num">${esc(ord != null ? ord + ' / ' + taskCount(pp) : '—')}</span>`],
        ['생성 방식', esc(d.mat === '—' ? 'SOURCE — 외부 적재' : matKo(d.mat))],
      ]));
      left.appendChild(el('<span class="t11 fnt">모델 정의·SQL 은 데이터 모델에서 봅니다.</span>'));
      grid.appendChild(left);
      grid.appendChild(plModelTrend(d));
    } else if (S.pipeTab === 'log') {
      /* 로그는 여기서 직접 받는다. 예전에는 api.js 가 b35 의 pipeDock 을 감싸
         채워 줬는데, 이 파일이 pipeDock 을 통째로 갈아끼우면서 그 래퍼가 함께
         빠졌다 — 감싼 층을 대체할 때는 그 층이 하던 일을 옮겨 와야 한다. */
      const wait = rn.st === 'wait' ? '아직 실행하지 않았습니다.'
        : rn.st === 'skip' ? '앞 단계가 실패해 실행하지 않았습니다. (SKIP)'
        : '로그를 불러오는 중…';
      const box = el(`<div class="code" style="max-height:100%">${esc(wait)}</div>`);
      const cap = el('<span class="t11 fnt"></span>');
      pane.appendChild(box);
      pane.appendChild(cap);
      /* 실행 번호는 그 노드가 실제로 돈 실행을 먼저 본다 — 파이프라인의 최신 실행만
         보면, 노드는 성공인데 __runId 가 비어 로그를 못 부르는 경우가 생긴다. */
      const runId = rn.runId || pp.__runId;
      if (rn.st !== 'wait' && rn.st !== 'skip') {
        if (!runId) box.textContent = '실행 기록은 있는데 어느 실행인지 알 수 없어 로그를 불러오지 못했습니다. 화면을 새로 고쳐 주세요.';
        else api(`/pipelines/${enc(pp.id)}/runs/${enc(runId)}/nodes/${enc(n.id)}/log`)
          .then(r2 => {
            box.textContent = r2.log || '(로그가 비어 있습니다)';
            cap.textContent = r2.log ? 'dbt 실행 로그 원본입니다.' : '';
          })
          .catch(e => { box.textContent = '로그를 불러오지 못했습니다: ' + e.message; });
      }
    } else {
      const rs = rulesOf(n.id).filter(x => x.active);
      if (!rs.length) pane.appendChild(el(`<div class="empty">${ic('shield')}
        <span class="empty-t">등록된 품질 규칙이 없습니다.</span></div>`));
      else {
        const t = el(`<div class="wc-table wc-table--compact"><div class="wc-table__scroll">
          <table><thead><tr><th>규칙</th><th style="width:220px">검사 방식</th>
          <th style="width:80px" class="wc-table__num">위반</th><th style="width:88px">결과</th></tr></thead>
          <tbody></tbody></table></div></div>`);
        const tb = $('tbody', t);
        rs.forEach(x => {
          /* 규칙 이름이 이미 «유형 · 컬럼» 이라 그 아래에 유형·컬럼을 한 번 더 적지
             않는다(예전 마크업은 «필수값 · deal_ym» 이 두 줄로 겹쳐 보였다). */
          const tr = el(`<tr style="cursor:pointer">
            <td><span class="t13 trunc">${esc(x.name)}</span></td>
            <td><span class="t11 mono fnt trunc">${esc(x.cond)}</span></td>
            <td class="wc-table__num num">${x.cnt ? esc(x.cnt) + '건' : '—'}</td>
            <td>${x.status === 'ok' ? '<span class="bdg ok">통과</span>'
              : x.status === 'warn' ? '<span class="bdg warn">주의</span>' : '<span class="bdg err">실패</span>'}</td></tr>`);
          tr.onclick = () => go('quality', x.id);
          tb.appendChild(tr);
        });
        pane.appendChild(t);
      }
    }
    return plChrome(p);
  };

  /* ── 빌드 추이 — 처리 행 수(막대) · 빌드 시간(선) ────────────────
     원본의 조합 차트다. 자료는 /history/models/{id} 로, dbt 가 남긴 실행 결과다. */
  const MHIST = {};
  function plModelHist(id) {
    if (MHIST[id]) return MHIST[id];
    const box = MHIST[id] = { loading: true, items: null, err: null };
    api(`/history/models/${enc(id)}?days=90&limit=10`).then(r => { box.items = r.items || []; })
      .catch(e => { box.err = e.message; })
      .finally(() => { box.loading = false; if (S.page === 'pipeline') render(); });
    return box;
  }

  /* 이 칸의 «지금» 은 이력의 마지막 회차다 — 왼쪽 표의 빌드 시간(현재 실행의
     노드 결과)과 출처가 다르므로 여기서 그 값을 끌어다 쓰지 않는다. */
  function plModelTrend(d) {
    const w = el('<div class="col g12" style="min-width:0"></div>');

    const h = plModelHist(d.id);
    const note = (t) => { w.appendChild(el('<span class="sect-t">빌드 추이</span>'));
      w.appendChild(el(`<span class="t12 fnt">${esc(t)}</span>`)); return w; };
    if (h.loading) return note('추이를 불러오는 중…');
    if (h.err) return note('추이를 불러오지 못했습니다: ' + h.err);

    const items = (h.items || []).slice().reverse();      /* 최신이 먼저 오므로 뒤집는다 */
    if (!items.length) return note('아직 빌드 기록이 없습니다. 한 번 실행하면 여기에 쌓입니다.');

    /* 처리 행 수는 실행 엔진이 남길 때만 있다(Spark 는 rows_affected 를 주지 않는다).
       하나도 없으면 그 칸을 아예 만들지 않는다 — 0 으로 채운 막대는 «행이 0건이었다»
       로 읽히는데 실제로는 «세지 않았다» 다. */
    const secs = items.map(x => Number(x.executionTime) || 0);
    const rows = items.map(x => (x.rowsAffected == null ? null : Number(x.rowsAffected)));
    const hasRows = rows.some(v => v != null);

    w.appendChild(plTrendTile({
      label: '빌드 시간', items, values: secs, fmt: sec1,
      caption: `최근 ${items.length}회 · 왼쪽이 과거`,
    }));
    if (hasRows) w.appendChild(plTrendTile({ label: '처리 행 수', items, values: rows, fmt: cnt }));
    else w.appendChild(el('<span class="t11 fnt">처리 행 수는 실행 엔진이 남길 때만 기록됩니다 — 이 모델에는 남아 있지 않아 빌드 시간만 그립니다.</span>'));
    return w;
  }

  /* ── 추이 한 칸 ─────────────────────────────────────────────────
     막대 = 회차별 값, 왼쪽이 과거. 값 하나짜리 계열이라 범례를 두지 않는다
     (제목이 곧 계열 이름이다). 색은 회차의 «상태» 만 말한다 —
     지난 회차는 중립 회색, 마지막 회차는 강조, 실패한 회차는 실패색.

     **두 지표를 한 판에 겹치지 않는다.** 원본은 행 수(막대)와 빌드 시간(선)을 한
     상자에 그렸는데, 두 축의 눈금을 맞출 근거가 없어서 화면이 없는 상관관계를
     지어낸다(초 단위 선이 백만 단위 막대 위에서 오르내리는 것처럼 보였다).
     지표가 둘이면 판을 둘로 나눈다.

     o = { label, items, values, fmt, caption } */
  const sec1 = (v) => (v == null ? '—' : Number(v).toFixed(1) + '초');
  const cnt = (v) => (v == null ? '—' : Number(v).toLocaleString('ko-KR') + '건');
  const HB = 56;                                   /* 막대 칸 높이 */

  function plTrendTile(o) {
    const vals = o.values;
    const known = vals.map(v => v != null);
    const max = Math.max(...vals.filter(v => v != null), 0) || 1;
    const lastI = [...vals.keys()].reverse().find(i => known[i]);
    const shown = vals.filter(v => v != null).slice().sort((a, b) => a - b);
    const mid = shown.length ? shown[Math.floor(shown.length / 2)] : null;
    const maxI = vals.reduce((b, v, i) => (v != null && (b < 0 || v > vals[b]) ? i : b), -1);

    const t = el('<div class="pl-tile"></div>');
    t.appendChild(el(`<div class="pl-tile-h">
      <span class="sect-t">${esc(o.label)}</span>
      ${o.caption ? `<span class="t11 fnt sp">${esc(o.caption)}</span>` : ''}</div>`));

    /* 값 + 기준. 마지막 회차가 이 칸의 «지금» 이고, 중앙값이 그것을 읽는 기준이다.
       큰 숫자는 비례 숫자(tabular 아님) — 자릿수를 맞출 상대가 없다. */
    t.appendChild(el(`<div class="pl-tile-v">
      <span class="pl-tile-n">${esc(o.fmt(lastI == null ? null : vals[lastI]))}</span>
      ${mid != null ? `<span class="t11 fnt num">중앙값 ${esc(o.fmt(mid))}</span>` : ''}
      ${maxI >= 0 && maxI !== lastI ? `<span class="t11 fnt num">최대 ${esc(o.fmt(vals[maxI]))}</span>` : ''}
    </div>`));

    const plot = el(`<div class="pl-plot" style="height:${HB}px"></div>`);
    o.items.forEach((x, i) => {
      const bad = x.status && x.status !== 'success';
      const hh = known[i] ? Math.max(3, Math.round(vals[i] / max * HB)) : 0;
      const tone = bad ? 'var(--w-danger)' : i === lastI ? 'var(--w-chart-1)' : 'rgba(142,142,147,.45)';
      /* 칸 전체가 hit 영역이다 — 3px 짜리 막대를 정확히 짚게 하지 않는다 */
      const col = el(`<span class="pl-col" title="${esc(fmtDT(x.ranAt))}\n${esc(o.label)} ${esc(o.fmt(vals[i]))}${bad ? '\n실패' : ''}"></span>`);
      col.appendChild(el(`<i style="height:${hh}px;background:${tone}"></i>`));
      plot.appendChild(col);
    });
    t.appendChild(plot);

    /* 눈금은 양 끝 날짜만. 열 개 칸에 열 개 날짜를 적으면 서로 겹쳐 읽히지 않는다 —
       가운데 값은 막대에 올린 tooltip 이 답한다. */
    const day = (x) => fmtDT(x.ranAt).slice(5, 10);
    t.appendChild(el(`<div class="pl-axis">
      <span>${esc(day(o.items[0]))}</span>
      <span>${esc(day(o.items[o.items.length - 1]))}</span></div>`));

    /* 마지막 회차가 중앙값의 1.5배를 넘겼을 때만 한 줄 덧붙인다 */
    if (lastI != null && mid && vals[lastI] > mid * 1.5) {
      t.appendChild(el(`<span class="t11 num" style="color:var(--w-warning);font-weight:var(--fw-med)">
        마지막 회차가 중앙값의 ${esc((vals[lastI] / mid).toFixed(1))}배입니다.</span>`));
    }
    return t;
  }

  /* ── 모델 사이 선 — 고른 모델 기준의 상류·하류 ─────────────────
     v1(b43)은 «양 끝이 모두 성공했나» 로 칠했다. 그건 카드의 점이 이미 말하고 있어서,
     선이 답할 수 있는 질문 — «이 모델은 무엇을 기다리고, 무엇을 망가뜨리나» — 이
     비어 있었다. 흐름도(4절)와 같은 규칙으로 맞춘다: 상류 초록 · 하류 주황.
     구성 편집 모드는 선을 눌러 지우는 자리라 예전 그리기를 그대로 쓴다. */
  const _drawPEdges = drawPEdges;
  drawPEdges = function (pp, host, svg, edit, gOv) {
    if (edit) return _drawPEdges(pp, host, svg, edit, gOv);
    const g = gOv || pgraph(pp);
    const sel = S.pipeNodeK;

    /* 고른 모델의 조상·자손. 간선을 따라 끝까지 걷는다(한 단계만 칠하면
       «이 모델이 결국 무엇을 망가뜨리나» 가 보이지 않는다). */
    const reach = (dir) => {
      const out = new Set();
      if (!sel) return out;
      const q = [sel];
      while (q.length) {
        const cur = q.shift();
        g.edges.forEach(e => {
          const [a, b] = dir === 'up' ? [e.to, e.from] : [e.from, e.to];
          if (a !== cur || out.has(b)) return;
          out.add(b); q.push(b);
        });
      }
      return out;
    };
    const anc = reach('up'), desc = reach('down');

    svg.innerHTML = '';
    g.edges.forEach(e => {
      const a = nodeOf(g, e.from), b = nodeOf(g, e.to);
      if (!a || !b) return;
      const isUp = sel && (e.to === sel || anc.has(e.to));
      const isDown = sel && (e.from === sel || desc.has(e.from));
      const col = isUp ? E_UP : isDown ? E_DOWN : E_OFF;
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', bez(a.x + PW, a.y + PH / 2, b.x, b.y + PH / 2));
      p.setAttribute('fill', 'none');
      p.style.stroke = col;                 /* SVG 의 stroke 속성으로는 var() 가 풀리지 않는다 */
      p.setAttribute('stroke-width', col === E_OFF ? '1.8' : '2.2');
      svg.appendChild(p);
    });
  };

  /* ── 가공 탭 본문 — 상단 요약 줄 + 캔버스 + 하단 상세 ── */
  pipeTabBody = function () {
    const r = R();
    const ig = ingById(S.openPipe);
    if (ig) return ingTabBody(ig, r);
    S.pipe = S.openPipe;
    S.pipeView = 'flow';
    const pp = PIPES.find(x => x.id === S.pipe);
    if (!pp) return el('<div class="mod-c"></div>');
    const g = pgraph(pp), runs = runsG(pp);

    if (S.pipeNodeK) {
      const n0 = nodeOf(g, S.pipeNodeK);
      if (n0 && (byId(n0.id) || {}).kind === 'source') S.pipeNodeK = null;
    }
    if (!S.pipeNodeK || !nodeOf(g, S.pipeNodeK)) {
      const bad = Object.entries(runs).find(([, v]) => v.st === 'err');
      S.pipeNodeK = bad ? bad[0] : null;
    }

    const center = el('<div class="mod-c col pl-tr" style="min-height:0"></div>');
    const meta = [TRIG_LABEL[pp.trigger] || pp.freq || '수동 실행',
                  pp.last && pp.last !== '아직 실행 전' ? pp.last : '실행 이력 없음',
                  `모델 ${taskCount(pp)}개`,
                  pp.dur && pp.dur !== '—' ? pp.dur : null].filter(Boolean).join(' · ');
    const bar = el(`<div class="mod-bar pl-bar">
      <span class="row g8" id="pdHead" style="min-width:0;flex:1 1 auto;overflow:hidden;cursor:context-menu"
        title="${esc(meta)} — 우클릭하면 설정 메뉴가 열립니다">
        ${plBadge(pp.status)}
        <span class="t12 fnt trunc" style="min-width:0">${esc(meta)}</span></span>
      <div class="row g6" style="flex:none">
        ${r.canPipeEdit ? `<button type="button" class="wc-btn wc-btn--sm wc-btn--secondary" id="pdCfg">설정</button>` : ''}
        ${r.canPipeEdit ? `<button type="button" class="wc-btn wc-btn--sm wc-btn--primary" id="pdRunAll">
          ${ic14(pp.status === 'err' ? 'rot' : 'play')}<span>전체 실행</span></button>` : ''}
        <button class="iconbtn" id="pdMore" title="파이프라인 메뉴">${ic14('dots')}</button>
      </div></div>`);
    center.appendChild(bar);

    const stage = el('<div class="col" style="flex:1 1 0;min-height:120px;overflow:hidden"></div>');
    const canvas = pipeCanvas(pp, false);
    /* 범례 — 선 색이 무엇을 뜻하는지. 배율 알약(.zoomlbl)과 같은 층에 둔다. */
    canvas.appendChild(el(`<div class="pl-leg">
      <span><em style="background:${E_UP}"></em>선택 모델의 상위</span>
      <span><em style="background:${E_DOWN}"></em>선택 모델의 하위</span>
      <i></i>
      <span>${plDot('ok')}성공</span>
      <span>${plDot('run')}실행 중</span>
      <span>${plDot('err')}실패</span></div>`));
    stage.appendChild(canvas);
    center.appendChild(stage);
    center.appendChild(pipeDock(pp));

    const openMenu = (x, y) => pipeNodeMenu(pp, x, y);
    const hd = $('#pdHead', center);
    if (hd) hd.oncontextmenu = (e) => { e.preventDefault(); openMenu(e.clientX, e.clientY); };
    const mb = $('#pdMore', center);
    if (mb) mb.onclick = () => { const b0 = mb.getBoundingClientRect(); openMenu(b0.left - 150, b0.bottom + 6); };
    const cf = $('#pdCfg', center); if (cf) cf.onclick = () => pipeCfgModal(pp);
    const ra = $('#pdRunAll', center); if (ra) ra.onclick = () => rerunG(pp, null);
    return center;
  };

  /* ============================================================
     7. 갱신 — 실행이 끝나면 이 화면의 캐시도 낡는다
     ============================================================ */
  const _refresh = refreshRun;
  refreshRun = async function (pp, quiet) {
    const st = await _refresh(pp, quiet);
    if (st === 'success' || st === 'failed') {
      Object.keys(RUNS).forEach(k => delete RUNS[k]);
      Object.keys(MHIST).forEach(k => delete MHIST[k]);
      /* 흐름도는 «비우지» 않는다. 이 갱신은 10초마다 배경에서 돌기 때문에,
         비워 두면 그 다음 그리기가 무엇이든(창 크기 변경·클릭·탭 이동)
         캔버스를 「불러오는 중」 으로 만든다. 보고 있으면 배경으로 바꿔 끼우고,
         보고 있지 않으면 그때 새로 받게 표시만 남긴다. */
      if (S.page === 'pipeline') pdagReload(); else PF.data = null;
    }
    return st;
  };

  /* 흐름을 받아온 시각을 남긴다 — 요약 줄의 «기준» 이 그것이다.
     원본의 «마지막 갱신» 자리인데, 그 값은 «이 화면이 언제의 사실을 보여주고
     있는가» 라 받아온 순간을 적어야 맞는다. 래핑 대신 전체를 다시 쓴다 —
     한 줄(PF.__at) 때문에 요청을 두 번 보낼 이유가 없다. */
  pdagLoad = function () {
    if (PF.loading) return;
    PF.loading = true; PF.err = null;
    api('/pipelines/flow')
      .then(d => { PF.data = d; PF.__at = nowLabel(); PF.__sig = pdagSig(d); })
      .catch(e => { PF.err = e.message; })
      .finally(() => { PF.loading = false; render(); });
  };

  /* ── 배경 갱신 — 「불러오는 중」 없이 값만 바꿔 끼운다 ──────────────
     예전에는 5초마다 PF.data 를 «비우고» 다시 받았다. 비우는 순간 캔버스가
     빈 화면이 되어 「파이프라인 흐름을 불러오는 중…」 이 뜨고, 응답이 오면
     다시 그려졌다. 5초마다 흐름도가 사라졌다 나타나니 실행이 잘 되고 있어도
     오류가 난 것처럼 보였다.

     추적은 «이미 보고 있는 화면을 최신으로 맞추는 일» 이다. 받아오기 전에
     보던 것을 치울 이유가 없다. 그래서 여기서는 받아온 다음에 바꿔 끼우고,
     실제로 달라졌을 때만 다시 그린다 — 같은 값으로 다시 그리면 보고 있던
     자리(선택·스크롤)가 5초마다 흔들린다. */
  function pdagSig(d) {
    return JSON.stringify((d.nodes || []).map(n => [n.id, n.status])
      .concat((d.edges || []).map(e => [e.from, e.to])));
  }

  function pdagReload() {
    if (PF.loading) return Promise.resolve();
    PF.loading = true;
    return api('/pipelines/flow')
      .then(d => {
        const sig = pdagSig(d);
        const changed = sig !== PF.__sig;
        PF.data = d; PF.__at = nowLabel(); PF.__sig = sig; PF.err = null;
        if (changed && S.page === 'pipeline') render();
      })
      /* 배경 갱신이 실패해도 화면은 건드리지 않는다. 한 번 못 받은 것 때문에
         보고 있던 흐름도를 오류 화면으로 바꾸면, 다음 5초에 성공해도 이미
         놀란 뒤다. 다음 차례에 다시 받는다. */
      .catch(() => {})
      .finally(() => { PF.loading = false; });
  }

  /* 5초마다 스스로 다음 차례를 잡는다. 예전에는 그리기(render)가 타이머를
     다시 걸어서, «바뀐 게 없어 다시 그리지 않은» 순간 추적이 끊겼다. */
  function pdagTick() {
    clearTimeout(PF.__t);
    PF.__t = setTimeout(async () => {
      PF.__t = null;
      if (S.page !== 'pipeline' || S.openPipe !== 'deps') return;   // 안 보면 쉰다
      if (document.visibilityState !== 'visible') { pdagTick(); return; }
      await pdagReload();
      if (((PF.data || {}).nodes || []).some(n => n.status === 'run')) pdagTick();
    }, 5000);
  }

  /* 도움말 — 바뀐 조작을 반영한다 */
  if (typeof HELP === 'object' && HELP.pipeline) {
    HELP.pipeline.items = [
      '왼쪽 목록은 INGEST(수집)와 TRANSFORM(가공) 두 단계입니다. 이름으로 검색하고, 영역 제목을 눌러 접습니다.',
      '흐름도의 카드 색 띠는 단계, 오른쪽 점과 문구는 지금 상태입니다.',
      '카드를 누르면 아래에 상세가 열리고, 상세 열기 를 누르면 탭으로 엽니다.',
      '연결 편집 을 켜면 카드의 연결점을 끌어 «선행 완료 후» 를 잇고, 연결 라벨을 눌러 끊습니다.',
      '수집 → 가공 연결은 모델이 그 원천을 참조해서 생깁니다 — 화면에서 잇거나 끊지 않습니다.',
      '가공 탭에서 모델 카드를 누르면 그 모델의 빌드 결과·품질 결과·로그를 봅니다.',
    ];
  }
})();
