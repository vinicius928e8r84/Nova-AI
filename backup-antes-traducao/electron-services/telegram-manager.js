const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const path = require('path');
const fs = require('fs');
const qrcode = require('qrcode');
const WebSocket = require('ws');

global.WebSocket = WebSocket;

const BOT_SIGNATURE = '[NOVA_AI_BOT]';

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

        this.pendingLogin = null; // Stores details during OTP stage
        this.processedMessageIds = new Set();

        this.busyModeEnabled = false;
        this.busyStatusText = 'busy hain ya shayad kahin bahar gaye hain';
        this.bossName = 'Boss';
        this.connectionCheckInterval = null;

        // Smart Notification Filter variables
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

                // Load Notification Filter settings
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
        const id = parseInt(apiId);
        let opts = {};
        if (id === 6) {
            opts = {
                connectionRetries: 5,
                deviceModel: 'Samsung SM-S908B',
                systemVersion: 'Android 13',
                appVersion: '10.14.0',
                useWSS: true
            };
        } else if (id === 2040) {
            opts = {
                connectionRetries: 5,
                deviceModel: 'Desktop',
                systemVersion: 'Windows 11',
                appVersion: '4.16.2',
                useWSS: true
            };
        } else if (id === 2496) {
            opts = {
                connectionRetries: 5,
                deviceModel: 'WebK',
                systemVersion: 'Chrome/120.0.0.0',
                appVersion: '2.0.0',
                useWSS: true
            };
        } else {
            opts = {
                connectionRetries: 5,
                deviceModel: 'Nova Desktop Assistant',
                systemVersion: 'Windows 11',
                appVersion: '1.0.11',
                useWSS: true
            };
        }

        // Auto-inject SOCKS5 or MTProto Proxy if configured
        try {
            const configPath = path.join(this.app.getPath('userData'), 'telegram_settings.json');
            if (fs.existsSync(configPath)) {
                const settings = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                if (settings.useProxy) {
                    if (settings.proxyType === 'mtproto') {
                        if (settings.proxyIp && settings.proxyPort && settings.proxySecret) {
                            opts.proxy = {
                                ip: settings.proxyIp,
                                port: parseInt(settings.proxyPort),
                                MTProxy: true,
                                secret: settings.proxySecret
                            };
                            console.log(`[Telegram] Connecting via MTProto proxy: ${settings.proxyIp}:${settings.proxyPort}`);
                        }
                    } else {
                        if (settings.proxyIp && settings.proxyPort) {
                            opts.proxy = {
                                ip: settings.proxyIp,
                                port: parseInt(settings.proxyPort),
                                socksType: settings.proxyType === 'socks4' ? 4 : 5
                            };
                            if (settings.proxyUsername) {
                                opts.proxy.username = settings.proxyUsername;
                            }
                            if (settings.proxyPassword) {
                                opts.proxy.password = settings.proxyPassword;
                            }
                            console.log(`[Telegram] Connecting via SOCKS${settings.proxyType === 'socks4' ? '4' : '5'} proxy: ${settings.proxyIp}:${settings.proxyPort}`);
                        }
                    }
                }
            }
        } catch (e) {
            console.error('[Telegram-Manager] Error reading proxy config:', e.message);
        }

        return opts;
    }

    startConnectionCheck() {
        if (this.connectionCheckInterval) {
            clearInterval(this.connectionCheckInterval);
        }
        this.connectionCheckInterval = setInterval(async () => {
            if (!this.client || !this.isReady) {
                this.stopConnectionCheck();
                return;
            }
            try {
                // Perform a fast call to verify authorization status
                await this.client.getMe();
            } catch (err) {
                console.error('[Telegram-Monitor] Connection check encountered error:', err.message);
                if (err.message.includes('AUTH_KEY_UNREGISTERED') || err.message.includes('401')) {
                    console.warn('[Telegram-Monitor] Authorization key is unregistered. Logging out/invalidating session...');
                    await this.handleSessionInvalidated('session-expired');
                }
            }
        }, 15000); // Check every 15 seconds
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

        // Clean up session file to force re-login
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
        if (fs.existsSync(this.sessionFilePath)) {
            try {
                const data = JSON.parse(fs.readFileSync(this.sessionFilePath, 'utf8'));
                if (data.sessionString && data.apiId && data.apiHash) {
                    console.log('[Telegram] Auto-connecting saved session...');
                    await this.initialize({
                        sessionString: data.sessionString,
                        apiId: data.apiId,
                        apiHash: data.apiHash
                    });
                }
            } catch (e) {
                console.error('[Telegram] Failed auto-connecting session:', e.message);
            }
        }
    }

    async initialize({ sessionString = '', apiId, apiHash }) {
        if (this.isInitializing) return { success: false, error: 'Already initializing' };
        await this.cleanupPendingLogin();
        this.isInitializing = true;
        this.setStatus('initializing');

        try {
            const session = new StringSession(sessionString);
            const clientOpts = this.getClientOptions(apiId);
            this.client = new TelegramClient(session, parseInt(apiId), apiHash, clientOpts);

            await this.client.connect();

            // Check if we are already authenticated in this session
            const authenticated = await this.client.isUserAuthorized();
            if (authenticated) {
                this.isReady = true;
                this.isInitializing = false;
                this.setStatus('connected');

                const me = await this.client.getMe();
                this.bossName = me.firstName || me.username || 'Boss';
                console.log(`[Telegram] 🤖 Authenticated as: ${this.bossName}`);
                
                // Save the session details
                this.ensureRuntimeDirectories();
                fs.writeFileSync(this.sessionFilePath, JSON.stringify({
                    sessionString: this.client.session.save(),
                    apiId,
                    apiHash
                }, null, 2));

                this.registerTelegramEvents();
            } else {
                this.isInitializing = false;
                this.setStatus('disconnected', { reason: 'not-authenticated' });
            }
            return { success: true, authenticated };
        } catch (err) {
            console.error('[Telegram] Init error:', err);
            this.isInitializing = false;
            this.setStatus('disconnected', { reason: err.message });
            if (err.message.includes('AUTH_KEY_UNREGISTERED') || err.message.includes('401')) {
                try {
                    if (fs.existsSync(this.sessionFilePath)) {
                        fs.unlinkSync(this.sessionFilePath);
                    }
                } catch (e) {}
            }
            return { success: false, error: err.message };
        }
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
            const session = new StringSession('');
            const clientOpts = this.getClientOptions(apiId);
            const client = new TelegramClient(session, parseInt(apiId), apiHash, clientOpts);

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
            const session = new StringSession('');
            const clientOpts = this.getClientOptions(apiId);
            const client = new TelegramClient(session, parseInt(apiId), apiHash, clientOpts);

            await client.connect();

            this.pendingLogin = {
                client,
                apiId,
                apiHash
            };

            // Start GramJS QR login flow in background
            client.signInUserWithQrCode(
                { apiId: parseInt(apiId), apiHash },
                {
                    onError: async (err) => {
                        console.error("[Telegram] QR Code Login error:", err.message);
                        this.setStatus('disconnected', { reason: err.message });
                        return true; // stop auth
                    },
                    qrCode: async (qrToken) => {
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
                    },
                    password: async (hint) => {
                        this.setStatus('wait_password');
                        return new Promise((resolve) => {
                            this.passwordResolver = resolve;
                        });
                    }
                }
            ).then(async () => {
                this.client = client;
                this.isReady = true;
                this.pendingLogin = null;
                this.passwordResolver = null;
                this.setStatus('connected');

                const me = await this.client.getMe();
                this.bossName = me.firstName || me.username || 'Boss';
                console.log(`[Telegram] 🤖 Logged in via QR Code as: ${this.bossName}`);

                this.ensureRuntimeDirectories();
                fs.writeFileSync(this.sessionFilePath, JSON.stringify({
                    sessionString: this.client.session.save(),
                    apiId,
                    apiHash
                }, null, 2));

                this.registerTelegramEvents();
            }).catch(err => {
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

    async submitOtpCode({ code }) {
        if (!this.pendingLogin) return { success: false, error: 'No login flow active' };
        const { client, phone, phoneCodeHash, apiId, apiHash } = this.pendingLogin;

        try {
            let user;
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
                user = signInResult.user;
            } catch (err) {
                if (err.message.includes('SESSION_PASSWORD_NEEDED')) {
                    this.setStatus('wait_password');
                    return { success: true, requiresPassword: true };
                }
                throw err;
            }

            this.client = client;
            this.isReady = true;
            this.pendingLogin = null;
            this.setStatus('connected');

            const me = await this.client.getMe();
            this.bossName = me.firstName || me.username || 'Boss';
            console.log(`[Telegram] 🤖 Logged in as: ${this.bossName}`);

            // Save the session details
            this.ensureRuntimeDirectories();
            fs.writeFileSync(this.sessionFilePath, JSON.stringify({
                sessionString: this.client.session.save(),
                apiId,
                apiHash
            }, null, 2));

            this.registerTelegramEvents();
            return { success: true, authenticated: true };
        } catch (err) {
            console.error('[Telegram] OTP verification failed:', err);
            return { success: false, error: err.message };
        }
    }

    async submitPassword({ password }) {
        if (!this.pendingLogin) return { success: false, error: 'No login flow active' };
        
        if (this.passwordResolver) {
            this.passwordResolver(password);
            this.passwordResolver = null;
            return { success: true, authenticated: true };
        }

        const { client, apiId, apiHash } = this.pendingLogin;

        try {
            await client.signInWithPassword(
                {
                    apiId: parseInt(apiId),
                    apiHash: apiHash
                },
                {
                    password: () => password,
                    onError: (err) => {
                        console.error('[Telegram] 2FA Password error callback:', err);
                        return true;
                    }
                }
            );

            this.client = client;
            this.isReady = true;
            this.pendingLogin = null;
            this.setStatus('connected');

            const me = await this.client.getMe();
            this.bossName = me.firstName || me.username || 'Boss';
            console.log(`[Telegram] 🤖 Logged in as (2FA): ${this.bossName}`);

            // Save the session details
            this.ensureRuntimeDirectories();
            fs.writeFileSync(this.sessionFilePath, JSON.stringify({
                sessionString: this.client.session.save(),
                apiId,
                apiHash
            }, null, 2));

            this.registerTelegramEvents();
            return { success: true, authenticated: true };
        } catch (err) {
            console.error('[Telegram] 2FA authentication failed:', err);
            return { success: false, error: err.message };
        }
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

        // Delete session file
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

        this.client.addEventHandler(async (event) => {
            const message = event.message;
            if (!message || !message.message) return;

            // Smart Notification Filter logic for monitored groups
            const peer = message.peerId;
            const isPrivate = peer instanceof Api.PeerUser;
            if (!isPrivate) {
                console.log(`[Telegram-Filter] Received group/channel message. Enabled: ${this.tgNotificationFilterEnabled}, Monitored: ${JSON.stringify(this.tgMonitoredGroups)}`);
                if (this.tgNotificationFilterEnabled && Array.isArray(this.tgMonitoredGroups) && this.tgMonitoredGroups.length > 0) {
                    try {
                        const entity = await this.client.getEntity(peer);
                        const chatTitle = entity.title || '';
                        console.log(`[Telegram-Filter] Resolved group title: "${chatTitle}"`);
                        
                        const isMonitored = this.tgMonitoredGroups.some(g => g.trim().toLowerCase() === chatTitle.trim().toLowerCase());
                        if (isMonitored) {
                            const now = Date.now();
                            const lastSent = this.tgNotificationCooldowns[chatTitle] ? new Date(this.tgNotificationCooldowns[chatTitle]).getTime() : 0;
                            const COOLDOWN_MS = 24 * 60 * 60 * 1000;
                            
                            if (now - lastSent >= COOLDOWN_MS) {
                                console.log(`[Telegram-Filter] Message detected in monitored group: "${chatTitle}". Dispatching predefined message...`);
                                
                                // Set cooldown timestamp immediately to prevent race conditions
                                this.tgNotificationCooldowns[chatTitle] = new Date().toISOString();
                                this.saveSettings();
                                
                                await this.client.sendMessage(entity, { message: this.tgNotificationMessage });
                                console.log(`[Telegram-Filter] Predefined notification successfully sent to group: "${chatTitle}"`);
                            } else {
                                console.log(`[Telegram-Filter] Group "${chatTitle}" is under cooldown. (Remaining: ${Math.round((COOLDOWN_MS - (now - lastSent)) / 1000 / 60)} minutes)`);
                            }
                        }
                    } catch (err) {
                        console.error('[Telegram-Filter] Error in monitored group message processing:', err.message);
                    }
                }
                return;
            }

            const senderId = message.senderId ? message.senderId.toString() : '';
            const body = message.message.trim();
            const fromMe = message.out;

            const me = await this.client.getMe();
            const myId = me.id.toString();
            const isSelfChat = senderId === myId;
            const targetId = senderId;

            console.log(`[TG-Bridge] body="${body.substring(0, 20)}" | fromMe=${fromMe} | isSelf=${isSelfChat} | targetId=${targetId}`);

            // Deduplication
            const msgKey = `${targetId}:${body}:${message.date}`;
            if (this.processedMessageIds.has(msgKey)) return;
            this.processedMessageIds.add(msgKey);
            setTimeout(() => this.processedMessageIds.delete(msgKey), 10000);

            // Loop Protection
            if (body.includes('[NOVA_AI_BOT]') || body.includes('🤖') || body.includes('\u200B')) {
                return;
            }

            // Ignore Nova's outgoing replies to guests
            if (fromMe && !isSelfChat) {
                return;
            }

            // Self commands routing (Boss commanding Nova)
            if (isSelfChat) {
                const lowerMsg = body.toLowerCase();
                const isLockCmd = lowerMsg === '!lock' || /(?:pc|laptop|computer|liptop|system) (?:lock|band)/i.test(lowerMsg) || /^(?:lock|lock pc|lock laptop)$/i.test(lowerMsg);
                if (isLockCmd) {
                    console.log('[ROOT_CMD_TG] 🔒 Instant System Lock Triggered');
                    if (process.platform === 'darwin') require('./mac-native').run('/System/Library/CoreServices/Menu Extras/User.menu/Contents/Resources/CGSession',['-suspend']).catch(console.error); else require('child_process').exec('rundll32.exe user32.dll,LockWorkStation');
                    await this.sendReply(targetId, '🔒 ✅ *[ROOT_CMD]* PC/Laptop instantly lock kar diya gaya hai Boss!');
                    return;
                }

                if (lowerMsg.startsWith('!browser ')) {
                    const url = body.substring('!browser '.length).trim();
                    const fullUrl = url.startsWith('http') ? url : `https://${url}`;
                    console.log(`[ROOT_CMD_TG] 🌐 Opening browser: ${fullUrl}`);
                    require('electron').shell.openExternal(fullUrl);
                    await this.sendReply(targetId, `✅ *[ROOT_CMD]* Browser mein kholna shuru kar diya:\n${fullUrl}`);
                    return;
                }

                if (lowerMsg === '!sysinfo' || lowerMsg === 'sysinfo' || lowerMsg === '!status') {
                    console.log('[ROOT_CMD_TG] 📊 Status request');
                    const os = require('os');
                    const totalMem = (os.totalmem() / 1024 / 1024 / 1024).toFixed(2);
                    const freeMem = (os.freemem() / 1024 / 1024 / 1024).toFixed(2);
                    const cpuLoad = os.loadavg()[0].toFixed(2);
                    const info = `*🖥️ NOVA SYSTEM STATUS*\n\n` +
                                 `*CPU:* ${os.cpus()[0].model}\n` +
                                 `*CPU Load:* ${cpuLoad}%\n` +
                                 `*RAM:* ${freeMem} GB Free / ${totalMem} GB Total\n` +
                                 `*Platform:* ${os.platform()} ${os.release()}\n` +
                                 `*Boss Name:* ${this.bossName}\n` +
                                 `*Busy Mode:* ${this.busyModeEnabled ? '🟢 ON' : '🔴 OFF'}`;
                    await this.sendReply(targetId, info);
                    return;
                }

                if (lowerMsg === '!busy on') {
                    this.busyModeEnabled = true;
                    this.saveSettings();
                    await this.sendReply(targetId, '✅ *[ROOT_CMD]* Busy Mode *ACTIVE*. Guests ko auto-reply milega.');
                    return;
                }
                if (lowerMsg === '!busy off') {
                    this.busyModeEnabled = false;
                    this.saveSettings();
                    await this.sendReply(targetId, '✅ *[ROOT_CMD]* Busy Mode *DISABLED*.');
                    return;
                }
            }

            // Forward to Frontend
            this.sendToFrontend('mobile-message', {
                message: body,
                chatId: targetId,
                fromMe: fromMe,
                isSelfChat: isSelfChat,
                bossName: this.bossName,
                timestamp: message.date,
                messageId: message.id.toString()
            });
        }, new NewMessage({}));
    }

    async sendReply(chatId, text, removeSignature = false) {
        if (!this.client || !this.isReady) {
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
            const replyText = removeSignature ? messageText : `${messageText}\n\n_${BOT_SIGNATURE}_`;
            await this.client.sendMessage(targetChatId, { message: replyText });
            console.log('[Telegram] Reply sent successfully.');
            return true;
        } catch (err) {
            console.error('[Telegram] Failed sending reply message:', err.message);
            return false;
        }
    }
}

module.exports = TelegramManager;
