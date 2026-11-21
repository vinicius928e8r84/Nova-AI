'use strict';

const FOTO = '/fotos/foto.jpg';
const VIDEO_GRANDE = 'v'.repeat(2000);
const KLING_CRIA = 'POST api.klingai.com/v1/videos/image2video';
const KLING_TAREFA = 'GET api.klingai.com/v1/videos/image2video/t1';
const FAL_SEEDANCE = 'fal-ai/bytedance/seedance/v1/lite/image-to-video';
const FAL_WAN = 'fal-ai/wan/v2.2-a14b/image-to-video';
const FAL_KLING = 'fal-ai/kling-video/v2.1/standard/image-to-video';
const VEO_LISTA = 'GET generativelanguage.googleapis.com/v1beta/models';
const DOWNLOAD = 'GET https://cdn.exemplo/video.mp4';
const CHAVE_KLING = '  kling-falso-123  ';

function json(valor) {
  return { corpo: JSON.stringify(valor) };
}

function comFoto(palco, caminho = FOTO) {
  palco.arquivo(caminho, 'DADOS-DA-FOTO');
  return caminho;
}

function pedirComFoto(palco, extra) {
  return palco.converter({ imagePath: comFoto(palco), onProgress: palco.progresso(), ...extra });
}

function comFfmpegEmRecursos(palco) {
  palco.recursos = '/recursos';
  palco.arquivo('/recursos/bin/ffmpeg', '');
}

function klingAceita(palco, ...situacoes) {
  palco.rota(KLING_CRIA, json({ code: 0, data: { task_id: 't1' } }));
  palco.rota(KLING_TAREFA, ...situacoes.map(json));
}

function klingConclui(palco) {
  klingAceita(palco, { data: { task_status: 'succeed', task_result: { videos: [{ url: 'https://cdn.exemplo/video.mp4' }] } } });
}

function falAceita(palco, endpoint, ...situacoes) {
  palco.rota(`POST queue.fal.run/${endpoint}`, json({ request_id: 'r1' }));
  palco.rota(`GET queue.fal.run/${endpoint}/requests/r1/status`, ...situacoes.map(json));
}

function falEntrega(palco, endpoint, resultado) {
  palco.rota(`GET queue.fal.run/${endpoint}/requests/r1`, json(resultado));
}

function falCompleta(palco, resultado) {
  falAceita(palco, FAL_SEEDANCE, { status: 'COMPLETED' });
  falEntrega(palco, FAL_SEEDANCE, resultado);
}

function veoComVideo(video) {
  return { done: true, response: { generatedVideos: [{ video }] } };
}

function veoAceitaDeCara(palco, video) {
  palco.rota(VEO_LISTA, json({ models: [{ name: 'models/veo-x', supportedGenerationMethods: ['predictLongRunning'] }] }));
  palco.veo.envios.push({ operacao: veoComVideo(video) });
}

function embutido(bytes) {
  return { inlineData: { data: Buffer.alloc(bytes, 7).toString('base64') } };
}

const cenasDoMotorLocal = {
  'local: foto no disco, ffmpeg em resourcesPath e padrões': async palco => {
    comFfmpegEmRecursos(palco);
    await pedirComFoto(palco, {});
  },
  'local: ffmpeg no cwd, pan_right, 9:16 e 7,5 s': async palco => {
    palco.arquivo('/trabalho/resources/bin/ffmpeg', '');
    await pedirComFoto(palco, { motionPreset: 'pan_right', aspectRatio: '9:16', duration: 7.5 });
  },
  'local: ffmpeg na raiz/bin, pan_left, 1:1 e duração 1': async palco => {
    palco.arquivo(palco.caminho('bin', 'ffmpeg'), '');
    await pedirComFoto(palco, { motionPreset: 'pan_left', aspectRatio: '1:1', duration: 1 });
  },
  'local: ffmpeg em app/resources/bin, zoom_out, 4:3 e duração 20': async palco => {
    palco.arquivo(palco.caminho('app', 'resources', 'bin', 'ffmpeg'), '');
    await pedirComFoto(palco, { motionPreset: 'zoom_out', aspectRatio: '4:3', duration: 20 });
  },
  'local: sem ffmpeg empacotado, orbit e duração em texto': async palco => {
    await pedirComFoto(palco, { motionPreset: 'orbit', duration: '10' });
  },
  'local: preset desconhecido, duração 0 e duração inválida': async palco => {
    await pedirComFoto(palco, { motionPreset: 'tremer', duration: 0 });
    await pedirComFoto(palco, { motionPreset: 'constructor', duration: 'abc', aspectRatio: 'constructor' });
  },
  'local: ffmpeg falha e a foto temporária é apagada': async palco => {
    palco.ffmpeg = { erro: 'saiu com 1' };
    await palco.converter({ imageBase64: 'data:image/png;base64,QUJD', onProgress: palco.progresso() });
  },
  'local: vídeo não gravado devolve tamanho 0': async palco => {
    palco.ffmpeg = { bytes: null };
    await pedirComFoto(palco, {});
  },
};

