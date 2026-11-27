'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');
const { EventEmitter } = require('events');
const { PassThrough, Writable } = require('stream');

const toolPaths = require('../tool-paths');
const iphoneSsh = require('../iphone-ssh');

const CAMINHO_DA_CAMERA = require.resolve('../ios-camera');
const ORIGINAIS = {
  spawn: childProcess.spawn,
  execFile: childProcess.execFile,
  exigirOpenssh: toolPaths.exigirOpenssh,
  ffmpeg: toolPaths.ffmpeg,
  sshOptions: iphoneSsh.sshOptions,
};

const PRONTO = { version: '0.1-39', hooksReady: true, enabled: false, timestamp: 1000 };
const OPCOES_SSH = ['-p', '2222', '-i', 'chave-falsa', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', '-o', 'StrictHostKeyChecking=accept-new'];
const JPEG = Buffer.from([255, 216, 1, 2, 3, 255, 217]);
const APPS = ['*', 'com.apple.camera', 'com.apple.WebKit.GPU', 'com.apple.mobilesafari', 'com.apple.facetime'];

function filhoFalso() {
  const filho = new EventEmitter();
  filho.stdout = new PassThrough();
  filho.stderr = new PassThrough();
  filho.mortes = 0;
  filho.kill = () => { filho.mortes++; };
  return filho;
}

function normalizar(texto) {
  return String(texto)
    .replace(/\.nbi-[0-9a-f]{8}\.sock/g, '.nbi-X.sock')
    .replace(/\/s\/[0-9a-f]{32}\//g, '/s/TOKEN/')
    .replace(/127\.0\.0\.1:\d+/g, '127.0.0.1:PORTA');
}

function prepararAmbiente({ aoAbrirTunel = () => {}, aoAbrirDecoder = () => {} } = {}) {
  const diario = [];
  const filhos = [];
  childProcess.spawn = (arquivo, argumentos, opcoes) => {
    const filho = filhoFalso();
    filhos.push({ arquivo, argumentos, opcoes, filho });
    diario.push(['spawn', arquivo, argumentos.map(normalizar), opcoes]);
    if (arquivo === 'ssh-falso') aoAbrirTunel(argumentos, filho, filhos.length);
    else aoAbrirDecoder(argumentos, filho);
    return filho;
  };
  toolPaths.exigirOpenssh = (nome) => `${nome}-falso`;
  toolPaths.ffmpeg = () => 'ffmpeg-falso';
  iphoneSsh.sshOptions = () => ['-i', 'chave-falsa'];
  delete require.cache[CAMINHO_DA_CAMERA];
  const IosCamera = require('../ios-camera');
  return { IosCamera, diario, filhos };
}

function restaurarAmbiente() {
  childProcess.spawn = ORIGINAIS.spawn;
  childProcess.execFile = ORIGINAIS.execFile;
  toolPaths.exigirOpenssh = ORIGINAIS.exigirOpenssh;
  toolPaths.ffmpeg = ORIGINAIS.ffmpeg;
  iphoneSsh.sshOptions = ORIGINAIS.sshOptions;
  delete require.cache[CAMINHO_DA_CAMERA];
}

test.afterEach(restaurarAmbiente);

function camera(IosCamera, diario, { estado = PRONTO, respostas = () => '', servico = {} } = {}) {
  const instancia = new IosCamera(servico);
  instancia.ssh = async (comando) => {
    diario.push(['ssh', normalizar(comando)]);
    const resposta = respostas(comando);
    if (resposta instanceof Error) throw resposta;
    if (comando === 'cat /var/tmp/obs-graph-bridge-status.json') return JSON.stringify(estado);
    return resposta;
  };
  instancia.writeControl = async (configuracao) => { diario.push(['controle', JSON.parse(normalizar(JSON.stringify(configuracao)).replace(/"novaSequestroSession":"[0-9a-f]{16}"/, '"novaSequestroSession":"SESSAO"'))]); };
  return instancia;
}

function clienteFalso({ destruido = false, terminado = false, pendente = 0 } = {}) {
  const escritas = [];
  const cliente = new Writable({ write: (parte, codificacao, pronto) => pronto() });
  cliente.escritas = escritas;
  cliente.write = (parte) => { escritas.push(parte); return true; };
  Object.defineProperty(cliente, 'destroyed', { value: destruido });
  Object.defineProperty(cliente, 'writableEnded', { value: terminado });
  Object.defineProperty(cliente, 'writableLength', { value: pendente });
  cliente.fim = 0;
  cliente.end = () => { cliente.fim++; };
  return cliente;
}

test('o construtor sorteia um token de 32 hexadecimais e monta o caminho do quadro', () => {
  const { IosCamera } = prepararAmbiente();
  const instancia = new IosCamera({ nome: 'servico' });
  assert.match(instancia.token, /^[0-9a-f]{32}$/);
  assert.strictEqual(instancia.framePath, `/s/${instancia.token}/frame.jpg`);
  assert.deepStrictEqual([instancia.frame, instancia.frameAt, instancia.transport, instancia.socketPath, instancia.url], [null, 0, null, null, null]);
  assert.deepStrictEqual(instancia.service, { nome: 'servico' });
  assert.strictEqual(instancia.clients.size, 0);
});

test('run: executa com limite de 15 s, 1 MB e janela escondida; devolve a saída e o erro com o stderr aparado', async () => {
  prepararAmbiente();
  const chamadas = [];
  childProcess.execFile = (arquivo, argumentos, opcoes, aoTerminar) => {
    chamadas.push([arquivo, argumentos, opcoes]);
    if (argumentos[0] === 'falha') aoTerminar(new Error('codigo 1'), '', '  detalhe do erro \n');
    else if (argumentos[0] === 'falha-muda') aoTerminar(new Error('so o erro'), '', '');
    else aoTerminar(null, Buffer.from('saida'), '');
  };
  delete require.cache[CAMINHO_DA_CAMERA];
  const instancia = new (require('../ios-camera'))({});
  assert.strictEqual(await instancia.run('x', ['ok']), 'saida');
  await assert.rejects(instancia.run('x', ['falha'], 5), { message: 'detalhe do erro' });
  await assert.rejects(instancia.run('x', ['falha-muda']), { message: 'so o erro' });
  assert.deepStrictEqual(chamadas[0], ['x', ['ok'], { timeout: 15000, maxBuffer: 1024 * 1024, windowsHide: true }]);
  assert.strictEqual(chamadas[1][2].timeout, 5);
});

test('ssh: chama o openssh com as opções fixas e o comando no fim', async () => {
  const { IosCamera } = prepararAmbiente();
  const instancia = new IosCamera({});
  const pedidos = [];
  instancia.run = async (arquivo, argumentos) => { pedidos.push([arquivo, argumentos]); return 'ok'; };
  assert.strictEqual(await instancia.ssh('ls'), 'ok');
  assert.deepStrictEqual(pedidos, [['ssh-falso', [...OPCOES_SSH, 'mobile@127.0.0.1', 'ls']]]);
});

test('status: pronto, desligado, sem gancho, em falha e indisponível', async () => {
  const { IosCamera, diario } = prepararAmbiente();
  const pronto = await camera(IosCamera, diario).status();
  assert.deepStrictEqual(pronto, {
    platform: 'ios', installed: true, active: false, ready: true, bridgeVersion: '0.1-39',
    message: 'Bridge do jailbreak pronto (0.1-39). Toque em Ligar para ativar a câmera.', state: PRONTO,
  });
  const ativo = await camera(IosCamera, diario, { estado: { ...PRONTO, enabled: true, version: '0.1-120' } }).status();
  assert.deepStrictEqual([ativo.active, ativo.ready], [true, true]);
  const mensagemDeAtualizar = 'Bridge não está pronto; atualize por USB (Conectar em PHONE CONTROL).';
  for (const estado of [{ ...PRONTO, version: '0.1-38' }, { ...PRONTO, hooksReady: false }, { ...PRONTO, faulted: true }, { version: 'outra' }, {}]) {
    const resposta = await camera(IosCamera, diario, { estado }).status();
    assert.deepStrictEqual([resposta.ready, resposta.installed, resposta.message], [false, false, mensagemDeAtualizar], JSON.stringify(estado));
  }
  const quebrada = await camera(IosCamera, diario, { respostas: () => new Error('sem ssh') });
  quebrada.ssh = async () => { throw new Error('sem ssh'); };
  assert.deepStrictEqual(await quebrada.status(), { platform: 'ios', installed: false, active: false, error: 'iPhone indisponível por USB/SSH: sem ssh' });
});

test('install: pronto, com o erro do status e sem erro', async () => {
  const { IosCamera, diario } = prepararAmbiente();
  assert.deepStrictEqual(await camera(IosCamera, diario).install(), { platform: 'ios', success: true, message: 'Bridge do jailbreak pronto (0.1-39).' });
  const atrasada = camera(IosCamera, diario, { estado: { version: '0.1-1' } });
  assert.deepStrictEqual(await atrasada.install(), { platform: 'ios', success: false, error: 'Atualize o bridge por USB em PHONE CONTROL (Conectar).' });
  const quebrada = camera(IosCamera, diario);
  quebrada.ssh = async () => { throw new Error('sem ssh'); };
  assert.deepStrictEqual(await quebrada.install(), { platform: 'ios', success: false, error: 'iPhone indisponível por USB/SSH: sem ssh' });
});

test('writeControl: escreve num arquivo temporário e renomeia, com aspas simples escapadas', async () => {
  const { IosCamera } = prepararAmbiente();
  const instancia = new IosCamera({});
  const comandos = [];
  instancia.ssh = async (comando) => { comandos.push(comando); };
  await instancia.writeControl({ mode: "it's" });
  const arquivo = '/var/tmp/obs-graph-bridge-control.json';
  assert.deepStrictEqual(comandos, [`umask 077; printf %s '{"mode":"it'\\''s"}' > ${arquivo}.nova-next && mv ${arquivo}.nova-next ${arquivo}`]);
});

test('pushFrame: só aceita JPEG de 4 bytes a 8 MB e entrega aos clientes que podem receber', () => {
  const { IosCamera } = prepararAmbiente();
  const instancia = new IosCamera({});
  const bom = clienteFalso();
  const destruido = clienteFalso({ destruido: true });
  const terminado = clienteFalso({ terminado: true });
  const cheio = clienteFalso({ pendente: 1024 * 1024 + 1 });
  const limite = clienteFalso({ pendente: 1024 * 1024 });
  for (const cliente of [bom, destruido, terminado, cheio, limite]) instancia.clients.add(cliente);

  for (const invalido of [Buffer.alloc(0), Buffer.from([255, 216, 1]), Buffer.from([0, 216, 1, 2]), Buffer.from([255, 215, 1, 2]), Buffer.alloc(8 * 1024 * 1024 + 1, 255)]) {
    instancia.pushFrame(invalido.toString('base64'));
  }
  assert.strictEqual(instancia.frame, null);
  assert.strictEqual(bom.escritas.length, 0);

  const antes = Date.now();
  instancia.pushFrame(JPEG.toString('base64'));
  assert.deepStrictEqual(instancia.frame, JPEG);
  assert.ok(instancia.frameAt >= antes && instancia.frameAt <= Date.now());
  assert.deepStrictEqual(bom.escritas, [Buffer.concat([Buffer.from(`--nova\r\nContent-Type: image/jpeg\r\nContent-Length: ${JPEG.length}\r\n\r\n`), JPEG, Buffer.from('\r\n')])]);
  assert.deepStrictEqual([destruido.escritas.length, terminado.escritas.length, cheio.escritas.length, limite.escritas.length], [0, 0, 0, 1]);
  assert.deepStrictEqual([...instancia.clients], [bom, cheio, limite]);

  const minimo = Buffer.from([255, 216, 0, 0]);
  instancia.pushFrame(minimo.toString('base64'));
  assert.deepStrictEqual(instancia.frame, minimo);
  const grande = Buffer.alloc(8 * 1024 * 1024, 7);
  grande[0] = 255; grande[1] = 216;
  instancia.pushFrame(grande.toString('base64'));
  assert.strictEqual(instancia.frame.length, 8 * 1024 * 1024);
});

async function pedir(porta, caminho) {
  const resposta = await fetch(`http://127.0.0.1:${porta}${caminho}`);
  const cabecalhos = Object.fromEntries([...resposta.headers].filter(([nome]) => ['content-type', 'cache-control', 'content-length'].includes(nome)));
  return { status: resposta.status, cabecalhos, corpo: Buffer.from(await resposta.arrayBuffer()) };
}

test('serve: 503 sem quadro novo, 200 com o JPEG, 404 no resto, e o stream MJPEG registra o cliente', async () => {
  const { IosCamera } = prepararAmbiente();
  const instancia = new IosCamera({});
  const porta = await instancia.serve();
  try {
    assert.ok(porta > 0);
    assert.deepStrictEqual(await pedir(porta, instancia.framePath), { status: 503, cabecalhos: { 'cache-control': 'no-store' }, corpo: Buffer.from('Indisponível') });
    instancia.pushFrame(JPEG.toString('base64'));
    assert.deepStrictEqual(await pedir(porta, instancia.framePath), { status: 200, cabecalhos: { 'cache-control': 'no-store', 'content-type': 'image/jpeg', 'content-length': String(JPEG.length) }, corpo: JPEG });
    instancia.frameAt -= 1500;
    assert.strictEqual((await pedir(porta, instancia.framePath)).status, 503);
    assert.deepStrictEqual(await pedir(porta, '/outra'), { status: 404, cabecalhos: { 'cache-control': 'no-store' }, corpo: Buffer.from('Não encontrado') });

    const abertos = [];
    const respostas = [];
    for (const caminho of ['/live.mjpg', '/stream']) {
      const pedido = http.get({ host: '127.0.0.1', port: porta, path: caminho }, (resposta) => respostas.push(resposta));
      pedido.on('error', () => {});
      abertos.push(pedido);
    }
    for (let tentativa = 0; tentativa < 50 && instancia.clients.size < 2; tentativa++) await new Promise((resolver) => setTimeout(resolver, 10));
    assert.strictEqual(instancia.clients.size, 2);
    instancia.pushFrame(JPEG.toString('base64'));
    for (let tentativa = 0; tentativa < 50 && respostas.length < 2; tentativa++) await new Promise((resolver) => setTimeout(resolver, 10));
    for (const resposta of respostas) {
      assert.strictEqual(resposta.statusCode, 200);
      assert.strictEqual(resposta.headers['content-type'], 'multipart/x-mixed-replace; boundary=nova');
      assert.strictEqual(resposta.headers['cache-control'], 'no-store');
    }
    assert.strictEqual(respostas.length, 2);
    for (const pedido of abertos) pedido.destroy();
    await new Promise((resolver) => setTimeout(resolver, 50));
    assert.strictEqual(instancia.clients.size, 0);
  } finally {
    await instancia.stop();
  }
  assert.strictEqual(instancia.server, null);
});

test('serve: 503 antes de qualquer quadro, mesmo com o frameAt zerado', async () => {
  const { IosCamera } = prepararAmbiente();
  const instancia = new IosCamera({});
  const porta = await instancia.serve();
  try {
    instancia.frame = JPEG;
    instancia.frameAt = 0;
    assert.strictEqual((await pedir(porta, instancia.framePath)).status, 503);
  } finally {
    await instancia.stop();
  }
});

test('_forwardArgs: opções fixas, -R com o encaminhamento e o destino no fim', () => {
  const { IosCamera } = prepararAmbiente();
  assert.deepStrictEqual(new IosCamera({})._forwardArgs('a:b:c'), [
    ...OPCOES_SSH, '-v', '-N', '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=5', '-o', 'ServerAliveCountMax=2', '-R', 'a:b:c', 'mobile@127.0.0.1',
  ]);
});

test('_openForward: confirma com "remote forward success" e guarda o processo do túnel', async () => {
  const { IosCamera, filhos } = prepararAmbiente({ aoAbrirTunel: (argumentos, filho) => setImmediate(() => filho.stderr.write('debug1: remote forward success for: listen 1')) });
  const instancia = new IosCamera({});
  const filho = await instancia._openForward(['a', 'b']);
  assert.strictEqual(filho, filhos[0].filho);
  assert.strictEqual(instancia.tunnelProcess, filho);
  assert.strictEqual(filho.novaAbort, false);
  assert.deepStrictEqual(filhos[0].opcoes, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  assert.deepStrictEqual(filhos[0].argumentos, ['a', 'b']);
});

test('_openForward: saída antes da confirmação rejeita com o stderr ou com a mensagem padrão e solta o processo', async () => {
  const comTexto = prepararAmbiente({ aoAbrirTunel: (argumentos, filho) => setImmediate(() => { filho.stderr.write('permission denied'); setImmediate(() => filho.emit('exit')); }) });
  const principal = new comTexto.IosCamera({});
  await assert.rejects(principal._openForward([]), { message: 'permission denied' });
  assert.strictEqual(principal.tunnelProcess, null);
  assert.strictEqual(comTexto.filhos[0].filho.mortes, 1);

  const semTexto = prepararAmbiente({ aoAbrirTunel: (argumentos, filho) => setImmediate(() => filho.emit('exit')) });
  await assert.rejects(new semTexto.IosCamera({})._openForward([]), { message: 'Túnel USB encerrado' });

  const comErro = prepararAmbiente({ aoAbrirTunel: (argumentos, filho) => setImmediate(() => filho.emit('error', new Error('spawn ssh ENOENT'))) });
  await assert.rejects(new comErro.IosCamera({})._openForward([]), { message: 'spawn ssh ENOENT' });
});

test('_openForward: depois de confirmado, saída ou erro do túnel desligam a câmera; abortado não', async () => {
  const { IosCamera, filhos } = prepararAmbiente({ aoAbrirTunel: (argumentos, filho) => setImmediate(() => filho.stderr.write('remote forward success')) });
  const instancia = new IosCamera({});
  const falhas = [];
  instancia.fail = (mensagem) => falhas.push(mensagem);
  const primeiro = await instancia._openForward([]);
  primeiro.emit('exit');
  primeiro.emit('error', new Error('caiu'));
  assert.deepStrictEqual(falhas, ['Túnel USB encerrado', 'caiu']);
  const segundo = await instancia._openForward([]);
  segundo.novaAbort = true;
  segundo.emit('exit');
  assert.deepStrictEqual(falhas, ['Túnel USB encerrado', 'caiu']);
  assert.strictEqual(filhos.length, 2);
});

test('_openForward: sem confirmação em 8 s rejeita e mata o processo', async () => {
  const { IosCamera, filhos } = prepararAmbiente();
  const temporizadores = [];
  const originalSetTimeout = global.setTimeout;
  global.setTimeout = (funcao, tempo, ...resto) => {
    if (tempo === 8000) { temporizadores.push(funcao); return { unref() {} }; }
    return originalSetTimeout(funcao, tempo, ...resto);
  };
  try {
    const instancia = new IosCamera({});
    const pedido = instancia._openForward([]);
    assert.strictEqual(temporizadores.length, 1);
    temporizadores[0]();
    await assert.rejects(pedido, { message: 'O túnel USB não confirmou o encaminhamento.' });
    assert.strictEqual(filhos[0].filho.mortes, 1);
    assert.strictEqual(instancia.tunnelProcess, null);
  } finally {
    global.setTimeout = originalSetTimeout;
  }
});

function tunelQueConfirma(argumentos, filho) {
  setImmediate(() => filho.stderr.write('remote forward success'));
}

test('tunnel: socket unix quando o chmod confirma, sem cair para TCP', async () => {
  const { IosCamera, diario } = prepararAmbiente({ aoAbrirTunel: tunelQueConfirma });
  const instancia = camera(IosCamera, diario, { respostas: (comando) => (comando.startsWith('chmod') ? 'ok\n' : '') });
  const transporte = await instancia.tunnel(4321);
  assert.match(transporte.path, /^\/var\/tmp\/\.nbi-[0-9a-f]{8}\.sock$/);
  assert.deepStrictEqual(transporte, { type: 'unix', path: instancia.socketPath });
  const lancamentos = diario.filter(([tipo]) => tipo === 'spawn');
  assert.strictEqual(lancamentos.length, 1);
  assert.deepStrictEqual(lancamentos[0][2].slice(-3), ['-R', '/var/tmp/.nbi-X.sock:127.0.0.1:PORTA', 'mobile@127.0.0.1']);
  assert.deepStrictEqual(diario.filter(([tipo]) => tipo === 'ssh').map(([, comando]) => comando), ["chmod 666 '/var/tmp/.nbi-X.sock' && test -S '/var/tmp/.nbi-X.sock' && echo ok"]);
});

test('tunnel: se o socket for recusado, remove o socket, mata o túnel e abre TCP numa porta de 20000 a 39999', async () => {
  const { IosCamera, diario, filhos } = prepararAmbiente({ aoAbrirTunel: tunelQueConfirma });
  const instancia = camera(IosCamera, diario, { respostas: (comando) => (comando.startsWith('chmod') ? 'negado' : '') });
  const transporte = await instancia.tunnel(4321);
  assert.strictEqual(transporte.type, 'tcp');
  assert.ok(transporte.port >= 20000 && transporte.port < 40000);
  assert.deepStrictEqual(Object.keys(transporte), ['type', 'port']);
  assert.strictEqual(instancia.socketPath, null);
  assert.strictEqual(filhos.length, 2);
  assert.strictEqual(filhos[0].filho.mortes, 1);
  assert.strictEqual(filhos[0].filho.novaAbort, true);
  assert.match(filhos[1].argumentos.at(-2), /^127\.0\.0\.1:\d{5}:127\.0\.0\.1:4321$/);
  assert.strictEqual(instancia.tunnelProcess, filhos[1].filho);
  assert.deepStrictEqual(diario.filter(([tipo]) => tipo === 'ssh').map(([, comando]) => comando), [
    "chmod 666 '/var/tmp/.nbi-X.sock' && test -S '/var/tmp/.nbi-X.sock' && echo ok",
    "rm -f '/var/tmp/.nbi-X.sock'",
  ]);
});

test('tunnel: o rm do socket que falha é ignorado e três tentativas de TCP falhas devolvem o último erro', async () => {
  const { IosCamera, diario, filhos } = prepararAmbiente({
    aoAbrirTunel: (argumentos, filho, numero) => setImmediate(() => {
      if (numero === 1) filho.stderr.write('remote forward success');
      else { filho.stderr.write(`falha ${numero}`); setImmediate(() => filho.emit('exit')); }
    }),
  });
  const instancia = camera(IosCamera, diario, { respostas: (comando) => (comando.startsWith('rm') ? new Error('sem ssh') : 'nao') });
  await assert.rejects(instancia.tunnel(1), { message: 'falha 4' });
  assert.strictEqual(filhos.length, 4);
});

test('tunnel: se o socket não abre e o TCP é impossível por erro do primeiro spawn, ainda tenta TCP', async () => {
  const { IosCamera, diario, filhos } = prepararAmbiente({
    aoAbrirTunel: (argumentos, filho, numero) => setImmediate(() => {
      if (numero === 1) filho.emit('error', new Error('spawn ssh ENOENT'));
      else filho.stderr.write('remote forward success');
    }),
  });
  const transporte = await camera(IosCamera, diario).tunnel(7);
  assert.strictEqual(transporte.type, 'tcp');
  assert.strictEqual(filhos.length, 2);
});

function decoderQueEmiteQuadros(quadros) {
  return (argumentos, filho) => setImmediate(() => {
    for (const quadro of quadros) filho.stdout.write(quadro);
  });
}

const CONFIGURACAO_DE_PREVIA = (url, extra = {}) => ({
  mode: 'inject', appID: 'com.apple.camera', appIDs: APPS, expiresAt: 1060, continuous: false, previewOnly: true,
  directRecording: false, photoPrepareBypass: false, videoInjection: false, frameRate: 15, url, ...extra,
});

function arquivoDeVideo() {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-ios-camera-'));
  const arquivo = path.join(pasta, 'v.mp4');
  fs.writeFileSync(arquivo, 'x');
  return { arquivo, limpar: () => fs.rmSync(pasta, { recursive: true, force: true }) };
}

test('start com socket unix: sobe o relé, o túnel e o decoder e liga a prévia', async () => {
  const video = arquivoDeVideo();
  const { IosCamera, diario, filhos } = prepararAmbiente({
    aoAbrirTunel: tunelQueConfirma,
    aoAbrirDecoder: decoderQueEmiteQuadros([Buffer.concat([Buffer.from([9, 9]), JPEG, Buffer.from([255, 216, 1, 1, 255, 217])]), Buffer.from([255, 216, 5])]),
  });
  const instancia = camera(IosCamera, diario, { respostas: (comando) => (comando.startsWith('chmod') ? 'ok' : '') });
  try {
    const resposta = await instancia.start(video.arquivo);
    assert.deepStrictEqual(resposta, {
      success: true, platform: 'ios', port: undefined, reverseOk: true, transport: 'unix',
      message: 'Vídeo local ativo na Câmera nativa. Feche e reabra a Câmera.',
    });
    assert.deepStrictEqual(instancia.transport, { type: 'unix', path: instancia.socketPath });
    assert.strictEqual(instancia.url, `http://127.0.0.1${instancia.framePath}`);
    assert.deepStrictEqual(instancia.frame, Buffer.from([255, 216, 1, 1, 255, 217]));
    const decoder = filhos.find((f) => f.arquivo === 'ffmpeg-falso');
    assert.deepStrictEqual(decoder.argumentos, ['-nostdin', '-loglevel', 'error', '-re', '-stream_loop', '-1', '-i', video.arquivo, '-an', '-vf', 'fps=15,scale=1280:1280:force_original_aspect_ratio=decrease', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-q:v', '4', 'pipe:1']);
    assert.deepStrictEqual(decoder.opcoes, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const controles = diario.filter(([tipo]) => tipo === 'controle').map(([, configuracao]) => configuracao);
    assert.deepStrictEqual(controles, [{ mode: 'observe' }, CONFIGURACAO_DE_PREVIA('http://127.0.0.1/s/TOKEN/frame.jpg', { socket: '/var/tmp/.nbi-X.sock' })]);
    assert.ok(instancia.heartbeat);
    assert.strictEqual(instancia.transmissaoLocalAtiva(), true);
  } finally {
    await instancia.stop();
    video.limpar();
  }
});

test('start: o decoder separa os JPEG do fluxo, ignora o lixo antes e depois, e descarta mais de 8 MB sem fim', async () => {
  const video = arquivoDeVideo();
  const primeiro = Buffer.from([255, 216, 1, 255, 217]);
  const segundo = Buffer.from([255, 216, 2, 2, 255, 217]);
  const { IosCamera, diario } = prepararAmbiente({
    aoAbrirTunel: tunelQueConfirma,
    aoAbrirDecoder: (argumentos, filho) => setImmediate(() => {
      filho.stdout.write(Buffer.concat([Buffer.from([7, 7]), primeiro]));
      filho.stdout.write(Buffer.concat([segundo.subarray(0, 3)]));
      filho.stdout.write(Buffer.concat([segundo.subarray(3), Buffer.from([255, 217, 3])]));
    }),
  });
  const instancia = camera(IosCamera, diario, { respostas: (comando) => (comando.startsWith('chmod') ? 'ok' : '') });
  const quadros = [];
  const empurrar = instancia.pushFrame.bind(instancia);
  instancia.pushFrame = (base64) => { quadros.push(Buffer.from(base64, 'base64')); empurrar(base64); };
  try {
    await instancia.start(video.arquivo);
    await new Promise((resolver) => setTimeout(resolver, 30));
    assert.deepStrictEqual(quadros.slice(0, 2), [primeiro, segundo]);
  } finally {
    await instancia.stop();
    video.limpar();
  }
});

test('start com TCP: devolve a porta e a URL leva a porta do túnel', async () => {
  const video = arquivoDeVideo();
  const { IosCamera, diario } = prepararAmbiente({ aoAbrirTunel: tunelQueConfirma, aoAbrirDecoder: decoderQueEmiteQuadros([JPEG]) });
  const instancia = camera(IosCamera, diario, { respostas: () => 'nao' });
  try {
    const resposta = await instancia.start(video.arquivo);
    assert.strictEqual(resposta.transport, 'tcp');
    assert.ok(resposta.port >= 20000 && resposta.port < 40000);
    assert.strictEqual(instancia.url, `http://127.0.0.1:${resposta.port}${instancia.framePath}`);
    const controle = diario.filter(([tipo]) => tipo === 'controle').map(([, configuracao]) => configuracao).at(-1);
    assert.strictEqual('socket' in controle, false);
    assert.strictEqual(controle.url, 'http://127.0.0.1:PORTA/s/TOKEN/frame.jpg');
  } finally {
    await instancia.stop();
    video.limpar();
  }
});

test('start: bridge fora do ar, caminho relativo, arquivo ausente e ffmpeg ausente devolvem { success: false }', async () => {
  const video = arquivoDeVideo();
  try {
    const semBridge = prepararAmbiente();
    const atrasada = camera(semBridge.IosCamera, semBridge.diario, { estado: { version: '0.1-1' } });
    assert.deepStrictEqual(await atrasada.start(video.arquivo), { success: false, platform: 'ios', error: 'Atualize o bridge (0.1-39) antes de iniciar.' });
    const indisponivel = camera(semBridge.IosCamera, semBridge.diario);
    indisponivel.ssh = async () => { throw new Error('sem ssh'); };
    assert.deepStrictEqual(await indisponivel.start(video.arquivo), { success: false, platform: 'ios', error: 'iPhone indisponível por USB/SSH: sem ssh' });

    for (const caminho of ['relativo.mp4', path.join(path.dirname(video.arquivo), 'nao-existe.mp4')]) {
      const { IosCamera, diario } = prepararAmbiente();
      const instancia = camera(IosCamera, diario);
      assert.deepStrictEqual(await instancia.start(caminho), { success: false, platform: 'ios', error: 'Selecione um arquivo de vídeo existente.' }, String(caminho));
      assert.deepStrictEqual(diario.filter(([tipo]) => tipo === 'controle').map(([, c]) => c), [{ mode: 'observe' }]);
    }

    const { IosCamera, diario } = prepararAmbiente({ aoAbrirTunel: tunelQueConfirma });
    toolPaths.ffmpeg = () => null;
    const instancia = camera(IosCamera, diario, { respostas: (comando) => (comando.startsWith('chmod') ? 'ok' : '') });
    assert.deepStrictEqual(await instancia.start(video.arquivo), { success: false, platform: 'ios', error: 'FFmpeg não encontrado neste computador.' });
    assert.strictEqual(instancia.server, null);
    assert.strictEqual(instancia.transport, null);
    assert.deepStrictEqual(diario.filter(([tipo]) => tipo === 'controle').map(([, c]) => c), [{ mode: 'observe' }, { mode: 'observe' }]);
  } finally {
    video.limpar();
  }
});

test('start: se o decoder não entrega quadro em 7 s, devolve o erro com o stderr dele e desfaz tudo', async () => {
  const video = arquivoDeVideo();
  const { IosCamera, diario } = prepararAmbiente({
    aoAbrirTunel: tunelQueConfirma,
    aoAbrirDecoder: (argumentos, filho) => setImmediate(() => filho.stderr.write('Invalid data found')),
  });
  const instancia = camera(IosCamera, diario, { respostas: (comando) => (comando.startsWith('chmod') ? 'ok' : '') });
  const dataOriginal = Date.now;
  let relogio = dataOriginal();
  Date.now = () => { relogio += 1000; return relogio; };
  try {
    const resposta = await instancia.start(video.arquivo);
    assert.deepStrictEqual(resposta, { success: false, platform: 'ios', error: 'Não foi possível decodificar o vídeo. Invalid data found' });
  } finally {
    Date.now = dataOriginal;
    video.limpar();
  }
  assert.strictEqual(instancia.server, null);
  assert.strictEqual(instancia.decoder, null);
  assert.strictEqual(instancia.tunnelProcess, null);
});

test('enable: sem bridge pronto joga o erro, com bridge grava a prévia e expira 60 s depois do relógio do iPhone', async () => {
  const { IosCamera, diario } = prepararAmbiente();
  const pronta = camera(IosCamera, diario, { estado: { ...PRONTO, timestamp: 500 } });
  pronta.url = 'http://127.0.0.1:1/s/TOKEN/frame.jpg';
  await pronta.enable();
  assert.deepStrictEqual(diario.at(-1), ['controle', CONFIGURACAO_DE_PREVIA('http://127.0.0.1:PORTA/s/TOKEN/frame.jpg', { expiresAt: 560 })]);
  pronta.transport = { type: 'tcp', port: 1 };
  await pronta.enable();
  assert.strictEqual(diario.at(-1)[1].socket, undefined);
  pronta.transport = { type: 'unix', path: '/var/tmp/x.sock' };
  await pronta.enable();
  assert.strictEqual(diario.at(-1)[1].socket, '/var/tmp/x.sock');
  const atrasada = camera(IosCamera, diario, { estado: { version: '0.1-1' } });
  await assert.rejects(atrasada.enable(), { message: 'Bridge iOS indisponível' });
  const indisponivel = camera(IosCamera, diario);
  indisponivel.ssh = async () => { throw new Error('sem ssh'); };
  await assert.rejects(indisponivel.enable(), { message: 'iPhone indisponível por USB/SSH: sem ssh' });
});

test('fail e stop: fail para uma vez só e stop devolve a mensagem de desligado e volta ao modo observe', async () => {
  const { IosCamera, diario } = prepararAmbiente();
  const instancia = camera(IosCamera, diario);
  const resposta = await instancia.stop();
  assert.deepStrictEqual(resposta, { success: true, platform: 'ios', message: 'Injeção desligada. Feche e reabra a Câmera para voltar ao sensor real.' });
  assert.deepStrictEqual(diario, [['controle', { mode: 'observe' }]]);
  assert.strictEqual(instancia.stopping, false);

  instancia.stopping = true;
  assert.deepStrictEqual(await instancia.stop(), { success: true, platform: 'ios' });
  instancia.fail();
  assert.strictEqual(diario.length, 1);
  instancia.stopping = false;
  instancia.fail();
  await new Promise((resolver) => setImmediate(resolver));
  assert.strictEqual(diario.length, 2);
});

test('stop depois de uma transmissão: fecha clientes, servidor, decoder, túnel, socket e zera o estado', async () => {
  const { IosCamera, diario } = prepararAmbiente();
  const instancia = camera(IosCamera, diario);
  const porta = await instancia.serve();
  assert.ok(porta);
  const decoder = filhoFalso();
  const tunel = filhoFalso();
  const cliente = clienteFalso();
  Object.assign(instancia, { decoder, tunnelProcess: tunel, socketPath: '/var/tmp/.nbi-aaaaaaaa.sock', transport: { type: 'unix' }, url: 'u', frame: JPEG, frameAt: 5 });
  decoder.on('exit', () => { throw new Error('o decoder não pode mais ouvir exit'); });
  tunel.on('exit', () => { throw new Error('o túnel não pode mais ouvir exit'); });
  instancia.clients.add(cliente);
  instancia.heartbeat = setInterval(() => {}, 100000);
  await instancia.stop();
  assert.deepStrictEqual([decoder.mortes, tunel.mortes, tunel.novaAbort, cliente.fim, instancia.clients.size], [1, 1, true, 1, 0]);
  assert.deepStrictEqual([instancia.decoder, instancia.tunnelProcess, instancia.server, instancia.socketPath, instancia.transport, instancia.url, instancia.frame, instancia.frameAt, instancia.heartbeat], [null, null, null, null, null, null, null, 0, null]);
  assert.deepStrictEqual(diario.map(([tipo, valor]) => [tipo, valor]), [['ssh', "rm -f '/var/tmp/.nbi-X.sock'"], ['controle', { mode: 'observe' }]]);
});

test('transmissaoLocalAtiva, camLive, suspenderHeartbeatLocal e liberarPortaCamera', async () => {
  const { IosCamera } = prepararAmbiente();
  const instancia = new IosCamera({});
  assert.strictEqual(instancia.transmissaoLocalAtiva(), false);
  instancia.server = {};
  assert.strictEqual(instancia.transmissaoLocalAtiva(), false);
  instancia.tunnelProcess = {};
  assert.strictEqual(instancia.transmissaoLocalAtiva(), true);
  assert.strictEqual(instancia.camLive(), null);
  assert.strictEqual(new IosCamera({ camLiveIphone: { running: 'sim' } }).camLive(), null);
  const viva = { running: false };
  assert.strictEqual(new IosCamera({ camLiveIphone: viva }).camLive(), viva);
  assert.strictEqual(new IosCamera(null).camLive(), null);
  instancia.heartbeat = setInterval(() => {}, 100000);
  instancia.suspenderHeartbeatLocal();
  assert.strictEqual(instancia.heartbeat, null);
  assert.strictEqual(await instancia.liberarPortaCamera(), undefined);
});

test('startCamSpoof: com vídeo inicia a transmissão local, sem vídeo liga a injeção; stopCamSpoof desliga', async () => {
  const { IosCamera } = prepararAmbiente();
  const instancia = new IosCamera({});
  const chamadas = [];
  instancia.start = async (video) => { chamadas.push(['start', video]); return 'a'; };
  instancia.setCameraInjection = async (ligada) => { chamadas.push(['injecao', ligada]); return 'b'; };
  assert.strictEqual(await instancia.startCamSpoof('/v.mp4'), 'a');
  assert.strictEqual(await instancia.startCamSpoof(), 'b');
  assert.strictEqual(await instancia.ligarInjecao(), 'b');
  assert.strictEqual(await instancia.stopCamSpoof(), 'b');
  assert.deepStrictEqual(chamadas, [['start', '/v.mp4'], ['injecao', true], ['injecao', true], ['injecao', false]]);
});

function servicoDeCamLive(extra = {}) {
  const chamadas = [];
  const camlive = {
    running: false,
    mediaEndpoint: () => ({ url: 'http://127.0.0.1:9/s/x/frame.jpg', socket: '/var/tmp/live.sock' }),
    setCameraEnabled: async (ligada, escrever) => { chamadas.push(['setCameraEnabled', ligada]); await escrever(); },
    ...extra,
  };
  return { camlive, chamadas, servico: { camLiveIphone: camlive } };
}

test('setCameraInjection pelo CAM LIVE: liga com o endpoint da live, desliga com observe, e devolve as mensagens', async () => {
  const { IosCamera, diario } = prepararAmbiente();
  const { servico, chamadas } = servicoDeCamLive();
  const instancia = camera(IosCamera, diario, { servico });
  const ligada = await instancia.setCameraInjection(true);
  assert.deepStrictEqual(ligada, { success: true, platform: 'ios', message: 'Injeção ligada. Câmera, FaceTime e Safari (câmera de qualquer app) recebem o CAM LIVE ou ficam pretos enquanto aguardam imagem.' });
  assert.deepStrictEqual(diario.at(-1)[1], {
    mode: 'inject', appID: 'com.apple.camera', appIDs: APPS, expiresAt: 1060, continuous: true, previewOnly: false, directRecording: false,
    photoPrepareBypass: true, videoInjection: true, audioInjection: true, frameRate: 30, url: 'http://127.0.0.1:PORTA/s/x/frame.jpg',
    novaSequestroSession: 'SESSAO', socket: '/var/tmp/live.sock',
  });
  const desligada = await instancia.setCameraInjection(false);
  assert.deepStrictEqual(desligada, { success: true, platform: 'ios', message: 'Injeção desligada. Se a Câmera estiver aberta, reabra para voltar ao sensor real.' });
  assert.deepStrictEqual(diario.at(-1), ['controle', { mode: 'observe' }]);
  assert.deepStrictEqual(chamadas, [['setCameraEnabled', true], ['setCameraEnabled', false]]);
});

test('setCameraInjection: endpoint sem socket não leva socket, e endpoint ausente ou sem url é erro', async () => {
  const { IosCamera, diario } = prepararAmbiente();
  const semSocket = servicoDeCamLive({ mediaEndpoint: () => ({ url: 'http://127.0.0.1:9/a' }) });
  const instancia = camera(IosCamera, diario, { servico: semSocket.servico });
  assert.strictEqual((await instancia.setCameraInjection(true)).success, true);
  assert.strictEqual('socket' in diario.at(-1)[1], false);
  for (const mediaEndpoint of [() => null, () => ({}), undefined]) {
    const { servico } = servicoDeCamLive({ mediaEndpoint });
    const sem = camera(IosCamera, diario, { servico });
    assert.deepStrictEqual(await sem.setCameraInjection(true), { success: false, platform: 'ios', error: 'O CAM LIVE ainda não abriu o túnel do iPhone.' });
  }
});

test('setCameraInjection: sem CAM LIVE, sem bridge pronto ou iPhone indisponível devolvem { success: false }', async () => {
  const { IosCamera, diario } = prepararAmbiente();
  assert.deepStrictEqual(await camera(IosCamera, diario).setCameraInjection(true), { success: false, platform: 'ios', error: 'O serviço CAM LIVE está indisponível.' });
  const { servico } = servicoDeCamLive();
  assert.deepStrictEqual(await camera(IosCamera, diario, { servico, estado: { version: '0.1-1' } }).setCameraInjection(true), {
    success: false, platform: 'ios', error: 'A ponte de câmera do iPhone não está pronta.',
  });
  const quebrada = camera(IosCamera, diario, { servico });
  quebrada.ssh = async () => { throw new Error('sem ssh'); };
  assert.deepStrictEqual(await quebrada.setCameraInjection(true), { success: false, platform: 'ios', error: 'iPhone indisponível por USB/SSH: sem ssh' });
});

test('setCameraInjection com a transmissão local ativa: suspende o heartbeat e grava direto, sem passar pelo CAM LIVE', async () => {
  const { IosCamera, diario } = prepararAmbiente();
  const { servico, chamadas } = servicoDeCamLive();
  const instancia = camera(IosCamera, diario, { servico });
  Object.assign(instancia, { server: {}, tunnelProcess: {}, url: 'http://127.0.0.1:1/s/TOKEN/frame.jpg', transport: { type: 'unix', path: '/var/tmp/local.sock' } });
  instancia.heartbeat = setInterval(() => {}, 100000);
  const resposta = await instancia.setCameraInjection(true);
  assert.strictEqual(resposta.success, true);
  assert.strictEqual(instancia.heartbeat, null);
  assert.deepStrictEqual(chamadas, []);
  const configuracao = diario.at(-1)[1];
  assert.strictEqual(configuracao.url, 'http://127.0.0.1:PORTA/s/TOKEN/frame.jpg');
  assert.strictEqual(configuracao.socket, '/var/tmp/local.sock');
  instancia.transport = { type: 'tcp', port: 1 };
  await instancia.setCameraInjection(true);
  assert.strictEqual('socket' in diario.at(-1)[1], false);
  instancia.transport = null;
  await instancia.setCameraInjection(true);
  assert.strictEqual('socket' in diario.at(-1)[1], false);
  await instancia.setCameraInjection(false);
  assert.deepStrictEqual(diario.at(-1), ['controle', { mode: 'observe' }]);
  assert.strictEqual(chamadas.length, 0);
});
