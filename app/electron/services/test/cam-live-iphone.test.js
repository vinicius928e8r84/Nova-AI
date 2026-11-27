'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');

const toolPaths = require('../tool-paths');
const iphoneSsh = require('../iphone-ssh');
const { CamLiveIphone, AdtsParser, UsbMedia } = require('../cam-live-iphone');

const ORIGINAIS = { exigirOpenssh: toolPaths.exigirOpenssh, ffmpeg: toolPaths.ffmpeg, sshOptions: iphoneSsh.sshOptions };

test.beforeEach(() => {
  toolPaths.exigirOpenssh = (nome) => `${nome}-falso`;
  toolPaths.ffmpeg = () => null;
  iphoneSsh.sshOptions = () => ['-i', 'chave-falsa'];
});

test.afterEach(() => {
  Object.assign(toolPaths, { exigirOpenssh: ORIGINAIS.exigirOpenssh, ffmpeg: ORIGINAIS.ffmpeg });
  iphoneSsh.sshOptions = ORIGINAIS.sshOptions;
});

const PRONTO = {
  version: '0.1-39', hooksReady: true, faulted: false, enabled: false,
  photoPrepareHookReady: true, photoStillHookReady: true, photoPortRemapHookReady: true,
};

function adts(carga, { protecao = false, perfil = 1, taxa = 4, canais = 1, tamanho = null } = {}) {
  const cabecalho = protecao ? 9 : 7;
  const n = tamanho ?? carga.length + cabecalho;
  const bytes = [255, protecao ? 240 : 241, (perfil << 6) | (taxa << 2) | (canais >> 2), ((canais & 3) << 6) | (n >> 11), (n >> 3) & 255, ((n & 7) << 5) | 31, 252];
  return Buffer.concat([Buffer.from(bytes), protecao ? Buffer.from([0, 0]) : Buffer.alloc(0), carga]);
}

function sof(marcador, largura, altura, tamanho = 17) {
  const corpo = Buffer.alloc(tamanho - 2);
  corpo[0] = 8;
  corpo.writeUInt16BE(altura, 1);
  corpo.writeUInt16BE(largura, 3);
  const cabecalho = Buffer.from([255, marcador, tamanho >> 8, tamanho & 255]);
  return Buffer.concat([cabecalho, corpo]);
}

function segmento(marcador, tamanho) {
  const cabecalho = Buffer.from([255, marcador, tamanho >> 8, tamanho & 255]);
  return Buffer.concat([cabecalho, Buffer.alloc(tamanho - 2, 1)]);
}

function jpeg(...partes) {
  return Buffer.concat([Buffer.from([255, 216]), ...partes, Buffer.from([255, 217])]);
}

const MENSAGEM_DAS_DIMENSOES = 'O JPEG precisa ter dimensões válidas de até 4096×4096.';

test('AdtsParser: o cabeçalho de 7 bytes e o de 9 (com CRC) entregam só a carga, e onPacket recebe cada pacote', () => {
  const recebidos = [];
  const parser = new AdtsParser((pacote) => recebidos.push(pacote));
  const sem = adts(Buffer.from([1, 2, 3]));
  const com = adts(Buffer.from([4, 5]), { protecao: true });
  assert.deepStrictEqual(parser.push(Buffer.concat([sem, com])), [Buffer.from([1, 2, 3]), Buffer.from([4, 5])]);
  assert.deepStrictEqual(recebidos, [Buffer.from([1, 2, 3]), Buffer.from([4, 5])]);
  assert.strictEqual(parser.pending.length, 0);
  assert.deepStrictEqual(new AdtsParser().push(Buffer.alloc(6)), []);
});

test('AdtsParser: guarda o pacote incompleto e rejeita cabeçalho, tamanho, formato e excesso com a mensagem de hoje', () => {
  const parcial = new AdtsParser();
  const pacote = adts(Buffer.from([9, 9, 9, 9]));
  assert.deepStrictEqual(parcial.push(pacote.subarray(0, 9)), []);
  assert.strictEqual(parcial.pending.length, 9);
  assert.deepStrictEqual(parcial.push(pacote.subarray(9)), [Buffer.from([9, 9, 9, 9])]);

  const erro = (bytes) => { try { new AdtsParser().push(bytes); } catch (e) { return e.message; } return null; };
  assert.strictEqual(erro(Buffer.alloc(7)), 'Encoder retornou áudio sem cabeçalho ADTS válido.');
  const segundoByte = adts(Buffer.from([1])); segundoByte[1] = 0xf2;
  assert.strictEqual(erro(segundoByte), 'Encoder retornou áudio sem cabeçalho ADTS válido.');
  assert.strictEqual(erro(adts(Buffer.alloc(0), { tamanho: 7 })), 'Tamanho de pacote AAC inválido.');
  assert.strictEqual(erro(adts(Buffer.alloc(0), { protecao: true, tamanho: 9 })), 'Tamanho de pacote AAC inválido.');
  assert.strictEqual(erro(adts(Buffer.alloc(0), { tamanho: 8192 })), 'Tamanho de pacote AAC inválido.');
  const exigeAac = 'Áudio do iPhone exige AAC-LC mono de 44,1 kHz.';
  for (const opcoes of [{ perfil: 0 }, { taxa: 3 }, { canais: 2 }, { canais: 5 }]) assert.strictEqual(erro(adts(Buffer.from([1]), opcoes)), exigeAac, JSON.stringify(opcoes));
  const reservado = adts(Buffer.from([1])); reservado[6] = 253;
  assert.strictEqual(erro(reservado), exigeAac);
  assert.strictEqual(erro(Buffer.alloc(1024 * 1024 + 1)), 'Saída AAC excedeu o limite.');
  const cheio = new AdtsParser();
  cheio.push(adts(Buffer.alloc(1024 * 1024 - 100), { tamanho: 8191 }).subarray(0, 8000));
  assert.throws(() => cheio.push(Buffer.alloc(1024 * 1024 - 7990)), { message: 'Saída AAC excedeu o limite.' });
});

