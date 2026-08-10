(async () => {
  const R = { errors: [] };
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const has = (sel) => !!document.querySelector(sel);
  const cnt = (sel) => document.querySelectorAll(sel).length;
  const txt = (sel) => (document.querySelector(sel) || {}).textContent || '';
  const btn = (t) => [...document.querySelectorAll('button')].find(b => b.textContent.includes(t));
  const seg = (k) => document.querySelector(`[data-pv="${k}"]`);

  try {
    await sleep(1800);
    R.booted = typeof DM !== 'undefined' && Array.isArray(D) && D.length > 0;
    R.data = { models: D.filter(d => d.kind === 'model').length,
               sources: D.filter(d => d.kind === 'source').length,
               pipes: PIPES.length };

    // ── 홈 ──
    go('home'); await sleep(500);
    R.home = { ok: S.page === 'home', cards: cnt('.card') >= 3,
               recentRuns: /최근 실행/.test(document.body.textContent) };

    // ── 데이터 수집 ──
    go('ingest'); await sleep(500);
    R.ingest = { ok: S.page === 'ingest', tabs: has('.ptabs'), side: has('.mod-l') };
    const nb = btn('수집 만들기');
    if (nb) { nb.click(); await sleep(350);
      R.ingest.modal = txt('.modal-t') === '새 수집 작업'
        && has('#igK') && has('#igPrev') && has('#igT');
      R.ingest.fixTerms = !/데이터 모델링/.test(txt('.modal'));   // modal 의 용어 통일
      const c = document.querySelector('.modal [data-close]'); if (c) c.click();
      await sleep(200);
    } else R.ingest.modal = 'no-button';

    // ── 데이터 모델 (계보 화면 + 하단 독) ──
    go('modeling'); await sleep(1400);
    R.modeling = { ok: S.page === 'modeling', canvas: has('#erdWrap'), catalog: has('#mList'),
                   mkPipeBtn: !!btn('파이프라인 생성'), fitBtn: !!btn('화면에 맞추기'),
                   linNodes: cnt('.lin-node') > 0, linLegend: has('.erd-lg') };
    S.sel = (D.find(d => d.kind === 'model') || {}).id || S.sel; render(); await sleep(400);
    R.modeling.dockTabs = ['모델 정보', 'SQL', '품질 규칙', '데이터 미리보기', '변경 이력']
      .every(t => !!btn(t));
    // 독 탭마다 본문이 실제로 그려지는지
    const bodies = [];
    for (const t of ['SQL', '품질 규칙', '모델 정보']) {
      const b = btn(t); if (!b) { bodies.push(t + ':없음'); continue; }
      b.click(); await sleep(500);
      bodies.push(t + ':' + (txt('.dock-b').trim().length > 0));
    }
    R.modeling.dockBodies = bodies.join(' ');

    // ── 데이터 파이프라인 ──
    go('pipeline'); await sleep(600);
    R.pipeline = { ok: S.page === 'pipeline', tabs: has('.ptabs'), dag: has('#pdagWrap'),
                   side: has('#plList'), sideRows: cnt('#plList .lp') };
    const row = document.querySelector('#plList .lp');
    if (row) {
      row.click(); await sleep(800);
      R.pipeline.tabOpened = S.openPipe !== 'deps' && cnt('.ptabs .tab') >= 2;
      R.pipeline.runInfo = /실행 정보|실행 흐름/.test(document.body.textContent);
      R.pipeline.segs = [...document.querySelectorAll('.mod-bar .seg button')].map(b => b.dataset.pv).join(',');
      R.pipeline.zoomWired = !!($('#pfWrap') || {}).__zoomAt;
      R.pipeline.dock = { grip: has('.dock .grip-h'), toggle: !!document.querySelector('.dock-h .iconbtn') };
      // 카드 선택 → 독 본문
      const card = document.querySelector('#pf .pn');
      if (card) { card.click(); await sleep(700);
        R.pipeline.cardSelected = !!S.pipeNodeK && txt('.dock-b').trim().length > 0; }
      // 실행 설정 · 이력 · 다시 흐름
      if (seg('cfg')) { seg('cfg').click(); await sleep(700); }
      R.pipeline.cfg = S.pipeView === 'cfg' && /실행 방식|실행 일정|예약/.test(document.body.textContent);
      if (seg('history')) { seg('history').click(); await sleep(800); }
      R.pipeline.history = S.pipeView === 'history' && cnt('[data-ht]') > 0;
      if (seg('flow')) { seg('flow').click(); await sleep(700); }
      R.pipeline.backToFlow = S.pipeView === 'flow' && has('#pfWrap');
      const x = document.querySelector('.ptabs .ptab-x');
      if (x) { x.click(); await sleep(400); }
      R.pipeline.tabClosed = S.openPipe === 'deps';
    }

    // ── 데이터 품질 ──
    go('quality'); await sleep(500);
    R.quality = { ok: S.page === 'quality',
                  rules: /규칙|검사/.test(document.body.textContent), rows: cnt('.tr') > 5 };

    R.gnb = MENUS.map(m => m.id).join(',');
    go('home'); await sleep(300);
  } catch (e) { R.errors.push(String(e).slice(0, 300)); }
  return JSON.stringify(R);
})()
