'use strict';

const { test, beforeEach, afterEach, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { EventEmitter } = require('events');

const palco = {};

function processoFalso() {
  const processo = new EventEmitter();
  Object.assign(processo, { pid: 4242, unref() {}, kill() {} });
  return processo;
}

function clienteCdpFalso() {
  const cliente = { enviados: [], ouvintes: {}, ligado: false };
  cliente.on = (evento, ouvinte) => { cliente.ouvintes[evento] = ouvinte; };
  cliente.send = async (metodo, params, sessao) => { cliente.enviados.push({ metodo, params, sessao }); return {}; };
  cliente.close = () => {};
  cliente.Browser = { grantPermissions: async () => {} };
  cliente.Fetch = { authRequired() {}, requestPaused() {} };
  cliente.Target = { setAutoAttach: async () => { cliente.ligado = true; } };
  return cliente;
}

const cdpFalso = async () => palco.cliente;
cdpFalso.Version = async () => ({ webSocketDebuggerUrl: 'ws://falso' });

const childProcessFalso = {
  spawn: (comando, args, opcoes) => {
    palco.spawns.push({ comando, args, opcoes });
    return palco.aoSpawn(comando, args);
  },
  execSync: (comando) => {
    palco.comandos.push(comando);
    return palco.aoExecSync(comando);
  },
  spawnSync: () => ({ status: 0 }),
};

const carregarOriginal = Module._load;
Module._load = function (pedido, ...resto) {
  if (pedido === 'child_process') return childProcessFalso;
  if (pedido === 'chrome-remote-interface') return cdpFalso;
  return carregarOriginal.call(this, pedido, ...resto);
};
const GlobalSpoofService = require('../global-spoof-service');

const plataformaOriginal = Object.getOwnPropertyDescriptor(process, 'platform');
const raizes = [];
const servicos = [];

function usarPlataforma(nome) {
  Object.defineProperty(process, 'platform', { value: nome, configurable: true });
}

beforeEach(() => {
  Object.assign(palco, {
    spawns: [],
    comandos: [],
    aoSpawn: () => processoFalso(),
    aoExecSync: () => '',
    cliente: clienteCdpFalso(),
  });
});

afterEach(async () => {
  while (servicos.length) await servicos.pop().stopHijack();
  Object.defineProperty(process, 'platform', plataformaOriginal);
});

after(() => {
  Module._load = carregarOriginal;
  for (const raiz of raizes) fs.rmSync(raiz, { recursive: true, force: true });
});

function criarServico() {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-spoof-'));
  raizes.push(raiz);
  const userData = path.join(raiz, 'userData');
  fs.mkdirSync(userData);
  const tmpdirOriginal = os.tmpdir;
  os.tmpdir = () => raiz;
  let servico;
  try {
    servico = new GlobalSpoofService(null, { getPath: () => userData }, null);
  } finally {
    os.tmpdir = tmpdirOriginal;
  }
  servico._findChrome = () => 'chrome-falso';
  servico._generateY4M = async () => {};
  servicos.push(servico);
  return { servico, userData, tempDir: servico.tempDir };
}

function gravarPerfil(userData, perfil) {
  fs.writeFileSync(path.join(userData, 'farm_profiles.json'), JSON.stringify([perfil]));
}

function lerInject(tempDir) {
  return fs.readFileSync(path.join(tempDir, 'anti_detect_ext', 'inject.js'), 'utf8');
}

const ajustesDaInterface = (extras) => ({ device: { id: 'desktop' }, url: 'about:blank', ...extras });

test('perfil Default com o regional da interface: abre sem erro e o fuso e o idioma chegam ao disfarce', async () => {
  usarPlataforma('win32');
  const { servico, tempDir } = criarServico();
  const regional = { timezone: 'America/Sao_Paulo', language: 'pt-BR' };
  const resultado = await servico.startHijack(Buffer.alloc(0), ajustesDaInterface({ profile: 'Default', regional }));
  assert.strictEqual(resultado.success, true);
  const inject = lerInject(tempDir);
  assert.match(inject, /var _tTimezone = "America\/Sao_Paulo";/);
  assert.match(inject, /var _tLocale = "pt-BR";/);
});

test('perfil salvo com fuso e idioma fixos continua mandando mais que o regional da interface', async () => {
  usarPlataforma('win32');
  const { servico, userData, tempDir } = criarServico();
  gravarPerfil(userData, { id: 'profile_01', name: 'Fixo', timezone: 'Europe/Lisbon', locale: 'pt-PT' });
  const regional = { timezone: 'America/Sao_Paulo', language: 'pt-BR' };
  const resultado = await servico.startHijack(Buffer.alloc(0), ajustesDaInterface({ profile: 'profile_01', regional }));
  assert.strictEqual(resultado.success, true);
  const inject = lerInject(tempDir);
  assert.match(inject, /var _tTimezone = "Europe\/Lisbon";/);
  assert.match(inject, /var _tLocale = "pt-PT";/);
});
