const ytSearch = require('yt-search');

const LIMITE_DA_PLAYLIST = 50;
const MARCOS_DA_PLAYLIST = [25, 50, 75];
const PASSO_DO_LOG_DE_PROGRESSO = 10;

function primeiroResultado(resposta, lista, erro) {
    const itens = resposta && resposta[lista];
    if (!itens || itens.length === 0) throw new Error(erro);
    return itens[0];
}

async function buscarPlaylist(consulta) {
    const playlist = primeiroResultado(await ytSearch(consulta + ' full playlist'), 'playlists', 'No playlist found.');
    return { url: playlist.url, title: playlist.title, totalCount: playlist.videoCount || 1 };
}

async function buscarVideo(consulta) {
    const video = primeiroResultado(await ytSearch(consulta), 'videos', 'No video found.');
    return { url: video.url, title: video.title, totalCount: 1 };
}

function buscarNoYoutube(pedido) {
    return pedido.type === 'playlist' ? buscarPlaylist(pedido.searchQuery) : buscarVideo(pedido.searchQuery);
}

class DownloadDoPedido {
    constructor(pedido, alvo) {
        this.pedido = pedido;
        this.alvo = alvo;
        this.arquivoAtual = 1;
        this.ultimoAviso = 0;
    }

    get ehPlaylist() { return this.pedido.type === 'playlist'; }
    get passaDoLimite() { return this.ehPlaylist && this.alvo.totalCount > LIMITE_DA_PLAYLIST; }
    get totalBaixavel() { return Math.min(this.alvo.totalCount, LIMITE_DA_PLAYLIST); }
    get contagem() { return `${this.arquivoAtual} / ${this.totalBaixavel}`; }
    get tituloNaTela() { return this.alvo.title + (this.ehPlaylist ? ' [Playlist]' : ''); }

    progressoNaTela(progresso, velocidade, eta) {
        return {
            status: 'DOWNLOADING',
            title: this.tituloNaTela,
            format: this.pedido.format,
            progress: progresso,
            speed: velocidade,
            eta,
            fileCount: this.contagem
        };
    }

    conclusaoNaTela() {
        return { status: 'COMPLETE', title: this.alvo.title, format: this.pedido.format, fileCount: `${this.totalBaixavel}`, saveLocation: 'Nova Downloads' };
    }

    avancouUmPasso(porcentagem) {
        if (porcentagem < this.ultimoAviso + PASSO_DO_LOG_DE_PROGRESSO) return false;
        this.ultimoAviso = Math.floor(porcentagem / PASSO_DO_LOG_DE_PROGRESSO) * PASSO_DO_LOG_DE_PROGRESSO;
        return true;
    }

    marcoAlcancado(porcentagem) {
        if (!this.ehPlaylist) return null;
        const marco = MARCOS_DA_PLAYLIST.find(m => porcentagem >= m && this.ultimoAviso < m);
        if (marco === undefined) return null;
        this.ultimoAviso = marco;
        return marco;
    }

    concluirArquivo() {
        this.arquivoAtual++;
        this.ultimoAviso = 0;
    }
}

module.exports = { LIMITE_DA_PLAYLIST, DownloadDoPedido, buscarNoYoutube };
