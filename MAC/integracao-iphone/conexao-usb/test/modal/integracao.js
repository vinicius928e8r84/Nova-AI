// Teste de integração: preload real do Nova + modal desenhado no app.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');

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

const SHOTS = path.join(__dirname, 'shots');
const APP = process.env.NOVA_APP || '/Applications/Nova AI Mac.app/Contents/Resources/app';

ipcMain.on('get-webview-bridge-path', (event) => { event.returnValue = path.join(APP, 'electron/webview-bridge.js'); });
ipcMain.on('get-stealth-preload-path', (event) => { event.returnValue = path.join(APP, 'electron/google-stealth-preload.js'); });

ipcMain.handle('physical-mobile:iphone-prepare', async (_event, data) => {
  console.log('[test] prepare recebeu', JSON.stringify({ id: data && data.id, senhaRecebida: !!(data && data.password), tamanho: (data && data.password || '').length }));
  await new Promise((resolve) => setTimeout(resolve, 700));
  return { success: true, message: 'Conectado por USB. Acesso SSH configurado; a senha não foi salva.\n\nResposta vinda do canal real physical-mobile:iphone-prepare.' };
});
ipcMain.handle('physical-mobile:ios-console-url', async () => ({ success: true, url: 'http://127.0.0.1:8799/' }));
ipcMain.handle('physical-mobile:ios-console', async () => ({ success: false, error: 'sem janela no teste' }));

app.whenReady().then(async () => {
  await new Promise((resolve) => server.listen(8799, '127.0.0.1', resolve));
  const win = new BrowserWindow({
    width: 1400, height: 900, show: true, backgroundColor: '#020406',
    webPreferences: {
      preload: path.join(APP, 'electron/preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false, webviewTag: true,
    },
  });
  win.webContents.on('console-message', (_e, _l, message) => console.log('[renderer]', message));
  await win.loadFile(path.join(__dirname, 'index.html'));
  const temApi = await win.webContents.executeJavaScript('typeof window.electronAPI');
  console.log('[test] electronAPI no renderer:', temApi);
  // Primeiro sem nome (como no app, para abrir na hora); depois o nome chega do ideviceinfo.
  win.webContents.send('nova:iphone-setup-open', { id: 'ios-47F4FC34C3ACF770EB4E3561CAD85FCARDCAC298' });
  await new Promise((resolve) => setTimeout(resolve, 300));
  win.webContents.send('nova:iphone-setup-open', { id: 'ios-47F4FC34C3ACF770EB4E3561CAD85FCARDCAC298', name: 'iPhone 8 Plus (iOS 16.7.16)' });
  await new Promise((resolve) => setTimeout(resolve, 300));
  const modalAberto = await win.webContents.executeJavaScript(`JSON.stringify({
    existe: !!document.querySelector('[data-nova-iphone-setup]'),
    aparelho: document.querySelector('.nvios-device') && document.querySelector('.nvios-device').textContent
  })`);
  console.log('[test] modal aberto:', modalAberto);
  await win.webContents.executeJavaScript(`
    (() => {
      const input = document.getElementById('nvios-pass');
      input.value = 'senha-do-teste-integracao';
      document.querySelector('.nvios-submit').click();
    })()
  `);
  await new Promise((resolve) => setTimeout(resolve, 1600));
  const estado = await win.webContents.executeJavaScript(`JSON.stringify({
    resultadoVisivel: !!document.querySelector('.nvios-result') && !document.querySelector('.nvios-result').hidden,
    mensagem: document.querySelector('.nvios-msg').textContent.slice(0, 60),
    senhaNoDom: !!document.querySelector('.nvios-input') && document.querySelector('.nvios-input').value
  })`);
  console.log('[test] estado:', estado);

  // Fecha o modal de senha e abre o controle direto pelo cartão ("Abrir controle").
  await win.webContents.executeJavaScript(`document.querySelector('.nvios-done').click()`);
  await new Promise((resolve) => setTimeout(resolve, 250));
  win.webContents.send('nova:iphone-console-open', { id: 'ios-47F4FC34C3ACF770EB4E3561CAD85FCARDCAC298' });
  await new Promise((resolve) => setTimeout(resolve, 3200));
  const dentro = await win.webContents.executeJavaScript(`(async () => {
    const w = document.querySelector('webview');
    if (!w) return 'sem webview';
    const box = w.getBoundingClientRect();
    let texto = '';
    try { texto = await w.executeJavaScript('document.body.innerText.slice(0,40)'); } catch (e) { texto = 'erro:' + e.message; }
    const st = document.querySelector('.nvios-webview-status');
    return JSON.stringify({ w: Math.round(box.width), h: Math.round(box.height), texto,
      statusHidden: st.hidden, statusDisplay: getComputedStyle(st).display,
      loading: w.isLoading ? w.isLoading() : 'n/a', crash: w.getWebContentsId ? 'tem-id' : 'sem-id' });
  })()`);
  console.log('[test] webview:', dentro);
  const controle = await win.webContents.executeJavaScript(`JSON.stringify({
    overlay: !!document.querySelector('[data-nova-iphone-setup]'),
    webview: !!document.querySelector('[data-nova-iphone-setup] webview'),
    titulo: document.querySelector('.nvios-console .nvios-title') && document.querySelector('.nvios-console .nvios-title').textContent,
    url: (() => { const w = document.querySelector('webview'); try { return w && w.getURL(); } catch (e) { return 'erro:' + e.message; } })()
  })`);
  console.log('[test] controle do cartão:', controle);

  fs.mkdirSync(SHOTS, { recursive: true });
  fs.writeFileSync(path.join(SHOTS, 'integracao.png'), (await win.webContents.capturePage()).toPNG());
  console.log('[test] saved integracao.png');
  app.exit(0);
}).catch((error) => { console.error('[test] falhou', error); app.exit(1); });
