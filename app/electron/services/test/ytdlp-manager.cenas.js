'use strict';
const fs = require('fs');

const toolPaths = require('../tool-paths');

const YT_DLP = toolPaths.exe('yt-dlp');
const FFMPEG = toolPaths.exe('ffmpeg');

const CANDIDATOS_DO_YTDLP = [
  ['recursos', 'bin', YT_DLP],
  ['recursos', 'app.asar.unpacked', 'resources', 'bin', YT_DLP],
  ['recursos', 'app.asar.unpacked', 'node_modules', 'youtube-dl-exec', 'bin', YT_DLP],
  ['app', 'resources', 'bin', YT_DLP],
  ['app', 'node_modules', 'youtube-dl-exec', 'bin', YT_DLP],
  ['cwd', 'resources', 'bin', YT_DLP],
  ['cwd', 'dist_electron', 'win-unpacked', 'resources', 'bin', YT_DLP],
];

const PASTAS_DO_FFMPEG = [
  ['recursos', 'bin'],
  ['recursos', 'app.asar.unpacked', 'resources', 'bin'],
  ['app', 'resources', 'bin'],
  ['cwd', 'resources', 'bin'],
  ['cwd', 'dist_electron', 'win-unpacked', 'resources', 'bin'],
];

const VIDEO = { videos: [{ url: 'https://yt/v1', title: 'Um Video Com Titulo Bem Comprido Para Passar De Quarenta E Cinco' }] };
const PLAYLIST_GRANDE = { playlists: [{ url: 'https://yt/pl1', title: 'Lista Grande', videoCount: 120 }] };
const PLAYLIST_SEM_CONTAGEM = { playlists: [{ url: 'https://yt/pl2', title: 'Lista Sem Contagem' }] };

function cadaCandidato(palco, candidatos, ler) {
  for (const partes of candidatos) {
    const arquivo = palco.criarArquivo(...partes);
    palco.anotar(`achou ${ler()}`);
    fs.rmSync(arquivo);
  }
  palco.anotar(`sem nenhum ${ler()}`);
}

async function baixarManual(palco, url, formato) {
  await palco.manager.manualDownload(url, formato, 'video');
  return palco.processo();
}

