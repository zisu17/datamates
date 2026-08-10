/* ── b38 — ── b38 — v2.6 — UI/UX 다듬기 : 문구 정리 · 중복 제거 · 위계 조정 ── (index.html 블록에서 기계적 추출, 동작 불변) */

/* ============================================================
   v2.6 — UI/UX 다듬기 : 문구 정리 · 중복 제거 · 위계 조정
   ============================================================ */

/* 1) 모델 화면 — 주요 액션은 모델 저장. 이동 버튼은 보조로 낮춘다 */

/* 2) 입력 데이터 탭 — 옛 캔버스 시절 문구를 실제 동작에 맞게 */
/* 3) 관계 화면 머리말 — 좁아지면 범례부터 감춘다 */
/* 4) 실행 흐름 — 배너 두 줄 겹침 제거, 규칙 문구는 흐름 머리말로 */
/* (pagePipeDetail — 이후 정의가 값 캡처 없이 전면 교체. 죽은 층 제거) */
/* 5) 실행 설정 — 저장 줄을 화면 아래에 고정 */
pipeCfg = (function (base) {
  return function (pp, r) {
    const w = base(pp, r);
    const ok = $('#pcOk', w);
    if (ok) ok.closest('.row.g6').classList.add('def-act');
    return w;
  };
})(pipeCfg);

/* 6) 모델 정보 독 — 품질 상태에 색을 입힌다 */
/* 7) 클릭되는 표 행에만 포인터 커서 */
(function () {
  const obs = new MutationObserver(() => {
    $$('#app .tr').forEach(tr => { if (tr.onclick) tr.classList.add('act'); });
  });
  obs.observe(document.getElementById('app'), { childList: true, subtree: true });
})();

