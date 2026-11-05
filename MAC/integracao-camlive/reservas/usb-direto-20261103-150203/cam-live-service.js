'use strict';
/**
 * CAM LIVE — serviço do processo principal (reconstrução em JS do MiniOBS: RTMPClient + RTMPOutput + FLV + AMF0).
 * O renderer captura/compõe/codifica (WebCodecs H.264) e manda os pacotes aqui; este arquivo conecta no servidor RTMP
 * (sem ffmpeg), mantém a fila com descarte por prioridade, o bitrate dinâmico (DBR) e a reconexão automática.
 *
 * Canais IPC:
 *   invoke  camlive:start   (settings)  -> {ok}      começa a conectar
 *   invoke  camlive:stop                -> {ok}      para (envia o fim de sequência)
 *   invoke  camlive:studio-load         -> json|null
 *   invoke  camlive:studio-save (json)  -> {ok}
 *   send    camlive:avcc    (Uint8Array)             AVCDecoderConfigurationRecord do encoder
 *   send    camlive:packet  ({data,ptsUs,key})       pacote H.264 em AVCC
 *   send    camlive:aasc    (Uint8Array)             AudioSpecificConfig do AAC
 *   send    camlive:apacket ({data,ptsUs})           pacote AAC bruto
 *   send    camlive:log     (texto)
 *   evento  camlive:status / camlive:stats / camlive:set-bitrate / camlive:keyframe
 */
const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const nowMs = () => Number(process.hrtime.bigint() / 1000000n);
const nowNs = () => process.hrtime.bigint();

// ───────────────────────── AMF0 ─────────────────────────
class ByteWriter {
  constructor() { this.parts = []; }
  u8(v) { this.parts.push(Buffer.from([v & 0xff])); return this; }
  u16(v) { const b = Buffer.alloc(2); b.writeUInt16BE(v); this.parts.push(b); return this; }
  u24(v) { this.parts.push(Buffer.from([(v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff])); return this; }
  u32(v) { const b = Buffer.alloc(4); b.writeUInt32BE(v >>> 0); this.parts.push(b); return this; }
  u32le(v) { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); this.parts.push(b); return this; }
  bytes(buf) { this.parts.push(Buffer.from(buf.buffer ? Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength) : buf)); return this; }
  str16(s) { const d = Buffer.from(s, 'utf8'); this.u16(d.length); this.parts.push(d); return this; }
  amf(v) {
    if (v === null) return this.u8(0x05);
    if (v === undefined) return this.u8(0x06);
    if (typeof v === 'number') { this.u8(0x00); const b = Buffer.alloc(8); b.writeDoubleBE(v); this.parts.push(b); return this; }
    if (typeof v === 'boolean') return this.u8(0x01).u8(v ? 1 : 0);
    if (typeof v === 'string') return this.u8(0x02).str16(v);
    if (v && v.__ecma) { this.u8(0x08).u32(Object.keys(v.props).length); return this._props(v.props); }
    this.u8(0x03); return this._props(v);
  }
  _props(o) { for (const k of Object.keys(o)) { this.str16(k); this.amf(o[k]); } return this.u16(0).u8(0x09); }
  get data() { return Buffer.concat(this.parts); }
}
const ecma = (props) => ({ __ecma: true, props });

class AMFReader {
  constructor(buf) { this.b = buf; this.p = 0; }
  get left() { return this.b.length - this.p; }
  value() {
    if (this.left < 1) return undefined;
    const m = this.b[this.p++];
    switch (m) {
      case 0x00: { if (this.left < 8) return undefined; const v = this.b.readDoubleBE(this.p); this.p += 8; return v; }
      case 0x01: return this.b[this.p++] !== 0;
      case 0x02: { const n = this.b.readUInt16BE(this.p); this.p += 2; const s = this.b.toString('utf8', this.p, this.p + n); this.p += n; return s; }
      case 0x03: return this._props();
      case 0x05: return null;
      case 0x06: return undefined;
      case 0x08: this.p += 4; return this._props();
      case 0x0a: { const n = this.b.readUInt32BE(this.p); this.p += 4; const a = []; for (let i = 0; i < n; i++) a.push(this.value()); return a; }
      case 0x0c: { const n = this.b.readUInt32BE(this.p); this.p += 4; const s = this.b.toString('utf8', this.p, this.p + n); this.p += n; return s; }
      default: return undefined;
    }
  }
  _props() {
    const o = {};
    while (this.left >= 3) {
      const n = this.b.readUInt16BE(this.p); this.p += 2;
      if (n === 0) { this.p++; return o; }
      const k = this.b.toString('utf8', this.p, this.p + n); this.p += n;
      o[k] = this.value();
    }
    return o;
  }
}

