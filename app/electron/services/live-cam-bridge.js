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

const PAGINAS = require('./live-cam-paginas');

const ADAPTADORES_VIRTUAIS = [
    'vethernet', 'virtual', 'vmnet', 'vmware', 'vbox', 'virtualbox',
    'hyper-v', 'wsl', 'radmin', 'hamachi', 'tap', 'tun', 'docker',
    'loopback', 'teredo', 'npcap', 'tailscale', 'zerotier', 'wireguard',
    'nordlynx', 'openvpn', 'anyconnect', 'forticlient', 'cisco', 'p2p', 'bridge', 'pseudo'
];

const ADAPTADORES_FISICOS = [
    'wi-fi', 'wifi', 'wireless', 'wlan', 'ethernet', 'eth', 'en0', 'en1', 'lan', 'local area connection'
];

const PONTOS_DE_PARTIDA = 50;
const PONTOS_DO_TIPO_DE_ADAPTADOR = 100;

const contemAlguma = (nome, palavras) => palavras.some(palavra => nome.includes(palavra));

function tipoDoAdaptador(nome) {
    const minusculo = nome.toLowerCase();
    return {
        isVirtual: contemAlguma(minusculo, ADAPTADORES_VIRTUAIS),
        isPhysical: contemAlguma(minusculo, ADAPTADORES_FISICOS)
    };
}

const ehIpv4Externo = iface => iface.family === 'IPv4' && !iface.internal;

const ehLoopbackOuLinkLocal = endereco => endereco.startsWith('127.') || endereco.startsWith('169.254.');

function ehFaixaPrivada172(endereco) {
    const segundoOcteto = parseInt(endereco.split('.')[1], 10);
    return segundoOcteto >= 16 && segundoOcteto <= 31;
}

function pontosDaFaixa172(endereco, isVirtual) {
    if (!ehFaixaPrivada172(endereco)) {
        return 0;
    }
    return isVirtual ? -80 : 10;
}

const PONTOS_POR_FAIXA = [
    { prefixo: '192.168.', pontos: endereco => (endereco.startsWith('192.168.56.') ? -60 : 60) },
    { prefixo: '10.', pontos: (endereco, isVirtual) => (isVirtual || endereco.startsWith('10.5.') ? -80 : 20) },
    { prefixo: '172.', pontos: pontosDaFaixa172 }
];

function pontosDaFaixa(endereco, isVirtual) {
    const faixa = PONTOS_POR_FAIXA.find(({ prefixo }) => endereco.startsWith(prefixo));
    return faixa ? faixa.pontos(endereco, isVirtual) : 0;
}

function pontuacaoDoEndereco(endereco, adaptador) {
    let pontos = PONTOS_DE_PARTIDA + pontosDaFaixa(endereco, adaptador.isVirtual);
    if (adaptador.isVirtual) {
        pontos -= PONTOS_DO_TIPO_DE_ADAPTADOR;
    }
    if (adaptador.isPhysical) {
        pontos += PONTOS_DO_TIPO_DE_ADAPTADOR;
    }
    return pontos;
}

function candidatosDoAdaptador(nome, enderecos) {
    const adaptador = tipoDoAdaptador(nome);
    return enderecos
        .filter(ehIpv4Externo)
        .map(iface => iface.address)
        .filter(endereco => !ehLoopbackOuLinkLocal(endereco))
        .map(endereco => ({
            ip: endereco,
            name: nome,
            score: pontuacaoDoEndereco(endereco, adaptador),
            isVirtual: adaptador.isVirtual
        }));
}

function enderecosPorPreferencia(interfaces) {
    const candidatos = Object.keys(interfaces).flatMap(nome => candidatosDoAdaptador(nome, interfaces[nome]));
    return candidatos.sort((a, b) => b.score - a.score);
}

async function gerarCertificado(localIp) {
    if (!selfsigned) {
        return null;
    }
    try {
        return await selfsigned.generate(
            [
                { name: 'commonName', value: localIp },
                { name: 'organizationName', value: 'Nova AI Live Cam' }
            ],
            { days: 365 }
        );
    } catch (err) {
        console.warn('[LiveCamBridge] Selfsigned generation failed, falling back to HTTP:', err);
        return null;
    }
}

