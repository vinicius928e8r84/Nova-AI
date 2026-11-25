'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { criar } = require('./auxiliar');
const { tamanhoDeArquivo, julgaCommitsAPartirDe } = require('../configuracao.json');

const LIMITE = tamanhoDeArquivo.bytesMaximos;
const DIA = 24 * 60 * 60 * 1000;
const ANTES_DO_CORTE = new Date(Date.parse(julgaCommitsAPartirDe) - DIA).toISOString();
const DEPOIS_DO_CORTE = new Date(Date.parse(julgaCommitsAPartirDe) + DIA).toISOString();

const comBytes = (quantos, letra = 'a') => `${letra.repeat(quantos - 1)}\n`;

const executar = repo => repo.rodar('--regra', 'limite-de-tamanho');

function tentar(base, ramo) {
  const repo = criar(base);
  repo.escrever(ramo);
  const resultado = executar(repo);
  repo.limpar();
  return resultado;
}

test('passa: arquivo novo com exatamente o limite de bytes', () => {
  const r = tentar({}, { 'app/novo.js': comBytes(LIMITE) });
  assert.equal(r.codigo, 0, r.saida);
});

test('falha: arquivo novo um byte acima do limite, com bytes e tokens na mensagem', () => {
  const r = tentar({}, { 'app/novo.js': comBytes(LIMITE + 1) });
  assert.equal(r.codigo, 1);
  assert.match(r.saida, /app\/novo\.js: 20001 bytes \(5001 tokens\), acima do limite de 20000 bytes \(5000 tokens\)/);
});

test('falha: texto que não é código também conta (Markdown e JSON)', () => {
  const r = tentar({}, { 'docs/guia.md': comBytes(LIMITE + 1), 'app/dados.json': comBytes(LIMITE + 1) });
  assert.equal(r.codigo, 1);
  assert.match(r.saida, /docs\/guia\.md/);
  assert.match(r.saida, /app\/dados\.json/);
});

test('passa: lugares isentos e binário não contam', () => {
  const r = tentar({}, {
    'app/dist/assets/bundle.js': comBytes(LIMITE * 3),
    'app/package-lock.json': comBytes(LIMITE * 3),
    'app/audio/som.wav': Buffer.concat([Buffer.from([0, 1, 2, 3]), Buffer.alloc(LIMITE * 3, 7)]),
  });
  assert.equal(r.codigo, 0, r.saida);
});

test('passa: arquivo que já passava do limite na base e não cresce, mesmo editado', () => {
  const r = tentar({ 'app/grande.js': comBytes(LIMITE * 2) }, { 'app/grande.js': comBytes(LIMITE * 2, 'b') });
  assert.equal(r.codigo, 0, r.saida);
});

test('passa: arquivo que já passava do limite na base e encolhe, sem lista para editar', () => {
  const r = tentar({ 'app/grande.js': comBytes(LIMITE * 2) }, { 'app/grande.js': comBytes(LIMITE + 500) });
  assert.equal(r.codigo, 0, r.saida);
});

test('falha: arquivo que já passava do limite na base e cresce um byte', () => {
  const r = tentar({ 'app/grande.js': comBytes(LIMITE * 2) }, { 'app/grande.js': comBytes(LIMITE * 2 + 1) });
  assert.equal(r.codigo, 1);
  assert.match(r.saida, /app\/grande\.js: 40001 bytes \(10001 tokens\); na branch-alvo ele tem 40000: arquivo grande não pode crescer \(1 byte a mais\)/);
});

test('falha: arquivo pequeno da base que passa do limite', () => {
  const r = tentar({ 'app/pequeno.js': comBytes(LIMITE - 100) }, { 'app/pequeno.js': comBytes(LIMITE + 100) });
  assert.equal(r.codigo, 1);
  assert.match(r.saida, /app\/pequeno\.js: 20100 bytes \(5025 tokens\), acima do limite de 20000 bytes/);
});

test('o teto só desce: depois que o arquivo encolheu na base, crescer de novo falha', () => {
  const repo = criar({ 'app/grande.js': comBytes(LIMITE * 2) });
  repo.git('checkout', '-q', 'main');
  repo.escrever({ 'app/grande.js': comBytes(LIMITE + 1000) });
  repo.guardar('encolhe');
  repo.git('checkout', '-q', 'ramo');
  repo.git('rebase', 'main');
  repo.escrever({ 'app/grande.js': comBytes(LIMITE + 2000) });
  const r = executar(repo);
  repo.limpar();
  assert.equal(r.codigo, 1);
  assert.match(r.saida, /app\/grande\.js: 22000 bytes .*na branch-alvo ele tem 21000/);
});

test('passa: arquivo grande renomeado que não cresce leva o teto junto', () => {
  const repo = criar({ 'app/grande.js': comBytes(LIMITE * 2) });
  repo.git('mv', 'app/grande.js', 'app/novo-nome.js');
  const r = executar(repo);
  repo.limpar();
  assert.equal(r.codigo, 0, r.saida);
});

