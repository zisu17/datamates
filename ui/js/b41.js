


let _seqCache = { sig: null, map: null };
function execSeq(pp) {
  const sig = gsig(pp);
  if (_seqCache.sig === sig) return _seqCache.map;
  const g = pgraph(pp), map = {};
  let i = 0;
  orderG(g).forEach(k => { const d = byId(nodeOf(g, k).id); if (d && d.kind !== 'source') map[k] = ++i; });
  _seqCache = { sig, map };
  return map;
}

pnodeEl = function (pp, n, runs, edit) {
  /* 노드는 «Task» 다. 모델 하나를 만드는 Task 면 그 모델의 이름·물리 위치를 그대로
     쓰고, 그렇지 않은 Task(완료 표식, 일괄 빌드)는 카탈로그에 대응하는 모델이
     없으므로 서버가 준 Task 정보로 그린다. byId 만 믿으면 그 둘에서 깨진다. */
  const md = byId(n.id);
  const marker = n.kind === 'marker';
  const d = md || {
    name: n.name || n.id,
    phys: marker ? '이 위의 Task 가 모두 성공하면 완료됩니다'
                 : ((n.models || []).join(' · ') || '—'),
    kind: n.kind || 'task', mat: '—', layer: '', group: 'DATA MODEL',
  };
  const rn = runs ? (runs[n.key] || { st: 'wait' }) : null;
  const src = d.kind === 'source';
  const seq = n.seq != null ? n.seq : execSeq(pp)[n.key];
  const e = el(`<div class="pn ${src ? 'src' : ''} ${marker ? 'done' : ''} ${S.pipeNodeK === n.key ? 'sel' : ''}" data-pk="${n.key}"
      title="${esc(d.name)}\n${esc(d.phys)}${src ? '\n참조 전용 · 실행하지 않음'
                                              : marker ? '' : '\n실행 순서 ' + seq}"
      style="left:${n.x}px;top:${n.y}px">
    <div class="pn-t" style="background:${grpColor(d)}"></div>
    <div class="pn-b">
      <span class="pn-hd">
        <span class="pn-seq">${src ? 'S' : marker ? '✓' : seq}</span>
        <span class="pn-n trunc">${esc(d.name)}</span></span>
      <span class="pn-p trunc">${esc(d.phys)}</span>
      <span class="pn-m">${marker ? '' : layerTag(d.layer)}
        ${rn ? stBadge(rn.st) : (!src && d.mat !== '—' ? `<span class="tag" style="font-size:var(--fs-micro)">${esc(matKo(d.mat))}</span>` : '')}
        ${rn && rn.dur && rn.dur !== '—' ? `<span class="t11 fnt">${esc(rn.dur)}</span>` : ''}</span></div>
    <span class="pport i"></span><span class="pport o" data-pport="${n.key}"></span>
    ${edit ? `<button class="pn-x" data-prm="${n.key}" title="캔버스에서 제거">${ic14('x')}</button>` : ''}</div>`);
  return e;
};

/* 캔버스 머리말에서 설명 문장을 뺀다 */
/* (pipeCanvas — 이후 정의가 값 캡처 없이 전면 교체. 죽은 층 제거) */
/* 순서는 카드에 있으므로 하단 순서 바는 없앤다 */
