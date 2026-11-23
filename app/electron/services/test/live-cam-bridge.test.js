'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { rodarCena } = require('./live-cam-bridge.palco');
const cenas = require('./live-cam-bridge.cenas');
const esperado = require('./live-cam-bridge.esperado.json');

const MODULO = path.join(__dirname, '..', 'live-cam-bridge.js');

test('cada cena tem o diário gravado', () => {
  assert.deepStrictEqual(cenas.map(cena => cena.nome), Object.keys(esperado));
});

for (const cena of cenas) {
  test(cena.nome, async () => {
    assert.deepStrictEqual(await rodarCena(MODULO, cena), esperado[cena.nome]);
  });
}
