'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { encenar } = require('./cam-live-audio.palco');
const { CENAS } = require('./cam-live-audio.cenas');
const ESPERADO = require('./cam-live-audio.esperado.json');

test('cada cena gravada tem a sua cena e vice-versa', () => {
  assert.deepStrictEqual(CENAS.map(cena => cena.nome), Object.keys(ESPERADO));
});

for (const cena of CENAS) {
  test(`cam-live-audio.js: ${cena.nome}`, async () => {
    assert.deepStrictEqual(await encenar(cena), ESPERADO[cena.nome]);
  });
}
