'use strict';

const { BrowserWindow, session, app, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { chromium, firefox } = require('playwright');
const { STEALTH_SCRIPT, DETECT_EMAIL_SCRIPT, BYPASS_POPUPS_SCRIPT } = require('./fazenda-scripts');

const PARADO = Symbol('parado');
const URL_DO_GOOGLE = 'https://accounts.google.com/signin';
const ARGUMENTOS_BASE = [
  '--no-first-run',
  '--no-default-browser-check',
  '--force-webrtc-ip-handling-policy=default_public_interface_only',
  '--lang=en-US',
];
const URLS_DE_LOGIN = new Map([
  ['youtube', 'https://accounts.google.com/signin'],
  ['tiktok', 'https://www.tiktok.com/login'],
  ['instagram', 'https://www.instagram.com/accounts/login/'],
  ['twitter', 'https://x.com/i/flow/login'],
]);
const ESCOLHA_DO_LOGIN = { padrao: 'aloha', executavel: (fazenda, escolha) => fazenda._executavelDoLogin(escolha) };
const ESCOLHA_DA_EXECUCAO = { padrao: 'chrome', executavel: (fazenda, escolha) => fazenda._executavelDaExecucao(escolha) };
const RECOMECOS = new Map([
  [2, { texto: 'segundaTentativa', espera: 3000 }],
  [3, { texto: 'terceiraTentativa', espera: 3500 }],
]);
const TEXTOS_DO_LOGIN = {
  segundaTentativa: 'Attempt 2: Clearing corrupted profile directory...',
  terceiraTentativa: 'Attempt 3: Final retry with fresh profile...',
  buscaDaGeo: 'Fetching optimal timezone/locale via proxy...',
  lancando: navegador => `Starting ${navegador} via Playwright launchPersistentContext...`,
};
const TEXTOS_DA_EXECUCAO = {
  segundaTentativa: 'Attempt 2: Clearing corrupted profile dir...',
  terceiraTentativa: 'Attempt 3: Final retry with fresh profile...',
  buscaDaGeo: 'Fetching optimal geo-sync...',
  lancando: navegador => `Launching ${navegador} via launchPersistentContext...`,
};
const FORMATOS_SEM_ARROBA = new Map([
  [4, parts => ({ host: parts[0], port: parts[1], username: parts[2], password: parts[3] })],
  [2, parts => ({ host: parts[0], port: parts[1], username: '', password: '' })],
]);

const getLoginUrl = platform => URLS_DE_LOGIN.get(platform) || URL_DO_GOOGLE;
const enderecoDeLogin = (profile, platform) => (profile.email ? URL_DO_GOOGLE : getLoginUrl(platform || 'youtube'));
const pastaDoPerfil = profileId => path.join(app.getPath('userData'), 'farm_profiles', profileId);
const ehCelular = plt => plt === 'android' || plt === 'ios';
const coordenada = valor => valor ?? 0;
const opcaoOtima = valor => valor === 'optimal';
const usaGeoOtima = profile => opcaoOtima(profile.timezone) || opcaoOtima(profile.locale);
const textoDoTamanho = tamanho => (tamanho.maximized ? 'Maximized' : `${tamanho.width}x${tamanho.height}`);
const argumentoDaJanela = tamanho => (tamanho.maximized ? '--start-maximized' : `--window-size=${tamanho.width},${tamanho.height}`);
const viewportDoLancamento = (tamanho, plt) => (tamanho.maximized && !ehCelular(plt) ? null : { width: tamanho.width, height: tamanho.height });
const credenciaisDoProxy = parsed => (parsed.username ? { username: parsed.username, password: parsed.password } : {});
const proxyDoPlaywright = parsed => (parsed ? { server: parsed.proxyRules, ...credenciaisDoProxy(parsed) } : undefined);
const emailValido = valor => (typeof valor === 'string' && valor.trim() ? valor.trim() : null);
const tentativaContinua = () => true;

function separarProtocolo(str) {
  const protoMatch = str.match(/^([a-zA-Z0-9]+):\/\/(.*)$/);
  return protoMatch ? { protocol: protoMatch[1].toLowerCase(), cleanStr: protoMatch[2] } : { protocol: 'http', cleanStr: str };
}

function enderecoComCredenciais(cleanStr) {
  const parts = cleanStr.split('@');
  const authParts = parts[0].split(':');
  const hostParts = parts[1].split(':');
  return { host: hostParts[0], port: hostParts[1] || '', username: authParts[0], password: authParts[1] || '' };
}

function enderecoSemCredenciais(cleanStr) {
  const parts = cleanStr.split(':');
  const formato = FORMATOS_SEM_ARROBA.get(parts.length);
  return formato ? formato(parts) : { host: cleanStr, port: '', username: '', password: '' };
}

function parseProxy(proxyStr) {
  if (!proxyStr) return null;
  const str = proxyStr.trim();
  if (!str) return null;
  const { protocol, cleanStr } = separarProtocolo(str);
  const { host, port, username, password } = cleanStr.includes('@') ? enderecoComCredenciais(cleanStr) : enderecoSemCredenciais(cleanStr);
  return { protocol, host, port, username, password, proxyRules: `${protocol}://${host}${port ? ':' + port : ''}` };
}

const autenticarNoProxy = parsed => (event, details, authInfo, callback) => {
  if (!authInfo.isProxy) return;
  event.preventDefault();
  callback(parsed.username, parsed.password);
};

async function configurarProxyDaSessao(ses, parsed) {
  await ses.setProxy({ proxyRules: parsed.proxyRules });
  if (parsed.username) ses.on('login', autenticarNoProxy(parsed));
}

function testarConexao(ses) {
  return new Promise((resolve) => {
    const req = net.request({ method: 'GET', url: 'https://clients3.google.com/generate_204', session: ses, redirect: 'follow' });
    let finished = false;
    const finish = (result) => {
      if (finished) return;
      finished = true;
      resolve(result);
    };
    req.on('response', res => finish(statusDaConexao(res.statusCode)));
    req.on('error', err => finish({ ok: false, error: err.message || 'Connection failed' }));
    req.setTimeout(5000, () => {
      req.abort();
      finish({ ok: false, error: 'Connection timeout' });
    });
    req.end();
  });
}

const statusDaConexao = statusCode => (statusCode >= 200 && statusCode < 400 ? { ok: true } : { ok: false, error: `Bad status code: ${statusCode}` });

function navegadorEscolhido(fazenda, profile, { padrao, executavel }) {
  const browserChoice = profile.browser || padrao;
  return { profile, browserChoice, exePath: executavel(fazenda, browserChoice), playLauncher: browserChoice === 'firefox' ? firefox : chromium };
}

function limparTravas(userDataDir) {
  if (!fs.existsSync(userDataDir)) return;
  try {
    for (const file of fs.readdirSync(userDataDir)) {
      if (file.startsWith('Singleton')) fs.unlinkSync(path.join(userDataDir, file));
    }
  } catch (e) {}
}

async function prepararTentativa(fazenda, profileId, tentativa) {
  limparTravas(tentativa.userDataDir);
  const recomeco = RECOMECOS.get(tentativa.attempt);
  if (!recomeco) return;
  fazenda._log(profileId, tentativa.textos[recomeco.texto], 'warn');
  try { fs.rmSync(tentativa.userDataDir, { recursive: true, force: true }); } catch (e) {}
  await fazenda._sleep(recomeco.espera);
}

function geoInicial(profile) {
  return {
    timezoneVal: opcaoOtima(profile.timezone) ? 'UTC' : (profile.timezone || 'UTC'),
    localeVal: opcaoOtima(profile.locale) ? 'en-US' : (profile.locale || 'en-US'),
    latVal: coordenada(profile.latitude),
    lngVal: coordenada(profile.longitude),
  };
}

function aplicarGeo(fazenda, profile, geo, achada) {
  if (opcaoOtima(profile.timezone)) geo.timezoneVal = achada.timezone;
  if (opcaoOtima(profile.locale)) geo.localeVal = achada.locale;
  geo.latVal = achada.lat; geo.lngVal = achada.lng;
  fazenda._log(profile.id, `Geo-Sync: TZ=${geo.timezoneVal} Locale=${geo.localeVal} Country=${achada.country}`, 'success');
}

async function geoDoPerfil(fazenda, profile, textoDaBusca) {
  const geo = geoInicial(profile);
  if (!usaGeoOtima(profile)) return geo;
  fazenda._log(profile.id, textoDaBusca, 'info');
  const achada = await fazenda.getOptimalGeoDetails(profile);
  if (achada) aplicarGeo(fazenda, profile, geo, achada);
  return geo;
}

function argumentosExtras(profile, tamanho) {
  const extraArgs = [...ARGUMENTOS_BASE, argumentoDaJanela(tamanho)];
  if (profile.hardwareAcceleration === 'disable') extraArgs.push('--disable-gpu', '--disable-software-rasterizer');
  if (profile.disableTlsFeatures === 'open') extraArgs.push('--ssl-version-min=tls1.2');
  return extraArgs;
}

function opcoesDoContexto(fazenda, { profile, exePath }, geo) {
  const sizeCfg = fazenda._getProfileWindowSize(profile);
  const plt = profile.platform || 'windows';
  fazenda._log(profile.id, `[Launch] Platform=${plt} Mode=${profile.windowMode || 'default'} Size=${textoDoTamanho(sizeCfg)}`, 'info');
  const proxy = proxyDoPlaywright(parseProxy(profile.proxy));
  const args = argumentosExtras(profile, sizeCfg);
  return {
    executablePath: exePath,
    headless: false,
    slowMo: 400,
    viewport: viewportDoLancamento(sizeCfg, plt),
    userAgent: profile.ua,
    proxy,
    timezoneId: geo.timezoneVal,
    locale: geo.localeVal,
    geolocation: { latitude: geo.latVal, longitude: geo.lngVal, accuracy: 1 },
    permissions: ['geolocation'],
    args,
    ignoreDefaultArgs: ['--enable-automation'],
  };
}

async function lancarContexto(fazenda, lancamento, tentativa) {
  const { profile } = lancamento;
  await prepararTentativa(fazenda, profile.id, tentativa);
  if (!tentativa.continuar()) return PARADO;
  const geo = await geoDoPerfil(fazenda, profile, tentativa.textos.buscaDaGeo);
  if (!tentativa.continuar()) return PARADO;
  const opcoes = opcoesDoContexto(fazenda, lancamento, geo);
  fazenda._log(profile.id, tentativa.textos.lancando(lancamento.browserChoice.toUpperCase()), 'info');
  return lancamento.playLauncher.launchPersistentContext(tentativa.userDataDir, opcoes);
}

async function instalarScripts(fazenda, context, profile) {
  const spoofScript = fazenda.getStealthSpoofScript(profile);
  await context.addInitScript(spoofScript).catch(() => {});
  await context.addInitScript(STEALTH_SCRIPT).catch(() => {});
  fazenda.playwrightContexts.set(profile.id, context);
}

const primeiraPagina = async context => context.pages()[0] || context.newPage();

function registrarEmail(fazenda, profile, detectado, aviso) {
  const trimmed = emailValido(detectado);
  if (!trimmed || profile.email === trimmed) return;
  profile.email = trimmed;
  fazenda.updateProfile(profile.id, { email: trimmed });
  fazenda._log(profile.id, `${aviso.texto} ${trimmed}`, 'success');
  fazenda._updateStatus(profile.id, aviso.status);
}

const statusDoLogin = fazenda => (fazenda.isRunning ? 'running' : 'idle');

async function verificarEmailDoContexto(fazenda, context, profile, intervalo) {
  try {
    if (context.pages().length === 0) { clearInterval(intervalo); return; }
    const activePage = context.pages()[0];
    if (!activePage) return;
    const detectado = await activePage.evaluate(DETECT_EMAIL_SCRIPT);
    registrarEmail(fazenda, profile, detectado, { texto: 'Auto-detected login email:', status: statusDoLogin(fazenda) });
  } catch (e) { clearInterval(intervalo); }
}

function vigiarContextoDeLogin(fazenda, context, profile) {
  const profileId = profile.id;
  const checkEmailInterval = setInterval(() => verificarEmailDoContexto(fazenda, context, profile, checkEmailInterval), 2000);
  context.on('close', () => {
    clearInterval(checkEmailInterval);
    fazenda.playwrightContexts.delete(profileId);
    fazenda.activeRunProfiles.delete(profileId);
    fazenda._updateStatus(profileId, 'idle');
    fazenda._log(profileId, 'Login browser closed — session saved ✓', 'success');
  });
}

async function prepararContextoDeLogin(fazenda, context, profile, platform) {
  await instalarScripts(fazenda, context, profile);
  const page = await primeiraPagina(context);
  const loginUrl = enderecoDeLogin(profile, platform);
  fazenda._log(profile.id, `Navigating to ${loginUrl}`, 'info');
  await page.goto(loginUrl, { timeout: 15000, waitUntil: 'domcontentloaded' }).catch(() => {});
  vigiarContextoDeLogin(fazenda, context, profile);
}

async function loginPeloPlaywright(fazenda, lancamento, platform) {
  const { profile, browserChoice } = lancamento;
  const profileId = profile.id;
  if (fazenda.activeRunProfiles.size > 0 && !fazenda.activeRunProfiles.has(profileId)) {
    return { success: false, error: 'Another profile login browser is already open. Please close it first.' };
  }
  fazenda.activeRunProfiles.add(profileId);
  fazenda._log(profileId, `Launching ${browserChoice.toUpperCase()} Browser for login...`, 'info');
  const tentativa = { userDataDir: pastaDoPerfil(profileId), textos: TEXTOS_DO_LOGIN, continuar: tentativaContinua };
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const context = await lancarContexto(fazenda, lancamento, { ...tentativa, attempt });
      await prepararContextoDeLogin(fazenda, context, profile, platform);
      return { success: true };
    } catch (err) {
      lastError = err;
      fazenda._log(profileId, `Attempt ${attempt}/3 failed: ${err.message}`, 'warn');
    }
  }
  fazenda.activeRunProfiles.delete(profileId);
  return { success: false, error: `Failed to launch ${browserChoice.toUpperCase()} Browser: ${lastError?.message}` };
}

