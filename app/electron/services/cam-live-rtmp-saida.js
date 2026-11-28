'use strict';

const { FLV } = require('./cam-live-amf');
const { RtmpClient, parseTarget, nowMs } = require('./cam-live-rtmp-cliente');

const PACOTES_MINIMOS_PARA_AVALIAR = 5;
const FILA_QUE_PEDE_MENOS_BITRATE_US = 200000;
const ESPERA_PARA_AUMENTAR_MS = 4000;
const BITRATE_MINIMO = 50;
const JANELA_MINIMA_DA_ESTIMATIVA_MS = 1000;
const JANELA_MAXIMA_DA_ESTIMATIVA_MS = 2000;
const PRIORIDADE = { audio: 4, quadroChave: 3, quadroP: 2 };
const PREFIXO_DO_LOG = "[rtmp stream: 'CAM LIVE']";
const ESPERA_DA_PARADA_MS = 100;
const TENTATIVAS_DE_ESPERA_DA_PARADA = 300;

const TEXTO_DOS_ERROS = {
  ENOTFOUND: 'HostNotFound',
  EHOSTUNREACH: 'HostNotFound',
  ECONNRESET: 'ConnectionReset',
  ETIMEDOUT: 'ConnectionTimedOut',
  ECONNABORTED: 'ConnectionAborted',
  EADDRNOTAVAIL: 'AddressNotAvailable',
  ENETUNREACH: 'NoRoute',
  EACCES: 'PermissionDenied',
  ECONNREFUSED: 'Conexão recusada (o servidor está ligado?)',
};
const SEM_CODIGO_DE_ERRO = [null, undefined, ''];

function textoDoErro(codigo) {
  if (SEM_CODIGO_DE_ERRO.includes(codigo)) return '';
  return Object.prototype.hasOwnProperty.call(TEXTO_DOS_ERROS, codigo) ? TEXTO_DOS_ERROS[codigo] : String(codigo);
}

class BitrateDinamico {
  constructor() {
    this.frames = []; this.size = 0; this.incTimeout = 0; this.est = 0;
    this.orig = 0; this.prev = 0; this.cur = 0; this.inc = 0; this.on = false;
  }

  reiniciar(bitrate, ligado) {
    this.frames = []; this.size = 0; this.incTimeout = 0; this.est = 0; this.prev = 0;
    this.orig = this.cur = bitrate;
    this.inc = Math.floor(bitrate / 10);
    this.on = Boolean(ligado);
  }

  _voltarAoAnterior(log) {
    if (!this.prev) return null;
    log(`${PREFIXO_DO_LOG} going back to prev bitrate`);
    return this.prev;
  }

  _bitrateAoReduzir(log) {
    if (this.est === 0 || this.cur <= this.est) return this._voltarAoAnterior(log);
    this.frames = [];
    this.size = 0;
    return Math.max(Math.floor(this.est / 100) * 100, BITRATE_MINIMO);
  }

  reduzir(log) {
    const novo = this._bitrateAoReduzir(log);
    if (novo === null || novo === this.cur) return false;
    this.prev = 0;
    this.cur = novo;
    this.incTimeout = nowMs() + ESPERA_PARA_AUMENTAR_MS;
    log(`${PREFIXO_DO_LOG} bitrate decreased to: ${novo}`);
    return true;
  }

  _chegouAHoraDeAumentar() {
    if (!this.on || !this.incTimeout) return false;
    return nowMs() >= this.incTimeout;
  }

  aumentar(log) {
    if (!this._chegouAHoraDeAumentar()) return false;
    this.incTimeout = 0;
    this.prev = this.cur;
    this.cur += this.inc;
    if (this.cur < this.orig) {
      this.incTimeout = nowMs() + ESPERA_PARA_AUMENTAR_MS;
      log(`${PREFIXO_DO_LOG} bitrate increased to: ${this.cur}, waiting`);
    } else {
      this.cur = this.orig;
      log(`${PREFIXO_DO_LOG} bitrate increased to: ${this.cur}, done`);
    }
    return true;
  }

