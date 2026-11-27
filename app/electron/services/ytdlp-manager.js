const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const toolPaths = require('./tool-paths');
const { LIMITE_DA_PLAYLIST, DownloadDoPedido, buscarNoYoutube } = require('./ytdlp-pedido');
const { LEITURA_DO_PEDIDO, grupoOuVazio, jaFoiBaixado, terminouUmArquivo, progressoManual, fimDoDownloadManual } = require('./ytdlp-saida');

const ARGUMENTOS_BASE = [
    '--newline',
    '--no-check-certificate',
    '--no-warnings',
    '--prefer-free-formats',
    '--retries', '5',
    '--fragment-retries', '5',
    '--windows-filenames',
    '--yes-playlist'
];
const ARGUMENTOS_DO_PEDIDO = ['--max-downloads', String(LIMITE_DA_PLAYLIST)];
const ARGUMENTOS_DE_AUDIO = ['-x', '--audio-format', 'mp3', '--audio-quality', '0'];
const SELETORES_DE_VIDEO = new Map([
    ['360p', 'bestvideo[height<=480]+bestaudio/best[height<=480]/best[height<=360]/best'],
    ['720p', 'bestvideo[height<=720]+bestaudio/best[height<=720]/best'],
    ['1080p', 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best']
]);

const RESPOSTAS_QUE_SUBSTITUEM = new Set(['haan', 'yes']);
const RESPOSTAS_QUE_MANTEM = new Set(['nahi', 'no']);

function matarSemFalhar(processo) {
    try { processo.kill(); } catch (e) {}
}

function encerrarArvoreNoWindows(processo) {
    const taskkill = spawn('taskkill', ['/PID', String(processo.pid), '/T', '/F'], { windowsHide: true });
    taskkill.on('error', () => matarSemFalhar(processo));
}

const ENCERRAR_ARVORE_POR_SISTEMA = { win32: encerrarArvoreNoWindows };

function encerrarArvoreDoProcesso(processo) {
    const encerrarArvore = ENCERRAR_ARVORE_POR_SISTEMA[process.platform];
    if (encerrarArvore && processo.pid) return encerrarArvore(processo);
    matarSemFalhar(processo);
}

function argumentosDoFormato(formato) {
    const seletor = SELETORES_DE_VIDEO.get(formato);
    return seletor ? ['-f', seletor, '--merge-output-format', 'mp4'] : ARGUMENTOS_DE_AUDIO;
}

class YtDlpManager {
    constructor(mainWindow, app) {
        this.mainWindow = mainWindow;
        this.app = app;
        this.defaultSavePath = path.resolve(os.homedir(), 'Downloads', 'Nova Downloads');
        this.garantirPastaDeDownloads();
        this.activeProcess = null;
        this.activeDetails = null;
        this.awaitingConfirmation = false;
        this.pendingDownloadArgs = null;
    }

    garantirPastaDeDownloads() {
        if (!fs.existsSync(this.defaultSavePath)) {
            fs.mkdirSync(this.defaultSavePath, { recursive: true });
        }
    }

    raizDoApp() {
        return this.app ? this.app.getAppPath() : process.cwd();
    }

    getYtDlpPath() {
        const ytDlp = toolPaths.exe('yt-dlp');
        const raizDoApp = this.raizDoApp();
        const candidates = [
            path.join(process.resourcesPath, 'bin', ytDlp),
            path.join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'bin', ytDlp),
            path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'youtube-dl-exec', 'bin', ytDlp),
            path.join(raizDoApp, 'resources', 'bin', ytDlp),
            path.join(raizDoApp, 'node_modules', 'youtube-dl-exec', 'bin', ytDlp),
            path.join(process.cwd(), 'resources', 'bin', ytDlp),
            path.join(process.cwd(), 'dist_electron', 'win-unpacked', 'resources', 'bin', ytDlp)
        ];
        return candidates.find(p => fs.existsSync(p)) || 'yt-dlp';
    }

    getFfmpegDir() {
        const ffmpeg = toolPaths.exe('ffmpeg');
        const candidates = [
            path.join(process.resourcesPath, 'bin'),
            path.join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'bin'),
            path.join(this.raizDoApp(), 'resources', 'bin'),
            path.join(process.cwd(), 'resources', 'bin'),
            path.join(process.cwd(), 'dist_electron', 'win-unpacked', 'resources', 'bin')
        ];
        return candidates.find(p => fs.existsSync(path.join(p, ffmpeg))) || path.join(process.resourcesPath, 'bin');
    }

    argumentosDoYtDlp(url, formato, argumentosDoModo) {
        const ffmpegDir = this.getFfmpegDir();
        const ffmpeg = fs.existsSync(path.join(ffmpegDir, toolPaths.exe('ffmpeg'))) ? ['--ffmpeg-location', ffmpegDir] : [];
        const savePathTemplate = path.resolve(this.defaultSavePath, '%(title)s.%(ext)s');
        return [...ARGUMENTOS_BASE, ...argumentosDoModo, '-o', savePathTemplate, ...argumentosDoFormato(formato), ...ffmpeg, url];
    }

    janelaAberta() {
        return Boolean(this.mainWindow) && !this.mainWindow.isDestroyed();
    }

    sendToFrontend(event, data) {
        if (!this.janelaAberta()) return;
        try {
            this.mainWindow.webContents.send(event, data);
        } catch (error) {
            console.error('[YTDLP-Smart] IPC Send error:', error);
        }
    }

    sendSwarmLog(text) {
        if (!this.janelaAberta()) return;
        try {
            const ts = new Date().toLocaleTimeString([], { hour12: false });
            const line = `[${ts}] DOWNLOADER → ${text}`;
            this.mainWindow.webContents.send('swarm:log', { agent: 'downloader', text: line });
        } catch (error) {}
    }

    sendSwarmStatus(status, progress) {
        if (!this.janelaAberta()) return;
        try {
            this.mainWindow.webContents.send('swarm:status', { agentId: 'downloader', status, progress });
        } catch (error) {}
    }

    sendWhatsappReply(chatId, message) {
        try {
            if (this.app.whatsappManager) {
                this.app.whatsappManager.sendReply(chatId, message);
            }
        } catch(e) { console.error('Failed sending WA message', e); }
    }

    encerrarProcessoAtivo() {
        if (!this.activeProcess) return false;
        try { encerrarArvoreDoProcesso(this.activeProcess); } catch (e) {}
        this.activeProcess = null;
        return true;
    }

    downloadOcupado() {
        return Boolean(this.activeProcess) || this.awaitingConfirmation;
    }

    async smartDownload(searchQuery, format, type, targetChatId) {
        console.info(`[YTDLP-Smart] Received Request: Query="${searchQuery}", Format=${format}, Type=${type}`);
        if (this.downloadOcupado()) {
            this.pedirConfirmacao({ searchQuery, format, type, targetChatId });
            return;
        }
        await this.executePipeline(searchQuery, format, type, targetChatId);
    }

    pedirConfirmacao(pedido) {
        console.info('[YTDLP-Smart] A download is already running.');
        this.awaitingConfirmation = true;
        this.pendingDownloadArgs = pedido;
        const tituloAtual = this.activeDetails?.title || 'Unknown';
        this.sendWhatsappReply(pedido.targetChatId, `⚠️ Ek download already chal raha hai (Title: ${tituloAtual}). Rokun aur naya shuru karun? (haan/nahi)`);
        this.sendToFrontend('ytdl-progress', { status: 'ERROR', error: "Download busy. Waiting for confirmation." });
        this.sendSwarmLog('Waiting for user confirmation...');
        this.sendSwarmStatus('waiting');
    }

    async handleConfirmation(userResponse) {
        if (!this.awaitingConfirmation) return false;
        const resposta = (userResponse || '').toLowerCase().trim();
        const pedido = this.pendingDownloadArgs;
        if (RESPOSTAS_QUE_SUBSTITUEM.has(resposta)) {
            await this.substituirDownload(pedido);
            return true;
        }
        if (RESPOSTAS_QUE_MANTEM.has(resposta)) {
            this.manterDownloadAtual(pedido);
            return true;
        }
        return false;
    }

    encerrarConfirmacao() {
        this.awaitingConfirmation = false;
        this.pendingDownloadArgs = null;
    }

    async substituirDownload(pedido) {
        this.sendWhatsappReply(pedido.targetChatId, '🛑 Current download stopped. Starting new request...');
        this.encerrarProcessoAtivo();
        this.encerrarConfirmacao();
        await this.executePipeline(pedido.searchQuery, pedido.format, pedido.type, pedido.targetChatId);
    }

    manterDownloadAtual(pedido) {
        this.sendWhatsappReply(pedido.targetChatId, '⏳ Naya request queue mein daal diya hai. Current load complete hone ke baad check karein.');
        this.encerrarConfirmacao();
        this.sendToFrontend('ytdl-progress', { status: 'DOWNLOADING', title: this.activeDetails?.title });
    }

    async manualDownload(url, format, type) {
        console.info(`[YTDLP-Manual] Received: URL=${url}, Format=${format}, Type=${type}`);
        this.encerrarProcessoAtivo();
        this.garantirPastaDeDownloads();
        const ytDlpPath = this.getYtDlpPath();
        const args = this.argumentosDoYtDlp(url, format, []);
        console.info(`[YTDLP-Manual] Spawning: ${ytDlpPath} with args:`, args);
        this.sendToFrontend('manual-ytdl-progress', {
            status: 'DOWNLOADING',
            progress: 0,
            speed: '',
            eta: '',
            title: 'Initializing download...'
        });
        this.activeProcess = spawn(ytDlpPath, args);
        this.acompanharDownloadManual(this.activeProcess);
    }

    acompanharDownloadManual(processo) {
        const stderr = [];
        processo.stdout.on('data', (data) => this.mostrarProgressoManual(data.toString()));
        processo.stderr.on('data', (data) => stderr.push(this.registrarStderrManual(data.toString())));
        processo.on('close', (code) => this.encerrarDownloadManual(code, stderr.join('')));
        processo.on('error', (err) => this.falharDownloadManual(err));
    }

    mostrarProgressoManual(texto) {
        const progresso = progressoManual(texto);
        if (progresso) this.sendToFrontend('manual-ytdl-progress', progresso);
    }

    registrarStderrManual(texto) {
        console.warn(`[YTDLP-Manual-Stderr]: ${texto}`);
        return texto + '\n';
    }

    encerrarDownloadManual(code, stderr) {
        console.info(`[YTDLP-Manual] Exit code ${code}`);
        this.activeProcess = null;
        this.sendToFrontend('manual-ytdl-progress', fimDoDownloadManual(code, stderr));
    }

    falharDownloadManual(err) {
        console.error('[YTDLP-Manual] Error:', err);
        this.sendToFrontend('manual-ytdl-progress', { status: 'ERROR', error: err.message });
        this.activeProcess = null;
    }

    cancelManualDownload() {
        if (!this.encerrarProcessoAtivo()) return false;
        this.sendToFrontend('manual-ytdl-progress', { status: 'ERROR', error: 'Download Canceled by User' });
        return true;
    }

    async executePipeline(searchQuery, format, type, targetChatId) {
        const pedido = { searchQuery, format, type, targetChatId };
        this.anunciarBusca(pedido);
        const alvo = await this.buscarAlvo(pedido);
        if (!alvo) return;
        const download = new DownloadDoPedido(pedido, alvo);
        this.anunciarAlvo(download);
        this.baixarPedido(download);
    }

    anunciarBusca(pedido) {
        this.activeDetails = { query: pedido.searchQuery, format: pedido.format, type: pedido.type, targetChatId: pedido.targetChatId, title: 'Searching...' };
        this.sendSwarmStatus('busy', 0);
        this.sendSwarmLog(`🔍 Initializing search sequence...`);
        this.sendWhatsappReply(pedido.targetChatId, `🔍 Searching YouTube for: "${pedido.searchQuery}"...`);
        this.sendToFrontend('ytdl-progress', {
            status: 'SEARCHING',
            query: pedido.searchQuery,
            message: 'Procurando no YouTube...'
        });
        this.sendSwarmLog(`🌐 Querying YouTube databanks: "${pedido.searchQuery}"`);
    }

    async buscarAlvo(pedido) {
        try {
            return await buscarNoYoutube(pedido);
        } catch (e) {
            this.avisarBuscaSemResultado(pedido, e);
            return null;
        }
    }

    avisarBuscaSemResultado(pedido, erro) {
        console.error('[YTDLP-Smart] Search failed:', erro.message);
        this.sendWhatsappReply(pedido.targetChatId, `❌ YouTube par koi result nahi mila: ${pedido.searchQuery}`);
        this.sendToFrontend('ytdl-progress', { status: 'ERROR', error: `No results found for: ${pedido.searchQuery}` });
        this.sendSwarmLog(`❌ Search failed: No results`);
        this.sendSwarmStatus('idle', 0);
        this.activeDetails = null;
    }

    anunciarAlvo(download) {
        const { pedido, alvo } = download;
        this.activeDetails.url = alvo.url;
        this.activeDetails.title = alvo.title;
        this.sendSwarmLog(`✅ Found Target: ${alvo.title.substring(0, 45)}...`);
        this.sendWhatsappReply(pedido.targetChatId, `✅ Found: ${alvo.title}\nFormat: ${pedido.format}\nType: ${pedido.type}\nStarting download...`);
        if (download.passaDoLimite) {
            this.sendWhatsappReply(pedido.targetChatId, `⚠️ Playlist mein ${alvo.totalCount} videos hain. Pehle ${LIMITE_DA_PLAYLIST} download ho rahe hain.`);
        }
    }

    baixarPedido(download) {
        const ytDlpPath = this.getYtDlpPath();
        const args = this.argumentosDoYtDlp(download.alvo.url, download.pedido.format, ARGUMENTOS_DO_PEDIDO);
        console.info(`[YTDLP-Smart] Spawning: ${ytDlpPath} with args:`, args);
        this.sendToFrontend('ytdl-progress', download.progressoNaTela(0, 'Calculating...', 'Calculating...'));
        this.activeProcess = spawn(ytDlpPath, args);
        this.acompanharPedido(download, this.activeProcess);
    }

    acompanharPedido(download, processo) {
        processo.stdout.on('data', (data) => this.lerSaidaDoPedido(download, data.toString()));
        processo.stderr.on('data', (data) => console.warn(`[YTDLP-Smart-Stderr]: ${data.toString()}`));
        processo.on('close', (code) => this.concluirPedido(download, code));
        processo.on('error', (err) => this.falharPedido(download, err));
    }

    lerSaidaDoPedido(download, texto) {
        if (jaFoiBaixado(texto)) {
            this.avisarArquivoPulado(download, texto);
            return;
        }
        const porcentagem = texto.match(LEITURA_DO_PEDIDO.porcentagem);
        if (porcentagem) this.mostrarProgressoDoPedido(download, texto, parseFloat(porcentagem[1]));
        if (terminouUmArquivo(texto)) {
            this.sendSwarmLog(`✅ File Extracted.`);
            download.concluirArquivo();
        }
    }

    avisarArquivoPulado(download, texto) {
        const arquivo = texto.match(LEITURA_DO_PEDIDO.arquivoPulado);
        const titulo = arquivo ? path.basename(arquivo[1]) : download.alvo.title;
        this.sendWhatsappReply(download.pedido.targetChatId, `⏭️ ${titulo} already downloaded hai — skip kiya.`);
    }

    mostrarProgressoDoPedido(download, texto, porcentagem) {
        const velocidade = grupoOuVazio(texto, LEITURA_DO_PEDIDO.velocidade);
        this.sendToFrontend('ytdl-progress', download.progressoNaTela(porcentagem, velocidade, grupoOuVazio(texto, LEITURA_DO_PEDIDO.eta)));
        this.sendSwarmStatus('busy', porcentagem);
        if (download.avancouUmPasso(porcentagem)) {
            this.sendSwarmLog(`⬇ Downloading... ${porcentagem}% (${velocidade})`);
        }
        const marco = download.marcoAlcancado(porcentagem);
        if (marco) {
            this.sendWhatsappReply(download.pedido.targetChatId, `⬇️ Downloading... ${marco}% complete\n${download.contagem} videos done`);
        }
    }

    concluirPedido(download, code) {
        console.info(`[YTDLP-Smart] child process exited with code ${code}`);
        this.sendToFrontend('ytdl-progress', download.conclusaoNaTela());
        this.sendWhatsappReply(download.pedido.targetChatId, `✅ Download Complete!\nTitle: ${download.alvo.title}\nSaved in: Nova Downloads folder`);
        this.sendSwarmLog(`✅ Download Sequence Complete.`);
        this.sendSwarmStatus('done');
        setTimeout(() => this.avisarOciosoSeLivre(), 2000);
        this.activeProcess = null;
        this.activeDetails = null;
    }

    avisarOciosoSeLivre() {
        if (!this.activeProcess) this.sendSwarmStatus('idle');
    }

    falharPedido(download, err) {
        console.error('[YTDLP-Smart] Child Process Spawn Error:', err);
        this.sendWhatsappReply(download.pedido.targetChatId, `❌ Download failed: Unable to spawn yt-dlp.\nKoi aur command do ya retry karo`);
        this.sendToFrontend('ytdl-progress', { status: 'ERROR', error: err.message });
        this.sendSwarmLog(`❌ Download Error: ${err.message}`);
        this.sendSwarmStatus('idle');
        this.activeProcess = null;
        this.activeDetails = null;
    }
}

module.exports = YtDlpManager;