async function sessaoDoPerfil(fazenda, profile) {
  const ses = session.fromPartition(`persist:farm_${profile.id}`, { cache: true });
  ses.setUserAgent(profile.ua);
  ses.removeAllListeners('login');
  const parsed = parseProxy(profile.proxy);
  if (!parsed) return ses;
  try {
    await configurarProxyDaSessao(ses, parsed);
  } catch (e) {
    fazenda._log(profile.id, `Proxy config error: ${e.message}`, 'error');
  }
  return ses;
}

function janelaDoPerfil(fazenda, profile, ses, { title, ...extras }) {
  const sizeCfg = fazenda._getProfileWindowSize(profile);
  const win = new BrowserWindow({
    width: sizeCfg.width,
    height: sizeCfg.height,
    title,
    webPreferences: {
      session: ses,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
    },
    autoHideMenuBar: true,
    ...extras,
  });
  if (sizeCfg.maximized) win.maximize();
  win.webContents.setUserAgent(profile.ua);
  return win;
}

function injetarFurtivoAoNavegar(win) {
  win.webContents.on('did-navigate', () => {
    win.webContents.executeJavaScript(STEALTH_SCRIPT).catch(() => {});
  });
  win.webContents.on('did-finish-load', () => {
    win.webContents.executeJavaScript(STEALTH_SCRIPT).catch(() => {});
  });
}

