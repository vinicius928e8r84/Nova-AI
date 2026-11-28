'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { carregarMain } = require('./ajuda/carregar-main');
const { carregarComArranqueCompleto } = require('./ajuda/arranque-completo');

const PASTA_DO_ELECTRON = path.join(__dirname, '..', 'electron');
const AGORA = 1700000000000;

function comRelogio(funcao) {
  const original = Date.now;
  Date.now = () => AGORA;
  const restaurar = () => { Date.now = original; };
  try {
    const resultado = funcao();
    return resultado && typeof resultado.finally === 'function' ? resultado.finally(restaurar) : (restaurar(), resultado);
  } catch (erro) {
    restaurar();
    throw erro;
  }
}

function comTmpEm(pasta, funcao) {
  const nomes = ['TMPDIR', 'TMP', 'TEMP'];
  const antes = nomes.map((nome) => process.env[nome]);
  for (const nome of nomes) process.env[nome] = pasta;
  const restaurar = () => nomes.forEach((nome, i) => { if (antes[i] === undefined) delete process.env[nome]; else process.env[nome] = antes[i]; });
  return Promise.resolve().then(funcao).finally(restaurar);
}

function semRuido(funcao) {
  const antes = { log: console.log, info: console.info, warn: console.warn, error: console.error };
  console.log = console.info = console.warn = console.error = () => {};
  return Promise.resolve().then(funcao).finally(() => Object.assign(console, antes));
}

test('get-webview-bridge-path e get-stealth-preload-path respondem o caminho dos arquivos ao lado do main.js', () => {
  const main = carregarMain();
  assert.strictEqual(main.emitir('get-webview-bridge-path').returnValue, path.join(PASTA_DO_ELECTRON, 'webview-bridge.js'));
  assert.strictEqual(main.emitir('get-stealth-preload-path').returnValue, path.join(PASTA_DO_ELECTRON, 'google-stealth-preload.js'));
  assert.ok(fs.existsSync(main.emitir('get-webview-bridge-path').returnValue));
  assert.ok(fs.existsSync(main.emitir('get-stealth-preload-path').returnValue));
});

test('a midia e a voz registram os 14 canais de midia e o de voz, cada um do tipo de hoje', () => {
  const main = carregarMain();
  const handle = ['rtmp:start-broadcast', 'rtmp:stop-broadcast', 'screen-recorder:get-sources', 'screen-recorder:save', 'virtual-cam:control', 'virtual-cam:update-regional', 'virtual-cam:update-transform', 'virtual-cam:spoof-registry', 'take-screenshot', 'get-screen-sources', 'preview-voice'];
  const on = ['get-webview-bridge-path', 'get-stealth-preload-path', 'rtmp:video-chunk', 'virtual-cam:stream-chunk'];
  for (const canal of handle) assert.ok(main.canais.handle.has(canal), `handle ${canal}`);
  for (const canal of on) assert.ok(main.canais.on.has(canal), `on ${canal}`);
  for (const canal of handle) assert.ok(!main.canais.on.has(canal), `${canal} nao e on`);
  for (const canal of on) assert.ok(!main.canais.handle.has(canal), `${canal} nao e handle`);
});

function fonteFalsa(id, nome, miniatura) {
  return { id, name: nome, thumbnail: { toDataURL: () => miniatura } };
}

test('screen-recorder:get-sources lista janelas e telas com icones, devolve id, nome e miniatura, e [] quando falha', async () => {
  const pedidos = [];
  const desktopCapturer = { getSources: async (opcoes) => { pedidos.push(opcoes); return [fonteFalsa('window:1', 'Editor', 'data:a'), fonteFalsa('screen:0', 'Tela 1', 'data:b')]; } };
  const main = carregarMain({ electron: { desktopCapturer } });
  assert.deepStrictEqual(await main.invocar('screen-recorder:get-sources'), [
    { id: 'window:1', name: 'Editor', thumbnail: 'data:a' },
    { id: 'screen:0', name: 'Tela 1', thumbnail: 'data:b' },
  ]);
  assert.deepStrictEqual(pedidos, [{ types: ['window', 'screen'], fetchWindowIcons: true }]);
  desktopCapturer.getSources = async () => { throw new Error('sem permissao'); };
  assert.deepStrictEqual(await main.invocar('screen-recorder:get-sources'), []);
});

