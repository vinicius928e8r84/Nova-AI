'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const { blocosDe, deixariaVazio, removerBlocos } = require('./blocos');

const PYTHON = process.env.PYTHON || 'python3';
const comPython = { skip: spawnSync(PYTHON, ['-I', '-c', 'import ast']).status === 0 ? false : 'sem python3 (aponte PYTHON=)' };

const apagarTudo = (arquivo, fonte) => removerBlocos(fonte, blocosDe(arquivo, fonte, PYTHON));

test('junta as linhas // seguidas num bloco e separa o que não é vizinho', () => {
  const fonte = '// um\n// dois\nconst a = 1;\n\n// tres\nconst b = 2;\n';
  const blocos = blocosDe('a.js', fonte);
  assert.deepEqual(blocos.map(b => [b.de, b.ate, b.texto]), [[1, 2, 'um dois'], [5, 5, 'tres']]);
});

test('a linha // vazia entre ou em volta da prosa sai com o bloco; sozinha não aparece', () => {
  const fonte = '//\n// um\n//\n// dois\n//\nconst a = 1;\n//\nconst b = 2;\n';
  assert.deepEqual(blocosDe('a.js', fonte).map(b => [b.de, b.ate, b.texto]), [[1, 5, 'um dois']]);
  assert.equal(apagarTudo('a.js', fonte), 'const a = 1;\n//\nconst b = 2;\n');
});

test('apagar tira o bloco inteiro e deixa o código idêntico', () => {
  const fonte = '// um\n// dois\nconst a = 1;\n\n// tres\nconst b = 2;\n';
  assert.equal(apagarTudo('a.js', fonte), 'const a = 1;\n\nconst b = 2;\n');
});

test('apagar o comentário do fim da linha tira também o espaço antes dele', () => {
  assert.equal(apagarTudo('a.js', 'const a = 1; // nota\nconst b = "//x";\n'), 'const a = 1;\nconst b = "//x";\n');
});

test('apagar um comentário de bloco no meio da linha não gruda os tokens', () => {
  assert.equal(apagarTudo('a.js', 'const a = /* nota */ 1;\n'), 'const a = 1;\n');
});

test('apagar mantém o fim de linha CRLF e fecha o buraco em branco duplo', () => {
  const fonte = 'const a = 1;\r\n\r\n// nota\r\n\r\nconst b = 2;\r\n';
  assert.equal(apagarTudo('a.js', fonte), 'const a = 1;\r\n\r\nconst b = 2;\r\n');
});

test('diretiva, shebang e licença não aparecem na lista', () => {
  const fonte = '#!/usr/bin/env node\n// SPDX-License-Identifier: MIT\n// @ts-nocheck\n// nota\nconst a = 1;\n';
  assert.deepEqual(blocosDe('a.js', fonte).map(b => b.texto), ['nota']);
});

test('shell: # em string e em expansão não é comentário', () => {
  assert.deepEqual(blocosDe('a.sh', 'echo "$#" "${#PATH}"\n# nota\n').map(b => b.texto), ['nota']);
});

test('Python: # em string não é comentário', comPython, () => {
  assert.deepEqual(blocosDe('a.py', 'x = "# nao"\n# nota\n', PYTHON).map(b => b.texto), ['nota']);
});

test('docstring de Python entra na lista e sai com as linhas inteiras', comPython, () => {
  const fonte = 'def f():\n    """Soma."""\n    return 1\n';
  const blocos = blocosDe('a.py', fonte, PYTHON);
  assert.deepEqual(blocos.map(b => [b.tipo, b.de, b.ate]), [['docstring', 2, 2]]);
  assert.equal(removerBlocos(fonte, blocos), 'def f():\n    return 1\n');
});

test('docstring que é o único corpo do bloco não pode sair', comPython, () => {
  const fonte = 'def f():\n    """Só isto."""\n\n\nx = 1\n';
  const [bloco] = blocosDe('a.py', fonte, PYTHON);
  assert.equal(deixariaVazio(fonte, bloco), true);
  const comCorpo = 'def f():\n    """Soma."""\n    return 1\n';
  assert.equal(deixariaVazio(comCorpo, blocosDe('a.py', comCorpo, PYTHON)[0]), false);
});

test('apagar o comentário do fim da linha em arquivo CRLF mantém o CRLF da linha', () => {
  const fonte = 'const a = 1; // nota\r\nconst b = 2;\r\n';
  assert.equal(apagarTudo('a.js', fonte), 'const a = 1;\r\nconst b = 2;\r\n');
});
