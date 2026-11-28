'use strict';

const fs = require('fs');
const path = require('path');
const { ByteWriter, AMFReader, FLV } = require('./cam-live-amf');
const { RtmpClient, parseTarget } = require('./cam-live-rtmp-cliente');
const { RtmpOutput, PRIORIDADE } = require('./cam-live-rtmp-saida');

const INTERVALO_DAS_ESTATISTICAS_MS = 1000;
const PARAR_E_TENTAR_DE_NOVO = new Set(['disconnected', 'connectFailed']);

const textoDaDesistencia = (tentativas, detalhe) => `Desistiu depois de ${tentativas} tentativas de reconexão.${detalhe ? ' (' + detalhe + ')' : ''}`;

class CamLiveService {
  constructor({ send, studioFile, logFile }) {
    this.sendToRenderer = send; this.studioFile = studioFile; this.logFile = logFile;
    this.output = null; this.cfg = null; this.avcC = null; this.asc = null; this.retries = 0; this.userStop = false; this.status = 'Pronto';
    this.lastBytes = 0; this.statsTimer = null; this.error = '';
  }

  log(msg) {
    const line = `${new Date().toISOString()} ${msg}\n`;
    try { if (this.logFile) fs.appendFileSync(this.logFile, line); } catch (_) {}
    if (process.env.CAMLIVE_DEBUG) console.info('[camlive]', msg);
  }

  _emitStatus(extra) { this.sendToRenderer('camlive:status', Object.assign({ status: this.status, error: this.error }, extra || {})); }

  async start(cfg) {
    if (this.output) return { ok: false, error: 'já está transmitindo' };
    this.cfg = cfg; this.userStop = false; this.retries = 0; this.error = ''; this.lastBytes = 0;
    this.status = 'Conectando…'; this._emitStatus();
    this._newOutput(); this.output.start();
    this.statsTimer = setInterval(() => this._stats(), INTERVALO_DAS_ESTATISTICAS_MS);
    return { ok: true };
  }

  _newOutput() {
    this.output = new RtmpOutput(this.cfg, {
      log: (m) => this.log(m),
      setBitrate: (k) => this.sendToRenderer('camlive:set-bitrate', { kbps: k }),
      requestKeyframe: () => this.sendToRenderer('camlive:keyframe', {}),
      onConnected: () => this._aoConectar(),
      onStopped: (reason, detail) => this._stopped(reason, detail),
    });
    this.output.avcC = this.avcC;
    this.output.asc = this.asc;
  }

  _aoConectar() {
    this.status = 'AO VIVO';
    this._emitStatus();
  }

  _stopped(reason, detail) {
    if (this.userStop) return;
    if (PARAR_E_TENTAR_DE_NOVO.has(reason)) return this._reconectarOuDesistir(detail);
    if (reason === 'encodeError') this.error = 'Erro no encoder, transmissão interrompida.';
    if (reason === 'badPath') this.error = detail || 'Endereço do servidor inválido.';
    return this._finish();
  }

  _reconectarOuDesistir(detail) {
    const c = this.cfg;
    if (this.retries >= c.maxRetries) {
      this.error = textoDaDesistencia(this.retries, detail);
      return this._finish();
    }
    this.retries++;
    this.status = `Reconectando em ${c.retryDelaySec}s (tentativa ${this.retries}/${c.maxRetries})`;
    this.error = detail || '';
    this._emitStatus();
    this.log(`Output 'CAM LIVE': Reconnecting in ${c.retryDelaySec} seconds (attempt ${this.retries}/${c.maxRetries})`);
    return this._agendarNovaTentativa(this.output, c.retryDelaySec * 1000);
  }

  _agendarNovaTentativa(saidaQueCaiu, esperaMs) {
    setTimeout(() => {
      if (this.output !== saidaQueCaiu || this.userStop) return;
      this._newOutput();
      this.output.start();
    }, esperaMs);
  }

  _finish() {
    clearInterval(this.statsTimer); this.statsTimer = null; this.output = null; this.status = 'Pronto';
    this.sendToRenderer('camlive:status', { status: 'Pronto', error: this.error, finished: true });
    this.sendToRenderer('camlive:stats', { sentKbps: 0, dropped: 0, congestion: 0, bitrate: 0, queued: 0 });
  }

  async stop() {
    if (!this.output) return { ok: true };
    this.userStop = true; this.status = 'Parando…'; this._emitStatus();
    const o = this.output; await o.stop().catch(() => {});
    this._finish(); return { ok: true };
  }