function cenarioDoGravador({ ffmpeg = '/ferramentas/ffmpeg', escolha, falhaDoFfmpeg = null, falhaDoDialogo = null } = {}) {
  const diario = { dialogos: [], ffmpeg: [], pastas: [] };
  const dialog = {
    showSaveDialog: async (janela, opcoes) => {
      diario.dialogos.push({ janela, opcoes });
      if (falhaDoDialogo) throw falhaDoDialogo;
      return { filePath: typeof escolha === 'function' ? escolha(diario) : escolha };
    },
  };
  const shell = { showItemInFolder: (arquivo) => diario.pastas.push(arquivo) };
  const child_process = {
    spawn: () => { throw new Error('spawn fora do teste'); },
    exec: () => { throw new Error('exec fora do teste'); },
    execFile: (arquivo, argumentos, opcoes, aoTerminar) => {
      diario.ffmpeg.push({ arquivo, argumentos, opcoes, temporarioExistia: fs.existsSync(argumentos[2]) });
      if (falhaDoFfmpeg) aoTerminar(falhaDoFfmpeg, '', 'saida de erro');
      else {
        fs.writeFileSync(argumentos.at(-1), 'remuxado');
        aoTerminar(null, '', '');
      }
    },
  };
  const modulos = { child_process, './services/tool-paths': { iconFile: () => 'nova.png', ffmpeg: () => ffmpeg } };
  const main = carregarMain({ electron: { dialog, shell }, modulos });
  return { main, diario };
}

const GRAVACAO = { buffer: [1, 2, 3, 4], extension: 'mp4' };
const temporarioDe = (main) => path.join(main.pasta('temp'), `nova_temp_rec_${AGORA}.webm`);

test('screen-recorder:save remuxa o webm para mp4 com faststart, apaga o temporario e mostra o arquivo na pasta', async () => {
  const { main, diario } = cenarioDoGravador({ escolha: (d) => path.join(path.dirname(temporarioDe(main)), 'saida.MP4') });
  const resposta = await comRelogio(() => main.invocar('screen-recorder:save', GRAVACAO));
  const destino = path.join(main.pasta('temp'), 'saida.MP4');
  assert.deepStrictEqual(resposta, { success: true, filePath: destino });
  assert.strictEqual(diario.dialogos[0].janela, main.janelaPrincipal);
  assert.deepStrictEqual(diario.dialogos[0].opcoes, {
    title: 'Salvar Gravação de Tela',
    defaultPath: path.join(main.pasta('videos'), `Nova_Record_${AGORA}.mp4`),
    filters: [{ name: 'Video File', extensions: ['mp4'] }, { name: 'All Files', extensions: ['*'] }],
  });
  assert.deepStrictEqual(diario.ffmpeg.map(({ arquivo, argumentos, opcoes, temporarioExistia }) => ({ arquivo, argumentos, opcoes, temporarioExistia })), [
    { arquivo: '/ferramentas/ffmpeg', argumentos: ['-y', '-i', temporarioDe(main), '-c', 'copy', '-movflags', '+faststart', destino], opcoes: { windowsHide: true }, temporarioExistia: true },
  ]);
  assert.strictEqual(fs.readFileSync(destino, 'utf8'), 'remuxado');
  assert.strictEqual(fs.existsSync(temporarioDe(main)), false);
  assert.deepStrictEqual(diario.pastas, [destino]);
});

