'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const WebSocket = require('ws');
const RemoteAccessService = require('../electron/services/remote-access');
const { LimiteDeTentativas, clienteDaConexao, FALHAS_LIVRES } = require('../electron/services/limite-tentativas');

delete process.env.NOVA_SMOKE_TEST;
delete process.env.NOVA_REMOTE_TUNNEL;

const tentarSocket = (porta, token, cliente) => new Promise((resolve, reject) => {
  const ws = new WebSocket(`ws://127.0.0.1:${porta}/socket.io/?EIO=4&transport=websocket`, { headers: { 'cf-connecting-ip': cliente } });
  const prazo = setTimeout(() => { ws.close(); reject(new Error('sem resposta de authenticated')); }, 3000);
  ws.on('error', reject);
  ws.on('message', (bruto) => {
    const texto = bruto.toString();
    if (texto === '2') return ws.send('3');
    if (texto.startsWith('0')) return ws.send('40');
    if (texto.startsWith('40')) return ws.send(`42${JSON.stringify(['authenticate', { token }])}`);
    if (texto.startsWith('42')) {
      const [evento, carga] = JSON.parse(texto.slice(2));
      if (evento !== 'authenticated') return;
      clearTimeout(prazo);
      ws.close();
      resolve(carga);
    }
  });
});

const tentarHttp = async (porta, token, cliente) => (await fetch(`http://127.0.0.1:${porta}/api/get-firebase-config`, {
  headers: { Authorization: `Bearer ${token}`, 'cf-connecting-ip': cliente }
})).status;

async function subirServico(tokensSalvos, { tunel = true } = {}) {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'forca-token-'));
  if (tokensSalvos) fs.writeFileSync(path.join(pasta, 'remote_tokens.json'), JSON.stringify({ tokens: tokensSalvos }));
  const servico = new RemoteAccessService({ getPath: () => pasta });
  servico.port = 0;
  await servico.start();
  if (tunel) {
    servico.cloudflaredProcess = {};
    servico.publicUrl = 'https://exemplo.trycloudflare.com';
  }
  const porta = servico.httpServer.address().port;
  const encerrar = () => {
    servico.cloudflaredProcess = null;
    servico.io.close();
    fs.rmSync(pasta, { recursive: true, force: true });
  };
  return { servico, porta, pasta, encerrar };
}

const chutes = Array.from({ length: FALHAS_LIVRES + 20 }, (_, i) => `CHUTE${String(i).padStart(27, '0')}`);

test('token novo tem 128 bits e o formato é aceito pelo cliente do celular', async () => {
  const { servico, porta, encerrar } = await subirServico(undefined, { tunel: false });
  try {
    const { token } = servico.generateToken('Celular');
    assert.match(token, /^[0-9A-F]{32}$/);
    assert.equal(new Set(Array.from({ length: 50 }, () => servico.generateToken().token)).size, 50);
    assert.deepEqual(await tentarSocket(porta, token, '203.0.113.7'), { success: true });
    assert.equal(await tentarHttp(porta, token, '203.0.113.7'), 200);
  } finally { encerrar(); }
});

test('token salvo de 32 bits é trocado na abertura e o token forte salvo continua valendo', async () => {
  const forte = 'AB'.repeat(16);
  const { servico, porta, pasta, encerrar } = await subirServico({
    A1B2C3D4: { token: 'A1B2C3D4', deviceName: 'Antigo', createdAt: 1, lastUsed: null, active: true },
    [forte]: { token: forte, deviceName: 'Forte', createdAt: 1, lastUsed: null, active: true }
  });
  try {
    assert.deepEqual([...servico.tokens.keys()], [forte]);
    assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(pasta, 'remote_tokens.json'), 'utf8')).tokens), [forte]);
    assert.equal((await tentarSocket(porta, 'A1B2C3D4', '203.0.113.8')).success, false);
    assert.equal((await tentarSocket(porta, forte, '203.0.113.9')).success, true);
  } finally { encerrar(); }
});

test('só com token fraco salvo, a abertura gera um token forte novo para o usuário ler no QR', async () => {
  const { servico, encerrar } = await subirServico({
    A1B2C3D4: { token: 'A1B2C3D4', deviceName: 'Antigo', createdAt: 1, lastUsed: null, active: true }
  });
  try {
    const [novo] = [...servico.tokens.values()];
    assert.equal(servico.tokens.size, 1);
    assert.match(novo.token, /^[0-9A-F]{32}$/);
    assert.equal(novo.active, true);
  } finally { encerrar(); }
});

