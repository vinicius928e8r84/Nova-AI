'use strict';
const crypto = require('crypto');
const Module = require('module');
const path = require('path');
const { EventEmitter } = require('events');

const CAMINHO_DO_SERVICO = path.join(__dirname, '..', 'cam-live-service.js');
const BYTES_EM_HEX = 48;
const TAMANHO_DO_HANDSHAKE = 1537;
const AMF = { numero: 0x00, texto: 0x02, objeto: 0x03, nulo: 0x05 };

let carregamentoAtual = null;
const carregarOriginal = Module._load;

Module._load = function (pedido, pai, ...resto) {
  const falso = carregamentoAtual && pai?.filename === carregamentoAtual.caminho ? carregamentoAtual.modulos.get(pedido) : null;
  if (falso) return falso();
  return carregarOriginal.call(this, pedido, pai, ...resto);
};

const resumoDosBytes = (bytes) => (bytes.length <= BYTES_EM_HEX
  ? { hex: bytes.toString('hex') }
  : { tamanho: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16) });

const ehBytes = valor => Buffer.isBuffer(valor) || valor instanceof Uint8Array;
const ehSimples = valor => typeof valor !== 'object' || valor === null;

const CONVERSOES = [
  [valor => valor instanceof Error, valor => ({ erro: valor.constructor.name, mensagem: valor.message })],
  [ehBytes, valor => resumoDosBytes(Buffer.from(valor))],
  [valor => valor === undefined, () => '(undefined)'],
  [valor => typeof valor === 'bigint', valor => `${valor}n`],
  [valor => typeof valor === 'function', () => '(função)'],
  [Array.isArray, valor => valor.map(paraRegistro)],
  [ehSimples, valor => valor],
];

function paraRegistro(valor) {
  const conversao = CONVERSOES.find(([casa]) => casa(valor));
  if (conversao) return conversao[1](valor);
  return Object.fromEntries(Object.entries(valor).map(([chave, item]) => [chave, paraRegistro(item)]));
}

const amfNumero = (n) => {
  const b = Buffer.alloc(9);
  b[0] = AMF.numero;
  b.writeDoubleBE(n, 1);
  return b;
};

const amfTexto = (s) => {
  const d = Buffer.from(s, 'utf8');
  const b = Buffer.alloc(3);
  b[0] = AMF.texto;
  b.writeUInt16BE(d.length, 1);
  return Buffer.concat([b, d]);
};

const chaveAmf = (k) => amfTexto(k).subarray(1);

function amfValor(v) {
  if (v === null) return Buffer.from([AMF.nulo]);
  if (typeof v === 'number') return amfNumero(v);
  if (typeof v === 'string') return amfTexto(v);
  const props = Object.entries(v).map(([k, item]) => Buffer.concat([chaveAmf(k), amfValor(item)]));
  return Buffer.concat([Buffer.from([AMF.objeto]), ...props, Buffer.from([0, 0, 9])]);
}

const comandoAmf = valores => Buffer.concat(valores.map(amfValor));

function cabecalhoFmt0({ csid, tipo, tamanho, sid = 0 }) {
  const b = Buffer.alloc(12);
  b[0] = csid;
  b.writeUIntBE(tamanho, 4, 3);
  b[7] = tipo;
  b.writeUInt32LE(sid, 8);
  return b;
}

function mensagemDoServidor({ csid = 3, tipo = 20, sid = 0, corpo, pedaco = 128 }) {
  const partes = [cabecalhoFmt0({ csid, tipo, tamanho: corpo.length, sid })];
  for (let ofs = 0; ofs < corpo.length; ofs += pedaco) {
    if (ofs > 0) partes.push(Buffer.from([0xc0 | csid]));
    partes.push(corpo.subarray(ofs, ofs + pedaco));
  }
  return Buffer.concat(partes);
}

function lerTextoAmf(b, p) {
  const n = b.readUInt16BE(p + 1);
  return { valor: b.toString('utf8', p + 3, p + 3 + n), fim: p + 3 + n };
}

function comandoDoCliente(corpo) {
  if (corpo[0] !== AMF.texto) return {};
  const nome = lerTextoAmf(corpo, 0);
  const txid = corpo[nome.fim] === AMF.numero ? corpo.readDoubleBE(nome.fim + 1) : null;
  return { nome: nome.valor, txid };
}

function decifrarEscrita(b) {
  if (b.length === TAMANHO_DO_HANDSHAKE && b[0] === 3) return { handshake: 'C0C1' };
  if (b[0] >> 6 !== 0) return {};
  const ts = b.readUIntBE(1, 3);
  const inicio = ts === 0xffffff ? 16 : 12;
  const cabecalho = { csid: b[0] & 0x3f, ts, tamanho: b.readUIntBE(4, 3), tipo: b[7], sid: b.readUInt32LE(8) };
  return cabecalho.tipo === 20 ? { ...cabecalho, ...comandoDoCliente(b.subarray(inicio)) } : cabecalho;
}