const temCertificado = sslPems => sslPems?.private && sslPems.cert;

const PAPEIS_DO_CELULAR = [
    { marca: 'role=sender', conectar: (servico, ws) => servico.conectarRemetente(ws) },
    { marca: 'role=viewer', conectar: (servico, ws) => servico.conectarEspectador(ws) },
    { marca: 'role=spoof-viewer', conectar: (servico, ws) => servico.conectarEspectadorDoSpoof(ws) }
];

const ROTAS_DO_VIDEO = ['/api/spoof-video', '/video/stream', '/spoof-stream'];

const ehRotaDoVideo = url => ROTAS_DO_VIDEO.some(rota => url.startsWith(rota));

const PAGINA_POR_ROTA = new Map([
    ['/phone-cam', 'getPhoneCameraSenderHtml'],
    ['/phone', 'getPhoneCameraSenderHtml'],
    ['/pc-cam', 'getPcCameraViewerHtml'],
    ['/pc', 'getPcCameraViewerHtml'],
    ['/spoof-cam', 'getMobileSpoofPlayerHtml'],
    ['/spoof', 'getMobileSpoofPlayerHtml'],
    ['/mobile-spoof', 'getMobileSpoofPlayerHtml']
]);

function trechoPedido(range, fileSize) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    return { start, end };
}

