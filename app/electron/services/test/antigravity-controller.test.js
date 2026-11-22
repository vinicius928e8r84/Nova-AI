'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { encenar } = require('./antigravity-controller.palco');
const { cenas } = require('./antigravity-controller.cenas');
const esperado = require('./antigravity-controller.esperado.json');

const MODULO = path.resolve(__dirname, '../antigravity-controller.js');

test('toda cena do antigravity-controller tem registro esperado', () => {
  assert.deepStrictEqual(Object.keys(cenas), Object.keys(esperado));
});

for (const [nome, cena] of Object.entries(cenas)) {
  test(`antigravity-controller: ${nome}`, async () => {
    assert.deepStrictEqual(await encenar(MODULO, cena), esperado[nome]);
  });
}
