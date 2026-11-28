'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { encenar } = require('./iphone-inapp.palco');
const { CENAS } = require('./iphone-inapp.cenas');

const ARQUIVO_ESPERADO = path.join(__dirname, 'iphone-inapp.esperado.json');

async function gravarEsperado() {
  const diario = {};
  for (const cena of CENAS) diario[cena.nome] = await encenar(cena);
  fs.writeFileSync(ARQUIVO_ESPERADO, `${JSON.stringify(diario, null, 2)}\n`);
}

if (process.env.ATUALIZAR_DIARIO_DO_INAPP === '1') {
  test('grava o diário das cenas do modal do iPhone no app', gravarEsperado);
} else {
  const ESPERADO = JSON.parse(fs.readFileSync(ARQUIVO_ESPERADO, 'utf8'));

  test('cada cena gravada tem a sua cena e vice-versa', () => {
    assert.deepStrictEqual(CENAS.map((cena) => cena.nome), Object.keys(ESPERADO));
  });

  for (const cena of CENAS) {
    test(`modal do iPhone no app: ${cena.nome}`, async () => {
      const registro = await encenar(cena);
      assert.deepStrictEqual(registro, ESPERADO[cena.nome]);
      assert.strictEqual(JSON.stringify(registro), JSON.stringify(ESPERADO[cena.nome]), 'a ordem das chaves mudou');
    });
  }
}
