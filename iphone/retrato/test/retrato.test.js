'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { tirarRetrato, lerControle } = require('../retrato');
const { construirDeb, construirMacho, membroDoAr, construirTar } = require('./construtores');

const CONTROLE = 'Package: com.exemplo.proxy\nVersion: 0.2\nArchitecture: iphoneos-arm64\nDescription: Proxy local\n com duas linhas\nDepends: firmware (>= 15.0), sudo\n';

const arquivosDoPacote = (binario, mtime = 0) => [
  { nome: './', tipo: '5', modo: 0o755, mtime },
  { nome: './var/', tipo: '5', modo: 0o755, mtime },
  { nome: './var/jb/usr/bin/proxy', dados: binario, modo: 0o755, mtime },
  { nome: './var/jb/Library/LaunchDaemons/proxy.plist', dados: '<plist/>', mtime },
  { nome: './var/jb/usr/bin/atalho', tipo: '2', alvo: 'proxy', modo: 0o777, mtime },
];

const binarioDeExemplo = (extras = {}) => construirMacho({ importados: ['_objc_msgSend'], exportados: ['_main'], textos: ['olá'], seletores: ['init'], direitos: '<dict/>', ...extras });

test('o controle vira um mapa em ordem alfabética, com a linha de continuação junta à anterior', () => {
  const controle = lerControle(CONTROLE);
  assert.deepEqual(Object.keys(controle), ['Architecture', 'Depends', 'Description', 'Package', 'Version']);
  assert.equal(controle.Description, 'Proxy local\ncom duas linhas');
  assert.equal(controle.Depends, 'firmware (>= 15.0), sudo');
});

test('retrato do .deb: controle, arquivos com modo e dono, scripts do pacote e só o Mach-O em binarios', () => {
  const deb = construirDeb({ controle: CONTROLE, scripts: { postinst: '#!/bin/sh\nexit 0\n' }, arquivos: arquivosDoPacote(binarioDeExemplo()) });
  const retrato = tirarRetrato(deb);
  assert.equal(retrato.formato, 1);
  assert.equal(retrato.controle.Version, '0.2');
  assert.deepEqual(Object.keys(retrato.arquivos), [
    'DEBIAN/postinst',
    'var',
    'var/jb/Library/LaunchDaemons/proxy.plist',
    'var/jb/usr/bin/atalho',
    'var/jb/usr/bin/proxy',
  ]);
  assert.deepEqual(retrato.arquivos['var/jb/usr/bin/atalho'], { tipo: 'link', modo: '0777', dono: 'root', grupo: 'wheel', alvo: 'proxy' });
  assert.deepEqual(retrato.arquivos.var, { tipo: 'pasta', modo: '0755', dono: 'root', grupo: 'wheel' });
  assert.equal(retrato.arquivos['DEBIAN/postinst'].modo, '0755');
  assert.deepEqual(Object.keys(retrato.binarios), ['var/jb/usr/bin/proxy']);
  assert.deepEqual(retrato.binarios['var/jb/usr/bin/proxy'].textos, ['olá']);
  assert.deepEqual(retrato.binarios['var/jb/usr/bin/proxy'].simbolosImportados, ['_objc_msgSend']);
});

test('arquivo comum tem o sha256 do conteúdo; o binário Mach-O tem só o tamanho, porque o UUID muda a cada montagem', () => {
  const binario = binarioDeExemplo();
  const retrato = tirarRetrato(construirDeb({ controle: CONTROLE, arquivos: arquivosDoPacote(binario) }));
  const plist = retrato.arquivos['var/jb/Library/LaunchDaemons/proxy.plist'];
  assert.equal(plist.sha256, crypto.createHash('sha256').update('<plist/>').digest('hex'));
  assert.equal(plist.tamanho, 8);
  assert.equal(retrato.arquivos['var/jb/usr/bin/proxy'].tamanho, binario.length);
  assert.equal('sha256' in retrato.arquivos['var/jb/usr/bin/proxy'], false);
});