  _estimativaEmKbps(duracaoMs, kbpsDoAudio) {
    const kbps = duracaoMs > 0 ? Math.floor((this.size * 8) / duracaoMs) : 0;
    return Math.max(kbps - kbpsDoAudio, BITRATE_MINIMO);
  }

  registrar(quadro, kbpsDoAudio) {
    this.frames.push(quadro);
    this.size += quadro.size;
    const duracao = quadro.end - this.frames[0].beg;
    if (duracao >= JANELA_MAXIMA_DA_ESTIMATIVA_MS) {
      this.size -= this.frames[0].size;
      this.frames.shift();
    }
    if (duracao >= JANELA_MINIMA_DA_ESTIMATIVA_MS) this.est = this._estimativaEmKbps(duracao, kbpsDoAudio);
  }
}

const eQuadroDeVideoQueNaoEChave = (pacote) => !pacote.audio && !pacote.key;

class RtmpOutput {
  constructor(s, hooks) {
    this.s = s; this.hooks = hooks; this.log = hooks.log || (() => {});
    this.client = null; this.packets = []; this.waiter = null;
    this.connecting = false; this.active = false; this.disconnected = false; this.stopEvent = false;
    this.sentHeaders = false; this.gotFirst = false; this.startDtsMs = 0; this.minPriority = 0;
    this.congestion = 0; this.lastDtsUs = 0; this.totalBytes = 0; this.dropped = 0; this.avcC = null; this.asc = null; this.audioHdr = false; this.needKey = true;
    this.dbr = new BitrateDinamico();
    this.sendDone = null;
  }

  get isActive() { return this.active; }

  get currentBitrate() { return this.dbr.cur || this.s.bitrate; }

  _prepararParaConectar() {
    const s = this.s;
    this.connecting = true;
    this.disconnected = false; this.sentHeaders = false; this.audioHdr = false; this.gotFirst = false; this.minPriority = 0; this.needKey = true;
    this.dropped = 0; this.totalBytes = 0;
    this.dropUs = s.dropMs * 1000; this.pDropUs = Math.max(s.pframeDropMs, s.dropMs + 200) * 1000;
    this.dbr.reiniciar(s.bitrate, s.dyn);
    if (!this.dbr.on) return;
    this.log("[rtmp stream: 'CAM LIVE'] Dynamic bitrate using default interpolation");
    this.log("[rtmp stream: 'CAM LIVE'] Dynamic bitrate enabled.  Dropped frames begone!");
  }

  _lerODestino() {
    try {
      return parseTarget(this.s.url, this.s.key);
    } catch (e) {
      this.log(`[rtmp stream] ${e.message}`);
      this.connecting = false;
      this.hooks.onStopped('badPath', e.message);
      return null;
    }
  }

  async _conectar(destino) {
    this.log(`${PREFIXO_DO_LOG} Connecting to RTMP URL ${destino.tcUrl}...`);
    this.client = new RtmpClient(this.log);
    this.client.throttleKbps = this.s.throttleKbps || 0;
    try {
      await this.client.connect(destino);
    } catch (e) {
      this.log(`${PREFIXO_DO_LOG} Connection to ${destino.tcUrl} failed: ${e.message}`);
      this.client.close();
      this.connecting = false;
      this.hooks.onStopped('connectFailed', this._errText(e.message));
      return false;
    }
    this.log(`${PREFIXO_DO_LOG} Connection to ${destino.tcUrl} (${destino.host}) successful`);
    return true;
  }

  async start() {
    this._prepararParaConectar();
    const destino = this._lerODestino();
    if (!destino) return;
    if (!(await this._conectar(destino))) return;
    this.client.onClose = () => this._aoFecharOSoquete();
    this.packets = []; this.stopEvent = false; this.active = true; this.connecting = false;
    if (this.hooks.onConnected) this.hooks.onConnected(this.client.connectTimeMs);
    this.sendDone = this._sendLoop();
  }

  _aoFecharOSoquete() {
    if (!this.active || this.stopEvent) return;
    this.disconnected = true;
    this._wake();
  }

