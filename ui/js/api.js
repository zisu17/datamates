/* ============================================================
   Data Mates — v4.0  API 연결
   ============================================================
   이 앱은 버전 블록을 뒤에 덧붙여 앞의 함수를 덮어쓰는 방식으로 자라 왔다
   (v2.1 이 v1.0 을, v3.2 가 v3.1 을 덮어썼다). 이 파일도 같은 방식이다.
   화면 코드는 건드리지 않고, 데이터를 만들어 내던 자리와 저장하던 자리만
   서버 호출로 갈아끼운다.

   담당 범위
     · 부팅       : /bootstrap 한 번으로 D · PIPES · QRULES 를 채운다
     · 모델       : 생성 · SQL 저장 · 검사 · 설명 저장 · 삭제
     · 파이프라인 : 등록 · 실행 설정 · 구성(대상) 변경 · 실행 · 부분 재실행
     · 품질       : 규칙 추가·심각도 변경·사용여부·삭제, 결과 내려받기
     · 미리보기   : 탭을 열었을 때만 웨어하우스를 조회
     · 실행 상태  : 돌고 있는 동안 폴링해서 카드 상태를 갱신

   담지 않는 것
     · 논리 폴더 — v3.2 가 개인 설정으로 설계해 localStorage 에 둔다.
       서버 공유로 바꾸려면 /folders API 가 이미 있으니 그때 옮기면 된다.
     · 최신성·싱귤러 검사 — 전자는 source 설정, 후자는 tests/ 폴더의 SQL 파일이라
       yml 쓰기로 만들 수 없다. 나머지 5종(필수값·중복·허용값·참조무결성·범위)은 만든다.
   ============================================================ */
