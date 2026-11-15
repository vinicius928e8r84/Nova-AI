/**
 * LiveCamBridgeService — Universal Bi-Directional Virtual Camera Bridge
 * 
 * 1. Mobile Camera -> PC Dashboard (Live Phone Camera on PC)
 *    - Universal Web Browser / QR Code (Works on ALL phones: iPhone, Android, iPad)
 *    - 1-Click ADB Scrcpy v4.1 Hardware Camera Stream (--video-source=camera)
 * 
 * 2. PC Webcam -> Mobile Live (Watch PC Webcam on Phone Screen)
 *    - Instant low-latency stream to any mobile device
 */

'use strict';

const http = require('http');
const https = require('https');
const os = require('os');
const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const QRCode = require('qrcode');
let selfsigned = null;
try {
    selfsigned = require('selfsigned');
} catch (e) {}

class LiveCamBridgeService {
    constructor(mainWindow, app, physicalMobileService) {
        this.mainWindow = mainWindow;
        this.app = app;
        this.physicalMobileService = physicalMobileService;

        this.server = null;
        this.httpFallbackServer = null;
        this.wss = null;
        this.port = 8899;
        this.httpPort = 8898;
        this.isHttps = false;
        this.isRunning = false;
        this.tunnelProcess = null;
        this.httpsUrl = null;

        this.mobileStreamClients = new Set(); // Phones sending video to PC
        this.mobileViewerClients = new Set(); // Phones watching PC video
        this.mobileSpoofClients = new Set();  // Phones playing spoof video from PC

        this.adbCameraProcesses = new Map(); // Scrcpy hardware camera instances

        this.lastPhoneFrame = null;
        this.activeSpoofVideoPath = null;
        this.activeSpoofVideoMeta = null;
        this.selectedIp = null;
    }

