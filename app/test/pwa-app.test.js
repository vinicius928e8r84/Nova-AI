'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { encenar } = require('./pwa-app.palco');
const { CENAS } = require('./pwa-app.cenas');
const ESPERADO = require('./pwa-app.esperado.json');

test('cada cena gravada tem a sua cena e vice-versa', () => {
  assert.deepStrictEqual(CENAS.map(cena => cena.nome), Object.keys(ESPERADO));
});

for (const cena of CENAS) {
  test(`pwa/app.js: ${cena.nome}`, async () => {
    assert.deepStrictEqual(await encenar(cena), ESPERADO[cena.nome]);
  });
}
