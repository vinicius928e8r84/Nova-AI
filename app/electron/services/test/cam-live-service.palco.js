'use strict';

const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { mock } = require('node:test');
const { CamLiveService } = require('../cam-live-service');

const setTimeoutReal = global.setTimeout;
const esperarReal = (ms) => new Promise((resolve) => setTimeoutReal(resolve, ms));
const hrtimeReal = process.hrtime.bigint;

const TIPO = { tamanhoDoBloco: 1, confirmacao: 3, controle: 4, janela: 5, banda: 6, audio: 8, video: 9, dados: 18, comando: 20 };
const TAMANHO_DO_HANDSHAKE = 1536;
const BLOCO_INICIAL = 128;

const relogio = { ms: 0 };

const LEITORES_AMF = {
  0x00: (b, p) => [b.readDoubleBE(p), p + 8],
  0x01: (b, p) => [b[p] !== 0, p + 1],
  0x02: (b, p) => {
    const n = b.readUInt16BE(p);
    return [b.toString('utf8', p + 2, p + 2 + n), p + 2 + n];
  },
  0x03: (b, p) => lerPropriedades(b, p),
  0x05: (b, p) => [null, p],
  0x06: (b, p) => [undefined, p],
  0x08: (b, p) => lerPropriedades(b, p + 4),
};

function lerAmf(b, p) {
  const leitor = LEITORES_AMF[b[p]];
  if (!leitor) throw new Error(`marca AMF0 desconhecida ${b[p]}`);
  return leitor(b, p + 1);
}

function lerPropriedades(b, inicio) {
  const objeto = {};
  let p = inicio;
  for (;;) {
    const n = b.readUInt16BE(p);
    if (n === 0) return [objeto, p + 3];
    const chave = b.toString('utf8', p + 2, p + 2 + n);
    const [valor, depois] = lerAmf(b, p + 2 + n);
    objeto[chave] = valor;
    p = depois;
  }
}

function lerValoresAmf(payload) {
  const valores = [];
  let p = 0;
  while (p < payload.length) {
    const [valor, depois] = lerAmf(payload, p);
    valores.push(valor === undefined ? '(indefinido)' : valor);
    p = depois;
  }
  return valores;
}

function escreverAmf(valor) {
  if (valor === null) return Buffer.from([0x05]);
  if (typeof valor === 'number') {
    const b = Buffer.alloc(9);
    b.writeDoubleBE(valor, 1);
    return b;
  }
  if (typeof valor === 'string') {
    const texto = Buffer.from(valor, 'utf8');
    return Buffer.concat([Buffer.from([0x02, texto.length >> 8, texto.length & 0xff]), texto]);
  }
  const partes = [Buffer.from([0x03])];
  for (const [chave, item] of Object.entries(valor)) {
    const nome = Buffer.from(chave, 'utf8');
    partes.push(Buffer.from([nome.length >> 8, nome.length & 0xff]), nome, escreverAmf(item));
  }
  partes.push(Buffer.from([0, 0, 0x09]));
  return Buffer.concat(partes);
}

const comandoAmf = (...valores) => Buffer.concat(valores.map(escreverAmf));

function inteiro32(valor) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(valor >>> 0);
  return b;
}

function resumoDoCorpo(corpo) {
  return { tamanho: corpo.length, inicio: corpo.subarray(0, 6).toString('hex'), sha: crypto.createHash('sha256').update(corpo).digest('hex').slice(0, 12) };
}

function descreverMensagem(tipo, corpo) {
  if (tipo === TIPO.comando || tipo === TIPO.dados) return lerValoresAmf(corpo);
  if (tipo === TIPO.audio || tipo === TIPO.video) return resumoDoCorpo(corpo);
  if (tipo === TIPO.controle) return { evento: corpo.readUInt16BE(0), resto: corpo.subarray(2).toString('hex') };
  return corpo.length >= 4 ? corpo.readUInt32BE(0) : corpo.toString('hex');
}

const TAMANHO_DO_CABECALHO = { 0: 11, 1: 7, 2: 3, 3: 0 };
const TEMPO_ESTENDIDO = 0xffffff;

function lerContinuacao(b, fluxo) {
  if (!fluxo.ext) return 1;
  return b.length < 5 ? -1 : 5;
}

