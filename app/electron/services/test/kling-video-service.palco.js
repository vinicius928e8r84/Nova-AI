'use strict';
const Module = require('module');
const os = require('os');
const path = require('path');
const util = require('util');
const { EventEmitter } = require('events');

const toolPaths = require('../tool-paths');

const carregadorOriginal = Module._load;
const setImmediateReal = setImmediate;
const setTimeoutReal = setTimeout;
const dateNowReal = Date.now;
const cwdReal = process.cwd;
const INSTANTE = 1700000000000;
const NIVEIS_DO_CONSOLE = { log: 'saida', info: 'saida', warn: 'erro', error: 'erro' };

function comBarra(caminho) {
  return String(caminho).replace(/\\/g, '/');
}

const caminhosComBarra = {
  ...path.posix,
  join: (...partes) => path.posix.join(...partes.map(comBarra)),
};

const ferramentasDoMac = {
  ...toolPaths,
  exe: nome => toolPaths.exe(nome, { platform: 'darwin' }),
};

function serializar(valor) {
  return JSON.stringify(valor, (_chave, v) => (v === undefined ? '«undefined»' : v));
}

function depois(funcao) {
  setImmediateReal(funcao);
}

function semConsulta(endereco) {
  return String(endereco).split('?')[0];
}

function resumoDosBytes(dados) {
  const base64 = Buffer.from(dados).toString('base64');
  return `${Buffer.byteLength(dados)}B ${base64.slice(0, 48)}`;
}

class FluxoFalso extends EventEmitter {
  constructor(disco, caminho) {
    super();
    this.disco = disco;
    this.caminho = caminho;
  }

  receber(corpo) {
    this.disco.arquivos.set(this.caminho, Buffer.from(corpo));
    depois(() => this.emit('finish'));
  }

  close(aoFechar) {
    this.disco.palco.anotar(`fecha ${this.caminho}`);
    depois(aoFechar);
  }
}

class DiscoFalso {
  constructor(palco) {
    this.palco = palco;
    this.arquivos = new Map();
    this.pastas = new Set();
    this.pastasTravadas = new Set();
    this.apagarFalha = false;
  }

  existsSync(caminho) {
    return this.arquivos.has(caminho) || this.pastas.has(caminho);
  }

  mkdirSync(caminho, opcoes) {
    this.palco.anotar(`mkdir ${caminho} ${serializar(opcoes)}`);
    if (this.pastasTravadas.has(caminho)) throw new Error(`EACCES ${caminho}`);
    this.pastas.add(caminho);
  }

  writeFileSync(caminho, dados) {
    this.palco.anotar(`grava ${caminho} ${resumoDosBytes(dados)}`);
    this.arquivos.set(caminho, Buffer.from(dados));
  }

  lerExistente(caminho) {
    if (!this.arquivos.has(caminho)) throw new Error(`ENOENT ${caminho}`);
    return this.arquivos.get(caminho);
  }

  readFileSync(caminho) {
    return Buffer.from(this.lerExistente(caminho));
  }

  statSync(caminho) {
    return { size: this.lerExistente(caminho).length };
  }

  unlinkSync(caminho) {
    this.palco.anotar(`apaga ${caminho}`);
    if (this.apagarFalha) throw new Error(`EPERM ${caminho}`);
    this.arquivos.delete(caminho);
  }

  unlink(caminho, aoApagar) {
    this.palco.anotar(`apaga-assincrono ${caminho}`);
    this.arquivos.delete(caminho);
    depois(aoApagar);
  }

  createWriteStream(caminho) {
    this.palco.anotar(`abre-escrita ${caminho}`);
    return new FluxoFalso(this, caminho);
  }

  modulo() {
    const metodos = ['existsSync', 'mkdirSync', 'writeFileSync', 'readFileSync', 'statSync', 'unlinkSync', 'unlink', 'createWriteStream'];
    return Object.fromEntries(metodos.map(nome => [nome, (...argumentos) => this[nome](...argumentos)]));
  }
}

class PedidoHttpFalso extends EventEmitter {
  constructor(palco, opcoes, aoResponder) {
    super();
    this.palco = palco;
    this.opcoes = opcoes;
    this.aoResponder = aoResponder;
    this.corpo = '';
  }

