'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { criar } = require('./auxiliar');
const { verificar } = require('../regra-binario');

const configuracao = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'configuracao.json'), 'utf8'));
const config = { ...configuracao, binarios: { ...configuracao.binarios, tamanhoMaximoMB: 0.001 } };

const MZ = Buffer.from([0x4d, 0x5a, 0x90, 0, 3, 0]);
const ELF = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]);
const ZIP_LIMPO = Buffer.from('504b0304 mas sem byte de controle');
const GRANDE = Buffer.from('a'.repeat(1100));
const PEQUENO = Buffer.from('a'.repeat(100));
const comControle = byte => Buffer.concat([Buffer.from('texto'), Buffer.from([byte]), Buffer.from('fim')]);

const BASE = {
  'app/mudou-para-mz.dat': PEQUENO,
  'app/era-mz.dat': MZ,
  'app/era-elf.dat': ELF,
  'app/cresceu.txt': PEQUENO,
  'app/ja-era-grande.txt': GRANDE,
  'MAC/x/reservas/velho.dat': PEQUENO,
  'app/codigo.js': 'const a = 1;\n',
};

const ARQUIVOS = [
  ['app/codigo.js', { status: 'M', buffer: Buffer.from('const a = 1;\0\n'), binario: true }],
  ['app/utf16.py', { status: 'A', buffer: Buffer.from('x = 1\n', 'utf16le'), utf16: true }],
  ['scripts/roda', { status: 'A', buffer: Buffer.from('#!/bin/sh\necho "\0"\n'), binario: true }],
  ['docs/notas.txt', { status: 'A', buffer: Buffer.from('notas\n', 'utf16le'), utf16: true }],
  ['app/mudou-para-mz.dat', { status: 'M', buffer: MZ, binario: true }],
  ['app/era-mz.dat', { status: 'M', buffer: Buffer.concat([MZ, Buffer.from([1])]), binario: true }],
  ['app/era-elf.dat', { status: 'M', buffer: MZ, binario: true }],
  ['app/cresceu.txt', { status: 'M', buffer: GRANDE }],
  ['app/ja-era-grande.txt', { status: 'M', buffer: Buffer.concat([GRANDE, GRANDE]) }],
  ['app/sem-base.dat', { status: 'M', buffer: MZ, binario: true }],
  ['MAC/x/reservas/velho.dat', { status: 'M', buffer: MZ, binario: true }],
  ['app/sumiu-modificado.dat', { status: 'M', sumiu: true }],
  ['app/apagado.exe', { status: 'D', sumiu: true }],
  ['app/main.js.bak-1', { status: 'A', buffer: Buffer.from('x') }],
  ['MAC/x/reservas/a.js.antes-patch', { status: 'A', buffer: Buffer.from('x') }],
  ['MAC/x/reservas/instalador.dmg', { status: 'A', buffer: Buffer.from('x') }],
  ['app/node_modules/pacote/index.js', { status: 'R', antigo: 'app/x.js', buffer: Buffer.from('x') }],
  ['app/a.tar', { status: 'A', buffer: Buffer.from('x') }],
  ['app/copia.dat', { status: 'A', buffer: MZ, binario: true }],
  ['app/disfarcado.png', { status: 'A', buffer: ELF, binario: true }],
  ['app/zip-limpo.dat', { status: 'A', buffer: ZIP_LIMPO }],
  ['app/tab.dat', { status: 'A', buffer: Buffer.concat([Buffer.from('MZ'), comControle(9)]) }],
  ['app/controle-8.dat', { status: 'A', buffer: Buffer.concat([Buffer.from('MZ'), comControle(8)]), binario: true }],
  ['app/controle-14.dat', { status: 'A', buffer: Buffer.concat([Buffer.from('MZ'), comControle(14)]), binario: true }],
  ['app/controle-31.dat', { status: 'A', buffer: Buffer.concat([Buffer.from('MZ'), comControle(31)]), binario: true }],
  ['app/controle-13.dat', { status: 'A', buffer: Buffer.concat([Buffer.from('MZ'), comControle(13)]) }],
  ['app/controle-32.dat', { status: 'A', buffer: Buffer.concat([Buffer.from('MZ'), comControle(32)]) }],
  ['app/grande-novo.txt', { status: 'R', antigo: 'app/y.txt', buffer: GRANDE }],
  ['app/no-limite.txt', { status: 'A', buffer: Buffer.from('a'.repeat(1048)) }],
  ['app/sumiu-novo.dat', { status: 'A', sumiu: true }],
  ['app/copiado.txt', { status: 'C', antigo: 'app/z.txt', buffer: GRANDE }],
  ['app/tipo.txt', { status: 'T', buffer: GRANDE }],
];

