const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { execFile } = require('child_process');
const toolPaths = require('./tool-paths');


const ESPERA_ENTRE_CONSULTAS_MS = 4000;
const TAMANHO_MINIMO_DO_VIDEO = 1000;
const PROMPT_PADRAO = 'Cinematic dynamic camera motion, high detail';
const PROMPT_PADRAO_DA_KLING = 'Cinematic video motion, ultra-realistic';
const PROMPT_PADRAO_DO_VEO = 'Animate this image naturally: subtle realistic motion of subject and environment, cinematic quality.';
const TIPO_POR_EXTENSAO = new Map([['.png', 'image/png'], ['.webp', 'image/webp']]);
const FILA_FAL = 'queue.fal.run';
const MODELOS_FAL = [
    { name: 'Seedance 1.0 Lite', endpoint: 'fal-ai/bytedance/seedance/v1/lite/image-to-video' },
    { name: 'Wan 2.2', endpoint: 'fal-ai/wan/v2.2-a14b/image-to-video' },
    { name: 'Kling 2.1', endpoint: 'fal-ai/kling-video/v2.1/standard/image-to-video' }
];
const CONSULTAS_DA_FILA_FAL = 150;
const FAL_FALHOU = new Set(['FAILED', 'ERROR']);
const RECUSA_DO_FAL = { indisponivel: /4(0[04]|22|29)|not found|unsupported|invalid/i, prefixo: 'fal.ai: ' };
const MODELOS_VEO_CONHECIDOS = ['veo-3-fast-generate-001', 'veo-3.0-fast-generate-001', 'veo-3-fast-preview', 'veo-3.0-generate-001', 'veo-2.0-generate-001'];
const RECUSA_DO_VEO = { indisponivel: /not found|404|NOT_FOUND/i, prefixo: 'Veo: ' };
const CONSULTAS_DO_VEO = 90;
const API_DA_KLING = 'api.klingai.com';
const TAREFAS_DA_KLING = '/v1/videos/image2video';
const CONSULTAS_DA_KLING = 30;
const TAMANHO_POR_PROPORCAO = new Map([['9:16', '720x1280'], ['1:1', '1080x1080']]);
const TAMANHO_PADRAO = '1280x720';
const ZOOM_PADRAO = quadros => `zoompan=z='min(1+0.20*on/${quadros},1.20)':d=${quadros}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`;
const MOVIMENTOS = new Map([
    ['pan_right', quadros => `zoompan=z='1.12':d=${quadros}:x='(iw-iw/zoom)*on/${quadros}':y='ih/2-(ih/zoom/2)'`],
    ['pan_left', quadros => `zoompan=z='1.12':d=${quadros}:x='(iw-iw/zoom)*(1-on/${quadros})':y='ih/2-(ih/zoom/2)'`],
    ['zoom_out', quadros => `zoompan=z='max(1.20-0.20*on/${quadros},1.0)':d=${quadros}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`],
    ['orbit', quadros => `zoompan=z='1.15+0.05*sin(on/20)':d=${quadros}:x='(iw-iw/zoom)/2+sin(on/25)*30':y='(ih-ih/zoom)/2+cos(on/25)*20'`]
]);
const MOTORES_ESCOLHIDOS = new Map([['fal', '_gerarComFal'], ['system', '_gerarComIaDoSistema']]);

function esperarAProximaConsulta() {
    return new Promise(r => setTimeout(r, ESPERA_ENTRE_CONSULTAS_MS));
}

function raizesDoFfmpeg() {
    const raizes = [];
    if (process.resourcesPath) raizes.push(path.join(process.resourcesPath, 'bin'));
    raizes.push(path.join(process.cwd(), 'resources', 'bin'));
    raizes.push(path.join(__dirname, '..', '..', '..', 'bin'));
    raizes.push(path.join(__dirname, '..', '..', 'resources', 'bin'));
    return raizes;
}

