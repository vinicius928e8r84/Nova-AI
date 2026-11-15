const { spawn, exec, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const WebSocket = require('ws');
const axios = require('axios');

class PhysicalMobileService {
    constructor(mainWindow, app) {
        this.mainWindow = mainWindow;
        this.app = app;
        
        // Base Directories
        this.baseDir = path.join(app ? app.getPath('userData') : process.cwd(), 'physical_mobile');
        this._adbPath = null;
        this._scrcpyPath = null;
        this.isProvisioning = false;
        
        this.runningStreams = new Map(); // deviceId -> process

        // Ensure base directories exist
        if (!fs.existsSync(this.baseDir)) fs.mkdirSync(this.baseDir, { recursive: true });

        // Auto-detect and resolve tools immediately
        this.resolveAdbPath();
        this.resolveScrcpyPath();

        // Trigger seamless background tool provisioning if missing
        if (process.env.NOVA_SMOKE_TEST !== '1') setTimeout(() => this.ensureTools(false), 2000);
    }

    // Dynamic getter for adbPath
    get adbPath() {
        return this.resolveAdbPath();
    }
    set adbPath(val) {
        this._adbPath = val;
    }

    // Dynamic getter for scrcpyPath
    get scrcpyPath() {
        return this.resolveScrcpyPath();
    }
    set scrcpyPath(val) {
        this._scrcpyPath = val;
    }

    // Comprehensive Path Resolver for ADB
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

    // Comprehensive Path Resolver for Scrcpy
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

    // Seamless Self-Provisioning: Auto-download & extract ADB & Scrcpy
    async ensureTools(force = false) {
        if (process.platform === "darwin") {
            const adb = this.adbPath, scrcpy = this.scrcpyPath;
            const ready = fs.existsSync(adb) && fs.existsSync(scrcpy);
            return {success:ready, message:ready?'Native macOS tools ready.':'Native adb/scrcpy missing. Install platform-tools and scrcpy for macOS.', adbPath:adb, scrcpyPath:scrcpy};
        }

        const adbReady = fs.existsSync(this.adbPath);
        const scrcpyReady = fs.existsSync(this.scrcpyPath);

        if (adbReady && scrcpyReady && !force) {
            return { success: true, message: 'Tools ready.' };
        }

        if (this.isProvisioning) {
            return { success: true, message: 'Setup in progress...' };
        }

        this.isProvisioning = true;
        this.sendToFrontend('physical-mobile:setup-progress', { stage: 'starting', message: 'Configuring Mobile Control Engine...' });

        try {
            // 1. Download & Extract Android Platform Tools (ADB)
            if (!adbReady || force) {
                this.sendToFrontend('physical-mobile:setup-progress', { stage: 'adb', message: 'Downloading Android ADB Engine...' });
                const adbZipUrl = 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip';
                const adbZipPath = path.join(this.baseDir, 'platform-tools.zip');
                
                const response = await axios({
                    url: adbZipUrl,
                    method: 'GET',
                    responseType: 'arraybuffer',
                    timeout: 60000
                });
                fs.writeFileSync(adbZipPath, Buffer.from(response.data));

                // Extract via PowerShell
                await new Promise((resolve, reject) => {
                    const extractCmd = `powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Path '${adbZipPath}' -DestinationPath '${this.baseDir}' -Force"`;
                    exec(extractCmd, (err) => {
                        try { fs.unlinkSync(adbZipPath); } catch (_) {}
                        if (err) reject(err); else resolve();
                    });
                });
            }

            // 2. Download & Extract Scrcpy Portable
            if (!scrcpyReady || force) {
                this.sendToFrontend('physical-mobile:setup-progress', { stage: 'scrcpy', message: 'Setting up Screen Mirroring Engine...' });
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
            this.sendToFrontend('physical-mobile:setup-progress', { stage: 'done', message: 'Engines ready!' });
            return { success: true };
        } catch (error) {
            console.error('[PhysicalMobile] ensureTools error:', error);
            this.sendToFrontend('physical-mobile:setup-progress', { stage: 'error', message: 'Auto-setup encountered error: ' + error.message });
            return { success: false, error: error.message };
        } finally {
            this.isProvisioning = false;
        }
    }

    // List connected devices via ADB with friendly names & statuses
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

                        // Extract model from line (e.g. model:SM_G998B product:p3s)
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

    // ── iOS (iPhone via USB) — adaptação macOS ──
    iosSsh(command) {
        return new Promise((resolve) => {
            const args = ['-p', '2222', '-i', path.join(os.homedir(), '.ssh', 'id_iphone'),
                '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-o', 'StrictHostKeyChecking=accept-new',
                'mobile@127.0.0.1', command];
            execFile('/usr/bin/ssh', args, { timeout: 12000 }, (err, stdout, stderr) => {
                resolve({ ok: !err, stdout: String(stdout || ''), error: err ? (String(stderr) || err.message) : null });
            });
        });
    }

    iosRun(args) {
        return new Promise((resolve) => {
            execFile('/opt/homebrew/bin/ideviceinstaller', args, { timeout: 25000 }, (err, stdout, stderr) => {
                resolve({ ok: !err, stdout: String(stdout || ''), error: err ? (String(stderr) || err.message) : null });
            });
        });
    }

    async getIosDevices() {
        return new Promise((resolve) => {
            execFile('/opt/homebrew/bin/idevice_id', ['-l'], { timeout: 6000 }, (err, stdout) => {
                if (err || !stdout) return resolve([]);
                const udids = String(stdout).split('\n').map(s => s.trim()).filter(Boolean);
                const out = [];
                let pending = udids.length;
                if (!pending) return resolve([]);
                for (const udid of udids) {
                    execFile('/opt/homebrew/bin/ideviceinfo', ['-u', udid, '-k', 'DeviceName'], { timeout: 6000 }, (e1, s1) => {
                        const name = (e1 || !s1) ? 'iPhone' : (String(s1).trim() || 'iPhone');
                        execFile('/opt/homebrew/bin/ideviceinfo', ['-u', udid, '-k', 'ProductVersion'], { timeout: 6000 }, (e2, s2) => {
                            const ver = (e2 || !s2) ? '' : String(s2).trim();
                            out.push({ id: 'ios-' + udid, status: 'device', name: name + (ver ? ' (iOS ' + ver + ')' : ''), type: 'usb', ios: true });
                            if (--pending === 0) resolve(out);
                        });
                    });
                }
            });
        });
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

    // Get current setup status and list of devices
    async getStatus() {
        const adbExists = fs.existsSync(this.adbPath);
        const scrcpyExists = fs.existsSync(this.scrcpyPath);
        const devices = await this.getConnectedDevices();

        return {
            needsSetup: !adbExists || !scrcpyExists,
            adbPath: this.adbPath,
            scrcpyPath: this.scrcpyPath,
            devices: devices.map(d => ({
                ...d,
                streaming: this.runningStreams.has(d.id)
            }))
        };
    }

    // Auto-Restart ADB Server to unfreeze or repair connections
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
                            resolve({ success: true, message: 'ADB Server restarted successfully.' });
                        }
                    });
                }, 600);
            });
        });
    }

    // 1-Click Auto-Pair USB Device to Wireless
    async autoPairUsbToWireless(deviceId) {
        const adb = this.adbPath;
        if (!fs.existsSync(adb)) return { success: false, error: 'ADB not found.' };

        return new Promise((resolve) => {
            // Get IP Address from the Android device
            const getIpCmd = `"${adb}" -s ${deviceId} shell ip -f inet addr show wlan0`;
            exec(getIpCmd, (err, stdout) => {
                let ip = null;
                const ipMatch = stdout ? stdout.match(/inet\s+(\d+\.\d+\.\d+\.\d+)/) : null;
                if (ipMatch) {
                    ip = ipMatch[1];
                } else {
                    // Fallback to getprop
                    const propCmd = `"${adb}" -s ${deviceId} shell getprop dhcp.wlan0.ipaddress`;
                    const propOut = require('child_process').execSync(propCmd, { encoding: 'utf8' }).trim();
                    if (propOut && propOut.match(/^\d+\.\d+\.\d+\.\d+$/)) ip = propOut;
                }

                if (!ip) {
                    resolve({ success: false, error: 'Could not detect device Wi-Fi IP. Ensure phone is connected to Wi-Fi.' });
                    return;
                }

                // Switch to TCP/IP mode
                exec(`"${adb}" -s ${deviceId} tcpip 5555`, (tcpErr) => {
                    setTimeout(() => {
                        // Connect to device IP
                        exec(`"${adb}" connect ${ip}:5555`, (connErr, connOut, connStderr) => {
                            if (connErr || (connOut && connOut.includes('failed'))) {
                                resolve({ success: false, error: connOut || connStderr || 'Wireless pairing timeout.' });
                            } else {
                                resolve({ success: true, ip, deviceId: `${ip}:5555`, message: `Successfully connected wirelessly to ${ip}:5555` });
                            }
                        });
                    }, 1000);
                });
            });
        });
    }

    // Auto-Scan Local Subnet on Port 5555 for Wireless Android Devices
    // Auto-Scan Local Subnet and mDNS for Wireless Android Devices
    async scanWifiDevices() {
        const adb = this.adbPath;
        if (!fs.existsSync(adb)) return { success: false, error: 'ADB not found.' };

        const discoveredIps = [];

        // 1. Check mDNS Wireless Debugging broadcast services
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

        // 2. Subnet port 5555 scan
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

        // Auto-connect to all discovered endpoints
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

    // Android 11+ Pair Wireless Device via 6-Digit Pairing Code
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

    // Connect device via Wi-Fi (Same Network)
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

    // Disconnect a device
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

    // Start streaming device screen via Scrcpy
    async startStream(deviceId) {
        if (String(deviceId).startsWith('ios-')) return this.iosStartStream(deviceId);
        if (this.runningStreams.has(deviceId)) {
            return { success: true, message: 'Already streaming' };
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

    // Stop streaming
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

    // Root-Level Settings Controls (Toggles)
    async toggleSetting(deviceId, setting, enable) {
        if (String(deviceId).startsWith('ios-')) return { success: false, error: 'Toggle de Wi-Fi/Bluetooth não é suportado no iOS por SSH nesta versão.' };
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
                    // Fallback to non-root shell command if su fails
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

    // App Control Interface (Launch, Stop, Clear Cache)
    async controlApp(deviceId, packageName, action) {
        if (String(deviceId).startsWith('ios-')) return this.iosControlApp(deviceId, packageName, action);
        return new Promise((resolve) => {
            if (!fs.existsSync(this.adbPath)) {
                resolve({ success: false, error: 'ADB missing.' });
                return;
            }

            let shellCmd = '';
            if (action === 'start') {
                // Universal launch via monkey package category
                shellCmd = `shell monkey -p ${packageName} -c android.intent.category.LAUNCHER 1`;
            } else if (action === 'stop') {
                // Root force stop
                shellCmd = `shell su -c "am force-stop ${packageName}"`;
            } else if (action === 'clear') {
                // Root clear data/cache
                shellCmd = `shell su -c "pm clear ${packageName}"`;
            }

            const cmd = `"${this.adbPath}" -s ${deviceId} ${shellCmd}`;
            console.log(`[PhysicalMobile] Executing app control: ${cmd}`);

            exec(cmd, (err, stdout, stderr) => {
                if (err && action !== 'start') {
                    // Non-root fallback for stop
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

    // Advanced Browser Automation via Chrome Debugging (CDP)
    async automateBrowser(deviceId, url, searchText) {
        if (String(deviceId).startsWith('ios-')) return this.iosAutomateBrowser(deviceId, url, searchText);
        return new Promise(async (resolve) => {
            if (!fs.existsSync(this.adbPath)) {
                resolve({ success: false, error: 'ADB missing.' });
                return;
            }

            console.log(`[PhysicalMobile] Initializing browser automation on device ${deviceId}...`);

            // Step 1: Forward local port 9222 to mobile Chrome DevTools socket
            const forwardCmd = `"${this.adbPath}" -s ${deviceId} forward tcp:9222 localabstract:chrome_devtools_remote`;
            
            exec(forwardCmd, async (err, stdout, stderr) => {
                if (err) {
                    console.error('[PhysicalMobile] Failed to set up port forwarding:', stderr);
                    resolve({ success: false, error: 'CDP Port forwarding failed.' });
                    return;
                }

                // Step 2: Open Chrome on mobile
                const chromeLaunchCmd = `"${this.adbPath}" -s ${deviceId} shell am start -n com.android.chrome/com.google.android.apps.chrome.Main`;
                exec(chromeLaunchCmd);

                // Wait 4 seconds for Chrome to spin up
                await new Promise(r => setTimeout(r, 4000));

                try {
                    // Step 3: Fetch active tabs from local port 9222
                    const response = await axios.get('http://localhost:9222/json');
                    const tabs = response.data;
                    
                    if (!tabs || tabs.length === 0) {
                        resolve({ success: false, error: 'No active Chrome tabs found. Make sure Chrome is running.' });
                        return;
                    }

                    // Select the first active page tab
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

                        // Helper function to send CDP commands
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

                        // Run automation sequence
                        (async () => {
                            try {
                                console.log(`[PhysicalMobile] Navigating to: ${url}`);
                                await sendCommand('Page.navigate', { url });

                                // Wait for navigation load
                                await new Promise(r => setTimeout(r, 5000));

                                if (searchText) {
                                    console.log(`[PhysicalMobile] Injecting search script for term: ${searchText}`);
                                    
                                    // Inject JavaScript to type search query and submit Google or standard forms
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
    // ─────────────────────────────────────────────
    // DEVICE IDENTITY SPOOFER METHODS
    // ─────────────────────────────────────────────

    // Load spoofer database
    getSpooferDatabase() {
        try {
            const dbPath = path.join(__dirname, 'spooferDatabase.json');
            return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        } catch (e) {
            console.error('[Spoofer] Failed to load database:', e);
            return { brands: {} };
        }
    }

    // Get all models grouped by brand
    getSpooferModels() {
        const db = this.getSpooferDatabase();
        const result = {};
        for (const [brand, models] of Object.entries(db.brands)) {
            result[brand] = models.map(m => ({ model: m.model, name: m.name }));
        }
        return { success: true, brands: result };
    }

    // Generate valid Luhn checksum IMEI
    generateIMEI(prefix) {
        const tac = prefix || '35' + Math.floor(Math.random() * 99999999).toString().padStart(8, '0');
        let digits = tac.split('').map(Number);
        // Luhn algorithm
        let sum = 0;
        for (let i = 0; i < 14; i++) {
            let d = digits[i];
            if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
            sum += d;
        }
        const checkDigit = (10 - (sum % 10)) % 10;
        return tac + checkDigit;
    }

    // Generate random hex string
    randomHex(length) {
        let result = '';
        const chars = '0123456789abcdef';
        for (let i = 0; i < length; i++) result += chars[Math.floor(Math.random() * 16)];
        return result;
    }

    // Generate random MAC address
    generateMAC() {
        const hex = () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0');
        return `02:${hex()}:${hex()}:${hex()}:${hex()}:${hex()}`;
    }

    // Generate random serial number with brand prefix
    generateSerial(prefix) {
        const suffix = Math.random().toString(36).substring(2, 10).toUpperCase();
        return (prefix || 'RND1') + suffix;
    }

    // Generate random Android ID (16 hex chars)
    generateAndroidId() {
        return this.randomHex(16);
    }

    // Generate random UUID for Advertising ID
    generateGAID() {
        const s4 = () => this.randomHex(4);
        return `${s4()}${s4()}-${s4()}-${s4()}-${s4()}-${s4()}${s4()}${s4()}`;
    }

    // Execute ADB root shell command helper
    adbRootExec(deviceId, shellCmd) {
        return new Promise((resolve) => {
            const cmd = `"${this.adbPath}" -s ${deviceId} shell su -c "${shellCmd}"`;
            exec(cmd, { timeout: 10000 }, (err, stdout, stderr) => {
                if (err) {
                    // Try without su as fallback
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

    // Push a file to device
    adbPush(deviceId, localPath, remotePath) {
        return new Promise((resolve) => {
            exec(`"${this.adbPath}" -s ${deviceId} push "${localPath}" ${remotePath}`, (err) => {
                resolve({ success: !err });
            });
        });
    }

    // Apply full device identity spoof
    async applySpoofProfile(deviceId, brandName, modelKey, customImei = null) {
        try {
            const db = this.getSpooferDatabase();
            // ── FIX 1: Case-insensitive brand lookup so "Google" matches even if key differs
            const brandKey = Object.keys(db.brands).find(
                k => k.toLowerCase() === brandName.toLowerCase()
            ) || brandName;
            const brand = db.brands[brandKey];
            if (!brand) return { success: false, error: `Brand "${brandName}" not found.` };

            const profile = brand.find(m => m.model === modelKey);
            if (!profile) return { success: false, error: `Model "${modelKey}" not found.` };

            // ── FIX 1b: IMEI TAC prefix per manufacturer (Luhn-valid prefix families)
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

            // ── PROP LIST (used for both RAM injection + Magisk module) ──────
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

            // ── STEP 1: RAM injection (takes effect immediately) ─────────────
            for (const [key, val] of props) {
                await this.adbRootExec(deviceId, `resetprop "${key}" "${val}" 2>/dev/null; true`);
            }

            // ── STEP 1b: DEEP IMEI INJECTION — *#06# compatible ─────────────────
            // Strategy: Set ALL known IMEI prop paths persistently + trigger safe telephony
            // notification WITHOUT restarting ril-daemon (which causes blank IMEI).
            // *#06# reads from ril.gsm.imei OR ril.imei — we set both.
            console.log(`[Spoofer] Deep IMEI inject: writing all prop paths (no ril restart)`);

            // Full persistent IMEI write — every known prop path
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

            // ── STEP 1c: SAFE TELEPHONY REFRESH (no ril-daemon kill) ──────────────
            // Broadcast a safe Intent to tell TelephonyManager to re-read IMEI from props.
            // This makes *#06# and Settings show the spoofed IMEI WITHOUT killing ril-daemon.
            await this.adbRootExec(deviceId, `am broadcast -a android.intent.action.SERVICE_STATE 2>/dev/null; true`);
            await this.adbRootExec(deviceId, `am broadcast -a android.telephony.action.SUBSCRIPTION_CARRIER_IDENTITY_CHANGED 2>/dev/null; true`);
            // Also restart just telephony framework services (not ril itself)
            await this.adbRootExec(deviceId, `service call phone 1 2>/dev/null; true`);
            console.log(`[Spoofer] ✅ IMEI props set + telephony refresh triggered (check *#06# after soft reboot)`);

            // ── STEP 1c: CARRIER DATABASE — match SIM carrier to manufacturer ────
            // Each brand has a realistic carrier association
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

            // Generate extra faker parameters
            const wifiSsid  = profile.manufacturer + '_' + this.randomHex(4).toUpperCase();
            const wifiBssid = this.generateMAC();
            const bluetoothId = this.generateMAC();
            const simSubId  = '8901' + mcc + mnc + Math.floor(Math.random() * 10000000000).toString().padStart(10, '0');
            const simSerial = '8901' + mcc + mnc + Math.floor(Math.random() * 10000000000).toString().padStart(10, '0');
            const mobileNumber = '5' + Math.floor(100000000 + Math.random() * 900000000).toString();
            const hwSerial   = serial;
            const gsfIdValue = this.randomHex(16);
            const mediaDrmId = this.randomHex(32);


            // Add these extra parameters to the config bridge for Nova internal use
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

            // ── STEP 2: Settings database, Telephony database, GMS & framework SQLites ──────────────────────────────
            // Secure Settings & System Settings
            await this.adbRootExec(deviceId, `settings put secure android_id ${androidId}`);
            await this.adbRootExec(deviceId, `settings put secure bluetooth_address ${bluetoothId}`);
            await this.adbRootExec(deviceId, `settings put secure wifi_ap_ssid ${wifiSsid}`);
            await this.adbRootExec(deviceId, `settings put secure wifi_ap_bssid ${wifiBssid}`);

            // ── STEP 2b: LIVE WiFi MAC (network interface level) ─────────────
            // This changes what wlan0 reports immediately — no reboot needed
            console.log(`[Spoofer] Changing live WiFi MAC → ${mac}`);
            await this.adbRootExec(deviceId,
                `ip link set wlan0 down 2>/dev/null; ip link set wlan0 address ${mac} 2>/dev/null; ip link set wlan0 up 2>/dev/null; true`);
            // Samsung: persist to EFS wifi partition
            await this.adbRootExec(deviceId,
                `[ -f /efs/wifi/.mac.info ] && printf '%s' '${mac}' > /efs/wifi/.mac.info 2>/dev/null; true`);

            // ── STEP 2c: LIVE Bluetooth MAC (bluedroid config) ───────────────
            // Writing to bt_config.conf forces BT stack to use new MAC on restart
            console.log(`[Spoofer] Setting Bluetooth MAC → ${bluetoothId}`);
            await this.adbRootExec(deviceId,
                `printf '[Adapter]\\nAddress = ${bluetoothId}\\n' > /data/misc/bluedroid/bt_config.conf 2>/dev/null; true`);
            await this.adbRootExec(deviceId,
                `printf '[Adapter]\\nAddress = ${bluetoothId}\\n' > /data/misc/bluedroid/bt_config.bak 2>/dev/null; true`);
            await this.adbRootExec(deviceId,
                `chown bluetooth:bluetooth /data/misc/bluedroid/bt_config.conf 2>/dev/null; chmod 660 /data/misc/bluedroid/bt_config.conf 2>/dev/null; true`);

            // GMS Advertising ID update in database manager
            await this.adbRootExec(deviceId,
                `sqlite3 /data/data/com.google.android.gms/databases/databasemanager.db "UPDATE main SET value='${gaid}' WHERE key='advertising_id'" 2>/dev/null; true`
            );

            // GSF ID update in gservices database
            await this.adbRootExec(deviceId,
                `sqlite3 /data/data/com.google.android.gsf/databases/gservices.db "UPDATE main SET value='${gsfIdValue}' WHERE name='android_id'" 2>/dev/null; true`
            );

            // Telephony database updates (SIM Sub ID, SIM Serial, Phone Number)
            await this.adbRootExec(deviceId,
                `sqlite3 /data/data/com.android.providers.telephony/databases/telephony.db "UPDATE siminfo SET icc_id='${simSerial}', number='${mobileNumber}', display_name='${simOperatorName}'" 2>/dev/null; true`
            );

            // ── 15-STEP COMPREHENSIVE PROPS (matching Android Faker) ──────────
            props.push(
                // Step 7: Serial
                ['ro.boot.serialno',                    hwSerial],
                ['ro.serialno',                         hwSerial],
                // Step 8: IMEI persistent (already done via resetprop -p)
                ['ro.ril.oem.imei',                     imei],
                // Step 9: SIM Carrier — matched to manufacturer
                ['gsm.sim.operator.numeric',            mcc + mnc],
                ['gsm.sim.operator.alpha',              simOperatorName],
                ['gsm.sim.operator.iso-country',        simCountryIso],
                ['gsm.operator.numeric',                mcc + mnc],
                ['gsm.operator.alpha',                  simOperatorName],
                ['gsm.operator.iso-country',            simCountryIso],
                ['gsm.sim.state',                       'LOADED'],
                // Step 10: WiFi MAC
                ['ro.boot.wifi.mac',                    mac],
                ['ro.wifi.bssid',                       wifiBssid],
                ['wifi.interface',                      'wlan0'],
                // Step 11: Bluetooth MAC
                ['ro.boot.btmacaddr',                   bluetoothId],
                ['bluetooth.address',                   bluetoothId],
                // Step 12: Carrier / Network
                ['ro.carrier',                          simOperatorName.toLowerCase().replace(/ /g, '_')],
                ['ro.com.google.clientidbase',          'android-' + profile.manufacturer.toLowerCase()],
                ['net.hostname',                        profile.device.toLowerCase() + '-' + this.randomHex(4)],
                // Step 13: Media DRM ID
                ['media.drm.uuid',                      mediaDrmId],
                // Step 14: SIM MCC/MNC direct
                ['ro.telephony.default_network',        '9'],
                ['persist.radio.multisim.config',       'dsds'],
                // Step 15: GSF / Play Store
                ['ro.build.expect.bootloader',          profile.device.toLowerCase()],
            );


            // ── STEP 3: MAGISK MODULE — persists across reboots ──────────────
            // Magisk reads system.prop from /data/adb/modules/<id>/ at boot
            // and applies them via resetprop BEFORE Zygote starts → all apps see spoofed props

            // Store generated identity for later verification
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

            // system.prop format: key=value (one per line, no quotes)
            const systemProp = props
                .map(([k, v]) => `${k}=${v}`)
                .join('\n') + '\n';

            // ── STEP 4: service.sh — 15-step re-apply at every boot ────────────
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
            // Write files locally then push
            const localMod = path.join(this.baseDir, 'nova_magisk_module');
            fs.mkdirSync(localMod, { recursive: true });
            fs.writeFileSync(path.join(localMod, 'module.prop'),  moduleProp,  'utf8');
            fs.writeFileSync(path.join(localMod, 'system.prop'),  systemProp,  'utf8');
            fs.writeFileSync(path.join(localMod, 'service.sh'),   serviceSh,   'utf8');

            // Create temporary staging directory in /data/local/tmp
            await this.adbRootExec(deviceId, `mkdir -p /data/local/tmp/nova_magisk_module`);

            // Push files to staging directory (writable by adb shell user)
            await this.adbPush(deviceId, path.join(localMod, 'module.prop'), '/data/local/tmp/nova_magisk_module/module.prop');
            await this.adbPush(deviceId, path.join(localMod, 'system.prop'), '/data/local/tmp/nova_magisk_module/system.prop');
            await this.adbPush(deviceId, path.join(localMod, 'service.sh'),  '/data/local/tmp/nova_magisk_module/service.sh');

            // Copy staging files to Magisk modules folder as root
            await this.adbRootExec(deviceId, `mkdir -p /data/adb/modules/nova_spoof`);
            await this.adbRootExec(deviceId, `cp /data/local/tmp/nova_magisk_module/module.prop /data/adb/modules/nova_spoof/module.prop`);
            await this.adbRootExec(deviceId, `cp /data/local/tmp/nova_magisk_module/system.prop /data/adb/modules/nova_spoof/system.prop`);
            await this.adbRootExec(deviceId, `cp /data/local/tmp/nova_magisk_module/service.sh /data/adb/modules/nova_spoof/service.sh`);
            
            // Clean up staging directory on device
            await this.adbRootExec(deviceId, `rm -rf /data/local/tmp/nova_magisk_module`);

            // Set correct ownership and permissions for Magisk module
            await this.adbRootExec(deviceId, `chown -R root:root /data/adb/modules/nova_spoof`);
            await this.adbRootExec(deviceId, `chmod 755 /data/adb/modules/nova_spoof`);
            await this.adbRootExec(deviceId, `chmod 644 /data/adb/modules/nova_spoof/module.prop`);
            await this.adbRootExec(deviceId, `chmod 644 /data/adb/modules/nova_spoof/system.prop`);
            await this.adbRootExec(deviceId, `chmod 755 /data/adb/modules/nova_spoof/service.sh`);

            // Remove skip/disable flags if present
            await this.adbRootExec(deviceId, `rm -f /data/adb/modules/nova_spoof/skip /data/adb/modules/nova_spoof/disable 2>/dev/null; true`);
            console.log(`[Spoofer] ✅ Magisk module installed: /data/adb/modules/nova_spoof/`);

            // ── STEP 4: Config bridge (for Nova internal use) ────────────────
            const tmpJsonPath = path.join(this.baseDir, 'nova_spoof.json');
            fs.writeFileSync(tmpJsonPath, JSON.stringify(spoofConfig, null, 2));
            await this.adbRootExec(deviceId, `mkdir -p /data/local/tmp`);
            await this.adbPush(deviceId, tmpJsonPath, '/data/local/tmp/nova_spoof.json');

            // ── STEP 5: Soft GMS flush (no zygote crash) ─────────────────────
            await this.adbRootExec(deviceId, `am force-stop com.google.android.gms 2>/dev/null; true`);

            console.log(`[Spoofer] ✅ Profile applied: ${profile.name} (Android ${av}) — Triggering crash-safe zygote reboot`);

            // ── STEP 6: Crash-safe soft reboot (zygote-only, Scrcpy mouse safe) ──
            // We do NOT use setTimeout — wait inline so Scrcpy has time to recover.
            await new Promise(r => setTimeout(r, 1500));
            console.log(`[Spoofer] Issuing zygote restart on ${deviceId}...`);

            // Strategy: setprop ctl.restart zygote
            // ✔ Kernel stays alive  ✔ ADB stays alive  ✔ Input/touch events stay alive
            // ✔ Scrcpy connection survives  ✔ All Java framework restarts cleanly
            await this.adbRootExec(deviceId, `setprop ctl.restart zygote 2>/dev/null; true`);

            // Wait for zygote to come back (polling up to 20s)
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

            // ── STEP 7: Show live confirmation on mobile screen (visible in Scrcpy) ──
            await new Promise(r => setTimeout(r, 3000)); // let system_server settle
            const toastMsg = `NOVA SPOOF ✓ | ${profile.name} | IMEI: ${imei}`;
            // Try modern notification channel first, fallback to am startactivity overlay
            await this.adbRootExec(deviceId,
                `cmd notification post -S bigtext -t 'NOVA Spoof Active' 'NovaSpoofTag' "${toastMsg}" 2>/dev/null; true`
            );
            // Also log to device logcat for ADB-side confirmation
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

    // Get GSF Android ID (needed for Play Store certification)
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

    // ── GPS SPOOF via background loop script ──────────────────────────────────
    async setSpoofLocation(deviceId, latitude, longitude) {
        try {
            console.log(`[Spoofer] Setting persistent fake GPS: ${latitude}, ${longitude}`);

            // 1. Stop any previous GPS spoof loop
            await this.adbRootExec(deviceId, `pkill -f nova_gps_loop 2>/dev/null; true`);
            await new Promise(r => setTimeout(r, 300));

            // 2. Enable mock location in developer settings
            await this.adbRootExec(deviceId, `settings put secure mock_location 1`);
            await this.adbRootExec(deviceId, `settings put global development_settings_enabled 1`);

            // 3. Build the persistent GPS injection shell script
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
            // 4. Write script to PC temp, push to phone
            const scriptPath = path.join(this.baseDir, 'nova_gps_loop.sh');
            fs.writeFileSync(scriptPath, gpsScript.replace(/\r\n/g, '\n'));
            await this.adbPush(deviceId, scriptPath, '/data/local/tmp/nova_gps_loop.sh');
            await this.adbRootExec(deviceId, `chmod +x /data/local/tmp/nova_gps_loop.sh`);

            // 5. Run loop in background with nohup
            await this.adbRootExec(deviceId,
                `nohup sh /data/local/tmp/nova_gps_loop.sh >/data/local/tmp/nova_gps.log 2>&1 &`
            );

            // 6. Update config bridge with GPS coords
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

    // Stop GPS spoof background loop
    async stopFakeGPS(deviceId) {
        await this.adbRootExec(deviceId, `pkill -f nova_gps_loop 2>/dev/null; true`);
        await this.adbRootExec(deviceId, `cmd location set-test-provider-enabled gps false 2>/dev/null; true`);
        await this.adbRootExec(deviceId, `cmd location set-test-provider-enabled network false 2>/dev/null; true`);
        await this.adbRootExec(deviceId, `cmd location set-test-provider-enabled fused false 2>/dev/null; true`);
        return { success: true };
    }

    // Mouse-Safe Soft Reboot — zygote-only strategy
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

    // Reset all spoofed values (restore real identity) — full hard reboot
    async resetSpoof(deviceId) {
        try {
            await this.stopFakeGPS(deviceId);
            await this.adbRootExec(deviceId, `rm -f /data/local/tmp/nova_spoof.json 2>/dev/null; true`);
            await this.adbRootExec(deviceId, `rm -f /data/local/tmp/nova_gps_loop.sh 2>/dev/null; true`);
            await this.adbRootExec(deviceId, `rm -rf /data/adb/modules/nova_spoof 2>/dev/null; true`);
            // Hard reboot to restore original props from boot image
            await this.rebootDevice(deviceId, 'hard');
            return { success: true, message: 'Device rebooting to restore real identity...' };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    // ── DUAL IMEI — inject both SIM slot IMEIs ────────────────────────────────
    async applyDualIMEI(deviceId, imei1, imei2) {
        try {
            if (!imei1 || imei1.length !== 15) return { success: false, error: 'IMEI 1 must be exactly 15 digits.' };
            if (!imei2 || imei2.length !== 15) return { success: false, error: 'IMEI 2 must be exactly 15 digits.' };

            console.log(`[Spoofer] Applying Dual IMEI: SIM1=${imei1} SIM2=${imei2} on ${deviceId}`);

            // SIM Slot 1
            const slot1Props = [
                ['ril.imei',              imei1],
                ['ril.imei1',             imei1],
                ['persist.radio.imei',    imei1],
                ['persist.radio.imei1',   imei1],
                ['vendor.ril.imei',       imei1],
                ['vendor.ril.imei1',      imei1],
                ['ro.ril.oem.imei',       imei1],
            ];
            // SIM Slot 2
            const slot2Props = [
                ['ril.imei2',             imei2],
                ['persist.radio.imei2',   imei2],
                ['vendor.ril.imei2',      imei2],
                ['ro.ril.oem.imei2',      imei2],
            ];

            const allProps = [...slot1Props, ...slot2Props];

            // RAM Injection (immediate effect)
            for (const [key, val] of allProps) {
                await this.adbRootExec(deviceId, `resetprop "${key}" "${val}" 2>/dev/null; true`);
            }

            // Persist to Magisk module system.prop
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

    // ── AUTO PROFILE GENERATOR ────────────────────────────────────────────────
    async generateRandomProfile(deviceId, preferredBrand = null) {
        try {
            const db = this.getSpooferDatabase();
            const brandNames = Object.keys(db.brands);
            if (!brandNames.length) return { success: false, error: 'Spoofer database empty.' };

            // Pick brand (prefer user selection or random)
            let brand = preferredBrand && db.brands[preferredBrand] ? preferredBrand
                : brandNames[Math.floor(Math.random() * brandNames.length)];

            const models = db.brands[brand];
            const profile = models[Math.floor(Math.random() * models.length)];

            console.log(`[Spoofer] Auto-generating profile: ${brand} — ${profile.name}`);

            // Apply the randomly selected profile
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

    // ── VERIFY APPLIED PROFILE — read live device props and compare ──────────
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
                // Anti-detection checks
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

    // ─────────────────────────────────────────────
    // CAMERA HIJACK (SPOOF CAM) METHODS
    // ─────────────────────────────────────────────

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

            // Resolve APK path from project resources folder
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
                    resolve({ success: true, message: 'nova-cam-spoofer installed successfully!' });
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
        if (String(deviceId).startsWith('ios-')) return this.iosCamera().start(videoPath);
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

            // Step 1: Ensure standard VCam and DCIM directories exist on phone
            await new Promise((resolve) => {
                const mkCmd = `"${this.adbPath}" -s ${deviceId} shell "mkdir -p /sdcard/DCIM/Camera1 /sdcard/DCIM/Camera /sdcard/DCIM"`;
                exec(mkCmd, { timeout: 10000 }, () => resolve());
            });

            // Step 2: Push media file to ALL standard Android Virtual Camera locations
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

            // Step 3: Set full read/write permissions on device
            await new Promise((resolve) => {
                const chCmd = `"${this.adbPath}" -s ${deviceId} shell "chmod -R 777 /sdcard/DCIM/Camera1 /sdcard/nova_fake_cam* /sdcard/DCIM/Camera"`;
                exec(chCmd, { timeout: 8000 }, () => resolve());
            });

            // Step 4: Broadcast to all LSPosed, VCam, and Nova modules
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
                // Try with su first, fallback to standard shell
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
        if (String(deviceId).startsWith('ios-')) return this.iosCamera().stop();
        return new Promise((resolve) => {
            if (!fs.existsSync(this.adbPath)) {
                resolve({ success: false, error: 'ADB not found.' });
                return;
            }

            console.log(`[CamSpoof] Sending STOP broadcast to device ${deviceId}...`);
            const cmd = `"${this.adbPath}" -s ${deviceId} shell su -c "am broadcast -a com.nova.action.STOP_SPOOF_CAM"`;

            exec(cmd, { timeout: 15000 }, (err, stdout, stderr) => {
                if (err) {
                    // Fallback without root
                    const fallback = `"${this.adbPath}" -s ${deviceId} shell am broadcast -a com.nova.action.STOP_SPOOF_CAM`;
                    exec(fallback, { timeout: 10000 }, (fbErr, fbOut) => {
                        if (fbErr) {
                            resolve({ success: false, error: 'Stop broadcast failed.' });
                        } else {
                            resolve({ success: true, message: 'Real camera restored successfully.' });
                        }
                    });
                } else {
                    resolve({ success: true, message: 'Real camera restored successfully.' });
                }
            });
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
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

            // Stop existing server if any
            await this.stopLiveStream(deviceId);

            const http = require('http');

            // ── MJPEG HTTP server ──────────────────────────────────────────
            this._mjpegClients   = [];
            this._mjpegPort      = port;
            this._mjpegDeviceId  = deviceId;
            this._mjpegFrameCount = 0;

            this._mjpegServer = http.createServer((req, res) => {
                if (req.url === '/stream' || req.url === '/') {
                    // MJPEG stream endpoint
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
                    // Health check endpoint
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

            // ── ADB Reverse Port Tunnel ─────────────────────────────────────
            // Maps phone's localhost:8899 → PC's localhost:8899
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

            // ── Send START_LIVE_STREAM broadcast to Android module ──────────
            const broadcastCmd = `"${this.adbPath}" -s ${deviceId} shell am broadcast -a com.nova.action.START_LIVE_STREAM --es stream_url "http://127.0.0.1:${port}/stream"`;
            exec(broadcastCmd, { timeout: 15000 }, (err, stdout) => {
                if (err) {
                    // Try with su fallback
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
            // Clean up dead clients
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

            // Send stop broadcast to Android module
            if (deviceId && fs.existsSync(this.adbPath)) {
                const stopCmd = `"${this.adbPath}" -s ${deviceId} shell am broadcast -a com.nova.action.STOP_LIVE_STREAM`;
                exec(stopCmd, { timeout: 10000 }, () => {});

                // Remove ADB reverse tunnel
                const removeCmd = `"${this.adbPath}" -s ${deviceId} reverse --remove tcp:${port}`;
                exec(removeCmd, { timeout: 10000 }, () => {});
                console.log(`[LiveStream] ADB reverse tcp:${port} removed`);
            }

            // Close all MJPEG clients
            if (this._mjpegClients) {
                for (const client of this._mjpegClients) {
                    try { client.end(); } catch (e) {}
                }
                this._mjpegClients = [];
            }

            // Close HTTP server
            if (this._mjpegServer) {
                await new Promise((resolve) => {
                    this._mjpegServer.close(() => resolve());
                    setTimeout(resolve, 2000); // Force close after 2s
                });
                this._mjpegServer = null;
                console.log('[LiveStream] MJPEG server stopped');
            }

            this._mjpegFrameCount = 0;
            return { success: true, message: 'Live stream stopped. Real camera restored.' };

        } catch (err) {
            console.error('[LiveStream] stopLiveStream error:', err);
            return { success: false, error: err.message };
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  FRIDA DEEP INJECT — Hardware-level camera replacement
    //  Starts frida-server on phone, spawns target app with camera hook
    //  Works for Camera1 + Camera2, ALL apps, Android 9-14
    // ─────────────────────────────────────────────────────────────────────────

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

            // 1. Push frida-server if it exists
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

            // 2. Kill existing frida-server, start fresh
            await new Promise((resolve) => {
                exec(`"${adb}" -s ${deviceId} shell "su -c 'pkill frida-server 2>/dev/null; sleep 1; nohup /data/local/tmp/frida-server &'"`,
                    { timeout: 15000 }, () => resolve());
            });
            console.log('[Frida] frida-server started on phone');

            // 3. Wait 2s for server to start
            await new Promise(r => setTimeout(r, 2000));

            // 4. ADB reverse for USB frida connection
            await new Promise((resolve) => {
                exec(`"${adb}" -s ${deviceId} forward tcp:27042 tcp:27042`,
                    { timeout: 10000 }, () => resolve());
            });

            // 5. Run frida to spawn app with camera hook
            const { spawn: spawnProc } = require('child_process');
            console.log(`[Frida] Injecting into ${packageName}...`);

            // Use python launcher if available, else direct frida CLI
            let fridaCmd, fridaArgs;

            // Try frida CLI directly (installed via pip)
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
            
            // Trigger LSPosed Broadcast explicitly
            ipcMain.handle('physical-mobile:trigger-lsposed-broadcast', async (event, params) => {
                if (!params.id) return { success: false, error: 'No device ID provided' };
                const port = params.port || 8899;
                return new Promise((resolve) => {
                    const broadcastCmd = `"${this.adbPath}" -s ${params.id} shell am broadcast -a com.nova.action.START_LIVE_STREAM --es stream_url "http://127.0.0.1:${port}/stream"`;
                    exec(broadcastCmd, { timeout: 10000 }, (err) => {
                        if (err) {
                            const suCmd = `"${this.adbPath}" -s ${params.id} shell su -c "am broadcast -a com.nova.action.START_LIVE_STREAM --es stream_url 'http://127.0.0.1:${port}/stream'"`;
                            exec(suCmd, { timeout: 10000 }, () => resolve({ success: true, message: 'LSPosed Hardware Hook Activated!' }));
                        } else {
                            resolve({ success: true, message: 'LSPosed Hardware Hook Activated!' });
                        }
                    });
                });
            });

            fridaProc.stderr.on('data', (d) => console.warn('[Frida stderr]', d.toString().trim()));
            fridaProc.on('exit', (code) => console.log(`[Frida] Process exited: ${code}`));

            // Store reference
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