function lerTempoDoCabecalho(b, fluxo, p) {
  let ts = b.readUIntBE(1, 3);
  fluxo.ext = ts === TEMPO_ESTENDIDO;
  if (!fluxo.ext) return { ts, p };
  if (b.length < p + 4) return { ts, p: -1 };
  ts = b.readUInt32BE(p);
  return { ts, p: p + 4 };
}

function lerCabecalhoDoBloco(b, fluxo) {
  const formato = b[0] >> 6;
  const depoisDoCabecalho = 1 + TAMANHO_DO_CABECALHO[formato];
  if (b.length < depoisDoCabecalho) return -1;
  if (formato === 3) return lerContinuacao(b, fluxo);
  if (formato <= 1) {
    fluxo.tamanho = b.readUIntBE(4, 3);
    fluxo.tipo = b[7];
  }
  if (formato === 0) fluxo.idDoFluxo = b.readUInt32LE(8);
  const { ts, p } = lerTempoDoCabecalho(b, fluxo, depoisDoCabecalho);
  fluxo.ts = ts;
  return p;
}

class LeitorDeBlocos {
  constructor(aoMensagem) {
    this.aoMensagem = aoMensagem;
    this.buffer = Buffer.alloc(0);
    this.fluxos = new Map();
    this.tamanhoDoBloco = BLOCO_INICIAL;
  }

  receber(dados) {
    this.buffer = Buffer.concat([this.buffer, dados]);
    while (this.lerUmBloco()) continue;
  }

  lerUmBloco() {
    const b = this.buffer;
    if (b.length < 1) return false;
    const csid = b[0] & 0x3f;
    const fluxo = this.fluxos.get(csid) || { ts: 0, tamanho: 0, tipo: 0, idDoFluxo: 0, ext: false, partes: [], lidos: 0 };
    const p = lerCabecalhoDoBloco(b, fluxo);
    if (p < 0) return false;
    const falta = Math.min(this.tamanhoDoBloco, fluxo.tamanho - fluxo.lidos);
    if (b.length < p + falta) return false;
    fluxo.partes.push(Buffer.from(b.subarray(p, p + falta)));
    fluxo.lidos += falta;
    this.fluxos.set(csid, fluxo);
    this.buffer = b.subarray(p + falta);
    if (fluxo.lidos >= fluxo.tamanho) this.fecharMensagem(csid, fluxo);
    return true;
  }

  fecharMensagem(csid, fluxo) {
    const corpo = Buffer.concat(fluxo.partes);
    fluxo.partes = [];
    fluxo.lidos = 0;
    if (fluxo.tipo === TIPO.tamanhoDoBloco) this.tamanhoDoBloco = corpo.readUInt32BE(0);
    this.aoMensagem({ csid, tipo: fluxo.tipo, idDoFluxo: fluxo.idDoFluxo, ts: fluxo.ts, extendido: fluxo.ext, corpo });
  }
}

function montarMensagem({ csid, tipo, idDoFluxo = 0, corpo }, tamanhoDoBloco) {
  const cabecalho = Buffer.alloc(12);
  cabecalho[0] = csid & 0x3f;
  cabecalho.writeUIntBE(corpo.length, 4, 3);
  cabecalho[7] = tipo;
  cabecalho.writeUInt32LE(idDoFluxo, 8);
  const partes = [cabecalho];
  for (let inicio = 0; inicio < Math.max(corpo.length, 1); inicio += tamanhoDoBloco) {
    if (inicio > 0) partes.push(Buffer.from([0xc0 | (csid & 0x3f)]));
    partes.push(corpo.subarray(inicio, inicio + tamanhoDoBloco));
  }
  return Buffer.concat(partes);
}

const SUCESSO_DO_CONNECT = 'NetConnection.Connect.Success';

function roteiroPadrao(opcoes = {}) {
  return {
    codigoDoConnect: SUCESSO_DO_CONNECT,
    responderConnect: true,
    extrasNoConnect: [],
    cairDepoisDeVideos: 0,
    ...opcoes,
  };
}

function responderAoComando(conexao, mensagem, roteiro) {
  const [nome, id] = lerValoresAmf(mensagem.corpo);
  if (nome === 'connect' && roteiro.responderConnect) {
    for (const extra of roteiro.extrasNoConnect) extra(conexao);
    conexao.enviarComando(3, 0, '_result', id, { fmsVer: 'FMS/3,5,7,7009' }, { code: roteiro.codigoDoConnect, level: 'status' });
  }
  if (nome === 'createStream') conexao.enviarComando(3, 0, '_result', id, null, 1);
  if (nome === 'publish') conexao.enviarComando(5, 1, 'onStatus', 0, null, { level: 'status', code: 'NetStream.Publish.Start' });
  if (nome === 'publish' && roteiro.aoPublicar) roteiro.aoPublicar(conexao);
}

