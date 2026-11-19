'use strict';
// Nova AI — iOS Bridge: iPhone por USB dentro do app (Apple Silicon port).
// Serve a pagina "iPhone Console" em 127.0.0.1:8778 com: info do aparelho,
// tela ao vivo (CatVNC via noVNC) e acoes por SSH (uiopen, screenshot, apps).
const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile, spawn } = require('child_process');
const iphoneSsh = require('./iphone-ssh');
const { WebSocketServer } = require('ws');

const PORT = parseInt(process.env.NOVA_IOS_PORT || '8778', 10);
const VNC_PORT = 5900;            // CatVNC no iPhone (encaminhado pelo iproxy)
const SSH_ARGS = ['-p', '2222', ...iphoneSsh.sshOptions(),
  '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-o', 'StrictHostKeyChecking=accept-new',
  'mobile@127.0.0.1'];
const NOVNC_DIR = path.join(__dirname, '..', '..', 'node_modules', '@novnc', 'novnc');
const TMP_DIR = path.join(os.tmpdir(), 'nova-ios-bridge');

let server = null;
let wss = null;
let iproxyChild = null;
let vncWsCount = 0;

function run(cmd, args, timeoutMs) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs || 12000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || ''), error: err ? err.message : null });
    });
  });
}

function ssh(command) {
  try { return run(require('./tool-paths').exigirOpenssh('ssh'), SSH_ARGS.concat(command)); }
  catch (erro) { return Promise.resolve({ ok: false, stdout: '', stderr: '', error: erro.message }); }
}

// ── iproxy: mantem o encaminhamento VNC do celular vivo ──
function vncReachable() {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port: VNC_PORT, timeout: 1500 });
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => { s.destroy(); resolve(false); });
    s.once('timeout', () => { s.destroy(); resolve(false); });
  });
}

function spawnIproxy() {
  if (!server || iproxyChild) return;
  iproxyChild = spawn(require('./ios-tools').tool('iproxy'), ['5900', '5900'], { stdio: 'ignore', windowsHide: true });
  iproxyChild.once('error', () => { iproxyChild = null; });
  iproxyChild.once('exit', () => { iproxyChild = null; });
}

function portOpen(port) {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port, timeout: 1500 });
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => { s.destroy(); resolve(false); });
    s.once('timeout', () => { s.destroy(); resolve(false); });
  });
}

let sshProxyChild = null;
function spawnSshProxy() {
  if (!server || sshProxyChild) return;
  sshProxyChild = spawn(require('./ios-tools').tool('iproxy'), ['2222', '22'], { stdio: 'ignore', windowsHide: true });
  sshProxyChild.once('error', () => { sshProxyChild = null; });
  sshProxyChild.once('exit', () => { sshProxyChild = null; });
}

setInterval(async () => {
  if (!server) return;
  try {
    const ok = await vncReachable();
    if (!ok && !iproxyChild) spawnIproxy();
  } catch (e) { /* ignora */ }
  try {
    const sshOk = await portOpen(2222);
    if (!sshOk && !sshProxyChild) spawnSshProxy();
  } catch (e) { /* ignora */ }
}, 15000).unref();

// ── Helpers de acoes ──
async function deviceInfo() {
  const keys = ['DeviceName', 'ProductType', 'ProductVersion', 'ModelNumber', 'SIMStatus'];
  const out = { connected: false };
  const info = await run(require('./ios-tools').tool('ideviceinfo'), ['-u', await firstUdid()], 10000);
  if (!info.ok) return out;
  out.connected = true;
  for (const k of keys) {
    const m = info.stdout.split('\n').find(l => l.startsWith(k + ':'));
    if (m) out[k] = m.split(':').slice(1).join(':').trim();
  }
  const bat = await run(require('./ios-tools').tool('ideviceinfo'), ['-q', 'com.apple.mobile.battery', '-k', 'BatteryCurrentCapacity'], 8000);
  if (bat.ok) out.battery = bat.stdout.trim();
  return out;
}

let udidCache = null;
async function firstUdid() {
  if (udidCache) return udidCache;
  const r = await run(require('./ios-tools').tool('idevice_id'), ['-l'], 8000);
  udidCache = (r.stdout.split('\n')[0] || '').trim();
  return udidCache;
}