async function verificarEmailDaJanela(fazenda, win, profile, intervalo) {
  if (win.isDestroyed()) {
    clearInterval(intervalo);
    return;
  }
  try {
    const detectado = await win.webContents.executeJavaScript(DETECT_EMAIL_SCRIPT);
    registrarEmail(fazenda, profile, detectado, { texto: 'Detected email/login:', status: statusDoLogin(fazenda) });
  } catch (e) {}
}

function vigiarJanelaDeLogin(fazenda, win, profile) {
  const profileId = profile.id;
  const checkEmailInterval = setInterval(() => verificarEmailDaJanela(fazenda, win, profile, checkEmailInterval), 2000);
  win.on('closed', () => {
    clearInterval(checkEmailInterval);
    fazenda.profileWindows.delete(profileId);
    fazenda._updateStatus(profileId, 'idle');
    fazenda._log(profileId, 'Login browser closed — session saved', 'success');
  });
}

async function loginPelaJanela(fazenda, profile, platform) {
  const ses = await sessaoDoPerfil(fazenda, profile);
  const loginUrl = enderecoDeLogin(profile, platform);
  const win = janelaDoPerfil(fazenda, profile, ses, { title: `Nova Farm Login — ${profile.name}` });
  injetarFurtivoAoNavegar(win);
  win.loadURL(loginUrl);
  fazenda.profileWindows.set(profile.id, win);
  fazenda._log(profile.id, `Browser opened for login at ${loginUrl}`, 'info');
  vigiarJanelaDeLogin(fazenda, win, profile);
  return { success: true };
}

