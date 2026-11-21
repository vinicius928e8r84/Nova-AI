'use strict';
const crypto = require('crypto');
const fs = require('fs');
const vm = require('vm');

const TEXTO_LONGO = 120;
const VAZIOS = new Set(['input']);

function resumir(valor) {
  if (typeof valor !== 'string' || valor.length <= TEXTO_LONGO) return valor;
  return `sha256:${crypto.createHash('sha256').update(valor).digest('hex').slice(0, 16)} (${valor.length} caracteres)`;
}

function lerAtributos(texto) {
  const atributos = {};
  for (const [, nome, valor] of texto.matchAll(/([\w-]+)(?:="([^"]*)")?/g)) atributos[nome] = valor === undefined ? '' : valor;
  return atributos;
}

function casaSimples(elemento, simples) {
  if (simples.startsWith('#')) return elemento.id === simples.slice(1);
  return simples.split('.').filter(Boolean).every(classe => elemento.classes().includes(classe));
}

function casaSeletor(elemento, partes) {
  if (!casaSimples(elemento, partes[partes.length - 1])) return false;
  if (partes.length === 1) return true;
  for (let acima = elemento.pai; acima; acima = acima.pai) if (casaSimples(acima, partes[partes.length - 2])) return true;
  return false;
}

class ElementoFalso {
  constructor(palco, tag, atributos = {}) {
    this.palco = palco;
    this.tag = tag;
    this.atributos = { ...atributos };
    this.filhos = [];
    this.pai = null;
    this.ouvintes = [];
    this.estado = { hidden: 'hidden' in atributos, disabled: false, value: '', className: atributos.class || '', id: atributos.id || '' };
    this.texto = null;
  }

  classes() {
    return this.estado.className.split(/\s+/).filter(Boolean);
  }

  rotulo() {
    return `${this.tag}${this.classes().map(classe => `.${classe}`).join('')}${this.estado.id ? `#${this.estado.id}` : ''}`;
  }

  anotar(...itens) {
    this.palco.registro.push(itens);
  }

  descendentes() {
    return this.filhos.flatMap(filho => (typeof filho === 'string' ? [] : [filho, ...filho.descendentes()]));
  }

  querySelector(seletor) {
    const partes = seletor.trim().split(/\s+/);
    return this.descendentes().find(elemento => casaSeletor(elemento, partes)) || null;
  }

  setAttribute(nome, valor) {
    this.anotar('setAttribute', this.rotulo(), nome, valor);
    this.atributos[nome] = valor;
  }

  addEventListener(tipo, ouvinte, captura) {
    this.anotar('addEventListener', this.rotulo(), tipo, captura === undefined ? '(sem captura)' : captura);
    this.ouvintes.push({ tipo, ouvinte, captura });
  }

  removeEventListener(tipo, ouvinte, captura) {
    const antes = this.ouvintes.length;
    this.ouvintes = this.ouvintes.filter(item => !(item.tipo === tipo && item.ouvinte === ouvinte && item.captura === captura));
    this.anotar('removeEventListener', this.rotulo(), tipo, captura, antes - this.ouvintes.length);
  }

  disparar(tipo, evento) {
    return this.ouvintes.filter(item => item.tipo === tipo).map(item => item.ouvinte(evento));
  }

  appendChild(filho) {
    this.anotar('appendChild', this.rotulo(), filho.rotulo());
    filho.pai = this;
    this.filhos.push(filho);
  }

  remove() {
    this.anotar('remove', this.rotulo());
    if (this.pai) this.pai.filhos = this.pai.filhos.filter(filho => filho !== this);
    this.pai = null;
  }

  focus() {
    this.anotar('focus', this.rotulo());
  }

  select() {
    this.anotar('select', this.rotulo());
  }

  set innerHTML(html) {
    this.anotar('innerHTML', this.rotulo(), resumir(html));
    this.filhos = [];
    const pilha = [this];
    for (const [, fecha, tag, atributos, texto] of html.matchAll(/<(\/?)([a-zA-Z0-9-]+)([^>]*)>|([^<]+)/g)) {
      const atual = pilha[pilha.length - 1];
      if (texto !== undefined) {
        if (texto.trim()) atual.filhos.push(texto.trim());
      } else if (fecha) {
        pilha.pop();
      } else {
        const elemento = new ElementoFalso(this.palco, tag, lerAtributos(atributos));
        elemento.pai = atual;
        atual.filhos.push(elemento);
        if (!VAZIOS.has(tag)) pilha.push(elemento);
      }
    }
  }

  get textContent() {
    if (this.texto !== null) return this.texto;
    return this.filhos.map(filho => (typeof filho === 'string' ? filho : filho.textContent)).join('');
  }

  set textContent(valor) {
    this.anotar('set', this.rotulo(), 'textContent', resumir(valor));
    this.texto = valor;
  }
}

for (const propriedade of ['hidden', 'disabled', 'value', 'className', 'id']) {
  Object.defineProperty(ElementoFalso.prototype, propriedade, {
    get() {
      return this.estado[propriedade];
    },
    set(valor) {
      this.anotar('set', this.rotulo(), propriedade, valor);
      this.estado[propriedade] = valor;
    },
  });
}

class FocoAnterior {
  constructor(palco, comportamento) {
    this.palco = palco;
    this.comportamento = comportamento;
    if (comportamento === 'sem-focus') this.focus = null;
  }

  focus() {
    this.palco.registro.push(['focus', 'anterior']);
    if (this.comportamento === 'lanca') throw new Error('foco falhou');
  }
}

class DocumentoFalso extends ElementoFalso {
  constructor(palco, opcoes) {
    super(palco, '#document');
    this.opcoes = opcoes;
    this.head = opcoes.semHead ? null : new ElementoFalso(palco, 'head');
    this.documentElement = new ElementoFalso(palco, 'html');
    this.body = new ElementoFalso(palco, 'body');
    this.activeElement = opcoes.focoAnterior ? new FocoAnterior(palco, opcoes.focoAnterior) : null;
    this.webviews = [];
  }

  getElementById(id) {
    const raizes = [this.head, this.documentElement, this.body].filter(Boolean);
    return raizes.flatMap(raiz => raiz.descendentes()).find(elemento => elemento.id === id) || null;
  }

  createElement(tag) {
    this.anotar('createElement', tag);
    if (tag !== 'webview') return new ElementoFalso(this.palco, tag);
    const modo = this.opcoes.webview.shift() || 'normal';
    if (modo === 'lanca') throw new Error('webview desligado');
    if (modo === 'nulo') return null;
    const view = new ElementoFalso(this.palco, 'webview');
    this.webviews.push(view);
    return view;
  }
}

class RelogioFalso {
  constructor(palco) {
    this.palco = palco;
    this.agora = 1000;
    this.proximoId = 0;
    this.timers = new Map();
  }

  agendar(tipo, funcao, atraso) {
    this.proximoId += 1;
    this.timers.set(this.proximoId, { tipo, funcao, atraso, quando: this.agora + atraso });
    this.palco.registro.push([tipo, atraso, this.proximoId]);
    return this.proximoId;
  }

  cancelar(id) {
    this.palco.registro.push(['clearInterval', id]);
    this.timers.delete(id);
  }

  saltar(ms) {
    this.agora += ms;
    for (const timer of this.timers.values()) timer.quando += ms;
  }

  avancar(ms) {
    const fim = this.agora + ms;
    for (;;) {
      const vencidos = [...this.timers].filter(([, timer]) => timer.quando <= fim).sort(([a, x], [b, y]) => x.quando - y.quando || a - b);
      if (!vencidos.length) break;
      const [id, timer] = vencidos[0];
      this.agora = timer.quando;
      if (timer.tipo === 'setInterval') timer.quando += timer.atraso;
      else this.timers.delete(id);
      timer.funcao();
    }
    this.agora = fim;
  }
}

function criarInvoke(palco) {
  palco.pendentes = [];
  return (canal, ...args) => {
    palco.registro.push(['invoke', canal, ...JSON.parse(JSON.stringify(args))]);
    return new Promise((resolve, reject) => palco.pendentes.push({ canal, resolve, reject }));
  };
}

function responder(palco, canal, resposta) {
  const indice = palco.pendentes.findIndex(pendente => pendente.canal === canal);
  if (indice < 0) throw new Error(`nenhum invoke pendente em ${canal}`);
  const [pendente] = palco.pendentes.splice(indice, 1);
  if ('lanca' in resposta) pendente.reject(resposta.lanca === null ? null : new Error(resposta.lanca));
  else pendente.resolve(resposta.valor);
}

function eventoFalso(palco, dados = {}) {
  return {
    ...dados,
    preventDefault: () => palco.registro.push(['preventDefault']),
    stopPropagation: () => palco.registro.push(['stopPropagation']),
  };
}

function achar(palco, rotulo) {
  const todos = palco.documento.body.descendentes();
  const achado = todos.find(elemento => elemento.rotulo() === rotulo);
  if (!achado) throw new Error(`não achei ${rotulo}`);
  return achado;
}

const ACOES = {
  abrir: (palco, payload) => palco.ponte.open(payload),
  ipc: (palco, canal, payload) => palco.ouvintesIpc[canal]({}, payload),
  clicar: (palco, rotulo) => achar(palco, rotulo).disparar('click', eventoFalso(palco)),
  enviar: palco => achar(palco, 'form.nvios-form').disparar('submit', eventoFalso(palco)),
  digitar: (palco, valor) => { achar(palco, 'input.nvios-input#nvios-pass').value = valor; },
  tecla: (palco, key) => palco.documento.disparar('keydown', eventoFalso(palco, { key })),
  mousedown: (palco, alvo) => {
    const host = palco.hosts[palco.hosts.length - 1];
    host.disparar('mousedown', eventoFalso(palco, { target: alvo === 'host' ? host : {} }));
  },
  responder: (palco, canal, resposta) => responder(palco, canal, resposta),
  avancar: (palco, ms) => palco.relogio.avancar(ms),
  saltar: (palco, ms) => palco.relogio.saltar(ms),
  webview: (palco, tipo) => palco.documento.webviews[palco.documento.webviews.length - 1].disparar(tipo, {}),
  estado: palco => palco.registro.push(['estado', palco.documento.body.descendentes().filter(mudouDoMarkup).map(retratoDoElemento)]),
};

function mudouDoMarkup(elemento) {
  const { hidden, disabled, value } = elemento.estado;
  const nasceuOculto = 'hidden' in elemento.atributos;
  return [hidden !== nasceuOculto, disabled, value !== '', elemento.texto !== null].some(Boolean);
}

function retratoDoElemento(elemento) {
  const { hidden, disabled, value } = elemento.estado;
  const marcas = [hidden ? 'oculto' : 'visível', disabled ? 'desligado' : '', value ? `valor=${value}` : ''].filter(Boolean).join(',');
  const texto = elemento.texto === null ? '' : ` "${resumir(elemento.texto)}"`;
  return `${elemento.rotulo()}${marcas ? ` [${marcas}]` : ''}${texto}`;
}

const esvaziarFila = () => new Promise(resolve => setImmediate(resolve));

async function encenar(modulo, cena) {
  const palco = { registro: [], ouvintesIpc: {}, hosts: [] };
  palco.relogio = new RelogioFalso(palco);
  palco.documento = new DocumentoFalso(palco, { webview: [...(cena.webview || [])], semHead: cena.semHead, focoAnterior: cena.focoAnterior });
  const criarDoDocumento = palco.documento.createElement.bind(palco.documento);
  palco.documento.createElement = tag => {
    const elemento = criarDoDocumento(tag);
    if (tag === 'div') palco.hosts.push(elemento);
    return elemento;
  };
  const contexto = {
    module: { exports: {} },
    document: palco.documento,
    setTimeout: (funcao, atraso) => palco.relogio.agendar('setTimeout', funcao, atraso),
    setInterval: (funcao, atraso) => palco.relogio.agendar('setInterval', funcao, atraso),
    clearInterval: id => palco.relogio.cancelar(id),
    Date: { now: () => palco.relogio.agora },
  };
  vm.createContext(contexto);
  vm.runInContext(`(function (module, exports) {${fs.readFileSync(modulo, 'utf8')}\n})(module, module.exports);`, contexto, { filename: modulo });
  const invoke = criarInvoke(palco);
  const ipcRenderer = {
    on: (canal, ouvinte) => {
      palco.registro.push(['ipcRenderer.on', canal]);
      palco.ouvintesIpc[canal] = ouvinte;
    },
    invoke: (canal, ...args) => {
      palco.registro.push(['ipcRenderer.invoke']);
      return invoke(canal, ...args);
    },
  };
  palco.ponte = contexto.module.exports.attach(cena.semInvoke ? { ipcRenderer } : { ipcRenderer, invoke });
  for (const [acao, ...args] of cena.passos) {
    palco.registro.push(['>', acao, ...args]);
    ACOES[acao](palco, ...args);
    await esvaziarFila();
  }
  return JSON.parse(JSON.stringify(palco.registro));
}

module.exports = { encenar };
