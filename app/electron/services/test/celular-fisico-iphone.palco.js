'use strict';
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');

const OPCOES_SEM_PERGUNTAS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-o', 'StrictHostKeyChecking=accept-new'];
const PREFIXO_DO_SSH = ['-p', '2222', 'OPCOES-DO-SSH', ...OPCOES_SEM_PERGUNTAS, 'mobile@127.0.0.1'];
const PREFIXO_DO_SCP = ['-P', '2222', 'OPCOES-DO-SSH', ...OPCOES_SEM_PERGUNTAS];
const NOVAPROXY = '/var/jb/usr/bin/novaproxy ';
const ID_DO_IPHONE = 'ios-00008120-ABCD';
const PERFIL_DO_ARQUIVO_DE_IDIOMAS = '/var/mobile/Library/Preferences/.GlobalPreferences.plist';

const palco = {
  chamadas: [],
  responder: () => ({}),
  ferramentasDoIphone: true,
  aparelhos: [],
  janelas: [],
  ponte: { rodando: false, iniciadas: 0 },
  plist: { gravacoes: [], primeiroIdioma: 'pt-BR' },
  reiniciar(responder = () => ({})) {
    this.chamadas = [];
    this.responder = responder;
  },
};

function responderChamada(chamada, callback) {
  palco.chamadas.push(chamada);
  const { erro = null, stdout = '', stderr = '' } = palco.responder(chamada) || {};
  callback(erro ? Object.assign(new Error(erro), { stderr }) : null, stdout, stderr);
}

const registrarChamada = (tipo, ...campos) => (...recebidos) => {
  const callback = recebidos.pop();
  responderChamada({ tipo, ...Object.fromEntries(campos.map((campo, indice) => [campo, recebidos[indice]])) }, callback);
};

class JanelaFalsa {
  constructor(opcoes) {
    Object.assign(this, { opcoes, destruida: false, focos: 0, enderecos: [], ouvintes: new Map(), fechadas: 0 });
    palco.janelas.push(this);
  }
  isDestroyed() { return this.destruida; }
  focus() { this.focos++; }
  loadURL(endereco) { this.enderecos.push(endereco); }
  on(evento, ouvinte) { this.ouvintes.set(evento, ouvinte); }
  close() {
    this.fechadas++;
    if (palco.falhaAoFechar) throw new Error('não fechou');
  }
}

const SUBSTITUTOS = {
  child_process: { execFile: registrarChamada('execFile', 'arquivo', 'argumentos', 'opcoes') },
  ws: function WebSocket() {},
  axios: {},
  electron: { BrowserWindow: JanelaFalsa },
  './mac-native': { tool: () => null },
  './iphone-ssh': { sshOptions: () => ['OPCOES-DO-SSH'], migrateLegacy: () => {} },
  './tool-paths': {
    execSsh: registrarChamada('ssh', 'argumentos', 'opcoes'),
    scp: () => 'SCP',
  },
  './ios-tools': {
    tool: (nome) => `FERRAMENTA-${nome}`,
    has: () => palco.ferramentasDoIphone,
  },
  './ios-devices': { listar: async () => { if (palco.aparelhos instanceof Error) throw palco.aparelhos; return palco.aparelhos; } },
  './ios-bridge': {
    PORT: 8765,
    isRunning: () => palco.ponte.rodando,
    start: () => { palco.ponte.iniciadas++; },
  },
  './plist-prefs': {
    aplicarIdiomaLocale: async (...argumentos) => { palco.plist.gravacoes.push(argumentos); },
    lerPrimeiroIdioma: async (arquivo) => { palco.chamadas.push({ tipo: 'plist', arquivo }); return palco.plist.primeiroIdioma; },
  },
};

const carregadorOriginal = Module._load;
Module._load = function (pedido, ...resto) {
  return Object.prototype.hasOwnProperty.call(SUBSTITUTOS, pedido) ? SUBSTITUTOS[pedido] : carregadorOriginal.call(this, pedido, ...resto);
};
process.env.NOVA_SMOKE_TEST = '1';
for (const nivel of ['log', 'info', 'warn', 'error']) console[nivel] = () => {};
const caminhoDoServico = path.resolve(__dirname, '../physicalMobileService.js');
delete require.cache[caminhoDoServico];
const Servico = require(caminhoDoServico);

const pastasCriadas = [];

function limparOPalco() {
  Module._load = carregadorOriginal;
  for (const pasta of pastasCriadas) fs.rmSync(pasta, { recursive: true, force: true });
}

function novoServico() {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'celular-fisico-iphone-'));
  pastasCriadas.push(pasta);
  Object.assign(palco, { aparelhos: [], janelas: [], falhaAoFechar: false, ferramentasDoIphone: true });
  Object.assign(palco.ponte, { rodando: false, iniciadas: 0 });
  Object.assign(palco.plist, { gravacoes: [], primeiroIdioma: 'pt-BR' });
  palco.reiniciar();
  return new Servico(null, { getPath: () => pasta });
}

const comandoDoSsh = (chamada) => chamada.argumentos.at(-1);
const respostaDoSsh = (porComando) => (chamada) => (chamada.tipo === 'ssh' ? porComando(comandoDoSsh(chamada)) : {});
const soSsh = () => palco.chamadas.filter((chamada) => chamada.tipo === 'ssh');
const comandosDoSsh = () => soSsh().map(comandoDoSsh);

module.exports = {
  palco, SUBSTITUTOS, novoServico, limparOPalco, PREFIXO_DO_SSH, PREFIXO_DO_SCP, NOVAPROXY, ID_DO_IPHONE, PERFIL_DO_ARQUIVO_DE_IDIOMAS,
  comandoDoSsh, respostaDoSsh, comandosDoSsh,
};
