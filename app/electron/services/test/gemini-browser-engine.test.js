'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { encenar } = require('./gemini-browser-engine.palco');
const { cenas } = require('./gemini-browser-engine.cenas');
const esperado = require('./gemini-browser-engine.esperado.json');

const MODULO = path.resolve(__dirname, '../gemini-browser-engine.js');

test('toda cena do gemini-browser-engine tem registro esperado', () => {
  assert.deepStrictEqual(Object.keys(cenas), Object.keys(esperado));
});

for (const [nome, cena] of Object.entries(cenas)) {
  test(`gemini-browser-engine: ${nome}`, async () => {
    assert.deepStrictEqual(await encenar(MODULO, cena), esperado[nome]);
  });
}