class Relogio {
  constructor() {
    this.agora = 1000;
    this.fila = [];
    this.sequencia = 0;
  }

  agendar(fn, ms, repete) {
    const id = ++this.sequencia;
    this.fila.push({ id, fn, quando: this.agora + Math.max(0, Number(ms) || 0), repete: repete ? Math.max(1, ms) : 0 });
    return id;
  }

  cancelar(id) {
    this.fila = this.fila.filter(t => t.id !== id);
  }

  proximoAte(limite) {
    const vencidos = this.fila.filter(t => t.quando <= limite).sort((a, b) => a.quando - b.quando || a.id - b.id);
    return vencidos[0] || null;
  }

  disparar(tarefa) {
    this.agora = Math.max(this.agora, tarefa.quando);
    if (tarefa.repete) tarefa.quando += tarefa.repete;
    else this.cancelar(tarefa.id);
    tarefa.fn();
  }
}

const umaVolta = () => new Promise(resolver => setImmediate(resolver));

async function voltas(n = 6) {
  for (let i = 0; i < n; i++) await umaVolta();
}

class Servidor {
  constructor(roteiro, cena) {
    this.roteiro = roteiro;
    this.respostas = { ...RESPOSTAS_PADRAO, ...(cena.respostas || {}) };
    this.conexoes = [...(cena.conexoes || ['ok'])];
    this.handshake = cena.handshake || 'ok';
    this.lento = false;
    this.socket = null;
    this.pendentes = [];
  }

  responder(socket, escrita) {
    if (escrita.handshake) return this.responderHandshake(socket);
    const resposta = escrita.nome && this.respostas[escrita.nome];
    if (resposta) this.entregar(socket, resposta(escrita.txid));
  }

  responderHandshake(socket) {
    if (this.handshake === 'silencio') return;
    const versao = this.handshake === 'versao' ? 6 : 3;
    this.entregar(socket, Buffer.concat([Buffer.from([versao]), Buffer.alloc(1536, 0x11), Buffer.alloc(1536, 0x22)]));
  }

  entregar(socket, dados) {
    setImmediate(() => setImmediate(() => socket.emit('data', dados)));
  }

  liberar() {
    const pendentes = this.pendentes;
    this.pendentes = [];
    for (const cb of pendentes) cb();
  }
}

const RESPOSTAS_PADRAO = {
  connect: txid => mensagemDoServidor({ corpo: comandoAmf(['_result', txid, { fmsVer: 'FMS/3' }, { code: 'NetConnection.Connect.Success' }]) }),
  createStream: txid => mensagemDoServidor({ corpo: comandoAmf(['_result', txid, null, 1]) }),
  publish: () => mensagemDoServidor({ csid: 5, sid: 1, corpo: comandoAmf(['onStatus', 0, null, { code: 'NetStream.Publish.Start' }]) }),
};

class SocketFalso extends EventEmitter {
  constructor(roteiro, servidor, destino) {
    super();
    this.roteiro = roteiro;
    this.servidor = servidor;
    this.numero = ++roteiro.sockets;
    this.destroyed = false;
    this.writable = true;
    roteiro.anotar('net.connect', destino);
  }

  setNoDelay(valor) {
    this.roteiro.anotar(`sock${this.numero}.setNoDelay`, valor);
  }

  write(buf, cb) {
    const escrita = decifrarEscrita(buf);
    this.roteiro.anotar(`sock${this.numero}.write`, buf, escrita);
    this.servidor.responder(this, escrita);
    if (!cb) return true;
    const falha = this.roteiro.falhaDeEscrita;
    const terminar = () => cb(falha || undefined);
    if (this.servidor.lento) this.servidor.pendentes.push(terminar);
    else setImmediate(terminar);
    return true;
  }

  end() {
    this.roteiro.anotar(`sock${this.numero}.end`);
    this.writable = false;
  }

  destroy(erro) {
    this.roteiro.anotar(`sock${this.numero}.destroy`, erro);
    if (this.destroyed) return;
    this.destroyed = true;
    this.writable = false;
    if (erro) setImmediate(() => this.emit('error', erro));
    setImmediate(() => this.emit('close'));
  }
}

function netFalso(roteiro, servidor) {
  return {
    connect: (destino) => {
      const socket = new SocketFalso(roteiro, servidor, destino);
      servidor.socket = socket;
      const modo = servidor.conexoes.length > 1 ? servidor.conexoes.shift() : servidor.conexoes[0];
      roteiro.abrir(socket, modo);
      return socket;
    },
  };
}

function abrirSocket(socket, modo) {
  if (modo === 'ok') return setImmediate(() => socket.emit('connect'));
  if (modo === 'pendurado') return null;
  const erro = Object.assign(new Error(`connect ${modo}`), { code: modo });
  return setImmediate(() => {
    socket.emit('error', erro);
    socket.emit('close');
  });
}