    // Detect and rank all available IPv4 addresses (prioritizes real Wi-Fi / LAN adapters over VPN / Virtual ones)
    getAllIps() {
        const interfaces = os.networkInterfaces();
        const candidates = [];

        const VIRTUAL_ADAPTER_KEYWORDS = [
            'vethernet', 'virtual', 'vmnet', 'vmware', 'vbox', 'virtualbox',
            'hyper-v', 'wsl', 'radmin', 'hamachi', 'tap', 'tun', 'docker',
            'loopback', 'teredo', 'npcap', 'tailscale', 'zerotier', 'wireguard',
            'nordlynx', 'openvpn', 'anyconnect', 'forticlient', 'cisco', 'p2p', 'bridge', 'pseudo'
        ];

        const PHYSICAL_KEYWORDS = [
            'wi-fi', 'wifi', 'wireless', 'wlan', 'ethernet', 'eth', 'en0', 'en1', 'lan', 'local area connection'
        ];

        for (const name of Object.keys(interfaces)) {
            const lowerName = name.toLowerCase();
            const isVirtual = VIRTUAL_ADAPTER_KEYWORDS.some(k => lowerName.includes(k));
            const isPhysical = PHYSICAL_KEYWORDS.some(k => lowerName.includes(k));

            for (const iface of interfaces[name]) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    const addr = iface.address;
                    if (addr.startsWith('127.') || addr.startsWith('169.254.')) {
                        continue;
                    }

                    let score = 50; // base score

                    if (isVirtual) {
                        score -= 100;
                    }
                    if (isPhysical) {
                        score += 100;
                    }

                    // Common home/office Wi-Fi ranges (192.168.x.x)
                    if (addr.startsWith('192.168.')) {
                        if (!addr.startsWith('192.168.56.')) { // 192.168.56.x is VirtualBox
                            score += 60;
                        } else {
                            score -= 60;
                        }
                    } else if (addr.startsWith('10.')) {
                        if (isVirtual || addr.startsWith('10.5.')) {
                            score -= 80;
                        } else {
                            score += 20;
                        }
                    } else if (addr.startsWith('172.')) {
                        const secondOctet = parseInt(addr.split('.')[1], 10);
                        if (secondOctet >= 16 && secondOctet <= 31) {
                            if (isVirtual) score -= 80;
                            else score += 10;
                        }
                    }

                    candidates.push({
                        ip: addr,
                        name: name,
                        score: score,
                        isVirtual: isVirtual
                    });
                }
            }
        }

        // Sort descending by score
        candidates.sort((a, b) => b.score - a.score);
        return candidates;
    }

    // Detect primary local IPv4 address
    getLocalIp() {
        if (this.selectedIp) {
            return this.selectedIp;
        }
        const candidates = this.getAllIps();
        if (candidates.length > 0) {
            return candidates[0].ip;
        }
        return '127.0.0.1';
    }

    // Allow user to manually select or switch network interface IP
    async setSelectedIp(ip) {
        this.selectedIp = ip;
        console.log('[LiveCamBridge] Network IP switched to:', ip);
        const status = await this.getStatus();
        this.notifyFrontend('live-cam:bridge-status-updated', status);
        return status;
    }

    // Start Live Bridge Server with Local Self-Signed HTTPS + HTTP fallback
    async startServer(preferredPort = 8899) {
        if (this.isRunning && this.server) {
            return this.getStatus();
        }

        this.port = preferredPort;
        this.httpPort = preferredPort - 1; // 8898
        const localIp = this.getLocalIp();

        // Generate selfsigned certificate for local IP
        let sslPems = null;
        if (selfsigned) {
            try {
                sslPems = await selfsigned.generate(
                    [
                        { name: 'commonName', value: localIp },
                        { name: 'organizationName', value: 'Nova AI Live Cam' }
                    ],
                    { days: 365 }
                );
            } catch (err) {
                console.warn('[LiveCamBridge] Selfsigned generation failed, falling back to HTTP:', err);
            }
        }

        return new Promise((resolve, reject) => {
            const requestHandler = (req, res) => this.handleHttpRequest(req, res);

            if (sslPems && sslPems.private && sslPems.cert) {
                this.isHttps = true;
                this.server = https.createServer({ key: sslPems.private, cert: sslPems.cert }, requestHandler);
                
                // Also create plain HTTP server that redirects to HTTPS or serves HTTP
                try {
                    this.httpFallbackServer = http.createServer((req, res) => {
                        res.writeHead(301, { Location: 'https://' + localIp + ':' + this.port + req.url });
                        res.end();
                    });
                    this.httpFallbackServer.listen(this.httpPort, '0.0.0.0');
                } catch (e) {}
            } else {
                this.isHttps = false;
                this.server = http.createServer(requestHandler);
            }

            this.wss = new WebSocket.Server({ server: this.server });

            this.wss.on('connection', (ws, req) => {
                const url = req.url || '';
                if (url.includes('role=sender')) {
                    // Mobile phone sending camera feed to PC
                    this.mobileStreamClients.add(ws);
                    this.notifyFrontend('live-cam:client-status', { type: 'sender', count: this.mobileStreamClients.size });

                    ws.on('message', (data) => {
                        this.lastPhoneFrame = data;
                        // Broadcast frame directly to Electron React renderer
                        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                            this.mainWindow.webContents.send('live-cam:phone-frame-received', data.toString());
                        }
                    });

                    ws.on('close', () => {
                        this.mobileStreamClients.delete(ws);
                        this.notifyFrontend('live-cam:client-status', { type: 'sender', count: this.mobileStreamClients.size });
                    });
                } else if (url.includes('role=viewer')) {
                    // Mobile phone watching PC webcam
                    this.mobileViewerClients.add(ws);
                    this.notifyFrontend('live-cam:client-status', { type: 'viewer', count: this.mobileViewerClients.size });

                    // Send latest PC frame immediately if available
                    if (this.lastPcFrame && ws.readyState === WebSocket.OPEN) {
                        ws.send(this.lastPcFrame);
                    }

                    ws.on('close', () => {
                        this.mobileViewerClients.delete(ws);
                        this.notifyFrontend('live-cam:client-status', { type: 'viewer', count: this.mobileViewerClients.size });
                    });
                } else if (url.includes('role=spoof-viewer')) {
                    // Mobile phone playing spoof video
                    this.mobileSpoofClients.add(ws);
                    this.notifyFrontend('live-cam:spoof-clients-changed', { count: this.mobileSpoofClients.size });

                    // Send initial spoof video state
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({
                            type: 'spoof-state',
                            hasVideo: !!this.activeSpoofVideoPath,
                            meta: this.activeSpoofVideoMeta
                        }));
                    }

                    ws.on('message', (msg) => {
                        try {
                            const data = JSON.parse(msg.toString());
                            if (data.type === 'spoof-status-update') {
                                this.notifyFrontend('live-cam:spoof-mobile-status', data);
                            }
                        } catch (e) {}
                    });

                    ws.on('close', () => {
                        this.mobileSpoofClients.delete(ws);
                        this.notifyFrontend('live-cam:spoof-clients-changed', { count: this.mobileSpoofClients.size });
                    });
                }
            });

            this.server.listen(this.port, '0.0.0.0', async () => {
                this.isRunning = true;
                const proto = this.isHttps ? 'https' : 'http';
                console.log('[LiveCamBridge] Server listening on ' + proto + '://' + localIp + ':' + this.port);

                const status = await this.getStatus();
                resolve(status);
            });

            this.server.on('error', (err) => {
                console.error('[LiveCamBridge] Server error:', err);
                this.isRunning = false;
                reject(err);
            });
        });
    }

    // Set Active Spoof Video (from PC Dashboard)
    setSpoofVideo(filePath, meta = {}) {
        this.activeSpoofVideoPath = filePath;
        this.activeSpoofVideoMeta = meta;
        console.log('[LiveCamBridge] Active spoof video set to:', filePath);

        // Notify all connected mobile spoof viewers
        this.broadcastSpoofCommand({
            type: 'load-video',
            hasVideo: !!filePath,
            meta: meta,
            timestamp: Date.now()
        });

        this.notifyFrontend('live-cam:spoof-video-updated', {
            hasVideo: !!filePath,
            filePath,
            meta
        });

        return { success: true, filePath };
    }

    // Broadcast Command to Mobile Spoof Viewers (play, pause, seek, loop, etc.)
    broadcastSpoofCommand(command) {
        if (this.mobileSpoofClients.size === 0) return;
        const payload = typeof command === 'string' ? command : JSON.stringify(command);

        for (const ws of this.mobileSpoofClients) {
            if (ws.readyState === WebSocket.OPEN) {
                try {
                    ws.send(payload);
                } catch (e) {}
            }
        }
    }

    // Stop Live Bridge Server
    async stopServer() {
        if (this.wss) {
            try { this.wss.close(); } catch (e) {}
            this.wss = null;
        }
        if (this.server) {
            await new Promise(r => this.server.close(r));
            this.server = null;
        }
        if (this.httpFallbackServer) {
            try { this.httpFallbackServer.close(); } catch (e) {}
            this.httpFallbackServer = null;
        }
        this.isRunning = false;
        this.mobileStreamClients.clear();
        this.mobileViewerClients.clear();
        this.mobileSpoofClients.clear();
        console.log('[LiveCamBridge] Server stopped');
        return { success: true };
    }

    // Push PC frame to mobile viewers
    pushPcFrame(base64Frame) {
        this.lastPcFrame = base64Frame;
        if (this.mobileViewerClients.size === 0) return;

        for (const ws of this.mobileViewerClients) {
            if (ws.readyState === WebSocket.OPEN) {
                try {
                    ws.send(base64Frame);
                } catch (e) {}
            }
        }
    }

    // Start Android Scrcpy v4.1 Physical Camera Stream (1-Click USB/Wi-Fi)
    async startAdbCameraStream(deviceId, facing = 'back', resolution = '1920x1080', fps = '60') {
        const scrcpyPath = this.physicalMobileService?.scrcpyPath || path.join(__dirname, (process.platform === 'darwin' ? '../../resources/bin/scrcpy' : (process.platform === 'darwin' ? '../../resources/bin/scrcpy' : (process.platform === 'darwin' ? '../../resources/bin/scrcpy' : (process.platform === 'darwin' ? '../../resources/bin/scrcpy' : (process.platform === 'darwin' ? '../../resources/bin/scrcpy' : '../../resources/scrcpy/scrcpy.exe'))))));
        
        if (!fs.existsSync(scrcpyPath)) {
            return { success: false, error: 'Scrcpy executable not found.' };
        }

        const procKey = deviceId + '-' + facing;
        if (this.adbCameraProcesses.has(procKey)) {
            return { success: true, message: 'Camera stream already active.' };
        }

        const args = [
            '-s', deviceId,
            '--video-source=camera',
            '--camera-facing=' + facing,
            '--camera-size=' + resolution,
            '--camera-fps=' + fps,
            '--window-title', 'Nova AI Live Mobile Camera - [' + deviceId + ']',
            '--stay-awake',
            '--no-audio',
            '--video-codec=h264',
            '--tunnel-host=127.0.0.1'
        ];

        console.log('[LiveCamBridge] Spawning Scrcpy v4.1 Hardware Camera:', args);
        const proc = spawn(scrcpyPath, args, { windowsHide: false });
        this.adbCameraProcesses.set(procKey, proc);

        proc.on('close', (code) => {
            console.log('[LiveCamBridge] ADB Camera stream for ' + procKey + ' exited with code ' + code);
            this.adbCameraProcesses.delete(procKey);
            this.notifyFrontend('live-cam:adb-camera-status', { deviceId, facing, active: false });
        });

        this.notifyFrontend('live-cam:adb-camera-status', { deviceId, facing, active: true });
        return { success: true, message: 'Scrcpy Camera (' + facing + ') started successfully!' };
    }

    // Stop Android Scrcpy Camera
    async stopAdbCameraStream(deviceId, facing = 'back') {
        const procKey = deviceId + '-' + facing;
        const proc = this.adbCameraProcesses.get(procKey);
        if (proc) {
            try { proc.kill(); } catch (e) {}
            this.adbCameraProcesses.delete(procKey);
        }
        this.notifyFrontend('live-cam:adb-camera-status', { deviceId, facing, active: false });
        return { success: true };
    }

    // Get Status + QR Codes
    async getStatus() {
        const localIp = this.getLocalIp();
        const availableIps = this.getAllIps().map(c => ({
            ip: c.ip,
            name: c.name,
            isVirtual: c.isVirtual,
            isSelected: c.ip === localIp
        }));
        const proto = this.isHttps ? 'https' : 'http';
        const localHttpsUrl = proto + '://' + localIp + ':' + this.port + '/phone-cam';
        const localPcUrl = proto + '://' + localIp + ':' + this.port + '/pc-cam';
        const spoofCamUrl = proto + '://' + localIp + ':' + this.port + '/spoof-cam';
        const cloudTunnelUrl = this.httpsUrl ? (this.httpsUrl + '/phone-cam') : null;
        const cloudSpoofUrl = this.httpsUrl ? (this.httpsUrl + '/spoof-cam') : null;

        const phoneToPcUrl = localHttpsUrl;
        const pcToPhoneUrl = localPcUrl;

        let qrPhoneCam = '';
        let qrPcCam = '';
        let qrSpoofCam = '';
        let qrCloudTunnel = '';

        try {
            qrPhoneCam = await QRCode.toDataURL(phoneToPcUrl, { margin: 1, width: 220, color: { dark: '#00E5FF', light: '#050A10' } });
            qrPcCam = await QRCode.toDataURL(pcToPhoneUrl, { margin: 1, width: 220, color: { dark: '#00ff8f', light: '#050A10' } });
            qrSpoofCam = await QRCode.toDataURL(spoofCamUrl, { margin: 1, width: 220, color: { dark: '#FF0055', light: '#050A10' } });
            if (cloudTunnelUrl) {
                qrCloudTunnel = await QRCode.toDataURL(cloudTunnelUrl, { margin: 1, width: 220, color: { dark: '#00E5FF', light: '#050A10' } });
            }
        } catch (e) {
            console.warn('[LiveCamBridge] QR generation error:', e.message);
        }

        return {
            active: this.isRunning,
            isHttps: this.isHttps,
            localIp,
            availableIps,
            port: this.port,
            phoneToPcUrl,
            pcToPhoneUrl,
            spoofCamUrl,
            cloudTunnelUrl,
            cloudSpoofUrl,
            qrPhoneCam,
            qrPcCam,
            qrSpoofCam,
            qrCloudTunnel,
            hasSpoofVideo: !!this.activeSpoofVideoPath,
            activeSpoofVideoPath: this.activeSpoofVideoPath,
            activeSpoofVideoMeta: this.activeSpoofVideoMeta,
            sendersCount: this.mobileStreamClients.size,
            viewersCount: this.mobileViewerClients.size,
            spoofClientsCount: this.mobileSpoofClients.size
        };
    }

    notifyFrontend(channel, payload) {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send(channel, payload);
        }
    }

    // Serve HTML Pages for Mobile Phone & PC
    handleHttpRequest(req, res) {
        const url = req.url || '/';
        res.setHeader('Access-Control-Allow-Origin', '*');

        // 1. Serve Video Stream (with HTTP 206 Partial Content / Range support)
        if (url.startsWith('/api/spoof-video') || url.startsWith('/video/stream') || url.startsWith('/spoof-stream')) {
            if (!this.activeSpoofVideoPath || !fs.existsSync(this.activeSpoofVideoPath)) {
                res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                return res.end('No spoof video active. Please select a video on the Nova AI dashboard.');
            }
            try {
                const stat = fs.statSync(this.activeSpoofVideoPath);
                const fileSize = stat.size;
                const range = req.headers.range;

                if (range) {
                    const parts = range.replace(/bytes=/, "").split("-");
                    const start = parseInt(parts[0], 10);
                    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
                    const chunksize = (end - start) + 1;
                    const file = fs.createReadStream(this.activeSpoofVideoPath, { start, end });
                    res.writeHead(206, {
                        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                        'Accept-Ranges': 'bytes',
                        'Content-Length': chunksize,
                        'Content-Type': 'video/mp4',
                    });
                    file.pipe(res);
                } else {
                    res.writeHead(200, {
                        'Content-Length': fileSize,
                        'Content-Type': 'video/mp4',
                        'Accept-Ranges': 'bytes'
                    });
                    fs.createReadStream(this.activeSpoofVideoPath).pipe(res);
                }
            } catch (err) {
                console.error('[LiveCamBridge] Video stream error:', err);
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Error streaming video: ' + err.message);
            }
            return;
        }

        // 2. HTML Routes
        if (url === '/phone-cam' || url === '/phone') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(this.getPhoneCameraSenderHtml());
        } else if (url === '/pc-cam' || url === '/pc') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(this.getPcCameraViewerHtml());
        } else if (url === '/spoof-cam' || url === '/spoof' || url === '/mobile-spoof') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(this.getMobileSpoofPlayerHtml());
        } else {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(this.getHubHtml());
        }
    }

    // HTML for Mobile Phone Streaming Camera to PC Dashboard
    getPhoneCameraSenderHtml() {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Nova AI - Mobile Camera</title>
    <style>
        * { margin:0; padding:0; box-sizing:border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; -webkit-tap-highlight-color: transparent; }
        body { background:#050A10; color:#E2E8F0; display:flex; flex-direction:column; height:100vh; overflow:hidden; }
        .header { padding:14px 16px; background:#0A1118; border-bottom:1px solid rgba(0,229,255,0.2); display:flex; justify-content:space-between; align-items:center; z-index:20; }
        .title { font-weight:800; font-size:14px; color:#00E5FF; letter-spacing:1.5px; text-transform:uppercase; display:flex; align-items:center; gap:6px; }
        .status { font-size:10px; padding:4px 10px; border-radius:20px; font-weight:800; background:rgba(255,255,255,0.08); color:#94a3b8; text-transform:uppercase; letter-spacing:1px; }
        .status.connected { background:rgba(0,255,143,0.15); color:#00ff8f; border:1px solid rgba(0,255,143,0.4); }
        .status.streaming { background:rgba(0,229,255,0.2); color:#00E5FF; border:1px solid rgba(0,229,255,0.6); box-shadow:0 0 10px rgba(0,229,255,0.3); }
        .video-container { flex:1; position:relative; background:#000; display:flex; align-items:center; justify-content:center; overflow:hidden; }
        video { width:100%; height:100%; object-fit:cover; }
        canvas { display:none; }
        
        /* Start Screen Modal Overlay */
        .start-overlay { position:absolute; inset:0; background:rgba(5,10,16,0.95); display:flex; flex-direction:column; align-items:center; justify-content:center; padding:24px; text-align:center; z-index:30; }
        .start-btn { width:100%; max-width:320px; padding:20px; border-radius:20px; font-size:16px; font-weight:900; background:linear-gradient(135deg, #00E5FF 0%, #00ff8f 100%); color:#050A10; border:none; cursor:pointer; box-shadow:0 10px 30px rgba(0,229,255,0.4); text-transform:uppercase; letter-spacing:1.5px; display:flex; align-items:center; justify-content:center; gap:10px; animation:pulse 2s infinite; }
        @keyframes pulse { 0%, 100% { transform:scale(1); } 50% { transform:scale(1.03); } }
        
        .controls-bar { position:absolute; bottom:20px; left:16px; right:16px; display:flex; gap:10px; z-index:15; }
        .ctrl-btn { flex:1; padding:15px; border-radius:16px; font-size:12px; font-weight:800; text-transform:uppercase; letter-spacing:1px; border:none; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px; box-shadow:0 6px 20px rgba(0,0,0,0.6); }
        .btn-flip { background:rgba(15,23,42,0.85); color:#00E5FF; border:1px solid rgba(0,229,255,0.4); backdrop-filter:blur(10px); }
        .btn-stop { background:rgba(239,68,68,0.85); color:#fff; border:1px solid rgba(239,68,68,0.4); backdrop-filter:blur(10px); }
        
        .stats-badge { position:absolute; top:16px; left:16px; padding:6px 12px; background:rgba(0,0,0,0.7); backdrop-filter:blur(6px); border:1px solid rgba(255,255,255,0.1); border-radius:10px; font-size:11px; font-mono; color:#00ff8f; z-index:15; display:flex; align-items:center; gap:6px; }
    </style>
</head>
<body>
    <div class="header">
        <div class="title">📱 Nova Live Camera</div>
        <div id="status" class="status">Connecting...</div>
    </div>
    
    <div class="video-container">
        <video id="video" autoplay playsinline muted></video>
        <canvas id="canvas"></canvas>

        <div id="statsBadge" class="stats-badge" style="display:none;">
            <span style="width:8px; height:8px; border-radius:50%; background:#00ff8f; display:inline-block; animation:pulse 1s infinite;"></span>
            <span id="statsText">0 FPS | 0 Frames</span>
        </div>

        <!-- Big Tap-To-Start Overlay -->
        <div id="startOverlay" class="start-overlay">
            <div style="font-size:48px; margin-bottom:16px;">📷</div>
            <h2 style="color:#00E5FF; font-size:20px; font-weight:800; text-transform:uppercase; margin-bottom:8px; letter-spacing:1px;">Nova PC Cam Link</h2>
            <p style="color:#94a3b8; font-size:13px; margin-bottom:28px; line-height:1.5; max-width:280px;">Tap below to start streaming your phone camera directly to the PC Dashboard.</p>
            <button id="startBtn" class="start-btn">⚡ Start Live Camera</button>
        </div>

        <!-- Live Controls (Visible when streaming) -->
        <div id="controlsBar" class="controls-bar" style="display:none;">
            <button id="flipBtn" class="ctrl-btn btn-flip">🔄 Flip Camera</button>
            <button id="stopBtn" class="ctrl-btn btn-stop">⏹ Stop Stream</button>
        </div>
    </div>

    <script>
        let ws = null;
        let stream = null;
        let isStreaming = false;
        let facingMode = 'environment';
        let sendInterval = null;
        let framesSent = 0;
        let lastFpsCount = 0;
        let lastFpsTime = Date.now();
        let currentFps = 0;

        const video = document.getElementById('video');
        const canvas = document.getElementById('canvas');
        const ctx = canvas.getContext('2d');
        const statusEl = document.getElementById('status');
        const startOverlay = document.getElementById('startOverlay');
        const startBtn = document.getElementById('startBtn');
        const controlsBar = document.getElementById('controlsBar');
        const flipBtn = document.getElementById('flipBtn');
        const stopBtn = document.getElementById('stopBtn');
        const statsBadge = document.getElementById('statsBadge');
        const statsText = document.getElementById('statsText');

        function connectWs() {
            const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
            ws = new WebSocket(proto + '//' + location.host + '/?role=sender');

            ws.onopen = () => {
                if (isStreaming) {
                    statusEl.textContent = 'STREAMING LIVE';
                    statusEl.className = 'status streaming';
                } else {
                    statusEl.textContent = 'CONNECTED TO PC';
                    statusEl.className = 'status connected';
                }
            };

            ws.onclose = () => {
                statusEl.textContent = 'RECONNECTING...';
                statusEl.className = 'status';
                setTimeout(connectWs, 2000);
            };
        }

        async function initCamera() {
            if (stream) {
                stream.getTracks().forEach(t => t.stop());
            }
            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        facingMode: { ideal: facingMode },
                        width: { ideal: 1280 },
                        height: { ideal: 720 },
                        frameRate: { ideal: 30 }
                    },
                    audio: false
                });
                video.srcObject = stream;
                await video.play();

                startOverlay.style.display = 'none';
                controlsBar.style.display = 'flex';
                statsBadge.style.display = 'flex';

                startSendingLoop();
            } catch (err) {
                alert('Camera Permission Error: ' + err.message + '\\nPlease ensure camera access is allowed in browser settings.');
            }
        }

        function startSendingLoop() {
            isStreaming = true;
            statusEl.textContent = 'STREAMING LIVE';
            statusEl.className = 'status streaming';

            if (sendInterval) clearInterval(sendInterval);

            sendInterval = setInterval(() => {
                if (ws && ws.readyState === WebSocket.OPEN && video.videoWidth > 0) {
                    canvas.width = 640;
                    canvas.height = 480;
                    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                    const base64 = canvas.toDataURL('image/jpeg', 0.65);
                    ws.send(base64);
                    
                    framesSent++;
                    lastFpsCount++;
                    const now = Date.now();
                    if (now - lastFpsTime >= 1000) {
                        currentFps = lastFpsCount;
                        lastFpsCount = 0;
                        lastFpsTime = now;
                        statsText.textContent = currentFps + ' FPS | ' + framesSent + ' Frames';
                    }
                }
            }, 40); // 25 FPS
        }

        function stopStreaming() {
            isStreaming = false;
            if (sendInterval) clearInterval(sendInterval);
            if (stream) {
                stream.getTracks().forEach(t => t.stop());
                stream = null;
            }
            video.srcObject = null;
            startOverlay.style.display = 'flex';
            controlsBar.style.display = 'none';
            statsBadge.style.display = 'none';
            statusEl.textContent = 'CONNECTED TO PC';
            statusEl.className = 'status connected';
        }

        startBtn.addEventListener('click', () => {
            initCamera();
        });

        stopBtn.addEventListener('click', () => {
            stopStreaming();
        });

        flipBtn.addEventListener('click', async () => {
            facingMode = facingMode === 'environment' ? 'user' : 'environment';
            await initCamera();
        });

        connectWs();
    </script>
</body>
</html>`;
    }

    // HTML for Mobile Phone Watching PC Webcam
    getPcCameraViewerHtml() {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Nova AI - PC Webcam Live Viewer</title>
    <style>
        * { margin:0; padding:0; box-sizing:border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
        body { background:#050A10; color:#E2E8F0; display:flex; flex-direction:column; height:100vh; overflow:hidden; }
        .header { padding:14px; background:#0A1118; border-bottom:1px solid rgba(0,255,143,0.2); display:flex; justify-content:space-between; align-items:center; }
        .title { font-weight:800; font-size:14px; color:#00ff8f; letter-spacing:1.5px; text-transform:uppercase; }
        .status { font-size:11px; padding:4px 10px; border-radius:20px; font-weight:700; background:rgba(255,255,255,0.05); color:#94a3b8; }
        .status.connected { background:rgba(0,255,143,0.15); color:#00ff8f; border:1px solid rgba(0,255,143,0.4); }
        .viewer { flex:1; display:flex; align-items:center; justify-content:center; background:#000; position:relative; }
        img { width:100%; height:100%; object-fit:contain; }
        .waiting { position:absolute; font-size:13px; color:#64748b; font-weight:700; text-transform:uppercase; letter-spacing:1px; }
    </style>
</head>
<body>
    <div class="header">
        <div class="title">PC Live Feed</div>
        <div id="status" class="status">Connecting to PC...</div>
    </div>
    <div class="viewer">
        <div id="waiting" class="waiting">Awaiting PC webcam stream...</div>
        <img id="streamImg" style="display:none;" />
    </div>

    <script>
        const statusEl = document.getElementById('status');
        const streamImg = document.getElementById('streamImg');
        const waitingEl = document.getElementById('waiting');

        function connect() {
            const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
            const ws = new WebSocket(proto + '//' + location.host + '/?role=viewer');

            ws.onopen = () => {
                statusEl.textContent = 'LIVE FROM PC';
                statusEl.className = 'status connected';
            };

            ws.onmessage = (event) => {
                streamImg.src = event.data;
                streamImg.style.display = 'block';
                waitingEl.style.display = 'none';
            };

            ws.onclose = () => {
                statusEl.textContent = 'DISCONNECTED';
                statusEl.className = 'status';
                setTimeout(connect, 2000);
            };
        }

        connect();
    </script>
</body>
</html>`;
    }

    // HTML for Mobile Phone Playing Spoof Video as Live Camera Feed (Stonic AI Style)
    getMobileSpoofPlayerHtml() {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    <title>Nova AI - Stonic Mobile Spoof Cam</title>
    <style>
        * { margin:0; padding:0; box-sizing:border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; -webkit-tap-highlight-color: transparent; }
        body { background:#000; color:#fff; height:100vh; width:100vw; overflow:hidden; display:flex; flex-direction:column; position:relative; }
        
        .video-wrapper { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; background:#000; overflow:hidden; }
        video { width:100%; height:100%; object-fit:cover; transition:transform 0.2s ease; }
        video.mirrored { transform:scaleX(-1); }
        video.contain { object-fit:contain; }
        
        /* Camera Simulation HUD Overlay */
        .hud-overlay { position:absolute; inset:0; pointer-events:none; display:flex; flex-direction:column; justify-content:space-between; padding:20px 16px env(safe-area-inset-bottom, 20px) 16px; z-index:10; transition:opacity 0.3s ease; }
        .hud-overlay.hidden { opacity:0; }
        
        .hud-top { display:flex; justify-content:space-between; align-items:center; }
        .rec-badge { display:flex; align-items:center; gap:8px; background:rgba(0,0,0,0.6); backdrop-filter:blur(8px); padding:6px 12px; border-radius:20px; font-size:11px; font-weight:800; font-family:monospace; border:1px solid rgba(255,255,255,0.15); }
        .rec-dot { width:10px; height:10px; border-radius:50%; background:#ef4444; animation:blink 1s infinite; }
        @keyframes blink { 0%, 100% { opacity:1; } 50% { opacity:0.3; } }
        .hud-specs { font-size:11px; font-weight:800; font-family:monospace; color:#00E5FF; background:rgba(0,0,0,0.6); backdrop-filter:blur(8px); padding:6px 12px; border-radius:20px; border:1px solid rgba(0,229,255,0.3); }
        
        /* Focus Reticle */
        .focus-box { position:absolute; top:50%; left:50%; transform:translate(-50%, -50%); width:120px; height:120px; border:1.5px solid rgba(255,255,255,0.4); border-radius:12px; pointer-events:none; }
        .focus-box::before { content:''; position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); width:6px; height:6px; background:#00E5FF; border-radius:50%; }
        
        /* Floating Interactive Controls */
        .controls-layer { position:absolute; bottom:24px; left:16px; right:16px; display:flex; justify-content:center; gap:10px; z-index:20; }
        .ctrl-btn { padding:12px 18px; border-radius:16px; background:rgba(15,23,42,0.85); backdrop-filter:blur(12px); border:1px solid rgba(255,255,255,0.2); color:#fff; font-size:12px; font-weight:800; text-transform:uppercase; letter-spacing:1px; cursor:pointer; display:flex; align-items:center; gap:6px; box-shadow:0 8px 24px rgba(0,0,0,0.6); }
        .ctrl-btn.active { background:#00E5FF; color:#050A10; border-color:#00E5FF; }
        .ctrl-btn.sound { background:rgba(0,255,143,0.2); border-color:rgba(0,255,143,0.5); color:#00ff8f; }
        
        /* Empty State Modal */
        .empty-overlay { position:absolute; inset:0; background:rgba(5,10,16,0.96); display:flex; flex-direction:column; align-items:center; justify-content:center; padding:24px; text-align:center; z-index:30; }
        .empty-icon { width:70px; height:70px; border-radius:24px; background:rgba(0,229,255,0.1); border:2px solid rgba(0,229,255,0.3); display:flex; align-items:center; justify-content:center; font-size:32px; margin-bottom:16px; animation:float 3s ease-in-out infinite; }
        @keyframes float { 0%, 100% { transform:translateY(0); } 50% { transform:translateY(-8px); } }
        .empty-title { font-size:18px; font-weight:900; color:#00E5FF; text-transform:uppercase; letter-spacing:1.5px; margin-bottom:8px; }
        .empty-desc { font-size:13px; color:#94a3b8; max-width:280px; line-height:1.5; }
    </style>
</head>
<body>
    <div class="video-wrapper" id="videoWrapper">
        <video id="spoofVideo" src="/api/spoof-video" autoplay loop playsinline muted></video>
        
        <div class="hud-overlay" id="hudOverlay">
            <div class="hud-top">
                <div class="rec-badge"><div class="rec-dot"></div> REC <span id="timecode">00:00:00</span></div>
                <div class="hud-specs">4K 60FPS • RAW</div>
            </div>
            <div class="focus-box"></div>
            <div style="font-size:10px; font-family:monospace; color:rgba(255,255,255,0.4); text-align:center;">LIVE VIRTUAL CAM BROADCAST</div>
        </div>

        <div class="controls-layer" id="controlsLayer">
            <button class="ctrl-btn" id="btnHud" title="Toggle Camera HUD">📸 HUD</button>
            <button class="ctrl-btn" id="btnFlip" title="Mirror View">🔄 Flip</button>
            <button class="ctrl-btn" id="btnFit" title="Aspect Ratio">📐 Fit</button>
            <button class="ctrl-btn sound" id="btnSound" title="Mute/Unmute">🔊 Audio</button>
            <button class="ctrl-btn" id="btnFull" title="Fullscreen">⛶ Max</button>
        </div>
    </div>

    <div class="empty-overlay" id="emptyOverlay" style="display:none;">
        <div class="empty-icon">📹</div>
        <div class="empty-title">Waiting for Video</div>
        <div class="empty-desc">Please upload or select a spoof video on the Nova AI PC Dashboard. The video will play here live automatically!</div>
    </div>

    <script>
        const video = document.getElementById('spoofVideo');
        const hud = document.getElementById('hudOverlay');
        const empty = document.getElementById('emptyOverlay');
        const timecodeEl = document.getElementById('timecode');
        const btnHud = document.getElementById('btnHud');
        const btnFlip = document.getElementById('btnFlip');
        const btnFit = document.getElementById('btnFit');
        const btnSound = document.getElementById('btnSound');
        const btnFull = document.getElementById('btnFull');

        let isMirrored = false;
        let isFitContain = false;
        let isHudVisible = true;
        let isMuted = true;
        let startTime = Date.now();

        // Update live timecode
        setInterval(() => {
            if (!video.paused) {
                const totalSeconds = Math.floor(video.currentTime || ((Date.now() - startTime) / 1000));
                const hrs = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
                const mins = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
                const secs = String(totalSeconds % 60).padStart(2, '0');
                timecodeEl.textContent = hrs + ':' + mins + ':' + secs;
            }
        }, 500);

        // Video Error Check
        video.onerror = () => {
            empty.style.display = 'flex';
        };

        video.onloadeddata = () => {
            empty.style.display = 'none';
            video.play().catch(() => {});
        };

        // Button Listeners
        btnHud.addEventListener('click', () => {
            isHudVisible = !isHudVisible;
            hud.classList.toggle('hidden', !isHudVisible);
            btnHud.classList.toggle('active', isHudVisible);
        });

        btnFlip.addEventListener('click', () => {
            isMirrored = !isMirrored;
            video.classList.toggle('mirrored', isMirrored);
            btnFlip.classList.toggle('active', isMirrored);
        });

        btnFit.addEventListener('click', () => {
            isFitContain = !isFitContain;
            video.classList.toggle('contain', isFitContain);
            btnFit.classList.toggle('active', isFitContain);
        });

        btnSound.addEventListener('click', () => {
            isMuted = !isMuted;
            video.muted = isMuted;
            btnSound.textContent = isMuted ? '🔇 Audio' : '🔊 Audio';
            btnSound.classList.toggle('active', !isMuted);
            video.play().catch(() => {});
        });

        btnFull.addEventListener('click', () => {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(() => {});
            } else {
                document.exitFullscreen().catch(() => {});
            }
        });

        // WebSocket Bi-Directional Synchronization with PC Dashboard
        function connectWs() {
            const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
            const ws = new WebSocket(proto + '//' + location.host + '/?role=spoof-viewer');

            ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    if (msg.type === 'load-video' || msg.type === 'spoof-state') {
                        if (msg.hasVideo) {
                            empty.style.display = 'none';
                            video.src = '/api/spoof-video?t=' + Date.now();
                            video.load();
                            video.play().catch(() => {});
                        } else {
                            empty.style.display = 'flex';
                        }
                    } else if (msg.type === 'play') {
                        video.play().catch(() => {});
                    } else if (msg.type === 'pause') {
                        video.pause();
                    } else if (msg.type === 'restart') {
                        video.currentTime = 0;
                        video.play().catch(() => {});
                    } else if (msg.type === 'speed' && msg.speed) {
                        video.playbackRate = msg.speed;
                    }
                } catch (e) {}
            };

            ws.onclose = () => {
                setTimeout(connectWs, 2000);
            };
        }

        connectWs();

        // Autoplay helper for mobile iOS/Android
        document.body.addEventListener('click', () => {
            if (video.paused) {
                video.play().catch(() => {});
            }
        }, { once: true });
    </script>
</body>
</html>`;
    }

    // Landing Hub
    getHubHtml() {
        return `<!DOCTYPE html>
<html>
<head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Nova AI Virtual Camera Hub</title>
    <style>
        body { background:#050A10; color:#E2E8F0; font-family:sans-serif; text-align:center; padding:30px 20px; }
        h1 { color:#00E5FF; font-size:22px; margin-bottom:8px; text-transform:uppercase; }
        p { color:#94a3b8; font-size:14px; margin-bottom:24px; }
        .card { background:#0A1118; border:1px solid rgba(0,229,255,0.2); border-radius:18px; padding:20px; margin:16px auto; max-width:380px; text-align:left; }
        a { display:block; padding:14px; background:#00E5FF; color:#050A10; text-decoration:none; border-radius:12px; font-weight:800; text-align:center; margin-top:12px; text-transform:uppercase; }
        a.spoof { background:linear-gradient(135deg, #FF0055, #FF5500); color:#fff; }
        a.pc { background:#00ff8f; }
    </style>
</head>
<body>
    <h1>Nova Virtual Camera Hub</h1>
    <p>Bi-directional Mobile & PC Camera Link</p>

    <div class="card" style="border-color:rgba(255,0,85,0.4);">
        <h3 style="color:#FF0055;">🎬 Stonic Mobile Video Spoofer</h3>
        <p style="font-size:12px; margin-top:4px;">Play your uploaded dashboard video as a live camera stream on this phone.</p>
        <a href="/spoof-cam" class="spoof">Open Mobile Spoof Cam</a>
    </div>

    <div class="card">
        <h3 style="color:#00E5FF;">Phone Camera -> PC Dashboard</h3>
        <p style="font-size:12px; margin-top:4px;">Stream this phone's physical back/front camera into the Nova AI PC dashboard live.</p>
        <a href="/phone-cam">Open Phone Camera</a>
    </div>

    <div class="card">
        <h3 style="color:#00ff8f;">PC Webcam -> Phone Screen</h3>
        <p style="font-size:12px; margin-top:4px;">Watch the PC's webcam or screen live on this mobile device.</p>
        <a href="/pc-cam" class="pc">Watch PC Webcam</a>
    </div>
</body>
</html>`;
    }
}

module.exports = LiveCamBridgeService;
