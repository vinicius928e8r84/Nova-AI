'use strict';

const test = require('node:test');
const { mock } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');
const { PassThrough } = require('node:stream');

const CAMINHO_DO_SERVICO = require.resolve('../rtmp-server');
const CONFIGURACAO_DO_SERVIDOR = {
  bind: '127.0.0.1',
  rtmp: { port: 11935, chunk_size: 60000, gop_cache: true, ping: 30, ping_timeout: 60 },
};
const ARGUMENTOS_DO_FFMPEG = [
  '-y', '-i', 'pipe:0', '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
  '-b:v', '2500k', '-maxrate', '3000k', '-bufsize', '3000k', '-g', '30', '-keyint_min', '30',
  '-f', 'flv', 'rtmp://127.0.0.1:11935/live/nova',
];

const proximoTurno = () => new Promise((resolve) => setImmediate(resolve));

const falsos = {};
const carregarOriginal = Module._load;
Module._load = function (pedido, ...resto) {
  return pedido in falsos ? falsos[pedido] : carregarOriginal.call(this, pedido, ...resto);
};
test.after(() => { Module._load = carregarOriginal; });

function ffmpegFalso(pid = 4321) {
  const processo = new EventEmitter();
  Object.assign(processo, { pid, stdin: new PassThrough(), stderr: new EventEmitter(), sinais: [] });
  processo.entrada = [];
  processo.stdin.on('data', (pedaco) => processo.entrada.push([...pedaco]));
  processo.kill = (sinal) => { processo.sinais.push(sinal); };
  return processo;
}

function montar({ plataforma = 'linux', caminhoDoFfmpeg = process.execPath, execucao } = {}) {
  const registro = { spawn: [], exec: [], execFile: [], servidores: [], mensagens: [] };
  const processos = [];
  const NodeMediaServer = class {
    constructor(configuracao) {
      this.estado = ['criado'];
      registro.servidores.push({ configuracao, estado: this.estado });
      if (NodeMediaServer.falhar) throw new Error('porta ocupada');
    }
    run() { this.estado.push('rodando'); }
    stop() { this.estado.push('parado'); }
  };
  falsos['node-media-server'] = NodeMediaServer;
  falsos.child_process = {
    spawn: (arquivo, argumentos) => {
      const processo = ffmpegFalso(4321 + processos.length);
      processos.push(processo);
      registro.spawn.push([arquivo, argumentos]);
      return processo;
    },
    exec: execucao || ((comando, retorno) => { registro.exec.push(comando); retorno(null); }),
    execFile: (...argumentos) => registro.execFile.push(argumentos.slice(0, 3)),
  };
  falsos['./tool-paths'] = { ffmpeg: () => caminhoDoFfmpeg };
  const originalDaPlataforma = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: plataforma, configurable: true });
  const consoleOriginal = { log: console.log, info: console.info, warn: console.warn, error: console.error };
  const nivelRegistrado = { log: 'log', info: 'log', warn: 'warn', error: 'error' };
  for (const nivel of Object.keys(consoleOriginal)) {
    console[nivel] = (...partes) => registro.mensagens.push([nivelRegistrado[nivel], ...partes.map((p) => (p instanceof Error ? p.message : p))]);
  }
  delete require.cache[CAMINHO_DO_SERVICO];
  const servico = require(CAMINHO_DO_SERVICO);
  const desmontar = () => {
    Object.defineProperty(process, 'platform', originalDaPlataforma);
    Object.assign(console, consoleOriginal);
    delete require.cache[CAMINHO_DO_SERVICO];
    for (const chave of Object.keys(falsos)) delete falsos[chave];
  };
  return { servico, registro, processos, NodeMediaServer, desmontar };
}

async function comServico(opcoes, cena) {
  const ambiente = montar(opcoes);
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    await cena(ambiente);
  } finally {
    mock.timers.reset();
    ambiente.desmontar();
  }
}

test('o servidor RTMP local sobe uma vez só na porta 11935 e desliga', () => comServico({}, ({ servico, registro }) => {
  servico.stopRtmpServer();
  servico.startRtmpServer();
  servico.startRtmpServer();
  assert.deepEqual(registro.servidores.map((s) => [s.configuracao, s.estado]), [[CONFIGURACAO_DO_SERVIDOR, ['criado', 'rodando']]]);
  servico.stopRtmpServer();
  servico.stopRtmpServer();
  assert.deepEqual(registro.servidores[0].estado, ['criado', 'rodando', 'parado']);
  assert.deepEqual(registro.mensagens, [
    ['log', '[RTMP] Node Media Server started on port 11935 (1935 é do MediaMTX neste Mac)'],
    ['log', '[RTMP] Node Media Server stopped'],
  ]);
}));

