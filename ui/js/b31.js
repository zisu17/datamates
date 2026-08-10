/* ── b31 — ── b31 — v2.5 — 데이터 모델(= SQL 하나) 과 데이터 파이프라인(= 흐름 구성) 의 역할 분리 ── (index.html 블록에서 기계적 추출, 동작 불변) */

/* ============================================================
   v2.5 — 데이터 모델(= SQL 하나) 과 데이터 파이프라인(= 흐름 구성) 의 역할 분리
   ============================================================ */

/* ── 1. 용어 : 분류는 SOURCE / DATA MODEL 두 가지뿐 ── */
const KINDC = { 'SOURCE': '#94A3B8', 'DATA MODEL': '#6366F1' };
const grpOf = (x) => { const d = typeof x === 'string' ? byId(x) : x; return (d && d.kind === 'source') ? 'SOURCE' : 'DATA MODEL'; };
const grpColor = (x) => KINDC[grpOf(x)];
LAYER['원천'].color = KINDC['SOURCE'];
LAYER['정제'].color = LAYER['분석용'].color = KINDC['DATA MODEL'];
LAYER['원천'].tech = 'source'; LAYER['정제'].tech = LAYER['분석용'].tech = 'model';
layerTag = function (l) {
  const g = l === '원천' ? 'SOURCE' : 'DATA MODEL';
  return `<span class="kindt" style="background:${KINDC[g]}1F;color:${KINDC[g]}">${g}</span>`;
};
MENUS.forEach(m => { if (m.id === 'modeling') m.label = '데이터 모델'; });
HELP.modeling.t = '데이터 모델';
HELP.modeling.items = [
  '하나의 SQL로 하나의 데이터 모델을 정의합니다. 출력 테이블도 하나입니다.',
  '왼쪽 카탈로그 는 SOURCE 와 DATA MODEL 두 가지로만 나뉩니다.',
  '모델을 고르면 기본 정보·입력 데이터·변환·컬럼·SQL·품질 규칙을 탭으로 설정합니다.',
  'SQL 안에서는 CTE 를 여러 개 쓸 수 있지만, 문장과 출력은 하나여야 합니다.',
  '관계 보기는 SOURCE 와 DATA MODEL 의 참조 관계와 데이터 계보를 보여줍니다.',
  '실행은 하지 않습니다. 실행 흐름은 데이터 파이프라인에서 구성합니다.'];
HELP.pipeline.t = '데이터 파이프라인';
HELP.pipeline.items = [
  'SOURCE 와 DATA MODEL 을 캔버스에 놓고 연결해 가공 흐름을 만듭니다.',
  '카드의 오른쪽 점을 다음 카드로 끌면 연결됩니다. 같은 모델을 여러 번 놓을 수 있습니다.',
  '실행 순서는 연결 관계에서 자동으로 계산됩니다.',
  '실행 설정 에서 일정·환경·재시도·알림을 정합니다.',
  '실행 흐름 에서 모델별 상태·실행 SQL·로그·품질 결과를 확인합니다.',
  '새 가공 로직이 필요하면 연결선이 아니라 데이터 모델에서 새 모델을 만들어 가져옵니다.'];

/* 남아 있는 데이터 모델링 표기를 한 번에 정리한다 */
function fixTerms(root) {
  if (!root) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const hit = [];
  while (w.nextNode()) if (w.currentNode.nodeValue.includes('데이터 모델링')) hit.push(w.currentNode);
  hit.forEach(n => { n.nodeValue = n.nodeValue.replace(/데이터 모델링/g, '데이터 모델'); });
  $$('[title*="데이터 모델링"]', root).forEach(n => n.title = n.title.replace(/데이터 모델링/g, '데이터 모델'));
}
/* (modal — fixTerms(scrim) 한 줄을 b01 본체 return 앞으로 옮겼다. 제거) */
/* ── 2. 모델 = SQL 하나 ── */
const MODEL_RULE = '하나의 SQL로 하나의 데이터 모델을 정의합니다.';
function sqlAudit(sql) {
  const s = String(sql || '');
  const body = s.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
  const stmts = body.split(';').map(x => x.trim()).filter(Boolean);
  const cte = (body.match(/\bwith\b|\)\s*,\s*[a-z_][\w]*\s+as\s*\(/gi) || []).length;
  const cteNames = [...body.matchAll(/(?:with|,)\s+([a-z_][\w]*)\s+as\s*\(/gi)].map(m => m[1]);
  const ddl = /\b(insert\s+into|create\s+table|create\s+view|drop\s+|merge\s+into|update\s+\w+\s+set|delete\s+from)\b/i.exec(body);
  const selects = (body.match(/\bselect\b/gi) || []).length;
  return { stmts: stmts.length, cte: cteNames.length, cteNames, ddl: ddl && ddl[0].trim(), selects };
}
/* (checkSql — 이후 정의가 값 캡처 없이 전면 교체. 죽은 층 제거) */
/* ── 3. 카탈로그 : SOURCE / DATA MODEL ── */
/* (modelList — 이후 정의가 값 캡처 없이 전면 교체. 죽은 층 제거) */
/* 정의 화면 머리말에 규칙 한 줄 */
/* 구분 을 SOURCE / DATA MODEL 로 */