function mediaComFrame(bytes) {
  const media = new UsbMedia({ now: () => 1000 });
  return { media, resposta: media.frame(bytes) };
}

test('UsbMedia.frame: aceita JPEG com SOF0, SOF2, preenchimento FF, marcadores sem tamanho, DHT e APP antes do SOF', () => {
  const aceitos = [
    jpeg(sof(0xc0, 32, 16)),
    jpeg(sof(0xc2, 32, 16)),
    jpeg(sof(0xcf, 32, 16)),
    jpeg(segmento(0xe0, 16), sof(0xc0, 32, 16)),
    jpeg(Buffer.from([255, 255, 255]), sof(0xc0, 32, 16)),
    jpeg(Buffer.from([255, 0xd0, 255, 0x01, 255, 0xd7]), sof(0xc0, 32, 16)),
    jpeg(segmento(0xc4, 10), segmento(0xc8, 6), segmento(0xcc, 6), sof(0xc0, 4096, 4096)),
    jpeg(sof(0xc0, 1, 1, 8)),
  ];
  aceitos.forEach((bytes, indice) => {
    const { media, resposta } = mediaComFrame(bytes);
    assert.deepStrictEqual(resposta, { ok: true }, String(indice));
    assert.deepStrictEqual(media.latestFrame, bytes);
    assert.strictEqual(media.frameAt, 1000);
  });
});

test('UsbMedia.frame: rejeita JPEG sem dimensões válidas, truncado, com tamanho de segmento errado ou fora do limite', () => {
  const sem = [
    jpeg(),
    jpeg(Buffer.from([1, 2])),
    jpeg(segmento(0xda, 10), sof(0xc0, 32, 16)),
    jpeg(Buffer.from([255, 0xd9, 0, 0, 0, 0]), sof(0xc0, 32, 16)),
    jpeg(Buffer.from([255, 0xe0, 0, 1, 0, 0, 0]), sof(0xc0, 32, 16)),
    jpeg(Buffer.from([255, 0xe0, 0, 200, 0, 0, 0, 0])),
    jpeg(sof(0xc0, 32, 16, 7)),
    jpeg(Buffer.from([255, 0xc0, 0, 7, 8, 0, 16, 0, 32])),
    jpeg(sof(0xc0, 0, 16)),
    jpeg(sof(0xc0, 16, 0)),
    jpeg(sof(0xc0, 4097, 16)),
    jpeg(sof(0xc0, 16, 4097)),
    jpeg(segmento(0xc4, 10), segmento(0xc8, 6), segmento(0xcc, 6)),
  ];
  sem.forEach((bytes, indice) => {
    const { media, resposta } = mediaComFrame(bytes);
    assert.deepStrictEqual(resposta, { ok: false, error: MENSAGEM_DAS_DIMENSOES }, String(indice));
    assert.strictEqual(media.latestFrame, null);
  });
});

test('UsbMedia.frame: tipo, tamanho e marcas de início e fim têm a mensagem de hoje', () => {
  const media = new UsbMedia();
  for (const invalido of ['texto', 12, null, undefined, [255, 216]]) assert.deepStrictEqual(media.frame(invalido), { ok: false, error: 'Quadro JPEG inválido.' });
  const limite = 'Quadro JPEG inválido ou maior que 2 MiB.';
  for (const bytes of [Buffer.alloc(0), Buffer.from([255, 216, 255]), Buffer.from([0, 216, 0, 255, 217]), Buffer.from([255, 215, 255, 217]), Buffer.from([255, 216, 0, 217]), Buffer.from([255, 216, 255, 0]), Buffer.alloc(2 * 1024 * 1024 + 1, 255)]) {
    assert.deepStrictEqual(media.frame(bytes), { ok: false, error: limite });
  }
  assert.deepStrictEqual(media.frame(new Uint8Array(jpeg(sof(0xc0, 8, 8)))), { ok: true });
  const noLimite = Buffer.alloc(2 * 1024 * 1024, 1);
  jpeg(sof(0xc0, 8, 8)).copy(noLimite);
  noLimite[noLimite.length - 2] = 255; noLimite[noLimite.length - 1] = 217;
  assert.deepStrictEqual(media.frame(noLimite), { ok: true });
});

test('UsbMedia.audioPacket: valida tipo e tamanho, mantém 96 pacotes e a sequência não reinicia', () => {
  let agora = 500;
  const media = new UsbMedia({ now: () => agora });
  for (const invalido of ['a', 1, null, [1]]) assert.deepStrictEqual(media.audioPacket(invalido), { ok: false, error: 'Pacote AAC inválido.' });
  assert.deepStrictEqual(media.audioPacket(Buffer.alloc(0)), { ok: false, error: 'Pacote AAC inválido.' });
  assert.deepStrictEqual(media.audioPacket(Buffer.alloc(8193)), { ok: false, error: 'Pacote AAC inválido.' });
  assert.strictEqual(media.audioAt, 0);
  assert.deepStrictEqual(media.audioPacket(new Uint8Array(8192)), { ok: true });
  assert.strictEqual(media.audioAt, 500);
  for (let i = 0; i < 100; i++) media.audioPacket(Buffer.from([i]));
  assert.strictEqual(media.audio.length, 96);
  assert.deepStrictEqual([media.audio[0].sequence, media.audio.at(-1).sequence], [6n, 101n]);
  agora = 1500;
  assert.strictEqual(media.freshAudio(), true);
  agora = 1501;
  assert.strictEqual(media.freshAudio(), false);
  assert.strictEqual(media.freshAudio(2000), true);
});

