'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const pastaDeDados = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-farm-login-'));
test.after(() => fs.rmSync(pastaDeDados, { recursive: true, force: true }));

const lancamentos = [];
const navegadorFalso = {
  launchPersistentContext: async (pasta, opcoes) => {
    lancamentos.push({ pasta, executavel: opcoes.executablePath });
    const pagina = { goto: async () => {} };
    const ouvintes = {};
    return {
      addInitScript: async () => {},
      pages: () => [pagina],
      newPage: async () => pagina,
      on: (evento, funcao) => { ouvintes[evento] = funcao; },
      fechar: () => ouvintes.close(),
    };
  },
};

const janelasAbertas = [];
class JanelaFalsa {
  constructor(opcoes) {
    this.titulo = opcoes.title;
    this.ouvintes = {};
    this.destruida = false;
    this.webContents = { setUserAgent: () => {}, on: () => {}, executeJavaScript: async () => null };
    janelasAbertas.push(this);
  }
  on(evento, funcao) { this.ouvintes[evento] = funcao; }
  maximize() {}
  loadURL(endereco) { this.endereco = endereco; }
  isDestroyed() { return this.destruida; }
  fechar() { this.destruida = true; this.ouvintes.closed(); }
}
const sessaoFalsa = { fromPartition: () => ({ setUserAgent: () => {}, removeAllListeners: () => {} }) };

const carregarOriginal = Module._load;
Module._load = function (pedido, ...resto) {
  if (pedido === 'electron') {
    return { app: { getPath: () => pastaDeDados, getAppPath: () => pastaDeDados }, BrowserWindow: JanelaFalsa, session: sessaoFalsa, ipcMain: {}, net: {}, screen: {} };
  }
  if (pedido === 'playwright') return { chromium: navegadorFalso, firefox: navegadorFalso };
  if (pedido === 'systeminformation') return {};
  return carregarOriginal.call(this, pedido, ...resto);
};
const BrowserFarmService = require('../browserFarmService');
Module._load = carregarOriginal;

const servicoComPerfilPadrao = () => {
  const servico = new BrowserFarmService(null);
  servico.profiles = servico._makeDefaultProfiles(1);
  servico.getChromeExecutablePath = () => 'chrome-do-teste';
  servico.getOptimalGeoDetails = async () => null;
  servico._log = () => {};
  servico._updateStatus = () => {};
  return servico;
};

test('perfil padrão, sem navegador escolhido, abre o login pelo Chrome', async () => {
  lancamentos.length = 0;
  const servico = servicoComPerfilPadrao();
  const perfil = servico.profiles[0];
  assert.strictEqual(perfil.browser, undefined);
  const resposta = await servico.openLoginBrowser(perfil.id, 'youtube');
  assert.deepStrictEqual(resposta, { success: true });
  assert.deepStrictEqual(lancamentos.map(l => l.executavel), ['chrome-do-teste']);
  servico.playwrightContexts.get(perfil.id).fechar();
});

test('perfil gravado como aloha abre o login na janela do Electron, como a corrida', async () => {
  lancamentos.length = 0;
  janelasAbertas.length = 0;
  const servico = servicoComPerfilPadrao();
  const perfil = servico.profiles[0];
  perfil.browser = 'aloha';
  const resposta = await servico.openLoginBrowser(perfil.id, 'youtube');
  assert.deepStrictEqual(resposta, { success: true });
  assert.deepStrictEqual(lancamentos, []);
  assert.deepStrictEqual(janelasAbertas.map(j => j.titulo), ['Nova Farm Login — Profile 01']);
  janelasAbertas[0].fechar();
});
