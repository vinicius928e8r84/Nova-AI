'use strict';

const { session, app, ipcMain, net } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const { findBundledChromiumExecutable, primeiroCaminhoExistente } = require('./platform-utils');
const si = require('systeminformation');
const { ensureProfileStealthSpecs, proximoNumeroDePerfil } = require('./perfil-da-fazenda');
const { SCRIPT_DE_CURTIR, SCRIPT_DE_INSCREVER, SCRIPT_DE_COMPARTILHAR, scriptDeComentar, scriptFurtivoDoPerfil } = require('./fazenda-scripts');
const { parseProxy, configurarProxyDaSessao, testarConexao, abrirLogin, rodarPerfil } = require('./fazenda-navegador');

const MOBILE_UAS = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 14; CPH2573) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 12; Redmi Note 12 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/122.0.6261.89 Mobile/15E148 Safari/604.1',
];

function getLocaleForCountry(countryCode) {
  const map = {
    US: 'en-US',
    GB: 'en-GB',
    PK: 'ur-PK',
    FR: 'fr-FR',
    DE: 'de-DE',
    CA: 'en-CA',
    AU: 'en-AU',
    IN: 'hi-IN',
    AE: 'ar-AE',
    SA: 'ar-SA',
  };
  return map[String(countryCode).toUpperCase()] || 'en-US';
}

function detectPlatform(url) {
  if (!url) return 'unknown';
  if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube';
  if (url.includes('tiktok.com')) return 'tiktok';
  if (url.includes('instagram.com')) return 'instagram';
  if (url.includes('twitter.com') || url.includes('x.com')) return 'twitter';
  return 'unknown';
}

const ESTADOS_FINAIS = ['success', 'error'];
const TAMANHOS_POR_PLATAFORMA = new Map([
  ['android', [412, 915]],
  ['ios', [412, 915]],
  ['mac', [1440, 900]],
  ['linux', [1366, 768]],
]);
const TAMANHO_DO_COMPUTADOR = [1920, 1080];

const ACOES = new Map([
  ['like', (fazenda, alvo) => fazenda._doLike(alvo.win, alvo.platform, alvo.profileId)],
  ['subscribe', (fazenda, alvo) => fazenda._doSubscribe(alvo.win, alvo.platform, alvo.profileId)],
  ['comment', (fazenda, alvo) => fazenda._doComment(alvo.win, alvo.platform, alvo.commentText, alvo.profileId)],
  ['share', (fazenda, alvo) => fazenda._doShare(alvo.win, alvo.platform, alvo.profileId)],
  ['watch', async (fazenda, alvo) => {
    fazenda._log(alvo.profileId, `👁 Watching for 45s...`, 'info');
    await fazenda._sleep(45000);
    return { success: true };
  }],
]);

const EXECUTAVEIS = new Map([
  ['chrome', fazenda => fazenda.getChromeExecutablePath()],
  ['brave', fazenda => fazenda.getBraveExecutablePath()],
  ['vivaldi', fazenda => fazenda.getVivaldiExecutablePath()],
  ['firefox', fazenda => fazenda.getFirefoxExecutablePath()],
]);

const ehCelular = plt => plt === 'android' || plt === 'ios';

function tamanhoDaResolucao(screenResolution) {
  if (!screenResolution || !screenResolution.includes('x')) return null;
  const parts = screenResolution.split('x');
  return [parseInt(parts[0]) || 1280, parseInt(parts[1]) || 720];
}

function tamanhoDaTela() {
  try {
    const { screen } = require('electron');
    const primaryDisplay = screen.getPrimaryDisplay();
    if (!primaryDisplay || !primaryDisplay.bounds) return [1280, 720];
    return [primaryDisplay.bounds.width || 1920, primaryDisplay.bounds.height || 1080];
  } catch (e) {
    console.error('[Farm] Failed to get screen size for maximized window:', e);
    return [1920, 1080];
  }
}

function tamanhoMaximizado(plt) {
  if (ehCelular(plt)) return { width: 412, height: 915, maximized: false };
  const [width, height] = tamanhoDaTela();
  return { width, height, maximized: true };
}