test('UsbMedia: freshFrame no limite de 1000 ms, batch só dos mais novos que after e o idleFrame', () => {
  let agora = 0;
  const media = new UsbMedia({ now: () => agora, idleFrame: Buffer.from('parado') });
  assert.strictEqual(media.freshFrame(), false);
  agora = 100;
  media.frame(jpeg(sof(0xc0, 8, 8)));
  agora = 1100;
  assert.strictEqual(media.freshFrame(), true);
  agora = 1101;
  assert.strictEqual(media.freshFrame(), false);
  assert.strictEqual(media.freshFrame(5000), true);
  assert.strictEqual(media.batch(0n), null);
  agora = 1200;
  media.audioPacket(Buffer.from([1, 2]));
  media.audioPacket(Buffer.from([3]));
  const lote = media.batch(1n);
  assert.deepStrictEqual(lote, Buffer.concat([Buffer.from('OBA1'), Buffer.from([0, 0, 0, 0, 0, 0, 0, 2, 0, 1]), Buffer.from([3])]));
  media.clearSource();
  assert.deepStrictEqual([media.latestFrame, media.audio], [null, []]);
});

function pedir(porta, caminho, metodo = 'GET') {
  return new Promise((resolver, rejeitar) => {
    const pedido = http.request({ host: '127.0.0.1', port: porta, path: caminho, method: metodo }, (resposta) => {
      const partes = [];
      resposta.on('data', (parte) => partes.push(parte));
      resposta.on('end', () => resolver({ status: resposta.statusCode, tipo: resposta.headers['content-type'], tamanho: resposta.headers['content-length'], corpo: Buffer.concat(partes) }));
    });
    pedido.on('error', rejeitar);
    pedido.end();
  });
}

test('UsbMedia.listen: rotas, textos, tipos e o quadro parado quando a fonte está velha', async () => {
  let agora = 0;
  const media = new UsbMedia({ now: () => agora, idleFrame: jpeg(sof(0xc0, 8, 8)) });
  const porta = await media.listen();
  try {
    await assert.rejects(media.listen(), { message: 'Servidor de mídia já iniciado.' });
    assert.deepStrictEqual([media.server.requestTimeout, media.server.headersTimeout, media.server.keepAliveTimeout], [3000, 3000, 1000]);
    const parado = await pedir(porta, media.framePath);
    assert.deepStrictEqual([parado.status, parado.tipo, parado.tamanho, parado.corpo], [200, 'image/jpeg', String(media.idleFrame.length), media.idleFrame]);
    const naoPermitido = await pedir(porta, media.framePath, 'POST');
    assert.deepStrictEqual([naoPermitido.status, naoPermitido.tipo, naoPermitido.corpo.toString()], [405, 'text/plain; charset=utf-8', 'Método não permitido']);
    assert.strictEqual((await pedir(porta, '/s/x')).corpo.toString(), 'Não encontrado');
    for (const consulta of ['?after=x', '?after=1.5', '?after=123456789012345678901', '?after=18446744073709551616']) {
      const resposta = await pedir(porta, media.audioPath + consulta);
      assert.deepStrictEqual([resposta.status, resposta.corpo.toString()], [400, 'Sequência inválida'], consulta);
    }
    assert.strictEqual((await pedir(porta, media.audioPath)).status, 503);
    assert.strictEqual((await pedir(porta, media.audioPath)).corpo.toString(), 'Indisponível');
    media.audioPacket(Buffer.from([7]));
    for (const consulta of ['', '?after=', '?after=0', '?after=000', '?after=18446744073709551615']) {
      const resposta = await pedir(porta, media.audioPath + consulta);
      const esperado = consulta === '?after=18446744073709551615' ? 200 : 200;
      assert.strictEqual(resposta.status, esperado, consulta);
    }
    const semNovos = await pedir(porta, `${media.audioPath}?after=1`);
    assert.deepStrictEqual([semNovos.status, semNovos.tipo, semNovos.corpo], [200, 'application/octet-stream', Buffer.from('OBA1')]);
    media.frame(jpeg(sof(0xc0, 16, 16)));
    assert.deepStrictEqual((await pedir(porta, media.framePath)).corpo, media.latestFrame);
  } finally {
    await media.close();
  }
  assert.strictEqual(media.server, null);
  await media.close();
});

test('UsbMedia: sem quadro parado e sem quadro novo a rota do quadro devolve 503 Indisponível', async () => {
  const media = new UsbMedia();
  const porta = await media.listen();
  try {
    const resposta = await pedir(porta, media.framePath);
    assert.deepStrictEqual([resposta.status, resposta.corpo.toString()], [503, 'Indisponível']);
  } finally {
    await media.close();
  }
});

function filho() {
  const processo = new EventEmitter();
  processo.stdin = new PassThrough();
  processo.stdout = new PassThrough();
  processo.stderr = new PassThrough();
  processo.pid = 1;
  return processo;
}

const COMPORTAMENTO_DO_TUNEL = {
  confirma: (processo) => processo.stderr.write('remote forward success for: listen'),
  ocupado: (processo) => { processo.stderr.write('remote forward failure for listen'); processo.emit('exit', 255); },
  encerra: (processo) => processo.emit('exit', 1),
  erro: (processo) => processo.emit('error', new Error('ENOENT')),
  ruidoso: (processo) => { processo.stderr.write(`remote forward failure${'x'.repeat(4100)}`); processo.emit('exit', 1); },
};

