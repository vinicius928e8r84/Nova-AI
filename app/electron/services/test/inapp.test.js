'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { encenar } = require('./inapp.palco');
const { CENAS } = require('./inapp.cenas');
const ESPERADO = require('./inapp.esperado.json');

const MODULO = path.resolve(__dirname, '../iphone-setup/inapp.js');

test('toda cena tem registro esperado e vice-versa', () => {
  assert.deepStrictEqual(CENAS.map(cena => cena.nome), Object.keys(ESPERADO));
});

for (const cena of CENAS) {
  test(`iphone-setup/inapp.js: ${cena.nome}`, async () => {
    assert.deepStrictEqual(await encenar(MODULO, cena), ESPERADO[cena.nome]);
  });
}
