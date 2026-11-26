'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CAMINHO_DO_APP = path.join(__dirname, '..', 'electron', 'pwa', 'app.js');
const AGORA = 1700000000000;
const IDS = ['message-input', 'model-select', 'token-input', 'ai-thinking', 'active-model-name', 'messages', 'mic-btn', 'connect-btn',
  'disconnect-btn', 'send-btn', 'auth-error', 'connection-status', 'auth-screen', 'chat-screen'];

function formatar(valor) {
  if (Object.prototype.toString.call(valor) === '[object Error]') return `${valor.name}: ${valor.message}`;
  if (typeof valor === 'function') return '[função]';
  if (typeof valor === 'string') return valor;
  return JSON.stringify(valor);
}

const escapar = texto => String(texto).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

class ElementoDoPalco {
  constructor(palco, nome, inicial) {
    this.palco = palco;
    this.nome = nome;
    this.estado = { ...inicial };
    this.ouvintes = {};
    this.filhos = {};
    this.style = new Proxy({}, { set: (alvo, prop, valor) => { palco.anotar(`${nome}.style.${prop} =`, valor); alvo[prop] = valor; return true; } });
    this.classList = { add: classe => palco.anotar(`${nome}.classList.add`, classe), remove: classe => palco.anotar(`${nome}.classList.remove`, classe) };
  }

  addEventListener(tipo, ouvinte) {
    this.palco.anotar(`${this.nome}.on`, tipo);
    this.ouvintes[tipo] = [...(this.ouvintes[tipo] || []), ouvinte];
  }

  querySelector(seletor) { return this.filhos[seletor] || null; }

  remove() { this.palco.anotar(`${this.nome}.remove()`); }

  focus() { this.palco.anotar(`${this.nome}.focus()`); }

  appendChild(filho) { this.palco.anotar(`${this.nome}.appendChild`, filho.className, filho.innerHTML); }
}

const PROPRIAS = new Set(['addEventListener', 'querySelector', 'remove', 'focus', 'appendChild', 'style', 'classList']);

function lerDoElemento(elemento, prop) {
  if (PROPRIAS.has(prop)) return typeof elemento[prop] === 'function' ? elemento[prop].bind(elemento) : elemento[prop];
  if (prop === 'innerHTML' && elemento.estado.innerHTML === undefined) return escapar(elemento.estado.textContent ?? '');
  return elemento.estado[prop];
}

function criarElemento(palco, nome, inicial = {}) {
  const elemento = new ElementoDoPalco(palco, nome, inicial);
  const proxy = new Proxy(elemento, {
    get: (alvo, prop) => lerDoElemento(alvo, prop),
    set: (alvo, prop, valor) => { palco.anotar(`${nome}.${String(prop)} =`, valor); alvo.estado[prop] = valor; return true; },
  });
  palco.porNome.set(nome, elemento);
  return proxy;
}

class SocketDoPalco {
  constructor(palco, conectado) {
    this.palco = palco;
    this.connected = conectado;
    this.ouvintes = [];
  }

  on(evento, ouvinte) { this.palco.anotar('socket.on', evento); this.ouvintes.push([evento, ouvinte]); }

  emit(evento, dados) { this.palco.anotar('socket.emit', evento, dados); }

  disconnect() { this.palco.anotar('socket.disconnect()'); }

  disparar(evento, dados) {
    for (const [, ouvinte] of this.ouvintes.filter(([nome]) => nome === evento)) this.palco.chamar(ouvinte, dados);
  }
}

class Palco {
  constructor(cena) {
    this.cena = cena;
    this.diario = [];
    this.timers = [];
    this.proximoTimer = 1;
    this.porNome = new Map();
    this.sockets = [];
    this.criados = 0;
    this.elementos = this.montarElementos();
  }

  anotar(...partes) { this.diario.push(partes.map(formatar).join(' ')); }

  montarElementos() {
    const elementos = {};
    for (const id of IDS.filter(id => !(this.cena.sem || []).includes(id))) elementos[id] = criarElemento(this, id, this.estadoInicial(id));
    const botao = this.porNome.get('connect-btn');
    if (botao && !this.cena.botaoSemFilhos) {
      botao.filhos['.btn-text'] = criarElemento(this, 'btn-text');
      botao.filhos['.btn-loader'] = criarElemento(this, 'btn-loader');
    }
    const mensagens = this.porNome.get('messages');
    if (mensagens) mensagens.filhos['.centered-hint'] = criarElemento(this, 'centered-hint');
    return elementos;
  }

  estadoInicial(id) {
    const iniciais = {
      'message-input': { value: '', scrollHeight: 400 },
      'model-select': { options: [{ text: 'Modelo Gemini Pro' }, { text: 'Modelo GPT-4o' }], selectedIndex: 0, value: 'gemini' },
      'token-input': { value: this.cena.tokenDigitado ?? '' },
    };
    return iniciais[id] || {};
  }

  setTimeout(funcao, espera) {
    const id = this.proximoTimer++;
    this.anotar('setTimeout', espera);
    this.timers.push({ id, funcao, espera });
    return id;
  }

  clearTimeout(id) {
    this.anotar('clearTimeout', id);
    this.timers = this.timers.filter(timer => timer.id !== id);
  }

