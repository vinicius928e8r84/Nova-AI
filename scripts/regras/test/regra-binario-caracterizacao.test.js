'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const config = require('../configuracao.json');
const { criar } = require('./auxiliar');
const { contextoDoRepositorio } = require('./contexto-de-repositorio');
const regra = require('../regra-binario');

const MEGA = 1024 * 1024;
const zip = Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(40)]);
const gzip = Buffer.concat([Buffer.from([0x1f, 0x8b]), Buffer.alloc(40)]);
const elf = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(40)]);
const dadosComNulos = Buffer.from([1, 2, 0, 3, 0, 0, 65, 66]);
const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('const a = 1;\n', 'utf16le')]);
const mzCom = (...depois) => Buffer.concat([Buffer.from('MZ'), Buffer.from(depois), Buffer.from(' resto\n')]);
const mzComControleNa = posicao => Buffer.concat([Buffer.from('MZ'), Buffer.alloc(posicao - 2, 'a'), Buffer.from([1]), Buffer.from('fim')]);
const grande = (megas, letra = 'a') => Buffer.alloc(megas * MEGA, letra);
const CONFIG_COM_LIMITE_DE_1_MB = { ...config, binarios: { ...config.binarios, tamanhoMaximoMB: 1 } };

const BASE = {
  'app/base-zip.dat': zip,
  'app/ja-era-zip.dat': zip,
  'app/virou-gzip.dat': 'texto\n',
  'app/cresceu.dat': grande(0.5),
  'app/ja-era-grande.dat': grande(2),
  'app/virou-nulo.js': 'const a = 1;\n',
  'app/velho.bin': elf,
  'app/chega-no-limite.dat': grande(0.5, 'c'),
  'app/exato.dat': grande(1, 'e'),
  'app/apagado.zip': zip,
  'app/estavel.dat': dadosComNulos,
};

const MUDANCAS = {
  'app/codigo-com-nulo.js': Buffer.from('const a = 1;\0\n'),
  'app/utf16.js': utf16,
  'app/utf16.txt': utf16,
  'app/dados.dat': Buffer.concat([dadosComNulos, Buffer.from('so')]),
  'app/copia-de-dados.dat': dadosComNulos,
  'app/sem-extensao': Buffer.concat([zip, Buffer.from('um')]),
  'app/sem-extensao-elf': Buffer.concat([elf, Buffer.from('dois')]),
  'app/mz-sem-byte-de-controle': Buffer.from('MZ texto comum\n'),
  'app/mz-com-8': mzCom(8),
  'app/mz-com-tab': mzCom(9),
  'app/mz-com-cr': mzCom(13),
  'app/mz-com-14': mzCom(14),
  'app/mz-com-31': mzCom(31),
  'app/mz-com-espaco': mzCom(32),
  'app/mz-controle-na-posicao-511': mzComControleNa(511),
  'app/mz-controle-na-posicao-512': mzComControleNa(512),
  'app/chega-no-limite.dat': grande(1, 'c'),
  'app/exato.dat': grande(2, 'e'),
  'app/instalador.exe': 'qualquer coisa\n',
  'app/pacote.deb': Buffer.from('!<arch>\n'),
  'reservas/copia.js': 'const a = 1;\n',
  'app/nota.log': 'log\n',
  'app/x.bak': 'bak\n',
  'node_modules/m/index.js': 'x\n',
  'app/enorme.dat': grande(2, 'b'),
  'app/limite.dat': grande(1),
  'app/copia-identica.zip': zip,
  'app/copia-identica.dat': zip,
  'app/novo-nome': elf,
  'app/virou-gzip.dat': gzip,
  'app/ja-era-zip.dat': Buffer.concat([zip, Buffer.from('mais')]),
  'app/cresceu.dat': grande(2),
  'app/ja-era-grande.dat': grande(3),
  'app/virou-nulo.js': Buffer.from('const a = 1;\0\n'),
  'app/estavel.dat': Buffer.concat([dadosComNulos, Buffer.from('mais')]),
  'app/apagado.zip': null,
  'app/velho.bin': null,
};

const EXTRAS = [
  { caminho: 'app/sumiu.zip', status: 'D' },
  { caminho: 'app/fantasma.zip', status: 'A' },
  { caminho: 'app/fantasma-m.js', status: 'M' },
  { caminho: 'app/tipo.zip', status: 'T' },
];

const resumo = achados => achados.map(({ arquivo, detalhe }) => `${arquivo} | ${detalhe}`);