test('screen-recorder:save usa a extensao pedida (mp4 por padrao), o ffmpeg do PATH sem a ferramenta e nao poe faststart fora do mp4', async () => {
  const { main, diario } = cenarioDoGravador({ ffmpeg: null, escolha: () => path.join(main.pasta('temp'), 'saida.webm') });
  const resposta = await comRelogio(() => main.invocar('screen-recorder:save', { buffer: [9] }));
  assert.strictEqual(resposta.success, true);
  assert.strictEqual(diario.dialogos[0].opcoes.defaultPath, path.join(main.pasta('videos'), `Nova_Record_${AGORA}.mp4`));
  assert.strictEqual(diario.ffmpeg[0].arquivo, 'ffmpeg');
  assert.deepStrictEqual(diario.ffmpeg[0].argumentos, ['-y', '-i', temporarioDe(main), '-c', 'copy', path.join(main.pasta('temp'), 'saida.webm')]);
  const outra = cenarioDoGravador({ escolha: () => path.join(outra.main.pasta('temp'), 'saida.mkv') });
  await comRelogio(() => outra.main.invocar('screen-recorder:save', { buffer: [9], extension: 'mkv' }));
  assert.deepStrictEqual(outra.diario.dialogos[0].opcoes.filters[0], { name: 'Video File', extensions: ['mkv'] });
  assert.strictEqual(outra.diario.dialogos[0].opcoes.defaultPath, path.join(outra.main.pasta('videos'), `Nova_Record_${AGORA}.mkv`));
});

test('screen-recorder:save cancelado apaga o temporario e responde cancelled, sem rodar o ffmpeg', async () => {
  const { main, diario } = cenarioDoGravador({ escolha: undefined });
  assert.deepStrictEqual(await comRelogio(() => main.invocar('screen-recorder:save', GRAVACAO)), { success: false, cancelled: true });
  assert.strictEqual(fs.existsSync(temporarioDe(main)), false);
  assert.deepStrictEqual([diario.ffmpeg, diario.pastas], [[], []]);
});

test('screen-recorder:save com erro do ffmpeg grava o buffer direto no destino, avisa fallback e deixa o temporario onde esta', async () => {
  const { main, diario } = cenarioDoGravador({ falhaDoFfmpeg: new Error('ffmpeg quebrou'), escolha: () => path.join(main.pasta('temp'), 'direto.mp4') });
  const destino = path.join(main.pasta('temp'), 'direto.mp4');
  assert.deepStrictEqual(await semRuido(() => comRelogio(() => main.invocar('screen-recorder:save', GRAVACAO))), { success: true, filePath: destino, fallback: true });
  assert.deepStrictEqual([...fs.readFileSync(destino)], [1, 2, 3, 4]);
  assert.deepStrictEqual(diario.pastas, [destino]);
  assert.strictEqual(fs.existsSync(temporarioDe(main)), true);
});

test('screen-recorder:save que falha no ffmpeg e no fallback apaga o temporario e devolve o erro do ffmpeg', async () => {
  const { main, diario } = cenarioDoGravador({ falhaDoFfmpeg: new Error('ffmpeg quebrou'), escolha: () => path.join(main.pasta('temp'), 'pasta-que-nao-existe', 'x.mp4') });
  assert.deepStrictEqual(await semRuido(() => comRelogio(() => main.invocar('screen-recorder:save', GRAVACAO))), { success: false, error: 'ffmpeg quebrou' });
  assert.strictEqual(fs.existsSync(temporarioDe(main)), false);
  assert.deepStrictEqual(diario.pastas, []);
});

test('screen-recorder:save com erro antes de escolher o destino apaga o temporario e devolve a mensagem', async () => {
  const { main } = cenarioDoGravador({ falhaDoDialogo: new Error('dialogo caiu') });
  assert.deepStrictEqual(await semRuido(() => comRelogio(() => main.invocar('screen-recorder:save', GRAVACAO))), { success: false, error: 'dialogo caiu' });
  assert.strictEqual(fs.existsSync(temporarioDe(main)), false);
});

