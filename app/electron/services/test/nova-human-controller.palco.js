'use strict';

const Module = require('module');

const DO_NOVA_HUMAN = /nova-human/;
const palco = { eventos: [], navegador: null, pagina: null };

const anotar = (tipo, dados) => palco.eventos.push([tipo, dados]);

function falharSeFor(metodo) {
  const mensagem = palco.navegador.falhas[metodo];
  if (mensagem) throw new Error(mensagem);
}

function criarLocalizador(seletor) {
  return {
    count: async () => {
      anotar('localizador.count', [seletor]);
      return palco.pagina.resultados;
    },
    nth: (indice) => ({
      scrollIntoViewIfNeeded: async () => anotar('resultado.scrollIntoViewIfNeeded', [indice]),
      click: async () => anotar('resultado.click', [indice]),
    }),
  };
}

function criarPagina() {
  const urls = [...palco.pagina.urls];
  const pagina = {
    bringToFront: async () => anotar('pagina.bringToFront', []),
    waitForTimeout: async (ms) => anotar('pagina.waitForTimeout', [ms]),
    click: async (seletor) => anotar('pagina.click', [seletor]),
    goBack: async () => anotar('pagina.goBack', []),
    locator: (seletor) => criarLocalizador(seletor),
    waitForSelector: async (seletor, opcoes) => {
      anotar('pagina.waitForSelector', [seletor, opcoes]);
      falharSeFor('waitForSelector');
    },
    url: () => {
      const atual = urls.length > 1 ? urls.shift() : urls[0];
      anotar('pagina.url', [atual]);
      return atual;
    },
  };
  return pagina;
}

function criarNavegador() {
  return {
    launch: async () => { anotar('navegador.launch', []); falharSeFor('launch'); },
    getPage: async () => palco.paginaFalsa,
    navigate: async (...argumentos) => anotar('navegador.navigate', argumentos),
    type: async (...argumentos) => anotar('navegador.type', argumentos),
    close: async () => { anotar('navegador.close', []); falharSeFor('close'); },
  };
}

palco.navegadorFalso = criarNavegador();

const carregarOriginal = Module._load;

const ehPedidoDoNavegador = (pedido, pai) => Boolean(pai) && pedido === './browser-manager' && DO_NOVA_HUMAN.test(pai.filename || '');

Module._load = function (pedido, pai, ...resto) {
  if (ehPedidoDoNavegador(pedido, pai)) return { browserService: palco.navegadorFalso };
  return carregarOriginal.call(this, pedido, pai, ...resto);
};

const NovaHumanController = require('../nova-human-controller');

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

const normalizar = (valor) => JSON.parse(JSON.stringify(valor, (chave, item) => (item === undefined ? '(indefinido)' : item)).replace(/\[\d{2}:\d{2}:\d{2}\]/g, '[HH:MM:SS]'));

async function rodarCena(cena) {
  palco.eventos = [];
  palco.navegador = { falhas: {}, ...cena.navegador };
  palco.pagina = { urls: ['https://www.youtube.com/'], resultados: 3, ...cena.pagina };
  palco.paginaFalsa = criarPagina();
  const janela = cena.semJanela ? null : janelaFalsa(cena.janela);
  const controlador = new NovaHumanController(janela, { nome: 'app' });
  const retornos = await cena.roteiro(controlador, janela);
  return normalizar({ retornos, eventos: palco.eventos, estado: { lastQuery: controlador.lastQuery, currentAttempt: controlador.currentAttempt } });
}

module.exports = { rodarCena };