const cenasDaPastaEDaFoto = {
  'pasta: a do app travada usa youtube_auto do cwd': async palco => {
    palco.disco.pastasTravadas.add(palco.caminho('app', 'youtube_auto', 'exports'));
    palco.pasta('/trabalho/youtube_auto/exports');
    await pedirComFoto(palco, {});
  },
  'pasta: cai para Downloads': async palco => {
    palco.disco.pastasTravadas.add(palco.caminho('app', 'youtube_auto', 'exports'));
    await pedirComFoto(palco, {});
  },
  'pasta: Downloads também travada': async palco => {
    palco.disco.pastasTravadas.add(palco.caminho('app', 'youtube_auto', 'exports'));
    palco.disco.pastasTravadas.add('/casa/downloads/Nova_AI_Videos');
    await pedirComFoto(palco, {});
  },
  'foto: base64 sem prefixo e imagePath inexistente': async palco => {
    await palco.converter({ imagePath: '/sumiu.png', imageBase64: 'REVG', onProgress: palco.progresso() });
  },
  'foto: base64 com prefixo jpeg': async palco => {
    await palco.converter({ imagePath: '', imageBase64: 'data:image/jpeg;base64,R0hJ', onProgress: palco.progresso() });
  },
  'foto: nada fornecido': async palco => {
    await palco.converter({ imagePath: '/sumiu.png', onProgress: palco.progresso() });
  },
  'foto: apagar a temporária falha em silêncio': async palco => {
    palco.disco.apagarFalha = true;
    await palco.converter({ imageBase64: 'SktM', onProgress: palco.progresso() });
  },
  'sem argumento': async palco => {
    await palco.converter();
  },
  'sem onProgress': async palco => {
    await palco.converter({ imagePath: comFoto(palco) });
  },
};