class InjetorFalso {
  constructor(janela, app, farm) {
    Object.assign(this, { janela, app, farm, chamadas: [], respostas: {}, falhas: {}, globalSpoof: {}, chunks: [] });
    InjetorFalso.criados.push(this);
    const registrar = (nome, resposta) => async (...argumentos) => {
      this.chamadas.push([nome, ...argumentos]);
      if (this.falhas[nome]) throw this.falhas[nome];
      return nome in this.respostas ? this.respostas[nome] : resposta;
    };
    this.detectDriver = registrar('detectDriver', { installed: true });
    this.startHijack = registrar('startHijack', { started: true });
    this.stopHijack = registrar('stopHijack', { stopped: true });
    this.installDriver = registrar('installDriver', { installed: true });
    this.getStatus = (...argumentos) => { this.chamadas.push(['getStatus', ...argumentos]); return { status: 'ocioso' }; };
    this.globalSpoof.listProfiles = (...argumentos) => { this.chamadas.push(['listProfiles', ...argumentos]); return ['perfil-a', 'perfil-b']; };
    this.globalSpoof.updateRegional = registrar('updateRegional', { success: true });
    this.globalSpoof.spoofRegistryName = registrar('spoofRegistryName', { success: true, nome: 'Camera Nova' });
    this.globalSpoof.broadcastTransform = (...argumentos) => {
      this.chamadas.push(['broadcastTransform', ...argumentos]);
      if (this.falhas.broadcastTransform) throw this.falhas.broadcastTransform;
    };
    this.writeChunk = (pedaco) => this.chunks.push(pedaco);
  }
}
InjetorFalso.criados = [];

function cameraVirtual({ navegador } = {}) {
  InjetorFalso.criados = [];
  const abertos = [];
  const shell = { openExternal: (url) => { abertos.push(url); } };
  const modulos = { './services/virtual-cam-injector': InjetorFalso };
  if (navegador) modulos['./services/browser-manager'] = { registerBrowserHandlers: () => {}, browserService: navegador };
  const { main } = carregarComArranqueCompleto({ electron: { shell }, modulos });
  return { main, injetor: InjetorFalso.criados[0], abertos };
}

test('virtual-cam:* sem o servico iniciado responde que nao esta inicializado, e o stream-chunk nao faz nada', async () => {
  const main = carregarMain();
  assert.deepStrictEqual(await main.invocar('virtual-cam:control', { action: 'detect' }), { error: 'Virtual Camera Service not initialized' });
  assert.deepStrictEqual(await main.invocar('virtual-cam:update-regional', { pais: 'BR' }), { success: false, error: 'Service not initialized' });
  assert.deepStrictEqual(await main.invocar('virtual-cam:update-transform', { zoom: 1, rotate: 0, mirror: false }), { success: false });
  assert.deepStrictEqual(await main.invocar('virtual-cam:spoof-registry'), { success: false, error: 'Service not initialized' });
  assert.strictEqual(main.emitir('virtual-cam:stream-chunk', new ArrayBuffer(2)).returnValue, undefined);
});

