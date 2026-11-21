'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { encenar } = require('./user-profile-manager.palco');
const { CENAS } = require('./user-profile-manager.cenas');
const ESPERADO = require('./user-profile-manager.esperado.json');

test('cada cena gravada tem a sua cena e vice-versa', () => {
  assert.deepStrictEqual(CENAS.map(cena => cena.nome), Object.keys(ESPERADO));
});

for (const cena of CENAS) {
  test(`user-profile-manager: ${cena.nome}`, async () => {
    const registro = await encenar(cena);
    assert.deepStrictEqual(registro, ESPERADO[cena.nome]);
    assert.strictEqual(JSON.stringify(registro), JSON.stringify(ESPERADO[cena.nome]), 'a ordem das chaves mudou');
  });
}