test('força bruta no socket para depois das falhas livres e o usuário certo de outro endereço entra', async () => {
  const { servico, token, porta, encerrar } = await subirServico().then((s) => ({ ...s, token: s.servico.tokens.values().next().value.token }));
  try {
    const respostas = [];
    for (const chute of chutes) respostas.push(await tentarSocket(porta, chute, '198.51.100.1'));
    assert.ok(respostas.every((r) => r.success === false));
    assert.equal(respostas.filter((r) => r.error === 'Invalid token').length, FALHAS_LIVRES + 1);
    assert.ok(respostas.slice(FALHAS_LIVRES + 1).every((r) => r.bloqueado === true && /Muitas tentativas/.test(r.error)));
    assert.equal((await tentarSocket(porta, token, '198.51.100.1')).success, false);
    assert.deepEqual(await tentarSocket(porta, token, '198.51.100.2'), { success: true });
    assert.equal(servico.limiteDeTentativas.clientes.has('198.51.100.2'), false);
  } finally { encerrar(); }
});

test('força bruta no Bearer HTTP para depois das falhas livres e o usuário certo ainda entra', async () => {
  const { servico, porta, encerrar } = await subirServico();
  const { token } = servico.tokens.values().next().value;
  try {
    const status = [];
    for (const chute of chutes) status.push(await tentarHttp(porta, chute, '198.51.100.3'));
    assert.ok(status.every((s) => s === 401));
    assert.equal(servico.limiteDeTentativas.clientes.get('198.51.100.3').falhas, FALHAS_LIVRES + 1);
    assert.equal(await tentarHttp(porta, token, '198.51.100.3'), 401);
    assert.equal(await tentarHttp(porta, token, '198.51.100.4'), 200);
  } finally { encerrar(); }
});

test('falhas por socket e por HTTP contam juntas e a requisição sem token não conta', async () => {
  const { servico, porta, encerrar } = await subirServico();
  try {
    for (let i = 0; i < 3; i++) await tentarSocket(porta, chutes[i], '198.51.100.5');
    for (let i = 0; i < 3; i++) await tentarHttp(porta, chutes[i], '198.51.100.5');
    assert.equal(servico.limiteDeTentativas.bloqueado('198.51.100.5'), true);
    for (let i = 0; i < 20; i++) await fetch(`http://127.0.0.1:${porta}/api/get-firebase-config`, { headers: { 'cf-connecting-ip': '198.51.100.6' } });
    assert.equal(servico.limiteDeTentativas.clientes.has('198.51.100.6'), false);
  } finally { encerrar(); }
});

test('a espera cresce a cada falha, tem teto e acaba com o tempo', () => {
  let agora = 0;
  const limite = new LimiteDeTentativas({ agora: () => agora });
  for (let i = 0; i < FALHAS_LIVRES; i++) limite.registrarFalha('a');
  assert.equal(limite.bloqueado('a'), false);
  limite.registrarFalha('a');
  assert.equal(limite.bloqueado('a'), true);
  agora = 29999;
  assert.equal(limite.bloqueado('a'), true);
  agora = 30000;
  assert.equal(limite.bloqueado('a'), false);
  limite.registrarFalha('a');
  agora = 30000 + 59999;
  assert.equal(limite.bloqueado('a'), true);
  for (let i = 0; i < 30; i++) limite.registrarFalha('a');
  agora += 15 * 60 * 1000;
  assert.equal(limite.bloqueado('a'), false);
  assert.equal(limite.bloqueado('b'), false);
});

test('o endereço do túnel só vale com o túnel ativo e a conexão vindo da própria máquina', () => {
  const falsificado = { 'cf-connecting-ip': '203.0.113.9' };
  assert.equal(clienteDaConexao('127.0.0.1', falsificado, true), '203.0.113.9');
  assert.equal(clienteDaConexao('::ffff:127.0.0.1', falsificado, true), '203.0.113.9');
  assert.equal(clienteDaConexao('192.0.2.50', falsificado, true), '192.0.2.50');
  assert.equal(clienteDaConexao('127.0.0.1', {}, true), '127.0.0.1');
  assert.equal(clienteDaConexao('127.0.0.1', falsificado, false), '127.0.0.1');
  assert.equal(clienteDaConexao('127.0.0.1', falsificado), '127.0.0.1');
});

