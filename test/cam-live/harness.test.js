'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { rodarCena } = require('./harness.palco');
const cenas = require('./harness.cenas');
const esperado = require('./harness.esperado.json');

const HARNESS = path.join(__dirname, 'harness.js');

test('cada cena do harness tem o diário gravado', () => {
  assert.deepStrictEqual(cenas.map(cena => cena.nome), Object.keys(esperado));
});

for (const cena of cenas) {
  test(cena.nome, async () => {
    assert.deepStrictEqual(await rodarCena(HARNESS, cena), esperado[cena.nome]);
  });
}
