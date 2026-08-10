const acorn = require('acorn'), fs = require('fs');
const name = process.argv[2];
const FILES = [...Array(53).keys()].map(i => `ui/js/b${String(i).padStart(2,'0')}.js`).concat(['ui/js/api.js']);
for (const f of FILES) {
  const src = fs.readFileSync(f, 'utf8');
  let ast; try { ast = acorn.parse(src, {ecmaVersion: 2022}); } catch (e) { console.log(`!! ${f} 파싱 실패: ${e.message}`); continue; }
  for (const node of ast.body) {
    let hit = null;
    if (node.type === 'FunctionDeclaration' && node.id.name === name) hit = node;
    else if (node.type === 'ExpressionStatement' && node.expression.type === 'AssignmentExpression'
             && node.expression.left.type === 'Identifier' && node.expression.left.name === name) hit = node;
    else if (node.type === 'VariableDeclaration')
      for (const d of node.declarations)
        if (d.id.type === 'Identifier' && d.id.name === name) hit = node;
    if (hit) {
      const line = src.slice(0, hit.start).split('\n').length;
      console.log(`\n══════════ ${f}:${line} (${hit.end - hit.start}자) ══════════`);
      console.log(src.slice(hit.start, hit.end));
    }
  }
}
