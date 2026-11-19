'use strict';
// CAM LIVE → iPhone USB: JPEG + AAC-LC over an app-owned loopback HTTP server.
//
// Transporte camuflado (bridge 0.1-39): o servidor só responde em
// /s/<token de 32 hex>/… e o túnel tenta primeiro um socket Unix no iPhone;
// se o sshd não aceitar, cai para uma porta TCP aleatória. Nada de 18999.
const http = require('http');
const crypto = require('crypto');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const iphoneSsh = require('./iphone-ssh');
const BLACK_FRAME = Buffer.from('/9j/4AAQSkZJRgABAgAAAQABAAD//gAPTGF2YzYzLjEuMTAyAP/bAEMACAQEBAQEBQUFBQUFBgYGBgYGBgYGBgYGBgcHBwgICAcHBwYGBwcICAgICQkJCAgICAkKCgoKDAwLCw4ODhERFP/EAEsAAQEAAAAAAAAAAAAAAAAAAAAIAQEAAAAAAAAAAAAAAAAAAAAAEAEAAAAAAAAAAAAAAAAAAAAAEQEAAAAAAAAAAAAAAAAAAAAA/8AAEQgAIAAgAwEiAAIRAAMRAP/aAAwDAQACEQMRAD8An8AAAAAAAH//2Q==', 'base64');
const MAX_JPEG = 2 * 1024 * 1024;
const MEDIA_TOKEN = /^[0-9a-f]{32}$/;
const UNAVAILABLE = 'Indisponível';
const quote = s => "'" + String(s).replace(/'/g, "'\\''") + "'";

class AdtsParser {
  constructor(onPacket) { this.pending = Buffer.alloc(0); this.onPacket = onPacket; }
  push(chunk) {
    const incoming = Buffer.from(chunk);
    if (incoming.length > 1024 * 1024 || this.pending.length + incoming.length > 1024 * 1024) throw new Error('Saída AAC excedeu o limite.');
    this.pending = Buffer.concat([this.pending, incoming]);
    const packets = [];
    while (this.pending.length >= 7) {
      const b = this.pending;
      if (b[0] !== 0xff || (b[1] & 0xf6) !== 0xf0) throw new Error('Encoder retornou áudio sem cabeçalho ADTS válido.');
      const header = b[1] & 1 ? 7 : 9;
      const length = ((b[3] & 3) << 11) | (b[4] << 3) | (b[5] >> 5);
      if (length <= header || length > 8191) throw new Error('Tamanho de pacote AAC inválido.');
      if (((b[2] >> 6) & 3) !== 1 || ((b[2] >> 2) & 15) !== 4 || (((b[2] & 1) << 2) | (b[3] >> 6)) !== 1 || (b[6] & 3) !== 0) throw new Error('Áudio do iPhone exige AAC-LC mono de 44,1 kHz.');
      if (b.length < length) break;
      const packet = Buffer.from(b.subarray(header, length));
      packets.push(packet);
      if (this.onPacket) this.onPacket(packet);
      this.pending = b.subarray(length);
    }
    return packets;
  }
}

function jpegDimensions(bytes) {
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset++] !== 0xff) return null;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return null;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return null;
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      if (length < 8) return null;
      return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) };
    }
    offset += length;
  }
  return null;
}

