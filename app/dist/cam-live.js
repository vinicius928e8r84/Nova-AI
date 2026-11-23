/* CAM LIVE — motor + janela (reconstrução em JS do MiniOBS Studio).
 * Roda no renderer do Nova (script clássico, sem React). Isolado em Shadow DOM.
 *  - Itens da lista "Cenas": foto, vídeo, áudio (arquivos do computador), captura de tela, câmera (só vídeo), cor, padrão de teste
 *  - Mixer de áudio só com o áudio dos vídeos/áudios da lista (window.CamLiveAudio) — nunca microfone nem áudio do computador
 *  - Formato de tela (computador/celular, proporção, HD/Full HD, deitado/em pé), compositor em canvas, preview com arrastar/redimensionar
 *  - Encoder H.264 (WebCodecs) + AAC (CamLiveAudio) -> pacotes -> serviço do processo principal (cliente RTMP, fila, DBR, reconexão)
 */
(function () {
  'use strict';
  if (window.__camLive) return;
  window.__camLive = true;

  const bridge = window.electronAPI;
  const hasIpc = !!(bridge && bridge.invoke && bridge.send && bridge.on && bridge.isMobile !== true);
  const ipcLog = (m) => { try { hasIpc && bridge.send('camlive:log', m); } catch (_) {} };
  const audio = () => window.CamLiveAudio || null;

  /* ───────────── ícones (estilo Lucide) ───────────── */
  const { CSS, IC, KINDS, PRESETS, RATIOS } = window.CamLiveDados;
  const { calcDims, defaultDoc, even, idbDel, idbGet, idbKeys, idbPut, mkItem } = window.CamLiveModelo;
  const { HANDLES, ROT_ARC, ROT_HEAD, ROT_OFF, centerOf, cursorFor, hitHandle, insideItem, rad, toLocal, toWorld } = window.CamLiveGeometria;
  const ic = (n, s = 14) => `<svg class="i" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${IC[n]}</svg>`;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ───────────── modelo (lista única de itens) ───────────── */
  // razões no sentido deitado (lado maior / lado menor)
  let P = defaultDoc();
  const R = {
    sel: null, modal: null, streaming: false, starting: false, stopping: false, status: 'Pronto', error: '', liveSince: 0,
    stats: { fps: 0, kbps: 0, dropped: 0, cong: 0, lagged: 0, bitrate: 0 }, lagged: 0, encFrames: 0, lastFrames: 0, lastTick: 0,
    open: false, min: false, loaded: false, srcErr: {}, missing: {}, editing: null, needGesture: false, audioCap: false,
  };
  const G = { x: 120, y: 60, w: 900, h: 620 };
  const MIN_W = 800, MIN_H = 540, PILL_W = 380, PILL_H = 50;

  const scene = () => P.scenes[0];
  const findItem = (id) => scene().items.find((i) => i.id === id);
  const kindLabel = (it) => KINDS[it.kind].label;

  /* ───────────── persistência: studio.json + IndexedDB (arquivos de mídia) ───────────── */
  let saveT = 0;
  const serialize = () => JSON.parse(JSON.stringify(P));
  function save() {
    clearTimeout(saveT);
    saveT = setTimeout(() => {
      const doc = serialize();
      if (hasIpc) bridge.invoke('camlive:studio-save', doc).catch(() => {});
      try { localStorage.setItem('nova-camlive-studio', JSON.stringify(doc)); } catch (_) {}
    }, 400);
  }

  function normalizeDoc(doc) {
    // lista única: junta os itens de eventuais cenas antigas
    const items = []; doc.scenes.forEach((s) => (s.items || []).forEach((i) => items.push(i)));
    const sid = doc.scenes[0].id;
    doc.scenes = [{ id: sid, name: 'Cena 1', items }]; doc.active = sid;
    items.forEach((i) => {
      if (!KINDS[i.kind]) i.kind = 'test';
      if (i.visible === undefined) i.visible = true;
      i.locked = !!i.locked; i.rot = typeof i.rot === 'number' ? i.rot : 0; i.muted = !!i.muted; i.monitor = !!i.monitor; i.loop = i.loop !== false;
      i.volume = typeof i.volume === 'number' ? Math.max(0, Math.min(1, i.volume)) : 1;
      if (i.kind === 'audio') i.frame = null;
      if (!i.name) i.name = KINDS[i.kind].label;
    });
    if (!doc.stream.target) {
      const local = ['rtmp://127.0.0.1:1935/obs', 'rtmp://127.0.0.1:11935/live'].includes(doc.stream.url);
      doc.stream.target = local ? 'iphone' : 'rtmp';
    }
    const v = doc.video, oldW = v.w, oldH = v.h;
    if (!v.fmt || !RATIOS[v.fmt]) { v.fmt = 'pc'; v.orient = 'land'; v.q = oldH >= 1000 || oldW >= 1900 ? 1080 : 720; v.ratio = '16:9'; }
    if (!RATIOS[v.fmt].some((r) => r[0] === v.ratio)) v.ratio = RATIOS[v.fmt][0][0];
    v.q = v.q === 1080 ? 1080 : 720; v.orient = v.orient === 'port' ? 'port' : 'land'; v.fps = v.fps || 30;
    const [nw, nh] = calcDims(v); v.w = nw; v.h = nh;
    if (oldW && oldH && (oldW !== nw || oldH !== nh)) rescaleItems(items, oldW, oldH, nw, nh);
    return doc;
  }
  async function load() {
    let doc = null;
    try { if (hasIpc) doc = await bridge.invoke('camlive:studio-load'); } catch (_) {}
    if (!doc) { try { doc = JSON.parse(localStorage.getItem('nova-camlive-studio')); } catch (_) {} }
    try { if (doc && doc.scenes && doc.scenes.length && doc.video && doc.stream) P = normalizeDoc(doc); } catch (e) { P = defaultDoc(); ipcLog('studio inválido: ' + e.message); }
    R.loaded = true;
    await restoreFiles();
  }
  async function restoreFiles() {
    const items = scene().items;
    await Promise.all(items.filter((i) => KINDS[i.kind].file).map(async (it) => {
      const blob = await idbGet(it.id);
      if (blob) { delete R.missing[it.id]; mountFile(it, blob, false); } else R.missing[it.id] = true;
    }));
    // limpa blobs órfãos
    try { const keys = await idbKeys(); (keys || []).forEach((k) => { if (!items.some((i) => i.id === k)) idbDel(k); }); } catch (_) {}
  }

  /* ───────────── mídia: arquivos e captura ───────────── */
  const rt = new Map();          // id -> {video, img, media, stream, url}
  const shouldPlay = () => R.open || R.streaming;
  const nativeOf = (it) => {
    const r = rt.get(it.id);
    if (it.kind === 'image' && r && r.img && r.img.naturalWidth) return [r.img.naturalWidth, r.img.naturalHeight];
    if ((it.kind === 'video' || it.kind === 'camera' || it.kind === 'screen') && r && r.video && r.video.videoWidth) return [r.video.videoWidth, r.video.videoHeight];
    if (it.kind === 'color') return [P.video.w, P.video.h];
    return KINDS[it.kind].nat || [P.video.w, P.video.h];
  };
  /** mode: 'fit' (ajustar, sem cortar) | 'cover' (preencher, corta) | 'stretch' (esticar) */
  function fitItem(it, mode) {
    if (KINDS[it.kind].noFrame) return;
    const W = P.video.w, H = P.video.h;
    it.fitMode = mode; delete it.rel; it.rot = 0;
    if (mode === 'stretch') { it.frame = { x: 0, y: 0, w: W, h: H }; return; }
    const [nw, nh] = nativeOf(it), s = (mode === 'cover' ? Math.max : Math.min)(W / nw, H / nh), w = nw * s, h = nh * s;
    it.frame = { x: (W - w) / 2, y: (H - h) / 2, w, h };
  }
  /* Tamanho "relativo": quanto o item ocupa em relação ao seu encaixe (Ajustar) no canvas, mais o centro em frações.
     Não depende do formato; por isso trocar de formato e voltar não encolhe nada (antes cada troca multiplicava o tamanho por <1). */
  const containSize = (it, W, H) => { const [nw, nh] = nativeOf(it), s = Math.min(W / nw, H / nh); return [nw * s, nh * s]; };
  function captureRel(it, W, H) {
    if (!it.frame || KINDS[it.kind].noFrame) return;
    W = W || P.video.w; H = H || P.video.h;
    const [cw, ch] = containSize(it, W, H), f = it.frame;
    it.rel = { w: f.w / cw, h: f.h / ch, cx: (f.x + f.w / 2) / W, cy: (f.y + f.h / 2) / H };
  }
  function applyRel(it, W, H) {
    const [cw, ch] = containSize(it, W, H), r = it.rel, w = cw * r.w, h = ch * r.h;
    let x = r.cx * W - w / 2, y = r.cy * H - h / 2;
    if (w <= W) x = Math.max(0, Math.min(x, W - w)); if (h <= H) y = Math.max(0, Math.min(y, H - h));
    it.frame = { x, y, w, h };
  }
  /** Chamado depois que P.video já tem o tamanho novo; oW/oH é o tamanho antigo. */
  function rescaleItems(items, oW, oH, nW, nH) {
    items.forEach((it) => {
      if (!it.frame || KINDS[it.kind].noFrame) return;
      const mode = it.fitMode;
      if (mode === 'fit' || mode === 'cover' || mode === 'stretch') { fitItem(it, mode); return; }   // continua encaixado em qualquer formato
      if (!it.rel) captureRel(it, oW, oH);
      applyRel(it, nW, nH);
    });
  }
  function applyAudio(it) {
    const a = audio(); if (!a || !KINDS[it.kind].av) return;
    try { a.setParams(it.id, { volume: it.volume, muted: it.muted, visible: it.visible, monitor: it.monitor }); } catch (_) {}
  }
  function playMedia(r) {
    const el = r && r.media; if (!el) return;
    const p = el.play(); if (p && p.catch) p.catch(() => { R.needGesture = true; });
  }
  function playAll() { R.needGesture = false; rt.forEach((r) => { if (r.media) playMedia(r); }); }
  function pauseAll() { rt.forEach((r) => { if (r.media) try { r.media.pause(); } catch (_) {} }); }
  function unmount(id) {
    const r = rt.get(id); if (!r) return;
    try { const a = audio(); if (a && r.media) a.detach(id); } catch (_) {}
    if (r.stream) r.stream.getTracks().forEach((t) => t.stop());
    if (r.media) { try { r.media.pause(); r.media.removeAttribute('src'); r.media.load(); } catch (_) {} }
    if (r.video && r.video !== r.media) { try { r.video.pause(); r.video.srcObject = null; } catch (_) {} }
    if (r.url) { try { URL.revokeObjectURL(r.url); } catch (_) {} }
    rt.delete(id);
  }
  /** Cria o elemento de mídia para um item de arquivo (foto/vídeo/áudio). */
  function mountFile(it, blob, fit) {
    unmount(it.id);
    const url = URL.createObjectURL(blob);
    if (it.kind === 'image') {
      const img = new Image(); img.onload = () => { if (fit) fitItem(it, 'fit'); paintDocks(); }; img.src = url; rt.set(it.id, { img, url });
    } else {
      const el = document.createElement(it.kind === 'audio' ? 'audio' : 'video');
      el.loop = it.loop !== false; el.preload = 'auto'; if (it.kind === 'video') el.playsInline = true;   // NÃO usar muted: o áudio vai pelo grafo
      const r = { media: el, video: it.kind === 'video' ? el : null, url }; rt.set(it.id, r);
      el.onloadedmetadata = () => { if (fit && it.kind === 'video') fitItem(it, 'fit'); paintDocks(); };
      el.src = url;
      const a = audio(); if (a) { try { a.attach(it.id, el); } catch (e) { ipcLog('audio.attach: ' + e.message); } applyAudio(it); }
      if (shouldPlay()) playMedia(r);
    }
  }
  async function startCapture(it) {
    if (rt.has(it.id)) return;
    const slot = { video: document.createElement('video'), stream: null, starting: true };
    slot.video.muted = true; slot.video.playsInline = true;
    rt.set(it.id, slot);
    try {
      let stream;
      if (it.kind === 'camera') {
        const v = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: P.video.fps } };
        if (it.deviceId) v.deviceId = { exact: it.deviceId };
        stream = await navigator.mediaDevices.getUserMedia({ video: v, audio: false });
      } else {
        let sid = it.deviceId;
        if (!sid && hasIpc) { const src = await bridge.invoke('screen-recorder:get-sources'); const scr = (src || []).find((s) => /^screen:/.test(s.id)) || (src || [])[0]; sid = scr && scr.id; }
        if (!sid) throw new Error('nenhuma tela encontrada');
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sid, maxFrameRate: P.video.fps } } });
      }
      if (rt.get(it.id) !== slot) { stream.getTracks().forEach((t) => t.stop()); return; }   // removida enquanto abria
      slot.stream = stream; slot.video.srcObject = stream; await slot.video.play();
      delete R.srcErr[it.id];
      if (!it.frame) fitItem(it, 'fit');
      paintDocks();
    } catch (e) {
      R.srcErr[it.id] = (e && e.message) || String(e);
      ipcLog(`fonte '${it.name}': ${R.srcErr[it.id]}`);
      rt.delete(it.id);
      toast(`Não foi possível abrir "${it.name}": ${R.srcErr[it.id]}`);
    }
    slot.starting = false;
  }
  /** Captura só o que está visível (como o OBS desativa fontes fora de cena). */
  function reconcile() {
    const need = new Set();
    scene().items.forEach((it) => { if (it.visible && (it.kind === 'screen' || it.kind === 'camera')) need.add(it.id); });
    for (const [id] of [...rt]) { const it = findItem(id); if (!it) { unmount(id); continue; } if ((it.kind === 'screen' || it.kind === 'camera') && !need.has(id)) unmount(id); }
    scene().items.forEach((it) => { if (need.has(it.id) && !rt.has(it.id) && !R.srcErr[it.id] && (R.open || R.streaming)) startCapture(it); });
  }

  /* ───────────── itens (a lista "Cenas") ───────────── */
  const uniqueName = (base) => { const names = new Set(scene().items.map((i) => i.name)); if (!names.has(base)) return base; let n = 2; while (names.has(base + ' ' + n)) n++; return base + ' ' + n; };
  const baseName = (f) => f.name.replace(/\.[^.]+$/, '') || f.name;
  function kindOfFile(f, hint) {
    const t = (f.type || '').toLowerCase(), n = (f.name || '').toLowerCase();
    if (t.startsWith('image/')) return 'image';
    if (t.startsWith('video/')) return 'video';
    if (t.startsWith('audio/')) return 'audio';
    if (/\.(png|jpe?g|gif|webp|bmp|svg|avif)$/.test(n)) return 'image';
    if (/\.(mp4|m4v|mov|webm|mkv|ogv)$/.test(n)) return 'video';
    if (/\.(mp3|wav|m4a|aac|ogg|oga|opus|flac)$/.test(n)) return 'audio';
    return hint || null;
  }
  function addFile(kind, file) {
    const it = mkItem(kind, uniqueName(baseName(file)), KINDS[kind].noFrame ? null : { x: 0, y: 0, w: P.video.w, h: P.video.h }, { path: file.name });
    scene().items.push(it); delete R.missing[it.id];
    idbPut(it.id, file);
    mountFile(it, file, true);
    R.sel = it.id; save(); reconcile(); paint(); ensureLoop();
    return it;
  }
  function addFiles(files, hint) {
    const out = []; let skipped = 0;
    [...files].forEach((f) => { const k = kindOfFile(f, hint); if (k) out.push(addFile(k, f)); else skipped++; });
    if (skipped) toast(skipped + ' arquivo(s) ignorado(s): use foto, vídeo ou áudio.');
    try { const a = audio(); a && a.resume(); } catch (_) {}
    return out;
  }
  function addSource(kind) {
    const it = mkItem(kind, uniqueName(KINDS[kind].label), null);
    fitItem(it, kind === 'color' ? 'stretch' : 'fit');
    scene().items.push(it); R.sel = it.id; save(); reconcile(); paint(); ensureLoop();
  }
  function moveItem(id, up) { const a = scene().items, i = a.findIndex((x) => x.id === id), j = up ? i + 1 : i - 1; if (i < 0 || j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; save(); paint(); }
  function removeItem(id) {
    const sc = scene(); sc.items = sc.items.filter((x) => x.id !== id);
    unmount(id); delete R.srcErr[id]; delete R.missing[id]; idbDel(id);
    if (R.sel === id) R.sel = null; if (R.editing === id) R.editing = null;
    save(); paint();
  }
  let pickInput = null;
  function pickFiles(kind, multiple, cb) {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = KINDS[kind].accept; inp.multiple = !!multiple; pickInput = inp;
    inp.onchange = () => { if (inp.files && inp.files.length) cb([...inp.files]); pickInput = null; };
    inp.click();
  }
  function toggleVisible(it) { it.visible = !it.visible; applyAudio(it); save(); reconcile(); paintDocks(); }
  function toggleLock(it) { it.locked = !it.locked; save(); paintDocks(); }

  /* ───────────── formato de tela ───────────── */
  function setFormat(patch) {
    if (R.streaming) { toast('Pare a transmissão para mudar o formato.'); return false; }
    const v = P.video, oW = v.w, oH = v.h, prev = v.fmt;
    Object.assign(v, patch);
    if (patch.fmt && patch.fmt !== prev && !patch.orient) v.orient = v.fmt === 'phone' ? 'port' : 'land';
    if (!RATIOS[v.fmt].some((r) => r[0] === v.ratio)) v.ratio = RATIOS[v.fmt][0][0];
    const [w, h] = calcDims(v); v.w = w; v.h = h;
    if (w !== oW || h !== oH) rescaleItems(scene().items, oW, oH, w, h);
    save(); paintFormat(); paintDocks(); if (R.modal) paintModal();
    return true;
  }

  /* ───────────── compositor ───────────── */
  const OUT = document.createElement('canvas');          // saída do programa (é daqui que o encoder lê)
  let loopTimer = 0, nextAt = 0, frameIdx = 0, t0 = 0, previewCanvas = null;
  function cover(g, v, x, y, w, h) { const vw = v.videoWidth || v.naturalWidth, vh = v.videoHeight || v.naturalHeight; if (!vw) return false; const s = Math.max(w / vw, h / vh); g.drawImage(v, x + (w - vw * s) / 2, y + (h - vh * s) / 2, vw * s, vh * s); return true; }
  function placeholder(g, it, x, y, w, h, text) {
    g.fillStyle = '#1b1d27'; g.fillRect(x, y, w, h); g.fillStyle = '#8b90a6'; g.textAlign = 'center';
    g.font = `${Math.max(12, Math.min(w, h) / 24)}px system-ui,sans-serif`; g.fillText(text, x + w / 2, y + h / 2); g.textAlign = 'start';
  }
  function drawItem(g, it, t) {
    const { x, y, w, h } = it.frame; g.save();
    if (it.rot) { g.translate(x + w / 2, y + h / 2); g.rotate((it.rot * Math.PI) / 180); g.translate(-(x + w / 2), -(y + h / 2)); }
    g.beginPath(); g.rect(x, y, w, h); g.clip();
    const r = rt.get(it.id), u = w / 1280;
    if (it.kind === 'color') { g.fillStyle = it.color; g.fillRect(x, y, w, h); }
    else if (it.kind === 'test') {
      const c = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'], bw = w / 7;
      c.forEach((k, i) => { g.fillStyle = k; g.fillRect(x + i * bw, y, bw + 1, h * 0.68); });
      const gr = g.createLinearGradient(x, 0, x + w, 0); gr.addColorStop(0, '#000'); gr.addColorStop(1, '#fff'); g.fillStyle = gr; g.fillRect(x, y + h * 0.68, w, h * 0.17);
      g.fillStyle = '#111'; g.fillRect(x, y + h * 0.85, w, h * 0.15); g.fillStyle = '#fff'; g.fillRect(x + ((t * 120 * u) % Math.max(1, w - 40 * u)), y + h * 0.88, 40 * u, h * 0.09);
      g.fillStyle = '#fff'; g.font = `${28 * u}px system-ui`; g.fillText(new Date().toLocaleTimeString(), x + 20 * u, y + 50 * u);
    } else if (it.kind === 'screen' || it.kind === 'camera') {
      if (!(r && r.video && r.video.readyState >= 2 && cover(g, r.video, x, y, w, h))) placeholder(g, it, x, y, w, h, R.srcErr[it.id] ? `Sem sinal: ${R.srcErr[it.id]}` : 'Abrindo fonte…');
    } else {
      if (r && r.img && r.img.naturalWidth) g.drawImage(r.img, x, y, w, h);
      else if (r && r.video && r.video.videoWidth) g.drawImage(r.video, x, y, w, h);
      else placeholder(g, it, x, y, w, h, R.missing[it.id] ? `Arquivo ausente: ${it.path || it.name} (reabra em Propriedades)` : it.name);
    }
    g.restore();
  }
  function renderFrame() {
    if (OUT.width !== P.video.w || OUT.height !== P.video.h) { OUT.width = P.video.w; OUT.height = P.video.h; }
    const g = OUT.getContext('2d'), t = performance.now() / 1000;
    g.fillStyle = '#000'; g.fillRect(0, 0, OUT.width, OUT.height);
    scene().items.forEach((it) => { if (it.visible && it.frame) drawItem(g, it, t); });
  }
  let fitBox = '';
  function fitPreview(c) {
    // ocupa o máximo possível da caixa mantendo a proporção do formato (centralizado por margin:auto)
    const box = c.parentElement, bw = box.clientWidth, bh = box.clientHeight; if (!bw || !bh) return;
    const key = bw + 'x' + bh + '/' + c.width + 'x' + c.height; if (key === fitBox && c.style.width) return; fitBox = key;
    const s = Math.min(bw / c.width, bh / c.height);
    c.style.width = Math.max(1, Math.floor(c.width * s)) + 'px'; c.style.height = Math.max(1, Math.floor(c.height * s)) + 'px';
  }
  function drawPreview() {
    const c = previewCanvas; if (!c || !c.isConnected) return;
    if (c.width !== OUT.width || c.height !== OUT.height) { c.width = OUT.width; c.height = OUT.height; }
    fitPreview(c);
    const g = c.getContext('2d'); g.drawImage(OUT, 0, 0);
    const it = R.sel && findItem(R.sel);
    if (it && it.frame && it.visible) {
      const k = c.width / Math.max(1, c.getBoundingClientRect().width), f = it.frame, col = it.locked ? '#ffb020' : '#ff3b3b';
      g.save(); g.translate(f.x + f.w / 2, f.y + f.h / 2); g.rotate(rad(it));
      g.strokeStyle = col; g.lineWidth = 2 * k; g.strokeRect(-f.w / 2, -f.h / 2, f.w, f.h);
      if (!it.locked) {
        g.fillStyle = col; g.strokeStyle = '#fff'; g.lineWidth = 1.5 * k;
        HANDLES.forEach((h) => { const hx = (h.sx * f.w) / 2, hy = (h.sy * f.h) / 2; g.fillRect(hx - 5 * k, hy - 5 * k, 10 * k, 10 * k); g.strokeRect(hx - 5 * k, hy - 5 * k, 10 * k, 10 * k); });
        // botão de girar: círculo com seta em arco, acima do centro do lado de cima
        const ry = -f.h / 2 - ROT_OFF * k;
        g.strokeStyle = col; g.lineWidth = 1.5 * k; g.beginPath(); g.moveTo(0, -f.h / 2); g.lineTo(0, ry + 11 * k); g.stroke();
        g.fillStyle = col; g.beginPath(); g.arc(0, ry, 11 * k, 0, Math.PI * 2); g.fill();
        g.strokeStyle = '#fff'; g.lineWidth = 2.2; g.lineCap = 'round'; g.lineJoin = 'round';
        g.save(); g.translate(0, ry); g.scale((14 * k) / 24, (14 * k) / 24); g.translate(-12, -12); g.stroke(ROT_ARC); g.stroke(ROT_HEAD); g.restore();
      }
      g.restore();
    }
  }
  /* medidores de áudio: atualizados direto no DOM, sem repintar o dock */
  let mt = { master: null, db: null, ch: {} };
  function cacheMeters() {
    mt = { master: null, db: null, ch: {} }; if (!shadow) return;
    mt.master = q('[data-meter="master"]'); mt.db = q('[data-mdb]');
    shadow.querySelectorAll('[data-meter]').forEach((e) => { if (e.dataset.meter !== 'master') mt.ch[e.dataset.meter] = e; });
  }
  function setMeter(el, db) {
    if (!el) return; const d = typeof db === 'number' && isFinite(db) ? db : -100, p = Math.max(0, Math.min(1, (d + 60) / 60));
    const w = (100 - p * 100).toFixed(1) + '%'; if (el._w !== w) { el.firstElementChild.style.width = w; el._w = w; }
  }
  function updateMeters() {
    const a = audio(); if (!a || !R.open || R.min || !mt.master) return;
    let L; try { L = a.levels(); } catch (_) { return; } if (!L) return;
    setMeter(mt.master, L.master);
    if (mt.db) { const t = L.master > -99 ? Math.round(L.master) + ' dB' : '-∞ dB'; if (mt.db.textContent !== t) mt.db.textContent = t; }
    const ch = L.channels || {}; for (const id in mt.ch) setMeter(mt.ch[id], ch[id]);
  }
  function loop() {
    loopTimer = 0;
    if (!R.open && !R.streaming) return;           // ocioso: nada para mostrar nem enviar
    const interval = 1000 / (P.stream.target === 'iphone' && R.streaming ? Math.min(30, P.video.fps) : P.video.fps), now = performance.now();
    if (!nextAt) nextAt = now;
    if (now > nextAt + interval) { R.lagged += Math.floor((now - nextAt) / interval); nextAt = now; }   // quadros atrasados
    nextAt += interval;
    renderFrame();
    if (R.open && !R.min) { drawPreview(); updateMeters(); }
    if (R.streaming && enc) enc.push(OUT, Math.round((now - t0) * 1000));
    frameIdx++;
    updateStatsDom(now);
    loopTimer = setTimeout(loop, Math.max(0, nextAt - performance.now()));
  }
  function ensureLoop() { if (!loopTimer && (R.open || R.streaming)) { nextAt = 0; loopTimer = setTimeout(loop, 0); } }

  /* ───────────── encoder H.264 (WebCodecs) ───────────── */
  const LEVELS = [[0x1f, 3600, 108000], [0x20, 5120, 216000], [0x28, 8192, 245760], [0x2a, 8704, 522240], [0x32, 22080, 589824], [0x33, 36864, 983040], [0x34, 36864, 2073600]];
  const levelFor = (w, h, fps) => { const mbs = Math.ceil(w / 16) * Math.ceil(h / 16); return (LEVELS.find((l) => mbs <= l[1] && mbs * fps <= l[2]) || LEVELS[LEVELS.length - 1])[0]; };
  class Encoder {
    constructor(cfg, onPacket, onDesc, onError) { this.cfg = cfg; this.onPacket = onPacket; this.onDesc = onDesc; this.onError = onError; this.enc = null; this.sinceKey = 1e9; this.frames = 0; this.sentDesc = false; this.forceKey = true; this.kbps = cfg.bitrate; }
    async start() {
      if (typeof VideoEncoder === 'undefined') throw new Error('WebCodecs (VideoEncoder) indisponível neste Electron');
      const c = this.cfg, lv = levelFor(c.w, c.h, c.fps).toString(16).padStart(2, '0');
      const base = { codec: `avc1.4d00${lv}`, width: c.w, height: c.h, bitrate: c.bitrate * 1000, framerate: c.fps, latencyMode: 'realtime', avc: { format: 'avc' }, bitrateMode: 'constant' };
      let chosen = null;
      for (const hw of ['prefer-hardware', 'prefer-software']) {
        try { const s = await VideoEncoder.isConfigSupported({ ...base, hardwareAcceleration: hw }); if (s.supported) { chosen = s.config; break; } } catch (_) {}
      }
      if (!chosen) throw new Error('Este Electron não codifica H.264 (WebCodecs)');
      this.chosen = chosen;
      this.enc = new VideoEncoder({
        output: (chunk, meta) => {
          const buf = new Uint8Array(chunk.byteLength); chunk.copyTo(buf);
          if (!this.sentDesc && meta && meta.decoderConfig && meta.decoderConfig.description) { this.sentDesc = true; this.onDesc(new Uint8Array(meta.decoderConfig.description)); }
          this.frames++; this.onPacket({ data: buf, ptsUs: chunk.timestamp, key: chunk.type === 'key' });
        },
        error: (e) => this.onError(e),
      });
      this.enc.configure(chosen);
      ipcLog(`encoder H.264 pronto: ${chosen.codec} ${chosen.width}x${chosen.height} ${c.bitrate}kbps ${chosen.hardwareAcceleration}`);
    }
    push(canvas, tsUs) {
      if (!this.enc || this.enc.state !== 'configured') return;
      if (this.enc.encodeQueueSize > 4) { R.lagged++; return; }
      const keyEvery = this.cfg.keyint * this.cfg.fps; let key = this.forceKey || this.sinceKey >= keyEvery;
      const vf = new VideoFrame(canvas, { timestamp: tsUs });
      try { this.enc.encode(vf, { keyFrame: key }); } finally { vf.close(); }
      this.sinceKey = key ? 1 : this.sinceKey + 1; this.forceKey = false;
    }
    requestKey() { this.forceKey = true; }
    updateBitrate(kbps) {
      if (!this.enc || kbps === this.kbps) return; this.kbps = kbps;
      try { this.enc.configure({ ...this.chosen, bitrate: kbps * 1000 }); } catch (e) { ipcLog('updateBitrate: ' + e.message); }
    }
    async stop() { if (!this.enc) return; try { await this.enc.flush(); } catch (_) {} try { this.enc.close(); } catch (_) {} this.enc = null; }
  }
  // USB uses the bridge's native JPEG input. At most one frame is in flight.
  class JpegEncoder {
    constructor(onError) { this.onError = onError; this.frames = 0; this.live = true; this.pending = false; }
    async start() {}
    push(canvas) {
      if (!this.live || this.pending) return;
      this.pending = true;
      canvas.toBlob(async blob => {
        try {
          if (!this.live) return;
          if (!blob || blob.size > 2 * 1024 * 1024) throw new Error('Quadro grande demais. Reduza a resolução do CAM LIVE.');
          const data = new Uint8Array(await blob.arrayBuffer());
          if (!this.live) return;
          const result = await bridge.invoke('camlive:frame', data);
          if (this.live && (!result || !result.ok)) throw new Error(result && result.error || 'Falha ao enviar a imagem pelo USB.');
          this.frames++;
        } catch (error) { if (this.live) this.onError(error); }
        finally { this.pending = false; }
      }, 'image/jpeg', 0.85);
    }
    requestKey() {}
    async stop() { this.live = false; }
  }
  let pcmGeneration = 0, pcmQueue = [], pcmBytes = 0, pcmSending = false;
  function resetPcm() { pcmGeneration++; pcmQueue = []; pcmBytes = 0; pcmSending = false; }
  function queuePcm(packet) {
    if (!R.streaming) return;
    if (pcmBytes + packet.data.byteLength > 100 * 1024) { R.error = 'O áudio ficou atrasado. A transmissão foi interrompida para não enviar som fora de sincronia.'; stopStreaming(); return; }
    pcmQueue.push(packet); pcmBytes += packet.data.byteLength;
    pumpPcm(pcmGeneration);
  }
  async function pumpPcm(generation) {
    if (pcmSending) return; pcmSending = true;
    try {
      while (generation === pcmGeneration && R.streaming && pcmQueue.length) {
        const packet = pcmQueue[0], result = await bridge.invoke('camlive:pcm', packet);
        if (generation !== pcmGeneration) return;
        if (result && !result.ok && result.backpressure) { await new Promise(resolve => setTimeout(resolve, 15)); continue; }
        if (!result || !result.ok) throw new Error(result && result.error || 'Falha no áudio USB.');
        pcmQueue.shift(); pcmBytes -= packet.data.byteLength;
      }
    } catch (error) { if (generation === pcmGeneration) { R.error = error.message; stopStreaming(); } }
    finally { if (generation === pcmGeneration) pcmSending = false; }
  }
  async function startUsbStreaming() {
    if (R.streaming || R.starting || R.stopping) return;
    R.starting = true; R.error = ''; R.status = 'Preparando iPhone por USB…'; paint();
    try {
      const result = await bridge.invoke('camlive:start', { target: 'iphone', fps: Math.min(30, P.video.fps), sampleRate: 48000 });
      if (!result || !result.ok) throw new Error(result && result.error || 'Não foi possível preparar o iPhone.');
      const A = audio(); if (!A) throw new Error('O mixer de áudio do CAM LIVE não foi carregado.');
      resetPcm(); R.streaming = true; R.status = 'Aguardando fonte'; R.stats = { fps: 0, kbps: 0, dropped: 0, cong: 0, lagged: 0, bitrate: 0 }; R.lagged = 0; R.lastFrames = 0; R.liveSince = 0;
      enc = new JpegEncoder(error => { R.error = error.message; stopStreaming(); });
      t0 = performance.now(); nextAt = 0; playAll(); renderFrame();
      const capture = await A.startCapture({ rawPcm: true, t0Ms: t0, onPcm: queuePcm, onError: message => { R.error = message; stopStreaming(); } });
      if (!capture || !capture.ok) throw new Error(capture && capture.error || 'Não foi possível preparar o áudio.');
      R.audioCap = true; ensureLoop(); save();
    } catch (error) {
      R.error = error.message;
      try { await bridge.invoke('camlive:stop'); } catch (_) {}
      await finishLocal();
    } finally { R.starting = false; paint(); updateButton(); }
  }

  let enc = null;

  /* ───────────── transmissão ───────────── */
  const u8 = (d) => (d instanceof Uint8Array ? d : new Uint8Array(d.buffer ? d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) : d));
  async function startStreaming() {
    if (R.streaming || R.starting || R.stopping) return;
    if (!hasIpc) { toast('Transmitir só funciona dentro do app Nova (sem IPC aqui).'); return; }
    if (!R.loaded) { try { await load(); } catch (_) {} }
    if (P.stream.target !== 'rtmp') return startUsbStreaming();
    R.error = ''; R.stats = { fps: 0, kbps: 0, dropped: 0, cong: 0, lagged: 0, bitrate: 0 }; R.lagged = 0; R.encFrames = 0; R.lastFrames = 0;
    const s = P.stream, v = P.video;
    let audioOk = false; const A = audio();
    if (A) { try { audioOk = !!(await A.supported()); } catch (_) {} }
    renderFrame();
    enc = new Encoder({ w: v.w, h: v.h, fps: v.fps, bitrate: s.bitrate, keyint: s.keyint },
      (p) => bridge.send('camlive:packet', p), (d) => bridge.send('camlive:avcc', d),
      (e) => { ipcLog('encoder: ' + e.message); R.error = 'Erro no encoder: ' + e.message; stopStreaming(); });
    try { await enc.start(); } catch (e) { enc = null; R.error = e.message; R.status = 'Erro no encoder'; paint(); toast(e.message); updateButton(); return; }
    R.streaming = true; R.status = 'Conectando…'; t0 = performance.now(); R.liveSince = 0; nextAt = 0;
    playAll(); paintFormat();
    if (audioOk) {
      try {
        await A.resume();
        const r = await A.startCapture({
          t0Ms: t0, bitrateKbps: 128,
          onError: (msg) => { ipcLog('audio: ' + msg); toast('Erro no áudio: ' + msg); },
          onAsc: (asc) => bridge.send('camlive:aasc', u8(asc)),
          onPacket: (p) => bridge.send('camlive:apacket', { data: u8(p.data), ptsUs: p.ptsUs }),
        });
        if (r && r.ok) R.audioCap = true; else { audioOk = false; ipcLog('audio.startCapture: ' + (r && r.error)); toast('Áudio indisponível (' + ((r && r.error) || 'erro') + '): transmitindo só vídeo.'); }
      } catch (e) { audioOk = false; ipcLog('audio.startCapture: ' + e.message); toast('Áudio indisponível: transmitindo só vídeo.'); }
    } else toast('Este Electron não codifica áudio AAC (WebCodecs): transmitindo só vídeo.');
    const r = await bridge.invoke('camlive:start', { target: 'rtmp', url: s.url, key: s.key, dropMs: s.drop, pframeDropMs: s.pdrop, dyn: s.dyn, bitrate: s.bitrate, audio: audioOk ? 128 : 0, width: v.w, height: v.h, fps: v.fps, retryDelaySec: s.retryDelay, maxRetries: s.maxRetries });
    if (!r || !r.ok) { R.error = (r && r.error) || 'falha ao iniciar'; await finishLocal(); return; }
    ensureLoop(); paint(); updateButton(); save();
  }
  async function stopStreaming() {
    if (!R.streaming || R.stopping) return;
    R.stopping = true; R.streaming = false;
    R.status = 'Parando…'; updateStatusDom();
    try { await bridge.invoke('camlive:stop'); } catch (_) {}
    await finishLocal(); R.stopping = false;
  }
  async function finishLocal() {
    R.streaming = false; resetPcm(); R.status = 'Pronto'; R.liveSince = 0;
    const e = enc; enc = null; if (e) await e.stop();
    if (R.audioCap) { R.audioCap = false; try { const a = audio(); a && (await a.stopCapture()); } catch (_) {} }
    if (!R.open) pauseAll();
    paint(); updateButton(); if (R.error) toast(R.error);
  }
  if (hasIpc) {
    bridge.on('camlive:status', (s) => {
      if (!R.streaming) return;
      R.status = s.status; if (s.error) R.error = s.error;
      if ((s.status === 'AO VIVO' || s.status === 'ATIVO') && !R.liveSince) { R.liveSince = Date.now(); if (enc) enc.requestKey(); }
      if (s.finished) { finishLocal(); return; }
      updateButton(); updateStatusDom();
    });
    bridge.on('camlive:stats', (s) => { R.stats.kbps = s.sentKbps; R.stats.dropped = s.dropped; R.stats.cong = s.congestion; R.stats.bitrate = s.bitrate; });
    bridge.on('camlive:set-bitrate', (b) => { if (enc) enc.updateBitrate(b.kbps); });
    bridge.on('camlive:keyframe', () => { if (enc) enc.requestKey(); });
  }

  /* ───────────── interface (Shadow DOM) ───────────── */
  let host = null, shadow = null, panel = null;
  const q = (s) => shadow && shadow.querySelector(s);

  function ensureHost() {
    if (host) return;
    host = document.createElement('div'); host.id = 'nova-cam-live-host';
    document.body.appendChild(host);
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>${CSS}</style><div class="root"></div>`;
  }

  /* ── barra de formato ── */
  function formatHTML() {
    const v = P.video, lk = R.streaming;
    const seg = (m, cur, opts) => `<span class="seg">${opts.map((o) => `<b data-m="${m}" data-v="${o[0]}" class="${String(o[0]) === String(cur) ? 'on' : ''}">${o[2] || ''}${o[1]}</b>`).join('')}</span>`;
    return `${seg('fmt', v.fmt, [['pc', 'Computador', ic('monitor', 13)], ['phone', 'Celular', '']])}
      <select id="f-ratio" title="Proporção" ${lk ? 'disabled' : ''}>${RATIOS[v.fmt].map((r) => `<option value="${r[0]}" ${r[0] === v.ratio ? 'selected' : ''}>${esc(r[2])}</option>`).join('')}</select>
      ${seg('q', v.q, [[720, 'HD 720p', ''], [1080, 'Full HD 1080p', '']])}
      ${seg('orient', v.orient, [['land', 'Deitado', ic('rectH', 14)], ['port', 'Em pé', ic('rectV', 14)]])}
      <span class="sp"></span><span class="fres" title="Resolução da transmissão">${v.w}×${v.h}</span>`;
  }
  function paintFormat() {
    const e = q('#fbar'); if (!e) return;
    e.className = 'fbar' + (R.streaming ? ' lock' : '');
    e.title = R.streaming ? 'O formato não pode ser mudado durante a transmissão. Pare a transmissão para alterar.' : '';
    e.innerHTML = formatHTML();
  }

  /* ── docks ── */
  const dock = (t, icon, body) => `<div class="dock"><div class="dhead">${ic(icon, 14)}${t}</div>${body}</div>`;
  function itemRow(it) {
    const sel = it.id === R.sel, editing = R.editing === it.id;
    const sub = R.srcErr[it.id] ? 'sem sinal' : R.missing[it.id] ? 'arquivo ausente' : kindLabel(it);
    return `<div class="orow ${sel ? 'osel' : ''} ${it.visible ? '' : 'hid'}" data-m="item" data-id="${it.id}">
      <span class="oic ${it.visible ? '' : 'off'}" data-m="eye" data-id="${it.id}" title="${it.visible ? 'Ocultar na saída' : 'Mostrar na saída'}">${ic(it.visible ? 'eye' : 'eyeOff', 14)}</span>
      <span class="oic ${it.locked ? 'amber' : 'off'}" data-m="lock" data-id="${it.id}" title="${it.locked ? 'Desbloquear (permite mover)' : 'Bloquear posição'}">${ic(it.locked ? 'lock' : 'unlock', 13)}</span>
      ${ic(KINDS[it.kind].icon, 14)}
      ${editing ? `<input data-edit value="${esc(it.name)}" maxlength="80">` : `<span class="nm" data-m="name" title="Duplo clique para renomear">${esc(it.name)}</span>`}
      <small style="opacity:.55;font-size:11px;white-space:nowrap">${sub}</small></div>`;
  }
  function audioRow(it) {
    const pct = Math.round(it.volume * 100);
    return `<div class="arow ${it.visible ? '' : 'ahid'}" data-id="${it.id}">
      <div class="ar1"><span class="aname">${ic(KINDS[it.kind].icon, 12)}<span style="overflow:hidden;text-overflow:ellipsis">${esc(it.name)}${it.visible ? '' : ' (oculto)'}</span></span>
        <span class="oic ${it.muted ? 'on' : ''}" data-m="mute" data-id="${it.id}" title="${it.muted ? 'Ativar som' : 'Mudo'}">${ic(it.muted ? 'volumeX' : 'volume', 14)}</span>
        <span class="oic ${it.monitor ? 'mon' : ''}" data-m="monitor" data-id="${it.id}" title="${it.monitor ? 'Parar de ouvir (fone)' : 'Ouvir no fone (monitorar)'}">${ic('headphones', 14)}</span></div>
      <div class="ar2"><div class="mt" data-meter="${it.id}"><i></i></div><input type="range" min="0" max="100" value="${pct}" data-vol="${it.id}" title="Volume"><small data-volv="${it.id}">${pct}%</small></div></div>`;
  }
  function docksHTML() {
    const items = [...scene().items].reverse(), st = P.stream, v = P.video, a = audio();
    const lista = items.length ? items.map(itemRow).join('') : '<div class="aempty">Nenhum item. Use + para adicionar foto, vídeo, áudio e mais.</div>';
    const sel = R.sel ? findItem(R.sel) : null, has = !!sel;
    const ch = items.filter((it) => KINDS[it.kind].av);
    const mix = a && ch.length ? ch.map(audioRow).join('')
      : `<div class="aempty">Adicione um vídeo ou áudio em Cenas. O CAM LIVE nunca usa o microfone nem o áudio do computador.${a ? '' : '<div class="awarn">Módulo de áudio indisponível nesta instalação: a transmissão sai só com vídeo.</div>'}</div>`;
    return `${dock('Cenas', 'layers', `<div class="dbody">${lista}</div><div class="dtools"><b data-m="add" title="Adicionar foto, vídeo, áudio, captura...">${ic('plus')}</b><b data-m="src-del" class="${has ? '' : 'dis'}" title="Remover">${ic('minus')}</b><b data-m="src-up" class="${has ? '' : 'dis'}" title="Subir">${ic('up')}</b><b data-m="src-down" class="${has ? '' : 'dis'}" title="Descer">${ic('down')}</b><b data-m="src-rename" class="${has ? '' : 'dis'}" title="Renomear">${ic('edit', 13)}</b><b data-m="src-props" class="${has ? '' : 'dis'}" style="margin-left:auto">${ic('sliders', 13)} Propriedades</b></div>`)}
      ${dock('Áudio', 'volume', `<div class="dbody">${mix}</div><div class="aout"><b>Saída</b><div class="mt" data-meter="master"><i></i></div><small data-mdb>-∞ dB</small></div>`)}
      ${dock('Controles', 'radio', `<div class="dbody" style="padding:8px;display:flex;flex-direction:column;gap:6px;overflow:hidden">
        <button class="obtn big ${R.streaming ? 'red' : 'blue'}" data-m="stream" ${R.starting ? 'disabled' : ''}>${ic(R.streaming ? 'stop' : 'radio', 14)} ${R.starting ? 'Preparando…' : R.streaming ? 'Parar Transmissão' : P.stream.target === 'rtmp' ? 'Iniciar Transmissão' : 'Transmitir para o iPhone'}</button>
        <button class="obtn big" data-m="settings">${ic('settings', 14)} Configurações</button>
        <div style="margin-top:auto;font-size:11px;color:#8b90a6;line-height:1.5;word-break:break-all">${st.target === 'iphone' ? 'Destino: iPhone por USB<br>Rede configurada automaticamente<br>Áudio das cenas → iPhone<br>' : `${st.target === 'rtmp' ? 'Servidor: ' + esc(st.url) : 'Destino: iPhone por USB<br>Conexão automática — sem IP ou servidor'}<br>`}${v.w}×${v.h} @ ${st.target === 'iphone' ? Math.min(30, v.fps) : v.fps} fps${st.target === 'rtmp' ? `, ${st.bitrate} kbps${st.dyn ? ', bitrate dinâmico' : ''}` : ''}</div></div>`)}`;
  }
  const field = (l, h) => `<div class="frow"><label>${l}</label><div>${h}</div></div>`;
  function modalHTML() {
    const m = R.modal; if (!m) return ''; let body = '';
    if (m.type === 'error') body = `<h3>Erro</h3><p style="font-size:13px;line-height:1.5">${esc(m.text)}</p><div class="sheet-bt"><button class="obtn blue" data-m="modal-close">OK</button></div>`;
    if (m.type === 'settings') {
      const s = P.stream, v = P.video, cur = s.target !== 'rtmp' ? 'iphone' : (PRESETS.find((p) => p.url === s.url && p.key === s.key) || PRESETS.find(p => p.id === 'custom')).id;
      body = `<h3>Configurações</h3><div class="sec">Destino</div>
      ${field('Enviar para', `<select id="f-target" ${R.streaming ? 'disabled' : ''}><option value="iphone" ${s.target === 'iphone' ? 'selected' : ''}>iPhone por USB — automático</option><option value="rtmp" ${s.target === 'rtmp' ? 'selected' : ''}>Servidor RTMP — avançado</option></select>`)}
      <p id="f-usb-note" style="font-size:12px;line-height:1.6;color:#9db6c6;${s.target === 'rtmp' ? 'display:none' : ''}">Conecte seu iPhone em PHONE CONTROL. O Nova prepara a conexão pelo cabo; não precisa preencher endereço, porta ou chave. O áudio vem apenas dos arquivos adicionados às cenas. Use até 30 fps.</p>
      <div id="f-rtmp" ${s.target !== 'rtmp' ? 'style="display:none"' : ''}><div class="sec">Transmissão RTMP</div>
      ${field('Predefinição', `<select id="f-preset">${PRESETS.map((p) => `<option value="${p.id}" ${p.id === cur ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select>`)}
      <p id="f-usb-info" style="font-size:12px;line-height:1.6;${cur === 'iphone' ? '' : 'display:none'}">O Nova prepara o envio de imagem e áudio pelo cabo. Conecte o iPhone em PHONE CONTROL antes de transmitir. Sem OBS, servidor externo ou configuração de rede.</p><div id="f-rtmp-settings" style="${cur === 'iphone' ? 'display:none' : ''}">${field('Servidor (rtmp://host:porta/app)', `<input class="input" id="f-url" value="${esc(s.url)}">`)}${field('Chave da stream', `<input class="input" id="f-key" type="password" value="${esc(s.key)}">`)}
      ${field('Bitrate dinâmico', `<label class="chk"><input type="checkbox" id="f-dyn" ${s.dyn ? 'checked' : ''}> reduz o bitrate em vez de descartar frames</label>`)}
      <div class="sec">Saída</div>${field('Bitrate (kbps)', `<input class="input" id="f-br" type="number" min="200" max="20000" step="100" value="${s.bitrate}">`)}${field('Keyframe a cada (s)', `<input class="input" id="f-ki" type="number" min="1" max="10" value="${s.keyint}">`)}
      </div></div><div class="sec">Vídeo</div>${field('Resolução', `<span style="font-family:'JetBrains Mono',monospace;color:#ffb020">${v.w}×${v.h}</span> <span style="color:#8b90a6;font-size:11px">(definida pelo formato, na barra acima do preview)</span>`)}
      ${field('FPS', `<select id="f-fps">${[24, 25, 30, 48, 50, 60].map((n) => `<option ${n === v.fps ? 'selected' : ''}>${n}</option>`).join('')}</select>`)}
      <details><summary style="cursor:pointer;margin-top:12px">Avançado — RTMP</summary><div class="sec">RTMP</div>${field('Limiar de descarte (ms)', `<input class="input" id="f-dr" type="number" min="100" max="5000" step="100" value="${s.drop}">`)}${field('Limiar de P-frames (ms)', `<input class="input" id="f-pd" type="number" min="100" max="5000" step="100" value="${s.pdrop}">`)}
      ${field('Reconexão', `<div style="display:flex;gap:6px;align-items:center">a cada <input class="input" id="f-rd" type="number" min="1" max="60" value="${s.retryDelay}" style="width:64px"> s, até <input class="input" id="f-mr" type="number" min="0" max="100" value="${s.maxRetries}" style="width:70px"> vezes</div>`)}
      </details>${R.streaming ? '<p style="font-size:11px;color:#ffb020;margin-top:8px">Mudanças de FPS e bitrate valem na próxima transmissão.</p>' : ''}
      <div class="sheet-bt"><button class="obtn" data-m="modal-close">Cancelar</button><button class="obtn blue" data-m="modal-ok">Aplicar</button></div>`;
    }
    if (m.type === 'props') {
      const it = findItem(m.id); if (!it) return ''; const f = it.frame || { x: 0, y: 0, w: 0, h: 0 }, K = KINDS[it.kind];
      let devSel = '';
      if (it.kind === 'camera') devSel = field('Dispositivo', `<select id="f-dev"><option value="">Padrão do sistema</option>${(m.devices || []).map((d) => `<option value="${esc(d.id)}" ${d.id === it.deviceId ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>`);
      if (it.kind === 'screen') devSel = field('Tela / janela', `<select id="f-dev"><option value="">Tela principal</option>${(m.devices || []).map((d) => `<option value="${esc(d.id)}" ${d.id === it.deviceId ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>`);
      body = `<h3>Propriedades</h3>${field('Nome', `<input class="input" id="f-name" value="${esc(it.name)}">`)}${field('Tipo', `<span>${K.label}</span>`)}
      ${devSel}${it.kind === 'color' ? field('Cor', `<input type="color" id="f-color" value="${it.color}" style="width:60px;height:28px;padding:0">`) : ''}
      ${K.file ? field('Arquivo', `<div style="display:flex;gap:6px;align-items:center"><span style="flex:1;word-break:break-all">${esc(it.path || '(nenhum)')}${R.missing[it.id] ? ' <b style="color:#ffb020">(ausente)</b>' : ''}</span><button class="obtn" data-m="modal-reopen">Escolher…</button></div>`) : ''}
      ${K.av ? field('Reprodução', `<label class="chk"><input type="checkbox" id="f-loop" ${it.loop !== false ? 'checked' : ''}> Repetir</label>`) : ''}
      ${K.noFrame ? '' : field('Posição', `<label class="chk"><input type="checkbox" id="f-locked" ${it.locked ? 'checked' : ''}> Bloqueado (não move nem redimensiona na prévia)</label>`)}
      ${K.noFrame ? '' : `<div class="sec">Transformação (área de edição ${P.video.w}×${P.video.h})</div>
      ${field('X / Y', `<div style="display:flex;gap:6px"><input class="input" id="f-x" type="number" value="${Math.round(f.x)}"><input class="input" id="f-y" type="number" value="${Math.round(f.y)}"></div>`)}
      ${field('Largura / Altura', `<div style="display:flex;gap:6px"><input class="input" id="f-pw" type="number" value="${Math.round(f.w)}"><input class="input" id="f-ph" type="number" value="${Math.round(f.h)}"></div>`)}
      ${field('Rotação (graus)', `<div style="display:flex;gap:6px"><input class="input" id="f-rot" type="number" step="1" value="${Math.round(it.rot || 0)}"><button class="obtn" data-m="modal-rot90">Girar 90°</button><button class="obtn" data-m="modal-rot0">Zerar</button></div>`)}
      <div style="display:flex;gap:6px;margin:6px 0;flex-wrap:wrap"><button class="obtn" data-m="modal-fit">${ic('fit', 13)} Ajustar</button><button class="obtn" data-m="modal-cover">${ic('fit', 13)} Preencher tela</button><button class="obtn" data-m="modal-stretch">${ic('fit', 13)} Esticar</button></div>`}
      <div class="sheet-bt"><button class="obtn" data-m="modal-close">Fechar</button><button class="obtn blue" data-m="modal-ok">Aplicar</button></div>`;
    }
    return `<div class="sheet-back"><div class="sheet">${body}</div></div>`;
  }
  function paintDocks() {
    const e = q('#docks'); if (!e) return;
    // preserva o campo de renomear durante repinturas
    const old = R.editing && q('[data-edit]'), keep = old ? { v: old.value, s: old.selectionStart, e: old.selectionEnd } : null;
    R.painting = true; e.innerHTML = docksHTML(); R.painting = false;
    if (R.editing) { const i = q('[data-edit]'); if (i) { if (keep) { i.value = keep.v; i.focus(); try { i.setSelectionRange(keep.s, keep.e); } catch (_) {} } } }
    cacheMeters();
  }
  function paintModal() { const e = q('#modal'); if (!e) return; e.innerHTML = modalHTML(); const i = e.querySelector('input[autofocus]'); if (i) { i.focus(); i.select(); } }
  function paint() { paintDocks(); paintFormat(); paintModal(); updateStatusDom(); }

  /* renomear na lista */
  function startEdit(id) { R.sel = id; R.editing = id; paintDocks(); const i = q('[data-edit]'); if (i) { i.focus(); i.select(); } }
  function commitEdit() {
    const id = R.editing; if (!id) return; const i = q('[data-edit]'), it = findItem(id); R.editing = null;
    if (it && i && i.value.trim() && i.value.trim() !== it.name) { it.name = i.value.trim(); save(); }
    paintDocks();
  }
  function cancelEdit() { R.editing = null; paintDocks(); }

  const fmtTime = (s) => [(s / 3600) | 0, ((s / 60) | 0) % 60, s % 60].map((n) => String(n).padStart(2, '0')).join(':');
  function updateStatusDom() {
    if (!shadow) return;
    const set = (k, v) => { const e = q(`[data-st="${k}"]`); if (e && e.textContent !== v) e.textContent = v; };
    set('status', R.status); set('time', R.status === 'AO VIVO' && R.liveSince ? fmtTime(Math.floor((Date.now() - R.liveSince) / 1000)) : '');
    const s = R.stats; set('fps', s.fps.toFixed(0) + ' fps'); set('kbps', s.kbps + ' kb/s'); set('dropped', 'Quadros perdidos: ' + s.dropped);
    set('cong', 'Congestão: ' + Math.round(Math.min(100, s.cong * 100)) + '%'); set('lagged', 'Atrasados: ' + s.lagged); set('bitrate', 'Bitrate: ' + (s.bitrate || P.stream.bitrate) + ' kbps');
    const d = q('#sdot'); if (d) d.style.background = R.streaming ? '#ff4d4d' : '#7c8196';
    const b = q('#badge'); if (b) { b.className = 'badge ' + (R.streaming ? 'live' : 'dim'); b.textContent = R.streaming ? (R.status === 'AO VIVO' ? 'AO VIVO' : R.status) : 'DESCONECTADO'; }
  }
  function updateStatsDom(now) {
    if (now - R.lastTick >= 1000) {
      R.lastTick = now; R.stats.fps = R.streaming && enc ? enc.frames - R.lastFrames : 0; R.lastFrames = enc ? enc.frames : 0; R.stats.lagged = R.lagged;
      if (!R.streaming) { R.stats.kbps = 0; R.stats.cong = 0; }
    }
    updateStatusDom();
  }
  function toast(msg) { const t = q('#toast'); if (!t) return; t.textContent = msg; t.style.opacity = 1; clearTimeout(toast.t); toast.t = setTimeout(() => { t.style.opacity = 0; }, 4500); }

  /* menu de contexto */
  let ctxEl = null, ctxOff = null;
  function closeCtx() { if (ctxEl) { ctxEl.remove(); ctxEl = null; } if (ctxOff) { removeEventListener('pointerdown', ctxOff, true); ctxOff = null; } }
  function ctx(x, y, items) {
    closeCtx(); const m = document.createElement('div'); m.className = 'ctxm';
    items.forEach((it) => { if (it === '-') { m.appendChild(document.createElement('hr')); return; } const d = document.createElement('div'); d.innerHTML = (it.icon ? ic(it.icon, 13) : '') + '<span>' + it.label + '</span>'; if (it.danger) d.style.color = '#ff7b7b'; d.onclick = () => { closeCtx(); it.fn(); }; m.appendChild(d); });
    shadow.querySelector('.root').appendChild(m);
    m.style.left = Math.max(4, Math.min(x, innerWidth - m.offsetWidth - 4)) + 'px'; m.style.top = Math.max(4, Math.min(y, innerHeight - m.offsetHeight - 4)) + 'px'; ctxEl = m;
    ctxOff = (e) => { if (!e.composedPath().includes(m)) closeCtx(); }; setTimeout(() => addEventListener('pointerdown', ctxOff, true));
  }
  function addMenu(x, y) {
    const pick = (k) => () => pickFiles(k, true, (fs) => addFiles(fs, k));
    ctx(x, y, [
      { icon: 'image', label: 'Foto…', fn: pick('image') }, { icon: 'film', label: 'Vídeo…', fn: pick('video') }, { icon: 'music', label: 'Áudio…', fn: pick('audio') }, '-',
      { icon: 'monitor', label: 'Captura de Tela', fn: () => addSource('screen') }, { icon: 'camera', label: 'Câmera (só vídeo)', fn: () => addSource('camera') },
      { icon: 'palette', label: 'Cor', fn: () => addSource('color') }, { icon: 'test', label: 'Padrão de teste', fn: () => addSource('test') },
    ]);
  }

  /* canvas: selecionar, arrastar, redimensionar (itens bloqueados só são selecionados) */
  function bindCanvas(c) {
    let d = null; const pt = (e) => { const r = c.getBoundingClientRect(), k = c.width / r.width; return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k, k }; };
    c.addEventListener('pointerdown', (e) => {
      const p = pt(e), items = scene().items; let hit = null, mode = 'move', hh = null;
      const sel = R.sel && findItem(R.sel);
      if (sel && sel.frame && sel.visible && !sel.locked && (hh = hitHandle(sel, p, p.k))) { hit = sel; mode = hh.type; }   // alças do item selecionado têm prioridade
      else for (let i = items.length - 1; i >= 0; i--) { const it = items[i]; if (!it.visible || !it.frame) continue; if (insideItem(it, p)) { hit = it; break; } }
      R.sel = hit ? hit.id : null; paintDocks(); if (!hit || (hit.locked && mode === 'move')) { d = null; return; }
      d = { id: hit.id, mode, h: hh && hh.h, sx: p.x, sy: p.y, o: { ...hit.frame }, rot: hit.rot || 0, moved: false }; c.setPointerCapture(e.pointerId);
      if (mode === 'rot') c.style.cursor = 'grabbing';
    });
    c.addEventListener('pointermove', (e) => {
      const p = pt(e);
      if (!d) {   // só passa o mouse: mostra o cursor certo
        const sel = R.sel && findItem(R.sel); let cur = '';
        if (sel && sel.frame && sel.visible && !sel.locked) { const h = hitHandle(sel, p, p.k); cur = h ? cursorFor(h, sel) : (insideItem(sel, p) ? 'move' : ''); }
        c.style.cursor = cur; return;
      }
      const it = findItem(d.id); if (!it || it.locked) return; const o = d.o, dx = p.x - d.sx, dy = p.y - d.sy;
      if (Math.abs(dx) + Math.abs(dy) > 0) d.moved = true;
      if (d.mode === 'move') it.frame = { x: o.x + dx, y: o.y + dy, w: o.w, h: o.h };
      else if (d.mode === 'rot') {
        const cc = centerOf(o); let ang = (Math.atan2(p.y - cc.y, p.x - cc.x) * 180) / Math.PI + 90;
        ang = ((ang + 180) % 360 + 360) % 360 - 180;
        if (e.shiftKey) ang = Math.round(ang / 15) * 15;
        else { const n = Math.round(ang / 90) * 90; if (Math.abs(ang - n) < 3) ang = n; }       // gruda em 0°, 90°, 180°… (perto)
        it.rot = ang === -180 ? 180 : ang;
      } else {
        const h = d.h, l = toLocal(o, d.rot, p); let nw = o.w, nh = o.h;
        if (h.sx) nw = Math.max(16, h.sx > 0 ? l.x + o.w / 2 : o.w / 2 - l.x);
        if (h.sy) nh = Math.max(16, h.sy > 0 ? l.y + o.h / 2 : o.h / 2 - l.y);
        if (h.sx && h.sy && !e.shiftKey && o.w > 0 && o.h > 0) {        // canto: mantém a proporção (Shift solta)
          let s = Math.max(nw / o.w, nh / o.h); s = Math.max(s, 16 / o.w, 16 / o.h); nw = o.w * s; nh = o.h * s;
        }
        const anchor = toWorld(o, d.rot, { x: (-h.sx * o.w) / 2, y: (-h.sy * o.h) / 2 }), a = (d.rot * Math.PI) / 180, vx = (h.sx * nw) / 2, vy = (h.sy * nh) / 2;
        const cx = anchor.x + vx * Math.cos(a) - vy * Math.sin(a), cy = anchor.y + vx * Math.sin(a) + vy * Math.cos(a);   // o lado oposto fica parado
        it.frame = { x: cx - nw / 2, y: cy - nh / 2, w: nw, h: nh };
      }
    });
    c.addEventListener('pointerup', () => { if (d) { const it = findItem(d.id); if (it && d.moved) { it.fitMode = 'free'; captureRel(it); } d = null; c.style.cursor = ''; save(); } });
  }

  const $v = (id) => { const e = q('#' + id); return e ? e.value : ''; };
  const num = (id, d, lo, hi) => { const n = parseFloat($v(id)); return isNaN(n) ? d : Math.min(hi, Math.max(lo, n)); };
  async function openProps(id) {
    R.modal = { type: 'props', id, devices: [] }; paintModal();
    try {
      const it = findItem(id);
      if (it.kind === 'camera') { const ds = await navigator.mediaDevices.enumerateDevices(); R.modal.devices = ds.filter((d) => d.kind === 'videoinput').map((d, i) => ({ id: d.deviceId, name: d.label || 'Câmera ' + (i + 1) })); }
      if (it.kind === 'screen' && hasIpc) { const src = await bridge.invoke('screen-recorder:get-sources'); R.modal.devices = (src || []).map((s) => ({ id: s.id, name: (/^screen:/.test(s.id) ? 'Tela: ' : 'Janela: ') + s.name })); }
      if (R.modal && R.modal.id === id) paintModal();
    } catch (_) {}
  }
  function modalOk() {
    const m = R.modal; if (!m) return;
    if (m.type === 'settings') {
      const s = P.stream, v = P.video; if (!R.streaming) s.target = $v('f-target') === 'rtmp' ? 'rtmp' : 'iphone'; s.url = $v('f-url').trim(); s.key = $v('f-key'); s.dyn = q('#f-dyn').checked; s.bitrate = num('f-br', s.bitrate, 200, 20000); s.keyint = num('f-ki', s.keyint, 1, 10);
      if (!R.streaming) v.fps = +$v('f-fps') || v.fps;
      s.drop = num('f-dr', s.drop, 100, 5000); s.pdrop = num('f-pd', s.pdrop, 100, 5000); s.retryDelay = num('f-rd', s.retryDelay, 1, 60); s.maxRetries = num('f-mr', s.maxRetries, 0, 100);
    }
    if (m.type === 'props') {
      const it = findItem(m.id);
      if (it) {
        if ($v('f-name').trim()) it.name = $v('f-name').trim();
        if (it.kind === 'color') it.color = $v('f-color');
        const dev = q('#f-dev'); if (dev && dev.value !== it.deviceId) { it.deviceId = dev.value; unmount(it.id); delete R.srcErr[it.id]; }
        const lp = q('#f-loop'); if (lp) { it.loop = lp.checked; const r = rt.get(it.id); if (r && r.media) r.media.loop = it.loop; }
        const lk = q('#f-locked'); if (lk) it.locked = lk.checked;
        if (!KINDS[it.kind].noFrame) {
          const nf = { x: num('f-x', 0, -99999, 99999), y: num('f-y', 0, -99999, 99999), w: num('f-pw', 16, 1, 99999), h: num('f-ph', 16, 1, 99999) }, of = it.frame || {};
          const nr = num('f-rot', 0, -360, 360), rotChanged = Math.abs(nr - Math.round(it.rot || 0)) > 0.5;
          if (rotChanged) it.rot = nr;
          if (rotChanged || ['x', 'y', 'w', 'h'].some((k) => Math.abs((nf[k] || 0) - Math.round(of[k] || 0)) > 0.5)) { it.frame = nf; it.fitMode = 'free'; captureRel(it); }   // só vira "livre" se você mudou os números
        }
      }
    }
    R.modal = null; save(); reconcile(); paint();
  }

  function buildPanel() {
    const root = shadow.querySelector('.root');
    panel = document.createElement('div'); panel.className = 'panel'; root.appendChild(panel);
    renderPanel();
  }
  function renderPanel() {
    if (!panel) return;
    panel.className = 'panel' + (R.min ? ' pill' : '');
    mt = { master: null, db: null, ch: {} };
    if (R.min) {
      panel.innerHTML = `<div class="pillbar"><b>${ic('video', 14)} CAM LIVE ${R.streaming ? '<span style="color:#ff6b6b;font-size:10px">● AO VIVO</span>' : ''}</b><div style="display:flex;gap:6px"><button class="xb" data-act="min" title="Restaurar">${ic('square', 12)}</button><button class="xb close" data-act="close" title="Fechar">${ic('x', 14)}</button></div></div>`;
      previewCanvas = null;
    } else {
      fitBox = '';
      panel.innerHTML = `<div class="phead"><h2>${ic('video', 18)} CAM LIVE</h2><span id="badge" class="badge dim">DESCONECTADO</span><span class="sp"></span>
        <button class="xb" data-act="min" title="Minimizar">${ic('minus', 14)}</button><button class="xb close" data-act="close" title="Fechar">${ic('x', 14)}</button></div>
        <div id="fbar" class="fbar"></div>
        <div class="body"><div class="oprev"><canvas id="cv" width="${P.video.w}" height="${P.video.h}"></canvas><div id="toast" class="otoast"></div></div><div id="docks" class="docks"></div></div>
        <div class="ostatus"><span style="display:inline-flex;align-items:center;gap:7px"><i id="sdot" class="sdot"></i><b data-st="status">Pronto</b><span data-st="time"></span></span><span class="sp"></span>
          <span data-st="fps">0 fps</span><span data-st="kbps">0 kb/s</span><span data-st="dropped">Quadros perdidos: 0</span><span data-st="cong">Congestão: 0%</span><span data-st="lagged">Atrasados: 0</span><span data-st="bitrate">Bitrate: 0 kbps</span></div>
        <div id="modal"></div><div class="dropov">Solte fotos, vídeos ou áudios para adicionar</div>
        ${['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map((d) => `<div class="rz" data-rz="${d}"></div>`).join('')}`;
      previewCanvas = q('#cv'); bindCanvas(previewCanvas); paint();
    }
    applyGeom(); bindWindow();
  }
  function applyGeom() {
    const w = R.min ? PILL_W : G.w, h = R.min ? PILL_H : G.h;
    const x = Math.max(0, Math.min(G.x, innerWidth - w)), y = Math.max(0, Math.min(G.y, innerHeight - h));
    panel.classList.toggle('compact', !R.min && w < 640);
    Object.assign(panel.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
  }
  function bindWindow() {
    const handle = panel.querySelector('.phead,.pillbar');
    handle.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      const sx = e.clientX, sy = e.clientY, ox = G.x, oy = G.y, pw = R.min ? PILL_W : G.w, ph = R.min ? PILL_H : G.h; panel.classList.add('dragging'); handle.setPointerCapture(e.pointerId);
      const mv = (ev) => { G.x = Math.max(0, Math.min(ox + ev.clientX - sx, innerWidth - pw)); G.y = Math.max(0, Math.min(oy + ev.clientY - sy, innerHeight - ph)); applyGeom(); };
      const up = () => { panel.classList.remove('dragging'); handle.removeEventListener('pointermove', mv); handle.removeEventListener('pointerup', up); };
      handle.addEventListener('pointermove', mv); handle.addEventListener('pointerup', up);
    });
    panel.querySelectorAll('.rz').forEach((rz) => rz.addEventListener('pointerdown', (e) => {
      const d = rz.dataset.rz, sx = e.clientX, sy = e.clientY, o = { ...G };
      const minW = Math.min(MIN_W, o.w), minH = Math.min(MIN_H, o.h); rz.setPointerCapture(e.pointerId); e.stopPropagation();
      const mv = (ev) => {
        const dx = ev.clientX - sx, dy = ev.clientY - sy;
        if (d.includes('e')) G.w = Math.max(minW, Math.min(o.w + dx, innerWidth - o.x));
        if (d.includes('s')) G.h = Math.max(minH, Math.min(o.h + dy, innerHeight - o.y));
        if (d.includes('w')) { const nw = Math.max(minW, Math.min(o.w - dx, o.x + o.w)); G.x = o.x + o.w - nw; G.w = nw; }
        if (d.includes('n')) { const nh = Math.max(minH, Math.min(o.h - dy, o.y + o.h)); G.y = o.y + o.h - nh; G.h = nh; }
        applyGeom();
      };
      const up = () => { rz.removeEventListener('pointermove', mv); rz.removeEventListener('pointerup', up); };
      rz.addEventListener('pointermove', mv); rz.addEventListener('pointerup', up);
    }));
  }

  function itemMenu(e, id) {
    const it = findItem(id); if (!it) return; R.sel = id; paintDocks();
    const vis = !KINDS[it.kind].noFrame;
    ctx(e.clientX, e.clientY, [
      { icon: 'edit', label: 'Renomear', fn: () => startEdit(id) }, { icon: 'sliders', label: 'Propriedades…', fn: () => openProps(id) },
      ...(vis ? ['-', { icon: 'fit', label: 'Ajustar', fn: () => { fitItem(it, 'fit'); save(); } }, { icon: 'fit', label: 'Preencher tela', fn: () => { fitItem(it, 'cover'); save(); } }, { icon: 'fit', label: 'Esticar', fn: () => { fitItem(it, 'stretch'); save(); } }] : []),
      ...(vis ? [{ icon: 'rotate', label: 'Girar 90°', fn: () => { if (it.locked) return toast('Item bloqueado: desbloqueie para girar.'); it.rot = (((Math.round((it.rot || 0) / 90) * 90 + 90 + 180) % 360) - 180); it.fitMode = 'free'; captureRel(it); save(); } }, { icon: 'rotate', label: 'Zerar rotação', fn: () => { it.rot = 0; it.fitMode = 'free'; captureRel(it); save(); } }] : []),
      '-', { icon: it.locked ? 'unlock' : 'lock', label: it.locked ? 'Desbloquear posição' : 'Bloquear posição', fn: () => toggleLock(it) },
      { icon: it.visible ? 'eyeOff' : 'eye', label: it.visible ? 'Ocultar na saída' : 'Mostrar na saída', fn: () => toggleVisible(it) },
      '-', { icon: 'trash', label: 'Remover', danger: true, fn: () => removeItem(id) },
    ]);
  }
  function onClick(e) {
    try { const a = audio(); a && a.resume(); } catch (_) {}      // gesto do usuário: libera o áudio do navegador
    if (R.needGesture) playAll();
    if (e.target.closest('[data-edit]')) return;
    const act = e.target.closest('[data-act]');
    if (act) { const a = act.dataset.act; if (a === 'close') closeWindow(); if (a === 'min') { R.min = !R.min; if (!R.min) syncPhoneControlPosition(); renderPanel(); } return; }
    const el = e.target.closest('[data-m]'); if (!el || el.classList.contains('dis')) return; const a = el.dataset.m, id = el.dataset.id;
    if (a === 'fmt' || a === 'q' || a === 'orient') {
      if (R.streaming) { toast('Pare a transmissão para mudar o formato.'); return; }
      const v = el.dataset.v; setFormat(a === 'fmt' ? { fmt: v } : a === 'q' ? { q: +v } : { orient: v }); return;
    }
    if (a === 'item' || a === 'name') { const iid = el.closest('[data-m="item"]').dataset.id; if (R.sel !== iid) { R.sel = iid; paintDocks(); } return; }
    if (a === 'eye') { const it = findItem(id); if (it) toggleVisible(it); }
    if (a === 'lock') { const it = findItem(id); if (it) toggleLock(it); }
    if (a === 'mute') { const it = findItem(id); if (it) { it.muted = !it.muted; applyAudio(it); save(); paintDocks(); } }
    if (a === 'monitor') { const it = findItem(id); if (it) { it.monitor = !it.monitor; applyAudio(it); save(); paintDocks(); } }
    if (a === 'add') { const r = el.getBoundingClientRect(); addMenu(r.left, r.bottom + 2); }
    if (a === 'src-del') R.sel && removeItem(R.sel);
    if (a === 'src-up') moveItem(R.sel, true);
    if (a === 'src-down') moveItem(R.sel, false);
    if (a === 'src-rename') R.sel && startEdit(R.sel);
    if (a === 'src-props') openProps(R.sel);
    if (a === 'stream') (R.streaming ? stopStreaming() : startStreaming());
    if (a === 'settings') { R.modal = { type: 'settings' }; paintModal(); }
    if (a === 'modal-close') { R.modal = null; paintModal(); }
    if (a === 'modal-ok') modalOk();
    if (a === 'modal-rot90' || a === 'modal-rot0') { const f = q('#f-rot'); if (f) { const cur = parseFloat(f.value) || 0; f.value = a === 'modal-rot0' ? 0 : ((Math.round(cur / 90) * 90 + 90 + 180) % 360) - 180; } }
    if (a === 'modal-fit' || a === 'modal-cover' || a === 'modal-stretch') { const m = R.modal, it = findItem(m.id); if (it) { fitItem(it, a === 'modal-fit' ? 'fit' : a === 'modal-cover' ? 'cover' : 'stretch'); R.modal = { ...m }; save(); paintModal(); } }
    if (a === 'modal-reopen') {
      const m = R.modal, it = findItem(m.id);
      if (it) pickFiles(it.kind, false, (fs) => { const f = fs[0]; it.path = f.name; delete R.missing[it.id]; idbPut(it.id, f); mountFile(it, f, true); R.modal = { ...m }; save(); paint(); });
    }
  }
  function onDbl(e) {
    if (e.target.closest('.oic') || e.target.closest('[data-edit]')) return;
    const el = e.target.closest('[data-m="item"]'); if (el) startEdit(el.dataset.id);
  }
  function onKey(e) {
    if (e.target && e.target.hasAttribute && e.target.hasAttribute('data-edit')) {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); commitEdit(); } else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
      return;
    }
    if (!R.modal) return; e.stopPropagation();
    if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') modalOk();
    if (e.key === 'Escape') { R.modal = null; paintModal(); }
  }
  function onCtx(e) {
    const it = e.composedPath().find((n) => n.dataset && n.dataset.m === 'item');
    if (it) { e.preventDefault(); itemMenu(e, it.dataset.id); }
  }
  function onChange(e) {
    if (e.target.id === 'f-target') { const usb = e.target.value === 'iphone'; q('#f-rtmp').style.display = usb ? 'none' : ''; q('#f-usb-note').style.display = usb ? '' : 'none'; }
    if (e.target.id === 'f-preset') { const p = PRESETS.find((x) => x.id === e.target.value); if (p && p.url) { q('#f-url').value = p.url; q('#f-key').value = p.key; } q('#f-rtmp-settings').style.display = e.target.value === 'iphone' ? 'none' : ''; q('#f-usb-info').style.display = e.target.value === 'iphone' ? '' : 'none'; }
    if (e.target.id === 'f-ratio') setFormat({ ratio: e.target.value });
    if (e.target.dataset && e.target.dataset.vol) save();
  }
  function onInput(e) {
    const id = e.target.dataset && e.target.dataset.vol; if (!id) return;
    const it = findItem(id); if (!it) return; it.volume = Math.max(0, Math.min(1, +e.target.value / 100));
    applyAudio(it); const lbl = q(`[data-volv="${id}"]`); if (lbl) lbl.textContent = Math.round(it.volume * 100) + '%'; save();
  }
  function onFocusOut(e) { if (R.painting) return; if (e.target && e.target.hasAttribute && e.target.hasAttribute('data-edit') && R.editing) commitEdit(); }
  const hasFiles = (e) => !!(e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files'));
  let dropT = 0;
  function onDragOver(e) {
    if (R.min || !hasFiles(e)) return; e.preventDefault(); try { e.dataTransfer.dropEffect = 'copy'; } catch (_) {}
    panel.classList.add('dropping'); clearTimeout(dropT); dropT = setTimeout(() => panel.classList.remove('dropping'), 160);
  }
  function onDrop(e) {
    if (R.min || !hasFiles(e)) return; e.preventDefault(); clearTimeout(dropT); panel.classList.remove('dropping');
    const fs = [...e.dataTransfer.files]; if (fs.length) addFiles(fs);
  }

  /* ───────────── abrir/fechar + botão da barra ───────────── */
  let pairedPhoneControl = null;
  function syncPhoneControlPosition() {
    const header = document.querySelector('.pm-drag');
    const phone = document.querySelector('[data-phone-control-window]') ||
      header?.closest('.react-draggable') || header?.parentElement;
    if (!phone || phone.hidden) {
      pairedPhoneControl = null;
      return;
    }
    if (pairedPhoneControl === phone) return;
    const rect = phone.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    pairedPhoneControl = phone;
    placeBesidePhoneControl(rect);
    applyGeom();
  }
  function placeBesidePhoneControl(rect) {

    const gap = 8;
    const right = innerWidth - rect.right - gap * 2;
    const left = rect.left - gap * 2;
    const onRight = right >= MIN_W || right >= left;
    const available = onRight ? right : left;
    if (available >= 360) {
      G.w = Math.min(G.w, available);
      G.x = onRight ? rect.right + gap : rect.left - gap - G.w;
      G.y = rect.top;
      return;
    }

    const below = innerHeight - rect.bottom - gap * 2;
    const above = rect.top - gap * 2;
    const onBottom = below >= MIN_H || below >= above;
    const height = onBottom ? below : above;
    if (height >= 300) {
      G.h = Math.min(G.h, height);
      G.x = rect.left;
      G.y = onBottom ? rect.bottom + gap : rect.top - gap - G.h;
    }
  }
  async function openWindow() {
    ensureHost(); if (!R.loaded) await load();
    if (!panel) {
      buildPanel(); const root = shadow.querySelector('.root');
      root.addEventListener('click', onClick); root.addEventListener('dblclick', onDbl); root.addEventListener('keydown', onKey); root.addEventListener('contextmenu', onCtx);
      root.addEventListener('change', onChange); root.addEventListener('input', onInput); root.addEventListener('focusout', onFocusOut);
      root.addEventListener('dragover', onDragOver); root.addEventListener('drop', onDrop);
    } else panel.style.display = 'flex';
    R.open = true; R.min = false;
    pairedPhoneControl = null; syncPhoneControlPosition();
    renderPanel(); reconcile(); playAll(); ensureLoop(); updateButton();
  }
  function closeWindow() {
    R.open = false; if (panel) panel.style.display = 'none'; closeCtx();
    if (!R.streaming) { for (const id of [...rt.keys()]) { const it = findItem(id); if (it && (it.kind === 'screen' || it.kind === 'camera')) unmount(id); } pauseAll(); }
    updateButton();
  }
  function toggleWindow() { (R.open ? closeWindow : openWindow)(); }

  let btn = null;
  function updateButton() {
    if (!btn) return; const on = R.open, live = R.streaming;
    btn.style.background = on ? 'rgba(255,176,32,.2)' : 'rgba(255,176,32,.07)'; btn.style.borderColor = on ? 'rgba(255,176,32,.85)' : 'rgba(255,176,32,.35)';
    btn.style.boxShadow = on ? '0 0 15px rgba(255,176,32,.55)' : 'none';
    const dot = btn.querySelector('[data-cl-dot]'); if (dot) dot.style.display = live ? 'inline-block' : 'none';
  }
  function injectButton() {
    if (document.getElementById('nova-cam-live-btn')) return;
    const ref = [...document.querySelectorAll('button')].find((b) => /^\s*(?:AI Upload|Envio com IA)\s*$/i.test(b.textContent || ''));
    if (!ref) return;
    btn = ref.cloneNode(true); btn.id = 'nova-cam-live-btn'; btn.removeAttribute('title');
    btn.className = ref.className.split(/\s+/).filter((c) => !/red-|text-red|bg-red|border-red/.test(c)).join(' ');
    btn.innerHTML = `<span data-cl-dot style="display:none;width:7px;height:7px;border-radius:50%;background:#ff3b3b;box-shadow:0 0 8px #ff3b3b"></span>${ic('video', 13)}<span>CAM LIVE</span>`;
    Object.assign(btn.style, { color: '#ffb020', border: '1px solid rgba(255,176,32,.35)', background: 'rgba(255,176,32,.07)', fontFamily: "'Righteous', cursive" });
    btn.addEventListener('mouseenter', () => { if (!R.open) btn.style.background = 'rgba(255,176,32,.18)'; });
    btn.addEventListener('mouseleave', updateButton);
    btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); toggleWindow(); });
    ref.insertAdjacentElement('afterend', btn); updateButton();
  }
  let mo = null, moT = 0;
  function watch() {
    injectButton();
    mo = new MutationObserver(() => {
      if (R.open && !R.min) syncPhoneControlPosition();
      if (moT || document.getElementById('nova-cam-live-btn')) return;
      moT = setTimeout(() => { moT = 0; injectButton(); }, 150);
    });
    mo.observe(document.body, { childList: true, subtree: true, attributeFilter: ['hidden'] });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch); else watch();

  window.camLive = { open: openWindow, close: closeWindow, toggle: toggleWindow, state: () => ({ P, R, G }), startStreaming, stopStreaming, addFiles, setFormat, _enc: () => enc };
  ipcLog('módulo CAM LIVE carregado; WebCodecs=' + (typeof VideoEncoder !== 'undefined') + '; CamLiveAudio=' + !!audio());
  if (typeof VideoEncoder !== 'undefined') {
    VideoEncoder.isConfigSupported({ codec: 'avc1.4d001f', width: 1280, height: 720, bitrate: 2500000, framerate: 30, latencyMode: 'realtime', avc: { format: 'avc' }, hardwareAcceleration: 'prefer-hardware' }).then((s) => ipcLog('H.264 hardware suportado=' + s.supported)).catch((e) => ipcLog('H.264 hw erro ' + e.message));
    VideoEncoder.isConfigSupported({ codec: 'avc1.4d001f', width: 1280, height: 720, bitrate: 2500000, framerate: 30, latencyMode: 'realtime', avc: { format: 'avc' }, hardwareAcceleration: 'prefer-software' }).then((s) => ipcLog('H.264 software suportado=' + s.supported)).catch((e) => ipcLog('H.264 sw erro ' + e.message));
  }
})();
