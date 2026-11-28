'use strict';

const net = require('net');
const crypto = require('crypto');
const { ByteWriter, AMFReader, ecma } = require('./cam-live-amf');

const nowMs = () => Number(process.hrtime.bigint() / 1000000n);

const TIPO = { tamanhoDoBloco: 1, confirmacao: 3, controle: 4, janela: 5, banda: 6, audio: 8, video: 9, dados: 18, comando: 20 };
const FLUXO_DE_CONTROLE = { csid: 2, streamId: 0 };
const FLUXO_DE_COMANDOS = { csid: 3, streamId: 0 };
const fluxoDaPublicacao = (streamId) => ({ csid: 4, streamId });
const fluxoDeAudio = (streamId) => ({ csid: 5, streamId });
const fluxoDeVideo = (streamId) => ({ csid: 6, streamId });

const VERSAO_DO_HANDSHAKE = 0x03;
const TAMANHO_DO_HANDSHAKE = 1536;
const TAMANHO_DA_RESPOSTA_DO_HANDSHAKE = 1 + TAMANHO_DO_HANDSHAKE + TAMANHO_DO_HANDSHAKE;
const TEMPO_ESTENDIDO = 0xffffff;
const BYTES_ENTRE_CONFIRMACOES = 2500000;
const ESPERA_DA_CONEXAO_MS = 30000;
const ESPERA_DA_RESPOSTA_MS = 10000;
const ESPERA_PARA_DESTRUIR_O_SOQUETE_MS = 300;
const PEDIDO_DE_PING = 6;
const PORTA_PADRAO_DO_RTMP = 1935;
const FORMATO_DO_ENDERECO = /^(rtmps?):\/\/([^/:]+)(?::(\d+))?(?:\/(.*))?$/i;
const RESPOSTA_DE_PING = 7;
const VALORES_LIDOS_POR_COMANDO = 12;
const CODIGO_DE_CONEXAO_ACEITA = 'NetConnection.Connect.Success';
const RESPOSTAS_DE_COMANDO = new Set(['_result', '_error']);
const TAMANHO_DO_CABECALHO_DA_MENSAGEM = { 0: 11, 1: 7, 2: 3 };
const BYTES_A_MAIS_NO_CSID = { 0: 1, 1: 2 };

function lerEnderecoDoDestino(url) {
  const achado = FORMATO_DO_ENDERECO.exec(String(url || '').trim());
  if (!achado) throw new Error(`URL inválida '${url}'`);
  return { esquema: achado[1].toLowerCase(), host: achado[2], porta: achado[3], caminho: achado[4] };
}

function parseTarget(url, key) {
  const { esquema, host, porta, caminho } = lerEnderecoDoDestino(url);
  if (esquema === 'rtmps') throw new Error('rtmps ainda não é suportado (use rtmp://)');
  const port = porta ? parseInt(porta, 10) : PORTA_PADRAO_DO_RTMP;
  const app = (caminho || '').replace(/\/+$/, '');
  return { host, port, app, key, tcUrl: `${esquema}://${host}:${port}/${app}` };
}

function criarDesfecho(resolve, reject, limpar) {
  let resolvido = false;
  const encerrar = (acao) => (valor) => {
    if (resolvido) return;
    resolvido = true;
    limpar();
    acao(valor);
  };
  return { falhar: encerrar(reject), concluir: encerrar(resolve) };
}

function codigoDoUltimoValor(valores) {
  return (valores[valores.length - 1] || {}).code;
}

function lerValoresDoComando(payload) {
  const leitor = new AMFReader(payload);
  const valores = [];
  while (leitor.left > 0) {
    valores.push(leitor.value());
    if (valores.length > VALORES_LIDOS_POR_COMANDO) break;
  }
  return valores;
}

function partirEmBlocos(payload, tamanho) {
  const blocos = [];
  for (let inicio = 0; inicio < payload.length; inicio += tamanho) blocos.push(payload.subarray(inicio, inicio + tamanho));
  return blocos;
}

function lerCabecalhoBasico(b) {
  if (b.length < 1) return null;
  const fmt = b[0] >> 6;
  const csid = b[0] & 0x3f;
  const extras = BYTES_A_MAIS_NO_CSID[csid] || 0;
  if (b.length < 1 + extras) return null;
  if (csid === 0) return { fmt, csid: b[1] + 64, p: 2 };
  if (csid === 1) return { fmt, csid: b[1] + b[2] * 256 + 64, p: 3 };
  return { fmt, csid, p: 1 };
}

function lerContinuacao(b, p, estado) {
  if (!estado.ext) return p;
  return b.length < p + 4 ? -1 : p + 4;
}