// ───────────────────────── FLV (corpo das tags de vídeo) ─────────────────────────
const FLV = {
  sequenceHeader: (avcC) => Buffer.concat([Buffer.from([0x17, 0x00, 0, 0, 0]), Buffer.from(avcC)]),
  frame: (p) => Buffer.concat([Buffer.from([p.key ? 0x17 : 0x27, 0x01, 0, 0, 0]), Buffer.from(p.data)]),   // sem B-frames: cts = 0
  endOfSequence: () => Buffer.from([0x17, 0x02, 0, 0, 0]),
  audioSeq: (asc) => Buffer.concat([Buffer.from([0xaf, 0x00]), Buffer.from(asc)]),          // AAC-LC 48 kHz estéreo: 0xAF
  audio: (data) => Buffer.concat([Buffer.from([0xaf, 0x01]), Buffer.from(data)]),
};

// ───────────────────────── Cliente RTMP (publicação) ─────────────────────────
function parseTarget(url, key) {
  const m = /^(rtmps?):\/\/([^/:]+)(?::(\d+))?(?:\/(.*))?$/i.exec(String(url || '').trim());
  if (!m) throw new Error(`URL inválida '${url}'`);
  const scheme = m[1].toLowerCase();
  if (scheme === 'rtmps') throw new Error('rtmps ainda não é suportado (use rtmp://)');
  const port = m[3] ? parseInt(m[3], 10) : 1935;
  const app = (m[4] || '').replace(/\/+$/, '');
  return { host: m[2], port, app, key, tcUrl: `${scheme}://${m[2]}:${port}/${app}` };
}

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
      this.sock = sock; sock.setNoDelay(true);
      const to = setTimeout(() => { this.lastErrno = 'ETIMEDOUT'; sock.destroy(new Error('connect timeout (30s)')); }, 30000);
      let settled = false;
      const fail = (e) => { if (!settled) { settled = true; clearTimeout(to); reject(e); } };
      sock.on('error', (e) => { this.lastErrno = e.code || String(e.message); fail(e); this._closed(); });
      sock.on('close', () => { fail(new Error('conexão fechada')); this._closed(); });
      sock.on('data', (d) => { this.rb = this.rb.length ? Buffer.concat([this.rb, d]) : d; try { this._pump(); } catch (e) { this.log(`[rtmp] parser: ${e.message}`); } });
      sock.once('connect', async () => {
        try {
          await this._handshake();
          await this._write(new ByteWriter().u32(this.outChunk).data, 1, 2, 0, 0);          // set chunk size
          const res = await this._command('connect', [{
            app: t.app, type: 'nonprivate', flashVer: 'FMLE/3.0 (compatible; FMSc/1.0)', swfUrl: t.tcUrl, tcUrl: t.tcUrl }], true);
          const code = res && res[res.length - 1] && res[res.length - 1].code;
          if (code && code !== 'NetConnection.Connect.Success') throw new Error(`connect recusado: ${code}`);
          await this._command('releaseStream', [null, t.key], false);
          await this._command('FCPublish', [null, t.key], false);
          const cs = await this._command('createStream', [null], true);
          const sid = cs[cs.length - 1];
          if (typeof sid !== 'number') throw new Error('createStream sem id');
          this.streamId = sid;
          await this._command('publish', [null, t.key, 'live'], false, 4, this.streamId);
          this.connectTimeMs = nowMs() - t0;
          if (!settled) { settled = true; clearTimeout(to); resolve(); }
        } catch (e) { fail(e); this.close(); }
      });
    });
  }

  _closed() { if (this.closed) return; this.closed = true; for (const [, p] of this.pending) { clearTimeout(p.t); p.reject(new Error('conexão fechada')); } this.pending.clear(); if (this.onClose) this.onClose(); }

  close() {
    if (!this.sock) return;
    const s = this.sock;
    try {
      if (this.streamId && !s.destroyed && s.writable) {
        s.write(this._msg(new ByteWriter().amf('FCUnpublish').amf(++this.txid).amf(null).data, 20, 4, this.streamId, 0));
        s.write(this._msg(new ByteWriter().amf('deleteStream').amf(++this.txid).amf(null).amf(this.streamId).data, 20, 3, 0, 0));
      }
    } catch (_) {}
    this.streamId = 0;
    s.end(); setTimeout(() => s.destroy(), 300);
  }

  // ---- handshake ----
  _handshake() {
    return new Promise((resolve, reject) => {
      const c1 = crypto.randomBytes(1536); c1.fill(0, 0, 8);
      this.sock.write(Buffer.concat([Buffer.from([0x03]), c1]));
      this.phase = 'hs';
      this.hsWait = { resolve, reject };
    });
  }

  // ---- escrita ----
  _msg(payload, type, csid, streamId, ts) {
    const w = new ByteWriter();
    const ext = ts >= 0xffffff;
    w.u8(csid & 0x3f).u24(ext ? 0xffffff : ts).u24(payload.length).u8(type).u32le(streamId);
    if (ext) w.u32(ts);
    let off = 0, first = true;
    while (off < payload.length || first) {
      if (!first) { w.u8(0xc0 | (csid & 0x3f)); if (ext) w.u32(ts); }
      const n = Math.min(this.outChunk, payload.length - off);
      if (n > 0) w.bytes(payload.subarray(off, off + n));
      off += n; first = false;
    }
    return w.data;
  }
  _write(payload, type, csid, streamId, ts) { return this.send(this._msg(payload, type, csid, streamId, ts)); }
  /** Escrita serializada; resolve quando o kernel aceitou os bytes (é a medida de send_beg/send_end do DBR). */
  send(buf) {
    return new Promise((resolve, reject) => {
      if (!this.sock || this.sock.destroyed || !this.sock.writable) { this.lastErrno = this.lastErrno || 'EPIPE'; return reject(new Error('socket fechado')); }
      this.sock.write(buf, (err) => {
        if (err) { this.lastErrno = err.code || String(err.message); return reject(err); }
        if (this.throttleKbps > 0) setTimeout(resolve, buf.length * 8 / this.throttleKbps);   // só teste: emula link lento
        else resolve();
      });
    });
  }
  _command(name, args, wait, csid = 3, streamId = 0) {
    const id = ++this.txid;
    const w = new ByteWriter().amf(name).amf(id);
    for (const a of args) w.amf(a);
    const p = wait ? new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.pending.delete(id); reject(new Error(`sem resposta para ${name}`)); }, 10000);
      this.pending.set(id, { resolve, reject, t });
    }) : null;
    return this._write(w.data, 20, csid, streamId, 0).then(() => p || []);
  }
  sendMetadata(width, height, fps, kbps, audio) {
    const props = { duration: 0, fileSize: 0, width, height, videocodecid: 7, videodatarate: kbps, framerate: fps, encoder: 'CAM LIVE (reconstrução do MiniOBS)' };
    if (audio) Object.assign(props, { audiocodecid: 10, audiosamplerate: 48000, audiosamplesize: 16, audiochannels: 2, stereo: true, audiodatarate: audio });
    const w = new ByteWriter().amf('@setDataFrame').amf('onMetaData').amf(ecma(props));
    return this._write(w.data, 18, 4, this.streamId, 0);
  }
  sendVideo(body, tsMs) { return this._write(body, 9, 6, this.streamId, tsMs >>> 0); }
  sendAudio(body, tsMs) { return this._write(body, 8, 5, this.streamId, tsMs >>> 0); }

  // ---- leitura ----
  _pump() {
    if (this.phase === 'hs') {
      if (this.rb.length < 1 + 1536 + 1536) return;
      if (this.rb[0] !== 0x03) { const r = this.hsWait; this.hsWait = null; this.phase = 'dead'; return r.reject(new Error(`versão de handshake inesperada ${this.rb[0]}`)); }
      const s1 = this.rb.subarray(1, 1537);
      this.sock.write(Buffer.from(s1));                       // C2 = eco de S1
      this.rb = this.rb.subarray(1 + 1536 + 1536);
      this.phase = 'chunks';
      const r = this.hsWait; this.hsWait = null; r.resolve();
    }
    if (this.phase !== 'chunks') return;
    for (;;) if (!this._parseChunk()) break;
  }

  _parseChunk() {
    const b = this.rb; let p = 0;
    if (b.length < 1) return false;
    const b0 = b[p++]; const fmt = b0 >> 6; let csid = b0 & 0x3f;
    if (csid === 0) { if (b.length < p + 1) return false; csid = b[p++] + 64; }
    else if (csid === 1) { if (b.length < p + 2) return false; csid = b[p] + b[p + 1] * 256 + 64; p += 2; }
    const st = this.inState.get(csid) || { ts: 0, len: 0, type: 0, sid: 0, delta: 0, ext: false, parts: [], got: 0 };
    let ts = 0;
    if (fmt <= 2) {
      if (b.length < p + 3) return false;
      ts = (b[p] << 16) | (b[p + 1] << 8) | b[p + 2]; p += 3;
      if (fmt <= 1) { if (b.length < p + 4) return false; st.len = (b[p] << 16) | (b[p + 1] << 8) | b[p + 2]; st.type = b[p + 3]; p += 4; }
      if (fmt === 0) { if (b.length < p + 4) return false; st.sid = b.readUInt32LE(p); p += 4; }
      st.ext = ts === 0xffffff;
      if (st.ext) { if (b.length < p + 4) return false; ts = b.readUInt32BE(p); p += 4; }
      if (fmt === 0) { st.ts = ts; st.delta = 0; } else { st.delta = ts; st.ts = (st.ts + ts) >>> 0; }
    } else if (st.ext) { if (b.length < p + 4) return false; p += 4; }
    const need = Math.min(this.inChunk, st.len - st.got);
    if (b.length < p + need) return false;
    if (need > 0) { st.parts.push(Buffer.from(b.subarray(p, p + need))); st.got += need; }
    p += need; this.bytesIn += need;
    this.inState.set(csid, st);
    this.rb = b.subarray(p);
    if (st.got >= st.len) { const payload = Buffer.concat(st.parts); st.parts = []; st.got = 0; this._message(st.type, payload); }
    if (this.bytesIn - this.lastAck >= 2500000) { this.lastAck = this.bytesIn; this._write(new ByteWriter().u32(this.bytesIn >>> 0).data, 3, 2, 0, 0).catch(() => {}); }
    return true;
  }

  _message(type, payload) {
    switch (type) {
      case 1: if (payload.length >= 4) this.inChunk = payload.readUInt32BE(0); break;
      case 4: if (payload.length >= 6 && payload.readUInt16BE(0) === 6) this._write(new ByteWriter().u16(7).u32(payload.readUInt32BE(2)).data, 4, 2, 0, 0).catch(() => {}); break;
      case 6: if (payload.length >= 4) this._write(new ByteWriter().u32(payload.readUInt32BE(0)).data, 5, 2, 0, 0).catch(() => {}); break;
      case 20: {
        const r = new AMFReader(payload); const vals = [];
        while (r.left > 0) { vals.push(r.value()); if (vals.length > 12) break; }
        const name = vals[0];
        if ((name === '_result' || name === '_error') && typeof vals[1] === 'number') {
          const pend = this.pending.get(vals[1]);
          if (pend) { clearTimeout(pend.t); this.pending.delete(vals[1]); name === '_error' ? pend.reject(new Error(`_error ${(vals[vals.length - 1] || {}).code || ''}`)) : pend.resolve(vals.slice(1)); }
        } else if (name === 'onStatus') {
          this.log(`[rtmp] onStatus ${(vals[vals.length - 1] || {}).code || '?'}`);
        }
        break;
      }
      default: break;
    }
  }
}

