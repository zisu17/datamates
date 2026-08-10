/* ── b05 — ── b05 — 4. 데이터 파이프라인   5. 데이터 품질   6. 설정 ── (index.html 블록에서 기계적 추출, 동작 불변) */

/* ============================================================
   4. 데이터 파이프라인   5. 데이터 품질   6. 설정
   ============================================================ */
/* (pagePipeline — 이후 정의가 값 캡처 없이 전면 교체. 죽은 층 제거) */
/* (pagePipeDetail — 이후 정의가 값 캡처 없이 전면 교체. 죽은 층 제거) */
/* ── 5. 데이터 품질 ── */
/* (pageQuality — 이후 정의가 값 캡처 없이 전면 교체. 죽은 층 제거) */
function qualityCard(t, tech) {
  const target = byId(t.target) || { name: t.target };
  const tone = t.status === 'err' ? 'err' : t.status === 'warn' ? 'warn' : 'ok';
  const open = !!S.qOpen[t.id];
  const hasDetail = (t.rows && t.rows.length) || tech;
  const c = el(`<section class="card" style="border-left:3px solid var(--${tone})">
    <div class="card-h">
      <span style="color:var(--${tone})">${ic(t.status === 'err' ? 'xc' : t.status === 'warn' ? 'alert' : 'checkc')}</span>
      <span class="card-t">${esc(t.title)}</span>
      <span class="tag" title="${esc(target.name)} · ${esc(t.col)}">${esc(target.name)} · ${esc(t.col)}</span>
      ${t.cnt ? `<span class="bdg ${t.status}">${t.cnt}건</span>` : '<span class="bdg ok">이상 없음</span>'}
      </div>
    <div class="card-b col g10" style="gap:8px">
      <p style="margin:0;line-height:1.65">${esc(t.plain)}${t.impact ? `<br><span class="mut">${esc(t.impact)}</span>` : ''}</p>
      ${hasDetail ? `<button class="acc-t ${open ? 'open' : ''}" data-acc="${t.id}">${ic14('chev')}
        <span>${open ? '상세 접기' : '실패 데이터 예시와 기술 정보 보기'}</span></button>` : ''}
      ${hasDetail && open ? `<div class="acc-b col g10">
        ${t.rows && t.rows.length ? `<div class="col g4"><span class="sect-t">실패 데이터 예시</span>
          <div class="code light" style="max-height:110px">${esc(t.rows.map(r => r.join('   ')).join('\n'))}</div></div>` : ''}
        ${tech ? `<div class="col g4"><span class="sect-t">기술 정보 · 데이터 엔지니어용</span>
          <div class="kv"><div class="kv-r"><span class="kv-k">검증 유형</span><span class="kv-v mono t12">${esc(t.dbt)}</span></div>
            <div class="kv-r"><span class="kv-k">심각도</span><span class="kv-v mono t12">severity: ${esc(t.sev)}</span></div>
            <div class="kv-r"><span class="kv-k">대상</span><span class="kv-v mono t12">${esc((byId(t.target) || {}).phys || '')}.${esc(t.col)}</span></div></div>
        </div>` : ''}
      </div>` : ''}
      <div class="row g6" style="border-top:1px solid var(--line-2);padding-top:9px">
        <button class="btn pri sm" data-go="${t.target}">데이터 보기</button>
        <button class="btn sm" data-re="${t.id}">${ic14('rot')}다시 검증</button>
      </div>
    </div></section>`);
  $$('[data-go]', c).forEach(b => b.onclick = () => go('catalog', b.dataset.go));
  $$('[data-re]', c).forEach(b => b.onclick = () => toast('다시 검증했습니다. 결과는 곧 반영됩니다.'));
  $$('[data-acc]', c).forEach(b => b.onclick = () => { S.qOpen[b.dataset.acc] = !S.qOpen[b.dataset.acc]; render(); });
  return c;
}

/* ── 6. 설정 ── */
/* 시작은 v1.2 확장 블록 끝에서 수행한다 */