'use strict';
/* IIFE 를 걷어냈다 — 화면별 파일로 재배치하려면 안의 이름들이 전역이어야 한다.
   기존 전역과의 충돌은 해체 전에 전수 검사했다(0건). strict 는 원래부터였다. */

  /* API 주소. 같은 서버가 UI 를 서빙하므로 기본은 현재 origin 이다.
     UI 만 따로 열어 볼 때는 콘솔에서 바꿔 끼운다:
       localStorage.setItem('datamates.api', 'http://localhost:8000') */
  const ORIGIN = localStorage.getItem('datamates.api') || location.origin;
  const BASE = ORIGIN + '/api/v1';

  /* ---------------------------------------------------------- 호출 */

  async function api(path, opts) {
    const res = await fetch(BASE + path, Object.assign({
      headers: { 'Content-Type': 'application/json' },
    }, opts || {}));
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch (e) { body = text; }
    if (!res.ok) {
      // 설계서 2.4 — 서버가 한국어 완성 문장으로 내려주므로 화면은 그대로 쓴다.
      const msg = (body && body.message) || `요청이 실패했습니다 (HTTP ${res.status})`;
      const err = new Error(msg);
      err.code = body && body.code;
      err.detail = (body && body.details) || null;
      err.status = res.status;
      throw err;
    }
    return body;
  }

  const enc = encodeURIComponent;

  /* 서버 오류를 화면에 그대로 보여준다. dbt 출력이 함께 오면 접어서 붙인다. */
  function fail(e) {
    toast(e.message || '요청이 실패했습니다.', 'err');
    const out = e.detail && e.detail.output;
    if (out) console.error('[Data Mates] 서버 출력:\n' + out);
    if (e.code) console.warn('[Data Mates]', e.code, e.detail || '');
  }

  /* ---------------------------------------------------------- 매핑 */

  /* dbt 의 materialized → 화면 표기. 화면은 '—' 를 원천 으로 읽는다. */
  const MAT = { table: 'Table', view: 'View', incremental: 'Incremental',
                ephemeral: 'Ephemeral', seed: '—', '': '—' };

  /* dbt 테스트 이름 → 화면의 검사 유형(QTYPES 키) */
    function toEntry(it) {
    return {
      id: it.id, name: it.name, phys: it.phys, layer: it.layer,
      kind: it.kind, desc: it.desc || '',
      team: '', freq: '', rows: '—',
      updated: it.run ? '최근 실행됨' : '—',
      quality: it.quality, certified: false, usable: true, fav: false,
      mat: MAT[it.mat] !== undefined ? MAT[it.mat] : it.mat,
      tags: it.tags || [], up: it.upstream || [], down: it.downstream || [],
      cols: it.cols || [], prev: [], sql: it.sql || '',
      folder: null,                    // 폴더 배치는 v3.2 가 localStorage 에서 복원한다
      __path: it.path, __dbtType: it.dbtType, __colDesc: it.colDesc || {},
    };
  }

  const RUNSTATE = { success: 'ok', failed: 'err', running: 'run', queued: 'wait' };

  function toPipe(p) {
    const lr = p.latestRun || null;
    return {
      id: p.id, name: p.name, desc: p.description || '',
      targets: (p.flow && p.flow.order) || p.targets || [],
      freq: p.freq, status: p.status || 'wait',
      last: lr && lr.endedAt ? shortTime(lr.endedAt) : '아직 실행 전',
      dur: '—', next: p.cron ? '예약됨' : '—',
      steps: [],
      env: p.env, retry: p.retry, task_mode: p.taskMode,
      paused: p.paused,                 // Airflow 의 DAG pause. null 이면 Airflow 미응답
      includeSeeds: p.includeSeeds,     // 원천 CSV 를 실행에 포함할지
      cfg2: { env: p.env, freq: p.freq, onFail: p.onFail,
              retry: p.retry, notify: p.notify },
      __runId: lr && lr.runId,
      __apiTargets: p.targets || [],
      graph: null, rg: null, __rsig: null,
      /* 트리거·소유 흐름 (v5.2) — 파이프라인 화면의 연결·탭이 쓴다 */
      trigger: p.triggerType || p.trigger_type || 'schedule',
      upstreamId: p.upstreamPipelineId || p.upstream_pipeline_id || null,
      __flow: p.flow || null,
      /* 다음 예정 실행 (v6.0) — 사이드바 정렬 기준 */
      nextRun: p.nextRun || null,
    };
  }

  function shortTime(iso) {
    try {
      const d = new Date(iso);
      const p = (n) => String(n).padStart(2, '0');
      return `${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    } catch (e) { return iso; }
  }

  /* 품질 규칙 — 서버가 이미 화면 모양으로 만들어 준다(설계서 8.1).
     여기서 다시 조립하면 홈·품질 화면의 숫자가 서버와 갈린다. */
  function toRule(r) {
    return {
      id: r.id, name: r.name, type: r.type, model: r.modelId, col: r.col,
      cond: r.cond, sev: r.sev, active: r.active,
      status: r.status === 'unknown' ? 'ok' : r.status,
      cnt: r.cnt, plain: r.plain, impact: r.impact, rows: r.rows,
      lastRun: r.lastRun, firstSeen: r.firstSeen, pipe: r.pipelineId,
      __notRun: r.status === 'unknown', __singular: r.singular,
    };
  }

  /* ---------------------------------------------------------- 부팅 */

  let BOOTED = false;

  async function boot(opts) {
    const keepView = opts && opts.keep;
    /* 화면별 파생 캐시는 부팅마다 비운다 — 서버 데이터가 바뀌면 전부 다시 계산해야 한다 */
    S.pSel = [];                              // 관계도 다중 선택
    PF.data = null;                           // 파이프라인 흐름 DAG 캐시
    LIN.data = null; S.__linFit = false;      // 데이터 계보 캐시·첫 맞춤

    const b = await api('/bootstrap');

    D.splice(0, D.length, ...b.items.map(toEntry));
    PIPES.splice(0, PIPES.length, ...b.pipelines.map(toPipe));
    QRULES.splice(0, QRULES.length, ...(b.rules || []).map(toRule));

    /* TESTS 는 v1.0 부터 남아 있는 배열이다. v2.1 이 품질 화면을 QRULES 로 옮겼지만
       사이드바 배지·홈의 데이터 검증 결과 는 아직 TESTS 를 본다.
       QRULES 만 갈아끼우면 그 둘이 예제 숫자를 계속 보여준다. */
    TESTS.splice(0, TESTS.length, ...QRULES.map(q => ({
      id: q.id, title: q.name, target: q.model, col: q.col,
      kind: (QTYPES[q.type] || {}).label || q.type, dbt: q.cond,
      sev: q.sev, status: q.status, cnt: q.cnt,
      plain: q.plain, impact: q.impact, rows: q.rows,
    })));

    /* 모델별 최근 실행 결과를 그 모델을 돌린 파이프라인에 붙인다.
       이걸 안 채우면 카드가 전부 대기로 보인다 — 방금 성공한 것도 그렇게 보인다. */
    PIPES.forEach(p => { p.__nodeRuns = {}; });
    b.items.forEach(it => {
      if (!it.run || !it.run.pipelineId) return;
      const p = PIPES.find(x => x.id === it.run.pipelineId);
      if (p) p.__nodeRuns[it.id] = it.run;
    });

    /* 노드가 예전 D 객체를 참조하고 있으므로 캔버스를 다시 만든다.
       ref 만 바꿔치기하면 삭제된 모델이 유령으로 남는다. */
    S.nodes = []; S.edges = []; S.laidOut = false; S.fitOnce = false;
    S.__erdSeeded = false;      // 새로 받아온 목록으로 한 번 배치한다
    if (!byId(S.sel)) S.sel = (D.find(d => d.kind === 'model') || D[0] || {}).id || null;
    if (!PIPES.some(p => p.id === S.pipe)) S.pipe = (PIPES[0] || {}).id || null;
    S.pipeNodeK = null;

    /* 실행 환경 목록을 서버 것으로 바꾼다.
       화면은 dev/stg/prod 를 들고 있었는데 실제 환경은 dbt 타깃(local/local_heavy/remote)이다.
       맞추지 않으면 ENVS[pp.env] 가 undefined 가 되어 파이프라인 실행 정보 패널이
       통째로 예외로 죽는다(빈 창으로 보인다). */
    if (b.envs && b.envs.length) {
      const COLOR = { local: '#6366F1', local_heavy: '#D97706', remote: '#0E9F6E' };
      Object.keys(ENVS).forEach(k => delete ENVS[k]);
      b.envs.forEach(e => { ENVS[e.env] = { label: e.label, c: COLOR[e.env] || '#6366F1' }; });
      if (!ENVS[S.env]) S.env = b.defaultEnv || b.envs[0].env;
    }

    /* v3.2 가 localStorage 에 저장해 둔 폴더 배치를 새 목록에 다시 입힌다 */
    restoreFolders();
    rebuildSideLists();

    BOOTED = true;
    if (!keepView) render();

    /* 수집 목록은 부트 응답에 없어 따로 받는다. 그 사이 화면이 이미 그려졌으므로
       수집 화면을 보고 있던 경우만 다시 그린다 — 목록이 늦게 와서 빈 채로 남는 화면. */
    await loadIngest();
    if (S.page === 'ingest') render();
    return b;
  }

  /* 홈의 알림 · 내가 담당하는 작업 과 파이프라인 묶음 은 예제 데이터였다.
     실제 상태에서 다시 만든다. 서버에 알림 개념이 아직 없으므로,
     지금 화면이 확실히 아는 것 — 실패한 파이프라인과 품질 문제 — 만 올린다. */
  function rebuildSideLists() {
    NOTIS.splice(0, NOTIS.length);
    MYTASKS.splice(0, MYTASKS.length);
    WSGROUPS.splice(0, WSGROUPS.length);   // 묶음은 서버에 없다. 비워서 전체만 남긴다.

    PIPES.filter(p => p.status === 'err').forEach(p => {
      NOTIS.push({ t: `${p.name} 실행 실패`, d: `${p.last} · ${p.freq}`,
                   k: 'err', go: ['pipeline', p.id] });
    });
    PIPES.filter(p => p.status === 'run').forEach(p => {
      NOTIS.push({ t: `${p.name} 실행 중`, d: p.freq, k: 'info', go: ['pipeline', p.id] });
    });

    QRULES.filter(q => q.status !== 'ok').forEach(q => {
      const d = byId(q.model);
      if (!d) return;
      MYTASKS.push({ t: `${d.name} — ${q.name}`,
                     d: `${q.sev === 'error' ? '오류' : '주의'} · ${q.cond}`,
                     k: q.sev === 'error' ? 'err' : 'warn', go: ['quality', q.id] });
    });

    if (!NOTIS.length) NOTIS.push({ t: '문제가 보고된 항목이 없습니다.',
                                    d: '최근 실행 기준', k: 'ok', go: ['pipeline', null] });
    if (!MYTASKS.length) MYTASKS.push({ t: '처리할 작업이 없습니다.',
                                        d: '품질 규칙 모두 통과', k: 'ok', go: ['quality', null] });
  }

  /* v3.2 는 예제 폴더(병원 데이터·업무 모델…)를 심어 두고 예제 모델을 배치한다.
     실제 카탈로그에는 그 모델들이 없어서 폴더가 전부 0개로 남는다.
     저장된 개인 설정이 없으면 = 처음 쓰는 것이므로 예제 폴더를 걷어내고
     빈 상태에서 시작한다. 폴더는 사용자가 직접 만들어 쓰는 것이다. */
  function restoreFolders() {
    let raw = null;
    try {
      raw = JSON.parse(localStorage.getItem('datamates.catalog.tree.v1') || 'null');
    } catch (e) { /* 개인 설정이 깨져도 카탈로그는 떠야 한다 */ }

    if (!raw || !Array.isArray(raw.folders)) {
      FOLDERS.splice(0, FOLDERS.length);
      D.forEach(d => d.folder = null);
      return;
    }
    FOLDERS.splice(0, FOLDERS.length, ...raw.folders);
    const known = new Set(FOLDERS.map(f => f.id));
    D.forEach(d => {
      const f = raw.assign ? raw.assign[d.id] : null;
      d.folder = f && known.has(f) ? f : null;   // 지워진 폴더를 가리키면 밖으로 뺀다
    });
  }

  /* ---------------------------------------------------------- 모델 */

  /* 화면에서 만든 모델을 서버에 만든다.
     기존 buildModel 은 로컬 D 에 즉시 넣는다. 그 낙관적 반영을 그대로 두되,
     서버가 거절하면 되돌린다 — 안 되돌리면 없는 모델이 화면에 남는다. */
  /* 모델 이름 규칙. 서버(dbtproj.check_name)와 같아야 저장 단계에서야 튕기지 않는다. */
  const NAME_RE = /^[a-z][a-z0-9_]{1,62}$/;

  const _buildModel = buildModel;
  buildModel = function (args) {
    const d = _buildModel(args);

    /* 화면은 id(custom_1) · 이름(한글) · 저장 위치(marts.xxx)를 따로 둔다.
       dbt 는 그렇지 않다 — 모델 이름 하나가 파일명이자 식별자이자 테이블명이다.
       그래서 저장 위치의 테이블명 부분을 dbt 모델 이름으로 쓰고,
       사용자가 입력한 한글 이름은 설명으로 남긴다. */
    const dbtId = String(d.phys || '').split('.').pop().trim();

    const rollback = (msg) => {
      const i = D.indexOf(d);
      if (i >= 0) D.splice(i, 1);
      S.nodes = S.nodes.filter(n => n.id !== d.id);
      rebuildEdges();
      if (S.sel === d.id) S.sel = null;
      render();
      if (msg) toast(msg, 'err');
    };

    if (!NAME_RE.test(dbtId)) {
      rollback(`저장 위치의 테이블명 ${dbtId} 은(는) 쓸 수 없습니다. ` +
               '영소문자로 시작하고 영소문자·숫자·밑줄만 쓸 수 있습니다.');
      return d;
    }
    if (byId(dbtId)) {
      rollback(`${dbtId} 은(는) 이미 있습니다. 저장 위치를 다르게 지정해 주세요.`);
      return d;
    }

    api('/models', {
      method: 'POST',
      body: JSON.stringify({
        id: dbtId, sql: d.sql,
        description: d.name && d.name !== dbtId ? d.name : (d.desc || ''),
        materialized: (d.mat || 'Table').toLowerCase(),
        tags: d.tags,
      }),
    }).then(async () => {
      toast(`${dbtId} 모델을 저장했습니다.`);
      await boot({ keep: true });
      S.sel = dbtId; S.mView = 'def'; S.mTab = 'SQL';
      render();
    }).catch(e => {
      rollback(null);
      fail(e);
    });
    return d;
  };

  /* SQL 저장 — 서버 검증 → 저장 → 재부팅(참조 관계가 바뀌므로) */
  sqlView = (function (base) {
    return function (node) {
      const w = base(node);
      const box = $('#sqlBox', w), save = $('#sqlSave', w);
      if (!box || !save) return w;
      save.onclick = async () => {
        const d = node.ref || byId(node.id);
        if (!d) return;
        save.disabled = true;
        try {
          const v = await api('/models/validate', {
            method: 'POST', body: JSON.stringify({ sql: box.value }),
          });
          if (!v.ok) { toast(v.message, 'err'); return; }
          await api('/models/' + enc(d.id), {
            method: 'PATCH', body: JSON.stringify({ sql: box.value }),
          });
          toast(`SQL 을 저장했습니다. 참조 ${v.refs.length}건을 반영했습니다.`);
          S.dirty = false;
          await boot();
        } catch (e) { fail(e); }
        finally { save.disabled = false; }
      };
      return w;
    };
  })(sqlView);

  /* SQL 검사 — 정규식이 아니라 서버 판정을 쓴다 */
  function checkSql(n) {
    const d = (n && (n.ref || byId(n.id))) || n;
    if (!d || !d.sql) { toast('SQL 이 있는 모델을 선택해 주세요.', 'warn'); return; }
    api('/models/validate', { method: 'POST', body: JSON.stringify({ sql: d.sql }) })
      .then(v => toast(v.message, v.ok ? '' : 'err'))
      .catch(fail);
    return true;
  }

  /* 설명 저장 */
    /* 삭제 — hard 일 때만 서버에서 지운다. 캔버스에서 빼는 것은 화면 조작이다. */
  const _removeNode = removeNode;
  removeNode = function (id, hard) {
    if (!hard) return _removeNode(id, hard);
    api('/models/' + enc(id), { method: 'DELETE' })
      .then(() => { toast(`${id} 모델을 삭제했습니다.`); return boot(); })
      .catch(fail);
  };

  /* ---------------------------------------------------------- 파이프라인 */

  const FREQS = ['수동 실행', '1시간마다', '매일 04:30', '매일 05:00', '매일 06:00', '매주 월 06:00'];

  function pipeBody(pp, targets) {
    return {
      name: pp.name, description: pp.desc || '',
      env: (pp.cfg2 && pp.cfg2.env) || pp.env || 'local',
      freq: FREQS.indexOf(pp.freq) >= 0 ? pp.freq : '수동 실행',
      retry: (pp.cfg2 && pp.cfg2.retry) != null ? pp.cfg2.retry : 1,
      on_fail: (pp.cfg2 && pp.cfg2.onFail) || 'stop',
      notify: !(pp.cfg2 && pp.cfg2.notify === false),
      targets: targets || pp.__apiTargets || pp.targets || [],
      task_mode: pp.task_mode || 'per_model',
    };
  }

  /* 구성 캔버스에서 카드를 놓거나 빼면 실행 대상이 바뀐다.
     매번 저장하면 요청이 쏟아지므로 잠깐 모았다 한 번에 보낸다. */
  let syncT = null;
  const _syncTargets = syncTargets;
  syncTargets = function (pp) {
    _syncTargets(pp);
    if (!BOOTED || !pp || !pp.id) return;
    clearTimeout(syncT);
    syncT = setTimeout(() => {
      const g = pgraph(pp);
      const ids = [...new Set(g.nodes.map(n => n.id))]
        .filter(id => { const d = byId(id); return d && d.kind === 'model'; });
      pp.__apiTargets = ids;
      api('/pipelines/' + enc(pp.id), {
        method: 'PUT', body: JSON.stringify(pipeBody(pp, ids)),
      }).catch(fail);
    }, 800);
  };

  /* 실행 설정 저장 */
  pipeCfg = (function (base) {
    return function (pp, r) {
      const w = base(pp, r);
      const ok = $('#pcOk', w);
      if (!ok) return w;
      ok.onclick = async () => {
        const g = (id) => { const x = $('#' + id, w); return x ? x.value : null; };
        const c = pcfg2(pp);
        c.freq = g('pcF') || c.freq;
        c.env = g('pcE') || c.env;
        c.retry = g('pcR') != null ? +g('pcR') : c.retry;
        c.onFail = g('pcS') || c.onFail;
        const n = $('#pcN', w); if (n) c.notify = n.checked;
        pp.freq = c.freq; pp.env = c.env;
        ok.disabled = true;
        try {
          await api('/pipelines/' + enc(pp.id), {
            method: 'PUT', body: JSON.stringify(pipeBody(pp)),
          });
          toast('실행 설정을 저장했습니다.');
          await boot();
        } catch (e) { fail(e); }
        finally { ok.disabled = false; }
      };
      return w;
    };
  })(pipeCfg);

  /* 캔버스 구성을 새 파이프라인으로 등록 */
      /* ---------------------------------------------------------- 실행 */

  /* 카드 상태는 서버가 준 것을 쓴다. 원래 구현은 품질 규칙으로 흉내 낸 값이었다. */
    function runsG(pp) {
    const g = pgraph(pp);
    const src = pp.__nodeRuns || {};
    const out = {};
    g.nodes.forEach(n => {
      const d = byId(n.id) || {};
      if (d.kind === 'source' && d.__dbtType === 'source') {
        out[n.key] = { st: 'srcok', rows: d.rows, src: true };
        return;
      }
      const r = src[n.id];
      if (!r) { out[n.key] = { st: 'wait', dur: '—' }; return; }
      out[n.key] = {
        st: r.st || 'wait',
        dur: r.dur != null ? Number(r.dur).toFixed(1) + '초' : '—',
        rows: r.rows != null ? String(r.rows) : d.rows,
      };
    });
    return out;
  }

  let pollT = null;

  async function refreshRun(pp) {
    try {
      const r = await api('/pipelines/' + enc(pp.id) + '/runs/latest');
      pp.__runId = r.run_id;
      pp.__nodeRuns = {};
      Object.entries(r.nodes || {}).forEach(([mid, v]) => {
        pp.__nodeRuns[mid] = { st: v.state, dur: v.duration, rows: v.rows };
      });
      pp.status = RUNSTATE[r.state] || 'run';
      pp.rg = null; pp.__rsig = null;
      if (S.page === 'pipeline') render();
      return r.state;
    } catch (e) { return null; }
  }

  function poll(pp) {
    clearTimeout(pollT);
    pollT = setTimeout(async () => {
      const st = await refreshRun(pp);
      if (st === 'running' || st === 'queued') poll(pp);
      else if (st) {
        toast(st === 'success' ? '파이프라인 실행이 끝났습니다.'
                               : '파이프라인 실행이 실패했습니다.',
              st === 'success' ? '' : 'err');
      }
    }, 5000);
  }

  /* 전체 실행 / 특정 모델부터 다시 실행 */
  async function rerunG(pp, fromKey) {
    const g = pgraph(pp);
    const node = fromKey ? g.nodes.find(n => n.key === fromKey) : null;
    const fromId = node ? node.id : null;
    try {
      if (fromId && pp.__runId) {
        const r = await api(`/pipelines/${enc(pp.id)}/runs/${enc(pp.__runId)}/rerun`, {
          method: 'POST', body: JSON.stringify({ from_node: fromId }),
        });
        toast(`${byId(fromId).name} 부터 다시 실행합니다. (${r.cleared.length}개)`);
      } else {
        toast('파이프라인을 실행합니다. 첫 실행은 조금 걸릴 수 있습니다.');
        const r = await api('/pipelines/' + enc(pp.id) + '/runs', {
          method: 'POST', body: JSON.stringify({ triggered_by: '' }),
        });
        pp.__runId = r.run_id;
      }
      pp.status = 'run';
      render();
      poll(pp);
    } catch (e) { fail(e); }
  }

  /* 모델별 로그 — 화면의 로그 탭이 부르던 흉내 로그를 실제 로그로 */
  pipeDock = (function (base) {
    return function (pp) {
      const w = base(pp);
      if (S.pipeTab !== '로그' || !pp.__runId) return w;
      const g = pgraph(pp);
      const n = S.pipeNodeK && g.nodes.find(x => x.key === S.pipeNodeK);
      if (!n) return w;
      const box = $('.code', w);
      if (!box) return w;
      box.textContent = '로그를 불러오는 중…';
      api(`/pipelines/${enc(pp.id)}/runs/${enc(pp.__runId)}/nodes/${enc(n.id)}/log`)
        .then(r => { box.textContent = r.log || '(로그가 비어 있습니다)'; })
        .catch(e => { box.textContent = '로그를 불러오지 못했습니다: ' + e.message; });
      return w;
    };
  })(pipeDock);

  /* ---------------------------------------------------------- 품질 규칙 */

  /* 화면의 검사 유형 → 서버가 만들 수 있는 것. fresh(최신성)와 sql(싱귤러)은
     yml 이 아니라 source 설정·tests 폴더의 파일이라 화면에서 만들 수 없다. */
  const CREATABLE = ['notnull', 'unique', 'accepted', 'rel', 'range'];
  const NEEDS_ARGS = { accepted: ['values'], rel: ['to', 'field'] };

  ruleModal = (function (base) {
    return function (ruleId, modelId) {
      base(ruleId, modelId);
      const m = document.querySelector('.scrim:last-of-type .modal');
      if (!m) return;
      const ok = $('#rOk', m), del = $('#rDel', m), tp = $('#rTp', m);

      /* 만들 수 없는 유형을 고르면 왜 안 되는지 먼저 알린다.
         저장 눌러서야 튕기면 무엇을 잘못했는지 알기 어렵다. */
      const hint = $('#rTpH', m);
      const paintHint = () => {
        if (!hint) return;
        const t = tp.value;
        if (!CREATABLE.includes(t)) {
          hint.textContent = t === 'fresh'
            ? '최신성은 원천(source) 설정으로 관리합니다. 화면에서 만들 수 없습니다.'
            : '사용자 정의 SQL 은 tests/ 폴더의 SQL 파일로 관리합니다.';
          hint.style.color = 'var(--warn)';
        } else if (NEEDS_ARGS[t]) {
          hint.textContent = `이 검사에는 ${NEEDS_ARGS[t].join(' · ')} 값이 필요합니다.`;
          hint.style.color = '';
        }
      };
      if (tp) { const prev = tp.onchange; tp.onchange = (e) => { if (prev) prev(e); paintHint(); }; paintHint(); }

      if (ok) ok.onclick = async () => {
        const type = tp.value;
        if (!CREATABLE.includes(type)) {
          toast(type === 'fresh'
            ? '최신성 검사는 원천 설정에서 관리합니다.'
            : '사용자 정의 SQL 검사는 tests/ 폴더의 파일로 관리합니다.', 'warn');
          return;
        }
        const payload = {
          modelId: $('#rMd', m).value, type,
          col: $('#rCl', m).value || '',
          sev: $('#rSv', m).value,
          active: $('#rAc', m).checked,
          arguments: {},
        };
        for (const a of (NEEDS_ARGS[type] || [])) {
          const v = prompt(`${type} 검사에 필요한 ${a} 값을 입력하세요.` +
                           (a === 'values' ? '\n쉼표로 구분합니다. 예) purchase, refund' : ''));
          if (v === null) return;
          payload.arguments[a] = a === 'values'
            ? v.split(',').map(x => x.trim()).filter(Boolean) : v.trim();
        }
        ok.disabled = true;
        try {
          if (ruleId) {
            await api('/quality/rules/' + enc(ruleId), {
              method: 'PUT',
              body: JSON.stringify({ sev: payload.sev, active: payload.active }),
            });
            toast('규칙을 저장했습니다.');
          } else {
            await api('/quality/rules', { method: 'POST', body: JSON.stringify(payload) });
            toast('검사 규칙을 추가했습니다.');
          }
          document.querySelectorAll('.scrim').forEach(x => x.remove());
          await boot();
        } catch (e) { ok.disabled = false; fail(e); }
      };

      if (del) del.onclick = async () => {
        if (!await confirmModal({
              title: '품질 규칙 삭제', tone: 'warn', danger: true, ok: '삭제',
              body: '이 규칙을 삭제합니다.<br>데이터 모델의 품질 규칙 탭에서도 사라집니다.' })) return;
        del.disabled = true;
        try {
          await api('/quality/rules/' + enc(ruleId), { method: 'DELETE' });
          document.querySelectorAll('.scrim').forEach(x => x.remove());
          toast('규칙을 삭제했습니다.');
          await boot();
        } catch (e) { del.disabled = false; fail(e); }
      };
    };
  })(ruleModal);

  /* 사용 여부 토글 — 목록과 모델 화면 양쪽의 스위치를 서버에 반영한다 */
  function wireToggles(root) {
    $$('[data-tg]', root || document).forEach(el => {
      if (el.__wired) return;
      el.__wired = true;
      el.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const q = QRULES.find(x => x.id === el.dataset.tg);
        if (!q) return;
        const next = !q.active;
        try {
          await api(`/quality/rules/${enc(q.id)}/active`, {
            method: 'PATCH', body: JSON.stringify({ active: next }),
          });
          toast(next ? '규칙을 사용합니다.' : '규칙을 사용하지 않습니다.');
          await boot();
        } catch (e) { fail(e); }
      }, true);
    });
  }

  /* 다시 검증 · 결과 내려받기 */

  /* ---------------------------------------------------------- 데이터 미리보기 */

  /* 미리보기는 웨어하우스 조회라 15초쯤 걸린다. 화면을 그릴 때마다 부르면 못 쓰므로
     탭을 열었을 때 한 번만 가져오고 결과를 모델에 붙여 둔다. */
  const previewing = new Set();

  function loadPreview(d, onDone) {
    if (!d || d.kind === 'source' && d.__dbtType === 'source') return;
    if (d.__prevLoaded || previewing.has(d.id)) return;
    previewing.add(d.id);
    api(`/catalog/${enc(d.id)}/preview?limit=20`)
      .then(r => {
        d.__prevLoaded = true;
        d.cols = d.cols.length ? d.cols
          : r.columns.map(c => [c, c, '', '선택']);
        const idx = r.columns.map(c => c);
        d.prev = r.rows.map(row => d.cols.map(c => {
          const i = idx.indexOf(c[0]);
          return i >= 0 ? (row[i] == null ? '' : String(row[i])) : '';
        }));
        if (onDone) onDone();
      })
      .catch(e => { d.__prevLoaded = true; d.__prevError = e.message; if (onDone) onDone(); })
      .finally(() => previewing.delete(d.id));
  }

    /* ============================================================
     v4.1 — 관계도 · 카탈로그 다듬기
     ============================================================ */

  /* (1. 관계 화면 하단 탭 3종 유지 — v5.1 의 DOCK_TABS_51 이 5탭으로 대신한다) */

  /* ── 2·6. 관계도에 올릴 모델 ──
     · SOURCE 를 빼고 있어서 원천 → 정제 관계가 아예 그려지지 않았다. 넣는다.
     · 비우면 seedCanvas 가 다시 전부 채워서 모두 지우기 가 되지 않았다.
       사용자가 직접 비운 것과 아직 한 번도 안 채운 것 을 구분한다. */
  function seedCanvas() {
    // 부팅 뒤 한 번만 자동 배치한다.
    //
    // 원래 조건은 비어 있으면 채운다 였는데, 그러면 카탈로그에서 - 로 하나씩 빼다가
    // 마지막 하나를 뺀 순간 removeNode 안의 render() 가 이걸 불러 전부 되살렸다.
    // 마지막 제거를 감지해서 막는 방식은 통하지 않는다 — 최종 removeNode(v2.7)는
    // 하위 모델이 있으면 확인 대화상자를 거쳐 여러 개를 한꺼번에 지우기 때문에,
    // 바깥 호출만 봐서는 언제 비는지 알 수 없다.
    // 그래서 누가 언제 비웠는지를 따지지 않고, 자동 배치 자체를 1회로 제한한다.
    if (S.nodes.length || S.__erdSeeded) return;
    S.__erdSeeded = true;
    const order = { '원천': 0, '정제': 1, '분석용': 2 };
    const col = { 0: 0, 1: 0, 2: 0 };
    D.slice()
      .sort((a, b) => (order[a.layer] ?? 3) - (order[b.layer] ?? 3) || a.name.localeCompare(b.name))
      .forEach(d => {
        const c = order[d.layer] ?? 3;
        S.nodes.push({ id: d.id, x: 40 + c * 320, y: 40 + (col[c]++) * 150, ref: d });
      });
    rebuildEdges();
    if (!S.sel && S.nodes.length) S.sel = S.nodes[S.nodes.length - 1].id;
  }

  /* ── 4·5. 상자에 보여줄 컬럼 ──
     키만/주요/전체 3단 선택은 없앤다. 대부분 상자를 훑어보는 용도라 5줄이면 충분하고,
     더 봐야 하면 모델 상세로 가는 편이 낫다. 상자 안에서 스크롤하며 보게 하면
     관계도에서 관계 가 아니라 컬럼 을 읽게 된다. */
        /* 컬럼 표시 모드 선택 바를 걷어낸다 */
  /* (erdView — 이후 정의가 값 캡처 없이 전면 교체. 죽은 층 제거) */
  /* ============================================================
     v4.2 — 예약 실행 끄고 켜기
     ============================================================
     Airflow 의 DAG pause 다. 끄면 예약대로 자동으로 도는 것만 멈추고,
     전체 실행 같은 수동 실행과 이미 돌고 있는 실행은 그대로다.
     상태는 Airflow 가 소유하므로 화면은 서버가 준 값을 보여주기만 한다. */

  /* (pagePipeline — 목록 행 #pList 에 스위치를 달던 층. v5.4 의 탭 화면이 그 왼쪽
     목록을 통째로 걷어내므로 칠한 결과가 버려진다. 지금 스위치는 pipeSidebar 의
     data-pz 하나뿐이다. 죽은 층 제거) */

    /* pageView 는 S.pipe 가 있으면 pagePipeDetail() 을 부른다. 그 별칭은 예전 시점의
     pagePipeline 을 값으로 붙잡아 둔 것이라, 여기서 다시 이어주지 않으면
     이 오버라이드가 화면에 전혀 반영되지 않는다. */
  /* (pagePipeDetail — 이후 정의가 값 캡처 없이 전면 교체. 죽은 층 제거) */
  /* 실행 설정 화면에도 같은 스위치를 둔다 — 일정을 고르는 자리 바로 옆이 자연스럽다 */
  pipeCfg = (function (base) {
    return function (pp, r) {
      const w = base(pp, r);
      const sel = $('#pcF', w);
      if (!sel || pp.paused == null || !r.canPipeEdit) return w;
      const on = !pp.paused;
      const row = el(`<label class="chkrow" style="cursor:pointer">
        <span class="tgl ${on ? 'on' : ''}" data-pause><i></i></span>
        <span style="margin-left:8px">예약 실행 ${on ? '켜짐' : '꺼짐'}</span>
        <span class="fr-h" style="margin-left:8px">끄면 정해진 시각에 자동으로 돌지 않습니다. 수동 실행은 그대로입니다.</span></label>`);
      row.onclick = async (ev) => {
        ev.preventDefault();
        try {
          const res = await api(`/pipelines/${enc(pp.id)}/paused`, {
            method: 'PATCH', body: JSON.stringify({ paused: on }),
          });
          pp.paused = res.paused;
          toast(res.message);
          await boot({ keep: true });
          render();
        } catch (e) { fail(e); }
      };
      sel.parentElement.appendChild(row);
      return w;
    };
  })(pipeCfg);

  /* ============================================================
     v4.3 — 원천 CSV 적재를 파이프라인에서 분리
     ============================================================
     원천이 dbt seed(레포 안 CSV)면 파이프라인이 매 실행마다 다시 적재할 이유가 없다.
     사람이 파일을 고칠 때만 바뀌는데, 적재 한 번에 Spark 세션이 새로 뜬다.
     그래서 기본은 빼고, 필요할 때 두 가지 방법으로 올린다:
       · 파이프라인 실행 설정의 원천 CSV 도 함께 적재
       · 카탈로그에서 그 원천을 골라 지금 적재 */

  /* 실행 설정 — 옵션 체크박스 */
  pipeCfg = (function (base) {
    return function (pp, r) {
      const w = base(pp, r);
      const sel = $('#pcR', w) || $('#pcF', w);      // 재시도 칸, 없으면 일정 칸
      if (!sel || !r.canPipeEdit) return w;
      const on = !!pp.includeSeeds;
      const row = el(`<label class="chkrow" style="cursor:pointer">
        <input type="checkbox" class="chk" ${on ? 'checked' : ''}>
        <span style="margin-left:6px">원천 CSV 도 함께 적재</span>
        <span class="fr-h" style="margin-left:8px">원천이 레포 안 CSV 일 때만 해당합니다.
          CSV 를 고친 뒤 한 번 켜서 돌리거나, 카탈로그에서 지금 적재 를 쓰세요.</span></label>`);
      row.querySelector('input').onchange = async (ev) => {
        try {
          await api(`/pipelines/${enc(pp.id)}/config`, {
            method: 'PUT', body: JSON.stringify({ includeSeeds: ev.target.checked }),
          });
          toast(ev.target.checked
            ? '원천 CSV 도 함께 적재합니다. 실행 시간이 늘어납니다.'
            : '원천 CSV 는 적재하지 않습니다.');
          await boot({ keep: true });
          render();
        } catch (e) { ev.target.checked = on; fail(e); }
      };
      sel.parentElement.appendChild(row);
      return w;
    };
  })(pipeCfg);
  /* (카탈로그 정의 화면 — 원천 CSV 에 지금 적재.
     mpBody 의 «기본 정보» 갈래에 버튼(#mpSeed → POST /catalog/{id}:load)을 달던 층인데,
     v5.1~5.6 이 정의 화면을 하단 독으로 옮기면서 mpBody 가 SQL·품질 규칙 두 탭으로만
     불리게 됐다. 그래서 이 버튼은 이 커밋 이전부터 이미 화면에 뜨지 않는다 —
     바로 위 «카탈로그에서 지금 적재 를 쓰세요» 안내가 가리키는 곳이 없다는 뜻이다.
     기능을 되살리려면 독의 모델 정보 탭(dockView 의 dt === 'info')에 다시 달아야 한다.
     서버 엔드포인트는 그대로 살아 있다. 지금은 죽은 층이라 제거) */

    /* ---------------------------------------------------------- 시작 */

  function splash(msg, kind) {
    const app = document.getElementById('app');
    if (!app) return;
    app.innerHTML = `<div style="height:100vh;display:grid;place-items:center;text-align:center;padding:24px">
      <div style="max-width:520px">
        <div style="font-size:22px;font-weight:800;letter-spacing:-.5px;color:#11151F;margin-bottom:10px">Data Mates</div>
        <div style="font-size:13.5px;color:${kind === 'err' ? '#DC2A32' : '#5F6A7D'};line-height:1.7;white-space:pre-line">${msg}</div>
      </div></div>`;
  }

  /* ============================================================
     v4.4 — 실행 이력 통계를 화면에 붙인다
     ============================================================
     홈의 7일 추이·수집 지연, 품질의 7일 점수 는 예제 배열이었다.
     서버의 /history/* 가 Elementary 를 집계해 주므로 그 값으로 갈아끼운다.

     한 번 받아 캐시하고 그린다. 화면은 동기 렌더라 없으면 비워두고, 오면 다시 그린다.
     매 렌더마다 부르면 홈을 볼 때마다 요청이 나간다. */

  const HIST = { data: null, loading: false, error: null };

  async function loadHistory(force) {
    if (HIST.loading || (HIST.data && !force)) return HIST.data;
    HIST.loading = true;
    try {
      const [daily, testDaily, slowest, models] = await Promise.all([
        api('/history/daily?days=7'),
        api('/history/tests/daily?days=7'),
        api('/history/slowest?limit=5'),
        api('/history/models?limit=20'),
      ]);
      HIST.data = { daily: daily.items, testDaily: testDaily.items,
                    slowest: slowest.items, models: models.items };
      HIST.error = null;
    } catch (e) {
      HIST.error = e.message;
    } finally {
      HIST.loading = false;
    }
    render();
    return HIST.data;
  }

  const mmdd = (d) => String(d || '').slice(5).replace('-', '/');

  function bars(items, opts) {
    /* 세로 막대. 값이 없는 날은 아예 항목이 없다(서버가 0으로 채우지 않는다) —
       그날 전부 실패 로 읽히지 않게 하려는 것이고, 화면도 그대로 따른다. */
    if (!items || !items.length) return '<div class="empty" style="padding:24px">아직 실행 이력이 없습니다.</div>';
    const max = Math.max(...items.map(opts.total), 1);
    return `<div class="row g10" style="align-items:flex-end;height:132px">
      ${items.map(d => {
        const tot = opts.total(d), bad = opts.bad(d);
        const hh = Math.max(6, Math.round(112 * tot / max));
        const eh = tot ? Math.round(hh * bad / tot) : 0;
        return `<div class="col f1" style="gap:6px;align-items:center;min-width:0">
          <div style="width:100%;max-width:34px;height:${hh}px;display:flex;flex-direction:column;
               justify-content:flex-end;border-radius:5px;overflow:hidden;background:var(--surface-3)"
               title="${esc(opts.tip(d))}">
            ${eh ? `<div style="height:${eh}px;background:var(--err)"></div>` : ''}
            <div style="flex:1;background:var(--ok)"></div></div>
          <span class="t11 fnt">${mmdd(d.date)}</span></div>`;
      }).join('')}</div>`;
  }

  /* 카드 제목으로 찾아 본문만 갈아끼운다. 홈 전체를 다시 구현하지 않기 위해서다. */
  function swapCard(root, title, html) {
    const t = $$('.card-t', root).find(x => x.textContent.trim() === title);
    if (!t) return null;
    const card = t.closest('.card');
    const body = $('.card-b', card);
    if (body) body.innerHTML = html;
    return card;
  }

  const loadingHtml = `<div class="empty" style="padding:24px">${ic('clock')}<span>이력을 불러오는 중…</span></div>`;

  
  /* 품질 대시보드의 최근 7일 품질 점수 */
  
  /* ---------------------------------------------------------- 파이프라인 이력 탭 */

  const HTABS = ['실행', '모델', '문제'];

  async function loadPipeHistory() {
    if (HIST.pipe || HIST.pipeLoading) return;
    HIST.pipeLoading = true;
    try {
      const [runs, models, failures] = await Promise.all([
        api('/history/runs?limit=30'),
        api('/history/models?limit=30'),
        api('/history/failures?limit=30'),
      ]);
      HIST.pipe = { runs: runs.items, models: models.items, failures: failures.items };
    } catch (e) { HIST.pipeError = e.message; }
    finally { HIST.pipeLoading = false; render(); }
  }

  function historyView() {
    const w = el('<div class="def"><div class="def-in"></div></div>');
    const inn = $('.def-in', w);
    inn.appendChild(el(`<div class="rule">${ic14('info')}<span>여기서 실행 은 dbt 호출 단위입니다.
      모델마다 태스크를 나누는 설정이면 파이프라인 한 번에 여러 번 잡힙니다.</span></div>`));

    const tabs = el(`<div class="tabs" style="padding:0">${HTABS.map(t =>
      `<button class="tab ${S.histTab === t ? 'on' : ''}" data-ht="${t}">${t}</button>`).join('')}</div>`);
    inn.appendChild(tabs);

    const d = HIST.pipe;
    if (!d) {
      inn.appendChild(el(HIST.pipeError
        ? `<div class="empty" style="padding:34px">${ic('alert')}<span class="empty-t">이력을 불러오지 못했습니다.</span><span>${esc(HIST.pipeError)}</span></div>`
        : `<div class="empty" style="padding:34px">${ic('clock')}<span>이력을 불러오는 중…</span></div>`));
      loadPipeHistory();
    } else if (S.histTab === '모델') {
      const t = el(`<div class="tbl" style="--cols:minmax(0,1.4fr) 64px 70px 78px 78px 78px 90px;border:1px solid var(--line);border-radius:var(--r-m);overflow:hidden"></div>`);
      t.appendChild(el(`<div class="th"><span>모델</span><span>실행</span><span>실패율</span>
        <span>평균</span><span>p95</span><span>최대</span><span>총 소요</span></div>`));
      d.models.forEach(m => t.appendChild(el(`<div class="tr static" style="min-height:38px">
        <span class="c2"><span class="t13 trunc">${esc(m.name)}</span>
          <span class="sub trunc">${esc(m.phys || m.resourceType)}${m.exists ? '' : ' · 삭제됨'}</span></span>
        <span class="t12 mut num">${m.runs}</span>
        <span class="t12 num" ${m.failRate ? 'style="color:var(--err)"' : ''}>${m.failRate}%</span>
        <span class="t12 mut num">${m.avgSeconds}초</span>
        <span class="t12 mut num">${m.p95Seconds}초</span>
        <span class="t12 mut num">${m.maxSeconds}초</span>
        <span class="t12 num">${m.totalSeconds}초</span></div>`)));
      inn.appendChild(t);
    } else if (S.histTab === '문제') {
      if (!d.failures.length) inn.appendChild(el(`<div class="empty" style="padding:34px">${ic('checkc')}
        <span class="empty-t">최근 30일 안에 문제가 없습니다.</span></div>`));
      else {
        const t = el(`<div class="tbl" style="--cols:130px minmax(0,1.2fr) 76px 70px minmax(0,1fr);border:1px solid var(--line);border-radius:var(--r-m);overflow:hidden"></div>`);
        t.appendChild(el(`<div class="th"><span>시각</span><span>대상</span><span>상태</span><span>위반</span><span>메시지</span></div>`));
        d.failures.forEach(f => t.appendChild(el(`<div class="tr static" style="min-height:36px">
          <span class="t12 mut">${esc(String(f.ranAt).slice(0, 16).replace('T', ' '))}</span>
          <span class="c2"><span class="t13 trunc">${esc(f.name)}</span><span class="sub">${esc(f.resourceType)}</span></span>
          <span><span class="bdg ${f.status === 'warn' ? 'warn' : 'err'}">${esc(f.status)}</span></span>
          <span class="t12 num">${f.failures == null ? '—' : f.failures}</span>
          <span class="t12 mut trunc" title="${esc(f.message || '')}">${esc(f.message || '—')}</span></div>`)));
        inn.appendChild(t);
      }
    } else {
      const t = el(`<div class="tbl" style="--cols:130px 76px minmax(0,1.2fr) 56px 60px 84px 84px;border:1px solid var(--line);border-radius:var(--r-m);overflow:hidden"></div>`);
      t.appendChild(el(`<div class="th"><span>시각</span><span>명령</span><span>대상</span>
        <span>노드</span><span>실패</span><span>실제</span><span>순수 실행</span></div>`));
      d.runs.forEach(r => {
        let sel = r.selected;
        try { sel = JSON.parse(sel).join(', '); } catch (e) { /* 문자열 그대로 */ }
        t.appendChild(el(`<div class="tr static" style="min-height:36px">
          <span class="t12 mut">${esc(String(r.startedAt).slice(0, 16).replace('T', ' '))}</span>
          <span><span class="tag">${esc(r.command)}</span></span>
          <span class="t12 trunc" title="${esc(sel || '')}">${esc(sel || '전체')}</span>
          <span class="t12 mut num">${r.nodes}</span>
          <span class="t12 num" ${r.fails ? 'style="color:var(--err)"' : ''}>${r.fails}</span>
          <span class="t12 mut num">${r.wallSeconds}초</span>
          <span class="t12 num">${r.execSeconds}초</span></div>`));
      });
      inn.appendChild(t);
      inn.appendChild(el(`<span class="t11 fnt">실제 는 dbt 호출 전체 시간, 순수 실행 은 노드 실행 시간의 합입니다.
        차이가 크면 대부분 Spark 세션을 새로 띄우는 비용입니다.</span>`));
    }

    $$('[data-ht]', tabs).forEach(b => b.onclick = () => { S.histTab = b.dataset.ht; render(); });
    return w;
  }

  S.histTab = S.histTab || '실행';

    /* index.html 은 `pagePipeDetail = pagePipeline` 으로 그 시점의 함수를 복사해 둔다.
     S.pipe 가 있으면 라우터가 그쪽을 부르므로, 다시 가리켜 주지 않으면
     여기서 씌운 것들이 통째로 건너뛰어진다. */
    /* 실행이 끝나면 이력도 낡는다 */
  const _refreshRunV44 = refreshRun;
  refreshRun = async function (pp) {
    const st = await _refreshRunV44(pp);
    if (st === 'success' || st === 'failed') { HIST.data = null; HIST.pipe = null; }
    return st;
  };

  /* ============================================================
     v4.5 — 「정의 열기 · 파이프라인에서 사용」을 상세 탭 오른쪽 위로
     ------------------------------------------------------------
     화면마다 dock 을 따로 그리는 오버라이드가 여러 벌이라, 각각에 버튼을
     넣으면 어디는 있고 어디는 없다. 맨 마지막에 한 번만 헤더에 꽂는다.
     ============================================================ */
  /* (v5.7 에서 삭제) 독 헤더의 파이프라인에서 사용 — 파이프라인 진입은
     헤더의 파이프라인 생성 하나로 모았다. 접기 버튼의 sp 만 정리한다. */
    /* ============================================================
     v4.6 — 전역 사이드바를 없애고 메뉴를 헤더로
     ------------------------------------------------------------
     메뉴가 4개뿐인데 좌측 GNB 가 200px(접어도 48px)를 항상 차지했다.
     헤더의 현재 메뉴 ▾ 드롭다운으로 접고, 도움말은 알림 옆으로 옮긴다.
     아이콘은 기존 MENUS 의 것을 그대로 쓴다.
     ============================================================ */

  /* 이름은 화면에서 데이터 모델 로 통일돼 있다(fixTerms). 드롭다운은
     document.body 에 붙어 fixTerms 가 닿지 않으므로 여기서 직접 맞춘다. */
  const navLabel = (m) => m.label.replace('데이터 모델링', '데이터 모델');

  /* 사이드바가 쓰던 배지 계산을 그대로 가져온다 — 숫자가 어긋나면 안 된다. */
  function navBadge(id) {
    if (id === 'quality') return TESTS.filter(t => t.status !== 'ok').length;
    if (id === 'pipeline') return PIPES.filter(p => p.status === 'err').length;
    return 0;
  }

  function navMenuAt(anchor) {
    $$('.menu').forEach(x => x.remove());
    anchor.classList.add('on');
    const r = anchor.getBoundingClientRect();
    const m = el(`<div class="menu" style="top:${Math.round(r.bottom + 6)}px;` +
      `left:${Math.round(r.left)}px;min-width:214px"></div>`);
    MENUS.filter(x => R().menus.includes(x.id)).forEach(x => {
      const n = navBadge(x.id);
      const b = el(`<button class="${S.page === x.id ? 'on' : ''}">${ic14(x.icon, S.page === x.id ? '' : 'fnt')}` +
        `<span>${esc(navLabel(x))}</span><span class="gnb-k">` +
        `${n ? `<span class="nav-b">${n}</span>` : ''}` +
        `${S.page === x.id ? ic14('check') : ''}</span></button>`);
      b.onclick = () => { m.remove(); anchor.classList.remove('on'); if (S.page !== x.id) go(x.id); };
      m.appendChild(b);
    });
    document.body.appendChild(m);
    setTimeout(() => {
      const c = (e) => {
        if (m.contains(e.target) || anchor.contains(e.target)) return;
        m.remove(); anchor.classList.remove('on');
        document.removeEventListener('mousedown', c);
      };
      document.addEventListener('mousedown', c);
    }, 0);
  }

  /* 드롭다운은 #app 밖(body)에 붙는다. 배경 갱신으로 화면이 다시 그려지면
     여는 버튼이 사라지는데 메뉴만 떠 있게 되므로 같이 걷는다. */
  
  /* 사이드바는 그리지 않는다. .side 를 찾는 코드가 남아 있으므로 빈 노드는 남긴다. */

  /* 없어진 사이드바 폭을 계속 빼고 있으면 툴바가 필요 이상으로 축약된다. */


  /* ============================================================
     v4.7 — 홈·품질의 본문 제목 줄 제거
     ------------------------------------------------------------
     헤더 드롭다운이 현재 메뉴를 이미 말하는데 본문 첫 줄이 같은 단어를
     한 번 더 썼다. 모델·파이프라인은 원래 제목 없이 바로 내용으로
     들어가므로, 남은 두 화면을 거기에 맞춘다.
     제목 줄에 같이 있던 것(홈=기준 시각, 품질=결과 내려받기)은 버리지 않고
     바로 아래 탭 스트립 오른쪽으로 옮긴다.
     ============================================================ */
  
  /* ============================================================
     v4.8 — 좌측 패널 폭 통일 + 헤더 서비스명 정렬
     ------------------------------------------------------------
     카탈로그는 S.leftW(228, 드래그로 176~360), 파이프라인 목록은 262px
     고정이라 메뉴를 오갈 때 왼쪽 경계가 어긋났다. 한 값으로 모은다.
     헤더의 서비스명 영역도 같은 폭을 쓰게 해 경계를 맞춘다.
     ============================================================ */
  /* --lw 는 처음 들어왔을 때의 사이드바 폭이다. 한 번만 박고 다시 손대지 않는다.
     헤더 구분선이 드래그를 따라다니면 폭을 조절할 때마다 상단이 같이 흔들린다.
     첫 진입에서 사이드바 경계와 맞으면 충분하다는 판단. */
  document.documentElement.style.setProperty('--lw', S.leftW + 'px');

  
  /* ============================================================
     v5.0 — 데이터 계보 (dbt manifest + SQL AST)
     ------------------------------------------------------------
     관계 화면을 ERD(FK 추론)에서 실제 SQL 데이터 흐름으로 바꾼다.

       · 모델 단위 간선 = dbt manifest 의 ref() 의존성 그대로.
         여기서 다시 계산하지 않는다 — dbt 가 소유한 정보다.
       · 컬럼 단위 간선 = 서버가 SQL AST 로 뽑는다 (/lineage).
         CAST·CASE·함수·연산에 쓰인 입력까지 N:1 로 추적된다.
       · 파싱 못 한 모델은 계보 확인 불가로 표시한다. 추측한 간선은 없다.

     상자 좌표는 자동 배치(위상 순서)다. 포트 y 계산은 CSS 의
     .lin-t(4) + .lin-h(44) + .lin-r(24) 높이와 한 몸이다.
     ============================================================ */
  const LIN = { data: null, loading: false, err: null };
  S.linMode = S.linMode || 'model';
  S.linSel = S.linSel || null;          // {id} | {id, col}

  function linLoad() {
    if (LIN.loading) return;
    LIN.loading = true; LIN.err = null;
    api('/lineage').then(d => {
      LIN.data = d;
      d.__posM = d.__posC = null; d.__idx = null;
      // 모델 간선을 기존 상태(S.edges)에도 채운다 — 하단 독의
      // 입력 데이터 · 바로 다음 모델 · 데이터 계보 블록이 이걸 읽는다.
      S.edges.splice(0, S.edges.length,
        ...d.modelEdges.map(e => ({ from: e.from, to: e.to })));
    }).catch(e => { LIN.err = e.message; })
      .finally(() => { LIN.loading = false; render(); });
  }

  /* 모델이 바뀌면(저장·삭제 → boot) 계보도 낡는다 */

  /* ── 배치 — 상류 깊이(위상)로 열을 나누고, 열 안에서는 상류의 평균 y 를 따른다 ── */
  const LGY = 26;
  // 폭·간격은 두 상태가 같아야 한다 — + 로 펼칠 때 상자의 x 좌표가
  // 그대로여서 같은 화면이 확장되는 느낌이 유지된다. 높이만 자란다.
  const linW = () => 264;
  const linGX = () => 150;
  // 모델 모드는 머리만(50), 컬럼 모드는 행까지. 포트 y 계산과 한 몸이다.
  const linH = (n, colMode) => colMode ? 50 + n.cols.length * 24 : 50;
  const linRowY = (y, i) => y + 61 + i * 24;            // 행 i 의 세로 중심
  const linHeadY = (y) => y + 27;                       // 머리의 세로 중심

  function linLayout(d, colMode) {
    const ck = colMode ? '__posC' : '__posM';
    if (d[ck]) return d[ck];
    const up = {};
    d.nodes.forEach(n => { up[n.id] = []; });
    d.modelEdges.forEach(e => { if (up[e.to]) up[e.to].push(e.from); });
    const depth = {};
    const dep = (i, seen) => {
      if (depth[i] !== undefined) return depth[i];
      if (seen.has(i)) return 0;
      seen.add(i);
      depth[i] = up[i].length ? Math.max(...up[i].map(u => dep(u, seen))) + 1 : 0;
      return depth[i];
    };
    d.nodes.forEach(n => dep(n.id, new Set()));

    const byD = {};
    d.nodes.forEach(n => (byD[depth[n.id]] = byD[depth[n.id]] || []).push(n));
    const maxD = Math.max(0, ...d.nodes.map(n => depth[n.id]));
    const pos = {};
    const colH = [];
    for (let c = 0; c <= maxD; c++) {
      const col = byD[c] || [];
      col.sort((x, y) => {
        const ky = (n) => {
          const us = up[n.id].filter(u => pos[u]);
          return us.length ? us.reduce((s, u) => s + pos[u].y, 0) / us.length : 1e9;
        };
        return ky(x) - ky(y) || x.name.localeCompare(y.name);
      });
      let y = 0;
      col.forEach(n => { pos[n.id] = { x: 40 + c * (linW(colMode) + linGX(colMode)), y }; y += linH(n, colMode) + LGY; });
      colH[c] = Math.max(0, y - LGY);
    }
    const tall = Math.max(...colH, 0);
    for (let c = 0; c <= maxD; c++)                     // 열을 세로 중앙 정렬
      (byD[c] || []).forEach(n => { pos[n.id].y += 30 + (tall - colH[c]) / 2; });
    d[ck] = pos;
    return pos;
  }

  /* ── 컬럼 간선 색인 — 경로 탐색용 ── */
  const LK = (id, col) => id + ' ' + col;
  function linIdx(d) {
    if (d.__idx) return d.__idx;
    const byTo = {}, byFrom = {};
    d.columnEdges.forEach((e, i) => {
      (byTo[LK(e.toId, e.toCol)] = byTo[LK(e.toId, e.toCol)] || []).push(i);
      (byFrom[LK(e.fromId, e.fromCol)] = byFrom[LK(e.fromId, e.fromCol)] || []).push(i);
    });
    d.__idx = { byTo, byFrom };
    return d.__idx;
  }

  /* ── 선택에 따른 강조 집합 ──
     모델 모드: 선택 모델의 상·하류 모델과 그 사이 간선.
     컬럼 모드: 선택 컬럼이 지나가는 전체 경로(끝까지 양방향). */
  function linMarks(d) {
    const sel = S.linSel;
    if (!sel) return null;
    const m = { upN: new Set(), downN: new Set(), upE: new Set(), downE: new Set(),
                rows: new Map(), selKey: sel.col ? LK(sel.id, sel.col) : null, id: sel.id };
    if (S.linMode === 'column' && sel.col) {
      const { byTo, byFrom } = linIdx(d);
      const walk = (key, dir) => {
        const idx = dir === 'up' ? byTo : byFrom;
        (idx[key] || []).forEach(i => {
          const e = d.columnEdges[i];
          const nk = dir === 'up' ? LK(e.fromId, e.fromCol) : LK(e.toId, e.toCol);
          (dir === 'up' ? m.upE : m.downE).add(i);
          if (!m.rows.has(nk)) { m.rows.set(nk, dir); walk(nk, dir); }
        });
      };
      m.rows.set(m.selKey, 'sel');
      walk(m.selKey, 'up'); walk(m.selKey, 'down');
      m.rows.forEach((dir, key) => {
        const id = key.split(' ')[0];
        if (dir === 'up') m.upN.add(id); else if (dir === 'down') m.downN.add(id);
      });
    } else {
      const walk = (id, dir) => {
        d.modelEdges.forEach((e, i) => {
          const hit = dir === 'up' ? e.to === id : e.from === id;
          if (!hit) return;
          const nx = dir === 'up' ? e.from : e.to;
          (dir === 'up' ? m.upE : m.downE).add(i);
          const set = dir === 'up' ? m.upN : m.downN;
          if (!set.has(nx)) { set.add(nx); walk(nx, dir); }
        });
      };
      walk(sel.id, 'up'); walk(sel.id, 'down');
    }
    return m;
  }

  /* ── 변환식 팝오버 ── */
  function linTxPop(anchor, d, id, col) {
    $$('.menu').forEach(x => x.remove());
    const t = d.transforms[id + '.' + col];
    if (!t) return;
    const r = anchor.getBoundingClientRect();
    const m = el(`<div class="menu lin-tx" style="top:${Math.round(r.bottom + 6)}px;left:${Math.round(Math.min(window.innerWidth - 480, Math.max(8, r.left - 40)))}px">
      <span class="row g6"><span class="lin-fx" style="cursor:default">fx</span>
        <span class="b6 t12 mono trunc">${esc(id)}.${esc(col)}</span></span>
      <div class="code">${esc(t.sql)}</div>
      <span class="t11 fnt" style="display:block;margin-top:7px">${t.inputs.length
        ? '입력 ' + t.inputs.length + '개 · ' + t.inputs.map(i => esc(i.id + '.' + i.col)).join(' · ')
        : '행 집계 — 특정 입력 컬럼이 없습니다.'}</span></div>`);
    document.body.appendChild(m);
    setTimeout(() => {
      const c = (ev) => { if (!m.contains(ev.target)) { m.remove(); document.removeEventListener('mousedown', c); } };
      document.addEventListener('mousedown', c);
    }, 0);
  }

  /* ── 캔버스 — 데이터 계보. 앞의 ERD 구현(엔티티 상자·PK/FK·연결선 편집)은
     v5.7 이 이 화면으로 통째로 갈아치웠으므로 이제 유일한 정의다.
     선언(function)인 이유: 이 파일은 strict 라, 앞에 선언이 없는 이름에
     배정하면 ReferenceError 로 파일 전체가 죽는다. */
  function erdView() {
    if (!LIN.data) {
      if (!LIN.loading && !LIN.err) linLoad();
      const box = el(`<div class="f1" style="min-height:0;display:flex;align-items:center;justify-content:center;background:#F7F8FA">
        <div class="empty">${ic(LIN.err ? 'alert' : 'clock')}
          <span class="empty-t">${LIN.err ? '계보를 불러오지 못했습니다.' : '데이터 계보를 불러오는 중입니다…'}</span>
          ${LIN.err ? `<span>${esc(LIN.err)}</span><button class="btn sm" id="linRetry" style="margin-top:8px">다시 시도</button>` : ''}
        </div></div>`);
      const rb = $('#linRetry', box);
      if (rb) rb.onclick = () => { LIN.err = null; render(); };
      return box;
    }

    const d = LIN.data;
    const colMode = S.linMode === 'column';
    const pos = linLayout(d, colMode);
    const marks = linMarks(d);
    const z0 = S.erdZoom || 1;
    const w = Math.max(900, ...d.nodes.map(n => pos[n.id].x + linW(colMode) + 60));
    const h = Math.max(520, ...d.nodes.map(n => pos[n.id].y + linH(n, colMode) + 40));

    const holder = el(`<div class="f1" style="min-height:0;position:relative;display:flex;flex-direction:column">
      <div class="erd-wrap" id="erdWrap">
        <div id="erdSizer" style="position:relative;width:${Math.round(w * z0)}px;height:${Math.round(h * z0)}px">
          <div id="erdC" style="position:relative;width:${w}px;height:${h}px;transform:scale(${z0});transform-origin:0 0">
            <svg id="linSvg" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible"></svg>
          </div></div></div>
      <div class="erd-lg">
        <span class="row g5"><span style="width:9px;height:9px;border-radius:2px;background:var(--ok)"></span>상위 모델</span>
        <span class="row g5"><span style="width:9px;height:9px;border-radius:2px;background:var(--warn)"></span>하위 모델</span>
        <span class="row g5"><span class="lin-fx" style="cursor:default">fx</span>변환 컬럼</span></div>
      <div class="zoomlbl">
        <button class="lnk" id="linZFit" title="전체가 보이도록 배율을 맞춥니다.">화면에 맞추기</button>
        <span style="margin:0 6px;color:var(--line)">|</span>
        <button class="lnk" id="linZ1" title="배율을 100% 로 되돌립니다.">배율 ${Math.round(z0 * 100)}%</button></div>
    </div>`);

    const c = $('#erdC', holder), svg = $('#linSvg', holder);

    /* 간선 — 모델 모드는 상자끼리, 컬럼 모드는 행끼리 잇는다 */
    const path = (x0, y0, x1, y1) => {
      const dx = Math.max(46, (x1 - x0) / 2);
      return `M ${x0} ${y0} C ${x0 + dx} ${y0}, ${x1 - dx} ${y1}, ${x1} ${y1}`;
    };
    const rowIdx = {};
    d.nodes.forEach(n => { n.cols.forEach((cc, i) => { rowIdx[LK(n.id, cc.col)] = i; }); });

    let svgBody = '';
    if (colMode) {
      d.columnEdges.forEach((e, i) => {
        const a = pos[e.fromId], b = pos[e.toId];
        const ia = rowIdx[LK(e.fromId, e.fromCol)], ib = rowIdx[LK(e.toId, e.toCol)];
        if (!a || !b || ia === undefined || ib === undefined) return;
        let cls = '';
        if (marks && marks.selKey) {
          // 컬럼 선택 — upE/downE 가 columnEdges 인덱스를 담고 있다.
          cls = marks.upE.has(i) ? 'up' : marks.downE.has(i) ? 'down' : 'dim';
        } else if (marks) {
          // 모델 선택 — upE/downE 는 modelEdges 인덱스라 여기 쓰면 엉뚱한
          // 컬럼 간선이 칠해진다. 모델 도달 집합으로 다시 판정한다.
          const isUp = marks.upN.has(e.fromId) && (e.toId === marks.id || marks.upN.has(e.toId));
          const isDown = marks.downN.has(e.toId) && (e.fromId === marks.id || marks.downN.has(e.fromId));
          cls = isUp ? 'up' : isDown ? 'down' : 'dim';
        }
        svgBody += `<path class="lin-e ${cls}" d="${path(a.x + linW(true), linRowY(a.y, ia), b.x, linRowY(b.y, ib))}"/>`;
      });
    } else {
      d.modelEdges.forEach((e, i) => {
        const a = pos[e.from], b = pos[e.to];
        if (!a || !b) return;
        let cls = '';
        if (marks) cls = marks.upE.has(i) ? 'up' : marks.downE.has(i) ? 'down' : 'dim';
        svgBody += `<path class="lin-e ${cls}" d="${path(a.x + linW(false), linHeadY(a.y), b.x, linHeadY(b.y))}"/>`;
      });
    }
    svg.innerHTML = svgBody;

    /* 상자 */
    const { byTo, byFrom } = linIdx(d);
    d.nodes.forEach(n => {
      const p = pos[n.id];
      const dd = byId(n.id) || {};
      const color = (LAYER[dd.layer] || {}).color || '#94A3B8';
      let ncls = '';
      if (marks) {
        if (n.id === marks.id && !marks.selKey) ncls = 'sel';
        else if (colMode && marks.selKey) {
          const has = n.cols.some(cc => marks.rows.has(LK(n.id, cc.col)));
          ncls = n.id === marks.id ? 'sel' : has ? (marks.upN.has(n.id) ? 'up' : marks.downN.has(n.id) ? 'down' : '') : 'dim';
        } else ncls = marks.upN.has(n.id) ? 'up' : marks.downN.has(n.id) ? 'down' : 'dim';
      } else if (S.sel === n.id) ncls = 'sel';

      const inPsel = (S.pSel || []).includes(n.id);
      const pselRO = inPsel && pselOwnerOf(n.id);   // 남이 적재 → 여기선 입력
      const box = el(`<div class="lin-node ${colMode ? '' : 'compact'} ${ncls} ${inPsel ? 'psel' : ''}" style="left:${p.x}px;top:${p.y}px" data-lid="${esc(n.id)}">
        <div class="lin-t" style="background:${color}"></div>
        <div class="lin-h" title="누르면 선택 · 두 번 누르면 정의 열기">
          <span class="lin-n">${inPsel ? `<span class="psel-chk ${pselRO ? 'ro' : ''}"
            title="${pselRO ? `${pselRO.name} 이(가) 적재합니다 — 새 파이프라인에서는 조회 전용 입력` : '새 파이프라인이 적재할 모델'}">${ic14(pselRO ? 'eye' : 'check')}</span>` : ''}<span>${esc(n.name)}</span>
            ${n.lineageStatus === 'unknown' ? `<span class="lin-badge" title="${esc(n.reason || '')}">계보 확인 불가</span>` : ''}
            <span class="tag mono t11" style="margin-left:auto;flex:none">${esc(n.group)}</span></span>
          <span class="lin-p">${esc(n.phys)}</span></div>
        ${!colMode ? '' : n.cols.map((cc) => {
          const key = LK(n.id, cc.col);
          let rcls = '';
          if (marks && colMode && marks.selKey) {
            const dir = marks.rows.get(key);
            rcls = dir === 'sel' ? 'sel' : dir === 'up' ? 'up' : dir === 'down' ? 'down' : 'dim';
          }
          const hasIn = colMode && byTo[key], hasOut = colMode && byFrom[key];
          return `<div class="lin-r ${rcls}" data-lcol="${esc(cc.col)}">
            ${hasIn ? '<span class="lin-port l"></span>' : ''}
            <span class="lin-c" title="${esc(cc.label !== cc.col ? cc.label + ' · ' + cc.col : cc.col)}">${esc(cc.col)}</span>
            ${cc.status === 'unknown' ? '<span class="lin-q" title="이 컬럼은 계보를 확인할 수 없습니다.">?</span>' : ''}
            ${cc.tx ? `<span class="lin-fx" data-fx="${esc(cc.col)}" title="변환식 보기">fx</span>` : ''}
            <span class="lin-y">${esc(cc.type || '')}</span>
            ${hasOut ? '<span class="lin-port r"></span>' : ''}
          </div>`;
        }).join('')}
      </div>`);

      const head = $('.lin-h', box);
      head.onclick = (ev) => {
        if (ev.metaKey || ev.ctrlKey) { pselAdd(d, n.id); return; }
        S.sel = n.id; S.linSel = { id: n.id };
        S.pSel = (n.dbtType === 'model') ? [n.id] : [];
        render();
      };
      head.ondblclick = () => { S.sel = n.id; S.mView = 'def'; S.mTab = '기본 정보'; render(); };
      $$('.lin-r', box).forEach(row => {
        row.onclick = (ev) => {
          if (ev.metaKey || ev.ctrlKey) { pselAdd(d, n.id); return; }
          S.sel = n.id;
          S.linSel = colMode ? { id: n.id, col: row.dataset.lcol } : { id: n.id };
          S.pSel = (n.dbtType === 'model') ? [n.id] : [];
          render();
        };
      });
      $$('[data-fx]', box).forEach(fx => {
        fx.onclick = (ev) => { ev.stopPropagation(); linTxPop(fx, d, n.id, fx.dataset.fx); };
      });
      c.appendChild(box);
    });

    /* 확대·이동 (보기 전환 seg 는 페이지 헤더로 옮겨 갔다 — v5.7) */
    wireLin(holder, w, h);
    $('#linZ1', holder).onclick = () => { S.erdZoom = 1; render(); };
    $('#linZFit', holder).onclick = () => linFit(holder, w, h);
    if (!S.__linFit) { S.__linFit = true; setTimeout(() => linFit(holder, w, h, true), 0); }
    return holder;
  }

  function linFit(holder, w, h, silent) {
    const wrap = $('#erdWrap', holder) || $('#erdWrap');
    if (!wrap) return;
    const z = Math.max(0.3, Math.min(1, (wrap.clientWidth - 48) / w, (wrap.clientHeight - 48) / h));
    const nz = Math.round(z * 100) / 100;
    if (silent && Math.abs(nz - (S.erdZoom || 1)) < 0.02) return;
    S.erdZoom = nz;
    S.__linScroll = { l: 0, t: 0 };   // 맞추기는 의도된 이동 — 원점 기준으로 다시 본다
    render();
    const w2 = $('#erdWrap');
    if (w2) { w2.scrollLeft = 0; w2.scrollTop = 0; }
  }

  function wireLin(holder, w, h) {
    const wrap = $('#erdWrap', holder), sizer = $('#erdSizer', holder), c = $('#erdC', holder);
    // 어디를 보고 있었는지 기억한다 — 선택 클릭마다 전체를 다시 그리는 구조라,
    // 이게 없으면 모델을 누를 때마다 화면이 원점으로 튄다.
    wrap.addEventListener('scroll', () => {
      S.__linScroll = { l: wrap.scrollLeft, t: wrap.scrollTop };
    }, { passive: true });
    const Z = () => S.erdZoom || 1;
    wrap.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const old = Z();
      // 확대 폭은 휠 이동량에 비례시키고 이벤트당 3% 로 묶는다.
      // 고정 배수(1.08)로 두면 트랙패드 한 번에 이벤트가 10개씩 들어와
      // 가볍게 밀어도 배율이 두 배가 된다(측정: 스와이프 1회에 0.86 → 1.71).
      // 계수는 앱의 다른 캔버스와 같은 값이다.
      const step = Math.min(Math.abs(ev.deltaY) * 0.0006, 0.03);
      const nz = Math.max(0.3, Math.min(2, old * (ev.deltaY < 0 ? 1 + step : 1 - step)));
      if (Math.abs(nz - old) < 0.002) return;
      const r0 = wrap.getBoundingClientRect();
      const px = ev.clientX - r0.left + wrap.scrollLeft, py = ev.clientY - r0.top + wrap.scrollTop;
      S.erdZoom = nz;
      sizer.style.width = Math.round(w * nz) + 'px';
      sizer.style.height = Math.round(h * nz) + 'px';
      c.style.transform = 'scale(' + nz + ')';
      wrap.scrollLeft += px * (nz / old) - px;
      wrap.scrollTop += py * (nz / old) - py;
      const zl = $('#linZ1', holder);
      if (zl) zl.textContent = '배율 ' + Math.round(nz * 100) + '%';
    }, { passive: false });

    let pan = null;
    wrap.addEventListener('mousedown', (ev) => {
      if (ev.target.closest('.lin-node') || ev.button !== 0) return;
      pan = { x: ev.clientX, y: ev.clientY, l: wrap.scrollLeft, t: wrap.scrollTop, moved: false };
      const mv = (e2) => {
        if (Math.abs(e2.clientX - pan.x) + Math.abs(e2.clientY - pan.y) > 3) pan.moved = true;
        wrap.scrollLeft = pan.l - (e2.clientX - pan.x);
        wrap.scrollTop = pan.t - (e2.clientY - pan.y);
      };
      const up = () => {
        document.removeEventListener('mousemove', mv);
        document.removeEventListener('mouseup', up);
        if (pan && !pan.moved && (S.linSel || (S.pSel && S.pSel.length))) {
          S.linSel = null; S.pSel = []; render();
        }
        pan = null;
      };
      document.addEventListener('mousemove', mv);
      document.addEventListener('mouseup', up);
    });
  }

  /* 계보 화면에서는 카탈로그의 캔버스 추가·제거 버튼을 숨긴다 */
  
  /* ============================================================
     v5.1 — 관계도 상시 표시 · 정의를 하단 상세 탭으로
     ------------------------------------------------------------
     정의 | 관계 보기 전환을 없앤다. 가운데는 항상 데이터 계보이고,
     정의 작성 화면(defView)은 하단 독의 정의 탭으로 들어간다.

     기존 코드 어디서든 S.mView='def' 로 정의를 열던 의도(정의 열기,
     SQL 편집, 새 모델, 파이프라인의 모델 정의 열기…)는 렌더 직전에
     독의 정의 탭 열기로 번역한다 — 호출부는 하나도 고치지 않는다.
     ============================================================ */
  S.mView = 'graph';                     // v2.2 의 기본값 'def' 를 걷어낸다
  const dockDefH = () => Math.min(560, Math.round(window.innerHeight * 0.52));

  
  const DOCK_TABS_51 = [['info', '모델 정보'], ['sql', 'SQL'], ['quality', '품질 규칙'],
                        ['preview', '데이터 미리보기'], ['hist', '변경 이력']];

    /* ============================================================
     v5.2 — 파이프라인 실행 계층: 적재 소유권 · 트리거 · 파이프라인 흐름
     ------------------------------------------------------------
     · 모델 적재는 파이프라인 하나만 맡는다. 다른 파이프라인의 흐름에서
       그 모델은 조회 전용 카드로 시작 지점에 놓인다(서버 flow 가 판정).
     · 실행 방식: 예약 / 수동 / 선행 파이프라인 완료 후(성공 시).
     · 전체 흐름 — 파이프라인 사이의 실행 의존성을 그리는 화면.
       모델 DAG(데이터 의존성)과 층이 다르다.
     · 저장 응답의 suggestion 으로 선행 연결을 제안한다.
     ============================================================ */

  /* 부팅 payload 에 실린 서버 flow(소유권 반영)를 카드 그래프로 쓴다.
     클라이언트 fallback(pgraph 원본)은 SQL ref 를 끝까지 걷기 때문에
     남의 모델도 실행할 것처럼 그린다 — 서버 판정이 항상 우선이다. */

  const _pipeBodyV52 = pipeBody;
  pipeBody = function (pp, targets) {
    const b = _pipeBodyV52(pp, targets);
    b.trigger_type = pp.trigger || 'schedule';
    b.upstream_pipeline_id = pp.upstreamId || null;
    return b;
  };

  pgraph = (function (base) {
    return function (pp) {
      if (pp.graph) return pp.graph;
      const f = pp.__flow;
      if (!f || !f.nodes || !f.nodes.length) return base(pp);
      pp.graph = {
        nodes: f.nodes.map(n => ({ key: n.key, id: n.id, ro: !!n.read_only,
                                   x: n.x, y: n.y })),
        edges: f.edges.map(e => ({ from: e.from, to: e.to })),
        seq: f.nodes.length,
      };
      return pp.graph;
    };
  })(pgraph);

  /* taskGraph 는 노드를 새로 만들며 ro 표시를 떨군다 — 다시 입힌다 */
  taskGraph = (function (base) {
    return function (pp) {
      const g = base(pp);
      const ro = {};
      pgraph(pp).nodes.forEach(n => { ro[n.key] = !!n.ro; });
      g.nodes.forEach(n => { n.ro = ro[n.key]; });
      return g;
    };
  })(taskGraph);

  /* 실행 순번은 실제로 실행하는 모델만 센다 — 조회 전용은 번호가 없다 */
  execSeq = (function (base) {
    return function (pp) {
      const map = base(pp);
      const g = pgraph(pp);
      const roKeys = new Set(g.nodes.filter(n => n.ro).map(n => n.key));
      if (!roKeys.size) return map;
      const out = {};
      let i = 0;
      Object.keys(map).sort((a, b) => map[a] - map[b]).forEach(k => {
        if (!roKeys.has(k)) out[k] = ++i;
      });
      return out;
    };
  })(execSeq);

  /* 조회 전용 카드 — 실행 순번·상태 대신 조회 전용 을 단다 */
  pnodeEl = (function (base) {
    return function (pp, n, runs, edit) {
      const e = base(pp, n, runs, edit);
      if (!n.ro) return e;
      e.classList.add('ro');
      e.title = (byId(n.id) || {}).name +
        '\n조회 전용 — 적재는 소유한 파이프라인이 수행합니다. 여기서는 읽기만 합니다.';
      const seq = $('.pn-seq', e); if (seq) seq.textContent = 'RO';
      const owner = PIPES.find(x => x.id !== pp.id && x.__flow
                               && (x.__flow.order || []).includes(n.id));
      const m = $('.pn-m', e);
      if (m) {
        $$('.bdg', m).forEach(x => x.remove());     // 남의 실행 상태를 내 카드에 달지 않는다
        m.appendChild(el('<span class="tag" style="font-size:10px;background:var(--warn-soft);color:var(--warn)">조회 전용</span>'));
        if (owner) m.appendChild(el(`<span class="t11 fnt trunc" title="적재 담당: ${esc(owner.name)}">적재 · ${esc(owner.name)}</span>`));
      }
      if (owner) e.title += `\n적재 담당: ${owner.name}`;
      const x = $('.pn-x', e); if (x) x.remove();   // 시작 입력은 흐름에서 뺄 수 없다
      return e;
    };
  })(pnodeEl);

  /* ── 실행 설정: 실행 방식 ── */
  const TRIGGERS = [
    ['schedule', '예약 실행', '아래 일정에 따라 자동으로 실행합니다.'],
    ['manual', '수동 실행', '전체 실행 버튼으로만 실행합니다.'],
    ['upstream', '선행 파이프라인 완료 후', '선행 파이프라인이 성공으로 끝나면 자동으로 시작합니다. 실패하면 실행하지 않습니다.'],
    ['data_event', '데이터 이벤트', '입력 데이터가 갱신되면 자동으로 시작합니다. 조회 전용 입력 모델과 원천을 감시하고, 하나만 갱신돼도 실행됩니다.'],
  ];

  pipeCfg = (function (base) {
    return function (pp, r) {
      const w = base(pp, r);
      const can = R().canPipeEdit;
      const freqSec = $('#pcF', w) && $('#pcF', w).closest('.sec');
      const cur = pp.trigger || 'schedule';

      const sec = el(`<div class="sec" style="background:var(--surface)">
        <span class="sec-t">${ic14('play', 'fnt')}실행 방식</span>
        <select class="inp" id="pcTg" ${can ? '' : 'disabled'}>
          ${TRIGGERS.map(([k, l]) => `<option value="${k}" ${cur === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <span class="fr-h" id="pcTgH">${esc((TRIGGERS.find(t => t[0] === cur) || TRIGGERS[0])[2])}</span>
        ${cur === 'data_event' ? (() => {
          const f2 = pp.__flow || {};
          // 서버의 data_event_watch 와 같은 규칙 — 갱신 이벤트가 오는 것만
          const watch = [...(f2.inputs || []),
            ...((f2.nodes || [])
              .filter(nd => nd.dbt_type === 'seed' || nd.dbt_type === 'source')
              .map(nd => nd.id))];
          return `<span class="fr-h" style="margin-top:2px">${watch.length
            ? '갱신 감시 대상: ' + [...new Set(watch)].map(esc).join(' · ')
            : '⚠ 감시할 입력(조회 전용 모델·원천)이 없어 이 방식을 쓸 수 없습니다.'}</span>`;
        })() : ''}
        ${cur === 'upstream' ? `
          <span class="sec-t" style="margin-top:4px">${ic14('pipe', 'fnt')}선행 파이프라인</span>
          <select class="inp" id="pcUp" ${can ? '' : 'disabled'}>
            <option value="">선택해 주세요</option>
            ${PIPES.filter(x => x.id !== pp.id).map(x =>
              `<option value="${x.id}" ${pp.upstreamId === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
          </select>
          <span class="fr-h">조건: 성공(Success) 시 실행. 선행이 실패하면 이 파이프라인은 돌지 않습니다.</span>` : ''}
      </div>`);
      if (freqSec) {
        freqSec.parentElement.insertBefore(sec, freqSec);
        if (cur !== 'schedule') {
          const f = $('#pcF', w);
          f.disabled = true;
          f.insertAdjacentElement('afterend',
            el(`<span class="fr-h">실행 방식이 예약이 아니므로 일정은 사용되지 않습니다.</span>`));
        }
      }
      /* 실행 대상 모델 목록 — 조회 전용은 대상이 아니다. 번호를 빼고
         표기를 바꾸고, 개수도 실행분만 센다. */
      const roNames = new Set(pgraph(pp).nodes.filter(n => n.ro)
        .map(n => (byId(n.id) || {}).name).filter(Boolean));
      if (roNames.size) {
        let seq = 0;
        $$('.ordn', w).forEach(row => {
          const nm = ($('.t12.b6', row) || {}).textContent;
          const b = $('b', row);
          if (!b) return;
          if (roNames.has(nm)) {
            b.textContent = 'RO';
            b.style.cssText = 'background:var(--warn-soft);color:var(--warn);font-size:8.5px';
            row.appendChild(el('<span class="tag" style="font-size:10px;background:var(--warn-soft);color:var(--warn);flex:none">조회 전용</span>'));
          } else b.textContent = ++seq;
        });
        const cnt = $$('.sec-t', w).map(x => x).find(x => x.textContent.includes('실행 대상 모델'));
        if (cnt) { const c2 = $('.t11.fnt', cnt); if (c2) c2.textContent = `${seq}개 · 조회 전용 ${roNames.size}개`; }
      }

      const tg = $('#pcTg', sec);
      tg.onchange = () => { pp.trigger = tg.value; render(); };
      const up = $('#pcUp', sec);
      if (up) up.onchange = () => { pp.upstreamId = up.value || null; };

      /* 저장 — 앞 버전 핸들러를 트리거 검증·제안 처리까지 확장해 대체한다 */
      const ok = $('#pcOk', w);
      if (ok && can) ok.onclick = async () => {
        if (pp.trigger === 'upstream' && !pp.upstreamId) {
          toast('선행 파이프라인을 선택해 주세요.', 'warn'); return;
        }
        const g = (id) => { const x = $('#' + id, w); return x ? x.value : null; };
        const c = pcfg2(pp);
        c.freq = g('pcF') || c.freq;
        c.env = g('pcE') || c.env;
        c.retry = g('pcR') != null ? +g('pcR') : c.retry;
        c.onFail = g('pcS') || c.onFail;
        const nchk = $('#pcN', w); if (nchk) c.notify = nchk.checked;
        pp.freq = c.freq; pp.env = c.env;
        ok.disabled = true;
        try {
          await api('/pipelines/' + enc(pp.id), {
            method: 'PUT', body: JSON.stringify(pipeBody(pp)),
          });
          toast('실행 설정을 저장했습니다.');
          PF.data = null;
          await boot();
        } catch (e) { fail(e); }
        finally { ok.disabled = false; }
      };
      return w;
    };
  })(pipeCfg);

  /* 파이프라인을 만들거나 고친 응답에 제안이 실려 오면 띄운다.
     생성 모달·구성 동기화·설정 저장 어디를 거치든 여기서 한 번에 잡힌다. */
  api = (function (base) {
    return async function (path, opts) {
      const res = await base(path, opts);
      if (res && res.suggestion && res.id && opts
          && (opts.method === 'POST' || opts.method === 'PUT')
          && path.indexOf('/pipelines') === 0 && path.indexOf('/config') < 0) {
        setTimeout(() => suggestModal(res.id, res.suggestion), 80);
      }
      return res;
    };
  })(api);

  /* 저장 응답의 선행 연결 제안 — 확인을 받아야 연결한다 */
  S.__sugSeen = S.__sugSeen || {};
  function suggestModal(pid, sug) {
    if (!sug || !sug.upstreamId) return;
    const key = pid + '→' + sug.upstreamId;
    if (S.__sugSeen[key]) return;
    S.__sugSeen[key] = 1;
    const h = `<div class="modal-h"><span class="modal-t">선행 파이프라인 연결 제안</span>
        <button class="iconbtn sp" data-close>${ic('x')}</button></div>
      <div class="modal-b"><div class="col g10">
        <div class="note info">${ic14('info')}<span>${esc(sug.message)}</span></div>
        <div class="info2" style="border-radius:6px">
          <div><span>적재 파이프라인</span><span>${esc(sug.upstreamName)}</span></div>
          <div><span>조회 전용 모델</span><span class="mono t12">${sug.models.map(esc).join(' · ')}</span></div>
          <div><span>조건</span><span>성공(Success) 완료 시 실행</span></div></div>
      </div></div>
      <div class="modal-f"><button class="btn sp" data-close>나중에</button>
        <button class="btn pri" id="sugOk">${ic14('pipe')}완료 후 실행으로 연결</button></div>`;
    const { m, close } = modal(h, { sm: true });
    $('#sugOk', m).onclick = async () => {
      try {
        await api(`/pipelines/${enc(pid)}/config`, {
          method: 'PUT',
          body: JSON.stringify({ trigger_type: 'upstream',
                                 upstream_pipeline_id: sug.upstreamId }),
        });
        close();
        toast(`${sug.upstreamName} 완료 후 실행하도록 연결했습니다.`);
        PF.data = null;
        await boot({ keep: true }); render();
      } catch (e) { fail(e); }
    };
  }

  /* 확인 대화상자 — 앱의 modal() 로 만든다.
     네이티브 confirm() 은 설치형 셸(webview·Electron)에서 억제되면 조용히 false 를
     돌려줘 버튼을 눌렀는데 아무 일도 없다 가 된다. 실제로 그 증상이 났다. */
  function confirmModal(opts) {
    return new Promise((resolve) => {
      const h = `<div class="modal-h"><span class="modal-t">${esc(opts.title)}</span>
          <button class="iconbtn sp" data-close>${ic('x')}</button></div>
        <div class="modal-b"><div class="col g10">
          <div class="note ${opts.tone || 'info'}">${ic14(opts.tone === 'warn' ? 'alert' : 'info')}
            <span>${opts.body}</span></div></div></div>
        <div class="modal-f"><button class="btn sp" data-close>취소</button>
          <button class="btn ${opts.danger ? 'dngr' : 'pri'}" id="cfmOk">${esc(opts.ok || '확인')}</button></div>`;
      const { scrim, m, close } = modal(h, { sm: true });
      let done = false;
      const fin = (v) => { if (!done) { done = true; resolve(v); } };
      $('#cfmOk', m).onclick = () => { fin(true); close(); };
      $$('[data-close]', m).forEach(b => b.addEventListener('click', () => fin(false)));
      scrim.addEventListener('click', (e) => { if (e.target === scrim) fin(false); });
    });
  }

  /* ── 전체 흐름 — 파이프라인 단위 DAG ── */
  const PF = { data: null, loading: false, err: null };


  function pdagLoad() {
    if (PF.loading) return;
    PF.loading = true; PF.err = null;
    api('/pipelines/flow').then(d => { PF.data = d; })
      .catch(e => { PF.err = e.message; })
      .finally(() => { PF.loading = false; render(); });
  }

  /* ── 새 파이프라인 — 파이프라인 화면에서 바로 만든다 ──
     원래 생성은 모델 화면(구성 캔버스 → 파이프라인으로 등록)뿐이었다.
     대상 목록에서 다른 파이프라인이 적재를 소유한 모델은 잠그고
     소유자를 보여준다 — 눌러보고 409 로 배우게 하지 않는다. */
  function newPipelineModal(preselect, fixedTargets, readOnlyInputs) {
    const ownerOf = (id) => PIPES.find(x => x.__flow && (x.__flow.order || []).includes(id));
    const models = D.filter(d => d.kind === 'model');
    const trig = { v: 'schedule', up: '' };

    const body = () => `<div class="modal-h"><span class="modal-t">새 파이프라인</span>
        <button class="iconbtn sp" data-close>${ic('x')}</button></div>
      <div class="modal-b"><div class="frm">
        <div class="fr"><span class="fr-l">이름</span>
          <input class="inp" id="npN" placeholder="예) 일별 리포트 생성"></div>
        <div class="fr"><span class="fr-l">설명</span><input class="inp" id="npD"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div class="fr"><span class="fr-l">실행 방식</span>
            <select class="inp" id="npTg">
              <option value="schedule">예약 실행</option>
              <option value="manual">수동 실행</option>
              <option value="upstream">선행 파이프라인 완료 후</option>
              <option value="data_event">데이터 이벤트 (입력 모델 갱신 시)</option></select></div>
          <div class="fr" id="npFw"><span class="fr-l">실행 일정</span>
            <select class="inp" id="npF">${FREQS.filter(f => f !== '수동 실행').map(f => `<option>${f}</option>`).join('')}</select></div>
        </div>
        <div class="fr" id="npUw" style="display:none"><span class="fr-l">선행 파이프라인</span>
          <select class="inp" id="npU">
            <option value="">선택해 주세요</option>
            ${PIPES.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select>
          <span class="fr-h">성공(Success)으로 끝나면 자동 실행됩니다.</span></div>
        ${fixedTargets ? `
        <div class="fr"><span class="fr-l">실행 대상 모델</span>
          <div class="row g6" style="flex-wrap:wrap;align-items:center;border:1px solid var(--line);border-radius:6px;padding:10px 12px">
            ${fixedTargets.map((id, i) => `${i ? '<span class="fnt">→</span>' : ''}
              <span class="row g5" style="flex:none">${layerTag((byId(id) || {}).layer)}<span class="t12 b6 mono">${esc(id)}</span></span>`).join('')}
          </div>
          <span class="fr-h">관계도에서 선택한 모델입니다. 실행 순서와 상위 모델 포함은 의존 관계에서 자동으로 정해집니다.</span></div>
        ${(readOnlyInputs && readOnlyInputs.length) ? `
        <div class="fr"><span class="fr-l">조회 전용 입력</span>
          <div class="row g6" style="flex-wrap:wrap;align-items:center;border:1px solid var(--line);border-radius:6px;padding:10px 12px">
            ${readOnlyInputs.map(id => {
              const o = ownerOf(id) || {};
              return `<span class="row g5" style="flex:none">
                <span class="tag" style="background:var(--warn-soft);color:var(--warn)">조회 전용</span>
                <span class="t12 b6 mono">${esc(id)}</span>
                <span class="t11 fnt">${esc(o.name || '')} 적재</span></span>`;
            }).join('')}
          </div>
          <span class="fr-h">이 모델들은 여기서 읽기만 합니다. 적재는 지금 담당하는 파이프라인이 계속 맡습니다.</span></div>` : ''}
        ` : `
        <div class="fr"><span class="fr-l">실행 대상 모델</span>
          <div class="col g4" style="border:1px solid var(--line);border-radius:6px;padding:8px;max-height:200px;overflow:auto">
            ${models.map(d => {
              const ow = ownerOf(d.id);
              return `<label class="chkrow" style="${ow ? 'opacity:.55;cursor:not-allowed' : ''}"
                  title="${ow ? esc(ow.name) + ' 이(가) 적재합니다 — 대상이 아니라 조회 전용 입력으로 쓰입니다.' : esc(d.phys)}">
                <input type="checkbox" class="chk" data-npt="${esc(d.id)}" ${ow ? 'disabled' : ''} ${!ow && d.id === preselect ? 'checked' : ''}>
                ${layerTag(d.layer)}<span class="t12 trunc">${esc(d.name)}</span>
                ${ow ? `<span class="t11 fnt sp trunc" style="max-width:180px">「${esc(ow.name)}」가 적재</span>` : ''}
              </label>`; }).join('')}
          </div>
          ${models.every(d => ownerOf(d.id))
            ? `<div class="note warn" style="margin-top:6px">${ic14('alert')}<span>모든 모델의 적재를 이미 다른 파이프라인이 맡고 있습니다.
               새 파이프라인을 만들려면 <b>데이터 모델</b>에서 새 모델(예: 기존 모델을 참조하는 리포트용 모델)을 먼저 만드세요 —
               그 모델이 이 파이프라인의 실행 대상이 되고, 참조한 모델은 조회 전용 입력이 됩니다.</span></div>`
            : `<span class="fr-h">상위 모델은 자동으로 포함됩니다. 다른 파이프라인이 적재하는 모델에서 이어서 만들면
               그 모델은 조회 전용 입력이 되고, 선행 연결을 제안받습니다.</span>`}</div>
        `}
      </div></div>
      <div class="modal-f"><button class="btn sp" data-close>취소</button>
        <button class="btn pri" id="npOk">${ic14('plus')}만들기</button></div>`;

    const { m, close } = modal(body());
    const tg = $('#npTg', m);
    tg.onchange = () => {
      trig.v = tg.value;
      $('#npFw', m).style.display = trig.v === 'schedule' ? '' : 'none';
      $('#npUw', m).style.display = trig.v === 'upstream' ? '' : 'none';
    };
    $('#npOk', m).onclick = async () => {
      const name = $('#npN', m).value.trim();
      const targets = fixedTargets || $$('[data-npt]:checked', m).map(x => x.dataset.npt);
      if (!name) { toast('파이프라인 이름을 입력해 주세요.', 'warn'); return; }
      if (!targets.length) { toast('실행 대상 모델을 골라 주세요.', 'warn'); return; }
      if (trig.v === 'upstream' && !$('#npU', m).value) {
        toast('선행 파이프라인을 선택해 주세요.', 'warn'); return;
      }
      const btn = $('#npOk', m); btn.disabled = true;
      try {
        const p = await api('/pipelines', {
          method: 'POST',
          body: JSON.stringify({
            name, description: $('#npD', m).value.trim(),
            env: S.env === 'dev' ? 'local' : S.env,
            freq: trig.v === 'schedule' ? $('#npF', m).value : '수동 실행',
            retry: 1, on_fail: 'stop', notify: true,
            targets, task_mode: 'per_model',
            trigger_type: trig.v,
            upstream_pipeline_id: trig.v === 'upstream' ? $('#npU', m).value : null,
          }),
        });
        close();
        S.pSel = [];
        await boot({ keep: true });
        toast(`${name} 파이프라인을 만들었습니다.`);
        openPipeTab(p.id);
      } catch (e) { btn.disabled = false; fail(e); }
    };
  }

  function wirePdagZoom(wrap, w, h) {
    const sizer = $('#pdagSizer', wrap), c = $('#pdagC', wrap);
    const Z = () => S.pdagZoom || 1;
    wrap.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const old = Z();
      const step = Math.min(Math.abs(ev.deltaY) * 0.0006, 0.03);
      const nz = Math.max(0.3, Math.min(2, old * (ev.deltaY < 0 ? 1 + step : 1 - step)));
      if (Math.abs(nz - old) < 0.002) return;
      const r0 = wrap.getBoundingClientRect();
      const px = ev.clientX - r0.left + wrap.scrollLeft, py = ev.clientY - r0.top + wrap.scrollTop;
      S.pdagZoom = nz;
      sizer.style.width = Math.round(w * nz) + 'px';
      sizer.style.height = Math.round(h * nz) + 'px';
      c.style.transform = 'scale(' + nz + ')';
      wrap.scrollLeft += px * (nz / old) - px;
      wrap.scrollTop += py * (nz / old) - py;
      const lb = $('#pdagZ1');
      if (lb) lb.textContent = '배율 ' + Math.round(nz * 100) + '%';
      S.__pfScroll = { l: wrap.scrollLeft, t: wrap.scrollTop };
    }, { passive: false });

    let pan = null;
    wrap.addEventListener('mousedown', (ev) => {
      if (ev.target.closest('.pf-n') || ev.target.closest('[data-edel]') || ev.button !== 0) return;
      pan = { x: ev.clientX, y: ev.clientY, l: wrap.scrollLeft, t: wrap.scrollTop, moved: false };
      const mv = (e2) => {
        if (Math.abs(e2.clientX - pan.x) + Math.abs(e2.clientY - pan.y) > 3) pan.moved = true;
        wrap.scrollLeft = pan.l - (e2.clientX - pan.x);
        wrap.scrollTop = pan.t - (e2.clientY - pan.y);
      };
      const up = () => {
        document.removeEventListener('mousemove', mv);
        document.removeEventListener('mouseup', up);
        if (pan && !pan.moved && S.pdagSel) { S.pdagSel = null; render(); }
        pan = null;
      };
      document.addEventListener('mousemove', mv);
      document.addEventListener('mouseup', up);
    });
  }

  function pdagView() {
    const box = el('<div class="f1" style="min-height:0;position:relative;display:flex;flex-direction:column"></div>');
    if (!PF.data) {
      if (!PF.loading && !PF.err) pdagLoad();
      box.appendChild(el(`<div class="empty" style="margin:auto">${ic(PF.err ? 'alert' : 'clock')}
        <span class="empty-t">${PF.err ? '흐름을 불러오지 못했습니다.' : '파이프라인 흐름을 불러오는 중…'}</span>
        ${PF.err ? `<span>${esc(PF.err)}</span>` : ''}</div>`));
      return box;
    }
    const d = PF.data;
    const up = {}; d.nodes.forEach(n => { up[n.id] = []; });
    d.edges.forEach(e => { if (up[e.to]) up[e.to].push(e.from); });
    const depth = {};
    const dep = (i, g) => {
      if (depth[i] !== undefined) return depth[i];
      if (g.has(i)) return 0;
      g.add(i);
      depth[i] = up[i].length ? Math.max(...up[i].map(u => dep(u, g))) + 1 : 0;
      return depth[i];
    };
    d.nodes.forEach(n => dep(n.id, new Set()));
    const byD = {};
    d.nodes.forEach(n => (byD[depth[n.id]] = byD[depth[n.id]] || []).push(n));
    const NW = 230, GX = 130, NH = 64, GY = 22;
    const pos = {};
    Object.keys(byD).map(Number).sort((a, b) => a - b).forEach(c => {
      byD[c].forEach((n, i) => { pos[n.id] = { x: 40 + c * (NW + GX), y: 34 + i * (NH + GY) }; });
    });
    const w = Math.max(760, ...d.nodes.map(n => pos[n.id].x + NW + 60));
    const h = Math.max(320, ...d.nodes.map(n => pos[n.id].y + NH + 40));

    // 데이터 모델 화면과 같은 문법의 통합 헤더 — 제목 · 개수 · (오른쪽) 안내
    box.appendChild(el(`<div class="mod-bar">
      <span class="row g8" style="padding-left:14px;min-width:0;flex:1 1 auto;overflow:hidden">
        <span class="b6 t13" style="flex:none">실행 의존성</span>
        <span class="t11 fnt trunc">파이프라인 ${d.nodes.length}개 · 연결 ${d.edges.length}개</span></span>
      <span class="t11 fnt trunc" style="flex:0 1 auto;min-width:0;padding-right:14px;text-align:right">
        ${R().canPipeEdit
          ? '파이프라인을 누르면 탭으로 열림 · 연결점을 끌어 성공 시 실행 연결 · 연결 라벨을 눌러 해제'
          : '파이프라인을 누르면 탭으로 열립니다'}</span></div>`));
    const z0 = S.pdagZoom || 1;
    const wrap = el(`<div class="erd-wrap f1" id="pdagWrap">
      <div id="pdagSizer" style="position:relative;width:${Math.round(w * z0)}px;height:${Math.round(h * z0)}px">
      <div id="pdagC" style="position:relative;width:${w}px;height:${h}px;transform:scale(${z0});transform-origin:0 0">
        <svg style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible">
          ${d.edges.map(e => {
            const a = pos[e.from], b = pos[e.to];
            if (!a || !b) return '';
            const x0 = a.x + NW, y0 = a.y + NH / 2, x1 = b.x, y1 = b.y + NH / 2;
            const dx = Math.max(40, (x1 - x0) / 2), mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
            return `<path class="lin-e up" d="M ${x0} ${y0} C ${x0 + dx} ${y0}, ${x1 - dx} ${y1}, ${x1} ${y1}"/>
              <g transform="translate(${mx},${my})" data-edel="${esc(e.to)}" data-efrom="${esc(e.from)}"
                 style="pointer-events:auto;cursor:pointer">
                <rect x="-26" y="-9" width="52" height="18" rx="5"
                 fill="var(--surface)" stroke="var(--ok-line)"/>
                <text text-anchor="middle" dominant-baseline="central" font-size="10"
                 fill="var(--ok)">성공 시</text>
                <title>누르면 연결을 해제합니다</title></g>`;
          }).join('')}
        </svg>
        ${d.nodes.map(n => `
          <div class="lin-node compact pf-n ${n.id === S.pipe ? 'sel' : ''}" data-pf="${esc(n.id)}"
               style="left:${pos[n.id].x}px;top:${pos[n.id].y}px;width:${NW}px;cursor:pointer">
            <div class="lin-t" style="background:${n.status === 'err' ? 'var(--err)' : n.status === 'run' ? 'var(--pri)' : n.status === 'ok' ? 'var(--ok)' : '#94A3B8'}"></div>
            <div class="lin-h" style="cursor:pointer">
              <span class="lin-n"><span>${esc(n.name)}</span>
                <span style="margin-left:auto;flex:none">${pipeBadge(n.status)}</span></span>
              <span class="lin-p">${n.triggerType === 'upstream' ? '선행 완료 후'
                : n.triggerType === 'manual' ? '수동 실행'
                : n.triggerType === 'data_event' ? '데이터 이벤트' : esc(n.freq)} · 모델 ${n.modelCount}개${n.paused ? ' · 일시정지' : ''}</span>
            </div>
            <span class="pf-port l"></span>
            ${R().canPipeEdit ? `<span class="pf-port r" data-pconn="${esc(n.id)}" title="끌어서 후행 파이프라인에 연결"></span>` : ''}
            ${R().canPipeEdit ? `<button class="pf-x" data-pfdel="${esc(n.id)}" title="파이프라인 삭제 — 모델과 데이터는 남습니다">${ic14('x')}</button>` : ''}</div>`).join('')}
      </div></div></div>`);
    // 보던 위치를 기억한다 — 선택 클릭마다 다시 그리므로
    wrap.addEventListener('scroll', () => {
      S.__pfScroll = { l: wrap.scrollLeft, t: wrap.scrollTop };
    }, { passive: true });
    box.appendChild(wrap);
    box.appendChild(el(`<div class="zoomlbl">
      <button class="lnk" id="pdagFit" title="전체가 보이도록 배율을 맞춥니다.">화면에 맞추기</button>
      <span style="margin:0 6px;color:var(--line)">|</span>
      <button class="lnk" id="pdagZ1" title="배율을 100% 로 되돌립니다.">배율 ${Math.round(z0 * 100)}%</button></div>`));
    $('#pdagZ1', box).onclick = () => { S.pdagZoom = 1; render(); };
    $('#pdagFit', box).onclick = () => {
      const z = Math.max(0.3, Math.min(1, (wrap.clientWidth - 48) / w, (wrap.clientHeight - 48) / h));
      S.pdagZoom = Math.round(z * 100) / 100;
      S.__pfScroll = { l: 0, t: 0 };
      render();
    };
    wirePdagZoom(wrap, w, h);
    $$('.pf-n', wrap).forEach(x => {
      // 한 번 클릭으로 연다 — 선택만 하는 중간 상태는 쓸 데가 없었다.
      x.onclick = () => { S.pdagSel = x.dataset.pf; openPipeTab(x.dataset.pf); };
      x.ondblclick = () => openPipeTab(x.dataset.pf);
      if (S.pdagSel === x.dataset.pf) x.classList.add('sel');
      x.title = '누르면 탭으로 열립니다';
    });

    /* 노드의 × — 파이프라인 삭제 */
    $$('[data-pfdel]', wrap).forEach(b => {
      b.onclick = (ev) => {
        ev.stopPropagation();
        const pp = PIPES.find(x => x.id === b.dataset.pfdel);
        if (pp) deletePipeline(pp);
      };
      b.ondblclick = (ev) => ev.stopPropagation();
    });

    /* 연결 해제 — 트리거 관계만 끊는다. 모델 의존성과는 무관하다. */
    const setTrigger = async (pid, body, msg) => {
      try {
        await api(`/pipelines/${enc(pid)}/config`, { method: 'PUT', body: JSON.stringify(body) });
        PF.data = null; toast(msg); await boot({ keep: true }); render();
      } catch (e) { fail(e); }
    };
    $$('g[data-edel]', wrap).forEach(g => {
      g.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        if (!R().canPipeEdit) return;
        const to = g.dataset.edel;
        const pp = PIPES.find(x => x.id === to) || {};
        const from = PIPES.find(x => x.id === g.dataset.efrom) || {};
        const nx = (pp.freq && pp.freq !== '수동 실행') ? 'schedule' : 'manual';
        const ok = await confirmModal({
          title: '파이프라인 연결 해제',
          tone: 'warn',
          ok: '연결 해제',
          body: `${esc(from.name)} → ${esc(pp.name)} 트리거 연결을 해제합니다.<br>` +
                `해제하면 ${esc(pp.name)} 은(는) <b>${nx === 'schedule' ? esc(pp.freq) + ' 예약' : '수동'}</b> 실행으로 돌아갑니다.<br>` +
                `모델 사이의 데이터 의존성은 바뀌지 않습니다.`,
        });
        if (!ok) return;
        setTrigger(to, { trigger_type: nx, clear_upstream: true },
                   `연결을 해제했습니다 — ${pp.name} 은(는) 이제 독립 실행됩니다.`);
      });
    });

    /* 포트 드래그 → 성공 시 연결 생성 */
    const inner = $('svg', wrap).parentElement;
    $$('[data-pconn]', wrap).forEach(port => {
      port.addEventListener('mousedown', (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        const from = port.dataset.pconn;
        const svg = $('svg', wrap);
        const zz = S.pdagZoom || 1;         // 캔버스는 scale() 로 확대돼 있다
        const r0 = inner.getBoundingClientRect();
        const p0 = port.getBoundingClientRect();
        const x0 = (p0.left - r0.left + 4) / zz, y0 = (p0.top - r0.top + 4) / zz;
        const tmp = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        tmp.setAttribute('class', 'lin-e up');
        tmp.setAttribute('stroke-dasharray', '5 4');
        svg.appendChild(tmp);
        const mv = (e2) => {
          const x1 = (e2.clientX - r0.left) / zz, y1 = (e2.clientY - r0.top) / zz;
          const dx = Math.max(30, (x1 - x0) / 2);
          tmp.setAttribute('d', `M ${x0} ${y0} C ${x0 + dx} ${y0}, ${x1 - dx} ${y1}, ${x1} ${y1}`);
          $$('.pf-n', wrap).forEach(nn => nn.classList.toggle('drop',
            nn.dataset.pf !== from && nn.contains(document.elementFromPoint(e2.clientX, e2.clientY))));
        };
        const up = (e2) => {
          document.removeEventListener('mousemove', mv);
          document.removeEventListener('mouseup', up);
          tmp.remove();
          const hit = document.elementFromPoint(e2.clientX, e2.clientY);
          const node = hit && hit.closest('.pf-n');
          $$('.pf-n', wrap).forEach(nn => nn.classList.remove('drop'));
          if (!node || node.dataset.pf === from) return;
          const to = node.dataset.pf;
          const pp = PIPES.find(x => x.id === to) || {};
          setTrigger(to, { trigger_type: 'upstream', upstream_pipeline_id: from },
                     `${(PIPES.find(x => x.id === from) || {}).name} 성공 후 ${pp.name} 이(가) 실행됩니다.`);
        };
        document.addEventListener('mousemove', mv);
        document.addEventListener('mouseup', up);
      });
    });
    // 실행 중인 파이프라인이 있으면 상태를 폴링한다
    if (d.nodes.some(nd => nd.status === 'run') && !PF.__t) {
      PF.__t = setTimeout(() => { PF.__t = null; PF.data = null;
        if (S.page === 'pipeline' && S.openPipe === 'deps') render(); }, 5000);
    }
    return box;
  }

  /* ============================================================
     v5.3 — 파이프라인 화면을 IDE식 탭 구조로
     ------------------------------------------------------------
     기본 화면 = Pipeline Dependencies(파이프라인 사이 실행 의존성 DAG).
     노드를 두 번 누르면 그 파이프라인이 탭으로 열리고, 탭 안이
     Task Dependencies(모델 단위 실행 DAG = 기존 구성/실행 흐름/설정/이력)다.
     여러 파이프라인을 동시에 열어 두고 오가며, 화면 전체를 갈아타지 않는다.
     ============================================================ */
  /* 주의 — S.pipeTab 은 이미 하단 독의 탭(실행 정보/로그/실행 SQL/품질 결과)이다.
     v1.0 부터 쓰던 키라, IDE 탭에 같은 이름을 쓰면 pipeDock 이 매 렌더마다
     TABS 에 없는 값 이라며 '실행 정보' 로 덮어써서 탭이 튕긴다. 이름을 가른다. */
  S.openPipes = S.openPipes || [];        // 열린 파이프라인 탭(id 순서 유지)
  S.openPipe = S.openPipe || 'deps';      // 'deps' | 파이프라인 id

  function openPipeTab(pid) {
    if (!PIPES.some(x => x.id === pid)) return;
    if (!S.openPipes.includes(pid)) S.openPipes.push(pid);   // 이미 열려 있으면 이동만
    S.openPipe = pid; S.pipe = pid; S.pipeNodeK = null;
    if (!['build', 'flow', 'cfg', 'history'].includes(S.pipeView)) S.pipeView = 'flow';
    render();
  }

  function closePipeTab(pid) {
    const i = S.openPipes.indexOf(pid);
    if (i >= 0) S.openPipes.splice(i, 1);
    if (S.openPipe === pid)
      S.openPipe = S.openPipes[i] || S.openPipes[i - 1] || 'deps';
    if (S.openPipe !== 'deps') S.pipe = S.openPipe;
    render();
  }

  function pipeTabStrip() {
    const strip = el('<div class="ptabs"></div>');
    const dep = el(`<button class="tab ${S.openPipe === 'deps' ? 'on' : ''}" style="height:45px">
      ${ic14('flow')}파이프라인 흐름</button>`);
    dep.onclick = () => { S.openPipe = 'deps'; render(); };
    strip.appendChild(dep);
    S.openPipes.forEach(pid => {
      const pp = PIPES.find(x => x.id === pid);
      if (!pp) return;
      const t = el(`<button class="tab ${S.openPipe === pid ? 'on' : ''}" style="height:45px">
        ${ic14('pipe')}<span class="trunc" style="max-width:160px">${esc(pp.name)}</span>
        <span class="ptab-x" title="탭 닫기">${ic14('x')}</span></button>`);
      t.onclick = (ev) => {
        if (ev.target.closest('.ptab-x')) { closePipeTab(pid); return; }
        S.openPipe = pid; S.pipe = pid; render();
      };
      strip.appendChild(t);
    });
    return strip;
  }

    /* 모델링 화면의 파이프라인에서 사용 등 바깥에서 들어오는 진입은
     해당 파이프라인 탭을 연다 — 화면 전체를 갈아타지 않는 것이 규칙이다. */
  /* 파이프라인에서 사용 — 이 모델을 실행(소유)하는 파이프라인이 있으면 그 탭,
     조회 전용으로라도 포함하면 그 탭, 어디에도 없으면 여기(데이터 모델 화면)가
     파이프라인 생성의 유일한 진입점이다. */
  function usePipeline(id) {
    const owner = PIPES.find(pp => pp.__flow && (pp.__flow.order || []).includes(id));
    const holder = owner || PIPES.find(pp => pgraph(pp).nodes.some(nn => nn.id === id));
    if (holder) {
      openPipeTab(holder.id);
      const nn = pgraph(holder).nodes.find(x => x.id === id);
      S.pipeNodeK = nn ? nn.key : null;
      go('pipeline');
      return;
    }
    newPipelineModal(id);
  }

  /* pageView 는 S.pipe 가 있으면 pagePipeDetail() 을 부른다 — 별칭을 다시 맞춘다 */
  /* (pagePipeDetail — 이후 정의가 값 캡처 없이 전면 교체. 죽은 층 제거) */
  /* ============================================================
     v5.5 — 관계도에서 모델을 골라 파이프라인 생성
     ------------------------------------------------------------
     · 일반 클릭 = 모델 하나 선택(S.pSel 시드), ⌘/Ctrl+클릭 = 연결된 모델 추가.
     · 서로 의존성으로 연결된 모델만 함께 담는다 — 분리된 그래프는 거부.
       A→B→C 에서 A·C 를 고르면 사이의 B 를 자동 포함해, 선택 집합이 항상
       실행 가능한 하나의 DAG 가 되게 한다.
     · 파이프라인 생성 버튼은 항상 보이되 유효한 선택이 없으면 비활성.
       비활성 사유는 hover 로 알려 준다.
     ============================================================ */
  S.pSel = S.pSel || [];


  /* 모델 간선 기반 도달 집합 — 방향 있는 조상/자손, 방향 없는 연결 성분 */
  function pselSets(d, id) {
    const up = {}, down = {}, und = {};
    d.nodes.forEach(x => { up[x.id] = []; down[x.id] = []; und[x.id] = []; });
    d.modelEdges.forEach(e => {
      if (up[e.to]) up[e.to].push(e.from);
      if (down[e.from]) down[e.from].push(e.to);
      if (und[e.to]) und[e.to].push(e.from);
      if (und[e.from]) und[e.from].push(e.to);
    });
    const bfs = (start, adj) => {
      const out = new Set([start]), q = [start];
      while (q.length) (adj[q.shift()] || []).forEach(x => {
        if (!out.has(x)) { out.add(x); q.push(x); } });
      out.delete(start);
      return out;
    };
    return { anc: bfs(id, up), desc: bfs(id, down), comp: bfs(id, und) };
  }

  function pselOwnerOf(id) {
    return PIPES.find(x => x.__flow && (x.__flow.order || []).includes(id));
  }

  /* ⌘/Ctrl+클릭 — 연결 검증 + 사이 모델 자동 포함 */
  function pselAdd(d, id) {
    const node = d.nodes.find(x => x.id === id);
    if (!node || node.dbtType !== 'model') {
      toast('원천은 파이프라인의 실행 대상이 아닙니다 — 상위 원천은 자동으로 포함됩니다.', 'warn');
      return;
    }
    const sel = S.pSel || [];
    if (sel.includes(id)) {                     // 다시 누르면 해제
      S.pSel = sel.filter(x => x !== id);
      render(); return;
    }
    if (!sel.length) { S.pSel = [id]; S.sel = id; render(); return; }

    const s0 = pselSets(d, sel[0]);
    if (!s0.comp.has(id)) {
      toast('현재 선택된 모델과 연결된 모델만 추가할 수 있습니다.', 'warn');
      return;
    }
    // 사이 모델 자동 포함 — 선택 s 와 새 모델 v 사이의 모든 경로 위 모델
    const v = pselSets(d, id);
    const add = new Set([id]);
    sel.forEach(sid => {
      const s = pselSets(d, sid);
      let between = null;
      if (s.desc.has(id)) between = [...s.desc].filter(m => v.anc.has(m));
      else if (s.anc.has(id)) between = [...s.anc].filter(m => v.desc.has(m));
      (between || []).forEach(m => {
        const mn = d.nodes.find(x => x.id === m);
        if (mn && mn.dbtType === 'model') add.add(m);
      });
    });
    S.pSel = [...new Set([...sel, ...add])];
    S.sel = id;
    render();
  }

  /* 선택을 적재할 모델과 조회 전용 입력으로 가른다.
     다른 파이프라인이 이미 적재하는 모델을 골랐다면 막지 않는다 — 그 모델은
     이 파이프라인에서 읽기만 하는 입력이 된다. 적재 대상이 하나도 없을 때만
     만들 수 없다(적재할 것이 없으면 파이프라인이 아니다). */
  function pselSplit() {
    const sel = S.pSel || [];
    const load = [], read = [];
    sel.forEach(id => (pselOwnerOf(id) ? read : load).push(id));
    return { load, read };
  }

  function pselState() {
    const sel = S.pSel || [];
    if (!sel.length)
      return { ok: false, reason: '파이프라인을 생성하려면 모델을 선택하세요. (⌘/Ctrl+클릭으로 여러 개)' };
    const { load, read } = pselSplit();
    if (!load.length)
      return { ok: false, reason: '선택한 모델은 모두 다른 파이프라인이 적재합니다. 이 파이프라인이 적재할 모델을 하나 이상 함께 선택하세요 — 고른 모델은 조회 전용 입력이 됩니다.' };
    return { ok: true, reason: read.length
      ? `적재 ${load.length}개 · 조회 전용 입력 ${read.length}개로 파이프라인을 만듭니다.`
      : '선택한 모델로 파이프라인을 만듭니다. 상위 모델은 자동 포함됩니다.' };
  }

  /* 선택 모델을 의존 순서로 — 모달의 체인 표시와 대상 순서에 쓴다 */
  function pselOrdered(d) {
    const sel = new Set(S.pSel || []);
    const up = {};
    d.nodes.forEach(x => { up[x.id] = []; });
    d.modelEdges.forEach(e => { if (up[e.to]) up[e.to].push(e.from); });
    const depth = {};
    const dep = (i, g) => {
      if (depth[i] !== undefined) return depth[i];
      if (g.has(i)) return 0;
      g.add(i);
      depth[i] = (up[i] || []).length ? Math.max(...up[i].map(u => dep(u, g))) + 1 : 0;
      return depth[i];
    };
    d.nodes.forEach(x => dep(x.id, new Set()));
    return [...sel].sort((a, b) => (depth[a] - depth[b]) || a.localeCompare(b));
  }

  /* 툴바 — 항상 보이는 파이프라인 생성 (모델 화면 전용) */
  

  /* ============================================================
     v5.6 — 정의의 이중 탭 해소: 남은 고유 내용을 모델 정보에 병합
     ------------------------------------------------------------
     기본 정보 탭의 고유분(구분·생성 방식·설명 편집·사용 파이프라인)을
     모델 정보 독에 한 열로 붙인다. 입력 데이터·변환 탭은 각각 중복·
     dbt 이전의 잔재라 승계하지 않았고, 컬럼의 형식은 출력 컬럼 목록에
     합쳤다(v2.5 템플릿 수정). SQL·품질 규칙만 독의 탭으로 남는다.
     ============================================================ */
  /* isDeletable 은 프로토타입의 내가 만든 카드(d.custom) 기준이었다.
     서버 연동 후 custom 이 없어 항상 false — UI 에서 모델 삭제가 불가능했다.
     실제 기준: dbt 모델이고 하류가 없을 것. (파이프라인 사용 여부는 메뉴
     비활성 + 서버 409 가 막는다.) */
  function isDeletable(id) {
    const d = byId(id);
    return !!(d && d.kind === 'model' && !(d.down || []).length);
  }

  /* 모델 정보 탭 — 기본 정의만 남긴 단순 화면으로 통째로 다시 그린다.
     연결 관계는 위 계보 화면, 컬럼은 + 상세 보기, SQL·품질 규칙·미리보기·
     이력은 각자의 탭이 맡는다. 여기는 요약판이 아니라 «이 모델이 무엇인지»
     확인하고 설명을 고치는 자리다. */
  function dockView() {
    /* 하단 독 — 모델 정보 · SQL · 품질 규칙 · 데이터 미리보기 · 변경 이력 (v5.1 단일 층).
       정의의 이중 탭은 없앴다: 기본 정보·컬럼은 모델 정보에 병합됐고, 입력 데이터는
       모델 정보와 중복, 변환은 dbt 이전의 잔재라 뺐다. SQL·품질 본문은 mpBody 가 그린다. */
    if (!DOCK_TABS_51.some(([k]) => k === S.dockTab)) S.dockTab = 'info';
    const dt = S.dockTab;
    const d = S.sel && byId(S.sel);

    const w = el(`<div class="dock ${S.dockMin ? 'min' : ''}" style="${S.dockMin ? '' : `height:${S.dockH}px`}">
      ${S.dockMin ? '' : '<div class="grip-h" id="gripH" title="높이 조절"></div>'}
      <div class="dock-h">${DOCK_TABS_51.map(([k, l]) =>
        `<button class="tab ${dt === k ? 'on' : ''}" data-dt="${k}" style="height:36px">${l}</button>`).join('')}
        <button class="iconbtn sp" id="dockTgl" title="${S.dockMin ? '펼치기' : '접기'}">${ic14(S.dockMin ? 'chev' : 'chevd')}</button></div>
      <div class="dock-b" id="dockB"></div></div>`);
    const b = $('#dockB', w);

    if (!d) {
      b.appendChild(el(`<div class="empty">${ic('model')}<span>관계도에서 모델을 선택해 주세요.</span></div>`));

    } else if (dt === 'info') {
      /* 모델 정보 — 핵심 정의만 (v5.6 단순화: 개수 나열·계보 요약은 화면 중복이라 뺐다) */
      const mat = d.mat === '—' ? '외부에서 들어오는 원천 데이터'
        : d.mat === 'Incremental' ? '변경분만 반영'
        : d.mat === 'View' ? '조회할 때 계산' : '전체 다시 생성';
      const pipes = PIPES.filter(pp => pp.__flow
        && ((pp.__flow.order || []).includes(d.id) || (pp.__flow.inputs || []).includes(d.id)));
      const isModel = d.kind === 'model';
      const dirty = (S.__dirty || {})[d.id];

      b.style.cssText = 'overflow:auto';
      const box = el(`<div class="col" style="max-width:820px;gap:14px;padding:18px 22px">
        <div class="row g8">
          <span class="swatch" style="background:${(LAYER[d.layer] || {}).color || '#94A3B8'}"></span>
          <span class="b6 t15">${esc(d.name)}</span>
          <span class="tag mono t11" style="flex:none">${esc(grpOf(d))}</span>
        </div>
        <div class="row" style="gap:22px;flex-wrap:wrap;color:var(--muted);font-size:12.5px">
          <span class="row g6"><span class="fnt">저장 위치</span><span class="mono" style="color:var(--text)">${esc(d.phys)}</span></span>
          <span class="row g6"><span class="fnt">구분</span><span style="color:var(--text)">${esc(d.layer)}</span><span class="t11 fnt">· ${esc((LAYER[d.layer] || {}).tech || '')}</span></span>
          <span class="row g6"><span class="fnt">생성 방식</span><span style="color:var(--text)">${mat}</span><span class="t11 fnt mono">· ${esc(d.mat)}</span></span>
        </div>
        <div class="col g6">
          <span class="t12 b6">설명 ${isModel && dirty ? '<span class="t11" style="color:var(--warn);font-weight:400">● 저장 안 됨</span>' : ''}</span>
          ${isModel
            ? `<textarea class="inp" id="dkDesc" style="min-height:64px;font-size:12.5px;line-height:1.6;resize:vertical">${esc((dirty || {}).desc ?? (d.desc || ''))}</textarea>`
            : `<span class="t12" style="line-height:1.6">${esc(d.desc || '설명이 없습니다.')}</span>`}
        </div>
        ${pipes.length ? `<div class="col g6">
          <span class="t12 b6">사용 파이프라인</span>
          ${pipes.map(pp => `
            <span class="row g6" style="font-size:12.5px">
              <span class="trunc">${esc(pp.name)}</span>
              <span class="t11 fnt" style="flex:none">${(pp.__flow.order || []).includes(d.id) ? '적재' : '조회 전용'}</span>
              <button class="lnk" data-dkp="${esc(pp.id)}" style="flex:none;font-size:12px">열기 →</button>
            </span>`).join('')}
        </div>` : ''}
      </div>`);

      const ta = $('#dkDesc', box);
      if (ta) ta.oninput = (ev) => {
        const v = ev.target.value;
        if (v === (d.desc || '')) {
          if (S.__dirty) delete S.__dirty[d.id];
        } else {
          S.__dirty = S.__dirty || {};
          S.__dirty[d.id] = { desc: v };
        }
        linMarkDirtyUI(d.id);
      };
      $$('[data-dkp]', box).forEach(x => x.onclick = () => {
        openPipeTab(x.dataset.dkp); go('pipeline');
      });
      b.appendChild(box);

    } else if (dt === 'sql' || dt === 'quality') {
      S.mTab = dt === 'sql' ? 'SQL' : '품질 규칙';
      b.style.cssText = 'padding:0;display:flex;flex-direction:column;min-height:0';
      const box = el('<div class="def f1" style="min-height:0"><div class="def-in"><div class="def-b"></div></div></div>');
      mpBody($('.def-b', box), { id: d.id, ref: d }, d);
      if (dt === 'quality') wireToggles(box);   // 프로토타입 토글을 실서버로
      b.appendChild(box);

    } else if (dt === 'preview') {
      if (d.__prevError) {
        b.appendChild(el(`<div class="empty">${ic('db')}<span class="empty-t">미리보기를 불러오지 못했습니다.</span>
          <span>${esc(d.__prevError)}</span></div>`));
      } else if (!d.__prevLoaded) {
        b.appendChild(el(`<div class="empty">${ic('clock')}<span class="empty-t">데이터를 읽는 중입니다…</span>
          <span>웨어하우스 조회라 15초쯤 걸립니다.</span></div>`));
        loadPreview(d, () => { if (S.dockTab === 'preview') render(); });
      } else if (!d.prev.length) {
        b.appendChild(el(`<div class="empty">${ic('db')}<span class="empty-t">표시할 행이 없습니다.</span></div>`));
      } else {
        const t = el(`<div class="tbl" style="--cols:${d.cols.map(() => 'minmax(110px,1fr)').join(' ')};border:1px solid var(--line);border-radius:6px;overflow:hidden"></div>`);
        t.appendChild(el(`<div class="th">${d.cols.map(c => `<span>${esc(c[1])}</span>`).join('')}</div>`));
        d.prev.forEach(row => t.appendChild(el(`<div class="tr static" style="min-height:34px">${
          row.map(v => `<span class="mono t12 trunc">${esc(v)}</span>`).join('')}</div>`)));
        b.appendChild(t);
      }

    } else {   // hist — 변경 이력은 메타스토어가 원천이다 (저장할 때 자동 기록)
      b.appendChild(el(`<div class="col g8" id="histBox" style="max-width:880px"><span class="t12 fnt">변경 이력을 불러오는 중…</span></div>`));
      api(`/models/${enc(d.id)}/history`).then(r => {
        const box = $('#histBox', w); if (!box) return;
        box.innerHTML = '';
        if (!r.items.length) {
          box.appendChild(el(`<span class="t12 fnt">${esc(r.message || '변경 이력이 없습니다.')}</span>`));
          return;
        }
        r.items.forEach(it => {
          const card = el(`<div class="col g4" style="border:1px solid var(--line-2);border-radius:8px;padding:9px 12px;background:var(--surface)">
            <span class="t11 fnt mono">${esc(shortTime(it.when))}</span></div>`);
          (it.entries || []).forEach(en => {
            const ba = (en.before !== undefined || en.after !== undefined)
              ? `<span class="t12" style="min-width:0;word-break:break-all">${en.before !== undefined && en.before !== '' ? `<span class="fnt">${esc(String(en.before))}</span> <span class="fnt">→</span> ` : ''}${esc(String(en.after ?? ''))}</span>`
              : '';
            card.appendChild(el(`<div class="row g6" style="align-items:baseline;flex-wrap:wrap">
              <span class="tag" style="flex:none">${esc(en.item)}${en.change ? ' · ' + esc(en.change) : ''}</span>${ba}</div>`));
            if (en.diff) card.appendChild(el(`<pre class="code" style="margin:0;white-space:pre-wrap;max-height:240px;overflow:auto">${esc(en.diff)}</pre>`));
          });
          box.appendChild(card);
        });
      }).catch(e => { const box = $('#histBox', w); if (box) box.textContent = e.message; });
    }

    $$('[data-dt]', w).forEach(x => x.onclick = () => {
      S.dockTab = x.dataset.dt; S.dockMin = false;
      // SQL·품질은 본문이 길다 — 접힌 높이로 열면 안 보이는 것과 같다
      if ((S.dockTab === 'sql' || S.dockTab === 'quality') && (S.dockH || 0) < 340) S.dockH = dockDefH();
      render();
    });
    $('#dockTgl', w).onclick = () => { S.dockMin = !S.dockMin; render(); };
    return w;
  }


  /* ============================================================
     v5.7 — 데이터 모델 페이지 헤더 통합 + 저장 + 자동 이력
     ------------------------------------------------------------
     · 캔버스가 갖고 있던 제목·개수·보기(모델/컬럼) 줄을 페이지 헤더로 흡수.
     · SQL 검사는 SQL 탭 안으로(헤더에서 제거), 변경사항 기록(수동 git)은
       삭제 — 저장할 때마다 서버가 변경 이력을 자동 기록한다.
     · 저장은 변경이 있을 때만 활성. 지금 헤더 저장이 확정하는 것은
       설명 편집이다(SQL·규칙은 각자의 편집기가 저장하며 똑같이 이력에 남는다).
     ============================================================ */
  S.__dirty = S.__dirty || {};

  function linMarkDirtyUI(id) {
    const dirty = !!S.__dirty[id] && id === S.sel;
    const sb = $('#mSaveAll');
    if (sb) {
      sb.disabled = !dirty;
      sb.title = dirty ? '변경한 내용을 저장합니다. 저장하면 변경 이력이 자동 기록됩니다.'
                       : '변경사항이 없습니다.';
    }
    const t = $('.dock-h [data-dt="info"]');
    if (t) t.classList.toggle('dirty', !!S.__dirty[id]);
    const nm = $(`.lin-node[data-lid="${CSS.escape(id)}"] .lin-n`);
    if (nm) nm.classList.toggle('dirty', !!S.__dirty[id]);
  }

  

  /* ============================================================
     v5.9 — 파이프라인 삭제 (실행 설정 탭)
     ------------------------------------------------------------
     지우는 것은 실행 단위뿐이다: 정의(메타스토어)·DAG 파일·예약/트리거.
     모델과 적재된 데이터는 그대로 남는다 — 데이터 정의는 dbt 소유라서다.
     이 파이프라인을 선행으로 쓰던 후행은 서버가 독립 실행으로 되돌린다.
     ============================================================ */
  async function deletePipeline(pp) {
    const deps = PIPES.filter(x => x.id !== pp.id && x.upstreamId === pp.id);
    const ok = await confirmModal({
      title: '파이프라인 삭제', tone: 'warn', danger: true, ok: '삭제',
      body: `${esc(pp.name)} 파이프라인을 삭제합니다. 데이터 모델과 적재된 데이터는 남습니다.`
        + (deps.length ? `<br>후행 <b>${deps.map(x => esc(x.name)).join(' · ')}</b> 은(는) 독립 실행으로 전환됩니다.` : ''),
    });
    if (!ok) return;
    try {
      const res2 = await api('/pipelines/' + enc(pp.id), { method: 'DELETE' });
      closePipeTab(pp.id);
      PF.data = null; S.pdagSel = null;
      toast(`${pp.name} 파이프라인을 삭제했습니다.`
        + ((res2.detached || []).length ? ` — ${res2.detached.join(' · ')} 은(는) 독립 실행으로 전환.` : ''));
      await boot({ keep: true });
      render();
    } catch (e) { fail(e); }
  }

  /* 실행 설정 푸터 — 설정 저장 옆에 삭제 버튼 하나 */
  pipeCfg = (function (base) {
    return function (pp, r) {
      const w = base(pp, r);
      if (!R().canPipeEdit || $('#pcDel', w)) return w;
      const foot = $('#pcOk', w) && $('#pcOk', w).parentElement;
      const b = el(`<button class="btn dngr" id="pcDel" title="파이프라인을 삭제합니다. 모델과 데이터는 남습니다.">${ic14('x')}삭제</button>`);
      b.onclick = () => deletePipeline(pp);
      if (foot) foot.insertBefore(b, $('#pcOk', w).nextSibling);
      else w.appendChild(b);
      return w;
    };
  })(pipeCfg);


  /* ============================================================
     v6.0 — 파이프라인 사이드바 (실행 예정 순 + Pause/Unpause)
     ------------------------------------------------------------
     Airflow 의 DAG 목록에 해당한다. 다음 실행이 임박한 순서로 세워 두고,
     각 줄에서 바로 예약을 끄고 켤 수 있게 한다.

     다음 실행 시각은 Airflow 가 계산한 next_dagrun_run_after 를 그대로 쓴다
     (cron·타임존·catchup 을 다시 구현하지 않는다). 예약이 아닌 트리거
     (수동·선행 완료 후·데이터 이벤트)는 예정 시각이 없으므로 트리거 이름을
     대신 보여주고 목록 아래쪽으로 보낸다.
     ============================================================ */
  S.pipeSideOpen = S.pipeSideOpen !== false;


  /* 예정 시각 표기 — 가까울수록 상대 시간이 읽기 쉽다 */
  function nextRunLabel(iso) {
    if (!iso) return null;
    const t = new Date(iso).getTime();
    if (!t) return null;
    const diff = t - Date.now();
    if (diff < 0) return '곧 실행';
    const m = Math.round(diff / 60000);
    if (m < 60) return `${m}분 후`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}시간 후`;
    return `${Math.round(h / 24)}일 후`;
  }

  const TRIG_LABEL = { manual: '수동 실행', upstream: '선행 완료 후',
                       data_event: '데이터 이벤트', schedule: '예약' };

  /* 정렬 — 예정 시각 있는 것부터 이른 순, 없는 것(비예약)은 뒤로 */
  function pipesByNextRun() {
    return PIPES.slice().sort((a, b) => {
      const ta = a.nextRun ? new Date(a.nextRun).getTime() : Infinity;
      const tb = b.nextRun ? new Date(b.nextRun).getTime() : Infinity;
      return (ta - tb) || a.name.localeCompare(b.name);
    });
  }

  function pipeSidebar() {
    const open = S.pipeSideOpen;
    const aside = el(`<aside class="mod-l ${open ? '' : 'closed'}" style="${open ? `width:${S.leftW}px` : ''}">
      <div class="mod-l-head"><span class="b6 t13">파이프라인</span>
        <button class="iconbtn sp" id="plTgl" title="${open ? '목록 접기' : '목록 펼치기'}">
          ${ic14(open ? 'chevl' : 'menu')}</button></div>
      <div class="mod-l-body f1 col" style="min-height:0">
        <div class="t11 fnt" style="padding:8px 12px 4px">실행 예정 순</div>
        <div class="f1 col g4" style="overflow:auto;padding:0 8px 8px" id="plList"></div>
      </div></aside>`);
    $('#plTgl', aside).onclick = () => { S.pipeSideOpen = !S.pipeSideOpen; render(); };
    if (!open) return aside;

    const host = $('#plList', aside);
    const list = pipesByNextRun();
    if (!list.length) {
      host.appendChild(el('<div class="t11 fnt" style="padding:16px 6px;text-align:center">등록된 파이프라인이 없습니다.</div>'));
      return aside;
    }

    list.forEach(pp => {
      const nx = nextRunLabel(pp.nextRun);
      const sub = pp.paused ? '예약 꺼짐'
        : nx ? nx
        : (TRIG_LABEL[pp.trigger] || pp.freq || '수동 실행');
      const row = el(`<div class="lp ${pp.id === S.openPipe ? 'on' : ''}" data-plp="${esc(pp.id)}"
          title="${esc(pp.name)}\n${pp.nextRun ? '다음 실행 ' + esc(shortTime(pp.nextRun)) : (TRIG_LABEL[pp.trigger] || '')}">
        <span class="col f1" style="gap:2px;min-width:0">
          <span class="t12 b6 trunc">${esc(pp.name)}</span>
          <span class="t11 fnt trunc">${esc(sub)} · 모델 ${pp.__flow ? (pp.__flow.order || []).length : 0}개</span></span>
        ${pipeBadge(pp.status)}
        ${pp.paused == null || !R().canPipeEdit ? ''
          : `<span class="tgl ${pp.paused ? '' : 'on'}" data-pz="${esc(pp.id)}"
               title="${pp.paused ? '예약 실행 켜기' : '예약 실행 끄기'}"><i></i></span>`}
      </div>`);

      row.onclick = (ev) => {
        if (ev.target.closest('[data-pz]')) return;
        openPipeTab(pp.id);
      };

      const tg = $('[data-pz]', row);
      if (tg) tg.onclick = async (ev) => {
        ev.stopPropagation();
        const next = !pp.paused;
        tg.classList.toggle('on', !next);          // 낙관적 반영 — 실패하면 boot 가 되돌린다
        try {
          const r2 = await api(`/pipelines/${enc(pp.id)}/paused`, {
            method: 'PATCH', body: JSON.stringify({ paused: next }),
          });
          pp.paused = r2.paused;
          toast(next ? `${pp.name} 예약 실행을 껐습니다.`
                     : `${pp.name} 예약 실행을 켰습니다.`);
          PF.data = null;
          await boot({ keep: true });
          render();
        } catch (e) { fail(e); await boot({ keep: true }); render(); }
      };
      host.appendChild(row);
    });
    return aside;
  }

  /* ── 데이터 파이프라인 화면 (12겹 → 1) ────────────────────────────────
     사이드바(전체 높이) 옆에 탭 스트립을 얹고, 탭이 파이프라인 흐름 이면
     DAG 화면, 아니면 그 파이프라인의 실행 흐름 · 실행 설정 · 이력 이다.

     접으면서 확인한 무효 층들:
     · 왼쪽 파이프라인 목록(#pList)과 워크스페이스 묶음 필터 — v5.4 탭 화면이
       매번 통째로 걷어냈다. 목록은 pipeSidebar 하나뿐이다.
     · 예약 스위치를 그 목록 행에 달던 층 — 같은 이유로 버려졌다.
       살아있는 스위치는 pipeSidebar 의 data-pz 다.
     · 구성(build) 뷰 — Task 의존성은 데이터 모델이 정하므로 여기서 고칠 수 없다.
       세그먼트 버튼도 진입점(#pcGo)도 뒤 층이 지우고 있었다.
     · 흐름 위의 규칙 안내 줄(.ro) — 만들자마자 뒤 층이 지웠다. 아예 만들지 않는다. */
  function pagePipeline() {
    if (!PIPES.length) {
      const p0 = el('<div class="page"></div>');
      p0.appendChild(el(`<div class="card"><div class="empty" style="padding:44px 20px">${ic('pipe')}
        <span class="empty-t">아직 등록된 파이프라인이 없습니다.</span></div></div>`));
      return p0;
    }

    S.openPipes = S.openPipes.filter(pid => PIPES.some(x => x.id === pid));
    if (S.openPipe !== 'deps' && !S.openPipes.includes(S.openPipe)) S.openPipe = 'deps';

    const page = el('<div class="page flush" style="display:flex;flex-direction:column;min-height:0"></div>');
    const strip = pipeTabStrip();
    const inner = el('<div class="f1 col" style="min-height:0"></div>');

    if (S.openPipe === 'deps') inner.appendChild(pdagView());
    else inner.appendChild(pipeTabBody());

    // 사이드바가 전체 높이를 차지하고, 탭 스트립은 오른쪽 영역의 맨 위에 온다.
    const row = el('<div class="mod f1" style="min-height:0"></div>');
    row.appendChild(pipeSidebar());
    const body = el('<div class="mod-c f1" style="min-width:0;min-height:0"></div>');
    body.appendChild(strip);
    body.appendChild(inner);
    row.appendChild(body);
    page.appendChild(row);
    return page;
  }

  /* 파이프라인 탭 하나의 본문 */
  function pipeTabBody() {
    const r = R();
    if (S.pipeView === 'build') S.pipeView = 'flow';     // 없앤 뷰가 상태에 남아 있을 때
    S.pipe = S.openPipe;                                 // 탭이 곧 선택이다
    const pp = PIPES.find(x => x.id === S.pipe);
    const g = pgraph(pp), runs = runsG(pp);

    /* 고른 카드 정리 — 실행 흐름에서는 SOURCE 를 고를 수 없고,
       고른 것이 없으면 실패한 카드를 대신 펴 준다. */
    if (S.pipeView === 'flow' && S.pipeNodeK) {
      const n = nodeOf(g, S.pipeNodeK);
      if (n && (byId(n.id) || {}).kind === 'source') S.pipeNodeK = null;
    }
    if (!S.pipeNodeK || !nodeOf(g, S.pipeNodeK)) {
      const bad = Object.entries(runs).find(([, v]) => v.st === 'err');
      S.pipeNodeK = bad ? bad[0] : null;
    }

    const center = el('<div class="mod-c"></div>');
    const lab = barBudget() >= 620;
    const SEG = [['flow', 'pipe', '실행 흐름', '실행 흐름'],
                 ['cfg', 'set', '실행 설정', '실행 설정'],
                 ['history', 'clock', '이력', 'dbt 실행 이력과 모델별 소요 통계입니다.']];
    center.appendChild(el(`<div class="mod-bar">
      <span class="row g8" style="padding-left:14px;min-width:0;flex:1 1 auto;overflow:hidden"
        title="${esc(pp.freq)} · 최근 실행 ${esc(pp.last)} (${esc(pp.dur)})">
        <span class="b6 t15 trunc" style="min-width:0">${esc(pp.name)}</span>${pipeBadge(pp.status)}
        ${barBudget() >= 820 ? `<span class="t12 fnt trunc" style="min-width:0">${esc(pp.freq)} · 최근 ${esc(pp.last)}</span>` : ''}</span>
      <div class="row g6 sp" style="flex:none">
        <span class="seg">${SEG.map(([k, ic0, l, tip]) =>
          `<button class="${S.pipeView === k ? 'on' : ''}" data-pv="${k}" title="${esc(tip)}">${ic14(ic0)}${lab ? l : ''}</button>`).join('')}</span>
        ${r.canPipeEdit ? `<button class="btn pri sm" id="pdRunAll">${ic14(pp.status === 'err' ? 'rot' : 'play')}${lab ? '전체 실행' : ''}</button>` : ''}
      </div></div>`));

    if (S.pipeView === 'history') center.appendChild(historyView());
    else if (S.pipeView === 'cfg') center.appendChild(pipeCfg(pp, r));
    else {
      const stage = el('<div class="col" style="flex:1 1 0;min-height:120px;overflow:hidden"></div>');
      stage.appendChild(pipeCanvas(pp, false));
      center.appendChild(stage);
      center.appendChild(pipeDock(pp));
    }

    $$('[data-pv]', center).forEach(b => b.onclick = () => {
      S.pipeView = b.dataset.pv;
      if (b.dataset.pv !== 'history') S.pipeScroll = null;   // 이력에는 캔버스가 없다
      render();
    });
    const ra = $('#pdRunAll', center); if (ra) ra.onclick = () => rerunG(pp, null);
    return center;
  }



  /* ============================================================
     v6.1 — 데이터 수집
     ------------------------------------------------------------
     바깥 데이터를 raw 로 들이는 화면이다. 여기서 하는 일은 «가져와서 그대로
     넣기» 하나뿐이고, 컬럼을 고르거나 값을 바꾸는 기능은 두지 않는다 —
     정제는 데이터 모델(dbt)의 일이라 두 군데로 갈라지면 계보가 끊긴다.

     화면 구조는 데이터 파이프라인과 같다. 왼쪽에 전체 높이 사이드바(실행
     예정 순), 오른쪽에 탭 + 내용. 수집 작업끼리는 의존 관계가 없어서 기본
     화면은 관계도가 아니라 목록이다.

     적재가 끝나면 그 원천의 Asset 이벤트가 나가고, 그 원천을 쓰는
     파이프라인이 데이터 이벤트 트리거로 이어서 돈다. 화면이 따로 시킬 것이
     없다 — 수집 DAG 의 outlets 에 선언돼 있다.
     ============================================================ */
  const ING = [];                         // 수집 작업 목록
  S.openIngs = S.openIngs || [];          // 열린 작업 탭
  S.openIng = S.openIng || 'list';        // 'list' | 작업 id
  S.ingSideOpen = S.ingSideOpen !== false;

  const ING_KIND = { api: 'API 연동', file: '파일 올리기' };
  const ING_MODE = { append: '덧붙이기', overwrite: '전체 교체' };

  MENUS.splice(1, 0, { id: 'ingest', label: '데이터 수집', icon: 'down' });
  if (!CAPS.menus.includes('ingest')) CAPS.menus.splice(1, 0, 'ingest');

  async function loadIngest() {
    try {
      const r = await api('/ingest/jobs');
      ING.splice(0, ING.length, ...(r.items || []));
    } catch (e) { console.warn('[Data Mates] 수집 목록을 불러오지 못했습니다.', e); }
  }

  const ingById = (id) => ING.find(j => j.id === id);

  /* 정렬 — 파이프라인 사이드바와 같은 규칙(예정 시각 이른 순, 비예약은 뒤로) */
  function ingsByNextRun() {
    return ING.slice().sort((a, b) => {
      const ta = a.nextRun ? new Date(a.nextRun).getTime() : Infinity;
      const tb = b.nextRun ? new Date(b.nextRun).getTime() : Infinity;
      return (ta - tb) || a.name.localeCompare(b.name);
    });
  }

  function ingSub(j) {
    if (j.kind === 'file') return '파일 올릴 때 적재';
    if (j.paused) return '예약 꺼짐';
    return nextRunLabel(j.nextRun) || j.freq || '수동 실행';
  }

  /* ---------------------------------------------------------- 파일 업로드 */

  /* api() 는 Content-Type 을 JSON 으로 고정한다. multipart 는 브라우저가
     경계 문자열까지 붙여야 해서 헤더를 아예 주면 안 된다. */
  async function apiForm(path, form) {
    const res = await fetch(BASE + path, { method: 'POST', body: form });
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch (e) { body = text; }
    if (!res.ok) {
      const err = new Error((body && body.message) || `요청이 실패했습니다 (HTTP ${res.status})`);
      err.code = body && body.code; err.detail = (body && body.details) || null;
      throw err;
    }
    return body;
  }

  function pickFile(accept) {
    return new Promise(resolve => {
      const inp = el(`<input type="file" accept="${accept}" style="display:none">`);
      inp.onchange = () => { resolve(inp.files[0] || null); inp.remove(); };
      document.body.appendChild(inp);
      inp.click();
    });
  }

  /* ---------------------------------------------------------- 탭 */

  function openIngTab(jid) {
    if (!ingById(jid)) return;
    if (!S.openIngs.includes(jid)) S.openIngs.push(jid);
    S.openIng = jid;
    render();
  }

  function closeIngTab(jid) {
    const i = S.openIngs.indexOf(jid);
    if (i >= 0) S.openIngs.splice(i, 1);
    if (S.openIng === jid) S.openIng = S.openIngs[i] || S.openIngs[i - 1] || 'list';
    render();
  }

  function ingTabStrip() {
    const strip = el('<div class="ptabs"></div>');
    const l = el(`<button class="tab ${S.openIng === 'list' ? 'on' : ''}" style="height:45px">
      ${ic14('down')}수집 현황</button>`);
    l.onclick = () => { S.openIng = 'list'; render(); };
    strip.appendChild(l);
    S.openIngs.forEach(jid => {
      const j = ingById(jid);
      if (!j) return;
      const t = el(`<button class="tab ${S.openIng === jid ? 'on' : ''}" style="height:45px">
        ${ic14(j.kind === 'file' ? 'doc' : 'link')}<span class="trunc" style="max-width:160px">${esc(j.name)}</span>
        <span class="ptab-x" title="탭 닫기">${ic14('x')}</span></button>`);
      t.onclick = (ev) => {
        if (ev.target.closest('.ptab-x')) { closeIngTab(jid); return; }
        S.openIng = jid; render();
      };
      strip.appendChild(t);
    });
    return strip;
  }

  /* ---------------------------------------------------------- 사이드바 */

  function ingSidebar() {
    const open = S.ingSideOpen;
    const list = ingsByNextRun();
    // 비어 있으면 라벨도 만들기 버튼도 내린다 — 빈 화면 쪽 안내 하나로 충분하다.
    const aside = el(`<aside class="mod-l ${open ? '' : 'closed'}" style="${open ? `width:${S.leftW}px` : ''}">
      <div class="mod-l-head"><span class="b6 t13">수집 작업</span>
        <button class="iconbtn sp" id="igTgl" title="${open ? '목록 접기' : '목록 펼치기'}">
          ${ic14(open ? 'chevl' : 'menu')}</button></div>
      <div class="mod-l-body f1 col" style="min-height:0">
        ${list.length ? '<div class="t11 fnt">실행 예정 순</div>' : ''}
        <div class="f1 col g4" style="overflow:auto;padding:0 8px 8px" id="igList"></div>
        ${list.length ? `<div style="padding:8px 12px 12px;border-top:1px solid var(--line-2)">
          <button class="btn pri" id="igNew" style="width:100%;justify-content:center">${ic14('plus')}수집 만들기</button></div>` : ''}
      </div></aside>`);
    $('#igTgl', aside).onclick = () => { S.ingSideOpen = !S.ingSideOpen; render(); };
    if (!open) return aside;
    if (list.length) $('#igNew', aside).onclick = () => ingestModal(null);

    const host = $('#igList', aside);
    if (!list.length) {
      host.appendChild(el(`<div class="t11 fnt" style="padding:16px 6px;text-align:center">
        등록된 수집 작업이 없습니다.</div>`));
      return aside;
    }
    list.forEach(j => {
      const row = el(`<div class="lp ${j.id === S.openIng ? 'on' : ''}"
          title="${esc(j.name)}\n${esc(j.phys)}">
        <span class="col f1" style="gap:2px;min-width:0">
          <span class="t12 b6 trunc">${esc(j.name)}</span>
          <span class="t11 fnt trunc">${esc(ingSub(j))} · ${esc(j.phys)}</span></span>
        ${j.paused == null ? ''
          : `<span class="tgl ${j.paused ? '' : 'on'}" data-iz="${esc(j.id)}"
               title="${j.paused ? '예약 실행 켜기' : '예약 실행 끄기'}"><i></i></span>`}
      </div>`);
      row.onclick = (ev) => { if (!ev.target.closest('[data-iz]')) openIngTab(j.id); };
      const tg = $('[data-iz]', row);
      if (tg) tg.onclick = async (ev) => {
        ev.stopPropagation();
        const next = !j.paused;
        tg.classList.toggle('on', !next);            // 낙관적 반영 — 실패하면 되돌린다
        try {
          const r = await api(`/ingest/jobs/${enc(j.id)}/paused`, {
            method: 'PATCH', body: JSON.stringify({ paused: next }) });
          j.paused = r.paused;
          toast(next ? `${j.name} 예약 실행을 껐습니다.` : `${j.name} 예약 실행을 켰습니다.`);
        } catch (e) { fail(e); }
        await loadIngest(); render();
      };
      host.appendChild(row);
    });
    return aside;
  }

  /* ---------------------------------------------------------- 목록 화면 */

  function ingListView() {
    const wrap = el(`<div class="f1 col" style="min-height:0;overflow:auto;background:#FAFBFC">
      <div class="col g14" style="padding:18px 20px 24px"></div></div>`);
    const body = $('.col', wrap);

    if (!ING.length) {
      body.appendChild(el(`<div class="card" style="align-items:center;padding:44px 20px;gap:12px">
        <span style="color:var(--faint)">${ic('down')}</span>
        <div class="t13 b6">아직 수집 작업이 없습니다.</div>
        <div class="t12 fnt" style="text-align:center;line-height:1.6">
          API 나 파일에서 데이터를 가져와 <b>원천 테이블</b>로 만듭니다.<br>
          가공은 하지 않습니다 — 원본 그대로 넣고, 정제는 데이터 모델이 맡습니다.</div>
        <button class="btn pri" id="igNew2" style="margin-top:6px">${ic14('plus')}수집 만들기</button>
      </div>`));
      $('#igNew2', body).onclick = () => ingestModal(null);
      return wrap;
    }

    const grid = el(`<div style="display:grid;gap:12px;
      grid-template-columns:repeat(auto-fill,minmax(320px,1fr))"></div>`);
    ingsByNextRun().forEach(j => {
      const c = el(`<div class="card" style="cursor:pointer">
        <div class="card-h">
          <span style="color:var(--pri)">${ic14(j.kind === 'file' ? 'doc' : 'link')}</span>
          <span class="card-t trunc f1">${esc(j.name)}</span>
          <span class="bdg ${j.paused ? 'wait' : 'pri'}">${esc(ING_KIND[j.kind] || j.kind)}</span>
        </div>
        <div class="card-b col g10">
          <div class="row g6"><span class="t11 fnt" style="width:64px">적재 대상</span>
            <span class="t12 mono b6 trunc">${esc(j.phys)}</span></div>
          <div class="row g6"><span class="t11 fnt" style="width:64px">적재 방식</span>
            <span class="t12">${esc(ING_MODE[j.mode] || j.mode)} · 컬럼 ${(j.columns || []).length}개</span></div>
          <div class="row g6"><span class="t11 fnt" style="width:64px">실행</span>
            <span class="t12">${esc(ingSub(j))}</span></div>
        </div></div>`);
      c.onclick = () => openIngTab(j.id);
      grid.appendChild(c);
    });
    body.appendChild(grid);
    return wrap;
  }

  /* ---------------------------------------------------------- 작업 상세 */

  async function ingRunNow(j) {
    try {
      if (j.kind === 'file') {
        const f = await pickFile('.csv,.json,.jsonl,.txt');
        if (!f) return;
        const fd = new FormData(); fd.append('file', f);
        const r = await apiForm(`/ingest/jobs/${enc(j.id)}/upload`, fd);
        toast(r.rows ? `${r.rows}건을 ${r.table} 에 적재했습니다.`
                     : '가져온 행이 없어 적재하지 않았습니다.');
      } else {
        await api(`/ingest/jobs/${enc(j.id)}/runs`, { method: 'POST' });
        toast(`${j.name} 실행을 시작했습니다.`);
      }
      await loadIngest();
      await boot({ keep: true });          // 새 원천이 카탈로그에 나타난다
      render();
    } catch (e) { fail(e); }
  }

  async function ingDelete(j) {
    const ok = await confirmModal({
      title: '수집 작업 삭제',
      body: `${j.name} 을(를) 지웁니다. 이미 적재된 ${j.phys} 테이블은 그대로 남습니다.`,
      ok: '삭제', danger: true, tone: 'warn',
    });
    if (!ok) return;
    try {
      await api(`/ingest/jobs/${enc(j.id)}`, { method: 'DELETE' });
      closeIngTab(j.id);
      toast(`${j.name} 을(를) 삭제했습니다.`);
      await loadIngest();
      await boot({ keep: true });
      render();
    } catch (e) { fail(e); }
  }

  function ingDetailView(j) {
    const wrap = el(`<div class="f1 col" style="min-height:0">
      <div class="mod-bar row g6" style="padding:0 14px">
        <span style="color:var(--pri)">${ic14(j.kind === 'file' ? 'doc' : 'link')}</span>
        <span class="t13 b6 trunc">${esc(j.name)}</span>
        <span class="bdg ${j.paused ? 'wait' : 'pri'}">${esc(ING_KIND[j.kind] || j.kind)}</span>
        <span class="sp"></span>
        <button class="btn sm" id="igRun">${ic14(j.kind === 'file' ? 'save' : 'play')}${j.kind === 'file' ? '파일 올리기' : '지금 실행'}</button>
        <button class="btn sm" id="igEdit">${ic14('pen')}수정</button>
        <button class="iconbtn" id="igDel" title="수집 작업 삭제">${ic14('x')}</button>
      </div>
      <div class="f1 col" style="min-height:0;overflow:auto;background:#FAFBFC">
        <div class="col g14" style="padding:16px 18px 24px"></div></div></div>`);
    const body = $('.col.g14', wrap);
    $('#igRun', wrap).onclick = () => ingRunNow(j);
    $('#igEdit', wrap).onclick = () => ingestModal(j);
    $('#igDel', wrap).onclick = () => ingDelete(j);

    const cfg = j.config || {};
    const rows = j.kind === 'api'
      ? [['요청 주소', `${cfg.method || 'GET'} ${cfg.url || ''}`],
         ['레코드 경로', cfg.record_path || '(응답 전체)'],
         ['인증', ({ bearer: 'Bearer 토큰', header: '헤더 키' })[(cfg.auth || {}).kind] || '없음']]
      : [['파일 형식', cfg.format === 'csv' ? 'CSV' : 'JSON Lines'],
         ['구분자', cfg.format === 'csv' ? (cfg.delimiter || ',') : '—']];

    body.appendChild(el(`<div class="card">
      <div class="card-h"><span class="card-t">수집 설정</span></div>
      <div class="card-b col g10">
        ${rows.map(([k, v]) => `<div class="row g10">
          <span class="t11 fnt" style="width:92px;flex:none">${esc(k)}</span>
          <span class="t12 mono trunc">${esc(v)}</span></div>`).join('')}
        <div class="row g10"><span class="t11 fnt" style="width:92px;flex:none">적재 대상</span>
          <span class="t12 mono b6">${esc(j.phys)}</span></div>
        <div class="row g10"><span class="t11 fnt" style="width:92px;flex:none">적재 방식</span>
          <span class="t12">${esc(ING_MODE[j.mode] || j.mode)}</span></div>
        <div class="row g10"><span class="t11 fnt" style="width:92px;flex:none">실행</span>
          <span class="t12">${esc(ingSub(j))}</span></div>
      </div></div>`));

    const cols = j.columns || [];
    body.appendChild(el(`<div class="card">
      <div class="card-h"><span class="card-t">적재 컬럼</span>
        <span class="t11 fnt sp">${cols.length}개 · 모두 문자열로 넣습니다</span></div>
      <div class="card-b">
        <div class="row g6" style="flex-wrap:wrap">
          ${cols.map(c => `<span class="tag mono">${esc(c.name)}</span>`).join('') || '<span class="t12 fnt">없음</span>'}
        </div>
        <div class="t11 fnt" style="margin-top:10px;line-height:1.6">
          타입을 정하고 값을 다듬는 일은 데이터 모델이 맡습니다.
          수집은 원본을 그대로 넣어 언제든 다시 해석할 수 있게 둡니다.</div>
      </div></div>`));

    const hist = el(`<div class="card">
      <div class="card-h"><span class="card-t">실행 이력</span></div>
      <div class="card-b" id="igHist"><div class="t12 fnt">불러오는 중…</div></div></div>`);
    body.appendChild(hist);

    if (j.kind === 'file') {
      $('#igHist', hist).innerHTML =
        '<div class="t12 fnt">파일 수집은 파일을 올릴 때 그 자리에서 적재합니다. 예약 실행 이력이 없습니다.</div>';
    } else {
      api(`/ingest/jobs/${enc(j.id)}/runs?limit=15`).then(r => {
        const host = $('#igHist', hist);
        if (!host) return;
        const items = r.items || [];
        if (!items.length) { host.innerHTML = '<div class="t12 fnt">아직 실행한 적이 없습니다.</div>'; return; }
        host.innerHTML = `<div class="tbl" style="--cols:1fr 100px 150px 150px">
          <div class="th"><span>실행</span><span>상태</span><span>시작</span><span>종료</span></div>
          ${items.map(x => `<div class="tr static">
            <span class="c2"><span class="t12 mono trunc">${esc(x.runId || '')}</span>
              <span class="sub">${esc(x.type || '')}</span></span>
            <span>${pipeBadge(x.state === 'success' ? 'ok' : x.state === 'failed' ? 'err'
                              : x.state === 'running' ? 'run' : 'wait')}</span>
            <span class="t12 fnt">${x.start ? esc(shortTime(x.start)) : '—'}</span>
            <span class="t12 fnt">${x.end ? esc(shortTime(x.end)) : '—'}</span></div>`).join('')}</div>`;
      }).catch(() => {
        const host = $('#igHist', hist);
        if (host) host.innerHTML = '<div class="t12 fnt">실행 이력을 불러오지 못했습니다.</div>';
      });
    }
    return wrap;
  }

  /* ---------------------------------------------------------- 등록 · 수정 */

  function ingestModal(job) {
    const edit = !!job;
    const st = {
      kind: edit ? job.kind : 'api',
      cfg: Object.assign({ method: 'GET', format: 'csv', delimiter: ',' },
                         edit ? job.config : {}),
      cols: edit ? (job.columns || []).slice() : [],
      rows: [], file: null,
    };

    const html = () => `<div class="modal-h">
        <span class="modal-t">${edit ? '수집 작업 수정' : '새 수집 작업'}</span>
        <button class="iconbtn sp" data-close>${ic('x')}</button></div>
      <div class="modal-b"><div class="frm">
        <div class="fr"><span class="fr-l">이름</span>
          <input class="inp" id="igN" value="${esc(edit ? job.name : '')}" placeholder="예) 주문 API 수집"></div>

        <div class="fr"><span class="fr-l">가져오는 방법</span>
          <div class="seg" id="igK">
            <button data-k="api" class="${st.kind === 'api' ? 'on' : ''}" ${edit ? 'disabled' : ''}>${ic14('link')}API 연동</button>
            <button data-k="file" class="${st.kind === 'file' ? 'on' : ''}" ${edit ? 'disabled' : ''}>${ic14('doc')}파일 올리기</button>
          </div>
          ${edit ? '<span class="fr-h">가져오는 방법은 바꿀 수 없습니다. 다른 방법이 필요하면 새 작업을 만들어 주세요.</span>' : ''}</div>

        <div id="igApi" style="${st.kind === 'api' ? '' : 'display:none'}">
          <div class="frm">
            <div class="fr"><span class="fr-l">요청 주소</span>
              <div class="row g6">
                <select class="inp" id="igM" style="width:96px;flex:none">
                  ${['GET', 'POST'].map(x => `<option ${st.cfg.method === x ? 'selected' : ''}>${x}</option>`).join('')}</select>
                <input class="inp f1" id="igU" value="${esc(st.cfg.url || '')}" placeholder="https://api.example.com/orders"></div></div>
            <div class="fr"><span class="fr-l">레코드 경로</span>
              <input class="inp" id="igP" value="${esc(st.cfg.record_path || '')}" placeholder="예) data.items">
              <span class="fr-h">응답 안에서 레코드 배열이 있는 위치입니다. 응답 자체가 배열이면 비워 두세요.</span></div>
            <div class="fr"><span class="fr-l">인증</span>
              <div class="row g6">
                <select class="inp" id="igAK" style="width:150px;flex:none">
                  ${[['', '없음'], ['bearer', 'Bearer 토큰'], ['header', '헤더 키']].map(([v, l]) =>
                    `<option value="${v}" ${((st.cfg.auth || {}).kind || '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
                <input class="inp" id="igAN" style="width:150px;flex:none;${((st.cfg.auth || {}).kind) === 'header' ? '' : 'display:none'}"
                  value="${esc((st.cfg.auth || {}).name || '')}" placeholder="헤더 이름">
                <input class="inp f1" id="igAV" type="password" style="${(st.cfg.auth || {}).kind ? '' : 'display:none'}"
                  value="${esc((st.cfg.auth || {}).token || (st.cfg.auth || {}).value || '')}" placeholder="값"></div></div>
          </div></div>

        <div id="igFile" style="${st.kind === 'file' ? '' : 'display:none'}">
          <div class="frm">
            <div class="fr"><span class="fr-l">파일 형식</span>
              <div class="row g6">
                <select class="inp" id="igF" style="width:150px;flex:none">
                  ${[['csv', 'CSV'], ['jsonl', 'JSON Lines']].map(([v, l]) =>
                    `<option value="${v}" ${st.cfg.format === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
                <input class="inp" id="igD" style="width:110px;flex:none;${st.cfg.format === 'csv' ? '' : 'display:none'}"
                  value="${esc(st.cfg.delimiter || ',')}" placeholder="구분자">
                <button class="btn" id="igPick">${ic14('doc')}파일 선택</button>
                <span class="t12 fnt trunc" id="igFn">${st.file ? esc(st.file.name) : '선택한 파일 없음'}</span></div>
              <span class="fr-h">여기서 고른 파일은 컬럼을 확인하는 데만 씁니다. 실제 적재는 저장한 뒤 파일 올리기로 합니다.</span></div>
          </div></div>

        <div class="fr"><span class="fr-l">데이터 확인</span>
          <div class="row g6">
            <button class="btn" id="igPrev">${ic14('eye')}미리보기</button>
            <span class="t12 fnt" id="igPrevMsg">${st.cols.length ? `컬럼 ${st.cols.length}개를 확인했습니다.` : '먼저 데이터를 한 번 가져와 컬럼을 확인합니다.'}</span></div>
          <div id="igPrevOut" style="margin-top:8px"></div></div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div class="fr"><span class="fr-l">적재 대상 테이블</span>
            <div class="row g4"><span class="t12 fnt mono" style="flex:none">raw.</span>
              <input class="inp f1" id="igT" value="${esc(edit ? job.target : '')}" placeholder="raw_orders"></div>
            <span class="fr-h">소문자·숫자·밑줄만 씁니다. 이 이름으로 원천 테이블이 생깁니다.</span></div>
          <div class="fr"><span class="fr-l">적재 방식</span>
            <select class="inp" id="igMo">
              ${[['append', '덧붙이기 — 가져온 만큼 뒤에 쌓습니다'],
                 ['overwrite', '전체 교체 — 기존 데이터를 지우고 새로 넣습니다']].map(([v, l]) =>
                `<option value="${v}" ${(edit ? job.mode : 'append') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        </div>

        <div id="igSch" style="${st.kind === 'api' ? '' : 'display:none'}">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div class="fr"><span class="fr-l">실행 방식</span>
              <select class="inp" id="igTg">
                <option value="schedule" ${(edit ? job.trigger_type : 'schedule') === 'schedule' ? 'selected' : ''}>예약 실행</option>
                <option value="manual" ${(edit ? job.trigger_type : '') === 'manual' ? 'selected' : ''}>수동 실행</option></select></div>
            <div class="fr" id="igFw"><span class="fr-l">실행 일정</span>
              <select class="inp" id="igFq">
                ${FREQS.filter(f => f !== '수동 실행').map(f =>
                  `<option ${(edit ? job.freq : '') === f ? 'selected' : ''}>${f}</option>`).join('')}</select></div>
          </div></div>

        <div class="note info">${ic14('info')}<span>가져온 값은 <b>원본 그대로</b> 넣습니다.
          타입을 정하고 값을 다듬는 일은 <b>데이터 모델</b>에서 합니다 —
          그래야 나중에 해석을 바꿔도 원본이 남아 있습니다.</span></div>
      </div></div>
      <div class="modal-f"><button class="btn sp" data-close>취소</button>
        <button class="btn pri" id="igOk">${ic14(edit ? 'save' : 'plus')}${edit ? '저장' : '만들기'}</button></div>`;

    const { m, close } = modal(html());

    /* --- 입력 연동 --- */
    const show = (sel, on) => { const x = $(sel, m); if (x) x.style.display = on ? '' : 'none'; };

    $$('#igK button', m).forEach(b => b.onclick = () => {
      if (edit) return;
      st.kind = b.dataset.k;
      $$('#igK button', m).forEach(x => x.classList.toggle('on', x === b));
      show('#igApi', st.kind === 'api');
      show('#igFile', st.kind === 'file');
      show('#igSch', st.kind === 'api');
      st.cols = []; st.rows = [];
      $('#igPrevOut', m).innerHTML = '';
      $('#igPrevMsg', m).textContent = '먼저 데이터를 한 번 가져와 컬럼을 확인합니다.';
    });

    $('#igAK', m).onchange = (e) => {
      show('#igAN', e.target.value === 'header');
      show('#igAV', !!e.target.value);
    };
    $('#igF', m).onchange = (e) => show('#igD', e.target.value === 'csv');
    $('#igTg', m).onchange = (e) => show('#igFw', e.target.value === 'schedule');
    show('#igFw', (edit ? job.trigger_type : 'schedule') === 'schedule');

    $('#igPick', m).onclick = async () => {
      const f = await pickFile('.csv,.json,.jsonl,.txt');
      if (!f) return;
      st.file = f;
      $('#igFn', m).textContent = f.name;
    };

    function readCfg() {
      if (st.kind === 'api') {
        const kind = $('#igAK', m).value;
        const cfg = { url: $('#igU', m).value.trim(), method: $('#igM', m).value,
                      record_path: $('#igP', m).value.trim() };
        if (kind === 'bearer') cfg.auth = { kind, token: $('#igAV', m).value };
        else if (kind === 'header') cfg.auth = { kind, name: $('#igAN', m).value, value: $('#igAV', m).value };
        return cfg;
      }
      return { format: $('#igF', m).value, delimiter: $('#igD', m).value || ',' };
    }

    /* --- 미리보기 --- */
    $('#igPrev', m).onclick = async () => {
      const btn = $('#igPrev', m);
      btn.disabled = true;
      $('#igPrevMsg', m).textContent = '가져오는 중…';
      try {
        const cfg = readCfg();
        let r;
        if (st.kind === 'api') {
          r = await api('/ingest/preview', { method: 'POST',
            body: JSON.stringify({ kind: 'api', config: cfg }) });
        } else {
          if (!st.file) throw new Error('먼저 파일을 선택해 주세요.');
          const fd = new FormData(); fd.append('file', st.file);
          r = await apiForm(`/ingest/preview/file?format=${enc(cfg.format)}&delimiter=${enc(cfg.delimiter)}`, fd);
        }
        st.cols = r.columns || []; st.rows = r.rows || [];
        st.cfg = cfg;
        $('#igPrevMsg', m).textContent =
          `컬럼 ${st.cols.length}개 · 표본 ${r.sampled}건을 확인했습니다.`;
        $('#igPrevOut', m).innerHTML = st.rows.length ? `
          <div style="border:1px solid var(--line);border-radius:6px;overflow:auto;max-height:220px">
            <table style="border-collapse:collapse;font-size:11.5px;white-space:nowrap">
              <thead><tr>${st.cols.map(c =>
                `<th style="position:sticky;top:0;background:var(--bg);border-bottom:1px solid var(--line);
                   padding:6px 10px;text-align:left;font-weight:650">${esc(c.name)}</th>`).join('')}</tr></thead>
              <tbody>${st.rows.slice(0, 8).map(row => `<tr>${st.cols.map(c =>
                `<td style="border-bottom:1px solid var(--line-2);padding:5px 10px;max-width:220px;
                   overflow:hidden;text-overflow:ellipsis" class="mono">${esc(fmtCell(row[c.name]))}</td>`).join('')}</tr>`).join('')}
              </tbody></table></div>` : '';
        // 대상 이름을 비워 뒀으면 하나 지어 준다
        const t = $('#igT', m);
        if (!t.value.trim() && st.kind === 'file' && st.file)
          t.value = 'raw_' + st.file.name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9_]/g, '_');
      } catch (e) {
        $('#igPrevMsg', m).textContent = '';
        fail(e);
      } finally { btn.disabled = false; }
    };

    /* --- 저장 --- */
    $('#igOk', m).onclick = async () => {
      const name = $('#igN', m).value.trim();
      const target = $('#igT', m).value.trim();
      if (!name) { toast('수집 작업 이름을 입력해 주세요.', 'warn'); return; }
      if (!target) { toast('적재 대상 테이블 이름을 입력해 주세요.', 'warn'); return; }
      if (!st.cols.length) { toast('미리보기로 컬럼을 먼저 확인해 주세요.', 'warn'); return; }

      const payload = {
        name, kind: st.kind, target,
        mode: $('#igMo', m).value,
        config: readCfg(), columns: st.cols,
        trigger_type: st.kind === 'api' ? $('#igTg', m).value : 'manual',
        freq: st.kind === 'api' && $('#igTg', m).value === 'schedule'
          ? $('#igFq', m).value : '수동 실행',
      };
      const btn = $('#igOk', m);
      btn.disabled = true;
      try {
        const saved = edit
          ? await api(`/ingest/jobs/${enc(job.id)}`, { method: 'PATCH', body: JSON.stringify(payload) })
          : await api('/ingest/jobs', { method: 'POST', body: JSON.stringify(payload) });
        close();
        toast(edit ? `${name} 을(를) 저장했습니다.`
                   : `${name} 을(를) 만들었습니다. ${saved.phys} 원천이 데이터 모델에 등록됩니다.`);
        await loadIngest();
        await boot({ keep: true });
        openIngTab(saved.id);
      } catch (e) { fail(e); btn.disabled = false; }
    };
  }

  function fmtCell(v) {
    if (v == null) return '';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }

  /* ---------------------------------------------------------- 페이지 */

  function pageIngest() {
    S.openIngs = S.openIngs.filter(id => ingById(id));
    if (S.openIng !== 'list' && !S.openIngs.includes(S.openIng)) S.openIng = 'list';

    const page = el('<div class="page flush" style="display:flex;flex-direction:column;min-height:0"></div>');
    const row = el('<div class="mod f1" style="min-height:0"></div>');
    row.appendChild(ingSidebar());

    const right = el('<div class="mod-c f1" style="min-width:0;min-height:0"></div>');
    right.appendChild(ingTabStrip());
    const j = S.openIng === 'list' ? null : ingById(S.openIng);
    right.appendChild(j ? ingDetailView(j) : ingListView());
    row.appendChild(right);
    page.appendChild(row);
    return page;
  }


  /* 수집 화면도 파이프라인과 같은 배경 층을 쓴다 — 탭 스트립·캔버스가 한 묶음 */
  
  /* 첫 기동에 목록을 함께 받는다 */

  splash('데이터를 불러오는 중입니다…');
  boot().catch(e => {
    splash(`서버에 연결하지 못했습니다.\n\n${e.message}\n\n` +
           `API 주소: ${BASE}\n` +
           `서버를 켜려면 프로젝트 루트에서 ./datamates/run.sh 를 실행하세요.`, 'err');
    console.error(e);
  });

  /* 콘솔에서 쓸 수 있게 열어 둔다 */
  window.DM = { api, boot, refreshRun, BASE, ORIGIN, HIST, loadHistory };