test('o servidor RTMP que não sobe só registra o erro e tenta de novo na próxima chamada', () => comServico({}, ({ servico, registro, NodeMediaServer }) => {
  NodeMediaServer.falhar = true;
  servico.startRtmpServer();
  NodeMediaServer.falhar = false;
  servico.startRtmpServer();
  assert.deepEqual(registro.mensagens, [
    ['error', '[RTMP] Error starting server:', 'porta ocupada'],
    ['log', '[RTMP] Node Media Server started on port 11935 (1935 é do MediaMTX neste Mac)'],
  ]);
  assert.deepEqual(registro.servidores.map((s) => s.estado), [['criado'], ['criado', 'rodando']]);
}));

test('a transmissão abre o ffmpeg com os argumentos de sempre e leva o adb reverse junto', () => comServico({}, async ({ servico, registro, processos }) => {
  assert.equal(await servico.startBroadcast(process.execPath), true);
  assert.deepEqual(registro.spawn, [[process.execPath, ARGUMENTOS_DO_FFMPEG]]);
  assert.deepEqual(registro.execFile, [[process.execPath, ['reverse', 'tcp:1935', 'tcp:11935'], { windowsHide: true }]]);
  assert.deepEqual(registro.mensagens, [['log', '[RTMP] Starting FFmpeg broadcaster stream to rtmp://127.0.0.1:11935/live/nova']]);
  assert.equal(processos.length, 1);
}));

test('sem ffmpeg achado ou com o caminho inexistente a transmissão cai no ffmpeg do PATH', async () => {
  for (const caminhoDoFfmpeg of [null, '', '/nao/existe/ffmpeg']) {
    await comServico({ caminhoDoFfmpeg }, async ({ servico, registro }) => {
      await servico.startBroadcast();
      assert.deepEqual(registro.spawn.map(([arquivo]) => arquivo), ['ffmpeg']);
      assert.deepEqual(registro.execFile.map(([arquivo]) => arquivo), ['adb']);
    });
  }
});

test('os pedaços de vídeo vão para a entrada do ffmpeg, e sem transmissão são largados', () => comServico({}, async ({ servico, processos }) => {
  servico.receiveVideoChunk(Buffer.from([9]));
  await servico.startBroadcast();
  servico.receiveVideoChunk(Buffer.from([1, 2, 3]));
  servico.receiveVideoChunk(new Uint8Array([4, 5]).buffer);
  servico.receiveVideoChunk([6, 7]);
  await proximoTurno();
  assert.deepEqual(processos[0].entrada, [[1, 2, 3], [4, 5], [6, 7]]);
}));

test('o ffmpeg que termina sozinho libera a transmissão e o próximo stop volta na hora', () => comServico({}, async ({ servico, registro, processos }) => {
  await servico.startBroadcast();
  processos[0].emit('close', 1);
  assert.deepEqual(registro.mensagens.at(-1), ['log', '[FFMPEG RTMP] Process exited with code 1']);
  assert.equal(await servico.stopBroadcast(), true);
  assert.deepEqual(processos[0].sinais, []);
}));

test('stop sem transmissão responde true sem matar nada', () => comServico({}, async ({ servico, registro }) => {
  assert.equal(await servico.stopBroadcast(), true);
  assert.deepEqual(registro.mensagens, []);
}));

const FIM_DO_FFMPEG = [
  ['close', (processo) => processo.emit('close', 0)],
  ['exit', (processo) => processo.emit('exit', 0)],
  ['os dois eventos', (processo) => { processo.emit('exit', 0); processo.emit('close', 0); }],
];

