'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ehMacho, lerMacho } = require('../macho');
const { construirMacho } = require('./construtores');

const DIREITOS = '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n  <dict>\n    <key>platform-application</key>\n    <true/>\n  </dict>\n</plist>\n';

test('lê símbolos importados e exportados e ignora os locais e os de depuração', () => {
  const macho = lerMacho(construirMacho({ importados: ['_objc_msgSend', '_MSHookMessageEx'], exportados: ['_main', '_ProxyConfig'], locais: ['_interno'] }));
  assert.deepEqual(macho.simbolosImportados, ['_MSHookMessageEx', '_objc_msgSend']);
  assert.deepEqual(macho.simbolosExportados, ['_ProxyConfig', '_main']);
});

test('lê as bibliotecas ligadas e marca a fraca e a reexportada', () => {
  const macho = lerMacho(construirMacho({
    bibliotecas: [{ nome: '/usr/lib/libobjc.A.dylib' }, { nome: '@rpath/CydiaSubstrate.framework/CydiaSubstrate', tipo: 'fraca' }, { nome: '/usr/lib/libz.dylib', tipo: 'reexportada' }],
  }));
  assert.deepEqual(macho.bibliotecas, ['/usr/lib/libobjc.A.dylib', '/usr/lib/libz.dylib (reexportada)', '@rpath/CydiaSubstrate.framework/CydiaSubstrate (fraca)']);
});

test('lê os textos e os seletores, sem repetição e em ordem, com acento e quebra de linha', () => {
  const macho = lerMacho(construirMacho({
    textos: ['proxy inválido', 'erro: %s\n', 'proxy inválido', 'aguardando configuração...'],
    seletores: ['setObject:forKey:', 'dataUsingEncoding:', 'setObject:forKey:'],
  }));
  assert.deepEqual(macho.textos, ['aguardando configuração...', 'erro: %s\n', 'proxy inválido']);
  assert.deepEqual(macho.seletores, ['dataUsingEncoding:', 'setObject:forKey:']);
});

test('lê os direitos da assinatura, linha a linha, e diz que está assinado', () => {
  const macho = lerMacho(construirMacho({ direitos: DIREITOS }));
  assert.equal(macho.assinado, true);
  assert.deepEqual(macho.direitos, ['<?xml version="1.0" encoding="UTF-8"?>', '<plist version="1.0">', '<dict>', '<key>platform-application</key>', '<true/>', '</dict>', '</plist>']);
});

test('binário sem assinatura não tem direitos', () => {
  const macho = lerMacho(construirMacho());
  assert.equal(macho.assinado, false);
  assert.deepEqual(macho.direitos, []);
});

test('o resumo do código muda com o código e não muda com o que fica fora dele', () => {
  const base = lerMacho(construirMacho({ codigo: 'mov x0, x1', rodape: 'uuid-1' }));
  assert.equal(lerMacho(construirMacho({ codigo: 'mov x0, x1', rodape: 'uuid-2' })).codigo, base.codigo);
  assert.notEqual(lerMacho(construirMacho({ codigo: 'mov x0, x2' })).codigo, base.codigo);
  assert.match(base.codigo, /^[0-9a-f]{64}$/);
});

test('reconhece o Mach-O de 64 bits e recusa o que não é', () => {
  assert.equal(ehMacho(construirMacho()), true);
  assert.equal(ehMacho(Buffer.from('#!/bin/sh\nexit 0\n# com mais de trinta e dois bytes')), false);
  assert.equal(ehMacho(Buffer.from('curto')), false);
  assert.equal(ehMacho(Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(60)])), false);
});

test('binário com várias arquiteturas (fat) é recusado com a razão', () => {
  const fat = Buffer.alloc(64);
  fat.writeUInt32BE(0xcafebabe, 0);
  assert.throws(() => ehMacho(fat), /fat/);
});
