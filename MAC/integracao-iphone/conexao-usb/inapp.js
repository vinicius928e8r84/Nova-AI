'use strict';

// Janela "Conectar iPhone por USB" desenhada dentro da própria janela do Nova.
//
// Este módulo roda no preload (mundo isolado): ele compartilha o DOM da página
// com o renderer, mas não as variáveis JavaScript dele. Por isso o modal não
// depende do bundle React e continua funcionando depois de uma atualização do
// app — o renderer só precisa disparar o canal 'physical-mobile:start-stream'.

const STYLE_ID = 'nova-iphone-setup-style';
const HOST_ATTR = 'data-nova-iphone-setup';
const OPEN_CHANNEL = 'nova:iphone-setup-open';
const PREPARE_CHANNEL = 'physical-mobile:iphone-prepare';
const CONSOLE_URL_CHANNEL = 'physical-mobile:ios-console-url';
const CONSOLE_WINDOW_CHANNEL = 'physical-mobile:ios-console';
const CONSOLE_OPEN_CHANNEL = 'nova:iphone-console-open';
const START_CHANNEL = 'physical-mobile:start-stream';

const CSS = `
[${HOST_ATTR}]{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;
  padding:24px;background:rgba(2,6,8,.74);-webkit-backdrop-filter:blur(7px);backdrop-filter:blur(7px);
  font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#d6e4e8;
  animation:nvios-fade .14s ease-out}
[${HOST_ATTR}] *{box-sizing:border-box}
[${HOST_ATTR}] [hidden]{display:none!important}
[${HOST_ATTR}] .nvios-card{width:min(540px,100%);max-height:calc(100vh - 48px);display:flex;flex-direction:column;
  background:linear-gradient(180deg,#0b151a,#070f13);border:1px solid rgba(0,213,237,.28);border-radius:16px;
  box-shadow:0 28px 90px rgba(0,0,0,.7),inset 0 1px 0 rgba(255,255,255,.04);overflow:hidden;
  animation:nvios-pop .16s ease-out}
[${HOST_ATTR}] .nvios-head{display:flex;align-items:center;gap:10px;padding:18px 20px 0;flex:0 0 auto}
[${HOST_ATTR}] .nvios-chip{font:600 10px/1 "JetBrains Mono",ui-monospace,monospace;letter-spacing:.14em;
  text-transform:uppercase;color:#00d5ed;background:rgba(0,213,237,.09);border:1px solid rgba(0,213,237,.32);
  border-radius:6px;padding:5px 8px}
[${HOST_ATTR}] .nvios-title{flex:1;margin:0;font-size:19px;font-weight:600;letter-spacing:.01em;color:#00d5ed}
[${HOST_ATTR}] .nvios-x{width:30px;height:30px;flex:0 0 auto;display:grid;place-items:center;background:transparent;
  border:1px solid transparent;border-radius:8px;color:#8fa4ab;font-size:18px;line-height:1;cursor:pointer;
  transition:background .12s,color .12s,border-color .12s}
[${HOST_ATTR}] .nvios-x:hover{background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.1);color:#eaf6f8}
[${HOST_ATTR}] .nvios-x:disabled{opacity:.3;cursor:not-allowed}
[${HOST_ATTR}] .nvios-device{margin:8px 20px 0;font:500 11px/1.5 "JetBrains Mono",ui-monospace,monospace;
  letter-spacing:.04em;color:#7f959d;word-break:break-word;flex:0 0 auto}
[${HOST_ATTR}] .nvios-scroll{padding:16px 20px 20px;overflow:auto}
[${HOST_ATTR}] .nvios-desc{margin:0 0 16px;font-size:13px;line-height:1.65;color:#9eafb6}
[${HOST_ATTR}] .nvios-label{display:block;margin-bottom:8px;font-size:12px;font-weight:600;
  letter-spacing:.04em;text-transform:uppercase;color:#b8cbd1}
[${HOST_ATTR}] .nvios-input{width:100%;padding:13px 14px;border-radius:10px;background:#0d1a21;
  border:1px solid #24404b;color:#eaf6f8;font-size:14px;outline:none;transition:border-color .12s,box-shadow .12s}
[${HOST_ATTR}] .nvios-input::placeholder{color:#5d757e}
[${HOST_ATTR}] .nvios-input:focus{border-color:rgba(0,213,237,.65);box-shadow:0 0 0 3px rgba(0,213,237,.14)}
[${HOST_ATTR}] .nvios-hint{margin:10px 0 0;font-size:12px;line-height:1.6;color:#778c94}
[${HOST_ATTR}] .nvios-error{margin:12px 0 0;padding:10px 12px;border-radius:9px;font-size:12.5px;line-height:1.5;
  color:#ffc2cf;background:rgba(255,84,119,.1);border:1px solid rgba(255,84,119,.35)}
[${HOST_ATTR}] .nvios-primary,.nvios-ghost{display:inline-flex;align-items:center;justify-content:center;
  width:100%;min-height:44px;padding:12px 16px;border-radius:10px;font-size:13.5px;font-weight:700;
  letter-spacing:.02em;cursor:pointer;transition:filter .12s,background .12s,border-color .12s}
[${HOST_ATTR}] .nvios-primary{background:#00d5ed;border:1px solid #00d5ed;color:#032127}
[${HOST_ATTR}] .nvios-primary:hover:not(:disabled){filter:brightness(1.08)}
[${HOST_ATTR}] .nvios-primary:disabled,.nvios-ghost:disabled{opacity:.55;cursor:progress}
[${HOST_ATTR}] .nvios-submit{margin-top:16px}
[${HOST_ATTR}] .nvios-ghost{background:transparent;border:1px solid #2b424c;color:#c2d4da}
[${HOST_ATTR}] .nvios-ghost:hover:not(:disabled){background:rgba(255,255,255,.05);border-color:#3d5b66}
[${HOST_ATTR}] .nvios-primary:focus-visible,[${HOST_ATTR}] .nvios-ghost:focus-visible,
[${HOST_ATTR}] .nvios-x:focus-visible,[${HOST_ATTR}] .nvios-input:focus-visible{
  outline:2px solid rgba(0,213,237,.75);outline-offset:2px}
[${HOST_ATTR}] .nvios-progress{display:flex;flex-direction:column;align-items:center;gap:10px;
  padding:26px 6px 10px;text-align:center}
[${HOST_ATTR}] .nvios-spinner{width:22px;height:22px;border-radius:50%;border:2px solid rgba(0,213,237,.22);
  border-top-color:#00d5ed;animation:nvios-spin .8s linear infinite}
[${HOST_ATTR}] .nvios-step{margin:0;max-width:400px;font-size:13px;line-height:1.6;color:#b8cbd1}
[${HOST_ATTR}] .nvios-elapsed{margin:0;font:500 11px/1 "JetBrains Mono",ui-monospace,monospace;
  letter-spacing:.06em;color:#6d838c}
[${HOST_ATTR}] .nvios-warn{margin:0;font-size:11.5px;color:#8a7f5c}
[${HOST_ATTR}] .nvios-msg{margin:0;font-size:13px;line-height:1.7;color:#cfe1e6;white-space:pre-wrap;word-break:break-word}
[${HOST_ATTR}] .nvios-msg::before{content:"✓  ";color:#28e6a4;font-weight:700}
[${HOST_ATTR}] .nvios-actions{display:flex;flex-direction:column;gap:10px;margin-top:18px}
[${HOST_ATTR}] .nvios-console{width:min(1180px,100%);height:min(880px,calc(100vh - 48px));max-height:none}
[${HOST_ATTR}] .nvios-console .nvios-head{padding-bottom:14px;border-bottom:1px solid rgba(0,213,237,.14)}
[${HOST_ATTR}] .nvios-console-window{width:auto;flex:0 0 auto;white-space:nowrap;min-height:32px;padding:7px 12px;font-size:12px;font-weight:600}
[${HOST_ATTR}] .nvios-console-retry{width:auto;flex:0 0 auto;white-space:nowrap;min-height:32px;padding:7px 12px;font-size:12px;font-weight:600}
[${HOST_ATTR}] .nvios-console .nvios-title{white-space:nowrap}
[${HOST_ATTR}] .nvios-webview-wrap{position:relative;flex:1 1 auto;display:flex;min-height:0;background:#050a10}
[${HOST_ATTR}] .nvios-webview{flex:1 1 auto;width:100%;height:100%;border:0;background:#050a10}
[${HOST_ATTR}] .nvios-webview-status{position:absolute;inset:0;display:grid;place-items:center;
  padding:24px;text-align:center;font-size:13px;line-height:1.6;color:#8fa4ab;background:#050a10}
@keyframes nvios-fade{from{opacity:0}to{opacity:1}}
@keyframes nvios-pop{from{opacity:0;transform:translateY(6px) scale(.985)}to{opacity:1;transform:none}}
@keyframes nvios-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){
  [${HOST_ATTR}],[${HOST_ATTR}] .nvios-card,[${HOST_ATTR}] .nvios-spinner{animation:none}
}
`;

