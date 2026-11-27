'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { rodarCena } = require('./cam-live-service.palco');
const cenas = require('./cam-live-service.cenas');

const ARQUIVO_ESPERADO = path.join(__dirname, 'cam-live-service.esperado.json');

async function gravarDiario() {
  const diario = {};
  for (const cena of cenas) diario[cena.nome] = await rodarCena(cena);
  fs.writeFileSync(ARQUIVO_ESPERADO, `${JSON.stringify(diario, null, 2)}\n`);
}

if (process.env.ATUALIZAR_DIARIO_DO_CAMLIVE === '1') {
  test('regrava o diário', { timeout: 120000 }, gravarDiario);
} else {
  const esperado = JSON.parse(fs.readFileSync(ARQUIVO_ESPERADO, 'utf8'));

  test('cada cena tem o diário gravado', () => {
    assert.deepStrictEqual(cenas.map((cena) => cena.nome), Object.keys(esperado));
  });

  for (const cena of cenas) {
    test(cena.nome, { timeout: 60000 }, async () => {
      assert.deepStrictEqual(await rodarCena(cena), esperado[cena.nome]);
    });
  }
}
