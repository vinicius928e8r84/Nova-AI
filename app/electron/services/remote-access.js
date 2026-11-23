const { Server } = require('socket.io');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { spawn } = require('child_process');
const cloudflared = require('cloudflared');
const toolPaths = require('./tool-paths');
const { AcessoDoAdmin } = require('./admin-acesso');

const CORS_PREFLIGHT = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};
const CABECALHOS_JSON = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
const METODOS_DAS_ROTAS_FIREBASE = new Map([
    ['/api/save-firebase-config', new Set(['POST', 'OPTIONS'])],
    ['/api/get-firebase-config', new Set(['GET', 'OPTIONS'])]
]);
const URL_DO_TRYCLOUDFLARE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;
const ESPERA_PELA_URL_PUBLICA_MS = 15000;

const tunelPublicoLigado = () => process.env.NOVA_REMOTE_TUNNEL === '1';
const emDesenvolvimento = () => process.env.NODE_ENV === 'development';

function ehRotaDeConfigFirebase(req) {
    return METODOS_DAS_ROTAS_FIREBASE.get(req.url)?.has(req.method) === true;
}

function responderPreflight(res) {
    res.writeHead(204, CORS_PREFLIGHT);
    res.end();
}

function responderJson(res, status, corpo) {
    res.writeHead(status, CABECALHOS_JSON);
    res.end(JSON.stringify(corpo));
}

function responderJsonOuErro(res, produzirCorpo) {
    try {
        responderJson(res, 200, produzirCorpo());
    } catch (e) {
        responderJson(res, 500, { error: e.message });
    }
}

function caminhoDoCloudflared() {
    if (emDesenvolvimento()) return cloudflared.bin;
    return toolPaths.tool('cloudflared') || path.join(process.resourcesPath, toolPaths.exe('cloudflared'));
}

function liberarExecucao(binario) {
    console.info('[RemoteAccess] ✅ Binary found at:', binario);
    try {
        fs.chmodSync(binario, 0o755);
    } catch (err) {
        console.info('[RemoteAccess] Could not set permissions (Windows - not needed):', err.message);
    }
}

function argumentosDoTunel(porta) {
    return ['tunnel', '--url', `http://localhost:${porta}`, '--no-autoupdate'];
}

const { LimiteDeTentativas, clienteDaConexao } = require('./limite-tentativas');

const SALA_AUTENTICADOS = 'autenticados';
const BYTES_DO_TOKEN = 16;
const TAMANHO_MINIMO_DO_TOKEN = BYTES_DO_TOKEN * 2;
const RESULTADO_VALIDO = 'valido';
const RESULTADO_INVALIDO = 'invalido';
const RESULTADO_BLOQUEADO = 'bloqueado';
const RECUSAS_DO_SOCKET = {
    [RESULTADO_INVALIDO]: { success: false, error: 'Invalid token' },
    [RESULTADO_BLOQUEADO]: { success: false, bloqueado: true, error: 'Muitas tentativas. Aguarde e tente de novo.' }
};

class RemoteAccessService {
    constructor(app) {
        this.app = app;
        this.server = null;
        this.io = null;
        this.httpServer = null;
        this.port = 3456; // WebSocket server port
        this.tokens = new Map(); // Store active tokens
        this.connectedClients = new Map(); // Track connected mobile clients
        this.cloudflaredProcess = null;
        this.limiteDeTentativas = new LimiteDeTentativas();
        this.acessoDoAdmin = new AcessoDoAdmin({
            pasta: app.getPath('userData'),
            conferirCliente: (cliente, validar) => this.conferirCliente(cliente, validar)
        });
        this.publicUrl = null;
        this.isRunning = false;

        // Paths
        this.tokensPath = path.join(app.getPath('userData'), 'remote_tokens.json');
        this.settingsPath = path.join(app.getPath('userData'), 'remote_settings.json');

        this.loadTokens();
    }

    // Load saved tokens from disk
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

