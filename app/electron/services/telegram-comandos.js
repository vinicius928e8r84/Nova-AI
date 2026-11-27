const os = require('os');

const COMANDO_DO_NAVEGADOR = '!browser ';
const PEDIDOS_DE_BLOQUEIO = [/^!lock$/, /(?:pc|laptop|computer|liptop|system) (?:lock|band)/i, /^(?:lock|lock pc|lock laptop)$/i];
const PEDIDOS_DE_STATUS = new Set(['!sysinfo', 'sysinfo', '!status']);

const COMANDOS_DO_CHEFE = [
    { reconhece: (texto) => PEDIDOS_DE_BLOQUEIO.some((padrao) => padrao.test(texto)), executa: (gerente, pedido) => bloquearComputador(gerente, pedido) },
    { reconhece: (texto) => texto.startsWith(COMANDO_DO_NAVEGADOR), executa: (gerente, pedido) => abrirNoNavegador(gerente, pedido) },
    { reconhece: (texto) => PEDIDOS_DE_STATUS.has(texto), executa: (gerente, pedido) => enviarStatusDoSistema(gerente, pedido) },
    { reconhece: (texto) => texto === '!busy on', executa: (gerente, pedido) => definirModoOcupado(gerente, true, pedido) },
    { reconhece: (texto) => texto === '!busy off', executa: (gerente, pedido) => definirModoOcupado(gerente, false, pedido) },
];

async function atenderComandoDoChefe(gerente, pedido) {
    const lowerMsg = pedido.texto.toLowerCase();
    const comando = COMANDOS_DO_CHEFE.find((candidato) => candidato.reconhece(lowerMsg));
    if (!comando) return false;
    await comando.executa(gerente, pedido);
    return true;
}

async function bloquearComputador(gerente, { chatId }) {
    console.info('[ROOT_CMD_TG] 🔒 Instant System Lock Triggered');
    if (process.platform === 'darwin') require('./mac-native').run('/System/Library/CoreServices/Menu Extras/User.menu/Contents/Resources/CGSession',['-suspend']).catch(console.error); else require('child_process').exec('rundll32.exe user32.dll,LockWorkStation');
    await gerente.sendReply(chatId, '🔒 ✅ *[ROOT_CMD]* PC/Laptop instantly lock kar diya gaya hai Boss!');
}

async function abrirNoNavegador(gerente, { texto, chatId }) {
    const url = texto.substring(COMANDO_DO_NAVEGADOR.length).trim();
    const fullUrl = url.startsWith('http') ? url : `https://${url}`;
    console.info(`[ROOT_CMD_TG] 🌐 Opening browser: ${fullUrl}`);
    require('electron').shell.openExternal(fullUrl);
    await gerente.sendReply(chatId, `✅ *[ROOT_CMD]* Browser mein kholna shuru kar diya:\n${fullUrl}`);
}

async function enviarStatusDoSistema(gerente, { chatId }) {
    console.info('[ROOT_CMD_TG] 📊 Status request');
    await gerente.sendReply(chatId, resumoDoSistema(gerente));
}

function resumoDoSistema(gerente) {
    const totalMem = (os.totalmem() / 1024 / 1024 / 1024).toFixed(2);
    const freeMem = (os.freemem() / 1024 / 1024 / 1024).toFixed(2);
    const cpuLoad = os.loadavg()[0].toFixed(2);
    return `*🖥️ NOVA SYSTEM STATUS*\n\n` +
           `*CPU:* ${os.cpus()[0].model}\n` +
           `*CPU Load:* ${cpuLoad}%\n` +
           `*RAM:* ${freeMem} GB Free / ${totalMem} GB Total\n` +
           `*Platform:* ${os.platform()} ${os.release()}\n` +
           `*Boss Name:* ${gerente.bossName}\n` +
           `*Busy Mode:* ${gerente.busyModeEnabled ? '🟢 ON' : '🔴 OFF'}`;
}

async function definirModoOcupado(gerente, ligado, { chatId }) {
    gerente.busyModeEnabled = ligado;
    gerente.saveSettings();
    await gerente.sendReply(chatId, ligado
        ? '✅ *[ROOT_CMD]* Busy Mode *ACTIVE*. Guests ko auto-reply milega.'
        : '✅ *[ROOT_CMD]* Busy Mode *DISABLED*.');
}

module.exports = { atenderComandoDoChefe };
