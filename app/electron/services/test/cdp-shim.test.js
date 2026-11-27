'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');
const http = require('http');
const net = require('net');
const path = require('path');

const caminhoDoShim = path.join(__dirname, '..', 'cdp-shim.js');
const carregadorOriginal = Module._load;
const consoleOriginal = { log: console.log, warn: console.warn, error: console.error };

const cena = { diario: [], rodando: false, falhaLaunch: null, cdpPort: 0, versao: null, chromium: [] };
const anota = (linha) => cena.diario.push(String(linha).replace(/in \d+ms/, 'in Nms'));

const browserManagerFalso = {
  browserService: {
    launch: async () => {
      anota('launch');
      if (cena.falhaLaunch) throw new Error(cena.falhaLaunch);
      cena.rodando = true;
    },
    isRunning: () => cena.rodando,
  },
  getCdpPort: () => cena.cdpPort,
  appendBrowserLog: (linha) => anota(`log: ${linha}`),
};

function chromiumFalso() {
  const servidor = http.createServer((req, res) => {
    cena.chromium.push(`GET ${req.url}`);
    if (req.url === '/json/version') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(cena.versao));
      return;
    }
    res.writeHead(207, { 'Content-Type': 'text/x-alvo' });
    res.end('[{"id":"alvo"}]');
  });
  servidor.on('upgrade', (req, socket, head) => {
    cena.chromium.push({ url: req.url, cabecalhos: req.rawHeaders, head: head.toString() });
    socket.write('HTTP/1.1 101 Switching Protocols\r\n\r\n');
    socket.on('data', (dados) => socket.write(`eco:${dados}`));
    socket.on('end', () => socket.end());
  });
  return servidor;
}

const escutar = (servidor) => new Promise((pronto) => servidor.listen(0, '127.0.0.1', () => pronto(servidor.address().port)));

async function reservarPorta() {
  const servidor = net.createServer();
  const porta = await escutar(servidor);
  await new Promise((pronto) => servidor.close(pronto));
  return porta;
}

function bruto(porta, texto, { esperar = 'fim', escrever = null } = {}) {
  return new Promise((pronto, falha) => {
    const socket = net.connect(porta, '127.0.0.1', () => socket.write(texto));
    socket.setTimeout(3000, () => socket.destroy());
    let recebido = '';
    const handshakeVoltou = () => recebido.includes('\r\n\r\n') && !recebido.includes('eco:');
    socket.on('data', (dados) => {
      recebido += dados;
      if (escrever && handshakeVoltou()) { socket.write(escrever); escrever = null; }
      if (esperar !== 'fim' && recebido.includes(esperar)) socket.end();
    });
    socket.on('close', () => pronto(recebido));
    socket.on('error', falha);
  });
}

const semData = (resposta) => resposta.split('\r\n').filter((linha) => !/^(Date|Connection|Keep-Alive):/i.test(linha)).join('\n');
const pedir = (porta, linha, host = `127.0.0.1:${porta}`) => bruto(porta, `${linha} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`).then(semData);
const upgrade = (porta, caminho, extras = '', head = '') => `GET ${caminho} HTTP/1.1\r\nHost: 127.0.0.1:${porta}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: chave==\r\nX-Dupla: a\r\nx-dupla: b\r\nSet-Cookie: c=1\r\nSet-Cookie: d=2\r\n${extras}\r\n${head}`;
const recusa = (linha, motivo) => `HTTP/1.1 ${linha}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(`CDP shim: ${motivo}\n`)}\r\n\r\nCDP shim: ${motivo}\n`;

let shim;
let porta;
let chromium;

test.before(async () => {
  Module._load = function (pedido, ...resto) {
    if (pedido === './browser-manager') return browserManagerFalso;
    return carregadorOriginal.call(this, pedido, ...resto);
  };
  Object.assign(console, { log: (...p) => anota(`log ${p.join(' ')}`), warn: (...p) => anota(`warn ${p.join(' ')}`), error: (...p) => anota(`error ${p.join(' ')}`) });
  delete require.cache[caminhoDoShim];
  shim = require(caminhoDoShim);
  chromium = chromiumFalso();
  cena.cdpPort = await escutar(chromium);
  porta = await reservarPorta();
  process.env.STONIC_CDP_SHIM_PORT = String(porta);
});

test.after(() => {
  shim.stopCdpShim();
  chromium.close();
  Module._load = carregadorOriginal;
  Object.assign(console, consoleOriginal);
  delete process.env.STONIC_CDP_SHIM_PORT;
});

