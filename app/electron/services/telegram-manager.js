const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const path = require('path');
const fs = require('fs');
const os = require('os');
const qrcode = require('qrcode');
const WebSocket = require('ws');

global.WebSocket = WebSocket;

const BOT_SIGNATURE = '[NOVA_AI_BOT]';
const MARCAS_DO_BOT = [BOT_SIGNATURE, '🤖', '\u200B'];
const SINAIS_DE_SESSAO_RECUSADA = ['AUTH_KEY_UNREGISTERED', '401'];
const CAMPOS_DA_SESSAO_SALVA = ['sessionString', 'apiId', 'apiHash'];
const CAMPOS_DO_PROXY_MTPROTO = ['proxyIp', 'proxyPort', 'proxySecret'];
const CAMPOS_DO_PROXY_SOCKS = ['proxyIp', 'proxyPort'];
const INTERVALO_DA_CONFERENCIA_MS = 15000;
const VALIDADE_DA_DEDUPLICACAO_MS = 10000;
const INTERVALO_ENTRE_AVISOS_DE_GRUPO_MS = 24 * 60 * 60 * 1000;
const COMANDO_DO_NAVEGADOR = '!browser ';
const PEDIDOS_DE_BLOQUEIO = [/^!lock$/, /(?:pc|laptop|computer|liptop|system) (?:lock|band)/i, /^(?:lock|lock pc|lock laptop)$/i];
const PEDIDOS_DE_STATUS = new Set(['!sysinfo', 'sysinfo', '!status']);

const PERFIS_DE_APARELHO = new Map([
    [6, { deviceModel: 'Samsung SM-S908B', systemVersion: 'Android 13', appVersion: '10.14.0' }],
    [2040, { deviceModel: 'Desktop', systemVersion: 'Windows 11', appVersion: '4.16.2' }],
    [2496, { deviceModel: 'WebK', systemVersion: 'Chrome/120.0.0.0', appVersion: '2.0.0' }],
]);
const PERFIL_PADRAO = { deviceModel: 'Nova Desktop Assistant', systemVersion: 'Windows 11', appVersion: '1.0.11' };

const COMANDOS_DO_CHEFE = [
    { reconhece: (texto) => PEDIDOS_DE_BLOQUEIO.some((padrao) => padrao.test(texto)), executa: (gerente, pedido) => gerente.bloquearComputador(pedido) },
    { reconhece: (texto) => texto.startsWith(COMANDO_DO_NAVEGADOR), executa: (gerente, pedido) => gerente.abrirNoNavegador(pedido) },
    { reconhece: (texto) => PEDIDOS_DE_STATUS.has(texto), executa: (gerente, pedido) => gerente.enviarStatusDoSistema(pedido) },
    { reconhece: (texto) => texto === '!busy on', executa: (gerente, pedido) => gerente.definirModoOcupado(true, pedido) },
    { reconhece: (texto) => texto === '!busy off', executa: (gerente, pedido) => gerente.definirModoOcupado(false, pedido) },
];

const camposPreenchidos = (dados, campos) => campos.every((campo) => dados[campo]);
const listaComItens = (lista) => Array.isArray(lista) && lista.length > 0;
const sessaoRecusada = (erro) => SINAIS_DE_SESSAO_RECUSADA.some((sinal) => erro.message.includes(sinal));
const escritaPeloBot = (texto) => MARCAS_DO_BOT.some((marca) => texto.includes(marca));
const respostaDaNovaAoConvidado = (fromMe, isSelfChat) => fromMe && !isSelfChat;
const textoDaResposta = (texto, semAssinatura) => (semAssinatura ? texto : `${texto}\n\n_${BOT_SIGNATURE}_`);

function opcoesDoPerfil(apiId) {
    const perfil = PERFIS_DE_APARELHO.get(parseInt(apiId)) || PERFIL_PADRAO;
    return { connectionRetries: 5, ...perfil, useWSS: true };
}

