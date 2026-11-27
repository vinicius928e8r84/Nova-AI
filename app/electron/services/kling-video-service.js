const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { execFile } = require('child_process');
const { criarPasta, exigirVideoGravado, tipoDaImagem, imagemEmDataUri, imagemExiste, apagarImagemTemporaria } = require('./kling-arquivos');
const { esperarAProximaConsulta, textoDoPrompt, resumoDoErro, primeiroModeloQueAceita, lerPedido, duracaoOuCinco, concluir, resultadoDoVideo, rotuloDoMotorLocal } = require('./kling-pedido');
const { localizarFfmpeg, roteiroDoFfmpeg } = require('./kling-ffmpeg');
const { API_DA_KLING, TAREFAS_DA_KLING, CONSULTAS_DA_KLING, FILA_FAL, MODELOS_FAL, CONSULTAS_DA_FILA_FAL, FAL_FALHOU, RECUSA_DO_FAL, temChaveDaKling, corpoDaKling, idDaTarefaDaKling, urlDoVideoDaKling, cabecalhosDoFal, duracaoDoFal, urlDoVideoFal } = require('./kling-nuvem');
const { MODELOS_VEO_CONHECIDOS, RECUSA_DO_VEO, CONSULTAS_DO_VEO, podeGerarComIa, criarClienteDoVeo, ehModeloDeVideo, nomeCurtoDoModelo, consultarOperacao, videoDaOperacao, temVideoEmbutido, urlComChave, pedidoParaOVeo } = require('./kling-veo');

const MOTORES_ESCOLHIDOS = new Map([['fal', '_gerarComFal'], ['system', '_gerarComIaDoSistema']]);

function ehRedirecionamento(codigo) {
    return codigo >= 300 && codigo < 400;
}

function deveSeguir(resposta) {
    return ehRedirecionamento(resposta.statusCode) && Boolean(resposta.headers.location);
}

class KlingVideoService {
    constructor(app) {
        this.app = app;
        this.ffmpegPath = this._resolveFfmpegPath();
    }

    _resolveFfmpegPath() {
        return localizarFfmpeg();
    }

    _getExportDir() {
        const daBiblioteca = path.join(__dirname, '..', '..', 'youtube_auto', 'exports');
        if (criarPasta(daBiblioteca)) return daBiblioteca;
        const doDiretorioAtual = path.join(process.cwd(), 'youtube_auto', 'exports');
        if (fs.existsSync(doDiretorioAtual)) return doDiretorioAtual;
        const nosDownloads = path.join(this.app.getPath('downloads'), 'Nova_AI_Videos');
        criarPasta(nosDownloads);
        return nosDownloads;
    }

    async convertPictureToVideo(entrada) {
        const pedido = lerPedido(entrada);
        const exportDir = this._getExportDir();
        pedido.timestamp = Date.now();
        pedido.outFileName = `kling_video_${pedido.timestamp}.mp4`;
        pedido.outFilePath = path.join(exportDir, pedido.outFileName);
        pedido.onProgress({ step: 'prepare', percent: 10, message: 'Preparando imagens...' });
        const imagem = this._imagemNoDisco(pedido, exportDir);
        try {
            return resultadoDoVideo(pedido, await this._gerar(pedido, imagem.caminho));
        } finally {
            apagarImagemTemporaria(imagem);
        }
    }

    _imagemNoDisco(pedido, exportDir) {
        if (imagemExiste(pedido.imagePath)) return { caminho: pedido.imagePath, temporaria: false };
        if (!pedido.imageBase64) throw new Error('No picture provided for video conversion.');
        const cleanBase64 = pedido.imageBase64.replace(/^data:image\/\w+;base64,/, '');
        const caminho = path.join(exportDir, `tmp_kling_${pedido.timestamp}.png`);
        fs.writeFileSync(caminho, Buffer.from(cleanBase64, 'base64'));
        return { caminho, temporaria: true };
    }

    async _gerar(pedido, imagem) {
        const motorEscolhido = MOTORES_ESCOLHIDOS.get(pedido.engine);
        if (motorEscolhido) return this[motorEscolhido](pedido, imagem);
        const naNuvem = await this._tentarKlingCloud(pedido, imagem);
        return naNuvem || this._gerarComMotorLocal(pedido, imagem);
    }