for (const [nome, terminar] of FIM_DO_FFMPEG) {
  test(`stop no Unix mata o ffmpeg com SIGKILL e responde quando vem ${nome}`, () => comServico({}, async ({ servico, registro, processos }) => {
    await servico.startBroadcast();
    const parada = servico.stopBroadcast();
    assert.deepEqual(processos[0].sinais, ['SIGKILL']);
    terminar(processos[0]);
    assert.equal(await parada, true);
    await proximoTurno();
    assert.equal(processos[0].stdin.writableEnded, true);
    assert.deepEqual(registro.mensagens.filter(([, texto]) => texto === '[RTMP] Stopped FFmpeg broadcaster stream').length, 1);
    assert.deepEqual(registro.exec, []);
    assert.equal(await servico.stopBroadcast(), true);
    assert.deepEqual(processos[0].sinais, ['SIGKILL']);
  }));
}

test('stop responde sozinho depois de 1 segundo se o ffmpeg não avisar e libera a transmissão', () => comServico({}, async ({ servico, registro, processos }) => {
  await servico.startBroadcast();
  let respondeu = false;
  const parada = servico.stopBroadcast().then((valor) => { respondeu = valor; });
  mock.timers.tick(999);
  await Promise.resolve();
  assert.equal(respondeu, false);
  mock.timers.tick(1);
  await parada;
  assert.equal(respondeu, true);
  assert.deepEqual(registro.mensagens.at(-1), ['log', '[RTMP] Stopped FFmpeg broadcaster stream']);
  await servico.stopBroadcast();
  assert.deepEqual(processos[0].sinais, ['SIGKILL']);
}));

test('stop no Windows usa o taskkill pelo pid e não chama kill quando ele funciona', () => comServico({ plataforma: 'win32' }, async ({ servico, registro, processos }) => {
  await servico.startBroadcast();
  const parada = servico.stopBroadcast();
  processos[0].emit('close', 0);
  assert.equal(await parada, true);
  assert.deepEqual(registro.exec, ['taskkill /F /PID 4321']);
  assert.deepEqual(processos[0].sinais, []);
}));

test('stop no Windows cai para kill SIGKILL quando o taskkill falha, e avisa', () => comServico({
  plataforma: 'win32',
  execucao: (comando, retorno) => retorno(new Error('negado')),
}, async ({ servico, registro, processos }) => {
  await servico.startBroadcast();
  const parada = servico.stopBroadcast();
  assert.deepEqual(processos[0].sinais, ['SIGKILL']);
  assert.deepEqual(registro.mensagens.at(-1), ['warn', '[RTMP] taskkill failed for PID 4321, falling back to kill()']);
  processos[0].emit('close', 0);
  assert.equal(await parada, true);
}));

test('stop no Windows cai para kill SIGKILL quando o exec lança', () => comServico({
  plataforma: 'win32',
  execucao: () => { throw new Error('sem cmd'); },
}, async ({ servico, processos }) => {
  await servico.startBroadcast();
  const parada = servico.stopBroadcast();
  assert.deepEqual(processos[0].sinais, ['SIGKILL']);
  processos[0].emit('exit', 0);
  assert.equal(await parada, true);
}));

test('stop no Windows: o taskkill que falha depois do fim do ffmpeg não mata nada', () => comServico({
  plataforma: 'win32',
  execucao: (comando, retorno) => setImmediate(retorno, new Error('tarde')),
}, async ({ servico, registro, processos }) => {
  await servico.startBroadcast();
  const parada = servico.stopBroadcast();
  processos[0].emit('close', 0);
  assert.equal(await parada, true);
  await proximoTurno();
  await proximoTurno();
  assert.deepEqual(processos[0].sinais, []);
  assert.deepEqual(registro.mensagens.at(-1), ['warn', '[RTMP] taskkill failed for PID 4321, falling back to kill()']);
}));

test('iniciar de novo com transmissão aberta para a anterior antes de abrir a nova', () => comServico({}, async ({ servico, registro, processos }) => {
  await servico.startBroadcast();
  const segunda = servico.startBroadcast();
  assert.deepEqual(processos[0].sinais, ['SIGKILL']);
  processos[0].emit('close', 0);
  assert.equal(await segunda, true);
  assert.equal(processos.length, 2);
  assert.deepEqual(registro.spawn.map(([, argumentos]) => argumentos), [ARGUMENTOS_DO_FFMPEG, ARGUMENTOS_DO_FFMPEG]);
  servico.receiveVideoChunk(Buffer.from([8]));
  await proximoTurno();
  assert.deepEqual(processos.map((p) => p.entrada), [[], [[8]]]);
}));
