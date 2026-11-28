'use strict';

const { abrirModalDeConexao } = require('./inapp-conectar');
const { abrirConsoleSozinho } = require('./inapp-console-sozinho');

const CANAL_PARA_ABRIR_A_CONEXAO = 'nova:iphone-setup-open';
const CANAL_PARA_ABRIR_O_CONSOLE = 'nova:iphone-console-open';

function attach({ ipcRenderer, invoke }) {
  const run = invoke || ((channel, ...args) => ipcRenderer.invoke(channel, ...args));
  ipcRenderer.on(CANAL_PARA_ABRIR_A_CONEXAO, (_event, payload) => abrirModalDeConexao(payload, run));
  ipcRenderer.on(CANAL_PARA_ABRIR_O_CONSOLE, (_event, payload) => abrirConsoleSozinho(payload, run));
  return { open: (payload) => abrirModalDeConexao(payload, run) };
}

module.exports = { attach };
