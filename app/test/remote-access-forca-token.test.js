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

async function subirServico(tokensSalvos) {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'forca-token-'));
  if (tokensSalvos) fs.writeFileSync(path.join(pasta, 'remote_tokens.json'), JSON.stringify({ tokens: tokensSalvos }));
  const servico = new RemoteAccessService({ getPath: () => pasta });
  servico.port = 0;
  await servico.start();
  const porta = servico.httpServer.address().port;
  const encerrar = () => {
    servico.io.close();
    fs.rmSync(pasta, { recursive: true, force: true });
  };
  return { servico, porta, pasta, encerrar };
}

const chutes = Array.from({ length: FALHAS_LIVRES + 20 }, (_, i) => `CHUTE${String(i).padStart(27, '0')}`);

test('token novo tem 128 bits e o formato é aceito pelo cliente do celular', async () => {
  const { servico, porta, encerrar } = await subirServico();
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
    assert.ok(respostas.slice(FALHAS_LIVRES + 1).every((r) => /Muitas tentativas/.test(r.error)));
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

test('o endereço do túnel só vale quando a conexão vem da própria máquina', () => {
  assert.equal(clienteDaConexao('127.0.0.1', { 'cf-connecting-ip': '203.0.113.9' }), '203.0.113.9');
  assert.equal(clienteDaConexao('::ffff:127.0.0.1', { 'cf-connecting-ip': '203.0.113.9' }), '203.0.113.9');
  assert.equal(clienteDaConexao('192.0.2.50', { 'cf-connecting-ip': '203.0.113.9' }), '192.0.2.50');
  assert.equal(clienteDaConexao('127.0.0.1', {}), '127.0.0.1');
});