test.beforeEach(() => { cena.diario = []; cena.chromium = []; cena.falhaLaunch = null; });

test('start: porta do ambiente, mesma URL na segunda chamada, de novo depois do stop', async () => {
  const url = await shim.startCdpShim();
  assert.strictEqual(url, `ws://127.0.0.1:${porta}/devtools/browser/stonic`);
  assert.strictEqual(await shim.startCdpShim(), url);
  shim.stopCdpShim();
  shim.stopCdpShim();
  assert.strictEqual(await shim.startCdpShim(), url);
  assert.deepStrictEqual(cena.diario, [
    `log [CDP Shim] Listening on 127.0.0.1:${porta} — browser opens on first CDP connect.`,
    `log [CDP Shim] Listening on 127.0.0.1:${porta} — browser opens on first CDP connect.`,
  ]);
});

test('start: porta ocupada no ambiente falha com a faixa', async () => {
  shim.stopCdpShim();
  const ocupante = http.createServer();
  const ocupada = await escutar(ocupante);
  process.env.STONIC_CDP_SHIM_PORT = String(ocupada);
  await assert.rejects(shim.startCdpShim(), { message: 'No free port for the CDP shim in 9333-9353' });
  ocupante.close();
  process.env.STONIC_CDP_SHIM_PORT = String(porta);
  await shim.startCdpShim();
});

const json = (status, texto, corpo) => `HTTP/1.1 ${status} ${texto}\nContent-Type: application/json\nContent-Length: ${Buffer.byteLength(corpo)}\n\n${corpo}`;

test('descoberta sem navegador: recusas e endpoint preguiçoso, sem abrir nada', async () => {
  cena.rodando = false;
  const url = `ws://127.0.0.1:${porta}/devtools/browser/stonic`;
  assert.strictEqual(await pedir(porta, 'GET /json/version', 'evil.example.com'), json(403, 'Forbidden', '{"error":"Forbidden"}'));
  assert.strictEqual(await pedir(porta, 'GET /json/version', 'LOCALHOST:1'), json(200, 'OK', JSON.stringify({ Browser: 'Chrome/Stonic (not started)', 'Protocol-Version': '1.3', webSocketDebuggerUrl: url })));
  assert.strictEqual(await pedir(porta, 'GET /json/version', '[::1]:9'), json(403, 'Forbidden', '{"error":"Forbidden"}'));
  assert.strictEqual(await pedir(porta, 'GET //'), json(400, 'Bad Request', '{"error":"Bad request"}'));
  assert.strictEqual(await pedir(porta, 'POST /json'), json(404, 'Not Found', '{"error":"Not found"}'));
  assert.strictEqual(await pedir(porta, 'GET /json/new?x'), json(404, 'Not Found', '{"error":"Not found"}'));
  assert.strictEqual(await pedir(porta, 'GET /json/list?x=1'), json(200, 'OK', '[]'));
  assert.deepStrictEqual([cena.diario, cena.chromium], [[], []]);
});

test('descoberta com navegador: versão com o nosso websocket, lista repassada, 502 sem Chromium', async () => {
  cena.rodando = true;
  cena.versao = { Browser: 'Chrome/131', webSocketDebuggerUrl: 'ws://127.0.0.1:1/devtools/browser/guid-1' };
  const url = `ws://127.0.0.1:${porta}/devtools/browser/stonic`;
  assert.strictEqual(await pedir(porta, 'GET /json/version'), json(200, 'OK', JSON.stringify({ Browser: 'Chrome/131', webSocketDebuggerUrl: url })));
  assert.strictEqual(await pedir(porta, 'GET /json'), 'HTTP/1.1 207 Multi-Status\nContent-Type: text/x-alvo\nTransfer-Encoding: chunked\n\nf\n[{"id":"alvo"}]\n0\n\n');
  assert.deepStrictEqual(cena.chromium, ['GET /json/version', 'GET /json']);
  const real = cena.cdpPort;
  cena.cdpPort = await reservarPorta();
  const corpo = JSON.stringify({ error: `Chromium CDP unreachable on port ${cena.cdpPort}` });
  assert.strictEqual(await pedir(porta, 'GET /json'), json(502, 'Bad Gateway', corpo));
  assert.match(cena.diario[0], new RegExp(`^error \\[CDP Shim\\] Could not reach Chromium CDP on ${cena.cdpPort}: connect ECONNREFUSED`));
  cena.cdpPort = real;
});

