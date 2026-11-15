const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const axios = require('axios');
const FormData = require('form-data');
const screenshot = require('screenshot-desktop');

const BOT_SIGNATURE = '[NOVA_AI_BOT]';

// ── Remote Screenshot: keywords that trigger instant screen capture ──────────
const SCREENSHOT_TRIGGERS = [
    'screenshot', 'take ss', 'screen dikhao', 'capture screen',
    'ss lo', 'screen lo', 'screen capture', 'pc screen', 'screen bhejo',
    'screen short', 'tasveer bhejo', 'pc screen dikhao', 'photo bhejo'
];

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
            this.setStatus('disconnected', { reason: 'reconnect-limit-reached' });
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

    resolveBrowserExecutable() {
        if (process.platform === "darwin") {
            return require('./mac-native').browser('chrome');
        }

        const candidates = [];

        if (process.env.PUPPETEER_EXECUTABLE_PATH) {
            candidates.push(process.env.PUPPETEER_EXECUTABLE_PATH);
        }

        const browserRoots = [
            process.resourcesPath ? path.join(process.resourcesPath, 'browsers') : null,
            path.join(process.cwd(), 'browsers'),
            path.join(this.app.getPath('userData'), 'browsers')
        ].filter(Boolean);

        for (const root of browserRoots) {
            if (!fs.existsSync(root)) continue;

            candidates.push(path.join(root, 'chromium-1208', 'chrome-win64', 'chrome.exe'));

            try {
                const chromiumDirs = fs.readdirSync(root, { withFileTypes: true })
                    .filter(entry => entry.isDirectory() && entry.name.startsWith('chromium-'))
                    .map(entry => entry.name)
                    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));

                for (const dirName of chromiumDirs) {
                    candidates.push(path.join(root, dirName, 'chrome-win64', 'chrome.exe'));
                }
            } catch (error) {
                console.warn('[WhatsApp] Failed scanning browser directory:', root, error.message);
            }
        }

        candidates.push('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
        candidates.push('C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe');
        candidates.push('C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe');

        for (const candidate of candidates) {
            if (candidate && fs.existsSync(candidate)) {
                console.log('[WhatsApp] Browser executable:', candidate);
                return candidate;
            }
        }

        console.warn('[WhatsApp] No explicit browser executable found. Puppeteer default resolution will be used.');
        return null;
    }

    async destroyClient({ preserveSession = true } = {}) {
        if (!this.client || this.destroying) return;

        this.destroying = true;
        const client = this.client;
        this.client = null;

        try {
            client.removeAllListeners();
        } catch (_error) { }

        try {
            if (!preserveSession && typeof client.logout === 'function') {
                await client.logout();
            }
        } catch (error) {
            console.warn('[WhatsApp] Logout during destroy failed:', error.message || error);
        }

        try {
            await client.destroy();
        } catch (error) {
            console.warn('[WhatsApp] Destroy failed:', error.message || error);
        } finally {
            this.destroying = false;
        }
    }

    async initialize(options = {}) {
        const { isReconnect = false } = options;

        if (this.isInitializing) {
            console.log('[WhatsApp] Initialize skipped (already initializing).');
            return;
        }

        if (this.client && this.isReady) {
            console.log('[WhatsApp] Initialize skipped (already connected).');
            this.setStatus('connected');
            return;
        }

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

        const executablePath = this.resolveBrowserExecutable();
        const puppeteerOptions = {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu'
            ]
        };

        if (executablePath) {
            puppeteerOptions.executablePath = executablePath;
        }

        this.client = new Client({
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

        this.registerClientEvents(this.client);

        try {
            await this.client.initialize();
        } catch (error) {
            const errorMessage = String(error?.message || error || '');
            console.error('[WhatsApp] Initialize error:', errorMessage);
            this.clearInitTimeout();
            this.isInitializing = false;
            this.isReady = false;

            const isProfileLockError =
                errorMessage.includes('already running for') ||
                errorMessage.includes('SingletonLock') ||
                errorMessage.includes('userDataDir');

            if (isProfileLockError) {
                this.setStatus('reconnecting', { reason: 'profile-lock' });
                await this.recoverFromProfileLock(errorMessage);
                this.scheduleReconnect('profile-lock');
                return;
            }

            this.setStatus('disconnected', { reason: errorMessage || 'init-error' });

            await this.destroyClient({ preserveSession: true });
            this.scheduleReconnect('init-error');
        }
    }

    registerClientEvents(client) {
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
            
            // Pillar 1: Identity Recognition
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

        client.on('auth_failure', async (msg) => {
            console.error('[WhatsApp] Auth failure:', msg);
            this.clearInitTimeout();
            this.isInitializing = false;
            this.isReady = false;
            this.qrCode = null;
            this.lastQr = null;
            this.setStatus('auth_failure', { reason: msg });

            await this.destroyClient({ preserveSession: true });
            this.scheduleReconnect('auth_failure');
        });

        client.on('disconnected', async (reason) => {
            console.warn('[WhatsApp] Disconnected:', reason);
            this.clearInitTimeout();
            this.isInitializing = false;
            this.isReady = false;
            this.qrCode = null;
            this.lastQr = null;
            this.setStatus('disconnected', { reason });

            await this.destroyClient({ preserveSession: true });
            this.scheduleReconnect(reason || 'disconnected');
        });

        // 1. Handle incoming messages from others
        client.on('message', async (msg) => {
            await this.handleIncomingMessage(msg);
        });

        // 2. Handle messages created by the user (useful for self-chat sync)
        client.on('message_create', async (msg) => {
            if (msg.fromMe) {
                await this.handleIncomingMessage(msg);
            }
        });
    }

    async handleIncomingMessage(msg) {
        if (!msg) return;

        // ── Handle Voice Messages (PTT / Audio) ────────────────────────
        if (msg.hasMedia && (msg.type === 'ptt' || msg.type === 'audio')) {
            console.log('[WhatsApp] Voice message detected. Downloading media...');
            try {
                const media = await msg.downloadMedia();
                if (media && media.data) {
                    console.log('[WhatsApp] Voice buffer downloaded. Sending to Whisper...');
                    const transcript = await this.transcribeAudio(media.data);
                    if (transcript) {
                        console.log(`[WhatsApp] Voice message transcribed: "${transcript}"`);
                        msg.body = transcript;
                    } else {
                        console.warn('[WhatsApp] Transcription failed or empty.');
                    }
                }
            } catch (err) {
                console.error('[WhatsApp] Voice processing error:', err.message);
            }
        }

        const body   = String(msg.body || '').trim();
        const myId   = this.client?.info?.wid?._serialized || '';
        const fromId = msg?.from || '';
        const toId   = msg?.to || '';

        // ── ROOT_MASTER Detection (Pillar 4) ─────────────────────────────
        const isGroup = fromId.includes('@g.us') || toId.includes('@g.us');

        // isSelfChat = Boss sent this message TO THEIR OWN NUMBER
        const isSelfChat = msg.from === msg.to;

        // Target ID to reply to
        // If fromMe (even to others), the target is toId. If from others, target is fromId.
        const targetId = msg.fromMe ? toId : fromId;

        console.log(`[WA-Bridge] body="${body.substring(0, 20)}" | fromMe=${msg.fromMe} | isSelf=${isSelfChat} | targetId=${targetId}`);

        // ── Deduplication ──────────────────────────────────────────────────
        // 1. By Message ID
        const messageId = msg?.id?._serialized;
        if (messageId && this.processedMessageIds.has(messageId)) return;
        if (messageId) this.processedMessageIds.add(messageId);

        // 2. By Body (Prevent rapid double-processing)
        const bodyKey = `${targetId}:${body}`;
        if (this.processedMessageIds.has(bodyKey)) return;
        this.processedMessageIds.add(bodyKey);
        setTimeout(() => this.processedMessageIds.delete(bodyKey), 5000); 

        // ── Loop Protection ───────────────────────────────────────────────
        // 1. Always ignore bot's own reply markers
        if (body.includes('[NOVA_AI_BOT]') || body.includes('🤖') || body.includes('\u200B')) {
            return;
        }

        // 2. Ignore Nova's outgoing replies to GUESTS (fromMe=true to a non-self chat)
        //    But allow: isSelfChat=true (Boss commanding Nova)
        if (msg.fromMe && !isSelfChat) {
            return;
        }

        if (!body) return;

        // ── Remote Terminal Commands (From Own Phone / Self-Chat) ─────────────
        const lowerMsg = body.toLowerCase();
        
        // Allow self commands OR explicitly requested commands
        if (isSelfChat) {
            // Notify frontend: Visual Pulse (Cyan blink) on ROOT command
            this.sendToFrontend('whatsapp-event', { event: 'root-pulse', data: { command: body } });

            // Instant System Lock: Supports !lock, lock pc, laptop lock karo, etc.
            const isLockCmd = lowerMsg === '!lock' || /(?:pc|laptop|computer|liptop|system) (?:lock|band)/i.test(lowerMsg) || /^(?:lock|lock pc|lock laptop)$/i.test(lowerMsg);
            if (isLockCmd) {
                console.log('[ROOT_CMD] 🔒 Instant System Lock Triggered');
                if (process.platform === 'darwin') require('./mac-native').run('/System/Library/CoreServices/Menu Extras/User.menu/Contents/Resources/CGSession',['-suspend']).catch(console.error); else require('child_process').exec('rundll32.exe user32.dll,LockWorkStation');
                await this.sendReplyWithMimicry(targetId, '🔒 ✅ *[ROOT_CMD]* PC/Laptop instantly lock kar diya gaya hai Boss!', false);
                return;
            }

            // !browser [url] — Open URL in default browser
            if (lowerMsg.startsWith('!browser ')) {
                const url = body.substring('!browser '.length).trim();
                const fullUrl = url.startsWith('http') ? url : `https://${url}`;
                console.log(`[ROOT_CMD] 🌐 Opening browser: ${fullUrl}`);
                require('electron').shell.openExternal(fullUrl);
                await this.sendReplyWithMimicry(targetId, `✅ *[ROOT_CMD]* Browser mein kholna shuru kar diya:\n${fullUrl}`, false);
                return;
            }

            if (lowerMsg === '!sysinfo' || lowerMsg === 'sysinfo' || lowerMsg === '!status') {
                console.log('[ROOT_CMD] 📊 Status request');
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
                await this.sendReplyWithMimicry(targetId, info, false);
                return;
            }

            if (lowerMsg === '!busy on') {
                this.busyModeEnabled = true;
                this._saveBusySettings();
                await this.sendReplyWithMimicry(targetId, '✅ *[ROOT_CMD]* Busy Mode *ACTIVE*. Guests ko auto-reply milega.', false);
                return;
            }
            if (lowerMsg === '!busy off') {
                this.busyModeEnabled = false;
                this._saveBusySettings();
                await this.sendReplyWithMimicry(targetId, '✅ *[ROOT_CMD]* Busy Mode *DISABLED*.', false);
                return;
            }

            // ── Preset Status Commands ─────────────────────────────────────────
            // Usage: !busy driving | !busy sick | !busy meeting | !busy sleeping | !busy travelling
            const BUSY_PRESETS = {
                'driving':    'The Carl Moon sir abhi drive kar rahe hain 🚗, baad mein call karein.',
                'sick':       'The Carl Moon sir ki tabiyat theek nahi 🤒, get well soon duaen karein.',
                'meeting':    'The Carl Moon sir abhi meeting mein hain 📋, baad mein available honge.',
                'sleeping':   'The Carl Moon sir so rahe hain 😴, subah contact karein.',
                'sleep':      'The Carl Moon sir so rahe hain 😴, subah contact karein.',
                'travelling': 'The Carl Moon sir safar par hain ✈️, wapas aa kar reply karenge.',
                'travel':     'The Carl Moon sir safar par hain ✈️, wapas aa kar reply karenge.',
                'busy':       'The Carl Moon sir abhi busy hain ⏳, thodi der baad try karein.',
            };

            if (lowerMsg.startsWith('!busy ')) {
                const param = lowerMsg.substring(6).trim();
                if (BUSY_PRESETS[param]) {
                    // Preset match
                    this.busyModeEnabled = true;
                    this.busyStatusText = BUSY_PRESETS[param];
                    this._saveBusySettings();
                    await this.sendReplyWithMimicry(targetId, `✅ *[ROOT_CMD]* Status set: "${this.busyStatusText}"`, false);
                    return;
                }
                // If param is longer than 3 chars and not a keyword — treat as custom text
                if (param.length > 3) {
                    this.busyModeEnabled = true;
                    this.busyStatusText = param;
                    this._saveBusySettings();
                    await this.sendReplyWithMimicry(targetId, `✅ *[ROOT_CMD]* Custom Status set: "${param}"`, false);
                    return;
                }
            }

            // ── !status <text> — Quick custom status update ──────────────────
            // (Kept here for backward compatibility)
            
            // Screenshot command intercept
            const isScreenshotCmd = lowerMsg === '!ss' || SCREENSHOT_TRIGGERS.some(t => lowerMsg.includes(t));
            if (isScreenshotCmd) {
                console.log('[ROOT_CMD] 📸 Screenshot command');
                this.handleScreenshotCommand(targetId).catch(err =>
                    console.error('[WA-Intelligence] handleScreenshotCommand failed:', err.message)
                );
                return;
            }
        }

        // ── Group Intelligence & Stealth Monitor (Pillar 3) ─────────────
        if (isGroup) {
            const urgentKeywords = ['payment', 'meeting', 'urgent', 'emergency', 'jaldi', 'zaroori', 'paisa'];
            const bossMentioned = body.toLowerCase().includes(this.bossName.toLowerCase());
            const hasUrgentKeyword = urgentKeywords.some(k => body.toLowerCase().includes(k));

            if (bossMentioned || hasUrgentKeyword) {
                console.log(`[WA-Monitor] 🔔 Group Alert in ${targetId}: ${body.substring(0, 40)}`);
                this.sendToFrontend('whatsapp-event', {
                    event: 'group-alert',
                    data: {
                        chatId: targetId,
                        message: body,
                        sender: fromId,
                        reason: bossMentioned ? 'MENTION' : 'URGENT_KEYWORD',
                        bossName: this.bossName
                    }
                });
            }
            // Silent Monitor: Groups are never auto-replied to unless Boss commands it
            return; 
        }

        // ── Urgent Detection & Notifications (For Direct Messages) ───────────
        if (!isSelfChat) {
            const urgentKeywords = ['urgent', 'emergency', 'call me', 'jaldi', 'zaroori'];
            const isUrgent = urgentKeywords.some(k => lowerMsg.includes(k));

            if (isUrgent) {
                console.log(`[WA-Intelligence] 🚨 URGENT message detected from ${fromId}`);
                const { Notification } = require('electron');
                try {
                    const chat = await msg.getChat();
                    const contact = await msg.getContact();
                    const name = contact?.name || contact?.pushname || chat.name || 'Someone';
                    new Notification({
                        title: `🚨 URGENT: WhatsApp from ${name}`,
                        body: body.length > 50 ? body.substring(0, 50) + '...' : body,
                    }).show();
                } catch (e) { console.error('Notification error', e); }
            }

            // ── Shagird / Busy Mode Auto-Reply (Only for Direct Messages) ──────────
            if (this.busyModeEnabled) {
                console.log(`[WA-Intelligence] 💤 Busy Mode Active. Auto-replying to ${fromId}`);
                // Reply will be handled by Shagird Persona in useAppLogic.ts for better AI response
            }
        }

        // Forward ALL messages to Nova frontend (Crucial for self-chat commands)
        this.sendToFrontend('mobile-message', {
            message:    body,
            chatId:     targetId,
            fromMe:     msg.fromMe === true,
            isSelfChat: isSelfChat,
            bossName:   this.bossName,
            timestamp:  msg.timestamp,
            messageId:  messageId || `msg-${Date.now()}`
        });
    }

    // ── Remote Screenshot Handler ──────────────────────────────────────────
    //
    // Captures the primary display to an in-memory Buffer (no temp file),
    // converts to whatsapp-web.js MessageMedia, and sends as a photo.
    // Buffer is GC'd automatically — no cleanup step needed.
    async handleScreenshotCommand(targetChatId) {
        if (!this.client || !this.isReady) {
            console.warn('[WA-Screenshot] Client not ready — cannot send screenshot.');
            return;
        }

        try {
            console.log('[WA-Screenshot] Capturing primary screen...');

            // Capture to Buffer (screenshot-desktop default: PNG)
            const imgBuffer = await screenshot({ format: 'png' });

            // Convert buffer → base64 → MessageMedia
            const media = new MessageMedia(
                'image/png',
                imgBuffer.toString('base64'),
                'nova_screenshot.png'
            );

            // Send image + caption to self-chat
            const sentMsg = await this.client.sendMessage(targetChatId, media, {
                caption: '🖥️ Here is your current PC screen'
            });

            // Register sent message ID to prevent echo processing
            const sentId = sentMsg?.id?._serialized;
            if (sentId) {
                this.processedMessageIds.add(sentId);
                setTimeout(() => this.processedMessageIds.delete(sentId), 120000);
            }

            console.log('[WA-Screenshot] ✅ Screenshot sent to self-chat');

        } catch (err) {
            console.error('[WA-Screenshot] Capture/send error:', err.message);
            // Notify user so they know capture failed
            try {
                await this.client.sendMessage(
                    targetChatId,
                    `❌ Screenshot failed: ${err.message}\n\n_${BOT_SIGNATURE}_`
                );
            } catch (_) { /* silent — client may have disconnected */ }
        }
    }

    async transcribeAudio(base64Data) {
        try {
            let apiKey = process.env.GROQ_API_KEY;
            const keyPath = path.join(this.app.getPath('userData'), 'groq_key.json');

            if (fs.existsSync(keyPath)) {
                const data = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
                if (data.apiKey) apiKey = data.apiKey;
            }

            if (!apiKey) {
                console.error('[WhatsApp] Groq API key missing for transcription.');
                return null;
            }

            const audioBuffer = Buffer.from(base64Data, 'base64');
            const form = new FormData();
            form.append('file', audioBuffer, {
                filename: 'audio.ogg',
                contentType: 'audio/ogg'
            });
            form.append('model', 'whisper-large-v3');
            form.append('response_format', 'json');

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

            const text = String(response?.data?.text || '').trim();
            return text || null;
        } catch (error) {
            console.error('[WhatsApp] Transcription error:', error?.response?.data || error.message || error);
            return null;
        }
    }

    async sendReply(chatId, text, removeSignature = false) {
        if (!this.client || !this.isReady) {
            console.warn('[WhatsApp] Send skipped. Client not ready.');
            return false;
        }

        const targetChatId = String(chatId || '').trim();
        const messageText  = String(text   || '').trim();

        if (!targetChatId || targetChatId === 'self' || !messageText) {
            console.warn('[WhatsApp] sendReply: invalid chatId or empty message. chatId:', targetChatId);
            return false;
        }

        try {
            const replyText = removeSignature ? messageText : `${messageText}\n\n_${BOT_SIGNATURE}_`;
            const sentMsg   = await this.client.sendMessage(targetChatId, replyText);

            const sentId = sentMsg?.id?._serialized;

            if (sentId) {
                this.processedMessageIds.add(sentId);
                setTimeout(() => this.processedMessageIds.delete(sentId), 120000);
            }

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

    // ── Human-Mimicry Send Reply ──────────────────────────────────────────
    async sendReplyWithMimicry(chatId, text, addSignature = true) {
        if (!this.client || !this.isReady) return false;

        const targetChatId = String(chatId || '').trim();
        if (!targetChatId) return false;

        try {
            const chat = await this.client.getChatById(targetChatId);
            
            // Stealth Typing: Short random delay before typing (1s to 2.5s)
            const initialDelay = Math.random() * 1500 + 1000;
            await new Promise(r => setTimeout(r, initialDelay));
            
            // Send 'typing...' state
            await chat.sendStateTyping();
            
            // Simulate typing duration based on text length (20ms per char, max 4s)
            const typingDuration = Math.min(Math.max(text.length * 20, 1000), 4000);
            await new Promise(r => setTimeout(r, typingDuration));

            const finalMessage = addSignature ? `${text}\n\n_${BOT_SIGNATURE}_` : text;
            const sentMsg = await this.client.sendMessage(targetChatId, finalMessage);

            const sentId = sentMsg?.id?._serialized;
            if (sentId) {
                this.processedMessageIds.add(sentId);
                setTimeout(() => this.processedMessageIds.delete(sentId), 120000);
            }
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
