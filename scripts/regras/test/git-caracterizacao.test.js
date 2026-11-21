'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { lerArquivo, lerMudancas, resolverBase } = require('../git');
const { criar } = require('./auxiliar');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'configuracao.json'), 'utf8'));

function montarRamo() {
  const repo = criar({
    'backup-antes-traducao/velho.js': 'linha1\nlinha2\nlinha3\n',
    'backup-antes-traducao/copia.js': 'isento\n',
    'app/comum.js': 'comum\num\n',
    'app/mexe.js': 'mexe\n',
    'app/antes.js': 'renomeia\nnormal\n',
    'app/apaga.js': 'some\n',
  });
  repo.git('mv', 'backup-antes-traducao/velho.js', 'app/velho.js');
  repo.git('mv', 'app/antes.js', 'app/depois.js');
  repo.escrever({
    'app/copia-do-isento.js': 'isento\n',
    'app/copia-do-comum.js': 'comum\num\n',
    'app/bin.dat': Buffer.from('\x00\x01\x02bin', 'latin1'),
    'app/utf16.txt': Buffer.from('a\x00b\x00\n\x00', 'latin1'),
    'app/mexe.js': 'mexe\nmais\n',
    'app/sólto\ttab.js': 'solto\nnovo\n',
    'app/solto2.js': 'solto2',
    'app/apaga.js': null,
  });
  repo.git('add', 'app/copia-do-isento.js', 'app/copia-do-comum.js', 'app/bin.dat', 'app/utf16.txt');
  return repo;
}

const resumo = ({ itens, acrescentadas, copias }) => ({
  itens: itens.map(({ status, antigo, caminho }) => [status, antigo, caminho].filter(Boolean).join(' ')),
  acrescentadas: Object.fromEntries([...acrescentadas].map(([caminho, linhas]) => [caminho, [...linhas]])),
  copias: [...copias],
});

const ITENS = ['D app/apaga.js', 'A app/bin.dat', 'A app/copia-do-comum.js', 'A app/copia-do-isento.js', 'R app/antes.js app/depois.js', 'M app/mexe.js', 'A app/utf16.txt',
  'R backup-antes-traducao/velho.js app/velho.js', 'A app/solto2.js', 'A app/sólto\ttab.js'];

const ACRESCENTADAS_EM_TODO_CASO = { 'app/bin.dat': [1], 'app/copia-do-comum.js': [], 'app/mexe.js': [2], 'app/utf16.txt': [1, 2], 'app/solto2.js': [1], 'app/sólto\ttab.js': [1, 2] };

test('caracterização: lerMudancas classifica renomeação, cópia, binário, UTF-16 e arquivo solto', t => {
  const repo = montarRamo();
  t.after(repo.limpar);
  const base = resolverBase(repo.raiz, 'main');
  assert.deepStrictEqual(resumo(lerMudancas(repo.raiz, base, config)), {
    itens: ITENS,
    acrescentadas: { ...ACRESCENTADAS_EM_TODO_CASO, 'app/copia-do-isento.js': [1], 'app/velho.js': [1, 2, 3] },
    copias: ['app/copia-do-comum.js'],
  });
  assert.deepStrictEqual(resumo(lerMudancas(repo.raiz, base)), {
    itens: ITENS,
    acrescentadas: { ...ACRESCENTADAS_EM_TODO_CASO, 'app/copia-do-isento.js': [] },
    copias: ['app/copia-do-comum.js', 'app/copia-do-isento.js'],
  });
});

test('caracterização: lerArquivo reconhece UTF-16 pela marca ou pelos zeros e o resto como binário ou UTF-8', t => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'regras-git-'));
  t.after(() => fs.rmSync(pasta, { recursive: true, force: true }));
  const le = Buffer.from('olá\n', 'utf16le');
  const casos = {
    'marca LE': Buffer.concat([Buffer.from([0xff, 0xfe]), le]),
    'marca BE': Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(le).swap16()]),
    'zeros LE com byte sobrando': Buffer.concat([le, Buffer.from([0x41])]),
    'zeros BE': Buffer.from(le).swap16(),
    'só a marca': Buffer.from([0xff]),
    'binário': Buffer.from([0, 0, 0, 1, 2, 3, 0x61, 0x62]),
    'UTF-8': Buffer.from('ação\n'),
  };
  const vistos = Object.fromEntries(Object.entries(casos).map(([nome, bytes]) => {
    fs.writeFileSync(path.join(pasta, 'f'), bytes);
    const { binario, utf16, texto } = lerArquivo(pasta, 'f');
    return [nome, { binario, utf16, texto }];
  }));
  assert.deepStrictEqual(vistos, {
    'marca LE': { binario: false, utf16: true, texto: 'olá\n' },
    'marca BE': { binario: false, utf16: true, texto: 'olá\n' },
    'zeros LE com byte sobrando': { binario: false, utf16: true, texto: 'olá\n' },
    'zeros BE': { binario: false, utf16: true, texto: 'olá\n' },
    'só a marca': { binario: false, utf16: false, texto: '\ufffd' },
    'binário': { binario: true, utf16: false, texto: null },
    'UTF-8': { binario: false, utf16: false, texto: 'ação\n' },
  });
  assert.strictEqual(lerArquivo(pasta, 'nao-existe'), null);
});
