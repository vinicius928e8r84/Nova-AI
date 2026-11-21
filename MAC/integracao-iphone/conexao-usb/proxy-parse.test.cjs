'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const P = require('./proxy-parse.js');
const { ENTRADAS, ESQUEMAS } = require('./proxy-parse.casos.cjs');
const ESPERADO = require('./proxy-parse.esperado.json');

const FONTE = path.join(__dirname, 'proxy-parse.js');

function retrato(helpers) {
  return ENTRADAS.map(entrada => ({
    entrada: entrada === null ? '(null)' : entrada,
    parse: helpers.parse(entrada),
    isValid: helpers.isValid(entrada),
    schemeOf: helpers.schemeOf(entrada),
    norm: ESQUEMAS.map(esquema => helpers.norm(entrada, esquema)),
    withScheme: ESQUEMAS.slice(2).map(esquema => helpers.withScheme(esquema, entrada)),
  }));
}

test('proxy-parse.js: cada formato colado sai igual (parse, isValid, schemeOf, norm e withScheme)', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(retrato(P))), ESPERADO);
});

test('proxy-parse.js: o corpo que o aplicar-proxy-tipo.py injeta no bundle devolve os mesmos helpers', () => {
  const linhas = fs.readFileSync(FONTE, 'utf8').split('\n').filter(linha => !linha.startsWith('if (typeof module'));
  const corpo = linhas.join('\n').replace('var PV_EXPORTS =', 'return ').trimEnd();
  assert.ok(corpo.endsWith('};'), 'proxy-parse.js sem bloco PV_EXPORTS');
  const injetado = new Function(`return (() => {\n${corpo}\n})();`)();
  assert.deepEqual(JSON.parse(JSON.stringify(retrato(injetado))), ESPERADO);
  assert.deepEqual(Object.keys(injetado), ['parse', 'build', 'norm', 'schemeOf', 'withScheme', 'isValid']);
  assert.equal(injetado.build('', { host: 'h.exemplo.com', port: 1, user: '', pass: '', scheme: '' }), 'socks5://h.exemplo.com:1');
});