// ───────────────────────── Saída RTMP (rtmp_output do obs-outputs) ─────────────────────────
const MIN_PACKETS = 5, DBR_TRIGGER_US = 200000, DBR_INC_TIMER_MS = 4000, DBR_MIN_BR = 50, DBR_MIN_EST_MS = 1000, DBR_MAX_EST_MS = 2000;

class RtmpOutput {
  /** s: {url,key,dropMs,pframeDropMs,dyn,bitrate,width,height,fps,maxShutdownSec} */
  constructor(s, hooks) {
    this.s = s; this.hooks = hooks; this.log = hooks.log || (() => {});
    this.client = null; this.packets = []; this.waiter = null;
    this.connecting = false; this.active = false; this.disconnected = false; this.stopEvent = false;
    this.sentHeaders = false; this.gotFirst = false; this.startDtsMs = 0; this.minPriority = 0;
    this.congestion = 0; this.lastDtsUs = 0; this.totalBytes = 0; this.dropped = 0; this.avcC = null; this.asc = null; this.audioHdr = false; this.needKey = true;
    this.dbr = { frames: [], size: 0, incTimeout: 0, est: 0, orig: 0, prev: 0, cur: 0, inc: 0, on: false };
    this.sendDone = null;
  }
  get isActive() { return this.active; }
  get currentBitrate() { return this.dbr.cur || this.s.bitrate; }

