'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { encenar } = require('./nova-grab-content.palco');
const { CENAS } = require('./nova-grab-content.cenas');
const ESPERADO = require('./nova-grab-content.esperado.json');

test('cada cena gravada tem a sua cena e vice-versa', () => {
  assert.deepStrictEqual(CENAS.map(cena => cena.nome), Object.keys(ESPERADO));
});

for (const cena of CENAS) {
  test(`nova-grab content.js: ${cena.nome}`, async () => {
    const registro = await encenar(cena);
    assert.deepStrictEqual(registro, ESPERADO[cena.nome]);
    assert.strictEqual(JSON.stringify(registro), JSON.stringify(ESPERADO[cena.nome]), 'a ordem das chaves mudou');
  });
}
