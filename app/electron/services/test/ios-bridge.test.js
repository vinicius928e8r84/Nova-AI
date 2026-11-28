'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const Module = require('module');
const net = require('net');
const path = require('path');
const { EventEmitter } = require('events');
const WebSocket = require('ws');

const CAMINHO_DA_PONTE = path.join(__dirname, '..', 'ios-bridge.js');
const PASTA_DO_NOVNC = path.join(__dirname, '..', '..', '..', 'node_modules', '@novnc', 'novnc');
const PREFIXO_DO_SSH = ['-p', '2222', 'OPCOES-DO-SSH', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-o', 'StrictHostKeyChecking=accept-new', 'mobile@127.0.0.1'];
const SHA256_DA_PAGINA = '3eb2ec6314b618ba54b36355a8d7a53597de51c88fadf59af5dfc84e8db33002';

const palco = {
  execucoes: [],
  processos: [],
  resposta: () => ({}),
  portasAbertas: new Set(),
  ferramentas: true,
  sem_openssh: null,
  tcp: [],
  logs: [],
};

function respostaDoExecFile(comando, argumentos, opcoes, aoTerminar) {
  palco.execucoes.push({ comando, argumentos, opcoes });
  const { erro = null, stdout = '', stderr = '' } = palco.resposta(comando, argumentos) || {};
  setImmediate(() => aoTerminar(erro ? new Error(erro) : null, stdout, stderr));
}

function processoFalso(comando, argumentos, opcoes) {
  const processo = Object.assign(new EventEmitter(), { comando, argumentos, opcoes, mortes: 0 });
  processo.kill = () => { processo.mortes++; };
  palco.processos.push(processo);
  return processo;
}

function soqueteFalso(opcoes) {
  const soquete = Object.assign(new EventEmitter(), { opcoes, escritos: [], destruido: false });
  soquete.write = (dados) => { soquete.escritos.push(Buffer.from(dados)); };
  soquete.destroy = () => {
    if (soquete.destruido) return;
    soquete.destruido = true;
    process.nextTick(() => soquete.emit('close'));
  };
  palco.tcp.push(soquete);
  if (opcoes.port === 5900 && opcoes.timeout === undefined) return soquete;
  process.nextTick(() => soquete.emit(palco.portasAbertas.has(opcoes.port) ? 'connect' : 'error', new Error('recusada')));
  return soquete;
}

const SUBSTITUTOS = {
  child_process: { execFile: respostaDoExecFile, spawn: processoFalso },
  net: { connect: soqueteFalso },
  './iphone-ssh': { sshOptions: () => ['OPCOES-DO-SSH'] },
  './ios-tools': { available: () => palco.ferramentas, tool: (nome) => `FERRAMENTA-${nome}` },
  './tool-paths': {
    exigirOpenssh: (nome) => {
      if (palco.sem_openssh) throw new Error(palco.sem_openssh);
      return `OPENSSH-${nome}`;
    },
  },
};

const carregarOriginal = Module._load;
const pedidoDaPonte = (pedido, pai) => pai?.filename === CAMINHO_DA_PONTE && Object.hasOwn(SUBSTITUTOS, pedido);
Module._load = function (pedido, pai, ...resto) {
  if (pedidoDaPonte(pedido, pai)) return SUBSTITUTOS[pedido];
  return carregarOriginal.call(this, pedido, pai, ...resto);
};

const registrarLog = (...argumentos) => palco.logs.push(argumentos.join(' '));
const logOriginal = { log: console.log, info: console.info };

function portaLivre() {
  return new Promise((resolver) => {
    const servidor = net.createServer();
    servidor.listen(0, '127.0.0.1', () => {
      const { port } = servidor.address();
      servidor.close(() => resolver(port));
    });
  });
}

async function esperar(vezes = 6) {
  for (let i = 0; i < vezes; i++) await new Promise((resolver) => setImmediate(resolver));
}

async function abrirPonte(t, { relogio = false } = {}) {
  Object.assign(palco, { execucoes: [], processos: [], resposta: () => ({}), portasAbertas: new Set(), ferramentas: true, sem_openssh: null, tcp: [], logs: [] });
  const porta = await portaLivre();
  process.env.NOVA_IOS_PORT = String(porta);
  if (relogio) t.mock.timers.enable({ apis: ['setInterval'] });
  delete require.cache[CAMINHO_DA_PONTE];
  console.log = registrarLog;
  console.info = registrarLog;
  const ponte = require(CAMINHO_DA_PONTE);
  t.after(() => {
    ponte.stop();
    console.log = logOriginal.log;
    console.info = logOriginal.info;
    delete require.cache[CAMINHO_DA_PONTE];
  });
  return { ponte, porta };
}

test.after(() => { Module._load = carregarOriginal; delete process.env.NOVA_IOS_PORT; });

function pedir(porta, caminho) {
  return new Promise((resolver, rejeitar) => {
    http.get({ host: '127.0.0.1', port: porta, path: caminho }, (resposta) => {
      const pedacos = [];
      resposta.on('data', (pedaco) => pedacos.push(pedaco));
      resposta.on('end', () => resolver({ codigo: resposta.statusCode, tipo: resposta.headers['content-type'], cache: resposta.headers['cache-control'], corpo: Buffer.concat(pedacos) }));
    }).on('error', rejeitar);
  });
}

const comoJson = (resposta) => JSON.parse(resposta.corpo.toString('utf8'));

test('start sem as ferramentas do iPhone nao sobe nada e diz o motivo', async (t) => {
  const { ponte } = await abrirPonte(t);
  palco.ferramentas = false;
  assert.deepStrictEqual(ponte.start(), { ok: false, error: 'Ferramentas do iPhone ausentes neste sistema.' });
  assert.strictEqual(ponte.isRunning(), false);
});

test('start sobe uma vez so, na porta do ambiente, e a segunda chamada diz que ja estava de pe', async (t) => {
  const { ponte, porta } = await abrirPonte(t);
  assert.strictEqual(ponte.PORT, porta);
  assert.deepStrictEqual(ponte.start(), { ok: true, port: porta });
  assert.strictEqual(ponte.isRunning(), true);
  assert.deepStrictEqual(ponte.start(), { ok: true, port: porta, already: true });
  await pedir(porta, '/');
  assert.deepStrictEqual(palco.logs, [`[iOSBridge] iPhone Console em http://127.0.0.1:${porta} (USB only)`]);
});

test('ao subir, abre o iproxy da tela (5900) so quando o VNC nao responde', async (t) => {
  const { ponte, porta } = await abrirPonte(t);
  ponte.start();
  await pedir(porta, '/');
  await esperar();
  assert.deepStrictEqual(palco.processos.map((p) => [p.comando, p.argumentos, p.opcoes]), [['FERRAMENTA-iproxy', ['5900', '5900'], { stdio: 'ignore', windowsHide: true }]]);
  assert.deepStrictEqual(palco.tcp[0].opcoes, { host: '127.0.0.1', port: 5900, timeout: 1500 });
  assert.strictEqual(palco.tcp[0].destruido, true);
  ponte.stop();
  assert.deepStrictEqual(palco.processos.map((p) => p.mortes), [1]);
});

test('ao subir com o VNC respondendo, nao abre o iproxy', async (t) => {
  const { ponte, porta } = await abrirPonte(t);
  palco.portasAbertas.add(5900);
  ponte.start();
  await pedir(porta, '/');
  await esperar();
  assert.deepStrictEqual(palco.processos, []);
});

test('a cada 15 s confere o VNC e o SSH do USB e abre um iproxy para cada porta que nao responde, sem repetir', async (t) => {
  const { ponte } = await abrirPonte(t, { relogio: true });
  t.mock.timers.tick(15000);
  await esperar();
  assert.deepStrictEqual(palco.processos, []);
  ponte.start();
  await esperar(20);
  const antes = palco.processos.length;
  t.mock.timers.tick(15000);
  await esperar();
  const comandos = palco.processos.slice(antes).map((p) => p.argumentos.join(' '));
  assert.deepStrictEqual(comandos, ['2222 22']);
  t.mock.timers.tick(15000);
  await esperar();
  assert.strictEqual(palco.processos.length, antes + 1);
  palco.processos[antes].emit('exit');
  t.mock.timers.tick(15000);
  await esperar();
  assert.deepStrictEqual(palco.processos.slice(antes + 1).map((p) => p.argumentos.join(' ')), ['2222 22']);
});

test('a pagina do console sai com o mesmo texto, em HTML e sem cache, na raiz e em /index.html', async (t) => {
  const { ponte, porta } = await abrirPonte(t);
  ponte.start();
  for (const caminho of ['/', '/index.html']) {
    const resposta = await pedir(porta, caminho);
    assert.strictEqual(resposta.codigo, 200);
    assert.strictEqual(resposta.tipo, 'text/html; charset=utf-8');
    assert.strictEqual(resposta.cache, 'no-store');
    assert.strictEqual(crypto.createHash('sha256').update(resposta.corpo).digest('hex'), SHA256_DA_PAGINA);
  }
});

test('/novnc/ serve arquivo da biblioteca com o tipo pela extensao, e recusa o que falta, a pasta e a rota desconhecida', async (t) => {
  const { ponte, porta } = await abrirPonte(t);
  ponte.start();
  const rfb = await pedir(porta, '/novnc/core/rfb.js');
  assert.deepStrictEqual([rfb.codigo, rfb.tipo, rfb.cache], [200, 'application/javascript', 'no-store']);
  assert.deepStrictEqual(rfb.corpo, fs.readFileSync(path.join(PASTA_DO_NOVNC, 'core', 'rfb.js')));
  const pacote = await pedir(porta, '/novnc/package.json');
  assert.deepStrictEqual([pacote.codigo, pacote.tipo], [200, 'application/octet-stream']);
  for (const caminho of ['/novnc/core/nao-existe.js', '/novnc/core', '/novnc/', '/outra-rota', '/api/nao-existe']) {
    const resposta = await pedir(porta, caminho);
    assert.deepStrictEqual([caminho, resposta.codigo, resposta.tipo, resposta.corpo.toString()], [caminho, 404, 'text/plain', 'not found']);
  }
});

const INFO_DO_APARELHO = [
  'ActivationState: Activated',
  'DeviceName: iPhone do Teste',
  'ModelNumber: MQ8Q2',
  'ProductType: iPhone10,2',
  'ProductVersion: 16.7.2',
  'SIMStatus: kCTSIMSupportSIMStatusReady',
  'Nota: com: dois-pontos',
].join('\n');

function aparelhoLigado(comando, argumentos) {
  if (comando === 'FERRAMENTA-idevice_id') return { stdout: 'UDID-UM\nUDID-DOIS\n' };
  if (argumentos.includes('com.apple.mobile.battery')) return { stdout: ' 87\n' };
  return { stdout: INFO_DO_APARELHO };
}

test('/api/info junta nome, modelo, versao, SIM e bateria do primeiro aparelho, e guarda o UDID para a proxima chamada', async (t) => {
  const { ponte, porta } = await abrirPonte(t);
  ponte.start();
  palco.resposta = aparelhoLigado;
  const esperado = { connected: true, DeviceName: 'iPhone do Teste', ProductType: 'iPhone10,2', ProductVersion: '16.7.2', ModelNumber: 'MQ8Q2', SIMStatus: 'kCTSIMSupportSIMStatusReady', battery: '87' };
  assert.deepStrictEqual(comoJson(await pedir(porta, '/api/info')), esperado);
  assert.deepStrictEqual(comoJson(await pedir(porta, '/api/info')), esperado);
  assert.deepStrictEqual(palco.execucoes.map((e) => [e.comando, e.argumentos, e.opcoes.timeout]), [
    ['FERRAMENTA-idevice_id', ['-l'], 8000],
    ['FERRAMENTA-ideviceinfo', ['-u', 'UDID-UM'], 10000],
    ['FERRAMENTA-ideviceinfo', ['-q', 'com.apple.mobile.battery', '-k', 'BatteryCurrentCapacity'], 8000],
    ['FERRAMENTA-ideviceinfo', ['-u', 'UDID-UM'], 10000],
    ['FERRAMENTA-ideviceinfo', ['-q', 'com.apple.mobile.battery', '-k', 'BatteryCurrentCapacity'], 8000],
  ]);
  assert.deepStrictEqual(palco.execucoes[0].opcoes, { timeout: 8000, maxBuffer: 4194304, windowsHide: true });
});

test('/api/info sem aparelho diz connected false, e sem bateria deixa o campo de fora', async (t) => {
  const { ponte, porta } = await abrirPonte(t);
  ponte.start();
  palco.resposta = (comando) => (comando === 'FERRAMENTA-ideviceinfo' ? { erro: 'No device found' } : { stdout: '' });
  assert.deepStrictEqual(comoJson(await pedir(porta, '/api/info')), { connected: false });
  palco.resposta = (comando, argumentos) => {
    if (comando === 'FERRAMENTA-idevice_id') return { stdout: 'U1\n' };
    return argumentos.includes('com.apple.mobile.battery') ? { erro: 'sem bateria' } : { stdout: 'DeviceName: Sem Bateria\n' };
  };
  assert.deepStrictEqual(comoJson(await pedir(porta, '/api/info')), { connected: true, DeviceName: 'Sem Bateria' });
});

test('/api/apps lista os apps do CSV do ideviceinstaller, ignora o cabecalho e linhas vazias e cai no id sem nome', async (t) => {
  const { ponte, porta } = await abrirPonte(t);
  ponte.start();
  palco.resposta = () => ({ stdout: ['CFBundleIdentifier, CFBundleVersion, CFBundleDisplayName', '"com.apple.mobilesafari", "1.0", "Safari"', '', '"com.exemplo.sem-nome", "2", ""', '   ', ', "x", "y"'].join('\n') });
  assert.deepStrictEqual(comoJson(await pedir(porta, '/api/apps')), { ok: true, apps: [{ bundleId: 'com.apple.mobilesafari', name: 'Safari' }, { bundleId: 'com.exemplo.sem-nome', name: 'com.exemplo.sem-nome' }] });
  assert.deepStrictEqual(palco.execucoes.map((e) => [e.comando, e.argumentos, e.opcoes.timeout]), [['FERRAMENTA-ideviceinstaller', ['list'], 25000]]);
});

test('/api/apps com falha sem saida devolve o erro, e com falha mas com saida ainda lista', async (t) => {
  const { ponte, porta } = await abrirPonte(t);
  ponte.start();
  palco.resposta = () => ({ erro: 'quebrou', stderr: 'detalhe' });
  assert.deepStrictEqual(comoJson(await pedir(porta, '/api/apps')), { ok: false, error: 'quebrou', apps: [] });
  palco.resposta = () => ({ erro: 'quebrou', stdout: '"a.b", "1", "Ab"\n' });
  assert.deepStrictEqual(comoJson(await pedir(porta, '/api/apps')), { ok: true, apps: [{ bundleId: 'a.b', name: 'Ab' }] });
});

test('/api/open so aceita esquema://, manda o uiopen pelo ssh do USB e devolve o erro do aparelho', async (t) => {
  const { ponte, porta } = await abrirPonte(t);
  ponte.start();
  const invalidos = ['', 'sem-esquema', 'https:/falta', 'https://com espaco', '1http://x'];
  for (const url of invalidos) {
    assert.deepStrictEqual(comoJson(await pedir(porta, `/api/open?url=${encodeURIComponent(url)}`)), { ok: false, error: 'URL invalida (use esquema://...)' }, url);
  }
  assert.deepStrictEqual(comoJson(await pedir(porta, '/api/open')), { ok: false, error: 'URL invalida (use esquema://...)' });
  assert.deepStrictEqual(palco.execucoes, []);
  assert.deepStrictEqual(comoJson(await pedir(porta, `/api/open?url=${encodeURIComponent('https://exemplo.test/a?b="c"')}`)), { ok: true, error: null });
  assert.deepStrictEqual([palco.execucoes[0].comando, palco.execucoes[0].argumentos, palco.execucoes[0].opcoes.timeout], ['OPENSSH-ssh', [...PREFIXO_DO_SSH, 'uiopen "https://exemplo.test/a?b=\\"c\\""'], 12000]);
  palco.resposta = () => ({ erro: 'falhou', stderr: 'permissao negada' });
  assert.deepStrictEqual(comoJson(await pedir(porta, '/api/open?url=app%3A%2F%2Fx')), { ok: false, error: 'permissao negada' });
  palco.resposta = () => ({ erro: 'falhou' });
  assert.deepStrictEqual(comoJson(await pedir(porta, '/api/open?url=app%3A%2F%2Fx')), { ok: false, error: 'falhou' });
});

test('/api/launch so aceita bundle id com letras, numeros, ponto e hifen, e abre pelo uiopen --bundleid', async (t) => {
  const { ponte, porta } = await abrirPonte(t);
  ponte.start();
  for (const id of ['', 'com espaco', 'com_sublinhado', 'a;b']) {
    assert.deepStrictEqual(comoJson(await pedir(porta, `/api/launch?id=${encodeURIComponent(id)}`)), { ok: false, error: 'bundle id invalido' }, id);
  }
  assert.deepStrictEqual(palco.execucoes, []);
  assert.deepStrictEqual(comoJson(await pedir(porta, '/api/launch?id=com.apple.mobilesafari')), { ok: true, error: null });
  assert.deepStrictEqual(palco.execucoes[0].argumentos, [...PREFIXO_DO_SSH, 'uiopen --bundleid "com.apple.mobilesafari"']);
});

test('sem o OpenSSH do Windows, /api/open e /api/launch devolvem o aviso da ferramenta e nao rodam nada', async (t) => {
  const { ponte, porta } = await abrirPonte(t);
  ponte.start();
  palco.sem_openssh = 'OpenSSH nao encontrado';
  assert.deepStrictEqual(comoJson(await pedir(porta, '/api/open?url=app%3A%2F%2Fx')), { ok: false, error: 'OpenSSH nao encontrado' });
  assert.deepStrictEqual(comoJson(await pedir(porta, '/api/launch?id=a.b')), { ok: false, error: 'OpenSSH nao encontrado' });
  assert.deepStrictEqual(palco.execucoes, []);
});

function conectarAoVnc(porta) {
  return new Promise((resolver, rejeitar) => {
    const cliente = new WebSocket(`ws://127.0.0.1:${porta}/vnc`);
    cliente.recebidos = [];
    cliente.on('message', (dados, binario) => cliente.recebidos.push({ dados: Buffer.from(dados), binario }));
    cliente.once('open', () => resolver(cliente));
    cliente.once('error', rejeitar);
  });
}

test('a ponte do VNC liga o websocket em /vnc ao TCP 5900: bytes de ida e volta, e fecha os dois lados', async (t) => {
  const { ponte, porta } = await abrirPonte(t);
  palco.portasAbertas.add(5900);
  ponte.start();
  const cliente = await conectarAoVnc(porta);
  await esperar();
  const tcp = palco.tcp.find((s) => s.opcoes.port === 5900 && s.opcoes.timeout === undefined);
  assert.deepStrictEqual(tcp.opcoes, { host: '127.0.0.1', port: 5900 });
  tcp.emit('data', Buffer.from([1, 2, 3]));
  cliente.send(Buffer.from([9, 8]));
  await esperar(10);
  assert.deepStrictEqual(cliente.recebidos, [{ dados: Buffer.from([1, 2, 3]), binario: true }]);
  assert.deepStrictEqual(tcp.escritos, [Buffer.from([9, 8])]);
  const fechou = new Promise((resolver) => cliente.once('close', resolver));
  cliente.close();
  await fechou;
  await esperar(10);
  assert.strictEqual(tcp.destruido, true);
});

test('quando o TCP do VNC fecha, o websocket e fechado; quando da erro, o TCP e destruido', async (t) => {
  const { ponte, porta } = await abrirPonte(t);
  palco.portasAbertas.add(5900);
  ponte.start();
  const primeiro = await conectarAoVnc(porta);
  await esperar();
  const tcpPrimeiro = palco.tcp.find((s) => s.opcoes.port === 5900 && s.opcoes.timeout === undefined);
  const fechou = new Promise((resolver) => primeiro.once('close', resolver));
  tcpPrimeiro.emit('close');
  await fechou;
  const segundo = await conectarAoVnc(porta);
  await esperar();
  const tcpSegundo = palco.tcp.filter((s) => s.opcoes.port === 5900 && s.opcoes.timeout === undefined).pop();
  assert.notStrictEqual(tcpSegundo, tcpPrimeiro);
  tcpSegundo.emit('error', new Error('caiu'));
  assert.strictEqual(tcpSegundo.destruido, true);
  segundo.terminate();
});

test('stop derruba os clientes do VNC, fecha o servidor, mata os iproxy e pode ser chamado de novo', async (t) => {
  const { ponte, porta } = await abrirPonte(t);
  palco.portasAbertas.add(5900);
  ponte.start();
  const cliente = await conectarAoVnc(porta);
  const fechou = new Promise((resolver) => cliente.once('close', resolver));
  ponte.stop();
  assert.strictEqual(ponte.isRunning(), false);
  await fechou;
  assert.doesNotThrow(() => ponte.stop());
  await assert.rejects(pedir(porta, '/'), { code: 'ECONNREFUSED' });
  assert.deepStrictEqual(ponte.start(), { ok: true, port: porta });
});
