/* 사용: node loadorder.js — 로드 순서 위반을 찾는다 (읽기만, 고치지 않음).
 *
 * 함정: 사슬을 접다 보면 어떤 이름의 정의가 뒤쪽 파일 하나에만 남는다.
 * 그런데 앞쪽 파일이 «로드 중에» 그 이름을 부르고 있으면, 그 시점에는 아직
 * 정의가 없어 ReferenceError 로 그 파일의 나머지가 통째로 죽는다.
 * 화면은 멀쩡해 보이는데 콘솔에만 찍히므로 눈으로는 놓치기 쉽다.
 *
 * 로드 중 실행되는 코드 = 최상위 문 중 정의가 아닌 것 + 최상위 IIFE 의 본문.
 */
const acorn = require('acorn'), fs = require('fs');
const FILES = [...Array(53).keys()].map(i => `ui/js/b${String(i).padStart(2,'0')}.js`).concat(['ui/js/api.js']);

const defAt = {};        // 이름 -> 처음 정의된 파일 순번
const rootByFile = {};   // 파일 -> 로드 중 실행되는 코드 텍스트

FILES.forEach((f, idx) => {
  const src = fs.readFileSync(f, 'utf8');
  const ast = acorn.parse(src, {ecmaVersion: 2022});
  let root = '';
  const note = (n) => { if (defAt[n] === undefined) defAt[n] = idx; };
  const iife = (node) => {
    if (node.type !== 'ExpressionStatement') return null;
    let e = node.expression;
    if (e.type === 'UnaryExpression') e = e.argument;
    return (e.type === 'CallExpression'
            && (e.callee.type === 'FunctionExpression' || e.callee.type === 'ArrowFunctionExpression')
            && e.callee.body.type === 'BlockStatement') ? e.callee.body : null;
  };
  const scan = (body) => {
    for (const node of body) {
      if (node.type === 'FunctionDeclaration') { note(node.id.name); continue; }
      if (node.type === 'VariableDeclaration') {
        node.declarations.forEach(d => { if (d.id.type === 'Identifier') note(d.id.name); });
        root += src.slice(node.start, node.end) + '\n';       // 초기화식은 로드 중 실행된다
        continue;
      }
      if (node.type === 'ExpressionStatement' && node.expression.type === 'AssignmentExpression'
          && node.expression.operator === '=' && node.expression.left.type === 'Identifier') {
        note(node.expression.left.name);
        continue;                                              // 값이 함수면 본문은 나중 실행
      }
      const b = iife(node);
      if (b) { scan(b.body); continue; }
      root += src.slice(node.start, node.end) + '\n';
    }
  };
  scan(ast.body);
  rootByFile[f] = root;
});

let bad = 0;
FILES.forEach((f, idx) => {
  const root = rootByFile[f];
  for (const [name, at] of Object.entries(defAt)) {
    if (at <= idx) continue;                                   // 이미 정의됨
    const re = new RegExp(`(?<![\\w$.])${name.replace(/\$/g, '\\$')}\\s*\\(`);
    if (re.test(root)) {
      const line = root.split(re)[0].split('\n').length;
      console.log(`!! ${f} 이(가) 로드 중에 ${name}() 을 부른다 — 정의는 ${FILES[at]} 에만 있다`);
      bad++;
    }
  }
});
console.log(bad ? `\n로드 순서 위반 ${bad}건 — 부르는 쪽을 지우거나 정의를 앞으로 옮길 것` : '로드 순서 위반 없음');