class Conexao {
  constructor(socket, numero, roteiro, servidor) {
    this.socket = socket;
    this.numero = numero;
    this.roteiro = roteiro;
    this.servidor = servidor;
    this.mensagens = [];
    this.bytes = Buffer.alloc(0);
    this.fase = 'c0c1';
    this.handshake = {};
    this.videosRecebidos = 0;
    this.tamanhoDeSaida = BLOCO_INICIAL;
    this.leitor = new LeitorDeBlocos((mensagem) => this.aoMensagem(mensagem));
    this.encerradaPor = null;
    this.s1 = crypto.createHash('sha256').update(`s1-${numero}`).digest().subarray(0, 16);
    socket.setNoDelay(true);
    socket.on('data', (dados) => this.receber(dados));
    socket.on('close', () => { this.encerradaPor = this.encerradaPor || 'cliente'; });
    socket.on('error', () => {});
  }

  enviar({ csid, tipo, idDoFluxo = 0, corpo }) {
    if (!this.socket.destroyed) this.socket.write(montarMensagem({ csid, tipo, idDoFluxo, corpo }, this.tamanhoDeSaida));
  }

  enviarComando(csid, idDoFluxo, ...valores) {
    this.enviar({ csid, tipo: TIPO.comando, idDoFluxo, corpo: comandoAmf(...valores) });
  }

  definirBlocoDeSaida(tamanho) {
    this.enviar({ csid: 2, tipo: TIPO.tamanhoDoBloco, corpo: inteiro32(tamanho) });
    this.tamanhoDeSaida = tamanho;
  }

  fechar() {
    this.encerradaPor = 'servidor';
    this.socket.end();
  }

  receber(dados) {
    this.servidor.bytesRecebidos += dados.length;
    if (this.fase === 'chunks') return this.leitor.receber(dados);
    this.bytes = Buffer.concat([this.bytes, dados]);
    if (this.fase === 'c0c1' && this.bytes.length >= 1 + TAMANHO_DO_HANDSHAKE) this.responderAoHandshake();
    if (this.fase === 'c2' && this.bytes.length >= TAMANHO_DO_HANDSHAKE) this.terminarHandshake();
    return undefined;
  }

  responderAoHandshake() {
    const c1 = this.bytes.subarray(1, 1 + TAMANHO_DO_HANDSHAKE);
    this.handshake = { versao: this.bytes[0], zerosNoInicioDoC1: c1.subarray(0, 8).every((x) => x === 0) };
    const s1 = Buffer.alloc(TAMANHO_DO_HANDSHAKE);
    for (let i = 0; i < s1.length; i++) s1[i] = this.s1[i % this.s1.length];
    this.socket.write(Buffer.concat([Buffer.from([0x03]), s1, Buffer.from(c1)]));
    this.s1Completo = s1;
    this.bytes = this.bytes.subarray(1 + TAMANHO_DO_HANDSHAKE);
    this.fase = 'c2';
    if (this.bytes.length >= TAMANHO_DO_HANDSHAKE) this.terminarHandshake();
  }

  terminarHandshake() {
    this.handshake.c2IgualAoS1 = this.bytes.subarray(0, TAMANHO_DO_HANDSHAKE).equals(this.s1Completo);
    const resto = this.bytes.subarray(TAMANHO_DO_HANDSHAKE);
    this.fase = 'chunks';
    if (resto.length) this.leitor.receber(resto);
  }

  aoMensagem(mensagem) {
    const { csid, tipo, idDoFluxo, ts, extendido, corpo } = mensagem;
    this.mensagens.push({ csid, tipo, idDoFluxo, ts, ...(extendido ? { extendido: true } : {}), conteudo: descreverMensagem(tipo, corpo) });
    if (tipo === TIPO.comando) responderAoComando(this, mensagem, this.roteiro);
    if (tipo === TIPO.video) this.contarVideo();
  }

