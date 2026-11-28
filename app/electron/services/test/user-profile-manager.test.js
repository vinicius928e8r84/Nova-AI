'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { rodarCena } = require('./user-profile-manager.palco');
const cenas = require('./user-profile-manager.cenas');

const ARQUIVO_ESPERADO = path.join(__dirname, 'user-profile-manager.esperado.json');

async function gravarDiario() {
  const diario = {};
  for (const cena of cenas) diario[cena.nome] = await rodarCena(cena);
  fs.writeFileSync(ARQUIVO_ESPERADO, `${JSON.stringify(diario, null, 2)}\n`);
}

if (process.env.ATUALIZAR_DIARIO_DO_PERFIL === '1') {
  test('regrava o diário', gravarDiario);
} else {
  const esperado = JSON.parse(fs.readFileSync(ARQUIVO_ESPERADO, 'utf8'));

  test('cada cena tem o diário gravado', () => {
    assert.deepStrictEqual(cenas.map((cena) => cena.nome), Object.keys(esperado));
  });

  for (const cena of cenas) {
    test(cena.nome, async () => {
      assert.deepStrictEqual(await rodarCena(cena), esperado[cena.nome]);
    });
  }
}