function lerTempoDaMensagem(b, { fmt, tempo, p }, estado) {
  estado.ext = tempo === TEMPO_ESTENDIDO;
  if (estado.ext && b.length < p + 4) return -1;
  const ts = estado.ext ? b.readUInt32BE(p) : tempo;
  if (fmt === 0) {
    estado.ts = ts;
    estado.delta = 0;
  } else {
    estado.delta = ts;
    estado.ts = (estado.ts + ts) >>> 0;
  }
  return estado.ext ? p + 4 : p;
}

function lerCabecalhoDaMensagem(b, { fmt, p }, estado) {
  if (fmt === 3) return lerContinuacao(b, p, estado);
  const tamanho = TAMANHO_DO_CABECALHO_DA_MENSAGEM[fmt];
  if (b.length < p + tamanho) return -1;
  if (fmt <= 1) {
    estado.len = b.readUIntBE(p + 3, 3);
    estado.type = b[p + 6];
  }
  if (fmt === 0) estado.sid = b.readUInt32LE(p + 7);
  return lerTempoDaMensagem(b, { fmt, tempo: b.readUIntBE(p, 3), p: p + tamanho }, estado);
}

const novoEstadoDeEntrada = () => ({ ts: 0, len: 0, type: 0, sid: 0, delta: 0, ext: false, parts: [], got: 0 });

function aoMudarOTamanhoDoBloco(cliente, payload) {
  if (payload.length >= 4) cliente.inChunk = payload.readUInt32BE(0);
}

function aoPedirPing(cliente, payload) {
  if (payload.length < 6 || payload.readUInt16BE(0) !== PEDIDO_DE_PING) return;
  const resposta = new ByteWriter().u16(RESPOSTA_DE_PING).u32(payload.readUInt32BE(2)).data;
  cliente._write(resposta, TIPO.controle, FLUXO_DE_CONTROLE, 0).catch(() => {});
}

function aoPedirBanda(cliente, payload) {
  if (payload.length < 4) return;
  cliente._write(new ByteWriter().u32(payload.readUInt32BE(0)).data, TIPO.janela, FLUXO_DE_CONTROLE, 0).catch(() => {});
}

function aoReceberComando(cliente, payload) {
  const valores = lerValoresDoComando(payload);
  const [nome, id] = valores;
  if (RESPOSTAS_DE_COMANDO.has(nome) && typeof id === 'number') return cliente._responder(nome, id, valores);
  if (nome === 'onStatus') cliente.log(`[rtmp] onStatus ${codigoDoUltimoValor(valores) || '?'}`);
  return undefined;
}

const TRATADORES_DE_MENSAGEM = {
  [TIPO.tamanhoDoBloco]: aoMudarOTamanhoDoBloco,
  [TIPO.controle]: aoPedirPing,
  [TIPO.banda]: aoPedirBanda,
  [TIPO.comando]: aoReceberComando,
};

class RtmpClient {
  constructor(log) {
    this.log = log || (() => {});
    this.sock = null; this.rb = Buffer.alloc(0);
    this.outChunk = 4096; this.inChunk = 128; this.streamId = 0; this.txid = 0;
    this.pending = new Map(); this.inState = new Map();
    this.phase = 'idle'; this.hsWait = null; this.bytesIn = 0; this.lastAck = 0;
    this.lastErrno = null; this.closed = false; this.connectTimeMs = 0; this.onClose = null; this.throttleKbps = 0;
  }

  connect(t) {
    const t0 = nowMs();
    return new Promise((resolve, reject) => {
      const sock = net.connect({ host: t.host, port: t.port });
      this.sock = sock;
      sock.setNoDelay(true);
      const espera = setTimeout(() => this._estourouAEsperaDaConexao(sock), ESPERA_DA_CONEXAO_MS);
      const desfecho = criarDesfecho(resolve, reject, () => clearTimeout(espera));
      this._ouvirOSoquete(sock, desfecho);
      sock.once('connect', () => this._aoConectar(t, t0, desfecho));
    });
  }

  _estourouAEsperaDaConexao(sock) {
    this.lastErrno = 'ETIMEDOUT';
    sock.destroy(new Error('connect timeout (30s)'));
  }

  _ouvirOSoquete(sock, desfecho) {
    sock.on('error', (e) => {
      this.lastErrno = e.code || String(e.message);
      desfecho.falhar(e);
      this._closed();
    });
    sock.on('close', () => {
      desfecho.falhar(new Error('conexão fechada'));
      this._closed();
    });
    sock.on('data', (dados) => this._receber(dados));
  }

  _receber(dados) {
    this.rb = this.rb.length ? Buffer.concat([this.rb, dados]) : dados;
    try {
      this._pump();
    } catch (e) {
      this.log(`[rtmp] parser: ${e.message}`);
    }
  }

