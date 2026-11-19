'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

const carregadorOriginal = Module._load;

function carregarManager(modo, dialogos) {
  class ClienteFalso extends EventEmitter {
    initialize() {
      if (modo === 'erro') return Promise.reject(new Error('falha ao iniciar'));
      return new Promise((_, rejeita) => { this.rejeita = rejeita; });
    }
    async destroy() {
      if (this.rejeita) this.rejeita(new Error('Target closed'));
    }
  }
  const falsos = {
    'whatsapp-web.js': { Client: ClienteFalso, LocalAuth: class {}, MessageMedia: class {} },
    axios: {},
    'form-data': class {},
    qrcode: { toDataURL: async () => '' },
    'screenshot-desktop': async () => Buffer.alloc(0),
    electron: { dialog: { showMessageBox: (_janela, opcoes) => { dialogos.push(opcoes.message); return Promise.resolve({ response: 0 }); } } },
  };
  Module._load = function (pedido, ...resto) {
    return falsos[pedido] || carregadorOriginal.call(this, pedido, ...resto);
  };
  const caminho = path.resolve(__dirname, '../whatsapp-manager.js');
  delete require.cache[caminho];
  return require(caminho);
}

async function rodarNoLimite(modo) {
  const dialogos = [];
  const WhatsAppManager = carregarManager(modo, dialogos);
  const janela = { isDestroyed: () => false, webContents: { send: () => {} } };
  const manager = new WhatsAppManager(janela, { getPath: () => os.tmpdir() });
  manager.resolveBrowserExecutable = () => null;
  manager.maxInitTimeMs = 20;
  manager.reconnectAttempts = manager.maxReconnectAttempts;
  const silencio = { log: console.log, error: console.error, warn: console.warn };
  console.log = console.error = console.warn = () => {};
  try {
    manager.initialize();
    await new Promise(r => setTimeout(r, 300));
  } finally {
    Object.assign(console, silencio);
    manager.clearAllTimers();
    Module._load = carregadorOriginal;
  }
  return dialogos;
}

test('limite por tempo esgotado abre um unico aviso', async () => {
  assert.strictEqual((await rodarNoLimite('timeout')).length, 1);
});

test('limite por erro de inicio abre um unico aviso', async () => {
  assert.strictEqual((await rodarNoLimite('erro')).length, 1);
});
