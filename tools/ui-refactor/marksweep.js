const acorn = require('acorn'), fs = require('fs');
const FILES = [...Array(53).keys()].map(i => `ui/js/b${String(i).padStart(2,'0')}.js`).concat(['ui/js/api.js']);
const SRC = {}; FILES.forEach(f => SRC[f] = fs.readFileSync(f, 'utf8'));

// 최상위 정의 노드들과, 정의가 아닌 최상위 문(=루트 코드)을 가른다
const defNodes = {};        // name -> [{file,start,end,text,multi}]
let rootText = '';          // 로드 시 실행되는 비정의 문 전부
for (const f of FILES) {
  const ast = acorn.parse(SRC[f], {ecmaVersion: 2022});
  for (const node of ast.body) {
    let names = [];
    if (node.type === 'FunctionDeclaration') names = [node.id.name];
    else if (node.type === 'ExpressionStatement' && node.expression.type === 'AssignmentExpression'
             && node.expression.operator === '=' && node.expression.left.type === 'Identifier')
      names = [node.expression.left.name];
    else if (node.type === 'VariableDeclaration')
      names = node.declarations.filter(d => d.id.type === 'Identifier').map(d => d.id.name);
    const text = SRC[f].slice(node.start, node.end);
    if (names.length) {
      for (const n of names)
        (defNodes[n] = defNodes[n] || []).push({file: f, start: node.start, end: node.end, text, multi: names.length > 1, siblings: names});
    } else rootText += text + '\n';
  }
}

// $ 는 \w 가 아니라 \b 가 안 걸린다 — 식별자 문자( [\w$] ) 기준 경계로 직접 본다
const mention = (name, text) => new RegExp(`(?<![\\w$])${name.replace(/\$/g,'\\$')}(?![\\w$])`).test(text);
const names = Object.keys(defNodes);

// mark — 루트 코드에서 시작해 정의 본문을 타고 전파
const live = new Set();
let frontier = names.filter(n => mention(n, rootText));
while (frontier.length) {
  const next = [];
  for (const n of frontier) {
    if (live.has(n)) continue;
    live.add(n);
    const body = defNodes[n].map(d => d.text).join('\n');
    for (const m of names) if (!live.has(m) && mention(m, body)) next.push(m);
  }
  frontier = next;
}
const deadNames = names.filter(n => !live.has(n) && !defNodes[n].some(d => d.multi));
console.log(`이름 ${names.length}개 중 도달 ${live.size} · 제거 대상 ${deadNames.length}`);
console.log('제거:', deadNames.join(', ') || '(없음)');

// sweep
const spans = [];
for (const n of deadNames) for (const d of defNodes[n]) spans.push({...d, name: n});
const byFile = {};
spans.forEach(d => (byFile[d.file] = byFile[d.file] || []).push(d));
let lines = 0;
for (const [f, list] of Object.entries(byFile)) {
  let s = SRC[f];
  const uniq = [...new Map(list.map(d => [d.start, d])).values()];
  for (const d of uniq.sort((a, b) => b.start - a.start)) {
    let tail = d.end; while (tail < s.length && (s[tail] === ';' || s[tail] === '\n')) tail++;
    lines += s.slice(d.start, tail).split('\n').length - 1;
    s = s.slice(0, d.start) + s.slice(tail);
  }
  fs.writeFileSync(f, s);
}
console.log(`약 ${lines}줄 제거`);