const cenasDaKlingCloud = {
  'kling: chave curta usa o motor local com rótulo de fallback': async palco => {
    await pedirComFoto(palco, { apiKey: ' curta ' });
  },
  'kling: chave com espaços, consultas e sucesso': async palco => {
    klingAceita(palco, { data: { task_status: 'processing' } }, {},
      { data: { task_status: 'succeed', task_result: { videos: [{ url: 'https://cdn.exemplo/video.mp4' }] } } });
    palco.rota(DOWNLOAD, { corpo: VIDEO_GRANDE });
    await pedirComFoto(palco, { apiKey: CHAVE_KLING, prompt: '', aspectRatio: '', duration: 0 });
  },
  'kling: foto png com prompt próprio': async palco => {
    klingConclui(palco);
    palco.rota(DOWNLOAD, { corpo: 'abc' });
    await palco.converter({ imagePath: comFoto(palco, '/fotos/a.PNG'), apiKey: CHAVE_KLING, prompt: 'voa', duration: 10, aspectRatio: '9:16', onProgress: palco.progresso() });
  },
  'kling: foto webp': async palco => {
    klingConclui(palco);
    palco.rota(DOWNLOAD, { corpo: 'abc' });
    await palco.converter({ imagePath: comFoto(palco, '/fotos/a.webp'), apiKey: CHAVE_KLING, onProgress: palco.progresso() });
  },
  'kling: criação recusada com mensagem': async palco => {
    palco.rota(KLING_CRIA, json({ code: 1, message: 'saldo insuficiente' }));
    await pedirComFoto(palco, { apiKey: CHAVE_KLING });
  },
  'kling: criação sem task_id e sem mensagem': async palco => {
    palco.rota(KLING_CRIA, json({ code: 0, data: {} }));
    await pedirComFoto(palco, { apiKey: CHAVE_KLING });
  },
  'kling: criação sem data': async palco => {
    palco.rota(KLING_CRIA, json({ code: 0 }));
    await pedirComFoto(palco, { apiKey: CHAVE_KLING });
  },
  'kling: tarefa falha com mensagem': async palco => {
    klingAceita(palco, { data: { task_status: 'failed', task_status_msg: 'conteúdo recusado' } });
    await pedirComFoto(palco, { apiKey: CHAVE_KLING });
  },
  'kling: tarefa falha sem mensagem': async palco => {
    klingAceita(palco, { data: { task_status: 'failed' } });
    await pedirComFoto(palco, { apiKey: CHAVE_KLING });
  },
  'kling: sucesso sem url': async palco => {
    klingAceita(palco, { data: { task_status: 'succeed', task_result: { videos: [] } } });
    await pedirComFoto(palco, { apiKey: CHAVE_KLING });
  },
  'kling: sucesso sem task_result': async palco => {
    klingAceita(palco, { data: { task_status: 'succeed' } });
    await pedirComFoto(palco, { apiKey: CHAVE_KLING });
  },
  'kling: tempo esgotado depois de 30 consultas': async palco => {
    klingAceita(palco, { data: { task_status: 'processing' } });
    await pedirComFoto(palco, { apiKey: CHAVE_KLING });
  },
  'kling: download redireciona para http e falha': async palco => {
    klingConclui(palco);
    palco.rota(DOWNLOAD, { status: 302, location: 'http://espelho.exemplo/v.mp4' });
    palco.rota('GET http://espelho.exemplo/v.mp4', { erro: 'ECONNREFUSED' });
    await pedirComFoto(palco, { apiKey: CHAVE_KLING });
  },
  'kling: download 301 sem location grava o corpo': async palco => {
    klingConclui(palco);
    palco.rota(DOWNLOAD, { status: 301, corpo: 'corpo' });
    await pedirComFoto(palco, { apiKey: CHAVE_KLING });
  },
  'kling: download 400 com location grava o corpo': async palco => {
    klingConclui(palco);
    palco.rota(DOWNLOAD, { status: 400, location: 'https://outro', corpo: 'erro' });
    await pedirComFoto(palco, { apiKey: CHAVE_KLING });
  },
  'kling: erro de rede na criação': async palco => {
    palco.rota(KLING_CRIA, { erro: 'ECONNRESET' });
    await pedirComFoto(palco, { apiKey: CHAVE_KLING });
  },
  'kling: chave que não é texto': async palco => {
    await pedirComFoto(palco, { apiKey: 12345678901 });
  },
};