async function trouxeContextoParaFrente(fazenda, profileId) {
  const existingPlaywright = fazenda.playwrightContexts.get(profileId);
  if (!existingPlaywright) return false;
  try {
    const pages = existingPlaywright.pages();
    if (pages.length === 0) return false;
    await pages[0].bringToFront();
    return true;
  } catch (e) {
    fazenda.playwrightContexts.delete(profileId);
    return false;
  }
}

async function focouSessaoAberta(fazenda, profileId) {
  if (await trouxeContextoParaFrente(fazenda, profileId)) return true;
  const existing = fazenda.profileWindows.get(profileId);
  if (!existing || existing.isDestroyed()) return false;
  existing.focus();
  return true;
}

async function abrirLogin(fazenda, profile, platform) {
  if (await focouSessaoAberta(fazenda, profile.id)) return { success: true };
  const lancamento = navegadorEscolhido(fazenda, profile, ESCOLHA_DO_LOGIN);
  if (lancamento.exePath) return loginPeloPlaywright(fazenda, lancamento, platform);
  return loginPelaJanela(fazenda, profile, platform);
}

async function esperarAcao(fazenda, actionDelay, descartarPopups) {
  if (actionDelay > 5) {
    await fazenda._sleep((actionDelay - 4) * 1000);
    await descartarPopups();
    await fazenda._sleep(4000);
  } else {
    await fazenda._sleep(actionDelay * 1000);
  }
}

