/* ── b40 — ── b40 — v2.7 — dbt DAG 의미에 맞춘 실행 : SOURCE 는 참조만 한다 ── (index.html 블록에서 기계적 추출, 동작 불변) */

/* ============================================================
   v2.7 — dbt DAG 의미에 맞춘 실행 : SOURCE 는 참조만 한다
   ============================================================ */
Object.assign(RUNST, {
  srcok:   { label: '원천 · 최신', icon: 'db', tone: 'mute' },
  srcwarn: { label: '원천 · 지연', icon: 'alert', tone: 'warn' },
});

/* 병원 방문 데이터 수집 은 원천만 있던 파이프라인 —
   dbt DAG 가 되도록 정제 모델을 붙인다 */
if (!byId('stg_visit')) {
  D.push({ id: 'stg_visit', name: '병원 방문 정제', phys: 'staging.stg_visit', layer: '정제', kind: 'model',
    desc: '병원 방문 원천에서 방문번호가 비었거나 중복인 행을 걸러낸 정제 데이터입니다.',
    owner: '이지훈', team: '데이터플랫폼팀', updated: '오늘 09:02', freq: '1시간마다', rows: '1,881,900',
    quality: 'ok', certified: false, usable: true, fav: false, mat: 'View', tags: ['정제', '방문'],
    cols: [['visit_id', '방문번호', 'STRING', '필수'], ['patient_id', '환자번호', 'STRING', '필수'],
           ['visit_dt', '방문일자', 'DATE', '필수'], ['visit_type', '방문구분', 'STRING', '선택'],
           ['dept_cd', '진료과코드', 'STRING', '선택']],
    prev: [['V20260803A0091', 'P00012841', '2026-08-03', '외래', 'IM']],
    sql: "select\n    visit_id,\n    patient_id,\n    visit_dt,\n    visit_type,\n    dept_cd\nfrom {{ source('raw_hospital', 'hospital_visit') }}\nwhere visit_id is not null" });
}
(function () {
  const pv = PIPES.find(x => x.id === 'pl_visit');
  if (pv) { pv.name = '병원 방문 데이터 정제'; pv.targets = ['stg_visit']; pv.graph = null; pv.rg = null; pv.__rsig = null; }
  const g = WSGROUPS.find(w => w.id === 'ws_ingest'); if (g) g.name = '방문 데이터';
})();

/* 모델 실행 상세 — SOURCE 를 고르면 실행 정보 대신 최신성 정보를 보여준다 */
/* (pipeDock — 도달 불가. 실행 흐름은 SOURCE 선택을 매 렌더마다 지우므로
   (pagePipeline 의 «실행 흐름에서는 SOURCE 를 고를 수 없다») 이 층의 조건
   d.kind === 'source' 가 참이 되는 순간이 없다. 실측으로도 SOURCE 카드를 누르면
   S.pipeNodeK 가 null 로 돌아가 «흐름도에서 모델을 선택해 주세요» 가 뜬다. 제거) */
HELP.pipeline.items = [
  'SOURCE 와 DATA MODEL 을 캔버스에 놓고 연결해 가공 흐름을 만듭니다.',
  '실행 대상은 DATA MODEL 뿐입니다. SOURCE 는 참조만 하며 최신성 검사로 지연을 확인합니다.',
  '실행 순서는 연결 관계(DAG)에서 자동으로 계산됩니다.',
  '실행 설정 에서 일정·환경·재시도·알림을 정합니다.',
  '실행 흐름 에서 모델별 상태·실행 SQL·로그·품질 결과를 확인합니다.',
  '새 가공 로직이 필요하면 연결선이 아니라 데이터 모델에서 새 모델을 만들어 가져옵니다.'];
