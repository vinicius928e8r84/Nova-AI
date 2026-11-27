'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { criar, LINHA_DE_BASE } = require('./auxiliar');

const COM_PYTHON = spawnSync(process.env.PYTHON || 'python3', ['-I', '-c', 'import ast']).status === 0;
const comPython = { skip: COM_PYTHON ? false : 'sem python3 (aponte PYTHON=)' };

const REGRA = ['--regra', 'teto-de-comentarios'];
const comComentarios = quantos => `${Array.from({ length: quantos }, (_, i) => `// nota ${i}`).join('\n')}\nconst a = 1;\n`;
const comoJson = comentarios => `${JSON.stringify({ arquivos: {}, 'saude-do-codigo': {}, comentarios })}\n`;

function repoCom(arquivos, comentarios) {
  const repo = criar(arquivos);
  repo.escrever({ [LINHA_DE_BASE]: comoJson(comentarios) });
  repo.guardar('linha de base de comentários');
  repo.git('branch', '-f', 'main', 'HEAD');
  return repo;
}

const lerComentarios = repo => JSON.parse(fs.readFileSync(path.join(repo.raiz, LINHA_DE_BASE), 'utf8')).comentarios;

test('passa: arquivo tocado fora da linha dos comentários que já tinha', () => {
  const repo = repoCom({ 'app/a.js': `${comComentarios(2)}const b = 2;\n` }, { 'app/a.js': 2 });
  repo.escrever({ 'app/a.js': `${comComentarios(2)}const b = 3;\n` });
  const r = repo.rodar(...REGRA);
  repo.limpar();
  assert.equal(r.codigo, 0, r.saida);
});

test('falha: comentário a mais num arquivo da linha de base, mesmo longe da linha tocada', () => {
  const repo = repoCom({ 'app/a.js': comComentarios(2) }, { 'app/a.js': 2 });
  repo.escrever({ 'app/a.js': comComentarios(3) });
  const r = repo.rodar(...REGRA);
  repo.limpar();
  assert.equal(r.codigo, 1, r.saida);
  assert.match(r.saida, /app\/a\.js.*3 linha\(s\) de comentário; o teto é 2/);
});

test('passa e avisa: apagar comentário baixa o teto sem travar a PR', () => {
  const repo = repoCom({ 'app/a.js': comComentarios(3) }, { 'app/a.js': 3 });
  repo.escrever({ 'app/a.js': comComentarios(1) });
  const r = repo.rodar(...REGRA);
  repo.limpar();
  assert.equal(r.codigo, 0, r.saida);
  assert.match(r.saida, /a linha de base pode descer: app\/a\.js 3 → 1/);
});

test('falha: baixar a entrada da linha de base abaixo do que o arquivo ainda tem', () => {
  const repo = repoCom({ 'app/a.js': comComentarios(3) }, { 'app/a.js': 3 });
  repo.escrever({ [LINHA_DE_BASE]: comoJson({ 'app/a.js': 1 }) });
  const r = repo.rodar(...REGRA);
  repo.limpar();
  assert.equal(r.codigo, 1, r.saida);
  assert.match(r.saida, /a entrada \(1\) está abaixo dos 3/);
});

test('arquivo que chegou a zero não volta a ter comentário', () => {
  const repo = repoCom({ 'app/a.js': 'const a = 1;\n' }, {});
  repo.escrever({ 'app/a.js': '// volta\nconst a = 1;\n' });
  const r = repo.rodar(...REGRA);
  repo.limpar();
  assert.equal(r.codigo, 1, r.saida);
  assert.match(r.saida, /o teto é 0/);
});

test('arquivo novo não ganha comentário nem herda a folga de outro', () => {
  const repo = repoCom({ 'app/a.js': comComentarios(2) }, { 'app/a.js': 2 });
  repo.escrever({ 'app/novo.js': comComentarios(1) });
  const r = repo.rodar(...REGRA);
  repo.limpar();
  assert.equal(r.codigo, 1, r.saida);
  assert.match(r.saida, /app\/novo\.js.*o teto é 0/);
});

test('a linha de base do ramo não pode subir nem ganhar arquivo', () => {
  const repo = repoCom({ 'app/a.js': comComentarios(2), 'app/b.js': 'const b = 1;\n' }, { 'app/a.js': 2 });
  repo.escrever({ [LINHA_DE_BASE]: comoJson({ 'app/a.js': 3, 'app/b.js': 1 }) });
  const r = repo.rodar(...REGRA);
  repo.limpar();
  assert.equal(r.codigo, 1, r.saida);
  assert.match(r.saida, /app\/a\.js: a linha de base subiu de 2 para 3/);
  assert.match(r.saida, /app\/b\.js entrou na linha de base/);
});

test('o teto também vale quando a linha de base está desatualizada para cima', () => {
  const repo = repoCom({ 'app/a.js': comComentarios(1) }, { 'app/a.js': 5 });
  repo.escrever({ 'app/a.js': comComentarios(2) });
  const r = repo.rodar(...REGRA);
  repo.limpar();
  assert.equal(r.codigo, 1, r.saida);
  assert.match(r.saida, /o teto é 1/);
});