function proxyMtproto(ajustes) {
    if (!camposPreenchidos(ajustes, CAMPOS_DO_PROXY_MTPROTO)) return null;
    return { ip: ajustes.proxyIp, port: parseInt(ajustes.proxyPort), MTProxy: true, secret: ajustes.proxySecret };
}

function proxySocks(ajustes) {
    if (!camposPreenchidos(ajustes, CAMPOS_DO_PROXY_SOCKS)) return null;
    const proxy = { ip: ajustes.proxyIp, port: parseInt(ajustes.proxyPort), socksType: ajustes.proxyType === 'socks4' ? 4 : 5 };
    if (ajustes.proxyUsername) proxy.username = ajustes.proxyUsername;
    if (ajustes.proxyPassword) proxy.password = ajustes.proxyPassword;
    return proxy;
}

function proxyDosAjustes(ajustes) {
    if (!ajustes.useProxy) return null;
    return ajustes.proxyType === 'mtproto' ? proxyMtproto(ajustes) : proxySocks(ajustes);
}

function aplicarProxy(opcoes, ajustes) {
    const proxy = proxyDosAjustes(ajustes);
    if (!proxy) return;
    opcoes.proxy = proxy;
    const tipo = proxy.MTProxy ? 'MTProto' : `SOCKS${proxy.socksType}`;
    console.info(`[Telegram] Connecting via ${tipo} proxy: ${ajustes.proxyIp}:${ajustes.proxyPort}`);
}

