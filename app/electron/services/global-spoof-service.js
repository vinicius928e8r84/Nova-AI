'use strict';

const { spawn } = require('child_process');
const toolPaths = require('./tool-paths');
const path  = require('path');
const fs    = require('fs');
const crypto = require('crypto');
const os    = require('os');
const { findBundledChromiumExecutable, primeiroCaminhoExistente } = require('./platform-utils');
const { prepararPagina, abrirUrlPedida, gerarAmbiente, encerrarChrome } = require('./global-spoof-abertura');
const { montarTextoDaPagina, gravarExtensao } = require('./global-spoof-pagina');
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

function valorFixo(valor, atual) {
  return valor && valor !== 'optimal' ? valor : atual;
}

class GlobalSpoofService {
    constructor(mainWindow, app, browserFarmService) {
        this.mainWindow = mainWindow;
        this.app        = app;
        this.browserFarmService = browserFarmService;

        this.ffmpegPath     = toolPaths.ffmpeg() || 'ffmpeg';
        this.tempDir        = path.join(os.tmpdir(), 'nova_webcam_hijack');
        this.y4mPath        = path.join(this.tempDir, 'fake_cam.y4m');

        this.isHijacking    = false;
        this.activeMode     = null;
        this.activeDeviceName = null;
        this.chromePid      = null;
        this.chromeProcess  = null;
        this.ffmpegProcess  = null;
        this.ffplayProcess  = null;

        this.registrySpoofed     = false;
        this.isInstallingDriver  = false;

        this.currentDevice   = null;
        this.currentRegional = null;
        this.activeSessions  = new Set();
        this.cdpClient       = null;

        if (!fs.existsSync(this.tempDir)) fs.mkdirSync(this.tempDir, { recursive: true });

        console.log('[GlobalSpoof] v4.0 — Native Y4M Hijack Engine initialized.');
    }

    async detectDriver() {
        const chromePath = this._findChrome();
        if (!chromePath) {
            return { mode: 'none', deviceName: null, vcamExePath: null };
        }
        return {
            mode: 'chrome-y4m',
            deviceName: 'Chrome Y4M Injector',
            vcamExePath: chromePath,
        };
    }

