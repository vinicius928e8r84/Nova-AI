'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { construirDeb, construirMacho } = require('./construtores');

const COMANDO = path.join(__dirname, '..', 'retrato-do-pacote.js');

function pastaTemporaria(t) {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'retrato-'));
  t.after(() => fs.rmSync(pasta, { recursive: true, force: true }));
  return pasta;
}

function rodar(...argumentos) {
  const resultado = spawnSync(process.execPath, [COMANDO, ...argumentos], { encoding: 'utf8' });
  return { codigo: resultado.status, saida: resultado.stdout, erro: resultado.stderr };
}

function escreverDeb(pasta, nome, { textos = ['olá'], versao = '0.2', mtime = 0, rodape = 'u' } = {}) {
  const arquivo = path.join(pasta, nome);
  const binario = construirMacho({ textos, seletores: ['init'], rodape });
  fs.writeFileSync(arquivo, construirDeb({ controle: `Package: p\nVersion: ${versao}\n`, arquivos: [{ nome: './usr/bin/p', dados: binario, modo: 0o755, mtime }] }));
  return arquivo;
}

test('tirar escreve o retrato em JSON no arquivo pedido e na saída padrão quando não há arquivo', t => {
  const pasta = pastaTemporaria(t);
  const deb = escreverDeb(pasta, 'p.deb');
  const saida = path.join(pasta, 'p.json');
  assert.equal(rodar('tirar', deb, saida).codigo, 0);
  const noArquivo = JSON.parse(fs.readFileSync(saida, 'utf8'));
  assert.equal(noArquivo.controle.Version, '0.2');
  assert.deepEqual(noArquivo.binarios['usr/bin/p'].textos, ['olá']);
  const naSaida = rodar('tirar', deb);
  assert.deepEqual(JSON.parse(naSaida.saida), noArquivo);
});

test('comparar dois pacotes do mesmo código diz que são iguais e sai com 0', t => {
  const pasta = pastaTemporaria(t);
  rodar('tirar', escreverDeb(pasta, 'a.deb', { mtime: 1, rodape: 'x' }), path.join(pasta, 'a.json'));
  rodar('tirar', escreverDeb(pasta, 'b.deb', { mtime: 2, rodape: 'y' }), path.join(pasta, 'b.json'));
  const resultado = rodar('comparar', path.join(pasta, 'a.json'), path.join(pasta, 'b.json'));
  assert.equal(resultado.codigo, 0);
  assert.equal(resultado.saida, 'os retratos são iguais\n');
});

test('comparar mostra cada diferença, conta quantas são e sai com 1', t => {
  const pasta = pastaTemporaria(t);
  rodar('tirar', escreverDeb(pasta, 'a.deb'), path.join(pasta, 'a.json'));
  rodar('tirar', escreverDeb(pasta, 'b.deb', { textos: ['olá, mundo'], versao: '0.3' }), path.join(pasta, 'b.json'));
  const resultado = rodar('comparar', path.join(pasta, 'a.json'), path.join(pasta, 'b.json'), '--ignorar', 'bytes');
  assert.equal(resultado.codigo, 1);
  assert.equal(resultado.saida, [
    'controle Version: mudou de "0.2" para "0.3"',
    'binário usr/bin/p: texto acrescentado: "olá, mundo"',
    'binário usr/bin/p: texto removido: "olá"',
    '3 diferença(s)',
    '',
  ].join('\n'));
  const semVersao = rodar('comparar', path.join(pasta, 'a.json'), path.join(pasta, 'b.json'), '--ignorar', 'versao,bytes');
  assert.equal(semVersao.codigo, 1);
  assert.doesNotMatch(semVersao.saida, /Version/);
});

test('uso errado, arquivo que não existe e pacote inválido saem com 2 e dizem o motivo', t => {
  const pasta = pastaTemporaria(t);
  assert.equal(rodar().codigo, 2);
  assert.match(rodar().erro, /uso:/);
  assert.equal(rodar('tirar').codigo, 2);
  assert.equal(rodar('comparar', 'so-um.json').codigo, 2);
  const inexistente = rodar('tirar', path.join(pasta, 'nao-existe.deb'));
  assert.equal(inexistente.codigo, 2);
  assert.match(inexistente.erro, /^erro: /);
  fs.writeFileSync(path.join(pasta, 'lixo.deb'), 'nao é pacote');
  const lixo = rodar('tirar', path.join(pasta, 'lixo.deb'));
  assert.equal(lixo.codigo, 2);
  assert.match(lixo.erro, /não é um \.deb/);
  rodar('tirar', escreverDeb(pasta, 'a.deb'), path.join(pasta, 'a.json'));
  const ignorarErrado = rodar('comparar', path.join(pasta, 'a.json'), path.join(pasta, 'a.json'), '--ignorar', 'tudo');
  assert.equal(ignorarErrado.codigo, 2);
  assert.match(ignorarErrado.erro, /não sei ignorar: tudo/);
});
