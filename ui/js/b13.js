/* ── b13 — ── b13 — v2.1 — 데이터 모델링: 정의만. 실행 기능은 파이프라인으로 옮긴다. ── (index.html 블록에서 기계적 추출, 동작 불변) */

/* ============================================================
   v2.1 — 데이터 모델링: 정의만. 실행 기능은 파이프라인으로 옮긴다.
   ============================================================ */
/* 하단 독의 SQL · 품질 규칙 본문.
   원래는 정의 화면 오른쪽 패널(mpView)의 6탭 본문이었지만, v2.2.1 이 mpView 를
   빈 조각으로 만들고 v5.1~5.6 이 정의 화면을 하단 독으로 옮기면서
   실제로 불리는 자리는 독의 두 탭(api 의 dockView)뿐이다.
   그래서 기본 정보 · 입력 데이터 · 변환 · 컬럼 갈래는 도달하지 않는다 —
   브라우저 실측으로도 이 함수는 S.mTab 이 'SQL' 또는 '품질 규칙' 일 때만 불렸다. */
function mpBody(b, n, d) {
  if (S.mTab === 'SQL') {
    if (!d.sql) { b.appendChild(el(`<div class="empty">${ic('db')}<span class="empty-t">원천 데이터는 SQL이 없습니다.</span></div>`)); return; }
    /* 문장·CTE 요약을 맨 위에 (v2.6 이 나중에 끼워 넣던 줄) */
    const a = sqlAudit(d.sql);
    b.appendChild(el(`<div class="rule q">${ic14('info')}<span>문장 ${a.stmts}개 · CTE ${a.cte}개${a.cteNames.length ? ` (${a.cteNames.join(', ')})` : ''} · 출력 테이블 1개.
      ${MODEL_RULE}</span></div>`));
    b.appendChild(el(`<div class="code" style="max-height:none;white-space:pre-wrap">${esc(d.sql)}</div>`));
    const row = el(`<div class="row g6"><button class="btn sm f1" id="mpEdit">${ic14('code')}SQL 편집</button>
      <button class="btn sm" id="mpChk">${ic14('checkc')}SQL 검사</button></div>`);
    $('#mpEdit', row).onclick = () => sqlModal(n);
    $('#mpChk', row).onclick = () => checkSql(n);
    b.appendChild(row);
    return;
  }

  /* 품질 규칙 */
  const rs = rulesOf(n.id);
  const s = el(`<div class="sec"><span class="sec-t">검사 규칙 ${rs.length}개</span>
    <span class="t11 fnt">여기서 만든 규칙은 데이터 품질 메뉴에도 함께 나타납니다.</span></div>`);
  if (!rs.length) s.appendChild(el('<span class="t12 fnt">아직 규칙이 없습니다.</span>'));
  rs.forEach(q => {
    const row = el(`<div class="hmrow" style="align-items:center">
      <span class="col f1" style="gap:3px;min-width:0">
        <span class="t12 b6 trunc">${esc(q.name)}</span>
        <span class="row g6"><span class="tag">${esc(QTYPES[q.type].label)}</span>
          <span class="sevb sev-${q.sev}">${q.sev === 'error' ? '오류' : '주의'}</span>
          ${q.active ? qDot(q.status) : '<span class="t11 fnt">사용 안 함</span>'}</span>
        <span class="t11 fnt mono trunc">${esc(q.cond)}</span></span>
      <span class="tgl ${q.active ? 'on' : ''}" data-tg="${q.id}"><i></i></span></div>`);
    row.onclick = (ev) => { if (ev.target.closest('[data-tg]')) return; go('quality', q.id); };
    /* 토글 자체는 api 의 wireToggles 가 서버 호출로 붙인다.
       여기 있던 프로토타입 핸들러는 없어진 #mPanel 을 다시 그리려 해
       누를 때마다 TypeError 만 던지고 있었다 — 제거. */
    s.appendChild(row);
  });
  const add = el(`<button class="btn sm" id="mpAddQ">${ic14('plus')}규칙 추가</button>`);
  add.onclick = () => ruleModal(null, n.id);
  s.appendChild(add);
  b.appendChild(s);
}
function qDot(st) {
  return st === 'ok' ? `<span class="t11" style="color:var(--ok)">${ic14('checkc')} 통과</span>`
    : st === 'warn' ? `<span class="t11" style="color:var(--warn)">${ic14('alert')} 주의</span>`
    : `<span class="t11" style="color:var(--err)">${ic14('xc')} 실패</span>`;
}
function edgeKey2(e) { return e.from + '>' + e.to; }
if (typeof edgeKey !== 'function') { window.edgeKey = edgeKey2; }

function sqlModal(n) {
  const { m, close } = modal(`<div class="modal-h"><span class="modal-t">SQL 편집 — ${esc(n.ref.name)}</span>
      <button class="iconbtn sp" data-close>${ic('x')}</button></div>
    <div class="modal-b" style="padding:0"><div id="sqlHost" style="display:flex;height:56vh;min-height:280px"></div></div>`, { lg: true });
  const host = $('#sqlHost', m);
  const v = sqlView(n); v.style.height = '100%';
  host.appendChild(v);
  const sv = $('#sqlSave', v);
  if (sv) { const old = sv.onclick; sv.onclick = () => { old(); close(); }; }
}
/* ── 모델링 화면 ── */
/* (pageModeling — 이후 정의가 값 캡처 없이 전면 교체. 죽은 층 제거) */
/* 하단은 미리보기 전용 — 실행 결과·로그는 파이프라인으로 */
/* (refreshPanel — 이후 정의가 값 캡처 없이 전면 교체. 죽은 층 제거) */
