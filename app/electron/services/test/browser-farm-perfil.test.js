'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { encenar } = require('./browser-farm-perfil.palco');
const { CENAS } = require('./browser-farm-perfil.cenas');
const ESPERADO = require('./browser-farm-perfil.esperado.json');

test('cada cena gravada tem a sua cena e vice-versa', () => {
  assert.deepStrictEqual(CENAS.map(cena => cena.nome), Object.keys(ESPERADO));
});

for (const cena of CENAS) {
  test(`browserFarmService (perfil): ${cena.nome}`, async () => {
    const registro = await encenar(cena);
    assert.deepStrictEqual(registro, ESPERADO[cena.nome]);
    assert.strictEqual(JSON.stringify(registro), JSON.stringify(ESPERADO[cena.nome]), 'a ordem das chaves mudou');
  });
}
