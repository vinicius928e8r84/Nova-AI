'use strict';

const os = require('os');

const SCREENSHOT_TRIGGERS = [
    'screenshot', 'take ss', 'screen dikhao', 'capture screen',
    'ss lo', 'screen lo', 'screen capture', 'pc screen', 'screen bhejo',
    'screen short', 'tasveer bhejo', 'pc screen dikhao', 'photo bhejo'
];

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

const TIPOS_DE_VOZ = new Set(['ptt', 'audio']);
const MARCAS_DO_ROBO = ['[NOVA_AI_BOT]', '🤖', '\u200B'];
const COMANDOS_DE_STATUS = new Set(['!sysinfo', 'sysinfo', '!status']);
const ALERTAS_DO_GRUPO = ['payment', 'meeting', 'urgent', 'emergency', 'jaldi', 'zaroori', 'paisa'];
const URGENCIAS_DIRETAS = ['urgent', 'emergency', 'call me', 'jaldi', 'zaroori'];
const PEDIDO_DE_TRAVA = /(?:pc|laptop|computer|liptop|system) (?:lock|band)/i;
const TRAVA_SOZINHA = /^(?:lock|lock pc|lock laptop)$/i;
const CGSESSION = '/System/Library/CoreServices/Menu Extras/User.menu/Contents/Resources/CGSession';
const PREFIXO_DO_NAVEGADOR = '!browser ';
const PREFIXO_DO_OCUPADO = '!busy ';
const ESQUECER_TEXTO_EM_MS = 5000;

const gigabytes = bytes => (bytes / 1024 / 1024 / 1024).toFixed(2);
const ehVoz = msg => Boolean(msg.hasMedia) && TIPOS_DE_VOZ.has(msg.type);
const ehPedidoDeTrava = m => m === '!lock' || PEDIDO_DE_TRAVA.test(m) || TRAVA_SOZINHA.test(m);
const ehPedidoDeCaptura = m => m === '!ss' || SCREENSHOT_TRIGGERS.some(t => m.includes(t));
const resumoDoCorpo = body => (body.length > 50 ? body.substring(0, 50) + '...' : body);
const enderecoDoNavegador = url => (url.startsWith('http') ? url : `https://${url}`);

function statusOcupadoPedido(lowerMsg) {
    if (!lowerMsg.startsWith(PREFIXO_DO_OCUPADO)) return null;
    const param = lowerMsg.substring(PREFIXO_DO_OCUPADO.length).trim();
    if (BUSY_PRESETS[param]) return { texto: BUSY_PRESETS[param], rotulo: 'Status set' };
    return param.length > 3 ? { texto: param, rotulo: 'Custom Status set' } : null;
}

const ehDeGrupo = (fromId, toId) => fromId.includes('@g.us') || toId.includes('@g.us');

function contextoDaMensagem(msg) {
    const body = String(msg.body || '').trim();
    const fromId = msg.from || '';
    const toId = msg.to || '';
    return {
        body,
        lowerMsg: body.toLowerCase(),
        fromId,
        isGroup: ehDeGrupo(fromId, toId),
        isSelfChat: msg.from === msg.to,
        targetId: msg.fromMe ? toId : fromId,
        messageId: msg.id?._serialized,
    };
}

function aplicarTranscricao(msg, transcript) {
    if (!transcript) {
        console.warn('[WhatsApp] Transcription failed or empty.');
        return;
    }
    console.info(`[WhatsApp] Voice message transcribed: "${transcript}"`);
    msg.body = transcript;
}

async function transcreverVoz(gerente, msg) {
    console.info('[WhatsApp] Voice message detected. Downloading media...');
    try {
        const media = await msg.downloadMedia();
        if (!media || !media.data) return;
        console.info('[WhatsApp] Voice buffer downloaded. Sending to Whisper...');
        aplicarTranscricao(msg, await gerente.transcribeAudio(media.data));
    } catch (err) {
        console.error('[WhatsApp] Voice processing error:', err.message);
    }
}