const COMPORTAMENTO_DO_CODIFICADOR = {
  sobe: (processo) => processo.emit('spawn'),
  erro: (processo) => processo.emit('error', new Error('x')),
  saida: (processo) => { processo.stderr.write('falhou assim'); processo.emit('exit', 1); },
  ruidoso: (processo) => { processo.stderr.write(`${'a'.repeat(3000)}${'b'.repeat(1000)}falhou assim`); processo.emit('exit', 1); },
};

function celularFalso({ estado, dispositivos, unixFalha, ssh }, comandos) {
  const respostaPadrao = (comando) => {
    if (comando.startsWith('chmod 666')) return { ok: !unixFalha, stdout: unixFalha ? '' : 'ok' };
    if (comando.startsWith('cat ')) return { ok: true, stdout: JSON.stringify(estado) };
    return { ok: true, stdout: '' };
  };
  return {
    getIosDevices: async () => dispositivos,
    iosSsh: async (comando) => {
      comandos.push(comando);
      return (ssh && ssh(comando)) || respostaPadrao(comando);
    },
  };
}

function lancadorFalso({ tunel, codificador }, filhos, lancamentos) {
  return (arquivo, argumentos, opcoes) => {
    const processo = filho();
    processo.kill = () => { processo.morto = true; queueMicrotask(() => processo.emit('exit', 0)); };
    filhos.push(processo);
    lancamentos.push({ arquivo, argumentos, opcoes });
    const comportamento = arquivo === 'ssh-falso' ? COMPORTAMENTO_DO_TUNEL[tunel] : COMPORTAMENTO_DO_CODIFICADOR[codificador];
    queueMicrotask(() => comportamento(processo));
    return processo;
  };
}

function montar({ estado = PRONTO, dispositivos = [{ id: 'ios-a', ios: true, name: 'iPhone teste' }], unixFalha = false, tunel = 'confirma', codificador = 'sobe', ssh = null, ffmpeg = '/ffmpeg-falso' } = {}) {
  const comandos = [];
  const eventos = [];
  const filhos = [];
  const lancamentos = [];
  const celular = celularFalso({ estado, dispositivos, unixFalha, ssh }, comandos);
  const spawnProcess = lancadorFalso({ tunel, codificador }, filhos, lancamentos);
  const servico = new CamLiveIphone({ getMobileService: () => celular, send: (nome, dados) => eventos.push([nome, dados]), ffmpegPath: ffmpeg, spawnProcess });
  return { servico, celular, comandos, eventos, filhos, lancamentos };
}

