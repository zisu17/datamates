


Object.assign(S, { erdScroll: null, pipeScroll: null });

function keepScroll(wrap, key, bbox) {
  const apply = () => {
    if (!wrap.isConnected || !wrap.clientWidth) return;
    const maxL = Math.max(0, wrap.scrollWidth - wrap.clientWidth);
    const maxT = Math.max(0, wrap.scrollHeight - wrap.clientHeight);
    const s = S[key];
    let l = s ? Math.max(0, Math.min(s.l, maxL)) : -1;
    let t = s ? Math.max(0, Math.min(s.t, maxT)) : -1;
    const b = bbox();                       /* sizer 좌표계의 내용 영역 */
    const home = { l: Math.max(0, Math.min(b.x - 24, maxL)), t: Math.max(0, Math.min(b.y - 24, maxT)) };
    if (l < 0 || t < 0) { l = home.l; t = home.t; }
    else {
      /* 되살린 위치에서 내용이 한 조각도 안 보이면 처음 자리로 */
      const visX = b.x < l + wrap.clientWidth - 40 && b.x + b.w > l + 40;
      const visY = b.y < t + wrap.clientHeight - 40 && b.y + b.h > t + 40;
      if (!visX || !visY) { l = home.l; t = home.t; }
    }
    wrap.scrollLeft = l; wrap.scrollTop = t;
    S[key] = { l: wrap.scrollLeft, t: wrap.scrollTop };
    wrap.addEventListener('scroll', () => { S[key] = { l: wrap.scrollLeft, t: wrap.scrollTop }; }, { passive: true });
  };
  requestAnimationFrame(apply);
  setTimeout(apply, 60);        /* 폭 조절·패널 전환 뒤 레이아웃이 늦게 잡히는 경우 */
}
/* 배율을 바꾸면 보던 위치도 함께 갱신된다 */
/* 자동 정렬 뒤에는 정렬된 결과가 바로 보이도록 위치를 초기화 */
/* 캔버스에 모델을 넣고 뺄 때도 화면 밖으로 밀려나지 않게 */
const _addNodeV241 = addNodeFromCatalog;
addNodeFromCatalog = function (id) { const r = _addNodeV241(id); if (S.erdPos) delete S.erdPos[id]; return r; };

/* ── 파이프라인 흐름도도 같은 방식으로 ── */
/* 파이프라인을 바꾸면 처음 위치에서 시작 */