function registrarResultado(fazenda, profileId, action, result) {
  if (result.success) {
    fazenda._log(profileId, `✅ ${action.toUpperCase()} done!`, 'success');
    fazenda._updateStatus(profileId, 'success');
  } else {
    fazenda._log(profileId, `❌ Failed: ${result.error}`, 'error');
    fazenda._updateStatus(profileId, 'error');
  }
}

class ExecucaoNoContexto {
  constructor(fazenda, context, profile, tarefa) {
    this.fazenda = fazenda;
    this.context = context;
    this.profile = profile;
    this.tarefa = tarefa;
    this.page = null;
  }

  async parouEFechou() {
    if (!this.fazenda._parado(this.tarefa.runId)) return false;
    await this.context.close().catch(() => {});
    this.fazenda.playwrightContexts.delete(this.profile.id);
    return true;
  }

  async descartarPopups() {
    try { await this.page.evaluate(BYPASS_POPUPS_SCRIPT); } catch (e) {}
  }

  async detectarEmail() {
    try {
      const detectado = await this.page.evaluate(DETECT_EMAIL_SCRIPT);
      registrarEmail(this.fazenda, this.profile, detectado, { texto: 'Detected email:', status: 'running' });
    } catch (e) {}
  }

  async abrirAlvo() {
    const { fazenda, profile, tarefa } = this;
    this.page = await primeiraPagina(this.context);
    fazenda._log(profile.id, `📍 Navigating → ${tarefa.targetUrl}`, 'info');
    try {
      await this.page.goto(tarefa.targetUrl, { timeout: 15000, waitUntil: 'domcontentloaded' });
    } catch (e) {
      fazenda._log(profile.id, `⚠️ Page load timeout — proceeding anyway...`, 'warn');
    }
  }

