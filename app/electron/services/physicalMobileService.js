const { spawn, exec, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const iphoneSsh = require('./iphone-ssh');
const iosModelo = require('./ios-modelo');
const plistPrefs = require('./plist-prefs');
const net = require('net');
const WebSocket = require('ws');
const axios = require('axios');

class PhysicalMobileService {
    constructor(mainWindow, app) {
        this.mainWindow = mainWindow;
        this.app = app;
        
        this.baseDir = path.join(app ? app.getPath('userData') : process.cwd(), 'physical_mobile');
        this._adbPath = null;
        this._scrcpyPath = null;
        this.isProvisioning = false;
        
        this.runningStreams = new Map();

        if (!fs.existsSync(this.baseDir)) fs.mkdirSync(this.baseDir, { recursive: true });
        try { require('./iphone-ssh').migrateLegacy(); } catch (e) { console.error('[iPhone SSH] migração:', e.message); }

        this.resolveAdbPath();
        this.resolveScrcpyPath();

        if (process.env.NOVA_SMOKE_TEST !== '1') setTimeout(() => this.ensureTools(false), 2000);
    }

    get adbPath() {
        return this.resolveAdbPath();
    }
    set adbPath(val) {
        this._adbPath = val;
    }

    get scrcpyPath() {
        return this.resolveScrcpyPath();
    }
    set scrcpyPath(val) {
        this._scrcpyPath = val;
    }

    resolveAdbPath() {
        if (process.platform === "darwin") {
            return require('./mac-native').tool('adb') || require('path').join(process.resourcesPath || '', 'bin', 'adb');
        }

        if (this._adbPath && fs.existsSync(this._adbPath)) {
            return this._adbPath;
        }

        const candidates = [
            path.join(__dirname, '..', '..', 'resources', 'bin', 'adb.exe'),
            path.join(__dirname, '..', '..', 'resources', 'platform-tools', 'adb.exe'),
            path.join(process.cwd(), 'resources', 'bin', 'adb.exe'),
            path.join(process.cwd(), 'resources', 'platform-tools', 'adb.exe'),
            path.join(process.resourcesPath || '', 'bin', 'adb.exe'),
            path.join(process.resourcesPath || '', 'platform-tools', 'adb.exe'),
            path.join(this.baseDir, 'platform-tools', 'adb.exe'),
            path.join(this.baseDir, 'adb.exe'),
            path.join(__dirname, '..', 'resources', 'bin', 'adb.exe'),
            path.join(__dirname, '..', 'resources', 'platform-tools', 'adb.exe'),
            path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
            path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
            path.join(process.env.PROGRAMFILES || '', 'Android', 'platform-tools', 'adb.exe'),
            path.join(process.env['PROGRAMFILES(X86)'] || '', 'Android', 'platform-tools', 'adb.exe'),
            path.join(process.env.USERPROFILE || '', 'platform-tools', 'adb.exe'),
            'C:\\platform-tools\\adb.exe',
            'C:\\Android\\platform-tools\\adb.exe',
            'C:\\Android\\Sdk\\platform-tools\\adb.exe',
            path.join(process.env.PROGRAMFILES || '', 'BlueStacks_nxt', 'HD-Adb.exe'),
            path.join(process.env.PROGRAMFILES || '', 'Nox', 'bin', 'nox_adb.exe'),
            path.join(process.env.PROGRAMFILES || '', 'LDPlayer', 'LDPlayer9', 'adb.exe')
        ];

        for (const p of candidates) {
            if (p && typeof p === 'string' && fs.existsSync(p)) {
                this._adbPath = p;
                return p;
            }
        }

        return path.join(this.baseDir, 'platform-tools', 'adb.exe');
    }

    resolveScrcpyPath() {
        if (process.platform === "darwin") {
            return require('./mac-native').tool('scrcpy') || require('path').join(process.resourcesPath || '', 'bin', 'scrcpy');
        }

        if (this._scrcpyPath && fs.existsSync(this._scrcpyPath)) {
            return this._scrcpyPath;
        }

        const candidates = [
            path.join(__dirname, '..', '..', 'resources', 'bin', 'scrcpy.exe'),
            path.join(__dirname, '..', '..', 'resources', 'scrcpy', 'scrcpy.exe'),
            path.join(process.cwd(), 'resources', 'bin', 'scrcpy.exe'),
            path.join(process.cwd(), 'resources', 'scrcpy', 'scrcpy.exe'),
            path.join(process.resourcesPath || '', 'bin', 'scrcpy.exe'),
            path.join(process.resourcesPath || '', 'scrcpy', 'scrcpy.exe'),
            path.join(this.baseDir, 'scrcpy', 'scrcpy.exe'),
            path.join(this.baseDir, 'scrcpy.exe'),
            path.join(__dirname, '..', 'resources', 'bin', 'scrcpy.exe'),
            path.join(__dirname, '..', 'resources', 'scrcpy', 'scrcpy.exe'),
            path.join(process.env.PROGRAMFILES || '', 'scrcpy', 'scrcpy.exe'),
            path.join(process.env.LOCALAPPDATA || '', 'Programs', 'scrcpy', 'scrcpy.exe'),
            path.join(process.env.USERPROFILE || '', 'scrcpy', 'scrcpy.exe'),
            'C:\\scrcpy\\scrcpy.exe'
        ];

        for (const p of candidates) {
            if (p && typeof p === 'string' && fs.existsSync(p)) {
                this._scrcpyPath = p;
                return p;
            }
        }

        return path.join(this.baseDir, 'scrcpy', 'scrcpy.exe');
    }

    sendToFrontend(event, data) {
        if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
        try {
            this.mainWindow.webContents.send(event, data);
        } catch (error) {
            console.error('[PhysicalMobile] IPC Send error:', error);
        }
    }

    async ensureTools(force = false) {
        if (process.platform === "darwin") {
            const adb = this.adbPath, scrcpy = this.scrcpyPath;
            const ready = fs.existsSync(adb) && fs.existsSync(scrcpy);
            return {success:ready, message:ready?'Native macOS tools ready.':'Native adb/scrcpy missing. Install platform-tools and scrcpy for macOS.', adbPath:adb, scrcpyPath:scrcpy};
        }

        const adbReady = fs.existsSync(this.adbPath);
        const scrcpyReady = fs.existsSync(this.scrcpyPath);

        if (adbReady && scrcpyReady && !force) {
            return { success: true, message: 'Ferramentas prontas.' };
        }

        if (this.isProvisioning) {
            return { success: true, message: 'Configuração em andamento...' };
        }

        this.isProvisioning = true;
        this.sendToFrontend('physical-mobile:setup-progress', { stage: 'starting', message: 'Configurando Motor de Controle Móvel...' });

        try {
            if (!adbReady || force) {
                this.sendToFrontend('physical-mobile:setup-progress', { stage: 'adb', message: 'Baixando Motor ADB Android...' });
                const adbZipUrl = 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip';
                const adbZipPath = path.join(this.baseDir, 'platform-tools.zip');
                
                const response = await axios({
                    url: adbZipUrl,
                    method: 'GET',
                    responseType: 'arraybuffer',
                    timeout: 60000
                });
                fs.writeFileSync(adbZipPath, Buffer.from(response.data));

                await new Promise((resolve, reject) => {
                    const extractCmd = `powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Path '${adbZipPath}' -DestinationPath '${this.baseDir}' -Force"`;
                    exec(extractCmd, (err) => {
                        try { fs.unlinkSync(adbZipPath); } catch (_) {}
                        if (err) reject(err); else resolve();
                    });
                });
            }

            if (!scrcpyReady || force) {
                this.sendToFrontend('physical-mobile:setup-progress', { stage: 'scrcpy', message: 'Configurando Motor de Espelhamento de Tela...' });
                const scrcpyZipUrl = 'https://github.com/Genymobile/scrcpy/releases/download/v2.4/scrcpy-win64-v2.4.zip';
                const scrcpyZipPath = path.join(this.baseDir, 'scrcpy.zip');
                const scrcpyDest = path.join(this.baseDir, 'scrcpy');

                try {
                    const response = await axios({
                        url: scrcpyZipUrl,
                        method: 'GET',
                        responseType: 'arraybuffer',
                        timeout: 60000
                    });
                    fs.writeFileSync(scrcpyZipPath, Buffer.from(response.data));

                    await new Promise((resolve, reject) => {
                        const extractCmd = `powershell -NoProfile -ExecutionPolicy Bypass -Command "$temp = Join-Path '${this.baseDir}' 'scrcpy_temp'; Expand-Archive -Path '${scrcpyZipPath}' -DestinationPath $temp -Force; $inner = Get-ChildItem -Path $temp -Directory | Select-Object -First 1; if ($inner) { Move-Item -Path ($inner.FullName + '\\*') -Destination '${scrcpyDest}' -Force } else { Move-Item -Path ($temp + '\\*') -Destination '${scrcpyDest}' -Force }; Remove-Item -Recurse -Force $temp"`;
                        if (!fs.existsSync(scrcpyDest)) fs.mkdirSync(scrcpyDest, { recursive: true });
                        exec(extractCmd, (err) => {
                            try { fs.unlinkSync(scrcpyZipPath); } catch (_) {}
                            if (err) reject(err); else resolve();
                        });
                    });
                } catch (e) {
                    console.warn('[PhysicalMobile] Scrcpy download mirror failed, attempting fallback...', e);
                }
            }

            this.resolveAdbPath();
            this.resolveScrcpyPath();
            this.sendToFrontend('physical-mobile:setup-progress', { stage: 'done', message: 'Motores prontos!' });
            return { success: true };
        } catch (error) {
            console.error('[PhysicalMobile] ensureTools error:', error);
            this.sendToFrontend('physical-mobile:setup-progress', { stage: 'error', message: 'A configuração automática encontrou um erro: ' + error.message });
            return { success: false, error: error.message };
        } finally {
            this.isProvisioning = false;
        }
    }

    async getConnectedDevices() {
        const adbDevices = await new Promise((resolve) => {
            const adb = this.adbPath;
            if (!fs.existsSync(adb)) {
                resolve([]);
                return;
            }

            exec(`"${adb}" devices -l`, (err, stdout) => {
                if (err || !stdout) {
                    resolve([]);
                    return;
                }

                const lines = stdout.split('\n');
                const devices = [];
                
                for (let i = 1; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (!line || line.startsWith('*')) continue;
                    
                    const parts = line.split(/\s+/);
                    if (parts.length >= 2) {
                        const id = parts[0];
                        const status = parts[1];
                        const isWifi = id.includes(':') || id.match(/^\d+\.\d+\.\d+\.\d+/);

                        const modelMatch = line.match(/model:(\S+)/);
                        const deviceMatch = line.match(/device:(\S+)/);
                        const modelName = modelMatch ? modelMatch[1].replace(/_/g, ' ') : (deviceMatch ? deviceMatch[1] : id);

                        devices.push({
                            id,
                            status,
                            name: modelName,
                            type: isWifi ? 'wifi' : 'usb'
                        });
                    }
                }
                resolve(devices);
            });
        });
        const iosDevices = await this.getIosDevices();
        return adbDevices.concat(iosDevices);
    }

    iosSsh(command) {
        return new Promise((resolve) => {
            const args = ['-p', '2222', ...iphoneSsh.sshOptions(),
                '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-o', 'StrictHostKeyChecking=accept-new',
                'mobile@127.0.0.1', command];
            execFile(require('./tool-paths').ssh(), args, { timeout: 12000 }, (err, stdout, stderr) => {
                resolve({ ok: !err, stdout: String(stdout || ''), error: err ? (String(stderr) || err.message) : null });
            });
        });
    }

    // Fuso do aparelho (o iOS ajusta sozinho quando a localização simulada muda)
    async iosDeviceTimeZone() {
        const r = await this.iosSsh('readlink /var/db/timezone/localtime');
        const m = r.ok ? String(r.stdout || '').trim().match(/zoneinfo\/(.+)$/) : null;
        return m ? m[1].trim() : null;
    }

    iosProxyRun(args, timeoutMs = 30000) {
        return new Promise((resolve) => {
            const cmd = '/var/jb/usr/bin/novaproxy ' + args;
            const sshArgs = ['-p', '2222', ...iphoneSsh.sshOptions(),
                '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-o', 'StrictHostKeyChecking=accept-new',
                'mobile@127.0.0.1', cmd];
            execFile(require('./tool-paths').ssh(), sshArgs, { timeout: timeoutMs }, (err, stdout, stderr) => {
                resolve({ ok: !err, stdout: String(stdout || '').trim(), error: err ? (String(stderr || '').trim() || err.message) : null });
            });
        });
    }

    iosProxyError(raw) {
        const msg = String(raw || '').trim();
        if (/No such file|not found|command not found/i.test(msg)) {
            return 'O novaproxy ainda não está instalado no iPhone. Rode o instalador uma vez.';
        }
        if (/password is required|a password is required/i.test(msg)) {
            return 'A regra de sudo do novaproxy não está ativa no iPhone. Reinstale o pacote.';
        }
        if (/must have a tty|requiretty/i.test(msg)) {
            return 'O sudo do iPhone exige terminal. Reinstale o pacote (a regra NOPASSWD não entrou).';
        }
        return msg || 'Falha ao falar com o proxy do iPhone.';
    }

    async iosProxySet(deviceId, proxy) {
        if (!String(deviceId || '').startsWith('ios-')) {
            return { success: false, error: 'O proxy está disponível apenas para iPhone.' };
        }
        const raw = String(proxy || '').trim();
        if (!raw) return { success: false, error: 'Proxy vazio.' };
        const quoted = "'" + raw.replace(/'/g, "'\\''") + "'";
        const r = await this.iosProxyRun('proxy set ' + quoted);
        if (!r.ok) return { success: false, error: this.iosProxyError(r.error) };
        return { success: true, message: r.stdout };
    }

    async iosProxyClear(deviceId) {
        if (!String(deviceId || '').startsWith('ios-')) {
            return { success: false, error: 'O proxy está disponível apenas para iPhone.' };
        }
        const r = await this.iosProxyRun('proxy clear', 15000);
        if (!r.ok) return { success: false, error: this.iosProxyError(r.error) };
        return { success: true, message: r.stdout };
    }

    async iosProxyStatus(deviceId) {
        if (!String(deviceId || '').startsWith('ios-')) {
            return { success: false, error: 'O proxy está disponível apenas para iPhone.' };
        }
        const r = await this.iosProxyRun('proxy status', 15000);
        if (!r.ok) return { success: false, error: this.iosProxyError(r.error) };
        const line = r.stdout;
        const upstream = (line.match(/upstream=([^\s]+)/) || [])[1] || '';
        return {
            success: true,
            on: /^on\s/.test(line),
            upstream,
            wifi: (line.match(/wifi=(\w+)/) || [])[1] || 'unknown',
            daemon: /daemon=running/.test(line),
            raw: line
        };
    }

    async iosProxyCheck(deviceId) {
        if (!String(deviceId || '').startsWith('ios-')) {
            return { success: false, error: 'O proxy está disponível apenas para iPhone.' };
        }
        const r = await this.iosProxyRun('proxy check', 40000);
        if (!r.ok) return { success: false, error: this.iosProxyError(r.error) };
        return { success: true, ip: r.stdout };
    }

    getIosModels() {
        try {
            const db = JSON.parse(fs.readFileSync(path.join(__dirname, 'iosModels.json'), 'utf8'));
            return { success: true, models: db.models || [] };
        } catch (e) {
            console.error('[novamodel] banco de modelos iOS ausente:', e.message);
            return { success: false, models: [], error: 'Banco de modelos iOS não encontrado.' };
        }
    }

    async applyIOSModel(deviceId, productType) {
        if (!String(deviceId || '').startsWith('ios-')) {
            return { success: false, error: 'O modelo é aplicável apenas ao iPhone.' };
        }
        if (!iosModelo.isValidProductType(productType)) {
            return { success: false, error: 'productType inválido.' };
        }
        const db = this.getIosModels();
        const found = db.success ? iosModelo.findModel(db.models, productType) : null;
        if (db.success && !found) {
            return { success: false, error: `Modelo "${productType}" não está no banco iOS.` };
        }
        const r = await iosModelo.applyModel((cmd) => this.iosSsh(cmd), productType);
        if (!r.success) return r;
        return { success: true, applied: { productType, name: found ? found.name : productType } };
    }

    async clearIOSModel(deviceId) {
        if (!String(deviceId || '').startsWith('ios-')) {
            return { success: false, error: 'O modelo é aplicável apenas ao iPhone.' };
        }
        return iosModelo.clearModel((cmd) => this.iosSsh(cmd));
    }

    async getIOSModel(deviceId) {
        if (!String(deviceId || '').startsWith('ios-')) {
            return { success: false, error: 'O modelo é aplicável apenas ao iPhone.' };
        }
        return iosModelo.getModel((cmd) => this.iosSsh(cmd));
    }

    iosRun(args) {
        return new Promise((resolve) => {
            execFile(require('./ios-tools').tool('ideviceinstaller'), args, { timeout: 25000 }, (err, stdout, stderr) => {
                resolve({ ok: !err, stdout: String(stdout || ''), error: err ? (String(stderr) || err.message) : null });
            });
        });
    }

    async getIosDevices() {
        try {
            const iosTools = require('./ios-tools');
            if (!iosTools.has('idevice_id') || !iosTools.has('ideviceinfo')) return [];
            return await require('./ios-devices').listar();
        } catch (e) {
            return [];
        }
    }

    // iPhone já preparado neste Mac: chave SSH instalada e impressão digital registrada
    // pelo Conectar. Serve para o cartão mostrar "Abrir controle" em vez de "Conectar".
    iosPrepared(udid) {
        try {
            const pinsFile = path.join(this.baseDir, 'iphone-hosts.json');
            if (!fs.existsSync(pinsFile)) return false;
            const pins = JSON.parse(fs.readFileSync(pinsFile, 'utf8'));
            return !!(pins && pins[udid]);
        } catch (e) {
            return false;
        }
    }

    async iosStartStream(deviceId) {
        try {
            const { BrowserWindow } = require('electron');
            const iosBridge = require('./ios-bridge');
            if (!iosBridge.isRunning || !iosBridge.isRunning()) iosBridge.start();
            if (!this.iosConsoleWindows) this.iosConsoleWindows = new Map();
            const existing = this.iosConsoleWindows.get(deviceId);
            if (existing && !existing.isDestroyed()) { existing.focus(); return { success: true, message: 'iPhone Console já estava aberto — trazido pra frente.' }; }
            const win = new BrowserWindow({ width: 1100, height: 820, title: 'iPhone Console', backgroundColor: '#050a10', webPreferences: { contextIsolation: true, nodeIntegration: false } });
            win.loadURL('http://127.0.0.1:' + iosBridge.PORT + '/');
            this.iosConsoleWindows.set(deviceId, win);
            win.on('closed', () => { this.iosConsoleWindows.delete(deviceId); });
            return { success: true, message: 'Controle do iPhone aberto. Se pedir senha, use a do CatVNC (Ajustes > CatVNC).' };
        } catch (e) { return { success: false, error: e.message }; }
    }

    async iosStopStream(deviceId) {
        const win = this.iosConsoleWindows && this.iosConsoleWindows.get(deviceId);
        if (win && !win.isDestroyed()) { try { win.close(); } catch (e) {} }
        return { success: true };
    }

    async iosControlApp(deviceId, packageName, action) {
        const act = String(action || '').toLowerCase();
        const IOS_ALIAS = {
            'com.whatsapp': 'net.whatsapp.Whatsapp',
            'com.whatsapp.w4b': 'net.whatsapp.Whatsapp',
            'com.instagram.android': 'com.burbn.instagram',
            'com.android.chrome': 'com.apple.mobilesafari',
            'com.facebook.katana': 'com.facebook.Facebook',
            'com.google.android.youtube': 'com.google.ios.youtube',
            'com.tencent.mm': 'com.tencent.xinWeChat',
            'com.zhiliaoapp.musically': 'com.zhiliaoapp.musically'
        };
        packageName = IOS_ALIAS[String(packageName)] || packageName;
        if (act === 'list') {
            const r = await this.iosRun(['list']);
            if (!r.ok && !r.stdout) return { success: false, error: r.error, apps: [] };
            const apps = [];
            r.stdout.split('\n').forEach((l) => {
                if (!l.trim() || l.startsWith('CFBundleIdentifier')) return;
                const parts = l.split(',').map(x => x.trim().replace(/^"|"$/g, ''));
                if (parts[0]) apps.push({ packageName: parts[0], name: parts[2] || parts[0] });
            });
            return { success: true, apps };
        }
        if (act === 'launch' || act === 'open' || act === 'start') {
            const r = await this.iosSsh('uiopen --bundleid ' + JSON.stringify(String(packageName)));
            return r.ok ? { success: true } : { success: false, error: r.error };
        }
        if (act === 'uninstall' || act === 'remove') {
            const r = await this.iosRun(['uninstall', String(packageName)]);
            return r.ok ? { success: true } : { success: false, error: r.error };
        }
        return { success: false, error: 'Ação não suportada no iOS: ' + act };
    }

    async iosAutomateBrowser(deviceId, url, searchText) {
        let target = String(url || '');
        if (!target && searchText) target = 'https://www.google.com/search?q=' + encodeURIComponent(searchText);
        if (target && !/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(target)) target = 'https://' + target;
        if (!target) return { success: false, error: 'Sem URL.' };
        const r = await this.iosSsh('uiopen ' + JSON.stringify(target));
        return r.ok ? { success: true } : { success: false, error: r.error };
    }

    async getStatus() {
        const adbExists = fs.existsSync(this.adbPath);
        const scrcpyExists = fs.existsSync(this.scrcpyPath);
        const devices = await this.getConnectedDevices();

        return {
            needsSetup: !adbExists || !scrcpyExists,
            adbPath: this.adbPath,
            scrcpyPath: this.scrcpyPath,
            devices: devices.map(d => {
                const isIos = String(d.id).startsWith('ios-');
                return {
                    ...d,
                    streaming: this.runningStreams.has(d.id) || (isIos && this.iosPrepared(String(d.id).slice(4)))
                };
            })
        };
    }

    async restartAdbServer() {
        const adb = this.adbPath;
        if (!fs.existsSync(adb)) return { success: false, error: 'ADB not found.' };

        return new Promise((resolve) => {
            exec(`"${adb}" kill-server`, () => {
                setTimeout(() => {
                    exec(`"${adb}" start-server`, (startErr) => {
                        if (startErr) {
                            resolve({ success: false, error: startErr.message });
                        } else {
                            resolve({ success: true, message: 'Servidor ADB reiniciado com sucesso.' });
                        }
                    });
                }, 600);
            });
        });
    }

    async autoPairUsbToWireless(deviceId) {
        if (String(deviceId).startsWith('ios-')) {
            return { success: false, platform: 'ios', error: 'Wireless Switch é exclusivo para Android. Nesta versão, mantenha o iPhone conectado por USB.' };
        }
        if (typeof deviceId !== 'string' || !deviceId.trim()) {
            return { success: false, error: 'Selecione um dispositivo Android conectado por USB.' };
        }
        const adb = this.adbPath;
        if (!fs.existsSync(adb)) return { success: false, error: 'ADB não encontrado.' };
        const run = (args) => new Promise((resolve, reject) => {
            execFile(adb, args, { encoding: 'utf8', timeout: 15000 }, (err, stdout, stderr) => {
                if (err) reject(new Error((stderr || stdout || err.message).trim()));
                else resolve((stdout || '').trim());
            });
        });
        try {
            const output = await run(['-s', deviceId, 'shell', 'ip', '-f', 'inet', 'addr', 'show', 'wlan0']);
            const match = output.match(/inet\s+(\d+\.\d+\.\d+\.\d+)/);
            const ip = match ? match[1] : await run(['-s', deviceId, 'shell', 'getprop', 'dhcp.wlan0.ipaddress']);
            if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip) || ip.split('.').some(n => Number(n) > 255)) {
                return { success: false, error: 'Não foi possível detectar o IP. Conecte o Android e o Mac à mesma rede Wi-Fi.' };
            }
            await run(['-s', deviceId, 'tcpip', '5555']);
            await new Promise(resolve => setTimeout(resolve, 1000));
            const connected = await run(['connect', `${ip}:5555`]);
            if (!/\b(?:already )?connected to\b/i.test(connected) || /failed|unable|cannot|error/i.test(connected)) {
                return { success: false, error: connected || 'Não foi possível conectar por Wi-Fi.' };
            }
            return { success: true, ip, deviceId: `${ip}:5555`, message: `Android conectado por Wi-Fi em ${ip}:5555` };
        } catch (err) {
            return { success: false, error: `Não foi possível ativar a conexão Wi-Fi: ${err.message}` };
        }
    }

    async scanWifiDevices() {
        const adb = this.adbPath;
        if (!fs.existsSync(adb)) return { success: false, error: 'ADB not found.' };

        const discoveredIps = [];

        await new Promise((res) => {
            exec(`"${adb}" mdns services`, { timeout: 4000 }, (err, stdout) => {
                if (stdout) {
                    const lines = stdout.split('\n');
                    for (const line of lines) {
                        const match = line.match(/(\d+\.\d+\.\d+\.\d+):(\d+)/);
                        if (match && !discoveredIps.includes(match[0])) {
                            discoveredIps.push(match[0]);
                        }
                    }
                }
                res();
            });
        });

        const interfaces = os.networkInterfaces();
        const baseIps = [];

        for (const name in interfaces) {
            for (const iface of interfaces[name]) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    const parts = iface.address.split('.');
                    if (parts.length === 4) {
                        baseIps.push(`${parts[0]}.${parts[1]}.${parts[2]}`);
                    }
                }
            }
        }

        if (baseIps.length > 0) {
            const checkHost = (ip) => new Promise((res) => {
                const socket = new net.Socket();
                socket.setTimeout(250);
                socket.on('connect', () => {
                    socket.destroy();
                    res(ip);
                });
                socket.on('timeout', () => { socket.destroy(); res(null); });
                socket.on('error', () => { socket.destroy(); res(null); });
                socket.connect(5555, ip);
            });

            const targetSubnet = baseIps[0];
            const hosts = [];
            for (let i = 1; i <= 254; i++) {
                hosts.push(`${targetSubnet}.${i}`);
            }

            const batchSize = 35;
            for (let i = 0; i < hosts.length; i += batchSize) {
                const batch = hosts.slice(i, i + batchSize);
                const results = await Promise.all(batch.map(ip => checkHost(ip)));
                for (const found of results) {
                    if (found && !discoveredIps.includes(`${found}:5555`)) {
                        discoveredIps.push(`${found}:5555`);
                    }
                }
            }
        }

        const connectResults = [];
        for (const target of discoveredIps) {
            await new Promise((res) => {
                exec(`"${adb}" connect ${target}`, (err, stdout) => {
                    connectResults.push({ target, success: !err && !stdout.includes('failed') });
                    res();
                });
            });
        }

        const connectedDevices = await this.getConnectedDevices();
        return {
            success: true,
            discoveredIps,
            connectedCount: connectResults.filter(c => c.success).length,
            devices: connectedDevices
        };
    }

    async pairWirelessDevice(ip, port, pairingCode) {
        const adb = this.adbPath;
        if (!fs.existsSync(adb)) return { success: false, error: 'ADB not found.' };

        return new Promise((resolve) => {
            exec(`"${adb}" pair ${ip}:${port} ${pairingCode}`, (err, stdout, stderr) => {
                if (err || (stdout && stdout.includes('Failed'))) {
                    resolve({ success: false, error: stdout || stderr || 'Pairing failed. Check pairing code and port.' });
                } else {
                    resolve({ success: true, message: stdout.trim() });
                }
            });
        });
    }

    async connectWifi(ipAddress) {
        const adb = this.adbPath;
        if (!fs.existsSync(adb)) {
            return { success: false, error: 'ADB tools missing.' };
        }

        return new Promise((resolve) => {
            const cleanIp = ipAddress.includes(':') ? ipAddress : `${ipAddress}:5555`;
            exec(`"${adb}" connect ${cleanIp}`, (connErr, connStdout, connStderr) => {
                if (connErr || (connStdout && connStdout.includes('failed'))) {
                    console.error('[PhysicalMobile] Connect Wi-Fi failed:', connStdout || connStderr);
                    resolve({ success: false, error: connStdout || connStderr || 'Connection timeout. Ensure Wireless Debugging is ON.' });
                } else {
                    console.log('[PhysicalMobile] Connected to Wi-Fi device:', connStdout);
                    resolve({ success: true, message: connStdout.trim() });
                }
            });
        });
    }

    async disconnectDevice(deviceId) {
        if (String(deviceId).startsWith('ios-')) return { success: false, error: 'iPhone é conexão USB — desconecte o cabo para desconectar.' };
        const adb = this.adbPath;
        if (!fs.existsSync(adb)) return { success: false };

        return new Promise((resolve) => {
            exec(`"${adb}" disconnect ${deviceId}`, (err, stdout) => {
                console.log(`[PhysicalMobile] Disconnected device ${deviceId}`);
                resolve({ success: true });
            });
        });
    }

    async startStream(deviceId) {
        if (String(deviceId).startsWith('ios-')) return this.iosStartStream(deviceId);
        if (this.runningStreams.has(deviceId)) {
            return { success: true, message: 'Já transmitindo' };
        }

        if (!fs.existsSync(this.scrcpyPath)) {
            return { success: false, error: 'Scrcpy stream client not found.' };
        }

        const args = [
            '-s', deviceId,
            '--window-title', `Nova Phone Control - [${deviceId}]`,
            '--stay-awake',
            '--no-audio',
            '--video-codec=h264',
            '--max-size', '1024',
            '--video-bit-rate', '4M',
            '--max-fps', '60',
            '--tunnel-host=127.0.0.1'
        ];

        console.log(`[PhysicalMobile] Spawning Scrcpy v4.1 (Stable): ${this.scrcpyPath} with args:`, args);
        
        const scrcpyProc = spawn(this.scrcpyPath, args, { windowsHide: false });
        this.runningStreams.set(deviceId, scrcpyProc);

        scrcpyProc.stdout?.on('data', (d) => console.log(`[Scrcpy] ${d}`));
        scrcpyProc.stderr?.on('data', (d) => console.warn(`[Scrcpy Err] ${d}`));

        scrcpyProc.on('close', (code) => {
            console.log(`[PhysicalMobile] Scrcpy stream for ${deviceId} closed with code ${code}`);
            this.runningStreams.delete(deviceId);
            this.sendToFrontend('physical-mobile:status-updated', { deviceId, streaming: false });
        });

        this.sendToFrontend('physical-mobile:status-updated', { deviceId, streaming: true });
        return { success: true };
    }

    async stopStream(deviceId) {
        if (String(deviceId).startsWith('ios-')) return this.iosStopStream(deviceId);
        const proc = this.runningStreams.get(deviceId);
        if (proc) {
            try {
                proc.kill();
            } catch (e) {}
            this.runningStreams.delete(deviceId);
        }
        return { success: true };
    }

    // iOS: toggle de Wi-Fi/Bluetooth via Atalho nativo disparado por uiopen.
    // Atalhos a criar no iPhone (nomes exatos): "Nova WiFi On", "Nova WiFi Off",
    // "Nova BT On", "Nova BT Off" — ações Definir Wi-Fi / Definir Bluetooth.
    // Leitura de estado real disponível via CLI novactl (com.aquiles.novactl).
    // Detalhes: MAC/integracao-iphone/CONTROLS-IPHONE-WIFI-BLUETOOTH.md
    async iosToggleSetting(deviceId, setting, enable) {
        const SHORTCUTS = {
            wifi:      { on: 'Nova WiFi On', off: 'Nova WiFi Off' },
            bluetooth: { on: 'Nova BT On',   off: 'Nova BT Off' }
        };
        const names = SHORTCUTS[String(setting).toLowerCase()];
        if (!names) return { success: false, error: 'Unsupported setting.' };
        const url = 'shortcuts://run-shortcut?name=' + encodeURIComponent(enable ? names.on : names.off);
        const r = await this.iosSsh('uiopen ' + JSON.stringify(url));
        return r.ok ? { success: true } : { success: false, error: r.error };
    }

    async toggleSetting(deviceId, setting, enable) {
        if (String(deviceId).startsWith('ios-')) return this.iosToggleSetting(deviceId, setting, enable);
        return new Promise((resolve) => {
            if (!fs.existsSync(this.adbPath)) {
                resolve({ success: false, error: 'ADB missing.' });
                return;
            }

            const action = enable ? 'enable' : 'disable';
            let shellCmd = '';

            if (setting === 'wifi') {
                shellCmd = `shell su -c "svc wifi ${action}"`;
            } else if (setting === 'bluetooth') {
                shellCmd = `shell su -c "svc bluetooth ${action}"`;
            } else {
                resolve({ success: false, error: 'Unsupported setting.' });
                return;
            }

            const cmd = `"${this.adbPath}" -s ${deviceId} ${shellCmd}`;
            console.log(`[PhysicalMobile] Executing settings toggle: ${cmd}`);

            exec(cmd, (err, stdout, stderr) => {
                if (err) {
                    const fallbackCmd = `"${this.adbPath}" -s ${deviceId} shell svc ${setting} ${action}`;
                    exec(fallbackCmd, (fbErr, fbStdout, fbStderr) => {
                        if (fbErr) {
                            console.error(`[PhysicalMobile] Fallback settings command failed:`, fbStderr);
                            resolve({ success: false, error: fbStderr });
                        } else {
                            resolve({ success: true });
                        }
                    });
                } else {
                    resolve({ success: true });
                }
            });
        });
    }

    async controlApp(deviceId, packageName, action) {
        if (String(deviceId).startsWith('ios-')) return this.iosControlApp(deviceId, packageName, action);
        return new Promise((resolve) => {
            if (!fs.existsSync(this.adbPath)) {
                resolve({ success: false, error: 'ADB missing.' });
                return;
            }

            let shellCmd = '';
            if (action === 'start') {
                shellCmd = `shell monkey -p ${packageName} -c android.intent.category.LAUNCHER 1`;
            } else if (action === 'stop') {
                shellCmd = `shell su -c "am force-stop ${packageName}"`;
            } else if (action === 'clear') {
                shellCmd = `shell su -c "pm clear ${packageName}"`;
            }

            const cmd = `"${this.adbPath}" -s ${deviceId} ${shellCmd}`;
            console.log(`[PhysicalMobile] Executing app control: ${cmd}`);

            exec(cmd, (err, stdout, stderr) => {
                if (err && action !== 'start') {
                    const fallbackCmd = `"${this.adbPath}" -s ${deviceId} shell am force-stop ${packageName}`;
                    exec(fallbackCmd, (fbErr) => {
                        resolve({ success: !fbErr });
                    });
                } else {
                    resolve({ success: !err });
                }
            });
        });
    }

    async automateBrowser(deviceId, url, searchText) {
        if (String(deviceId).startsWith('ios-')) return this.iosAutomateBrowser(deviceId, url, searchText);
        return new Promise(async (resolve) => {
            if (!fs.existsSync(this.adbPath)) {
                resolve({ success: false, error: 'ADB missing.' });
                return;
            }

            console.log(`[PhysicalMobile] Initializing browser automation on device ${deviceId}...`);

            const forwardCmd = `"${this.adbPath}" -s ${deviceId} forward tcp:9222 localabstract:chrome_devtools_remote`;
            
            exec(forwardCmd, async (err, stdout, stderr) => {
                if (err) {
                    console.error('[PhysicalMobile] Failed to set up port forwarding:', stderr);
                    resolve({ success: false, error: 'CDP Port forwarding failed.' });
                    return;
                }

                const chromeLaunchCmd = `"${this.adbPath}" -s ${deviceId} shell am start -n com.android.chrome/com.google.android.apps.chrome.Main`;
                exec(chromeLaunchCmd);

                await new Promise(r => setTimeout(r, 4000));

                try {
                    const response = await axios.get('http://localhost:9222/json');
                    const tabs = response.data;
                    
                    if (!tabs || tabs.length === 0) {
                        resolve({ success: false, error: 'No active Chrome tabs found. Make sure Chrome is running.' });
                        return;
                    }

                    const targetTab = tabs.find(t => t.type === 'page') || tabs[0];
                    const wsUrl = targetTab.webSocketDebuggerUrl;
                    
                    if (!wsUrl) {
                        resolve({ success: false, error: 'Debugger WebSocket URL not found.' });
                        return;
                    }

                    console.log(`[PhysicalMobile] Connecting to Chrome debugger socket: ${wsUrl}`);
                    const ws = new WebSocket(wsUrl);

                    ws.on('open', () => {
                        let msgId = 1;

                        const sendCommand = (method, params = {}) => {
                            return new Promise((cmdResolve) => {
                                const id = msgId++;
                                const payload = JSON.stringify({ id, method, params });
                                
                                const listener = (data) => {
                                    const res = JSON.parse(data);
                                    if (res.id === id) {
                                        ws.off('message', listener);
                                        cmdResolve(res.result);
                                    }
                                };
                                
                                ws.on('message', listener);
                                ws.send(payload);
                            });
                        };

                        (async () => {
                            try {
                                console.log(`[PhysicalMobile] Navigating to: ${url}`);
                                await sendCommand('Page.navigate', { url });

                                await new Promise(r => setTimeout(r, 5000));

                                if (searchText) {
                                    console.log(`[PhysicalMobile] Injecting search script for term: ${searchText}`);
                                    
                                    const jsCode = `
                                        (function() {
                                            // Check standard inputs
                                            const inputs = [
                                                document.querySelector('input[name="q"]'),
                                                document.querySelector('input[type="search"]'),
                                                document.querySelector('input[placeholder*="Search"]'),
                                                document.querySelector('input[placeholder*="search"]')
                                            ];
                                            const searchInput = inputs.find(el => el !== null);
                                            if (searchInput) {
                                                searchInput.value = "${searchText}";
                                                // Try submitting the form
                                                if (searchInput.form) {
                                                    searchInput.form.submit();
                                                    return "Form submitted successfully";
                                                }
                                                // Fallback: Dispatch Enter event
                                                const enterEvent = new KeyboardEvent('keydown', {
                                                    bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13
                                                });
                                                searchInput.dispatchEvent(enterEvent);
                                                return "Enter event dispatched";
                                            }
                                            return "Search input element not found";
                                        })()
                                    `;

                                    const evalRes = await sendCommand('Runtime.evaluate', { expression: jsCode });
                                    console.log('[PhysicalMobile] Eval result:', evalRes);
                                }

                                ws.close();
                                resolve({ success: true });
                            } catch (e) {
                                console.error('[PhysicalMobile] Automation loop failed:', e);
                                ws.close();
                                resolve({ success: false, error: e.message });
                            }
                        })();
                    });

                    ws.on('error', (wsErr) => {
                        console.error('[PhysicalMobile] WebSocket debugger error:', wsErr);
                        resolve({ success: false, error: wsErr.message });
                    });

                } catch (fetchErr) {
                    console.error('[PhysicalMobile] Failed to fetch debugger tabs:', fetchErr.message);
                    resolve({ success: false, error: 'Could not connect to Chrome debugging interface.' });
                }
            });
        });
    }

    getSpooferDatabase() {
        try {
            const dbPath = path.join(__dirname, 'spooferDatabase.json');
            return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        } catch (e) {
            console.error('[Spoofer] Failed to load database:', e);
            return { brands: {} };
        }
    }

    getSpooferModels() {
        const db = this.getSpooferDatabase();
        const result = {};
        for (const [brand, models] of Object.entries(db.brands)) {
            result[brand] = models.map(m => ({ model: m.model, name: m.name }));
        }
        return { success: true, brands: result };
    }

    generateIMEI(prefix) {
        const tac = prefix || '35' + Math.floor(Math.random() * 99999999).toString().padStart(8, '0');
        let digits = tac.split('').map(Number);
        let sum = 0;
        for (let i = 0; i < 14; i++) {
            let d = digits[i];
            if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
            sum += d;
        }
        const checkDigit = (10 - (sum % 10)) % 10;
        return tac + checkDigit;
    }

    randomHex(length) {
        let result = '';
        const chars = '0123456789abcdef';
        for (let i = 0; i < length; i++) result += chars[Math.floor(Math.random() * 16)];
        return result;
    }

    generateMAC() {
        const hex = () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0');
        return `02:${hex()}:${hex()}:${hex()}:${hex()}:${hex()}`;
    }

    generateSerial(prefix) {
        const suffix = Math.random().toString(36).substring(2, 10).toUpperCase();
        return (prefix || 'RND1') + suffix;
    }

    generateAndroidId() {
        return this.randomHex(16);
    }

    generateGAID() {
        const s4 = () => this.randomHex(4);
        return `${s4()}${s4()}-${s4()}-${s4()}-${s4()}-${s4()}${s4()}${s4()}`;
    }

    adbRootExec(deviceId, shellCmd) {
        return new Promise((resolve) => {
            const cmd = `"${this.adbPath}" -s ${deviceId} shell su -c "${shellCmd}"`;
            exec(cmd, { timeout: 10000 }, (err, stdout, stderr) => {
                if (err) {
                    const fallback = `"${this.adbPath}" -s ${deviceId} shell ${shellCmd}`;
                    exec(fallback, { timeout: 10000 }, (fbErr, fbOut) => {
                        resolve({ success: !fbErr, output: fbOut });
                    });
                } else {
                    resolve({ success: true, output: stdout });
                }
            });
        });
    }

    adbPush(deviceId, localPath, remotePath) {
        return new Promise((resolve) => {
            exec(`"${this.adbPath}" -s ${deviceId} push "${localPath}" ${remotePath}`, (err) => {
                resolve({ success: !err });
            });
        });
    }

    async applySpoofProfile(deviceId, brandName, modelKey, customImei = null) {
        try {
            const db = this.getSpooferDatabase();
            const brandKey = Object.keys(db.brands).find(
                k => k.toLowerCase() === brandName.toLowerCase()
            ) || brandName;
            const brand = db.brands[brandKey];
            if (!brand) return { success: false, error: `Brand "${brandName}" not found.` };

            const profile = brand.find(m => m.model === modelKey);
            if (!profile) return { success: false, error: `Model "${modelKey}" not found.` };

            // Each brand family maps to an official TAC range registered with GSMA
            const IMEI_TAC = {
                'samsung':   ['35265210', '35386910', '35617210', '35913410', '35265211'],
                'google':    ['35396210', '35396211', '35396212', '35396213', '35396214'],
                'oneplus':   ['86882803', '86882804', '86882805', '86882806'],
                'xiaomi':    ['86875203', '86875204', '86875205', '86875206'],
                'oppo':      ['86855701', '86855702', '86855703', '86855704'],
                'vivo':      ['86878001', '86878002', '86878003', '86878004'],
                'huawei':    ['86798010', '86798011', '86798012', '86798013'],
                'realme':    ['86888401', '86888402', '86888403', '86888404'],
                'sony':      ['35332110', '35332111', '35332112', '35332113'],
                'motorola':  ['35528010', '35528011', '35528012', '35528013'],
                'nokia':     ['35900610', '35900611', '35900612', '35900613'],
                'lg':        ['35268410', '35268411', '35268412', '35268413'],
            };
            const mfrKey = (profile.manufacturer || brandName).toLowerCase();
            const tacPool = IMEI_TAC[mfrKey] || IMEI_TAC['samsung'];
            const tac = tacPool[Math.floor(Math.random() * tacPool.length)];
            const imei = customImei || this.generateIMEI(tac);

            const serial   = this.generateSerial(profile.serial_prefix);
            const androidId = this.generateAndroidId();
            const mac      = this.generateMAC();
            const gaid     = this.generateGAID();
            const imsi     = '310150' + Math.floor(Math.random() * 9999999999).toString().padStart(10, '0');

            // Read the device's actual OS properties to prevent framework mismatch crashes
            const realReleaseRes = await this.adbRootExec(deviceId, 'getprop ro.build.version.release');
            const realSdkRes = await this.adbRootExec(deviceId, 'getprop ro.build.version.sdk');
            const realPatchRes = await this.adbRootExec(deviceId, 'getprop ro.build.version.security_patch');
            const realIncrementalRes = await this.adbRootExec(deviceId, 'getprop ro.build.version.incremental');
            const realBuildIdRes = await this.adbRootExec(deviceId, 'getprop ro.build.id');

            const av = (realReleaseRes.output && realReleaseRes.output.trim()) || '11';
            const sdk = (realSdkRes.output && realSdkRes.output.trim()) || '30';
            const patch = (realPatchRes.output && realPatchRes.output.trim()) || '2021-05-05';
            const incremental = (realIncrementalRes.output && realIncrementalRes.output.trim()) || 'RQ2A.210505.003';
            const bid = (realBuildIdRes.output && realBuildIdRes.output.trim()) || 'RQ2A.210505.003';

            console.log(`[Spoofer] Applying profile: ${profile.name} | Preserving real OS: Android ${av} (SDK ${sdk}) | Patch: ${patch}`);

            const props = [
                ['ro.product.model',                    profile.model],
                ['ro.product.name',                     profile.device],
                ['ro.product.device',                   profile.device],
                ['ro.product.brand',                    profile.manufacturer],
                ['ro.product.manufacturer',             profile.manufacturer],
                ['ro.build.product',                    profile.device],
                ['ro.build.fingerprint',                profile.fingerprint],
                ['ro.build.id',                         bid],
                ['ro.build.display.id',                 bid],
                ['ro.build.type',                       'user'],
                ['ro.build.tags',                       'release-keys'],
                ['ro.build.description',                `${profile.device}-user ${av} ${bid} release-keys`],
                ['ro.build.version.security_patch',     patch],
                ['ro.build.version.release',            av],
                ['ro.build.version.release_or_codename',av],
                ['ro.build.version.sdk',                sdk],
                ['ro.build.version.preview_sdk',        '0'],
                ['ro.build.version.incremental',        incremental],
                ['ro.serialno',                         serial],
                ['ro.boot.serialno',                    serial],
                ['ro.product.vendor.model',             profile.model],
                ['ro.product.vendor.brand',             profile.manufacturer],
                ['ro.product.vendor.manufacturer',      profile.manufacturer],
                ['ro.product.vendor.device',            profile.device],
                ['ro.product.vendor.name',              profile.device],
                ['ro.product.system.model',             profile.model],
                ['ro.product.system.brand',             profile.manufacturer],
                ['ro.product.system.manufacturer',      profile.manufacturer],
                ['ro.product.system.device',            profile.device],
                ['ro.product.system.name',              profile.device],
                ['ro.product.odm.model',                profile.model],
                ['ro.product.odm.brand',                profile.manufacturer],
                ['ro.product.odm.manufacturer',         profile.manufacturer],
                ['ro.product.odm.device',               profile.device],
                ['ril.imei',                            imei],
                ['ril.imei1',                           imei],
                ['persist.radio.imei',                  imei],
                ['persist.radio.imei1',                 imei],
                ['vendor.ril.imei',                     imei],
                ['vendor.ril.imei1',                    imei],
                // Anti-detection: must appear as a production user build
                ['ro.debuggable',                       '0'],
                ['ro.secure',                           '1'],
                ['ro.adb.secure',                       '1'],
                ['ro.build.type',                       'user'],
                ['ro.build.tags',                       'release-keys'],
                ['ro.boot.verifiedbootstate',           'green'],
                ['ro.boot.flash.locked',                '1'],
                ['ro.boot.warranty_bit',                '0'],
                ['ro.warranty_bit',                     '0'],
                ['sys.oem_unlock_allowed',              '0'],
                ['ro.oem_unlock_supported',             '0'],
            ];

            for (const [key, val] of props) {
                await this.adbRootExec(deviceId, `resetprop "${key}" "${val}" 2>/dev/null; true`);
            }

            // Strategy: Set ALL known IMEI prop paths persistently + trigger safe telephony
            // notification WITHOUT restarting ril-daemon (which causes blank IMEI).
            // *#06# reads from ril.gsm.imei OR ril.imei — we set both.
            console.log(`[Spoofer] Deep IMEI inject: writing all prop paths (no ril restart)`);

            const imeiProps = [
                `ril.imei`, `ril.imei1`, `ril.imei2`,
                `persist.radio.imei`, `persist.radio.imei1`,
                `vendor.ril.imei`, `vendor.ril.imei1`,
                `ro.ril.oem.imei`, `ril.gsm.imei`,
                `gsm.current.phone-subid`, // Samsung path
            ];
            for (const p of imeiProps) {
                // -p flag writes to persist.* namespace AND volatile namespace
                await this.adbRootExec(deviceId, `resetprop -p "${p}" "${imei}" 2>/dev/null; true`);
                await this.adbRootExec(deviceId, `resetprop "${p}" "${imei}" 2>/dev/null; true`);
            }

            // Samsung EFS direct write (if /efs accessible) — takes effect after full reboot
            await this.adbRootExec(deviceId, `mount -o remount,rw /efs 2>/dev/null; true`);
            await this.adbRootExec(deviceId,
                `[ -d /efs/imei ] && printf '%s' '${imei}' > /efs/imei/nv_data.bin 2>/dev/null; true`);
            await this.adbRootExec(deviceId,
                `[ -f /efs/.nv_imei ] && printf '%s' '${imei}' > /efs/.nv_imei 2>/dev/null; true`);
            await this.adbRootExec(deviceId,
                `[ -f /efs/imei ] && printf '%s' '${imei}' > /efs/imei 2>/dev/null; true`);
            await this.adbRootExec(deviceId, `sync 2>/dev/null; true`);

            // Broadcast a safe Intent to tell TelephonyManager to re-read IMEI from props.
            // This makes *#06# and Settings show the spoofed IMEI WITHOUT killing ril-daemon.
            await this.adbRootExec(deviceId, `am broadcast -a android.intent.action.SERVICE_STATE 2>/dev/null; true`);
            await this.adbRootExec(deviceId, `am broadcast -a android.telephony.action.SUBSCRIPTION_CARRIER_IDENTITY_CHANGED 2>/dev/null; true`);
            await this.adbRootExec(deviceId, `service call phone 1 2>/dev/null; true`);
            console.log(`[Spoofer] ✅ IMEI props set + telephony refresh triggered (check *#06# after soft reboot)`);

            const CARRIER_DB = {
                'Samsung':  { name: 'T-Mobile US',  mcc: '310', mnc: '260', country: 'us', apn: 'fast.t-mobile.com' },
                'Google':   { name: 'AT&T',          mcc: '310', mnc: '410', country: 'us', apn: 'phone' },
                'OnePlus':  { name: 'Verizon',        mcc: '311', mnc: '480', country: 'us', apn: 'vzwinternet' },
                'Realme':   { name: 'Airtel',         mcc: '404', mnc: '10',  country: 'in', apn: 'airtelgprs.com' },
                'Xiaomi':   { name: 'T-Mobile US',   mcc: '310', mnc: '260', country: 'us', apn: 'fast.t-mobile.com' },
                'OPPO':     { name: 'Vodafone UK',   mcc: '234', mnc: '15',  country: 'gb', apn: 'pp.vodafone.co.uk' },
                'Vivo':     { name: 'O2 UK',          mcc: '234', mnc: '10',  country: 'gb', apn: 'mobile.o2.co.uk' },
                'Huawei':   { name: 'EE UK',          mcc: '234', mnc: '30',  country: 'gb', apn: 'everywhere' },
                'Sony':     { name: 'T-Mobile US',   mcc: '310', mnc: '260', country: 'us', apn: 'fast.t-mobile.com' },
                'Motorola': { name: 'Verizon',        mcc: '311', mnc: '480', country: 'us', apn: 'vzwinternet' },
                'LG':       { name: 'AT&T',           mcc: '310', mnc: '410', country: 'us', apn: 'phone' },
                'Nokia':    { name: 'T-Mobile US',   mcc: '310', mnc: '260', country: 'us', apn: 'fast.t-mobile.com' },
            };
            const carrier = CARRIER_DB[profile.manufacturer] || CARRIER_DB['Samsung'];
            const mcc = carrier.mcc;
            const mnc = carrier.mnc;
            const simOperatorName = carrier.name;
            const simCountryIso = carrier.country;

            const wifiSsid  = profile.manufacturer + '_' + this.randomHex(4).toUpperCase();
            const wifiBssid = this.generateMAC();
            const bluetoothId = this.generateMAC();
            const simSubId  = '8901' + mcc + mnc + Math.floor(Math.random() * 10000000000).toString().padStart(10, '0');
            const simSerial = '8901' + mcc + mnc + Math.floor(Math.random() * 10000000000).toString().padStart(10, '0');
            const mobileNumber = '5' + Math.floor(100000000 + Math.random() * 900000000).toString();
            const hwSerial   = serial;
            const gsfIdValue = this.randomHex(16);
            const mediaDrmId = this.randomHex(32);


            const spoofConfig = {
                imei, imsi, serial, android_id: androidId, mac, gaid,
                model: profile.name, brand: profile.manufacturer,
                fingerprint: profile.fingerprint,
                android_version: av, security_patch: patch,
                wifi_ssid: wifiSsid, wifi_bssid: wifiBssid,
                bluetooth_id: bluetoothId, sim_sub_id: simSubId,
                sim_serial: simSerial, mobile_number: mobileNumber,
                hw_serial: hwSerial, ads_id: gaid, gsf_id: gsfIdValue,
                mediadrm_id: mediaDrmId, sim_operator: simOperatorName,
                sim_country: simCountryIso, mcc, mnc
            };

            await this.adbRootExec(deviceId, `settings put secure android_id ${androidId}`);
            await this.adbRootExec(deviceId, `settings put secure bluetooth_address ${bluetoothId}`);
            await this.adbRootExec(deviceId, `settings put secure wifi_ap_ssid ${wifiSsid}`);
            await this.adbRootExec(deviceId, `settings put secure wifi_ap_bssid ${wifiBssid}`);

            console.log(`[Spoofer] Changing live WiFi MAC → ${mac}`);
            await this.adbRootExec(deviceId,
                `ip link set wlan0 down 2>/dev/null; ip link set wlan0 address ${mac} 2>/dev/null; ip link set wlan0 up 2>/dev/null; true`);
            await this.adbRootExec(deviceId,
                `[ -f /efs/wifi/.mac.info ] && printf '%s' '${mac}' > /efs/wifi/.mac.info 2>/dev/null; true`);

            console.log(`[Spoofer] Setting Bluetooth MAC → ${bluetoothId}`);
            await this.adbRootExec(deviceId,
                `printf '[Adapter]\\nAddress = ${bluetoothId}\\n' > /data/misc/bluedroid/bt_config.conf 2>/dev/null; true`);
            await this.adbRootExec(deviceId,
                `printf '[Adapter]\\nAddress = ${bluetoothId}\\n' > /data/misc/bluedroid/bt_config.bak 2>/dev/null; true`);
            await this.adbRootExec(deviceId,
                `chown bluetooth:bluetooth /data/misc/bluedroid/bt_config.conf 2>/dev/null; chmod 660 /data/misc/bluedroid/bt_config.conf 2>/dev/null; true`);

            await this.adbRootExec(deviceId,
                `sqlite3 /data/data/com.google.android.gms/databases/databasemanager.db "UPDATE main SET value='${gaid}' WHERE key='advertising_id'" 2>/dev/null; true`
            );

            await this.adbRootExec(deviceId,
                `sqlite3 /data/data/com.google.android.gsf/databases/gservices.db "UPDATE main SET value='${gsfIdValue}' WHERE name='android_id'" 2>/dev/null; true`
            );

            await this.adbRootExec(deviceId,
                `sqlite3 /data/data/com.android.providers.telephony/databases/telephony.db "UPDATE siminfo SET icc_id='${simSerial}', number='${mobileNumber}', display_name='${simOperatorName}'" 2>/dev/null; true`
            );

            props.push(
                ['ro.boot.serialno',                    hwSerial],
                ['ro.serialno',                         hwSerial],
                ['ro.ril.oem.imei',                     imei],
                ['gsm.sim.operator.numeric',            mcc + mnc],
                ['gsm.sim.operator.alpha',              simOperatorName],
                ['gsm.sim.operator.iso-country',        simCountryIso],
                ['gsm.operator.numeric',                mcc + mnc],
                ['gsm.operator.alpha',                  simOperatorName],
                ['gsm.operator.iso-country',            simCountryIso],
                ['gsm.sim.state',                       'LOADED'],
                ['ro.boot.wifi.mac',                    mac],
                ['ro.wifi.bssid',                       wifiBssid],
                ['wifi.interface',                      'wlan0'],
                ['ro.boot.btmacaddr',                   bluetoothId],
                ['bluetooth.address',                   bluetoothId],
                ['ro.carrier',                          simOperatorName.toLowerCase().replace(/ /g, '_')],
                ['ro.com.google.clientidbase',          'android-' + profile.manufacturer.toLowerCase()],
                ['net.hostname',                        profile.device.toLowerCase() + '-' + this.randomHex(4)],
                ['media.drm.uuid',                      mediaDrmId],
                ['ro.telephony.default_network',        '9'],
                ['persist.radio.multisim.config',       'dsds'],
                ['ro.build.expect.bootloader',          profile.device.toLowerCase()],
            );


            // Magisk reads system.prop from /data/adb/modules/<id>/ at boot
            // and applies them via resetprop BEFORE Zygote starts → all apps see spoofed props

            this._lastAppliedProfile = {
                model: profile.model,
                manufacturer: profile.manufacturer,
                device: profile.device,
                fingerprint: profile.fingerprint,
                serial, imei, androidId, mac,
                android_version: av, security_patch: patch
            };

            const moduleProp = [
                `id=nova_spoof`,
                `name=Nova Identity Spoof`,
                `version=v${Date.now()}`,
                `versionCode=${Date.now()}`,
                `author=Nova`,
                `description=Persistent device identity: ${profile.name} (Android ${av})`
            ].join('\n');

            const systemProp = props
                .map(([k, v]) => `${k}=${v}`)
                .join('\n') + '\n';

            const serviceSh = `#!/system/bin/sh
# Nova Identity Spoof — 15-Step Deep Spoof (Boot Service)
# Runs at every boot AFTER Zygote starts — applies to all Java apps

# ── Wait for system to be fully booted before applying ──
SYS_BOOT=$(getprop sys.boot_completed)
if [ "$SYS_BOOT" != "1" ]; then
  sleep 5
fi

# Step 1-6: Model/Brand/Android already in system.prop (pre-Zygote)

# Step 7-8: IMEI — persistent props (ALL known paths, NO ril-daemon restart)
# This ensures *#06# reads spoofed IMEI after zygote restart
for p in ril.imei ril.imei1 ril.imei2 persist.radio.imei persist.radio.imei1 vendor.ril.imei vendor.ril.imei1 ro.ril.oem.imei ril.gsm.imei; do
  resetprop -p $p ${imei} 2>/dev/null
  resetprop $p ${imei} 2>/dev/null
done

# Samsung EFS (full reboot IMEI)
[ -d /efs/imei ] && printf '%s' '${imei}' > /efs/imei/nv_data.bin 2>/dev/null
[ -f /efs/.nv_imei ] && printf '%s' '${imei}' > /efs/.nv_imei 2>/dev/null
sync 2>/dev/null

# Trigger safe telephony refresh to make *#06# show new IMEI
am broadcast -a android.intent.action.SERVICE_STATE 2>/dev/null
am broadcast -a android.telephony.action.SUBSCRIPTION_CARRIER_IDENTITY_CHANGED 2>/dev/null

# Step 9: Secure Settings
settings put secure android_id ${androidId} 2>/dev/null

# Step 10: WiFi MAC
ip link set wlan0 down 2>/dev/null
ip link set wlan0 address ${mac} 2>/dev/null
ip link set wlan0 up 2>/dev/null
[ -f /efs/wifi/.mac.info ] && printf '%s' '${mac}' > /efs/wifi/.mac.info 2>/dev/null
settings put secure wifi_ap_bssid ${wifiBssid} 2>/dev/null
settings put secure wifi_ap_ssid ${wifiSsid} 2>/dev/null

# Step 11: Bluetooth MAC
printf '[Adapter]\nAddress = ${bluetoothId}\n' > /data/misc/bluedroid/bt_config.conf 2>/dev/null
printf '[Adapter]\nAddress = ${bluetoothId}\n' > /data/misc/bluedroid/bt_config.bak 2>/dev/null
chown bluetooth:bluetooth /data/misc/bluedroid/bt_config.conf 2>/dev/null
chmod 660 /data/misc/bluedroid/bt_config.conf 2>/dev/null
settings put secure bluetooth_address ${bluetoothId} 2>/dev/null

# Step 12: SIM Carrier (matched to ${profile.manufacturer})
resetprop gsm.sim.operator.alpha '${simOperatorName}' 2>/dev/null
resetprop gsm.operator.alpha '${simOperatorName}' 2>/dev/null
resetprop gsm.sim.operator.numeric '${mcc}${mnc}' 2>/dev/null
resetprop gsm.operator.numeric '${mcc}${mnc}' 2>/dev/null
resetprop gsm.sim.operator.iso-country '${simCountryIso}' 2>/dev/null

# Step 13: GMS Advertising ID
sqlite3 /data/data/com.google.android.gms/databases/databasemanager.db \
  "UPDATE main SET value='${gaid}' WHERE key='advertising_id'" 2>/dev/null

# Step 14: GSF / Play Store ID
sqlite3 /data/data/com.google.android.gsf/databases/gservices.db \
  "UPDATE main SET value='${gsfIdValue}' WHERE name='android_id'" 2>/dev/null

# Step 15: Telephony DB (SIM info)
sqlite3 /data/data/com.android.providers.telephony/databases/telephony.db \
  "UPDATE siminfo SET icc_id='${simSerial}', number='${mobileNumber}', display_name='${simOperatorName}'" 2>/dev/null

# Anti-detection flags
resetprop ro.debuggable 0 2>/dev/null
resetprop ro.secure 1 2>/dev/null
resetprop ro.adb.secure 1 2>/dev/null
resetprop ro.boot.verifiedbootstate green 2>/dev/null
resetprop ro.boot.flash.locked 1 2>/dev/null
resetprop sys.oem_unlock_allowed 0 2>/dev/null

# Flush GMS cache
am force-stop com.google.android.gms 2>/dev/null
stop traced 2>/dev/null

# ── NOVA CONFIRMATION: Show live toast on mobile screen ──
# Visible confirmation that spoof is active — user can see it on phone/Scrcpy
MODEL_NOW=\$(getprop ro.product.model)
IMEI_NOW=\$(getprop ril.imei)
am broadcast -a android.intent.action.BOOT_COMPLETED 2>/dev/null
# Toast via ADB notification (visible in Scrcpy)
cmd notification post -S bigtext -t 'NOVA Spoof Active' 'NovaSpoofTag' \"Model: $MODEL_NOW | IMEI: $IMEI_NOW\" 2>/dev/null

exit 0
`;
            const localMod = path.join(this.baseDir, 'nova_magisk_module');
            fs.mkdirSync(localMod, { recursive: true });
            fs.writeFileSync(path.join(localMod, 'module.prop'),  moduleProp,  'utf8');
            fs.writeFileSync(path.join(localMod, 'system.prop'),  systemProp,  'utf8');
            fs.writeFileSync(path.join(localMod, 'service.sh'),   serviceSh,   'utf8');

            await this.adbRootExec(deviceId, `mkdir -p /data/local/tmp/nova_magisk_module`);

            await this.adbPush(deviceId, path.join(localMod, 'module.prop'), '/data/local/tmp/nova_magisk_module/module.prop');
            await this.adbPush(deviceId, path.join(localMod, 'system.prop'), '/data/local/tmp/nova_magisk_module/system.prop');
            await this.adbPush(deviceId, path.join(localMod, 'service.sh'),  '/data/local/tmp/nova_magisk_module/service.sh');

            await this.adbRootExec(deviceId, `mkdir -p /data/adb/modules/nova_spoof`);
            await this.adbRootExec(deviceId, `cp /data/local/tmp/nova_magisk_module/module.prop /data/adb/modules/nova_spoof/module.prop`);
            await this.adbRootExec(deviceId, `cp /data/local/tmp/nova_magisk_module/system.prop /data/adb/modules/nova_spoof/system.prop`);
            await this.adbRootExec(deviceId, `cp /data/local/tmp/nova_magisk_module/service.sh /data/adb/modules/nova_spoof/service.sh`);
            
            await this.adbRootExec(deviceId, `rm -rf /data/local/tmp/nova_magisk_module`);

            await this.adbRootExec(deviceId, `chown -R root:root /data/adb/modules/nova_spoof`);
            await this.adbRootExec(deviceId, `chmod 755 /data/adb/modules/nova_spoof`);
            await this.adbRootExec(deviceId, `chmod 644 /data/adb/modules/nova_spoof/module.prop`);
            await this.adbRootExec(deviceId, `chmod 644 /data/adb/modules/nova_spoof/system.prop`);
            await this.adbRootExec(deviceId, `chmod 755 /data/adb/modules/nova_spoof/service.sh`);

            await this.adbRootExec(deviceId, `rm -f /data/adb/modules/nova_spoof/skip /data/adb/modules/nova_spoof/disable 2>/dev/null; true`);
            console.log(`[Spoofer] ✅ Magisk module installed: /data/adb/modules/nova_spoof/`);

            const tmpJsonPath = path.join(this.baseDir, 'nova_spoof.json');
            fs.writeFileSync(tmpJsonPath, JSON.stringify(spoofConfig, null, 2));
            await this.adbRootExec(deviceId, `mkdir -p /data/local/tmp`);
            await this.adbPush(deviceId, tmpJsonPath, '/data/local/tmp/nova_spoof.json');

            await this.adbRootExec(deviceId, `am force-stop com.google.android.gms 2>/dev/null; true`);

            console.log(`[Spoofer] ✅ Profile applied: ${profile.name} (Android ${av}) — Triggering crash-safe zygote reboot`);

            // We do NOT use setTimeout — wait inline so Scrcpy has time to recover.
            await new Promise(r => setTimeout(r, 1500));
            console.log(`[Spoofer] Issuing zygote restart on ${deviceId}...`);

            // Strategy: setprop ctl.restart zygote
            // ✔ Kernel stays alive  ✔ ADB stays alive  ✔ Input/touch events stay alive
            // ✔ Scrcpy connection survives  ✔ All Java framework restarts cleanly
            await this.adbRootExec(deviceId, `setprop ctl.restart zygote 2>/dev/null; true`);

            let zygoteReady = false;
            for (let i = 0; i < 20; i++) {
                await new Promise(r => setTimeout(r, 1000));
                const check = await this.adbRootExec(deviceId, `getprop init.svc.zygote`).catch(() => ({ output: '' }));
                const state = (check.output || '').trim();
                if (state === 'running') {
                    zygoteReady = true;
                    console.log(`[Spoofer] ✅ Zygote is running again after ${i + 1}s`);
                    break;
                }
            }

            if (!zygoteReady) {
                console.warn('[Spoofer] ⚠ Zygote did not report running in 20s — may still be booting');
            }

            await new Promise(r => setTimeout(r, 3000)); // let system_server settle
            const toastMsg = `NOVA SPOOF ✓ | ${profile.name} | IMEI: ${imei}`;
            await this.adbRootExec(deviceId,
                `cmd notification post -S bigtext -t 'NOVA Spoof Active' 'NovaSpoofTag' "${toastMsg}" 2>/dev/null; true`
            );
            await this.adbRootExec(deviceId,
                `log -t NOVA_SPOOF -p i "${toastMsg}" 2>/dev/null; true`
            );
            console.log(`[Spoofer] ✅ Mobile confirmation sent: ${toastMsg}`);

            return {
                success: true,
                applied: {
                    model: profile.name, fingerprint: profile.fingerprint,
                    serial, imei, androidId, mac, gaid, imsi,
                    android_version: av, security_patch: patch,
                    antiDetection: true,
                    deepImeiInjected: true,
                    confirmationSent: true
                }
            };

        } catch (err) {
            console.error('[Spoofer] Error applying profile:', err);
            return { success: false, error: err.message };
        }
    }

    async getGSFAndroidId(deviceId) {
        return new Promise((resolve) => {
            const cmd = `"${this.adbPath}" -s ${deviceId} shell content query --uri content://com.google.android.gsf.gservices/prefix --projection value: --where "name='android_id'"`;
            exec(cmd, { timeout: 8000 }, (err, stdout) => {
                if (err) {
                    const fallback = `"${this.adbPath}" -s ${deviceId} shell sqlite3 /data/data/com.google.android.gsf/databases/gservices.db "select value from main where name = 'android_id'"`;
                    exec(fallback, { timeout: 8000 }, (fbErr, fbOut) => {
                        if (fbErr) {
                            resolve({ success: false, error: 'Could not read GSF ID. Make sure device is rooted.' });
                        } else {
                            const raw = fbOut.trim();
                            const hexId = isNaN(raw) ? raw : BigInt(raw).toString(16).toUpperCase();
                            resolve({ success: true, gsfId: hexId, raw });
                        }
                    });
                } else {
                    const match = stdout.match(/value=([a-f0-9A-F]+)/i) || stdout.match(/value=(\d+)/);
                    if (match) {
                        const raw = match[1];
                        const hexId = /^\d+$/.test(raw) ? BigInt(raw).toString(16).toUpperCase() : raw.toUpperCase();
                        resolve({ success: true, gsfId: hexId, raw });
                    } else {
                        resolve({ success: false, error: 'GSF ID not found: ' + stdout.slice(0, 100) });
                    }
                }
            });
        });
    }

    async geoFromProxy(deviceId, proxy) {
        const geo = require('./geo-proxy');
        const id = String(deviceId || '');
        const proxyStr = String(proxy || '').trim();
        let ip = null;
        let via = 'aparelho';

        if (id.startsWith('ios-')) {
            try {
                const r = await this.iosProxyCheck(deviceId);
                const raw = r && r.success ? String(r.ip || '').trim() : '';
                if (/^\d{1,3}(\.\d{1,3}){3}$/.test(raw)) ip = raw;
            } catch (_) {}
        }

        if (!ip) {
            if (!proxyStr) {
                console.log('[Geo] sem IP de saída e sem proxy salvo');
                return { success: false, error: 'Sem proxy configurado. Salve a proxy primeiro.' };
            }
            via = 'proxy';
            try {
                const g = await geo.throughProxy(proxyStr);
                console.log(`[Geo] via proxy: ${g.ip} ${g.city}/${g.countryCode} ${g.lat},${g.lon}`);
                return { success: true, via, ...g };
            } catch (e) {
                return { success: false, error: String(e.message || e) };
            }
        }

        try {
            const g = await geo.byIp(ip);
            console.log(`[Geo] via ${via}: ${g.ip} ${g.city}/${g.countryCode} ${g.lat},${g.lon}`);
            return { success: true, via, ...g };
        } catch (e) {
            return { success: false, error: String(e.message || e) };
        }
    }

    idevicesetlocationPath() {
        const roots = [
            process.resourcesPath ? path.join(process.resourcesPath, 'bin') : null,
            '/opt/homebrew/bin',
            '/usr/local/bin',
            '/usr/bin'
        ].filter(Boolean);
        for (const root of roots) {
            const file = path.join(root, 'idevicesetlocation');
            try { fs.accessSync(file, fs.constants.X_OK); return file; } catch (_) {}
        }
        return null;
    }

    pymobiledevice3Path() {
        const candidates = [
            process.env.NOVA_PYMOBILEDEVICE3,
            path.join(os.homedir(), '.local', 'bin', 'pymobiledevice3'),
            '/opt/homebrew/bin/pymobiledevice3',
            '/usr/local/bin/pymobiledevice3'
        ].filter(Boolean);
        for (const c of candidates) {
            try { fs.accessSync(c, fs.constants.X_OK); return c; } catch (_) {}
        }
        return null;
    }

    mountDeveloperImage(udid) {
        return new Promise((resolve) => {
            const bin = this.pymobiledevice3Path();
            if (!bin) return resolve(false);
            execFile(bin, ['mounter', 'auto-mount', '--udid', udid], { timeout: 180000 }, (err) => resolve(!err));
        });
    }

    runIdevicesetlocation(udid, args, timeout = 30000) {
        return new Promise((resolve) => {
            const bin = this.idevicesetlocationPath();
            if (!bin) return resolve({ ok: false, error: 'idevicesetlocation não encontrado no Mac.' });
            execFile(bin, ['--udid', udid, ...args], { timeout }, (err, stdout, stderr) => {
                // idevicesetlocation imprime os erros no STDOUT (não no stderr); junta os dois
                const saida = [String(stderr || '').trim(), String(stdout || '').trim()].filter(Boolean).join('\n');
                resolve({ ok: !err, out: String(stdout || ''), err: saida || (err && err.message) || '' });
            });
        });
    }

    async iosSetLocation(deviceId, latitude, longitude) {
        const udid = String(deviceId || '').replace(/^ios-/, '');
        const tzAntes = await this.iosDeviceTimeZone();
        const mounted = await this.mountDeveloperImage(udid);
        if (!mounted) {
            return { success: false, error: 'O iPhone precisa da imagem de desenvolvedor montada. Instale pymobiledevice3 (pip install pymobiledevice3) e tente de novo.' };
        }
        const r = await this.runIdevicesetlocation(udid, ['--', String(latitude), String(longitude)]);
        if (!r.ok) {
            console.log(`[Geo] iPhone falhou: ${(r.err || '').slice(0, 160)}`);
            return { success: false, error: (r.err || 'Falha ao aplicar a localização no iPhone.').slice(0, 300) };
        }
        // O iOS ajusta o fuso sozinho a partir da localização; espera ele trocar (até ~8s).
        let timezone = tzAntes;
        for (let i = 0; i < 4; i++) {
            await new Promise((res) => setTimeout(res, 2000));
            const tz = await this.iosDeviceTimeZone();
            if (tz) {
                timezone = tz;
                if (tz !== tzAntes) break;
            }
        }
        console.log(`[Geo] iPhone GPS aplicado: ${latitude}, ${longitude} (fuso ${timezone || '?'})`);
        return { success: true, latitude, longitude, timezone, timezoneBefore: tzAntes };
    }

    async iosStopLocation(deviceId) {
        const udid = String(deviceId || '').replace(/^ios-/, '');
        const r = await this.runIdevicesetlocation(udid, ['reset'], 20000);
        if (!r.ok && /developer disk image|invalid service/i.test(r.err)) {
            return { success: true, note: 'GPS simulado removido junto com a imagem de desenvolvedor.' };
        }
        if (!r.ok) return { success: false, error: (r.err || '').slice(0, 300) };
        return { success: true };
    }

    languageForCountry(cc) {
        const map = {
            US: ['en-US', 'en_US'], GB: ['en-GB', 'en_GB'], CA: ['en-CA', 'en_CA'], AU: ['en-AU', 'en_AU'],
            NZ: ['en-NZ', 'en_NZ'], IE: ['en-IE', 'en_IE'], DE: ['de-DE', 'de_DE'], AT: ['de-AT', 'de_AT'],
            CH: ['de-CH', 'de_CH'], FR: ['fr-FR', 'fr_FR'], BE: ['fr-BE', 'fr_BE'], ES: ['es-ES', 'es_ES'],
            MX: ['es-MX', 'es_MX'], AR: ['es-AR', 'es_AR'], CO: ['es-CO', 'es_CO'], CL: ['es-CL', 'es_CL'],
            PE: ['es-PE', 'es_PE'], VE: ['es-VE', 'es_VE'], BR: ['pt-BR', 'pt_BR'], PT: ['pt-PT', 'pt_PT'],
            IT: ['it-IT', 'it_IT'], NL: ['nl-NL', 'nl_NL'], SE: ['sv-SE', 'sv_SE'], NO: ['nb-NO', 'nb_NO'],
            DK: ['da-DK', 'da_DK'], FI: ['fi-FI', 'fi_FI'], PL: ['pl-PL', 'pl_PL'], RU: ['ru-RU', 'ru_RU'],
            UA: ['uk-UA', 'uk_UA'], TR: ['tr-TR', 'tr_TR'], JP: ['ja-JP', 'ja_JP'], KR: ['ko-KR', 'ko_KR'],
            CN: ['zh-CN', 'zh_CN'], TW: ['zh-TW', 'zh_TW'], HK: ['zh-HK', 'zh_HK'], IN: ['en-IN', 'en_IN'],
            ID: ['id-ID', 'id_ID'], TH: ['th-TH', 'th_TH'], VN: ['vi-VN', 'vi_VN'], PH: ['en-PH', 'en_PH'],
            MY: ['ms-MY', 'ms_MY'], SG: ['en-SG', 'en_SG'], ZA: ['en-ZA', 'en_ZA'], AE: ['ar-AE', 'ar_AE'],
            SA: ['ar-SA', 'ar_SA'], IL: ['he-IL', 'he_IL'], EG: ['ar-EG', 'ar_EG'], NG: ['en-NG', 'en_NG']
        };
        const hit = map[String(cc || '').toUpperCase()] || ['en-US', 'en_US'];
        return { language: hit[0], locale: hit[1] };
    }

    iosLocaleStatus() {
        return this.iosSsh('cat /var/tmp/nova-locale-status.json 2>/dev/null').then((r) => {
            try { return JSON.parse(String(r.stdout || '').trim()); } catch (_) { return null; }
        });
    }

    async iosLocaleHelperReady() {
        const r = await this.iosSsh('test -f /var/jb/Library/LaunchDaemons/com.aquiles.novalocale.plist && test -f /var/jb/usr/libexec/nova-locale.sh && echo ok');
        return !!(r.ok && /ok/.test(r.stdout));
    }

    iosScp(args) {
        return new Promise((resolve, reject) => {
            execFile(require('./tool-paths').scp(), args, { timeout: 30000 }, (err, stdout, stderr) => {
                if (err) return reject(new Error(String(stderr || err.message).slice(0, 200)));
                resolve(true);
            });
        });
    }

    iosScpBase(remote, local, direction) {
        const base = ['-P', '2222', ...iphoneSsh.sshOptions(), '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-o', 'StrictHostKeyChecking=accept-new'];
        return direction === 'from'
            ? [...base, `mobile@127.0.0.1:${remote}`, local]
            : [...base, local, `mobile@127.0.0.1:${remote}`];
    }

    async iosBuildLocalePlist(language, locale) {
        const local = path.join(this.baseDir, 'nova-globalprefs.plist');
        await this.iosScp(this.iosScpBase('/var/mobile/Library/Preferences/.GlobalPreferences.plist', local, 'from'));
        await plistPrefs.aplicarIdiomaLocale(local, language, locale);
        await this.iosScp(this.iosScpBase('/var/tmp/nova-gp.plist', local, 'to'));
        return local;
    }

    async iosSendLocaleCommand(fields) {
        await this.iosSsh('rm -f /var/tmp/nova-locale-status.json');
        const local = path.join(this.baseDir, 'nova-locale.cmd');
        fs.writeFileSync(local, Object.entries(fields).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
        await this.iosScp(this.iosScpBase('/var/tmp/nova-locale.cmd', local, 'to'));
    }

    async iosWaitLocaleStatus(timeoutMs = 25000) {
        const t0 = Date.now();
        while (Date.now() - t0 < timeoutMs) {
            await new Promise((r) => setTimeout(r, 1200));
            const st = await this.iosLocaleStatus();
            if (st && typeof st.ok === 'boolean') return st;
        }
        return null;
    }

    async iosPlistLanguage() {
        const local = path.join(this.baseDir, 'nova-globalprefs-check.plist');
        await this.iosScp(this.iosScpBase('/var/mobile/Library/Preferences/.GlobalPreferences.plist', local, 'from'));
        return plistPrefs.lerPrimeiroIdioma(local);
    }

    // Idioma: o iOS 16 só troca de verdade pela tela de Ajustes — escrever o plist
    // (mesmo com cfprefsd morto e respring) não muda o idioma efetivo. Por isso aqui
    // só aplicamos o FUSO (determinístico) e não mexemos mais no idioma.
    async iosApplyLocale(deviceId, timezone) {
        if (!String(deviceId || '').startsWith('ios-')) return { success: false, error: 'Só para iPhone.' };
        if (!(await this.iosLocaleHelperReady())) {
            return { success: false, error: 'helper-not-installed', language: null };
        }
        const tz = timezone && /^[A-Za-z0-9_+\/-]+$/.test(timezone) ? timezone : '';
        if (!tz) return { success: false, error: 'sem fuso para aplicar' };
        try {
            // Se o fuso do aparelho já é o pedido, não manda comando (evita respring à toa)
            const tzAntes = await this.iosDeviceTimeZone();
            if (tzAntes === tz) return { success: true, timezone: tz, message: 'fuso já estava certo' };
            await this.iosSendLocaleCommand({ action: 'apply', tz });
            const st = await this.iosWaitLocaleStatus();
            const tzAtual = await this.iosDeviceTimeZone();
            console.log(`[Locale] tz pedido=${tz} aparelho=${tzAtual} status=${st && st.message}`);
            if (tzAtual === tz) return { success: true, timezone: tzAtual, message: 'fuso aplicado' };
            return { success: false, error: `fuso ${tzAtual || '?'} ≠ ${tz}`, timezone: tzAtual };
        } catch (e) {
            return { success: false, error: String(e.message || e) };
        }
    }

    async iosRevertLocale(deviceId) {
        if (!String(deviceId || '').startsWith('ios-')) return { success: true };
        if (!(await this.iosLocaleHelperReady())) return { success: false, error: 'helper-not-installed' };
        try {
            await this.iosSendLocaleCommand({ action: 'revert' });
            const st = await this.iosWaitLocaleStatus(20000);
            if (st && st.ok) return { success: true, message: st.message };
            return { success: false, error: (st && st.message) || 'helper não respondeu' };
        } catch (e) {
            return { success: false, error: String(e.message || e) };
        }
    }

    async setSpoofLocation(deviceId, latitude, longitude) {
        if (String(deviceId || '').startsWith('ios-')) {
            return this.iosSetLocation(deviceId, latitude, longitude);
        }
        try {
            console.log(`[Spoofer] Setting persistent fake GPS: ${latitude}, ${longitude}`);

            await this.adbRootExec(deviceId, `pkill -f nova_gps_loop 2>/dev/null; true`);
            await new Promise(r => setTimeout(r, 300));

            await this.adbRootExec(deviceId, `settings put secure mock_location 1`);
            await this.adbRootExec(deviceId, `settings put global development_settings_enabled 1`);

            const ts = `$(date +%s%3N)`;
            const gpsScript = `#!/system/bin/sh
# Nova GPS Spoof Loop — nova_gps_loop
LAT="${latitude}"
LNG="${longitude}"
while true; do
  # Inject via platform cmd (Android 8+ / rooted)
  cmd location set-test-provider-enabled gps true 2>/dev/null
  cmd location set-test-provider-location gps --lat $LAT --lng $LNG --accuracy 3.0 --altitude 50 --speed 0.0 --bearing 0.0 --time ${ts} 2>/dev/null
  cmd location set-test-provider-enabled network true 2>/dev/null
  cmd location set-test-provider-location network --lat $LAT --lng $LNG --accuracy 20.0 --altitude 50 --speed 0.0 --bearing 0.0 --time ${ts} 2>/dev/null
  cmd location set-test-provider-enabled fused true 2>/dev/null
  cmd location set-test-provider-location fused --lat $LAT --lng $LNG --accuracy 1.0 --altitude 50 --speed 0.0 --bearing 0.0 --time ${ts} 2>/dev/null
  sleep 2
done
`;
            const scriptPath = path.join(this.baseDir, 'nova_gps_loop.sh');
            fs.writeFileSync(scriptPath, gpsScript.replace(/\r\n/g, '\n'));
            await this.adbPush(deviceId, scriptPath, '/data/local/tmp/nova_gps_loop.sh');
            await this.adbRootExec(deviceId, `chmod +x /data/local/tmp/nova_gps_loop.sh`);

            await this.adbRootExec(deviceId,
                `nohup sh /data/local/tmp/nova_gps_loop.sh >/data/local/tmp/nova_gps.log 2>&1 &`
            );

            const tmpJsonPath = path.join(this.baseDir, 'nova_spoof.json');
            let cfg = {};
            try { cfg = JSON.parse(fs.readFileSync(tmpJsonPath, 'utf8')); } catch(_){}
            cfg.latitude = latitude; cfg.longitude = longitude; cfg.altitude = 50.0;
            fs.writeFileSync(tmpJsonPath, JSON.stringify(cfg, null, 2));
            await this.adbPush(deviceId, tmpJsonPath, '/data/local/tmp/nova_spoof.json');

            console.log(`[Spoofer] ✅ GPS loop started: ${latitude}, ${longitude}`);
            return { success: true, latitude, longitude };

        } catch (err) {
            console.error('[Spoofer] GPS error:', err);
            return { success: false, error: err.message };
        }
    }

    async stopFakeGPS(deviceId) {
        if (String(deviceId || '').startsWith('ios-')) {
            return this.iosStopLocation(deviceId);
        }
        await this.adbRootExec(deviceId, `pkill -f nova_gps_loop 2>/dev/null; true`);
        await this.adbRootExec(deviceId, `cmd location set-test-provider-enabled gps false 2>/dev/null; true`);
        await this.adbRootExec(deviceId, `cmd location set-test-provider-enabled network false 2>/dev/null; true`);
        await this.adbRootExec(deviceId, `cmd location set-test-provider-enabled fused false 2>/dev/null; true`);
        return { success: true };
    }

    // ✔ Kernel stays alive  ✔ ADB stays alive  ✔ Input/touch/mouse stays alive
    // ✔ Scrcpy connection survives  ✔ All Java framework restarts cleanly
    async rebootDevice(deviceId, mode = 'soft') {
        try {
            if (mode === 'hard') {
                await this.adbRootExec(deviceId, `reboot`);
                return { success: true, mode: 'hard' };
            }

            console.log(`[Spoofer] Zygote-only soft reboot on ${deviceId}`);
            await this.adbRootExec(deviceId, `setprop ctl.restart zygote 2>/dev/null; true`);

            // ── FIX 2: Poll zygote state properly — wait until 'running' or 20s timeout
            // This prevents returning too early (which caused Scrcpy mouse loss)
            let zygoteState = 'unknown';
            for (let i = 0; i < 20; i++) {
                await new Promise(r => setTimeout(r, 1000));
                const check = await this.adbRootExec(deviceId, `getprop init.svc.zygote`).catch(() => ({ output: '' }));
                zygoteState = (check.output || '').trim();
                if (zygoteState === 'running') {
                    console.log(`[Spoofer] ✅ Zygote running after ${i + 1}s — mouse control OK`);
                    break;
                }
            }

            // Extra 2s for input service to stabilise — keeps Scrcpy mouse alive
            await new Promise(r => setTimeout(r, 2000));

            return { success: true, mode: 'soft-zygote', zygoteState };

        } catch (err) {
            console.error('[Spoofer] rebootDevice error:', err);
            return { success: false, error: err.message };
        }
    }

    async resetSpoof(deviceId) {
        try {
            await this.stopFakeGPS(deviceId);
            await this.adbRootExec(deviceId, `rm -f /data/local/tmp/nova_spoof.json 2>/dev/null; true`);
            await this.adbRootExec(deviceId, `rm -f /data/local/tmp/nova_gps_loop.sh 2>/dev/null; true`);
            await this.adbRootExec(deviceId, `rm -rf /data/adb/modules/nova_spoof 2>/dev/null; true`);
            // Hard reboot to restore original props from boot image
            await this.rebootDevice(deviceId, 'hard');
            return { success: true, message: 'Reiniciando dispositivo para restaurar a identidade real...' };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    async applyDualIMEI(deviceId, imei1, imei2) {
        try {
            if (!imei1 || imei1.length !== 15) return { success: false, error: 'IMEI 1 must be exactly 15 digits.' };
            if (!imei2 || imei2.length !== 15) return { success: false, error: 'IMEI 2 must be exactly 15 digits.' };

            console.log(`[Spoofer] Applying Dual IMEI: SIM1=${imei1} SIM2=${imei2} on ${deviceId}`);

            const slot1Props = [
                ['ril.imei',              imei1],
                ['ril.imei1',             imei1],
                ['persist.radio.imei',    imei1],
                ['persist.radio.imei1',   imei1],
                ['vendor.ril.imei',       imei1],
                ['vendor.ril.imei1',      imei1],
                ['ro.ril.oem.imei',       imei1],
            ];
            const slot2Props = [
                ['ril.imei2',             imei2],
                ['persist.radio.imei2',   imei2],
                ['vendor.ril.imei2',      imei2],
                ['ro.ril.oem.imei2',      imei2],
            ];

            const allProps = [...slot1Props, ...slot2Props];

            for (const [key, val] of allProps) {
                await this.adbRootExec(deviceId, `resetprop "${key}" "${val}" 2>/dev/null; true`);
            }

            const existingMod = `/data/adb/modules/nova_spoof/system.prop`;
            const imeiLines = allProps.map(([k, v]) => `${k}=${v}`).join('\n') + '\n';

            // Append/update dual IMEI lines in existing module (sed remove old ril.imei lines, then append)
            await this.adbRootExec(deviceId,
                `grep -v '^ril.imei\|^persist.radio.imei\|^vendor.ril.imei\|^ro.ril.oem.imei' ${existingMod} > /data/local/tmp/sp_tmp.prop 2>/dev/null; true`
            );
            const appendCmd = imeiLines.split('\n').filter(Boolean)
                .map(line => `echo '${line}' >> /data/local/tmp/sp_tmp.prop`).join('; ');
            await this.adbRootExec(deviceId, appendCmd);
            await this.adbRootExec(deviceId,
                `cp /data/local/tmp/sp_tmp.prop ${existingMod} 2>/dev/null; true`
            );

            console.log(`[Spoofer] ✅ Dual IMEI applied. Triggering soft reboot...`);
            setTimeout(() => this.rebootDevice(deviceId, 'soft'), 1500);

            return { success: true, imei1, imei2 };
        } catch (err) {
            console.error('[Spoofer] applyDualIMEI error:', err);
            return { success: false, error: err.message };
        }
    }

    async generateRandomProfile(deviceId, preferredBrand = null) {
        try {
            const db = this.getSpooferDatabase();
            const brandNames = Object.keys(db.brands);
            if (!brandNames.length) return { success: false, error: 'Spoofer database empty.' };

            let brand = preferredBrand && db.brands[preferredBrand] ? preferredBrand
                : brandNames[Math.floor(Math.random() * brandNames.length)];

            const models = db.brands[brand];
            const profile = models[Math.floor(Math.random() * models.length)];

            console.log(`[Spoofer] Auto-generating profile: ${brand} — ${profile.name}`);

            const result = await this.applySpoofProfile(deviceId, brand, profile.model, null);
            if (result.success) {
                result.generated = { brand, model: profile.model, name: profile.name };
            }
            return result;
        } catch (err) {
            console.error('[Spoofer] generateRandomProfile error:', err);
            return { success: false, error: err.message };
        }
    }

    async verifyAppliedProfile(deviceId) {
        try {
            console.log(`[Spoofer] Verifying applied identity on ${deviceId}...`);

            const read = async (cmd) => {
                const res = await this.adbRootExec(deviceId, cmd);
                return (res.output || '').trim();
            };

            const [liveModel, liveMfr, liveFingerprint, liveSerial,
                   liveImei1, liveImei2, liveAndroidId, liveMac,
                   liveAndroidVer, livePatch, liveDebugFlag, liveSecure,
                   liveBuildType, liveVerifiedBoot] = await Promise.all([
                read(`getprop ro.product.model`),
                read(`getprop ro.product.manufacturer`),
                read(`getprop ro.build.fingerprint`),
                read(`getprop ro.serialno`),
                read(`getprop ril.imei`),
                read(`getprop ril.imei2`),
                read(`settings get secure android_id`),
                read(`cat /sys/class/net/wlan0/address 2>/dev/null || getprop ro.boot.wifi.mac`),
                read(`getprop ro.build.version.release`),
                read(`getprop ro.build.version.security_patch`),
                read(`getprop ro.debuggable`),
                read(`getprop ro.secure`),
                read(`getprop ro.build.type`),
                read(`getprop ro.boot.verifiedbootstate`),
            ]);

            const expected = this._lastAppliedProfile || {};

            const results = [
                { field: 'Model',              expected: expected.model      || '—', live: liveModel,       ok: !expected.model      || liveModel      === expected.model },
                { field: 'Manufacturer',       expected: expected.manufacturer || '—', live: liveMfr,        ok: !expected.manufacturer || liveMfr.toLowerCase() === (expected.manufacturer||'').toLowerCase() },
                { field: 'Serial',             expected: expected.serial     || '—', live: liveSerial,      ok: !expected.serial     || liveSerial     === expected.serial },
                { field: 'IMEI (SIM 1)',        expected: expected.imei      || '—', live: liveImei1,       ok: !expected.imei       || liveImei1      === expected.imei },
                { field: 'IMEI (SIM 2)',        expected: '(any)',                   live: liveImei2,       ok: true },
                { field: 'Android ID',         expected: expected.androidId  || '—', live: liveAndroidId,   ok: !expected.androidId  || liveAndroidId  === expected.androidId },
                { field: 'Android Version',    expected: expected.android_version || '—', live: liveAndroidVer, ok: true },
                { field: 'Security Patch',     expected: expected.security_patch || '—', live: livePatch,   ok: true },
                { field: 'ro.debuggable',      expected: '0',  live: liveDebugFlag,    ok: liveDebugFlag   === '0' },
                { field: 'ro.secure',          expected: '1',  live: liveSecure,       ok: liveSecure      === '1' },
                { field: 'Build Type',         expected: 'user', live: liveBuildType,  ok: liveBuildType   === 'user' },
                { field: 'Verified Boot',      expected: 'green', live: liveVerifiedBoot, ok: liveVerifiedBoot === 'green' },
            ];

            const passCount = results.filter(r => r.ok).length;
            const total = results.length;

            console.log(`[Spoofer] Verification: ${passCount}/${total} checks passed`);
            return { success: true, results, passCount, total };

        } catch (err) {
            console.error('[Spoofer] verifyAppliedProfile error:', err);
            return { success: false, error: err.message };
        }
    }


    /**
     * getCamSpoofStatus — Check if nova-cam-spoofer APK is installed on device
     */
    iosCamera() {
        if (!this._iosCamera) this._iosCamera = new (require('./ios-camera'))(this);
        return this._iosCamera;
    }

    async getCamSpoofStatus(deviceId) {
        if (String(deviceId).startsWith('ios-')) return this.iosCamera().status();
        return new Promise((resolve) => {
            if (!fs.existsSync(this.adbPath)) {
                resolve({ installed: false, active: false, error: 'ADB missing.' });
                return;
            }
            const cmd = `"${this.adbPath}" -s ${deviceId} shell pm list packages com.nova.camspoofer`;
            exec(cmd, (err, stdout) => {
                const installed = stdout && stdout.includes('com.nova.camspoofer');
                resolve({ installed, active: false });
            });
        });
    }

    /**
     * installCamSpoofer — Push and install the nova-cam-spoofer.apk onto device via ADB
     * The APK must be located at: resources/nova-cam-spoofer.apk (relative to app root)
     */
    async installCamSpoofer(deviceId) {
        if (String(deviceId).startsWith('ios-')) return this.iosCamera().install();
        return new Promise((resolve) => {
            if (!fs.existsSync(this.adbPath)) {
                resolve({ success: false, error: 'ADB not found. Please install ADB tools first.' });
                return;
            }

            const apkPath = path.join(process.cwd(), 'resources', 'nova-cam-spoofer.apk');
            const altApkPath = path.join(__dirname, '..', '..', 'resources', 'nova-cam-spoofer.apk');
            const packagedApkPath = path.join(process.resourcesPath || '', 'nova-cam-spoofer.apk');
            const finalApkPath = [packagedApkPath, apkPath, altApkPath].find(p => fs.existsSync(p)) || altApkPath;

            if (!fs.existsSync(finalApkPath)) {
                resolve({ success: false, error: `APK not found at: ${finalApkPath}. Please compile the Android module first using the provided PowerShell script.` });
                return;
            }

            console.log(`[CamSpoof] Installing nova-cam-spoofer.apk on device ${deviceId}...`);
            const cmd = `"${this.adbPath}" -s ${deviceId} install -r -g "${finalApkPath}"`;

            exec(cmd, { timeout: 60000 }, (err, stdout, stderr) => {
                if (err || (stdout && stdout.toLowerCase().includes('failure'))) {
                    console.error('[CamSpoof] Install failed:', stderr || stdout);
                    resolve({ success: false, error: stderr || stdout || 'APK installation failed.' });
                } else {
                    console.log('[CamSpoof] APK installed successfully:', stdout);
                    resolve({ success: true, message: 'nova-cam-spoofer instalado com sucesso!' });
                }
            });
        });
    }

    /**
     * startCamSpoof — Push selected video/picture to device and activate camera spoofing across all apps
     * @param {string} deviceId - ADB device ID
     * @param {string} videoPath - Local path to the fake camera video (.mp4) or photo (.jpg/.png/.bmp)
     */
    async startCamSpoof(deviceId, videoPath) {
        if (String(deviceId).startsWith('ios-')) return this.iosCamera().startCamSpoof(videoPath);
        try {
            if (!fs.existsSync(this.adbPath)) {
                return { success: false, error: 'ADB not found. Please connect device.' };
            }
            if (!videoPath || !fs.existsSync(videoPath)) {
                return { success: false, error: `Media file not found: ${videoPath}` };
            }

            const ext = path.extname(videoPath).toLowerCase();
            const isImage = ['.jpg', '.jpeg', '.png', '.bmp'].includes(ext);

            console.log(`[CamSpoof] Preparing ${isImage ? 'IMAGE' : 'VIDEO'} camera hijack for device ${deviceId}...`);

            await new Promise((resolve) => {
                const mkCmd = `"${this.adbPath}" -s ${deviceId} shell "mkdir -p /sdcard/DCIM/Camera1 /sdcard/DCIM/Camera /sdcard/DCIM"`;
                exec(mkCmd, { timeout: 10000 }, () => resolve());
            });

            const pushTargets = isImage ? [
                '/sdcard/DCIM/Camera1/virtual.bmp',
                '/sdcard/DCIM/Camera1/virtual.jpg',
                '/sdcard/DCIM/Camera1/virtual.png',
                '/sdcard/nova_fake_cam.jpg',
                '/sdcard/DCIM/Camera/virtual.jpg'
            ] : [
                '/sdcard/DCIM/Camera1/virtual.mp4',
                '/sdcard/nova_fake_cam.mp4',
                '/sdcard/DCIM/Camera/virtual.mp4',
                '/sdcard/DCIM/virtual.mp4'
            ];

            for (const target of pushTargets) {
                console.log(`[CamSpoof] Pushing to ${target}...`);
                await this.adbPush(deviceId, videoPath, target).catch(() => {});
            }

            await new Promise((resolve) => {
                const chCmd = `"${this.adbPath}" -s ${deviceId} shell "chmod -R 777 /sdcard/DCIM/Camera1 /sdcard/nova_fake_cam* /sdcard/DCIM/Camera"`;
                exec(chCmd, { timeout: 8000 }, () => resolve());
            });

            const primaryPath = isImage ? '/sdcard/DCIM/Camera1/virtual.jpg' : '/sdcard/DCIM/Camera1/virtual.mp4';
            const novaPath = isImage ? '/sdcard/nova_fake_cam.jpg' : '/sdcard/nova_fake_cam.mp4';

            const broadcastCommands = [
                `am broadcast -a com.nova.action.START_SPOOF_CAM --es video_path '${novaPath}'`,
                `am broadcast -a com.vcam.action.SET_VIDEO --es path '${primaryPath}'`,
                `am broadcast -a com.vcam.action.SET_PICTURE --es path '${primaryPath}'`,
                `am broadcast -a com.vcam.action.ENABLE_VCAM`,
                `am broadcast -a com.fakecam.action.START --es path '${primaryPath}'`
            ];

            for (const bCmd of broadcastCommands) {
                await new Promise((resolve) => {
                    const suCmd = `"${this.adbPath}" -s ${deviceId} shell su -c "${bCmd}"`;
                    exec(suCmd, { timeout: 5000 }, (err) => {
                        if (err) {
                            const normalCmd = `"${this.adbPath}" -s ${deviceId} shell ${bCmd}`;
                            exec(normalCmd, { timeout: 5000 }, () => resolve());
                        } else {
                            resolve();
                        }
                    });
                });
            }

            console.log(`[CamSpoof] ✅ Camera spoof activated successfully for device ${deviceId}!`);
            return {
                success: true,
                message: `Hardware Camera Hijacked! Open ANY app (WhatsApp, Camera, Instagram, Chrome, KYC) — your ${isImage ? 'photo' : 'video'} will play live!`
            };

        } catch (err) {
            console.error('[CamSpoof] startCamSpoof error:', err);
            return { success: false, error: err.message };
        }
    }

    /**
     * stopCamSpoof — Send stop broadcast to restore real camera
     */
    async stopCamSpoof(deviceId) {
        if (String(deviceId).startsWith('ios-')) return this.iosCamera().stopCamSpoof();
        return new Promise((resolve) => {
            if (!fs.existsSync(this.adbPath)) {
                resolve({ success: false, error: 'ADB not found.' });
                return;
            }

            console.log(`[CamSpoof] Sending STOP broadcast to device ${deviceId}...`);
            const cmd = `"${this.adbPath}" -s ${deviceId} shell su -c "am broadcast -a com.nova.action.STOP_SPOOF_CAM"`;

            exec(cmd, { timeout: 15000 }, (err, stdout, stderr) => {
                if (err) {
                    const fallback = `"${this.adbPath}" -s ${deviceId} shell am broadcast -a com.nova.action.STOP_SPOOF_CAM`;
                    exec(fallback, { timeout: 10000 }, (fbErr, fbOut) => {
                        if (fbErr) {
                            resolve({ success: false, error: 'Stop broadcast failed.' });
                        } else {
                            resolve({ success: true, message: 'Câmera real restaurada com sucesso.' });
                        }
                    });
                } else {
                    resolve({ success: true, message: 'Câmera real restaurada com sucesso.' });
                }
            });
        });
    }

    //  LIVE STREAM ENGINE — MJPEG over ADB Reverse Port Tunnel
    //  PC runs HTTP MJPEG server on :8899 → ADB reverse → phone localhost:8899
    //  LSPosed module reads frames from http://127.0.0.1:8899/stream
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * startLiveStream — Start MJPEG HTTP server + ADB reverse tunnel
     * @param {string} deviceId  ADB device serial
     * @param {number} port      Local port (default 8899)
     */
    async startLiveStream(deviceId, port = 8899) {
        if (String(deviceId).startsWith('ios-')) return this.iosCamera().start();
        try {
            if (!fs.existsSync(this.adbPath)) {
                return { success: false, error: 'ADB not found. Install it from Phone Control tab.' };
            }

            await this.stopLiveStream(deviceId);

            const http = require('http');

            this._mjpegClients   = [];
            this._mjpegPort      = port;
            this._mjpegDeviceId  = deviceId;
            this._mjpegFrameCount = 0;

            this._mjpegServer = http.createServer((req, res) => {
                if (req.url === '/stream' || req.url === '/') {
                    res.writeHead(200, {
                        'Content-Type':  'multipart/x-mixed-replace; boundary=--novacamboundary',
                        'Cache-Control': 'no-cache, no-store, must-revalidate',
                        'Pragma':        'no-cache',
                        'Connection':    'keep-alive',
                        'Access-Control-Allow-Origin': '*',
                    });

                    this._mjpegClients.push(res);
                    console.log(`[LiveStream] Client connected. Total: ${this._mjpegClients.length}`);

                    req.on('close', () => {
                        this._mjpegClients = this._mjpegClients.filter(c => c !== res);
                        console.log(`[LiveStream] Client disconnected. Remaining: ${this._mjpegClients.length}`);
                    });

                    req.on('error', () => {
                        this._mjpegClients = this._mjpegClients.filter(c => c !== res);
                    });

                } else if (req.url === '/ping') {
                    res.writeHead(200, { 'Content-Type': 'text/plain' });
                    res.end(`Nova Live Cam Stream OK — frames: ${this._mjpegFrameCount}`);
                } else {
                    res.writeHead(404);
                    res.end();
                }
            });

            await new Promise((resolve, reject) => {
                this._mjpegServer.listen(port, '127.0.0.1', () => {
                    console.log(`[LiveStream] MJPEG server listening on 127.0.0.1:${port}`);
                    resolve();
                });
                this._mjpegServer.on('error', reject);
            });

            const reverseResult = await new Promise((resolve) => {
                const cmd = `"${this.adbPath}" -s ${deviceId} reverse tcp:${port} tcp:${port}`;
                exec(cmd, { timeout: 15000 }, (err, stdout, stderr) => {
                    if (err) {
                        console.warn(`[LiveStream] ADB reverse warning (may still work): ${err.message}`);
                        resolve({ ok: false, error: err.message });
                    } else {
                        console.log(`[LiveStream] ADB reverse tcp:${port} <- tcp:${port} established`);
                        resolve({ ok: true });
                    }
                });
            });

            const broadcastCmd = `"${this.adbPath}" -s ${deviceId} shell am broadcast -a com.nova.action.START_LIVE_STREAM --es stream_url "http://127.0.0.1:${port}/stream"`;
            exec(broadcastCmd, { timeout: 15000 }, (err, stdout) => {
                if (err) {
                    const suCmd = `"${this.adbPath}" -s ${deviceId} shell su -c "am broadcast -a com.nova.action.START_LIVE_STREAM --es stream_url 'http://127.0.0.1:${port}/stream'"`;
                    exec(suCmd, { timeout: 15000 }, () => {});
                }
                console.log(`[LiveStream] START_LIVE_STREAM broadcast sent → stream: http://127.0.0.1:${port}/stream`);
            });

            return {
                success: true,
                port,
                reverseOk: reverseResult.ok,
                message: `Live stream started on port ${port}. Phone camera will show PC canvas in real-time.`,
            };

        } catch (err) {
            console.error('[LiveStream] startLiveStream error:', err);
            return { success: false, error: err.message };
        }
    }

    /**
     * pushLiveFrame — Push a JPEG frame (base64) to all connected MJPEG clients
     * Called by IPC handler at ~30fps from VirtualCamPanel canvas capture
     * @param {string} base64jpeg  Base64-encoded JPEG image
     */
    pushLiveFrame(base64jpeg) {
        if (this._iosCamera && this._iosCamera.server) this._iosCamera.pushFrame(base64jpeg);
        if (!this._mjpegServer || !this._mjpegClients || this._mjpegClients.length === 0) return;

        try {
            const buf    = Buffer.from(base64jpeg, 'base64');
            const header = `--novacamboundary\r\nContent-Type: image/jpeg\r\nContent-Length: ${buf.length}\r\n\r\n`;
            const tail   = '\r\n';

            const deadClients = [];
            for (const client of this._mjpegClients) {
                try {
                    if (!client.writableEnded) {
                        client.write(header);
                        client.write(buf);
                        client.write(tail);
                    } else {
                        deadClients.push(client);
                    }
                } catch (e) {
                    deadClients.push(client);
                }
            }
            if (deadClients.length > 0) {
                this._mjpegClients = this._mjpegClients.filter(c => !deadClients.includes(c));
            }
            this._mjpegFrameCount++;
        } catch (err) {
            console.warn('[LiveStream] pushLiveFrame error:', err.message);
        }
    }

    /**
     * stopLiveStream — Stop MJPEG server + remove ADB reverse tunnel
     * @param {string} deviceId
     */
    async stopLiveStream(deviceId) {
        if (String(deviceId).startsWith('ios-')) return this.iosCamera().stop();
        try {
            const port = this._mjpegPort || 8899;

            if (deviceId && fs.existsSync(this.adbPath)) {
                const stopCmd = `"${this.adbPath}" -s ${deviceId} shell am broadcast -a com.nova.action.STOP_LIVE_STREAM`;
                exec(stopCmd, { timeout: 10000 }, () => {});

                const removeCmd = `"${this.adbPath}" -s ${deviceId} reverse --remove tcp:${port}`;
                exec(removeCmd, { timeout: 10000 }, () => {});
                console.log(`[LiveStream] ADB reverse tcp:${port} removed`);
            }

            if (this._mjpegClients) {
                for (const client of this._mjpegClients) {
                    try { client.end(); } catch (e) {}
                }
                this._mjpegClients = [];
            }

            if (this._mjpegServer) {
                await new Promise((resolve) => {
                    this._mjpegServer.close(() => resolve());
                    setTimeout(resolve, 2000); // Force close after 2s
                });
                this._mjpegServer = null;
                console.log('[LiveStream] MJPEG server stopped');
            }

            this._mjpegFrameCount = 0;
            return { success: true, message: 'Transmissão ao vivo parada. Câmera real restaurada.' };

        } catch (err) {
            console.error('[LiveStream] stopLiveStream error:', err);
            return { success: false, error: err.message };
        }
    }

    //  FRIDA DEEP INJECT — Hardware-level camera replacement
    //  Starts frida-server on phone, spawns target app with camera hook
    //  Works for Camera1 + Camera2, ALL apps, Android 9-14

    /**
     * fridaInject — Start frida-server on phone + inject camera hook into app
     * @param {string} deviceId  ADB device serial
     * @param {string} appName   Short app name (tiktok, whatsapp, etc.)
     */
    async fridaInject(deviceId, appName) {
        try {
            const APP_PACKAGES = {
                tiktok:    'com.zhiliaoapp.musically',
                whatsapp:  'com.whatsapp',
                instagram: 'com.instagram.android',
                snapchat:  'com.snapchat.android',
                chrome:    'com.android.chrome',
                telegram:  'org.telegram.messenger',
                zoom:      'us.zoom.videomeetings',
            };

            const packageName = APP_PACKAGES[appName] || appName;
            const scriptPath  = path.join(__dirname, '../../resources/frida/nova_camera_inject.js');
            const fridaServer = path.join(__dirname, '../../resources/frida/frida-server');
            const launcherPy  = path.join(__dirname, '../../resources/frida/nova_frida_launcher.py');

            if (!fs.existsSync(scriptPath)) {
                return { success: false, error: 'Frida script not found. Resources missing.' };
            }

            const adb = this.adbPath;

            if (fs.existsSync(fridaServer)) {
                console.log('[Frida] Pushing frida-server to phone...');
                await new Promise((resolve) => {
                    exec(`"${adb}" -s ${deviceId} push "${fridaServer}" /data/local/tmp/frida-server`,
                        { timeout: 30000 }, () => resolve());
                });
                await new Promise((resolve) => {
                    exec(`"${adb}" -s ${deviceId} shell "su -c 'chmod +x /data/local/tmp/frida-server'"`,
                        { timeout: 10000 }, () => resolve());
                });
            }

            await new Promise((resolve) => {
                exec(`"${adb}" -s ${deviceId} shell "su -c 'pkill frida-server 2>/dev/null; sleep 1; nohup /data/local/tmp/frida-server &'"`,
                    { timeout: 15000 }, () => resolve());
            });
            console.log('[Frida] frida-server started on phone');

            await new Promise(r => setTimeout(r, 2000));

            await new Promise((resolve) => {
                exec(`"${adb}" -s ${deviceId} forward tcp:27042 tcp:27042`,
                    { timeout: 10000 }, () => resolve());
            });

            const { spawn: spawnProc } = require('child_process');
            console.log(`[Frida] Injecting into ${packageName}...`);

            let fridaCmd, fridaArgs;

            fridaCmd = 'frida';
            fridaArgs = [
                '-U', '-f', packageName,
                '-l', scriptPath,
                '--runtime=v8'
            ];

            console.log(`[Frida] Command: frida ${fridaArgs.join(' ')}`);

            const fridaProc = spawnProc(fridaCmd, fridaArgs, {
                detached: false,
                stdio: ['ignore', 'pipe', 'pipe'],
            });

            fridaProc.stdout.on('data', (d) => {
                const msg = d.toString().trim();
                console.log('[Frida]', msg);
                if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                    this.mainWindow.webContents.send('physical-mobile:frida-log', msg);
                }
            });
            
            ipcMain.handle('physical-mobile:trigger-lsposed-broadcast', async (event, params) => {
                if (!params.id) return { success: false, error: 'No device ID provided' };
                const port = params.port || 8899;
                return new Promise((resolve) => {
                    const broadcastCmd = `"${this.adbPath}" -s ${params.id} shell am broadcast -a com.nova.action.START_LIVE_STREAM --es stream_url "http://127.0.0.1:${port}/stream"`;
                    exec(broadcastCmd, { timeout: 10000 }, (err) => {
                        if (err) {
                            const suCmd = `"${this.adbPath}" -s ${params.id} shell su -c "am broadcast -a com.nova.action.START_LIVE_STREAM --es stream_url 'http://127.0.0.1:${port}/stream'"`;
                            exec(suCmd, { timeout: 10000 }, () => resolve({ success: true, message: 'Hook de Hardware LSPosed Ativado!' }));
                        } else {
                            resolve({ success: true, message: 'Hook de Hardware LSPosed Ativado!' });
                        }
                    });
                });
            });

            fridaProc.stderr.on('data', (d) => console.warn('[Frida stderr]', d.toString().trim()));
            fridaProc.on('exit', (code) => console.log(`[Frida] Process exited: ${code}`));

            this._fridaProcess = fridaProc;

            return {
                success: true,
                message: `⚡ Frida injected into ${appName} (${packageName}). Camera replaced!`,
                package: packageName,
            };

        } catch (err) {
            console.error('[Frida] fridaInject error:', err);
            return { success: false, error: err.message };
        }
    }
}

module.exports = PhysicalMobileService;