const SETUP_MARKUP = `
<div class="nvios-card nvios-setup" role="dialog" aria-modal="true" aria-labelledby="nvios-title">
  <div class="nvios-head">
    <span class="nvios-chip">USB</span>
    <h2 class="nvios-title" id="nvios-title">Conectar iPhone por USB</h2>
    <button class="nvios-x" type="button" aria-label="Fechar">&times;</button>
  </div>
  <p class="nvios-device"></p>
  <div class="nvios-scroll">
    <form class="nvios-form" novalidate>
      <p class="nvios-desc">Mantenha apenas este iPhone conectado, desbloqueado e com o jailbreak ativo. O OpenSSH precisa estar instalado pelo Sileo.</p>
      <label class="nvios-label" for="nvios-pass">Senha SSH do usuário mobile</label>
      <input class="nvios-input" id="nvios-pass" type="password" autocomplete="off" spellcheck="false"
        placeholder="Senha definida no ambiente do jailbreak">
      <p class="nvios-hint">É a senha do terminal, diferente do código da tela. Ela não é salva. O Nova configura uma chave de acesso neste Mac e instala a ponte de câmera só em aparelhos compatíveis.</p>
      <p class="nvios-error" role="alert" hidden></p>
      <button class="nvios-primary nvios-submit" type="submit">Conectar e preparar</button>
    </form>
    <div class="nvios-progress" hidden>
      <span class="nvios-spinner" aria-hidden="true"></span>
      <p class="nvios-step">Conectando por USB, verificando o jailbreak e preparando o acesso…</p>
      <p class="nvios-elapsed">0 s</p>
      <p class="nvios-warn">Não feche o Nova durante a preparação.</p>
    </div>
    <div class="nvios-result" hidden>
      <p class="nvios-msg" role="status"></p>
      <div class="nvios-actions">
        <button class="nvios-primary nvios-console-open" type="button">Abrir controle e tela do iPhone</button>
        <button class="nvios-ghost nvios-done" type="button">Fechar</button>
      </div>
    </div>
  </div>
</div>
`;