function momentoDoUltimoAviso(avisos, titulo) {
    return avisos[titulo] ? new Date(avisos[titulo]).getTime() : 0;
}

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

    async sendOtpCode({ phone, apiId, apiHash }) {
        await this.cleanupPendingLogin();
        this.ensureRuntimeDirectories();
        this.setStatus('connecting');
        try {
            const client = this.criarCliente('', { apiId, apiHash });

            await client.connect();

            const res = await client.sendCode({
                apiId: parseInt(apiId),
                apiHash: apiHash
            }, phone);

            this.pendingLogin = {
                client,
                phone,
                phoneCodeHash: res.phoneCodeHash,
                apiId,
                apiHash
            };

            this.setStatus('wait_code');
            return { success: true };
        } catch (err) {
            console.error('[Telegram] Failed sending OTP:', err);
            this.setStatus('disconnected', { reason: err.message });
            return { success: false, error: err.message };
        }
    }

    async sendQrCode({ apiId, apiHash }) {
        await this.cleanupPendingLogin();
        this.ensureRuntimeDirectories();
        this.setStatus('connecting');
        try {
            const client = this.criarCliente('', { apiId, apiHash });

            await client.connect();

            this.pendingLogin = {
                client,
                apiId,
                apiHash
            };

            client.signInUserWithQrCode({ apiId: parseInt(apiId), apiHash }, this.etapasDoLoginPorQr())
                .then(() => this.concluirLoginPorQr(client, { apiId, apiHash }))
                .catch(err => {
                    console.error("[Telegram] QR code login failed/aborted:", err.message);
                    this.setStatus('disconnected', { reason: err.message });
                });

            return { success: true };
        } catch (err) {
            console.error('[Telegram] Failed initiating QR login:', err);
            this.setStatus('disconnected', { reason: err.message });
            return { success: false, error: err.message };
        }
    }

    etapasDoLoginPorQr() {
        return {
            onError: async (err) => this.falhaNoLoginPorQr(err),
            qrCode: async (qrToken) => this.mostrarQrCode(qrToken),
            password: async () => this.esperarSenhaDoLoginPorQr()
        };
    }

    falhaNoLoginPorQr(err) {
        console.error("[Telegram] QR Code Login error:", err.message);
        this.setStatus('disconnected', { reason: err.message });
        return true;
    }

    async mostrarQrCode(qrToken) {
        const tokenString = qrToken.token.toString("base64url");
        const link = `tg://login?token=${tokenString}`;
        try {
            const qrDataUrl = await qrcode.toDataURL(link);
            this.qrCodeUrl = qrDataUrl;
            this.setStatus('wait_qr', { qrUrl: qrDataUrl });
        } catch (err) {
            console.error("[Telegram] QR generation failed:", err);
            this.qrCodeUrl = link;
            this.setStatus('wait_qr', { qrUrl: link });
        }
    }

    esperarSenhaDoLoginPorQr() {
        this.setStatus('wait_password');
        return new Promise((resolve) => {
            this.passwordResolver = resolve;
        });
    }

    async concluirLoginPorQr(client, credenciais) {
        this.passwordResolver = null;
        this.ativarCliente(client);
        await this.concluirLogin('Logged in via QR Code as', credenciais);
    }

    async submitOtpCode({ code }) {
        if (!this.pendingLogin) return { success: false, error: 'No login flow active' };
        const login = this.pendingLogin;

        try {
            const entrou = await this.entrarComCodigo(login, code);
            if (!entrou) {
                this.setStatus('wait_password');
                return { success: true, requiresPassword: true };
            }
            this.ativarCliente(login.client);
            await this.concluirLogin('Logged in as', login);
            return { success: true, authenticated: true };
        } catch (err) {
            console.error('[Telegram] OTP verification failed:', err);
            return { success: false, error: err.message };
        }
    }

    async entrarComCodigo({ client, phone, phoneCodeHash }, code) {
        try {
            const signInResult = await client.invoke(
                new Api.auth.SignIn({
                    phoneNumber: phone,
                    phoneCodeHash: phoneCodeHash,
                    phoneCode: code
                })
            );
            if (signInResult instanceof Api.auth.AuthorizationSignUpRequired) {
                throw new Error('SIGN_UP_REQUIRED: This phone number is not registered on Telegram. Please register it using the official app first.');
            }
            return true;
        } catch (err) {
            if (err.message.includes('SESSION_PASSWORD_NEEDED')) return false;
            throw err;
        }
    }

    async submitPassword({ password }) {
        if (!this.pendingLogin) return { success: false, error: 'No login flow active' };
        if (this.passwordResolver) return this.entregarSenhaAoLoginPorQr(password);
        const login = this.pendingLogin;

        try {
            await login.client.signInWithPassword(
                {
                    apiId: parseInt(login.apiId),
                    apiHash: login.apiHash
                },
                {
                    password: () => password,
                    onError: (err) => {
                        console.error('[Telegram] 2FA Password error callback:', err);
                        return true;
                    }
                }
            );
            this.ativarCliente(login.client);
            await this.concluirLogin('Logged in as (2FA)', login);
            return { success: true, authenticated: true };
        } catch (err) {
            console.error('[Telegram] 2FA authentication failed:', err);
            return { success: false, error: err.message };
        }
    }

    entregarSenhaAoLoginPorQr(password) {
        this.passwordResolver(password);
        this.passwordResolver = null;
        return { success: true, authenticated: true };
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
            await this.tratarMensagemDeGrupo(message.peerId);
        }
    }

    filtroDeGruposAtivo() {
        return this.tgNotificationFilterEnabled && listaComItens(this.tgMonitoredGroups);
    }

    grupoMonitorado(chatTitle) {
        return this.tgMonitoredGroups.some(g => g.trim().toLowerCase() === chatTitle.trim().toLowerCase());
    }

    async tratarMensagemDeGrupo(peer) {
        console.info(`[Telegram-Filter] Received group/channel message. Enabled: ${this.tgNotificationFilterEnabled}, Monitored: ${JSON.stringify(this.tgMonitoredGroups)}`);
        if (!this.filtroDeGruposAtivo()) return;
        try {
            const entity = await this.client.getEntity(peer);
            const chatTitle = entity.title || '';
            console.info(`[Telegram-Filter] Resolved group title: "${chatTitle}"`);
            if (this.grupoMonitorado(chatTitle)) {
                await this.avisarGrupoMonitorado(entity, chatTitle);
            }
        } catch (err) {
            console.error('[Telegram-Filter] Error in monitored group message processing:', err.message);
        }
    }

    async avisarGrupoMonitorado(entity, chatTitle) {
        const now = Date.now();
        const decorrido = now - momentoDoUltimoAviso(this.tgNotificationCooldowns, chatTitle);
        if (decorrido >= INTERVALO_ENTRE_AVISOS_DE_GRUPO_MS) {
            await this.enviarAvisoAoGrupo(entity, chatTitle);
        } else {
            console.info(`[Telegram-Filter] Group "${chatTitle}" is under cooldown. (Remaining: ${Math.round((INTERVALO_ENTRE_AVISOS_DE_GRUPO_MS - decorrido) / 1000 / 60)} minutes)`);
        }
    }

    async enviarAvisoAoGrupo(entity, chatTitle) {
        console.info(`[Telegram-Filter] Message detected in monitored group: "${chatTitle}". Dispatching predefined message...`);
        this.tgNotificationCooldowns[chatTitle] = new Date().toISOString();
        this.saveSettings();
        await this.client.sendMessage(entity, { message: this.tgNotificationMessage });
        console.info(`[Telegram-Filter] Predefined notification successfully sent to group: "${chatTitle}"`);
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
        if (isSelfChat && await this.atenderComandoDoChefe({ texto: body, chatId: targetId })) return;

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

    async atenderComandoDoChefe(pedido) {
        const lowerMsg = pedido.texto.toLowerCase();
        const comando = COMANDOS_DO_CHEFE.find((candidato) => candidato.reconhece(lowerMsg));
        if (!comando) return false;
        await comando.executa(this, pedido);
        return true;
    }

    async bloquearComputador({ chatId }) {
        console.info('[ROOT_CMD_TG] 🔒 Instant System Lock Triggered');
        if (process.platform === 'darwin') require('./mac-native').run('/System/Library/CoreServices/Menu Extras/User.menu/Contents/Resources/CGSession',['-suspend']).catch(console.error); else require('child_process').exec('rundll32.exe user32.dll,LockWorkStation');
        await this.sendReply(chatId, '🔒 ✅ *[ROOT_CMD]* PC/Laptop instantly lock kar diya gaya hai Boss!');
    }

    async abrirNoNavegador({ texto, chatId }) {
        const url = texto.substring(COMANDO_DO_NAVEGADOR.length).trim();
        const fullUrl = url.startsWith('http') ? url : `https://${url}`;
        console.info(`[ROOT_CMD_TG] 🌐 Opening browser: ${fullUrl}`);
        require('electron').shell.openExternal(fullUrl);
        await this.sendReply(chatId, `✅ *[ROOT_CMD]* Browser mein kholna shuru kar diya:\n${fullUrl}`);
    }

    async enviarStatusDoSistema({ chatId }) {
        console.info('[ROOT_CMD_TG] 📊 Status request');
        await this.sendReply(chatId, this.resumoDoSistema());
    }

    resumoDoSistema() {
        const totalMem = (os.totalmem() / 1024 / 1024 / 1024).toFixed(2);
        const freeMem = (os.freemem() / 1024 / 1024 / 1024).toFixed(2);
        const cpuLoad = os.loadavg()[0].toFixed(2);
        return `*🖥️ NOVA SYSTEM STATUS*\n\n` +
               `*CPU:* ${os.cpus()[0].model}\n` +
               `*CPU Load:* ${cpuLoad}%\n` +
               `*RAM:* ${freeMem} GB Free / ${totalMem} GB Total\n` +
               `*Platform:* ${os.platform()} ${os.release()}\n` +
               `*Boss Name:* ${this.bossName}\n` +
               `*Busy Mode:* ${this.busyModeEnabled ? '🟢 ON' : '🔴 OFF'}`;
    }

    async definirModoOcupado(ligado, { chatId }) {
        this.busyModeEnabled = ligado;
        this.saveSettings();
        await this.sendReply(chatId, ligado
            ? '✅ *[ROOT_CMD]* Busy Mode *ACTIVE*. Guests ko auto-reply milega.'
            : '✅ *[ROOT_CMD]* Busy Mode *DISABLED*.');
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