function ctxDe(repo, lidos) {
  const porCaminho = new Map(ARQUIVOS);
  return {
    raiz: repo.raiz,
    config,
    arquivos: ARQUIVOS.map(([caminho, a]) => ({ caminho, status: a.status, antigo: a.antigo })),
    mudancas: { base: { desde: 'main' }, copias: new Set(['app/copia.dat']) },
    ler(caminho) {
      lidos.push(caminho);
      const arquivo = porCaminho.get(caminho);
      if (arquivo.sumiu) return null;
      return { buffer: arquivo.buffer, binario: Boolean(arquivo.binario), utf16: Boolean(arquivo.utf16) };
    },
  };
}

test('binário: achados na ordem, com leitura dupla do modificado, base consultada e limites de tamanho e de byte de controle', () => {
  const repo = criar(BASE);
  try {
    const lidos = [];
    const achados = verificar(ctxDe(repo, lidos)).map(({ arquivo, detalhe }) => `${arquivo}: ${detalhe}`);
    assert.deepEqual(achados, [
      'app/codigo.js: arquivo de código com byte nulo: as regras de linha não o leem',
      'app/utf16.py: arquivo de código em UTF-16: o interpretador o lê de outro jeito; código entra em UTF-8',
      'scripts/roda: arquivo de código com byte nulo: as regras de linha não o leem',
      'app/mudou-para-mz.dat: o conteúdo passou a ser executável Windows (MZ)',
      'app/era-elf.dat: o conteúdo passou a ser executável Windows (MZ)',
      'app/cresceu.txt: 0.0 MB: passou do limite de 0.001 MB',
      'app/main.js.bak-1: cópia de backup, sobra de editor, log ou pasta de dependências',
      'MAC/x/reservas/instalador.dmg: extensão .dmg: instalador, pacote ou binário não entra no repositório',
      'app/node_modules/pacote/index.js: cópia de backup, sobra de editor, log ou pasta de dependências',
      'app/a.tar: extensão .tar: instalador, pacote ou binário não entra no repositório',
      'app/disfarcado.png: o conteúdo é executável Linux (ELF), mesmo com outro nome',
      'app/controle-8.dat: o conteúdo é executável Windows (MZ), mesmo com outro nome',
      'app/controle-14.dat: o conteúdo é executável Windows (MZ), mesmo com outro nome',
      'app/controle-31.dat: o conteúdo é executável Windows (MZ), mesmo com outro nome',
      'app/grande-novo.txt: 0.0 MB, acima do limite de 0.001 MB para arquivo novo',
    ]);
    const vezes = caminho => lidos.filter(lido => lido === caminho).length;
    assert.deepEqual(ARQUIVOS.map(([caminho]) => `${caminho}:${vezes(caminho)}`), [
      'app/codigo.js:1', 'app/utf16.py:1', 'scripts/roda:1', 'docs/notas.txt:2', 'app/mudou-para-mz.dat:2', 'app/era-mz.dat:2',
      'app/era-elf.dat:2', 'app/cresceu.txt:2', 'app/ja-era-grande.txt:2', 'app/sem-base.dat:2', 'MAC/x/reservas/velho.dat:2',
      'app/sumiu-modificado.dat:2', 'app/apagado.exe:0', 'app/main.js.bak-1:2', 'MAC/x/reservas/a.js.antes-patch:2',
      'MAC/x/reservas/instalador.dmg:2', 'app/node_modules/pacote/index.js:2', 'app/a.tar:2', 'app/copia.dat:2', 'app/disfarcado.png:2',
      'app/zip-limpo.dat:2', 'app/tab.dat:2', 'app/controle-8.dat:2', 'app/controle-14.dat:2', 'app/controle-31.dat:2',
      'app/controle-13.dat:2', 'app/controle-32.dat:2', 'app/grande-novo.txt:2', 'app/no-limite.txt:2', 'app/sumiu-novo.dat:2',
      'app/copiado.txt:1', 'app/tipo.txt:1',
    ]);
  } finally {
    repo.limpar();
  }
});
