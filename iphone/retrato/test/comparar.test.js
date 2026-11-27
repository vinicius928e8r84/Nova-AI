'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { tirarRetrato } = require('../retrato');
const { compararRetratos } = require('../comparar');
const { construirDeb, construirMacho } = require('./construtores');

const BINARIO = 'var/jb/usr/bin/proxy';

const BASE = {
  importados: ['_objc_msgSend', '_socket'],
  exportados: ['_main'],
  bibliotecas: [{ nome: '/usr/lib/libobjc.A.dylib' }],
  textos: ['proxy inválido', 'aguardando configuração...'],
  seletores: ['init', 'setObject:forKey:'],
  direitos: '<key>platform-application</key>\n<true/>',
  codigo: 'codigo-base',
};

function retratoDe({ binario = {}, controle = 'Package: p\nVersion: 0.2\nInstalled-Size: 96\n', extras = [] } = {}) {
  const dados = construirMacho({ ...BASE, ...binario });
  return tirarRetrato(construirDeb({
    controle,
    scripts: { postinst: 'exit 0\n' },
    arquivos: [{ nome: `./${BINARIO}`, dados, modo: 0o755 }, { nome: './var/jb/usr/share/p/modelos.json', dados: '{}' }, ...extras],
  }));
}

const diferencasDe = (mudanca, ignorar) => compararRetratos(retratoDe(), retratoDe(mudanca), ignorar);

test('dois retratos iguais não têm diferença', () => {
  assert.deepEqual(compararRetratos(retratoDe(), retratoDe()), []);
});

test('uma mudança de propósito num texto aparece, com o texto que saiu e o que entrou', () => {
  assert.deepEqual(diferencasDe({ binario: { textos: ['proxy inválido', 'aguardando a configuração...'] } }, ['bytes']), [
    `binário ${BINARIO}: texto acrescentado: "aguardando a configuração..."`,
    `binário ${BINARIO}: texto removido: "aguardando configuração..."`,
  ]);
});

test('uma mudança de propósito num seletor aparece', () => {
  assert.deepEqual(diferencasDe({ binario: { seletores: ['init', 'setValue:forKey:'] } }, ['bytes']), [
    `binário ${BINARIO}: seletor acrescentado: "setValue:forKey:"`,
    `binário ${BINARIO}: seletor removido: "setObject:forKey:"`,
  ]);
});

test('símbolo importado, símbolo exportado, biblioteca e direitos que mudam aparecem', () => {
  const diferencas = diferencasDe({
    binario: {
      importados: ['_objc_msgSend', '_connect'],
      exportados: ['_main', '_run'],
      bibliotecas: [{ nome: '/usr/lib/libobjc.A.dylib' }, { nome: '/usr/lib/libSystem.B.dylib', tipo: 'fraca' }],
      direitos: '<key>platform-application</key>\n<true/>\n<key>com.apple.private.security.no-sandbox</key>',
    },
  }, ['bytes']);
  assert.deepEqual(diferencas, [
    `binário ${BINARIO}: símbolo importado acrescentado: "_connect"`,
    `binário ${BINARIO}: símbolo importado removido: "_socket"`,
    `binário ${BINARIO}: símbolo exportado acrescentado: "_run"`,
    `binário ${BINARIO}: biblioteca ligada acrescentado: "/usr/lib/libSystem.B.dylib (fraca)"`,
    `binário ${BINARIO}: linha dos direitos acrescentado: "<key>com.apple.private.security.no-sandbox</key>"`,
  ]);
});

test('binário que perde a assinatura aparece', () => {
  const sem = { binario: { direitos: null } };
  const diferencas = compararRetratos(retratoDe(), retratoDe(sem));
  assert.ok(diferencas.includes(`binário ${BINARIO}: assinado: mudou de true para false`));
  assert.ok(diferencas.includes(`binário ${BINARIO}: linha dos direitos removido: "<true/>"`));
});

