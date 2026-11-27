const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { MAC_BROWSER_KILL_PATTERN } = require('./paridade-utils');
const { avisarFalhaRepetida } = require('./whatsapp-aviso');
const { spawnSync } = require('child_process');
const axios = require('axios');
const FormData = require('form-data');
const screenshot = require('screenshot-desktop');
const {
    ASSINATURA_DO_ROBO,
    ehMensagemDeVoz,
    descreverMensagem,
    dadosDaMensagemRecebida,
    textoDaTranscricao,
    motivoDaFalhaNaTranscricao,
    mensagemDoErro,
    deveDescartar,
    motivoDoAlertaDeGrupo,
    ehUrgenteParaContato,
    nomeDoRemetente,
    resumoDaNotificacao,
    duracaoDaDigitacao,
    envioInvalido,
    comAssinatura
} = require('./whatsapp-mensagem');
const { reconhecerComandoDoDono, enderecoCompleto, relatorioDoSistema } = require('./whatsapp-comandos');

const ARGUMENTOS_DO_NAVEGADOR = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    '--disable-gpu'
];

const TRECHOS_DE_PERFIL_TRAVADO = ['already running for', 'SingletonLock', 'userDataDir'];

const NAVEGADORES_INSTALADOS_NO_WINDOWS = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];

const esperar = milissegundos => new Promise(resolver => setTimeout(resolver, milissegundos));

const ehPerfilTravado = mensagem => TRECHOS_DE_PERFIL_TRAVADO.some(trecho => mensagem.includes(trecho));

function primeiroNavegadorQueExiste(candidatos) {
    const encontrado = candidatos.find(candidato => candidato && fs.existsSync(candidato));
    if (encontrado) {
        console.info('[WhatsApp] Browser executable:', encontrado);
        return encontrado;
    }

    console.warn('[WhatsApp] No explicit browser executable found. Puppeteer default resolution will be used.');
    return null;
}

function formularioDeAudio(base64Data) {
    const form = new FormData();
    form.append('file', Buffer.from(base64Data, 'base64'), {
        filename: 'audio.ogg',
        contentType: 'audio/ogg'
    });
    form.append('model', 'whisper-large-v3');
    form.append('response_format', 'json');
    return form;
}

function soltarOuvintes(client) {
    try {
        client.removeAllListeners();
    } catch (_error) { }
}

async function sairDaSessao(client, preserveSession) {
    try {
        if (!preserveSession && typeof client.logout === 'function') {
            await client.logout();
        }
    } catch (error) {
        console.warn('[WhatsApp] Logout during destroy failed:', error.message || error);
    }
}

async function fecharNavegador(client) {
    try {
        await client.destroy();
    } catch (error) {
        console.warn('[WhatsApp] Destroy failed:', error.message || error);
    }
}

