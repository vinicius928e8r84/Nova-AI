const { textoDoPrompt } = require('./kling-pedido');

const PROMPT_PADRAO_DO_VEO = 'Animate this image naturally: subtle realistic motion of subject and environment, cinematic quality.';
const MODELOS_VEO_CONHECIDOS = ['veo-3-fast-generate-001', 'veo-3.0-fast-generate-001', 'veo-3-fast-preview', 'veo-3.0-generate-001', 'veo-2.0-generate-001'];
const RECUSA_DO_VEO = { indisponivel: /not found|404|NOT_FOUND/i, prefixo: 'Veo: ' };
const CONSULTAS_DO_VEO = 90;

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

module.exports = { MODELOS_VEO_CONHECIDOS, RECUSA_DO_VEO, CONSULTAS_DO_VEO, podeGerarComIa, criarClienteDoVeo, ehModeloDeVideo, nomeCurtoDoModelo, consultarOperacao, videoDaOperacao, temVideoEmbutido, urlComChave, pedidoParaOVeo };