    async _gerarComFal(pedido, imagem) {
        pedido.onProgress({ step: 'fal_prepare', percent: 10, message: 'Preparando a IA fal.ai...' });
        await this._generateFalVideo(pedido, imagem);
        concluir(pedido);
        return { duration: duracaoOuCinco(pedido.duration), engine: 'IA fal.ai (Seedance Lite)' };
    }

    async _gerarComIaDoSistema(pedido, imagem) {
        pedido.onProgress({ step: 'system_prepare', percent: 10, message: 'Preparando a IA do Nova (Veo)...' });
        const { durationSeconds } = await this._generateSystemAIVideo(pedido, imagem);
        concluir(pedido);
        return { duration: durationSeconds, engine: 'IA do Sistema (Veo do Nova)' };
    }

    async _tentarKlingCloud(pedido, imagem) {
        if (!temChaveDaKling(pedido.apiKey)) return null;
        try {
            pedido.onProgress({ step: 'cloud_kling', percent: 25, message: 'Enviando tarefa para a Kling AI Cloud...' });
            const cloudResult = await this._callKlingCloudApi(pedido, imagem);
            if (cloudResult && cloudResult.success) return { duration: pedido.duration, engine: 'Kling AI Cloud API' };
        } catch (cloudErr) {
            console.warn('[KlingService] Kling Cloud API notice:', cloudErr.message, '→ Seamlessly using Nova Motion Engine.');
            pedido.onProgress({ step: 'fallback', percent: 35, message: `Kling Cloud: ${cloudErr.message}. Running Nova Motion Engine...` });
        }
        return null;
    }

    async _gerarComMotorLocal(pedido, imagem) {
        pedido.onProgress({ step: 'synthesizing', percent: 40, message: 'Sintetizando vídeo de movimento cinematográfico a 60fps...' });
        await this._generateLocalMotionVideo({
            imagePath: imagem,
            outFilePath: pedido.outFilePath,
            duration: duracaoOuCinco(pedido.duration),
            aspectRatio: pedido.aspectRatio,
            motionPreset: pedido.motionPreset,
            onProgress: pedido.onProgress
        });
        concluir(pedido);
        return { duration: pedido.duration, engine: rotuloDoMotorLocal(pedido) };
    }

