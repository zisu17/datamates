/* ── b02 — ── b02 — 2. 데이터 카탈로그 ── (index.html 블록에서 기계적 추출, 동작 불변) */

/* ============================================================
   2. 데이터 카탈로그
   ============================================================ */
/* 화면 폭에 따라 열을 줄인다 — 중요도가 낮은 열부터 상세 화면으로 넘긴다 */
/* (catRow — 이후 정의가 값 캡처 없이 전면 교체. 죽은 층 제거) */
/* (pageCatalog — 이후 정의가 값 캡처 없이 전면 교체. 죽은 층 제거) */
/* ── 데이터 상세 ── */
function detailTab(d) {
  const t = S.detailTab;
  if (t === '개요') return tabOverview(d);
  if (t === '컬럼') return tabColumns(d);
  if (t === '데이터 미리보기') return tabPreview(d);
  if (t === '데이터 생성 흐름') return tabFlow(d);
  return tabQualityOf(d);
}

function tabOverview(d) {
  const dn = downOf(d.id), up = (d.up || []).map(byId);
  const tests = TESTS.filter(x => x.target === d.id);
  const w = el(`<div style="display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:14px;align-items:start"></div>`);
  w.appendChild(el(`<div class="col g14">
    <section class="card"><div class="card-h"><span class="card-t">이 데이터는 이렇게 쓰입니다</span></div>
      <div class="card-b col g10">
        <p style="margin:0;line-height:1.65">${esc(d.desc)}</p>
        <div class="row g6" style="flex-wrap:wrap">${(d.tags || []).map(x => `<span class="tag">${esc(x)}</span>`).join('')}</div>
      </div></section>
    <section class="card"><div class="card-h"><span class="card-t">기본 정보</span></div>
      <div class="card-b"><div class="kv">
        ${kvRow('데이터 유형', `${d.layer} · ${d.kind === 'source' ? '원천 데이터' : '데이터 모델'}`)}
        ${kvRow('최근 업데이트', esc(d.updated) + (d.stale ? ' <span class="bdg warn">지연</span>' : ''))}
        ${kvRow('업데이트 주기', esc(d.freq))}
        ${kvRow('데이터 건수', esc(d.rows) + '건')}
        ${kvRow('앞 단계', up.length ? up.map(u => esc(u.name)).join(' · ') : '없음 (원천 데이터)')}
        ${kvRow('다음 단계', dn.length ? dn.map(u => esc(u.name)).join(' · ') : '없음')}
        ${S.showTech ? kvRow('물리 테이블', `<span class="mono t12">${esc(d.phys)}</span>`) : ''}
        ${S.showTech && d.mat !== '—' ? kvRow('생성 방식', `${d.mat === 'Incremental' ? '변경분만 반영' : d.mat === 'View' ? '조회 시 계산' : '전체 다시 생성'} <span class="mono t11 fnt">Materialization: ${esc(d.mat)}</span>`) : ''}
      </div></div></section>
  </div>`));
  const right = el(`<div class="col g14">
    <section class="card"><div class="card-h"><span class="card-t">품질 상태</span>${qBadge(d.quality)}</div>
      <div class="card-b col g8">
        ${tests.length ? tests.map(x => `<div class="row g8 t12">
            ${x.status === 'ok' ? `<span style="color:var(--ok)">${ic14('checkc')}</span>` : x.status === 'warn' ? `<span style="color:var(--warn)">${ic14('alert')}</span>` : `<span style="color:var(--err)">${ic14('xc')}</span>`}
            <span class="f1 trunc">${esc(x.title)} · ${esc(x.col)}</span>
            <span class="fnt">${x.cnt ? x.cnt + '건' : '이상 없음'}</span></div>`).join('')
          : '<span class="t12 fnt">등록된 검증 규칙이 없습니다.</span>'}
      </div></section>
  </div>`);
  w.appendChild(right);
  return w;
}
function kvRow(k, v) { return `<div class="kv-r"><span class="kv-k">${esc(k)}</span><span class="kv-v">${v}</span></div>`; }

function tabColumns(d) {
  const c = el(`<section class="card"><div class="card-h"><span class="card-t">컬럼 ${d.cols.length}개</span>
    <span class="t12 fnt sp">쉬운 이름을 앞에 두고, 실제 컬럼명은 옆에 함께 표기합니다.</span></div>
    <div class="card-b tight"><div class="tbl" style="--cols:minmax(0,1.2fr) minmax(0,1.2fr) 120px 80px minmax(0,1fr)"></div></div></section>`);
  const t = $('.tbl', c);
  t.appendChild(el(`<div class="th"><span>컬럼 이름</span><span>실제 컬럼명</span><span>형식</span><span>필수</span><span>설명 · 검증</span></div>`));
  d.cols.forEach(col => {
    const tests = TESTS.filter(x => x.target === d.id && x.col === col[0]);
    t.appendChild(el(`<div class="tr static" style="min-height:42px">
      <span class="b6 trunc">${esc(col[1])}</span>
      <span class="mono t12 mut trunc">${esc(col[0])}</span>
      <span class="t12 mut">${esc(col[2])}</span>
      <span class="t12">${col[3] === '필수' ? '필수' : '<span class="fnt">선택</span>'}</span>
      <span class="t12 mut trunc">${tests.length ? tests.map(x => `<span class="bdg ${x.status === 'ok' ? 'mute' : x.status}">${esc(x.title)}</span>`).join(' ') : '<span class="fnt">—</span>'}</span>
    </div>`));
  });
  return c;
}