function localizarFfmpeg() {
    const nome = toolPaths.exe('ffmpeg');
    const empacotado = raizesDoFfmpeg().map(raiz => path.join(raiz, nome)).find(candidato => fs.existsSync(candidato));
    return empacotado || 'ffmpeg';
}

function criarPasta(pasta) {
    try {
        fs.mkdirSync(pasta, { recursive: true });
        return true;
    } catch (e) {
        return false;
    }
}

function tamanhoDoArquivo(caminho) {
    return fs.existsSync(caminho) ? fs.statSync(caminho).size : 0;
}

function exigirVideoGravado(caminho, mensagem) {
    if (tamanhoDoArquivo(caminho) < TAMANHO_MINIMO_DO_VIDEO) throw new Error(mensagem);
}

function tipoDaImagem(caminho) {
    return TIPO_POR_EXTENSAO.get(path.extname(caminho).toLowerCase()) || 'image/jpeg';
}

function imagemEmDataUri(caminho) {
    return `data:${tipoDaImagem(caminho)};base64,${fs.readFileSync(caminho).toString('base64')}`;
}

function textoDoPrompt(prompt, padrao) {
    return (prompt && String(prompt).trim()) || padrao;
}

function mensagemDoErro(erro) {
    return String(erro && erro.message || erro);
}

function resumoDoErro(erro, limite, semErro) {
    return erro ? String(erro.message || erro).slice(0, limite) : semErro;
}

async function primeiroModeloQueAceita(modelos, recusa, enviar) {
    let ultimoErro = null;
    for (const modelo of modelos) {
        try {
            await enviar(modelo);
            return { aceito: true, ultimoErro };
        } catch (e) {
            ultimoErro = e;
            if (!recusa.indisponivel.test(mensagemDoErro(e))) throw new Error(recusa.prefixo + mensagemDoErro(e));
        }
    }
    return { aceito: false, ultimoErro };
}

function lerPedido({
    imagePath,
    imageBase64,
    engine = '',
    prompt = PROMPT_PADRAO,
    duration = 5,
    aspectRatio = '16:9',
    motionPreset = 'zoom',
    apiKey = '',
    onProgress = () => {}
}) {
    return { imagePath, imageBase64, engine, prompt, duration, aspectRatio, motionPreset, apiKey, onProgress };
}

function duracaoOuCinco(duration) {
    return Number(duration) || 5;
}

function concluir(pedido) {
    pedido.onProgress({ step: 'complete', percent: 100, message: 'Geração de vídeo concluída!' });
}

function resultadoDoVideo(pedido, { duration, engine }) {
    return {
        success: true,
        videoPath: pedido.outFilePath,
        fileName: pedido.outFileName,
        sizeBytes: tamanhoDoArquivo(pedido.outFilePath),
        duration,
        engine,
        aspectRatio: pedido.aspectRatio
    };
}

function imagemExiste(caminho) {
    return Boolean(caminho) && fs.existsSync(caminho);
}

function apagarImagemTemporaria(imagem) {
    if (!imagem.temporaria || !fs.existsSync(imagem.caminho)) return;
    try { fs.unlinkSync(imagem.caminho); } catch (e) {}
}

function temChaveDaKling(apiKey) {
    return Boolean(apiKey) && apiKey.trim().length > 10;
}

function rotuloDoMotorLocal(pedido) {
    return pedido.apiKey ? 'Nova Motion Engine (Cloud fallback)' : 'Nova Motion Engine';
}

function cabecalhosDoFal(chave) {
    return { Authorization: `Key ${chave}`, 'Content-Type': 'application/json' };
}

function duracaoDoFal(duration) {
    return Number(duration) >= 10 ? '10' : '5';
}

function urlDoObjetoDeVideo(video) {
    return video && (video.url || video.file_url);
}

function primeiraUrl(videos) {
    return videos && videos[0] && videos[0].url;
}