test('virtual-cam:control repassa cada acao ao injetor, abre o guia do driver e recusa acao desconhecida', async () => {
  const { main, injetor, abertos } = cameraVirtual();
  assert.ok(injetor, 'o injetor nasce com a janela');
  const buffer = Buffer.from([7, 7]);
  const configuracoes = { fps: 30 };
  assert.deepStrictEqual(await main.invocar('virtual-cam:control', { action: 'detect' }), { installed: true });
  assert.deepStrictEqual(await main.invocar('virtual-cam:control', { action: 'list-profiles' }), ['perfil-a', 'perfil-b']);
  assert.deepStrictEqual(await main.invocar('virtual-cam:control', { action: 'hijack', buffer, settings: configuracoes }), { started: true });
  assert.deepStrictEqual(await main.invocar('virtual-cam:control', { action: 'restore' }), { stopped: true });
  assert.deepStrictEqual(await main.invocar('virtual-cam:control', { action: 'status' }), { status: 'ocioso' });
  assert.deepStrictEqual(await main.invocar('virtual-cam:control', { action: 'install-driver' }), { installed: true });
  assert.deepStrictEqual(await main.invocar('virtual-cam:control', { action: 'install-guide' }), { success: true });
  assert.deepStrictEqual(await main.invocar('virtual-cam:control', { action: 'voar' }), { error: 'Unsupported action: voar' });
  assert.deepStrictEqual(await main.invocar('virtual-cam:control', {}), { error: 'Unsupported action: undefined' });
  assert.deepStrictEqual(injetor.chamadas, [['detectDriver'], ['listProfiles'], ['startHijack', buffer, configuracoes], ['stopHijack'], ['getStatus'], ['installDriver']]);
  assert.deepStrictEqual(abertos, ['https://github.com/CatxFish/obs-virtual-cam/releases/tag/2.0.4']);
});

test('virtual-cam:control devolve o erro do injetor, e o aviso de driver ausente sem o prefixo e com noDriver', async () => {
  const { main, injetor } = cameraVirtual();
  injetor.falhas.detectDriver = new Error('falhou de vez');
  assert.deepStrictEqual(await semRuido(() => main.invocar('virtual-cam:control', { action: 'detect' })), { error: 'falhou de vez', noDriver: false });
  injetor.falhas.startHijack = new Error('NO_DRIVER: Instale o driver da camera virtual');
  assert.deepStrictEqual(await semRuido(() => main.invocar('virtual-cam:control', { action: 'hijack' })), { error: 'Instale o driver da camera virtual', noDriver: true });
  injetor.falhas.stopHijack = new Error('depois NO_DRIVER: no meio');
  assert.deepStrictEqual(await semRuido(() => main.invocar('virtual-cam:control', { action: 'restore' })), { error: 'depois NO_DRIVER: no meio', noDriver: false });
});

test('virtual-cam:update-regional atualiza o injetor e tambem o servico do navegador, e segue se o navegador falhar', async () => {
  const atualizacoes = [];
  const navegador = { updateRegional: async (regional) => { atualizacoes.push(regional); } };
  const { main, injetor } = cameraVirtual({ navegador });
  const regional = { pais: 'BR', fuso: 'America/Recife' };
  assert.deepStrictEqual(await main.invocar('virtual-cam:update-regional', regional), { success: true });
  assert.deepStrictEqual([injetor.chamadas, atualizacoes], [[['updateRegional', regional]], [regional]]);
  navegador.updateRegional = async () => { throw new Error('navegador caiu'); };
  assert.deepStrictEqual(await semRuido(() => main.invocar('virtual-cam:update-regional', regional)), { success: true });
  delete navegador.updateRegional;
  assert.deepStrictEqual(await main.invocar('virtual-cam:update-regional', regional), { success: true });
  injetor.falhas.updateRegional = new Error('regional recusada');
  assert.deepStrictEqual(await main.invocar('virtual-cam:update-regional', regional), { success: false, error: 'regional recusada' });
});

test('virtual-cam:update-transform manda zoom, rotacao e espelho ao injetor e devolve o erro em texto', async () => {
  const { main, injetor } = cameraVirtual();
  assert.deepStrictEqual(await main.invocar('virtual-cam:update-transform', { zoom: 1.5, rotate: 90, mirror: true, extra: 'ignorado' }), { success: true });
  assert.deepStrictEqual(injetor.chamadas, [['broadcastTransform', 1.5, 90, true]]);
  injetor.falhas.broadcastTransform = new Error('transformacao recusada');
  assert.deepStrictEqual(await main.invocar('virtual-cam:update-transform', { zoom: 1, rotate: 0, mirror: false }), { success: false, error: 'transformacao recusada' });
});

