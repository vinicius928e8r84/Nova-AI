'use strict';

const PADROES_DE_TRANCAR = [
    /(?:pc|laptop|computer|liptop|system) (?:lock|band)/i,
    /^(?:lock|lock pc|lock laptop)$/i
];

const TEXTOS_DE_STATUS = ['!sysinfo', 'sysinfo', '!status'];

const GATILHOS_DE_CAPTURA = [
    'screenshot', 'take ss', 'screen dikhao', 'capture screen',
    'ss lo', 'screen lo', 'screen capture', 'pc screen', 'screen bhejo',
    'screen short', 'tasveer bhejo', 'pc screen dikhao', 'photo bhejo'
];

const PRESETS_DE_OCUPADO = {
    'driving':    'The Carl Moon sir abhi drive kar rahe hain 🚗, baad mein call karein.',
    'sick':       'The Carl Moon sir ki tabiyat theek nahi 🤒, get well soon duaen karein.',
    'meeting':    'The Carl Moon sir abhi meeting mein hain 📋, baad mein available honge.',
    'sleeping':   'The Carl Moon sir so rahe hain 😴, subah contact karein.',
    'sleep':      'The Carl Moon sir so rahe hain 😴, subah contact karein.',
    'travelling': 'The Carl Moon sir safar par hain ✈️, wapas aa kar reply karenge.',
    'travel':     'The Carl Moon sir safar par hain ✈️, wapas aa kar reply karenge.',
    'busy':       'The Carl Moon sir abhi busy hain ⏳, thodi der baad try karein.'
};

const PREFIXO_DO_NAVEGADOR = '!browser ';
const PREFIXO_DE_OCUPADO = '!busy ';
const MENOR_TEXTO_LIVRE_DE_OCUPADO = 4;

const comando = (metodo, argumento) => ({ metodo, argumento });

function reconhecerTrancar(body, texto) {
    const ehTrancar = texto === '!lock' || PADROES_DE_TRANCAR.some(padrao => padrao.test(texto));
    return ehTrancar ? comando('trancarComputador') : null;
}

function reconhecerNavegador(body, texto) {
    if (!texto.startsWith(PREFIXO_DO_NAVEGADOR)) return null;
    return comando('abrirNavegador', body.substring(PREFIXO_DO_NAVEGADOR.length).trim());
}

function reconhecerStatus(body, texto) {
    return TEXTOS_DE_STATUS.includes(texto) ? comando('responderStatus') : null;
}

function reconhecerTextoDeOcupado(texto) {
    if (PRESETS_DE_OCUPADO[texto]) return comando('definirOcupado', { texto: PRESETS_DE_OCUPADO[texto], rotulo: 'Status' });
    if (texto.length >= MENOR_TEXTO_LIVRE_DE_OCUPADO) return comando('definirOcupado', { texto, rotulo: 'Custom Status' });
    return null;
}

function reconhecerOcupado(body, texto) {
    if (texto === '!busy on') return comando('ligarOcupado');
    if (texto === '!busy off') return comando('desligarOcupado');
    if (!texto.startsWith(PREFIXO_DE_OCUPADO)) return null;
    return reconhecerTextoDeOcupado(texto.substring(PREFIXO_DE_OCUPADO.length).trim());
}

function reconhecerCaptura(body, texto) {
    const ehCaptura = texto === '!ss' || GATILHOS_DE_CAPTURA.some(gatilho => texto.includes(gatilho));
    return ehCaptura ? comando('capturarTela') : null;
}

const RECONHECEDORES = [reconhecerTrancar, reconhecerNavegador, reconhecerStatus, reconhecerOcupado, reconhecerCaptura];

function reconhecerComandoDoDono(body) {
    const texto = body.toLowerCase();
    for (const reconhecer of RECONHECEDORES) {
        const reconhecido = reconhecer(body, texto);
        if (reconhecido) return reconhecido;
    }
    return null;
}

function enderecoCompleto(endereco) {
    return endereco.startsWith('http') ? endereco : `https://${endereco}`;
}

function relatorioDoSistema({ os, nomeDoDono, ocupado }) {
    const memoriaTotal = (os.totalmem() / 1024 / 1024 / 1024).toFixed(2);
    const memoriaLivre = (os.freemem() / 1024 / 1024 / 1024).toFixed(2);
    const cargaDaCpu = os.loadavg()[0].toFixed(2);
    return `*🖥️ NOVA SYSTEM STATUS*\n\n` +
           `*CPU:* ${os.cpus()[0].model}\n` +
           `*CPU Load:* ${cargaDaCpu}%\n` +
           `*RAM:* ${memoriaLivre} GB Free / ${memoriaTotal} GB Total\n` +
           `*Platform:* ${os.platform()} ${os.release()}\n` +
           `*Boss Name:* ${nomeDoDono}\n` +
           `*Busy Mode:* ${ocupado ? '🟢 ON' : '🔴 OFF'}`;
}

module.exports = {
    reconhecerComandoDoDono,
    enderecoCompleto,
    relatorioDoSistema
};
