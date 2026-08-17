


S.pdockH = S.pdockH || null;      /* 파이프라인 하단 높이 */
S.pdockUser = S.pdockUser || false;  /* 사용자가 직접 조절했는가 */
const PDOCK_MIN = 150, PDOCK_FIT = 340;  /* 자동 맞춤은 340px 까지 */
/* 직접 조절의 위 한계는 dockMaxH(b45) 가 화면 높이에서 계산한다 —
   고정값(440px)이면 어느 화면에서든 페이지 절반에서 멈췄다. */
/* (pipeDock — 본문은 b35 의 pipeDockChrome 으로 옮겼다. 여기 상수·상태는 그대로 쓴다) */