  /** rtmp_stream_start → thread de conexão (FUN_3962c) */
  async start() {
    const s = this.s; this.connecting = true;
    this.disconnected = false; this.sentHeaders = false; this.audioHdr = false; this.gotFirst = false; this.minPriority = 0; this.needKey = true;
    this.dropped = 0; this.totalBytes = 0;
    this.dropUs = s.dropMs * 1000; this.pDropUs = Math.max(s.pframeDropMs, s.dropMs + 200) * 1000;
    const d = this.dbr; d.frames = []; d.size = 0; d.incTimeout = 0; d.est = 0; d.prev = 0;
    d.orig = d.cur = s.bitrate; d.inc = Math.floor(s.bitrate / 10); d.on = !!s.dyn;
    if (d.on) { this.log("[rtmp stream: 'CAM LIVE'] Dynamic bitrate using default interpolation"); this.log("[rtmp stream: 'CAM LIVE'] Dynamic bitrate enabled.  Dropped frames begone!"); }
    let target;
    try { target = parseTarget(s.url, s.key); } catch (e) { this.log(`[rtmp stream] ${e.message}`); this.connecting = false; return this.hooks.onStopped('badPath', e.message); }
    this.log(`[rtmp stream: 'CAM LIVE'] Connecting to RTMP URL ${target.tcUrl}...`);
    this.client = new RtmpClient(this.log); this.client.throttleKbps = s.throttleKbps || 0;
    try { await this.client.connect(target); }
    catch (e) {
      this.log(`[rtmp stream: 'CAM LIVE'] Connection to ${target.tcUrl} failed: ${e.message}`);
      this.client.close(); this.connecting = false;
      return this.hooks.onStopped('connectFailed', this._errText(e.message));
    }
    this.log(`[rtmp stream: 'CAM LIVE'] Connection to ${target.tcUrl} (${target.host}) successful`);
    this.client.onClose = () => { if (this.active && !this.stopEvent) { this.disconnected = true; this._wake(); } };
    this.packets = []; this.stopEvent = false; this.active = true; this.connecting = false;
    this.hooks.onConnected && this.hooks.onConnected(this.client.connectTimeMs);
    this.sendDone = this._sendLoop();
  }

