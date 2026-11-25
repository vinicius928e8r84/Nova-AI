'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { criar, EMAIL_DO_REPOSITORIO } = require('./auxiliar');
const { julgaCommitsAPartirDe, tamanhoDeArquivo } = require('../configuracao.json');

const RAIZ_REAL = path.join(__dirname, '..', '..', '..');
const GANCHOS = path.join(RAIZ_REAL, '.githooks');
const VERIFICAR = path.join(RAIZ_REAL, 'scripts', 'regras', 'verificar.js');
const ZEROS = '0'.repeat(40);
const GRANDE = `${'a'.repeat(tamanhoDeArquivo.bytesMaximos)}\n`;
const DEPOIS_DO_CORTE = new Date(Date.parse(julgaCommitsAPartirDe) + 24 * 60 * 60 * 1000).toISOString();
const AMBIENTE = { ...process.env, REGRAS_EXIGE_FERRAMENTAS: '' };

function repositorio() {
  const repo = criar();
  repo.git('update-ref', 'refs/remotes/origin/main', 'main');
  repo.git('config', 'core.hooksPath', GANCHOS);
  return repo;
}

function commitar(repo, arquivos) {
  repo.escrever(arquivos);
  repo.git('add', '-A');
  return spawnSync('git', ['-c', `user.email=${EMAIL_DO_REPOSITORIO}`, '-c', 'user.name=t', 'commit', '-q', '-m', 'muda'], { cwd: repo.raiz, encoding: 'utf8', env: AMBIENTE });
}

function empurrar(repo, remoto = 'origin') {
  const sha = repo.git('rev-parse', 'HEAD');
  const entrada = `refs/heads/ramo ${sha} refs/heads/ramo ${ZEROS}\n`;
  return spawnSync('sh', [path.join(GANCHOS, 'pre-push'), remoto, 'url'], { cwd: repo.raiz, encoding: 'utf8', input: entrada, env: AMBIENTE });
}

const saida = resultado => `${resultado.stdout}${resultado.stderr}`;

test('pre-commit deixa passar um commit que as regras aceitam', () => {
  const repo = repositorio();
  const r = commitar(repo, { 'app/pequeno.js': 'module.exports = { a: 1 };\n' });
  repo.limpar();
  assert.equal(r.status, 0, saida(r));
});

test('pre-commit barra o commit de um arquivo novo acima do limite de bytes', () => {
  const repo = repositorio();
  const r = commitar(repo, { 'app/grande.js': GRANDE });
  const commits = repo.git('rev-list', '--count', 'main..HEAD');
  repo.limpar();
  assert.notEqual(r.status, 0);
  assert.match(saida(r), /limite-de-tamanho/);
  assert.match(saida(r), /Commit barrado/);
  assert.equal(commits, '0');
});

test('pre-commit barra comentário novo, como o CI', () => {
  const repo = repositorio();
  const r = commitar(repo, { 'app/a.js': '// explica\nconst a = 1;\n' });
  repo.limpar();
  assert.notEqual(r.status, 0);
  assert.match(saida(r), /sem-comentario-novo/);
});

test('pre-commit avisa e deixa passar quando não há origin/main para comparar', () => {
  const repo = repositorio();
  repo.git('update-ref', '-d', 'refs/remotes/origin/main');
  const r = commitar(repo, { 'app/grande.js': GRANDE });
  repo.limpar();
  assert.equal(r.status, 0, saida(r));
  assert.match(saida(r), /sem origin\/main para comparar/);
});

test('pre-push deixa passar um ramo que as regras aceitam', () => {
  const repo = repositorio();
  commitar(repo, { 'app/pequeno.js': 'module.exports = { a: 1 };\n' });
  const r = empurrar(repo);
  repo.limpar();
  assert.equal(r.status, 0, saida(r));
});

test('pre-push barra o ramo com arquivo acima do limite de bytes', () => {
  const repo = criar();
  repo.escrever({ 'app/grande.js': GRANDE });
  repo.git('add', '-A');
  repo.git('commit', '-q', '-m', 'grande', '--date', DEPOIS_DO_CORTE);
  repo.git('update-ref', 'refs/remotes/origin/main', 'main');
  const r = empurrar(repo);
  repo.limpar();
  assert.equal(r.status, 1);
  assert.match(saida(r), /limite-de-tamanho/);
  assert.match(saida(r), /Push barrado/);
});

test('pre-push barra o ramo com commit de outro e-mail', () => {
  const repo = repositorio();
  repo.escrever({ 'app/a.js': 'module.exports = { a: 1 };\n' });
  repo.git('add', '-A');
  repo.git('commit', '-q', '--no-verify', '-m', 'de outro', '--date', DEPOIS_DO_CORTE, '--author', 'x <outro@exemplo.test>');
  const r = empurrar(repo);
  repo.limpar();
  assert.equal(r.status, 1);
  assert.match(saida(r), /autoria/);
  assert.match(saida(r), /outro@exemplo\.test/);
});

test('pre-push não julga o push da main nem a exclusão de ramo', () => {
  const repo = repositorio();
  const sha = repo.git('rev-parse', 'HEAD');
  const entrada = `refs/heads/main ${sha} refs/heads/main ${ZEROS}\n(delete) ${ZEROS} refs/heads/velho ${sha}\n`;
  repo.escrever({ 'app/grande.js': GRANDE });
  repo.git('add', '-A');
  repo.git('commit', '-q', '--no-verify', '-m', 'grande');
  const r = spawnSync('sh', [path.join(GANCHOS, 'pre-push'), 'origin', 'url'], { cwd: repo.raiz, encoding: 'utf8', input: entrada, env: AMBIENTE });
  repo.limpar();
  assert.equal(r.status, 0, saida(r));
});

test('o pre-commit roda todas as regras do CI menos a autoria, que o pre-push cobre', () => {
  const lista = execFileSync(process.execPath, [VERIFICAR, '--lista'], { encoding: 'utf8' });
  const ids = lista.split('\n').filter(Boolean).map(linha => linha.split(':')[0]);
  const preCommit = fs.readFileSync(path.join(GANCHOS, 'pre-commit'), 'utf8');
  const prePush = fs.readFileSync(path.join(GANCHOS, 'pre-push'), 'utf8');
  const nomeadas = [...preCommit.matchAll(/--regra (\S+)/g)].map(m => m[1]);
  assert.deepEqual([...nomeadas].sort(), ids.filter(id => id !== 'autoria').sort());
  assert.doesNotMatch(prePush, /--regra/);
});

test('os ganchos são executáveis no git e o .gitattributes os mantém com fim de linha LF', () => {
  const indice = execFileSync('git', ['ls-files', '--stage', '.githooks'], { cwd: RAIZ_REAL, encoding: 'utf8' });
  for (const gancho of ['pre-commit', 'pre-push']) assert.match(indice, new RegExp(`^100755 .*\\.githooks/${gancho}$`, 'm'));
  assert.match(fs.readFileSync(path.join(RAIZ_REAL, '.gitattributes'), 'utf8'), /^\.githooks\/\* text eol=lf$/m);
});
