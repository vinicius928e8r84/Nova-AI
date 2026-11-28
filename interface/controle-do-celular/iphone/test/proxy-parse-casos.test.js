'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ARQUIVO_DO_LEITOR = path.join(__dirname, '..', 'proxy-parse.js');
const casos = JSON.parse(fs.readFileSync(path.join(__dirname, 'proxy-parse-casos.json'), 'utf8'));

function daInjecao() {
  const linhas = fs.readFileSync(ARQUIVO_DO_LEITOR, 'utf8').split(/\r?\n/).filter((linha) => !linha.startsWith('if (typeof module'));
  const corpo = linhas.join('\n').replace('var PV_EXPORTS =', 'return ').trimEnd();
  assert.ok(corpo.endsWith('};'));
  return vm.runInNewContext('(()=>{\n' + corpo + '\n})()');
}

const leitores = [['pelo require', require(ARQUIVO_DO_LEITOR)], ['pelo texto que o patch da interface injeta', daInjecao()]];

const comoObjeto = (linha) => linha && { scheme: linha[0], host: linha[1], port: linha[2], user: linha[3], pass: linha[4] };
const entradaDaTabela = (entrada) => (entrada === 'undefined' ? undefined : JSON.parse(entrada));

for (const [nome, leitor] of leitores) {
  test(`o leitor ${nome} exporta as mesmas seis funções`, () => {
    assert.deepEqual(Object.keys(leitor), casos.chaves);
  });

  test(`o leitor ${nome} lê cada uma das ${casos.parse.length} entradas gravadas da mesma forma`, () => {
    const divergentes = casos.parse
      .map(([entrada, esperado]) => [entrada, esperado, leitor.parse(entrada)])
      .filter(([, esperado, lido]) => JSON.stringify(comoObjeto(esperado)) !== JSON.stringify(lido));
    assert.deepEqual(divergentes, []);
  });

  test(`o leitor ${nome} normaliza, acha o tipo, troca o tipo e valida como gravado`, () => {
    const lidas = casos.derivadas.map(([entrada]) => [
      entrada, leitor.norm(entrada), leitor.norm(entrada, 'http'), leitor.norm(entrada, 'socks4://'),
      leitor.schemeOf(entrada), leitor.withScheme('https', entrada), leitor.withScheme('socks5h', entrada), leitor.isValid(entrada),
    ]);
    assert.deepEqual(lidas, casos.derivadas);
  });

  test(`o leitor ${nome} monta a forma canônica como gravado`, () => {
    assert.deepEqual(casos.build.map(([tipo, objeto]) => [tipo, objeto, leitor.build(tipo, objeto)]), casos.build);
  });

  test(`o leitor ${nome} trata o que não é texto como gravado`, () => {
    const lidas = casos.naoTexto.map(([entrada]) => {
      const valor = entradaDaTabela(entrada);
      return [entrada, leitor.parse(valor), leitor.norm(valor), leitor.schemeOf(valor), leitor.withScheme('http', valor), leitor.isValid(valor)];
    });
    assert.deepEqual(lidas, casos.naoTexto);
  });
}
