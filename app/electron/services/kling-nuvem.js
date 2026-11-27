const PROMPT_PADRAO_DA_KLING = 'Cinematic video motion, ultra-realistic';
const API_DA_KLING = 'api.klingai.com';
const TAREFAS_DA_KLING = '/v1/videos/image2video';
const CONSULTAS_DA_KLING = 30;

function temChaveDaKling(apiKey) {
    return Boolean(apiKey) && apiKey.trim().length > 10;
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

const FILA_FAL = 'queue.fal.run';
const MODELOS_FAL = [
    { name: 'Seedance 1.0 Lite', endpoint: 'fal-ai/bytedance/seedance/v1/lite/image-to-video' },
    { name: 'Wan 2.2', endpoint: 'fal-ai/wan/v2.2-a14b/image-to-video' },
    { name: 'Kling 2.1', endpoint: 'fal-ai/kling-video/v2.1/standard/image-to-video' }
];
const CONSULTAS_DA_FILA_FAL = 150;
const FAL_FALHOU = new Set(['FAILED', 'ERROR']);
const RECUSA_DO_FAL = { indisponivel: /4(0[04]|22|29)|not found|unsupported|invalid/i, prefixo: 'fal.ai: ' };

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

module.exports = { API_DA_KLING, TAREFAS_DA_KLING, CONSULTAS_DA_KLING, FILA_FAL, MODELOS_FAL, CONSULTAS_DA_FILA_FAL, FAL_FALHOU, RECUSA_DO_FAL, temChaveDaKling, corpoDaKling, idDaTarefaDaKling, urlDoVideoDaKling, cabecalhosDoFal, duracaoDoFal, urlDoVideoFal };
