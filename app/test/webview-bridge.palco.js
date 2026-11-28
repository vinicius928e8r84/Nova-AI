'use strict';

const Module = require('module');
const path = require('path');
const { mock } = require('node:test');

const PONTE = path.join(__dirname, '..', 'electron', 'webview-bridge.js');
const GLOBAIS_DO_NAVEGADOR = ['document', 'window', 'Node', 'NodeFilter', 'MutationObserver', 'Event', 'KeyboardEvent'];
const palco = { eventos: [], cena: null, observador: null, ouvintesDoIpc: new Map(), ouvintesDoDocumento: new Map(), janela: null };

const anotar = (tipo, dados) => palco.eventos.push([tipo, dados]);

class NoDeTexto {
  constructor(valor) {
    this.nodeType = 3;
    this.valor = valor;
    this.parentElement = null;
  }

  get nodeValue() {
    return this.valor;
  }

  set nodeValue(novo) {
    anotar('texto.nodeValue', [novo]);
    this.valor = novo;
  }

  get textContent() {
    return this.valor;
  }
}

class ElementoFalso {
  constructor(rotulo, opcoes = {}) {
    this.nodeType = 1;
    this.rotulo = rotulo;
    this.tagName = opcoes.tag || 'DIV';
    this.className = opcoes.classe || '';
    this.texto = opcoes.texto || '';
    this.nos = [];
    this.style = {};
    this.disabled = Boolean(opcoes.desabilitado);
    this.atributos = opcoes.atributos || {};
    this.shadowRoot = opcoes.sombra || null;
    this.consultas = opcoes.consultas || {};
    this.parentElement = null;
  }

  adicionar(no) {
    no.parentElement = this;
    this.nos.push(no);
    return this;
  }

  get textContent() {
    return this.nos.length ? this.nos.map((no) => no.textContent).join('') : this.texto;
  }

  set textContent(novo) {
    anotar('elemento.textContent', [this.rotulo, novo]);
    this.nos = [];
    this.texto = novo;
  }

  get innerText() {
    return this.textContent;
  }

  set innerHTML(novo) {
    anotar('elemento.innerHTML', [this.rotulo, novo]);
    this.nos = [];
    this.texto = '';
  }

  focus() {
    anotar('elemento.focus', [this.rotulo]);
  }

  click() {
    anotar('elemento.click', [this.rotulo]);
  }

  dispatchEvent(evento) {
    anotar('elemento.evento', [this.rotulo, evento.tipo, evento.iniciais]);
  }

  getAttribute(nome) {
    return Object.prototype.hasOwnProperty.call(this.atributos, nome) ? this.atributos[nome] : null;
  }

  querySelector(seletor) {
    anotar('elemento.querySelector', [this.rotulo, seletor]);
    return resolverConsulta(this.consultas[seletor]);
  }
}

function resolverConsulta(resposta) {
  if (resposta === 'lanca') throw new Error('seletor inválido');
  return resposta || null;
}

class EventoFalso {
  constructor(tipo, iniciais) {
    this.tipo = tipo;
    this.iniciais = iniciais;
  }
}

class MutationObserverFalso {
  constructor(chamada) {
    this.chamada = chamada;
    palco.observador = this;
  }

  observe(alvo, opcoes) {
    anotar('observer.observe', [alvo.rotulo, opcoes]);
  }
}

function* textosDentroDe(no) {
  for (const filho of no.nos) {
    if (filho.nodeType === 3) yield filho;
    else yield* textosDentroDe(filho);
  }
}

