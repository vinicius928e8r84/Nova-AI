'use strict';
const Module = require('module');
const path = require('path');

const CAMINHO_DO_HUMANO = path.join(__dirname, '..', 'nova-human-controller.js');

let carregamentoAtual = null;
const carregarOriginal = Module._load;

Module._load = function (pedido, pai, ...resto) {
  const falso = carregamentoAtual && pai?.filename === carregamentoAtual.caminho ? carregamentoAtual.modulos.get(pedido) : null;
  if (falso) return falso();
  return carregarOriginal.call(this, pedido, pai, ...resto);
};

function paraRegistro(valor) {
  if (valor instanceof Error) return { erro: valor.constructor.name, mensagem: valor.message };
  if (valor === undefined) return '(undefined)';
  if (Array.isArray(valor)) return valor.map(paraRegistro);
  if (typeof valor !== 'object' || valor === null) return valor;
  return Object.fromEntries(Object.entries(valor).map(([chave, item]) => [chave, paraRegistro(item)]));
}

class Roteiro {
  constructor(cena) {
    this.registro = [];
    this.enderecos = [...(cena.enderecos || ['about:blank'])];
    this.falhas = { ...(cena.falhas || {}) };
    this.resultados = cena.resultados ?? 1;
  }

  anotar(...evento) {
    this.registro.push(evento.map(paraRegistro));
  }

  passo(nome, ...args) {
    this.anotar(nome, ...args);
    if (this.falhas[nome]) throw new Error(this.falhas[nome]);
  }

  endereco() {
    const atual = this.enderecos.length > 1 ? this.enderecos.shift() : this.enderecos[0];
    this.anotar('page.url', atual);
    return atual;
  }
}

function resultadosFalsos(roteiro) {
  return {
    count: async () => {
      roteiro.anotar('results.count');
      return roteiro.resultados;
    },
    nth: (indice) => ({
      scrollIntoViewIfNeeded: async () => roteiro.passo('results.nth.scrollIntoViewIfNeeded', indice),
      click: async () => roteiro.passo('results.nth.click', indice),
    }),
  };
}

function paginaFalsa(roteiro) {
  const passo = nome => async (...args) => roteiro.passo(nome, ...args);
  return {
    bringToFront: passo('page.bringToFront'),
    waitForTimeout: passo('page.waitForTimeout'),
    click: passo('page.click'),
    goBack: passo('page.goBack'),
    waitForSelector: passo('page.waitForSelector'),
    url: () => roteiro.endereco(),
    locator: (seletor) => {
      roteiro.anotar('page.locator', seletor);
      return resultadosFalsos(roteiro);
    },
  };
}

function navegadorFalso(roteiro) {
  const pagina = paginaFalsa(roteiro);
  const passo = nome => async (...args) => roteiro.passo(nome, ...args);
  return {
    launch: passo('browser.launch'),
    navigate: passo('browser.navigate'),
    type: passo('browser.type'),
    close: passo('browser.close'),
    getPage: async () => {
      roteiro.passo('browser.getPage');
      return pagina;
    },
  };
}

function janelaFalsa(roteiro, janela) {
  if (!janela) return null;
  return {
    isDestroyed: () => janela === 'destruida',
    show: () => roteiro.anotar('janela.show'),
    focus: () => roteiro.anotar('janela.focus'),
    webContents: { send: (canal, dados) => roteiro.anotar('janela.send', canal, dados) },
  };
}

function prenderHora(roteiro) {
  const original = Date.prototype.toLocaleTimeString;
  Date.prototype.toLocaleTimeString = function (...args) {
    roteiro.anotar('toLocaleTimeString', ...args);
    return '12:34:56';
  };
  return () => {
    Date.prototype.toLocaleTimeString = original;
  };
}

async function encenar(cena, caminho = CAMINHO_DO_HUMANO) {
  const roteiro = new Roteiro(cena);
  const devolverHora = prenderHora(roteiro);
  carregamentoAtual = { caminho, modulos: new Map([['./browser-manager', () => ({ browserService: navegadorFalso(roteiro) })]]) };
  try {
    delete require.cache[caminho];
    const NovaHumanController = require(caminho);
    carregamentoAtual = null;
    const humano = new NovaHumanController(janelaFalsa(roteiro, cena.janela ?? 'viva'), { app: 'falso' });
    await cena.passos(humano, roteiro);
    roteiro.anotar('estado', { lastQuery: humano.lastQuery, currentAttempt: humano.currentAttempt });
  } finally {
    carregamentoAtual = null;
    devolverHora();
  }
  return roteiro.registro;
}

async function chamar(roteiro, rotulo, acao) {
  try {
    roteiro.anotar(rotulo, await acao());
  } catch (erro) {
    roteiro.anotar(`${rotulo} lançou`, erro);
  }
}

module.exports = { CAMINHO_DO_HUMANO, encenar, chamar };
