'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { criar } = require('./auxiliar');

const ID = 'sem-config-do-codescene';
const REGRAS_DIR = path.join(__dirname, '..');
const PRE_COMMIT = path.join(REGRAS_DIR, '..', '..', '.githooks', 'pre-commit');
const REGRAS_DO_CODESCENE = '{"rules":[]}\n';

function tentar(base, ramo, ...regra) {
  const repo = criar(base);
  repo.escrever(ramo);
  const resultado = repo.rodar('--regra', regra[0] || ID);
  repo.limpar();
  return resultado;
}

test('a regra está registrada em verificar.js e no pre-commit', () => {
  const { REGRAS } = require('../verificar');
  assert.ok(REGRAS.some(regra => regra.id === ID));
  assert.match(fs.readFileSync(PRE_COMMIT, 'utf8'), new RegExp(`--regra ${ID}\\b`));
});

test('falha: .codescene/code-health-rules.json novo', () => {
  const r = tentar({}, { '.codescene/code-health-rules.json': REGRAS_DO_CODESCENE });
  assert.equal(r.codigo, 1, r.saida);
  assert.match(r.saida, new RegExp(`✗ ${ID}`));
  assert.match(r.saida, /\.codescene\/code-health-rules\.json/);
});

test('passa: o mesmo ramo sem a configuração', () => {
  const r = tentar({}, { 'app/a.js': 'module.exports = { a: 1 };\n' });
  assert.equal(r.codigo, 0, r.saida);
});

test('falha: qualquer arquivo sob .codescene/, em qualquer profundidade', () => {
  const r = tentar({}, { '.codescene/outro.txt': 'x\n', '.codescene/a/b/c.md': 'x\n' });
  assert.equal(r.codigo, 1);
  assert.match(r.saida, /\.codescene\/outro\.txt/);
  assert.match(r.saida, /\.codescene\/a\/b\/c\.md/);
});

test('falha: code-health-rules.json em qualquer pasta, inclusive na raiz', () => {
  const r = tentar({}, { 'code-health-rules.json': REGRAS_DO_CODESCENE, 'app/x/code-health-rules.json': REGRAS_DO_CODESCENE });
  assert.equal(r.codigo, 1);
  assert.match(r.saida, /code-health-rules\.json: /);
  assert.match(r.saida, /app\/x\/code-health-rules\.json/);
});

test('falha: arquivo que já existia e é mudado', () => {
  const r = tentar({ '.codescene/code-health-rules.json': REGRAS_DO_CODESCENE }, { '.codescene/code-health-rules.json': '{"rules":[1]}\n' });
  assert.equal(r.codigo, 1);
});

test('falha: arquivo renomeado para dentro de .codescene/ ou para code-health-rules.json', () => {
  const repo = criar({ 'docs/regras.json': REGRAS_DO_CODESCENE, 'docs/outras.json': REGRAS_DO_CODESCENE });
  repo.git('mv', 'docs/regras.json', 'docs/code-health-rules.json');
  fs.mkdirSync(path.join(repo.raiz, '.codescene'));
  repo.git('mv', 'docs/outras.json', '.codescene/outras.json');
  const r = repo.rodar('--regra', ID);
  repo.limpar();
  assert.equal(r.codigo, 1, r.saida);
  assert.match(r.saida, /docs\/code-health-rules\.json: /);
  assert.match(r.saida, /\.codescene\/outras\.json: /);
});

test('passa: apagar a configuração que já existia', () => {
  const r = tentar({ '.codescene/code-health-rules.json': REGRAS_DO_CODESCENE, 'code-health-rules.json': REGRAS_DO_CODESCENE }, { '.codescene/code-health-rules.json': null, 'code-health-rules.json': null });
  assert.equal(r.codigo, 0, r.saida);
});

test('passa: nomes parecidos não são a configuração', () => {
  const r = tentar({}, {
    'docs/codescene-exclusoes.md': 'texto\n',
    'app/codescene/a.json': '{}\n',
    'app/.codescene/a.json': '{}\n',
    'docs/code-health-rules.md': 'texto\n',
    'docs/meu-code-health-rules.json': '{}\n',
    'docs/code-health-rules.json.md': 'texto\n',
  });
  assert.equal(r.codigo, 0, r.saida);
});

test('não existe isenção: a regra roda em arquivo de pasta isenta das outras', () => {
  const r = tentar({}, { 'MAC/x/reservas/code-health-rules.json': REGRAS_DO_CODESCENE });
  assert.equal(r.codigo, 1);
});

test('linha nova com @codescene(...) continua barrada pela sem-comentario-novo', () => {
  const casos = {
    'app/a.js': '// @codescene(disable: "Complex Method")\nconst a = 1;\n',
    'app/a.py': '# @codescene(disable: "Complex Method")\na = 1\n',
    'app/b.js': '/* @codescene(disable: "Complex Method") */\nconst a = 1;\n',
  };
  for (const [arquivo, texto] of Object.entries(casos)) {
    const r = tentar({}, { [arquivo]: texto }, 'sem-comentario-novo');
    assert.equal(r.codigo, 1, `${arquivo}: ${r.saida}`);
    assert.match(r.saida, /sem-comentario-novo/);
  }
});
