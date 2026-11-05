/* CAM LIVE — mixer de áudio + captura AAC (renderer do Electron / Chromium, sem dependências).
 *
 * REGRA INEGOCIÁVEL: o áudio vem SOMENTE dos arquivos de vídeo/áudio colocados nas cenas
 * (elementos <video>/<audio> ligados com attach). Este módulo NUNCA chama getUserMedia e
 * nunca captura microfone nem o áudio do computador/sistema.
 *
 * API (window.CamLiveAudio):
 *   attach(id, mediaEl) -> bool          liga o elemento ao mixer (createMediaElementSource, só uma vez por elemento)
 *   detach(id)                           desliga e esquece o canal
 *   setParams(id, {volume, muted, visible, monitor})
 *   levels() -> {master: dB, channels: {id: dB}}
 *   resume()                             retoma o AudioContext (chamar em gesto do usuário)
 *   supported() -> Promise<boolean>      AAC-LC 48 kHz estéreo disponível no AudioEncoder?
 *   startCapture({t0Ms, bitrateKbps, onAsc, onPacket, onError}) -> Promise<{ok, error?}>
 *   stopCapture() -> Promise
 */
(function () {
  'use strict';

  var SR = 48000, BLOCK = 1024, WORKLET_FRAMES = 128, FFT = 2048, FLOOR_DB = -100;
  var AAC_CODEC = 'mp4a.40.2';

  var ctx = null;            // AudioContext (preguiçoso)
  var master = null;         // GainNode (soma de todos os canais)
  var masterAn = null;       // AnalyserNode do master
  var channels = {};         // id -> {id, el, src, gain, an, mon, params}
  var sources = new WeakMap(); // elemento -> MediaElementAudioSourceNode (só se cria uma vez por elemento)
  var pending = {};          // parâmetros recebidos antes do attach
  var buf = null;            // Float32Array reutilizado por levels()
  var workletReady = false;
  var cap = null;            // estado da captura em andamento
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

  function defaults(p) {
    p = p || {};
    return {
      volume: typeof p.volume === 'number' && isFinite(p.volume) ? Math.max(0, Math.min(1, p.volume)) : 1,
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

  /* ───────────────────────── mixer ───────────────────────── */

  function attach(id, mediaEl) {
    try {
      if (id === undefined || id === null || !mediaEl) return false;
      id = String(id);
      var cur = channels[id];
      if (cur && cur.el === mediaEl) return true;       // idempotente
      if (cur) detach(id);                               // mesmo id com outro elemento
      ensureCtx();
      var src = sources.get(mediaEl);
      if (!src) { src = ctx.createMediaElementSource(mediaEl); sources.set(mediaEl, src); }
      var gain = ctx.createGain(), an = ctx.createAnalyser(), mon = ctx.createGain();
      an.fftSize = FFT; an.smoothingTimeConstant = 0;
      gain.gain.value = 0; mon.gain.value = 0;
      src.connect(gain);
      gain.connect(an);
      gain.connect(master);
      gain.connect(mon);
      mon.connect(ctx.destination);
      var ch = { id: id, el: mediaEl, src: src, gain: gain, an: an, mon: mon, params: defaults(pending[id]) };
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
      safeDisconnect(ch.src, ch.gain);   // o nó de origem fica no WeakMap para um futuro attach do mesmo elemento
      safeDisconnect(ch.gain); safeDisconnect(ch.an); safeDisconnect(ch.mon);
    } catch (_) {}
  }

  function setParams(id, p) {
    try {
      id = String(id);
      p = p || {};
      var ch = channels[id];
      var base = ch ? ch.params : (pending[id] || defaults());
      var next = {
        volume: p.volume === undefined ? base.volume : defaults({ volume: p.volume }).volume,
        muted: p.muted === undefined ? base.muted : !!p.muted,
        visible: p.visible === undefined ? base.visible : !!p.visible,
        monitor: p.monitor === undefined ? base.monitor : !!p.monitor,
      };
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

  /* ───────────────────────── suporte AAC ───────────────────────── */

  function aacConfig(kbps) {
    return { codec: AAC_CODEC, sampleRate: SR, numberOfChannels: 2, bitrate: (kbps || 128) * 1000, aac: { format: 'aac' } };
  }

  function supported() {
    if (supportedP) return supportedP;
    supportedP = (async function () {
      try {
        if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') return false;
        if (typeof AudioWorkletNode === 'undefined') return false;
        var s = await AudioEncoder.isConfigSupported(aacConfig(128));
        return !!(s && s.supported);
      } catch (_) { return false; }
    })();
    return supportedP;
  }

  /* ───────────────────────── captura / codificação ───────────────────────── */

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

  async function startCapture(opts) {
    var local = null;
    try {
      opts = opts || {};
      if (cap) return { ok: false, error: 'A captura de áudio já está em andamento.' };
      if (!(await supported())) return { ok: false, error: 'Este Electron não codifica áudio AAC (WebCodecs AudioEncoder indisponível).' };
      if (typeof opts.onPacket !== 'function') return { ok: false, error: 'Falta o callback onPacket para receber o áudio codificado.' };
      var t0Ms = typeof opts.t0Ms === 'number' ? opts.t0Ms : performance.now();
      var kbps = opts.bitrateKbps > 0 ? opts.bitrateKbps : 128;

      ensureCtx();
      if (ctx.state === 'suspended') { try { await Promise.race([ctx.resume(), new Promise(function (r) { setTimeout(r, 1500); })]); } catch (_) {} }
      if (ctx.state !== 'running') return { ok: false, error: 'O áudio do navegador está bloqueado até um clique do usuário. Clique na tela e tente transmitir de novo.' };
      await ensureWorklet();

      local = {
        t0Ms: t0Ms, onAsc: opts.onAsc, onPacket: opts.onPacket, onError: opts.onError,
        enc: null, node: null, mute: null, sentAsc: false, base: null, acc: 0, fill: 0,
        L: new Float32Array(BLOCK), R: new Float32Array(BLOCK), stopped: false, failed: null,
        packets: 0, bytes: 0,
      };
      local.enc = new AudioEncoder({
        output: function (chunk, meta) {
          try {
            if (!local.sentAsc && meta && meta.decoderConfig && meta.decoderConfig.description) {
              local.sentAsc = true;
              if (typeof local.onAsc === 'function') local.onAsc(new Uint8Array(meta.decoderConfig.description));
            }
            var data = new Uint8Array(chunk.byteLength); chunk.copyTo(data);
            local.packets++; local.bytes += data.length;
            local.onPacket({ data: data, ptsUs: chunk.timestamp });
          } catch (e) { fail(local, e); }
        },
        error: function (e) { fail(local, e); },
      });
      local.enc.configure(aacConfig(kbps));

      var node = new AudioWorkletNode(ctx, 'camlive-sink', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
        channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers',
      });
      var mute = ctx.createGain(); mute.gain.value = 0;
      node.onprocessorerror = function () { fail(local, new Error('o processador de áudio falhou')); };
      node.port.onmessage = function (ev) { onBlock(local, ev.data); };
      master.connect(node); node.connect(mute); mute.connect(ctx.destination);
      local.node = node; local.mute = mute;
      cap = local;
      return { ok: true };
    } catch (e) {
      if (local) { try { await teardown(local, false); } catch (_) {} }
      if (cap === local) cap = null;
      return { ok: false, error: 'Falha ao iniciar a captura de áudio: ' + msg(e) };
    }
  }

  function fail(c, e) {
    if (c.failed) return;
    c.failed = msg(e);
    try { console.warn('[CamLiveAudio] erro:', c.failed); } catch (_) {}
    try { if (typeof c.onError === 'function') c.onError('Erro no áudio: ' + c.failed); } catch (_) {}
  }

  function onBlock(c, data) {
    if (c.stopped || c.failed || !c.enc || c.enc.state !== 'configured') return;
    if (c.base === null) c.base = performance.now() - WORKLET_FRAMES * 1000 / SR;   // início do primeiro bloco
    var l = data[0], r = data[1], n = l.length, off = 0;
    while (off < n) {
      var take = Math.min(n - off, BLOCK - c.fill);
      c.L.set(l.subarray(off, off + take), c.fill);
      c.R.set(r.subarray(off, off + take), c.fill);
      c.fill += take; off += take;
      if (c.fill === BLOCK) { encodeBlock(c); c.fill = 0; }
    }
  }

  function encodeBlock(c) {
    try {
      var planar = new Float32Array(BLOCK * 2);
      planar.set(c.L, 0); planar.set(c.R, BLOCK);
      var ts = Math.round((c.base - c.t0Ms) * 1000 + c.acc * 1000 / SR);
      var ad = new AudioData({ format: 'f32-planar', sampleRate: SR, numberOfFrames: BLOCK, numberOfChannels: 2, timestamp: ts, data: planar });
      try { c.enc.encode(ad); } finally { ad.close(); }
      c.acc += BLOCK;
    } catch (e) { fail(c, e); }
  }

  async function teardown(c, flush) {
    c.stopped = true;
    try { if (c.node) { c.node.port.onmessage = null; c.node.onprocessorerror = null; } } catch (_) {}
    if (c.node) { safeDisconnect(master, c.node); safeDisconnect(c.node); }
    if (c.mute) safeDisconnect(c.mute);
    try { if (c.node) c.node.port.close(); } catch (_) {}
    var enc = c.enc; c.enc = null;
    if (enc) {
      if (flush && c.fill > 0 && c.base !== null && !c.failed) {      // completa o último bloco com silêncio
        try {
          c.L.fill(0, c.fill); c.R.fill(0, c.fill);
          c.enc = enc; c.stopped = false; encodeBlock(c); c.stopped = true; c.enc = null;
        } catch (_) {}
      }
      if (flush && enc.state === 'configured') { try { await enc.flush(); } catch (_) {} }
      try { if (enc.state !== 'closed') enc.close(); } catch (_) {}
    }
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