  _stats() {
    const o = this.output; if (!o) return;
    const bytes = o.totalBytes, kbps = bytes >= this.lastBytes ? Math.round((bytes - this.lastBytes) * 8 / 1000) : 0; this.lastBytes = bytes;
    this.sendToRenderer('camlive:stats', { sentKbps: kbps, dropped: o.dropped, congestion: o.congestion, bitrate: o.currentBitrate, queued: o.packets.length, connectMs: o.client ? o.client.connectTimeMs : 0 });
  }

  setAvcC(buf) { this.avcC = Buffer.from(buf); if (this.output) this.output.avcC = this.avcC; }

  setAsc(buf) { this.asc = Buffer.from(buf); if (this.output) this.output.asc = this.asc; }

  audioPacket(p) {
    const o = this.output;
    if (!o) return;
    o.encodedPacket({ data: Buffer.from(p.data), dtsUs: p.ptsUs, ptsUs: p.ptsUs, key: false, audio: true, dropPriority: PRIORIDADE.audio });
  }

  packet(p) {
    const o = this.output;
    if (!o) return;
    const prioridade = p.key ? PRIORIDADE.quadroChave : PRIORIDADE.quadroP;
    o.encodedPacket({ data: Buffer.from(p.data), dtsUs: p.ptsUs, ptsUs: p.ptsUs, key: !!p.key, dropPriority: prioridade });
  }

  loadStudio() {
    try { return JSON.parse(fs.readFileSync(this.studioFile, 'utf8')); } catch (_) { return null; }
  }

  saveStudio(doc) {
    try {
      fs.mkdirSync(path.dirname(this.studioFile), { recursive: true });
      fs.writeFileSync(this.studioFile, JSON.stringify(doc, null, 2));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }
}

function criarEnvioParaAJanela(getWindow) {
  return (canal, carga) => {
    const janela = getWindow && getWindow();
    if (janela && !janela.isDestroyed()) janela.webContents.send(canal, carga);
  };
}

function ligarOIphoneAoCelular(getMobileService, iphone) {
  try {
    const celular = getMobileService && getMobileService();
    if (celular) celular.camLiveIphone = iphone;
  } catch (_) {}
}

function registrarCanaisDeTransmissao(ipcMain, svc, iphone) {
  ipcMain.handle('camlive:start', (_e, cfg) => (cfg && cfg.target === 'iphone' ? iphone.start(cfg) : svc.start(cfg)));
  ipcMain.handle('camlive:stop', async () => { await iphone.stop(); return svc.stop(); });
  ipcMain.handle('camlive:frame', (_e, data) => iphone.frame(data));
  ipcMain.handle('camlive:pcm', (_e, packet) => iphone.pcm(packet));
}

function registrarCanaisDoEstudio(ipcMain, svc) {
  ipcMain.handle('camlive:studio-load', () => svc.loadStudio());
  ipcMain.handle('camlive:studio-save', (_e, doc) => svc.saveStudio(doc));
}

function registrarOuvintesDeMidia(ipcMain, svc) {
  ipcMain.on('camlive:avcc', (_e, buf) => svc.setAvcC(buf));
  ipcMain.on('camlive:packet', (_e, p) => svc.packet(p));
  ipcMain.on('camlive:aasc', (_e, buf) => svc.setAsc(buf));
  ipcMain.on('camlive:apacket', (_e, p) => svc.audioPacket(p));
  ipcMain.on('camlive:log', (_e, msg) => svc.log(String(msg)));
}

function register({ ipcMain, getWindow, userDataDir, getMobileService }) {
  const dir = path.join(userDataDir, 'CamLive');
  const send = criarEnvioParaAJanela(getWindow);
  const svc = new CamLiveService({ send, studioFile: path.join(dir, 'studio.json'), logFile: path.join(dir, 'camlive.log') });
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  const { CamLiveIphone } = require('./cam-live-iphone');
  const iphone = new CamLiveIphone({ getMobileService, send });
  ligarOIphoneAoCelular(getMobileService, iphone);
  registrarCanaisDeTransmissao(ipcMain, svc, iphone);
  registrarCanaisDoEstudio(ipcMain, svc);
  registrarOuvintesDeMidia(ipcMain, svc);
  svc.iphone = iphone;
  return svc;
}

module.exports = { register, CamLiveService, RtmpOutput, RtmpClient, AMFReader, ByteWriter, parseTarget, FLV };
