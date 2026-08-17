


S.pdockMin = S.pdockMin || false;
const DOCK_MIN = 120;


function dockMaxH(dock) {
  const host = dock && dock.parentElement;
  const room = host ? host.getBoundingClientRect().height : window.innerHeight - 106;
  return Math.max(320, Math.round(room - 132));
}

/* 1) 하단 상세 — 높이 조절 + 접기 */

/* 2) 관계도 — 카탈로그에서 끌어다 놓기 */
/* 3) 모델링 하단 패널도 같은 한계값을 쓴다 */
/* (wireGrips — 도크 그립을 통째로 다시 연결하던 층. b03 본체가 처음부터
   이 한계값(DOCK_MIN/MAX)과 transition 복원으로 연결하도록 합쳤다. 제거) */
