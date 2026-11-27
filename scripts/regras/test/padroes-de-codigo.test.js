'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tamanhoDeArquivo } = require('../configuracao.json');

const RAIZ = path.join(__dirname, '..', '..', '..');
const ler = nome => fs.readFileSync(path.join(RAIZ, nome), 'utf8');
const PADROES = 'CODING_STANDARDS.md';

function caminhosCitados(texto) {
  const citados = [...texto.matchAll(/`([^`\s]+)`/g)].map(achado => achado[1]);
  return citados.filter(item => /^[\w.-]+(\/[\w.@-]+)+\/?$/.test(item) || /^[\w-]+\.(md|js|json|yml)$/.test(item));
}

test('o arquivo existe na raiz e cabe no limite de bytes', () => {
  assert.ok(fs.existsSync(path.join(RAIZ, PADROES)));
  assert.ok(Buffer.byteLength(ler(PADROES)) <= tamanhoDeArquivo.bytesMaximos);
});

test('tem os sete itens numerados, na ordem', () => {
  const numeros = [...ler(PADROES).matchAll(/^## (\d+)\. /gm)].map(achado => Number(achado[1]));
  assert.deepEqual(numeros, [1, 2, 3, 4, 5, 6, 7]);
});

test('o item dos níveis do veredito nomeia os três níveis', () => {
  const texto = ler(PADROES);
  for (const nivel of ['bloqueia', 'conserta se for barato', 'vira issue']) {
    assert.ok(texto.includes(`**${nivel}**`), nivel);
  }
});

test('o item da issue nomeia as três formas de a PR dizer a sua issue', () => {
  const texto = ler(PADROES);
  for (const forma of ['Closes', 'Refs', 'Prova que falta:']) {
    assert.ok(texto.includes(`\`${forma}`), forma);
  }
});

test('o CONTRIBUTING.md e o AGENTS.md apontam para ele, e ele aponta para o CONTRIBUTING.md', () => {
  assert.match(ler('CONTRIBUTING.md'), /\]\(CODING_STANDARDS\.md\)/);
  assert.match(ler('AGENTS.md'), /\]\(CODING_STANDARDS\.md\)/);
  assert.match(ler(PADROES), /\]\(CONTRIBUTING\.md\)/);
});

test('todo caminho que o arquivo cita existe no repositório', () => {
  const citados = caminhosCitados(ler(PADROES));
  assert.ok(citados.length >= 5);
  const faltam = citados.filter(item => !fs.existsSync(path.join(RAIZ, item)));
  assert.deepEqual(faltam, []);
});
