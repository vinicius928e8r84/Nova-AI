'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { cenas } = require('./verificar.cenas');
const ESPERADO = require('./verificar-caracterizacao.esperado.json');

test('verificar.js: argumentos, erros de uso, base, formato dos achados, risco, avisos e linha de base saem iguais', () => {
  const saidas = cenas();
  assert.deepEqual(Object.keys(saidas), Object.keys(ESPERADO));
  for (const nome of Object.keys(ESPERADO)) assert.deepEqual(saidas[nome], ESPERADO[nome], nome);
});
