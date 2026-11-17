'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { criar, temEslint } = require('./auxiliar');

function tentar(regra, arquivos, base = {}) {
  const repo = criar(base);
  repo.escrever(arquivos);
  const resultado = repo.rodar('--regra', regra);
  repo.limpar();
  return resultado;
}

const AWS = `AKI${'A'}${'IOSFODNN7EXAMPLE'}`;
const JWT = ['eyJ' + 'hbGciOiJIUzI1NiJ9', 'eyJ' + 'zdWIiOiIxMjM0NTY3ODkwIn0', 'abcdefghij1234567890'].join('.');

test('segredo passa: variável de ambiente, placeholder e valor curto', () => {
  const r = tentar('sem-segredo', {
    'app/a.js': 'const chave = process.env.NOVA_CHAVE;\nconst config = { apiKey: "SUA-CHAVE-AQUI-XXXXXXXXXXXX", token: "curto" };\n',
  });
  assert.equal(r.codigo, 0, r.saida);
});

test('segredo falha: chave AWS, JWT, chave privada e atribuição literal', () => {
  const r = tentar('sem-segredo', {
    'app/a.js': `const a = "${AWS}";\nconst b = "${JWT}";\n`,
    'app/b.py': `-----BEGIN ${'RSA'} PRIVATE KEY-----\npassword = "${'Zx9fKq2L'}${'mN8vB4tR7yU1'}"\n`,
  });
  assert.equal(r.codigo, 1);
  for (const esperado of ['app/a.js:1', 'app/a.js:2', 'app/b.py:1', 'app/b.py:2']) assert.ok(r.saida.includes(esperado), r.saida);
  assert.ok(!r.saida.includes(AWS), 'o segredo não pode aparecer na saída');
});

test('segredo falha: arquivo de chave, sessão e .env pelo nome', () => {
  const r = tentar('sem-segredo', { 'app/secret_key.json': '{}\n', 'x/.env': 'A=1\n', 'app/.wwebjs_auth/s.json': '{}\n', 'app/ok.json': '{}\n' });
  assert.equal(r.codigo, 1);
  for (const nome of ['app/secret_key.json', 'x/.env', 'app/.wwebjs_auth/s.json']) assert.ok(r.saida.includes(nome), r.saida);
  assert.ok(!r.saida.includes('app/ok.json'));
});

test('segredo passa: linha antiga com segredo em arquivo tocado em outra linha', () => {
  const base = { 'app/a.js': `const a = "${AWS}";\nconst b = 1;\n` };
  const r = tentar('sem-segredo', { 'app/a.js': `const a = "${AWS}";\nconst b = 2;\n` }, base);
  assert.equal(r.codigo, 0, r.saida);
});

test('binário passa: imagem pequena e texto que começa com MZ', () => {
  const r = tentar('sem-binario-nem-lixo', { 'app/a.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]), 'app/nota.txt': 'MZ-1 é um modelo\n' });
  assert.equal(r.codigo, 0, r.saida);
});

test('binário falha: instalador, executável disfarçado, backup e arquivo grande', () => {
  const r = tentar('sem-binario-nem-lixo', {
    'dist/Nova.dmg': 'x',
    'app/ferramenta.txt': Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]),
    'app/main.js.bak-20261115': 'x',
    'app/enorme.dat': Buffer.alloc(9 * 1024 * 1024, 65),
  });
  assert.equal(r.codigo, 1);
  for (const nome of ['dist/Nova.dmg', 'app/ferramenta.txt', 'app/main.js.bak-20261115', 'app/enorme.dat']) assert.ok(r.saida.includes(nome), r.saida);
});

test('depuração passa: console.error, scripts e console.log antigo', () => {
  const base = { 'app/velho.js': 'console.log("antigo");\nconst a = 1;\n' };
  const r = tentar('sem-depuracao-esquecida', {
    'app/velho.js': 'console.log("antigo");\nconst a = 2;\n',
    'app/b.js': 'console.error("falhou");\nconst s = "debugger";\n',
    'app/scripts/c.js': 'console.log("saída da ferramenta");\n',
  }, base);
  assert.equal(r.codigo, 0, r.saida);
});

test('depuração falha: console.log, debugger, .only e breakpoint()', () => {
  const r = tentar('sem-depuracao-esquecida', {
    'app/a.js': 'function f() {\n  console.log("x");\n  debugger;\n}\n',
    'app/a.test.js': 'it.only("a", () => {});\n',
    'app/b.py': 'breakpoint()\n',
  });
  assert.equal(r.codigo, 1);
  for (const esperado of ['app/a.js:2', 'app/a.js:3', 'app/a.test.js:1', 'app/b.py:1']) assert.ok(r.saida.includes(esperado), r.saida);
});

test('sintaxe passa: CommonJS, módulo ES, Python, shell e JSON', () => {
  const r = tentar('sintaxe-valida', {
    'app/a.js': 'const a = require("x");\n',
    'app/b.mjs': 'import x from "y";\nexport default x;\n',
    'app/c.py': 'x = 1\n',
    'app/d.sh': 'echo oi\n',
    'app/e.json': '{"a": 1}\n',
  });
  assert.equal(r.codigo, 0, r.saida);
});

test('sintaxe falha: JS, Python, shell e JSON quebrados', () => {
  const r = tentar('sintaxe-valida', {
    'app/a.js': 'const a = ;\n',
    'app/c.py': 'def f(:\n',
    'app/d.sh': 'if true; then\n',
    'app/e.json': '{"a": }\n',
  });
  assert.equal(r.codigo, 1);
  for (const nome of ['app/a.js', 'app/c.py', 'app/d.sh', 'app/e.json']) assert.ok(r.saida.includes(nome), r.saida);
});

test('eslint passa: código limpo e problema antigo em linha que a mudança não tocou', { skip: !temEslint }, () => {
  const base = { 'app/a.js': 'const velha = 1;\nconst b = 1;\nmodule.exports = { b };\n' };
  const repo = criar(base);
  repo.escrever({ 'app/a.js': 'const velha = 1;\nconst b = 2;\nmodule.exports = { b };\n' });
  const r = repo.rodar('--regra', 'eslint-nas-linhas-novas');
  repo.limpar();
  assert.equal(r.codigo, 0, r.saida);
});

test('eslint falha: variável não usada, não declarada e == na linha nova', { skip: !temEslint }, () => {
  const repo = criar();
  repo.escrever({ 'app/a.js': 'const naoUsada = 1;\nfunction f(x) { return x == 1 && naoDeclarada; }\nmodule.exports = { f };\n' });
  const r = repo.rodar('--regra', 'eslint-nas-linhas-novas');
  repo.limpar();
  assert.equal(r.codigo, 1);
  for (const regra of ['no-unused-vars', 'no-undef', 'eqeqeq']) assert.ok(r.saida.includes(regra), r.saida);
});