function urlDoVideoFal(resposta) {
    return urlDoObjetoDeVideo(resposta.video) || resposta.video_url || primeiraUrl(resposta.videos);
}

function podeGerarComIa(app) {
    return Boolean(app) && typeof app.getGeminiToken === 'function';
}

function carregarSdkDoGoogle() {
    try {
        return require('@google/genai').GoogleGenAI;
    } catch (e) {
        throw new Error('SDK da IA do Nova não encontrado no app.');
    }
}

function geraVideo(ai) {
    return Boolean(ai.models) && typeof ai.models.generateVideos === 'function';
}

function criarClienteDoVeo(token) {
    const GoogleGenAI = carregarSdkDoGoogle();
    const ai = new GoogleGenAI({ apiKey: token });
    if (!geraVideo(ai)) throw new Error('Este app não tem suporte a geração de vídeo (Veo).');
    return ai;
}

function ehModeloDeVideo(modelo) {
    return /veo/i.test(modelo.name || '') && (modelo.supportedGenerationMethods || []).includes('predictLongRunning');
}

function nomeCurtoDoModelo(modelo) {
    return String(modelo.name).replace(/^models\//, '');
}

function temConsultaDeOperacoes(ai) {
    return Boolean(ai.operations) && typeof ai.operations.getVideosOperation === 'function';
}

function consultarOperacao(ai, operacao) {
    const origem = temConsultaDeOperacoes(ai) ? ai.operations : ai.models;
    return origem.getVideosOperation({ operation: operacao });
}

function videoDaOperacao(operacao) {
    const videos = operacao.response && operacao.response.generatedVideos;
    return videos && videos[0] && videos[0].video;
}

function temVideoEmbutido(video) {
    return Boolean(video.inlineData) && Boolean(video.inlineData.data);
}

function urlComChave(uri, token) {
    return `${uri}${uri.includes('?') ? '&' : '?'}key=${encodeURIComponent(token)}`;
}

function pedidoParaOVeo(veo, model) {
    return {
        model,
        prompt: textoDoPrompt(veo.pedido.prompt, PROMPT_PADRAO_DO_VEO),
        image: { imageBytes: veo.imageBytes, mimeType: veo.mimeType },
        config: { aspectRatio: veo.aspectRatio, durationSeconds: veo.durationSeconds, personGeneration: 'allow_all' }
    };
}

function corpoDaKling(pedido, dataUri) {
    return JSON.stringify({
        model_name: 'kling-v1',
        image: dataUri,
        prompt: pedido.prompt || PROMPT_PADRAO_DA_KLING,
        duration: String(pedido.duration || 5),
        aspect_ratio: pedido.aspectRatio || '16:9',
        mode: 'std'
    });
}

function idDaTarefaDaKling(criacao) {
    if (criacao.code !== 0 || !criacao.data?.task_id) {
        throw new Error(criacao.message || 'Kling API task submission error');
    }
    return criacao.data.task_id;
}

function urlDoVideoDaKling(tarefa) {
    return tarefa.task_result?.videos?.[0]?.url;
}

function roteiroDoFfmpeg({ imagePath, outFilePath, duration, aspectRatio, motionPreset }) {
    const dur = Math.max(3, Math.min(15, duration || 5));
    const totalFrames = dur * 30;
    const tamanho = TAMANHO_POR_PROPORCAO.get(aspectRatio) || TAMANHO_PADRAO;
    const movimento = MOVIMENTOS.get(motionPreset) || ZOOM_PADRAO;
    const filtro = `${movimento(totalFrames)}:s=${tamanho}:fps=30,fade=t=in:st=0:d=0.4,fade=t=out:st=${dur - 0.4}:d=0.4,format=yuv420p`;
    return [
        '-y',
        '-i', imagePath,
        '-vf', filtro,
        '-c:v', 'libx264',
        '-t', String(dur),
        '-pix_fmt', 'yuv420p',
        '-preset', 'fast',
        '-crf', '18',
        outFilePath
    ];
}

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