test('montar duas vezes dá o mesmo retrato: a data dos arquivos e o UUID do binário não contam', () => {
  const primeira = tirarRetrato(construirDeb({ controle: CONTROLE, arquivos: arquivosDoPacote(binarioDeExemplo({ rodape: 'uuid-1' }), 1700000000) }));
  const segunda = tirarRetrato(construirDeb({ controle: CONTROLE, arquivos: arquivosDoPacote(binarioDeExemplo({ rodape: 'uuid-2' }), 1800000000) }));
  assert.deepEqual(segunda, primeira);
  assert.equal(JSON.stringify(segunda), JSON.stringify(primeira));
});

test('o retrato é o mesmo com o pacote comprimido ou sem compressão', () => {
  const comprimido = tirarRetrato(construirDeb({ controle: CONTROLE, arquivos: arquivosDoPacote(binarioDeExemplo()) }));
  const solto = tirarRetrato(construirDeb({ controle: CONTROLE, arquivos: arquivosDoPacote(binarioDeExemplo()), compressao: 'nenhuma' }));
  assert.deepEqual(solto, comprimido);
});

function registroPax(chave, valor) {
  const corpo = ` ${chave}=${valor}\n`;
  const tamanho = corpo.length + String(corpo.length + 1).length;
  return `${tamanho}${corpo}`;
}

test('caminho comprido no prefixo do ustar, no nome longo do GNU e no cabeçalho pax é lido inteiro', () => {
  const prefixo = 'var/jb/Library/MobileSubstrate/DynamicLibraries/com/exemplo/de/um/caminho';
  const nomeGnu = `var/jb/${'pasta-comprida/'.repeat(8)}arquivo.txt`;
  const nomePax = `var/jb/${'outra-pasta/'.repeat(9)}pax.txt`;
  const entradas = [
    { nome: 'um.txt', prefixo, dados: 'a' },
    { nome: '././@LongLink', tipo: 'L', dados: `${nomeGnu}\0` },
    { nome: 'cortado', dados: 'b' },
    { nome: 'PaxHeader/x', tipo: 'x', dados: registroPax('path', nomePax) },
    { nome: 'cortado-pax', dados: 'c' },
  ];
  const dados = construirTar(entradas);
  const deb = Buffer.concat([Buffer.from('!<arch>\n'), membroDoAr('control.tar', construirTar([{ nome: './control', dados: CONTROLE }])), membroDoAr('data.tar', dados)]);
  const retrato = tirarRetrato(deb);
  assert.deepEqual(Object.keys(retrato.arquivos), [nomeGnu, nomePax, `${prefixo}/um.txt`].sort());
});

test('arquivo que não é um .deb, .deb cortado e .deb sem control dão erro que diz o problema', () => {
  assert.throws(() => tirarRetrato(Buffer.from('isto não é um pacote')), /não é um \.deb/);
  const deb = construirDeb({ controle: CONTROLE, arquivos: arquivosDoPacote(binarioDeExemplo()) });
  assert.throws(() => tirarRetrato(deb.subarray(0, deb.length - 40)), /truncado/);
  const semControle = Buffer.concat([Buffer.from('!<arch>\n'), membroDoAr('data.tar', construirTar([]))]);
  assert.throws(() => tirarRetrato(semControle), /control\.tar/);
  const semArquivoControl = Buffer.concat([Buffer.from('!<arch>\n'), membroDoAr('control.tar', construirTar([{ nome: './outro', dados: 'x' }])), membroDoAr('data.tar', construirTar([]))]);
  assert.throws(() => tirarRetrato(semArquivoControl), /arquivo control/);
});

test('compressão que o programa não conhece dá erro com o nome do membro', () => {
  const deb = Buffer.concat([Buffer.from('!<arch>\n'), membroDoAr('control.tar.bz2', Buffer.from('x')), membroDoAr('data.tar.bz2', Buffer.from('x'))]);
  assert.throws(() => tirarRetrato(deb), /compressão não suportada em control\.tar\.bz2/);
});
