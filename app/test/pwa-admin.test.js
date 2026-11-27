'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { encenar, scriptsDaPagina } = require('./pwa-admin.palco');
const { cenas } = require('./pwa-admin.cenas');
const ESPERADO = require('./pwa-admin.esperado.json');

test('cada cena gravada tem a sua cena e vice-versa', () => {
  assert.deepStrictEqual(Object.keys(cenas), Object.keys(ESPERADO));
});

test('a página do admin tem ao menos um script próprio', () => {
  assert.ok(scriptsDaPagina().length > 0);
});

for (const [nome, cena] of Object.entries(cenas)) {
  test(`pwa/admin.html: ${nome}`, async () => {
    assert.deepStrictEqual(await encenar(cena), ESPERADO[nome]);
  });
}