function jaProcessada(gerente, { messageId, targetId, body }) {
    if (messageId && gerente.processedMessageIds.has(messageId)) return true;
    if (messageId) gerente.processedMessageIds.add(messageId);
    const bodyKey = `${targetId}:${body}`;
    if (gerente.processedMessageIds.has(bodyKey)) return true;
    gerente.processedMessageIds.add(bodyKey);
    setTimeout(() => gerente.processedMessageIds.delete(bodyKey), ESQUECER_TEXTO_EM_MS);
    return false;
}

function deveIgnorar(msg, { body, isSelfChat }) {
    if (MARCAS_DO_ROBO.some(marca => body.includes(marca))) return true;
    if (msg.fromMe && !isSelfChat) return true;
    return !body;
}

function travarSistema() {
    if (process.platform === 'darwin') require('./mac-native').run(CGSESSION, ['-suspend']).catch(console.error);
    else require('child_process').exec('rundll32.exe user32.dll,LockWorkStation');
}

async function travarPeloDono(gerente, { targetId }) {
    console.info('[ROOT_CMD] 🔒 Instant System Lock Triggered');
    travarSistema();
    await gerente.sendReplyWithMimicry(targetId, '🔒 ✅ *[ROOT_CMD]* PC/Laptop instantly lock kar diya gaya hai Boss!', false);
}

async function abrirNoNavegador(gerente, { body, targetId }) {
    const fullUrl = enderecoDoNavegador(body.substring(PREFIXO_DO_NAVEGADOR.length).trim());
    console.info(`[ROOT_CMD] 🌐 Opening browser: ${fullUrl}`);
    require('electron').shell.openExternal(fullUrl);
    await gerente.sendReplyWithMimicry(targetId, `✅ *[ROOT_CMD]* Browser mein kholna shuru kar diya:\n${fullUrl}`, false);
}

function statusDoSistema(gerente) {
    return `*🖥️ NOVA SYSTEM STATUS*\n\n` +
           `*CPU:* ${os.cpus()[0].model}\n` +
           `*CPU Load:* ${os.loadavg()[0].toFixed(2)}%\n` +
           `*RAM:* ${gigabytes(os.freemem())} GB Free / ${gigabytes(os.totalmem())} GB Total\n` +
           `*Platform:* ${os.platform()} ${os.release()}\n` +
           `*Boss Name:* ${gerente.bossName}\n` +
           `*Busy Mode:* ${gerente.busyModeEnabled ? '🟢 ON' : '🔴 OFF'}`;
}

async function enviarStatusDoSistema(gerente, { targetId }) {
    console.info('[ROOT_CMD] 📊 Status request');
    await gerente.sendReplyWithMimicry(targetId, statusDoSistema(gerente), false);
}

async function mudarOcupado(gerente, targetId, { ligado, texto, resposta }) {
    gerente.busyModeEnabled = ligado;
    if (texto !== undefined) gerente.busyStatusText = texto;
    gerente._saveBusySettings();
    await gerente.sendReplyWithMimicry(targetId, resposta, false);
}

const ligarOcupado = (gerente, { targetId }) => mudarOcupado(gerente, targetId, { ligado: true, resposta: '✅ *[ROOT_CMD]* Busy Mode *ACTIVE*. Guests ko auto-reply milega.' });
const desligarOcupado = (gerente, { targetId }) => mudarOcupado(gerente, targetId, { ligado: false, resposta: '✅ *[ROOT_CMD]* Busy Mode *DISABLED*.' });

function definirStatusOcupado(gerente, { lowerMsg, targetId }) {
    const { texto, rotulo } = statusOcupadoPedido(lowerMsg);
    return mudarOcupado(gerente, targetId, { ligado: true, texto, resposta: `✅ *[ROOT_CMD]* ${rotulo}: "${texto}"` });
}

function capturarTela(gerente, { targetId }) {
    console.info('[ROOT_CMD] 📸 Screenshot command');
    gerente.handleScreenshotCommand(targetId).catch(err =>
        console.error('[WA-Intelligence] handleScreenshotCommand failed:', err.message)
    );
}