  write(trecho) {
    this.corpo += trecho;
  }

  end() {
    const { method, hostname, path: caminho, headers } = this.opcoes;
    this.palco.anotar(`https ${method} ${hostname}${caminho} ${serializar(headers)} ${this.corpo}`);
    depois(() => this.responder(this.palco.respostaDa(`${method} ${hostname}${semConsulta(caminho)}`)));
  }

  responder(resposta) {
    if (resposta.erro) return this.emit('error', new Error(resposta.erro));
    const corpo = String(resposta.corpo);
    const meio = Math.floor(corpo.length / 2);
    const recebida = new EventEmitter();
    this.aoResponder(recebida);
    recebida.emit('data', corpo.slice(0, meio));
    recebida.emit('data', corpo.slice(meio));
    recebida.emit('end');
  }
}

class RedeFalsa {
  constructor(palco, protocolo) {
    this.palco = palco;
    this.protocolo = protocolo;
  }

  request(opcoes, aoResponder) {
    return new PedidoHttpFalso(this.palco, opcoes, aoResponder);
  }

  get(endereco, aoResponder) {
    this.palco.anotar(`${this.protocolo} get ${endereco}`);
    const pedido = new EventEmitter();
    depois(() => this.baixar(pedido, this.palco.respostaDa(`GET ${semConsulta(endereco)}`), aoResponder));
    return pedido;
  }

  baixar(pedido, resposta, aoResponder) {
    if (resposta.erro) return pedido.emit('error', new Error(resposta.erro));
    aoResponder({
      statusCode: resposta.status || 200,
      headers: { location: resposta.location },
      pipe: destino => destino.receber(resposta.corpo || ''),
    });
  }
}

class Palco {
  constructor(caminhoDoModulo) {
    this.modulo = path.resolve(caminhoDoModulo);
    this.raiz = comBarra(path.resolve(path.dirname(this.modulo), '..', '..', '..'));
    this.registro = [];
    this.disco = new DiscoFalso(this);
    this.rotas = new Map();
    this.recursos = undefined;
    this.chaveFal = 'fal-falso';
    this.ffmpeg = { bytes: 4096 };
    this.veo = { envios: [], consultas: [] };
    this.token = 'gemini-falso';
    this.app = this.criarApp();
  }

  caminho(...partes) {
    return path.posix.join(this.raiz, ...partes);
  }

  anotar(linha) {
    this.registro.push(linha.split(this.raiz).join('<raiz>'));
  }

  criarApp() {
    return {
      getPath: nome => `/casa/${nome}`,
      getGeminiToken: async () => this.token,
    };
  }

  arquivo(caminho, conteudo) {
    this.disco.arquivos.set(caminho, Buffer.from(conteudo));
  }

  pasta(caminho) {
    this.disco.pastas.add(caminho);
  }

  rota(chave, ...respostas) {
    this.rotas.set(chave, respostas);
  }

  respostaDa(chave) {
    const respostas = this.rotas.get(chave);
    if (!respostas) return { erro: `sem rota ${chave}` };
    return respostas.length > 1 ? respostas.shift() : respostas[0];
  }

  execFile(comando, argumentos, opcoes, aoTerminar) {
    this.anotar(`execFile ${comando} ${serializar(argumentos)} ${serializar(opcoes)}`);
    depois(() => this.terminarFfmpeg(argumentos[argumentos.length - 1], aoTerminar));
    return {};
  }

  terminarFfmpeg(saida, aoTerminar) {
    if (this.ffmpeg.erro) return aoTerminar(new Error(this.ffmpeg.erro), '', 'stderr do ffmpeg');
    if (this.ffmpeg.bytes !== null) this.disco.arquivos.set(saida, Buffer.alloc(this.ffmpeg.bytes));
    aoTerminar(null, '', '');
  }

  execFileSync(comando, argumentos, opcoes) {
    this.anotar(`execFileSync ${comando} ${serializar(argumentos)} ${serializar(opcoes)}`);
    if (this.chaveFal === null) throw new Error('item não encontrado');
    return this.chaveFal;
  }

  enviarVeo(pedido) {
    this.anotar(`veo envia ${serializar(pedido)}`);
    const resposta = this.veo.envios.shift();
    if ('erro' in resposta) return Promise.reject(resposta.erro);
    return Promise.resolve(resposta.operacao);
  }

