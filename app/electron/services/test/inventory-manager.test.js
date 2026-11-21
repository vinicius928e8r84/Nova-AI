'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { rodarCena } = require('./inventory-manager.palco');
const cenas = require('./inventory-manager.cenas');
const esperado = require('./inventory-manager.esperado.json');

const MODULO = path.join(__dirname, '..', 'inventory-manager.js');

test('cada cena tem o diário gravado', () => {
  assert.deepStrictEqual(cenas.map(cena => cena.nome), Object.keys(esperado));
});

for (const cena of cenas) {
  test(cena.nome, async () => {
    const diario = await rodarCena(MODULO, cena);
    assert.deepStrictEqual(diario, esperado[cena.nome]);
    assert.strictEqual(JSON.stringify(diario), JSON.stringify(esperado[cena.nome]), 'mesmos valores, mas a ordem das chaves mudou');
  });
}
