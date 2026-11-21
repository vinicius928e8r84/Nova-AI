const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { MAC_BROWSER_KILL_PATTERN } = require('./paridade-utils');
const { avisarFalhaRepetida } = require('./whatsapp-aviso');
const { tratarMensagemRecebida } = require('./whatsapp-mensagens');
const { spawnSync } = require('child_process');
const axios = require('axios');
const FormData = require('form-data');
const screenshot = require('screenshot-desktop');

const BOT_SIGNATURE = '[NOVA_AI_BOT]';
const ESQUECER_ENVIADA_EM_MS = 120000;
const TRAVAS_DO_PERFIL = ['already running for', 'SingletonLock', 'userDataDir'];
const NAVEGADORES_DO_WINDOWS = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
const ARGUMENTOS_DO_CHROMIUM = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    '--disable-gpu'
];

const comAssinatura = texto => `${texto}\n\n_${BOT_SIGNATURE}_`;
const ehTravaDoPerfil = mensagem => TRAVAS_DO_PERFIL.some(trava => mensagem.includes(trava));
const destinoValido = (chat, texto) => Boolean(chat) && chat !== 'self' && Boolean(texto);
const esperar = ms => new Promise(r => setTimeout(r, ms));
const textoDaTranscricao = response => String(response?.data?.text || '').trim() || null;
const detalheDoErro = error => error?.response?.data || error.message || error;
const ehPastaDoChromium = entry => entry.isDirectory() && entry.name.startsWith('chromium-');

function formularioDoAudio(base64Data) {
    const form = new FormData();
    form.append('file', Buffer.from(base64Data, 'base64'), {
        filename: 'audio.ogg',
        contentType: 'audio/ogg'
    });
    form.append('model', 'whisper-large-v3');
    form.append('response_format', 'json');
    return form;
}

function navegadorDoAmbienteSeExistir() {
    const doAmbiente = process.env.PUPPETEER_EXECUTABLE_PATH;
    return doAmbiente && fs.existsSync(doAmbiente) ? doAmbiente : null;
}

class WhatsAppManager {
    constructor(mainWindow, app) {
        this.mainWindow = mainWindow;
        this.app = app;

        this.client = null;
        this.isReady = false;
        this.isInitializing = false;
        this.destroying = false;
        this.manualLogout = false;

        this.status = 'disconnected';
        this.statusReason = null;
        this.qrCode = null;
        this.lastQr = null;

        this.sessionPath = path.join(app.getPath('userData'), '.wwebjs_auth');
        this.webCachePath = path.join(app.getPath('userData'), '.wwebjs_cache');

        this.processedMessageIds = new Set();
        this.initTimeout = null;
        this.reconnectTimer = null;
        this.reconnectAttempts = 0;

        this.maxReconnectAttempts = 8;
        this.maxInitTimeMs = 60000;

        // WhatsApp Intelligence Module State
        this.busyModeEnabled = false;
        this.busyStatusText  = 'busy hain ya shayad kahin bahar gaye hain';
    }

    updateMainWindow(mainWindow) {
        this.mainWindow = mainWindow;
    }

    getState() {
        return {
            status: this.status,
            reason: this.statusReason,
            isReady: this.isReady,
            isInitializing: this.isInitializing,
            qrCode: this.qrCode,
            reconnectAttempts: this.reconnectAttempts
        };
    }

    setStatus(status, extra = {}) {
        this.status = status;
        this.statusReason = extra.reason || null;
        this.sendToFrontend('status', { status, ...extra });
    }

    ensureRuntimeDirectories() {
        for (const dir of [this.sessionPath, this.webCachePath]) {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        }
    }

    getSessionProfilePath() {
        return path.join(this.sessionPath, 'session-nova-desktop-client');
    }

    clearSessionProfileLocks() {
        const profilePath = this.getSessionProfilePath();
        const lockFiles = [
            'SingletonLock',
            'SingletonCookie',
            'SingletonSocket',
            'DevToolsActivePort'
        ];

        for (const fileName of lockFiles) {
            const filePath = path.join(profilePath, fileName);
            try {
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            } catch (error) {
                console.warn('[WhatsApp] Failed removing lock file:', filePath, error.message || error);
            }
        }
    }

