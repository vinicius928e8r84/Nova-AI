const { Server } = require('socket.io');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { AcessoDoAdmin } = require('./admin-acesso');
const { abrirTunelCloudflared, abrirTunelReserva } = require('./remote-access-tunel');
const { SALA_AUTENTICADOS, RESULTADO_VALIDO, RESULTADO_INVALIDO, RESULTADO_BLOQUEADO, receberCelular } = require('./remote-access-celular');
const { ehRotaDeConfigFirebase, responderPreflight, responderJson, responderJsonOuErro, servirPwa } = require('./remote-access-http');

const tunelPublicoLigado = () => process.env.NOVA_REMOTE_TUNNEL === '1';

const { LimiteDeTentativas, clienteDaConexao } = require('./limite-tentativas');

const BYTES_DO_TOKEN = 16;
const TAMANHO_MINIMO_DO_TOKEN = BYTES_DO_TOKEN * 2;

class RemoteAccessService {
    constructor(app) {
        this.app = app;
        this.server = null;
        this.io = null;
        this.httpServer = null;
        this.port = 3456;
        this.tokens = new Map();
        this.connectedClients = new Map();
        this.cloudflaredProcess = null;
        this.limiteDeTentativas = new LimiteDeTentativas();
        this.acessoDoAdmin = new AcessoDoAdmin({
            pasta: app.getPath('userData'),
            conferirCliente: (cliente, validar) => this.conferirCliente(cliente, validar)
        });
        this.publicUrl = null;
        this.isRunning = false;

        this.tokensPath = path.join(app.getPath('userData'), 'remote_tokens.json');
        this.settingsPath = path.join(app.getPath('userData'), 'remote_settings.json');

        this.loadTokens();
    }

    loadTokens() {
        try {
            if (fs.existsSync(this.tokensPath)) {
                const data = JSON.parse(fs.readFileSync(this.tokensPath, 'utf8'));
                const salvos = Object.entries(data.tokens || {});
                this.tokens = new Map(salvos.filter(([token]) => token.length >= TAMANHO_MINIMO_DO_TOKEN));
                console.log(`[RemoteAccess] Loaded ${this.tokens.size} saved tokens`);
                if (this.tokens.size < salvos.length) {
                    console.warn(`[RemoteAccess] ${salvos.length - this.tokens.size} tokens fracos (menos de ${TAMANHO_MINIMO_DO_TOKEN} caracteres) descartados; leia o QR novo.`);
                    this.saveTokens();
                }
            }

            if (this.tokens.size === 0) {
                console.log('[RemoteAccess] No saved tokens found. Generating a default token...');
                this.generateToken('Default Mobile');
            }
        } catch (e) {
            console.error('[RemoteAccess] Error loading tokens:', e);
        }
    }

    saveTokens() {
        try {
            const data = {
                tokens: Object.fromEntries(this.tokens),
                updatedAt: Date.now()
            };
            fs.writeFileSync(this.tokensPath, JSON.stringify(data, null, 2));
        } catch (e) {
            console.error('[RemoteAccess] Error saving tokens:', e);
        }
    }

    generateToken(deviceName = 'Mobile Device') {
        const token = crypto.randomBytes(BYTES_DO_TOKEN).toString('hex').toUpperCase();
        const tokenData = {
            token,
            deviceName,
            createdAt: Date.now(),
            lastUsed: null,
            active: true
        };

        this.tokens.set(token, tokenData);
        this.saveTokens();

        console.log(`[RemoteAccess] Generated new token for: ${deviceName} with token: ${token}`);
        if (this.publicUrl) {
            this.writeLinkToFile();
        }
        return tokenData;
    }

    writeLinkToFile() {
        try {
            const { app } = require('electron');
            const projectRoot = app && app.getPath ? app.getPath('userData') : path.join(os.homedir(), 'Library', 'Application Support', 'nova_dsktp');
            const filePath = path.join(projectRoot, 'REMOTE_ACCESS_INFO.txt');
            
            const activeTokens = Array.from(this.tokens.values())
                .filter(t => t.active)
                .map(t => t.token);

            const directLink = activeTokens.length > 0 
                ? `${this.publicUrl}?token=${activeTokens[0]}` 
                : this.publicUrl;

            const content = `==================================================
NOVA REMOTE ACCESS INFO
==================================================
Active Cloudflare Link: ${this.publicUrl}
Active Token: ${activeTokens.join(', ') || 'None generated'}

Direct Link (Open on Mobile):
${directLink}
==================================================
Note: Yeh files aur links temporary hain. Har baar Nova restart 
hone par ye file automatically update ho jayegi.
`;
            fs.writeFileSync(filePath, content, 'utf8');
            console.log(`[RemoteAccess] Saved remote info to ${filePath}`);
        } catch (e) {
            console.error('[RemoteAccess] Error writing link to file:', e);
        }
    }

    validateToken(token) {
        const tokenData = this.tokens.get(token);
        if (!tokenData || !tokenData.active) {
            return false;
        }

        tokenData.lastUsed = Date.now();
        this.tokens.set(token, tokenData);
        this.saveTokens();

        return true;
    }