function camposDoPerfilNovo(i) {
  return {
    ua: MOBILE_UAS[i % MOBILE_UAS.length],
    proxy: '',
    email: '',
    status: 'idle',
    battery: Math.floor(Math.random() * 50) + 40,
    anonymityScore: Math.floor(Math.random() * 30) + 65,
    lastRun: null,
    platform: 'android',
    timezone: 'optimal',
    locale: 'optimal',
    latitude: null,
    longitude: null,
    canvasNoise: true,
    webglNoise: true,
    audioNoise: true
  };
}

function geoDaResposta(body) {
  try {
    const data = JSON.parse(body);
    if (data && data.status === 'success') {
      return { timezone: data.timezone || 'UTC', lat: data.lat || 0, lng: data.lon || 0, country: data.countryCode || 'US', locale: getLocaleForCountry(data.countryCode) };
    }
  } catch (e) {}
  return null;
}

function consultarGeo(ses) {
  return new Promise((resolve) => {
    const req = net.request({
      method: 'GET',
      url: 'http://ip-api.com/json',
      session: ses
    });
    req.on('response', (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve(geoDaResposta(body)));
    });
    req.on('error', () => resolve(null));
    req.end();
    setTimeout(() => resolve(null), 3000);
  });
}

async function rodarScriptDeAcao(win, script) {
  try {
    return await win.webContents.executeJavaScript(script) || { success: true };
  } catch (e) { return { success: false, error: e.message }; }
}

function motivoParaNaoRodar(toRun, targetUrl) {
  if (toRun.length === 0) return '❌ No profiles selected! Please select at least one profile.';
  if (!targetUrl || targetUrl.trim() === '') return '❌ No target URL set! Please enter a URL in the Target URL field.';
  return null;
}

class BrowserFarmService {
  constructor(mainWindow) {
    this.mainWindow = mainWindow;
    this.profileWindows = new Map();
    this.playwrightContexts = new Map();
    this.launchingProfiles = new Set();
    this.activeRunProfiles = new Set();
    this.profiles = [];
    this.isRunning = false;
    this.shouldStop = false;
  }

  _getProfileWindowSize(profile) {
    const plt = profile.platform || 'windows';
    if (profile.windowMode === 'maximized') return tamanhoMaximizado(plt);
    const [width, height] = tamanhoDaResolucao(profile.screenResolution) || TAMANHOS_POR_PLATAFORMA.get(plt) || TAMANHO_DO_COMPUTADOR;
    return { width, height, maximized: false };
  }

