/* ── b06 — ── b06 — v1.2 — 연결 작업 · 워크 스페이스 카탈로그 · 모델링↔파이프라인 ── (index.html 블록에서 기계적 추출, 동작 불변) */

/* ============================================================
   v1.2 — 연결 작업 · 워크 스페이스 카탈로그 · 모델링↔파이프라인
   (뒤에 정의한 함수가 앞의 동명 함수를 대체한다)
   ============================================================ */

/* ── 연결 작업 정의 ── */
function edgeCfg(e) { if (!e.cfg) e.cfg = edgeDefaults(); return e.cfg; }
/* (edgeTip — 이후 정의가 값 캡처 없이 전면 교체. 죽은 층 제거) */
function edgeKey(e) { return e.from + '>' + e.to; }
function findEdge(k) { return S.edges.find(e => edgeKey(e) === k); }

/* ── 워크 스페이스 ── */
const WS_BASE = [
  { id: 'all', name: '전체', icon: 'db', desc: '플랫폼에 등록된 모든 데이터를 한곳에서 확인합니다.', pick: () => D },
  { id: 'src', name: '원천', icon: 'down', desc: '운영시스템에서 그대로 들어온 원본 데이터입니다. 가공 전이라 분석에는 정제 데이터를 권장합니다.', pick: () => D.filter(d => d.layer === '원천') },
  { id: 'stg', name: '정제', icon: 'filter', desc: '표기와 단위를 통일하고 오류를 정리한 중간 데이터입니다.', pick: () => D.filter(d => d.layer === '정제') },
  { id: 'mart', name: '분석', icon: 'chart', desc: '분석과 보고에 바로 사용할 수 있는 데이터를 모아둔 공간입니다.', pick: () => D.filter(d => d.layer === '분석용') },
];
const WS_USER = [
  { id: 'w1', name: '건강검진 분석', desc: '검진 실적 보고에 쓰는 데이터 모음입니다.', owner: '박서연', vis: '팀 공개',
    tables: ['stg_health_checkup', 'agg_checkup_summary', 'dim_patient'] },
  { id: 'w2', name: '검사 운영 현황', desc: '일일 검사 운영 보고에 사용합니다.', owner: '김수현', vis: '팀 공개',
    tables: ['stg_examination_result', 'fct_patient_examination', 'agg_daily_examination'] },
  { id: 'w3', name: '즐겨찾는 데이터', desc: '자주 여는 데이터를 모아둔 개인 공간입니다.', owner: '김수현', vis: '나만 보기',
    tables: ['dim_patient', 'fct_patient_examination'] },
  { id: 'w4', name: '2026년 경영지표', desc: '경영보고용 지표 산출에 사용하는 데이터입니다.', owner: '박민재', vis: '전체 공개',
    tables: ['agg_daily_examination', 'agg_checkup_summary'] },
];
function wsTables(ws) {
  if (!ws) return [];
  if (ws.pick) return ws.pick();
  return (ws.tables || []).map(byId).filter(Boolean);
}
function wsById(id) { return WS_BASE.find(w => w.id === id) || WS_USER.find(w => w.id === id); }
/* ── 상태 확장 ── */
Object.assign(S, {
  selEdge: null, ws: null, wsTable: null, wsTab: '개요', wsQ: '', wsSort: '이름순',
  pipeNode: null, pipeTab: '실행 정보',
});

/* ============================================================
   연결 작업 설정
   ============================================================ */
/* (openEdgeCfg — 이후 정의가 값 캡처 없이 전면 교체. 죽은 층 제거) */
/* ── 삭제 ── */
function confirmBox({ title, body, ok, danger }, onOk) {
  const h = `<div class="modal-h"><span class="modal-t">${esc(title)}</span><button class="iconbtn sp" data-close>${ic('x')}</button></div>
    <div class="modal-b"><p style="margin:0;line-height:1.7;white-space:pre-line">${esc(body)}</p></div>
    <div class="modal-f"><button class="btn sp" data-close>취소</button>
      <button class="btn ${danger ? 'pri' : 'pri'}" id="cbOk" ${danger ? 'style="background:var(--err);border-color:var(--err)"' : ''}>${esc(ok || '확인')}</button></div>`;
  const { m, close } = modal(h, { sm: true });
  $('#cbOk', m).onclick = () => { close(); onOk(); };
}
function removeNode(id, hard) {
  const d = byId(id);
  S.edges = S.edges.filter(e => e.from !== id && e.to !== id);
  S.nodes = S.nodes.filter(n => n.id !== id);
  if (hard) { const i = D.findIndex(x => x.id === id); if (i >= 0) D.splice(i, 1); }
  if (S.sel === id) S.sel = S.nodes.length ? S.nodes[S.nodes.length - 1].id : null;
  S.dirty = true; render();
  toast(hard ? `${d.name} 모델을 삭제했습니다.` : `${d.name} 을(를) 캔버스에서 제거했습니다.`);
}
/* ============================================================
   캔버스 — 연결선 라벨 · 선택 · 삭제
   ============================================================ */
/* (nodeEl — 이후 정의가 값 캡처 없이 전면 교체. 죽은 층 제거) */
/* (drawEdges — 이후 정의가 값 캡처 없이 전면 교체. 죽은 층 제거) */
/* (canvasView — 이후 정의가 값 캡처 없이 전면 교체. 죽은 층 제거) */
/* (afterModelingRender — 이후 정의가 값 캡처 없이 전면 교체. 죽은 층 제거) */
/* Delete · Backspace 로 선택한 모델·연결 삭제 */
/* 상세 패널 — 연결 목록과 삭제 버튼 추가 */
/* (paintPanel — 이후 정의가 값 캡처 없이 전면 교체. 죽은 층 제거) */
/* 툴바 더보기 — 파이프라인 저장 · 삭제 추가 */
/* (moreMenu — 이후 정의가 값 캡처 없이 전면 교체. 죽은 층 제거) */
/* 새로 만든 모델은 삭제 가능하도록 표시 */
const _buildModelBase = buildModel;
buildModel = function (args) { const d = _buildModelBase(args); d.custom = true; return d; };

/* 연결 목록을 다시 만들 때 작업 설정을 잃지 않게 보존한다 */
/* (rebuildEdges — cfg 보존을 b03 본체 앞뒤로 옮겼다. 제거) */
