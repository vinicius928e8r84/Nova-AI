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

  function rampa(param, valor, t) {
    try { param.setTargetAtTime(valor, t, 0.008); } catch (_) { param.value = valor; }
  }

  function applyParams(ch) {
    if (!ctx) return;
    var p = ch.params, t = ctx.currentTime;
    rampa(ch.gain.gain, (p.visible && !p.muted) ? p.volume : 0, t);
    rampa(ch.mon.gain, p.monitor ? 1 : 0, t);
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

  function idValido(id) { return id !== undefined && id !== null; }

  function fonteDe(mediaEl) {
    var src = sources.get(mediaEl);
    if (!src) { src = ctx.createMediaElementSource(mediaEl); sources.set(mediaEl, src); }
    return src;
  }

  function criarCanal(id, mediaEl) {
    var src = fonteDe(mediaEl);
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

  function ligarCanal(id, mediaEl) {
    var cur = channels[id];
    if (cur && cur.el === mediaEl) return true;
    if (cur) detach(id);
    ensureCtx();
    var ch = criarCanal(id, mediaEl);
    channels[id] = ch;
    applyParams(ch);
    return true;
  }

  function attach(id, mediaEl) {
    try {
      if (!idValido(id) || !mediaEl) return false;
      return ligarCanal(String(id), mediaEl);
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

  function booleanoOuBase(p, base, nome) { return p[nome] === undefined ? base[nome] : !!p[nome]; }

  function mesclarParams(base, p) {
    return {
      volume: p.volume === undefined ? base.volume : defaults({ volume: p.volume }).volume,
      muted: booleanoOuBase(p, base, 'muted'),
      visible: booleanoOuBase(p, base, 'visible'),
      monitor: booleanoOuBase(p, base, 'monitor'),
    };
  }

  function paramsAtuais(id) {
    var ch = channels[id];
    return ch ? ch.params : (pending[id] || defaults());
  }

  function setParams(id, p) {
    try {
      id = String(id);
      var next = mesclarParams(paramsAtuais(id), p || {});
      var ch = channels[id];
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

  var JA_CAPTURANDO = 'A captura de áudio já está em andamento.';
  var SEM_AAC = 'Este Electron não codifica áudio AAC (WebCodecs AudioEncoder indisponível).';
  var SEM_CALLBACK = 'Falta o callback onPacket para receber o áudio codificado.';
  var AUDIO_BLOQUEADO = 'O áudio do navegador está bloqueado até um clique do usuário. Clique na tela e tente transmitir de novo.';
  var ESPERA_DO_RESUME_MS = 1500;

  function temCallback(opts) { return opts.rawPcm ? typeof opts.onPcm === 'function' : typeof opts.onPacket === 'function'; }

  async function recusaDaCaptura(opts) {
    if (cap) return JA_CAPTURANDO;
    if (!opts.rawPcm && !(await supported())) return SEM_AAC;
    return temCallback(opts) ? null : SEM_CALLBACK;
  }

  function relogioDaCaptura(opts) {
    return {
      t0Ms: typeof opts.t0Ms === 'number' ? opts.t0Ms : performance.now(),
      kbps: opts.bitrateKbps > 0 ? opts.bitrateKbps : 128,
    };
  }

  function esperar(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  async function retomarContexto() {
    if (ctx.state !== 'suspended') return;
    try { await Promise.race([ctx.resume(), esperar(ESPERA_DO_RESUME_MS)]); } catch (_) {}
  }

  function novaCaptura(opts, t0Ms) {
    return {
      rawPcm: !!opts.rawPcm, onPcm: opts.onPcm, t0Ms: t0Ms, onAsc: opts.onAsc, onPacket: opts.onPacket, onError: opts.onError,
      enc: null, node: null, mute: null, sentAsc: false, base: null, acc: 0, fill: 0,
      L: new Float32Array(BLOCK), R: new Float32Array(BLOCK), stopped: false, failed: null,
      packets: 0, bytes: 0,
    };
  }

  function temDescricao(meta) { return Boolean(meta && meta.decoderConfig && meta.decoderConfig.description); }

  function enviarAsc(c, meta) {
    if (c.sentAsc || !temDescricao(meta)) return;
    c.sentAsc = true;
    if (typeof c.onAsc === 'function') c.onAsc(new Uint8Array(meta.decoderConfig.description));
  }

  function aoSairPacote(c, chunk, meta) {
    try {
      enviarAsc(c, meta);
      var data = new Uint8Array(chunk.byteLength); chunk.copyTo(data);
      c.packets++; c.bytes += data.length;
      c.onPacket({ data: data, ptsUs: chunk.timestamp });
    } catch (e) { fail(c, e); }
  }

  function ligarEncoder(c, kbps) {
    c.enc = new AudioEncoder({
      output: function (chunk, meta) { aoSairPacote(c, chunk, meta); },
      error: function (e) { fail(c, e); },
    });
    c.enc.configure(aacConfig(kbps));
  }

  function ligarProcessador(c) {
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

  async function falhaAoIniciar(local, e) {
    if (local) { try { await teardown(local, false); } catch (_) {} }
    if (cap === local) cap = null;
    return { ok: false, error: 'Falha ao iniciar a captura de áudio: ' + msg(e) };
  }

  async function startCapture(opts) {
    var local = null;
    try {
      opts = opts || {};
      var recusa = await recusaDaCaptura(opts);
      if (recusa) return { ok: false, error: recusa };
      var relogio = relogioDaCaptura(opts);
      ensureCtx();
      await retomarContexto();
      if (ctx.state !== 'running') return { ok: false, error: AUDIO_BLOQUEADO };
      await ensureWorklet();
      local = novaCaptura(opts, relogio.t0Ms);
      if (!local.rawPcm) ligarEncoder(local, relogio.kbps);
      ligarProcessador(local);
      cap = local;
      return { ok: true };
    } catch (e) {
      return falhaAoIniciar(local, e);
    }
  }

  function fail(c, e) {
    if (c.failed) return;
    c.failed = msg(e);
    try { console.warn('[CamLiveAudio] erro:', c.failed); } catch (_) {}
    try { if (typeof c.onError === 'function') c.onError('Erro no áudio: ' + c.failed); } catch (_) {}
  }

  function encoderPronto(enc) { return Boolean(enc) && enc.state === 'configured'; }

  function aceitaBloco(c) {
    if (c.stopped || c.failed) return false;
    return c.rawPcm || encoderPronto(c.enc);
  }

  function acumular(c, l, r) {
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
    if (!aceitaBloco(c)) return;
    if (c.base === null) c.base = performance.now() - WORKLET_FRAMES * 1000 / SR;
    acumular(c, data[0], data[1]);
  }

  function paraPcm16(L, R) {
    var pcm = new Int16Array(BLOCK);
    for (var i = 0; i < BLOCK; i++) {
      var sample = Math.max(-1, Math.min(1, (L[i] + R[i]) / 2));
      pcm[i] = Math.round(sample * (sample < 0 ? 32768 : 32767));
    }
    return pcm;
  }

  function codificarAac(c) {
    var planar = new Float32Array(BLOCK * 2);
    planar.set(c.L, 0); planar.set(c.R, BLOCK);
    var ts = Math.round((c.base - c.t0Ms) * 1000 + c.acc * 1000 / SR);
    var ad = new AudioData({ format: 'f32-planar', sampleRate: SR, numberOfFrames: BLOCK, numberOfChannels: 2, timestamp: ts, data: planar });
    try { c.enc.encode(ad); } finally { ad.close(); }
  }

  function encodeBlock(c) {
    try {
      if (c.rawPcm) c.onPcm({data: new Uint8Array(paraPcm16(c.L, c.R).buffer), sampleRate: ctx.sampleRate});
      else codificarAac(c);
      c.acc += BLOCK;
    } catch (e) { fail(c, e); }
  }

  function soltarNo(node) {
    try { node.port.onmessage = null; node.onprocessorerror = null; } catch (_) {}
    safeDisconnect(master, node); safeDisconnect(node);
  }

  function fecharPorta(node) {
    try { node.port.close(); } catch (_) {}
  }

  function desligarProcessador(c) {
    if (c.node) soltarNo(c.node);
    if (c.mute) safeDisconnect(c.mute);
    if (c.node) fecharPorta(c.node);
  }

  function podeCompletar(c) { return c.fill > 0 && c.base !== null && !c.failed; }

  function completarComSilencio(c, enc) {
    if (!podeCompletar(c)) return;
    try {
      c.L.fill(0, c.fill); c.R.fill(0, c.fill);
      c.enc = enc; c.stopped = false; encodeBlock(c); c.stopped = true; c.enc = null;
    } catch (_) {}
  }

  async function esvaziarEncoder(enc) {
    if (enc.state !== 'configured') return;
    try { await enc.flush(); } catch (_) {}
  }

  function fecharSemErro(enc) {
    try { if (enc.state !== 'closed') enc.close(); } catch (_) {}
  }

  async function fecharEncoder(c, enc, flush) {
    if (flush) {
      completarComSilencio(c, enc);
      await esvaziarEncoder(enc);
    }
    fecharSemErro(enc);
  }

  async function teardown(c, flush) {
    c.stopped = true;
    desligarProcessador(c);
    var enc = c.enc; c.enc = null;
    if (enc) await fecharEncoder(c, enc, flush);
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