  async stop() {
    if (this.connecting) {
      for (let i = 0; i < TENTATIVAS_DE_ESPERA_DA_PARADA && this.connecting; i++) await new Promise((resolve) => setTimeout(resolve, ESPERA_DA_PARADA_MS));
    }
    if (!this.active) {
      this.hooks.onStopped('success');
      return;
    }
    this.stopEvent = true;
    this._wake();
    if (this.sendDone) await this.sendDone;
  }

  _wake() {
    if (!this.waiter) return;
    const acordar = this.waiter;
    this.waiter = null;
    acordar();
  }

  _waitPacket() { return new Promise((resolve) => { this.waiter = resolve; }); }

  _pedirQuadroChave() {
    if (this.hooks.requestKeyframe) this.hooks.requestKeyframe();
  }

  _falhaDoEncoder() {
    this.encodeError = true;
    this._wake();
  }

  _receberAudio(pacote) {
    if (!this.gotFirst) return;
    this.packets.push(pacote);
    this._wake();
  }

  _aceitarPelaChave(pacote) {
    if (!this.needKey) return true;
    if (!pacote.key) {
      this._pedirQuadroChave();
      return false;
    }
    this.needKey = false;
    return true;
  }

  _marcarOPrimeiroQuadro(pacote) {
    if (this.gotFirst) return;
    this.startDtsMs = Math.floor(pacote.dtsUs / 1000);
    this.gotFirst = true;
  }

  _enfileirarVideo(pacote) {
    if (pacote.dropPriority < this.minPriority) {
      this.dropped++;
      return;
    }
    this.minPriority = 0;
    this.lastDtsUs = pacote.dtsUs;
    this.packets.push(pacote);
    this._wake();
  }

  encodedPacket(p) {
    if (this.disconnected || !this.active) return;
    if (!p) return this._falhaDoEncoder();
    if (p.audio) return this._receberAudio(p);
    if (!this._aceitarPelaChave(p)) return;
    this._marcarOPrimeiroQuadro(p);
    this._check(false);
    this._check(true);
    this._enfileirarVideo(p);
  }

  _aumentarOBitrateSePossivel() {
    if (this.dbr.aumentar(this.log)) this._dbrSet();
  }

  _check(pframes) {
    if (!pframes) this._aumentarOBitrateSePossivel();
    if (this.packets.length < PACOTES_MINIMOS_PARA_AVALIAR) {
      if (!pframes) this.congestion = 0;
      return;
    }
    const primeiro = this.packets.find(eQuadroDeVideoQueNaoEChave);
    if (!primeiro) return;
    this._reagirAFila(this.lastDtsUs - primeiro.dtsUs, pframes);
  }

  _reagirAFila(duracao, pframes) {
    const limite = pframes ? this.pDropUs : this.dropUs;
    if (!pframes) this.congestion = duracao / limite;
    if (this.dbr.on) {
      if (!pframes) this._baixarOBitrateSeFilaLonga(duracao);
      return;
    }
    if (!(duracao > limite)) return;
    this.log(`[rtmp stream] buffer_duration_usec: ${duracao}`);
    this._drop(pframes ? PRIORIDADE.quadroChave : PRIORIDADE.quadroP, pframes);
  }

  _baixarOBitrateSeFilaLonga(duracao) {
    if (!(duracao >= FILA_QUE_PEDE_MENOS_BITRATE_US)) return;
    if (!this.dbr.reduzir(this.log)) return;
    this.log(`[rtmp stream] buffer_duration_msec: ${Math.floor(duracao / 1000)}`);
    this._dbrSet();
  }

  _drop(priority, pframes) {
    const kept = this.packets.filter((p) => p.dropPriority >= priority);
    const n = this.packets.length - kept.length;
    this.packets = kept;
    if (this.minPriority < priority) this.minPriority = priority;
    if (n > 0) {
      this.dropped += n;
      this.log(`${PREFIXO_DO_LOG} dropped ${n} frames (${pframes ? 'pframes' : 'all below HIGH'})`);
    }
  }

  _dbrSet() {
    if (this.hooks.setBitrate) this.hooks.setBitrate(this.dbr.cur);
  }