    revokeToken(token) {
        const tokenData = this.tokens.get(token);
        if (tokenData) {
            tokenData.active = false;
            this.tokens.set(token, tokenData);
            this.saveTokens();

            this.connectedClients.forEach((client, socketId) => {
                if (client.token === token && this.io) {
                    this.io.to(socketId).emit('token-revoked');
                    this.io.sockets.sockets.get(socketId)?.disconnect();
                }
            });

            return true;
        }
        return false;
    }

    revogarTodosOsTokens() {
        this.tokens.clear();
        this.connectedClients.forEach((client, socketId) => {
            this.io?.to(socketId).emit('token-revoked');
            this.io?.sockets.sockets.get(socketId)?.disconnect();
        });
    }

    tunelCloudflaredAtivo() {
        return Boolean(this.cloudflaredProcess && this.publicUrl);
    }

    clienteDaConexao(enderecoDoPar, cabecalhos) {
        return clienteDaConexao(enderecoDoPar, cabecalhos, this.tunelCloudflaredAtivo());
    }

    conferirCliente(cliente, validar) {
        if (this.limiteDeTentativas.bloqueado(cliente)) return RESULTADO_BLOQUEADO;
        if (!validar()) {
            this.limiteDeTentativas.registrarFalha(cliente);
            return RESULTADO_INVALIDO;
        }
        this.limiteDeTentativas.registrarSucesso(cliente);
        return RESULTADO_VALIDO;
    }

    tokenDaRequisicaoValido(req) {
        const token = /^Bearer (\S+)$/.exec(req.headers.authorization || '')?.[1];
        if (!token) return false;
        const cliente = this.clienteDaConexao(req.socket?.remoteAddress, req.headers);
        return this.conferirCliente(cliente, () => this.tokens.get(token)?.active === true) === RESULTADO_VALIDO;
    }

    origemPermitida(origem) {
        if (!origem) return true;
        const porta = this.httpServer?.address()?.port ?? this.port;
        const proprias = [this.publicUrl, `http://localhost:${porta}`, `http://127.0.0.1:${porta}`, `http://${this.getLocalIpAddress()}:${porta}`];
        return proprias.filter(Boolean).map((url) => url.replace(/\/$/, '')).includes(origem);
    }

    getAllTokens() {
        return Array.from(this.tokens.values()).map(t => ({
            deviceName: t.deviceName,
            createdAt: t.createdAt,
            lastUsed: t.lastUsed,
            active: t.active,
            token: t.token.substring(0, 8) + '...'
        }));
    }

    async start() {
        if (process.env.NOVA_SMOKE_TEST === '1') return;
        if (this.isRunning) return this.continuarRodando();

        try {
            this.montarServidor();
            await this.escutarNaPrimeiraPortaLivre();
            if (tunelPublicoLigado()) await this.abrirTunelNaPartida();
            else console.info('[RemoteAccess] Public internet tunnel OFF (LAN/internet exposure disabled).');
            return this.enderecosDoServidor();
        } catch (error) {
            console.error('[RemoteAccess] Failed to start server:', error);
            return { success: false, error: error.message };
        }
    }

    continuarRodando() {
        console.info('[RemoteAccess] Server already running');
        if (this.semTunelAtivo()) this.reabrirTunel();
        return { success: true, port: this.port, url: this.publicUrl };
    }

    semTunelAtivo() {
        return !this.publicUrl && !this.cloudflaredProcess;
    }

    reabrirTunel() {
        console.info('[RemoteAccess] Tunnel not active, attempting to restart tunnel...');
        if (tunelPublicoLigado()) this.startCloudflaredTunnel().catch(e => console.error('[RemoteAccess] Failed to restart tunnel:', e));
        else console.info('[RemoteAccess] Public tunnel disabled (use NOVA_REMOTE_TUNNEL=1 to enable).');
    }

    montarServidor() {
        this.httpServer = http.createServer((req, res) => this.atenderRequisicao(req, res));
        this.io = new Server(this.httpServer, {
            cors: {
                origin: (origem, responder) => responder(null, this.origemPermitida(origem)),
                methods: ['GET', 'POST']
            },
            allowRequest: (req, responder) => responder(null, this.origemPermitida(req.headers.origin)),
            transports: ['websocket', 'polling']
        });
        this.setupSocketHandlers();
    }

    escutarNaPrimeiraPortaLivre() {
        return new Promise((resolve, reject) => {
            this.httpServer.listen(this.port, '127.0.0.1', () => {
                console.info(`[RemoteAccess] WebSocket server started on port ${this.port}`);
                this.isRunning = true;
                resolve();
            });
            this.httpServer.on('error', (err) => this.tentarPortaSeguinte(err, reject));
        });
    }

    tentarPortaSeguinte(err, reject) {
        if (err.code !== 'EADDRINUSE') {
            reject(err);
            return;
        }
        this.port++;
        this.httpServer.listen(this.port, '127.0.0.1');
    }

