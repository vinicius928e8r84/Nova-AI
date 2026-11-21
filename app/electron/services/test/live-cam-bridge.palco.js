'use strict';

const Module = require('module');
const path = require('path');
const util = require('util');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const LIMITE_DE_TEXTO = 400;
const AGORA = 1700000000000;

const resumoDoTexto = texto => 'sha256:' + crypto.createHash('sha256').update(texto).digest('hex') + ':' + texto.length;

function criarDiario(raizDoApp, completo) {
  const entradas = [];
  const limpar = valor => {
    if (typeof valor !== 'string') return valor;
    const texto = valor.split(raizDoApp).join('<app>');
    const longo = texto.length > LIMITE_DE_TEXTO;
    return longo && !completo ? resumoDoTexto(texto) : texto;
  };
  const normalizar = valor => JSON.parse(JSON.stringify(valor === undefined ? null : valor, (_, v) => limpar(v)));
  return {
    entradas,
    anotar: (...entrada) => entradas.push(normalizar(entrada)),
  };
}

class ServidorFalso extends EventEmitter {
  constructor(palco, tipo, argumentos) {
    super();
    this.palco = palco;
    this.tipo = tipo;
    this.handler = argumentos[argumentos.length - 1];
    palco.anotar(tipo + '.createServer', argumentos.length > 1 ? argumentos[0] : 'sem-opcoes');
    palco.servidores.push(this);
  }

  listen(porta, host, aoEscutar) {
    this.palco.anotar(this.tipo + '.listen', porta, host);
    const falhar = this.palco.cenario.falhaAoEscutar === this.tipo;
    setImmediate(() => (falhar ? this.emit('error', new Error('EADDRINUSE')) : aoEscutar && aoEscutar()));
    return this;
  }

  close(aoFechar) {
    this.palco.anotar(this.tipo + '.close');
    if (aoFechar) setImmediate(aoFechar);
  }
}

class ClienteFalso extends EventEmitter {
  constructor(palco, nome, readyState = 1) {
    super();
    this.palco = palco;
    this.nome = nome;
    this.readyState = readyState;
    this.falharNoEnvio = false;
  }

  on(evento, ouvinte) {
    this.palco.anotar('ws.on', this.nome, evento);
    return super.on(evento, ouvinte);
  }

  send(dado) {
    this.palco.anotar('ws.send', this.nome, dado);
    if (this.falharNoEnvio) throw new Error('envio falhou');
  }

  terminate() {
    this.palco.anotar('ws.terminate', this.nome);
  }
}

function criarWs(palco) {
  class ServidorWs extends EventEmitter {
    constructor(opcoes) {
      super();
      palco.anotar('wss.new', opcoes.server.tipo);
      this.clients = new Set();
      palco.wss = this;
    }

    close() {
      palco.anotar('wss.close');
    }
  }
  const WebSocket = function WebSocket() {};
  WebSocket.Server = ServidorWs;
  WebSocket.OPEN = 1;
  return WebSocket;
}

function criarSelfsigned(palco) {
  const modo = palco.cenario.selfsigned;
  if (modo === 'ausente') throw new Error("Cannot find module 'selfsigned'");
  const resultados = { falha: null, 'sem-cert': { private: 'CHAVE' }, vazio: undefined };
  return {
    generate: async (atributos, opcoes) => {
      palco.anotar('selfsigned.generate', atributos, opcoes);
      if (modo === 'falha') throw new Error('sem openssl');
      return modo in resultados ? resultados[modo] : { private: 'CHAVE', cert: 'CERT' };
    },
  };
}

function criarFs(palco) {
  const existe = caminho => palco.existentes.has(caminho);
  return {
    existsSync: caminho => {
      palco.anotar('fs.existsSync', caminho);
      return existe(caminho);
    },
    statSync: caminho => {
      palco.anotar('fs.statSync', caminho);
      if (palco.cenario.falhaNoStat) throw new Error('EACCES');
      return { size: palco.cenario.tamanho ?? 1000 };
    },
    createReadStream: (caminho, opcoes) => {
      palco.anotar('fs.createReadStream', caminho, opcoes ?? 'sem-opcoes');
      return { pipe: destino => palco.anotar('stream.pipe', destino.nome) };
    },
  };
}

function criarChildProcess(palco) {
  return {
    spawn: (comando, argumentos, opcoes) => {
      palco.anotar('spawn', comando, argumentos, opcoes);
      const processo = new EventEmitter();
      processo.kill = () => {
        palco.anotar('proc.kill');
        if (palco.cenario.falhaAoMatar) throw new Error('ESRCH');
      };
      palco.processos.push(processo);
      return processo;
    },
    exec: () => palco.anotar('exec'),
  };
}