class UsbMedia {
  constructor({ now = Date.now, idleFrame = null, token = crypto.randomBytes(16).toString('hex') } = {}) {
    if (!MEDIA_TOKEN.test(String(token))) throw new Error('Token de mídia inválido.');
    this.token = String(token);
    this.now = now; this.idleFrame = idleFrame; this.latestFrame = null; this.frameAt = 0; this.audioAt = 0; this.sequence = 0n; this.audio = []; this.server = null;
  }
  get framePath() { return `/s/${this.token}/frame.jpg`; }
  get audioPath() { return `/s/${this.token}/audio`; }
  frame(data) {
    if (!Buffer.isBuffer(data) && !(data instanceof Uint8Array)) return { ok: false, error: 'Quadro JPEG inválido.' };
    const b = Buffer.from(data);
    if (b.length < 4 || b.length > MAX_JPEG || b[0] !== 0xff || b[1] !== 0xd8 || b[b.length - 2] !== 0xff || b[b.length - 1] !== 0xd9) return { ok: false, error: 'Quadro JPEG inválido ou maior que 2 MiB.' };
    const size = jpegDimensions(b);
    if (!size || size.width < 1 || size.height < 1 || size.width > 4096 || size.height > 4096) return { ok: false, error: 'O JPEG precisa ter dimensões válidas de até 4096×4096.' };
    this.latestFrame = Buffer.from(b); this.frameAt = this.now(); return { ok: true };
  }
  audioPacket(data) {
    if (!Buffer.isBuffer(data) && !(data instanceof Uint8Array)) return { ok: false, error: 'Pacote AAC inválido.' };
    const b = Buffer.from(data);
    if (b.length < 1 || b.length > 8192) return { ok: false, error: 'Pacote AAC inválido.' };
    this.sequence++; this.audio.push({ sequence: this.sequence, data: Buffer.from(b) });
    if (this.audio.length > 96) this.audio.splice(0, this.audio.length - 96);
    this.audioAt = this.now(); return { ok: true };
  }
  freshFrame(maxAge = 1000) { return !!this.latestFrame && this.now() - this.frameAt <= maxAge; }
  freshAudio(maxAge = 1000) { return this.audio.length > 0 && this.now() - this.audioAt <= maxAge; }
  batch(after) {
    if (!this.freshAudio()) return null;
    const records = this.audio.filter(p => p.sequence > after).slice(-32);
    return Buffer.concat([Buffer.from('OBA1'), ...records.map(p => { const header = Buffer.alloc(10); header.writeBigUInt64BE(p.sequence); header.writeUInt16BE(p.data.length, 8); return Buffer.concat([header, p.data]); })]);
  }
  async listen() {
    if (this.server) throw new Error('Servidor de mídia já iniciado.');
    this.server = http.createServer((req, res) => {
      const reply = (status, data, type = 'text/plain; charset=utf-8') => { res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(data) }); res.end(data); };
      if (req.method !== 'GET') return reply(405, 'Método não permitido');
      let url;
      try { url = new URL(req.url, 'http://127.0.0.1'); } catch (_) { return reply(400, 'URL inválida'); }
      if (url.pathname === this.framePath) {
        const frame = this.freshFrame() ? this.latestFrame : this.idleFrame;
        return frame ? reply(200, frame, 'image/jpeg') : reply(503, UNAVAILABLE);
      }
      if (url.pathname === this.audioPath) {
        const text = url.searchParams.get('after') || '0';
        if (!/^\d{1,20}$/.test(text) || BigInt(text) > 0xffffffffffffffffn) return reply(400, 'Sequência inválida');
        const batch = this.batch(BigInt(text)); return batch ? reply(200, batch, 'application/octet-stream') : reply(503, UNAVAILABLE);
      }
      return reply(404, 'Não encontrado');
    });
    this.server.requestTimeout = 3000; this.server.headersTimeout = 3000; this.server.keepAliveTimeout = 1000;
    await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(0, '127.0.0.1', resolve); });
    return this.server.address().port;
  }
  clearSource() { this.latestFrame = null; this.audio = []; }
  async close() {
    const server = this.server; this.server = null;
    this.clearSource();
    if (!server) return;
    await new Promise(resolve => { const timer = setTimeout(resolve, 1000); server.close(() => { clearTimeout(timer); resolve(); }); if (server.closeAllConnections) server.closeAllConnections(); });
  }
}

// A ponte relata "0.1-<revisão>"; 0.1-39 é a primeira com o transporte camuflado.
function bridgePatch(state) {
  const match = /^0\.1-(\d+)/.exec(String((state && state.version) || ''));
  return match ? Number(match[1]) : 0;
}

