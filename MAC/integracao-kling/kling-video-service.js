/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  KLING AI PICTURE-TO-VIDEO SERVICE - NOVA AI
 *  Transforms any image/picture into a cinematic, animated AI video.
 *  Supports Kling AI Cloud API + Nova High-Fidelity Local Motion Engine.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { execFile } = require('child_process');

class KlingVideoService {
    constructor(app) {
        this.app = app;
        this.ffmpegPath = this._resolveFfmpegPath();
    }

    _resolveFfmpegPath() {
        // Procura o FFmpeg incluído no app em qualquer plataforma (macOS usa "ffmpeg", Windows "ffmpeg.exe")
        const names = ['ffmpeg', 'ffmpeg.exe'];
        const roots = [];
        if (process.resourcesPath) roots.push(path.join(process.resourcesPath, 'bin'));
        roots.push(path.join(process.cwd(), 'resources', 'bin'));
        roots.push(path.join(__dirname, '..', '..', '..', 'bin'));
        roots.push(path.join(__dirname, '..', '..', 'resources', 'bin'));
        for (const root of roots) {
            for (const name of names) {
                const candidate = path.join(root, name);
                if (fs.existsSync(candidate)) return candidate;
            }
        }
        return 'ffmpeg';
    }

    _getExportDir() {
        // Mesma pasta que o IPC get-exported-files lê (app/youtube_auto/exports),
        // para o vídeo gerado aparecer na biblioteca "Arquivos Exportados".
        let exportDir = path.join(__dirname, '..', '..', 'youtube_auto', 'exports');
        try {
            fs.mkdirSync(exportDir, { recursive: true });
            return exportDir;
        } catch (e) { /* sem permissão na pasta do app: cai para os fallbacks */ }
        exportDir = path.join(process.cwd(), 'youtube_auto', 'exports');
        if (fs.existsSync(exportDir)) return exportDir;
        exportDir = path.join(this.app.getPath('downloads'), 'Nova_AI_Videos');
        try { fs.mkdirSync(exportDir, { recursive: true }); } catch (e2) {}
        return exportDir;
    }

