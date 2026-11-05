const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');

const STATE = process.env.TEST_STATE || 'idle';
const APP = process.env.NOVA_APP || '/Applications/Nova AI Mac.app/Contents/Resources/app';
const SHOTS = path.join(__dirname, 'shots');
const WAIT = { idle: 1200, running: 2600, success: 2800, error: 2800, console: 4800 }[STATE] || 1500;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><meta charset="utf-8"><body style="margin:0;background:#050a10;color:#c8d6e5;font-family:-apple-system,sans-serif;padding:26px">
  <h1 style="color:#00e5ff;letter-spacing:3px;font-size:15px;margin:0 0 6px">IPHONE CONSOLE</h1>
  <p style="color:#64748b;font-size:12px;margin:0 0 18px">pagina de teste carregada dentro do webview</p>
  <div style="display:grid;grid-template-columns:340px 1fr;gap:14px">
    <div style="border:1px solid rgba(0,229,255,.25);border-radius:10px;padding:14px;background:rgba(0,229,255,.05)">
      <h2 style="color:#00e5ff;font-size:12px;letter-spacing:2px">APARELHO</h2>
      <div>DeviceName: <span style="color:#00e5ff">iPhone 8 Plus</span></div>
      <div>ProductVersion: <span style="color:#00e5ff">16.7.16</span></div>
      <div>Battery: <span style="color:#00e5ff">100</span></div>
    </div>
    <div style="border:1px solid rgba(0,229,255,.25);border-radius:10px;padding:14px;background:rgba(0,229,255,.05)">
      <h2 style="color:#00e5ff;font-size:12px;letter-spacing:2px">TELA AO VIVO</h2>
      <div style="height:320px;background:#000;border-radius:8px;display:grid;place-items:center;color:#334155">stub da tela do iPhone</div>
    </div>
  </div></body>`);
});

app.whenReady().then(async () => {
  await new Promise((resolve) => server.listen(8799, '127.0.0.1', resolve));
  const win = new BrowserWindow({
    width: 1400, height: 900, show: true, backgroundColor: '#020406',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false, webviewTag: true,
    },
  });
  win.webContents.on('console-message', (_e, _level, message) => console.log('[renderer]', message));
  win.webContents.on('did-attach-webview', () => console.log('[test] webview attached'));
  await win.loadFile(path.join(__dirname, 'index.html'));
  await new Promise((resolve) => setTimeout(resolve, WAIT));
  const image = await win.webContents.capturePage();
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.writeFileSync(path.join(SHOTS, STATE + '.png'), image.toPNG());
  console.log('[test] saved', STATE + '.png');
  app.exit(0);
}).catch((error) => { console.error('[test] falhou', error); app.exit(1); });