function ready(state) {
  return state && bridgePatch(state) >= 39 && state.hooksReady && !state.faulted && state.photoPrepareHookReady && state.photoStillHookReady && state.photoPortRemapHookReady;
}
class CamLiveIphone {
  constructor({ getMobileService, send = () => {}, ffmpegPath, spawnProcess = spawn }) {
    this.getMobileService = getMobileService; this.send = send; this.ffmpegPath = ffmpegPath; this.spawnProcess = spawnProcess;
    this.stopping = null; this.generation = 0; this.running = false; this.starting = false; this.active = false; this.status = 'Pronto'; this.error = ''; this.droppedPcm = 0; this.cameraEnabled = false; this.transportQueue = Promise.resolve();
    this.transport = null; this.frameUrl = null; this.socketPath = null;
  }
  _emit(extra = {}) { this.send('camlive:status', { status: this.status, error: this.error, destination: 'iphone', ...extra }); }
  _assert(token) { if (token !== this.generation) throw new Error('Preparação do CAM LIVE cancelada.'); }
  async _readState() {
    // `this.mobile` só era preenchido no _activate; o status podia ser pedido antes
    // e estourava "Cannot read properties of undefined (reading 'iosSsh')".
    if (!this.mobile && typeof this.getMobileService === 'function') this.mobile = this.getMobileService();
    if (!this.mobile) throw new Error('Abra PHONE CONTROL e conecte o iPhone antes de transmitir.');
    const response = await this.mobile.iosSsh('cat /var/tmp/obs-graph-bridge-status.json');
    if (!response || !response.ok) throw new Error('iPhone sem acesso SSH. Use Conectar em PHONE CONTROL e confira o cabo USB.');
    try { return JSON.parse(response.stdout); } catch (_) { throw new Error('A ponte do iPhone não retornou um status válido. Reconecte em PHONE CONTROL.'); }
  }
  withTransport(operation) {
    const task = this.transportQueue.then(operation);
    this.transportQueue = task.catch(() => {});
    return task;
  }
  // Endereço que a ponte deve ler. O sequestro (ios-camera.js) usa isto ao
  // escrever o control, em vez de repetir 18999/frame.jpg.
  mediaEndpoint() {
    return { url: this.frameUrl, socket: this.transport?.type === 'unix' ? this.transport.path : null };
  }
  async ensureTransport() {
    if (this.tunnel && this.media) return;
    const camera = this.getMobileService()?.iosCamera?.();
    await camera?.liberarPortaCamera();
    // Limpa qualquer injeção anterior (sequestro/vídeo local) antes de assumir a
    // câmera: controle velho apontando para um túnel morto deixava o CAM LIVE preto.
    try { camera?.suspenderHeartbeatLocal?.(); } catch (_) {}
    try { await camera?.writeControl?.({ mode: 'observe' }); } catch (_) {}
    await this.closeTransport();
    this.media = new UsbMedia({ idleFrame: BLACK_FRAME });
    try {
      await this.media.listen();
      await this._tunnel();
    } catch (error) {
      await this.closeTransport();
      throw error;
    }
  }
  async closeTransport() {
    const tunnel = this.tunnel, media = this.media, socketPath = this.socketPath;
    this.tunnel = null; this.media = null; this.socketPath = null; this.transport = null; this.frameUrl = null;
    if (tunnel && tunnel.exitCode == null && tunnel.signalCode == null) {
      await new Promise(resolve => {
        const done = () => {
          clearTimeout(timeout);
          tunnel.removeListener('exit', done);
          resolve();
        };
        const timeout = setTimeout(done, 1500);
        tunnel.once('exit', done);
        tunnel.kill();
      });
    }
    if (socketPath) { try { await this.getMobileService?.()?.iosSsh(`rm -f ${quote(socketPath)}`); } catch (_) {} }
    await media?.close();
  }
  setCameraEnabled(enabled, writeControl) {
    return this.withTransport(async () => {
      if (enabled) await this.ensureTransport();
      try {
        await writeControl();
        this.cameraEnabled = enabled;
      } finally {
        if (!this.cameraEnabled && !this.running && !this.starting) await this.closeTransport();
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
    if (this.running || this.starting || this.stopping) return { ok: false, error: 'O CAM LIVE já está preparando ou transmitindo para o iPhone.' };
    const token = ++this.generation; this.starting = true; this.error = ''; this.status = 'Preparando iPhone por USB…'; this._emit();
    try {
      this.mobile = this.getMobileService && this.getMobileService();
      if (!this.mobile) throw new Error('Abra PHONE CONTROL e conecte o iPhone antes de transmitir.');
      const devices = (await this.mobile.getIosDevices()).filter(d => d.ios || String(d.id).startsWith('ios-')); this._assert(token);
      if (devices.length !== 1) throw new Error('Conecte exatamente um iPhone por USB para transmitir.');
      const device = devices[0];
      if (cfg.deviceId && cfg.deviceId !== device.id) throw new Error('O iPhone selecionado não corresponde ao único dispositivo conectado.');
      this.deviceName = device.name || 'iPhone'; this.deviceId = device.id;
      const state = await this._readState(); this._assert(token);
      if (!ready(state)) throw new Error('A ponte de câmera precisa ser a versão 0.1-39 (transporte camuflado) com os hooks de foto prontos. Use Conectar em PHONE CONTROL para atualizar/preparar o iPhone.');
      const sampleRate = Number(cfg.sampleRate || 48000);
      if (![8000, 11025, 16000, 22050, 24000, 32000, 44100, 48000, 88200, 96000].includes(sampleRate)) throw new Error('Taxa de áudio da fonte não suportada.');
      this.sampleRate = sampleRate; this.fps = Math.max(1, Math.min(30, Math.round(Number(cfg.fps) || 30)));
      this.pcmAt = 0; this.droppedPcm = 0; this.pcmBlocked = false; this.active = false;
      await this.withTransport(() => {
        this._assert(token);
        return this.ensureTransport();
      });
      this._assert(token);
      await this._encoder(token); this._assert(token);
      this.running = true; this.starting = false; this.status = 'Aguardando fonte'; this._emit();
      this.sourceWatch = setInterval(() => this._updateSource(token), 500); this.sourceWatch.unref();
      return { ok: true, deviceName: this.deviceName, sampleRate };
    } catch (error) {
      if (token === this.generation) { this.error = error.message; this.starting = false; this.running = false; await this._cleanup(); this.status = 'Pronto'; this._emit({ finished: true }); }
      return { ok: false, error: error.message };
    }
  }
  _sshArgs(forward) {
    return ['-p', '2222', ...iphoneSsh.sshOptions(), '-v', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=5', '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=5', '-o', 'ServerAliveCountMax=2', '-N', '-R', forward, 'mobile@127.0.0.1'];
  }
  _openForward(args) {
    return new Promise((resolve, reject) => {
      const child = this.spawnProcess(require('./tool-paths').ssh(), args, { stdio: ['ignore', 'ignore', 'pipe'] }); child.novaAbort = false; this.tunnel = child;
      let confirmed = false, settled = false, stderr = '';
      const close = () => { if (this.tunnel === child) this.tunnel = null; try { child.kill(); } catch (_) {} };
      const fail = error => {
        if (!settled) { settled = true; clearTimeout(timer); close(); reject(error); }
        else if (confirmed) { close(); this._fail(error, this.generation); }
      };
      const timer = setTimeout(() => { fail(new Error('O túnel USB não confirmou a conexão. Use Conectar em PHONE CONTROL.')); }, 8000);
      child.stderr.on('data', bytes => {
        stderr = (stderr + bytes.toString()).slice(-4096);
        if (!settled && stderr.includes('remote forward success')) { confirmed = true; settled = true; clearTimeout(timer); resolve(); }
      });
      child.once('error', () => fail(new Error('Não foi possível iniciar o túnel SSH por USB. Use Conectar em PHONE CONTROL.')));
      child.once('exit', () => { if (child.novaAbort) return; fail(new Error(stderr.includes('remote port forwarding failed') || stderr.includes('remote forward failure') ? 'O endereço de câmera do iPhone está ocupado por outra transmissão. Encerre-a antes de iniciar o CAM LIVE.' : 'O túnel USB foi encerrado. Reconecte o iPhone em PHONE CONTROL.')); });
    });
  }
  async _tunnel() {
    const localPort = this.media.server.address().port;
    this.transport = await this._camouflagedForward(localPort);
    this.frameUrl = this.transport.type === 'unix'
      ? `http://127.0.0.1${this.media.framePath}`
      : `http://127.0.0.1:${this.transport.port}${this.media.framePath}`;
  }
  // 1º: socket Unix no iPhone (nenhuma porta TCP escutando). 2º: porta aleatória.
  async _camouflagedForward(localPort) {
    const socketPath = `/var/tmp/.nb-${crypto.randomBytes(4).toString('hex')}.sock`;
    this.socketPath = socketPath;
    try {
      await this._openForward(this._sshArgs(`${socketPath}:127.0.0.1:${localPort}`));
      const check = await this.mobile.iosSsh(`chmod 666 ${quote(socketPath)} && test -S ${quote(socketPath)} && echo ok`);
      if (!check || !check.ok || !String(check.stdout || '').includes('ok')) throw new Error('O iPhone não aceitou o socket Unix.');
      return { type: 'unix', path: socketPath };
    } catch (_) {
      if (this.tunnel) { this.tunnel.novaAbort = true; try { this.tunnel.kill(); } catch (__) {} this.tunnel = null; }
      this.mobile.iosSsh(`rm -f ${quote(socketPath)}`).catch(() => {});
      this.socketPath = null;
      return this._tcpForward(localPort);
    }
  }
  async _tcpForward(localPort, attempts = 3) {
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const port = 20000 + crypto.randomInt(0, 20000);
      try {
        await this._openForward(this._sshArgs(`127.0.0.1:${port}:127.0.0.1:${localPort}`));
        this.remotePort = port;
        return { type: 'tcp', port };
      } catch (error) { lastError = error; }
    }
    throw lastError || new Error('Não foi possível abrir o túnel do iPhone.');
  }
  async _encoder(token) {
    const ffmpeg = this.ffmpegPath || require('./tool-paths').ffmpeg();
    if (!ffmpeg) throw new Error('FFmpeg não está incluído no Nova. Reinstale o aplicativo completo.');
    const child = this.spawnProcess(ffmpeg, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-probesize', '32', '-analyzeduration', '0', '-f', 's16le', '-ar', String(this.sampleRate), '-ac', '1', '-i', 'pipe:0', '-vn', '-c:a', 'aac', '-profile:a', 'aac_low', '-ar', '44100', '-ac', '1', '-b:a', '96k', '-flush_packets', '1', '-f', 'adts', 'pipe:1'], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.encoder = child; this.encoderError = '';
    const parser = new AdtsParser(packet => { if (token !== this.generation || !this.media) return; this.media.audioPacket(packet); this._updateSource(token); });
    child.stdout.on('data', data => { if (token !== this.generation) return; try { parser.push(data); } catch (e) { this._fail(e, token); } });
    child.stderr.on('data', data => { this.encoderError = (this.encoderError + data.toString()).slice(-2048); });
    child.stdin.on('drain', () => { this.pcmBlocked = false; });
    child.stdin.on('error', () => this._fail(new Error('A entrada de áudio do CAM LIVE foi interrompida.'), token));
    await new Promise((resolve, reject) => {
      let spawned = false;
      child.once('spawn', () => { spawned = true; resolve(); });
      child.once('error', () => { const error = new Error('Não foi possível iniciar o encoder de áudio incluído no Nova.'); if (spawned) this._fail(error, token); else reject(error); });
      child.once('exit', () => { const error = new Error('O encoder de áudio do CAM LIVE foi encerrado.' + (this.encoderError ? ' ' + this.encoderError : '')); if (spawned) this._fail(error, token); else reject(error); });
    });
  }
  frame(data) {
    if (!this.running || !this.media) return { ok: false, error: 'A transmissão USB ainda não está preparada.' };
    let result;
    try { result = this.media.frame(data); } catch (_) { return { ok: false, error: 'Quadro JPEG inválido.' }; }
    if (result.ok) this._updateSource(this.generation);
    return result;
  }
  async pcm({ data, sampleRate } = {}) {
    if (!this.running || !this.encoder || !this.encoder.stdin || this.encoder.stdin.destroyed) return { ok: false, error: 'O encoder de áudio não está preparado.' };
    if (Number(sampleRate) !== this.sampleRate) return { ok: false, error: 'A taxa do áudio mudou. Pare e inicie novamente o CAM LIVE.' };
    let bytes; try { if (!Buffer.isBuffer(data) && !(data instanceof Uint8Array)) throw new Error(); bytes = Buffer.from(data); } catch (_) { return { ok: false, error: 'PCM inválido.' }; }
    if (bytes.length < 2 || bytes.length % 2 || bytes.length > 64 * 1024) return { ok: false, error: 'Bloco de áudio PCM inválido ou excessivo.' };
    const input = this.encoder.stdin, token = this.generation;
    if (this.pcmWaiting) return { ok: false, backpressure: true, error: 'Já existe um bloco de áudio aguardando o encoder.' };
    if (this.pcmBlocked || input.writableLength > 128 * 1024) {
      this.pcmWaiting = true;
      const drained = await new Promise(resolve => {
        const finish = ok => { clearTimeout(timer); input.removeListener('drain', onDrain); input.removeListener('close', onClose); input.removeListener('error', onClose); resolve(ok); };
        const onDrain = () => finish(true), onClose = () => finish(false);
        const timer = setTimeout(() => finish(false), 500);
        input.once('drain', onDrain); input.once('close', onClose); input.once('error', onClose);
      });
      this.pcmWaiting = false;
      if (!drained || token !== this.generation || !this.running || input.destroyed) { this.droppedPcm++; return { ok: false, backpressure: true, error: 'O encoder não liberou o áudio em 500 ms. Pare e inicie novamente o CAM LIVE.' }; }
      this.pcmBlocked = false;
    }
    try { this.pcmBlocked = !this.encoder.stdin.write(bytes); this.pcmAt = Date.now(); return { ok: true, backpressure: this.pcmBlocked }; }
    catch (_) { return { ok: false, error: 'Não foi possível enviar o áudio ao encoder.' }; }
  }
  _updateSource(token) {
    if (!this.running || token !== this.generation || !this.media) return;
    const active = this.media.freshFrame() && this.media.freshAudio() &&
      !!this.pcmAt && Date.now() - this.pcmAt <= 2000;
    if (active === this.active) return;
    this.active = active;
    this.status = active ? 'AO VIVO' : 'Aguardando fonte';
    this._emit();
  }
  async _fail(error, token) {
    if (token !== this.generation || this.failing) return;
    this.failing = true; this.error = error.message || String(error); await this.stop(); this.failing = false; this._emit({ finished: true });
  }
  async _cleanup() {
    clearInterval(this.sourceWatch); this.sourceWatch = null;
    // Sem isto, um CAM LIVE que morre deixa o controle em "inject" apontando para
    // um túnel morto: a Câmera do iPhone fica preta e a próxima transmissão não entra.
    try { await this.getMobileService?.()?.iosCamera?.().writeControl?.({ mode: 'observe' }); } catch (_) {}
    const encoder = this.encoder;
    this.encoder = null; this.active = false;
    encoder?.kill();
    await this.withTransport(async () => {
      this.media?.clearSource();
      if (!this.cameraEnabled || !this.tunnel) await this.closeTransport();
    });
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