test('arquivo acrescentado, arquivo removido e arquivo que mudou de modo ou de conteúdo aparecem', () => {
  const antes = retratoDe({ extras: [{ nome: './var/jb/usr/share/p/velho.txt', dados: 'a' }, { nome: './var/jb/usr/share/p/ajuste.txt', dados: 'um', modo: 0o644 }] });
  const depois = retratoDe({ extras: [{ nome: './var/jb/usr/share/p/novo.txt', dados: 'b' }, { nome: './var/jb/usr/share/p/ajuste.txt', dados: 'dois', modo: 0o600 }] });
  const diferencas = compararRetratos(antes, depois);
  assert.ok(diferencas.includes('arquivo acrescentado: var/jb/usr/share/p/novo.txt'));
  assert.ok(diferencas.includes('arquivo removido: var/jb/usr/share/p/velho.txt'));
  assert.ok(diferencas.includes('arquivo var/jb/usr/share/p/ajuste.txt: modo: mudou de "0644" para "0600"'));
  assert.ok(diferencas.some(linha => linha.startsWith('arquivo var/jb/usr/share/p/ajuste.txt: sha256: mudou de')));
  assert.equal(diferencas.length, 5);
});

test('a versão do controle aparece, e --ignorar versao a esconde', () => {
  const mudanca = { controle: 'Package: p\nVersion: 0.3\nInstalled-Size: 96\n' };
  assert.deepEqual(diferencasDe(mudanca), ['controle Version: mudou de "0.2" para "0.3"']);
  assert.deepEqual(diferencasDe(mudanca, ['versao']), []);
});

test('campo do controle que entra ou sai aparece', () => {
  assert.deepEqual(diferencasDe({ controle: 'Package: p\nVersion: 0.2\nInstalled-Size: 96\nDepends: sudo\n' }), ['controle Depends: acrescentado "sudo"']);
  assert.deepEqual(diferencasDe({ controle: 'Package: p\nVersion: 0.2\n' }), ['controle Installed-Size: removido (era "96")']);
});

test('--ignorar bytes esconde o tamanho do binário, o resumo do código e o Installed-Size, mas não o texto', () => {
  const mudanca = { binario: { codigo: 'codigo-novo-e-maior', textos: [...BASE.textos, 'texto novo'] }, controle: 'Package: p\nVersion: 0.2\nInstalled-Size: 120\n' };
  const todas = diferencasDe(mudanca);
  assert.ok(todas.some(linha => linha.includes('sha256 do código')));
  assert.ok(todas.some(linha => linha.includes('tamanho: mudou')));
  assert.ok(todas.includes('controle Installed-Size: mudou de "96" para "120"'));
  assert.deepEqual(diferencasDe(mudanca, ['bytes']), [`binário ${BINARIO}: texto acrescentado: "texto novo"`]);
});

test('arquivo que passa a ser Mach-O, ou deixa de ser, aparece', () => {
  const comoTexto = retratoDe({ extras: [{ nome: './var/jb/usr/bin/outro', dados: 'texto simples' }] });
  const comoMacho = retratoDe({ extras: [{ nome: './var/jb/usr/bin/outro', dados: construirMacho() }] });
  const passou = compararRetratos(comoTexto, comoMacho);
  assert.ok(passou.includes('binário var/jb/usr/bin/outro: passou a ser um Mach-O'));
  assert.ok(compararRetratos(comoMacho, comoTexto).includes('binário var/jb/usr/bin/outro: deixou de ser um Mach-O'));
});

test('retrato de outro formato e opção de ignorar desconhecida dão erro que diz o problema', () => {
  assert.throws(() => compararRetratos({ formato: 2 }, retratoDe()), /retrato "antes" não tem o formato 1/);
  assert.throws(() => compararRetratos(retratoDe(), null), /retrato "depois"/);
  assert.throws(() => compararRetratos(retratoDe(), retratoDe(), ['tudo']), /não sei ignorar: tudo \(use versao ou bytes\)/);
});