  consultarVeo(origem, pedido) {
    this.anotar(`veo consulta ${origem} ${serializar(pedido)}`);
    const resposta = this.veo.consultas.length > 1 ? this.veo.consultas.shift() : this.veo.consultas[0];
    return Promise.resolve(resposta);
  }

  modelosDoVeo() {
    if (this.veo.semModelos) return undefined;
    if (this.veo.semGerar) return {};
    return {
      generateVideos: pedido => this.enviarVeo(pedido),
      getVideosOperation: pedido => this.consultarVeo('models', pedido),
    };
  }

  operacoesDoVeo() {
    if (this.veo.semOperacoes) return undefined;
    return { getVideosOperation: pedido => this.consultarVeo('operations', pedido) };
  }

  sdkDoGoogle() {
    if (this.veo.semSdk) throw new Error("Cannot find module '@google/genai'");
    const palco = this;
    class GoogleGenAI {
      constructor(opcoes) {
        palco.anotar(`genai ${serializar(opcoes)}`);
        this.models = palco.modelosDoVeo();
        this.operations = palco.operacoesDoVeo();
      }
    }
    return { GoogleGenAI };
  }

  falsos() {
    return {
      fs: this.disco.modulo(),
      https: new RedeFalsa(this, 'https'),
      http: new RedeFalsa(this, 'http'),
      os: { ...os, userInfo: () => ({ username: 'dono' }) },
      child_process: {
        execFile: (...argumentos) => this.execFile(...argumentos),
        execFileSync: (...argumentos) => this.execFileSync(...argumentos),
      },
      path: caminhosComBarra,
      './tool-paths': ferramentasDoMac,
    };
  }

  instalar() {
    const falsos = this.falsos();
    const modulo = this.modulo;
    const palco = this;
    Module._load = function (pedido, pai, ...resto) {
      if (!pai || pai.filename !== modulo) return carregadorOriginal.call(this, pedido, pai, ...resto);
      if (pedido === '@google/genai') return palco.sdkDoGoogle();
      return falsos[pedido] || carregadorOriginal.call(this, pedido, pai, ...resto);
    };
    this.trocarAmbiente();
  }

  trocarAmbiente() {
    this.recursosOriginais = process.resourcesPath;
    process.resourcesPath = this.recursos;
    process.cwd = () => '/trabalho';
    Date.now = () => INSTANTE;
    globalThis.setTimeout = (funcao, ms) => {
      this.anotar(`espera ${ms}`);
      depois(funcao);
    };
    this.consoleOriginal = { ...console };
    for (const [nivel, saida] of Object.entries(NIVEIS_DO_CONSOLE)) {
      console[nivel] = (...argumentos) => this.anotar(`${saida} ${util.format(...argumentos)}`);
    }
  }

  desinstalar() {
    Module._load = carregadorOriginal;
    process.resourcesPath = this.recursosOriginais;
    process.cwd = cwdReal;
    Date.now = dateNowReal;
    globalThis.setTimeout = setTimeoutReal;
    Object.assign(console, this.consoleOriginal);
  }

  servico() {
    process.resourcesPath = this.recursos;
    delete require.cache[this.modulo];
    const KlingVideoService = require(this.modulo);
    this.instancia = new KlingVideoService(this.app);
    this.anotar(`ffmpeg ${this.instancia.ffmpegPath}`);
    return this.instancia;
  }

  progresso() {
    return passo => this.anotar(`progresso ${serializar(passo)}`);
  }

  async converter(entrada) {
    const servico = this.instancia || this.servico();
    try {
      this.anotar(`resultado ${serializar(await servico.convertPictureToVideo(entrada))}`);
    } catch (erro) {
      this.anotar(`falha ${erro.name}: ${erro.message}`);
    }
  }
}

async function assentar() {
  for (let volta = 0; volta < 5; volta++) await new Promise(pronto => setImmediateReal(pronto));
}

async function encenar(caminhoDoModulo, cena) {
  const palco = new Palco(caminhoDoModulo);
  palco.instalar();
  try {
    await cena(palco);
    await assentar();
  } finally {
    palco.desinstalar();
  }
  return palco.registro;
}

module.exports = { encenar };