test('upgrade recusado: Host, Origin, URL, caminho e navegador que não sobe', async () => {
  const casos = [
    [upgrade(porta, '/devtools/browser/stonic').replace(`Host: 127.0.0.1:${porta}`, 'Host: 192.0.2.2'), '403 Forbidden', 'non-loopback Host'],
    [upgrade(porta, '/devtools/browser/stonic', 'Origin: https://site.example.com\r\n'), '403 Forbidden', 'Origin header present (https://site.example.com)'],
    [upgrade(porta, '//'), '400 Bad Request', 'unparseable request URL'],
    [upgrade(porta, '/json/version'), '404 Not Found', 'path /json/version'],
  ];
  for (const [pedido, linha, motivo] of casos) {
    cena.diario = [];
    assert.strictEqual(await bruto(porta, pedido), recusa(linha, motivo));
    assert.deepStrictEqual(cena.diario, [`warn [CDP Shim] Rejected websocket upgrade: ${motivo}`, `log: shim reject (${linha}): ${motivo}`]);
  }
  cena.diario = [];
  cena.falhaLaunch = 'Playwright: sem binário';
  assert.strictEqual(await bruto(porta, upgrade(porta, '/devtools/page/1')), recusa('503 Service Unavailable', 'browser unavailable: Playwright: sem binário'));
  assert.deepStrictEqual(cena.diario, [
    'launch',
    'error [CDP Shim] Browser unavailable for CDP connect: Playwright: sem binário',
    'warn [CDP Shim] Rejected websocket upgrade: browser unavailable: Playwright: sem binário',
    'log: shim reject (503 Service Unavailable): browser unavailable: Playwright: sem binário',
  ]);
  cena.diario = [];
  cena.falhaLaunch = null;
  cena.versao = { Browser: 'Chrome/131' };
  assert.strictEqual(await bruto(porta, upgrade(porta, '/devtools/browser/stonic')), recusa('503 Service Unavailable', 'browser unavailable: Chromium did not report a webSocketDebuggerUrl'));
  assert.deepStrictEqual(cena.chromium, ['GET /json/version']);
});

test('upgrade aceito: abre o navegador, troca o caminho do browser e emenda os bytes', async () => {
  cena.versao = { webSocketDebuggerUrl: 'ws://127.0.0.1:1/devtools/browser/guid-2?x=1' };
  const doBrowser = await bruto(porta, upgrade(porta, '/devtools/browser/stonic', '', 'cabeca'), { esperar: 'eco:oi', escrever: 'oi' });
  assert.strictEqual(doBrowser, 'HTTP/1.1 101 Switching Protocols\r\n\r\neco:oi');
  const daPagina = await bruto(porta, upgrade(porta, '/devtools/page/AB?y=2'), { esperar: 'eco:ola', escrever: 'ola' });
  assert.strictEqual(daPagina, 'HTTP/1.1 101 Switching Protocols\r\n\r\neco:ola');
  const cabecalhos = ['upgrade', 'websocket', 'connection', 'Upgrade', 'sec-websocket-key', 'chave==', 'x-dupla', 'a, b', 'set-cookie', 'c=1', 'set-cookie', 'd=2', 'Host', `127.0.0.1:${cena.cdpPort}`];
  assert.deepStrictEqual(cena.chromium, [
    'GET /json/version',
    { url: '/devtools/browser/guid-2', cabecalhos, head: 'cabeca' },
    { url: '/devtools/page/AB?y=2', cabecalhos, head: '' },
  ]);
  const anexado = (alvo) => `log [CDP Shim] CDP client attached to Chromium (port ${cena.cdpPort}, ${alvo}).`;
  assert.deepStrictEqual(cena.diario, [
    'launch', `log: shim connect OK in Nms (port ${cena.cdpPort})`, anexado('/devtools/browser/guid-2'),
    'launch', `log: shim connect OK in Nms (port ${cena.cdpPort})`, anexado('/devtools/page/AB?y=2'),
  ]);
});

test('upgrade: Chromium que some no meio derruba o cliente com aviso', async () => {
  const real = cena.cdpPort;
  cena.rodando = true;
  cena.cdpPort = await reservarPorta();
  cena.versao = null;
  const resposta = await bruto(porta, upgrade(porta, '/devtools/page/9'));
  assert.strictEqual(resposta, '');
  assert.deepStrictEqual(cena.diario.slice(0, 2), ['launch', `log: shim connect OK in Nms (port ${cena.cdpPort})`]);
  assert.match(cena.diario[2], /^warn \[CDP Shim\] CDP tunnel upstream error: connect ECONNREFUSED/);
  cena.cdpPort = real;
});
