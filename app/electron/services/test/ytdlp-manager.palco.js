'use strict';
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');
const util = require('util');
const { EventEmitter } = require('events');

const toolPaths = require('../tool-paths');
const carregadorOriginal = Module._load;
const CONSOLE_PARA_SAIDA = { log: 'saida', info: 'saida', warn: 'erro', error: 'erro' };
const CAMINHO_COM_SEPARADOR_DO_WINDOWS = /<tmp>(?:\\{1,2}[^\\'"\n]*)+/g;

class ProcessoFalso extends EventEmitter {
  constructor(registrar, killFalha) {
    super();
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
    this.registrar = registrar;
    this.killFalha = killFalha;
  }

  kill() {
    this.registrar('kill');
    if (this.killFalha) throw new Error('kill falhou');
  }

  escrever(texto) { this.stdout.emit('data', Buffer.from(texto)); }
  escreverErro(texto) { this.stderr.emit('data', Buffer.from(texto)); }
  fechar(codigo) { this.emit('close', codigo); }
  falhar(mensagem) { this.emit('error', new Error(mensagem)); }
}

function semPilha(argumento) {
  return argumento instanceof Error ? `«${argumento.name}: ${argumento.message}»` : argumento;
}

function formasDaRaiz(raiz) {
  return [...new Set([JSON.stringify(raiz).slice(1, -1), raiz])];
}

function caminhoEmPosix(caminho) {
  return caminho.replace(/\//g, '«/»').replace(/\\{1,2}/g, '/').replace(/\.exe\b/gi, '');
}

function caminhosEmPosix(linha) {
  return path.sep === '\\' ? linha.replace(CAMINHO_COM_SEPARADOR_DO_WINDOWS, caminhoEmPosix) : linha;
}

function serializar(valor) {
  return JSON.stringify(valor, (_chave, v) => (v === undefined ? '«undefined»' : v));
}

class Palco {
  constructor() {
    this.raiz = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlp-palco-')));
    this.registro = [];
    this.processos = [];
    this.timers = [];
    this.resultados = {};
    this.killFalha = false;
    this.janela = this.criarJanela();
    this.zap = { sendReply: (chat, mensagem) => this.anotar(`zap ${chat} ${mensagem}`) };
    this.app = { getAppPath: () => this.caminho('app'), whatsappManager: this.zap };
  }

  caminho(...partes) { return path.join(this.raiz, ...partes); }

  anotar(linha) {
    const comRaizOculta = formasDaRaiz(this.raiz).reduce((texto, raiz) => texto.split(raiz).join('<tmp>'), linha);
    this.registro.push(caminhosEmPosix(comRaizOculta).replace(/\[\d{2}:\d{2}:\d{2}\] DOWNLOADER/, '[hora] DOWNLOADER'));
  }

  criarJanela() {
    return {
      destruida: false,
      falhaNoEnvio: false,
      isDestroyed() { return this.destruida; },
      webContents: { send: (canal, dados) => this.enviarParaTela(canal, dados) },
    };
  }

  enviarParaTela(canal, dados) {
    if (this.janela.falhaNoEnvio) throw new Error('janela fechada');
    this.anotar(`tela ${canal} ${serializar(dados)}`);
  }

  spawn(comando, argumentos) {
    this.anotar(`spawn ${comando} ${serializar(argumentos)}`);
    const processo = new ProcessoFalso(linha => this.anotar(linha), this.killFalha);
    this.processos.push(processo);
    return processo;
  }

  async buscar(consulta) {
    this.anotar(`busca ${consulta}`);
    const resultado = this.resultados[consulta];
    if (resultado instanceof Error) throw resultado;
    return resultado;
  }

  processo() { return this.processos[this.processos.length - 1]; }

  criarArquivo(...partes) {
    const arquivo = this.caminho(...partes);
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    fs.writeFileSync(arquivo, '');
    return arquivo;
  }

  rodarTimers() {
    const pendentes = this.timers.splice(0);
    for (const { funcao, ms } of pendentes) {
      this.anotar(`timer ${ms}`);
      funcao();
    }
  }

  carregar(caminhoDoModulo) {
    const falsos = {
      child_process: { spawn: (c, a) => this.spawn(c, a) },
      'yt-search': consulta => this.buscar(consulta),
      os: { ...os, homedir: () => this.caminho('casa') },
      './tool-paths': toolPaths,
    };
    Module._load = function (pedido, ...resto) {
      return falsos[pedido] || carregadorOriginal.call(this, pedido, ...resto);
    };
    try {
      const resolvido = require.resolve(caminhoDoModulo);
      delete require.cache[resolvido];
      return require(resolvido);
    } finally {
      Module._load = carregadorOriginal;
    }
  }

  async encenar(caminhoDoModulo, cena) {
    const YtDlpManager = this.carregar(caminhoDoModulo);
    const restaurar = this.capturarAmbiente();
    try {
      this.manager = new YtDlpManager(this.janela, this.app);
      await cena(this);
    } finally {
      restaurar();
      fs.rmSync(this.raiz, { recursive: true, force: true });
    }
    return this.registro;
  }

  capturarAmbiente() {
    const original = { console: { ...console }, setTimeout: global.setTimeout, recursos: process.resourcesPath, cwd: process.cwd() };
    for (const [metodo, tipo] of Object.entries(CONSOLE_PARA_SAIDA)) {
      console[metodo] = (...args) => this.anotar(`${tipo} ${util.format(...args.map(semPilha))}`);
    }
    global.setTimeout = (funcao, ms) => this.timers.push({ funcao, ms });
    process.resourcesPath = this.caminho('recursos');
    fs.mkdirSync(this.caminho('cwd'), { recursive: true });
    process.chdir(this.caminho('cwd'));
    return () => {
      Object.assign(console, original.console);
      global.setTimeout = original.setTimeout;
      process.resourcesPath = original.recursos;
      process.chdir(original.cwd);
    };
  }
}

function encenar(caminhoDoModulo, cena) {
  return new Palco().encenar(caminhoDoModulo, cena);
}

module.exports = { encenar };
