'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const nomes = require('./teste-ipc.nomes.json');

const SCRIPT = path.join(__dirname, 'teste-ipc.js');
const PALCO = path.join(__dirname, 'teste-ipc.palco.js');

function rodar(...argumentosDoNode) {
  const processo = spawnSync(process.execPath, [...argumentosDoNode, SCRIPT], { encoding: 'utf8' });
  return { saida: processo.stdout, status: processo.status };
}

test('as verificações do script têm os mesmos nomes, na mesma ordem', () => {
  const lidos = [...fs.readFileSync(SCRIPT, 'utf8').matchAll(/\bok\(\s*'([^']+)'/g)].map(achado => achado[1]);
  assert.deepStrictEqual(lidos, nomes);
});

test('o script passa e diz que todos os testes passaram', () => {
  assert.deepStrictEqual(rodar(), { saida: 'IPC DE IDIOMA: TODOS OS TESTES PASSARAM\n', status: 0 });
});

test('com o idioma devolvendo outro valor o script acusa só as verificações afetadas e sai com 1', () => {
  const { saida, status } = rodar('--require', PALCO);
  assert.strictEqual(status, 1);
  assert.deepStrictEqual(saida.split('\n').filter(linha => linha.startsWith('FALHA [')).map(linha => linha.slice(0, linha.indexOf(']') + 1)), ['FALHA [get-language]', 'FALHA [get-apps-proprios]', 'FALHA [revert]']);
  assert.ok(saida.endsWith('3 FALHA(S) NO IPC\n'));
});
