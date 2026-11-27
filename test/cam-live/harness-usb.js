require('../../app/electron/services/cam-live-service.js');
const { UsbMedia } = require('../../app/electron/services/cam-live-iphone.js');
const { criarBancada } = require('./harness-servidor.js');

const { ipcMain, dir, iniciar } = criarBancada(8766, 19351);
const media = new UsbMedia(); const counts = { starts: 0, stops: 0, frames: 0, badFrames: 0, pcm: 0, pcmBytes: 0, sampleRates: {}, lastStart: null, lastError: '' };
globalThis.__counts = counts;
ipcMain.handle('camlive:studio-load', () => null); ipcMain.handle('camlive:studio-save', () => ({ ok: true }));
ipcMain.handle('camlive:start', (_e, cfg) => { counts.starts++; counts.lastStart = cfg; return { ok: true }; });
ipcMain.handle('camlive:stop', () => { counts.stops++; return { ok: true }; });
const bin = (x) => (x && x.__bin ? Uint8Array.from(x.__bin) : x);
ipcMain.handle('camlive:frame', (_e, d) => { const r = media.frame(bin(d)); if (r.ok) counts.frames++; else { counts.badFrames++; counts.lastError = r.error; } return r; });
ipcMain.handle('camlive:pcm', (_e, p) => { counts.pcm++; counts.pcmBytes += bin(p.data).length; counts.sampleRates[p.sampleRate] = 1; return { ok: true }; });
ipcMain.on('camlive:log', () => {});
console.log('userData de teste:', dir);

const PAGE = `<!doctype html><meta charset=utf8><title>Nova (harness)</title>
<body style="background:#0F172A;color:#ddd;font-family:sans-serif"><div id=bar style="display:flex;gap:8px;padding:10px;border-bottom:1px solid #234">
<button class="px-3 py-1.5 bg-red-500/10 border-red-500/30 text-red-400" style="padding:6px 12px;border-radius:8px;border:1px solid;background:#2a1418;color:#f87171">AI Upload</button></div>
<script>
window.electronAPI={isMobile:false,
 invoke:(c,...a)=>fetch('/ipc/invoke/'+c,{method:'POST',body:JSON.stringify(a[0]===undefined?null:a[0],(k,v)=>v instanceof Uint8Array?{__bin:Array.from(v)}:v)}).then(r=>r.json()),
 send:(c,p)=>{ if(p&&p.data) p={...p,data:Array.from(p.data)}; else if(p instanceof Uint8Array) p={__u8:Array.from(p)}; fetch('/ipc/send/'+c,{method:'POST',body:JSON.stringify(p===undefined?null:p)}); },
 on:(c,cb)=>{(window.__on=window.__on||{})[c]=cb;return()=>{}}};
const es=new EventSource('/events'); es.onmessage=e=>{const {ch,p}=JSON.parse(e.data); window.__on&&window.__on[ch]&&window.__on[ch](p)};
</script><script src="/cam-live-audio.js"></script><script src="/cam-live-dados.js"></script><script src="/cam-live-modelo.js"></script><script src="/cam-live-geometria.js"></script><script src="/cam-live.js"></script>`;

iniciar(PAGE, { '/counts': (req, res) => { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(globalThis.__counts)); } });