    _getFalKey() {
        try {
            const os = require('os');
            const { execFileSync } = require('child_process');
            return execFileSync('security',
                ['find-generic-password', '-a', os.userInfo().username, '-s', 'fal-key', '-w'],
                { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
        } catch (e) { return null; }
    }

    async _generateFalVideo(pedido, imagem) {
        const key = this._getFalKey();
        if (!key) throw new Error('Chave do fal.ai não encontrada no Chaveiro do Mac (item "fal-key").');
        const fal = { pedido, dataUri: imagemEmDataUri(imagem), dur: duracaoDoFal(pedido.duration), headers: cabecalhosDoFal(key) };
        await this._enviarParaOFal(fal);
        await this._aguardarOFal(fal);
        const done = JSON.parse(await this._httpRequest({ hostname: FILA_FAL, path: fal.base, method: 'GET', headers: fal.headers }));
        const videoUrl = urlDoVideoFal(done);
        if (!videoUrl) throw new Error('fal.ai concluiu sem vídeo.');
        pedido.onProgress({ step: 'fal_save', percent: 95, message: 'Baixando o vídeo gerado...' });
        await this._downloadFile(videoUrl, pedido.outFilePath);
        exigirVideoGravado(pedido.outFilePath, 'O vídeo do fal.ai veio vazio.');
    }

    async _enviarParaOFal(fal) {
        const envio = await primeiroModeloQueAceita(MODELOS_FAL, RECUSA_DO_FAL, modelo => this._enviarAoModeloFal(fal, modelo));
        if (!envio.aceito) throw new Error('fal.ai recusou todos os modelos. (' + resumoDoErro(envio.ultimoErro, 300, 'sem detalhe') + ')');
    }

    async _enviarAoModeloFal(fal, modelo) {
        fal.pedido.onProgress({ step: 'fal_submit', percent: 20, message: `fal.ai (${modelo.name}): enviando a foto...` });
        const body = JSON.stringify({ prompt: textoDoPrompt(fal.pedido.prompt, ''), image_url: fal.dataUri, resolution: '720p', duration: fal.dur });
        const res = JSON.parse(await this._httpRequest({ hostname: FILA_FAL, path: `/${modelo.endpoint}`, method: 'POST', headers: fal.headers, body }));
        if (!res.request_id) throw new Error(res.detail || JSON.stringify(res).slice(0, 200));
        fal.used = modelo;
        fal.base = `/${modelo.endpoint}/requests/${res.request_id}`;
    }

    async _aguardarOFal(fal) {
        for (let attempts = 1; attempts <= CONSULTAS_DA_FILA_FAL; attempts++) {
            await esperarAProximaConsulta();
            const st = JSON.parse(await this._httpRequest({ hostname: FILA_FAL, path: `${fal.base}/status`, method: 'GET', headers: fal.headers }));
            fal.pedido.onProgress({ step: 'fal_wait', percent: Math.min(90, 25 + attempts), message: `fal.ai (${fal.used.name}) gerando o vídeo... ${attempts * 4}s (${st.status || '...'})` });
            if (st.status === 'COMPLETED') return;
            if (FAL_FALHOU.has(st.status)) throw new Error('fal.ai: geração falhou (' + JSON.stringify(st).slice(0, 200) + ')');
        }
    }

    async _tokenDaIa() {
        if (!podeGerarComIa(this.app)) throw new Error('IA do sistema indisponível neste app.');
        const token = await this.app.getGeminiToken();
        if (!token) throw new Error('Nenhuma chave da IA do Nova configurada. Configure no Nova Studio e tente de novo.');
        return token;
    }

    async _generateSystemAIVideo(pedido, imagem) {
        const token = await this._tokenDaIa();
        const veo = {
            pedido,
            token,
            ai: criarClienteDoVeo(token),
            mimeType: tipoDaImagem(imagem),
            imageBytes: fs.readFileSync(imagem).toString('base64'),
            aspectRatio: pedido.aspectRatio === '16:9' ? '16:9' : '9:16',
            durationSeconds: Number(pedido.duration) >= 10 ? 8 : 6
        };
        await this._enviarParaOVeo(veo, await this._modelosDoVeo(token));
        await this._aguardarOVeo(veo);
        await this._salvarVideoDoVeo(veo, videoDaOperacao(veo.op));
        return { durationSeconds: veo.durationSeconds };
    }

    async _modelosDoVeo(token) {
        const daChave = await this._modelosDeVideoDaChave(token);
        return daChave.length ? daChave : MODELOS_VEO_CONHECIDOS;
    }

    async _modelosDeVideoDaChave(token) {
        try {
            const list = JSON.parse(await this._httpRequest({
                hostname: 'generativelanguage.googleapis.com',
                path: '/v1beta/models?pageSize=200&key=' + encodeURIComponent(token),
                method: 'GET', headers: {}
            }));
            return (list.models || []).filter(ehModeloDeVideo).map(nomeCurtoDoModelo);
        } catch (e) {
            return [];
        }
    }

    async _enviarParaOVeo(veo, modelos) {
        const envio = await primeiroModeloQueAceita(modelos, RECUSA_DO_VEO, model => this._enviarAoModeloVeo(veo, model));
        if (!veo.op) throw new Error('A chave do Nova não tem acesso a vídeo (Veo) — a listagem da API não mostrou nenhum modelo de vídeo. Ative o faturamento no Google AI ou use o botão da IA fal.ai. Detalhe: ' + resumoDoErro(envio.ultimoErro, 200, 'nenhum'));
    }

    async _enviarAoModeloVeo(veo, model) {
        veo.pedido.onProgress({ step: 'veo_submit', percent: 20, message: `IA do Nova (${model}): enviando a foto...` });
        veo.op = await veo.ai.models.generateVideos(pedidoParaOVeo(veo, model));
        veo.usedModel = model;
    }

    async _aguardarOVeo(veo) {
        for (let attempts = 1; !veo.op.done && attempts <= CONSULTAS_DO_VEO; attempts++) {
            await esperarAProximaConsulta();
            veo.pedido.onProgress({ step: 'veo_wait', percent: Math.min(90, 25 + attempts), message: `IA do Nova gerando o vídeo (${veo.usedModel})... ${attempts * 4}s` });
            veo.op = await consultarOperacao(veo.ai, veo.op);
        }
        if (!veo.op.done) throw new Error('Tempo esgotado esperando a IA do Nova (6 min).');
    }

    async _salvarVideoDoVeo(veo, video) {
        if (!video) throw new Error('A IA do Nova não devolveu vídeo.');
        const { outFilePath } = veo.pedido;
        veo.pedido.onProgress({ step: 'veo_save', percent: 95, message: 'Salvando o vídeo gerado...' });
        if (temVideoEmbutido(video)) {
            fs.writeFileSync(outFilePath, Buffer.from(video.inlineData.data, 'base64'));
        } else if (video.uri) {
            await this._downloadFile(urlComChave(video.uri, veo.token), outFilePath);
        } else {
            throw new Error('Resposta da IA sem dados de vídeo.');
        }
        exigirVideoGravado(outFilePath, 'O vídeo da IA veio vazio.');
    }

    _generateLocalMotionVideo({ imagePath, outFilePath, duration, aspectRatio, motionPreset, onProgress }) {
        return new Promise((resolve, reject) => {
            const args = roteiroDoFfmpeg({ imagePath, outFilePath, duration, aspectRatio, motionPreset });
            console.info('[KlingService] Spawning FFmpeg Motion Video:', this.ffmpegPath, args.join(' '));
            execFile(this.ffmpegPath, args, { windowsHide: true }, (err, stdout, stderr) => {
                if (err) {
                    console.error('[KlingService] FFmpeg error:', err.message, stderr);
                    return reject(new Error(`Video motion synthesis failed: ${err.message}`));
                }
                console.info('[KlingService] Local motion video generated successfully:', outFilePath);
                resolve();
            });
            onProgress({ step: 'rendering', percent: 70, message: 'Renderizando caminho de câmera cinematográfico a 60fps...' });
        });
    }

    async _callKlingCloudApi(pedido, imagem) {
        const apiKey = pedido.apiKey.trim();
        const postData = corpoDaKling(pedido, imagemEmDataUri(imagem));
        const createRes = await this._httpRequest({
            hostname: API_DA_KLING,
            path: TAREFAS_DA_KLING,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'Content-Length': Buffer.byteLength(postData)
            },
            body: postData
        });
        const taskId = idDaTarefaDaKling(JSON.parse(createRes));
        console.info('[KlingService] Kling task created ID:', taskId);
        return this._aguardarAKling(pedido, apiKey, taskId);
    }

    async _aguardarAKling(pedido, apiKey, taskId) {
        for (let attempts = 1; attempts <= CONSULTAS_DA_KLING; attempts++) {
            await esperarAProximaConsulta();
            const statusRes = await this._httpRequest({
                hostname: API_DA_KLING,
                path: `${TAREFAS_DA_KLING}/${taskId}`,
                method: 'GET',
                headers: { 'Authorization': `Bearer ${apiKey}` }
            });
            const taskData = JSON.parse(statusRes).data;
            const state = taskData?.task_status;
            pedido.onProgress({ step: 'polling', percent: Math.min(90, 30 + attempts * 2), message: `Kling AI Cloud generating: ${state || 'processing'}...` });
            if (state === 'succeed') return this._baixarVideoDaKling(pedido, taskData);
            if (state === 'failed') throw new Error(taskData.task_status_msg || 'Kling task failed on cloud');
        }
        throw new Error('Kling API task timed out after 120s.');
    }

    async _baixarVideoDaKling(pedido, taskData) {
        const videoUrl = urlDoVideoDaKling(taskData);
        if (!videoUrl) throw new Error('Kling API completed but returned empty video URL');
        pedido.onProgress({ step: 'downloading', percent: 92, message: 'Baixando vídeo da Kling Cloud...' });
        await this._downloadFile(videoUrl, pedido.outFilePath);
        return { success: true };
    }

    _httpRequest({ hostname, path: reqPath, method, headers, body }) {
        return new Promise((resolve, reject) => {
            const req = https.request({ hostname, path: reqPath, method, headers }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve(data));
            });
            req.on('error', reject);
            if (body) req.write(body);
            req.end();
        });
    }

    _downloadFile(fileUrl, destPath) {
        return new Promise((resolve, reject) => {
            const file = fs.createWriteStream(destPath);
            const client = fileUrl.startsWith('https') ? https : http;
            client.get(fileUrl, (response) => {
                if (deveSeguir(response)) {
                    return this._downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
                }
                response.pipe(file);
                file.on('finish', () => file.close(() => resolve(destPath)));
            }).on('error', (err) => {
                fs.unlink(destPath, () => {});
                reject(err);
            });
        });
    }
}

module.exports = KlingVideoService;
