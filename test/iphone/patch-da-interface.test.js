'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { acharPython } = require('./script-python.palco');
const { rodarCena } = require('./patch-da-interface.palco');
const { patches } = require('./patch-da-interface.cenas');
const esperado = require('./patch-da-interface.esperado.json');

const python = acharPython();
const SEM_PYTHON = 'precisa de Python 3 e não roda no Windows';

for (const patch of patches) {
  test(`${patch.nome}: cada cena tem o diário gravado`, () => {
    assert.deepStrictEqual(patch.cenas.map(cena => cena.nome), Object.keys(esperado[patch.nome]));
  });

  for (const cena of patch.cenas) {
    test(`${patch.nome}: o texto que o patch gera ${cena.nome}`, { skip: !python && SEM_PYTHON }, () => {
      const diario = rodarCena(python, patch, cena);
      assert.deepStrictEqual(diario, esperado[patch.nome][cena.nome]);
      assert.strictEqual(JSON.stringify(diario), JSON.stringify(esperado[patch.nome][cena.nome]), 'mesmos valores, mas a ordem das chaves mudou');
    });
  }
}