test('start: caminho feliz devolve o nome e a taxa, emite os dois status e monta o codificador com a taxa pedida', async () => {
  const { servico, eventos, lancamentos } = montar();
  const resposta = await servico.start({ sampleRate: 44100, fps: 24.4 });
  try {
    assert.deepStrictEqual(resposta, { ok: true, deviceName: 'iPhone teste', sampleRate: 44100 });
    assert.deepStrictEqual(eventos.map(([nome, dados]) => [nome, dados.status, dados.error, dados.destination]), [
      ['camlive:status', 'Preparando iPhone por USB…', '', 'iphone'],
      ['camlive:status', 'Aguardando fonte', '', 'iphone'],
    ]);
    assert.deepStrictEqual([servico.running, servico.starting, servico.active, servico.fps, servico.sampleRate, servico.deviceId], [true, false, false, 24, 44100, 'ios-a']);
    const codificador = lancamentos.find((l) => l.arquivo === '/ffmpeg-falso');
    assert.deepStrictEqual(codificador.argumentos, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-probesize', '32', '-analyzeduration', '0', '-f', 's16le', '-ar', '44100', '-ac', '1', '-i', 'pipe:0', '-vn', '-c:a', 'aac', '-profile:a', 'aac_low', '-ar', '44100', '-ac', '1', '-b:a', '96k', '-flush_packets', '1', '-f', 'adts', 'pipe:1']);
    assert.deepStrictEqual(codificador.opcoes, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const tunel = lancamentos.find((l) => l.arquivo === 'ssh-falso');
    assert.deepStrictEqual(tunel.argumentos.filter((_, i) => i !== tunel.argumentos.length - 2), ['-p', '2222', '-i', 'chave-falsa', '-v', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=5', '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=5', '-o', 'ServerAliveCountMax=2', '-N', '-R', 'mobile@127.0.0.1']);
    assert.match(tunel.argumentos.at(-2), /^\/var\/tmp\/\.nb-[0-9a-f]{8}\.sock:127\.0\.0\.1:\d+$/);
    assert.deepStrictEqual(tunel.opcoes, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  } finally {
    await servico.stop();
  }
});

test('start: o fps e a taxa seguem os limites e os padrões', async () => {
  for (const [entrada, esperado] of [[undefined, 30], [0, 30], [-5, 1], [99, 30], [0.4, 1], ['12', 12], ['x', 30]]) {
    const { servico } = montar();
    const resposta = await servico.start({ fps: entrada });
    assert.strictEqual(resposta.sampleRate, 48000);
    assert.strictEqual(servico.fps, esperado, String(entrada));
    await servico.stop();
  }
  const { servico } = montar();
  for (const taxa of [1, 44000, 48001, 192000]) {
    assert.deepStrictEqual(await servico.start({ sampleRate: taxa }), { ok: false, error: 'Taxa de áudio da fonte não suportada.' }, String(taxa));
  }
  for (const taxa of [8000, 11025, 16000, 22050, 24000, 32000, 88200, 96000]) {
    const { servico: outro } = montar();
    assert.strictEqual((await outro.start({ sampleRate: taxa })).ok, true, String(taxa));
    await outro.stop();
  }
});

test('start: o nome padrão, ios- no id, e as recusas de aparelho e de estado da ponte', async () => {
  const semNome = montar({ dispositivos: [{ id: 'ios-z' }] });
  assert.strictEqual((await semNome.servico.start()).deviceName, 'iPhone');
  await semNome.servico.stop();
  const porPrefixo = montar({ dispositivos: [{ id: 'ios-b' }, { id: 'android-1' }] });
  assert.strictEqual((await porPrefixo.servico.start()).ok, true);
  await porPrefixo.servico.stop();

  const erro = async (opcoes, configuracao) => {
    const { servico } = montar(opcoes);
    const { error } = await servico.start(configuracao);
    await servico.stop();
    return error;
  };
  assert.strictEqual(await erro({ dispositivos: [] }), 'Conecte exatamente um iPhone por USB para transmitir.');
  assert.strictEqual(await erro({ dispositivos: [{ id: 'ios-a' }, { id: 'ios-b' }] }), 'Conecte exatamente um iPhone por USB para transmitir.');
  assert.strictEqual(await erro({}, { deviceId: 'ios-outro' }), 'O iPhone selecionado não corresponde ao único dispositivo conectado.');
  const exigeBridge = 'A ponte de câmera precisa ser a versão 0.1-39 (transporte camuflado) com os hooks de foto prontos. Use Conectar em PHONE CONTROL para atualizar/preparar o iPhone.';
  for (const estado of [{ ...PRONTO, version: '0.1-38' }, { ...PRONTO, version: 'x' }, { ...PRONTO, hooksReady: false }, { ...PRONTO, faulted: true }, { ...PRONTO, photoPrepareHookReady: false }, { ...PRONTO, photoStillHookReady: false }, { ...PRONTO, photoPortRemapHookReady: false }]) {
    assert.strictEqual(await erro({ estado }), exigeBridge, JSON.stringify(estado));
  }
  const nova = montar({ estado: { ...PRONTO, version: '0.1-120' } });
  assert.strictEqual((await nova.servico.start()).ok, true);
  await nova.servico.stop();
  assert.strictEqual(await erro({ ssh: (comando) => (comando.startsWith('cat ') ? { ok: false } : null) }), 'iPhone sem acesso SSH. Use Conectar em PHONE CONTROL e confira o cabo USB.');
  assert.strictEqual(await erro({ ssh: (comando) => (comando.startsWith('cat ') ? { ok: true, stdout: '{quebrado' } : null) }), 'A ponte do iPhone não retornou um status válido. Reconecte em PHONE CONTROL.');
});

test('start: sem celular, com transmissão em curso e com preparação em andamento', async () => {
  const semCelular = new CamLiveIphone({ getMobileService: () => null, ffmpegPath: 'x' });
  assert.deepStrictEqual(await semCelular.start(), { ok: false, error: 'Abra PHONE CONTROL e conecte o iPhone antes de transmitir.' });
  assert.deepStrictEqual([semCelular.status, semCelular.error, semCelular.running, semCelular.starting], ['Pronto', 'Abra PHONE CONTROL e conecte o iPhone antes de transmitir.', false, false]);

  const { servico, eventos } = montar();
  const primeira = servico.start();
  assert.deepStrictEqual(await servico.start(), { ok: false, error: 'Aguarde a preparação ou parada da transmissão anterior.' });
  assert.strictEqual((await primeira).ok, true);
  assert.deepStrictEqual(await servico.start(), { ok: false, error: 'O CAM LIVE já está preparando ou transmitindo para o iPhone.' });
  const emitidos = eventos.length;
  await servico.stop();
  assert.strictEqual(eventos.length, emitidos);
  assert.strictEqual(servico.status, 'Pronto');
  const falho = montar({ dispositivos: [] });
  await falho.servico.start();
  assert.deepStrictEqual(falho.eventos.at(-1), ['camlive:status', { status: 'Pronto', error: 'Conecte exatamente um iPhone por USB para transmitir.', destination: 'iphone', finished: true }]);
});

test('stop: devolve ok, é repetível e deixa o serviço pronto, sem celular escrito além do observe', async () => {
  const { servico, comandos } = montar();
  await servico.start();
  const g = servico.generation;
  const [um, dois] = await Promise.all([servico.stop(), servico.stop()]);
  assert.deepStrictEqual([um, dois], [{ ok: true }, { ok: true }]);
  assert.strictEqual(servico.generation, g + 1);
  assert.deepStrictEqual([servico.running, servico.status, servico.media, servico.tunnel, servico.encoder], [false, 'Pronto', null, null, null]);
  assert.deepStrictEqual(await servico.stop(), { ok: true });
  assert.ok(comandos.some((c) => c.startsWith('rm -f')));
});

test('frame: recusa antes de preparar, com texto de hoje, e atualiza a fonte quando aceita', async () => {
  const { servico } = montar();
  assert.deepStrictEqual(servico.frame(Buffer.alloc(4)), { ok: false, error: 'A transmissão USB ainda não está preparada.' });
  await servico.start();
  try {
    assert.deepStrictEqual(servico.frame(Buffer.alloc(4)), { ok: false, error: 'Quadro JPEG inválido ou maior que 2 MiB.' });
    servico.media.frame = () => { throw new Error('quebrou'); };
    assert.deepStrictEqual(servico.frame(Buffer.alloc(4)), { ok: false, error: 'Quadro JPEG inválido.' });
    delete servico.media.frame;
    assert.deepStrictEqual(servico.frame(jpeg(sof(0xc0, 8, 8))), { ok: true });
    assert.strictEqual(servico.media.freshFrame(), true);
  } finally {
    await servico.stop();
  }
});

async function iniciar(opcoes) {
  const montado = montar(opcoes);
  await montado.servico.start();
  const codificador = montado.filhos.find((f, i) => montado.lancamentos[i].arquivo === '/ffmpeg-falso');
  return { ...montado, codificador };
}

test('pcm: as recusas na ordem de hoje e as mensagens', async () => {
  const { servico, codificador } = await iniciar();
  codificador.stdin.on('data', () => {});
  try {
    const par = (bytes) => ({ data: bytes, sampleRate: 48000 });
    assert.deepStrictEqual(await servico.pcm({ data: Buffer.alloc(4), sampleRate: 44100 }), { ok: false, error: 'A taxa do áudio mudou. Pare e inicie novamente o CAM LIVE.' });
    assert.deepStrictEqual(await servico.pcm({ data: Buffer.alloc(4) }), { ok: false, error: 'A taxa do áudio mudou. Pare e inicie novamente o CAM LIVE.' });
    for (const invalido of ['texto', 4, null, undefined, [1, 2]]) assert.deepStrictEqual(await servico.pcm(par(invalido)), { ok: false, error: 'PCM inválido.' });
    for (const tamanho of [0, 1, 3, 64 * 1024 + 2]) assert.deepStrictEqual(await servico.pcm(par(Buffer.alloc(tamanho))), { ok: false, error: 'Bloco de áudio PCM inválido ou excessivo.' }, String(tamanho));
    assert.strictEqual((await servico.pcm(par(Buffer.alloc(64 * 1024)))).ok, true);
    assert.strictEqual((await servico.pcm(par(new Uint8Array(2)))).ok, true);
    const antes = Date.now();
    assert.deepStrictEqual(await servico.pcm(par(Buffer.alloc(2))), { ok: true, backpressure: false });
    assert.ok(servico.pcmAt >= antes);
    servico.pcmWaiting = true;
    assert.deepStrictEqual(await servico.pcm(par(Buffer.alloc(2))), { ok: false, backpressure: true, error: 'Já existe um bloco de áudio aguardando o encoder.' });
    servico.pcmWaiting = false;
    codificador.stdin.destroy();
    assert.deepStrictEqual(await servico.pcm(par(Buffer.alloc(2))), { ok: false, error: 'O encoder de áudio não está preparado.' });
  } finally {
    await servico.stop();
  }
  assert.deepStrictEqual(await servico.pcm({ data: Buffer.alloc(2), sampleRate: 48000 }), { ok: false, error: 'O encoder de áudio não está preparado.' });
});

test('pcm: backpressure espera o drain, desiste em 500 ms, conta o descarte e a escrita que falha vira erro', async () => {
  const { servico, codificador } = await iniciar();
  try {
    const par = { data: Buffer.alloc(2), sampleRate: 48000 };
    servico.pcmBlocked = true;
    const esperando = servico.pcm(par);
    await new Promise((resolver) => setImmediate(resolver));
    assert.strictEqual(servico.pcmWaiting, true);
    codificador.stdin.emit('drain');
    assert.deepStrictEqual(await esperando, { ok: true, backpressure: false });
    assert.deepStrictEqual([servico.pcmBlocked, servico.pcmWaiting, servico.droppedPcm], [false, false, 0]);

    servico.pcmBlocked = true;
    const inicio = Date.now();
    assert.deepStrictEqual(await servico.pcm(par), { ok: false, backpressure: true, error: 'O encoder não liberou o áudio em 500 ms. Pare e inicie novamente o CAM LIVE.' });
    assert.ok(Date.now() - inicio >= 450);
    assert.deepStrictEqual([servico.droppedPcm, servico.pcmWaiting, servico.stats().dropped], [1, false, 1]);

    servico.pcmBlocked = true;
    const fechando = servico.pcm(par);
    await new Promise((resolver) => setImmediate(resolver));
    codificador.stdin.emit('close');
    assert.strictEqual((await fechando).backpressure, true);
    assert.strictEqual(servico.droppedPcm, 2);

    servico.pcmBlocked = false;
    codificador.stdin.write = () => { throw new Error('pipe quebrado'); };
    assert.deepStrictEqual(await servico.pcm(par), { ok: false, error: 'Não foi possível enviar o áudio ao encoder.' });
    codificador.stdin.write = () => false;
    assert.deepStrictEqual(await servico.pcm(par), { ok: true, backpressure: true });
    assert.strictEqual(servico.pcmBlocked, true);
    codificador.stdin.emit('drain');
    assert.strictEqual(servico.pcmBlocked, false);
  } finally {
    await servico.stop();
  }
});

test('_updateSource: AO VIVO só com quadro, áudio e PCM recentes; muda e emite apenas na troca', async () => {
  const { servico, eventos } = await iniciar();
  try {
    const token = servico.generation;
    const antes = eventos.length;
    servico._updateSource(token);
    assert.strictEqual(eventos.length, antes);
    servico.media.frame(jpeg(sof(0xc0, 8, 8)));
    servico.media.audioPacket(Buffer.from([1]));
    servico._updateSource(token);
    assert.strictEqual(servico.active, false);
    servico.pcmAt = Date.now() - 2001;
    servico._updateSource(token);
    assert.strictEqual(servico.active, false);
    servico.pcmAt = Date.now() - 1990;
    servico._updateSource(token);
    assert.deepStrictEqual([servico.active, servico.status], [true, 'AO VIVO']);
    assert.deepStrictEqual(eventos.at(-1), ['camlive:status', { status: 'AO VIVO', error: '', destination: 'iphone' }]);
    const total = eventos.length;
    servico._updateSource(token);
    assert.strictEqual(eventos.length, total);
    servico._updateSource(token + 1);
    servico.media.latestFrame = null;
    servico._updateSource(token + 1);
    assert.strictEqual(servico.active, true);
    servico._updateSource(token);
    assert.deepStrictEqual([servico.active, servico.status], [false, 'Aguardando fonte']);
    servico.pcmAt = 0;
    servico.running = false;
    servico._updateSource(token);
    assert.strictEqual(servico.status, 'Aguardando fonte');
  } finally {
    servico.running = true;
    await servico.stop();
  }
});

test('o pacote AAC do codificador alimenta o áudio, atualiza a fonte e um erro do codificador encerra a sessão', async () => {
  const { servico, codificador, eventos } = await iniciar();
  servico.media.frame(jpeg(sof(0xc0, 8, 8)));
  servico.pcmAt = Date.now();
  codificador.stdout.write(adts(Buffer.from([1, 2, 3])));
  await new Promise((resolver) => setTimeout(resolver, 20));
  assert.strictEqual(servico.media.audio.length, 1);
  assert.strictEqual(servico.active, true);
  codificador.stdout.write(Buffer.alloc(7));
  await new Promise((resolver) => setTimeout(resolver, 30));
  assert.deepStrictEqual([servico.running, servico.error], [false, 'Encoder retornou áudio sem cabeçalho ADTS válido.']);
  assert.deepStrictEqual(eventos.at(-1)[1], { status: 'Pronto', error: 'Encoder retornou áudio sem cabeçalho ADTS válido.', destination: 'iphone', finished: true });
});

test('o encoder: erro de entrada derruba a sessão; saída e erro depois do spawn também', async () => {
  const entrada = await iniciar();
  entrada.codificador.stdin.emit('error', new Error('x'));
  await new Promise((resolver) => setTimeout(resolver, 30));
  assert.deepStrictEqual([entrada.servico.running, entrada.servico.error], [false, 'A entrada de áudio do CAM LIVE foi interrompida.']);

  const saida = await iniciar();
  saida.codificador.stderr.write('mensagem do ffmpeg');
  saida.codificador.emit('exit', 1);
  await new Promise((resolver) => setTimeout(resolver, 30));
  assert.strictEqual(saida.servico.error, 'O encoder de áudio do CAM LIVE foi encerrado. mensagem do ffmpeg');

  const erro = await iniciar();
  erro.codificador.emit('error', new Error('x'));
  await new Promise((resolver) => setTimeout(resolver, 30));
  assert.strictEqual(erro.servico.error, 'Não foi possível iniciar o encoder de áudio incluído no Nova.');
});

test('start: o encoder que não sobe devolve a mensagem certa e deixa tudo fechado', async () => {
  const porErro = montar({ codificador: 'erro' });
  assert.deepStrictEqual(await porErro.servico.start(), { ok: false, error: 'Não foi possível iniciar o encoder de áudio incluído no Nova.' });
  const porSaida = montar({ codificador: 'saida' });
  assert.deepStrictEqual(await porSaida.servico.start(), { ok: false, error: 'O encoder de áudio do CAM LIVE foi encerrado. falhou assim' });
  for (const { servico, filhos } of [porErro, porSaida]) {
    assert.deepStrictEqual([servico.media, servico.tunnel, servico.encoder, servico.running, servico.status], [null, null, null, false, 'Pronto']);
    assert.ok(filhos.every((f) => f.morto));
  }
  const semFfmpeg = montar({ ffmpeg: null });
  assert.deepStrictEqual(await semFfmpeg.servico.start(), { ok: false, error: 'FFmpeg não está incluído no Nova. Reinstale o aplicativo completo.' });
});

test('túnel: a mensagem muda conforme a falha, e o erro do spawn do ssh tem texto próprio', async () => {
  const ocupado = montar({ tunel: 'ocupado' });
  assert.strictEqual((await ocupado.servico.start()).error, 'O endereço de câmera do iPhone está ocupado por outra transmissão. Encerre-a antes de iniciar o CAM LIVE.');
  const encerrado = montar({ tunel: 'encerra' });
  assert.strictEqual((await encerrado.servico.start()).error, 'O túnel USB foi encerrado. Reconecte o iPhone em PHONE CONTROL.');
  const comErro = montar({ tunel: 'erro' });
  assert.strictEqual((await comErro.servico.start()).error, 'Não foi possível iniciar o túnel SSH por USB. Use Conectar em PHONE CONTROL.');
});

test('socket Unix recusado: mata o primeiro túnel, apaga o socket sem esperar e abre TCP; três falhas de TCP devolvem o último erro', async () => {
  const { servico, celular, comandos, filhos } = montar({ unixFalha: true });
  servico.mobile = celular;
  const transporte = await servico._camouflagedForward(55);
  assert.strictEqual(transporte.type, 'tcp');
  assert.strictEqual(filhos[0].novaAbort, true);
  assert.strictEqual(filhos[0].morto, true);
  assert.strictEqual(servico.socketPath, null);
  assert.strictEqual(servico.remotePort, transporte.port);
  assert.ok(comandos.some((c) => /^rm -f '\/var\/tmp\/\.nb-[0-9a-f]{8}\.sock'$/.test(c)));
  await servico.closeTransport();

  const todasFalham = montar();
  todasFalham.servico._openForward = async () => { throw new Error(`falha ${++todasFalham.tentativas}`); };
  todasFalham.tentativas = 0;
  await assert.rejects(todasFalham.servico._tcpForward(9), { message: 'falha 3' });
  assert.strictEqual(todasFalham.tentativas, 3);
  todasFalham.servico._openForward = () => Promise.reject();
  await assert.rejects(todasFalham.servico._tcpForward(9, 0), { message: 'Não foi possível abrir o túnel do iPhone.' });
});

test('closeTransport: espera o túnel sair, não espera mais de 1,5 s, ignora túnel já encerrado e erro ao apagar o socket', async () => {
  const { servico, celular } = montar();
  celular.iosSsh = async () => { throw new Error('sem ssh'); };
  const saiu = filho();
  saiu.kill = () => queueMicrotask(() => saiu.emit('exit'));
  Object.assign(servico, { tunnel: saiu, socketPath: '/var/tmp/.nb-aaaaaaaa.sock', transport: { type: 'unix' }, frameUrl: 'u', media: new UsbMedia() });
  await servico.closeTransport();
  assert.deepStrictEqual([servico.tunnel, servico.media, servico.socketPath, servico.transport, servico.frameUrl], [null, null, null, null, null]);

  const teimoso = filho();
  let mortes = 0;
  teimoso.kill = () => { mortes++; };
  servico.tunnel = teimoso;
  const inicio = Date.now();
  await servico.closeTransport();
  assert.ok(Date.now() - inicio >= 1400 && Date.now() - inicio < 2500);
  assert.strictEqual(mortes, 1);
  assert.strictEqual(teimoso.listenerCount('exit'), 0);

  const terminado = filho();
  terminado.exitCode = 0;
  terminado.kill = () => { mortes++; };
  servico.tunnel = terminado;
  await servico.closeTransport();
  const sinalizado = filho();
  sinalizado.signalCode = 'SIGTERM';
  sinalizado.kill = () => { mortes++; };
  servico.tunnel = sinalizado;
  await servico.closeTransport();
  assert.strictEqual(mortes, 1);
  await servico.closeTransport();
});

test('setCameraEnabled: liga o transporte antes de gravar, só fecha se ninguém mais usa, e o erro da gravação volta', async () => {
  const { servico } = montar();
  const gravacoes = [];
  await servico.setCameraEnabled(true, async () => { gravacoes.push(servico.media !== null); });
  assert.deepStrictEqual(gravacoes, [true]);
  assert.strictEqual(servico.cameraEnabled, true);
  assert.notStrictEqual(servico.media, null);
  await servico.setCameraEnabled(false, async () => gravacoes.push('desliga'));
  assert.strictEqual(servico.cameraEnabled, false);
  assert.strictEqual(servico.media, null);

  await assert.rejects(servico.setCameraEnabled(true, async () => { throw new Error('gravação falhou'); }), { message: 'gravação falhou' });
  assert.strictEqual(servico.cameraEnabled, false);
  assert.strictEqual(servico.media, null);

  const viva = montar();
  await viva.servico.start();
  await viva.servico.setCameraEnabled(false, async () => {});
  assert.notStrictEqual(viva.servico.media, null);
  await viva.servico.stop();
});

test('ensureTransport: já existente não refaz; libera a porta, pausa o heartbeat e escreve observe na câmera', async () => {
  const { servico, celular } = montar();
  const chamadas = [];
  const camera = {
    liberarPortaCamera: async () => chamadas.push('liberar'),
    suspenderHeartbeatLocal: () => { chamadas.push('suspender'); throw new Error('ignorado'); },
    writeControl: async (config) => { chamadas.push(['controle', config]); throw new Error('ignorado'); },
  };
  celular.iosCamera = () => camera;
  await servico.ensureTransport();
  assert.deepStrictEqual(chamadas, ['liberar', 'suspender', ['controle', { mode: 'observe' }]]);
  const midia = servico.media;
  await servico.ensureTransport();
  assert.strictEqual(servico.media, midia);
  assert.strictEqual(chamadas.length, 3);
  await servico.closeTransport();
});

test('mediaEndpoint, stats e snapshot', async () => {
  const { servico } = montar();
  assert.deepStrictEqual(servico.mediaEndpoint(), { url: null, socket: null });
  assert.deepStrictEqual(servico.stats(), { destination: 'iphone', status: 'Pronto', active: false, fps: 30, queued: 0, dropped: 0, deviceName: '', frameFresh: false, audioFresh: false, transport: '' });
  assert.deepStrictEqual(servico.snapshot(), { ...servico.stats(), error: '', running: false });
  await servico.start();
  try {
    assert.strictEqual(servico.stats().transport, 'unix');
    assert.strictEqual(servico.stats().deviceName, 'iPhone teste');
    servico.media.audioPacket(Buffer.from([1]));
    assert.deepStrictEqual([servico.stats().queued, servico.stats().audioFresh, servico.snapshot().running], [1, true, true]);
    assert.match(servico.mediaEndpoint().socket, /^\/var\/tmp\/\.nb-[0-9a-f]{8}\.sock$/);
  } finally {
    await servico.stop();
  }
});

test('só os últimos 4096 bytes do stderr do túnel e 2048 do encoder entram nas mensagens de erro', async () => {
  const tunel = montar({ tunel: 'ruidoso' });
  assert.strictEqual((await tunel.servico.start()).error, 'O túnel USB foi encerrado. Reconecte o iPhone em PHONE CONTROL.');
  const { error } = await montar({ codificador: 'ruidoso' }).servico.start();
  const texto = error.replace('O encoder de áudio do CAM LIVE foi encerrado. ', '');
  assert.strictEqual(texto.length, 2048);
  assert.strictEqual(texto, `${'a'.repeat(1036)}${'b'.repeat(1000)}falhou assim`);
});
