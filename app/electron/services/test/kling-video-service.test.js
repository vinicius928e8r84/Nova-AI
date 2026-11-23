'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { encenar } = require('./kling-video-service.palco');
const { cenas } = require('./kling-video-service.cenas');
const esperado = require('./kling-video-service.esperado.json');

const MODULO = path.resolve(__dirname, '../kling-video-service.js');

test('toda cena tem registro esperado', () => {
  assert.deepStrictEqual(Object.keys(cenas), Object.keys(esperado));
});

for (const [nome, cena] of Object.entries(cenas)) {
  test(`kling-video-service: ${nome}`, async () => {
    assert.deepStrictEqual(await encenar(MODULO, cena), esperado[nome]);
  });
}