function criarQrcode(palco) {
  return {
    toDataURL: async (texto, opcoes) => {
      if (palco.cenario.falhaNoQr) throw new Error('qr quebrou');
      return 'qr[' + opcoes.color.dark + ',' + opcoes.width + ',' + opcoes.margin + ',' + opcoes.color.light + ']' + texto;
    },
  };
}

function criarDubles(palco) {
  return {
    http: { createServer: (...argumentos) => new ServidorFalso(palco, 'http', argumentos) },
    https: { createServer: (...argumentos) => new ServidorFalso(palco, 'https', argumentos) },
    os: { networkInterfaces: () => palco.cenario.interfaces ?? {} },
    child_process: () => criarChildProcess(palco),
    fs: () => criarFs(palco),
    ws: () => criarWs(palco),
    qrcode: () => criarQrcode(palco),
    selfsigned: () => criarSelfsigned(palco),
  };
}

function trocarConsole(palco) {
  const original = { log: console.log, info: console.info, warn: console.warn, error: console.error };
  const legivel = valor => (valor instanceof Error ? 'Error: ' + valor.message : valor);
  const gravar = canal => (...argumentos) => palco.anotar(canal, util.format(...argumentos.map(legivel)));
  Object.assign(console, { log: gravar('stdout'), info: gravar('stdout'), warn: gravar('warn'), error: gravar('error') });
  return () => Object.assign(console, original);
}

function trocarAmbiente(palco) {
  const plataforma = Object.getOwnPropertyDescriptor(process, 'platform');
  const agora = Date.now;
  Object.defineProperty(process, 'platform', { value: palco.cenario.plataforma ?? 'darwin', configurable: true });
  Date.now = () => AGORA;
  const voltarConsole = trocarConsole(palco);
  return () => {
    Object.defineProperty(process, 'platform', plataforma);
    Date.now = agora;
    voltarConsole();
  };
}

function carregarModulo(palco, caminhoDoModulo) {
  const dubles = criarDubles(palco);
  const carregarOriginal = Module._load;
  Module._load = function carregar(pedido, pai, ...resto) {
    const doAlvo = pai && pai.filename === caminhoDoModulo;
    const duble = doAlvo ? dubles[pedido] : undefined;
    if (duble === undefined) return carregarOriginal.call(this, pedido, pai, ...resto);
    return typeof duble === 'function' ? duble() : duble;
  };
  try {
    delete require.cache[caminhoDoModulo];
    return require(caminhoDoModulo);
  } finally {
    Module._load = carregarOriginal;
  }
}

function criarJanela(palco) {
  return {
    isDestroyed: () => Boolean(palco.cenario.janelaDestruida),
    webContents: { send: (canal, dado) => palco.anotar('janela', canal, dado) },
  };
}

function criarResposta(palco, nome = 'res') {
  return {
    nome,
    setHeader: (chave, valor) => palco.anotar(nome + '.setHeader', chave, valor),
    writeHead: (codigo, cabecalhos) => palco.anotar(nome + '.writeHead', codigo, cabecalhos),
    end: texto => {
      palco.anotar(nome + '.end', texto ?? 'sem-corpo');
      return 'retorno-do-end';
    },
  };
}

function montarPalco(caminhoDoModulo, cenario = {}, { completo = false } = {}) {
  const raizDoApp = path.resolve(path.dirname(caminhoDoModulo), '../..');
  const diario = criarDiario(raizDoApp, completo);
  const palco = { cenario, servidores: [], processos: [], wss: null, anotar: diario.anotar, raizDoApp };
  palco.existentes = new Set((cenario.existentes ?? []).map(caminho => caminho.split('<app>').join(raizDoApp)));
  const restaurar = trocarAmbiente(palco);
  try {
    palco.LiveCamBridgeService = carregarModulo(palco, caminhoDoModulo);
  } catch (erro) {
    restaurar();
    throw erro;
  }
  palco.restaurar = restaurar;
  palco.diario = diario.entradas;
  palco.janela = criarJanela(palco);
  palco.cliente = (nome, readyState) => new ClienteFalso(palco, nome, readyState);
  palco.resposta = nome => criarResposta(palco, nome);
  palco.servico = (servicoDoCelular = null) => new palco.LiveCamBridgeService(palco.janela, { nome: 'app' }, servicoDoCelular);
  return palco;
}

async function rodarCena(caminhoDoModulo, cena, opcoes) {
  const palco = montarPalco(caminhoDoModulo, cena.cenario ?? {}, opcoes);
  try {
    await cena.rodar(palco);
  } catch (erro) {
    palco.anotar('erro', erro.message);
  } finally {
    palco.restaurar();
  }
  return palco.diario;
}

module.exports = { montarPalco, rodarCena, AGORA };
