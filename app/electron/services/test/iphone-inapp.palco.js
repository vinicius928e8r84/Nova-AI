'use strict';
const path = require('path');
const { mock } = require('node:test');

const PASTA_DO_SETUP = path.join(__dirname, '..', 'iphone-setup');
const CAMINHO_DO_INAPP = path.join(PASTA_DO_SETUP, 'inapp.js');
const ENTIDADES = { '&times;': '×', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"' };
const SEM_FECHAMENTO = new Set(['input', 'br']);
const PEDACO_DA_MARCACAO = /<(\/?)([a-zA-Z][\w-]*)((?:[^>"]|"[^"]*")*?)(\/?)>|([^<]+)/g;
const ATRIBUTO = /([\w:-]+)(?:="([^"]*)")?/g;
const ESTADO_DE_CADA_ELEMENTO = [
  '.nvios-setup', '.nvios-console', '.nvios-device', '.nvios-form', '#nvios-pass', '.nvios-submit', '.nvios-error', '.nvios-progress',
  '.nvios-elapsed', '.nvios-result', '.nvios-msg', '.nvios-console-open', '.nvios-done', '.nvios-setup .nvios-x', '.nvios-console-close',
  '.nvios-console-window', '.nvios-console-retry', '.nvios-webview-wrap', '.nvios-webview-status',
];

const decodificar = (texto) => texto.replace(/&\w+;/g, (entidade) => ENTIDADES[entidade] || entidade);

function lerAtributos(texto) {
  const atributos = [];
  for (const [, nome, valor] of texto.matchAll(ATRIBUTO)) atributos.push([nome, valor === undefined ? '' : decodificar(valor)]);
  return atributos;
}

function casaCom(elemento, simples) {
  if (simples.startsWith('#')) return elemento.getAttribute('id') === simples.slice(1);
  return elemento.classes().includes(simples.slice(1));
}

function casaComSeletor(elemento, partes) {
  if (!casaCom(elemento, partes[partes.length - 1])) return false;
  let restante = partes.length - 2;
  for (let pai = elemento.pai; pai && restante >= 0; pai = pai.pai) {
    if (casaCom(pai, partes[restante])) restante--;
  }
  return restante < 0;
}

class Elemento {
  constructor(documento, tag) {
    Object.assign(this, { documento, tagName: tag.toUpperCase(), pai: null, filhos: [], atributos: new Map(), ouvintes: new Map() });
    Object.assign(this, { disabled: false, value: '', textoProprio: null });
  }

  classes() { return (this.atributos.get('class') || '').split(/\s+/).filter(Boolean); }
  get className() { return this.atributos.get('class') || ''; }
  set className(valor) { this.atributos.set('class', valor); }
  get hidden() { return this.atributos.has('hidden'); }
  set hidden(valor) { if (valor) this.atributos.set('hidden', ''); else this.atributos.delete('hidden'); }
  getAttribute(nome) { return this.atributos.has(nome) ? this.atributos.get(nome) : null; }
  setAttribute(nome, valor) { this.atributos.set(nome, String(valor)); }
  get id() { return this.getAttribute('id') || ''; }
  set id(valor) { this.setAttribute('id', valor); }

  get textContent() {
    if (this.textoProprio !== null) return this.textoProprio;
    return this.filhos.map((filho) => (typeof filho === 'string' ? filho : filho.textContent)).join('');
  }

  set textContent(valor) {
    this.filhos = [];
    this.textoProprio = String(valor);
  }

  set innerHTML(marcacao) {
    this.filhos = [];
    this.textoProprio = null;
    const pilha = [this];
    for (const [, fecha, tag, atributos, , texto] of marcacao.matchAll(PEDACO_DA_MARCACAO)) {
      const topo = pilha[pilha.length - 1];
      if (texto !== undefined) topo.filhos.push(decodificar(texto));
      else if (fecha) pilha.pop();
      else this.abrirFilho(topo, pilha, tag, atributos);
    }
  }

  abrirFilho(topo, pilha, tag, atributos) {
    const filho = new Elemento(this.documento, tag);
    for (const [nome, valor] of lerAtributos(atributos)) filho.atributos.set(nome, valor);
    filho.pai = topo;
    topo.filhos.push(filho);
    if (!SEM_FECHAMENTO.has(tag)) pilha.push(filho);
  }

  elementos() { return this.filhos.filter((filho) => typeof filho !== 'string').flatMap((filho) => [filho, ...filho.elementos()]); }

  querySelector(seletor) {
    const partes = seletor.split(/\s+/);
    return this.elementos().find((elemento) => casaComSeletor(elemento, partes)) || null;
  }

  appendChild(filho) {
    filho.pai = this;
    this.filhos.push(filho);
    return filho;
  }

  remove() {
    if (this.pai) this.pai.filhos = this.pai.filhos.filter((irmao) => irmao !== this);
    this.pai = null;
    this.documento.diario.push(['remove', this.rotulo()]);
  }

  addEventListener(tipo, ouvinte) {
    this.ouvintes.set(tipo, [...(this.ouvintes.get(tipo) || []), ouvinte]);
  }

  disparar(tipo, evento = {}) {
    const completo = { target: this, preventDefault: () => this.documento.diario.push(['preventDefault', tipo]), stopPropagation: () => {}, ...evento };
    for (const ouvinte of this.ouvintes.get(tipo) || []) ouvinte(completo);
  }

  focus() {
    this.documento.activeElement = this;
    this.documento.diario.push(['focus', this.rotulo()]);
  }

  select() { this.documento.diario.push(['select', this.rotulo()]); }

  rotulo() {
    const classe = this.classes()[0];
    return this.id || classe || this.tagName.toLowerCase();
  }
}

class Documento {
  constructor(opcoes) {
    this.diario = [];
    this.webviewIndisponivel = Boolean(opcoes.webviewIndisponivel);
    this.ouvintesDeTeclas = [];
    this.head = new Elemento(this, 'head');
    this.documentElement = new Elemento(this, 'html');
    this.body = new Elemento(this, 'body');
    this.botaoDaPagina = new Elemento(this, 'button');
    this.botaoDaPagina.className = 'botao-da-pagina';
    this.activeElement = this.botaoDaPagina;
  }

  createElement(tag) {
    if (tag === 'webview' && this.webviewIndisponivel) throw new Error('webview indisponível');
    return new Elemento(this, tag);
  }

  getElementById(id) {
    return [this.head, this.body].flatMap((raiz) => raiz.elementos()).find((elemento) => elemento.id === id) || null;
  }

  addEventListener(tipo, ouvinte, captura) { this.ouvintesDeTeclas.push([tipo, ouvinte, captura]); }

  removeEventListener(tipo, ouvinte, captura) {
    this.ouvintesDeTeclas = this.ouvintesDeTeclas.filter((item) => !(item[0] === tipo && item[1] === ouvinte && item[2] === captura));
  }

  teclar(tecla) {
    const evento = { key: tecla, preventDefault: () => this.diario.push(['preventDefault', tecla]), stopPropagation: () => this.diario.push(['stopPropagation', tecla]) };
    for (const [tipo, ouvinte] of this.ouvintesDeTeclas) if (tipo === 'keydown') ouvinte(evento);
  }
}

function ipcFalso(diario) {
  const ouvintes = new Map();
  return {
    ouvintes,
    on: (canal, ouvinte) => { ouvintes.set(canal, ouvinte); },
    invoke: async (canal, ...argumentos) => { diario.push(['ipcRenderer.invoke', canal, ...argumentos]); return { success: true, via: 'ipcRenderer' }; },
  };
}

function fotografar(host) {
  const estado = {};
  for (const seletor of ESTADO_DE_CADA_ELEMENTO) {
    const elemento = host.querySelector(seletor);
    estado[seletor] = elemento && { hidden: elemento.hidden, disabled: elemento.disabled, texto: elemento.textContent, valor: elemento.value };
  }
  return estado;
}

function criarContexto(documento, diario, resposta) {
  const ipc = ipcFalso(diario);
  const contexto = { responder: resposta };
  const invocar = async (canal, argumento) => {
    diario.push(['invoke', canal, argumento === undefined ? null : argumento]);
    const retorno = await contexto.responder(canal, argumento);
    if (retorno instanceof Error) throw retorno;
    return retorno;
  };
  const hosts = () => documento.body.elementos().filter((elemento) => elemento.atributos.has('data-nova-iphone-setup') && elemento.pai === documento.body);
  const avancar = async (ms) => {
    mock.timers.tick(ms);
    for (let i = 0; i < 5; i++) await new Promise((resolver) => setImmediate(resolver));
  };
  return Object.assign(contexto, {
    documento, ipc, invocar, avancar, diario, hosts,
    host: () => hosts()[0] || null,
    foto: () => (hosts()[0] ? fotografar(hosts()[0]) : null),
    clicar: (seletor) => hosts()[0].querySelector(seletor).disparar('click'),
    enviarFormulario: () => hosts()[0].querySelector('.nvios-form').disparar('submit'),
    pressionar: (seletor, tipo, evento) => hosts()[0].querySelector(seletor).disparar(tipo, evento),
  });
}

function relogiosFalsos() {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1000 });
  const contagem = { intervalosAtivos: 0 };
  const intervalo = global.setInterval;
  const limpar = global.clearInterval;
  global.setInterval = (...argumentos) => { contagem.intervalosAtivos++; return intervalo(...argumentos); };
  global.clearInterval = (id) => { if (id) contagem.intervalosAtivos--; return limpar(id); };
  return {
    contagem,
    restaurar: () => { mock.timers.reset(); global.setInterval = intervalo; global.clearInterval = limpar; },
  };
}

function esquecerModulosDoInapp() {
  for (const arquivo of Object.keys(require.cache)) {
    if (path.dirname(arquivo) === PASTA_DO_SETUP && path.basename(arquivo).startsWith('inapp')) delete require.cache[arquivo];
  }
}

async function encenar(cena) {
  const documento = new Documento(cena.ambiente || {});
  const diario = documento.diario;
  const contexto = criarContexto(documento, diario, cena.responder || (() => ({ success: true })));
  const antes = global.document;
  global.document = documento;
  const relogios = relogiosFalsos();
  esquecerModulosDoInapp();
  try {
    const { attach } = require(CAMINHO_DO_INAPP);
    const resultado = await cena.roteiro(Object.assign(contexto, { attach, intervalosAtivos: () => relogios.contagem.intervalosAtivos }));
    return { resultado: resultado === undefined ? null : resultado, diario: [...diario], intervalosAtivos: relogios.contagem.intervalosAtivos };
  } finally {
    relogios.restaurar();
    global.document = antes;
    esquecerModulosDoInapp();
  }
}

module.exports = { encenar };