function fsFalso(roteiro) {
  return {
    appendFileSync: (arquivo, linha) => roteiro.anotar('fs.appendFileSync', arquivo, linha),
    mkdirSync: (pasta, opcoes) => {
      roteiro.anotar('fs.mkdirSync', pasta, opcoes);
      if (roteiro.cena.falhaDoDisco) throw new Error('EACCES: sem permissão');
    },
    writeFileSync: (arquivo, conteudo) => roteiro.anotar('fs.writeFileSync', arquivo, conteudo),
    readFileSync: (arquivo, codificacao) => {
      roteiro.anotar('fs.readFileSync', arquivo, codificacao);
      if (roteiro.cena.estudio === undefined) throw new Error('ENOENT');
      return roteiro.cena.estudio;
    },
  };
}

function iphoneFalso(roteiro) {
  return class CamLiveIphone {
    constructor(opcoes) {
      roteiro.anotar('new CamLiveIphone', Object.keys(opcoes));
      this.enviar = opcoes.send;
    }

    start(cfg) { roteiro.anotar('iphone.start', cfg); return { ok: true, iphone: true }; }
    async stop() { roteiro.anotar('iphone.stop'); }
    frame(dados) { roteiro.anotar('iphone.frame', dados); return 'quadro'; }
    pcm(pacote) { roteiro.anotar('iphone.pcm', pacote); return 'pcm'; }
  };
}

class Roteiro {
  constructor(cena) {
    this.cena = cena;
    this.registro = [];
    this.relogio = new Relogio();
    this.servidor = new Servidor(this, cena);
    this.sockets = 0;
    this.falhaDeEscrita = null;
  }

  anotar(...evento) {
    this.registro.push(evento.map(paraRegistro));
  }

  abrir(socket, modo) {
    abrirSocket(socket, modo);
  }

  async avancar(ms) {
    const limite = this.relogio.agora + ms;
    await voltas();
    for (let tarefa = this.relogio.proximoAte(limite); tarefa; tarefa = this.relogio.proximoAte(limite)) {
      this.relogio.disparar(tarefa);
      await voltas();
    }
    this.relogio.agora = limite;
    await voltas();
  }
}

const GLOBAIS_DE_TEMPO = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'];

function prenderTempo(roteiro) {
  const originais = Object.fromEntries(GLOBAIS_DE_TEMPO.map(nome => [nome, global[nome]]));
  const hrtimeOriginal = process.hrtime.bigint;
  const isoOriginal = Date.prototype.toISOString;
  global.setTimeout = (fn, ms, ...args) => roteiro.relogio.agendar(() => fn(...args), ms, false);
  global.setInterval = (fn, ms) => roteiro.relogio.agendar(fn, ms, true);
  global.clearTimeout = global.clearInterval = id => roteiro.relogio.cancelar(id);
  process.hrtime.bigint = () => BigInt(Math.round(roteiro.relogio.agora * 1e6));
  Date.prototype.toISOString = function () { return `T+${roteiro.relogio.agora}`; };
  return () => {
    Object.assign(global, originais);
    process.hrtime.bigint = hrtimeOriginal;
    Date.prototype.toISOString = isoOriginal;
  };
}

function modulosFalsos(roteiro) {
  return new Map([
    ['net', () => netFalso(roteiro, roteiro.servidor)],
    ['fs', () => fsFalso(roteiro)],
    ['crypto', () => ({ randomBytes: n => Buffer.alloc(n, 0xab) })],
  ]);
}

function carregarServico(roteiro, caminho) {
  carregamentoAtual = { caminho, modulos: modulosFalsos(roteiro) };
  delete require.cache[caminho];
  const modulo = require(caminho);
  carregamentoAtual = null;
  return modulo;
}

function prenderIphone(roteiro, caminho) {
  const caminhoDoIphone = path.join(path.dirname(caminho), 'cam-live-iphone.js');
  const anterior = require.cache[caminhoDoIphone];
  require.cache[caminhoDoIphone] = { id: caminhoDoIphone, filename: caminhoDoIphone, loaded: true, exports: { CamLiveIphone: iphoneFalso(roteiro) } };
  return () => {
    if (anterior) require.cache[caminhoDoIphone] = anterior;
    else delete require.cache[caminhoDoIphone];
  };
}

async function encenar(cena, caminho = CAMINHO_DO_SERVICO) {
  const roteiro = new Roteiro(cena);
  const devolverTempo = prenderTempo(roteiro);
  const devolverIphone = prenderIphone(roteiro, caminho);
  const debugAnterior = process.env.CAMLIVE_DEBUG;
  delete process.env.CAMLIVE_DEBUG;
  try {
    const modulo = carregarServico(roteiro, caminho);
    await cena.passos(modulo, roteiro);
    roteiro.anotar('timers pendentes', roteiro.relogio.fila.length);
  } finally {
    carregamentoAtual = null;
    if (debugAnterior !== undefined) process.env.CAMLIVE_DEBUG = debugAnterior;
    devolverIphone();
    devolverTempo();
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

module.exports = { CAMINHO_DO_SERVICO, encenar, chamar, voltas, mensagemDoServidor, comandoAmf };
