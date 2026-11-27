'use strict';
const { spawn } = require('child_process');
const { AdtsParser } = require('./cam-live-iphone-adts');
const { UsbMedia } = require('./cam-live-iphone-midia');
const { iniciarCodificador } = require('./cam-live-iphone-codificador');
const { enviarPcm } = require('./cam-live-iphone-pcm');
const tunel = require('./cam-live-iphone-tunel');
const BLACK_FRAME = Buffer.from('/9j/4AAQSkZJRgABAgAAAQABAAD//gAPTGF2YzYzLjEuMTAyAP/bAEMACAQEBAQEBQUFBQUFBgYGBgYGBgYGBgYGBgcHBwgICAcHBwYGBwcICAgICQkJCAgICAkKCgoKDAwLCw4ODhERFP/EAEsAAQEAAAAAAAAAAAAAAAAAAAAIAQEAAAAAAAAAAAAAAAAAAAAAEAEAAAAAAAAAAAAAAAAAAAAAEQEAAAAAAAAAAAAAAAAAAAAA/8AAEQgAIAAgAwEiAAIRAAMRAP/aAAwDAQACEQMRAD8An8AAAAAAAH//2Q==', 'base64');
const TAXAS_DE_AUDIO = [8000, 11025, 16000, 22050, 24000, 32000, 44100, 48000, 88200, 96000];
const CAMPOS_DA_PONTE = ['hooksReady', 'photoPrepareHookReady', 'photoStillHookReady', 'photoPortRemapHookReady'];

function bridgePatch(state) {
  const match = /^0\.1-(\d+)/.exec(String((state && state.version) || ''));
  return match ? Number(match[1]) : 0;
}

function ponteNaVersaoDoTransporte(state) {
  return !!state && bridgePatch(state) >= 39;
}

function ready(state) {
  if (!ponteNaVersaoDoTransporte(state) || state.faulted) return false;
  return CAMPOS_DA_PONTE.every((campo) => state[campo]);
}

function quadrosPorSegundo(valor) {
  return Math.max(1, Math.min(30, Math.round(Number(valor) || 30)));
}