test('virtual-cam:spoof-registry marca o registro como disfarcado so quando da certo, e devolve o erro em texto', async () => {
  const { main, injetor } = cameraVirtual();
  assert.deepStrictEqual(await main.invocar('virtual-cam:spoof-registry'), { success: true, nome: 'Camera Nova' });
  assert.strictEqual(injetor.globalSpoof.registrySpoofed, true);
  injetor.globalSpoof.registrySpoofed = false;
  injetor.respostas.spoofRegistryName = { success: false };
  assert.deepStrictEqual(await main.invocar('virtual-cam:spoof-registry'), { success: false });
  assert.strictEqual(injetor.globalSpoof.registrySpoofed, false);
  injetor.falhas.spoofRegistryName = new Error('registro protegido');
  assert.deepStrictEqual(await main.invocar('virtual-cam:spoof-registry'), { success: false, error: 'registro protegido' });
});

test('virtual-cam:stream-chunk entrega ao injetor os mesmos bytes como Buffer e nao responde', () => {
  const { main, injetor } = cameraVirtual();
  const pedaco = new Uint8Array([5, 6, 7]).buffer;
  assert.strictEqual(main.emitir('virtual-cam:stream-chunk', pedaco).returnValue, undefined);
  assert.strictEqual(injetor.chunks.length, 1);
  assert.ok(Buffer.isBuffer(injetor.chunks[0]));
  assert.deepStrictEqual([...injetor.chunks[0]], [5, 6, 7]);
});

const VTT = [
  'WEBVTT',
  '',
  '00:00:00.100 --> 00:00:00.600',
  'Ola',
  '',
  '',
  '00:00:01.000 --> 01:02:03.250',
  'mundo',
  '',
].join('\n');

function cenarioDaVoz({ tts = {}, ffplay = {} } = {}) {
  const diario = { comandos: [], mensagens: [], textoLido: null };
  const evento = { sender: { send: (canal, dados) => diario.mensagens.push([canal, dados]) } };
  const exec = (comando, aoTerminar) => {
    diario.comandos.push(comando);
    if (comando.startsWith('ffplay')) return aoTerminar(ffplay.erro || null);
    const arquivo = (opcao) => comando.match(new RegExp(`${opcao} "([^"]+)"`))[1];
    diario.textoLido = fs.readFileSync(arquivo('--file'), 'utf8');
    if (tts.audio !== undefined) fs.writeFileSync(arquivo('--write-media'), tts.audio);
    if (tts.legenda !== undefined) fs.writeFileSync(arquivo('--write-subtitles'), tts.legenda);
    return aoTerminar(tts.erro || null);
  };
  const modulos = {
    child_process: { spawn: () => { throw new Error('spawn fora do teste'); }, exec },
    './services/paridade-utils': { edgeTtsBinary: (plataforma, python) => `edge-tts(${plataforma},${python()})` },
  };
  const main = carregarMain({ modulos });
  return { main, diario, evento, chamar: (dados) => main.canais.handle.get('preview-voice')(evento, dados) };
}

const nomesDoTmp = (main) => fs.readdirSync(main.raiz).filter((nome) => nome.startsWith('nova_prev'));

async function falarEmTmp(cenario, dados) {
  return comTmpEm(cenario.main.raiz, () => comRelogio(() => cenario.chamar(dados)));
}