function rodarNoRepositorio() {
  const repo = criar(BASE);
  try {
    repo.escrever(MUDANCAS);
    repo.git('add', '-A');
    const ctx = contextoDoRepositorio(repo, CONFIG_COM_LIMITE_DE_1_MB);
    ctx.arquivos.push(...EXTRAS);
    return { achados: regra.verificar(ctx), copias: [...ctx.mudancas.copias].sort(), itens: ctx.arquivos.map(a => `${a.status} ${a.caminho}`) };
  } finally {
    repo.limpar();
  }
}

test('binário: identidade, título e texto do conserto', () => {
  assert.equal(regra.id, 'sem-binario-nem-lixo');
  assert.equal(regra.titulo, 'Nenhum instalador, binário, arquivo grande ou cópia de backup novo');
  assert.equal(crypto.createHash('sha256').update(regra.conserto).digest('hex'), 'e66ab329908f98e0c2015ab34d01413e76c3d5c80bcb78dcac4c17bed378ef4a');
  assert.deepEqual(Object.keys(regra).sort(), ['conserto', 'id', 'titulo', 'verificar']);
});

test('binário: achados por arquivo, na ordem do diff, para cada tipo de mudança', () => {
  const { achados, copias, itens } = rodarNoRepositorio();
  assert.deepEqual(copias, ['app/copia-de-dados.dat', 'app/copia-identica.zip', 'reservas/copia.js']);
  assert.deepEqual(itens.filter(item => /^[RMT]/.test(item) || item.includes('fantasma')), [
    'M app/chega-no-limite.dat', 'R app/copia-identica.dat', 'M app/cresceu.dat', 'M app/estavel.dat', 'M app/exato.dat', 'M app/ja-era-grande.dat', 'M app/ja-era-zip.dat', 'R app/novo-nome',
    'M app/virou-gzip.dat', 'M app/virou-nulo.js', 'A app/fantasma.zip', 'M app/fantasma-m.js', 'T app/tipo.zip',
  ]);
  assert.deepEqual(resumo(achados), [
    'app/codigo-com-nulo.js | arquivo de código com byte nulo: as regras de linha não o leem',
    'app/copia-identica.dat | o conteúdo é arquivo ZIP, mesmo com outro nome',
    'app/copia-identica.zip | extensão .zip: instalador, pacote ou binário não entra no repositório',
    'app/cresceu.dat | 2.0 MB: passou do limite de 1 MB',
    'app/enorme.dat | 2.0 MB, acima do limite de 1 MB para arquivo novo',
    'app/exato.dat | 2.0 MB: passou do limite de 1 MB',
    'app/instalador.exe | extensão .exe: instalador, pacote ou binário não entra no repositório',
    'app/mz-com-14 | o conteúdo é executável Windows (MZ), mesmo com outro nome',
    'app/mz-com-31 | o conteúdo é executável Windows (MZ), mesmo com outro nome',
    'app/mz-com-8 | o conteúdo é executável Windows (MZ), mesmo com outro nome',
    'app/mz-controle-na-posicao-511 | o conteúdo é executável Windows (MZ), mesmo com outro nome',
    'app/nota.log | cópia de backup, sobra de editor, log ou pasta de dependências',
    'app/novo-nome | o conteúdo é executável Linux (ELF), mesmo com outro nome',
    'app/pacote.deb | extensão .deb: instalador, pacote ou binário não entra no repositório',
    'app/sem-extensao | o conteúdo é arquivo ZIP, mesmo com outro nome',
    'app/sem-extensao-elf | o conteúdo é executável Linux (ELF), mesmo com outro nome',
    'app/utf16.js | arquivo de código em UTF-16: o interpretador o lê de outro jeito; código entra em UTF-8',
    'app/virou-gzip.dat | o conteúdo passou a ser arquivo gzip',
    'app/virou-nulo.js | arquivo de código com byte nulo: as regras de linha não o leem',
    'app/x.bak | cópia de backup, sobra de editor, log ou pasta de dependências',
    'node_modules/m/index.js | cópia de backup, sobra de editor, log ou pasta de dependências',
    'reservas/copia.js | cópia de backup em reservas/: a cópia do arquivo anterior do app instalado fica fora do repositório, em ~/Nova-AI-reservas/AAAAMMDD-HHMMSS-<branch>/',
  ]);
  assert.ok(achados.every(achado => Object.keys(achado).join() === 'arquivo,detalhe'));
});