class CamLiveIphone {
  constructor({ getMobileService, send = () => {}, ffmpegPath, spawnProcess = spawn }) {
    this.getMobileService = getMobileService; this.send = send; this.ffmpegPath = ffmpegPath; this.spawnProcess = spawnProcess;
    this.stopping = null; this.generation = 0; this.running = false; this.starting = false; this.active = false; this.status = 'Pronto'; this.error = ''; this.droppedPcm = 0; this.cameraEnabled = false; this.transportQueue = Promise.resolve();
    this.transport = null; this.frameUrl = null; this.socketPath = null;
  }
  _emit(extra = {}) { this.send('camlive:status', { status: this.status, error: this.error, destination: 'iphone', ...extra }); }
  _assert(token) { if (token !== this.generation) throw new Error('Preparação do CAM LIVE cancelada.'); }
  _emUso() { return this.running || this.starting; }
  _sessaoAtual(token) { return this.running && token === this.generation; }
  async _readState() {
    if (!this.mobile && typeof this.getMobileService === 'function') this.mobile = this.getMobileService();
    if (!this.mobile) throw new Error('Abra PHONE CONTROL e conecte o iPhone antes de transmitir.');
    require('./tool-paths').exigirOpenssh('ssh');
    const response = await this.mobile.iosSsh('cat /var/tmp/obs-graph-bridge-status.json');
    if (!response || !response.ok) throw new Error('iPhone sem acesso SSH. Use Conectar em PHONE CONTROL e confira o cabo USB.');
    try { return JSON.parse(response.stdout); } catch (_) { throw new Error('A ponte do iPhone não retornou um status válido. Reconecte em PHONE CONTROL.'); }
  }
  withTransport(operation) {
    const task = this.transportQueue.then(operation);
    this.transportQueue = task.catch(() => {});
    return task;
  }
  mediaEndpoint() {
    return { url: this.frameUrl, socket: this.transport?.type === 'unix' ? this.transport.path : null };
  }
  async ensureTransport() {
    if (this.tunnel && this.media) return;
    await this._prepararCamera(this.getMobileService()?.iosCamera?.());
    await this.closeTransport();
    this.media = new UsbMedia({ idleFrame: BLACK_FRAME });
    await this._abrirTransporte();
  }
  async _prepararCamera(camera) {
    await camera?.liberarPortaCamera();
    try { camera?.suspenderHeartbeatLocal?.(); } catch (_) {}
    try { await camera?.writeControl?.({ mode: 'observe' }); } catch (_) {}
  }
  async _abrirTransporte() {
    try {
      await this.media.listen();
      this._exigirCelular();
      await this._tunnel();
    } catch (error) {
      await this.closeTransport();
      throw error;
    }
  }
  _exigirCelular() {
    if (!this.mobile) this.mobile = this.getMobileService?.();
    if (!this.mobile) throw new Error('Abra PHONE CONTROL e conecte o iPhone antes de ligar a injeção.');
  }
  async closeTransport() {
    const tunnel = this.tunnel, media = this.media, socketPath = this.socketPath;
    this.tunnel = null; this.media = null; this.socketPath = null; this.transport = null; this.frameUrl = null;
    await tunel.aguardarSaidaDoTunel(tunnel);
    await tunel.apagarSocket(this, socketPath);
    await media?.close();
  }
  setCameraEnabled(enabled, writeControl) {
    return this.withTransport(async () => {
      if (enabled) await this.ensureTransport();
      try {
        await writeControl();
        this.cameraEnabled = enabled;
      } finally {
        if (!this.cameraEnabled && !this._emUso()) await this.closeTransport();
      }
    });
  }
  start(cfg = {}) {
    if (this.startTask || this.stopping) return Promise.resolve({ ok: false, error: 'Aguarde a preparação ou parada da transmissão anterior.' });
    const task = this._start(cfg); this.startTask = task;
    task.finally(() => { if (this.startTask === task) this.startTask = null; });
    return task;
  }
  async _start(cfg = {}) {
    if (this._emUso() || this.stopping) return { ok: false, error: 'O CAM LIVE já está preparando ou transmitindo para o iPhone.' };
    const token = ++this.generation; this.starting = true; this.error = ''; this.status = 'Preparando iPhone por USB…'; this._emit();
    try {
      await this._escolherAparelho(token, cfg);
      await this._exigirPonte(token);
      const sampleRate = this._configurarFonte(cfg);
      await this._prepararTransporte(token);
      await this._iniciarTransmissao(token);
      return { ok: true, deviceName: this.deviceName, sampleRate };
    } catch (error) {
      return this._abortarPartida(token, error);
    }
  }
  async _escolherAparelho(token, cfg) {
    this.mobile = this.getMobileService && this.getMobileService();
    if (!this.mobile) throw new Error('Abra PHONE CONTROL e conecte o iPhone antes de transmitir.');
    const devices = (await this.mobile.getIosDevices()).filter(d => d.ios || String(d.id).startsWith('ios-')); this._assert(token);
    if (devices.length !== 1) throw new Error('Conecte exatamente um iPhone por USB para transmitir.');
    const device = devices[0];
    if (cfg.deviceId && cfg.deviceId !== device.id) throw new Error('O iPhone selecionado não corresponde ao único dispositivo conectado.');
    this.deviceName = device.name || 'iPhone'; this.deviceId = device.id;
  }
  async _exigirPonte(token) {
    const state = await this._readState(); this._assert(token);
    if (!ready(state)) throw new Error('A ponte de câmera precisa ser a versão 0.1-39 (transporte camuflado) com os hooks de foto prontos. Use Conectar em PHONE CONTROL para atualizar/preparar o iPhone.');
  }
  _configurarFonte(cfg) {
    const sampleRate = Number(cfg.sampleRate || 48000);
    if (!TAXAS_DE_AUDIO.includes(sampleRate)) throw new Error('Taxa de áudio da fonte não suportada.');
    this.sampleRate = sampleRate; this.fps = quadrosPorSegundo(cfg.fps);
    this.pcmAt = 0; this.droppedPcm = 0; this.pcmBlocked = false; this.active = false;
    return sampleRate;
  }
  async _prepararTransporte(token) {
    await this.withTransport(() => {
      this._assert(token);
      return this.ensureTransport();
    });
    this._assert(token);
  }
  async _iniciarTransmissao(token) {
    await iniciarCodificador(this, token); this._assert(token);
    this.running = true; this.starting = false; this.status = 'Aguardando fonte'; this._emit();
    this.sourceWatch = setInterval(() => this._updateSource(token), 500); this.sourceWatch.unref();
  }
  async _abortarPartida(token, error) {
    if (token === this.generation) { this.error = error.message; this.starting = false; this.running = false; await this._cleanup(); this.status = 'Pronto'; this._emit({ finished: true }); }
    return { ok: false, error: error.message };
  }
  _openForward(args) { return tunel.abrirRedirecionamento(this, args); }
  async _tunnel() {
    const localPort = this.media.server.address().port;
    this.transport = await this._camouflagedForward(localPort);
    this.frameUrl = this.transport.type === 'unix'
      ? `http://127.0.0.1${this.media.framePath}`
      : `http://127.0.0.1:${this.transport.port}${this.media.framePath}`;
  }
  _camouflagedForward(localPort) { return tunel.redirecionamentoCamuflado(this, localPort); }
  _tcpForward(localPort, attempts) { return tunel.redirecionamentoTcp(this, localPort, attempts); }
  frame(data) {
    if (!this.running || !this.media) return { ok: false, error: 'A transmissão USB ainda não está preparada.' };
    let result;
    try { result = this.media.frame(data); } catch (_) { return { ok: false, error: 'Quadro JPEG inválido.' }; }
    if (result.ok) this._updateSource(this.generation);
    return result;
  }
  pcm(bloco) { return enviarPcm(this, bloco); }
  _pcmRecente() { return !!this.pcmAt && Date.now() - this.pcmAt <= 2000; }
  _fonteAtiva() {
    if (!this.media.freshFrame() || !this.media.freshAudio()) return false;
    return this._pcmRecente();
  }
  _updateSource(token) {
    if (!this._sessaoAtual(token) || !this.media) return;
    const active = this._fonteAtiva();
    if (active === this.active) return;
    this.active = active;
    this.status = active ? 'AO VIVO' : 'Aguardando fonte';
    this._emit();
  }
  async _fail(error, token) {
    if (token !== this.generation || this.failing) return;
    this.failing = true; this.error = error.message || String(error); await this.stop(); this.failing = false; this._emit({ finished: true });
  }
  async _devolverCameraAoObservador() {
    try { await this.getMobileService?.()?.iosCamera?.().writeControl?.({ mode: 'observe' }); } catch (_) {}
  }
  async _liberarMidia() {
    this.media?.clearSource();
    if (!this.cameraEnabled || !this.tunnel) await this.closeTransport();
  }
  async _cleanup() {
    clearInterval(this.sourceWatch); this.sourceWatch = null;
    await this._devolverCameraAoObservador();
    const encoder = this.encoder;
    this.encoder = null; this.active = false;
    encoder?.kill();
    await this.withTransport(() => this._liberarMidia());
  }
  async stop() {
    if (this.stopping) return this.stopTask || { ok: true };
    this.stopping = true;
    const task = this._stop(); this.stopTask = task;
    try { return await task; } finally { this.stopping = false; this.stopTask = null; }
  }
  async _stop() {
    ++this.generation; this.running = false; this.starting = false;
    const preparing = this.startTask;
    if (preparing) await preparing;
    await this._cleanup(); this.status = 'Pronto'; return { ok: true };
  }
  stats() { return { destination: 'iphone', status: this.status, active: this.active, fps: this.fps || 30, queued: this.media ? this.media.audio.length : 0, dropped: this.droppedPcm, deviceName: this.deviceName || '', frameFresh: !!this.media && this.media.freshFrame(), audioFresh: !!this.media && this.media.freshAudio(), transport: this.transport?.type || '' }; }
  snapshot() { return { ...this.stats(), error: this.error, running: this.running }; }
}
module.exports = { CamLiveIphone, AdtsParser, UsbMedia };