function tabPreview(d) {
  const c = el(`<section class="card"><div class="card-h"><span class="card-t">데이터 미리보기</span>
    <span class="t12 fnt">상위 ${d.prev.length}건 · 전체 ${esc(d.rows)}건</span>
    <button class="btn sm sp">${ic14('down')}CSV 내려받기</button></div>
    <div class="card-b tight" style="overflow:auto"><div class="tbl" style="--cols:${d.cols.map(() => 'minmax(120px,1fr)').join(' ')};min-width:100%"></div></div></section>`);
  const t = $('.tbl', c);
  t.appendChild(el(`<div class="th">${d.cols.map(col => `<span title="${esc(col[0])}">${esc(col[1])}</span>`).join('')}</div>`));
  d.prev.forEach(row => t.appendChild(el(`<div class="tr static" style="min-height:38px">${row.map(v => `<span class="mono t12 trunc">${esc(v)}</span>`).join('')}</div>`)));
  return c;
}

function tabFlow(d) {
  const chain = [];
  (function up(id, depth) {
    const n = byId(id); if (!n || depth > 4) return;
    (n.up || []).forEach(u => up(u, depth + 1));
    if (!chain.includes(id)) chain.push(id);
  })(d.id, 0);
  const dn = downOf(d.id);
  const w = el(`<div class="col g14"></div>`);
  w.appendChild(el(`<div class="note info">${ic('info')}<span>이 데이터가 <b>어떤 원천에서 어떤 단계를 거쳐</b> 만들어지는지 보여줍니다.
    ${S.showTech ? '기술 정보를 켜면 실제 테이블명과 데이터 모델 SQL을 함께 볼 수 있습니다.' : '기술 정보를 켜면 실제 테이블명과 SQL도 볼 수 있습니다.'}</span></div>`));

  const flow = el(`<section class="card"><div class="card-h"><span class="card-t">데이터 생성 흐름</span>
    <span class="t12 fnt sp">앞 단계 ${chain.length - 1}개 · 다음 단계 ${dn.length}개</span></div>
    <div class="card-b col g6"></div></section>`);
  const fb = $('.card-b', flow);
  chain.forEach((id, i) => {
    const n = byId(id), cur = id === d.id;
    fb.appendChild(el(`<div class="row g8" style="padding:9px 11px;border:1px solid ${cur ? 'var(--pri)' : 'var(--line)'};
        border-radius:8px;background:${cur ? 'var(--pri-soft)' : 'var(--surface)'}">
      <span class="swatch" style="background:${LAYER[n.layer].color}"></span>
      ${layerTag(n.layer)}
      <span class="b6 ${cur ? '' : ''}">${esc(n.name)}</span>
      ${S.showTech ? `<span class="sub">${esc(n.phys)}</span>` : ''}
      ${cur ? '<span class="bdg pri sp">지금 보는 데이터</span>' : `<span class="t11 fnt sp">${esc(n.updated)}</span>`}
    </div>`));
    if (i < chain.length - 1) fb.appendChild(el(`<div style="padding-left:18px;color:var(--faint)">${ic14('chevd')}</div>`));
  });
  if (dn.length) {
    fb.appendChild(el(`<div class="t11 fnt" style="padding-top:6px">이 데이터를 사용하는 다음 단계</div>`));
    dn.forEach(n => {
      const b = el(`<button class="row g8" style="padding:8px 11px;border:1px dashed var(--line);border-radius:8px;background:none;cursor:pointer;text-align:left">
        ${layerTag(n.layer)}<span class="b6">${esc(n.name)}</span>${S.showTech ? `<span class="sub">${esc(n.phys)}</span>` : ''}${ic14('chev', 'fnt sp')}</button>`);
      b.onclick = () => go('catalog', n.id);
      fb.appendChild(b);
    });
  }
  w.appendChild(flow);

  if (S.showTech && d.sql) {
    w.appendChild(el(`<section class="card"><div class="card-h"><span class="card-t">데이터 모델 SQL</span>
      <span class="sub sp">${esc(d.phys)}</span></div>
      <div class="card-b"><div class="code">${hlSQL(d.sql)}</div></div></section>`));
  }
  return w;
}

function tabQualityOf(d) {
  const tests = TESTS.filter(x => x.target === d.id);
  const w = el(`<div class="col g14"></div>`);
  if (!tests.length) { w.appendChild(el(`<section class="card"><div class="card-b"><div class="empty">${ic('shield')}
    <span class="empty-t">등록된 검증 규칙이 없습니다.</span><span>데이터 모델의 품질 규칙 탭에서 추가할 수 있습니다.</span></div></div></section>`)); return w; }
  tests.forEach(x => w.appendChild(qualityCard(x, true)));
  return w;
}


function hlSQL(sql) {
  return esc(sql)
    .replace(/(--[^\n]*)/g, '<span class="c">$1</span>')
    .replace(/\b(select|from|where|group by|order by|join|left join|inner join|on|as|case|when|then|else|end|with|and|or|not|is|null|count|sum|avg|distinct|cast|upper|lower|trim|coalesce)\b/gi, '<span class="k">$1</span>')
    .replace(/(\{\{\s*(?:ref|source)\([^}]*\)\s*\}\})/g, '<span class="r">$1</span>')
    .replace(/('[^']*')/g, '<span class="s">$1</span>');
}