  async prepararPagina() {
    const { fazenda, profile, tarefa } = this;
    fazenda._log(profile.id, `✓ Page loaded — human delay ${tarefa.actionDelay}s...`, 'info');
    await this.descartarPopups();
    await fazenda._sleep(2000);
    await this.descartarPopups();
    if (await this.parouEFechou()) return false;
    await this.detectarEmail();
    await fazenda._sleep(1500);
    await this.page.evaluate(() => {
      window.scrollBy({ top: Math.floor(Math.random() * 300) + 100, behavior: 'smooth' });
    }).catch(() => {});
    await esperarAcao(fazenda, tarefa.actionDelay, () => this.descartarPopups());
    await this.descartarPopups();
    return !(await this.parouEFechou());
  }

  async rodar() {
    const { fazenda, context, profile, tarefa } = this;
    if (fazenda._parado(tarefa.runId)) {
      await context.close().catch(() => {});
      return;
    }
    await instalarScripts(fazenda, context, profile);
    await this.abrirAlvo();
    if (await this.parouEFechou()) return;
    if (!(await this.prepararPagina())) return;
    registrarResultado(fazenda, profile.id, tarefa.action, await fazenda._executePlaywrightAction(this.page, tarefa, profile.id));
    await fazenda._sleep(3000);
    await context.close().catch(() => {});
    fazenda.playwrightContexts.delete(profile.id);
    fazenda._log(profile.id, `🔒 Browser closed — session saved`, 'info');
  }
}

async function contextoDaExecucao(fazenda, lancamento, tarefa, userDataDir) {
  const tentativa = { userDataDir, textos: TEXTOS_DA_EXECUCAO, continuar: () => !fazenda._parado(tarefa.runId) };
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (!tentativa.continuar()) return { parado: true };
    try {
      const context = await lancarContexto(fazenda, lancamento, { ...tentativa, attempt });
      return context === PARADO ? { parado: true } : { context };
    } catch (err) {
      lastError = err;
      fazenda._log(lancamento.profile.id, `Attempt ${attempt}/3 failed: ${err.message}`, 'warn');
    }
  }
  return { context: null, lastError };
}

async function rodarPeloPlaywright(fazenda, lancamento, tarefa) {
  const { profile, browserChoice } = lancamento;
  fazenda.activeRunProfiles.add(profile.id);
  const userDataDir = pastaDoPerfil(profile.id);
  let context = null;
  try {
    const lancado = await contextoDaExecucao(fazenda, lancamento, tarefa, userDataDir);
    if (lancado.parado) return;
    context = lancado.context;
    if (!context) {
      fazenda._log(profile.id, `❌ ${browserChoice.toUpperCase()} failed after retries: ${lancado.lastError?.message}`, 'error');
      fazenda._updateStatus(profile.id, 'error');
      return;
    }
    await new ExecucaoNoContexto(fazenda, context, profile, tarefa).rodar();
  } catch (err) {
    fazenda._log(profile.id, `⚠️ Error during run: ${err.message}`, 'error');
    fazenda._updateStatus(profile.id, 'error');
    if (context) await context.close().catch(() => {});
    fazenda.playwrightContexts.delete(profile.id);
  } finally {
    fazenda.activeRunProfiles.delete(profile.id);
  }
}