  contarVideo() {
    this.videosRecebidos++;
    if (this.roteiro.cairDepoisDeVideos && this.videosRecebidos === this.roteiro.cairDepoisDeVideos) this.fechar();
  }
}

async function criarServidor(opcoes) {
  const roteiro = roteiroPadrao(opcoes);
  const servidor = { conexoes: [], bytesRecebidos: 0, roteiro };
  const aberto = net.createServer((socket) => servidor.conexoes.push(new Conexao(socket, servidor.conexoes.length + 1, roteiro, servidor)));
  await new Promise((resolve) => aberto.listen(0, '127.0.0.1', resolve));
  servidor.porta = aberto.address().port;
  servidor.encerrar = async () => {
    for (const conexao of servidor.conexoes) conexao.socket.destroy();
    await new Promise((resolve) => aberto.close(resolve));
  };
  return servidor;
}

function instalarRelogio() {
  relogio.ms = 0;
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'], now: 0 });
  process.hrtime.bigint = () => BigInt(Math.round(relogio.ms * 1000)) * 1000n;
}

function desinstalarRelogio() {
  mock.timers.reset();
  process.hrtime.bigint = hrtimeReal;
}

function marcarCaminhos(texto, raiz) {
  return texto.split(raiz).join('<raiz>').replace(/\\/g, '/');
}

async function avancarRelogio(ambiente, ms) {
  relogio.ms += ms;
  mock.timers.tick(ms);
  await ambiente.asentar();
}

async function avancarAte(ambiente, condicao, passo = 10) {
  for (let tentativa = 0; tentativa < 400 && !condicao(); tentativa++) await ambiente.avancar(passo);
}

async function pararAvancandoORelogio(ambiente) {
  const parada = ambiente.servico.stop();
  let terminou = false;
  parada.then(() => { terminou = true; });
  for (let passo = 0; passo < 200 && !terminou; passo++) await ambiente.avancar(100);
  return parada;
}

async function esperarAcalmar({ servidor, eventos }) {
  let anterior = '';
  for (let estavel = 0, passos = 0; estavel < 6 && passos < 600; passos++) {
    await esperarReal(5);
    const agora = `${servidor.bytesRecebidos}/${servidor.conexoes.length}/${eventos.length}`;
    estavel = agora === anterior ? estavel + 1 : 0;
    anterior = agora;
  }
}

function criarAmbiente({ cena, servico, servidor, eventos }) {
  const ambiente = { servico, servidor, eventos, url: `rtmp://127.0.0.1:${cena.porta || servidor.porta}/live` };
  ambiente.avancar = (ms) => avancarRelogio(ambiente, ms);
  ambiente.ate = (condicao, passo) => avancarAte(ambiente, condicao, passo);
  ambiente.parar = () => pararAvancandoORelogio(ambiente);
  ambiente.asentar = () => esperarAcalmar(ambiente);
  return ambiente;
}

async function rodarCena(cena) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-camlive-'));
  const servidor = await criarServidor(cena.servidor);
  const eventos = [];
  instalarRelogio();
  const servico = new CamLiveService({ send: (canal, carga) => eventos.push([canal, carga]), studioFile: path.join(raiz, 'studio.json'), logFile: path.join(raiz, 'camlive.log') });
  const ambiente = criarAmbiente({ cena, servico, servidor, eventos });
  try {
    const retornos = await cena.roteiro(ambiente);
    await ambiente.asentar();
    return diarioDaCena({ servidor, eventos, retornos, raiz });
  } finally {
    desinstalarRelogio();
    await servidor.encerrar();
    fs.rmSync(raiz, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}

function diarioDaCena({ servidor, eventos, retornos, raiz }) {
  const linhas = fs.existsSync(path.join(raiz, 'camlive.log')) ? fs.readFileSync(path.join(raiz, 'camlive.log'), 'utf8').split('\n').filter(Boolean) : [];
  const diario = {
    retornos,
    conexoes: servidor.conexoes.map((c) => ({ handshake: c.handshake, encerradaPor: c.encerradaPor, mensagens: c.mensagens })),
    eventos,
    log: linhas.map((linha) => marcarCaminhos(linha.replace(/^\S+ /, ''), raiz)),
  };
  return JSON.parse(JSON.stringify(diario).split(`127.0.0.1:${servidor.porta}`).join('127.0.0.1:<porta>'));
}

module.exports = { rodarCena, comandoAmf, inteiro32, TIPO, montarMensagem };
