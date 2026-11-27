'use strict';
const http = require('http');
const crypto = require('crypto');
const { ehBytes, quadroJpeg } = require('./cam-live-iphone-quadro');

const MEDIA_TOKEN = /^[0-9a-f]{32}$/;
const UNAVAILABLE = 'Indisponível';
const MAIOR_SEQUENCIA = 0xffffffffffffffffn;

function responder(res, status, data, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(data) });
  res.end(data);
}

function atenderQuadro(media, res) {
  const frame = media.freshFrame() ? media.latestFrame : media.idleFrame;
  return frame ? responder(res, 200, frame, 'image/jpeg') : responder(res, 503, UNAVAILABLE);
}

function sequenciaValida(texto) {
  if (!/^\d{1,20}$/.test(texto)) return false;
  return BigInt(texto) <= MAIOR_SEQUENCIA;
}

function atenderAudio(media, url, res) {
  const text = url.searchParams.get('after') || '0';
  if (!sequenciaValida(text)) return responder(res, 400, 'Sequência inválida');
  const batch = media.batch(BigInt(text));
  return batch ? responder(res, 200, batch, 'application/octet-stream') : responder(res, 503, UNAVAILABLE);
}

function lerUrl(req) {
  try { return new URL(req.url, 'http://127.0.0.1'); } catch (_) { return null; }
}

function atenderPedido(media, req, res) {
  if (req.method !== 'GET') return responder(res, 405, 'Método não permitido');
  const url = lerUrl(req);
  if (!url) return responder(res, 400, 'URL inválida');
  if (url.pathname === media.framePath) return atenderQuadro(media, res);
  if (url.pathname === media.audioPath) return atenderAudio(media, url, res);
  return responder(res, 404, 'Não encontrado');
}

function registroDeAudio(pacote) {
  const header = Buffer.alloc(10);
  header.writeBigUInt64BE(pacote.sequence);
  header.writeUInt16BE(pacote.data.length, 8);
  return Buffer.concat([header, pacote.data]);
}

function pacoteInvalido() {
  return { ok: false, error: 'Pacote AAC inválido.' };
}

function encerrarServidor(server) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 1000);
    server.close(() => { clearTimeout(timer); resolve(); });
    if (server.closeAllConnections) server.closeAllConnections();
  });
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
    const quadro = quadroJpeg(data);
    if (!quadro.ok) return quadro;
    this.latestFrame = Buffer.from(quadro.bytes); this.frameAt = this.now(); return { ok: true };
  }
  audioPacket(data) {
    if (!ehBytes(data)) return pacoteInvalido();
    const b = Buffer.from(data);
    if (b.length < 1 || b.length > 8192) return pacoteInvalido();
    this.sequence++; this.audio.push({ sequence: this.sequence, data: Buffer.from(b) });
    if (this.audio.length > 96) this.audio.splice(0, this.audio.length - 96);
    this.audioAt = this.now(); return { ok: true };
  }
  freshFrame(maxAge = 1000) { return !!this.latestFrame && this.now() - this.frameAt <= maxAge; }
  freshAudio(maxAge = 1000) { return this.audio.length > 0 && this.now() - this.audioAt <= maxAge; }
  batch(after) {
    if (!this.freshAudio()) return null;
    const records = this.audio.filter((p) => p.sequence > after).slice(-32);
    return Buffer.concat([Buffer.from('OBA1'), ...records.map(registroDeAudio)]);
  }
  async listen() {
    if (this.server) throw new Error('Servidor de mídia já iniciado.');
    this.server = http.createServer((req, res) => atenderPedido(this, req, res));
    this.server.requestTimeout = 3000; this.server.headersTimeout = 3000; this.server.keepAliveTimeout = 1000;
    await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(0, '127.0.0.1', resolve); });
    return this.server.address().port;
  }
  clearSource() { this.latestFrame = null; this.audio = []; }
  async close() {
    const server = this.server; this.server = null;
    this.clearSource();
    if (!server) return;
    await encerrarServidor(server);
  }
}

module.exports = { UsbMedia };