async function listApps() {
  const r = await run(require('./ios-tools').tool('ideviceinstaller'), ['list'], 25000);
  if (!r.ok && !r.stdout) return { ok: false, error: r.error || r.stderr, apps: [] };
  const apps = [];
  r.stdout.split('\n').forEach((l) => {
    if (!l.trim() || l.startsWith('CFBundleIdentifier')) return;
    const parts = l.split(',').map(x => x.trim().replace(/^"|"$/g, ''));
    if (parts[0]) apps.push({ bundleId: parts[0], name: parts[2] || parts[0] });
  });
  return { ok: true, apps };
}

function openOnPhone(target) {
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s]+$/.test(target)) return Promise.resolve({ ok: false, error: 'URL invalida (use esquema://...)' });
  return ssh('uiopen ' + JSON.stringify(target)).then(r => ({ ok: r.ok, error: r.ok ? null : (r.stderr || r.error) }));
}

function launchApp(bundleId) {
  if (!/^[A-Za-z0-9.-]+$/.test(bundleId)) return Promise.resolve({ ok: false, error: 'bundle id invalido' });
  return ssh('uiopen --bundleid ' + JSON.stringify(bundleId)).then(r => ({ ok: r.ok, error: r.ok ? null : (r.stderr || r.error) }));
}

// ── Ponte WebSocket <-> VNC TCP (para o noVNC da pagina) ──
function attachVncBridge(wssInstance) {
  wssInstance.on('connection', (ws) => {
    vncWsCount++;
    const tcp = net.connect({ host: '127.0.0.1', port: VNC_PORT });
    tcp.on('data', (buf) => { try { if (ws.readyState === 1) ws.send(buf, { binary: true }); } catch (e) {} });
    ws.on('message', (buf) => { try { tcp.write(Buffer.from(buf)); } catch (e) {} });
    const cleanup = () => { try { tcp.destroy(); } catch (e) {} vncWsCount--; };
    tcp.on('error', cleanup);
    tcp.on('close', () => { try { ws.close(); } catch (e) {} });
    ws.on('close', cleanup);
    ws.on('error', cleanup);
  });
}

