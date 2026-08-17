



/* ── 품질 규칙: 기존 TESTS 를 하나의 공유 객체로 승격 ── */
const QTYPES = {
  notnull:  { label: '필수값', dbt: 'not_null' },
  unique:   { label: '중복', dbt: 'unique' },
  accepted: { label: '허용값', dbt: 'accepted_values' },
  rel:      { label: '참조 무결성', dbt: 'relationships' },
  range:    { label: '범위', dbt: 'dbt_utils.accepted_range' },
  fresh:    { label: '최신성', dbt: 'source freshness' },
  sql:      { label: '사용자 정의 SQL', dbt: 'singular test' },
};
const KIND2TYPE = { '필수값': 'notnull', '중복': 'unique', '기준값': 'accepted', '연결': 'rel', '업데이트': 'fresh', '범위': 'range' };
const QRULES = TESTS.map(t => ({
  id: t.id, name: t.title + ' · ' + t.col, type: KIND2TYPE[t.kind] || 'notnull',
  model: t.target, col: t.col, cond: t.dbt, sev: t.sev === 'error' ? 'error' : 'warn',
  active: true,
  status: t.status, cnt: t.cnt, plain: t.plain, impact: t.impact, rows: t.rows || [],
  lastRun: '오늘 05:19', firstSeen: '07.31 05:19',
  pipe: (PIPES.find(p => ((p.canvas ? p.canvas.order : p.targets) || []).includes(t.target)) || {}).id || null,
}));
const rulesOf = (mid) => QRULES.filter(q => q.model === mid);
const ruleById = (id) => QRULES.find(q => q.id === id);
function qStatusOf(mid) {
  const rs = rulesOf(mid).filter(r => r.active);
  if (rs.some(r => r.status === 'err')) return 'err';
  if (rs.some(r => r.status === 'warn')) return 'warn';
  return 'ok';
}
let QSEQ = 0;
function addRule(o) {
  QSEQ++;
  const q = Object.assign({ id: 'q' + Date.now() + QSEQ, name: '새 규칙', type: 'notnull', model: null, col: '',
    cond: '', sev: 'error', active: true, owner: '', status: 'ok', cnt: 0,
    plain: '아직 실행되지 않았습니다.', impact: '', rows: [], lastRun: '실행 전', firstSeen: '—', pipe: null }, o);
  q.cond = q.cond || QTYPES[q.type].dbt;
  QRULES.push(q); return q;
}
/* 워크스페이스(파이프라인 묶음)는 서버에 없는 개념이라 api.js 가 부팅 때
   비운다. 예시를 채워 두면 부팅 전 한 프레임 동안만 보였다 사라져
   «있다가 없어지는 묶음» 으로 읽힌다. 빈 채로 둔다 — 화면은 «전체» 만 쓴다. */
const WSGROUPS = [];
Object.assign(S, { mTab: '기본 정보', mPanelOpen: true, qTab: '대시보드', qSel: null, qQuery: '', qType: '전체', vSel: null, pipeWs: '전체' });

/* ── 라우팅: 카탈로그로 가던 호출을 4개 메뉴로 보낸다 ── */
/* 프로필 메뉴에 환경 설정 */
function settingsModal() {
  const r = R();
  const h = `<div class="modal-h"><span class="modal-t">환경 설정</span><button class="iconbtn sp" data-close>${ic('x')}</button></div>
    <div class="modal-b"><div class="frm">
      <div class="fr"><span class="fr-l">기본 실행 환경</span>
        <select class="inp" id="stEnv">${Object.entries(ENVS).map(([k, v]) => `<option value="${k}" ${S.env === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></div>
      <div class="fr"><span class="fr-l">알림</span>
        <label class="chkrow"><input type="checkbox" class="chk" checked> 데이터에 문제가 생기면 알림</label>
        <label class="chkrow"><input type="checkbox" class="chk" checked> 파이프라인 실패 알림</label>
        <label class="chkrow"><input type="checkbox" class="chk"> 매 실행 결과 알림</label></div>

    </div></div>
    <div class="modal-f"><button class="btn sp" data-close>취소</button><button class="btn pri" id="stOk">저장</button></div>`;
  const { m, close } = modal(h, { sm: true });
  $('#stOk', m).onclick = () => { S.env = $('#stEnv', m).value; close(); render(); toast('환경 설정을 저장했습니다.'); };
}
/* 도움말 — 4개 메뉴 기준 */
HELP.modeling = { t: '데이터 모델링', items: [
  '왼쪽 목록의 + 버튼을 누르거나 데이터를 캔버스로 끌어 추가합니다.',
  '카드의 연결점을 다른 카드로 끌어 입력 관계를 만듭니다.',
  '모델을 선택하면 오른쪽에서 기본 정보·입력·변환·컬럼·SQL·품질 규칙을 설정합니다.',
  'SQL 탭에서 생성된 dbt SQL을 확인하거나 직접 수정합니다.',
  '품질 규칙 탭에서 만든 규칙은 데이터 품질 메뉴에도 함께 나타납니다.',
  '모델 저장으로 정의를 저장하고, 실행은 데이터 파이프라인에서 합니다.'] };
HELP.pipeline = { t: '데이터 파이프라인', items: [
  '목록에서 파이프라인을 고르면 실행 흐름이 열립니다.',
  '모델별 성공·실패·건너뜀 상태를 흐름도에서 확인합니다.',
  '카드를 클릭하면 실행 정보·로그·실행 SQL·품질 결과를 봅니다.',
  '실패한 모델부터 다시 실행할 수 있습니다.',
  '실행 일정과 알림은 권한이 있는 사용자만 변경할 수 있습니다.'] };
HELP.quality = { t: '데이터 품질', items: [
  '품질 대시보드에서 통과율·지표별 점수·모델별 통과율과 실패 상위 규칙을 봅니다.',
  '품질 리포트는 데이터 모델과 품질지표를 교차해 점수를 보여줍니다. 셀을 누르면 해당 규칙으로 갑니다.',
  '검증 규칙 하나는 dbt 제네릭 테스트와 그 인자입니다. 그것이 걸린 모델·컬럼 하나하나가 적용 대상입니다.',
  '규칙 상세에서 적용 대상·실행 이력·규칙 정보를 보고, 즉시 검증이나 대상 추가를 합니다.',
  '검증 결과에서 적용 대상별 최근 실행을 보고, 줄을 누르면 실제 오류 행으로 갑니다.',
  '규칙은 데이터 모델 화면의 품질 규칙 탭에서도 수정할 수 있습니다 — 같은 규칙입니다.'] };
delete HELP.catalog; delete HELP.settings;