    killSessionBrowserProcesses() {
        if (process.platform === 'darwin') {
            try {
                spawnSync('pkill', ['-f', '--', MAC_BROWSER_KILL_PATTERN], { timeout: 12000, encoding: 'utf8' });
            } catch (error) {
                console.warn('[WhatsApp] Failed to terminate stale browser process:', error.message || error);
            }
            return;
        }
        if (process.platform !== 'win32') return;

        const psCommand = [
            "$ErrorActionPreference='SilentlyContinue'",
            "Get-CimInstance Win32_Process",
            "| Where-Object {",
            "    ($_.Name -in @('chrome.exe','msedge.exe')) -and",
            "    ($_.CommandLine -like '*session-nova-desktop-client*')",
            "}",
            "| ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
        ].join(' ');

        try {
            spawnSync(
                'powershell.exe',
                ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psCommand],
                { windowsHide: true, timeout: 12000, encoding: 'utf8' }
            );
        } catch (error) {
            console.warn('[WhatsApp] Failed to terminate stale browser process:', error.message || error);
        }
    }

    async recoverFromProfileLock(errorMessage = '') {
        console.warn('[WhatsApp] Recovering from browser profile lock...', errorMessage);
        await this.destroyClient({ preserveSession: true });
        this.killSessionBrowserProcesses();
        this.clearSessionProfileLocks();
        await new Promise(resolve => setTimeout(resolve, 1200));
    }

    clearInitTimeout() {
        if (this.initTimeout) {
            clearTimeout(this.initTimeout);
            this.initTimeout = null;
        }
    }

    clearReconnectTimer() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    clearAllTimers() {
        this.clearInitTimeout();
        this.clearReconnectTimer();
    }

    startInitTimeout() {
        this.clearInitTimeout();
        this.initTimeout = setTimeout(() => {
            console.error('[WhatsApp] Initialization timeout. Rebuilding client.');
            return this._derrubarSessao('disconnected', 'init-timeout', 'init-timeout');
        }, this.maxInitTimeMs);
    }

    async _derrubarSessao(status, reason, motivoDaReconexao) {
        this.isInitializing = false;
        this.isReady = false;
        this.qrCode = null;
        this.lastQr = null;
        this.setStatus(status, { reason });

        await this.destroyClient({ preserveSession: true });
        this.scheduleReconnect(motivoDaReconexao);
    }

    scheduleReconnect(reason = 'unknown') {
        if (this.manualLogout) return;
        if (this.reconnectTimer) return;

        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('[WhatsApp] Reconnect limit reached. Waiting for manual restart.');
            const aviso = avisarFalhaRepetida({
                platform: process.platform,
                tentativas: this.maxReconnectAttempts,
                mostrar: texto => require('electron').dialog.showMessageBox(this.mainWindow, { type: 'warning', title: 'WhatsApp', message: texto })
            });
            this.setStatus('disconnected', { reason: 'reconnect-limit-reached', hint: aviso });
            return;
        }

        this.reconnectAttempts += 1;
        const baseDelay = 2000;
        const delayMs = Math.min(30000, baseDelay * (2 ** (this.reconnectAttempts - 1)));

        this.setStatus('reconnecting', {
            reason,
            attempt: this.reconnectAttempts,
            delayMs
        });

        this.reconnectTimer = setTimeout(async () => {
            this.reconnectTimer = null;
            await this.initialize({ isReconnect: true });
        }, delayMs);
    }

    resolverNavegadorNoMac() {
        const macNative = require('./mac-native');
        return navegadorDoAmbienteSeExistir()
            || this.chromiumBaixadoNoUserData()
            || macNative.browser('chrome')
            || macNative.browser('edge');
    }

    chromiumBaixadoNoUserData() {
        return require('./platform-utils').findBundledChromiumExecutable([path.join(this.app.getPath('userData'), 'browsers')]);
    }

    resolveBrowserExecutable() {
        if (process.platform === "darwin") {
            return this.resolverNavegadorNoMac();
        }

        const escolhido = this._candidatosNoWindows().find(candidate => candidate && fs.existsSync(candidate));
        if (escolhido) {
            console.info('[WhatsApp] Browser executable:', escolhido);
            return escolhido;
        }

        console.warn('[WhatsApp] No explicit browser executable found. Puppeteer default resolution will be used.');
        return null;
    }

    _candidatosNoWindows() {
        const candidates = [];
        if (process.env.PUPPETEER_EXECUTABLE_PATH) {
            candidates.push(process.env.PUPPETEER_EXECUTABLE_PATH);
        }
        for (const root of this._raizesDeNavegadores()) candidates.push(...this._chromiumsNaRaiz(root));
        candidates.push(...NAVEGADORES_DO_WINDOWS);
        return candidates;
    }

    _raizesDeNavegadores() {
        return [
            process.resourcesPath ? path.join(process.resourcesPath, 'browsers') : null,
            path.join(process.cwd(), 'browsers'),
            path.join(this.app.getPath('userData'), 'browsers')
        ].filter(Boolean);
    }

    _chromiumsNaRaiz(root) {
        if (!fs.existsSync(root)) return [];
        const achados = [path.join(root, 'chromium-1208', 'chrome-win64', 'chrome.exe')];
        try {
            const chromiumDirs = fs.readdirSync(root, { withFileTypes: true })
                .filter(ehPastaDoChromium)
                .map(entry => entry.name)
                .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
            for (const dirName of chromiumDirs) achados.push(path.join(root, dirName, 'chrome-win64', 'chrome.exe'));
        } catch (error) {
            console.warn('[WhatsApp] Failed scanning browser directory:', root, error.message);
        }
        return achados;
    }

    async destroyClient({ preserveSession = true } = {}) {
        if (!this.client || this.destroying) return;

        this.destroying = true;
        const client = this.client;
        this.client = null;

        try {
            client.removeAllListeners();
        } catch (_error) { }

        if (!preserveSession) await this._sairDaConta(client);

        try {
            await client.destroy();
        } catch (error) {
            console.warn('[WhatsApp] Destroy failed:', error.message || error);
        } finally {
            this.destroying = false;
        }
    }

    async _sairDaConta(client) {
        if (typeof client.logout !== 'function') return;
        try {
            await client.logout();
        } catch (error) {
            console.warn('[WhatsApp] Logout during destroy failed:', error.message || error);
        }
    }

    _inicializacaoDispensada() {
        if (this.isInitializing) {
            console.info('[WhatsApp] Initialize skipped (already initializing).');
            return true;
        }
        if (!(this.client && this.isReady)) return false;
        console.info('[WhatsApp] Initialize skipped (already connected).');
        this.setStatus('connected');
        return true;
    }

    _prepararNovaSessao(isReconnect) {
        this.isInitializing = true;
        this.isReady = false;
        this.qrCode = '';
        this.processedMessageIds = new Set();
        this.busyModeEnabled = false;
        this.bossName = 'Boss';
        this.setStatus(isReconnect ? 'reconnecting' : 'initializing', {
            attempt: this.reconnectAttempts || 0
        });
    }

    _opcoesDoCliente() {
        const executablePath = this.resolveBrowserExecutable();
        const puppeteerOptions = { headless: true, args: [...ARGUMENTOS_DO_CHROMIUM] };
        if (executablePath) {
            puppeteerOptions.executablePath = executablePath;
        }
        return {
            authStrategy: new LocalAuth({
                clientId: 'nova-desktop-client',
                dataPath: this.sessionPath
            }),
            authTimeoutMs: 120000,
            qrMaxRetries: 3,
            takeoverOnConflict: true,
            takeoverTimeoutMs: 15000,
            webVersionCache: {
                type: 'local',
                path: this.webCachePath
            },
            puppeteer: puppeteerOptions
        };
    }

    async initialize(options = {}) {
        const { isReconnect = false } = options;
        if (this._inicializacaoDispensada()) return;

        this.manualLogout = false;
        this.ensureRuntimeDirectories();
        this.clearReconnectTimer();

        if (this.client && !this.isReady) {
            await this.destroyClient({ preserveSession: true });
        }

        this._prepararNovaSessao(isReconnect);
        this.startInitTimeout();
        this.client = new Client(this._opcoesDoCliente());
        this.registerClientEvents(this.client);

        const cliente = this.client;
        try {
            await cliente.initialize();
        } catch (error) {
            await this._falhaAoIniciar(cliente, error);
        }
    }

    async _falhaAoIniciar(cliente, error) {
        if (this.client !== cliente) return;
        const errorMessage = String(error?.message || error || '');
        console.error('[WhatsApp] Initialize error:', errorMessage);
        this.clearInitTimeout();
        this.isInitializing = false;
        this.isReady = false;

        if (ehTravaDoPerfil(errorMessage)) {
            this.setStatus('reconnecting', { reason: 'profile-lock' });
            await this.recoverFromProfileLock(errorMessage);
            this.scheduleReconnect('profile-lock');
            return;
        }

        this.setStatus('disconnected', { reason: errorMessage || 'init-error' });

        await this.destroyClient({ preserveSession: true });
        this.scheduleReconnect('init-error');
    }

    registerClientEvents(client) {
        client.on('qr', qr => this._aoReceberQr(qr));
        client.on('loading_screen', (percent, message) => {
            this.sendToFrontend('loading', { percent, message });
        });
        client.on('authenticated', () => this._aoAutenticar());
        client.on('ready', () => this._aoFicarPronto());
        client.on('remote_session_saved', () => {
            console.info('[WhatsApp] Remote session saved');
        });
        client.on('auth_failure', msg => this._aoFalharAutenticacao(msg));
        client.on('disconnected', reason => this._aoDesconectar(reason));
        client.on('message', msg => this.handleIncomingMessage(msg));
        client.on('message_create', msg => this._aoCriarMensagem(msg));
    }

    async _aoReceberQr(qr) {
        if (this.lastQr === qr) return;
        this.lastQr = qr;
        this.isInitializing = false;
        this.clearInitTimeout();
        this.setStatus('scan_qr');

        try {
            const url = await qrcode.toDataURL(qr);
            this.qrCode = url;
            this.sendToFrontend('qr-code', { url });
        } catch (error) {
            console.error('[WhatsApp] QR encode error:', error.message || error);
        }
    }

    _aoAutenticar() {
        this.clearInitTimeout();
        this.isInitializing = false;
        this.setStatus('authenticated');
        console.info('[WhatsApp] Authenticated');
    }

    _aoFicarPronto() {
        this.clearInitTimeout();
        this.status = 'connected';
        this.isReady = true;
        this.qrCode = '';
        this.bossName = this.client?.info?.pushname || 'Boss';
        console.info(`[WhatsApp] 🤖 Authenticated as: ${this.bossName}`);

        this.sendToFrontend('whatsapp-event', { event: 'ready', data: { status: 'connected', bossName: this.bossName } });
        this.reconnectAttempts = 0;
        this.setStatus('connected');
        console.info('[WhatsApp] Client ready');
    }

    _aoFalharAutenticacao(msg) {
        console.error('[WhatsApp] Auth failure:', msg);
        this.clearInitTimeout();
        return this._derrubarSessao('auth_failure', msg, 'auth_failure');
    }

    _aoDesconectar(reason) {
        console.warn('[WhatsApp] Disconnected:', reason);
        this.clearInitTimeout();
        return this._derrubarSessao('disconnected', reason, reason || 'disconnected');
    }

    async _aoCriarMensagem(msg) {
        if (msg.fromMe) {
            await this.handleIncomingMessage(msg);
        }
    }

    async handleIncomingMessage(msg) {
        if (!msg) return;
        await tratarMensagemRecebida(this, msg);
    }

    _clientePronto() {
        return Boolean(this.client) && this.isReady;
    }

    _lembrarEnviada(sentMsg) {
        const sentId = sentMsg?.id?._serialized;
        if (!sentId) return;
        this.processedMessageIds.add(sentId);
        setTimeout(() => this.processedMessageIds.delete(sentId), ESQUECER_ENVIADA_EM_MS);
    }

    async handleScreenshotCommand(targetChatId) {
        if (!this._clientePronto()) {
            console.warn('[WA-Screenshot] Client not ready — cannot send screenshot.');
            return;
        }

        try {
            console.info('[WA-Screenshot] Capturing primary screen...');
            const imgBuffer = await screenshot({ format: 'png' });
            const media = new MessageMedia(
                'image/png',
                imgBuffer.toString('base64'),
                'nova_screenshot.png'
            );
            this._lembrarEnviada(await this.client.sendMessage(targetChatId, media, {
                caption: '🖥️ Here is your current PC screen'
            }));
            console.info('[WA-Screenshot] ✅ Screenshot sent to self-chat');
        } catch (err) {
            console.error('[WA-Screenshot] Capture/send error:', err.message);
            await this._avisarFalhaDaCaptura(targetChatId, err);
        }
    }

    async _avisarFalhaDaCaptura(targetChatId, err) {
        try {
            await this.client.sendMessage(
                targetChatId,
                `❌ Screenshot failed: ${err.message}\n\n_${BOT_SIGNATURE}_`
            );
        } catch (_) { }
    }

    _chaveDoGroq() {
        let apiKey = process.env.GROQ_API_KEY;
        const keyPath = path.join(this.app.getPath('userData'), 'groq_key.json');

        if (fs.existsSync(keyPath)) {
            const data = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
            if (data.apiKey) apiKey = data.apiKey;
        }
        return apiKey;
    }

    async transcribeAudio(base64Data) {
        try {
            const apiKey = this._chaveDoGroq();
            if (!apiKey) {
                console.error('[WhatsApp] Groq API key missing for transcription.');
                return null;
            }

            const form = formularioDoAudio(base64Data);
            const response = await axios.post(
                'https://api.groq.com/openai/v1/audio/transcriptions',
                form,
                {
                    headers: {
                        ...form.getHeaders(),
                        Authorization: `Bearer ${apiKey}`
                    },
                    timeout: 45000,
                    maxBodyLength: Infinity
                }
            );
            return textoDaTranscricao(response);
        } catch (error) {
            console.error('[WhatsApp] Transcription error:', detalheDoErro(error));
            return null;
        }
    }

    async sendReply(chatId, text, removeSignature = false) {
        if (!this._clientePronto()) {
            console.warn('[WhatsApp] Send skipped. Client not ready.');
            return false;
        }

        const targetChatId = String(chatId || '').trim();
        const messageText  = String(text   || '').trim();

        if (!destinoValido(targetChatId, messageText)) {
            console.warn('[WhatsApp] sendReply: invalid chatId or empty message. chatId:', targetChatId);
            return false;
        }

        try {
            const replyText = removeSignature ? messageText : comAssinatura(messageText);
            this._lembrarEnviada(await this.client.sendMessage(targetChatId, replyText));
            return true;
        } catch (error) {
            console.error('[WhatsApp] Send error:', error.message || error);
            return false;
        }
    }

    async sendToOwner(message) {
        if (!this.client || !this.isReady) {
            console.warn('[WhatsApp] Cannot send to owner. Client not ready.');
            return false;
        }
        try {
            const targetId = this.client.info.wid._serialized;
            await this.client.sendMessage(targetId, message);
            return true;
        } catch (error) {
            console.error('[WhatsApp] sendToOwner error:', error.message || error);
            return false;
        }
    }

    // ── Save busy settings to whatsapp_settings.json ─────────────────────
    _saveBusySettings() {
        try {
            const settingsPath = require('path').join(this.app.getPath('userData'), 'whatsapp_settings.json');
            const fs = require('fs');
            const current = fs.existsSync(settingsPath)
                ? JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
                : {};
            const updated = {
                ...current,
                busyStatus: this.busyStatusText,
                busyPreset: 'custom'
            };
            fs.writeFileSync(settingsPath, JSON.stringify(updated, null, 2));
            // Notify frontend to sync state
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.webContents.send('whatsapp-busy-status-updated', {
                    busyStatus: this.busyStatusText
                });
            }
            console.log('[WA-Busy] Settings saved:', this.busyStatusText);
        } catch (e) {
            console.error('[WA-Busy] Failed to save settings:', e.message);
        }
    }

    async sendReplyWithMimicry(chatId, text, addSignature = true) {
        if (!this._clientePronto()) return false;

        const targetChatId = String(chatId || '').trim();
        if (!targetChatId) return false;

        try {
            const chat = await this.client.getChatById(targetChatId);
            await esperar(Math.random() * 1500 + 1000);
            await chat.sendStateTyping();
            await esperar(Math.min(Math.max(text.length * 20, 1000), 4000));

            const finalMessage = addSignature ? comAssinatura(text) : text;
            this._lembrarEnviada(await this.client.sendMessage(targetChatId, finalMessage));
            return true;
        } catch (error) {
            console.error('[WA-Intelligence] Mimicry Send error:', error.message || error);
            return false;
        }
    }

    async logout() {
        this.manualLogout = true;
        this.clearAllTimers();
        this.reconnectAttempts = 0;
        this.isReady = false;
        this.isInitializing = false;
        this.qrCode = null;
        this.lastQr = null;

        await this.destroyClient({ preserveSession: false });
        this.setStatus('disconnected', { reason: 'manual-logout' });
    }

    async shutdown() {
        this.manualLogout = true;
        this.clearAllTimers();
        this.isReady = false;
        this.isInitializing = false;
        this.qrCode = null;
        this.lastQr = null;
        await this.destroyClient({ preserveSession: true });
    }

    sendToFrontend(event, data) {
        if (!this.mainWindow || this.mainWindow.isDestroyed()) return;

        try {
            this.mainWindow.webContents.send('whatsapp-event', { event, data });
        } catch (error) {
            console.error('[WhatsApp] Failed to send IPC event:', error.message || error);
        }
    }
}

module.exports = WhatsAppManager;
