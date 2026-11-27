'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ANALISADOR = path.join(__dirname, '..', 'analisador');

function ambienteIsolado(pasta) {
  return {
    ...process.env,
    GIT_CONFIG_GLOBAL: path.join(pasta, 'global-vazio'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CEILING_DIRECTORIES: path.dirname(pasta),
  };
}

function clone({ comRepositorio = true, comGanchos = true } = {}) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'ligar-ganchos-'));
  const projeto = path.join(raiz, 'projeto');
  const analisador = path.join(projeto, 'scripts', 'regras', 'analisador');
  fs.mkdirSync(analisador, { recursive: true });
  if (comGanchos) fs.mkdirSync(path.join(projeto, '.githooks'));
  const pacote = JSON.parse(fs.readFileSync(path.join(ANALISADOR, 'package.json'), 'utf8'));
  fs.writeFileSync(path.join(analisador, 'package.json'), JSON.stringify({ ...pacote, dependencies: {} }));
  fs.writeFileSync(path.join(analisador, 'package-lock.json'), JSON.stringify({ name: pacote.name, lockfileVersion: 3, requires: true, packages: { '': { name: pacote.name } } }));
  fs.copyFileSync(path.join(ANALISADOR, 'ligar-ganchos.js'), path.join(analisador, 'ligar-ganchos.js'));
  const ambiente = ambienteIsolado(projeto);
  if (comRepositorio) spawnSync('git', ['init', '-q'], { cwd: projeto, env: ambiente });
  const git = (...args) => spawnSync('git', args, { cwd: projeto, encoding: 'utf8', env: ambiente }).stdout.trim();
  const instalar = (...extras) => spawnSync(['npm', 'ci', '--no-audit', '--no-fund', '--prefix', 'scripts/regras/analisador', ...extras].join(' '), { cwd: projeto, encoding: 'utf8', env: ambiente, shell: true });
  const configuracao = () => fs.readFileSync(path.join(projeto, '.git', 'config'), 'utf8');
  return { git, instalar, configuracao, limpar: () => fs.rmSync(raiz, { recursive: true, force: true }) };
}

test('npm ci num clone novo liga o core.hooksPath em .githooks', () => {
  const c = clone();
  const r = c.instalar();
  const ligado = c.git('config', '--get', 'core.hooksPath');
  c.limpar();
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  assert.equal(ligado, '.githooks');
});

test('uma segunda rodada do npm ci não muda a configuração', () => {
  const c = clone();
  c.instalar();
  const depoisDaPrimeira = c.configuracao();
  const r = c.instalar();
  const depoisDaSegunda = c.configuracao();
  const ligado = c.git('config', '--get', 'core.hooksPath');
  c.limpar();
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  assert.equal(ligado, '.githooks');
  assert.equal(depoisDaSegunda, depoisDaPrimeira);
});

test('npm ci com --ignore-scripts não liga nada', () => {
  const c = clone();
  const r = c.instalar('--ignore-scripts');
  const ligado = c.git('config', '--get', 'core.hooksPath');
  c.limpar();
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  assert.equal(ligado, '');
});

test('npm ci não troca uma pasta de ganchos já configurada para outro caminho', () => {
  const c = clone();
  c.git('config', 'core.hooksPath', 'outros-ganchos');
  const r = c.instalar();
  const ligado = c.git('config', '--get', 'core.hooksPath');
  c.limpar();
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  assert.equal(ligado, 'outros-ganchos');
});

test('npm ci fora de um repositório git passa sem ligar nada', () => {
  const c = clone({ comRepositorio: false });
  const r = c.instalar();
  c.limpar();
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /nada a ligar/);
});

test('npm ci num repositório sem a pasta .githooks passa sem ligar nada', () => {
  const c = clone({ comGanchos: false });
  const r = c.instalar();
  const ligado = c.git('config', '--get', 'core.hooksPath');
  c.limpar();
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  assert.equal(ligado, '');
});