const scrcpyEmbutido = () => (process.platform === 'darwin' ? '../../resources/bin/scrcpy' : '../../resources/scrcpy/scrcpy.exe');

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
        return enderecosPorPreferencia(os.networkInterfaces());
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
        this.httpPort = preferredPort - 1;
        const localIp = this.getLocalIp();
        const sslPems = await gerarCertificado(localIp);

        return new Promise((resolve, reject) => {
            this.criarServidor(sslPems, localIp);
            this.wss = new WebSocket.Server({ server: this.server });
            this.wss.on('connection', (ws, req) => this.aceitarCelular(ws, req));

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

    criarServidor(sslPems, localIp) {
        const requestHandler = (req, res) => this.handleHttpRequest(req, res);
        if (temCertificado(sslPems)) {
            this.isHttps = true;
            this.server = https.createServer({ key: sslPems.private, cert: sslPems.cert }, requestHandler);
            this.abrirRedirecionamentoParaHttps(localIp);
        } else {
            this.isHttps = false;
            this.server = http.createServer(requestHandler);
        }
    }

    abrirRedirecionamentoParaHttps(localIp) {
        try {
            this.httpFallbackServer = http.createServer((req, res) => {
                res.writeHead(301, { Location: 'https://' + localIp + ':' + this.port + req.url });
                res.end();
            });
            this.httpFallbackServer.listen(this.httpPort, '0.0.0.0');
        } catch (e) {}
    }

    aceitarCelular(ws, req) {
        const url = req.url || '';
        const papel = PAPEIS_DO_CELULAR.find(({ marca }) => url.includes(marca));
        if (papel) {
            papel.conectar(this, ws);
        }
    }

    conectarRemetente(ws) {
        this.mobileStreamClients.add(ws);
        this.avisarRemetentes();
        ws.on('message', (data) => {
            this.lastPhoneFrame = data;
            this.notifyFrontend('live-cam:phone-frame-received', data.toString());
        });
        this.removerAoFechar(ws, this.mobileStreamClients, () => this.avisarRemetentes());
    }

    conectarEspectador(ws) {
        this.mobileViewerClients.add(ws);
        this.avisarEspectadores();
        if (this.lastPcFrame && ws.readyState === WebSocket.OPEN) {
            ws.send(this.lastPcFrame);
        }
        this.removerAoFechar(ws, this.mobileViewerClients, () => this.avisarEspectadores());
    }

    conectarEspectadorDoSpoof(ws) {
        this.mobileSpoofClients.add(ws);
        this.avisarEspectadoresDoSpoof();
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'spoof-state',
                hasVideo: !!this.activeSpoofVideoPath,
                meta: this.activeSpoofVideoMeta
            }));
        }
        ws.on('message', (msg) => this.receberStatusDoSpoof(msg));
        this.removerAoFechar(ws, this.mobileSpoofClients, () => this.avisarEspectadoresDoSpoof());
    }

    receberStatusDoSpoof(msg) {
        try {
            const data = JSON.parse(msg.toString());
            if (data.type === 'spoof-status-update') {
                this.notifyFrontend('live-cam:spoof-mobile-status', data);
            }
        } catch (e) {}
    }

    removerAoFechar(ws, clientes, avisar) {
        ws.on('close', () => {
            clientes.delete(ws);
            avisar();
        });
    }

    avisarRemetentes() {
        this.notifyFrontend('live-cam:client-status', { type: 'sender', count: this.mobileStreamClients.size });
    }

    avisarEspectadores() {
        this.notifyFrontend('live-cam:client-status', { type: 'viewer', count: this.mobileViewerClients.size });
    }

    avisarEspectadoresDoSpoof() {
        this.notifyFrontend('live-cam:spoof-clients-changed', { count: this.mobileSpoofClients.size });
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

    async stopServer() {
        if (this.wss) {
            try { for (const client of this.wss.clients) client.terminate(); } catch (e) {}
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
        const scrcpyPath = this.physicalMobileService?.scrcpyPath || path.join(__dirname, scrcpyEmbutido());
        
        if (!fs.existsSync(scrcpyPath)) {
            return { success: false, error: 'Scrcpy executable not found.' };
        }

        const procKey = deviceId + '-' + facing;
        if (this.adbCameraProcesses.has(procKey)) {
            return { success: true, message: 'Transmissão da câmera já ativa.' };
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
        return { success: true, message: 'Câmera Scrcpy (' + facing + ') started successfully!' };
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

        if (ehRotaDoVideo(url)) {
            return this.servirVideoDoSpoof(req, res);
        }

        const pagina = PAGINA_POR_ROTA.get(url) || 'getHubHtml';
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(this[pagina]());
    }

    temVideoDoSpoofNoDisco() {
        return !!this.activeSpoofVideoPath && fs.existsSync(this.activeSpoofVideoPath);
    }

    servirVideoDoSpoof(req, res) {
        if (!this.temVideoDoSpoofNoDisco()) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            return res.end('No spoof video active. Please select a video on the Nova AI dashboard.');
        }
        try {
            const fileSize = fs.statSync(this.activeSpoofVideoPath).size;
            const range = req.headers.range;
            if (range) {
                this.servirTrechoDoVideo(res, trechoPedido(range, fileSize), fileSize);
            } else {
                this.servirVideoInteiro(res, fileSize);
            }
        } catch (err) {
            console.error('[LiveCamBridge] Video stream error:', err);
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Error streaming video: ' + err.message);
        }
    }

    servirTrechoDoVideo(res, { start, end }, fileSize) {
        const chunksize = (end - start) + 1;
        const file = fs.createReadStream(this.activeSpoofVideoPath, { start, end });
        res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunksize,
            'Content-Type': 'video/mp4',
        });
        file.pipe(res);
    }

    servirVideoInteiro(res, fileSize) {
        res.writeHead(200, {
            'Content-Length': fileSize,
            'Content-Type': 'video/mp4',
            'Accept-Ranges': 'bytes'
        });
        fs.createReadStream(this.activeSpoofVideoPath).pipe(res);
    }

    getPhoneCameraSenderHtml() {
        return PAGINAS.CAMERA_DO_CELULAR;
    }

    getPcCameraViewerHtml() {
        return PAGINAS.WEBCAM_DO_PC;
    }

    getMobileSpoofPlayerHtml() {
        return PAGINAS.SPOOF_DO_CELULAR;
    }

    getHubHtml() {
        return PAGINAS.CENTRAL;
    }
}

module.exports = LiveCamBridgeService;
