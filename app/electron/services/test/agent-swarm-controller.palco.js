'use strict';

const Module = require('module');
const path = require('path');
const { EventEmitter } = require('events');
const { mock } = require('node:test');
const { marcarCaminhos } = require('./caminhos-do-palco');

const PASTA_DOS_SERVICOS = path.join(__dirname, '..');
const AGORA = Date.UTC(2026, 10, 27, 12, 0, 0);
const DO_ENXAME = /agent-swarm/;
const setImmediateReal = global.setImmediate;

const palco = { eventos: [], gemini: null, https: null, filho: null, navegador: null, processo: null };

const anotar = (tipo, dados) => palco.eventos.push([tipo, dados]);

function criarFilho() {
  return class FilhoFalso {
    constructor(janela, app) {
      anotar('filho.criado', { temJanela: Boolean(janela), temApp: Boolean(app) });
    }

    async executeTask(...argumentos) {
      anotar('filho.executeTask', argumentos);
      return palco.filho.responder(...argumentos);
    }
  };
}

function criarNavegador() {
  const metodos = ['launch', 'navigate', 'type', 'wait', 'click', 'close'];
  const navegador = {};
  for (const metodo of metodos) {
    navegador[metodo] = async (...argumentos) => {
      anotar(`navegador.${metodo}`, argumentos);
      return palco.navegador.responder(metodo, argumentos);
    };
  }
  navegador.executeScript = async (...argumentos) => {
    anotar('navegador.executeScript', argumentos);
    return palco.navegador.responder('executeScript', argumentos);
  };
  return navegador;
}

function criarEngineDoGemini() {
  return {
    getAuthStatus: () => palco.gemini.autenticacao(),
    sendMessage: async (pedido) => {
      anotar('gemini.sendMessage', pedido);
      return palco.gemini.responder(pedido);
    },
  };
}

function criarHttps() {
  return {
    request: (opcoes, aoResponder) => {
      anotar('https.request', opcoes);
      const requisicao = new EventEmitter();
      let corpo = '';
      requisicao.write = (texto) => { corpo += texto; };
      requisicao.end = () => {
        anotar('https.corpo', corpo);
        setImmediateReal(() => palco.https.responder(opcoes, aoResponder, requisicao));
      };
      return requisicao;
    },
  };
}

function criarProcesso() {
  const processo = new EventEmitter();
  processo.stdout = new EventEmitter();
  processo.stderr = new EventEmitter();
  return processo;
}

const FALSOS = {
  './browser-manager': () => ({ browserService: palco.navegadorFalso }),
  './child-worker-agent': () => palco.FilhoFalso,
  './gemini-browser-engine': () => palco.engineDoGemini,
  './python-runtime': () => ({ python: () => 'python-falso' }),
  https: () => palco.httpsFalso,
  child_process: () => ({
    spawn: (comando, argumentos, opcoes) => {
      anotar('spawn', { comando, argumentos, opcoes });
      palco.processo = criarProcesso();
      return palco.processo;
    },
  }),
};

const carregarOriginal = Module._load;

function ehPedidoDoEnxame(pedido, pai) {
  if (!pai) return false;
  return DO_ENXAME.test(pai.filename || '') && Boolean(FALSOS[pedido]);
}

Module._load = function (pedido, pai, ...resto) {
  if (ehPedidoDoEnxame(pedido, pai)) return FALSOS[pedido]();
  return carregarOriginal.call(this, pedido, pai, ...resto);
};

palco.navegadorFalso = criarNavegador();
palco.FilhoFalso = criarFilho();
palco.engineDoGemini = criarEngineDoGemini();
palco.httpsFalso = criarHttps();

const AgentSwarmController = require('../agent-swarm-controller');

function janelaFalsa(estado = {}) {
  const janela = {
    destruida: Boolean(estado.destruida),
    isDestroyed: () => janela.destruida,
    show: () => anotar('janela.show', []),
    focus: () => anotar('janela.focus', []),
    webContents: { send: (canal, dados) => anotar('janela.enviar', [canal, dados]) },
  };
  return janela;
}

function appFalso(whatsapp) {
  return { whatsappManager: whatsapp };
}

const whatsappFalso = (opcoes = {}) => ({
  isReady: opcoes.pronto !== false,
  client: opcoes.semId ? {} : { info: { wid: { _serialized: 'meu-id@c.us' } } },
  sendReply: async (...argumentos) => {
    anotar('whatsapp.sendReply', argumentos);
    if (opcoes.falha) throw new Error(opcoes.falha);
  },
});

function instalarConsole() {
  const originais = {};
  for (const nivel of ['log', 'info', 'warn', 'error']) {
    originais[nivel] = console[nivel];
    console[nivel] = (...partes) => anotar(`console.${nivel === 'info' ? 'log' : nivel}`, partes.map(String));
  }
  return () => Object.assign(console, originais);
}

async function descarregar() {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediateReal(resolve));
}

async function avancar(ms) {
  mock.timers.tick(ms);
  await descarregar();
}

async function ate(condicao, passo = 100, maximo = 400) {
  for (let i = 0; i < maximo && !condicao(); i++) await avancar(passo);
}

function normalizar(valor) {
  const texto = JSON.stringify(valor, (chave, item) => (item === undefined ? '(indefinido)' : item));
  const semHora = texto.replace(/\[\d{2}:\d{2}:\d{2}\]/g, '[HH:MM:SS]');
  return JSON.parse(marcarCaminhos(semHora, [[path.join(PASTA_DOS_SERVICOS, '..', '..'), '<app>']]));
}

async function rodarCena(cena) {
  palco.eventos = [];
  palco.gemini = { autenticacao: () => null, responder: () => ({ success: false }), ...cena.gemini };
  palco.https = { responder: (opcoes, aoResponder) => aoResponder(respostaFalsa(200, '{}')), ...cena.https };
  palco.filho = { responder: async () => ({ success: true, finalAnswer: 'feito' }), ...cena.filho };
  palco.navegador = { responder: async () => undefined, ...cena.navegador };
  const restaurarConsole = instalarConsole();
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: AGORA });
  try {
    const janela = janelaFalsa(cena.janela);
    const controlador = new AgentSwarmController(janela, appFalso(cena.whatsapp && whatsappFalso(cena.whatsapp)));
    const ambiente = { controlador, janela, avancar, ate, descarregar, processo: () => palco.processo, eventos: () => palco.eventos };
    const retornos = await cena.roteiro(ambiente);
    await descarregar();
    return normalizar({ retornos, eventos: palco.eventos, estado: { isSwarmActive: controlador.isSwarmActive, isCancelled: controlador.isCancelled } });
  } finally {
    mock.timers.reset();
    restaurarConsole();
  }
}

function respostaFalsa(status, texto) {
  const resposta = new EventEmitter();
  resposta.statusCode = status;
  setImmediateReal(() => {
    resposta.emit('data', texto.slice(0, Math.ceil(texto.length / 2)));
    resposta.emit('data', texto.slice(Math.ceil(texto.length / 2)));
    resposta.emit('end');
  });
  return resposta;
}

function respostaDoGemini(texto) {
  return { candidates: [{ content: { parts: [{ text: texto }] } }] };
}

module.exports = { rodarCena, respostaFalsa, respostaDoGemini, marcarCaminhos, PASTA_DOS_SERVICOS };
