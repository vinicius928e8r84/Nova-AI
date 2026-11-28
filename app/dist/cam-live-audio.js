(function () {
  'use strict';

  var SR = 48000, BLOCK = 1024, WORKLET_FRAMES = 128, FFT = 2048, FLOOR_DB = -100;
  var AAC_CODEC = 'mp4a.40.2';

  var ctx = null;
  var master = null;
  var masterAn = null;
  var channels = {};
  var sources = new WeakMap();
  var pending = {};
  var buf = null;
  var workletReady = false;
  var cap = null;
  var supportedP = null;

  function msg(e) { return (e && e.message) ? e.message : String(e); }

  function ensureCtx() {
    if (ctx && ctx.state !== 'closed') return ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error('Este navegador não tem Web Audio (AudioContext).');
    ctx = new AC({ sampleRate: SR, latencyHint: 'interactive' });
    workletReady = false;
    master = ctx.createGain();
    master.channelCount = 2; master.channelCountMode = 'explicit'; master.channelInterpretation = 'speakers';
    masterAn = ctx.createAnalyser(); masterAn.fftSize = FFT; masterAn.smoothingTimeConstant = 0;
    master.connect(masterAn);
    buf = new Float32Array(FFT);
    return ctx;
  }

  function clampVolume(v) {
    return typeof v === 'number' && isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
  }

  function defaults(p) {
    p = p || {};
    return {
      volume: clampVolume(p.volume),
      muted: !!p.muted,
      visible: p.visible === undefined ? true : !!p.visible,
      monitor: !!p.monitor,
    };
  }

  function applyParams(ch) {
    if (!ctx) return;
    var p = ch.params, t = ctx.currentTime;
    var g = (p.visible && !p.muted) ? p.volume : 0;
    try { ch.gain.gain.setTargetAtTime(g, t, 0.008); } catch (_) { ch.gain.gain.value = g; }
    try { ch.mon.gain.setTargetAtTime(p.monitor ? 1 : 0, t, 0.008); } catch (_) { ch.mon.gain.value = p.monitor ? 1 : 0; }
  }

  function peakDb(an) {
    an.getFloatTimeDomainData(buf);
    var pk = 0;
    for (var i = 0; i < buf.length; i++) { var v = buf[i]; if (v < 0) v = -v; if (v > pk) pk = v; }
    if (pk <= 0) return FLOOR_DB;
    var db = 20 * Math.log10(pk);
    return db < FLOOR_DB || !isFinite(db) ? FLOOR_DB : db;
  }

  function safeDisconnect(n, to) { try { if (to) n.disconnect(to); else n.disconnect(); } catch (_) {} }

  function validAttach(id, mediaEl) {
    var semId = id === undefined || id === null;
    return !semId && Boolean(mediaEl);
  }

  function sourceFor(mediaEl) {
    var src = sources.get(mediaEl);
    if (!src) { src = ctx.createMediaElementSource(mediaEl); sources.set(mediaEl, src); }
    return src;
  }

  function buildChannel(id, mediaEl) {
    var src = sourceFor(mediaEl);
    var gain = ctx.createGain(), an = ctx.createAnalyser(), mon = ctx.createGain();
    an.fftSize = FFT; an.smoothingTimeConstant = 0;
    gain.gain.value = 0; mon.gain.value = 0;
    src.connect(gain);
    gain.connect(an);
    gain.connect(master);
    gain.connect(mon);
    mon.connect(ctx.destination);
    return { id: id, el: mediaEl, src: src, gain: gain, an: an, mon: mon, params: defaults(pending[id]) };
  }

  function attach(id, mediaEl) {
    try {
      if (!validAttach(id, mediaEl)) return false;
      id = String(id);
      var cur = channels[id];
      if (cur && cur.el === mediaEl) return true;
      if (cur) detach(id);
      ensureCtx();
      var ch = buildChannel(id, mediaEl);
      channels[id] = ch;
      applyParams(ch);
      return true;
    } catch (e) {
      try { console.warn('[CamLiveAudio] attach falhou:', msg(e)); } catch (_) {}
      return false;
    }
  }

  function detach(id) {
    try {
      id = String(id);
      var ch = channels[id];
      delete pending[id];
      if (!ch) return;
      delete channels[id];
      safeDisconnect(ch.src, ch.gain);
      safeDisconnect(ch.gain); safeDisconnect(ch.an); safeDisconnect(ch.mon);
    } catch (_) {}
  }

  function orBase(value, base, convert) {
    return value === undefined ? base : convert(value);
  }

  function mergeParams(base, p) {
    return {
      volume: orBase(p.volume, base.volume, clampVolume),
      muted: orBase(p.muted, base.muted, Boolean),
      visible: orBase(p.visible, base.visible, Boolean),
      monitor: orBase(p.monitor, base.monitor, Boolean),
    };
  }

  function setParams(id, p) {
    try {
      id = String(id);
      p = p || {};
      var ch = channels[id];
      var base = ch ? ch.params : (pending[id] || defaults());
      var next = mergeParams(base, p);
      if (ch) { ch.params = next; applyParams(ch); } else pending[id] = next;
    } catch (_) {}
  }

  function levels() {
    var out = { master: FLOOR_DB, channels: {} };
    try {
      if (!ctx || ctx.state === 'closed') return out;
      out.master = peakDb(masterAn);
      for (var id in channels) out.channels[id] = peakDb(channels[id].an);
    } catch (_) {}
    return out;
  }

  function resume() {
    try {
      if (!ctx) return Promise.resolve(false);
      if (ctx.state === 'suspended') return ctx.resume().then(function () { return ctx.state === 'running'; }, function () { return false; });
      return Promise.resolve(ctx.state === 'running');
    } catch (_) { return Promise.resolve(false); }
  }

  function aacConfig(kbps) {
    return { codec: AAC_CODEC, sampleRate: SR, numberOfChannels: 2, bitrate: (kbps || 128) * 1000, aac: { format: 'aac' } };
  }

  function webCodecsAvailable() {
    var codec = typeof AudioEncoder !== 'undefined' && typeof AudioData !== 'undefined';
    return codec && typeof AudioWorkletNode !== 'undefined';
  }

  async function aacIsSupported() {
    var s = await AudioEncoder.isConfigSupported(aacConfig(128));
    return !!(s && s.supported);
  }

  async function probeSupport() {
    try { return webCodecsAvailable() && await aacIsSupported(); } catch (_) { return false; }
  }

  function supported() {
    if (supportedP) return supportedP;
    supportedP = probeSupport();
    return supportedP;
  }

  var WORKLET_SRC =
    "class CamLiveSink extends AudioWorkletProcessor {\n" +
    "  process(inputs, outputs) {\n" +
    "    var inp = inputs[0], n = 128, l, r;\n" +
    "    if (inp && inp.length > 0 && inp[0] && inp[0].length) { n = inp[0].length; l = inp[0].slice(); r = (inp[1] || inp[0]).slice(); }\n" +
    "    else { l = new Float32Array(n); r = new Float32Array(n); }\n" +
    "    this.port.postMessage([l, r], [l.buffer, r.buffer]);\n" +
    "    return true;\n" +
    "  }\n" +
    "}\n" +
    "registerProcessor('camlive-sink', CamLiveSink);\n";

  async function ensureWorklet() {
    if (workletReady) return;
    var url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }));
    try { await ctx.audioWorklet.addModule(url); } finally { try { URL.revokeObjectURL(url); } catch (_) {} }
    workletReady = true;
  }

  var BLOCKED_MESSAGE = 'O áudio do navegador está bloqueado até um clique do usuário. Clique na tela e tente transmitir de novo.';

  function hasCallback(opts) {
    return typeof (opts.rawPcm ? opts.onPcm : opts.onPacket) === 'function';
  }

  async function unlockContext() {
    if (ctx.state === 'suspended') { try { await Promise.race([ctx.resume(), new Promise(function (r) { setTimeout(r, 1500); })]); } catch (_) {} }
    return ctx.state === 'running';
  }

  function newCapture(opts, t0Ms) {
    return {
      rawPcm: !!opts.rawPcm, onPcm: opts.onPcm, t0Ms: t0Ms, onAsc: opts.onAsc, onPacket: opts.onPacket, onError: opts.onError,
      enc: null, node: null, mute: null, sentAsc: false, base: null, acc: 0, fill: 0,
      L: new Float32Array(BLOCK), R: new Float32Array(BLOCK), stopped: false, failed: null,
      packets: 0, bytes: 0,
    };
  }

  function ascOf(meta) {
    var config = meta && meta.decoderConfig;
    return config && config.description;
  }

  function announceAsc(c, meta) {
    if (c.sentAsc || !ascOf(meta)) return;
    c.sentAsc = true;
    if (typeof c.onAsc === 'function') c.onAsc(new Uint8Array(meta.decoderConfig.description));
  }

  function onEncoded(c, chunk, meta) {
    try {
      announceAsc(c, meta);
      var data = new Uint8Array(chunk.byteLength); chunk.copyTo(data);
      c.packets++; c.bytes += data.length;
      c.onPacket({ data: data, ptsUs: chunk.timestamp });
    } catch (e) { fail(c, e); }
  }

  function attachEncoder(c, kbps) {
    c.enc = new AudioEncoder({
      output: function (chunk, meta) { onEncoded(c, chunk, meta); },
      error: function (e) { fail(c, e); },
    });
    c.enc.configure(aacConfig(kbps));
  }

  function attachWorkletNode(c) {
    var node = new AudioWorkletNode(ctx, 'camlive-sink', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
      channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers',
    });
    var mute = ctx.createGain(); mute.gain.value = 0;
    node.onprocessorerror = function () { fail(c, new Error('o processador de áudio falhou')); };
    node.port.onmessage = function (ev) { onBlock(c, ev.data); };
    master.connect(node); node.connect(mute); mute.connect(ctx.destination);
    c.node = node; c.mute = mute;
  }

  async function captureProblem(opts) {
    if (cap) return 'A captura de áudio já está em andamento.';
    if (!opts.rawPcm && !(await supported())) return 'Este Electron não codifica áudio AAC (WebCodecs AudioEncoder indisponível).';
    if (!hasCallback(opts)) return 'Falta o callback onPacket para receber o áudio codificado.';
    return null;
  }

  function startTimeOf(opts) {
    return typeof opts.t0Ms === 'number' ? opts.t0Ms : performance.now();
  }

  function bitrateOf(opts) {
    return opts.bitrateKbps > 0 ? opts.bitrateKbps : 128;
  }

  function wireCapture(c, kbps) {
    if (!c.rawPcm) attachEncoder(c, kbps);
    attachWorkletNode(c);
  }

  async function abortCapture(local, e) {
    if (local) { try { await teardown(local, false); } catch (_) {} }
    if (cap === local) cap = null;
    return { ok: false, error: 'Falha ao iniciar a captura de áudio: ' + msg(e) };
  }

  async function startCapture(opts) {
    var local = null;
    try {
      opts = opts || {};
      var problem = await captureProblem(opts);
      if (problem) return { ok: false, error: problem };
      var t0Ms = startTimeOf(opts);
      var kbps = bitrateOf(opts);

      ensureCtx();
      if (!(await unlockContext())) return { ok: false, error: BLOCKED_MESSAGE };
      await ensureWorklet();

      local = newCapture(opts, t0Ms);
      wireCapture(local, kbps);
      cap = local;
      return { ok: true };
    } catch (e) {
      return abortCapture(local, e);
    }
  }

  function fail(c, e) {
    if (c.failed) return;
    c.failed = msg(e);
    try { console.warn('[CamLiveAudio] erro:', c.failed); } catch (_) {}
    try { if (typeof c.onError === 'function') c.onError('Erro no áudio: ' + c.failed); } catch (_) {}
  }

  function ignoresBlocks(c) {
    if (c.stopped || c.failed) return true;
    var needsEncoder = !c.rawPcm;
    return needsEncoder && (!c.enc || c.enc.state !== 'configured');
  }

  function feedBlock(c, l, r) {
    var n = l.length, off = 0;
    while (off < n) {
      var take = Math.min(n - off, BLOCK - c.fill);
      c.L.set(l.subarray(off, off + take), c.fill);
      c.R.set(r.subarray(off, off + take), c.fill);
      c.fill += take; off += take;
      if (c.fill === BLOCK) { encodeBlock(c); c.fill = 0; }
    }
  }

  function onBlock(c, data) {
    if (ignoresBlocks(c)) return;
    if (c.base === null) c.base = performance.now() - WORKLET_FRAMES * 1000 / SR;
    feedBlock(c, data[0], data[1]);
  }

  function toInt16(mean) {
    var sample = Math.max(-1, Math.min(1, mean));
    return Math.round(sample * (sample < 0 ? 32768 : 32767));
  }

  function emitPcm(c) {
    var pcm = new Int16Array(BLOCK);
    for (var i = 0; i < BLOCK; i++) pcm[i] = toInt16((c.L[i] + c.R[i]) / 2);
    c.onPcm({data: new Uint8Array(pcm.buffer), sampleRate: ctx.sampleRate});
  }

  function encodeAac(c) {
    var planar = new Float32Array(BLOCK * 2);
    planar.set(c.L, 0); planar.set(c.R, BLOCK);
    var ts = Math.round((c.base - c.t0Ms) * 1000 + c.acc * 1000 / SR);
    var ad = new AudioData({ format: 'f32-planar', sampleRate: SR, numberOfFrames: BLOCK, numberOfChannels: 2, timestamp: ts, data: planar });
    try { c.enc.encode(ad); } finally { ad.close(); }
  }

  function encodeBlock(c) {
    try {
      if (c.rawPcm) emitPcm(c); else encodeAac(c);
      c.acc += BLOCK;
    } catch (e) { fail(c, e); }
  }

  function detachWorkletNode(c) {
    try { if (c.node) { c.node.port.onmessage = null; c.node.onprocessorerror = null; } } catch (_) {}
    if (c.node) { safeDisconnect(master, c.node); safeDisconnect(c.node); }
    if (c.mute) safeDisconnect(c.mute);
    try { if (c.node) c.node.port.close(); } catch (_) {}
  }

  function tailPending(c) {
    var hasTail = c.fill > 0 && c.base !== null;
    return hasTail && !c.failed;
  }

  function encodeTail(c, enc) {
    try {
      c.L.fill(0, c.fill); c.R.fill(0, c.fill);
      c.enc = enc; c.stopped = false; encodeBlock(c); c.stopped = true; c.enc = null;
    } catch (_) {}
  }

  async function closeEncoder(c, enc, flush) {
    if (flush && tailPending(c)) encodeTail(c, enc);
    if (flush && enc.state === 'configured') { try { await enc.flush(); } catch (_) {} }
    try { if (enc.state !== 'closed') enc.close(); } catch (_) {}
  }

  async function teardown(c, flush) {
    c.stopped = true;
    detachWorkletNode(c);
    var enc = c.enc; c.enc = null;
    if (enc) await closeEncoder(c, enc, flush);
  }

  async function stopCapture() {
    var c = cap; cap = null;
    if (!c) return { ok: true };
    try { await teardown(c, true); } catch (_) {}
    return { ok: !c.failed, packets: c.packets, bytes: c.bytes, error: c.failed || undefined };
  }

  window.CamLiveAudio = {
    attach: attach, detach: detach, setParams: setParams, levels: levels,
    resume: resume, supported: supported, startCapture: startCapture, stopCapture: stopCapture,
  };
})();