test('git mv leva o teto junto; o arquivo movido não ganha comentário; --atualizar move a entrada', () => {
  const repo = repoCom({ 'app/a.js': comComentarios(2) }, { 'app/a.js': 2 });
  repo.git('mv', 'app/a.js', 'app/b.js');
  assert.equal(repo.rodar(...REGRA).codigo, 0);
  repo.escrever({ 'app/b.js': comComentarios(3) });
  const sobe = repo.rodar(...REGRA);
  assert.equal(sobe.codigo, 1, sobe.saida);
  repo.escrever({ 'app/b.js': comComentarios(2) });
  const atualizar = repo.rodar('--atualizar-linha-de-base', ...REGRA);
  const lida = lerComentarios(repo);
  repo.limpar();
  assert.equal(atualizar.codigo, 0, atualizar.saida);
  assert.deepEqual(lida, { 'app/b.js': 2 });
});

test('diretiva, shebang e licença não contam', () => {
  const repo = repoCom({ 'app/a.py': '#!/usr/bin/env python3\n# -*- coding: utf-8 -*-\nx = 1  # noqa: E501\n' }, {});
  repo.escrever({ 'app/a.py': '#!/usr/bin/env python3\n# -*- coding: utf-8 -*-\nx = 2  # noqa: E501\n' });
  const r = repo.rodar(...REGRA);
  repo.limpar();
  assert.equal(r.codigo, 0, r.saida);
});

test('arquivos isentos (dist) não entram na conta', () => {
  const repo = repoCom({ 'MAC/x/dist/a.js': comComentarios(4) }, {});
  repo.escrever({ 'MAC/x/dist/a.js': comComentarios(5) });
  const r = repo.rodar(...REGRA);
  repo.limpar();
  assert.equal(r.codigo, 0, r.saida);
});

test('falta a chave comentarios no ramo: falha', () => {
  const repo = criar({ 'app/a.js': 'const a = 1;\n' });
  repo.escrever({ [LINHA_DE_BASE]: `${JSON.stringify({ arquivos: {}, 'saude-do-codigo': {} })}\n` });
  const r = repo.rodar(...REGRA);
  repo.limpar();
  assert.equal(r.codigo, 1, r.saida);
  assert.match(r.saida, /falta a chave "comentarios"/);
});

test('--atualizar-linha-de-base desce o teto e tira o arquivo que chegou a zero; recusa subir', () => {
  const repo = repoCom({ 'app/a.js': comComentarios(3), 'app/b.js': comComentarios(2) }, { 'app/a.js': 3, 'app/b.js': 2 });
  repo.escrever({ 'app/a.js': comComentarios(1), 'app/b.js': 'const b = 1;\n' });
  assert.equal(repo.rodar('--atualizar-linha-de-base', ...REGRA).codigo, 0);
  assert.deepEqual(lerComentarios(repo), { 'app/a.js': 1 });
  assert.equal(repo.rodar(...REGRA).codigo, 0);
  repo.escrever({ 'app/a.js': comComentarios(2) });
  const sobe = repo.rodar('--atualizar-linha-de-base', ...REGRA);
  repo.limpar();
  assert.equal(sobe.codigo, 1, sobe.saida);
  assert.match(sobe.saida, /a linha de base só desce|só encolhe/);
});

test('--criar-linha-de-base conta as linhas de prosa do repositório', () => {
  const repo = criar({ 'app/a.js': comComentarios(2), 'app/b.js': 'const b = 1;\n', 'app/c.sh': '#!/bin/sh\n# um\n# dois\necho 1\n' });
  repo.escrever({ [LINHA_DE_BASE]: `${JSON.stringify({ arquivos: {}, 'saude-do-codigo': {} })}\n` });
  const criou = repo.rodar('--criar-linha-de-base', ...REGRA);
  const lida = lerComentarios(repo);
  repo.limpar();
  assert.equal(criou.codigo, 0, criou.saida);
  assert.deepEqual(lida, { 'app/a.js': 2, 'app/c.sh': 2 });
});

const comDocstring = linhasDoCorpo => ['def f():', '    """Um.', '', ...linhasDoCorpo, '    """', '    return 1', ''].join('\n');

test('a docstring de Python conta no teto: uma linha a mais na docstring passa do limite', comPython, () => {
  const repo = repoCom({ 'app/a.py': comDocstring(['    Dois.']) }, { 'app/a.py': 3 });
  const igual = repo.rodar(...REGRA);
  repo.escrever({ 'app/a.py': comDocstring(['    Dois.', '    Tres.']) });
  const r = repo.rodar(...REGRA);
  repo.limpar();
  assert.equal(igual.codigo, 0, igual.saida);
  assert.equal(r.codigo, 1, r.saida);
  assert.match(r.saida, /4 linha\(s\) de comentário; o teto é 3/);
});
