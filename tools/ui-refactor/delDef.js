/* 사용: node delDef.js <파일> <이름> <몇번째(0부터)> — acorn 구간으로 최상위 정의 하나를 정확히 삭제 */
const acorn = require('acorn'), fs = require('fs');
const [file, name, idxStr] = process.argv.slice(2);
const idx = Number(idxStr || 0);
const src = fs.readFileSync(file, 'utf8');
const ast = acorn.parse(src, {ecmaVersion: 2022});
const hits = [];
for (const node of ast.body) {
  if (node.type === 'FunctionDeclaration' && node.id.name === name) hits.push(node);
  else if (node.type === 'ExpressionStatement' && node.expression.type === 'AssignmentExpression'
           && node.expression.left.type === 'Identifier' && node.expression.left.name === name) hits.push(node);
  else if (node.type === 'VariableDeclaration'
           && node.declarations.some(d => d.id.type === 'Identifier' && d.id.name === name)) hits.push(node);
}
if (!hits[idx]) { console.error(`못 찾음: ${file} ${name}[${idx}] (발견 ${hits.length}개)`); process.exit(1); }
const n = hits[idx];
let tail = n.end; while (tail < src.length && (src[tail] === ';' || src[tail] === '\n')) tail++;
fs.writeFileSync(file, src.slice(0, n.start) + src.slice(tail));
console.log(`${file}: ${name}[${idx}] 삭제 (${tail - n.start}자)`);