  async avancar(ate = Infinity) {
    for (let volta = 0; volta < 20; volta++) {
      const pendentes = this.timers.filter(timer => timer.espera <= ate).sort((a, b) => a.espera - b.espera);
      if (!pendentes.length) return;
      this.timers = this.timers.filter(timer => !pendentes.includes(timer));
      for (const { funcao, espera } of pendentes) { this.anotar('timer', espera); funcao(); }
      await this.esperar();
    }
  }

  async esperar() {
    for (let volta = 0; volta < 10; volta++) await new Promise(pronto => setImmediate(pronto));
  }

  chamar(ouvinte, dados) {
    try {
      ouvinte(dados);
    } catch (erro) {
      this.anotar('lançou', erro);
    }
  }

  disparar(nome, tipo, evento = {}) {
    for (const ouvinte of this.porNome.get(nome).ouvintes[tipo] || []) this.chamar(ouvinte, evento);
  }

  tecla(nome, key, shiftKey = false) {
    this.disparar(nome, 'keypress', { key, shiftKey, preventDefault: () => this.anotar('preventDefault()') });
  }

  socket(evento, dados) { this.sockets[this.sockets.length - 1].disparar(evento, dados); }

  ajustar(nome, mudancas) { Object.assign(this.porNome.get(nome).estado, mudancas); }

  io(url, opcoes) {
    this.anotar('io', url, opcoes);
    if (this.cena.ioFalha) throw new Error(this.cena.ioFalha);
    const socket = new SocketDoPalco(this, this.cena.socketConectado !== false);
    this.sockets.push(socket);
    return socket;
  }

  documento() {
    return {
      readyState: this.cena.carregando ? 'loading' : 'complete',
      getElementById: id => this.elementos[id] || null,
      querySelectorAll: seletor => (seletor === '.screen' ? ['auth-screen', 'chat-screen'].map(id => this.elementos[id]).filter(Boolean) : []),
      createElement: tag => criarElemento(this, `novo-${tag}-${++this.criados}`),
      addEventListener: (tipo, ouvinte) => { this.anotar('document.on', tipo); this.domPronto = ouvinte; },
    };
  }

  dispositivosDeMidia() {
    if (this.cena.semMicrofone) return undefined;
    if (this.cena.semGetUserMedia) return {};
    return { getUserMedia: async pedido => this.pedirMicrofone(pedido) };
  }

  navegador() {
    return {
      mediaDevices: this.dispositivosDeMidia(),
      serviceWorker: { register: async url => { this.anotar('serviceWorker.register', url); if (this.cena.swFalha) throw new Error('sem sw'); } },
    };
  }

  async pedirMicrofone(pedido) {
    this.anotar('getUserMedia', pedido);
    if (this.cena.microfoneNegado) throw new Error('NotAllowedError');
    return { nome: 'stream', getTracks: () => [{ stop: () => this.anotar('track.stop()') }] };
  }

  async buscar(url, opcoes) {
    this.anotar('fetch', url, { method: opcoes.method, headers: opcoes.headers, body: opcoes.body.partes });
    if (this.cena.groqFalha) throw new Error('rede caiu');
    return { json: async () => this.cena.respostaDoGroq || {} };
  }

  contexto() {
    const palco = this;
    class MediaRecorder {
      constructor(stream) { palco.anotar('new MediaRecorder', stream.nome); this.state = 'inactive'; palco.gravador = this; }
      start() { palco.anotar('recorder.start()'); this.state = 'recording'; }
      stop() { palco.anotar('recorder.stop()'); this.state = 'inactive'; }
    }
    class FormData {
      constructor() { this.partes = []; }
      append(...parte) { this.partes.push(parte.map(item => (item && item.partes ? `Blob(${item.type}: ${item.partes.join('+')})` : item))); }
    }
    class Blob {
      constructor(partes, opcoes) { this.partes = partes.map(parte => parte.nome); this.type = opcoes.type; }
    }
    class Data extends Date {
      static now() { return AGORA; }
    }
    return this.contextoBase({ MediaRecorder, FormData, Blob, Date: Data });
  }

  contextoBase(classes) {
    const registrar = rotulo => (...partes) => this.anotar(rotulo, ...partes);
    const contexto = {
      ...classes,
      URLSearchParams,
      console: { log: registrar('console.log'), error: registrar('console.error') },
      document: this.documento(),
      navigator: this.navegador(),
      localStorage: { getItem: chave => this.cena.salvo ?? null, setItem: registrar('localStorage.setItem') },
      location: { search: this.cena.busca || '', origin: 'https://nova.exemplo.com' },
      alert: registrar('alert'),
      fetch: (url, opcoes) => this.buscar(url, opcoes),
      io: (url, opcoes) => this.io(url, opcoes),
      setTimeout: (funcao, espera) => this.setTimeout(funcao, espera),
      clearTimeout: id => this.clearTimeout(id),
    };
    if (this.cena.marked) contexto.marked = this.cena.marked;
    contexto.window = contexto;
    return contexto;
  }
}

async function encenar(cena) {
  const palco = new Palco(cena);
  const contexto = vm.createContext(palco.contexto());
  vm.runInContext(fs.readFileSync(CAMINHO_DO_APP, 'utf8'), contexto, { filename: CAMINHO_DO_APP });
  await palco.esperar();
  if (palco.domPronto) palco.domPronto();
  palco.app = contexto.window.app;
  await cena.acao(palco);
  await palco.esperar();
  return palco.diario;
}

module.exports = { encenar };