  async _aoConectar(t, t0, desfecho) {
    try {
      await this._abrirTransmissao(t);
      this.connectTimeMs = nowMs() - t0;
      desfecho.concluir();
    } catch (e) {
      desfecho.falhar(e);
      this.close();
    }
  }

  async _abrirTransmissao(t) {
    await this._handshake();
    await this._write(new ByteWriter().u32(this.outChunk).data, TIPO.tamanhoDoBloco, FLUXO_DE_CONTROLE, 0);
    await this._conectarAoServidor(t);
    await this._command('releaseStream', [null, t.key], false);
    await this._command('FCPublish', [null, t.key], false);
    await this._criarOFluxo();
    await this._command('publish', [null, t.key, 'live'], false, fluxoDaPublicacao(this.streamId));
  }

  async _conectarAoServidor(t) {
    const pedido = { app: t.app, type: 'nonprivate', flashVer: 'FMLE/3.0 (compatible; FMSc/1.0)', swfUrl: t.tcUrl, tcUrl: t.tcUrl };
    const resposta = await this._command('connect', [pedido], true);
    const codigo = resposta && resposta[resposta.length - 1] && resposta[resposta.length - 1].code;
    if (codigo && codigo !== CODIGO_DE_CONEXAO_ACEITA) throw new Error(`connect recusado: ${codigo}`);
  }

  async _criarOFluxo() {
    const resposta = await this._command('createStream', [null], true);
    const id = resposta[resposta.length - 1];
    if (typeof id !== 'number') throw new Error('createStream sem id');
    this.streamId = id;
  }

  _closed() {
    if (this.closed) return;
    this.closed = true;
    for (const [, pendente] of this.pending) {
      clearTimeout(pendente.t);
      pendente.reject(new Error('conexão fechada'));
    }
    this.pending.clear();
    if (this.onClose) this.onClose();
  }

  close() {
    if (!this.sock) return;
    const s = this.sock;
    try {
      this._despedirDoServidor(s);
    } catch (_) {}
    this.streamId = 0;
    s.end();
    setTimeout(() => s.destroy(), ESPERA_PARA_DESTRUIR_O_SOQUETE_MS);
  }

  _despedirDoServidor(s) {
    if (!this.streamId) return;
    if (s.destroyed || !s.writable) return;
    const fluxo = fluxoDaPublicacao(this.streamId);
    s.write(this._msg(new ByteWriter().amf('FCUnpublish').amf(++this.txid).amf(null).data, TIPO.comando, fluxo, 0));
    s.write(this._msg(new ByteWriter().amf('deleteStream').amf(++this.txid).amf(null).amf(this.streamId).data, TIPO.comando, FLUXO_DE_COMANDOS, 0));
  }

  _handshake() {
    return new Promise((resolve, reject) => {
      const c1 = crypto.randomBytes(TAMANHO_DO_HANDSHAKE);
      c1.fill(0, 0, 8);
      this.sock.write(Buffer.concat([Buffer.from([VERSAO_DO_HANDSHAKE]), c1]));
      this.phase = 'hs';
      this.hsWait = { resolve, reject };
    });
  }

  _msg(payload, tipo, fluxo, ts) {
    const w = new ByteWriter();
    const estendido = ts >= TEMPO_ESTENDIDO;
    w.u8(fluxo.csid & 0x3f).u24(estendido ? TEMPO_ESTENDIDO : ts).u24(payload.length).u8(tipo).u32le(fluxo.streamId);
    if (estendido) w.u32(ts);
    partirEmBlocos(payload, this.outChunk).forEach((bloco, indice) => {
      if (indice > 0) this._continuacao(w, fluxo, estendido, ts);
      w.bytes(bloco);
    });
    return w.data;
  }

  _continuacao(w, fluxo, estendido, ts) {
    w.u8(0xc0 | (fluxo.csid & 0x3f));
    if (estendido) w.u32(ts);
  }

  _write(payload, tipo, fluxo, ts) { return this.send(this._msg(payload, tipo, fluxo, ts)); }

  _podeEscrever() {
    if (!this.sock) return false;
    return !this.sock.destroyed && this.sock.writable;
  }

  send(buf) {
    return new Promise((resolve, reject) => {
      if (!this._podeEscrever()) {
        this.lastErrno = this.lastErrno || 'EPIPE';
        return reject(new Error('socket fechado'));
      }
      return this.sock.write(buf, (erro) => this._depoisDeEscrever(erro, buf.length, { resolve, reject }));
    });
  }

  _depoisDeEscrever(erro, tamanho, { resolve, reject }) {
    if (erro) {
      this.lastErrno = erro.code || String(erro.message);
      return reject(erro);
    }
    if (this.throttleKbps > 0) return setTimeout(resolve, tamanho * 8 / this.throttleKbps);
    return resolve();
  }

