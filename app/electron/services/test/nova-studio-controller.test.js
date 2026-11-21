'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { encenar } = require('./nova-studio-controller.palco');
const { CENAS } = require('./nova-studio-controller.cenas');
const ESPERADO = require('./nova-studio-controller.esperado.json');

test('cada cena gravada tem a sua cena e vice-versa', () => {
  assert.deepStrictEqual(CENAS.map(cena => cena.nome), Object.keys(ESPERADO));
});

for (const cena of CENAS) {
  test(`nova-studio-controller: ${cena.nome}`, async () => {
    const registro = await encenar(cena);
    assert.deepStrictEqual(registro, ESPERADO[cena.nome]);
    assert.strictEqual(JSON.stringify(registro), JSON.stringify(ESPERADO[cena.nome]), 'a ordem das chaves mudou');
  });
}
