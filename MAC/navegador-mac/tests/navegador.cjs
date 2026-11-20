'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const servicos = path.join(__dirname, '../../../app/electron/services');
const macNativePath = path.join(servicos, 'mac-native.js');

function criarExecutavel(raiz, ...partes) {
  const arquivo = path.join(raiz, ...partes);
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  fs.writeFileSync(arquivo, '');
  return arquivo;
}

function carregar({ resources, userData, home }) {
  const originalLoad = Module._load;
  const originalHome = process.env.HOME;
  const originalExists = fs.existsSync;
  const base = path.dirname(home);
  fs.existsSync = (p) => String(p).startsWith(base) && originalExists(p);
  process.env.HOME = home;
  process.resourcesPath = resources;
  Module._load = function (pedido, ...resto) {
    if (pedido === 'playwright') throw new Error('sem playwright no teste');
    if (pedido === 'electron') return { app: { getPath: () => userData } };
    return originalLoad.call(this, pedido, ...resto);
  };
  delete require.cache[macNativePath];
  const modulo = require(macNativePath);
  return { modulo, restaurar() { fs.existsSync = originalExists; Module._load = originalLoad; process.env.HOME = originalHome; delete process.resourcesPath; delete require.cache[macNativePath]; } };
}

test('navegador embutido em resources/browsers/<nome>/<App>.app', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'nav-'));
  const esperado = criarExecutavel(base, 'res', 'browsers', 'brave', 'Brave Browser.app', 'Contents', 'MacOS', 'Brave Browser');
  const { modulo, restaurar } = carregar({ resources: path.join(base, 'res'), userData: path.join(base, 'ud'), home: path.join(base, 'home') });
  try { assert.strictEqual(modulo.browser('brave'), esperado); } finally { restaurar(); }
});

test('userData/browsers nao vale para fazenda nem CAM spoof, como no Windows', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'nav-'));
  const esperado = criarExecutavel(base, 'ud', 'browsers', 'firefox', 'Firefox.app', 'Contents', 'MacOS', 'firefox');
  const { modulo, restaurar } = carregar({ resources: path.join(base, 'res'), userData: path.join(base, 'ud'), home: path.join(base, 'home') });
  try { assert.strictEqual(modulo.browser('firefox'), null); assert.ok(fs.existsSync(esperado)); } finally { restaurar(); }
});

test('edge embutido e sem nada devolve null', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'nav-'));
  const { modulo, restaurar } = carregar({ resources: path.join(base, 'res'), userData: path.join(base, 'ud'), home: path.join(base, 'home') });
  try {
    assert.strictEqual(modulo.browser('vivaldi'), null);
    const esperado = criarExecutavel(base, 'res', 'browsers', 'edge', 'Microsoft Edge.app', 'Contents', 'MacOS', 'Microsoft Edge');
    assert.strictEqual(modulo.browser('edge'), esperado);
  } finally { restaurar(); }
});

test('whatsapp no Mac: PUPPETEER_EXECUTABLE_PATH vence, depois Chromium de userData/browsers, depois Edge embutido', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'nav-'));
  const edge = criarExecutavel(base, 'res', 'browsers', 'edge', 'Microsoft Edge.app', 'Contents', 'MacOS', 'Microsoft Edge');
  const { restaurar } = carregar({ resources: path.join(base, 'res'), userData: path.join(base, 'ud'), home: path.join(base, 'home') });
  const plataforma = Object.getOwnPropertyDescriptor(process, 'platform');
  const envOriginal = process.env.PUPPETEER_EXECUTABLE_PATH;
  try {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const carregarOriginal = Module._load;
    Module._load = function (pedido, ...resto) {
      if (!pedido.startsWith('.') && !pedido.startsWith('/') && !Module.builtinModules.includes(pedido) && pedido !== 'electron') return new Proxy(function () {}, { get: () => function () {} });
      return carregarOriginal.call(this, pedido, ...resto);
    };
    let WhatsAppManager;
    try { WhatsAppManager = require(path.join(servicos, 'whatsapp-manager.js')); } finally { Module._load = carregarOriginal; }
    const gerente = Object.create(WhatsAppManager.prototype);
    gerente.app = { getPath: () => path.join(base, 'ud') };
    delete process.env.PUPPETEER_EXECUTABLE_PATH;
    assert.strictEqual(gerente.resolveBrowserExecutable(), edge);
    const chromium = criarExecutavel(base, 'ud', 'browsers', 'chromium-1208', 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium');
    assert.strictEqual(gerente.resolveBrowserExecutable(), chromium);
    const proprio = criarExecutavel(base, 'meu', 'chrome');
    process.env.PUPPETEER_EXECUTABLE_PATH = proprio;
    assert.strictEqual(gerente.resolveBrowserExecutable(), proprio);
  } finally {
    Object.defineProperty(process, 'platform', plataforma);
    if (envOriginal === undefined) delete process.env.PUPPETEER_EXECUTABLE_PATH; else process.env.PUPPETEER_EXECUTABLE_PATH = envOriginal;
    restaurar();
  }
});
