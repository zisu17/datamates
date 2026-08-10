const acorn = require('acorn'), fs = require('fs');
const FILES = [...Array(53).keys()].map(i => `ui/js/b${String(i).padStart(2,'0')}.js`).concat(['ui/js/api.js']);
const defs = {};   // name -> [{file, line}]
for (const f of FILES) {
  const src = fs.readFileSync(f, 'utf8');
  const ast = acorn.parse(src, {ecmaVersion: 2022});
  const add = (name, node) => {
    (defs[name] = defs[name] || []).push(`${f.replace('ui/js/','').replace('.js','')}:${src.slice(0,node.start).split('\n').length}`);
  };
  for (const node of ast.body) {
    if (node.type === 'FunctionDeclaration') add(node.id.name, node);
    else if (node.type === 'ExpressionStatement' && node.expression.type === 'AssignmentExpression'
             && node.expression.operator === '=' && node.expression.left.type === 'Identifier')
      add(node.expression.left.name, node);
    else if (node.type === 'VariableDeclaration')
      for (const d of node.declarations) if (d.id.type === 'Identifier') add(d.id.name, node);
  }
}
const multi = Object.entries(defs).filter(([,v]) => v.length >= 2).sort((a,b) => b[1].length - a[1].length);
console.log(`전역 이름 ${Object.keys(defs).length}개 · 다중 정의 ${multi.length}개`);
for (const [k, v] of multi) console.log(`${String(v.length).padStart(2)}× ${k.padEnd(22)} ${v.join(' ')}`);

