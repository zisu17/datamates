/* ── b07 — ── b07 — 2. 데이터 카탈로그 — 워크 스페이스 중심 ── (index.html 블록에서 기계적 추출, 동작 불변) */

/* ============================================================
   2. 데이터 카탈로그 — 워크 스페이스 중심
   ============================================================ */
/* ── 오른쪽 메타데이터 패널 ── */
/* ── 워크 스페이스 관리 ── */
function wsCreateModal() {
  const picked = [];
  const h = `<div class="modal-h"><span class="modal-t">워크 스페이스 만들기</span><button class="iconbtn sp" data-close>${ic('x')}</button></div>
    <div class="modal-b"><div class="frm">
      <div class="fr"><span class="fr-l">이름</span><input class="inp" id="wcN" placeholder="예) 건강검진 분석"></div>
      <div class="fr"><span class="fr-l">설명</span><input class="inp" id="wcD" placeholder="이 워크 스페이스를 어떤 일에 쓰는지 적어 주세요."></div>
      <div class="fr"><span class="fr-l">공개 범위</span>
        <select class="inp" id="wcV"><option>나만 보기</option><option selected>팀 공개</option><option>전체 공개</option></select></div>
      <div class="fr"><span class="fr-l">담을 테이블</span>
        <div class="pick" style="max-height:190px">${D.map(d => `<button class="pk" data-p="${d.id}">${esc(d.name)}</button>`).join('')}</div></div>
    </div></div>
    <div class="modal-f"><span class="t12 fnt" id="wcCnt">0개 선택</span>
      <button class="btn sp" data-close>취소</button><button class="btn pri" id="wcOk">만들기</button></div>`;
  const { m, close } = modal(h);
  $$('[data-p]', m).forEach(b => b.onclick = () => { const id = b.dataset.p; const i = picked.indexOf(id);
    if (i >= 0) picked.splice(i, 1); else picked.push(id);
    b.classList.toggle('on'); $('#wcCnt', m).textContent = picked.length + '개 선택'; });
  $('#wcOk', m).onclick = () => {
    const n = $('#wcN', m).value.trim();
    if (!n) { toast('워크 스페이스 이름을 입력해 주세요.', 'warn'); return; }
    const ws = { id: 'w' + Date.now(), name: n, desc: $('#wcD', m).value.trim() || '설명이 아직 없습니다.',
      owner: '', vis: $('#wcV', m).value, tables: picked.slice() };
    WS_USER.push(ws); close(); S.ws = ws.id; S.wsTable = null; render();
    toast(`${n} 워크 스페이스를 만들었습니다.`);
  };
}
