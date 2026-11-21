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

function carregarGerente(plataforma, base) {
  const original = Module._load;
  const descritor = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: plataforma });
  delete require.cache[require.resolve(path.join(servicos, 'platform-utils.js'))];
  delete require.cache[require.resolve(path.join(servicos, 'whatsapp-manager.js'))];
  Module._load = function (pedido, ...resto) {
    if (!pedido.startsWith('.') && !path.isAbsolute(pedido) && !Module.builtinModules.includes(pedido) && pedido !== 'electron') return new Proxy(function () {}, { get: () => function () {} });
    return original.call(this, pedido, ...resto);
  };
  try {
    const WhatsAppManager = require(path.join(servicos, 'whatsapp-manager.js'));
    const gerente = Object.create(WhatsAppManager.prototype);
    gerente.app = { getPath: () => path.join(base, 'ud') };
    return { gerente, restaurar() { Object.defineProperty(process, 'platform', descritor); } };
  } finally { Module._load = original; }
}

function semEnvDoPuppeteer(acao) {
  const original = process.env.PUPPETEER_EXECUTABLE_PATH;
  delete process.env.PUPPETEER_EXECUTABLE_PATH;
  try { return acao(); } finally {
    if (original === undefined) delete process.env.PUPPETEER_EXECUTABLE_PATH; else process.env.PUPPETEER_EXECUTABLE_PATH = original;
  }
}

function comGerenteNoMac(base, acao) {
  const { restaurar } = carregar({ resources: path.join(base, 'res'), userData: path.join(base, 'ud'), home: path.join(base, 'home') });
  const { gerente, restaurar: restaurarPlataforma } = carregarGerente('darwin', base);
  try { return semEnvDoPuppeteer(() => acao(gerente)); } finally { restaurarPlataforma(); restaurar(); }
}

function edgeEmbutido(base) {
  return criarExecutavel(base, 'res', 'browsers', 'edge', 'Microsoft Edge.app', 'Contents', 'MacOS', 'Microsoft Edge');
}

function chromiumNoUserData(base, pastaDoSistema, ...executavel) {
  return criarExecutavel(base, 'ud', 'browsers', 'chromium-1208', pastaDoSistema, ...executavel);
}

test('whatsapp no Mac: PUPPETEER_EXECUTABLE_PATH vence, depois Chromium de userData/browsers, depois Edge embutido', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'nav-'));
  const edge = edgeEmbutido(base);
  comGerenteNoMac(base, (gerente) => {
    assert.strictEqual(gerente.resolveBrowserExecutable(), edge);
    const chromium = chromiumNoUserData(base, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium');
    assert.strictEqual(gerente.resolveBrowserExecutable(), chromium);
    const proprio = criarExecutavel(base, 'meu', 'chrome');
    process.env.PUPPETEER_EXECUTABLE_PATH = proprio;
    assert.strictEqual(gerente.resolveBrowserExecutable(), proprio);
  });
});

test('whatsapp no Mac: PUPPETEER_EXECUTABLE_PATH para arquivo que nao existe fica de fora', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'nav-'));
  const edge = edgeEmbutido(base);
  comGerenteNoMac(base, (gerente) => {
    process.env.PUPPETEER_EXECUTABLE_PATH = path.join(base, 'nao-existe', 'chrome');
    assert.strictEqual(gerente.resolveBrowserExecutable(), edge);
  });
});

test('whatsapp no Mac: Chromium de userData/browsers vem antes do Chrome instalado em ~/Applications', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'nav-'));
  edgeEmbutido(base);
  const chrome = criarExecutavel(base, 'home', 'Applications', 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome');
  comGerenteNoMac(base, (gerente) => {
    assert.strictEqual(gerente.resolveBrowserExecutable(), chrome);
    const chromium = chromiumNoUserData(base, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium');
    assert.strictEqual(gerente.resolveBrowserExecutable(), chromium);
  });
});

test('whatsapp no Windows: Chromium de userData/browsers vale, como no Mac', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'nav-'));
  const chromium = chromiumNoUserData(base, 'chrome-win64', 'chrome.exe');
  const { gerente, restaurar } = carregarGerente('win32', base);
  try {
    semEnvDoPuppeteer(() => assert.strictEqual(gerente.resolveBrowserExecutable(), chromium));
  } finally { restaurar(); }
});