test('preview-voice gera a voz com o edge-tts, le a legenda, toca com o ffplay e apaga os tres arquivos', async () => {
  const cenario = cenarioDaVoz({ tts: { audio: 'mp3', legenda: VTT } });
  const resposta = await falarEmTmp(cenario, { aiVoice: 'Christopher', aiLanguage: 'English', aiSpeed: 50, aiPitch: 50, scriptText: '  Ola mundo  ' });
  const { raiz } = cenario.main;
  assert.deepStrictEqual(resposta, { success: true });
  assert.deepStrictEqual(cenario.diario.comandos, [
    `edge-tts(${process.platform},python-teste) --file "${raiz}/nova_prev_txt_${AGORA}.txt" --write-media "${raiz}/nova_prev_${AGORA}.mp3" --write-subtitles "${raiz}/nova_prev_${AGORA}.vtt" --voice en-US-ChristopherNeural`,
    `ffplay -nodisp -autoexit -loglevel quiet "${raiz}/nova_prev_${AGORA}.mp3"`,
  ]);
  assert.strictEqual(cenario.diario.textoLido, '﻿Ola mundo');
  assert.deepStrictEqual(cenario.diario.mensagens, [
    ['preview-voice-status', { state: 'generating', message: '🎙️ Gerando voz...' }],
    ['preview-voice-status', { state: 'playing', message: '🔊 Reproduzindo...', wordTimings: [{ word: 'Ola', start: 0.1, end: 0.6 }, { word: 'mundo', start: 1, end: 3723.25 }] }],
    ['preview-voice-status', { state: 'done', message: '✅ Pronto!' }],
  ]);
  assert.deepStrictEqual(nomesDoTmp(cenario.main), []);
});

test('preview-voice escolhe a voz pelo nome, depois pelo idioma, e o texto padrao pelo idioma da voz', async () => {
  const casos = [
    [{ aiVoice: 'Asad (Urdu)' }, 'ur-PK-AsadNeural', 'السلام علیکم، میں نووا اے آئی ہوں، آپ کی خدمت میں حاضر ہوں'],
    [{ aiVoice: 'Uzma', aiLanguage: 'Hindi' }, 'ur-PK-UzmaNeural', 'السلام علیکم، میں نووا اے آئی ہوں، آپ کی خدمت میں حاضر ہوں'],
    [{ aiVoice: 'Christopher', aiLanguage: 'Hindi' }, 'en-US-ChristopherNeural', 'Hello! I am Nova AI, your intelligent voice assistant. How can I help you today?'],
    [{ aiLanguage: 'Hindi (India)' }, 'hi-IN-MadhurNeural', 'नमस्ते, मैं Nova AI हूँ। आपकी सेवा में हाजिर हूँ।'],
    [{ aiVoice: 'Outra', aiLanguage: 'English' }, 'en-US-ChristopherNeural', 'Hello! I am Nova AI, your intelligent voice assistant. How can I help you today?'],
    [{ scriptText: '   ' }, 'en-US-ChristopherNeural', 'Hello! I am Nova AI, your intelligent voice assistant. How can I help you today?'],
    [{ scriptText: 'texto proprio', aiLanguage: 'Hindi' }, 'hi-IN-MadhurNeural', 'texto proprio'],
  ];
  const obtidos = [];
  for (const [dados] of casos) {
    const cenario = cenarioDaVoz({ tts: { audio: 'mp3', legenda: '' } });
    await falarEmTmp(cenario, dados);
    obtidos.push([cenario.diario.comandos[0].match(/--voice (\S+)/)[1], cenario.diario.textoLido.slice(1)]);
  }
  assert.deepStrictEqual(obtidos, casos.map(([, voz, texto]) => [voz, texto]));
});

test('preview-voice monta a velocidade e o tom so quando saem do meio (50), com sinal e arredondamento de hoje', async () => {
  const casos = [
    [{}, ''],
    [{ aiSpeed: 75 }, ' --rate "+50%"'],
    [{ aiSpeed: 25 }, ' --rate "-50%"'],
    [{ aiPitch: 60 }, ' --pitch "+10Hz"'],
    [{ aiPitch: 40 }, ' --pitch "-10Hz"'],
    [{ aiSpeed: 0, aiPitch: 0 }, ''],
    [{ aiSpeed: 51, aiPitch: 49 }, ' --rate "+2%" --pitch "-1Hz"'],
  ];
  const obtidos = [];
  for (const [dados] of casos) {
    const cenario = cenarioDaVoz({ tts: { audio: 'mp3', legenda: '' } });
    await falarEmTmp(cenario, dados);
    obtidos.push(cenario.diario.comandos[0].split('--voice en-US-ChristopherNeural')[1]);
  }
  assert.deepStrictEqual(obtidos, casos.map(([, resto]) => resto));
});

