'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { criar, EMAIL_DO_REPOSITORIO } = require('./auxiliar');
const { autoria } = require('../configuracao.json');

const DIA = 24 * 60 * 60 * 1000;
const CORTE = Date.parse(autoria.julgaCommitsAPartirDe);
const ANTES_DO_CORTE = new Date(CORTE - DIA).toISOString();
const DEPOIS_DO_CORTE = new Date(CORTE + DIA).toISOString();
const OUTRO_EMAIL = 'outro@exemplo.test';

const executar = repo => repo.rodar('--regra', 'autoria');

function commitar(repo, { autor = EMAIL_DO_REPOSITORIO, committer = EMAIL_DO_REPOSITORIO, data = DEPOIS_DO_CORTE, mensagem = 'muda', arquivo = 'a.txt' } = {}) {
  repo.escrever({ [arquivo]: `${mensagem}\n` });
  repo.git('add', '-A');
  repo.git('-c', `user.email=${committer}`, 'commit', '-q', '-m', mensagem, '--date', data, '--author', `x <${autor}>`);
}

test('passa: commit novo com o e-mail do repositório', () => {
  const repo = criar();
  commitar(repo);
  const r = executar(repo);
  repo.limpar();
  assert.equal(r.codigo, 0, r.saida);
});

test('falha: commit novo com o e-mail de outra conta, citando o commit e o e-mail', () => {
  const repo = criar();
  commitar(repo, { autor: OUTRO_EMAIL, mensagem: 'troca a autoria' });
  const sha = repo.git('rev-parse', '--short=7', 'HEAD');
  const r = executar(repo);
  repo.limpar();
  assert.equal(r.codigo, 1);
  assert.match(r.saida, new RegExp(`${sha}: troca a autoria: autor ${OUTRO_EMAIL}`));
});

test('falha: committer com outro e-mail, mesmo com o autor certo', () => {
  const repo = criar();
  commitar(repo, { committer: OUTRO_EMAIL });
  const r = executar(repo);
  repo.limpar();
  assert.equal(r.codigo, 1);
  assert.match(r.saida, new RegExp(`committer ${OUTRO_EMAIL}`));
});

test('passa: committer do GitHub (merge e edição pela web)', () => {
  const repo = criar();
  commitar(repo, { committer: 'noreply@github.com' });
  const r = executar(repo);
  repo.limpar();
  assert.equal(r.codigo, 0, r.saida);
});

test('passa: commit com e-mail errado de antes da data de corte não é julgado', () => {
  const repo = criar();
  commitar(repo, { autor: OUTRO_EMAIL, committer: OUTRO_EMAIL, data: ANTES_DO_CORTE });
  const r = executar(repo);
  repo.limpar();
  assert.equal(r.codigo, 0, r.saida);
});

test('falha: só o commit novo da branch é julgado quando há um antigo errado antes dele', () => {
  const repo = criar();
  commitar(repo, { autor: OUTRO_EMAIL, data: ANTES_DO_CORTE, mensagem: 'antigo', arquivo: 'antigo.txt' });
  commitar(repo, { autor: OUTRO_EMAIL, mensagem: 'novo', arquivo: 'novo.txt' });
  const r = executar(repo);
  repo.limpar();
  assert.equal(r.codigo, 1);
  assert.match(r.saida, /novo: autor/);
  assert.doesNotMatch(r.saida, /antigo: autor/);
});

test('passa: o commit antigo continua sem ser julgado depois de um rebase, que muda só a data do committer', () => {
  const repo = criar();
  commitar(repo, { autor: OUTRO_EMAIL, committer: OUTRO_EMAIL, data: ANTES_DO_CORTE });
  repo.git('checkout', '-q', 'main');
  repo.escrever({ 'principal.txt': 'novo na base\n' });
  repo.guardar('avanço da base');
  repo.git('checkout', '-q', 'ramo');
  repo.git('rebase', 'main');
  const r = executar(repo);
  repo.limpar();
  assert.equal(r.codigo, 0, r.saida);
});

test('passa: commit de merge não é julgado e o que veio da base também não', () => {
  const repo = criar();
  repo.git('checkout', '-q', 'main');
  commitar(repo, { autor: OUTRO_EMAIL, mensagem: 'veio da base', arquivo: 'base.txt' });
  repo.git('checkout', '-q', 'ramo');
  commitar(repo, { mensagem: 'da branch', arquivo: 'ramo.txt' });
  repo.git('merge', '--no-ff', '--no-commit', 'main');
  repo.git('-c', `user.email=${OUTRO_EMAIL}`, 'commit', '-q', '-m', 'Merge branch main', '--date', DEPOIS_DO_CORTE, '--author', `x <${OUTRO_EMAIL}>`);
  const r = executar(repo);
  repo.limpar();
  assert.equal(r.codigo, 0, r.saida);
});

test('passa: o e-mail confere sem distinguir maiúsculas', () => {
  const repo = criar();
  commitar(repo, { autor: EMAIL_DO_REPOSITORIO.toUpperCase(), committer: EMAIL_DO_REPOSITORIO.toUpperCase() });
  const r = executar(repo);
  repo.limpar();
  assert.equal(r.codigo, 0, r.saida);
});