  async _haOQueEnviar() {
    while (!this.disconnected && !this.encodeError) {
      if (this.packets.length) return !this.stopEvent;
      if (this.stopEvent) return false;
      await this._waitPacket();
    }
    return false;
  }

  async _enviarAteParar() {
    while (await this._haOQueEnviar()) await this._enviarOProximo();
  }

  async _enviarOProximo() {
    const pacote = this.packets.shift();
    if (!this.sentHeaders) {
      await this._sendHeaders();
      this.sentHeaders = true;
    }
    if (pacote.audio) await this._sendAudio(pacote);
    else await this._sendPacket(pacote);
  }

  async _encerrarOEnvio(motivoDaFalha) {
    if (this.disconnected) {
      this.log(`${PREFIXO_DO_LOG} Disconnected from ${this.s.url}`);
      return 'disconnected';
    }
    await this._terminarComRodape(this.encodeError);
    return motivoDaFalha;
  }

  async _terminarComRodape(houveErroDoEncoder) {
    this.log(houveErroDoEncoder ? `${PREFIXO_DO_LOG} Encoder error, disconnecting` : `${PREFIXO_DO_LOG} User stopped the stream`);
    await this._footer();
  }

  async _sendLoop() {
    let detalhe = '';
    try {
      await this._enviarAteParar();
    } catch (e) {
      this.disconnected = true;
      detalhe = e.message;
    }
    const motivo = await this._encerrarOEnvio(this.encodeError ? 'encodeError' : 'success');
    const erro = textoDoErro(this.client.lastErrno);
    if (erro) this.log(`${PREFIXO_DO_LOG} last error: ${erro}`);
    this.client.close();
    this._restaurarOBitrate();
    if (this.packets.length) this.log(`${PREFIXO_DO_LOG} Freeing ${this.packets.length} remaining packets`);
    this.packets = []; this.active = false; this.stopEvent = false; this.encodeError = false;
    this.hooks.onStopped(motivo, detalhe || erro || '');
  }

  _restaurarOBitrate() {
    if (!this.dbr.on || this.dbr.cur === this.dbr.orig) return;
    this.dbr.cur = this.dbr.orig;
    this._dbrSet();
  }

  async _sendHeaders() {
    if (!this.avcC) throw new Error('Codec not initialized for track 0 while sending header');
    await this.client.sendMetadata(this.s, this.s.audio || 0);
    const cabecalho = FLV.sequenceHeader(this.avcC);
    await this.client.sendVideo(cabecalho, 0);
    this.totalBytes += cabecalho.length;
  }

  async _enviarCabecalhoDeAudio() {
    if (this.audioHdr) return true;
    if (!this.asc) return false;
    const cabecalho = FLV.audioSeq(this.asc);
    await this.client.sendAudio(cabecalho, 0);
    this.totalBytes += cabecalho.length;
    this.audioHdr = true;
    return true;
  }

  _tempoRelativoEmMs(dtsUs) {
    return Math.max(0, Math.floor(dtsUs / 1000) - this.startDtsMs);
  }

  async _enviarMedindo(metodo, corpo, pacote) {
    const ts = this._tempoRelativoEmMs(pacote.dtsUs);
    const inicio = nowMs();
    await this.client[metodo](corpo, ts);
    this.totalBytes += corpo.length;
    if (this.dbr.on) this.dbr.registrar({ beg: inicio, end: nowMs(), size: corpo.length }, this.s.audio || 0);
  }

  async _sendAudio(pacote) {
    if (!(await this._enviarCabecalhoDeAudio())) return;
    await this._enviarMedindo('sendAudio', FLV.audio(pacote.data), pacote);
  }

  async _sendPacket(pacote) {
    await this._enviarMedindo('sendVideo', FLV.frame(pacote), pacote);
  }

  async _footer() {
    try {
      await this.client.sendVideo(FLV.endOfSequence(), this._tempoRelativoEmMs(this.lastDtsUs));
    } catch (_) {}
  }

  _errText(codigo) { return textoDoErro(codigo); }
}

module.exports = { RtmpOutput, PRIORIDADE };