test('preview-voice sem legenda ou com legenda sem tempos manda a lista de palavras vazia', async () => {
  for (const legenda of [undefined, '', 'WEBVTT\n\nsem tempo nenhum']) {
    const cenario = cenarioDaVoz({ tts: { audio: 'mp3', legenda } });
    await falarEmTmp(cenario, { scriptText: 'x' });
    const tocando = cenario.diario.mensagens.find(([, dados]) => dados.state === 'playing')[1];
    assert.deepStrictEqual(tocando.wordTimings, [], String(legenda));
  }
});

test('preview-voice com erro do edge-tts avisa com a mensagem cortada em 100 caracteres, devolve o erro inteiro e apaga o texto', async () => {
  const mensagem = `falhou ${'x'.repeat(200)}`;
  const cenario = cenarioDaVoz({ tts: { erro: new Error(mensagem), audio: 'mp3' } });
  assert.deepStrictEqual(await falarEmTmp(cenario, { scriptText: 'x' }), { success: false, error: mensagem });
  assert.deepStrictEqual(cenario.diario.mensagens.at(-1), ['preview-voice-status', { state: 'error', message: `❌ edge-tts: ${mensagem.slice(0, 100)}` }]);
  assert.deepStrictEqual(cenario.diario.comandos.length, 1);
  assert.deepStrictEqual(nomesDoTmp(cenario.main), [`nova_prev_${AGORA}.mp3`]);
});

test('preview-voice com audio ausente ou vazio avisa Arquivo de audio vazio e nao toca', async () => {
  for (const audio of [undefined, '']) {
    const cenario = cenarioDaVoz({ tts: { audio } });
    assert.deepStrictEqual(await falarEmTmp(cenario, { scriptText: 'x' }), { success: false, error: 'Audio empty' });
    assert.deepStrictEqual(cenario.diario.mensagens.at(-1), ['preview-voice-status', { state: 'error', message: '❌ Arquivo de áudio vazio' }]);
    assert.strictEqual(cenario.diario.comandos.length, 1);
  }
});

test('preview-voice termina como pronto mesmo quando o ffplay falha', async () => {
  const cenario = cenarioDaVoz({ tts: { audio: 'mp3', legenda: VTT }, ffplay: { erro: new Error('sem ffplay') } });
  assert.deepStrictEqual(await falarEmTmp(cenario, { scriptText: 'x' }), { success: true });
  assert.deepStrictEqual(cenario.diario.mensagens.at(-1), ['preview-voice-status', { state: 'done', message: '✅ Pronto!' }]);
  assert.deepStrictEqual(nomesDoTmp(cenario.main), []);
});

test('preview-voice devolve a mensagem quando nao consegue nem preparar o texto', async () => {
  const cenario = cenarioDaVoz({ tts: { audio: 'mp3' } });
  const pastaInexistente = path.join(cenario.main.raiz, 'nao-existe');
  const resposta = await comTmpEm(pastaInexistente, () => comRelogio(() => cenario.chamar({ scriptText: 'x' })));
  assert.strictEqual(resposta.success, false);
  assert.match(resposta.error, /^ENOENT: no such file or directory, open /);
  assert.deepStrictEqual(cenario.diario.mensagens, []);
});

test('preview-voice devolve a mensagem quando o aviso ao app falha', async () => {
  const cenario = cenarioDaVoz({ tts: { audio: 'mp3' } });
  cenario.evento.sender.send = () => { throw new Error('janela fechada'); };
  assert.deepStrictEqual(await falarEmTmp(cenario, { scriptText: 'x' }), { success: false, error: 'janela fechada' });
  assert.strictEqual(cenario.diario.comandos.length, 0);
});