test('falha: arquivo grande renomeado que cresce', () => {
  const repo = criar({ 'app/grande.js': comBytes(LIMITE * 2) });
  repo.git('mv', 'app/grande.js', 'app/novo-nome.js');
  repo.escrever({ 'app/novo-nome.js': comBytes(LIMITE * 2 + 50) });
  const r = executar(repo);
  repo.limpar();
  assert.equal(r.codigo, 1);
  assert.match(r.saida, /app\/novo-nome\.js: 40050 bytes/);
});

test('falha: cópia de um arquivo grande é arquivo novo e tem de caber no limite', () => {
  const r = tentar({ 'app/grande.js': comBytes(LIMITE * 2) }, { 'app/copia.js': comBytes(LIMITE * 2) });
  assert.equal(r.codigo, 1);
  assert.match(r.saida, /app\/copia\.js: 40000 bytes/);
});

test('falha: arquivo que sai de um lugar isento para o código é arquivo novo', () => {
  const repo = criar({ 'MAC/area/reservas/antigo.js': comBytes(LIMITE * 2) });
  fs.mkdirSync(path.join(repo.raiz, 'app'));
  repo.git('mv', 'MAC/area/reservas/antigo.js', 'app/antigo.js');
  const r = executar(repo);
  repo.limpar();
  assert.equal(r.codigo, 1);
  assert.match(r.saida, /app\/antigo\.js: 40000 bytes/);
});

test('passa: o fim de linha CRLF não conta como byte a mais', () => {
  const linha = `${'a'.repeat(98)}\n`;
  const repo = criar({ 'app/texto.js': linha.repeat(195) });
  repo.escrever({ 'app/texto.js': linha.replace('\n', '\r\n').repeat(195) });
  const r = executar(repo);
  repo.limpar();
  assert.equal(r.codigo, 0, r.saida);
});

test('passa: apagar um arquivo grande', () => {
  const repo = criar({ 'app/grande.js': comBytes(LIMITE * 2) });
  repo.escrever({ 'app/grande.js': null });
  const r = executar(repo);
  repo.limpar();
  assert.equal(r.codigo, 0, r.saida);
});

test('passa: arquivo grande que a mudança não toca', () => {
  const r = tentar({ 'app/grande.js': comBytes(LIMITE * 2) }, { 'app/outro.js': 'const a = 1;\n' });
  assert.equal(r.codigo, 0, r.saida);
});

function commitarEm(repo, data, arquivos) {
  repo.escrever(arquivos);
  repo.git('add', '-A');
  repo.git('commit', '-q', '-m', 'muda', '--date', data);
}

test('corte: arquivo novo grande num commit de antes da data de corte passa', () => {
  const repo = criar();
  commitarEm(repo, ANTES_DO_CORTE, { 'app/novo.js': comBytes(LIMITE * 2) });
  const r = executar(repo);
  repo.limpar();
  assert.equal(r.codigo, 0, r.saida);
});

test('corte: o mesmo arquivo num commit de depois da data de corte falha', () => {
  const repo = criar();
  commitarEm(repo, DEPOIS_DO_CORTE, { 'app/novo.js': comBytes(LIMITE * 2) });
  const r = executar(repo);
  repo.limpar();
  assert.equal(r.codigo, 1);
  assert.match(r.saida, /app\/novo\.js: 40000 bytes/);
});

test('corte: arquivo grande da base que cresce num commit antigo passa e num commit novo falha', () => {
  const repo = criar({ 'app/grande.js': comBytes(LIMITE * 2) });
  commitarEm(repo, ANTES_DO_CORTE, { 'app/grande.js': comBytes(LIMITE * 2 + 100) });
  const antigo = executar(repo);
  commitarEm(repo, DEPOIS_DO_CORTE, { 'app/grande.js': comBytes(LIMITE * 2 + 200) });
  const novo = executar(repo);
  repo.limpar();
  assert.equal(antigo.codigo, 0, antigo.saida);
  assert.equal(novo.codigo, 1);
  assert.match(novo.saida, /app\/grande\.js: 40200 bytes .*na branch-alvo ele tem 40000/);
});

test('corte: só o arquivo tocado por commit novo é julgado, o de commit antigo não', () => {
  const repo = criar();
  commitarEm(repo, ANTES_DO_CORTE, { 'app/antigo.js': comBytes(LIMITE * 2) });
  commitarEm(repo, DEPOIS_DO_CORTE, { 'app/novo.js': comBytes(LIMITE * 2) });
  const r = executar(repo);
  repo.limpar();
  assert.equal(r.codigo, 1);
  assert.match(r.saida, /app\/novo\.js/);
  assert.doesNotMatch(r.saida, /app\/antigo\.js/);
});

test('corte: mudança ainda sem commit é julgada, para o pre-commit pegar', () => {
  const repo = criar();
  commitarEm(repo, ANTES_DO_CORTE, { 'app/antigo.js': comBytes(LIMITE * 2) });
  repo.escrever({ 'app/antigo.js': comBytes(LIMITE * 2 + 1) });
  const r = executar(repo);
  repo.limpar();
  assert.equal(r.codigo, 1);
  assert.match(r.saida, /app\/antigo\.js: 40001 bytes/);
});