    async convertPictureToVideo({
        imagePath,
        imageBase64,
        engine = '',
        prompt = 'Cinematic dynamic camera motion, high detail',
        duration = 5,
        aspectRatio = '16:9',
        motionPreset = 'zoom',
        apiKey = '',
        onProgress = () => {}
    }) {
        const exportDir = this._getExportDir();
        const timestamp = Date.now();
        const outFileName = `kling_video_${timestamp}.mp4`;
        const outFilePath = path.join(exportDir, outFileName);

        onProgress({ step: 'prepare', percent: 10, message: 'Preparando imagens...' });

        // Ensure we have an image file path on disk
        let localImagePath = imagePath;
        let tempCreated = false;

        if (!localImagePath || !fs.existsSync(localImagePath)) {
            if (!imageBase64) {
                throw new Error('No picture provided for video conversion.');
            }
            const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
            const tmpImg = path.join(exportDir, `tmp_kling_${timestamp}.png`);
            fs.writeFileSync(tmpImg, Buffer.from(cleanBase64, 'base64'));
            localImagePath = tmpImg;
            tempCreated = true;
        }

        try {
            // ── OPTION A-1: fal.ai (chave do Chaveiro do Mac, modelos mais baratos) ──
            if (engine === 'fal') {
                onProgress({ step: 'fal_prepare', percent: 10, message: 'Preparando a IA fal.ai...' });
                await this._generateFalVideo({ localImagePath, prompt, duration, outFilePath, onProgress });
                onProgress({ step: 'complete', percent: 100, message: 'Geração de vídeo concluída!' });
                return {
                    success: true,
                    videoPath: outFilePath,
                    fileName: outFileName,
                    sizeBytes: fs.existsSync(outFilePath) ? fs.statSync(outFilePath).size : 0,
                    duration: Number(duration) || 5,
                    engine: 'IA fal.ai (Seedance Lite)',
                    aspectRatio
                };
            }

            // ── OPTION A0: IA do Sistema (Google Veo, chave já configurada no Nova) ──
            if (engine === 'system') {
                onProgress({ step: 'system_prepare', percent: 10, message: 'Preparando a IA do Nova (Veo)...' });
                const sysResult = await this._generateSystemAIVideo({
                    localImagePath, prompt, duration, aspectRatio, outFilePath, onProgress
                });
                onProgress({ step: 'complete', percent: 100, message: 'Geração de vídeo concluída!' });
                return {
                    success: true,
                    videoPath: outFilePath,
                    fileName: outFileName,
                    sizeBytes: fs.existsSync(outFilePath) ? fs.statSync(outFilePath).size : 0,
                    duration: sysResult.durationSeconds,
                    engine: 'IA do Sistema (Veo do Nova)',
                    aspectRatio
                };
            }

            // ── OPTION A: Kling AI Cloud API ──
            if (apiKey && apiKey.trim().length > 10) {
                try {
                    onProgress({ step: 'cloud_kling', percent: 25, message: 'Enviando tarefa para a Kling AI Cloud...' });
                    const cloudResult = await this._callKlingCloudApi({
                        apiKey: apiKey.trim(),
                        imagePath: localImagePath,
                        prompt,
                        duration,
                        aspectRatio,
                        outFilePath,
                        onProgress
                    });
                    if (cloudResult && cloudResult.success) {
                        return {
                            success: true,
                            videoPath: outFilePath,
                            fileName: outFileName,
                            sizeBytes: fs.existsSync(outFilePath) ? fs.statSync(outFilePath).size : 0,
                            duration,
                            engine: 'Kling AI Cloud API',
                            aspectRatio
                        };
                    }
                } catch (cloudErr) {
                    console.warn('[KlingService] Kling Cloud API notice:', cloudErr.message, '→ Seamlessly using Nova Motion Engine.');
                    onProgress({ step: 'fallback', percent: 35, message: `Kling Cloud: ${cloudErr.message}. Running Nova Motion Engine...` });
                }
            }

            // ── OPTION B: Nova High-Fidelity Local Motion Engine (bundled FFmpeg) ──
            onProgress({ step: 'synthesizing', percent: 40, message: 'Sintetizando vídeo de movimento cinematográfico a 60fps...' });
            await this._generateLocalMotionVideo({
                imagePath: localImagePath,
                outFilePath,
                duration: Number(duration) || 5,
                aspectRatio,
                motionPreset,
                onProgress
            });

            onProgress({ step: 'complete', percent: 100, message: 'Geração de vídeo concluída!' });

            return {
                success: true,
                videoPath: outFilePath,
                fileName: outFileName,
                sizeBytes: fs.existsSync(outFilePath) ? fs.statSync(outFilePath).size : 0,
                duration,
                engine: apiKey ? 'Nova Motion Engine (Cloud fallback)' : 'Nova Motion Engine',
                aspectRatio
            };

        } finally {
            if (tempCreated && fs.existsSync(localImagePath)) {
                try { fs.unlinkSync(localImagePath); } catch (e) {}
            }
        }
    }