  _enviarParaJanela(canal, dados) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(canal, dados);
    }
  }

  _parado(runId) {
    return this.shouldStop || this.currentRunId !== runId;
  }

  _executavelDaExecucao(browserChoice) {
    const executavel = EXECUTAVEIS.get(browserChoice);
    return executavel ? executavel(this) : null;
  }

  _executavelDoLogin(browserChoice) {
    if (browserChoice === 'aloha') return this.getAlohaExecutablePath();
    return this._executavelDaExecucao(browserChoice);
  }

  _profilesPath() {
    return path.join(app.getPath('userData'), 'farm_profiles.json');
  }



  getChromeExecutablePath() {
        if (process.platform === "darwin") {
            return require('./mac-native').browser('chrome');
        }

    const paths = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
      findBundledChromiumExecutable([process.resourcesPath && path.join(process.resourcesPath, 'browsers'), path.join(app.getAppPath(), 'browsers')]),
      path.join(process.resourcesPath || '', 'browsers', 'chrome', 'chrome.exe'),
      path.join(app.getAppPath(), 'browsers', 'chrome', 'chrome.exe')
    ];
    return primeiroCaminhoExistente(paths);
  }

  getBraveExecutablePath() {
        if (process.platform === "darwin") {
            return require('./mac-native').browser('brave');
        }

    const paths = [
      path.join(process.resourcesPath || '', 'browsers', 'brave', 'brave.exe'),
      path.join(app.getAppPath(), 'browsers', 'brave', 'brave.exe'),
      'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
      'C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
      path.join(process.env.LOCALAPPDATA || '', 'BraveSoftware\\Brave-Browser\\Application\\brave.exe')
    ];
    for (const p of paths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }
  }

  getVivaldiExecutablePath() {
        if (process.platform === "darwin") {
            return require('./mac-native').browser('vivaldi');
        }

    const paths = [
      path.join(process.resourcesPath || '', 'browsers', 'vivaldi', 'vivaldi.exe'),
      path.join(app.getAppPath(), 'browsers', 'vivaldi', 'vivaldi.exe'),
      path.join(__dirname, '../../browsers/vivaldi/vivaldi.exe'),
      path.join(__dirname, '../browsers/vivaldi/vivaldi.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Vivaldi\\Application\\vivaldi.exe'),
      'C:\\Program Files\\Vivaldi\\Application\\vivaldi.exe',
      'C:\\Program Files (x86)\\Vivaldi\\Application\\vivaldi.exe'
    ];
    for (const p of paths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }
    return null;
  }

  getFirefoxExecutablePath() {
        if (process.platform === "darwin") {
            return require('./mac-native').browser('firefox');
        }

    const paths = [
      path.join(process.resourcesPath || '', 'browsers', 'firefox', 'firefox.exe'),
      path.join(app.getAppPath(), 'browsers', 'firefox', 'firefox.exe'),
      'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
      'C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Mozilla Firefox\\firefox.exe')
    ];
    for (const p of paths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }
    return null;
  }

  loadProfiles() {
    try {
      const p = this._profilesPath();
      let modified = false;
      if (fs.existsSync(p)) {
        this.profiles = JSON.parse(fs.readFileSync(p, 'utf8'));
        for (const prof of this.profiles) {
          const before = JSON.stringify(prof);
          ensureProfileStealthSpecs(prof);
          const after = JSON.stringify(prof);
          if (before !== after) {
            modified = true;
          }
        }
      } else {
        this.profiles = this._makeDefaultProfiles(6);
        modified = true;
      }
      if (modified) {
        this._saveProfiles();
      }
    } catch (e) {
      console.error('[Farm] loadProfiles error:', e);
      this.profiles = this._makeDefaultProfiles(6);
      this._saveProfiles();
    }
    return this.profiles;
  }

  _saveProfiles() {
    try {
      fs.writeFileSync(this._profilesPath(), JSON.stringify(this.profiles, null, 2));
    } catch (e) {
      console.error('[Farm] saveProfiles error:', e);
    }
  }

  _makeDefaultProfiles(count) {
    return Array.from({ length: count }, (_, i) => {
      const p = {
        id: `profile_${String(i + 1).padStart(2, '0')}`,
        name: `Profile ${String(i + 1).padStart(2, '0')}`,
        ...camposDoPerfilNovo(i)
      };
      ensureProfileStealthSpecs(p);
      return p;
    });
  }

  addProfile(name = '', browser = 'aloha') {
    const nextNum = proximoNumeroDePerfil(this.profiles);
    const p = {
      id: `profile_${String(nextNum).padStart(2, '0')}`,
      name: name || `Profile ${String(nextNum).padStart(2, '0')}`,
      browser: browser || 'chrome',
      ...camposDoPerfilNovo(this.profiles.length)
    };
    ensureProfileStealthSpecs(p);
    this.profiles.push(p);
    this._saveProfiles();
    return p;
  }

  updateProfile(profileId, patch) {
    const idx = this.profiles.findIndex(p => p.id === profileId);
    if (idx === -1) return { success: false, error: 'Not found' };
    this.profiles[idx] = { ...this.profiles[idx], ...patch };
    this._saveProfiles();
    this._enviarParaJanela('farm:profile-update', {
      profileId,
      ...patch
    });
    return { success: true, profile: this.profiles[idx] };
  }

  deleteProfile(profileId) {
    const win = this.profileWindows.get(profileId);
    if (win && !win.isDestroyed()) win.close();
    this.profileWindows.delete(profileId);

    const context = this.playwrightContexts.get(profileId);
    if (context) {
      context.close().catch(() => {});
      this.playwrightContexts.delete(profileId);
    }

    this.profiles = this.profiles.filter(p => p.id !== profileId);
    this._saveProfiles();
    return { success: true };
  }

  async openLoginBrowser(profileId, platform) {
    const profile = this.profiles.find(p => p.id === profileId);
    if (!profile) return { success: false, error: 'Profile not found' };

    if (this.launchingProfiles.has(profileId)) {
      this._log(profileId, `Already launching browser, ignoring duplicate request.`, 'warn');
      return { success: true };
    }
    this.launchingProfiles.add(profileId);

    try {
      return await abrirLogin(this, profile, platform);
    } finally {
      this.launchingProfiles.delete(profileId);
    }
  }

  async checkProxy(profileId) {
    const profile = this.profiles.find(p => p.id === profileId);
    if (!profile) return { ok: false, error: 'Not found' };
    if (!profile.proxy || !profile.proxy.trim()) return { ok: false, error: 'No proxy configured' };
    try {
      const ses = session.fromPartition(`persist:farm_${profileId}`);
      ses.removeAllListeners('login');
      const parsed = parseProxy(profile.proxy);
      if (!parsed) return { ok: false, error: 'Invalid proxy format' };

      await configurarProxyDaSessao(ses, parsed);
      return testarConexao(ses);
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  _perfisDaExecucao(profileIds) {
    return profileIds && profileIds.length > 0
      ? this.profiles.filter(p => profileIds.includes(p.id))
      : this.profiles;
  }

  async runFarm({ profileIds, targetUrl, action, batchSize, launchDelay, actionDelay, commentText }) {
    this.stopFarm();
    await this._sleep(1000);

    this.isRunning = true;
    this.shouldStop = false;
    this.currentRunId = Math.random().toString();
    const runId = this.currentRunId;

    const toRun = this._perfisDaExecucao(profileIds);
    const motivo = motivoParaNaoRodar(toRun, targetUrl);
    if (motivo) {
      this._log('SYSTEM', motivo, 'error');
      this.isRunning = false;
      return;
    }

    const totalBatches = Math.ceil(toRun.length / batchSize);
    this._log('SYSTEM', `🚀 Farm started — ${toRun.length} profiles | ${totalBatches} batches | Action: ${action.toUpperCase()} | URL: ${targetUrl}`, 'info');
    this._enviarParaJanela('farm:started', { total: toRun.length, batches: totalBatches });

    const tarefa = { targetUrl, action, actionDelay, commentText, runId };
    try {
      await this._rodarLotes(toRun, { batchSize, launchDelay, totalBatches }, tarefa);
      this._anunciarFim(runId);
    } catch (err) {
      if (this.currentRunId === runId) {
        this._log('SYSTEM', `❌ Farm crashed: ${err.message}`, 'error');
      }
      console.error('[Farm] Unhandled error in runFarm:', err);
    } finally {
      this._encerrarExecucao(runId);
    }
  }

  async _rodarLotes(toRun, lotes, tarefa) {
    const { runId } = tarefa;
    for (let bi = 0; bi < lotes.totalBatches; bi++) {
      if (this._parado(runId)) break;
      await this._rodarLote(toRun.slice(bi * lotes.batchSize, (bi + 1) * lotes.batchSize), bi, lotes, tarefa);
      if (this._parado(runId)) break;
      this._log('SYSTEM', `═══ BATCH ${bi + 1} COMPLETE — RAM freed ═══`, 'success');
      if (bi < lotes.totalBatches - 1 && !this._parado(runId)) {
        this._log('SYSTEM', `⏱ Next batch in ${lotes.launchDelay}s...`, 'info');
        await this._sleep(lotes.launchDelay * 1000);
      }
    }
  }

  async _rodarLote(batch, bi, lotes, tarefa) {
    this._log('SYSTEM', `═══ BATCH ${bi + 1}/${lotes.totalBatches} — ${batch.length} profiles ═══`, 'info');
    this._enviarParaJanela('farm:batch-start', { batchNo: bi + 1, totalBatches: lotes.totalBatches });
    await Promise.all(batch.map((profile, idx) => this._rodarNoLote(profile, idx * lotes.launchDelay * 1000, tarefa)));
  }

  async _rodarNoLote(profile, espera, tarefa) {
    if (this._parado(tarefa.runId)) return;
    await this._sleep(espera);
    if (this._parado(tarefa.runId)) return;
    await this._runSingleProfile(profile, tarefa);
  }

  _anunciarFim(runId) {
    if (this.currentRunId !== runId) return;
    const msg = this.shouldStop ? '⏹ Farm stopped by user' : '🏁 Farm complete!';
    this._log('SYSTEM', msg, this.shouldStop ? 'warn' : 'success');
  }

  _encerrarExecucao(runId) {
    if (this.currentRunId !== runId) return;
    this.isRunning = false;
    this._enviarParaJanela('farm:completed', { stopped: this.shouldStop });
  }

  async _runSingleProfile(profile, tarefa) {
    if (this._parado(tarefa.runId)) return;
    this._log(profile.id, `🌐 Launching browser...`, 'info');
    this._updateStatus(profile.id, 'running');
    await rodarPerfil(this, profile, tarefa);
  }

  async _executePlaywrightAction(page, tarefa, profileId) {
    const mockWin = {
      webContents: {
        executeJavaScript: async (script) => {
          return await page.evaluate(script);
        }
      }
    };
    return this._executeAction(mockWin, tarefa, profileId);
  }

  async _executeAction(win, { action, commentText, targetUrl }, profileId) {
    const platform = detectPlatform(targetUrl);
    this._log(profileId, `Platform: ${platform} | Action: ${action}`, 'info');
    const executar = ACOES.get(action);
    if (!executar) return { success: false, error: 'Unknown action' };
    return executar(this, { win, platform, commentText, profileId });
  }

  async _doLike(win, platform, profileId) {
    this._log(profileId, `👍 Looking for Like button...`, 'info');
    return rodarScriptDeAcao(win, SCRIPT_DE_CURTIR);
  }

  async _doSubscribe(win, platform, profileId) {
    this._log(profileId, `🔔 Looking for Subscribe button...`, 'info');
    return rodarScriptDeAcao(win, SCRIPT_DE_INSCREVER);
  }

  async _doComment(win, platform, commentText, profileId) {
    const text = commentText || 'Great content! 🔥';
    this._log(profileId, `💬 Typing comment: "${text.substring(0, 30)}..."`, 'info');
    return rodarScriptDeAcao(win, scriptDeComentar(text));
  }

  async _doShare(win, platform, profileId) {
    this._log(profileId, `📤 Looking for Share button...`, 'info');
    return rodarScriptDeAcao(win, SCRIPT_DE_COMPARTILHAR);
  }

  stopFarm() {
    this.shouldStop = true;
    this.isRunning = false;
    for (const [id, win] of this.profileWindows.entries()) {
      if (!win.isDestroyed()) win.close();
    }
    this.profileWindows.clear();

    for (const [id, context] of this.playwrightContexts.entries()) {
      context.close().catch(() => {});
    }
    this.playwrightContexts.clear();
  }

  async _getEncryptionKey() {
    let machineId = 'nova-farm-default-id';
    try {
      const uuidData = await si.uuid();
      machineId = uuidData.os || uuidData.hardware || machineId;
    } catch (e) {
      machineId = os.hostname() + '-' + os.platform();
    }
    return crypto.createHash('sha256').update(machineId + 'nova_farm_secure_salt_786').digest();
  }

  async _encrypt(plainText) {
    try {
      const key = await this._getEncryptionKey();
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
      let encrypted = cipher.update(plainText, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      return iv.toString('hex') + ':' + encrypted;
    } catch (e) {
      console.error('[Farm Backup Encryption Error]:', e);
      return null;
    }
  }

  async _decrypt(cipherText) {
    try {
      const key = await this._getEncryptionKey();
      const parts = cipherText.split(':');
      if (parts.length !== 2) return null;
      const iv = Buffer.from(parts[0], 'hex');
      const encryptedText = parts[1];
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
      let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (e) {
      console.error('[Farm Backup Decryption Error]:', e);
      return null;
    }
  }

  async getOptimalGeoDetails(profile) {
    const ses = session.fromPartition(`persist:farm_geo_${profile.id}`);
    const parsed = parseProxy(profile.proxy);
    if (parsed) {
      try {
        await configurarProxyDaSessao(ses, parsed);
      } catch (e) {}
    }
    return consultarGeo(ses);
  }

  getStealthSpoofScript(profile) {
    return scriptFurtivoDoPerfil(profile);
  }

  async backupProfiles() {
    try {
      const vaultDir = path.join(app.getPath('documents'), 'Nova_Vault');
      if (!fs.existsSync(vaultDir)) fs.mkdirSync(vaultDir, { recursive: true });
      const backupPath = path.join(vaultDir, `farm_backup_${Date.now()}.nvm`);
      
      const plainText = JSON.stringify(this.profiles, null, 2);
      const encrypted = await this._encrypt(plainText);
      if (!encrypted) throw new Error('Encryption failed');
      
      fs.writeFileSync(backupPath, encrypted, 'utf8');
      return { success: true, path: backupPath };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async restoreProfiles(data) {
    try {
      let encryptedContent = '';
      if (typeof data === 'string' && fs.existsSync(data)) {
        encryptedContent = fs.readFileSync(data, 'utf8');
      } else {
        encryptedContent = String(data);
      }
      
      const decrypted = await this._decrypt(encryptedContent);
      if (!decrypted) throw new Error('Decryption failed. File might be tampered or from another machine.');
      
      const parsed = JSON.parse(decrypted);
      const arr = Array.isArray(parsed) ? parsed : parsed.profiles || [];
      this.profiles = arr;
      this._saveProfiles();
      return { success: true, count: arr.length };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  _updateStatus(profileId, status) {
    const terminou = ESTADOS_FINAIS.includes(status);
    const perfil = this.profiles.find(p => p.id === profileId);
    const email = perfil ? this._marcarStatus(perfil, status, terminou) : undefined;
    this._enviarParaJanela('farm:profile-update', {
      profileId,
      status,
      lastRun: terminou ? new Date().toLocaleString() : undefined,
      email: email,
    });
  }

  _marcarStatus(perfil, status, terminou) {
    perfil.status = status;
    if (terminou) perfil.lastRun = new Date().toLocaleString();
    const { email } = perfil;
    this._saveProfiles();
    return email;
  }

  _log(profileId, msg, type = 'info') {
    const entry = {
      ts: new Date().toLocaleTimeString(),
      profileId,
      msg,
      type,
    };
    console.log(`[Farm][${profileId}] ${msg}`);
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('farm:log', entry);
    }
  }

  _sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  registerIPC() {
    ipcMain.handle('farm:load-profiles', () => this.loadProfiles());

    ipcMain.handle('farm:add-profile', (e, { name, browser } = {}) => this.addProfile(name, browser));

    ipcMain.handle('farm:update-profile', (e, { profileId, patch }) =>
      this.updateProfile(profileId, patch)
    );

    ipcMain.handle('farm:delete-profile', (e, profileId) =>
      this.deleteProfile(profileId)
    );

    ipcMain.handle('farm:open-login-browser', async (e, { profileId, platform }) =>
      this.openLoginBrowser(profileId, platform)
    );

    ipcMain.handle('farm:check-proxy', async (e, profileId) =>
      this.checkProxy(profileId)
    );

    ipcMain.handle('farm:run', async (e, config) => {
      try {
        // Run non-blocking — don't await the full run
        this.runFarm(config).catch(err => {
          console.error('[Farm IPC] runFarm error:', err);
        });
        return { success: true };
      } catch (err) {
        return { success: false, error: err.message };
      }
    });

    ipcMain.handle('farm:stop', () => {
      this.stopFarm();
      return { success: true };
    });

    ipcMain.handle('farm:backup', () => this.backupProfiles());

    ipcMain.handle('farm:restore', (e, data) => this.restoreProfiles(data));

    console.log('[BrowserFarmService] IPC handlers registered.');
  }
}

module.exports = BrowserFarmService;
