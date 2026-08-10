/* 사용: node prefix.js [이름] — «마지막 전면 교체» 앞의 죽은 접두 층을 보고만 한다 (삭제 안 함).
 *
 * sweep.js 는 «바로 다음 정의» 하나만 보므로, 사이에 호출이 한 번이라도 있으면
 * (그 호출이 실행 시점에는 최종 정의를 부르는데도) 죽음 판정을 포기한다.
 * 여기서는 사슬 전체를 본다:
 *   1. 이름 X 의 정의 중 «값 표현식이 X 를 참조하지 않는» 것 = 전면 교체.
 *   2. 마지막 전면 교체를 L 이라 하면, L 앞의 정의는 전부 덮인다.
 *   3. 단, L 앞의 코드가 X 를 «값으로» 붙잡아 뒀으면(별칭 · 래퍼 인자) 살아 있다.
 *      값 캡처 = 뒤에 '(' 가 오지 않는 X 언급. 호출 X(...) 은 실행 시점에
 *      최종 정의로 풀리므로 캡처가 아니다.
 * 판정 창에서 X 자신의 정의 구간은 뺀다 — 그 정의들도 함께 죽기 때문이다.
 */
const acorn = require('acorn'), fs = require('fs');
const only = process.argv[2];
const FILES = [...Array(53).keys()].map(i => `ui/js/b${String(i).padStart(2,'0')}.js`).concat(['ui/js/api.js']);

/* 주석은 판정에서 지운다 — 앞선 정리 커밋들이 남긴 «(이름 — 죽은 층 제거)»
   같은 자취가 전부 값 캡처로 잘못 잡히기 때문이다. 공백으로 바꿔 위치는 보존. */
const strip = (src, ast) => {
  const cs = [];
  acorn.parse(src, {ecmaVersion: 2022, onComment: cs});
  let out = src;
  for (const c of cs) out = out.slice(0, c.start) + ' '.repeat(c.end - c.start) + out.slice(c.end);
  return out;
};

const SRC = {}, BARE = {}, OFF = {};
let ALL = '';
for (const f of FILES) {
  SRC[f] = fs.readFileSync(f, 'utf8');
  BARE[f] = strip(SRC[f]);
  OFF[f] = ALL.length; ALL += BARE[f] + '\n';
}
const abs = (f, p) => OFF[f] + p;

const defs = {};
for (const f of FILES) {
  const ast = acorn.parse(SRC[f], {ecmaVersion: 2022});
  for (const node of ast.body) {
    let names = [], value = null;
    if (node.type === 'FunctionDeclaration') { names = [node.id.name]; value = node; }
    else if (node.type === 'ExpressionStatement' && node.expression.type === 'AssignmentExpression'
             && node.expression.operator === '=' && node.expression.left.type === 'Identifier') {
      names = [node.expression.left.name]; value = node.expression.right;
    } else if (node.type === 'VariableDeclaration') {
      for (const d of node.declarations)
        if (d.id.type === 'Identifier')
          (defs[d.id.name] = defs[d.id.name] || []).push({
            file: f, start: node.start, end: node.end, multi: node.declarations.length > 1,
            valueText: d.init ? SRC[f].slice(d.init.start, d.init.end) : '',
            line: SRC[f].slice(0, node.start).split('\n').length });
      continue;
    }
    for (const n of names)
      (defs[n] = defs[n] || []).push({
        file: f, start: node.start, end: node.end, multi: false,
        valueText: SRC[f].slice(value.start, value.end),
        line: SRC[f].slice(0, node.start).split('\n').length });
  }
}

const esc = (n) => n.replace(/\$/g, '\\$');
const mentions = (n, t) => new RegExp(`(?<![\\w$.])${esc(n)}(?![\\w$])`).test(t);
const captures = (n, t) => new RegExp(`(?<![\\w$.])${esc(n)}(?![\\w$])\\s*(?!\\()`).test(t);

let total = 0;
for (const [name, sites] of Object.entries(defs)) {
  if (only && name !== only) continue;
  if (sites.length < 2) continue;
  // 파일 순서대로
  sites.sort((a, b) => abs(a.file, a.start) - abs(b.file, b.start));
  // 마지막 전면 교체
  let L = -1;
  for (let i = sites.length - 1; i >= 0; i--)
    if (!sites[i].multi && !mentions(name, sites[i].valueText)) { L = i; break; }
  if (L <= 0) continue;

  // 창 = L 앞의 전체 소스에서 이 이름의 정의 구간을 뺀 것
  const cut = sites.slice(0, L + 1)
    .map(s => [abs(s.file, s.start), abs(s.file, s.end)])
    .sort((a, b) => a[0] - b[0]);
  let win = '', at = 0;
  const end = abs(sites[L].file, sites[L].start);
  for (const [a, b] of cut) { if (a >= end) break; win += ALL.slice(at, Math.min(a, end)); at = Math.max(at, b); }
  if (at < end) win += ALL.slice(at, end);

  const held = captures(name, win);
  const dead = sites.slice(0, L);
  total += held ? 0 : dead.length;
  console.log(`${held ? '보류' : '죽음'} ${String(dead.length).padStart(2)}겹  ${name.padEnd(20)} ` +
    dead.map(s => `${s.file.replace('ui/js/','').replace('.js','')}:${s.line}`).join(' ') +
    `  → 최종 ${sites[L].file.replace('ui/js/','').replace('.js','')}:${sites[L].line}` +
    (held ? `  (앞에서 값으로 붙잡음 — 손으로 확인할 것)` : ''));
}
console.log(`\n죽은 접두 층 합계 ${total}겹`);