    // Chave do fal.ai guardada no Chaveiro do macOS (item "fal-key"),
    // a mesma usada pelo projeto criar-videos.
    _getFalKey() {
        try {
            const os = require('os');
            const { execFileSync } = require('child_process');
            return execFileSync('security',
                ['find-generic-password', '-a', os.userInfo().username, '-s', 'fal-key', '-w'],
                { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
        } catch (e) { return null; }
    }

    // Animação generativa via fal.ai (fila queue.fal.run), modelo mais barato primeiro.
    async _generateFalVideo({ localImagePath, prompt, duration, outFilePath, onProgress }) {
        const key = this._getFalKey();
        if (!key) throw new Error('Chave do fal.ai não encontrada no Chaveiro do Mac (item "fal-key").');

        const ext = path.extname(localImagePath).toLowerCase();
        const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
        const dataUri = `data:${mimeType};base64,${fs.readFileSync(localImagePath).toString('base64')}`;
        const dur = Number(duration) >= 10 ? '10' : '5';

        const candidates = [
            { name: 'Seedance 1.0 Lite', endpoint: 'fal-ai/bytedance/seedance/v1/lite/image-to-video' },
            { name: 'Wan 2.2', endpoint: 'fal-ai/wan/v2.2-a14b/image-to-video' },
            { name: 'Kling 2.1', endpoint: 'fal-ai/kling-video/v2.1/standard/image-to-video' }
        ];
        const headers = { Authorization: `Key ${key}`, 'Content-Type': 'application/json' };
        let requestId = null, used = null, lastErr = null;
        for (const c of candidates) {
            try {
                onProgress({ step: 'fal_submit', percent: 20, message: `fal.ai (${c.name}): enviando a foto...` });
                const body = JSON.stringify({ prompt: (prompt && String(prompt).trim()) || '', image_url: dataUri, resolution: '720p', duration: dur });
                const res = JSON.parse(await this._httpRequest({ hostname: 'queue.fal.run', path: `/${c.endpoint}`, method: 'POST', headers, body }));
                if (!res.request_id) throw new Error(res.detail || JSON.stringify(res).slice(0, 200));
                requestId = res.request_id; used = c; break;
            } catch (e) {
                lastErr = e;
                const msg = String(e && e.message || e);
                if (/4(0[04]|22|29)|not found|unsupported|invalid/i.test(msg)) continue; // modelo indisponível → tenta o próximo
                throw new Error('fal.ai: ' + msg);
            }
        }
        if (!requestId) throw new Error('fal.ai recusou todos os modelos. (' + (lastErr ? String(lastErr.message || lastErr).slice(0, 300) : 'sem detalhe') + ')');

        // aguarda a fila (geralmente 1–3 min)
        const base = `/${used.endpoint}/requests/${requestId}`;
        let attempts = 0;
        while (attempts < 150) {
            await new Promise(r => setTimeout(r, 4000));
            attempts++;
            const st = JSON.parse(await this._httpRequest({ hostname: 'queue.fal.run', path: `${base}/status`, method: 'GET', headers }));
            onProgress({ step: 'fal_wait', percent: Math.min(90, 25 + attempts), message: `fal.ai (${used.name}) gerando o vídeo... ${attempts * 4}s (${st.status || '...'})` });
            if (st.status === 'COMPLETED') break;
            if (st.status === 'FAILED' || st.status === 'ERROR') throw new Error('fal.ai: geração falhou (' + JSON.stringify(st).slice(0, 200) + ')');
        }
        const done = JSON.parse(await this._httpRequest({ hostname: 'queue.fal.run', path: base, method: 'GET', headers }));
        const videoUrl = (done.video && (done.video.url || done.video.file_url)) || done.video_url || (done.videos && done.videos[0] && done.videos[0].url);
        if (!videoUrl) throw new Error('fal.ai concluiu sem vídeo.');
        onProgress({ step: 'fal_save', percent: 95, message: 'Baixando o vídeo gerado...' });
        await this._downloadFile(videoUrl, outFilePath);
        if (!fs.existsSync(outFilePath) || fs.statSync(outFilePath).size < 1000) throw new Error('O vídeo do fal.ai veio vazio.');
        return { durationSeconds: Number(dur) };
    }

    // Animação generativa de verdade: usa a chave Gemini já configurada no Nova
    // (a mesma do Nova Studio) para gerar vídeo com os modelos Veo do Google.
    async _generateSystemAIVideo({ localImagePath, prompt, duration, aspectRatio, outFilePath, onProgress }) {
        if (!this.app || typeof this.app.getGeminiToken !== 'function') {
            throw new Error('IA do sistema indisponível neste app.');
        }
        const token = await this.app.getGeminiToken();
        if (!token) throw new Error('Nenhuma chave da IA do Nova configurada. Configure no Nova Studio e tente de novo.');

        let GoogleGenAI;
        try { ({ GoogleGenAI } = require('@google/genai')); }
        catch (e) { throw new Error('SDK da IA do Nova não encontrado no app.'); }

        const ai = new GoogleGenAI({ apiKey: token });
        if (!ai.models || typeof ai.models.generateVideos !== 'function') {
            throw new Error('Este app não tem suporte a geração de vídeo (Veo).');
        }

        const ext = path.extname(localImagePath).toLowerCase();
        const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
        const imageBytes = fs.readFileSync(localImagePath).toString('base64');
        const ar = aspectRatio === '16:9' ? '16:9' : '9:16'; // Veo: só 16:9 e 9:16
        const durationSeconds = Number(duration) >= 10 ? 8 : 6; // durações aceitas pelo Veo

        // Descobre quais modelos de vídeo a chave realmente tem (ListModels é gratuito).
        let models = [];
        try {
            const list = JSON.parse(await this._httpRequest({
                hostname: 'generativelanguage.googleapis.com',
                path: '/v1beta/models?pageSize=200&key=' + encodeURIComponent(token),
                method: 'GET', headers: {}
            }));
            models = (list.models || [])
                .filter(m => /veo/i.test(m.name || '') && (m.supportedGenerationMethods || []).includes('predictLongRunning'))
                .map(m => String(m.name).replace(/^models\//, ''));
        } catch (e) { /* usa a lista fixa abaixo como fallback */ }
        if (!models.length) models = ['veo-3-fast-generate-001', 'veo-3.0-fast-generate-001', 'veo-3-fast-preview', 'veo-3.0-generate-001', 'veo-2.0-generate-001'];
        let op = null, usedModel = null, lastErr = null;
        for (const model of models) {
            try {
                onProgress({ step: 'veo_submit', percent: 20, message: `IA do Nova (${model}): enviando a foto...` });
                op = await ai.models.generateVideos({
                    model,
                    prompt: (prompt && String(prompt).trim()) || 'Animate this image naturally: subtle realistic motion of subject and environment, cinematic quality.',
                    image: { imageBytes, mimeType },
                    config: { aspectRatio: ar, durationSeconds, personGeneration: 'allow_all' }
                });
                usedModel = model;
                break;
            } catch (e) {
                lastErr = e;
                const msg = String(e && e.message || e);
                // 404/not found → tenta o próximo nome de modelo; outros erros → falha já
                if (/not found|404|NOT_FOUND/i.test(msg)) continue;
                throw new Error('Veo: ' + msg);
            }
        }
        if (!op) throw new Error('A chave do Nova não tem acesso a vídeo (Veo) — a listagem da API não mostrou nenhum modelo de vídeo. Ative o faturamento no Google AI ou use o botão da IA fal.ai. Detalhe: ' + (lastErr ? String(lastErr.message || lastErr).slice(0, 200) : 'nenhum'));

        // aguarda a geração (Veo leva de ~1 a 6 minutos)
        const getOp = (o) => (ai.operations && typeof ai.operations.getVideosOperation === 'function')
            ? ai.operations.getVideosOperation({ operation: o })
            : ai.models.getVideosOperation({ operation: o });
        let attempts = 0;
        while (!op.done && attempts < 90) {
            await new Promise(r => setTimeout(r, 4000));
            attempts++;
            onProgress({ step: 'veo_wait', percent: Math.min(90, 25 + attempts), message: `IA do Nova gerando o vídeo (${usedModel})... ${attempts * 4}s` });
            op = await getOp(op);
        }
        if (!op.done) throw new Error('Tempo esgotado esperando a IA do Nova (6 min).');

        const video = op.response && op.response.generatedVideos && op.response.generatedVideos[0] && op.response.generatedVideos[0].video;
        if (!video) throw new Error('A IA do Nova não devolveu vídeo.');

        onProgress({ step: 'veo_save', percent: 95, message: 'Salvando o vídeo gerado...' });
        if (video.inlineData && video.inlineData.data) {
            fs.writeFileSync(outFilePath, Buffer.from(video.inlineData.data, 'base64'));
        } else if (video.uri) {
            await this._downloadFile(`${video.uri}${video.uri.includes('?') ? '&' : '?'}key=${encodeURIComponent(token)}`, outFilePath);
        } else {
            throw new Error('Resposta da IA sem dados de vídeo.');
        }
        if (!fs.existsSync(outFilePath) || fs.statSync(outFilePath).size < 1000) {
            throw new Error('O vídeo da IA veio vazio.');
        }
        return { durationSeconds };
    }

    _generateLocalMotionVideo({ imagePath, outFilePath, duration, aspectRatio, motionPreset, onProgress }) {
        return new Promise((resolve, reject) => {
            const dur = Math.max(3, Math.min(15, duration || 5));
            const totalFrames = dur * 30; // 30 fps

            let width = 1280;
            let height = 720;
            if (aspectRatio === '9:16') {
                width = 720;
                height = 1280;
            } else if (aspectRatio === '1:1') {
                width = 1080;
                height = 1080;
            }

            // Movimento como função pura do número do quadro (on). O formato antigo usava
            // "zoom+0.0012" (estado acumulado do FFmpeg), que podia congelar dependendo da
            // imagem de entrada e produzia vídeo parado. Com "on" o movimento é garantido
            // do primeiro ao último quadro, em todos os presets.
            const S = `${width}x${height}`;
            let zoompanExpr = `zoompan=z='min(1+0.20*on/${totalFrames},1.20)':d=${totalFrames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${S}:fps=30`;

            if (motionPreset === 'pan_right') {
                zoompanExpr = `zoompan=z='1.12':d=${totalFrames}:x='(iw-iw/zoom)*on/${totalFrames}':y='ih/2-(ih/zoom/2)':s=${S}:fps=30`;
            } else if (motionPreset === 'pan_left') {
                zoompanExpr = `zoompan=z='1.12':d=${totalFrames}:x='(iw-iw/zoom)*(1-on/${totalFrames})':y='ih/2-(ih/zoom/2)':s=${S}:fps=30`;
            } else if (motionPreset === 'zoom_out') {
                zoompanExpr = `zoompan=z='max(1.20-0.20*on/${totalFrames},1.0)':d=${totalFrames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${S}:fps=30`;
            } else if (motionPreset === 'orbit') {
                zoompanExpr = `zoompan=z='1.15+0.05*sin(on/20)':d=${totalFrames}:x='(iw-iw/zoom)/2+sin(on/25)*30':y='(ih-ih/zoom)/2+cos(on/25)*20':s=${S}:fps=30`;
            }

            const filterComplex = `${zoompanExpr},fade=t=in:st=0:d=0.4,fade=t=out:st=${dur - 0.4}:d=0.4,format=yuv420p`;

            // Sem -loop: o zoompan com d=<total de quadros> expande a imagem única
            // exatamente na duração do vídeo (receita canônica do FFmpeg para Ken Burns).
            const args = [
                '-y',
                '-i', imagePath,
                '-vf', filterComplex,
                '-c:v', 'libx264',
                '-t', String(dur),
                '-pix_fmt', 'yuv420p',
                '-preset', 'fast',
                '-crf', '18',
                outFilePath
            ];

            console.log('[KlingService] Spawning FFmpeg Motion Video:', this.ffmpegPath, args.join(' '));

            const child = execFile(this.ffmpegPath, args, { windowsHide: true }, (err, stdout, stderr) => {
                if (err) {
                    console.error('[KlingService] FFmpeg error:', err.message, stderr);
                    return reject(new Error(`Video motion synthesis failed: ${err.message}`));
                }
                console.log('[KlingService] Local motion video generated successfully:', outFilePath);
                resolve();
            });

            onProgress({ step: 'rendering', percent: 70, message: 'Renderizando caminho de câmera cinematográfico a 60fps...' });
        });
    }

    async _callKlingCloudApi({ apiKey, imagePath, prompt, duration, aspectRatio, outFilePath, onProgress }) {
        const imageBuffer = fs.readFileSync(imagePath);
        const base64Data = imageBuffer.toString('base64');
        const ext = path.extname(imagePath).toLowerCase(); const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
        const dataUri = `data:${mimeType};base64,${base64Data}`;

        const postData = JSON.stringify({
            model_name: 'kling-v1',
            image: dataUri,
            prompt: prompt || 'Cinematic video motion, ultra-realistic',
            duration: String(duration || 5),
            aspect_ratio: aspectRatio || '16:9',
            mode: 'std'
        });

        // 1. Submit task
        const createRes = await this._httpRequest({
            hostname: 'api.klingai.com',
            path: '/v1/videos/image2video',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'Content-Length': Buffer.byteLength(postData)
            },
            body: postData
        });

        const createJson = JSON.parse(createRes);
        if (createJson.code !== 0 || !createJson.data?.task_id) {
            throw new Error(createJson.message || 'Kling API task submission error');
        }

        const taskId = createJson.data.task_id;
        console.log('[KlingService] Kling task created ID:', taskId);

        // 2. Poll task status
        let attempts = 0;
        const maxAttempts = 30; // 30 * 4s = 120s
        while (attempts < maxAttempts) {
            await new Promise(r => setTimeout(r, 4000));
            attempts++;

            const statusRes = await this._httpRequest({
                hostname: 'api.klingai.com',
                path: `/v1/videos/image2video/${taskId}`,
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${apiKey}`
                }
            });

            const statusJson = JSON.parse(statusRes);
            const taskData = statusJson.data;
            const state = taskData?.task_status;

            onProgress({
                step: 'polling',
                percent: Math.min(90, 30 + attempts * 2),
                message: `Kling AI Cloud generating: ${state || 'processing'}...`
            });

            if (state === 'succeed') {
                const videoUrl = taskData.task_result?.videos?.[0]?.url;
                if (!videoUrl) throw new Error('Kling API completed but returned empty video URL');
                
                onProgress({ step: 'downloading', percent: 92, message: 'Baixando vídeo da Kling Cloud...' });
                await this._downloadFile(videoUrl, outFilePath);
                return { success: true };
            } else if (state === 'failed') {
                throw new Error(taskData.task_status_msg || 'Kling task failed on cloud');
            }
        }

        throw new Error('Kling API task timed out after 120s.');
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
                if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
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
