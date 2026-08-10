/* ── b17 — ── b17 — v2.2 — 역할 분리를 화면 구조에 반영 ── (index.html 블록에서 기계적 추출, 동작 불변) */

/* ============================================================
   v2.2 — 역할 분리를 화면 구조에 반영
   · 모델링  : 모델 하나의 정의가 기본, 전체 의존 관계는 관계 보기에서
   · 파이프라인 : 실행 설정(대상·일정·환경) + 모델 의존성으로 계산된 읽기 전용 흐름
   ============================================================ */
Object.assign(S, { mView: 'def', pipeView: 'flow' });

/* 모델 의존 관계 — SQL 의 ref()/source() 가 사실상의 정의다 */
function modelDeps(id) {
  const d = byId(id); if (!d || !d.sql) return [];
  return parseRefs(d.sql).filter(x => x !== id);
}
/* 실행 대상만 주면 순서·흐름은 의존 관계로 계산한다 */
/* ────────────────── 데이터 모델링 ────────────────── */
pageModeling = function () {
  /* 정의(def) 화면은 하단 독으로 합쳐졌다(v5.1). 옛 의도는 목적지 탭으로 번역하고
     화면은 항상 관계 그래프다. */
  if (S.mView === 'def') {
    S.dockTab = S.mTab === 'SQL' ? 'sql' : S.mTab === '품질 규칙' ? 'quality' : 'info';
    S.dockMin = false;
    if (S.dockTab !== 'info' && (S.dockH || 0) < 340) S.dockH = dockDefH();
  }
  S.mView = 'graph';

  seedCanvas();
  if (!S.laidOut) { autoLayout(); S.laidOut = true; }
  const r = R(), canEdit = r.canModel;
  if (!S.fitOnce) { S.fitOnce = true; setTimeout(fitCanvasQuiet, 0); }
  const p = el('<div class="page flush"><div class="mod"></div></div>');
  const mod = $('.mod', p);
  mod.appendChild(modelList(r));

  const center = el('<div class="mod-c"></div>');
  const bw = barBudget(), full = bw >= 760, mid = bw >= 620, tiny = bw < 400;
  const L = (a, b) => full ? a : mid ? b : '';
  center.appendChild(el(`<div class="mod-bar">
    <span class="row g8" style="padding-left:14px;min-width:0;flex:1 1 auto;overflow:hidden">
      <span class="b6 t13" style="flex:none">데이터 계보</span>
      <span class="t11 fnt trunc" id="mhCnt"></span>
      <button class="iconbtn" id="mhTgl" style="flex:none;width:24px;height:24px"></button></span>
    <div class="row g6 sp" style="flex:none">
      ${canEdit && !tiny ? `<button class="btn sm" id="mNew" title="새 데이터 모델을 만듭니다.">${ic14('plus')}${L('새 모델', '새 모델')}</button>` : ''}
      ${canEdit ? `<button class="btn sm" id="mSaveAll" disabled title="변경사항이 없습니다.">${ic14('save')}${L('저장', '저장')}</button>` : ''}
      <button class="btn sm" id="mMore" title="보기 옵션 · 삭제">${ic14('chevd')}</button>
    </div></div>`));

  S.view = 'canvas';
  const stage = el('<div class="f1" style="min-height:0;display:flex;flex-direction:column"></div>');
  stage.appendChild(canvasView());
  center.appendChild(stage);
  center.appendChild(dockView());
  mod.appendChild(center);
  mod.appendChild(mpView());

  const on = (id, fn) => { const b = $('#' + id, center); if (b && !b.disabled) b.onclick = fn; };
  on('mNew', openNewModel);
  on('mMore', (ev) => moreMenu(ev.currentTarget, canEdit));

  /* 관계도에서 모델을 골라 파이프라인 만들기 (v5.5) — ⌘/Ctrl 클릭 다중 선택 */
  const btnRow = $('.mod-bar .row.g6.sp', p);
  if (btnRow && R().canPipeEdit) {
    const st = pselState();
    const b = el(`<button class="btn sm" id="mNewPipe" ${st.ok ? '' : 'disabled'}
      title="${esc(st.reason)}">${ic14('plus')}파이프라인 생성</button>`);
    if (st.ok) b.onclick = () => {
      if (!LIN.data) return;
      const { load, read } = pselSplit();
      const order = pselOrdered(LIN.data).filter(id => load.includes(id));
      newPipelineModal(null, order, read);
    };
    btnRow.insertBefore(b, $('#mMore', btnRow));
  }

  /* 제목 옆 개수 — 계보 데이터가 오기 전엔 비워 둔다 */
  const cnt = $('#mhCnt', p);
  if (cnt && LIN.data)
    cnt.textContent = `모델 ${LIN.data.nodes.length}개 · 연결 ${LIN.data.columnEdges.length}개`;

  /* 컬럼 상세 펼치기/접기 — 모드 전환이 아니라 같은 화면의 확장이다.
     기본은 모델 관계만, + 를 누르면 모든 상자가 컬럼까지 펼쳐진다. */
  const tg = $('#mhTgl', p);
  if (tg) {
    const open = S.linMode === 'column';
    tg.innerHTML = ic14(open ? 'minus' : 'plus');
    tg.title = open ? '컬럼 상세 닫기' : '컬럼 상세 보기';
    tg.onclick = () => {
      // 배율·스크롤은 그대로 — 펼침은 맞추기가 아니라 같은 자리의 확장이다.
      S.linMode = open ? 'model' : 'column';
      if (S.linMode === 'model' && S.linSel && S.linSel.col) S.linSel = { id: S.linSel.id };
      render();
    };
  }

  /* 저장 — 대기 중인 변경(설명)을 확정한다. 저장하면 이력이 자동 기록된다(v5.7) */
  const sb = $('#mSaveAll', p);
  if (sb) {
    const dirty = S.sel && S.__dirty[S.sel];
    sb.disabled = !dirty;
    sb.title = dirty ? '변경한 내용을 저장합니다. 저장하면 변경 이력이 자동 기록됩니다.'
                     : '변경사항이 없습니다.';
    sb.onclick = async () => {
      const id = S.sel, d = byId(id), pend = S.__dirty[id];
      if (!d || !pend) return;
      sb.disabled = true;
      try {
        await api('/models/' + enc(id), {
          method: 'PATCH', body: JSON.stringify({ description: pend.desc }),
        });
        d.desc = pend.desc;
        delete S.__dirty[id];
        toast('저장했습니다 — 변경 이력에 기록되었습니다.');
        render();
      } catch (e) { sb.disabled = false; fail(e); }
    };
  }
  return p;
};

/* 왼쪽 모델 목록 — 정의 화면에서는 선택, 관계 화면에서는 캔버스에 추가 */
/* 정의 화면 — 모델 하나를 넓게 편집 */
/* 정의 화면에서는 다시 그릴 때 통째로 렌더한다 */
/* (refreshPanel — 이후 정의가 값 캡처 없이 전면 교체. 죽은 층 제거) */
/* (moreMenu — 이후 정의가 값 캡처 없이 전면 교체. 죽은 층 제거) */
