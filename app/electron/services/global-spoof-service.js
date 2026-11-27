'use strict';

const { spawn } = require('child_process');
const toolPaths = require('./tool-paths');
const path  = require('path');
const fs    = require('fs');
const crypto = require('crypto');
const os    = require('os');
const { findBundledChromiumExecutable, primeiroCaminhoExistente } = require('./platform-utils');
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
            } else try {
                execSync('wmic process where "name=\'chrome.exe\' and CommandLine like \'%nova_webcam_hijack%\'" call terminate', { stdio: 'ignore', timeout: 3000 });
                console.log('[GlobalSpoof] Cleaned up orphaned Nova Chrome instances via WMIC.');
            } catch (wmicErr) {
                const cleanupCmd = `Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" | Where-Object { $_.CommandLine -like "*nova_webcam_hijack*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`;
                execSync(`powershell -NoProfile -Command "${cleanupCmd}"`, { stdio: 'ignore', timeout: 5000 });
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
        let tTimezone   = regional.timezone    || 'Asia/Dubai';
        let tLat        = (regional.lat        !== undefined) ? regional.lat : 25.2048;
        let tLng        = (regional.lng        !== undefined) ? regional.lng : 55.2708;
        let tLocale     = regional.language    || 'en-AE';

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

        chromeArgs.push(targetUrl || 'about:blank');

        let audioFile = settings.audioPath;
        if (!audioFile) {
            audioFile = path.join(this.tempDir, 'room_ambience.wav');
            if (!fs.existsSync(audioFile)) {
                const audioArgs = [
                    '-f', 'lavfi', '-i', 'anoisesrc=a=0.01:c=white:r=48000', 
                    '-t', '15', '-ac', '1', '-ar', '48000', audioFile
                ];
                spawn(this.ffmpegPath, audioArgs, { windowsHide: true }).on('close', () => {
                    console.log('[GlobalSpoof] Ambient audio file generated.');
                });
            }
        }

        if (audioFile && fs.existsSync(audioFile)) {
            chromeArgs.push(`--use-file-for-fake-audio-capture=${audioFile}`);
            try {
                const psCommand = `$wmp = New-Object -ComObject wmplayer.ocx; $wmp.URL = '${settings.audioPath.replace(/'/g, "''")}'; $wmp.settings.setMode('loop', $true); $wmp.controls.play(); while($wmp.playState -ne 1){ Start-Sleep -Seconds 1 }`;
                this.ffplayProcess = process.platform === 'darwin' ? spawn('/usr/bin/afplay', [audioFile]) : spawn('powershell', ['-WindowStyle', 'Hidden', '-Command', psCommand], {
                    windowsHide: true,
                    detached: false,
                    stdio: 'ignore'
                });
                this.ffplayProcess.on('error', () => {});
            } catch (err) {}
        }

        const crypto = require('crypto');
        const randDeviceId = crypto.randomBytes(32).toString('hex');
        const randGroupId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
        const _dStr = JSON.stringify(device);
        const _wStr = winW;
        const _hStr = winH;
        const _cWStr = camW;
        const _cHStr = camH;
        const _mStr = isMobile;

        const _canvasNoise = activeProfile ? activeProfile.canvasNoise !== false : true;
        const _webglNoise = activeProfile ? activeProfile.webglNoise !== false : true;
        const _audioNoise = activeProfile ? activeProfile.audioNoise !== false : true;
        const _webglImageNoise = activeProfile ? activeProfile.webglImageNoise !== false : true;
        const _clientRectsNoise = activeProfile ? activeProfile.clientRectsNoise !== false : true;
        const _speechVoicesNoise = activeProfile ? activeProfile.speechVoicesNoise !== false : true;
        
        const _platformStr = (activeProfile ? activeProfile.platformStr : null) || (isMobile ? (device.id && device.id.includes('iphone') ? 'iPhone' : 'Linux armv8l') : 'Win32');
        const _cpuCores = (activeProfile && activeProfile.cpuCores && activeProfile.cpuCores !== 'Auto') ? parseInt(activeProfile.cpuCores) : 8;
        const _ramSize = (activeProfile && activeProfile.ramSize && activeProfile.ramSize !== 'Auto') ? parseInt(activeProfile.ramSize) : 8;
        
        const _gpuVendor = (activeProfile ? activeProfile.webglVendor : null) || (isMobile ? (device.id && device.id.includes('iphone') ? 'Apple Inc.' : 'Google Inc. (Qualcomm)') : 'Google Inc. (NVIDIA)');
        const _gpuRenderer = (activeProfile ? activeProfile.webglRenderer : null) || (isMobile ? (device.id && device.id.includes('iphone') ? 'Apple GPU' : 'Adreno (TM) 750') : 'NVIDIA GeForce RTX 3060');

        const _doNotTrack = activeProfile ? activeProfile.doNotTrack : 'default';
        const _portScanProtection = activeProfile ? activeProfile.portScanProtection : 'enable';

        const deepHijackScript = `
console.log("[Nova] CDP Stealth Injector Initializing (MAIN World)...");
try {
  for (let prop in window) {
    if (typeof prop === 'string' && prop.match(/cdc_[a-zA-Z0-9]+_/)) {
      try { delete window[prop]; } catch(e) {}
    }
  }
} catch(e) {}

try {
  const ogGetOwnPropertyNames = Object.getOwnPropertyNames;
  Object.getOwnPropertyNames = function(obj) {
    const names = ogGetOwnPropertyNames(obj);
    return names.filter(n => typeof n !== 'string' || !n.match(/cdc_[a-zA-Z0-9]+_/));
  };
} catch(e) {}

try {
  Object.defineProperty(Object.getPrototypeOf(navigator), 'webdriver', {
    get: () => false,
    configurable: true,
    enumerable: true
  });
} catch(e) {}

try { delete window.vivaldi; } catch(e) {}
try { delete window.Brave; } catch(e) {}
try { if (navigator.brave) delete navigator.brave; } catch(e) {}

try {
  const observer = new MutationObserver((mutations) => {
    for (let m of mutations) {
      for (let node of m.addedNodes) {
        if (node.id && typeof node.id === 'string' && node.id.includes('vivaldi')) {
          try { node.remove(); } catch(e) {}
        }
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
} catch(e) {}
var _canvasNoise = ${_canvasNoise};
var _webglNoise = ${_webglNoise};
var _audioNoise = ${_audioNoise};
var _webglImageNoise = ${_webglImageNoise};
var _clientRectsNoise = ${_clientRectsNoise};
var _speechVoicesNoise = ${_speechVoicesNoise};
var _platformStr = "${_platformStr.replace(/"/g,'\\"')}";
var _cpuCores = ${_cpuCores};
var _ramSize = ${_ramSize};
var _gpuVendor = "${_gpuVendor.replace(/"/g,'\\"')}";
var _gpuRenderer = "${_gpuRenderer.replace(/"/g,'\\"')}";
var _doNotTrack = "${_doNotTrack}";
var _portScanProtection = "${_portScanProtection}";
var _canvasNoiseSeed = ${activeProfile.canvasNoiseSeed || 42};
var _webglNoiseSeed = ${activeProfile.webglNoiseSeed || 88};
var _audioNoiseSeed = ${activeProfile.audioNoiseSeed || 0.0000001};
var _virtualCamId = "${activeProfile.virtualCamId || 'mock_cam_id'}";
var _virtualCamLabel = "${(activeProfile.virtualCamLabel || 'HD Camera').replace(/"/g,'\\"')}";
var _virtualMicId = "${activeProfile.virtualMicId || 'mock_mic_id'}";
var _virtualMicLabel = "${(activeProfile.virtualMicLabel || 'Microphone').replace(/"/g,'\\"')}";
var _virtualSpeakerId = "${activeProfile.virtualSpeakerId || 'mock_speaker_id'}";
var _virtualSpeakerLabel = "${(activeProfile.virtualSpeakerLabel || 'Speakers').replace(/"/g,'\\"')}";

var _tTimezone = "${tTimezone.replace(/"/g,'\\"')}";
var _tOffset = ${tOffset};
var _tLat = ${tLat};
var _tLng = ${tLng};
var _tIP = "${tIP}";
var _tISP = "${tISP.replace(/"/g,'\\"')}";
var _tOrg = "${tOrg.replace(/"/g,'\\"')}";
var _tASN = "${tASN}";
var _tCountry = "${tCountry.replace(/"/g,'\\"')}";
var _tCC = "${tCC}";
var _tRegion = "${tRegion.replace(/"/g,'\\"')}";
var _tCity = "${tCity.replace(/"/g,'\\"')}";
var _tGMT = "${tGMT.replace(/"/g,'\\"')}";
var _tLocale = "${tLocale}";
var _tLocales = ${JSON.stringify(tLocales)};
var _d = ${_dStr};
var _w = ${_wStr};
var _h = ${_hStr};
var _cW = ${_cWStr};
var _cH = ${_cHStr};
var _m = ${_mStr};
var _devId = "${randDeviceId}";
var _grpId = "${randGroupId}";
var _isIOS = (_d.id && _d.id.indexOf("iphone") !== -1) || (navigator.userAgent && (navigator.userAgent.indexOf("iPhone") !== -1 || navigator.userAgent.indexOf("iPad") !== -1));
var _lbl = _isIOS ? "iPhone Front Camera" : "FaceTime HD Camera";

function applyStealth(win) {
  if (!win || win.__nova_stealth_applied) return;
  win.__nova_stealth_applied = true;

  // Stealth: Mask Function.prototype.toString
  try {
    if (!win.__nova_toString_hooked) {
      win.__nova_toString_hooked = true;
      var originalToString = win.Function.prototype.toString;
      win.Function.prototype.toString = function toString() {
        if (this === win.Function.prototype.toString) return "function toString() { [native code] }";
        var res = originalToString.call(this);
        if (res.indexOf('[native code]') === -1 && this.name) {
          var stealthNames = ['enumerateDevices', 'getUserMedia', 'getParameter', 'getCurrentPosition', 'readPixels', 'getChannelData', 'getBoundingClientRect', 'getVoices', 'getSettings', 'getCapabilities', 'watchPosition', 'getImageData', 'toDataURL', 'createOscillator', 'fetch', 'open', 'getTimezoneOffset', 'resolvedOptions'];
          if (stealthNames.includes(this.name) || this.name.startsWith('get') || this.name.startsWith('set')) return "function " + this.name + "() { [native code] }";
        }
        return res;
      };
      Object.defineProperty(win.Function.prototype.toString, 'name', { value: 'toString' });
    }
  } catch(e) {}

  // Proxy window.frames
  try {
    var framesProxy = new Proxy(win, {
      get: function(target, prop, receiver) {
        if (typeof prop === 'string' && /^\d+$/.test(prop)) {
          var res = target[prop];
          if (res) { try { applyStealth(res); } catch(e){} }
          return res;
        }
        var res = target[prop];
        if (typeof res === 'function') { return res.bind(target); }
        return res;
      }
    });
    Object.defineProperty(win, 'frames', { get: function() { return framesProxy; }, configurable: true });
  } catch(e) {}
  
  // Timezone & Date Overrides
  try {
    var targetTimezone = _tTimezone;
    var targetOffset = _tOffset;
    var targetLocale = _tLocale;
    var targetLocales = _tLocales;

    var orgDTF = win.Intl.DateTimeFormat;
    var orgResolvedOptions = orgDTF.prototype.resolvedOptions;
    orgDTF.prototype.resolvedOptions = function() {
      var res = orgResolvedOptions.apply(this, arguments);
      res.timeZone = targetTimezone;
      res.locale = targetLocale;
      return res;
    };

    win.Intl.DateTimeFormat = function(locales, options) {
      var resolvedLocales = locales || targetLocales;
      var resolvedOptions = Object.assign({}, options);
      if (!resolvedOptions.timeZone) resolvedOptions.timeZone = targetTimezone;
      return new orgDTF(resolvedLocales, resolvedOptions);
    };
    win.Intl.DateTimeFormat.prototype = orgDTF.prototype;
    win.Intl.DateTimeFormat.supportedLocalesOf = orgDTF.supportedLocalesOf;

    var orgDate = win.Date;
    var orgGetTimezoneOffset = orgDate.prototype.getTimezoneOffset;
    orgDate.prototype.getTimezoneOffset = function() { return targetOffset; };

    var getShiftedDate = function(dateInst) {
      var systemOffset = orgGetTimezoneOffset.call(dateInst);
      var diffMin = systemOffset - targetOffset;
      return new orgDate(dateInst.getTime() + diffMin * 60000);
    };

    var localGetMethods = ['getDate', 'getDay', 'getFullYear', 'getHours', 'getMilliseconds', 'getMinutes', 'getMonth', 'getSeconds'];
    localGetMethods.forEach(function(m) {
      var utcMethod = m.replace('get', 'getUTC');
      orgDate.prototype[m] = function() { return getShiftedDate(this)[utcMethod](); };
    });

    var localSetMethods = ['setDate', 'setFullYear', 'setHours', 'setMilliseconds', 'setMinutes', 'setMonth', 'setSeconds'];
    localSetMethods.forEach(function(m) {
      var utcMethod = m.replace('set', 'setUTC');
      orgDate.prototype[m] = function() {
        var shifted = getShiftedDate(this);
        var res = shifted[utcMethod].apply(shifted, arguments);
        var systemOffset = orgGetTimezoneOffset.call(this);
        var diffMin = systemOffset - targetOffset;
        this.setTime(shifted.getTime() - diffMin * 60000);
        return res;
      };
    });

    orgDate.prototype.toString = function() {
      var opt = { weekday: 'short', year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: targetTimezone };
      var dtf = new orgDTF(targetLocale, opt);
      var parts = dtf.formatToParts(this);
      var p = {};
      parts.forEach(function(x) { p[x.type] = x.value; });
      return p.weekday + " " + p.month + " " + p.day + " " + p.year + " " + p.hour + ":" + p.minute + ":" + p.second + " " + _tGMT;
    };

    orgDate.prototype.toTimeString = function() {
      var dtf = new orgDTF(targetLocale, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: targetTimezone });
      return dtf.format(this) + " " + _tGMT;
    };

    orgDate.prototype.toDateString = function() {
      return new orgDTF(targetLocale, { weekday: 'short', year: 'numeric', month: 'short', day: '2-digit', timeZone: targetTimezone }).format(this);
    };
  } catch(e) {}

  // Geolocation API Override
  try {
    if (win.navigator.geolocation) {
      win.navigator.geolocation.getCurrentPosition = function(success) {
        if (typeof success === 'function') {
          setTimeout(function() {
            success({ coords: { latitude: _tLat, longitude: _tLng, accuracy: 15, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: Date.now() });
          }, 10);
        }
      };
      win.navigator.geolocation.watchPosition = function(success) {
        if (typeof success === 'function') {
          var trigger = function() {
            success({ coords: { latitude: _tLat, longitude: _tLng, accuracy: 15, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: Date.now() });
          };
          trigger();
          return setInterval(trigger, 5000);
        }
        return 0;
      };
    }
  } catch(e) {}

  // Navigator Properties
  try {
    var navProto = win.Navigator && win.Navigator.prototype ? win.Navigator.prototype : win.navigator;
    Object.defineProperty(navProto, "platform", { get: function() { return _platformStr; }, configurable: true });
    Object.defineProperty(navProto, "hardwareConcurrency", { get: function() { return _cpuCores; }, configurable: true });
    Object.defineProperty(navProto, "deviceMemory", { get: function() { return _ramSize; }, configurable: true });
    Object.defineProperty(navProto, "webdriver", { get: function() { return undefined; }, configurable: true });
    Object.defineProperty(navProto, "language", { get: function() { return _tLocale; }, configurable: true });
    Object.defineProperty(navProto, "languages", { get: function() { return _tLocales; }, configurable: true });
    if (_m) { Object.defineProperty(navProto, "maxTouchPoints", { get: function() { return 10; }, configurable: true }); }
  } catch(e) {}

  // WebGL GPU Spoof
  try {
    var gpuVendor = _gpuVendor;
    var gpuRenderer = _gpuRenderer;
    
    var spoofGL = function(proto) {
      if (!proto || !proto.getParameter) return;
      var _ogGetParam = proto.getParameter;
      Object.defineProperty(proto, 'getParameter', {
        value: function(p) {
          if (p === 37446 || p === 7937) return gpuRenderer;
          if (p === 37445 || p === 7936) return gpuVendor;
          return _ogGetParam.call(this, p);
        },
        writable: true, configurable: true
      });
    };
    if (win.WebGLRenderingContext) spoofGL(win.WebGLRenderingContext.prototype);
    if (win.WebGL2RenderingContext) spoofGL(win.WebGL2RenderingContext.prototype);
  } catch(e) {}

  // MediaStreamTrack Prototype Labels
  try {
    if (win.MediaStreamTrack) {
      var _ogSettings = win.MediaStreamTrack.prototype.getSettings;
      win.MediaStreamTrack.prototype.getSettings = function() {
        var s = _ogSettings.call(this) || {};
        if (this.kind === "video") {
          s.deviceId = _devId; s.groupId = _grpId; s.facingMode = "user"; s.width = _cW; s.height = _cH; s.frameRate = 30;
        }
        return s;
      };
      
      var _ogCaps = win.MediaStreamTrack.prototype.getCapabilities;
      if (_ogCaps) {
        win.MediaStreamTrack.prototype.getCapabilities = function() {
          var c = _ogCaps.call(this) || {};
          if (this.kind === "video") {
            c.facingMode = ["user"]; c.deviceId = _devId; c.groupId = _grpId;
            c.width = { max: _cW, min: 320 }; c.height = { max: _cH, min: 240 }; c.frameRate = { max: 30, min: 15 };
          }
          return c;
        };
      }

      Object.defineProperty(win.MediaStreamTrack.prototype, "label", {
        get: function() { return this.kind === "video" ? _lbl : "Microphone (High Definition Audio Device)"; },
        configurable: true
      });
      Object.defineProperty(win.MediaStreamTrack.prototype, "id", {
        get: function() { return this.kind === "video" ? _devId : "mock_audio_track_id"; },
        configurable: true
      });
    }
  } catch(e) {}

  // EnumerateDevices Hook (Maps Native IDs to Spoofed IDs)
  try {
    if (win.MediaDevices && win.MediaDevices.prototype.enumerateDevices) {
      var orgEnum = win.MediaDevices.prototype.enumerateDevices;
      win.MediaDevices.prototype.enumerateDevices = function enumerateDevices() {
        return orgEnum.call(this).then(function(devices) {
          return devices.map(function(d) {
            if (d.kind === "videoinput") {
              if (d.deviceId && d.deviceId !== _virtualCamId) {
                win.__nova_native_cam_id = d.deviceId;
              }
              try {
                Object.defineProperty(d, "label", { get: function() { return _virtualCamLabel; }, enumerable: true, configurable: true });
                Object.defineProperty(d, "deviceId", { get: function() { return _virtualCamId; }, enumerable: true, configurable: true });
                Object.defineProperty(d, "groupId", { get: function() { return _virtualCamId; }, enumerable: true, configurable: true });
              } catch(e) {}
            } else if (d.kind === "audioinput") {
              try {
                Object.defineProperty(d, "label", { get: function() { return _virtualMicLabel; }, enumerable: true, configurable: true });
                Object.defineProperty(d, "deviceId", { get: function() { return _virtualMicId; }, enumerable: true, configurable: true });
                Object.defineProperty(d, "groupId", { get: function() { return _virtualMicId; }, enumerable: true, configurable: true });
              } catch(e) {}
            } else if (d.kind === "audiooutput") {
              try {
                Object.defineProperty(d, "label", { get: function() { return _virtualSpeakerLabel; }, enumerable: true, configurable: true });
                Object.defineProperty(d, "deviceId", { get: function() { return _virtualSpeakerId; }, enumerable: true, configurable: true });
                Object.defineProperty(d, "groupId", { get: function() { return _virtualSpeakerId; }, enumerable: true, configurable: true });
              } catch(e) {}
            }
            return d;
          });
        });
      };
    }
  } catch(e) {}

  // getUserMedia Interceptor (Remaps constraints back to native IDs)
  try {
    var overrideGUM = function(constraints, _ogGUM) {
      if (!constraints) constraints = { video: true };
      console.log("[Nova] getUserMedia intercepted:", JSON.stringify(constraints));
      
      if (constraints.video) {
        var nativeId = win.__nova_native_cam_id;
        if (typeof constraints.video === 'object') {
          if (constraints.video.deviceId) {
            var requestedId = constraints.video.deviceId.exact || constraints.video.deviceId.ideal || constraints.video.deviceId;
            if (requestedId === _virtualCamId && nativeId) {
              if (constraints.video.deviceId.exact) constraints.video.deviceId.exact = nativeId;
              else if (constraints.video.deviceId.ideal) constraints.video.deviceId.ideal = nativeId;
              else constraints.video.deviceId = nativeId;
            } else {
              delete constraints.video.deviceId;
            }
          }
        } else {
          // If true, keep it true so it defaults to the single native fake camera
          if (nativeId) {
            constraints.video = { deviceId: { exact: nativeId } };
          }
        }
      }
      return _ogGUM(constraints);
    };

    if (win.MediaDevices && win.MediaDevices.prototype.getUserMedia) {
      var _ogM = win.MediaDevices.prototype.getUserMedia;
      win.MediaDevices.prototype.getUserMedia = function getUserMedia(c) { return overrideGUM(c, _ogM.bind(this)); };
    }
    if (win.navigator.mediaDevices && win.navigator.mediaDevices.getUserMedia) {
      var _ogM2 = win.navigator.mediaDevices.getUserMedia;
      win.navigator.mediaDevices.getUserMedia = function getUserMedia(c) { return overrideGUM(c, _ogM2.bind(win.navigator.mediaDevices)); };
    }
  } catch(err) {}

  // Canvas Noise Injection
  try {
    if (_canvasNoise) {
      var spoofCanvas = function(proto) {
        var ogToDataURL = proto.toDataURL;
        proto.toDataURL = function() {
          var ctx = this.getContext('2d');
          if (ctx) {
            var ogFillText = ctx.fillText;
            ctx.fillText = function() {
              ctx.fillStyle = 'rgba(0,0,0,0.01)';
              ogFillText.apply(this, arguments);
            };
          }
          return ogToDataURL.apply(this, arguments);
        };
        
        var ogGetImageData = proto.getContext ? HTMLCanvasElement.prototype.getContext : null;
        if (win.CanvasRenderingContext2D) {
          var ogGetImg = win.CanvasRenderingContext2D.prototype.getImageData;
          win.CanvasRenderingContext2D.prototype.getImageData = function(x, y, w, h) {
            var res = ogGetImg.apply(this, arguments);
            if (res && res.data) {
              var seed = _canvasNoiseSeed || 42;
              for (var i = 0; i < res.data.length; i += 4) {
                res.data[i] = (res.data[i] + ((i + seed) % 3)) % 256;
              }
            }
            return res;
          };
        }
      };
      spoofCanvas(win.HTMLCanvasElement.prototype);
    }
  } catch(e) {}

  // WebGL Image Noise
  try {
    if (_webglImageNoise && win.WebGLRenderingContext) {
      var ogReadPixels = win.WebGLRenderingContext.prototype.readPixels;
      win.WebGLRenderingContext.prototype.readPixels = function(x, y, w, h, format, type, pixels) {
        ogReadPixels.apply(this, arguments);
        if (pixels && pixels.length > 0) {
          var seed = _webglNoiseSeed || 88;
          for (var i = 0; i < Math.min(pixels.length, 100); i++) {
            pixels[i] = (pixels[i] + ((i + seed) % 3)) % 256;
          }
        }
      };
    }
    if (_webglImageNoise && win.WebGL2RenderingContext) {
      var ogReadPixels2 = win.WebGL2RenderingContext.prototype.readPixels;
      win.WebGL2RenderingContext.prototype.readPixels = function(x, y, w, h, format, type, pixels) {
        ogReadPixels2.apply(this, arguments);
        if (pixels && pixels.length > 0) {
          var seed = _webglNoiseSeed || 88;
          for (var i = 0; i < Math.min(pixels.length, 100); i++) {
            pixels[i] = (pixels[i] + ((i + seed) % 3)) % 256;
          }
        }
      };
    }
  } catch(e) {}

  // ClientRects Noise Injection
  try {
    if (_clientRectsNoise) {
      var spoofRects = function(proto, name) {
        if (!proto || !proto[name]) return;
        var og = proto[name];
        proto[name] = function() {
          var res = og.apply(this, arguments);
          if (res && typeof res.width === 'number') {
            var factor = 0.0001 * (Math.random() - 0.5);
            Object.defineProperty(res, 'width', { get: function() { return res.width + factor; }, configurable: true });
            Object.defineProperty(res, 'height', { get: function() { return res.height + factor; }, configurable: true });
          }
          return res;
        };
      };
      spoofRects(win.Element.prototype, 'getBoundingClientRect');
    }
  } catch(e) {}

  // Audio Context Noise
  try {
    if (_audioNoise) {
      if (win.BaseAudioContext && win.BaseAudioContext.prototype.createOscillator) {
        var ogCreateOscillator = win.BaseAudioContext.prototype.createOscillator;
        win.BaseAudioContext.prototype.createOscillator = function() {
          var osc = ogCreateOscillator.apply(this, arguments);
          var ogFrequency = osc.frequency.value;
          var offset = (_audioNoiseSeed || 0.0000001) * 1000;
          Object.defineProperty(osc.frequency, 'value', {
            get: function() { return ogFrequency + offset; },
            set: function(val) { ogFrequency = val; },
            configurable: true
          });
          return osc;
        };
      }
      if (win.AudioBuffer) {
        var ogGetChannelData = win.AudioBuffer.prototype.getChannelData;
        var seed = _audioNoiseSeed || 0.0000001;
        win.AudioBuffer.prototype.getChannelData = function(channel) {
          var data = ogGetChannelData.apply(this, arguments);
          if (data && data.length > 0) {
            for (var i = 0; i < Math.min(data.length, 50); i++) {
              data[i] += seed * ((i % 3) - 1);
            }
          }
          return data;
        };
      }
    }
  } catch(e) {}

  // SpeechVoices Noise
  try {
    if (_speechVoicesNoise && win.speechSynthesis) {
      var ogGetVoices = win.SpeechSynthesis.prototype.getVoices;
      win.SpeechSynthesis.prototype.getVoices = function() {
        var list = ogGetVoices.apply(this, arguments) || [];
        return list.slice(0, list.length > 2 ? list.length - 1 : list.length);
      };
    }
  } catch(e) {}

  // Do Not Track Override
  try {
    if (_doNotTrack === 'enable') {
      Object.defineProperty(win.navigator, 'doNotTrack', { get: function() { return "1"; }, configurable: true });
      Object.defineProperty(win.window, 'doNotTrack', { get: function() { return "1"; }, configurable: true });
    } else if (_doNotTrack === 'disable') {
      Object.defineProperty(win.navigator, 'doNotTrack', { get: function() { return "0"; }, configurable: true });
      Object.defineProperty(win.window, 'doNotTrack', { get: function() { return "0"; }, configurable: true });
    }
  } catch(e) {}

  // Localhost Port Scan Blocker
  try {
    if (_portScanProtection === 'enable' && win.fetch) {
      var ogFetch = win.fetch;
      win.fetch = function(url, options) {
        var urlStr = String(url || '');
        if (urlStr.includes('127.0.0.1') || urlStr.includes('localhost')) {
          return Promise.reject(new TypeError('Failed to fetch (Port Scan Protection Active)'));
        }
        return ogFetch.apply(this, arguments);
      };
      
      if (win.XMLHttpRequest) {
        var ogOpen = win.XMLHttpRequest.prototype.open;
        win.XMLHttpRequest.prototype.open = function(method, url) {
          var urlStr = String(url || '');
          if (urlStr.includes('127.0.0.1') || urlStr.includes('localhost')) {
            throw new Error('Connection refused (Port Scan Protection Active)');
          }
          return ogOpen.apply(this, arguments);
        };
      }
    }
  } catch(e) {}
}

applyStealth(window);

// Handle dynamic iframes
(function() {
  try {
    var orgContentWindow = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "contentWindow").get;
    Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", {
      get: function() {
        var win = orgContentWindow.call(this);
        if (win) { try { applyStealth(win); } catch(e) {} }
        return win;
      },
      configurable: true
    });
  } catch(e) {}
})();
`;

        const injectNavBarStr = "";

        {
            const extDir = path.join(this.tempDir, 'anti_detect_ext');
            if (!fs.existsSync(extDir)) fs.mkdirSync(extDir, { recursive: true });
            
            const manifest = {
                manifest_version: 3,
                name: "Nova Stealth Injector",
                version: "4.0",
                content_scripts: [{
                    matches: ["<all_urls>"],
                    js: ["inject.js"],
                    run_at: "document_start",
                    world: "MAIN",
                    all_frames: true,
                    match_about_blank: true,
                    match_origin_as_fallback: true
                }]
            };
            fs.writeFileSync(path.join(extDir, 'manifest.json'), JSON.stringify(manifest));
            
            const injectJs = deepHijackScript;
            fs.writeFileSync(path.join(extDir, 'inject.js'), injectJs);
            chromeArgs.push(`--load-extension=${extDir}`);
            chromeArgs.push(`--disable-extensions-except=${extDir}`);
        }

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

                            try {
                                await client.send('Page.enable', {}, sessionId);
                                await client.send('Page.setBypassCSP', { enabled: true }, sessionId);
                                await client.send('Page.addScriptToEvaluateOnNewDocument', { source: deepHijackScript }, sessionId);
                            } catch (pageErr) {}

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
                spawn('taskkill', ['/F', '/T', '/PID', String(this.chromePid)], {
                    windowsHide: true, detached: true, stdio: 'ignore',
                }).unref();
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