const cenas = {
  async 'construtor cria a pasta Nova Downloads'(palco) {
    palco.anotar(`pasta ${palco.manager.defaultSavePath} ${fs.existsSync(palco.manager.defaultSavePath)}`);
  },

  async 'yt-dlp: ordem dos candidatos'(palco) {
    cadaCandidato(palco, CANDIDATOS_DO_YTDLP, () => palco.manager.getYtDlpPath());
    palco.manager.app = null;
    palco.criarArquivo('cwd', 'node_modules', 'youtube-dl-exec', 'bin', YT_DLP);
    palco.anotar(`sem app ${palco.manager.getYtDlpPath()}`);
  },

  async 'ffmpeg: ordem das pastas'(palco) {
    const ffmpegEm = PASTAS_DO_FFMPEG.map(pasta => [...pasta, FFMPEG]);
    cadaCandidato(palco, ffmpegEm, () => palco.manager.getFfmpegDir());
    palco.manager.app = null;
    palco.criarArquivo('cwd', 'resources', 'bin', FFMPEG);
    palco.anotar(`sem app ${palco.manager.getFfmpegDir()}`);
  },

  async 'manual: argumentos de cada formato'(palco) {
    for (const formato of ['360p', '720p', '1080p', 'mp3', 'constructor', undefined]) {
      (await baixarManual(palco, `https://yt/${formato}`, formato)).fechar(0);
    }
    palco.criarArquivo('recursos', 'bin', YT_DLP);
    palco.criarArquivo('app', 'resources', 'bin', FFMPEG);
    (await baixarManual(palco, 'https://yt/com-ffmpeg', '720p')).fechar(0);
  },

  async 'manual: leitura do progresso'(palco) {
    const processo = await baixarManual(palco, 'https://yt/m', '360p');
    processo.escrever('[download]  12.5% of 10.00MiB at 1.20MiB/s ETA 00:07\n');
    processo.escrever('[download] Destination: /x/y/Song Name.mp4\n');
    processo.escrever('[download] Destination: /x/y/Song.mp4\n[download]   3.0% of 5.00MiB at 2.00KiB/s ETA 00:02\n');
    processo.escrever('frag 45% done\n');
    processo.escrever('[DOWNLOAD] 50.0% OF 3.00MIB AT 1.00KIB/S eta 01:01\n');
    processo.escrever('[download] /x/a.mp3 has already been downloaded\n');
    processo.escrever('Already Been Downloaded\n');
    processo.escrever('[download] Destination:  \nalready been downloaded\n');
    processo.escrever('linha qualquer\n');
    processo.fechar(0);
  },

  async 'manual: erro de saída filtra WARNING'(palco) {
    const processo = await baixarManual(palco, 'https://yt/e', 'mp3');
    processo.escreverErro('WARNING: primeiro aviso');
    processo.escreverErro('ERROR: problema real\nWARNING: aviso no meio');
    processo.escreverErro('ERROR: problema final');
    processo.escreverErro('WARNING: ultimo aviso');
    processo.fechar(1);
  },

  async 'manual: código diferente de zero sem stderr'(palco) {
    (await baixarManual(palco, 'https://yt/a', 'mp3')).fechar(2);
    const soAvisos = await baixarManual(palco, 'https://yt/b', 'mp3');
    soAvisos.escreverErro('WARNING: so aviso');
    soAvisos.fechar(null);
    const espacos = await baixarManual(palco, 'https://yt/c', 'mp3');
    espacos.escreverErro('   ');
    espacos.fechar(3);
  },

  async 'manual: erro ao iniciar o processo'(palco) {
    (await baixarManual(palco, 'https://yt/x', '1080p')).falhar('spawn ENOENT');
    palco.anotar(`ativo ${palco.manager.activeProcess}`);
  },

  async 'manual: novo download mata o anterior, mesmo se kill falha'(palco) {
    const primeiro = await baixarManual(palco, 'https://yt/1', 'mp3');
    palco.killFalha = true;
    const segundo = await baixarManual(palco, 'https://yt/2', 'mp3');
    await baixarManual(palco, 'https://yt/3', 'mp3');
    primeiro.fechar(0);
    segundo.fechar(1);
    palco.anotar(`ativo ${palco.manager.activeProcess}`);
  },

  async 'manual: a pasta apagada é recriada'(palco) {
    fs.rmSync(palco.manager.defaultSavePath, { recursive: true });
    await baixarManual(palco, 'https://yt/p', 'mp3');
    palco.anotar(`pasta ${fs.existsSync(palco.manager.defaultSavePath)}`);
  },

  async 'cancelar sem e com download'(palco) {
    palco.anotar(`cancelou ${palco.manager.cancelManualDownload()}`);
    await baixarManual(palco, 'https://yt/c', 'mp3');
    palco.anotar(`cancelou ${palco.manager.cancelManualDownload()}`);
    palco.killFalha = true;
    await baixarManual(palco, 'https://yt/d', 'mp3');
    palco.anotar(`cancelou ${palco.manager.cancelManualDownload()}`);
    palco.anotar(`ativo ${palco.manager.activeProcess}`);
  },

  async 'pedido de video: busca, progresso e fim'(palco) {
    palco.resultados['musica boa'] = VIDEO;
    palco.criarArquivo('recursos', 'bin', FFMPEG);
    await palco.manager.smartDownload('musica boa', '720p', 'video', 'chat-1');
    palco.anotar(`detalhes ${JSON.stringify(palco.manager.activeDetails)}`);
    const processo = palco.processo();
    for (const chunk of ['[download]   5.0% of 3MiB at 1.5MiB/s ETA 00:02', '[download]  12.0% of 3MiB', '[download]  35.5% of 3MiB at 9KiB/s ETA 1:00:00', '[DOWNLOAD]  60.0%', '[download] 100% of 3MiB in 00:02']) {
      processo.escrever(chunk);
    }
    processo.escrever('[download] /a/b/ja tinha.mp4 has already been downloaded');
    processo.escrever('[download]  50.0% x Has Already Been Downloaded');
    processo.escrever('[download]  has already been downloaded');
    processo.escreverErro('WARNING: aviso do yt-dlp');
    processo.fechar(0);
    palco.anotar(`detalhes ${palco.manager.activeDetails} ativo ${palco.manager.activeProcess}`);
    palco.rodarTimers();
  },

  async 'pedido de playlist grande: marcos de 25, 50 e 75'(palco) {
    palco.resultados['lista boa full playlist'] = PLAYLIST_GRANDE;
    await palco.manager.smartDownload('lista boa', 'mp3', 'playlist', 'chat-2');
    const processo = palco.processo();
    for (const porcento of ['9.0', '26.0', '37.0', '52.0', '60.0', '77.0', '80.0', '99.9']) {
      processo.escrever(`[download]  ${porcento}% of 2MiB at 3MiB/s ETA 00:01`);
    }
    processo.escrever('[download] 100% of 2MiB');
    processo.escrever('[download]  30.0% of 2MiB');
    processo.escrever('[download]  100% done, 100% of 1MiB');
    processo.escrever('[download]  90.0% of 1MiB');
    processo.escrever('[download] 100%, sem tamanho');
    processo.escrever('[download]  10.0% of 1MiB');
    processo.fechar(1);
    palco.manager.activeProcess = {};
    palco.rodarTimers();
  },

  async 'pedido de playlist sem contagem'(palco) {
    palco.resultados['outra full playlist'] = PLAYLIST_SEM_CONTAGEM;
    await palco.manager.smartDownload('outra', '360p', 'playlist', 'chat-3');
    palco.processo().escrever('[download]  25.0% of 2MiB');
    palco.processo().escrever('[download]  50.0% of 2MiB');
    palco.processo().fechar(0);
  },

  async 'manual: título do destino sem os espaços das pontas'(palco) {
    const processo = await baixarManual(palco, 'https://yt/t', 'mp3');
    processo.escrever('[download] Destination: /x/y/Com Folga.mp3   \n[download]   4.0% of 1MiB\n');
    processo.fechar(0);
  },

  async 'pedido de playlist: o limite de 50 vídeos'(palco) {
    for (const total of [49, 50, 51]) {
      palco.resultados['lista de ' + total + ' full playlist'] = { playlists: [{ url: 'https://yt/pl' + total, title: 'Lista ' + total, videoCount: total }] };
      await palco.manager.smartDownload('lista de ' + total, 'mp3', 'playlist', 'chat-limite');
      palco.processo().fechar(0);
      palco.rodarTimers();
    }
  },

  async 'pedido de vídeo: porcentagens entre os passos não viram marco da playlist'(palco) {
    palco.resultados['musica curta'] = VIDEO;
    await palco.manager.smartDownload('musica curta', 'mp3', 'video', 'chat-6');
    const processo = palco.processo();
    for (const porcento of ['21.0', '26.0', '27.0']) processo.escrever(`[download]  ${porcento}% of 2MiB at 3MiB/s ETA 00:01`);
    processo.fechar(0);
    palco.rodarTimers();
  },

  async 'pedido sem resultado'(palco) {
    palco.resultados['nada full playlist'] = { playlists: [] };
    palco.resultados.nada = { videos: [] };
    palco.resultados.quebra = new Error('rede caiu');
    palco.resultados['sem playlists full playlist'] = { videos: VIDEO.videos };
    await palco.manager.smartDownload('nada', 'mp3', 'playlist', 'chat-4');
    await palco.manager.smartDownload('nada', 'mp3', 'video', 'chat-4');
    await palco.manager.smartDownload('quebra', 'mp3', 'video', 'chat-4');
    await palco.manager.smartDownload('sem playlists', 'mp3', 'playlist', 'chat-4');
    await palco.manager.smartDownload('indefinido', 'mp3', 'video', 'chat-4');
    palco.anotar(`detalhes ${palco.manager.activeDetails} processos ${palco.processos.length}`);
  },

  async 'pedido: erro ao iniciar o yt-dlp'(palco) {
    palco.resultados.falha = VIDEO;
    await palco.manager.smartDownload('falha', '1080p', 'video', 'chat-5');
    palco.processo().falhar('spawn EACCES');
    palco.anotar(`detalhes ${palco.manager.activeDetails} ativo ${palco.manager.activeProcess}`);
  },

  async 'confirmação: ocupado, recusa, aceita'(palco) {
    palco.resultados.nova = VIDEO;
    palco.anotar(`sem espera ${await palco.manager.handleConfirmation('haan')}`);
    await baixarManual(palco, 'https://yt/em-curso', 'mp3');
    await palco.manager.smartDownload('nova', 'mp3', 'video', 'chat-6');
    await palco.manager.smartDownload('nova', '720p', 'playlist', 'chat-7');
    palco.anotar(`pendente ${JSON.stringify(palco.manager.pendingDownloadArgs)} ${palco.manager.awaitingConfirmation}`);
    palco.anotar(`talvez ${await palco.manager.handleConfirmation('talvez')}`);
    palco.anotar(`vazio ${await palco.manager.handleConfirmation(null)}`);
    palco.anotar(`nahi ${await palco.manager.handleConfirmation('  NAHI ')}`);
    palco.anotar(`depois ${palco.manager.pendingDownloadArgs} ${palco.manager.awaitingConfirmation}`);
    await palco.manager.smartDownload('nova', '360p', 'video', 'chat-8');
    palco.anotar(`no ${await palco.manager.handleConfirmation('No')}`);
    await palco.manager.smartDownload('nova', '360p', 'video', 'chat-9');
    palco.anotar(`haan ${await palco.manager.handleConfirmation(' Haan')}`);
    await palco.manager.smartDownload('nova', 'mp3', 'video', 'chat-10');
    palco.killFalha = true;
    palco.anotar(`yes ${await palco.manager.handleConfirmation('YES')}`);
  },

  async 'confirmação sem processo ativo'(palco) {
    palco.resultados.livre = VIDEO;
    palco.manager.awaitingConfirmation = true;
    palco.manager.pendingDownloadArgs = { searchQuery: 'livre', format: 'mp3', type: 'video', targetChatId: 'chat-11' };
    palco.anotar(`haan ${await palco.manager.handleConfirmation('haan')}`);
    palco.manager.activeDetails = null;
    palco.manager.awaitingConfirmation = true;
    palco.manager.activeProcess = null;
    await palco.manager.smartDownload('livre', 'mp3', 'video', 'chat-12');
    palco.anotar(`no ${await palco.manager.handleConfirmation('no')}`);
  },

  async 'whatsapp ausente ou com erro'(palco) {
    palco.resultados.zap = VIDEO;
    palco.app.whatsappManager = null;
    await palco.manager.smartDownload('zap', 'mp3', 'video', 'chat-13');
    palco.processo().fechar(0);
    palco.app.whatsappManager = { sendReply() { throw new Error('zap fora'); } };
    palco.manager.sendWhatsappReply('chat-14', 'oi');
    palco.manager.app = null;
    palco.manager.sendWhatsappReply('chat-15', 'oi');
  },

  async 'janela fechada, ausente ou com erro'(palco) {
    palco.janela.destruida = true;
    palco.manager.sendToFrontend('canal', { a: 1 });
    palco.manager.sendSwarmLog('log');
    palco.manager.sendSwarmStatus('busy', 1);
    palco.janela.destruida = false;
    palco.janela.falhaNoEnvio = true;
    palco.manager.sendToFrontend('canal', { a: 2 });
    palco.manager.sendSwarmLog('log');
    palco.manager.sendSwarmStatus('busy', 2);
    palco.manager.mainWindow = null;
    palco.manager.sendToFrontend('canal', { a: 3 });
    palco.manager.sendSwarmLog('log');
    palco.manager.sendSwarmStatus('busy', 3);
  },
};

module.exports = { cenas };