const cenasDoFal = {
  'fal: sem item no Chaveiro': async palco => {
    palco.chaveFal = null;
    await palco.converter({ engine: 'fal', imageBase64: 'TU5P', onProgress: palco.progresso() });
  },
  'fal: item vazio no Chaveiro': async palco => {
    palco.chaveFal = '  \n';
    await pedirComFoto(palco, { engine: 'fal' });
  },
  'fal: primeiro modelo aceita e a fila conclui': async palco => {
    falAceita(palco, FAL_SEEDANCE, { status: 'IN_QUEUE' }, {}, { status: 'COMPLETED' });
    falEntrega(palco, FAL_SEEDANCE, { video: { url: 'https://cdn.exemplo/video.mp4' } });
    palco.rota(DOWNLOAD, { corpo: VIDEO_GRANDE });
    await palco.converter({ engine: 'fal', imagePath: comFoto(palco, '/fotos/a.png'), prompt: '  Mexa o cabelo  ', onProgress: palco.progresso() });
  },
  'fal: 404 e 422 pulam para o terceiro modelo': async palco => {
    palco.rota(`POST queue.fal.run/${FAL_SEEDANCE}`, json({ detail: 'Erro 404' }));
    palco.rota(`POST queue.fal.run/${FAL_WAN}`, json({ detail: 'HTTP 422' }));
    falAceita(palco, FAL_KLING, { status: 'COMPLETED' });
    falEntrega(palco, FAL_KLING, { video: { file_url: 'https://cdn.exemplo/video.mp4' } });
    palco.rota(DOWNLOAD, { corpo: VIDEO_GRANDE });
    await palco.converter({ engine: 'fal', imagePath: comFoto(palco, '/fotos/a.webp'), duration: 12, onProgress: palco.progresso() });
  },
  'fal: 400 e 429 também pulam, e recusa todos': async palco => {
    palco.rota(`POST queue.fal.run/${FAL_SEEDANCE}`, json({ detail: 'status 400' }));
    palco.rota(`POST queue.fal.run/${FAL_WAN}`, json({ detail: 'status 429' }));
    palco.rota(`POST queue.fal.run/${FAL_KLING}`, json({ detail: 'Model Not Found' }));
    await pedirComFoto(palco, { engine: 'fal' });
  },
  'fal: unsupported e invalid pulam, detalhe longo é cortado': async palco => {
    palco.rota(`POST queue.fal.run/${FAL_SEEDANCE}`, json({ detail: 'Unsupported' }));
    palco.rota(`POST queue.fal.run/${FAL_WAN}`, json({ detail: 'invalid' }));
    palco.rota(`POST queue.fal.run/${FAL_KLING}`, json({ detail: `invalid ${'x'.repeat(400)}` }));
    await pedirComFoto(palco, { engine: 'fal' });
  },
  'fal: resposta sem request_id nem detail': async palco => {
    palco.rota(`POST queue.fal.run/${FAL_SEEDANCE}`, json({ outro: 'campo'.repeat(60) }));
    await pedirComFoto(palco, { engine: 'fal' });
  },
  'fal: erro que não é de modelo': async palco => {
    palco.rota(`POST queue.fal.run/${FAL_SEEDANCE}`, json({ detail: 'cota estourada' }));
    await pedirComFoto(palco, { engine: 'fal' });
  },
  'fal: erro de rede': async palco => {
    palco.rota(`POST queue.fal.run/${FAL_SEEDANCE}`, { erro: 'ECONNRESET' });
    await pedirComFoto(palco, { engine: 'fal' });
  },
  'fal: geração FAILED': async palco => {
    falAceita(palco, FAL_SEEDANCE, { status: 'IN_PROGRESS' }, { status: 'FAILED', motivo: 'm'.repeat(300) });
    await pedirComFoto(palco, { engine: 'fal' });
  },
  'fal: geração ERROR': async palco => {
    falAceita(palco, FAL_SEEDANCE, { status: 'ERROR' });
    await pedirComFoto(palco, { engine: 'fal' });
  },
  'fal: fila não conclui em 150 consultas e busca o resultado mesmo assim': async palco => {
    falAceita(palco, FAL_SEEDANCE, { status: 'IN_QUEUE' });
    falEntrega(palco, FAL_SEEDANCE, { video_url: 'https://cdn.exemplo/video.mp4' });
    palco.rota(DOWNLOAD, { corpo: VIDEO_GRANDE });
    await pedirComFoto(palco, { engine: 'fal', duration: 'xyz' });
  },
  'fal: resultado em videos[0]': async palco => {
    falCompleta(palco, { video: {}, videos: [{ url: 'https://cdn.exemplo/video.mp4' }] });
    palco.rota(DOWNLOAD, { corpo: VIDEO_GRANDE });
    await palco.converter({ engine: 'fal', imagePath: comFoto(palco, '/fotos/a.JPEG'), prompt: null, onProgress: palco.progresso() });
  },
  'fal: resultado sem vídeo': async palco => {
    falCompleta(palco, { videos: [] });
    await pedirComFoto(palco, { engine: 'fal' });
  },
  'fal: vídeo vazio': async palco => {
    falCompleta(palco, { video: { url: 'https://cdn.exemplo/video.mp4' } });
    palco.rota(DOWNLOAD, { corpo: 'pequeno' });
    await pedirComFoto(palco, { engine: 'fal' });
  },
};

