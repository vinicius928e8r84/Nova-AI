const { Server } = require('socket.io');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { spawn } = require('child_process');
const cloudflared = require('cloudflared');
const { LimiteDeTentativas, clienteDaConexao } = require('./limite-tentativas');

const SALA_AUTENTICADOS = 'autenticados';
const BYTES_DO_TOKEN = 16;
const TAMANHO_MINIMO_DO_TOKEN = BYTES_DO_TOKEN * 2;

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

    tokenDaRequisicaoValido(req) {
        const token = /^Bearer (\S+)$/.exec(req.headers.authorization || '')?.[1];
        if (!token) return false;
        const cliente = clienteDaConexao(req.socket?.remoteAddress, req.headers);
        if (this.limiteDeTentativas.bloqueado(cliente)) return false;
        const valido = this.tokens.get(token)?.active === true;
        if (valido) this.limiteDeTentativas.registrarSucesso(cliente);
        else this.limiteDeTentativas.registrarFalha(cliente);
        return valido;
    }

    atenderConfigFirebase(req, res) {
        const rotas = {
            '/api/save-firebase-config': { metodo: 'POST', tratar: (...args) => this.salvarConfigFirebase(...args) },
            '/api/get-firebase-config': { metodo: 'GET', tratar: (...args) => this.lerConfigFirebase(...args) }
        };
        const rota = rotas[req.url];
        if (!rota || ![rota.metodo, 'OPTIONS'].includes(req.method)) return false;
        if (req.method === 'OPTIONS') {
            res.writeHead(204, {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization'
            });
            res.end();
        } else if (!this.tokenDaRequisicaoValido(req)) {
            this.responderJson(res, 401, { error: 'Não autenticado' });
        } else {
            rota.tratar(req, res);
        }
        return true;
    }

    responderJson(res, status, corpo) {
        res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(corpo));
    }

    caminhoConfigFirebase() {
        return path.join(this.app.getPath('userData'), 'firebase_config.json');
    }

    salvarConfigFirebase(req, res) {
        let corpo = '';
        req.on('data', (pedaco) => { corpo += pedaco; });
        req.on('end', () => {
            try {
                fs.writeFileSync(this.caminhoConfigFirebase(), JSON.stringify(JSON.parse(corpo), null, 2));
                this.responderJson(res, 200, { success: true });
            } catch (e) {
                this.responderJson(res, 500, { error: e.message });
            }
        });
    }

    lerConfigFirebase(req, res) {
        try {
            const caminho = this.caminhoConfigFirebase();
            this.responderJson(res, 200, fs.existsSync(caminho) ? JSON.parse(fs.readFileSync(caminho, 'utf8')) : {});
        } catch (e) {
            this.responderJson(res, 500, { error: e.message });
        }
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

    // Start WebSocket server
    async start() {
        if (process.env.NOVA_SMOKE_TEST === '1') return;
        if (this.isRunning) {
            console.log('[RemoteAccess] Server already running');

            // If tunnel is not running but we want it, try starting it again
            if (!this.publicUrl && !this.cloudflaredProcess) {
                console.log('[RemoteAccess] Tunnel not active, attempting to restart tunnel...');
                if (process.env.NOVA_REMOTE_TUNNEL === '1') this.startCloudflaredTunnel().catch(e => console.error('[RemoteAccess] Failed to restart tunnel:', e));
                else console.log('[RemoteAccess] Public tunnel disabled (use NOVA_REMOTE_TUNNEL=1 to enable).');
            }

            return { success: true, port: this.port, url: this.publicUrl };
        }

        try {
            // Create HTTP server for Socket.IO
            this.httpServer = http.createServer((req, res) => {
                if (this.atenderConfigFirebase(req, res)) return;

                // Serve the mobile PWA
                this.servePWA(req, res);
            });

            // Initialize Socket.IO
            this.io = new Server(this.httpServer, {
                cors: {
                    origin: '*',
                    methods: ['GET', 'POST']
                },
                transports: ['websocket', 'polling']
            });

            // Setup Socket.IO event handlers
            this.setupSocketHandlers();

            // Start listening
            await new Promise((resolve, reject) => {
                this.httpServer.listen(this.port, '127.0.0.1', () => {
                    console.log(`[RemoteAccess] WebSocket server started on port ${this.port}`);
                    this.isRunning = true;
                    resolve();
                });

                this.httpServer.on('error', (err) => {
                    if (err.code === 'EADDRINUSE') {
                        this.port++;
                        this.httpServer.listen(this.port, '127.0.0.1');
                    } else {
                        reject(err);
                    }
                });
            });

            // Public tunnel is opt-in on this Mac port: set NOVA_REMOTE_TUNNEL=1 to enable.
            if (process.env.NOVA_REMOTE_TUNNEL === '1') {
                try {
                    await this.startCloudflaredTunnel();
                } catch (tunnelError) {
                    console.error('[RemoteAccess] Tunnel startup failed:', tunnelError);
                }
            } else {
                console.log('[RemoteAccess] Public internet tunnel OFF (LAN/internet exposure disabled).');
            }

            // Get local IP address for same-network access
            const localIp = this.getLocalIpAddress();
            const localNetworkUrl = `http://${localIp}:${this.port}`;

            return {
                success: true,
                port: this.port,
                localUrl: `http://localhost:${this.port}`,
                localNetworkUrl: localNetworkUrl,
                publicUrl: this.publicUrl,
                localIp: localIp
            };

        } catch (error) {
            console.error('[RemoteAccess] Failed to start server:', error);
            return { success: false, error: error.message };
        }
    }

    // Setup Socket.IO event handlers
    setupSocketHandlers() {
        this.io.on('connection', (socket) => {
            console.log(`[RemoteAccess] New connection attempt: ${socket.id}`);

            // Authentication required
            socket.on('authenticate', (carga) => {
                const cliente = clienteDaConexao(socket.handshake.address, socket.handshake.headers);
                if (this.limiteDeTentativas.bloqueado(cliente)) {
                    socket.emit('authenticated', { success: false, error: 'Muitas tentativas. Aguarde e tente de novo.' });
                    socket.disconnect();
                    return;
                }
                if (this.validateToken(carga?.token)) {
                    this.limiteDeTentativas.registrarSucesso(cliente);
                    const tokenData = this.tokens.get(carga.token);
                    this.connectedClients.set(socket.id, {
                        token: carga.token,
                        deviceName: tokenData.deviceName,
                        connectedAt: Date.now()
                    });

                    this.confirmarAutenticacao(socket);
                    console.log(`[RemoteAccess] Client authenticated: ${tokenData.deviceName}`);

                    // Notify desktop app about new connection
                    this.notifyDesktop('client-connected', {
                        deviceName: tokenData.deviceName,
                        socketId: socket.id
                    });

                    // Send Groq key for voice support
                    this.sendGroqKeyToClient(socket);
                } else {
                    this.limiteDeTentativas.registrarFalha(cliente);
                    socket.emit('authenticated', { success: false, error: 'Invalid token' });
                    socket.disconnect();
                }
            });

            // Handle chat messages from mobile
            socket.on('chat-message', async (data) => {
                const client = this.connectedClients.get(socket.id);
                if (!client) {
                    socket.emit('error', { message: 'Não autenticado' });
                    return;
                }

                console.log(`[RemoteAccess] Message from ${client.deviceName}:`, data.message);

                // Forward to desktop app for processing
                this.notifyDesktop('mobile-message', {
                    message: data.message,
                    attachments: data.attachments,
                    socketId: socket.id,
                    deviceName: client.deviceName
                });
            });

            // Handle model switching from mobile
            socket.on('switch-model', (data) => {
                const client = this.connectedClients.get(socket.id);
                if (!client) return;

                console.log(`[RemoteAccess] Model switch request from ${client.deviceName}:`, data.model);

                // Forward to desktop app
                this.notifyDesktop('model-select', {
                    model: data.model,
                    socketId: socket.id
                });
            });

            // Handle disconnection
            socket.on('disconnect', () => {
                const client = this.connectedClients.get(socket.id);
                if (client) {
                    console.log(`[RemoteAccess] Client disconnected: ${client.deviceName}`);
                    this.connectedClients.delete(socket.id);

                    this.notifyDesktop('client-disconnected', {
                        deviceName: client.deviceName,
                        socketId: socket.id
                    });
                }
            });

            // Handle Groq key request (in case they need it again)
            socket.on('get-groq-key', () => {
                this.sendGroqKeyToClient(socket);
            });
        });
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

    // Start Cloudflare Tunnel for outdoor access
    async startCloudflaredTunnel() {
        if (this.cloudflaredProcess) {
            this.cloudflaredProcess.kill();
        }

        try {
            console.log('[RemoteAccess] Starting Cloudflare Tunnel...');

            // Get correct binary path for dev vs production
            let binPath;
            const isDev = process.env.NODE_ENV === 'development';

            if (isDev) {
                // Development: use npm package binary
                binPath = cloudflared.bin;
            } else {
                // Production: use bundled binary from resources
                const path = require('path');
                const toolPaths = require('./tool-paths');
                binPath = toolPaths.tool('cloudflared') || path.join(process.resourcesPath, toolPaths.exe('cloudflared'));
            }

            console.log('[RemoteAccess] Using binary path:', binPath);

            if (!fs.existsSync(binPath)) {
                console.warn('[RemoteAccess] Cloudflared binary not found at:', binPath);
                // Try to install/ensure it (only works in dev)
                if (isDev) {
                    await cloudflared.install(binPath).catch(err => console.error('[RemoteAccess] Manual install failed:', err));
                } else {
                    console.error('[RemoteAccess] Binary missing in production build!');
                    console.log('[RemoteAccess] Checked path:', binPath);
                    console.log('[RemoteAccess] Resources path:', process.resourcesPath);
                    // Use fallback immediately
                    this.startFallbackTunnel();
                    return;
                }
            } else {
                console.log('[RemoteAccess] ✅ Binary found at:', binPath);
                // Ensure executable permissions (important for production)
                try {
                    fs.chmodSync(binPath, 0o755);
                } catch (err) {
                    console.log('[RemoteAccess] Could not set permissions (Windows - not needed):', err.message);
                }
            }

            // Start cloudflared tunnel
            this.cloudflaredProcess = spawn(binPath, [
                'tunnel',
                '--url', `http://localhost:${this.port}`,
                '--no-autoupdate'
            ], {
                windowsHide: true,
                stdio: ['ignore', 'pipe', 'pipe']
            });

            console.log('[RemoteAccess] Cloudflared process spawned');

            const handleOutput = (data) => {
                const output = data.toString();
                // console.log('[Cloudflared Output]', output);

                // Extract public URL - looking for https://...trycloudflare.com
                const urlMatch = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
                if (urlMatch && !this.publicUrl) {
                    this.publicUrl = urlMatch[0].trim();
                    console.log(`[RemoteAccess] ✅ Cloudflared URL Ready: ${this.publicUrl}`);

                    // Write to REMOTE_ACCESS_INFO.txt in project root
                    this.writeLinkToFile();

                    // Notify desktop about public URL
                    this.notifyDesktop('tunnel-ready', {
                        url: this.publicUrl,
                        provider: 'cloudflare'
                    });
                }
            };

            this.cloudflaredProcess.stdout.on('data', handleOutput);
            this.cloudflaredProcess.stderr.on('data', handleOutput);

            this.cloudflaredProcess.on('error', (err) => {
                console.error('[RemoteAccess] Cloudflared spawn error:', err);
                this.startFallbackTunnel();
            });

            this.cloudflaredProcess.on('close', (code) => {
                console.log(`[RemoteAccess] Cloudflared exited with code ${code}`);
                if (code !== 0 && !this.publicUrl) {
                    this.startFallbackTunnel();
                }
                this.publicUrl = null;
            });

            // If no URL after 15 seconds, try fallback
            setTimeout(() => {
                if (!this.publicUrl && this.isRunning) {
                    console.log('[RemoteAccess] Cloudflare timeout, trying fallback...');
                    this.startFallbackTunnel();
                }
            }, 15000);

        } catch (error) {
            console.error('[RemoteAccess] Failed to start Cloudflare Tunnel:', error);
            this.startFallbackTunnel();
        }
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