  _command(name, args, wait, fluxo = FLUXO_DE_COMANDOS) {
    const id = ++this.txid;
    const w = new ByteWriter().amf(name).amf(id);
    for (const a of args) w.amf(a);
    const resposta = wait ? this._esperarResposta(id, name) : null;
    return this._write(w.data, TIPO.comando, fluxo, 0).then(() => resposta || []);
  }

  _esperarResposta(id, name) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`sem resposta para ${name}`));
      }, ESPERA_DA_RESPOSTA_MS);
      this.pending.set(id, { resolve, reject, t });
    });
  }

  _responder(nome, id, valores) {
    const pendente = this.pending.get(id);
    if (!pendente) return;
    clearTimeout(pendente.t);
    this.pending.delete(id);
    if (nome === '_error') pendente.reject(new Error(`_error ${codigoDoUltimoValor(valores) || ''}`));
    else pendente.resolve(valores.slice(1));
  }

  sendMetadata({ width, height, fps, bitrate }, audioKbps) {
    const props = { duration: 0, fileSize: 0, width, height, videocodecid: 7, videodatarate: bitrate, framerate: fps, encoder: 'CAM LIVE (reconstrução do MiniOBS)' };
    if (audioKbps) Object.assign(props, { audiocodecid: 10, audiosamplerate: 48000, audiosamplesize: 16, audiochannels: 2, stereo: true, audiodatarate: audioKbps });
    const w = new ByteWriter().amf('@setDataFrame').amf('onMetaData').amf(ecma(props));
    return this._write(w.data, TIPO.dados, fluxoDaPublicacao(this.streamId), 0);
  }

  sendVideo(body, tsMs) { return this._write(body, TIPO.video, fluxoDeVideo(this.streamId), tsMs >>> 0); }

  sendAudio(body, tsMs) { return this._write(body, TIPO.audio, fluxoDeAudio(this.streamId), tsMs >>> 0); }

  _pump() {
    if (this.phase === 'hs') this._avancarOHandshake();
    if (this.phase !== 'chunks') return;
    while (this._parseChunk()) continue;
  }

  _tomarAEsperaDoHandshake() {
    const espera = this.hsWait;
    this.hsWait = null;
    return espera;
  }

  _avancarOHandshake() {
    if (this.rb.length < TAMANHO_DA_RESPOSTA_DO_HANDSHAKE) return;
    if (this.rb[0] !== VERSAO_DO_HANDSHAKE) {
      this.phase = 'dead';
      this._tomarAEsperaDoHandshake().reject(new Error(`versão de handshake inesperada ${this.rb[0]}`));
      return;
    }
    this.sock.write(Buffer.from(this.rb.subarray(1, 1 + TAMANHO_DO_HANDSHAKE)));
    this.rb = this.rb.subarray(TAMANHO_DA_RESPOSTA_DO_HANDSHAKE);
    this.phase = 'chunks';
    this._tomarAEsperaDoHandshake().resolve();
  }

  _parseChunk() {
    const b = this.rb;
    const basico = lerCabecalhoBasico(b);
    if (!basico) return false;
    const estado = this.inState.get(basico.csid) || novoEstadoDeEntrada();
    const p = lerCabecalhoDaMensagem(b, basico, estado);
    if (p < 0) return false;
    const tamanho = Math.min(this.inChunk, estado.len - estado.got);
    if (b.length < p + tamanho) return false;
    this._guardarBloco(basico.csid, estado, { bloco: b.subarray(p, p + tamanho), tamanho });
    this.rb = b.subarray(p + tamanho);
    this._entregarSeCompleta(estado);
    this._confirmarSePreciso();
    return true;
  }

  _guardarBloco(csid, estado, { bloco, tamanho }) {
    if (tamanho > 0) {
      estado.parts.push(Buffer.from(bloco));
      estado.got += tamanho;
    }
    this.bytesIn += tamanho;
    this.inState.set(csid, estado);
  }

  _entregarSeCompleta(estado) {
    if (estado.got < estado.len) return;
    const payload = Buffer.concat(estado.parts);
    estado.parts = [];
    estado.got = 0;
    this._message(estado.type, payload);
  }

  _confirmarSePreciso() {
    if (this.bytesIn - this.lastAck < BYTES_ENTRE_CONFIRMACOES) return;
    this.lastAck = this.bytesIn;
    this._write(new ByteWriter().u32(this.bytesIn >>> 0).data, TIPO.confirmacao, FLUXO_DE_CONTROLE, 0).catch(() => {});
  }

  _message(tipo, payload) {
    const tratador = TRATADORES_DE_MENSAGEM[tipo];
    if (tratador) tratador(this, payload);
  }
}

module.exports = { RtmpClient, parseTarget, nowMs };