function criarDocumento(montado) {
  return {
    readyState: palco.cena.estadoDoDocumento || 'complete',
    body: montado.corpo,
    addEventListener: (tipo, ouvinte) => {
      anotar('documento.addEventListener', [tipo]);
      palco.ouvintesDoDocumento.set(tipo, ouvinte);
    },
    createTreeWalker: (raiz, filtro, nulo, falso) => {
      anotar('documento.createTreeWalker', [raiz.rotulo, filtro, nulo, falso]);
      const textos = textosDentroDe(raiz);
      return { nextNode: () => textos.next().value || null };
    },
    querySelector: (seletor) => {
      anotar('documento.querySelector', [seletor]);
      return resolverConsulta(montado.seletores[seletor]);
    },
    querySelectorAll: (seletor) => {
      anotar('documento.querySelectorAll', [seletor]);
      return montado.botoes;
    },
    execCommand: (...argumentos) => {
      anotar('documento.execCommand', argumentos);
      if (palco.cena.execCommandEscreve) montado.campoDeTexto.texto = argumentos[2];
    },
  };
}

function criarJanela() {
  class HTMLTextAreaElementFalso {}
  Object.defineProperty(HTMLTextAreaElementFalso.prototype, 'value', {
    set(novo) {
      anotar('textarea.value', [this.rotulo, novo]);
    },
  });
  return { HTMLTextAreaElement: HTMLTextAreaElementFalso };
}

function instalarGlobais(montado) {
  const globais = {
    document: criarDocumento(montado),
    window: palco.janela,
    Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 },
    NodeFilter: { SHOW_TEXT: 4 },
    MutationObserver: MutationObserverFalso,
    Event: EventoFalso,
    KeyboardEvent: EventoFalso,
  };
  Object.assign(global, globais);
}

function removerGlobais() {
  for (const nome of GLOBAIS_DO_NAVEGADOR) delete global[nome];
}

function instalarConsole() {
  const originais = {};
  const descrever = (parte) => (parte instanceof Error ? `<${parte.name}>` : parte);
  for (const nivel of ['log', 'warn', 'error']) {
    originais[nivel] = console[nivel];
    console[nivel] = (...partes) => anotar(`console.${nivel}`, partes.map(descrever));
  }
  return () => Object.assign(console, originais);
}

const carregarOriginal = Module._load;

const ehPedidoDoElectron = (pedido, pai) => pedido === 'electron' && Boolean(pai) && pai.filename === PONTE;

Module._load = function (pedido, pai, ...resto) {
  if (ehPedidoDoElectron(pedido, pai)) return { ipcRenderer: palco.ipcFalso };
  return carregarOriginal.call(this, pedido, pai, ...resto);
};

palco.ipcFalso = {
  on: (canal, ouvinte) => {
    anotar('ipc.on', [canal]);
    palco.ouvintesDoIpc.set(canal, ouvinte);
  },
  sendToHost: (canal, dados) => anotar('ipc.sendToHost', [canal, dados]),
};

function criarAmbiente(montado) {
  return {
    montado,
    ponte: () => palco.janela.NovaBridge,
    mutar: (mutacoes) => palco.observador.chamada(mutacoes),
    ouvirIpc: (canal, ...argumentos) => palco.ouvintesDoIpc.get(canal)(...argumentos),
    ouvirDocumento: (tipo) => palco.ouvintesDoDocumento.get(tipo)(),
    avancar: (ms) => mock.timers.tick(ms),
    observadorCriado: () => palco.observador !== null,
  };
}

async function rodarCena(cena) {
  palco.eventos = [];
  palco.cena = cena;
  palco.observador = null;
  palco.ouvintesDoIpc = new Map();
  palco.ouvintesDoDocumento = new Map();
  palco.janela = criarJanela();
  const montado = cena.montar({ elemento: (rotulo, opcoes) => new ElementoFalso(rotulo, opcoes), texto: (valor) => new NoDeTexto(valor) });
  delete require.cache[PONTE];
  const restaurarConsole = instalarConsole();
  mock.timers.enable({ apis: ['setTimeout'] });
  instalarGlobais(montado);
  try {
    require(PONTE);
    const retornos = await cena.roteiro(criarAmbiente(montado));
    return JSON.parse(JSON.stringify({ retornos, eventos: palco.eventos }, (chave, item) => (item === undefined ? '(indefinido)' : item)));
  } finally {
    removerGlobais();
    mock.timers.reset();
    restaurarConsole();
    delete require.cache[PONTE];
  }
}

module.exports = { rodarCena };
