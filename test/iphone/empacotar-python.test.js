'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { acharPython } = require('./script-python.palco');
const { rodarCena } = require('./empacotar-python.palco');
const { cenas } = require('./empacotar-python.cenas');
const esperado = require('./empacotar-python.esperado.json');

const python = acharPython();
const SEM_PYTHON = 'precisa de Python 3 e não roda no Windows';

test('cada cena tem o diário gravado', () => {
  assert.deepStrictEqual(cenas.map(cena => cena.nome), Object.keys(esperado));
});

for (const cena of cenas) {
  test(`o runtime que o script monta: ${cena.nome}`, { skip: !python && SEM_PYTHON }, () => {
    const diario = rodarCena(python, cena);
    assert.deepStrictEqual(diario, esperado[cena.nome]);
    assert.strictEqual(JSON.stringify(diario), JSON.stringify(esperado[cena.nome]), 'mesmos valores, mas a ordem das chaves mudou');
  });
}
