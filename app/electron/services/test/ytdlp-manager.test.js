'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { encenar } = require('./ytdlp-manager.palco');
const { cenas } = require('./ytdlp-manager.cenas');
const esperado = require('./ytdlp-manager.esperado.json');

const MODULO = path.resolve(__dirname, '../ytdlp-manager.js');

test('toda cena tem registro esperado', () => {
  assert.deepStrictEqual(Object.keys(cenas), Object.keys(esperado));
});

for (const [nome, cena] of Object.entries(cenas)) {
  test(`ytdlp-manager: ${nome}`, async () => {
    assert.deepStrictEqual(await encenar(MODULO, cena), esperado[nome]);
  });
}