const COMANDOS_DO_DONO = [
    { casa: ehPedidoDeTrava, executar: travarPeloDono },
    { casa: m => m.startsWith(PREFIXO_DO_NAVEGADOR), executar: abrirNoNavegador },
    { casa: m => COMANDOS_DE_STATUS.has(m), executar: enviarStatusDoSistema },
    { casa: m => m === '!busy on', executar: ligarOcupado },
    { casa: m => m === '!busy off', executar: desligarOcupado },
    { casa: m => statusOcupadoPedido(m) !== null, executar: definirStatusOcupado },
    { casa: ehPedidoDeCaptura, executar: capturarTela },
];

function comandoDoDono(gerente, ctx) {
    if (!ctx.isSelfChat) return null;
    gerente.sendToFrontend('whatsapp-event', { event: 'root-pulse', data: { command: ctx.body } });
    return COMANDOS_DO_DONO.find(({ casa }) => casa(ctx.lowerMsg)) || null;
}

function monitorarGrupo(gerente, { body, targetId, fromId }) {
    const bossMentioned = body.toLowerCase().includes(gerente.bossName.toLowerCase());
    const hasUrgentKeyword = ALERTAS_DO_GRUPO.some(k => body.toLowerCase().includes(k));
    if (!bossMentioned && !hasUrgentKeyword) return;
    console.info(`[WA-Monitor] 🔔 Group Alert in ${targetId}: ${body.substring(0, 40)}`);
    gerente.sendToFrontend('whatsapp-event', {
        event: 'group-alert',
        data: {
            chatId: targetId,
            message: body,
            sender: fromId,
            reason: bossMentioned ? 'MENTION' : 'URGENT_KEYWORD',
            bossName: gerente.bossName
        }
    });
}

async function notificarUrgencia(msg, { fromId, body }) {
    console.info(`[WA-Intelligence] 🚨 URGENT message detected from ${fromId}`);
    const { Notification } = require('electron');
    try {
        const chat = await msg.getChat();
        const contact = await msg.getContact();
        const name = contact?.name || contact?.pushname || chat.name || 'Someone';
        new Notification({
            title: `🚨 URGENT: WhatsApp from ${name}`,
            body: resumoDoCorpo(body),
        }).show();
    } catch (e) { console.error('Notification error', e); }
}

function registrarOcupado(gerente, ctx) {
    if (!ctx.isSelfChat && gerente.busyModeEnabled) console.info(`[WA-Intelligence] 💤 Busy Mode Active. Auto-replying to ${ctx.fromId}`);
}

const urgenciaDireta = ctx => !ctx.isSelfChat && URGENCIAS_DIRETAS.some(k => ctx.lowerMsg.includes(k));

function encaminharParaJanela(gerente, msg, ctx) {
    gerente.sendToFrontend('mobile-message', {
        message:    ctx.body,
        chatId:     ctx.targetId,
        fromMe:     msg.fromMe === true,
        isSelfChat: ctx.isSelfChat,
        bossName:   gerente.bossName,
        timestamp:  msg.timestamp,
        messageId:  ctx.messageId || `msg-${Date.now()}`
    });
}

async function tratarMensagemRecebida(gerente, msg) {
    if (ehVoz(msg)) await transcreverVoz(gerente, msg);
    const ctx = contextoDaMensagem(msg);
    console.info(`[WA-Bridge] body="${ctx.body.substring(0, 20)}" | fromMe=${msg.fromMe} | isSelf=${ctx.isSelfChat} | targetId=${ctx.targetId}`);
    if (jaProcessada(gerente, ctx) || deveIgnorar(msg, ctx)) return;
    const comando = comandoDoDono(gerente, ctx);
    if (comando) return comando.executar(gerente, ctx);
    if (ctx.isGroup) return monitorarGrupo(gerente, ctx);
    if (urgenciaDireta(ctx)) await notificarUrgencia(msg, ctx);
    registrarOcupado(gerente, ctx);
    encaminharParaJanela(gerente, msg, ctx);
}

module.exports = { tratarMensagemRecebida };
