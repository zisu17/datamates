


/* 캔버스 첫 배율 — 화면 크기를 따라간다(canvasInitZoom · b09).

   값을 «한 번 계산해 담아 두는» 방식은 쓰지 않는다. 스크립트가 읽히는 시점의
   창 크기로 고정돼, 작은 창으로 열었다가 최대화해도 그대로 작게 남았다.

   대신 **사용자가 배율을 건드렸는지**를 기억한다. 건드리지 않았으면 렌더마다
   화면 크기에서 다시 구하고, 한 번이라도 바꿨으면 그 값을 지킨다.
   할당 지점이 12곳(휠·「배율 100%」·「화면에 맞추기」)이라 그곳마다 표시를 남기면
   반드시 하나를 빠뜨린다 — 그래서 값이 바뀌었는지를 렌더 시점에 비교한다. */
const CANVAS_ZOOM = ['erdZoom', 'pdagZoom', 'pipeZoom'];
S.zoomAuto = {};                    // 자동으로 넣어 둔 값. 이것과 다르면 사용자가 바꾼 것.

function syncCanvasZoom() {
  const z = canvasInitZoom();
  CANVAS_ZOOM.forEach(k => {
    const cur = S[k];
    /* 아직 없거나, 지금 값이 «우리가 넣어 둔 그 값» 그대로면 아직 안 건드린 것이다. */
    if (cur == null || cur === S.zoomAuto[k]) { S[k] = z; S.zoomAuto[k] = z; }
  });
}
syncCanvasZoom();
window.addEventListener('resize', () => { syncCanvasZoom(); });
/* render 래핑은 여기서 하지 않는다 — api.js 와 b57.js 가 render 를 통째로 다시
   정의해서 이 자리에서 감싸면 그 뒤에 날아간다. 가장 마지막에 읽히는 파일이 감싼다. */

/* 모든 엔티티가 들어오도록 배율 맞추기 */
/* 휠 확대·축소 + 상자 이동 + 배경 패닝 — 배율을 좌표 계산에 반영한다 */
/* (wireErd — 이후 정의가 값 캡처 없이 전면 교체. 죽은 층 제거) */
/* 더보기 메뉴에도 배율 항목을 되살린다 */

HELP.modeling.items[4] = 'ERD의 상자를 두 번 누르면 정의로, 선을 두 번 누르면 연결 설정으로 갑니다. 휠로 확대·축소, 배경을 끌어 이동합니다.';
