'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { criar } = require('./auxiliar');
const { linhasDeComentario } = require('../comentarios');

const corpos = (arquivo, fonte) => linhasDeComentario(arquivo, fonte).map(l => l.corpo).filter(Boolean);

function tentar(arquivos, base = {}) {
  const repo = criar(base);
  repo.escrever(arquivos);
  const resultado = repo.rodar('--regra', 'sem-comentario-novo');
  repo.limpar();
  return resultado;
}

test('passa: arquivo novo sem nenhum comentário', () => {
  const r = tentar({ 'app/a.js': 'const a = 1;\nconst b = "http://x//y";\nmodule.exports = { a, b };\n' });
  assert.equal(r.codigo, 0, r.saida);
});

test('passa: shebang, diretiva de ferramenta e cabeçalho de licença', () => {
  const r = tentar({
    'app/a.js': '#!/usr/bin/env node\n// SPDX-License-Identifier: MIT\n/* eslint-disable no-console */\nconst a = 1; // eslint-disable-line no-unused-vars\n',
    'app/b.py': '#!/usr/bin/env python3\n# -*- coding: utf-8 -*-\nx = 1  # noqa: E501\n',
    'app/c.sh': '#!/bin/bash\necho "$#" ${#PATH}\n',
  });
  assert.equal(r.codigo, 0, r.saida);
});

test('passa: comentário antigo em arquivo que a mudança tocou em outra linha', () => {
  const base = { 'app/a.js': '// velho\nconst a = 1;\nconst b = 2;\n' };
  const r = tentar({ 'app/a.js': '// velho\nconst a = 1;\nconst b = 3;\n' }, base);
  assert.equal(r.codigo, 0, r.saida);
});

test('passa: cópia idêntica de arquivo que já existe na base', () => {
  const base = { 'app/a.js': '// velho\nconst a = 1;\n' };
  const r = tentar({ 'app/copia.js': '// velho\nconst a = 1;\n' }, base);
  assert.equal(r.codigo, 0, r.saida);
});

test('falha: comentário de linha, de bloco e na mesma linha do código em JS', () => {
  const r = tentar({ 'app/a.js': '// novo\nconst a = 1; // explica\n/* bloco\n * de duas linhas */\nconst b = 2;\n' });
  assert.equal(r.codigo, 1);
  assert.match(r.saida, /app\/a\.js:1: comentário novo: “novo”/);
  assert.match(r.saida, /app\/a\.js:2: comentário novo: “explica”/);
  assert.match(r.saida, /app\/a\.js:3/);
  assert.match(r.saida, /app\/a\.js:4/);
});

test('falha: Python (# e docstring), shell, CSS e HTML', () => {
  const r = tentar({
    'app/a.py': 'x = 1  # explica\n',
    'app/d.py': 'def f():\n    """Faz f."""\n    return 1\n',
    'app/a.sh': 'echo oi\n# novo\n',
    'app/a.css': 'a { color: red; }\n/* novo */\n',
    'app/a.html': '<p>oi</p>\n<!-- novo -->\n<script>\n// js\n</script>\n',
  });
  assert.equal(r.codigo, 1);
  for (const esperado of ['app/a.py:1', 'app/d.py:2: docstring nova', 'app/a.sh:2', 'app/a.css:2', 'app/a.html:2', 'app/a.html:4']) {
    assert.ok(r.saida.includes(esperado), `faltou ${esperado}\n${r.saida}`);
  }
});

test('falha: comentário antigo numa linha que a mudança tocou', () => {
  const base = { 'app/a.js': 'const a = 1; // velho\n' };
  const r = tentar({ 'app/a.js': 'const a = 2; // velho\n' }, base);
  assert.equal(r.codigo, 1);
  assert.match(r.saida, /app\/a\.js:1/);
});

test('falha: arquivo novo copiado com alteração', () => {
  const base = { 'app/a.js': '// velho\nconst a = 1;\n' };
  const r = tentar({ 'app/b.js': '// velho\nconst a = 1;\nconst c = 3;\n' }, base);
  assert.equal(r.codigo, 1);
});

test('o separador entende strings, templates aninhados, regex e heredoc', () => {
  assert.deepEqual(corpos('a.js', 'const a = `x ${`y // no` + b} // no`; // sim\nconst r = /\\//; /[/]/.test(a); // outro\n'), ['sim', 'outro']);
  assert.deepEqual(corpos('a.js', 'const a = "// no"; const b = \'/* no */\'; /* sim */\n'), ['sim']);
  assert.deepEqual(corpos('a.sh', 'echo $# ${#a} # c\nx="# no" # c2\ncat <<E\n# no\nE\n'), ['c', 'c2']);
  assert.deepEqual(corpos('a.py', 'x = "#no" # c\n"""doc # no"""\n'), ['c']);
  assert.deepEqual(corpos('a.html', '<a title="<!-- no -->"><!-- s --><style>/* css */</style>'), ['s', 'css']);
});