    async abrirTunelNaPartida() {
        try {
            await this.startCloudflaredTunnel();
        } catch (tunnelError) {
            console.error('[RemoteAccess] Tunnel startup failed:', tunnelError);
        }
    }

    enderecosDoServidor() {
        const localIp = this.getLocalIpAddress();
        return {
            success: true,
            port: this.port,
            localUrl: `http://localhost:${this.port}`,
            localNetworkUrl: `http://${localIp}:${this.port}`,
            publicUrl: this.publicUrl,
            localIp
        };
    }

    atenderRequisicao(req, res) {
        if (this.acessoDoAdmin.ehRota(req)) this.acessoDoAdmin.atender(req, res, this.clienteDaConexao(req.socket?.remoteAddress, req.headers));
        else if (!ehRotaDeConfigFirebase(req)) this.servePWA(req, res);
        else if (req.method === 'OPTIONS') responderPreflight(res);
        else if (!this.tokenDaRequisicaoValido(req)) responderJson(res, 401, { error: 'Não autenticado' });
        else if (req.method === 'POST') this.receberConfigFirebase(req, res);
        else responderJsonOuErro(res, () => this.lerConfigFirebase());
    }

    receberConfigFirebase(req, res) {
        let corpo = '';
        req.on('data', pedaco => { corpo += pedaco; });
        req.on('end', () => responderJsonOuErro(res, () => this.gravarConfigFirebase(corpo)));
    }

    gravarConfigFirebase(corpo) {
        const config = JSON.parse(corpo);
        fs.writeFileSync(this.caminhoDaConfigFirebase(), JSON.stringify(config, null, 2));
        return { success: true };
    }

    lerConfigFirebase() {
        const caminho = this.caminhoDaConfigFirebase();
        return fs.existsSync(caminho) ? JSON.parse(fs.readFileSync(caminho, 'utf8')) : {};
    }

    caminhoDaConfigFirebase() {
        return path.join(this.app.getPath('userData'), 'firebase_config.json');
    }

    setupSocketHandlers() {
        this.io.on('connection', (socket) => receberCelular(this, socket));
    }

    sendToMobile(socketId, event, data) {
        if (this.io) {
            this.io.to(socketId).emit(event, data);
        }
    }

    broadcastToMobile(event, data) {
        if (this.io) {
            this.io.to(SALA_AUTENTICADOS).emit(event, data);
        }
    }

    notifyDesktop(event, data) {
        if (this.desktopCallback) {
            this.desktopCallback(event, data);
        }
    }

    setDesktopCallback(callback) {
        this.desktopCallback = callback;
    }

    servePWA(req, res) {
        servirPwa(req, res);
    }

    startCloudflaredTunnel() {
        return abrirTunelCloudflared(this);
    }

    startFallbackTunnel() {
        return abrirTunelReserva(this);
    }

    getLocalIpAddress() {
        const os = require('os');
        const interfaces = os.networkInterfaces();

        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name]) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    return iface.address;
                }
            }
        }

        return 'localhost';
    }

    async generateQRCode(token) {
        try {
            let baseUrl;
            const localIp = this.getLocalIpAddress();
            const localNetworkUrl = `http://${localIp}:${this.port}`;

            if (this.publicUrl) {
                baseUrl = this.publicUrl;
            } else {
                baseUrl = localNetworkUrl;
            }

            const directUrl = `${baseUrl}?token=${token}`;

            const qrCodeDataUrl = await QRCode.toDataURL(directUrl, {
                width: 400,
                margin: 2,
                color: {
                    dark: '#000000',
                    light: '#FFFFFF'
                }
            });

            return {
                success: true,
                qrCode: qrCodeDataUrl,
                url: baseUrl,
                directUrl: directUrl,
                token
            };
        } catch (error) {
            console.error('[RemoteAccess] QR Code generation failed:', error);
            return { success: false, error: error.message };
        }
    }

    async stop() {
        console.log('[RemoteAccess] Stopping service...');
        this.isRunning = false;

        if (this.io) {
            this.io.emit('server-shutdown');
            this.io.close();
        }

        if (this.httpServer) {
            this.httpServer.close();
        }

        if (this.cloudflaredProcess) {
            this.cloudflaredProcess.kill();
            this.cloudflaredProcess = null;
        }

        this.publicUrl = null;
        this.connectedClients.clear();

        console.log('[RemoteAccess] Service stopped');
    }

    getStatus() {
        const localIp = this.getLocalIpAddress();
        return {
            isRunning: this.isRunning,
            port: this.port,
            localUrl: `http://localhost:${this.port}`,
            localNetworkUrl: `http://${localIp}:${this.port}`,
            publicUrl: this.publicUrl,
            connectedClients: Array.from(this.connectedClients.values()),
            totalTokens: this.tokens.size,
            activeTokens: Array.from(this.tokens.values()).filter(t => t.active).length
        };
    }
}

module.exports = RemoteAccessService;
