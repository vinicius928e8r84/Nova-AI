const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

Object.defineProperty(process, 'platform', { value: 'win32' });

const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-chromium-'));
const recursos = path.join(raiz, 'resources');
const executavel = path.join(recursos, 'browsers', 'chromium-1248', 'chrome-win64', 'chrome.exe');
fs.mkdirSync(path.dirname(executavel), { recursive: true });
fs.writeFileSync(executavel, '');
process.resourcesPath = recursos;
test.after(() => fs.rmSync(raiz, { recursive: true, force: true }));

const carregarOriginal = Module._load;
Module._load = function (pedido, ...resto) {
  if (pedido === 'electron') return { app: { getAppPath: () => path.join(raiz, 'app'), isPackaged: true }, BrowserWindow: class {}, session: {}, ipcMain: {}, net: {}, screen: {} };
  if (pedido === 'playwright') return { chromium: {}, firefox: {} };
  if (pedido === 'systeminformation') return {};
  return carregarOriginal.call(this, pedido, ...resto);
};

const BrowserFarmService = require('../electron/services/browserFarmService');
const GlobalSpoofService = require('../electron/services/global-spoof-service');

const semNavegadorDoSistema = (fn) => {
  const existe = fs.existsSync;
  fs.existsSync = (p) => (String(p).startsWith(raiz) && existe(p));
  try { return fn(); } finally { fs.existsSync = existe; }
};

test('browserFarmService acha chromium-1248 empacotado', () => {
  const servico = Object.create(BrowserFarmService.prototype);
  assert.strictEqual(semNavegadorDoSistema(() => servico.getChromeExecutablePath()), executavel);
});

test('browserFarmService devolve null sem nenhum chromium', () => {
  const servico = Object.create(BrowserFarmService.prototype);
  const antes = process.resourcesPath;
  process.resourcesPath = path.join(raiz, 'vazio');
  try {
    assert.strictEqual(semNavegadorDoSistema(() => servico.getChromeExecutablePath()), null);
  } finally { process.resourcesPath = antes; }
});

test('global-spoof-service _findChrome acha chromium-1248 empacotado', () => {
  const servico = Object.create(GlobalSpoofService.prototype);
  servico.app = { isPackaged: true };
  assert.strictEqual(semNavegadorDoSistema(() => servico._findChrome('chrome')), executavel);
});

test('global-spoof-service cai no chromium empacotado quando o navegador pedido não existe', () => {
  const servico = Object.create(GlobalSpoofService.prototype);
  servico.app = { isPackaged: true };
  assert.strictEqual(semNavegadorDoSistema(() => servico._findChrome('brave')), executavel);
});