function carregarComPrazo(fazenda, win, profileId, targetUrl) {
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      fazenda._log(profileId, `⚠️ Page load took too long, stopping load and proceeding...`, 'warn');
      try {
        win.webContents.stop();
      } catch (e) {}
      resolve();
    }, 12000);

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(t);
      resolve();
    };

    win.webContents.once('dom-ready', finish);
    win.webContents.once('did-finish-load', finish);
    win.loadURL(targetUrl).catch(() => {
      finish();
    });
  });
}

class ExecucaoNaJanela {
  constructor(fazenda, win, profile, tarefa) {
    this.fazenda = fazenda;
    this.win = win;
    this.profile = profile;
    this.tarefa = tarefa;
  }

  parouEFechou() {
    if (!this.fazenda._parado(this.tarefa.runId)) return false;
    this.win.close();
    return true;
  }

  descartarPopups() {
    return this.win.webContents.executeJavaScript(BYPASS_POPUPS_SCRIPT).catch(() => {});
  }

  async detectarEmail() {
    try {
      const detectado = await this.win.webContents.executeJavaScript(DETECT_EMAIL_SCRIPT);
      registrarEmail(this.fazenda, this.profile, detectado, { texto: 'Detected email/login:', status: 'running' });
    } catch (e) {}
  }

  async prepararPagina() {
    const { fazenda, win, tarefa } = this;
    fazenda._log(this.profile.id, `✓ Page loaded — human delay ${tarefa.actionDelay}s...`, 'info');
    await this.descartarPopups();
    await fazenda._sleep(2000);
    await this.descartarPopups();
    await this.detectarEmail();
    await fazenda._sleep(1500);
    win.webContents.executeJavaScript(`window.scrollBy({ top: ${Math.floor(Math.random() * 300) + 100}, behavior: 'smooth' })`).catch(() => {});
    await esperarAcao(fazenda, tarefa.actionDelay, () => this.descartarPopups());
    await this.descartarPopups();
  }

  async rodar() {
    const { fazenda, win, profile, tarefa } = this;
    if (this.parouEFechou()) return false;
    injetarFurtivoAoNavegar(win);
    fazenda._log(profile.id, `📍 Navigating → ${tarefa.targetUrl}`, 'info');
    await carregarComPrazo(fazenda, win, profile.id, tarefa.targetUrl);
    if (this.parouEFechou()) return false;
    await this.prepararPagina();
    if (this.parouEFechou()) return false;
    registrarResultado(fazenda, profile.id, tarefa.action, await fazenda._executeAction(win, tarefa, profile.id));
    return true;
  }
}

async function rodarPelaJanela(fazenda, profile, tarefa) {
  const ses = await sessaoDoPerfil(fazenda, profile);
  const win = janelaDoPerfil(fazenda, profile, ses, { title: `[Farm Running] ${profile.name}`, show: true });
  fazenda.profileWindows.set(profile.id, win);
  let concluiu = true;
  try {
    concluiu = await new ExecucaoNaJanela(fazenda, win, profile, tarefa).rodar();
  } catch (err) {
    fazenda._log(profile.id, `❌ Error: ${err.message}`, 'error');
    fazenda._updateStatus(profile.id, 'error');
  }
  if (!concluiu) return;
  await fazenda._sleep(3000);
  if (!win.isDestroyed()) { win.close(); }
  fazenda.profileWindows.delete(profile.id);
  fazenda._log(profile.id, `🔒 Browser closed — session saved`, 'info');
}

function rodarPerfil(fazenda, profile, tarefa) {
  const lancamento = navegadorEscolhido(fazenda, profile, ESCOLHA_DA_EXECUCAO);
  if (lancamento.exePath) return rodarPeloPlaywright(fazenda, lancamento, tarefa);
  return rodarPelaJanela(fazenda, profile, tarefa);
}

module.exports = { parseProxy, configurarProxyDaSessao, testarConexao, abrirLogin, rodarPerfil };