  /** rtmp_stream_stop */
  async stop() {
    if (this.connecting) { for (let i = 0; i < 300 && this.connecting; i++) await new Promise(r => setTimeout(r, 100)); }
    if (!this.active) { this.hooks.onStopped('success'); return; }
    this.stopEvent = true; this._wake();
    if (this.sendDone) await this.sendDone;
  }

  _wake() { if (this.waiter) { const w = this.waiter; this.waiter = null; w(); } }
  _waitPacket() { return new Promise(r => { this.waiter = r; }); }

  /** encoded_packet (0x38fd0): pacote = {data,dtsUs,key,dropPriority} ou null (erro do encoder) */
  encodedPacket(p) {
    if (this.disconnected || !this.active) return;
    if (!p) { this.encodeError = true; this._wake(); return; }
    if (p.audio) { if (!this.gotFirst) return; this.packets.push(p); this._wake(); return; }   // áudio nunca é descartado (prioridade máxima)
    if (this.needKey) { if (!p.key) { this.hooks.requestKeyframe && this.hooks.requestKeyframe(); return; } this.needKey = false; }
    if (!this.gotFirst) { this.startDtsMs = Math.floor(p.dtsUs / 1000); this.gotFirst = true; }
    this._check(false); this._check(true);
    if (p.dropPriority < this.minPriority) { this.dropped++; return; }
    this.minPriority = 0; this.lastDtsUs = p.dtsUs; this.packets.push(p); this._wake();
  }

