const acorn = require('acorn'), fs = require('fs');
const FILES = [...Array(53).keys()].map(i => `ui/js/b${String(i).padStart(2,'0')}.js`).concat(['ui/js/api.js']);
const SRC = {}; FILES.forEach(f => SRC[f] = fs.readFileSync(f, 'utf8'));
const ORDER = {}; FILES.forEach((f, i) => ORDER[f] = i);

function topDefs() {
  const defs = {};
  for (const f of FILES) {
    const ast = acorn.parse(SRC[f], {ecmaVersion: 2022});
    for (const node of ast.body) {
      let names = [];
      if (node.type === 'FunctionDeclaration') names = [[node.id.name, 'fn']];
      else if (node.type === 'ExpressionStatement' && node.expression.type === 'AssignmentExpression'
               && node.expression.operator === '=' && node.expression.left.type === 'Identifier')
        names = [[node.expression.left.name, 'assign']];
      else if (node.type === 'VariableDeclaration')
        names = node.declarations.filter(d => d.id.type === 'Identifier').map(d => [d.id.name, node.kind]);
      for (const [n, kind] of names)
        (defs[n] = defs[n] || []).push({file: f, start: node.start, end: node.end, kind,
                                        multi: names.length > 1});
    }
  }
  for (const n in defs) defs[n].sort((a, b) => (ORDER[a.file] - ORDER[b.file]) || (a.start - b.start));
  return defs;
}

const defs = topDefs();
const mentions = (name, text) => (text.match(new RegExp(`\\b${name.replace(/\$/g,'\\$')}\\b`, 'g')) || []).length;

const dead = [];
for (const [name, sites] of Object.entries(defs)) {
  if (sites.length < 2) continue;
  for (let k = 0; k < sites.length - 1; k++) {
    const cur = sites[k], nxt = sites[k + 1];
    if (cur.multi) continue;                       // 형제 선언 있는 건 안 지운다
    let win = '';
    if (cur.kind === 'fn') win += SRC[cur.file].slice(0, cur.start);   // 호이스팅 — 같은 파일 앞부분도 캡처 창
    if (cur.file === nxt.file) win += SRC[cur.file].slice(cur.end, nxt.end);
    else {
      win += SRC[cur.file].slice(cur.end);
      for (let i = ORDER[cur.file] + 1; i < ORDER[nxt.file]; i++) win += SRC[FILES[i]];
      win += SRC[nxt.file].slice(0, nxt.end);
    }
    const inNext = mentions(name, SRC[nxt.file].slice(nxt.start, nxt.end));
    // 다음 정의가 순수 교체(자기 이름 1회 = 좌변)일 때만, 창 전체 언급이 그 1회뿐이면 죽음
    if (mentions(name, win) === inNext && inNext === 1)
      dead.push({name, ...cur});
  }
}
console.log(`DEAD ${dead.length}개`);

// 삭제 (파일별 역순) — acorn 최상위 노드 구간이라 겹칠 수 없다
const byFile = {};
dead.forEach(d => (byFile[d.file] = byFile[d.file] || []).push(d));
let lines = 0;
for (const [f, list] of Object.entries(byFile)) {
  let s = SRC[f];
  for (const d of list.sort((a, b) => b.start - a.start)) {
    let tail = d.end; while (tail < s.length && (s[tail] === ';' || s[tail] === '\n')) tail++;
    lines += s.slice(d.start, tail).split('\n').length - 1;
    s = s.slice(0, d.start) + `/* (${d.name} — 이후 정의가 값 캡처 없이 전면 교체. 죽은 층 제거) */\n` + s.slice(tail);
  }
  fs.writeFileSync(f, s);
}
console.log(`약 ${lines}줄 제거`);

// 불변식: 살아있어야 할 정의는 전부 남아 있어야 한다
FILES.forEach(f => SRC[f] = fs.readFileSync(f, 'utf8'));
const after = topDefs();
let bad = 0;
for (const [name, sites] of Object.entries(defs)) {
  const expect = sites.length - dead.filter(d => d.name === name).length;
  const got = (after[name] || []).length;
  if (got !== expect) { console.log(`!! ${name}: 기대 ${expect} 실제 ${got}`); bad++; }
}
console.log(bad ? `불변식 위반 ${bad}건 — 되돌릴 것!` : "불변식 통과 — 살아있는 정의 전부 보존됨");
