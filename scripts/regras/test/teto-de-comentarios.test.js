'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const { criar } = require('./auxiliar');

const COM_PYTHON = spawnSync(process.env.PYTHON || 'python3', ['-I', '-c', 'import ast']).status === 0;
const comPython = { skip: COM_PYTHON ? false : 'sem python3 (aponte PYTHON=)' };

const REGRA = ['--regra', 'teto-de-comentarios'];
const comComentarios = quantos => `${Array.from({ length: quantos }, (_, i) => `// nota ${i}`).join('\n')}\nconst a = 1;\n`;

test('passa: arquivo tocado fora da linha dos comentários que já tinha', () => {
  const repo = criar({ 'app/a.js': `${comComentarios(2)}const b = 2;\n` });
  repo.escrever({ 'app/a.js': `${comComentarios(2)}const b = 3;\n` });
  const r = repo.rodar(...REGRA);
  repo.limpar();
  assert.equal(r.codigo, 0, r.saida);
});

test('falha: comentário a mais num arquivo que já tinha, mesmo longe da linha tocada', () => {
  const repo = criar({ 'app/a.js': comComentarios(2) });
  repo.escrever({ 'app/a.js': comComentarios(3) });
  const r = repo.rodar(...REGRA);
  repo.limpar();
  assert.equal(r.codigo, 1, r.saida);
  assert.match(r.saida, /app\/a\.js.*3 linha\(s\) de comentário; o teto é 2, a contagem dele na branch-alvo/);
});

test('passa sem editar lista nenhuma: apagar comentário baixa o teto, e o teto seguinte é a contagem nova', () => {
  const repo = criar({ 'app/a.js': comComentarios(3) });
  repo.escrever({ 'app/a.js': comComentarios(1) });
  const apaga = repo.rodar(...REGRA);
  repo.guardar('apaga');
  repo.git('branch', '-f', 'main', 'HEAD');
  repo.escrever({ 'app/a.js': comComentarios(2) });
  const volta = repo.rodar(...REGRA);
  repo.limpar();
  assert.equal(apaga.codigo, 0, apaga.saida);
  assert.doesNotMatch(apaga.saida, /linha de base/);
  assert.equal(volta.codigo, 1, volta.saida);
  assert.match(volta.saida, /o teto é 1/);
});

test('arquivo que chegou a zero não volta a ter comentário', () => {
  const repo = criar({ 'app/a.js': 'const a = 1;\n' });
  repo.escrever({ 'app/a.js': '// volta\nconst a = 1;\n' });
  const r = repo.rodar(...REGRA);
  repo.limpar();
  assert.equal(r.codigo, 1, r.saida);
  assert.match(r.saida, /o teto é 0/);
});

test('arquivo novo não ganha comentário nem herda a folga de outro', () => {
  const repo = criar({ 'app/a.js': comComentarios(2) });
  repo.escrever({ 'app/novo.js': comComentarios(1) });
  const r = repo.rodar(...REGRA);
  repo.limpar();
  assert.equal(r.codigo, 1, r.saida);
  assert.match(r.saida, /app\/novo\.js.*o teto é 0/);
});

test('falha: cópia de um arquivo com comentário não leva o teto do original, e cópia idêntica nem é cobrada', () => {
  const repo = criar({ 'app/a.js': comComentarios(2) });
  repo.escrever({ 'app/copia.js': comComentarios(2) });
  const identica = repo.rodar(...REGRA);
  repo.escrever({ 'app/outra.js': `${comComentarios(2)}const b = 2;\n` });
  const mudada = repo.rodar(...REGRA);
  repo.limpar();
  assert.equal(identica.codigo, 0, identica.saida);
  assert.equal(mudada.codigo, 1, mudada.saida);
  assert.match(mudada.saida, /app\/outra\.js.*2 linha\(s\) de comentário; o teto é 0/);
});

test('git mv leva o teto: o arquivo movido passa igual e com menos, e não ganha comentário', () => {
  const repo = criar({ 'app/a.js': comComentarios(2) });
  repo.git('mv', 'app/a.js', 'app/b.js');
  const igual = repo.rodar(...REGRA);
  repo.escrever({ 'app/b.js': comComentarios(1) });
  const menos = repo.rodar(...REGRA);
  repo.escrever({ 'app/b.js': comComentarios(3) });
  const sobe = repo.rodar(...REGRA);
  repo.limpar();
  assert.equal(igual.codigo, 0, igual.saida);
  assert.equal(menos.codigo, 0, menos.saida);
  assert.equal(sobe.codigo, 1, sobe.saida);
  assert.match(sobe.saida, /app\/b\.js.*3 linha\(s\) de comentário; o teto é 2/);
});

test('diretiva, shebang e licença não contam', () => {
  const repo = criar({ 'app/a.py': '#!/usr/bin/env python3\n# -*- coding: utf-8 -*-\nx = 1  # noqa: E501\n' });
  repo.escrever({ 'app/a.py': '#!/usr/bin/env python3\n# -*- coding: utf-8 -*-\nx = 2  # noqa: E501\n' });
  const r = repo.rodar(...REGRA);
  repo.limpar();
  assert.equal(r.codigo, 0, r.saida);
});

test('arquivos isentos (reservas, dist) não entram na conta', () => {
  const repo = criar({ 'MAC/x/reservas/a.js': comComentarios(4) });
  repo.escrever({ 'MAC/x/reservas/a.js': comComentarios(5) });
  const r = repo.rodar(...REGRA);
  repo.limpar();
  assert.equal(r.codigo, 0, r.saida);
});

test('arquivo que sai de uma pasta isenta não leva o teto dos comentários que tinha lá', () => {
  const repo = criar({ 'MAC/x/reservas/a.js': comComentarios(4), 'app/b.js': 'const b = 1;\n' });
  repo.git('mv', 'MAC/x/reservas/a.js', 'app/a.js');
  const r = repo.rodar(...REGRA);
  repo.limpar();
  assert.equal(r.codigo, 1, r.saida);
  assert.match(r.saida, /app\/a\.js.*4 linha\(s\) de comentário; o teto é 0/);
});

const comDocstring = linhasDoCorpo => ['def f():', '    """Um.', '', ...linhasDoCorpo, '    """', '    return 1', ''].join('\n');

test('a docstring de Python conta no teto: uma linha a mais na docstring passa do limite', comPython, () => {
  const repo = criar({ 'app/a.py': comDocstring(['    Dois.']) });
  const igual = repo.rodar(...REGRA);
  repo.escrever({ 'app/a.py': comDocstring(['    Dois.', '    Tres.']) });
  const r = repo.rodar(...REGRA);
  repo.limpar();
  assert.equal(igual.codigo, 0, igual.saida);
  assert.equal(r.codigo, 1, r.saida);
  assert.match(r.saida, /4 linha\(s\) de comentário; o teto é 3/);
});