const CONSOLE_MARKUP = `
<div class="nvios-card nvios-console" role="dialog" aria-modal="true" aria-label="Controle e tela do iPhone">
  <div class="nvios-head">
    <span class="nvios-chip">USB</span>
    <h2 class="nvios-title">Controle e tela do iPhone</h2>
    <button class="nvios-ghost nvios-console-retry" type="button" hidden>Refazer conexão</button>
    <button class="nvios-ghost nvios-console-window" type="button">Abrir em janela</button>
    <button class="nvios-x nvios-console-close" type="button" aria-label="Fechar">&times;</button>
  </div>
  <div class="nvios-webview-wrap">
    <div class="nvios-webview-status">Carregando o controle do iPhone…</div>
  </div>
</div>
`;

let active = null;
let activeConsole = null;

function ensureStyle(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  (doc.head || doc.documentElement).appendChild(style);
}

function deviceLine(payload) {
  const name = String((payload && payload.name) || '').trim();
  const id = String((payload && payload.id) || '');
  const tail = id.length > 8 ? '…' + id.slice(-8) : id;
  if (name && tail) return name + ' · ' + tail;
  return name || (tail ? 'iPhone ' + tail : 'iPhone conectado por USB');
}

function open(payload, invoke) {
  if (active) {
    active.update(payload);
    active.focusPassword();
    return;
  }
  if (!payload || !payload.id) return;

  const doc = document;
  ensureStyle(doc);

  const host = doc.createElement('div');
  host.setAttribute(HOST_ATTR, '');
  host.innerHTML = SETUP_MARKUP + CONSOLE_MARKUP;

  const setupCard = host.querySelector('.nvios-setup');
  const consoleCard = host.querySelector('.nvios-console');
  consoleCard.hidden = true;
  const deviceEl = host.querySelector('.nvios-device');
  const form = host.querySelector('.nvios-form');
  const input = host.querySelector('#nvios-pass');
  const submitBtn = host.querySelector('.nvios-submit');
  const errorEl = host.querySelector('.nvios-error');
  const progressEl = host.querySelector('.nvios-progress');
  const elapsedEl = host.querySelector('.nvios-elapsed');
  const resultEl = host.querySelector('.nvios-result');
  const messageEl = host.querySelector('.nvios-msg');
  const consoleOpenBtn = host.querySelector('.nvios-console-open');
  const doneBtn = host.querySelector('.nvios-done');
  const closeX = host.querySelector('.nvios-setup .nvios-x');
  const consoleCloseBtn = host.querySelector('.nvios-console-close');
  const consoleWindowBtn = host.querySelector('.nvios-console-window');
  const webviewWrap = host.querySelector('.nvios-webview-wrap');
  const webviewStatus = host.querySelector('.nvios-webview-status');
  const previousFocus = doc.activeElement;
  const state = { id: String(payload.id), name: '', running: false, timer: null, startedAt: 0 };

  function applyDeviceLabels() {
    if (state.name && state.id) deviceEl.textContent = state.name + ' · …' + state.id.slice(-8);
    else deviceEl.textContent = deviceLine({ id: state.id, name: state.name });
  }

  function setRunning(running) {
    state.running = running;
    form.hidden = running;
    progressEl.hidden = !running;
    closeX.disabled = running;
    if (running) {
      state.startedAt = Date.now();
      elapsedEl.textContent = '0 s';
      state.timer = setInterval(() => {
        const seconds = Math.max(0, Math.round((Date.now() - state.startedAt) / 1000));
        elapsedEl.textContent = (seconds < 60 ? seconds + ' s' : Math.floor(seconds / 60) + ' min ' + (seconds % 60) + ' s');
      }, 500);
    } else {
      if (state.timer) { clearInterval(state.timer); state.timer = null; }
    }
  }

  function showError(text) {
    errorEl.textContent = text;
    errorEl.hidden = false;
    submitBtn.disabled = false;
    submitBtn.textContent = 'Tentar novamente';
    form.hidden = false;
    resultEl.hidden = true;
    progressEl.hidden = true;
    input.disabled = false;
    input.focus();
    input.select();
  }

  function showSuccess(text) {
    errorEl.hidden = true;
    form.hidden = true;
    progressEl.hidden = true;
    resultEl.hidden = false;
    messageEl.textContent = text || 'Conectado por USB.';
  }

  async function submit(event) {
    event.preventDefault();
    if (state.running) return;
    errorEl.hidden = true;
    let password = input.value;
    if (!password) {
      showError('Informe a senha SSH do usuário mobile.');
      return;
    }
    input.value = '';
    input.disabled = true;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Conectando…';
    setRunning(true);
    let result;
    try {
      result = await invoke(PREPARE_CHANNEL, { id: state.id, password });
    } catch (err) {
      result = { success: false, error: (err && err.message) || 'Não foi possível concluir. Verifique o cabo e tente novamente.' };
    } finally {
      password = '';
    }
    setRunning(false);
    input.disabled = false;
    if (result && result.success) {
      showSuccess(result.message);
      consoleOpenBtn.focus();
    } else {
      showError((result && (result.error || result.message)) || 'Não foi possível concluir. Verifique o cabo e tente novamente.');
    }
  }

  function close() {
    if (state.running) return;
    doc.removeEventListener('keydown', onKeydown, true);
    host.remove();
    if (state.timer) clearInterval(state.timer);
    active = null;
    try { if (previousFocus && previousFocus.focus) previousFocus.focus(); } catch (e) { /* ignora */ }
  }

  function onKeydown(event) {
    if (event.key === 'Escape' && !state.running) {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  }

  function mountConsole(url) {
    setupCard.hidden = true;
    consoleCard.hidden = false;
    let view;
    try {
      view = doc.createElement('webview');
    } catch (e) {
      view = null;
    }
    if (!view) {
      webviewStatus.textContent = 'Esta versão do Nova não permite embutir a tela. Use "Abrir em janela".';
      return;
    }
    view.className = 'nvios-webview';
    view.setAttribute('src', url);
    view.setAttribute('allowpopups', '');
    view.addEventListener('did-finish-load', () => { webviewStatus.hidden = true; });
    view.addEventListener('did-fail-load', () => {
      webviewStatus.hidden = false;
      webviewStatus.textContent = 'Não foi possível carregar a tela do iPhone. Confira o cabo e tente de novo, ou use "Abrir em janela".';
    });
    webviewWrap.appendChild(view);
    consoleCloseBtn.focus();
  }

  function showConsoleMessage(text) {
    setupCard.hidden = true;
    consoleCard.hidden = false;
    webviewStatus.hidden = false;
    webviewStatus.textContent = text;
  }

  async function openConsole() {
    consoleOpenBtn.disabled = true;
    consoleOpenBtn.textContent = 'Abrindo o controle…';
    let result;
    try {
      result = await invoke(CONSOLE_URL_CHANNEL, state.id);
    } catch (err) {
      result = { success: false, error: (err && err.message) || 'O controle do iPhone não abriu.' };
    }
    consoleOpenBtn.disabled = false;
    consoleOpenBtn.textContent = 'Abrir controle e tela do iPhone';
    if (result && result.success && result.url) mountConsole(result.url);
    else showConsoleMessage((result && result.error) || 'O controle do iPhone não abriu.');
  }

  async function openConsoleWindow() {
    consoleWindowBtn.disabled = true;
    let result;
    try {
      result = await invoke(CONSOLE_WINDOW_CHANNEL, state.id);
    } catch (err) {
      result = { success: false, error: (err && err.message) || 'Não foi possível abrir a janela do controle.' };
    }
    consoleWindowBtn.disabled = false;
    if (result && result.success) close();
    else showConsoleMessage((result && result.error) || 'Não foi possível abrir a janela do controle.');
  }

  host.querySelector('.nvios-form').addEventListener('submit', submit);
  closeX.addEventListener('click', close);
  doneBtn.addEventListener('click', close);
  consoleCloseBtn.addEventListener('click', close);
  consoleOpenBtn.addEventListener('click', openConsole);
  consoleWindowBtn.addEventListener('click', openConsoleWindow);
  host.addEventListener('mousedown', (event) => { if (event.target === host && !state.running) close(); });
  doc.addEventListener('keydown', onKeydown, true);

  active = {
    update(next) {
      if (next && next.id) state.id = String(next.id);
      if (next && next.name) state.name = String(next.name);
      applyDeviceLabels();
    },
    focusPassword() {
      if (!state.running) input.focus();
    },
  };

  state.name = String(payload.name || '');
  applyDeviceLabels();
  doc.body.appendChild(host);
  setTimeout(() => input.focus(), 30);
}

// Console aberto direto pelo cartão do aparelho ("Abrir controle"): sem senha.
function openConsoleOnly(payload, invoke) {
  if (!payload || !payload.id) return;
  if (activeConsole) { activeConsole.focus(); return; }

  const doc = document;
  ensureStyle(doc);
  const host = doc.createElement('div');
  host.setAttribute(HOST_ATTR, '');
  host.innerHTML = CONSOLE_MARKUP;

  const webviewWrap = host.querySelector('.nvios-webview-wrap');
  const webviewStatus = host.querySelector('.nvios-webview-status');
  const closeBtn = host.querySelector('.nvios-console-close');
  const windowBtn = host.querySelector('.nvios-console-window');
  const retryBtn = host.querySelector('.nvios-console-retry');
  const id = String(payload.id);
  const previousFocus = doc.activeElement;

  function close() {
    doc.removeEventListener('keydown', onKeydown, true);
    host.remove();
    activeConsole = null;
    try { if (previousFocus && previousFocus.focus) previousFocus.focus(); } catch (e) { /* ignora */ }
  }

  function onKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  }

  function showError(text) {
    webviewStatus.hidden = false;
    webviewStatus.textContent = text;
    retryBtn.hidden = false;
  }

  function mount(url) {
    let view;
    try { view = doc.createElement('webview'); } catch (e) { view = null; }
    if (!view) {
      showError('Esta versão do Nova não permite embutir a tela. Use "Abrir em janela".');
      return;
    }
    view.className = 'nvios-webview';
    view.setAttribute('src', url);
    view.setAttribute('allowpopups', '');
    view.addEventListener('did-finish-load', () => { webviewStatus.hidden = true; });
    view.addEventListener('did-fail-load', () => {
      showError('Não foi possível carregar a tela do iPhone. Confira o cabo e tente de novo, ou use "Abrir em janela".');
    });
    webviewWrap.appendChild(view);
    closeBtn.focus();
  }

  async function carregar() {
    retryBtn.hidden = false;
    webviewStatus.hidden = false;
    webviewStatus.textContent = 'Carregando o controle do iPhone…';
    let result;
    try { result = await invoke(CONSOLE_URL_CHANNEL, id); }
    catch (err) { result = { success: false, error: (err && err.message) || 'O controle do iPhone não abriu.' }; }
    if (result && result.success && result.url) mount(result.url);
    else showError((result && result.error) || 'O controle do iPhone não abriu.');
  }

  closeBtn.addEventListener('click', close);
  host.addEventListener('mousedown', (event) => { if (event.target === host) close(); });
  doc.addEventListener('keydown', onKeydown, true);

  windowBtn.addEventListener('click', async () => {
    windowBtn.disabled = true;
    let result;
    try { result = await invoke(CONSOLE_WINDOW_CHANNEL, id); }
    catch (err) { result = { success: false, error: (err && err.message) || 'Não foi possível abrir a janela do controle.' }; }
    windowBtn.disabled = false;
    if (result && result.success) close();
    else showError((result && result.error) || 'Não foi possível abrir a janela do controle.');
  });

  retryBtn.addEventListener('click', async () => {
    // Fecha o controle e reabre o quadro de senha do Conectar.
    retryBtn.disabled = true;
    close();
    try { await invoke(START_CHANNEL, id); } catch (e) { /* o main abre o modal */ }
  });

  activeConsole = { focus() { closeBtn.focus(); } };
  doc.body.appendChild(host);
  carregar();
}

// Chamado uma única vez pelo preload. `invoke` existe para os testes em
// navegador/Electron trocarem o IPC por uma função de mentira.
function attach({ ipcRenderer, invoke }) {
  const run = invoke || ((channel, ...args) => ipcRenderer.invoke(channel, ...args));
  ipcRenderer.on(OPEN_CHANNEL, (_event, payload) => open(payload, run));
  ipcRenderer.on(CONSOLE_OPEN_CHANNEL, (_event, payload) => openConsoleOnly(payload, run));
  return { open: (payload) => open(payload, run) };
}

module.exports = { attach };
