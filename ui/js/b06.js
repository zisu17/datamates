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

/* ── 워크 스페이스 (제거) ──
   홈의 두 번째 탭에서만 쓰던 묶음이다. 기본 4개(전체·원천·정제·분석)는 층 필터였고,
   내 워크 스페이스 4개는 의료 데모 시절 테이블 id(dim_patient · agg_checkup_summary …)를
   들고 있어 지금 데이터에서는 하나도 찾히지 않았다 — 넷 다 «0개 파이프라인» 만 그렸다.
   홈을 한 화면으로 정리하며 WS_BASE · WS_USER · wsTables · wsById 를 걷어냈고,
   화면 쪽(homeWsView 등)은 b11, 만들기 모달(wsCreateModal)은 b07 에서 함께 지웠다.
   딸려 있던 상태 키(ws · wsTable · wsTab · wsQ · wsSort)도 읽는 곳이 없어 뺀다. */
/* ── 상태 확장 ── */
Object.assign(S, {
  selEdge: null,
  pipeNode: null, pipeTab: '빌드 정보',
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
