const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const { camposPreenchidos, sessaoRecusada, opcoesDoPerfil, aplicarProxy } = require('./telegram-conexao');
const { enviarCodigo, iniciarLoginPorQr, confirmarCodigo, confirmarSenha } = require('./telegram-login');
const { tratarMensagemDeGrupo } = require('./telegram-grupos');
const { atenderComandoDoChefe } = require('./telegram-comandos');

global.WebSocket = WebSocket;

const BOT_SIGNATURE = '[NOVA_AI_BOT]';
const MARCAS_DO_BOT = [BOT_SIGNATURE, '🤖', '\u200B'];
const CAMPOS_DA_SESSAO_SALVA = ['sessionString', 'apiId', 'apiHash'];
const INTERVALO_DA_CONFERENCIA_MS = 15000;
const VALIDADE_DA_DEDUPLICACAO_MS = 10000;

const escritaPeloBot = (texto) => MARCAS_DO_BOT.some((marca) => texto.includes(marca));
const respostaDaNovaAoConvidado = (fromMe, isSelfChat) => fromMe && !isSelfChat;
const textoDaResposta = (texto, semAssinatura) => (semAssinatura ? texto : `${texto}\n\n_${BOT_SIGNATURE}_`);

class TelegramManager {
    constructor(mainWindow, app) {
        this.mainWindow = mainWindow;
        this.app = app;

        this.client = null;
        this.isReady = false;
        this.isInitializing = false;
        this.status = 'disconnected';
        this.statusReason = null;
        this.qrCodeUrl = '';

        this.sessionDir = path.join(app.getPath('userData'), '.telegram_auth');
        this.sessionFilePath = path.join(this.sessionDir, 'session.json');

        this.pendingLogin = null;
        this.processedMessageIds = new Set();

        this.busyModeEnabled = false;
        this.busyStatusText = 'busy hain ya shayad kahin bahar gaye hain';
        this.bossName = 'Boss';
        this.connectionCheckInterval = null;

        this.tgNotificationFilterEnabled = false;
        this.tgMonitoredGroups = [];
        this.tgNotificationMessage = '⚠️ Nova Predefined Group Notification: Active monitored group message detected!';
        this.tgNotificationCooldowns = {};

        this.loadSettings();
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
            busyModeEnabled: this.busyModeEnabled,
            busyStatusText: this.busyStatusText,
            qrCode: this.qrCodeUrl || ''
        };
    }

    setStatus(status, extra = {}) {
        this.status = status;
        this.statusReason = extra.reason || null;
        if (status === 'disconnected' || status === 'connected') {
            this.qrCodeUrl = '';
        }
        this.sendToFrontend('status', { status, ...extra });
    }

    sendToFrontend(event, data) {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('telegram-event', { event, data });
        }
    }

    ensureRuntimeDirectories() {
        if (!fs.existsSync(this.sessionDir)) {
            fs.mkdirSync(this.sessionDir, { recursive: true });
        }
    }

    loadSettings() {
        const configPath = path.join(this.app.getPath('userData'), 'telegram_settings.json');
        try {
            if (fs.existsSync(configPath)) {
                const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                this.busyModeEnabled = !!data.busyModeEnabled;
                this.busyStatusText = data.busyStatusText || this.busyStatusText;

                this.tgNotificationFilterEnabled = !!data.tgNotificationFilterEnabled;
                this.tgMonitoredGroups = Array.isArray(data.tgMonitoredGroups) ? data.tgMonitoredGroups : [];
                this.tgNotificationMessage = data.tgNotificationMessage || '⚠️ Nova Predefined Group Notification: Active monitored group message detected!';
                this.tgNotificationCooldowns = data.tgNotificationCooldowns || {};
            }
        } catch (e) {
            console.error('[Telegram] Failed to load settings:', e);
        }
    }

    saveSettings() {
        const configPath = path.join(this.app.getPath('userData'), 'telegram_settings.json');
        try {
            const currentSettings = fs.existsSync(configPath)
                ? JSON.parse(fs.readFileSync(configPath, 'utf8'))
                : {};
            const merged = {
                ...currentSettings,
                busyModeEnabled: this.busyModeEnabled,
                busyStatusText: this.busyStatusText,
                tgNotificationFilterEnabled: this.tgNotificationFilterEnabled,
                tgMonitoredGroups: this.tgMonitoredGroups,
                tgNotificationMessage: this.tgNotificationMessage,
                tgNotificationCooldowns: this.tgNotificationCooldowns
            };
            fs.writeFileSync(configPath, JSON.stringify(merged, null, 2));
        } catch (e) {
            console.error('[Telegram] Failed to save settings:', e);
        }
    }

    getClientOptions(apiId) {
        const opts = opcoesDoPerfil(apiId);
        try {
            const configPath = path.join(this.app.getPath('userData'), 'telegram_settings.json');
            if (fs.existsSync(configPath)) {
                aplicarProxy(opts, JSON.parse(fs.readFileSync(configPath, 'utf8')));
            }
        } catch (e) {
            console.error('[Telegram-Manager] Error reading proxy config:', e.message);
        }
        return opts;
    }

    criarCliente(textoDaSessao, { apiId, apiHash }) {
        const session = new StringSession(textoDaSessao);
        const clientOpts = this.getClientOptions(apiId);
        return new TelegramClient(session, parseInt(apiId), apiHash, clientOpts);
    }

    clientePronto() {
        return Boolean(this.client && this.isReady);
    }

    startConnectionCheck() {
        if (this.connectionCheckInterval) {
            clearInterval(this.connectionCheckInterval);
        }
        this.connectionCheckInterval = setInterval(() => this.conferirConexao(), INTERVALO_DA_CONFERENCIA_MS);
    }

    async conferirConexao() {
        if (!this.clientePronto()) {
            this.stopConnectionCheck();
            return;
        }
        try {
            await this.client.getMe();
        } catch (err) {
            console.error('[Telegram-Monitor] Connection check encountered error:', err.message);
            if (sessaoRecusada(err)) {
                console.warn('[Telegram-Monitor] Authorization key is unregistered. Logging out/invalidating session...');
                await this.handleSessionInvalidated('session-expired');
            }
        }
    }

    stopConnectionCheck() {
        if (this.connectionCheckInterval) {
            clearInterval(this.connectionCheckInterval);
            this.connectionCheckInterval = null;
        }
    }

    async handleSessionInvalidated(reason) {
        this.stopConnectionCheck();
        this.isReady = false;
        this.setStatus('disconnected', { reason });

        if (this.client) {
            try {
                await this.client.disconnect();
            } catch (e) {
                console.warn('[Telegram-Monitor] Error during disconnect:', e.message);
            }
            this.client = null;
        }

        try {
            if (fs.existsSync(this.sessionFilePath)) {
                fs.unlinkSync(this.sessionFilePath);
                console.log('[Telegram-Monitor] Invalid session file deleted.');
            }
        } catch (e) {
            console.error('[Telegram-Monitor] Failed deleting session file:', e);
        }
    }

    async autoConnect() {
        this.ensureRuntimeDirectories();
        if (!fs.existsSync(this.sessionFilePath)) return;
        try {
            const data = JSON.parse(fs.readFileSync(this.sessionFilePath, 'utf8'));
            if (!camposPreenchidos(data, CAMPOS_DA_SESSAO_SALVA)) return;
            console.info('[Telegram] Auto-connecting saved session...');
            await this.initialize({
                sessionString: data.sessionString,
                apiId: data.apiId,
                apiHash: data.apiHash
            });
        } catch (e) {
            console.error('[Telegram] Failed auto-connecting session:', e.message);
        }
    }

    async initialize({ sessionString = '', apiId, apiHash }) {
        if (this.isInitializing) return { success: false, error: 'Already initializing' };
        await this.cleanupPendingLogin();
        this.isInitializing = true;
        this.setStatus('initializing');

        try {
            this.client = this.criarCliente(sessionString, { apiId, apiHash });
            await this.client.connect();
            const authenticated = await this.client.isUserAuthorized();
            if (authenticated) {
                await this.retomarSessaoAutorizada({ apiId, apiHash });
            } else {
                this.isInitializing = false;
                this.setStatus('disconnected', { reason: 'not-authenticated' });
            }
            return { success: true, authenticated };
        } catch (err) {
            return this.falhaAoIniciar(err);
        }
    }

    async retomarSessaoAutorizada(credenciais) {
        this.isReady = true;
        this.isInitializing = false;
        this.setStatus('connected');
        await this.concluirLogin('Authenticated as', credenciais);
    }

    falhaAoIniciar(err) {
        console.error('[Telegram] Init error:', err);
        this.isInitializing = false;
        this.setStatus('disconnected', { reason: err.message });
        if (sessaoRecusada(err)) {
            this.descartarSessaoSalva();
        }
        return { success: false, error: err.message };
    }

    descartarSessaoSalva() {
        try {
            if (fs.existsSync(this.sessionFilePath)) {
                fs.unlinkSync(this.sessionFilePath);
            }
        } catch (e) {}
    }

    ativarCliente(client) {
        this.client = client;
        this.isReady = true;
        this.pendingLogin = null;
        this.setStatus('connected');
    }

    async concluirLogin(rotulo, { apiId, apiHash }) {
        const me = await this.client.getMe();
        this.bossName = me.firstName || me.username || 'Boss';
        console.info(`[Telegram] 🤖 ${rotulo}: ${this.bossName}`);

        this.ensureRuntimeDirectories();
        fs.writeFileSync(this.sessionFilePath, JSON.stringify({
            sessionString: this.client.session.save(),
            apiId,
            apiHash
        }, null, 2));

        this.registerTelegramEvents();
    }

    async cleanupPendingLogin() {
        if (this.pendingLogin && this.pendingLogin.client) {
            try {
                console.log('[Telegram] Disconnecting previous pending login client...');
                await this.pendingLogin.client.disconnect();
            } catch (e) {
                console.warn('[Telegram] Error disconnecting pending login client:', e.message);
            }
        }
        this.pendingLogin = null;
    }

    sendOtpCode(credenciais) {
        return enviarCodigo(this, credenciais);
    }

    sendQrCode(credenciais) {
        return iniciarLoginPorQr(this, credenciais);
    }

    submitOtpCode(dados) {
        return confirmarCodigo(this, dados);
    }

    submitPassword(dados) {
        return confirmarSenha(this, dados);
    }

    async logout() {
        this.stopConnectionCheck();
        await this.cleanupPendingLogin();
        if (this.client) {
            try {
                if (this.isReady) {
                    await this.client.logOut();
                } else {
                    await this.client.disconnect();
                }
            } catch (e) {
                console.warn('[Telegram] Logout error:', e.message);
            }
        }

        this.client = null;
        this.isReady = false;
        this.pendingLogin = null;
        this.qrCodeUrl = '';
        this.setStatus('disconnected');

        try {
            if (fs.existsSync(this.sessionFilePath)) {
                fs.unlinkSync(this.sessionFilePath);
            }
        } catch (e) {
            console.error('[Telegram] Failed deleting session file:', e);
        }
        return { success: true };
    }

    registerTelegramEvents() {
        if (!this.client) return;

        this.startConnectionCheck();

        this.client.addEventHandler((event) => this.tratarMensagemNova(event), new NewMessage({}));
    }

    async tratarMensagemNova(event) {
        const message = event.message;
        if (!message || !message.message) return;

        if (message.peerId instanceof Api.PeerUser) {
            await this.tratarMensagemPrivada(message);
        } else {
            await tratarMensagemDeGrupo(this, message.peerId);
        }
    }

    async tratarMensagemPrivada(message) {
        const senderId = message.senderId ? message.senderId.toString() : '';
        const body = message.message.trim();
        const fromMe = message.out;

        const me = await this.client.getMe();
        const myId = me.id.toString();
        const isSelfChat = senderId === myId;
        const targetId = senderId;

        console.info(`[TG-Bridge] body="${body.substring(0, 20)}" | fromMe=${fromMe} | isSelf=${isSelfChat} | targetId=${targetId}`);

        if (this.mensagemRepetida(`${targetId}:${body}:${message.date}`)) return;
        if (escritaPeloBot(body)) return;
        if (respostaDaNovaAoConvidado(fromMe, isSelfChat)) return;
        if (isSelfChat && await atenderComandoDoChefe(this, { texto: body, chatId: targetId })) return;

        this.sendToFrontend('mobile-message', {
            message: body,
            chatId: targetId,
            fromMe: fromMe,
            isSelfChat: isSelfChat,
            bossName: this.bossName,
            timestamp: message.date,
            messageId: message.id.toString()
        });
    }

    mensagemRepetida(msgKey) {
        if (this.processedMessageIds.has(msgKey)) return true;
        this.processedMessageIds.add(msgKey);
        setTimeout(() => this.processedMessageIds.delete(msgKey), VALIDADE_DA_DEDUPLICACAO_MS);
        return false;
    }

    async sendReply(chatId, text, removeSignature = false) {
        if (!this.clientePronto()) {
            console.warn('[Telegram] Send skipped. Client not ready.');
            return false;
        }

        const targetChatId = String(chatId || '').trim();
        const messageText = String(text || '').trim();

        if (!targetChatId || !messageText) {
            console.warn('[Telegram] sendReply: invalid chatId or empty message.');
            return false;
        }

        try {
            await this.client.sendMessage(targetChatId, { message: textoDaResposta(messageText, removeSignature) });
            console.log('[Telegram] Reply sent successfully.');
            return true;
        } catch (err) {
            console.error('[Telegram] Failed sending reply message:', err.message);
            return false;
        }
    }
}

module.exports = TelegramManager;
