'use strict';

const { BrowserWindow, session, app, ipcMain, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { chromium, firefox } = require('playwright');
const crypto = require('crypto');
const os = require('os');
const { findBundledChromiumExecutable, primeiroCaminhoExistente } = require('./platform-utils');
const si = require('systeminformation');

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

const STEALTH_SCRIPT = `
(function() {
  try {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3,4,5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    window.chrome = { runtime: {} };
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) =>
      parameters.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : originalQuery(parameters);
  } catch(e) {}
})();
`;

const DETECT_EMAIL_SCRIPT = `
(function() {
  try {
    const isEmail = (str) => {
      if (!str) return false;
      return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$/.test(str.trim());
    };

    // 1. Google accounts signout button aria-label
    let signOutBtn = document.querySelector('a[href*="SignOutOptions"]');
    if (signOutBtn) {
      let label = signOutBtn.getAttribute('aria-label') || '';
      let match = label.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}/);
      if (match && isEmail(match[0])) return match[0];
    }

    // 2. Elements with data-email attribute
    let dataEmailEl = document.querySelector('[data-email]');
    if (dataEmailEl) {
      let email = dataEmailEl.getAttribute('data-email');
      if (isEmail(email)) return email;
    }

    // 3. Input value that looks like an email
    let emailInput = document.querySelector('input[type="email"], input[name="identifier"], input[id*="email" i], input[name*="email" i]');
    if (emailInput && emailInput.value && isEmail(emailInput.value)) {
      return emailInput.value;
    }

    // 4. Header elements
    let profileHeader = document.querySelector('div[aria-label*="@"], div[title*="@"]');
    if (profileHeader) {
      let val = profileHeader.getAttribute('aria-label') || profileHeader.getAttribute('title') || '';
      let match = val.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}/);
      if (match && isEmail(match[0])) return match[0];
    }

    // 5. Common profile / account containers
    let elements = document.querySelectorAll('[class*="profile" i], [class*="user" i], [class*="account" i], [id*="profile" i], [id*="user" i], [id*="account" i], header, nav');
    for (let el of elements) {
      let text = el.innerText || '';
      let match = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}/);
      if (match && isEmail(match[0])) {
        const email = match[0].toLowerCase();
        if (!email.includes('support') && !email.includes('info') && !email.includes('help') && !email.includes('service') && !email.includes('noreply')) {
          return match[0];
        }
      }
    }

    // 6. Generic body search
    let bodyText = document.body ? document.body.innerText : '';
    let match = bodyText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}/);
    if (match && isEmail(match[0])) {
      const email = match[0].toLowerCase();
      if (!email.includes('support') && !email.includes('info') && !email.includes('help') && !email.includes('service') && !email.includes('noreply')) {
        return match[0];
      }
    }
  } catch(e) {}
  return null;
})();
`;

const BYPASS_POPUPS_SCRIPT = `
(function() {
  try {
    const notNowPatterns = [/not now/i, /not_now/i, /dismiss/i, /close/i, /cancel/i, /no thanks/i, /later/i, /not now, thanks/i];
    
    const matchesPattern = (text) => {
      if (!text) return false;
      const clean = text.trim().toLowerCase();
      if (clean.length > 40) return false;
      return notNowPatterns.some(pat => pat.test(clean));
    };

    const checkAndClick = (el) => {
      if (!el) return false;
      const text = el.textContent || el.innerText || '';
      if (matchesPattern(text)) {
        const clickTarget = el.closest('button') || el.closest('a') || el;
        clickTarget.click();
        const rect = clickTarget.getBoundingClientRect();
        const opts = { bubbles: true, view: window, clientX: rect.left + rect.width/2, clientY: rect.top + rect.height/2 };
        clickTarget.dispatchEvent(new MouseEvent('mousedown', opts));
        clickTarget.dispatchEvent(new MouseEvent('mouseup', opts));
        clickTarget.dispatchEvent(new MouseEvent('click', opts));
        return true;
      }
      return false;
    };

    const elements = document.querySelectorAll('button, a, div, span, p, [role="button"]');
    for (let el of elements) {
      if (checkAndClick(el)) return true;
    }

    const scanShadowDOM = (root) => {
      if (!root) return false;
      const shadowEls = root.querySelectorAll('*');
      for (let el of shadowEls) {
        if (el.shadowRoot) {
          if (scanShadowDOM(el.shadowRoot)) return true;
        }
        if (checkAndClick(el)) return true;
      }
      return false;
    };
    if (scanShadowDOM(document)) return true;

    let closeBtn = document.querySelector('[aria-label*="close" i], [class*="close" i] button, [class*="modal" i] svg, .tiktok-modal-close, [class*="ButtonClose"]');
    if (closeBtn) {
      closeBtn.click();
      return true;
    }
  } catch(e) {}
  return false;
})();
`;

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

function getLoginUrl(platform) {
  const map = {
    youtube: 'https://accounts.google.com/signin',
    tiktok: 'https://www.tiktok.com/login',
    instagram: 'https://www.instagram.com/accounts/login/',
    twitter: 'https://x.com/i/flow/login',
  };
  return map[platform] || 'https://accounts.google.com/signin';
}

function parseProxy(proxyStr) {
  if (!proxyStr) return null;
  const str = proxyStr.trim();
  if (!str) return null;

  // Format 1: user:pass@host:port
  // Format 2: host:port:user:pass
  // Format 3: host:port

  let host = '';
  let port = '';
  let username = '';
  let password = '';
  let protocol = 'http';

  let cleanStr = str;
  const protoMatch = str.match(/^([a-zA-Z0-9]+):\/\/(.*)$/);
  if (protoMatch) {
    protocol = protoMatch[1].toLowerCase();
    cleanStr = protoMatch[2];
  }

  if (cleanStr.includes('@')) {
    const parts = cleanStr.split('@');
    const authParts = parts[0].split(':');
    const hostParts = parts[1].split(':');

    username = authParts[0];
    password = authParts[1] || '';
    host = hostParts[0];
    port = hostParts[1] || '';
  } else {
    const parts = cleanStr.split(':');
    if (parts.length === 4) {
      host = parts[0];
      port = parts[1];
      username = parts[2];
      password = parts[3];
    } else if (parts.length === 2) {
      host = parts[0];
      port = parts[1];
    } else {
      host = cleanStr;
    }
  }

  return {
    protocol,
    host,
    port,
    username,
    password,
    proxyRules: `${protocol}://${host}${port ? ':' + port : ''}`
  };
}

function ensureProfileStealthSpecs(p) {
  if (!p) return;
  const platform = p.platform || 'android';

  if (!p.cpuCores || p.cpuCores === 'Auto') {
    const coresOptions = ['4', '6', '8', '12', '16'];
    p.cpuCores = coresOptions[Math.floor(Math.random() * coresOptions.length)];
  }

  if (!p.ramSize || p.ramSize === 'Auto') {
    const ramOptions = ['4', '8', '12', '16', '32'];
    p.ramSize = ramOptions[Math.floor(Math.random() * ramOptions.length)];
  }

  if (!p.platformStr || !p.webglVendor || !p.webglRenderer) {
    if (platform === 'mac') {
      p.platformStr = 'MacIntel';
      p.webglVendor = 'Apple Inc.';
      p.webglRenderer = 'Apple M1';
    } else if (platform === 'linux') {
      p.platformStr = 'Linux x86_64';
      p.webglVendor = 'Intel Open Source Technology Center';
      p.webglRenderer = 'Mesa DRI Intel(R) HD Graphics 520 (Skylake GT2)';
    } else if (platform === 'android') {
      p.platformStr = 'Linux aarch64';
      const androidGpus = [
        { vendor: 'Google Inc. (Qualcomm)', renderer: 'Adreno (TM) 750' },
        { vendor: 'Google Inc. (Qualcomm)', renderer: 'Adreno (TM) 740' },
        { vendor: 'Google Inc. (ARM)', renderer: 'Mali-G715 MC10' },
        { vendor: 'Google Inc. (ARM)', renderer: 'Mali-G720 MC12' },
        { vendor: 'Google Inc. (ARM)', renderer: 'Mali-G68 MC4' }
      ];
      const gpu = androidGpus[Math.floor(Math.random() * androidGpus.length)];
      p.webglVendor = gpu.vendor;
      p.webglRenderer = gpu.renderer;
    } else if (platform === 'ios') {
      p.platformStr = 'iPhone';
      p.webglVendor = 'Apple Inc.';
      p.webglRenderer = 'Apple GPU';
    } else {
      p.platformStr = 'Win32';
      const winGpus = [
        'NVIDIA GeForce RTX 3060',
        'NVIDIA GeForce RTX 4070',
        'NVIDIA GeForce RTX 3080',
        'Intel(R) Iris(R) Xe Graphics',
        'AMD Radeon(TM) RX 6700 XT',
        'NVIDIA GeForce GTX 1660 Super'
      ];
      p.webglVendor = 'Google Inc. (NVIDIA)';
      p.webglRenderer = winGpus[Math.floor(Math.random() * winGpus.length)];
    }
  }

  if (!p.deviceName || p.deviceName === 'USER-PC-X6NAGE1') {
    const rand = Math.random().toString(36).substring(2, 9).toUpperCase();
    p.deviceName = `LAPTOP-${rand}`;
  }

  if (!p.macAddress || p.macAddress === '00-1B-21-29-FE-FA') {
    const hex = () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0').toUpperCase();
    p.macAddress = `00-1B-21-${hex()}-${hex()}-${hex()}`;
  }

  if (!p.screenResolution || p.screenResolution === 'Based on User-Agent') {
    if (platform === 'android' || platform === 'ios') {
      p.screenResolution = '412x915';
      p.windowMode = 'custom';
    } else if (platform === 'mac') {
      p.screenResolution = '1440x900';
      p.windowMode = 'custom';
    } else {
      p.screenResolution = '1920x1080';
      p.windowMode = 'maximized';
    }
  }

  if (p.canvasNoiseSeed === undefined || p.canvasNoiseSeed === null) {
    p.canvasNoiseSeed = Math.floor(Math.random() * 200) + 1;
  }
  if (p.webglNoiseSeed === undefined || p.webglNoiseSeed === null) {
    p.webglNoiseSeed = Math.floor(Math.random() * 200) + 1;
  }
  if (p.audioNoiseSeed === undefined || p.audioNoiseSeed === null) {
    p.audioNoiseSeed = parseFloat((Math.random() * 0.0001).toFixed(8));
  }

  if (!p.virtualCamId) {
    p.virtualCamId = crypto.randomBytes(32).toString('hex');
  }
  if (!p.virtualCamLabel) {
    const camBrands = ['HD Camera', 'Integrated Webcam', 'USB Camera', 'FaceTime HD Camera', 'FHD Web Camera'];
    p.virtualCamLabel = camBrands[Math.floor(Math.random() * camBrands.length)];
  }

  if (!p.virtualMicId) {
    p.virtualMicId = crypto.randomBytes(32).toString('hex');
  }
  if (!p.virtualMicLabel) {
    const micBrands = ['Microphone (Realtek High Definition Audio)', 'Internal Microphone', 'Microphone (USB Audio Device)', 'Built-in Microphone'];
    p.virtualMicLabel = micBrands[Math.floor(Math.random() * micBrands.length)];
  }

  if (!p.virtualSpeakerId) {
    p.virtualSpeakerId = crypto.randomBytes(32).toString('hex');
  }
  if (!p.virtualSpeakerLabel) {
    const spkBrands = ['Speakers (Realtek High Definition Audio)', 'Internal Speakers', 'Headphones (Realtek High Definition Audio)', 'Built-in Output'];
    p.virtualSpeakerLabel = spkBrands[Math.floor(Math.random() * spkBrands.length)];
  }
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
    let w = 1280;
    let h = 720;
    let maximized = profile.windowMode === 'maximized';

    if (maximized) {
      if (plt === 'android' || plt === 'ios') {
        w = 412;
        h = 915;
        maximized = false;
      } else {
        try {
          const { screen } = require('electron');
          const primaryDisplay = screen.getPrimaryDisplay();
          if (primaryDisplay && primaryDisplay.bounds) {
            w = primaryDisplay.bounds.width || 1920;
            h = primaryDisplay.bounds.height || 1080;
          }
        } catch (e) {
          console.error('[Farm] Failed to get screen size for maximized window:', e);
          w = 1920;
          h = 1080;
        }
      }
    } else {
      if (profile.screenResolution && profile.screenResolution.includes('x')) {
        const parts = profile.screenResolution.split('x');
        w = parseInt(parts[0]) || 1280;
        h = parseInt(parts[1]) || 720;
      } else {
        if (plt === 'android' || plt === 'ios') {
          w = 412;
          h = 915;
        } else if (plt === 'mac') {
          w = 1440;
          h = 900;
        } else if (plt === 'linux') {
          w = 1366;
          h = 768;
        } else {
          w = 1920;
          h = 1080;
        }
      }
    }
    return { width: w, height: h, maximized };
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
      ensureProfileStealthSpecs(p);
      return p;
    });
  }

  addProfile(name = '', browser = 'aloha') {
    let nextNum = 1;
    if (this.profiles && this.profiles.length > 0) {
      const nums = this.profiles
        .map(p => {
          if (!p || !p.id) return 0;
          const match = p.id.match(/^profile_(\d+)$/);
          return match ? parseInt(match[1], 10) : 0;
        })
        .filter(n => !isNaN(n));
      if (nums.length > 0) {
        nextNum = Math.max(...nums) + 1;
      }
    }
    const i = this.profiles.length;
    const p = {
      id: `profile_${String(nextNum).padStart(2, '0')}`,
      name: name || `Profile ${String(nextNum).padStart(2, '0')}`,
      browser: browser || 'chrome',
      ua: MOBILE_UAS[i % MOBILE_UAS.length],
      proxy: '', email: '', status: 'idle',
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
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('farm:profile-update', {
        profileId,
        ...patch
      });
    }
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
      const existingPlaywright = this.playwrightContexts.get(profileId);
      if (existingPlaywright) {
        try {
          const pages = existingPlaywright.pages();
          if (pages.length > 0) {
            await pages[0].bringToFront();
            return { success: true };
          }
        } catch (e) {
          this.playwrightContexts.delete(profileId);
        }
      }

      const existing = this.profileWindows.get(profileId);
      if (existing && !existing.isDestroyed()) {
        existing.focus();
        return { success: true };
      }

      let exePath = null;
      let playLauncher = chromium;
      const browserChoice = profile.browser || 'aloha';

      if (browserChoice === 'aloha') {
        exePath = this.getAlohaExecutablePath();
      } else if (browserChoice === 'chrome') {
        exePath = this.getChromeExecutablePath();
      } else if (browserChoice === 'brave') {
        exePath = this.getBraveExecutablePath();
      } else if (browserChoice === 'vivaldi') {
        exePath = this.getVivaldiExecutablePath();
      } else if (browserChoice === 'firefox') {
        exePath = this.getFirefoxExecutablePath();
        playLauncher = firefox;
      }

      if (exePath) {
        if (this.activeRunProfiles.size > 0 && !this.activeRunProfiles.has(profileId)) {
          return {
            success: false,
            error: 'Another profile login browser is already open. Please close it first.'
          };
        }
        this.activeRunProfiles.add(profileId);

        this._log(profileId, `Launching ${browserChoice.toUpperCase()} Browser for login...`, 'info');
        const userDataDir = path.join(app.getPath('userData'), 'farm_profiles', profileId);
        let lastError = null;

        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            // Clean up Singleton lock files to prevent "already running" errors
            if (fs.existsSync(userDataDir)) {
              try {
                const files = fs.readdirSync(userDataDir);
                for (const file of files) {
                  if (file.startsWith('Singleton')) {
                    fs.unlinkSync(path.join(userDataDir, file));
                  }
                }
              } catch (e) {}
            }
            if (attempt === 2) {
              this._log(profileId, `Attempt 2: Clearing corrupted profile directory...`, 'warn');
              try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (e) {}
              await this._sleep(3000); // Wait 3s for browser to fully release before retry
            }
            if (attempt === 3) {
              this._log(profileId, `Attempt 3: Final retry with fresh profile...`, 'warn');
              try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (e) {}
              await this._sleep(3500);
            }

            let timezoneVal = profile.timezone === 'optimal' ? 'UTC' : (profile.timezone || 'UTC');
            let localeVal   = profile.locale   === 'optimal' ? 'en-US' : (profile.locale   || 'en-US');
            let latVal = (profile.latitude  !== undefined && profile.latitude  !== null) ? profile.latitude  : 0;
            let lngVal = (profile.longitude !== undefined && profile.longitude !== null) ? profile.longitude : 0;
            if (profile.timezone === 'optimal' || profile.locale === 'optimal') {
              this._log(profileId, `Fetching optimal timezone/locale via proxy...`, 'info');
              const geo = await this.getOptimalGeoDetails(profile);
              if (geo) {
                if (profile.timezone === 'optimal') timezoneVal = geo.timezone;
                if (profile.locale   === 'optimal') localeVal   = geo.locale;
                latVal = geo.lat; lngVal = geo.lng;
                this._log(profileId, `Geo-Sync: TZ=${timezoneVal} Locale=${localeVal} Country=${geo.country}`, 'success');
              }
            }

            const sizeCfg = this._getProfileWindowSize(profile);
            const plt = profile.platform || 'windows';
            const isMobilePlt = (plt === 'android' || plt === 'ios');
            let windowArgs = [];

            if (sizeCfg.maximized) {
              windowArgs.push('--start-maximized');
            } else {
              windowArgs.push(`--window-size=${sizeCfg.width},${sizeCfg.height}`);
            }

            this._log(profileId, `[Launch] Platform=${plt} Mode=${profile.windowMode || 'default'} Size=${sizeCfg.maximized ? 'Maximized' : `${sizeCfg.width}x${sizeCfg.height}`}`, 'info');

            const parsed = parseProxy(profile.proxy);
            const proxyOpts = parsed ? {
              server: parsed.proxyRules,
              ...(parsed.username ? { username: parsed.username, password: parsed.password } : {})
            } : undefined;

            const extraArgs = [
              '--no-first-run',
              '--no-default-browser-check',
              '--force-webrtc-ip-handling-policy=default_public_interface_only',
              '--lang=en-US',
              ...windowArgs
            ];

            if (profile.hardwareAcceleration === 'disable') {
              extraArgs.push('--disable-gpu');
              extraArgs.push('--disable-software-rasterizer');
            }

            if (profile.disableTlsFeatures === 'open') {
              extraArgs.push('--ssl-version-min=tls1.2');
            }

            // For desktop maximized: use viewport=null so Playwright doesn't lock the viewport
            // and the OS maximized state fills the entire window naturally.
            // For desktop custom / mobile: set explicit viewport dimensions.
            const viewportArg = (sizeCfg.maximized && !isMobilePlt)
              ? null
              : { width: sizeCfg.width, height: sizeCfg.height };

            this._log(profileId, `Starting ${browserChoice.toUpperCase()} via Playwright launchPersistentContext...`, 'info');
            const context = await playLauncher.launchPersistentContext(userDataDir, {
              executablePath: exePath,
              headless: false,
              slowMo: 400, // 400ms between CDP calls — gives browser window time to initialize
              viewport: viewportArg,
              userAgent: profile.ua,
              proxy: proxyOpts,
              timezoneId: timezoneVal,
              locale: localeVal,
              geolocation: { latitude: latVal, longitude: lngVal, accuracy: 1 },
              permissions: ['geolocation'],
              args: extraArgs,
              ignoreDefaultArgs: ['--enable-automation'],
            });

            const spoofScript = this.getStealthSpoofScript(profile);
            await context.addInitScript(spoofScript).catch(() => {});
            await context.addInitScript(STEALTH_SCRIPT).catch(() => {});

            this.playwrightContexts.set(profileId, context);

            let pages = context.pages();
            let page  = pages[0] || await context.newPage();

            const loginUrl = profile.email
              ? `https://accounts.google.com/signin`
              : getLoginUrl(platform || 'youtube');

            this._log(profileId, `Navigating to ${loginUrl}`, 'info');
            await page.goto(loginUrl, { timeout: 15000, waitUntil: 'domcontentloaded' }).catch(() => {});

            const checkEmailInterval = setInterval(async () => {
              try {
                if (context.pages().length === 0) { clearInterval(checkEmailInterval); return; }
                const activePage = context.pages()[0];
                if (!activePage) return;
                const detectedEmail = await activePage.evaluate(DETECT_EMAIL_SCRIPT);
                if (detectedEmail && typeof detectedEmail === 'string' && detectedEmail.trim()) {
                  const trimmed = detectedEmail.trim();
                  if (profile.email !== trimmed) {
                     profile.email = trimmed;
                     this.updateProfile(profileId, { email: trimmed });
                     this._log(profileId, `Auto-detected login email: ${trimmed}`, 'success');
                     this._updateStatus(profileId, this.isRunning ? 'running' : 'idle');
                  }
                }
              } catch (e) { clearInterval(checkEmailInterval); }
            }, 2000);

            context.on('close', () => {
              clearInterval(checkEmailInterval);
              this.playwrightContexts.delete(profileId);
              this.activeRunProfiles.delete(profileId);
              this._updateStatus(profileId, 'idle');
              this._log(profileId, 'Login browser closed — session saved ✓', 'success');
            });

            return { success: true };
          } catch (err) {
            lastError = err;
            this._log(profileId, `Attempt ${attempt}/3 failed: ${err.message}`, 'warn');
          }
        }
        this.activeRunProfiles.delete(profileId);
        return { success: false, error: `Failed to launch ${browserChoice.toUpperCase()} Browser: ${lastError?.message}` };
      }

      const ses = session.fromPartition(`persist:farm_${profileId}`, { cache: true });
      ses.setUserAgent(profile.ua);

      ses.removeAllListeners('login');
      const parsed = parseProxy(profile.proxy);
      if (parsed) {
        try {
          await ses.setProxy({ proxyRules: parsed.proxyRules });
          if (parsed.username) {
            ses.on('login', (event, details, authInfo, callback) => {
              if (authInfo.isProxy) {
                event.preventDefault();
                callback(parsed.username, parsed.password);
              }
            });
          }
        } catch (e) {
          this._log(profileId, `Proxy config error: ${e.message}`, 'error');
        }
      }

      const loginUrl = profile.email
        ? `https://accounts.google.com/signin`
        : getLoginUrl(platform || 'youtube');

      const sizeCfg = this._getProfileWindowSize(profile);
      const win = new BrowserWindow({
        width: sizeCfg.width,
        height: sizeCfg.height,
        title: `Nova Farm Login — ${profile.name}`,
        webPreferences: {
          session: ses,
          nodeIntegration: false,
          contextIsolation: true,
          webSecurity: false,
        },
        autoHideMenuBar: true,
      });

      if (sizeCfg.maximized) {
        win.maximize();
      }

      win.webContents.setUserAgent(profile.ua);

      win.webContents.on('did-navigate', () => {
        win.webContents.executeJavaScript(STEALTH_SCRIPT).catch(() => {});
      });
      win.webContents.on('did-finish-load', () => {
        win.webContents.executeJavaScript(STEALTH_SCRIPT).catch(() => {});
      });

      win.loadURL(loginUrl);
      this.profileWindows.set(profileId, win);

      this._log(profileId, `Browser opened for login at ${loginUrl}`, 'info');

      const checkEmailInterval = setInterval(async () => {
        if (win.isDestroyed()) {
          clearInterval(checkEmailInterval);
          return;
        }
        try {
          const detectedEmail = await win.webContents.executeJavaScript(DETECT_EMAIL_SCRIPT);
          if (detectedEmail && typeof detectedEmail === 'string' && detectedEmail.trim()) {
            const trimmed = detectedEmail.trim();
            if (profile.email !== trimmed) {
              profile.email = trimmed;
              this.updateProfile(profileId, { email: trimmed });
              this._log(profileId, `Detected email/login: ${trimmed}`, 'success');
              this._updateStatus(profileId, this.isRunning ? 'running' : 'idle');
            }
          }
        } catch (e) {}
      }, 2000);

      win.on('closed', () => {
        clearInterval(checkEmailInterval);
        this.profileWindows.delete(profileId);
        this._updateStatus(profileId, 'idle');
        this._log(profileId, 'Login browser closed — session saved', 'success');
      });

      return { success: true };
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

      await ses.setProxy({ proxyRules: parsed.proxyRules });
      if (parsed.username) {
        ses.on('login', (event, details, authInfo, callback) => {
          if (authInfo.isProxy) {
            event.preventDefault();
            callback(parsed.username, parsed.password);
          }
        });
      }

      const { net } = require('electron');
      return new Promise((resolve) => {
        const req = net.request({
          method: 'GET',
          url: 'https://clients3.google.com/generate_204',
          session: ses,
          redirect: 'follow'
        });

        let finished = false;
        const finish = (result) => {
          if (finished) return;
          finished = true;
          resolve(result);
        };

        req.on('response', (res) => {
          if (res.statusCode >= 200 && res.statusCode < 400) {
            finish({ ok: true });
          } else {
            finish({ ok: false, error: `Bad status code: ${res.statusCode}` });
          }
        });

        req.on('error', (err) => {
          finish({ ok: false, error: err.message || 'Connection failed' });
        });

        req.setTimeout(5000, () => {
          req.abort();
          finish({ ok: false, error: 'Connection timeout' });
        });

        req.end();
      });
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  async runFarm({ profileIds, targetUrl, action, batchSize, launchDelay, actionDelay, commentText }) {
    // Always stop and clean up any existing runs or open login browsers first to guarantee a clean state
    this.stopFarm();
    await this._sleep(1000);

    this.isRunning = true;
    this.shouldStop = false;
    this.currentRunId = Math.random().toString();
    const runId = this.currentRunId;

    const toRun = profileIds && profileIds.length > 0
      ? this.profiles.filter(p => profileIds.includes(p.id))
      : this.profiles;

    if (toRun.length === 0) {
      this._log('SYSTEM', '❌ No profiles selected! Please select at least one profile.', 'error');
      this.isRunning = false;
      return;
    }

    if (!targetUrl || targetUrl.trim() === '') {
      this._log('SYSTEM', '❌ No target URL set! Please enter a URL in the Target URL field.', 'error');
      this.isRunning = false;
      return;
    }

    const totalBatches = Math.ceil(toRun.length / batchSize);
    this._log('SYSTEM', `🚀 Farm started — ${toRun.length} profiles | ${totalBatches} batches | Action: ${action.toUpperCase()} | URL: ${targetUrl}`, 'info');

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('farm:started', { total: toRun.length, batches: totalBatches });
    }

    try {
      for (let bi = 0; bi < totalBatches; bi++) {
        if (this.shouldStop || this.currentRunId !== runId) break;
        const batch = toRun.slice(bi * batchSize, (bi + 1) * batchSize);
        this._log('SYSTEM', `═══ BATCH ${bi + 1}/${totalBatches} — ${batch.length} profiles ═══`, 'info');

        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('farm:batch-start', { batchNo: bi + 1, totalBatches });
        }

        const promises = batch.map(async (profile, idx) => {
          if (this.shouldStop || this.currentRunId !== runId) return;
          await this._sleep(idx * launchDelay * 1000);
          if (this.shouldStop || this.currentRunId !== runId) return;
          await this._runSingleProfile(profile, targetUrl, action, actionDelay, commentText, runId);
        });

        await Promise.all(promises);

        if (this.shouldStop || this.currentRunId !== runId) break;
        this._log('SYSTEM', `═══ BATCH ${bi + 1} COMPLETE — RAM freed ═══`, 'success');

        if (bi < totalBatches - 1 && !this.shouldStop && this.currentRunId === runId) {
          this._log('SYSTEM', `⏱ Next batch in ${launchDelay}s...`, 'info');
          await this._sleep(launchDelay * 1000);
        }
      }

      if (this.currentRunId === runId) {
        const msg = this.shouldStop ? '⏹ Farm stopped by user' : '🏁 Farm complete!';
        this._log('SYSTEM', msg, this.shouldStop ? 'warn' : 'success');
      }
    } catch (err) {
      if (this.currentRunId === runId) {
        this._log('SYSTEM', `❌ Farm crashed: ${err.message}`, 'error');
      }
      console.error('[Farm] Unhandled error in runFarm:', err);
    } finally {
      if (this.currentRunId === runId) {
        this.isRunning = false;
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('farm:completed', { stopped: this.shouldStop });
        }
      }
    }
  }

  async _runSingleProfile(profile, targetUrl, action, actionDelay, commentText, runId) {
    if (this.shouldStop || this.currentRunId !== runId) return;
    this._log(profile.id, `🌐 Launching browser...`, 'info');
    this._updateStatus(profile.id, 'running');

    let exePath = null;
    let playLauncher = chromium;
    const browserChoice = profile.browser || 'chrome';

    if (browserChoice === 'chrome') {
      exePath = this.getChromeExecutablePath();
    } else if (browserChoice === 'brave') {
      exePath = this.getBraveExecutablePath();
    } else if (browserChoice === 'vivaldi') {
      exePath = this.getVivaldiExecutablePath();
    } else if (browserChoice === 'firefox') {
      exePath = this.getFirefoxExecutablePath();
      playLauncher = firefox;
    }

    if (exePath) {
      this.activeRunProfiles.add(profile.id);

      const userDataDir = path.join(app.getPath('userData'), 'farm_profiles', profile.id);
      let lastError = null;
      let context = null;

      try {
        for (let attempt = 1; attempt <= 3; attempt++) {
          if (this.shouldStop || this.currentRunId !== runId) return;
          try {
            // Remove Singleton lock files to avoid "browser already running" crash
            if (fs.existsSync(userDataDir)) {
              try {
                const files = fs.readdirSync(userDataDir);
                for (const file of files) {
                  if (file.startsWith('Singleton')) {
                    fs.unlinkSync(path.join(userDataDir, file));
                  }
                }
              } catch (e) {}
            }
            if (attempt === 2) {
              this._log(profile.id, `Attempt 2: Clearing corrupted profile dir...`, 'warn');
              try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (e) {}
              await this._sleep(3000); // 3s for browser to fully release
            }
            if (attempt === 3) {
              this._log(profile.id, `Attempt 3: Final retry with fresh profile...`, 'warn');
              try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (e) {}
              await this._sleep(3500);
            }

            if (this.shouldStop || this.currentRunId !== runId) return;

            let timezoneVal = profile.timezone === 'optimal' ? 'UTC' : (profile.timezone || 'UTC');
            let localeVal   = profile.locale   === 'optimal' ? 'en-US' : (profile.locale   || 'en-US');
            let latVal = (profile.latitude  !== undefined && profile.latitude  !== null) ? profile.latitude  : 0;
            let lngVal = (profile.longitude !== undefined && profile.longitude !== null) ? profile.longitude : 0;
            if (profile.timezone === 'optimal' || profile.locale === 'optimal') {
              this._log(profile.id, `Fetching optimal geo-sync...`, 'info');
              const geo = await this.getOptimalGeoDetails(profile);
              if (geo) {
                if (profile.timezone === 'optimal') timezoneVal = geo.timezone;
                if (profile.locale   === 'optimal') localeVal   = geo.locale;
                latVal = geo.lat; lngVal = geo.lng;
                this._log(profile.id, `Geo-Sync: TZ=${timezoneVal} Locale=${localeVal} Country=${geo.country}`, 'success');
              }
            }

            if (this.shouldStop || this.currentRunId !== runId) return;

            const sizeCfg = this._getProfileWindowSize(profile);
            const plt2 = profile.platform || 'windows';
            const isMobilePlt2 = (plt2 === 'android' || plt2 === 'ios');
            let windowArgs = [];

            if (sizeCfg.maximized) {
              windowArgs.push('--start-maximized');
            } else {
              windowArgs.push(`--window-size=${sizeCfg.width},${sizeCfg.height}`);
            }

            this._log(profile.id, `[Launch] Platform=${plt2} Mode=${profile.windowMode || 'default'} Size=${sizeCfg.maximized ? 'Maximized' : `${sizeCfg.width}x${sizeCfg.height}`}`, 'info');

            const parsed = parseProxy(profile.proxy);
            const proxyOpts = parsed ? {
              server: parsed.proxyRules,
              ...(parsed.username ? { username: parsed.username, password: parsed.password } : {})
            } : undefined;

            const extraArgs = [
              '--no-first-run',
              '--no-default-browser-check',
              '--force-webrtc-ip-handling-policy=default_public_interface_only',
              '--lang=en-US',
              ...windowArgs
            ];

            if (profile.hardwareAcceleration === 'disable') {
              extraArgs.push('--disable-gpu');
              extraArgs.push('--disable-software-rasterizer');
            }

            if (profile.disableTlsFeatures === 'open') {
              extraArgs.push('--ssl-version-min=tls1.2');
            }

            // For desktop maximized: viewport=null lets the OS window fill naturally
            // For mobile / custom resolution: explicit viewport needed
            const viewportArg2 = (sizeCfg.maximized && !isMobilePlt2)
              ? null
              : { width: sizeCfg.width, height: sizeCfg.height };

            this._log(profile.id, `Launching ${browserChoice.toUpperCase()} via launchPersistentContext...`, 'info');
            context = await playLauncher.launchPersistentContext(userDataDir, {
              executablePath: exePath,
              headless: false,
              slowMo: 400, // 400ms between CDP calls — gives browser window time to initialize
              viewport: viewportArg2,
              userAgent: profile.ua,
              proxy: proxyOpts,
              timezoneId: timezoneVal,
              locale: localeVal,
              geolocation: { latitude: latVal, longitude: lngVal, accuracy: 1 },
              permissions: ['geolocation'],
              args: extraArgs,
              ignoreDefaultArgs: ['--enable-automation'],
            });
            break;
          } catch (err) {
            lastError = err;
            this._log(profile.id, `Attempt ${attempt}/3 failed: ${err.message}`, 'warn');
          }
        }

        if (!context) {
          this._log(profile.id, `❌ ${browserChoice.toUpperCase()} failed after retries: ${lastError?.message}`, 'error');
          this._updateStatus(profile.id, 'error');
          return;
        }

        if (this.shouldStop || this.currentRunId !== runId) {
          await context.close().catch(() => {});
          return;
        }

        const spoofScript = this.getStealthSpoofScript(profile);
        await context.addInitScript(spoofScript).catch(() => {});
        await context.addInitScript(STEALTH_SCRIPT).catch(() => {});

        this.playwrightContexts.set(profile.id, context);

        let pages = context.pages();
        let page  = pages[0] || await context.newPage();

        this._log(profile.id, `📍 Navigating → ${targetUrl}`, 'info');

        try {
          await page.goto(targetUrl, { timeout: 15000, waitUntil: 'domcontentloaded' });
        } catch (e) {
          this._log(profile.id, `⚠️ Page load timeout — proceeding anyway...`, 'warn');
        }

        if (this.shouldStop || this.currentRunId !== runId) {
          await context.close().catch(() => {});
          this.playwrightContexts.delete(profile.id);
          return;
        }

        this._log(profile.id, `✓ Page loaded — human delay ${actionDelay}s...`, 'info');

        const dismissPopups = async () => {
          try { await page.evaluate(BYPASS_POPUPS_SCRIPT); } catch (e) {}
        };

        await dismissPopups();
        await this._sleep(2000);
        await dismissPopups();

        if (this.shouldStop || this.currentRunId !== runId) {
          await context.close().catch(() => {});
          this.playwrightContexts.delete(profile.id);
          return;
        }

        try {
          const detectedEmail = await page.evaluate(DETECT_EMAIL_SCRIPT);
          if (detectedEmail && typeof detectedEmail === 'string' && detectedEmail.trim()) {
            const trimmed = detectedEmail.trim();
            if (profile.email !== trimmed) {
              profile.email = trimmed;
              this.updateProfile(profile.id, { email: trimmed });
              this._log(profile.id, `Detected email: ${trimmed}`, 'success');
              this._updateStatus(profile.id, 'running');
            }
          }
        } catch (e) {}

        await this._sleep(1500);
        await page.evaluate(() => {
          window.scrollBy({ top: Math.floor(Math.random() * 300) + 100, behavior: 'smooth' });
        }).catch(() => {});

        if (actionDelay > 5) {
          await this._sleep((actionDelay - 4) * 1000);
          await dismissPopups();
          await this._sleep(4000);
        } else {
          await this._sleep(actionDelay * 1000);
        }
        await dismissPopups();

        if (this.shouldStop || this.currentRunId !== runId) {
          await context.close().catch(() => {});
          this.playwrightContexts.delete(profile.id);
          return;
        }

        const result = await this._executePlaywrightAction(page, action, commentText, profile.id, targetUrl);

        if (result.success) {
          this._log(profile.id, `✅ ${action.toUpperCase()} done!`, 'success');
          this._updateStatus(profile.id, 'success');
        } else {
          this._log(profile.id, `❌ Failed: ${result.error}`, 'error');
          this._updateStatus(profile.id, 'error');
        }

        await this._sleep(3000);
        await context.close().catch(() => {});
        this.playwrightContexts.delete(profile.id);
        this._log(profile.id, `🔒 Browser closed — session saved`, 'info');
        return;
      } catch (err) {
        this._log(profile.id, `⚠️ Error during run: ${err.message}`, 'error');
        this._updateStatus(profile.id, 'error');
        if (context) await context.close().catch(() => {});
        this.playwrightContexts.delete(profile.id);
        return;
      } finally {
        this.activeRunProfiles.delete(profile.id);
      }
    }

    const ses = session.fromPartition(`persist:farm_${profile.id}`, { cache: true });
    ses.setUserAgent(profile.ua);

    ses.removeAllListeners('login');
    const parsed = parseProxy(profile.proxy);
    if (parsed) {
      try {
        await ses.setProxy({ proxyRules: parsed.proxyRules });
        if (parsed.username) {
          ses.on('login', (event, details, authInfo, callback) => {
            if (authInfo.isProxy) {
              event.preventDefault();
              callback(parsed.username, parsed.password);
            }
          });
        }
      } catch (e) {
        this._log(profile.id, `Proxy config error: ${e.message}`, 'error');
      }
    }

    const sizeCfg = this._getProfileWindowSize(profile);
    const win = new BrowserWindow({
      width: sizeCfg.width,
      height: sizeCfg.height,
      title: `[Farm Running] ${profile.name}`,
      webPreferences: {
        session: ses,
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: false,
      },
      autoHideMenuBar: true,
      show: true,
    });

    if (sizeCfg.maximized) {
      win.maximize();
    }

    win.webContents.setUserAgent(profile.ua);
    this.profileWindows.set(profile.id, win);

    try {
      if (this.shouldStop || this.currentRunId !== runId) {
        win.close();
        return;
      }

      win.webContents.on('did-navigate', () => {
        win.webContents.executeJavaScript(STEALTH_SCRIPT).catch(() => {});
      });
      win.webContents.on('did-finish-load', () => {
        win.webContents.executeJavaScript(STEALTH_SCRIPT).catch(() => {});
      });

      this._log(profile.id, `📍 Navigating → ${targetUrl}`, 'info');

      // Page load wrapper with a soft timeout (12s) to avoid freezing on heavy trackers/scripts
      await new Promise((resolve) => {
        const t = setTimeout(() => {
          this._log(profile.id, `⚠️ Page load took too long, stopping load and proceeding...`, 'warn');
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

      if (this.shouldStop || this.currentRunId !== runId) {
        win.close();
        return;
      }

      this._log(profile.id, `✓ Page loaded — human delay ${actionDelay}s...`, 'info');

      const dismissPopups = () => win.webContents.executeJavaScript(BYPASS_POPUPS_SCRIPT).catch(() => {});

      await dismissPopups();
      await this._sleep(2000);
      await dismissPopups();

      try {
        const detectedEmail = await win.webContents.executeJavaScript(DETECT_EMAIL_SCRIPT);
        if (detectedEmail && typeof detectedEmail === 'string' && detectedEmail.trim()) {
          const trimmed = detectedEmail.trim();
          if (profile.email !== trimmed) {
            profile.email = trimmed;
            this.updateProfile(profile.id, { email: trimmed });
            this._log(profile.id, `Detected email/login: ${trimmed}`, 'success');
            this._updateStatus(profile.id, 'running');
          }
        }
      } catch (e) {}

      await this._sleep(1500);
      win.webContents.executeJavaScript(`window.scrollBy({ top: ${Math.floor(Math.random() * 300) + 100}, behavior: 'smooth' })`).catch(() => {});

      if (actionDelay > 5) {
        await this._sleep((actionDelay - 4) * 1000);
        await dismissPopups();
        await this._sleep(4000);
      } else {
        await this._sleep(actionDelay * 1000);
      }
      await dismissPopups();

      if (this.shouldStop || this.currentRunId !== runId) { win.close(); return; }

      const result = await this._executeAction(win, action, commentText, profile.id, targetUrl);

      if (result.success) {
        this._log(profile.id, `✅ ${action.toUpperCase()} done!`, 'success');
        this._updateStatus(profile.id, 'success');
      } else {
        this._log(profile.id, `❌ Failed: ${result.error}`, 'error');
        this._updateStatus(profile.id, 'error');
      }

    } catch (err) {
      this._log(profile.id, `❌ Error: ${err.message}`, 'error');
      this._updateStatus(profile.id, 'error');
    }

    await this._sleep(3000);
    if (!win.isDestroyed()) { win.close(); }
    this.profileWindows.delete(profile.id);
    this._log(profile.id, `🔒 Browser closed — session saved`, 'info');
  }

  async _executePlaywrightAction(page, action, commentText, profileId, url) {
    const platform = detectPlatform(url);
    this._log(profileId, `Platform: ${platform} | Action: ${action}`, 'info');

    const mockWin = {
      webContents: {
        executeJavaScript: async (script) => {
          return await page.evaluate(script);
        }
      }
    };

    switch (action) {
      case 'like':      return this._doLike(mockWin, platform, profileId);
      case 'subscribe': return this._doSubscribe(mockWin, platform, profileId);
      case 'comment':   return this._doComment(mockWin, platform, commentText, profileId);
      case 'share':     return this._doShare(mockWin, platform, profileId);
      case 'watch':
        this._log(profileId, `👁 Watching for 45s...`, 'info');
        await this._sleep(45000);
        return { success: true };
      default:
        return { success: false, error: 'Unknown action' };
    }
  }

  async _executeAction(win, action, commentText, profileId, url) {
    const platform = detectPlatform(url);
    this._log(profileId, `Platform: ${platform} | Action: ${action}`, 'info');

    switch (action) {
      case 'like':      return this._doLike(win, platform, profileId);
      case 'subscribe': return this._doSubscribe(win, platform, profileId);
      case 'comment':   return this._doComment(win, platform, commentText, profileId);
      case 'share':     return this._doShare(win, platform, profileId);
      case 'watch':
        this._log(profileId, `👁 Watching for 45s...`, 'info');
        await this._sleep(45000);
        return { success: true };
      default:
        return { success: false, error: 'Unknown action' };
    }
  }

  async _doLike(win, platform, profileId) {
    this._log(profileId, `👍 Looking for Like button...`, 'info');
    const script = `
      (async () => {
        try {
          // Human scroll simulation
          window.scrollBy({ top: 350, behavior: 'smooth' });
          await new Promise(r => setTimeout(r, 2000 + Math.random() * 1000));
          window.scrollTo({ top: 0, behavior: 'smooth' });
          await new Promise(r => setTimeout(r, 1500));

          // YouTube selectors
          let btn = document.querySelector(
            'ytd-toggle-button-renderer:first-child button[aria-pressed], ' +
            '#top-level-buttons-computed ytd-toggle-button-renderer:first-child button, ' +
            'button[aria-label*="like" i]:not([aria-label*="dislike" i])'
          );
          // TikTok
          if (!btn) btn = document.querySelector('[data-e2e="like-icon"], [class*="likeWrapper"]');
          // Instagram
          if (!btn) btn = document.querySelector('svg[aria-label*="Like" i]')?.closest('button');
          // Twitter
          if (!btn) btn = document.querySelector('[data-testid="like"]');

          if (!btn) return { success: false, error: 'Like button not found — try scrolling or logging in' };

          // Random offset jitter
          const rect = btn.getBoundingClientRect();
          btn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: rect.x + (Math.random()-0.5)*6, clientY: rect.y + (Math.random()-0.5)*6 }));
          await new Promise(r => setTimeout(r, Math.random() * 500 + 400));
          btn.click();
          return { success: true };
        } catch(e) { return { success: false, error: e.message }; }
      })()
    `;
    try {
      return await win.webContents.executeJavaScript(script) || { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  }

  async _doSubscribe(win, platform, profileId) {
    this._log(profileId, `🔔 Looking for Subscribe button...`, 'info');
    const script = `
      (async () => {
        try {
          // Simulate reading comments / human scrolling before subscribing
          window.scrollBy({ top: 450, behavior: 'smooth' });
          await new Promise(r => setTimeout(r, 2500 + Math.random() * 1000));
          window.scrollBy({ top: -300, behavior: 'smooth' });
          await new Promise(r => setTimeout(r, 1500 + Math.random() * 1000));
          window.scrollTo({ top: 0, behavior: 'smooth' });
          await new Promise(r => setTimeout(r, 1500));

          let btn = document.querySelector(
            'ytd-subscribe-button-renderer button, tp-yt-paper-button#subscribe-button, ' +
            'button[aria-label*="Subscribe" i], [class*="subscribe" i] button, ' +
            '[data-e2e="follow-button"], button[class*="follow" i]'
          );
          if (!btn) return { success: false, error: 'Subscribe/Follow button not found' };

          // Hover and wait
          btn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
          await new Promise(r => setTimeout(r, 600 + Math.random() * 400));
          btn.click();
          return { success: true };
        } catch(e) { return { success: false, error: e.message }; }
      })()
    `;
    try {
      return await win.webContents.executeJavaScript(script) || { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  }

  async _doComment(win, platform, commentText, profileId) {
    const text = commentText || 'Great content! 🔥';
    this._log(profileId, `💬 Typing comment: "${text.substring(0, 30)}..."`, 'info');
    const script = `
      (async () => {
        try {
          window.scrollBy({ top: 700, behavior: 'smooth' });
          await new Promise(r => setTimeout(r, 2200));

          let box = document.querySelector(
            '#simplebox-placeholder, [aria-label*="Add a comment" i], ' +
            '[placeholder*="comment" i], .DPvwYc, [contenteditable="true"]'
          );
          if (!box) return { success: false, error: 'Comment box not found' };

          box.click();
          await new Promise(r => setTimeout(r, 800));

          // Type human-like
          const text = ${JSON.stringify(text)};
          const active = document.activeElement;
          for (const ch of text) {
            const ev = new KeyboardEvent('keypress', { key: ch, charCode: ch.charCodeAt(0), bubbles: true });
            active.dispatchEvent(new InputEvent('input', { data: ch, inputType: 'insertText', bubbles: true }));
            if (active.isContentEditable) {
              document.execCommand('insertText', false, ch);
            } else {
              active.value = (active.value || '') + ch;
              active.dispatchEvent(new Event('input', { bubbles: true }));
            }
            await new Promise(r => setTimeout(r, Math.random() * 90 + 50));
          }

          await new Promise(r => setTimeout(r, 1200));

          const submitBtn = document.querySelector(
            '[aria-label="Comment" i], #submit-button button, button[type="submit"], ' +
            '.commentBox-submitBtn, [data-e2e="comment-post"]'
          );
          if (submitBtn) { submitBtn.click(); return { success: true }; }
          return { success: false, error: 'Submit button not found' };
        } catch(e) { return { success: false, error: e.message }; }
      })()
    `;
    try {
      return await win.webContents.executeJavaScript(script) || { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  }

  async _doShare(win, platform, profileId) {
    this._log(profileId, `📤 Looking for Share button...`, 'info');
    const script = `
      (async () => {
        try {
          const btn = document.querySelector(
            'button[aria-label*="share" i], [data-e2e="share-icon"], ' +
            '[aria-label*="Share" i], .share-button'
          );
          if (!btn) return { success: false, error: 'Share button not found' };
          btn.click();
          return { success: true };
        } catch(e) { return { success: false, error: e.message }; }
      })()
    `;
    try {
      return await win.webContents.executeJavaScript(script) || { success: true };
    } catch (e) { return { success: false, error: e.message }; }
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
        await ses.setProxy({ proxyRules: parsed.proxyRules });
        if (parsed.username) {
          ses.on('login', (event, details, authInfo, callback) => {
            if (authInfo.isProxy) {
              event.preventDefault();
              callback(parsed.username, parsed.password);
            }
          });
        }
      } catch (e) {}
    }
    return new Promise((resolve) => {
      const req = net.request({
        method: 'GET',
        url: 'http://ip-api.com/json',
        session: ses
      });
      req.on('response', (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (data && data.status === 'success') {
              resolve({
                timezone: data.timezone || 'UTC',
                lat: data.lat || 0,
                lng: data.lon || 0,
                country: data.countryCode || 'US',
                locale: getLocaleForCountry(data.countryCode)
              });
              return;
            }
          } catch (e) {}
          resolve(null);
        });
      });
      req.on('error', () => resolve(null));
      req.end();
      setTimeout(() => resolve(null), 3000);
    });
  }

  getStealthSpoofScript(profile) {
    let platformStr = 'Win32';
    let webglVendor = 'Google Inc. (NVIDIA)';
    let webglRenderer = 'NVIDIA GeForce RTX 3060';
    
    const platform = profile.platform || 'android';
    if (platform === 'mac') {
      platformStr = 'MacIntel';
      webglVendor = 'Apple Inc.';
      webglRenderer = 'Apple M1';
    } else if (platform === 'linux') {
      platformStr = 'Linux x86_64';
      webglVendor = 'Intel Open Source Technology Center';
      webglRenderer = 'Mesa DRI Intel(R) HD Graphics 520 (Skylake GT2)';
    } else if (platform === 'android') {
      platformStr = 'Linux aarch64';
      webglVendor = 'Google Inc. (Qualcomm)';
      webglRenderer = 'Adreno (TM) 640';
    } else if (platform === 'ios') {
      platformStr = 'iPhone';
      webglVendor = 'Apple Inc.';
      webglRenderer = 'Apple GPU';
    }

    if (profile.webglVendor) {
      webglVendor = profile.webglVendor;
    }
    if (profile.webglRenderer) {
      webglRenderer = profile.webglRenderer;
    }
    if (profile.platformStr) {
      platformStr = profile.platformStr;
    }

    const canvasNoise = profile.canvasNoise !== false;
    const webglNoise = profile.webglNoise !== false;
    const audioNoise = profile.audioNoise !== false;

    const webglImageNoise = profile.webglImageNoise !== false;
    const mediaDeviceNoise = profile.mediaDeviceNoise !== false;
    const clientRectsNoise = profile.clientRectsNoise !== false;
    const speechVoicesNoise = profile.speechVoicesNoise !== false;
    const webgpuMode = profile.webgpuMode || 'real';
    const cpuCores = profile.cpuCores && profile.cpuCores !== 'Auto' ? parseInt(profile.cpuCores) : null;
    const ramSize = profile.ramSize && profile.ramSize !== 'Auto' ? parseInt(profile.ramSize) : null;
    const doNotTrack = profile.doNotTrack || 'default';
    const portScanProtection = profile.portScanProtection || 'enable';

    ensureProfileStealthSpecs(profile);

    return `
      (function() {
        try {
          // 1. Spoof Navigator Platform
          Object.defineProperty(navigator, 'platform', { get: () => ${JSON.stringify(platformStr)} });
          
          // 2. Spoof Canvas Fingerprinting with dynamic, seed-based noise
          if (${canvasNoise}) {
            const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;
            CanvasRenderingContext2D.prototype.getImageData = function(x, y, w, h) {
              const res = originalGetImageData.apply(this, arguments);
              if (res.data) {
                const seed = ${profile.canvasNoiseSeed || 42};
                for (let i = 0; i < res.data.length; i += 4) {
                  // Coordinate-dependent pseudo-random noise consistent for this profile seed
                  res.data[i] = (res.data[i] + ((i + seed) % 3)) % 256;
                }
              }
              return res;
            };

            const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
            HTMLCanvasElement.prototype.toDataURL = function() {
              const ctx = this.getContext('2d');
              if (ctx) {
                try {
                  const oldFillStyle = ctx.fillStyle;
                  ctx.fillStyle = 'rgba(255,255,255,0.01)';
                  ctx.fillRect(0, 0, 1, 1);
                  ctx.fillStyle = oldFillStyle;
                } catch(e) {}
              }
              return originalToDataURL.apply(this, arguments);
            };
          }

          // 3. Spoof WebGL Vendor/Renderer
          if (${webglNoise}) {
            const getParameterProxy = function(originalGetParameter) {
              return function(parameter) {
                if (parameter === 37445) return ${JSON.stringify(webglVendor)};
                if (parameter === 37446) return ${JSON.stringify(webglRenderer)};
                return originalGetParameter.apply(this, arguments);
              };
            };
            if (window.WebGLRenderingContext) {
              WebGLRenderingContext.prototype.getParameter = getParameterProxy(WebGLRenderingContext.prototype.getParameter);
            }
            if (window.WebGL2RenderingContext) {
              WebGL2RenderingContext.prototype.getParameter = getParameterProxy(WebGL2RenderingContext.prototype.getParameter);
            }
          }

          // 3b. WebGL Image noise (readPixels)
          if (${webglImageNoise}) {
            const seed = ${profile.webglNoiseSeed || 88};
            if (window.WebGLRenderingContext) {
              const originalReadPixels = WebGLRenderingContext.prototype.readPixels;
              WebGLRenderingContext.prototype.readPixels = function(x, y, width, height, format, type, pixels) {
                originalReadPixels.apply(this, arguments);
                if (pixels && pixels.length > 0) {
                  for (let i = 0; i < Math.min(pixels.length, 100); i++) {
                    pixels[i] = (pixels[i] + ((i + seed) % 3)) % 256;
                  }
                }
              };
            }
            if (window.WebGL2RenderingContext) {
              const originalReadPixels2 = WebGL2RenderingContext.prototype.readPixels;
              WebGL2RenderingContext.prototype.readPixels = function(x, y, width, height, format, type, pixels) {
                originalReadPixels2.apply(this, arguments);
                if (pixels && pixels.length > 0) {
                  for (let i = 0; i < Math.min(pixels.length, 100); i++) {
                    pixels[i] = (pixels[i] + ((i + seed) % 3)) % 256;
                  }
                }
              };
            }
          }

          // 4. Spoof AudioContext sound card signature with consistent seed-based offset
          if (${audioNoise}) {
            if (window.AudioBuffer) {
              const originalGetChannelData = AudioBuffer.prototype.getChannelData;
              const seed = ${profile.audioNoiseSeed || 0.0000001};
              AudioBuffer.prototype.getChannelData = function(channel) {
                const data = originalGetChannelData.apply(this, arguments);
                if (data && data.length > 0) {
                  for (let i = 0; i < Math.min(data.length, 50); i++) {
                    data[i] += seed * ((i % 3) - 1);
                  }
                }
                return data;
              };
            }
          }

          // 5. Media Devices Virtualization (Isolate names & IDs per profile environment)
          if (${mediaDeviceNoise}) {
            if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
              navigator.mediaDevices.enumerateDevices = async function() {
                return [
                  {
                    deviceId: ${JSON.stringify(profile.virtualCamId || 'mock_cam_id')},
                    kind: 'videoinput',
                    label: ${JSON.stringify(profile.virtualCamLabel || 'HD Camera')},
                    groupId: ${JSON.stringify(profile.virtualCamId || 'mock_cam_group')}
                  },
                  {
                    deviceId: ${JSON.stringify(profile.virtualMicId || 'mock_mic_id')},
                    kind: 'audioinput',
                    label: ${JSON.stringify(profile.virtualMicLabel || 'Microphone')},
                    groupId: ${JSON.stringify(profile.virtualMicId || 'mock_mic_group')}
                  },
                  {
                    deviceId: ${JSON.stringify(profile.virtualSpeakerId || 'mock_speaker_id')},
                    kind: 'audiooutput',
                    label: ${JSON.stringify(profile.virtualSpeakerLabel || 'Speakers')},
                    groupId: ${JSON.stringify(profile.virtualSpeakerId || 'mock_speaker_group')}
                  }
                ];
              };
            }
            if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
              const originalGetUserMedia = navigator.mediaDevices.getUserMedia;
              navigator.mediaDevices.getUserMedia = async function(constraints) {
                const cloned = Object.assign({}, constraints);
                if (cloned.video && typeof cloned.video === 'object') {
                  if (cloned.video.deviceId) {
                    delete cloned.video.deviceId;
                  }
                }
                return originalGetUserMedia.call(navigator.mediaDevices, cloned);
              };
            }
          }

          // 6. ClientRects Noise (getBoundingClientRect and getClientRects)
          if (${clientRectsNoise}) {
            const origGetBoundingClientRect = Element.prototype.getBoundingClientRect;
            Element.prototype.getBoundingClientRect = function() {
              const r = origGetBoundingClientRect.apply(this, arguments);
              return new DOMRect(r.x + 0.0001, r.y + 0.0001, r.width + 0.0002, r.height + 0.0002);
            };
          }

          // 7. SpeechVoices Noise
          if (${speechVoicesNoise}) {
            if (window.speechSynthesis) {
              const origGetVoices = SpeechSynthesis.prototype.getVoices;
              SpeechSynthesis.prototype.getVoices = function() {
                const voices = origGetVoices.apply(this, arguments);
                return voices.slice(0, Math.max(1, voices.length - 1));
              };
            }
          }

          // 8. WebGPU override
          if (${webgpuMode === 'disabled'}) {
            if (navigator.gpu) {
              Object.defineProperty(navigator, 'gpu', { get: () => undefined });
            }
          }

          // 9. CPU Cores override
          if (${cpuCores !== null}) {
            Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => ${cpuCores} });
          }

          // 10. RAM override
          if (${ramSize !== null}) {
            Object.defineProperty(navigator, 'deviceMemory', { get: () => ${ramSize} });
          }

          // 11. Do Not Track override
          if (${doNotTrack === 'enable'}) {
            Object.defineProperty(navigator, 'doNotTrack', { get: () => '1' });
          } else if (${doNotTrack === 'disable'}) {
            Object.defineProperty(navigator, 'doNotTrack', { get: () => '0' });
          }

          // 12. Port Scan Protection (Fetch and WebSockets localhost interception)
          if (${portScanProtection === 'enable'}) {
            const origFetch = window.fetch;
            window.fetch = function(input, init) {
              const url = typeof input === 'string' ? input : (input && input.url) ? input.url : '';
              if (url.includes('127.0.0.1') || url.includes('localhost')) {
                return Promise.reject(new TypeError('Failed to fetch (port scan protection)'));
              }
              return origFetch.apply(this, arguments);
            };
            const origWS = window.WebSocket;
            window.WebSocket = function(url, protocols) {
              if (url.includes('127.0.0.1') || url.includes('localhost')) {
                throw new DOMException('Connection refused (port scan protection)', 'ConnectionError');
              }
              return new origWS(url, protocols);
            };
          }
        } catch(e) {}
      })();
    `;
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
    const idx = this.profiles.findIndex(p => p.id === profileId);
    let email = undefined;
    if (idx !== -1) {
      this.profiles[idx].status = status;
      if (['success', 'error'].includes(status)) {
        this.profiles[idx].lastRun = new Date().toLocaleString();
      }
      email = this.profiles[idx].email;
      this._saveProfiles();
    }
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('farm:profile-update', {
        profileId,
        status,
        lastRun: ['success', 'error'].includes(status) ? new Date().toLocaleString() : undefined,
        email: email,
      });
    }
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