test('com o túnel desligado, cabeçalho falsificado não escolhe a chave: vale o par da conexão', async () => {
  const { servico, porta, encerrar } = await subirServico(undefined, { tunel: false });
  const { token } = servico.tokens.values().next().value;
  try {
    for (let i = 0; i < 40; i++) await tentarHttp(porta, chutes[i % chutes.length], `203.0.113.${i}`);
    assert.deepEqual([...servico.limiteDeTentativas.clientes.keys()], ['127.0.0.1']);
    assert.equal(servico.limiteDeTentativas.bloqueado('127.0.0.1'), true);
    assert.equal(await tentarHttp(porta, token, '203.0.113.200'), 401);
    for (let i = 0; i < 40; i++) await tentarSocket(porta, chutes[i % chutes.length], `203.0.113.${i}`);
    assert.deepEqual([...servico.limiteDeTentativas.clientes.keys()], ['127.0.0.1']);
  } finally { encerrar(); }
});

test('com o túnel ativo a chave é o cabeçalho do cloudflared: bloquear um cliente não trava outro', async () => {
  const { servico, porta, encerrar } = await subirServico();
  const { token } = servico.tokens.values().next().value;
  try {
    for (let i = 0; i < 10; i++) await tentarHttp(porta, chutes[i], '192.0.2.77');
    assert.equal(await tentarHttp(porta, token, '192.0.2.77'), 401);
    assert.equal(await tentarHttp(porta, token, '192.0.2.78'), 200);
  } finally { encerrar(); }
});

test('túnel que não é o cloudflared não habilita o cabeçalho', async () => {
  const { servico, porta, encerrar } = await subirServico(undefined, { tunel: false });
  servico.publicUrl = 'https://exemplo.loca.lt';
  try {
    await tentarHttp(porta, chutes[0], '203.0.113.1');
    assert.deepEqual([...servico.limiteDeTentativas.clientes.keys()], ['127.0.0.1']);
  } finally { servico.publicUrl = null; encerrar(); }
});

test('página de outra origem não passa no Socket.IO nem no polling, e as origens do próprio PWA passam', async () => {
  const { porta, encerrar } = await subirServico();
  try {
    const sondar = (origem, extra = {}) => fetch(`http://127.0.0.1:${porta}/socket.io/?EIO=4&transport=polling`, { headers: { ...(origem && { Origin: origem }), ...extra } });
    const alheia = await sondar('http://127.0.0.1:1', { 'cf-connecting-ip': '192.0.2.77' });
    assert.equal(alheia.status, 403);
    assert.equal(alheia.headers.get('access-control-allow-origin'), null);
    const preflightAlheio = await fetch(`http://127.0.0.1:${porta}/socket.io/?EIO=4&transport=polling`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://site-qualquer.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'cf-connecting-ip' }
    });
    assert.equal(preflightAlheio.headers.get('access-control-allow-origin'), null);
    assert.equal((await sondar(`http://127.0.0.1:${porta}`)).status, 200);
    assert.equal((await sondar(`http://localhost:${porta}`)).status, 200);
    assert.equal((await sondar('https://exemplo.trycloudflare.com')).status, 200);
    assert.equal((await sondar(null)).status, 200);
    const erro = await new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${porta}/socket.io/?EIO=4&transport=websocket`, { headers: { Origin: 'https://site-qualquer.example' } });
      ws.on('open', () => { ws.close(); resolve(null); });
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode));
      ws.on('error', () => {});
    });
    assert.ok(erro >= 400);
  } finally { encerrar(); }
});

test('as falhas envelhecem depois de 1 h e o erro de digitação seguinte não bloqueia', () => {
  let agora = 0;
  const limite = new LimiteDeTentativas({ agora: () => agora });
  for (let i = 0; i < FALHAS_LIVRES + 1; i++) limite.registrarFalha('a');
  assert.equal(limite.bloqueado('a'), true);
  agora = 60 * 60 * 1000 + 1;
  limite.registrarFalha('a');
  assert.equal(limite.bloqueado('a'), false);
  assert.equal(limite.clientes.get('a').falhas, 1);
});

test('o cliente do celular mostra a mensagem de bloqueio e não "token inválido"', () => {
  const origem = fs.readFileSync(path.join(__dirname, '../electron/pwa/app.js'), 'utf8');
  assert.match(origem, /showError\(data\.bloqueado \? data\.error : 'Token inválido/);
});
