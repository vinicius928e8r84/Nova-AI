// Harness: serve uma página "fake Nova" + o cam-live.js; o IPC do renderer vai por HTTP para o serviço REAL (cam-live-service.js).
// uso: node harness.js   -> http://localhost:8765   (RTMP de destino: ffmpeg -listen na 19351)
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const { spawn } = require('child_process');
require('../../../app/electron/services/cam-live-service.js');

const PORT = parseInt(process.env.PORT || '8766', 10), RTMP_PORT = parseInt(process.env.RTMP_PORT || '19351', 10);
const sse = new Set();
const handlers = new Map(), ons = new Map();
const ipcMain = { handle: (c, f) => handlers.set(c, f), on: (c, f) => ons.set(c, f) };
const win = { isDestroyed: () => false, webContents: { send: (ch, p) => { const m = `data: ${JSON.stringify({ ch, p })}\n\n`; sse.forEach((r) => r.write(m)); } } };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'camlive-h-'));
const { UsbMedia } = require('../../../app/electron/services/cam-live-iphone.js');
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

const out = path.join(dir, 'out.flv');
let listener = null;
const startListener = () => { listener = spawn('ffmpeg', ['-y', '-v', 'warning', '-listen', '1', '-i', `rtmp://127.0.0.1:${RTMP_PORT}/live/cam`, '-c', 'copy', '-f', 'flv', out], { stdio: 'inherit' }); };

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

http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/') { res.setHeader('content-type', 'text/html'); return res.end(PAGE); }
  if (u === '/cam-live-audio.js') { res.setHeader('content-type', 'application/javascript'); try { return res.end(fs.readFileSync(path.join(__dirname, '../../../app/dist/cam-live-audio.js'))); } catch (e) { return res.end('/* cam-live-audio.js ainda não existe */'); } }
  if (u.startsWith('/fixtures/')) { const f = path.join(__dirname, 'fixtures', path.basename(u)); if (fs.existsSync(f)) { res.setHeader('content-type', f.endsWith('.png') ? 'image/png' : f.endsWith('.mp4') ? 'video/mp4' : 'audio/wav'); return res.end(fs.readFileSync(f)); } res.statusCode = 404; return res.end(); }
  if (/^\/cam-live(-dados|-modelo|-geometria)?\.js$/.test(u)) { res.setHeader('content-type', 'application/javascript'); return res.end(fs.readFileSync(path.join(__dirname, '../../../app/dist', u))); }
  if (u === '/counts') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(globalThis.__counts)); }
  if (u === '/events') { res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }); res.write(': ok\n\n'); sse.add(res); req.on('close', () => sse.delete(res)); return; }
  if (u === '/listen') { if (listener) { try { listener.kill('SIGKILL'); } catch (_) {} } startListener(); return res.end('listening'); }
  if (u === '/kill') { if (listener) { try { listener.kill('SIGKILL'); } catch (_) {} } return res.end('killed'); }
  if (u === '/result') { try { if (listener) listener.kill('SIGINT'); } catch (_) {} setTimeout(() => { const pr = require('child_process').spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_type,codec_name,profile,width,height,nb_read_frames,avg_frame_rate,channels,sample_rate', '-of', 'json', out]); res.setHeader('content-type', 'application/json'); res.end(pr.stdout.length ? pr.stdout : JSON.stringify({ err: pr.stderr.toString() })); }, 1200); return; }
  if (u === '/log') { try { return res.end(fs.readFileSync(path.join(dir, 'CamLive', 'camlive.log'), 'utf8')); } catch (e) { return res.end('(sem log)'); } }
  let body = ''; req.on('data', (d) => (body += d)); req.on('end', async () => {
    const m = /^\/ipc\/(invoke|send)\/(.+)$/.exec(u); if (!m) { res.statusCode = 404; return res.end(); }
    const arg = body ? JSON.parse(body) : null;
    if (arg && arg.data && Array.isArray(arg.data)) arg.data = Uint8Array.from(arg.data);
    if (arg && arg.__u8) { const b = Uint8Array.from(arg.__u8); return ons.get(m[2]) && ons.get(m[2])({}, b), res.end('{}'); }
    if (m[1] === 'invoke') { const h = handlers.get(m[2]); const r = h ? await h({}, arg) : null; res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(r === undefined ? null : r)); }
    const h = ons.get(m[2]); if (h) h({}, arg); res.end('{}');
  });
}).listen(PORT, () => console.log(`harness em http://localhost:${PORT}  (RTMP ffmpeg na ${RTMP_PORT})`));
