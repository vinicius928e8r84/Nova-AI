'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { rodarPagina } = require('./live-cam-paginas.palco');
const cenas = require('./live-cam-paginas.cenas');
const esperado = require('./live-cam-paginas.esperado.json');
const PAGINAS = require('../live-cam-paginas');

test('cada roteiro de página tem o diário gravado', () => {
  assert.deepStrictEqual(cenas.map(cena => cena.nome), Object.keys(esperado));
});

for (const cena of cenas) {
  test(cena.nome, async () => {
    assert.deepStrictEqual(await rodarPagina(PAGINAS[cena.pagina], cena.roteiro, structuredClone(cena.cenario ?? {})), esperado[cena.nome]);
  });
}
