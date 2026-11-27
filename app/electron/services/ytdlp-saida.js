const path = require('path');

const LEITURA_MANUAL = {
    porcentagem: [/\[download\]\s+(\d+\.?\d*)%/i, /(\d+\.?\d*)%/],
    velocidade: /at\s+([0-9.]+[a-zA-Z]+\/s)/i,
    eta: /ETA\s+([0-9:]+)/i,
    tamanho: /of\s+([0-9.]+[a-zA-Z]+)/i,
    destino: [/Destination:\s*(.+)$/m, /\[download\]\s+(.+?)\s+has already been/i]
};
const LEITURA_DO_PEDIDO = {
    porcentagem: /\[download\]\s+(\d+\.?\d*)%/,
    velocidade: /at\s+([0-9.]+[a-zA-Z]+\/s)/,
    eta: /ETA\s+([0-9:]+)/,
    arquivoPulado: /\[download\] (.*?) has already been/
};

function primeiroGrupo(texto, expressoes) {
    for (const expressao of expressoes) {
        const achado = texto.match(expressao);
        if (achado) return achado[1];
    }
    return undefined;
}

function grupoOuVazio(texto, expressao) {
    const achado = texto.match(expressao);
    return achado ? achado[1] : '';
}

function jaFoiBaixado(texto) {
    return texto.toLowerCase().includes('already been downloaded');
}

function terminouUmArquivo(texto) {
    return texto.includes('[download] 100%') || texto.includes('100% of');
}

function tituloDoDestino(texto) {
    const destino = primeiroGrupo(texto, LEITURA_MANUAL.destino);
    return destino ? path.basename(destino.trim()) : undefined;
}

function progressoManual(texto) {
    const porcentagem = primeiroGrupo(texto, LEITURA_MANUAL.porcentagem);
    const titulo = tituloDoDestino(texto);
    if (porcentagem) {
        return {
            status: 'DOWNLOADING',
            progress: parseFloat(porcentagem),
            speed: grupoOuVazio(texto, LEITURA_MANUAL.velocidade),
            eta: grupoOuVazio(texto, LEITURA_MANUAL.eta),
            size: grupoOuVazio(texto, LEITURA_MANUAL.tamanho),
            title: titulo
        };
    }
    if (jaFoiBaixado(texto)) return { status: 'COMPLETE', progress: 100, title: titulo || 'File already downloaded' };
    return null;
}

function ultimoErroDoStderr(stderr) {
    const linhas = stderr.trim().split('\n').filter(linha => !linha.startsWith('WARNING:'));
    return linhas[linhas.length - 1] || 'Download failed or was interrupted.';
}

function fimDoDownloadManual(codigo, stderr) {
    if (codigo === 0) return { status: 'COMPLETE', progress: 100 };
    return { status: 'ERROR', error: `Exit Code ${codigo}: ${ultimoErroDoStderr(stderr)}` };
}

module.exports = { LEITURA_DO_PEDIDO, grupoOuVazio, jaFoiBaixado, terminouUmArquivo, progressoManual, fimDoDownloadManual };
