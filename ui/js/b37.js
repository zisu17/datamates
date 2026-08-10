/* ── b37 — ── b37 — ── 6. 마무리 : ERD 상자에 분류 표시, 새 모델 만들 때 규칙 안내 ── (index.html 블록에서 기계적 추출, 동작 불변) */

/* ── 6. 마무리 : ERD 상자에 분류 표시, 새 모델 만들 때 규칙 안내 ── */
openNewModel = (function (base) {
  return function () {
    base();
    const m = $('.modal'); if (!m) return;
    const b = $('.modal-b', m);
    if (b) b.insertBefore(el(`<div class="rule" style="margin-bottom:12px">${ic14('info')}<span>${MODEL_RULE}
      SQL 안에서 CTE는 여러 개 쓸 수 있지만, 문장과 출력 테이블은 하나입니다.</span></div>`), b.firstChild);
    fixTerms(m);
  };
})(openNewModel);

/* SQL 저장 전에 문장 하나 · 출력 하나 를 검사한다 */
sqlView = (function (base) {
  return function (node) {
    const w = base(node);
    const box = $('#sqlBox', w), save = $('#sqlSave', w);
    const hint = $('.row.g6 .t11.fnt', w);
    if (hint) hint.textContent = MODEL_RULE + ' 저장하면 참조 관계와 품질 규칙이 함께 반영됩니다.';
    if (box && save) {
      const old = save.onclick;
      save.onclick = () => {
        const a = sqlAudit(box.value);
        if (a.stmts > 1) { toast(`SQL 문장이 ${a.stmts}개입니다. 모델 하나는 SQL 하나여야 합니다.`, 'err'); return; }
        if (a.ddl) { toast(`${a.ddl} 은(는) 쓸 수 없습니다. 모델은 SELECT 하나로 정의합니다.`, 'err'); return; }
        old();
      };
    }
    return w;
  };
})(sqlView);

/* SQL 탭 머리말에 CTE 요약 */
/* 모델링 툴바 안내 문구 */