  /** check_to_drop_frames (FUN_3ca34) */
  _check(pframes) {
    const priority = pframes ? 3 : 2, threshold = pframes ? this.pDropUs : this.dropUs;
    if (!pframes) this._dbrTryIncrease();
    if (this.packets.length < MIN_PACKETS) { if (!pframes) this.congestion = 0; return; }
    const first = this.packets.find(x => !x.audio && !x.key);
    if (!first) return;
    const dur = this.lastDtsUs - first.dtsUs;
    if (!pframes) this.congestion = dur / threshold;
    const d = this.dbr;
    if (d.on) {
      if (pframes) return;
      let changed = false;
      if (dur >= DBR_TRIGGER_US) changed = this._dbrLowered();
      if (changed) { this.log(`[rtmp stream] buffer_duration_msec: ${Math.floor(dur / 1000)}`); this._dbrSet(); }
      return;
    }
    if (dur > threshold) { this.log(`[rtmp stream] buffer_duration_usec: ${dur}`); this._drop(priority, pframes); }
  }
  _drop(priority, pframes) {
    const kept = this.packets.filter(p => p.dropPriority >= priority);
    const n = this.packets.length - kept.length; this.packets = kept;
    if (this.minPriority < priority) this.minPriority = priority;
    if (n > 0) { this.dropped += n; this.log(`[rtmp stream: 'CAM LIVE'] dropped ${n} frames (${pframes ? 'pframes' : 'all below HIGH'})`); }
  }

  // ---- DBR ----
  _dbrLowered() {
    const d = this.dbr; let nb;
    if (d.est === 0 || d.cur <= d.est) {
      if (!d.prev) return false;
      this.log("[rtmp stream: 'CAM LIVE'] going back to prev bitrate"); nb = d.prev;
    } else { d.frames = []; d.size = 0; nb = Math.max(Math.floor(d.est / 100) * 100, DBR_MIN_BR); }
    if (nb === d.cur) return false;
    d.prev = 0; d.cur = nb; d.incTimeout = nowMs() + DBR_INC_TIMER_MS;
    this.log(`[rtmp stream: 'CAM LIVE'] bitrate decreased to: ${nb}`);
    return true;
  }
  _dbrTryIncrease() {
    const d = this.dbr;
    if (!d.on || !d.incTimeout || nowMs() < d.incTimeout) return;
    d.incTimeout = 0; d.prev = d.cur; d.cur += d.inc;
    if (d.cur < d.orig) { d.incTimeout = nowMs() + DBR_INC_TIMER_MS; this.log(`[rtmp stream: 'CAM LIVE'] bitrate increased to: ${d.cur}, waiting`); }
    else { d.cur = d.orig; this.log(`[rtmp stream: 'CAM LIVE'] bitrate increased to: ${d.cur}, done`); }
    this._dbrSet();
  }
  _dbrSet() { this.hooks.setBitrate && this.hooks.setBitrate(this.dbr.cur); }
  _dbrAdd(f) {
    const d = this.dbr; d.frames.push(f); d.size += f.size;
    const dur = f.end - d.frames[0].beg;
    if (dur >= DBR_MAX_EST_MS) { d.size -= d.frames[0].size; d.frames.shift(); }
    if (dur >= DBR_MIN_EST_MS) { let kbps = dur > 0 ? Math.floor((d.size * 8) / dur) : 0; kbps -= (this.s.audio || 0); if (kbps < DBR_MIN_BR) kbps = DBR_MIN_BR; d.est = kbps; }
  }