async function encerrarCliente(client, preserveSession) {
    soltarOuvintes(client);
    await sairDaSessao(client, preserveSession);
    await fecharNavegador(client);
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
        this.initTimeout = setTimeout(async () => {
            console.error('[WhatsApp] Initialization timeout. Rebuilding client.');
            this.isInitializing = false;
            this.isReady = false;
            this.qrCode = null;
            this.lastQr = null;
            this.setStatus('disconnected', { reason: 'init-timeout' });

            await this.destroyClient({ preserveSession: true });
            this.scheduleReconnect('init-timeout');
        }, this.maxInitTimeMs);
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

        const candidatos = [
            ...[process.env.PUPPETEER_EXECUTABLE_PATH].filter(Boolean),
            ...this.pastasDeNavegadores().flatMap(pasta => this.chromiumsDaPasta(pasta)),
            ...NAVEGADORES_INSTALADOS_NO_WINDOWS
        ];

        return primeiroNavegadorQueExiste(candidatos);
    }

    pastasDeNavegadores() {
        return [
            process.resourcesPath ? path.join(process.resourcesPath, 'browsers') : null,
            path.join(process.cwd(), 'browsers'),
            path.join(this.app.getPath('userData'), 'browsers')
        ].filter(Boolean);
    }

    chromiumsDaPasta(pasta) {
        if (!fs.existsSync(pasta)) return [];

        const candidatos = [path.join(pasta, 'chromium-1208', 'chrome-win64', 'chrome.exe')];

        try {
            const chromiumDirs = fs.readdirSync(pasta, { withFileTypes: true })
                .filter(entry => entry.isDirectory() && entry.name.startsWith('chromium-'))
                .map(entry => entry.name)
                .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));

            for (const dirName of chromiumDirs) {
                candidatos.push(path.join(pasta, dirName, 'chrome-win64', 'chrome.exe'));
            }
        } catch (error) {
            console.warn('[WhatsApp] Failed scanning browser directory:', pasta, error.message);
        }

        return candidatos;
    }

    async destroyClient({ preserveSession = true } = {}) {
        if (!this.client || this.destroying) return;

        this.destroying = true;
        const client = this.client;
        this.client = null;

        try {
            await encerrarCliente(client, preserveSession);
        } finally {
            this.destroying = false;
        }
    }

    async initialize({ isReconnect = false } = {}) {
        if (this.isInitializing) {
            console.log('[WhatsApp] Initialize skipped (already initializing).');
            return;
        }

        if (this.estaConectado()) {
            console.log('[WhatsApp] Initialize skipped (already connected).');
            this.setStatus('connected');
            return;
        }

        await this.prepararParaIniciar(isReconnect);

        const cliente = this.criarCliente();
        this.client = cliente;
        this.registerClientEvents(cliente);

        try {
            await cliente.initialize();
        } catch (error) {
            if (this.client !== cliente) return;
            await this.tratarFalhaAoIniciar(mensagemDoErro(error));
        }
    }

    async prepararParaIniciar(isReconnect) {
        this.manualLogout = false;
        this.ensureRuntimeDirectories();
        this.clearReconnectTimer();

        if (this.client && !this.isReady) {
            await this.destroyClient({ preserveSession: true });
        }

        this.isInitializing = true;
        this.isReady = false;
        this.qrCode = '';
        this.processedMessageIds = new Set();
        this.busyModeEnabled = false;
        this.bossName = 'Boss';
        this.setStatus(isReconnect ? 'reconnecting' : 'initializing', {
            attempt: this.reconnectAttempts || 0
        });

        this.startInitTimeout();
    }

    criarCliente() {
        const executablePath = this.resolveBrowserExecutable();
        const puppeteerOptions = { headless: true, args: [...ARGUMENTOS_DO_NAVEGADOR] };

        if (executablePath) {
            puppeteerOptions.executablePath = executablePath;
        }

        return new Client({
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
        });
    }

    async tratarFalhaAoIniciar(errorMessage) {
        console.error('[WhatsApp] Initialize error:', errorMessage);
        this.clearInitTimeout();
        this.isInitializing = false;
        this.isReady = false;

        if (ehPerfilTravado(errorMessage)) {
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
        this.registrarEventosDeConexao(client);
        this.registrarEventosDeQueda(client);

        client.on('message', async (msg) => {
            await this.handleIncomingMessage(msg);
        });

        client.on('message_create', async (msg) => {
            if (msg.fromMe) {
                await this.handleIncomingMessage(msg);
            }
        });
    }

    registrarEventosDeConexao(client) {
        client.on('qr', async (qr) => {
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
        });

        client.on('loading_screen', (percent, message) => {
            this.sendToFrontend('loading', { percent, message });
        });

        client.on('authenticated', () => {
            this.clearInitTimeout();
            this.isInitializing = false;
            this.setStatus('authenticated');
            console.log('[WhatsApp] Authenticated');
        });

        client.on('ready', () => {
            this.clearInitTimeout();
            this.status = 'connected';
            this.isReady = true;
            this.qrCode = '';

            this.bossName = this.client?.info?.pushname || 'Boss';
            console.log(`[WhatsApp] 🤖 Authenticated as: ${this.bossName}`);

            this.sendToFrontend('whatsapp-event', { event: 'ready', data: { status: 'connected', bossName: this.bossName } });
            this.reconnectAttempts = 0;
            this.setStatus('connected');
            console.log('[WhatsApp] Client ready');
        });

        client.on('remote_session_saved', () => {
            console.log('[WhatsApp] Remote session saved');
        });
    }

    registrarEventosDeQueda(client) {
        client.on('auth_failure', async (msg) => {
            console.error('[WhatsApp] Auth failure:', msg);
            this.marcarConexaoPerdida();
            this.setStatus('auth_failure', { reason: msg });

            await this.destroyClient({ preserveSession: true });
            this.scheduleReconnect('auth_failure');
        });

        client.on('disconnected', async (reason) => {
            console.warn('[WhatsApp] Disconnected:', reason);
            this.marcarConexaoPerdida();
            this.setStatus('disconnected', { reason });

            await this.destroyClient({ preserveSession: true });
            this.scheduleReconnect(reason || 'disconnected');
        });
    }

    marcarConexaoPerdida() {
        this.clearInitTimeout();
        this.isInitializing = false;
        this.isReady = false;
        this.qrCode = null;
        this.lastQr = null;
    }

    estaConectado() {
        return Boolean(this.client && this.isReady);
    }

    lembrarPorUmTempo(id, milissegundos) {
        this.processedMessageIds.add(id);
        setTimeout(() => this.processedMessageIds.delete(id), milissegundos);
    }

    ehRepetida({ messageId, targetId, body }) {
        if (this.processedMessageIds.has(messageId)) return true;
        if (messageId) this.processedMessageIds.add(messageId);

        const chaveDoTexto = `${targetId}:${body}`;
        if (this.processedMessageIds.has(chaveDoTexto)) return true;
        this.lembrarPorUmTempo(chaveDoTexto, 5000);
        return false;
    }

    async transcreverMensagemDeVoz(msg) {
        if (!ehMensagemDeVoz(msg)) return;

        console.info('[WhatsApp] Voice message detected. Downloading media...');
        try {
            const media = await msg.downloadMedia();
            if (!media?.data) return;

            console.info('[WhatsApp] Voice buffer downloaded. Sending to Whisper...');
            const transcript = await this.transcribeAudio(media.data);
            if (!transcript) {
                console.warn('[WhatsApp] Transcription failed or empty.');
                return;
            }

            console.info(`[WhatsApp] Voice message transcribed: "${transcript}"`);
            msg.body = transcript;
        } catch (err) {
            console.error('[WhatsApp] Voice processing error:', err.message);
        }
    }

    async handleIncomingMessage(msg) {
        if (!msg) return;

        await this.transcreverMensagemDeVoz(msg);

        const mensagem = descreverMensagem(msg);
        const { body, targetId, conversaComigo } = mensagem;

        console.info(`[WA-Bridge] body="${body.substring(0, 20)}" | fromMe=${msg.fromMe} | isSelf=${conversaComigo} | targetId=${targetId}`);

        if (this.ehRepetida(mensagem)) return;
        if (deveDescartar(mensagem)) return;

        if (conversaComigo && await this.tratarComandoDoDono(mensagem)) return;

        if (mensagem.ehGrupo) {
            this.alertarSobreGrupo(mensagem);
            return;
        }

        if (!conversaComigo) await this.observarContato(msg, mensagem);

        this.sendToFrontend('mobile-message', dadosDaMensagemRecebida(msg, mensagem, this.bossName));
    }

    async tratarComandoDoDono({ body, targetId }) {
        this.sendToFrontend('whatsapp-event', { event: 'root-pulse', data: { command: body } });

        const comando = reconhecerComandoDoDono(body);
        if (!comando) return false;

        await this[comando.metodo](targetId, comando.argumento);
        return true;
    }

    async trancarComputador(targetId) {
        console.info('[ROOT_CMD] 🔒 Instant System Lock Triggered');
        if (process.platform === 'darwin') require('./mac-native').run('/System/Library/CoreServices/Menu Extras/User.menu/Contents/Resources/CGSession',['-suspend']).catch(console.error); else require('child_process').exec('rundll32.exe user32.dll,LockWorkStation');
        await this.sendReplyWithMimicry(targetId, '🔒 ✅ *[ROOT_CMD]* PC/Laptop instantly lock kar diya gaya hai Boss!', false);
    }

    async abrirNavegador(targetId, endereco) {
        const fullUrl = enderecoCompleto(endereco);
        console.info(`[ROOT_CMD] 🌐 Opening browser: ${fullUrl}`);
        require('electron').shell.openExternal(fullUrl);
        await this.sendReplyWithMimicry(targetId, `✅ *[ROOT_CMD]* Browser mein kholna shuru kar diya:\n${fullUrl}`, false);
    }

    async responderStatus(targetId) {
        console.info('[ROOT_CMD] 📊 Status request');
        const info = relatorioDoSistema({ os, nomeDoDono: this.bossName, ocupado: this.busyModeEnabled });
        await this.sendReplyWithMimicry(targetId, info, false);
    }

    async ligarOcupado(targetId) {
        this.busyModeEnabled = true;
        this._saveBusySettings();
        await this.sendReplyWithMimicry(targetId, '✅ *[ROOT_CMD]* Busy Mode *ACTIVE*. Guests ko auto-reply milega.', false);
    }

    async desligarOcupado(targetId) {
        this.busyModeEnabled = false;
        this._saveBusySettings();
        await this.sendReplyWithMimicry(targetId, '✅ *[ROOT_CMD]* Busy Mode *DISABLED*.', false);
    }

    async definirOcupado(targetId, { texto, rotulo }) {
        this.busyModeEnabled = true;
        this.busyStatusText = texto;
        this._saveBusySettings();
        await this.sendReplyWithMimicry(targetId, `✅ *[ROOT_CMD]* ${rotulo} set: "${texto}"`, false);
    }

    capturarTela(targetId) {
        console.info('[ROOT_CMD] 📸 Screenshot command');
        this.handleScreenshotCommand(targetId).catch(err =>
            console.error('[WA-Intelligence] handleScreenshotCommand failed:', err.message)
        );
    }

    alertarSobreGrupo({ body, targetId, fromId }) {
        const reason = motivoDoAlertaDeGrupo(body, this.bossName);
        if (!reason) return;

        console.info(`[WA-Monitor] 🔔 Group Alert in ${targetId}: ${body.substring(0, 40)}`);
        this.sendToFrontend('whatsapp-event', {
            event: 'group-alert',
            data: {
                chatId: targetId,
                message: body,
                sender: fromId,
                reason,
                bossName: this.bossName
            }
        });
    }

    async observarContato(msg, mensagem) {
        if (ehUrgenteParaContato(mensagem.body)) {
            await this.notificarUrgencia(msg, mensagem);
        }

        if (this.busyModeEnabled) {
            console.info(`[WA-Intelligence] 💤 Busy Mode Active. Auto-replying to ${mensagem.fromId}`);
        }
    }

    async notificarUrgencia(msg, { body, fromId }) {
        console.info(`[WA-Intelligence] 🚨 URGENT message detected from ${fromId}`);
        const { Notification } = require('electron');
        try {
            const chat = await msg.getChat();
            const contact = await msg.getContact();
            new Notification({
                title: `🚨 URGENT: WhatsApp from ${nomeDoRemetente(contact, chat)}`,
                body: resumoDaNotificacao(body),
            }).show();
        } catch (e) { console.error('Notification error', e); }
    }

    async handleScreenshotCommand(targetChatId) {
        if (!this.client || !this.isReady) {
            console.warn('[WA-Screenshot] Client not ready — cannot send screenshot.');
            return;
        }

        try {
            console.log('[WA-Screenshot] Capturing primary screen...');

            const imgBuffer = await screenshot({ format: 'png' });

            const media = new MessageMedia(
                'image/png',
                imgBuffer.toString('base64'),
                'nova_screenshot.png'
            );

            const sentMsg = await this.client.sendMessage(targetChatId, media, {
                caption: '🖥️ Here is your current PC screen'
            });

            const sentId = sentMsg?.id?._serialized;
            if (sentId) this.lembrarPorUmTempo(sentId, 120000);

            console.log('[WA-Screenshot] ✅ Screenshot sent to self-chat');

        } catch (err) {
            console.error('[WA-Screenshot] Capture/send error:', err.message);
            try {
                await this.client.sendMessage(
                    targetChatId,
                    `❌ Screenshot failed: ${err.message}\n\n_${ASSINATURA_DO_ROBO}_`
                );
            } catch (_) { }
        }
    }

    chaveDaGroq() {
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
            const apiKey = this.chaveDaGroq();

            if (!apiKey) {
                console.error('[WhatsApp] Groq API key missing for transcription.');
                return null;
            }

            const form = formularioDeAudio(base64Data);
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
            console.error('[WhatsApp] Transcription error:', motivoDaFalhaNaTranscricao(error));
            return null;
        }
    }

    async enviarELembrar(chatId, texto) {
        const sentMsg = await this.client.sendMessage(chatId, texto);

        const sentId = sentMsg?.id?._serialized;
        if (sentId) this.lembrarPorUmTempo(sentId, 120000);
    }

    async sendReply(chatId, text, removeSignature = false) {
        if (!this.estaConectado()) {
            console.warn('[WhatsApp] Send skipped. Client not ready.');
            return false;
        }

        const targetChatId = String(chatId || '').trim();
        const messageText  = String(text   || '').trim();

        if (envioInvalido(targetChatId, messageText)) {
            console.warn('[WhatsApp] sendReply: invalid chatId or empty message. chatId:', targetChatId);
            return false;
        }

        try {
            await this.enviarELembrar(targetChatId, comAssinatura(messageText, removeSignature));
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
        if (!this.estaConectado()) return false;

        const targetChatId = String(chatId || '').trim();
        if (!targetChatId) return false;

        try {
            const chat = await this.client.getChatById(targetChatId);

            const initialDelay = Math.random() * 1500 + 1000;
            await esperar(initialDelay);

            await chat.sendStateTyping();

            await esperar(duracaoDaDigitacao(text));

            await this.enviarELembrar(targetChatId, comAssinatura(text, !addSignature));
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