            // Automatically generate a default token if none exist
            if (this.tokens.size === 0) {
                console.log('[RemoteAccess] No saved tokens found. Generating a default token...');
                this.generateToken('Default Mobile');
            }
        } catch (e) {
            console.error('[RemoteAccess] Error loading tokens:', e);
        }
    }

    // Save tokens to disk
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

    // Generate a new authentication token
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

    // Write connection info to REMOTE_ACCESS_INFO.txt in userData (never inside the .app bundle — it would break the code signature)
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

    // Validate token
    validateToken(token) {
        const tokenData = this.tokens.get(token);
        if (!tokenData || !tokenData.active) {
            return false;
        }

        // Update last used time
        tokenData.lastUsed = Date.now();
        this.tokens.set(token, tokenData);
        this.saveTokens();

        return true;
    }

    // Revoke a token
    revokeToken(token) {
        const tokenData = this.tokens.get(token);
        if (tokenData) {
            tokenData.active = false;
            this.tokens.set(token, tokenData);
            this.saveTokens();

            // Disconnect any clients using this token
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

    // Get all tokens
    getAllTokens() {
        return Array.from(this.tokens.values()).map(t => ({
            deviceName: t.deviceName,
            createdAt: t.createdAt,
            lastUsed: t.lastUsed,
            active: t.active,
            token: t.token.substring(0, 8) + '...' // Show only first 8 chars for security
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
        this.io.on('connection', (socket) => this.receberCelular(socket));
    }

    receberCelular(socket) {
        console.info(`[RemoteAccess] New connection attempt: ${socket.id}`);
        socket.on('authenticate', (carga) => this.autenticarSocket(socket, carga));
        socket.on('chat-message', (data) => this.encaminharMensagem(socket, data));
        socket.on('switch-model', (data) => this.encaminharTrocaDeModelo(socket, data));
        socket.on('disconnect', () => this.desligarCelular(socket));
        socket.on('get-groq-key', () => this.sendGroqKeyToClient(socket));
    }

    autenticarSocket(socket, carga) {
        const cliente = this.clienteDaConexao(socket.handshake.address, socket.handshake.headers);
        const resultado = this.conferirCliente(cliente, () => this.validateToken(carga?.token));
        if (resultado === RESULTADO_VALIDO) return this.aceitarSocket(socket, carga.token);
        socket.emit('authenticated', RECUSAS_DO_SOCKET[resultado]);
        socket.disconnect();
    }

    aceitarSocket(socket, token) {
        const tokenData = this.tokens.get(token);
        this.connectedClients.set(socket.id, {
            token,
            deviceName: tokenData.deviceName,
            connectedAt: Date.now()
        });

        this.confirmarAutenticacao(socket);
        console.info(`[RemoteAccess] Client authenticated: ${tokenData.deviceName}`);

        this.notifyDesktop('client-connected', {
            deviceName: tokenData.deviceName,
            socketId: socket.id
        });

        this.sendGroqKeyToClient(socket);
    }

    async encaminharMensagem(socket, data) {
        const cliente = this.connectedClients.get(socket.id);
        if (!cliente) {
            socket.emit('error', { message: 'Não autenticado' });
            return;
        }
        console.info(`[RemoteAccess] Message from ${cliente.deviceName}:`, data.message);
        this.notifyDesktop('mobile-message', {
            message: data.message,
            attachments: data.attachments,
            socketId: socket.id,
            deviceName: cliente.deviceName
        });
    }

    encaminharTrocaDeModelo(socket, data) {
        const cliente = this.connectedClients.get(socket.id);
        if (!cliente) return;
        console.info(`[RemoteAccess] Model switch request from ${cliente.deviceName}:`, data.model);
        this.notifyDesktop('model-select', { model: data.model, socketId: socket.id });
    }

    desligarCelular(socket) {
        const cliente = this.connectedClients.get(socket.id);
        if (!cliente) return;
        console.info(`[RemoteAccess] Client disconnected: ${cliente.deviceName}`);
        this.connectedClients.delete(socket.id);
        this.notifyDesktop('client-disconnected', { deviceName: cliente.deviceName, socketId: socket.id });
    }

    // Send Groq key to a specific socket
    sendGroqKeyToClient(socket) {
        if (!this.connectedClients.has(socket.id)) return;
        const groqKeyPath = path.join(this.app.getPath('userData'), 'groq_key.json');
        try {
            if (fs.existsSync(groqKeyPath)) {
                const data = JSON.parse(fs.readFileSync(groqKeyPath, 'utf8'));
                if (data.apiKey) {
                    socket.emit('groq-key', { apiKey: data.apiKey });
                    return;
                }
            }
            // Fallback to env
            if (process.env.GROQ_API_KEY) {
                socket.emit('groq-key', { apiKey: process.env.GROQ_API_KEY });
            }
        } catch (e) {
            console.error('[RemoteAccess] Error reading Groq key:', e);
        }
    }

    confirmarAutenticacao(socket) {
        socket.join(SALA_AUTENTICADOS);
        socket.emit('authenticated', { success: true });
    }

    // Send response back to mobile client
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

    // Notify desktop app (will be connected via IPC)
    notifyDesktop(event, data) {
        // This will be handled by main.js via event emitter
        if (this.desktopCallback) {
            this.desktopCallback(event, data);
        }
    }

    // Set callback for desktop notifications
    setDesktopCallback(callback) {
        this.desktopCallback = callback;
    }

    // Serve PWA files
    servePWA(req, res) {
        const pwaDir = path.join(__dirname, '../pwa');
        let filePath = path.join(pwaDir, req.url === '/' ? 'index.html' : req.url);

        // Security check
        if (!filePath.startsWith(pwaDir)) {
            res.writeHead(403);
            res.end('Forbidden');
            return;
        }

        // Check if file exists
        if (!fs.existsSync(filePath)) {
            filePath = path.join(pwaDir, 'index.html'); // SPA fallback
        }

        const ext = path.extname(filePath);
        const mimeTypes = {
            '.html': 'text/html',
            '.js': 'application/javascript',
            '.css': 'text/css',
            '.json': 'application/json',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.svg': 'image/svg+xml',
            '.ico': 'image/x-icon'
        };

        const contentType = mimeTypes[ext] || 'text/plain';

        fs.readFile(filePath, (err, content) => {
            if (err) {
                res.writeHead(500);
                res.end('Server Error');
            } else {
                res.writeHead(200, { 'Content-Type': contentType });
                res.end(content);
            }
        });
    }

    async startCloudflaredTunnel() {
        if (this.cloudflaredProcess) this.cloudflaredProcess.kill();

        try {
            console.info('[RemoteAccess] Starting Cloudflare Tunnel...');
            const binario = caminhoDoCloudflared();
            console.info('[RemoteAccess] Using binary path:', binario);
            if (fs.existsSync(binario)) liberarExecucao(binario);
            else if (!(await this.recuperarBinarioAusente(binario))) return;
            this.dispararCloudflared(binario);
        } catch (error) {
            console.error('[RemoteAccess] Failed to start Cloudflare Tunnel:', error);
            this.startFallbackTunnel();
        }
    }

    async recuperarBinarioAusente(binario) {
        console.warn('[RemoteAccess] Cloudflared binary not found at:', binario);
        if (!emDesenvolvimento()) {
            this.desistirSemBinario(binario);
            return false;
        }
        await cloudflared.install(binario).catch(err => console.error('[RemoteAccess] Manual install failed:', err));
        return true;
    }

    desistirSemBinario(binario) {
        console.error('[RemoteAccess] Binary missing in production build!');
        console.info('[RemoteAccess] Checked path:', binario);
        console.info('[RemoteAccess] Resources path:', process.resourcesPath);
        this.startFallbackTunnel();
    }

    dispararCloudflared(binario) {
        this.cloudflaredProcess = spawn(binario, argumentosDoTunel(this.port), {
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        console.info('[RemoteAccess] Cloudflared process spawned');
        this.acompanharCloudflared(this.cloudflaredProcess);
        setTimeout(() => this.recuarSemUrlPublica(), ESPERA_PELA_URL_PUBLICA_MS);
    }

    acompanharCloudflared(processo) {
        const lerSaida = (data) => this.lerSaidaDoCloudflared(data);
        processo.stdout.on('data', lerSaida);
        processo.stderr.on('data', lerSaida);
        processo.on('error', (err) => {
            console.error('[RemoteAccess] Cloudflared spawn error:', err);
            this.startFallbackTunnel();
        });
        processo.on('close', (code) => this.aoFecharCloudflared(code));
    }

    lerSaidaDoCloudflared(data) {
        const achada = data.toString().match(URL_DO_TRYCLOUDFLARE);
        if (!achada || this.publicUrl) return;
        this.publicUrl = achada[0].trim();
        console.info(`[RemoteAccess] ✅ Cloudflared URL Ready: ${this.publicUrl}`);
        this.writeLinkToFile();
        this.notifyDesktop('tunnel-ready', {
            url: this.publicUrl,
            provider: 'cloudflare'
        });
    }

    aoFecharCloudflared(code) {
        console.info(`[RemoteAccess] Cloudflared exited with code ${code}`);
        if (code !== 0 && !this.publicUrl) this.startFallbackTunnel();
        this.publicUrl = null;
    }

    recuarSemUrlPublica() {
        if (this.publicUrl || !this.isRunning) return;
        console.info('[RemoteAccess] Cloudflare timeout, trying fallback...');
        this.startFallbackTunnel();
    }

    // Fallback to localtunnel
    async startFallbackTunnel() {
        if (this.publicUrl) return; // Already have a URL
        if (!this.isRunning) return; // Service is stopping

        try {
            console.log('[RemoteAccess] Starting Localtunnel fallback...');
            let localtunnel;
            try {
                localtunnel = require('localtunnel');
            } catch (err) {
                console.error('[RemoteAccess] localtunnel module not installed. Fallback unavailable.');
                return;
            }

            const tunnel = await localtunnel({ port: this.port });

            this.publicUrl = tunnel.url;
            console.log(`[RemoteAccess] ✅ Localtunnel Ready: ${this.publicUrl}`);

            // Write to REMOTE_ACCESS_INFO.txt in project root
            this.writeLinkToFile();

            this.notifyDesktop('tunnel-ready', {
                url: this.publicUrl,
                provider: 'localtunnel'
            });

            tunnel.on('close', () => {
                console.log('[RemoteAccess] Localtunnel closed');
                this.publicUrl = null;
            });

        } catch (error) {
            console.error('[RemoteAccess] Fallback tunnel failed:', error);
        }
    }


    // Get local IP address for same-network access
    getLocalIpAddress() {
        const os = require('os');
        const interfaces = os.networkInterfaces();

        // Find the first non-internal IPv4 address
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name]) {
                // Skip internal (localhost) and non-IPv4 addresses
                if (iface.family === 'IPv4' && !iface.internal) {
                    return iface.address;
                }
            }
        }

        // Fallback to localhost if no network interface found
        return 'localhost';
    }

    // Generate QR code for mobile setup
    async generateQRCode(token) {
        try {
            // Priority: Public URL > Local Network IP > Localhost
            let baseUrl;
            const localIp = this.getLocalIpAddress();
            const localNetworkUrl = `http://${localIp}:${this.port}`;

            if (this.publicUrl) {
                baseUrl = this.publicUrl;
            } else {
                baseUrl = localNetworkUrl;
            }

            // Create direct URL with token as query parameter
            // This will open directly in mobile browser when QR is scanned
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

    // Stop the service
    async stop() {
        console.log('[RemoteAccess] Stopping service...');
        this.isRunning = false;

        // Disconnect all clients
        if (this.io) {
            this.io.emit('server-shutdown');
            this.io.close();
        }

        // Close HTTP server
        if (this.httpServer) {
            this.httpServer.close();
        }

        // Kill cloudflared process
        if (this.cloudflaredProcess) {
            this.cloudflaredProcess.kill();
            this.cloudflaredProcess = null;
        }

        this.publicUrl = null;
        this.connectedClients.clear();

        console.log('[RemoteAccess] Service stopped');
    }

    // Get service status
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