// ── Pagina do console ──
const PAGE = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nova AI — iPhone Console (USB)</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }
  body { background:#050a10; color:#c8d6e5; padding:18px; }
  h1 { font-size:15px; letter-spacing:3px; color:#00e5ff; margin-bottom:4px; }
  .sub { font-size:12px; color:#64748b; margin-bottom:14px; }
  .grid { display:grid; grid-template-columns: minmax(340px, 520px) 1fr; gap:16px; align-items:start; }
  @media (max-width:900px){ .grid { grid-template-columns: 1fr; } }
  .card { background:rgba(0,229,255,.05); border:1px solid rgba(0,229,255,.25); border-radius:10px; padding:14px; margin-bottom:14px; }
  .card h2 { font-size:12px; letter-spacing:2px; color:#00e5ff; margin-bottom:10px; }
  .row { display:flex; gap:8px; flex-wrap:wrap; margin-top:8px; }
  button, input { font-size:13px; border-radius:7px; }
  button { background:rgba(0,229,255,.12); border:1px solid rgba(0,229,255,.5); color:#7dd3fc; padding:7px 12px; cursor:pointer; }
  button:hover { background:rgba(0,229,255,.25); }
  button:disabled { opacity:.4; cursor:default; }
  input { background:#0b1622; border:1px solid #22405c; color:#dbeafe; padding:7px 10px; flex:1; min-width:200px; }
  #info div { font-size:13px; padding:2px 0; }
  #info span { color:#00e5ff; }
  .vncwrap { background:#000; border-radius:10px; border:1px solid rgba(0,229,255,.25); padding:6px; }
  #vnc { width:100%; height:58vh; background:#000; }
  #vncStatus { font-size:13px; color:#ffd166; margin-bottom:6px; }
  #shot img { max-width:100%; border-radius:8px; border:1px solid #22405c; }
  .apps button { margin:0 6px 6px 0; font-size:12px; }
  .status { font-size:12px; color:#64748b; margin-top:6px; }
  .ok { color:#00ff9d; } .bad { color:#ff5477; }
</style></head>
<body>
  <h1>IPHONE CONSOLE</h1>
  <div class="sub">iPhone 8 Plus por cabo USB — tela ao vivo via CatVNC + acoes via SSH. Nao usa Wi-Fi.</div>
  <div class="grid">
    <div>
      <div class="card" id="info"><h2>APARELHO</h2><div class="status">carregando...</div></div>
      <div class="card"><h2>ACOES</h2>
        <div class="row"><input id="url" placeholder="https://site-ou-esquema://para-abrir"><button id="btnOpen">Abrir no iPhone</button></div>
        <div class="row"><button id="btnShot">Screenshot</button><button id="btnApps">Listar apps</button></div>
        <div id="shot" class="status"></div>
        <div id="apps" class="apps" style="margin-top:8px"></div>
      </div>
    </div>
    <div class="card"><h2>TELA AO VIVO (clique = toque)</h2>
      <div class="status" id="vncStatus">conectando ao VNC pela porta USB...</div>
      <div class="row" id="passRow" style="display:none">
        <input type="password" id="vncpass" placeholder="Senha do CatVNC (a que você definiu no Ajustes > CatVNC)">
        <button id="btnPass">Conectar</button>
      </div>
      <div class="vncwrap" style="margin-top:8px"><div id="vnc"></div></div>
      <div class="status">Quadro preto? Acorda o iPhone (tela acesa/destravada) e confere a senha.</div>
    </div>
  </div>
<script type="module">
import RFB from './novnc/core/rfb.js';
let savedPassword = localStorage.getItem('nova-vnc-pass') || '';
let rfb = null;
function connectVnc() {
  const status = document.getElementById('vncStatus');
  status.textContent = 'conectando ao VNC pela porta USB...';
  try { if (rfb) rfb.disconnect(); } catch (e) {}
  rfb = new RFB(document.getElementById('vnc'), 'ws://' + location.host + '/vnc',
                { shared: true, credentials: { password: savedPassword } });
  rfb.scaleViewport = true;
  rfb.background = '#000000';
  rfb.addEventListener('connect', () => { status.textContent = 'conectado — clique na tela para tocar'; status.className = 'status ok'; document.getElementById('passRow').style.display = 'none'; });
  rfb.addEventListener('securityfailure', (e) => { status.textContent = 'falha de segurança: ' + (e.detail && e.detail.reason || 'verifique a senha do CatVNC'); status.className = 'status bad'; });
  rfb.addEventListener('disconnect', () => { status.textContent = 'desconectado — reconectando em 3s...'; status.className = 'status bad'; setTimeout(connectVnc, 3000); });
  setTimeout(() => { if (status.className.indexOf('ok') === -1) document.getElementById('passRow').style.display = 'flex'; }, 6000);
  rfb.addEventListener('credentialsrequired', () => {
    document.getElementById('passRow').style.display = 'flex';
    document.getElementById('vncpass').focus();
    document.getElementById('vncStatus').textContent = 'informe a senha do CatVNC e clique Conectar';
  });
  document.getElementById('btnPass').onclick = () => {
    const p = document.getElementById('vncpass').value;
    if (!p) return;
    savedPassword = p;
    localStorage.setItem('nova-vnc-pass', p);
    document.getElementById('passRow').style.display = 'none';
    rfb.sendCredentials({ password: p });
  };
}
connectVnc();
async function fetchJson(u, ms) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try { const r = await fetch(u, { signal: c.signal }); return await r.json(); }
  finally { clearTimeout(t); }
}
async function refreshInfo() {
  const el = document.getElementById('info');
  el.innerHTML = '<h2>APARELHO</h2><div class="status">carregando...</div>';
  try {
    const d = await fetchJson('/api/info', 8000);
    if (!d.connected) { el.innerHTML = '<h2>APARELHO</h2><div class="status bad">iPhone nao visivel — pluga o cabo de dados</div>'; setTimeout(refreshInfo, 8000); return; }
    el.innerHTML = '<h2>APARELHO</h2><div><span>Nome:</span> ' + (d.DeviceName||'?') + '</div>'
      + '<div><span>Modelo:</span> ' + (d.ProductType||'?') + '</div>'
      + '<div><span>iOS:</span> ' + (d.ProductVersion||'?') + '</div>'
      + '<div><span>Bateria:</span> ' + (d.battery||'?') + '%</div>';
  } catch (e) { el.innerHTML = '<h2>APARELHO</h2><div class="status bad">erro: ' + e.message + '</div>'; }
}
document.getElementById('btnOpen').onclick = async () => {
  const v = document.getElementById('url').value.trim(); if (!v) return;
  const r = await (await fetch('/api/open?url=' + encodeURIComponent(v))).json();
  document.getElementById('shot').textContent = r.ok ? 'comando enviado.' : ('erro: ' + r.error);
};
document.getElementById('btnShot').onclick = () => {
  const c = document.querySelector('#vnc canvas');
  if (!c) { document.getElementById('shot').textContent = 'conecte a tela ao vivo primeiro'; return; }
  const a = document.createElement('a');
  a.download = 'iphone-tela.png';
  a.href = c.toDataURL('image/png');
  a.click();
  document.getElementById('shot').textContent = 'imagem da tela salva (Downloads).';
};
document.getElementById('btnApps').onclick = async () => {
  const r = await (await fetch('/api/apps')).json();
  const box = document.getElementById('apps');
  box.innerHTML = r.ok ? r.apps.map(a => '<button data-b="' + a.bundleId + '">' + a.name + '</button>').join('') : ('erro: ' + r.error);
  box.querySelectorAll('button').forEach(b => b.onclick = async () => {
    const r = await (await fetch('/api/launch?id=' + encodeURIComponent(b.dataset.b))).json();
    document.getElementById('shot').textContent = r.ok ? 'abrindo ' + b.textContent + '...' : ('erro: ' + r.error);
  });
};
refreshInfo(); setInterval(refreshInfo, 30000);
</script></body></html>`;

const MIME = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.svg': 'image/svg+xml', '.map': 'application/json' };

function start() {
  if (server) return { ok: true, port: PORT, already: true };
  if (!require('./ios-tools').available()) return { ok: false, error: 'Ferramentas do iPhone ausentes neste sistema.' };
  server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    const send = (code, body, type) => { res.writeHead(code, { 'Content-Type': type || 'application/json', 'Cache-Control': 'no-store' }); res.end(body); };
    try {
      if (u.pathname === '/' || u.pathname === '/index.html') return send(200, PAGE, 'text/html; charset=utf-8');
      if (u.pathname.startsWith('/novnc/')) {
        const rel = path.normalize(u.pathname.replace('/novnc/', ''));
        const file = path.join(NOVNC_DIR, rel);
        if (!file.startsWith(NOVNC_DIR) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(404, 'not found', 'text/plain');
        return send(200, fs.readFileSync(file), MIME[path.extname(file)] || 'application/octet-stream');
      }
      if (u.pathname === '/api/info') return deviceInfo().then(d => send(200, JSON.stringify(d)));
      if (u.pathname === '/api/apps') return listApps().then(d => send(200, JSON.stringify(d)));
      if (u.pathname === '/api/open') return openOnPhone(u.searchParams.get('url') || '').then(d => send(200, JSON.stringify(d)));
      if (u.pathname === '/api/launch') return launchApp(u.searchParams.get('id') || '').then(d => send(200, JSON.stringify(d)));
      send(404, 'not found', 'text/plain');
    } catch (e) { send(500, JSON.stringify({ ok: false, error: e.message })); }
  });
  wss = new WebSocketServer({ server, path: '/vnc' });
  attachVncBridge(wss);
  server.listen(PORT, '127.0.0.1', () => {
    console.log('[iOSBridge] iPhone Console em http://127.0.0.1:' + PORT + ' (USB only)');
    vncReachable().then(ok => { if (!ok) spawnIproxy(); });
  });
  server.on('error', (err) => console.error('[iOSBridge] erro:', err.message));
  return { ok: true, port: PORT };
}

function stop() {
  const activeServer = server;
  server = null;
  if (wss) {
    for (const client of wss.clients) client.terminate();
    wss.close();
    wss = null;
  }
  activeServer?.close();
  iproxyChild?.kill();
  sshProxyChild?.kill();
}

module.exports = { start, stop, PORT, isRunning: () => !!server };