  // ---- thread de envio (FUN_3b5dc) ----
  async _sendLoop() {
    let reason = 'success', detail = '';
    try {
      outer: for (;;) {
        if (this.disconnected || this.encodeError) break;
        if (!this.packets.length) { if (this.stopEvent) break; await this._waitPacket(); continue; }
        if (this.stopEvent) break outer;       // parada imediata: o resto da fila é liberado
        const p = this.packets.shift();
        if (!this.sentHeaders) { await this._sendHeaders(); this.sentHeaders = true; }
        if (p.audio) await this._sendAudio(p); else await this._sendPacket(p);
      }
    } catch (e) { this.disconnected = true; detail = e.message; }
    if (this.disconnected) { this.log(`[rtmp stream: 'CAM LIVE'] Disconnected from ${this.s.url}`); reason = 'disconnected'; }
    else if (this.encodeError) { this.log("[rtmp stream: 'CAM LIVE'] Encoder error, disconnecting"); await this._footer(); reason = 'encodeError'; }
    else { this.log("[rtmp stream: 'CAM LIVE'] User stopped the stream"); await this._footer(); }
    const err = this._errText(this.client.lastErrno); if (err) this.log(`[rtmp stream: 'CAM LIVE'] last error: ${err}`);
    this.client.close();
    if (this.dbr.on && this.dbr.cur !== this.dbr.orig) { this.dbr.cur = this.dbr.orig; this._dbrSet(); }
    if (this.packets.length) this.log(`[rtmp stream: 'CAM LIVE'] Freeing ${this.packets.length} remaining packets`);
    this.packets = []; this.active = false; this.stopEvent = false; this.encodeError = false;
    this.hooks.onStopped(reason, detail || err || '');
  }
  async _sendHeaders() {
    if (!this.avcC) throw new Error('Codec not initialized for track 0 while sending header');
    await this.client.sendMetadata(this.s.width, this.s.height, this.s.fps, this.s.bitrate, this.s.audio || 0);
    const h = FLV.sequenceHeader(this.avcC); await this.client.sendVideo(h, 0); this.totalBytes += h.length;
  }
  async _sendAudio(p) {
    if (!this.audioHdr) { if (!this.asc) return; const h = FLV.audioSeq(this.asc); await this.client.sendAudio(h, 0); this.totalBytes += h.length; this.audioHdr = true; }
    const body = FLV.audio(p.data), ts = Math.max(0, Math.floor(p.dtsUs / 1000) - this.startDtsMs);
    const beg = nowMs();
    await this.client.sendAudio(body, ts);
    this.totalBytes += body.length;
    if (this.dbr.on) this._dbrAdd({ beg, end: nowMs(), size: body.length });
  }
  async _sendPacket(p) {
    const body = FLV.frame(p), ts = Math.max(0, Math.floor(p.dtsUs / 1000) - this.startDtsMs);
    const beg = nowMs();
    await this.client.sendVideo(body, ts);
    this.totalBytes += body.length;
    if (this.dbr.on) this._dbrAdd({ beg, end: nowMs(), size: body.length });
  }
  async _footer() { try { await this.client.sendVideo(FLV.endOfSequence(), Math.max(0, Math.floor(this.lastDtsUs / 1000) - this.startDtsMs)); } catch (_) {} }
  _errText(code) {
    switch (code) {
      case null: case undefined: case '': return '';
      case 'ENOTFOUND': case 'EHOSTUNREACH': return 'HostNotFound';
      case 'ECONNRESET': return 'ConnectionReset';
      case 'ETIMEDOUT': return 'ConnectionTimedOut';
      case 'ECONNABORTED': return 'ConnectionAborted';
      case 'EADDRNOTAVAIL': return 'AddressNotAvailable';
      case 'ENETUNREACH': return 'NoRoute';
      case 'EACCES': return 'PermissionDenied';
      case 'ECONNREFUSED': return 'Conexão recusada (o servidor está ligado?)';
      default: return String(code);
    }
  }
}

// ───────────────────────── Orquestração (o papel do Engine) ─────────────────────────
class CamLiveService {
  constructor({ send, studioFile, logFile }) {
    this.sendToRenderer = send; this.studioFile = studioFile; this.logFile = logFile;
    this.output = null; this.cfg = null; this.avcC = null; this.asc = null; this.retries = 0; this.userStop = false; this.status = 'Pronto';
    this.lastBytes = 0; this.statsTimer = null; this.error = '';
  }
  log(msg) {
    const line = `${new Date().toISOString()} ${msg}\n`;
    try { if (this.logFile) fs.appendFileSync(this.logFile, line); } catch (_) {}
    if (process.env.CAMLIVE_DEBUG) console.log('[camlive]', msg);
  }
  _emitStatus(extra) { this.sendToRenderer('camlive:status', Object.assign({ status: this.status, error: this.error }, extra || {})); }