const cenasDoVeo = {
  'veo: app sem getGeminiToken': async palco => {
    palco.app = { getPath: nome => `/casa/${nome}` };
    await pedirComFoto(palco, { engine: 'system' });
  },
  'veo: app nulo': async palco => {
    palco.app = null;
    await pedirComFoto(palco, { engine: 'system' });
  },
  'veo: sem token': async palco => {
    palco.token = '';
    await pedirComFoto(palco, { engine: 'system' });
  },
  'veo: sem SDK': async palco => {
    palco.veo.semSdk = true;
    await pedirComFoto(palco, { engine: 'system' });
  },
  'veo: SDK sem models': async palco => {
    palco.veo.semModelos = true;
    await pedirComFoto(palco, { engine: 'system' });
  },
  'veo: models sem generateVideos': async palco => {
    palco.veo.semGerar = true;
    await pedirComFoto(palco, { engine: 'system' });
  },
  'veo: lista da chave, consultas por operations e vídeo embutido': async palco => {
    palco.rota(VEO_LISTA, json({ models: [
      { name: 'models/veo-3-teste', supportedGenerationMethods: ['predictLongRunning'] },
      { name: 'models/gemini-2', supportedGenerationMethods: ['predictLongRunning'] },
      { name: 'models/VEO-antigo', supportedGenerationMethods: ['generateContent'] },
      { supportedGenerationMethods: ['predictLongRunning'] },
      { name: 'models/veo-sem-metodos' },
    ] }));
    palco.veo.envios.push({ operacao: { done: false, name: 'op1' } });
    palco.veo.consultas.push({ done: false, name: 'op1' }, veoComVideo(embutido(1200)));
    await pedirComFoto(palco, { engine: 'system', prompt: '', duration: 12 });
  },
  'veo: lista falha, modelos fixos, 404 pula e consultas por models': async palco => {
    palco.rota(VEO_LISTA, { erro: 'ENOTFOUND' });
    palco.veo.semOperacoes = true;
    palco.veo.envios.push({ erro: new Error('models/veo-3 is not found') }, { erro: '404' }, { operacao: { done: false } });
    palco.veo.consultas.push(veoComVideo({ uri: 'https://cdn.exemplo/video.mp4' }));
    palco.rota(DOWNLOAD, { corpo: VIDEO_GRANDE });
    await pedirComFoto(palco, { engine: 'system', aspectRatio: '1:1', prompt: '  dance  ' });
  },
  'veo: uri com consulta usa &key': async palco => {
    veoAceitaDeCara(palco, { uri: 'https://cdn.exemplo/video.mp4?alt=media' });
    palco.rota(DOWNLOAD, { corpo: VIDEO_GRANDE });
    await pedirComFoto(palco, { engine: 'system', aspectRatio: '9:16' });
  },
  'veo: lista sem veo e todos NOT_FOUND': async palco => {
    palco.rota(VEO_LISTA, json({ models: [{ name: 'models/gemini' }] }));
    for (let i = 0; i < 5; i++) palco.veo.envios.push({ erro: new Error(`NOT_FOUND ${i} ${'y'.repeat(300)}`) });
    await pedirComFoto(palco, { engine: 'system' });
  },
  'veo: lista sem campo models e erro de outro tipo': async palco => {
    palco.rota(VEO_LISTA, json({}));
    palco.veo.envios.push({ erro: new Error('PERMISSION_DENIED') });
    await pedirComFoto(palco, { engine: 'system' });
  },
  'veo: lista com models que não é lista': async palco => {
    palco.rota(VEO_LISTA, json({ models: { name: 'veo' } }));
    palco.veo.envios.push({ erro: 'quebrou' });
    await pedirComFoto(palco, { engine: 'system' });
  },
  'veo: geração devolve nada': async palco => {
    palco.rota(VEO_LISTA, json({ models: [] }));
    palco.veo.envios.push({ operacao: null });
    await pedirComFoto(palco, { engine: 'system' });
  },
  'veo: tempo esgotado depois de 90 consultas': async palco => {
    palco.rota(VEO_LISTA, json({ models: [] }));
    palco.veo.envios.push({ operacao: { done: false } });
    palco.veo.consultas.push({ done: false });
    await pedirComFoto(palco, { engine: 'system' });
  },
  'veo: resposta sem vídeo': async palco => {
    palco.rota(VEO_LISTA, json({ models: [] }));
    palco.veo.envios.push({ operacao: { done: true, response: { generatedVideos: [{}] } } });
    await pedirComFoto(palco, { engine: 'system' });
  },
  'veo: resposta sem generatedVideos': async palco => {
    palco.rota(VEO_LISTA, json({ models: [] }));
    palco.veo.envios.push({ operacao: { done: true, response: {} } });
    await pedirComFoto(palco, { engine: 'system' });
  },
  'veo: vídeo sem dados': async palco => {
    veoAceitaDeCara(palco, { inlineData: {} });
    await pedirComFoto(palco, { engine: 'system' });
  },
  'veo: vídeo embutido vazio': async palco => {
    veoAceitaDeCara(palco, embutido(10));
    await pedirComFoto(palco, { engine: 'system' });
  },
};

const cenas = { ...cenasDoMotorLocal, ...cenasDaPastaEDaFoto, ...cenasDaKlingCloud, ...cenasDoFal, ...cenasDoVeo };

module.exports = { cenas };
