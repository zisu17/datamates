/* ── b47 — ── b47 — v3.0 — 카탈로그를 폴더로 관리한다 ── (index.html 블록에서 기계적 추출, 동작 불변) */

/* ============================================================
   v3.0 — 카탈로그를 폴더로 관리한다
   · SOURCE / DATA MODEL 아래에 폴더를 만들어 정리
   · 목록에는 이름만 — 스키마·물리 테이블명은 상세와 툴팁으로
   ============================================================ */
/* 폴더의 원천은 서버다 — api.js 가 부팅 때 /bootstrap 의 folders 로 통째로
   교체한다. 여기에는 그릇만 둔다. 모델 id 에 폴더를 붙이던 SEED_FOLDER 는
   그 id 들이 사라진 지금 아무 데도 닿지 않는다. */
const FOLDERS = [];
S.fdrOpen = S.fdrOpen || {};
const fdrOpen = (id) => S.fdrOpen[id] !== false;
const foldersOf = (grp) => FOLDERS.filter(f => f.grp === grp);
const inFolder = (fid, list) => list.filter(d => (d.folder || null) === fid);
let FSEQ = 0;

function folderModal(fid, grp) {
  const f = fid ? FOLDERS.find(x => x.id === fid) : null;
  const h = `<div class="modal-h"><span class="modal-t">${f ? '폴더 이름 변경' : '새 폴더'}</span>
      <button class="iconbtn sp" data-close>${ic('x')}</button></div>
    <div class="modal-b"><div class="frm">
      <div class="fr"><span class="fr-l">폴더 이름</span>
        <input class="inp" id="fdName" value="${esc(f ? f.name : '')}" placeholder="예) 매출 · 고객 · 재고"></div>
      <div class="fr"><span class="fr-l">위치</span>
        <select class="inp" id="fdGrp" ${f ? 'disabled' : ''}>
          ${['SOURCE', 'DATA MODEL'].map(g => `<option ${(f ? f.grp : grp) === g ? 'selected' : ''}>${g}</option>`).join('')}</select>
        <span class="fr-h">폴더는 SOURCE 와 DATA MODEL 안에서만 만듭니다.</span></div>
    </div></div>
    <div class="modal-f">${f ? '<button class="btn sm dngr" id="fdDel">폴더 삭제</button>' : ''}
      <button class="btn sp" data-close>취소</button>
      <button class="btn pri" id="fdOk">${f ? '저장' : '폴더 만들기'}</button></div>`;
  const { m, close } = modal(h, { sm: true });
  const inp = $('#fdName', m);
  setTimeout(() => inp.focus(), 0);
  const ok = () => {
    const nm = inp.value.trim();
    if (!nm) { toast('폴더 이름을 입력해 주세요.', 'warn'); return; }
    if (f) { f.name = nm; toast('폴더 이름을 바꿨습니다.'); }
    else { FSEQ++; const id = 'fd' + Date.now() + FSEQ;
      FOLDERS.push({ id, name: nm, grp: $('#fdGrp', m).value });
      S.fdrOpen[id] = true; toast(`${nm} 폴더를 만들었습니다.`); }
    close(); render();
  };
  $('#fdOk', m).onclick = ok;
  inp.onkeydown = (e) => { if (e.key === 'Enter') ok(); };
  const del = $('#fdDel', m);
  if (del) del.onclick = () => { close();
    const n = D.filter(d => d.folder === f.id).length;
    confirmBox({ title: '폴더 삭제', ok: '삭제', danger: true,
      body: `${f.name} 폴더를 삭제하시겠습니까?\n\n${n ? `안에 있는 ${n}개는 폴더 없음 으로 옮겨집니다.\n` : ''}데이터는 삭제되지 않습니다.` },
      () => { D.forEach(d => { if (d.folder === f.id) d.folder = null; });
        const i = FOLDERS.indexOf(f); if (i >= 0) FOLDERS.splice(i, 1);
        render(); toast('폴더를 삭제했습니다.'); }); };
}
function moveModal(id) {
  const d = byId(id), grp = grpOf(d);
  const list = foldersOf(grp);
  const h = `<div class="modal-h"><span class="modal-t">폴더 이동</span>
      <button class="iconbtn sp" data-close>${ic('x')}</button></div>
    <div class="modal-b"><div class="frm">
      <div class="fr"><span class="fr-l">${esc(d.name)}</span>
        <select class="inp" id="mvF">
          <option value="">폴더 없음</option>
          ${list.map(f => `<option value="${f.id}" ${d.folder === f.id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></div>
    </div></div>
    <div class="modal-f"><button class="btn sp" data-close>취소</button>
      <button class="btn pri" id="mvOk">이동</button></div>`;
  const { m, close } = modal(h, { sm: true });
  $('#mvOk', m).onclick = () => { d.folder = $('#mvF', m).value || null; close(); render();
    toast(d.folder ? `${(FOLDERS.find(f => f.id === d.folder) || {}).name} 으로 옮겼습니다.` : '폴더에서 꺼냈습니다.'); };
}