  async start(cfg) {
    if (this.output) return { ok: false, error: 'já está transmitindo' };
    this.cfg = cfg; this.userStop = false; this.retries = 0; this.error = ''; this.lastBytes = 0;
    this.status = 'Conectando…'; this._emitStatus();
    this._newOutput(); this.output.start();
    this.statsTimer = setInterval(() => this._stats(), 1000);
    return { ok: true };
  }
  _newOutput() {
    const c = this.cfg, self = this;
    const prevAvcC = this.avcC;
    this.output = new RtmpOutput(c, {
      log: (m) => this.log(m),
      setBitrate: (k) => this.sendToRenderer('camlive:set-bitrate', { kbps: k }),
      requestKeyframe: () => this.sendToRenderer('camlive:keyframe', {}),
      onConnected: () => { self.status = 'AO VIVO'; self._emitStatus(); },
      onStopped: (reason, detail) => self._stopped(reason, detail),
    });
    this.output.avcC = prevAvcC; this.output.asc = this.asc;
  }
  _stopped(reason, detail) {
    if (this.userStop) return;
    const c = this.cfg;
    if (reason === 'disconnected' || reason === 'connectFailed') {
      if (this.retries >= c.maxRetries) { this.error = `Desistiu depois de ${this.retries} tentativas de reconexão.${detail ? ' (' + detail + ')' : ''}`; return this._finish(); }
      this.retries++;
      this.status = `Reconectando em ${c.retryDelaySec}s (tentativa ${this.retries}/${c.maxRetries})`;
      this.error = detail || ''; this._emitStatus();
      this.log(`Output 'CAM LIVE': Reconnecting in ${c.retryDelaySec} seconds (attempt ${this.retries}/${c.maxRetries})`);
      const o = this.output;
      setTimeout(() => { if (this.output === o && !this.userStop) { this._newOutput(); this.output.start(); } }, c.retryDelaySec * 1000);
    } else if (reason === 'encodeError') { this.error = 'Erro no encoder, transmissão interrompida.'; this._finish(); }
    else if (reason === 'badPath') { this.error = detail || 'Endereço do servidor inválido.'; this._finish(); }
    else this._finish();
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
  audioPacket(p) { const o = this.output; if (!o) return; o.encodedPacket({ data: Buffer.from(p.data), dtsUs: p.ptsUs, ptsUs: p.ptsUs, key: false, audio: true, dropPriority: 4 }); }
  packet(p) {
    const o = this.output; if (!o) return;
    const pr = p.key ? 3 : 2;
    o.encodedPacket({ data: Buffer.from(p.data), dtsUs: p.ptsUs, ptsUs: p.ptsUs, key: !!p.key, dropPriority: pr });
  }
  loadStudio() { try { return JSON.parse(fs.readFileSync(this.studioFile, 'utf8')); } catch (_) { return null; } }
  saveStudio(doc) { try { fs.mkdirSync(path.dirname(this.studioFile), { recursive: true }); fs.writeFileSync(this.studioFile, JSON.stringify(doc, null, 2)); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; } }
}

/** Registra os canais IPC. `getWindow()` devolve a BrowserWindow principal. */
function register({ ipcMain, getWindow, userDataDir }) {
  const dir = path.join(userDataDir, 'CamLive');
  const svc = new CamLiveService({
    send: (ch, payload) => { const w = getWindow && getWindow(); if (w && !w.isDestroyed()) w.webContents.send(ch, payload); },
    studioFile: path.join(dir, 'studio.json'), logFile: path.join(dir, 'camlive.log'),
  });
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  ipcMain.handle('camlive:start', (_e, cfg) => svc.start(cfg));
  ipcMain.handle('camlive:stop', () => svc.stop());
  ipcMain.handle('camlive:studio-load', () => svc.loadStudio());
  ipcMain.handle('camlive:studio-save', (_e, doc) => svc.saveStudio(doc));
  ipcMain.on('camlive:avcc', (_e, buf) => svc.setAvcC(buf));
  ipcMain.on('camlive:packet', (_e, p) => svc.packet(p));
  ipcMain.on('camlive:aasc', (_e, buf) => svc.setAsc(buf));
  ipcMain.on('camlive:apacket', (_e, p) => svc.audioPacket(p));
  ipcMain.on('camlive:log', (_e, msg) => svc.log(String(msg)));
  return svc;
}

module.exports = { register, CamLiveService, RtmpOutput, RtmpClient, AMFReader, ByteWriter, parseTarget, FLV };