    async startHijack(buffer, settings = {}) {
        if (this.isHijacking) {
            return { success: false, error: 'Already hijacking.' };
        }

        try {
            console.log('[GlobalSpoof] Checking for orphaned Nova Chrome processes...');
            const { execSync, spawnSync } = require('child_process');
            if (process.platform === 'darwin') {
                const r = spawnSync('pkill', ['-f', '--', require('./paridade-utils').MAC_CAM_SPOOF_KILL_PATTERN], { timeout: 5000 });
                if (r.error || r.status > 1) console.error('[GlobalSpoof] Failed to run Chrome cleanup:', r.error ? r.error.message : `pkill status ${r.status}`);
            } else {
                const cleanupCmd = `Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'chrome.exe' -and $_.CommandLine -like '*nova_webcam_hijack*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
                execSync(`powershell -NoProfile -Command "${cleanupCmd}"`, { stdio: 'ignore', timeout: 15000 });
                console.log('[GlobalSpoof] Cleaned up orphaned Nova Chrome instances via PowerShell.');
            }
        } catch (cleanupErr) {
            console.error('[GlobalSpoof] Failed to run Chrome cleanup:', cleanupErr.message);
        }

        function getTimezoneOffset(timeZone) {
            try {
                const date = new Date();
                const loc = date.toLocaleString('en-US', { timeZone, hour12: false });
                const utc = date.toLocaleString('en-US', { timeZone: 'UTC', hour12: false });
                const diffMs = new Date(loc).getTime() - new Date(utc).getTime();
                return -Math.round(diffMs / 60000);
            } catch (e) {
                return 0;
            }
        }

        function getGMTLabel(offsetMin) {
            const offsetReal = -offsetMin;
            const absMin = Math.abs(offsetReal);
            const hrs = Math.floor(absMin / 60);
            const mins = absMin % 60;
            const sign = offsetReal >= 0 ? '+' : '-';
            return 'GMT' + sign + String(hrs).padStart(2, '0') + String(mins).padStart(2, '0');
        }

        const device    = settings.device || { id: 'desktop', ua: '', res: '1920,1080', dpr: 1 };
        const targetUrl = (settings.url || '').trim();
        let profileName = settings.profile || 'Default';
        const pPath = path.join(this.app.getPath('userData'), 'farm_profiles.json');
        
        if (profileName && !profileName.startsWith('profile_') && profileName !== 'Default') {
            let farmProfiles = [];
            if (this.browserFarmService) {
                farmProfiles = this.browserFarmService.profiles || [];
            } else if (fs.existsSync(pPath)) {
                try { farmProfiles = JSON.parse(fs.readFileSync(pPath, 'utf8')); } catch(e) {}
            }
            let nextNum = 1;
            if (farmProfiles && farmProfiles.length > 0) {
                const nums = farmProfiles
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
            const newId = `profile_${String(nextNum).padStart(2, '0')}`;
            const newProfile = {
                id: newId,
                name: profileName,
                browser: settings.browser || 'chrome',
                ua: device.ua || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                proxy: settings.proxy ? `${settings.proxy.user ? settings.proxy.user + ':' + settings.proxy.pass + '@' : ''}${settings.proxy.ip}:${settings.proxy.port}` : '',
                email: '',
                status: 'idle',
                battery: Math.floor(Math.random() * 50) + 40,
                anonymityScore: Math.floor(Math.random() * 30) + 65,
                lastRun: null,
                platform: device.id !== 'desktop' ? 'android' : 'windows',
                timezone: 'optimal',
                locale: 'optimal',
                latitude: settings.regional ? settings.regional.lat : null,
                longitude: settings.regional ? settings.regional.lng : null,
                canvasNoise: true,
                webglNoise: true,
                audioNoise: true
            };
            ensureProfileStealthSpecs(newProfile);
            if (this.browserFarmService) {
                this.browserFarmService.profiles.push(newProfile);
                this.browserFarmService._saveProfiles();
            } else {
                farmProfiles.push(newProfile);
                fs.writeFileSync(pPath, JSON.stringify(farmProfiles, null, 2));
            }
            profileName = newId;
        }

        let activeProfile = null;
        let farmProfiles = [];
        if (fs.existsSync(pPath)) {
            try { farmProfiles = JSON.parse(fs.readFileSync(pPath, 'utf8')); } catch(e) {}
        }
        if (profileName && profileName !== 'Default') {
            activeProfile = farmProfiles.find(p => p.id === profileName);
            if (activeProfile) {
                console.log(`[GlobalSpoof] Loaded active profile config: ${activeProfile.name} (${activeProfile.id})`);
                const before = JSON.stringify(activeProfile);
                ensureProfileStealthSpecs(activeProfile);
                const after = JSON.stringify(activeProfile);
                if (before !== after) {
                    const idx = farmProfiles.findIndex(p => p.id === profileName);
                    if (idx !== -1) {
                        farmProfiles[idx] = activeProfile;
                        try {
                            fs.writeFileSync(pPath, JSON.stringify(farmProfiles, null, 2));
                        } catch (e) {}
                    }
                }
                if (activeProfile.ua) {
                    device.ua = activeProfile.ua;
                }
            }
        }

        if (!activeProfile) {
            activeProfile = {
                id: 'temp_launch_' + Math.random().toString(36).substring(2, 9),
                name: 'Temporary Profile',
                platform: device.id !== 'desktop' ? (device.id.includes('iphone') ? 'ios' : 'android') : 'windows',
                ua: device.ua || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                proxy: '',
                canvasNoise: true,
                webglNoise: true,
                audioNoise: true
            };
            ensureProfileStealthSpecs(activeProfile);
        }

        const browserChoice = activeProfile.browser || 'chrome';
        const chromePath = this._findChrome(browserChoice);
        if (!chromePath) {
            return {
                success: false,
                error: `${browserChoice.toUpperCase()} Browser not found. Please install it or check your browsers folder.`,
                noDriver: true,
            };
        }

        let proxyServer = '';
        let proxyUser = '';
        let proxyPass = '';
        const rawProxy = activeProfile ? activeProfile.proxy : (settings.proxy ? `${settings.proxy.user ? settings.proxy.user + ':' + settings.proxy.pass + '@' : ''}${settings.proxy.ip}:${settings.proxy.port}` : '');
        if (rawProxy && rawProxy.trim()) {
            const cleaned = rawProxy.trim();
            if (cleaned.includes('@')) {
                const [creds, server] = cleaned.split('@');
                proxyServer = server;
                if (creds.includes(':')) {
                    [proxyUser, proxyPass] = creds.split(':');
                } else {
                    proxyUser = creds;
                }
            } else {
                const parts = cleaned.split(':');
                if (parts.length === 4) {
                    proxyServer = `${parts[0]}:${parts[1]}`;
                    proxyUser = parts[2];
                    proxyPass = parts[3];
                } else if (parts.length === 2) {
                    proxyServer = cleaned;
                } else {
                    proxyServer = cleaned;
                }
            }
        }

        const isMobile = activeProfile 
            ? (activeProfile.platform === 'android' || activeProfile.platform === 'ios')
            : (device.id && device.id !== 'desktop');

        const profileRoot = path.join(this.app.getPath('userData'), 'farm_profiles');
        const profileDir  = path.join(profileRoot, profileName);
        if (!fs.existsSync(profileRoot)) fs.mkdirSync(profileRoot, { recursive: true });
        if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir, { recursive: true });

        this.currentDevice   = device;
        this.currentRegional = settings.regional || {};

        const regional    = settings.regional || {};
        let tTimezone   = valorFixo(regional.timezone, 'Asia/Dubai');
        let tLat        = (regional.lat        !== undefined) ? regional.lat : 25.2048;
        let tLng        = (regional.lng        !== undefined) ? regional.lng : 55.2708;
        let tLocale     = valorFixo(regional.language, 'en-AE');

        if (activeProfile) {
            if (activeProfile.timezone === 'optimal' || activeProfile.locale === 'optimal' || activeProfile.locationMode === 'optimal') {
                if (this.browserFarmService && typeof this.browserFarmService.getOptimalGeoDetails === 'function') {
                    console.log('[GlobalSpoof] Fetching optimal geo details via proxy/IP...');
                    const geo = await this.browserFarmService.getOptimalGeoDetails(activeProfile);
                    if (geo) {
                        console.log('[GlobalSpoof] Retrieved optimal geo details:', geo);
                        if (activeProfile.timezone === 'optimal') {
                            tTimezone = geo.timezone;
                        }
                        if (activeProfile.locationMode === 'optimal') {
                            tLat = geo.lat;
                            tLng = geo.lng;
                        }
                        if (activeProfile.locale === 'optimal') {
                            tLocale = geo.locale;
                        }
                    }
                }
            }

            tTimezone = valorFixo(activeProfile.timezone, tTimezone);
            if (activeProfile.locationMode === 'custom') {
                if (activeProfile.latitude !== undefined && activeProfile.latitude !== null) {
                    tLat = activeProfile.latitude;
                }
                if (activeProfile.longitude !== undefined && activeProfile.longitude !== null) {
                    tLng = activeProfile.longitude;
                }
            }
            tLocale = valorFixo(activeProfile.locale, tLocale);
        }

        let tOffset     = -Math.round(((regional.utcOffset  !== undefined) ? regional.utcOffset : 4) * 60);
        if (tTimezone) {
            tOffset = getTimezoneOffset(tTimezone);
        }

        const tIP         = regional.ip          || '94.200.120.45';
        const tISP        = regional.isp         || 'Etisalat';
        const tOrg        = regional.org         || 'Emirates Telecommunications Group Company PJSC';
        const tASN        = regional.asn         || 'AS8966';
        const tCountry    = regional.country     || 'United Arab Emirates';
        const tCC         = regional.countryCode || 'AE';
        const tRegion     = regional.region      || 'Dubai';
        const tCity       = regional.city        || 'Dubai';

        let tGMT        = regional.gmtLabel    || 'GMT+0400 (Gulf Standard Time)';
        if (tTimezone) {
            tGMT = `${getGMTLabel(tOffset)} (Custom Timezone)`;
        }

        let tLocales    = [tLocale];
        if (tLocale.includes('-')) {
            tLocales.push(tLocale.split('-')[0]);
        }
        if (!tLocales.includes('en-US')) tLocales.push('en-US');
        if (!tLocales.includes('en')) tLocales.push('en');
        const tAcceptLang = tLocales.join(',') + ';q=0.9,en;q=0.8';

        let winW = 1920;
        let winH = 1080;
        
        if (activeProfile) {
            if (activeProfile.platform === 'android' || activeProfile.platform === 'ios') {
                winW = 412;
                winH = 915;
            } else if (activeProfile.platform === 'mac') {
                winW = 1440;
                winH = 900;
            } else {
                winW = 1920;
                winH = 1080;
            }

            if (activeProfile.screenResolution && activeProfile.screenResolution.includes('x') && activeProfile.screenResolution !== 'Based on User-Agent') {
                const [w, h] = activeProfile.screenResolution.split('x').map(Number);
                if (!isNaN(w) && !isNaN(h)) {
                    winW = w;
                    winH = h;
                }
            }
        } else {
            const fallbackPlatform = (device.id && device.id !== 'desktop') ? 'android' : 'windows';
            if (fallbackPlatform === 'android') {
                winW = 412;
                winH = 915;
            } else {
                winW = 1920;
                winH = 1080;
            }
        }

        let camW = winW;
        let camH = winH;
        if (activeProfile) {
            if (activeProfile.platform === 'android' || activeProfile.platform === 'ios') {
                camW = 1080;
                camH = 1920;
            }
        } else if (isMobile) {
            camW = 720;
            camH = 1280;
        }

        if (!buffer) {
            return { success: false, error: 'No media buffer received from canvas.' };
        }
        const webmPath = path.join(this.tempDir, 'temp_canvas.webm');
        console.log(`[GlobalSpoof] Saving canvas clip to: ${webmPath}`);
        try {
            fs.writeFileSync(webmPath, Buffer.from(buffer));
        } catch (err) {
            return { success: false, error: `Failed to save clip: ${err.message}` };
        }

        console.log(`[GlobalSpoof] Converting clip to Y4M: ${camW}x${camH}`);
        try {
            await this._generateY4M(webmPath, settings.rotate || 0, `${camW},${camH}`);
        } catch (err) {
            return { success: false, error: `FFmpeg conversion failed: ${err.message}` };
        }

        const chromeArgs = [
            `--use-fake-device-for-media-stream`,
            `--use-fake-ui-for-media-stream`,
            `--use-file-for-fake-video-capture=${this.y4mPath}`,
            `--user-data-dir=${profileDir}`,
            `--window-size=${winW},${winH}`,
            `--window-position=100,100`,
            `--disable-notifications`,
            `--hide-scrollbars`,
            `--lang=en-US`,
            `--no-first-run`,
            `--no-default-browser-check`,
            `--disable-blink-features=AutomationControlled`,
            `--force-webrtc-ip-handling-policy=default_public_interface_only`,
            `--password-store=basic`,
            `--use-mock-keychain`,
            `--disable-background-mode`,
            `--disable-background-networking`,
            `--disable-features=CalculateNativeWinOcclusion`
        ];

        if (proxyServer) {
            chromeArgs.push(`--proxy-server=${proxyServer}`);
        }

        if (device.ua) {
            chromeArgs.push(`--user-agent=${device.ua}`);
        }

        if (isMobile) {
            chromeArgs.push(`--force-device-scale-factor=1`); 
            chromeArgs.push(`--high-dpi-support=1`);
            chromeArgs.push(`--touch-events=enabled`);
            chromeArgs.push(`--enable-touch-drag-drop`);
        }

        if (activeProfile && (activeProfile.windowMode === 'maximized' || activeProfile.platform === 'windows' || activeProfile.platform === 'linux')) {
            if (!activeProfile.screenResolution || activeProfile.screenResolution === 'Based on User-Agent' || activeProfile.screenResolution === '1920x1080') {
                chromeArgs.push('--start-maximized');
            }
        }

        chromeArgs.push('about:blank');

        let audioFile = settings.audioPath;
        if (!audioFile) {
            audioFile = path.join(this.tempDir, 'room_ambience.wav');
            if (!fs.existsSync(audioFile)) {
                const audioArgs = [
                    '-f', 'lavfi', '-i', 'anoisesrc=a=0.01:c=white:r=48000', 
                    '-t', '15', '-ac', '1', '-ar', '48000', audioFile
                ];
                await gerarAmbiente(spawn, this.ffmpegPath, audioArgs);
            }
        }

        if (audioFile && fs.existsSync(audioFile)) {
            chromeArgs.push(`--use-file-for-fake-audio-capture=${audioFile}`);
            try {
                const psCommand = `$wmp = New-Object -ComObject wmplayer.ocx; $wmp.URL = '${audioFile.replace(/'/g, "''")}'; $wmp.settings.setMode('loop', $true); $wmp.controls.play(); while($wmp.playState -ne 1){ Start-Sleep -Seconds 1 }`;
                this.ffplayProcess = process.platform === 'darwin' ? spawn('/usr/bin/afplay', [audioFile]) : spawn('powershell', ['-WindowStyle', 'Hidden', '-Command', psCommand], {
                    windowsHide: true,
                    detached: false,
                    stdio: 'ignore'
                });
                this.ffplayProcess.on('error', () => {});
            } catch (err) {}
        }

        const deepHijackScript = montarTextoDaPagina({
            perfil: activeProfile,
            device,
            isMobile,
            tela: { winW, winH, camW, camH },
            identidade: { tTimezone, tOffset, tLat, tLng, tIP, tISP, tOrg, tASN, tCountry, tCC, tRegion, tCity, tGMT, tLocale, tLocales },
        });

        const extDir = path.join(this.tempDir, 'anti_detect_ext');
        gravarExtensao(extDir, deepHijackScript);
        chromeArgs.push(`--load-extension=${extDir}`);
        chromeArgs.push(`--disable-extensions-except=${extDir}`);

        const debugPort = 9222 + Math.floor(Math.random() * 1000);
        chromeArgs.push(`--remote-debugging-port=${debugPort}`);

        this.chromeProcess = spawn(chromePath, chromeArgs, {
            detached: true,
            stdio: 'ignore',
            windowsHide: false,
            env: { ...process.env, ATTACH_DEBUGGER: 'true' }
        });
        this.chromeProcess.unref();
        this.chromePid = this.chromeProcess.pid;

        const connectCDP = async (port, retries = 30, interval = 200) => {
            const CDP = require('chrome-remote-interface');
            for (let i = 0; i < retries; i++) {
                try {
                    const versionInfo = await CDP.Version({ port });
                    if (versionInfo && versionInfo.webSocketDebuggerUrl) {
                        return await CDP({ target: versionInfo.webSocketDebuggerUrl });
                    }
                    return await CDP({ port });
                } catch (err) {
                    if (i === retries - 1) throw err;
                    await new Promise(resolve => setTimeout(resolve, interval));
                }
            }
        };

        (async () => {
            try {
                console.log(`[GlobalSpoof] Connecting to Chrome CDP on port ${debugPort}...`);
                const client = await connectCDP(debugPort);
                this.cdpClient = client;

                if (profileName && profileName.startsWith('profile_')) {
                    const checkEmailInterval = setInterval(async () => {
                        if (!this.isHijacking || !client) {
                            clearInterval(checkEmailInterval);
                            return;
                        }
                        try {
                            const response = await client.Runtime.evaluate({
                                expression: `(function() {
  try {
    const isEmail = (str) => {
      if (!str) return false;
      return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$/.test(str.trim());
    };
    let signOutBtn = document.querySelector('a[href*="SignOutOptions"]');
    if (signOutBtn) {
      let label = signOutBtn.getAttribute('aria-label') || '';
      let match = label.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}/);
      if (match && isEmail(match[0])) return match[0];
    }
    let dataEmailEl = document.querySelector('[data-email]');
    if (dataEmailEl) {
      let email = dataEmailEl.getAttribute('data-email');
      if (isEmail(email)) return email;
    }
    let emailInput = document.querySelector('input[type="email"], input[name="identifier"], input[id*="email" i], input[name*="email" i]');
    if (emailInput && emailInput.value && isEmail(emailInput.value)) {
      return emailInput.value;
    }
    let profileHeader = document.querySelector('div[aria-label*="@"], div[title*="@"]');
    if (profileHeader) {
      let val = profileHeader.getAttribute('aria-label') || profileHeader.getAttribute('title') || '';
      let match = val.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}/);
      if (match && isEmail(match[0])) return match[0];
    }
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
})()`,
                                returnByValue: true
                            });
                            const detectedEmail = response.result?.value;
                            if (detectedEmail && typeof detectedEmail === 'string' && detectedEmail.trim()) {
                                const trimmed = detectedEmail.trim();
                                if (this.browserFarmService) {
                                    const idx = this.browserFarmService.profiles.findIndex(p => p.id === profileName);
                                    if (idx !== -1 && this.browserFarmService.profiles[idx].email !== trimmed) {
                                        this.browserFarmService.profiles[idx].email = trimmed;
                                        this.browserFarmService._saveProfiles();
                                        console.log(`[GlobalSpoof] Detected email and saved: ${trimmed}`);
                                        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                                            this.mainWindow.webContents.send('farm:profile-update', {
                                                profileId: profileName,
                                                email: trimmed,
                                                status: 'idle'
                                            });
                                        }
                                    }
                                } else {
                                    let farmProfiles = [];
                                    if (fs.existsSync(pPath)) {
                                        try { farmProfiles = JSON.parse(fs.readFileSync(pPath, 'utf8')); } catch(e) {}
                                    }
                                    const idx = farmProfiles.findIndex(p => p.id === profileName);
                                    if (idx !== -1 && farmProfiles[idx].email !== trimmed) {
                                        farmProfiles[idx].email = trimmed;
                                        fs.writeFileSync(pPath, JSON.stringify(farmProfiles, null, 2));
                                        console.log(`[GlobalSpoof] Detected email and saved directly: ${trimmed}`);
                                        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                                            this.mainWindow.webContents.send('farm:profile-update', {
                                                profileId: profileName,
                                                email: trimmed,
                                                status: 'idle'
                                            });
                                        }
                                    }
                                }
                            }
                        } catch (err) {
                        }
                    }, 5000);
                    this.checkEmailInterval = checkEmailInterval;
                }

                client.on('disconnect', () => {
                    console.log('[GlobalSpoof] Chrome CDP disconnected. Stopping hijack.');
                    this.stopHijack();
                });

                if (proxyUser && proxyPass) {
                    console.log('[GlobalSpoof] Setting up proxy auth handlers for credentials:', proxyUser);
                    client.Fetch.authRequired(async (params, sessionId) => {
                        console.log('[GlobalSpoof] Proxy Auth required for session:', sessionId);
                        try {
                            await client.send('Fetch.continueWithAuth', {
                                requestId: params.requestId,
                                authChallengeResponse: {
                                    response: 'ProvideCredentials',
                                    username: proxyUser,
                                    password: proxyPass
                                }
                            }, sessionId);
                        } catch (err) {
                            console.error('[GlobalSpoof] Fetch.continueWithAuth error:', err.message);
                        }
                    });

                    client.Fetch.requestPaused(async (params, sessionId) => {
                        try {
                            await client.send('Fetch.continueRequest', {
                                requestId: params.requestId
                            }, sessionId);
                        } catch (err) {
                            console.error('[GlobalSpoof] Fetch.continueRequest error:', err.message);
                        }
                    });
                }

                const userAgent = (isMobile && device.ua) ? device.ua : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
                const platform = isMobile ? (device.id.includes('iphone') ? 'iPhone' : 'Linux armv8l') : 'Win32';
                const platformVersion = isMobile ? '16.0.0' : '10.0.0';

                try {
                    await client.Browser.grantPermissions({ permissions: ['geolocation'] });
                } catch (pe) {}

                client.on('Target.attachedToTarget', async (params) => {
                    const { sessionId, targetInfo, waitingForDebugger } = params;
                    if (targetInfo.type === 'page' || targetInfo.type === 'iframe') {
                        this.activeSessions.add(sessionId);
                        try {
                            if (proxyUser && proxyPass) {
                                try {
                                    await client.send('Fetch.enable', {
                                        patterns: [{ requestStage: 'Request' }]
                                    }, sessionId);
                                } catch (fetchErr) {
                                    console.error('[GlobalSpoof] Fetch.enable error:', fetchErr.message);
                                }
                            }

                            await client.send('Network.enable', {}, sessionId);
                            await client.send('Network.setUserAgentOverride', {
                                userAgent: userAgent,
                                acceptLanguage: tAcceptLang,
                                platform: platform,
                                userAgentMetadata: {
                                    architecture: isMobile ? 'arm' : 'x86',
                                    bitness: '64',
                                    mobile: isMobile,
                                    model: isMobile ? 'iPhone' : '',
                                    platform: platform,
                                    platformVersion: platformVersion
                                }
                            }, sessionId);

                            await client.send('Emulation.setTimezoneOverride', { timezoneId: tTimezone }, sessionId);
                            await client.send('Emulation.setGeolocationOverride', { latitude: tLat, longitude: tLng, accuracy: 15 }, sessionId);

                            const disfarcada = await prepararPagina(client, sessionId, deepHijackScript);

                            if (targetInfo.type === 'page' && isMobile) {
                                try {
                                    await client.send('Emulation.setDeviceMetricsOverride', {
                                        width: 0,
                                        height: 0,
                                        deviceScaleFactor: device.dpr || 3,
                                        mobile: true,
                                        screenOrientation: { angle: 0, type: 'portraitPrimary' }
                                    }, sessionId);
                                    await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 10 }, sessionId);
                                } catch (emErr) {}
                            }

                            if (waitingForDebugger) {
                                await client.send('Runtime.runIfWaitingForDebugger', {}, sessionId);
                            }
                            if (disfarcada) await abrirUrlPedida(client, sessionId, targetInfo, targetUrl);
                        } catch (err) {
                            if (waitingForDebugger) {
                                try { await client.send('Runtime.runIfWaitingForDebugger', {}, sessionId); } catch (_) {}
                            }
                        }
                    } else {
                        if (waitingForDebugger) {
                            try { await client.send('Runtime.runIfWaitingForDebugger', {}, sessionId); } catch (_) {}
                        }
                    }
                });

                client.on('Target.detachedFromTarget', (params) => {
                    this.activeSessions.delete(params.sessionId);
                });

                await client.Target.setAutoAttach({ autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
                console.log('[GlobalSpoof] CDP Auto-Attach activated browser-wide.');

            } catch (e) {
                console.log('[GlobalSpoof] CDP Integration Error:', e.message);
            }
        })();

        this.isHijacking      = true;
        this.activeMode       = 'chrome-y4m';
        this.activeDeviceName = 'Chrome Y4M Injector';

        this._emitStatus();
        console.log(`[GlobalSpoof] Chrome launched PID=${this.chromePid}`);

        return {
            success: true,
            mode: 'chrome-y4m',
            deviceName: 'Chrome Y4M Injector',
            message: 'Chrome alterado aberto! A câmera agora usa o vídeo Y4M como fonte nativa.',
        };
    }

    async stopHijack() {
        if (!this.isHijacking) {
            return { success: true, message: 'Não ativo.' };
        }

        console.log('[GlobalSpoof] Stopping Chrome Y4M Hijack...');

        if (this.checkEmailInterval) {
            clearInterval(this.checkEmailInterval);
            this.checkEmailInterval = null;
        }

        if (this.chromePid) {
            try {
                encerrarChrome(spawn, this.chromePid);
            } catch (_) {}
            this.chromePid     = null;
            this.chromeProcess = null;
        }

        if (this.ffplayProcess) {
            try {
                this.ffplayProcess.kill();
                console.log('[GlobalSpoof] Local audio playback stopped.');
            } catch (_) {}
            this.ffplayProcess = null;
        }

        if (this.cdpClient) {
            try {
                this.cdpClient.close();
            } catch (_) {}
            this.cdpClient = null;
        }

        try {
            if (fs.existsSync(this.y4mPath)) fs.unlinkSync(this.y4mPath);
        } catch (_) {}

        this.activeSessions.clear();
        this.isHijacking      = false;
        this.activeMode       = null;
        this.activeDeviceName = null;

        this._emitStatus();
        return { success: true, message: 'Sequestro Y4M do Chrome parado. Arquivo Y4M excluído.' };
    }

    listProfiles() {
        const pPath = path.join(this.app.getPath('userData'), 'farm_profiles.json');
        if (!fs.existsSync(pPath)) {
            return [{ id: 'Default', name: 'Default', email: '', platform: 'windows', proxy: '' }];
        }
        try {
            const list = JSON.parse(fs.readFileSync(pPath, 'utf8'));
            const mapped = list.map(item => ({
                id: item.id,
                name: item.name,
                email: item.email || '',
                platform: item.platform || 'android',
                proxy: item.proxy || '',
                anonymityScore: item.anonymityScore || 75
            }));
            return [{ id: 'Default', name: 'Default', email: '', platform: 'windows', proxy: '' }, ...mapped];
        } catch (e) {
            return [{ id: 'Default', name: 'Default', email: '', platform: 'windows', proxy: '' }];
        }
    }

    _generateY4M(inputPath, rotateDeg = 0, deviceRes = '1080,1920') {
        return new Promise((resolve, reject) => {
            const w = 1080;
            const h = 1920;
            const wScale = Math.floor(w * 0.75);
            const hScale = Math.floor(h * 0.75);
            
            let rotFilter = '';
            if (rotateDeg === 90) {
                rotFilter = 'transpose=1,';
            } else if (rotateDeg === 180) {
                rotFilter = 'transpose=1,transpose=1,';
            } else if (rotateDeg === 270) {
                rotFilter = 'transpose=2,';
            }
            
            let vfChain = `${rotFilter}setpts='(RTCTIME - RTCSTART) / (TB * 1000000)',split[original][copy];[copy]scale=${w}:${h}:flags=lanczos:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=20:20[blurred];[original]scale=${wScale}:${hScale}:flags=lanczos:force_original_aspect_ratio=increase,crop=${wScale}:${hScale},eq=brightness=0.15:contrast=1.1[fg];[blurred][fg]overlay=(W-w)/2:(H-h)/2,unsharp=5:5:1.0:5:5:0.0`;

            const args = [
                '-y',
                '-i', inputPath,
                '-f', 'yuv4mpegpipe',
                '-c:v', 'rawvideo',
                '-pix_fmt', 'yuv420p',
                '-crf', '0',
                '-b:v', '20000k',
                '-minrate', '12000k',
                '-maxrate', '20000k',
                '-bufsize', '20000k',
                '-colorspace', 'bt709',
                '-color_primaries', 'bt709',
                '-r', '29.97',
                '-vf', `${vfChain},format=yuv420p`,
                '-sws_flags', 'lanczos',
                '-map_metadata', '-1',
                '-fflags', '+bitexact',
                '-flags:v', '+bitexact',
                '-metadata', 'creation_time="now"',
                this.y4mPath,
            ];

            console.log('[GlobalSpoof] FFmpeg Y4M args:', args.join(' '));

            this.ffmpegProcess = spawn(this.ffmpegPath, args, {
                windowsHide: true,
                stdio: ['ignore', 'pipe', 'pipe'],
            });

            let stderr = '';
            this.ffmpegProcess.stderr.on('data', d => { stderr += d.toString(); });

            this.ffmpegProcess.on('close', code => {
                this.ffmpegProcess = null;
                if (code === 0) {
                    console.log(`[GlobalSpoof] Y4M generated: ${this.y4mPath}`);
                    resolve();
                } else {
                    reject(new Error(`FFmpeg exited ${code}: ${stderr.slice(-400)}`));
                }
            });

            this.ffmpegProcess.on('error', err => {
                this.ffmpegProcess = null;
                reject(new Error(`FFmpeg spawn error: ${err.message}`));
            });
        });
    }

    _findChrome(browserChoice = 'chrome') {
        if (process.platform === "darwin") {
            return require('./mac-native').browser(browserChoice);
        }

        let resolvedPath = null;
        if (this.browserFarmService) {
            if (browserChoice === 'chrome') {
                resolvedPath = this.browserFarmService.getChromeExecutablePath();
            } else if (browserChoice === 'brave') {
                resolvedPath = this.browserFarmService.getBraveExecutablePath();
            } else if (browserChoice === 'vivaldi') {
                resolvedPath = this.browserFarmService.getVivaldiExecutablePath();
            } else if (browserChoice === 'firefox') {
                resolvedPath = this.browserFarmService.getFirefoxExecutablePath();
            }
            if (resolvedPath && fs.existsSync(resolvedPath)) {
                return resolvedPath;
            }
        }

        const isPackaged = this.app ? this.app.isPackaged : false;
        const baseBrowsersPath = isPackaged
            ? path.join(process.resourcesPath, 'browsers')
            : path.join(process.cwd(), 'browsers');

        let searchPaths = [];
        if (browserChoice === 'chrome') {
            searchPaths = [
                path.join(baseBrowsersPath, 'chrome', 'chrome.exe'),
                'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
                'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
                path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'),
                findBundledChromiumExecutable([baseBrowsersPath]),
            ];
        } else if (browserChoice === 'brave') {
            searchPaths = [
                path.join(baseBrowsersPath, 'brave', 'brave.exe'),
                'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
                'C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
                path.join(os.homedir(), 'AppData\\Local\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'),
            ];
        } else if (browserChoice === 'vivaldi') {
            searchPaths = [
                path.join(baseBrowsersPath, 'vivaldi', 'vivaldi.exe'),
                path.join(os.homedir(), 'AppData\\Local\\Vivaldi\\Application\\vivaldi.exe'),
                'C:\\Program Files\\Vivaldi\\Application\\vivaldi.exe',
                'C:\\Program Files (x86)\\Vivaldi\\Application\\vivaldi.exe'
            ];
        } else if (browserChoice === 'firefox') {
            searchPaths = [
                path.join(baseBrowsersPath, 'firefox', 'firefox.exe'),
                'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
                'C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe',
                path.join(os.homedir(), 'AppData\\Local\\Mozilla Firefox\\firefox.exe'),
            ];
        }

        const doNavegadorPedido = primeiroCaminhoExistente(searchPaths);
        if (doNavegadorPedido) return doNavegadorPedido;

        const fallbackOrders = ['chrome', 'brave', 'vivaldi', 'firefox'];
        for (const fb of fallbackOrders) {
            if (fb === browserChoice) continue;
            let fbPath = null;
            if (this.browserFarmService) {
                if (fb === 'chrome') fbPath = this.browserFarmService.getChromeExecutablePath();
                else if (fb === 'brave') fbPath = this.browserFarmService.getBraveExecutablePath();
                else if (fb === 'vivaldi') fbPath = this.browserFarmService.getVivaldiExecutablePath();
                else if (fb === 'firefox') fbPath = this.browserFarmService.getFirefoxExecutablePath();
            }
            if (fbPath && fs.existsSync(fbPath)) return fbPath;

            let fbPaths = [];
            if (fb === 'chrome') {
                fbPaths = [
                    path.join(baseBrowsersPath, 'chrome', 'chrome.exe'),
                    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
                    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
                    path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'),
                    findBundledChromiumExecutable([baseBrowsersPath]),
                ];
            } else if (fb === 'brave') {
                fbPaths = [
                    path.join(baseBrowsersPath, 'brave', 'brave.exe'),
                    'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
                    'C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
                    path.join(os.homedir(), 'AppData\\Local\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'),
                ];
            } else if (fb === 'vivaldi') {
                fbPaths = [
                    path.join(baseBrowsersPath, 'vivaldi', 'vivaldi.exe'),
                    path.join(os.homedir(), 'AppData\\Local\\Vivaldi\\Application\\vivaldi.exe'),
                    'C:\\Program Files\\Vivaldi\\Application\\vivaldi.exe',
                    'C:\\Program Files (x86)\\Vivaldi\\Application\\vivaldi.exe'
                ];
            } else if (fb === 'firefox') {
                fbPaths = [
                    path.join(baseBrowsersPath, 'firefox', 'firefox.exe'),
                    'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
                    'C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe',
                    path.join(os.homedir(), 'AppData\\Local\\Mozilla Firefox\\firefox.exe'),
                ];
            }
            const doAlternativo = primeiroCaminhoExistente(fbPaths);
            if (doAlternativo) return doAlternativo;
        }

        return null;
    }

    async spoofRegistryName() {
        return { success: true, message: 'Falsificação de registro não necessária no modo Y4M do Chrome.' };
    }

    async revertRegistryName() { }
    async installOBSVirtualCam() {
        return { success: false, message: 'Driver OBS não necessário. Usando modo Y4M do Chrome.' };
    }

    async broadcastTransform(zoom, rotate, mirror) {
    }

    async updateRegional(regional) {
        this.currentRegional = regional;
        return { success: true };
    }

    writeChunk(buffer) {
    }

    _emitStatus() {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('virtual-cam:status', {
                isActive:     this.isHijacking,
                mode:         this.activeMode,
                deviceName:   this.activeDeviceName,
                pid:          this.chromePid,
            });
        }
    }

    _emitInstallStatus(phase, message, progress) {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('virtual-cam:install-progress', {
                phase, message, progress,
            });
        }
    }

    _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    getStatus() {
        return {
            isActive:           this.isHijacking,
            mode:               this.activeMode,
            deviceName:         this.activeDeviceName,
            pid:                this.chromePid,
            isInstallingDriver: this.isInstallingDriver,
        };
    }
}

module.exports = GlobalSpoofService;
