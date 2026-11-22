'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const WebSocket = require('ws');
const RemoteAccessService = require('../electron/services/remote-access');

const abrirCliente = (porta) => new Promise((resolve, reject) => {
  const ws = new WebSocket(`ws://127.0.0.1:${porta}/socket.io/?EIO=4&transport=websocket`);
  const cliente = { ws, eventos: [], desconectado: false };
  ws.on('error', reject);
  ws.on('message', (bruto) => {
    const texto = bruto.toString();
    if (texto === '2') return ws.send('3');
    if (texto.startsWith('0')) return ws.send('40');
    if (texto.startsWith('40')) return resolve(cliente);
    if (texto.startsWith('41')) cliente.desconectado = true;
    if (texto.startsWith('42')) cliente.eventos.push(JSON.parse(texto.slice(2)));
  });
});

const emitir = (cliente, evento, dados) => cliente.ws.send(`42${JSON.stringify(dados === undefined ? [evento] : [evento, dados])}`);
const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nomes = (cliente) => cliente.eventos.map(([evento]) => evento);

async function esperarEvento(cliente, evento) {
  for (let i = 0; i < 100 && !nomes(cliente).includes(evento); i++) await esperar(20);
}

const valorAleatorio = (prefixo) => `${prefixo}_${crypto.randomBytes(8).toString('hex')}`;

async function subirServico() {
  const chaveGroq = valorAleatorio('groq');
  const chaveFirebase = valorAleatorio('fb');
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-access-'));
  fs.writeFileSync(path.join(pasta, 'groq_key.json'), JSON.stringify({ apiKey: chaveGroq }));
  fs.writeFileSync(path.join(pasta, 'firebase_config.json'), JSON.stringify({ apiKey: chaveFirebase }));
  const servico = new RemoteAccessService({ getPath: () => pasta });
  servico.port = 0;
  await servico.start();
  const { token } = servico.tokens.values().next().value;
  const porta = servico.httpServer.address().port;
  const clientes = [];
  const conectar = async () => { const cliente = await abrirCliente(porta); clientes.push(cliente); return cliente; };
  const encerrar = async () => {
    clientes.forEach((cliente) => cliente.ws.close());
    servico.io.close();
    fs.rmSync(pasta, { recursive: true, force: true });
  };
  return { servico, token, porta, pasta, chaveGroq, chaveFirebase, conectar, encerrar };
}

async function autenticar(cliente, token) {
  emitir(cliente, 'authenticate', { token });
  await esperarEvento(cliente, 'authenticated');
}

test('aviso ao celular vai só para quem se autenticou', async () => {
  const { servico, token, conectar, encerrar } = await subirServico();
  try {
    const autenticado = await conectar();
    const anonimo = await conectar();
    await autenticar(autenticado, token);

    servico.broadcastToMobile('aviso-teste', { texto: 'segredo' });
    await esperar(300);

    assert.ok(nomes(autenticado).includes('aviso-teste'), 'o autenticado recebe o aviso');
    assert.deepEqual(nomes(anonimo), [], 'quem não se autenticou não recebe nada');
  } finally {
    await encerrar();
  }
});

test('get-groq-key só responde a socket autenticado', async () => {
  const { token, chaveGroq, conectar, encerrar } = await subirServico();
  try {
    const anonimo = await conectar();
    emitir(anonimo, 'get-groq-key');
    await esperar(300);
    assert.deepEqual(nomes(anonimo), [], 'anônimo não recebe a chave');
    assert.ok(!JSON.stringify(anonimo.eventos).includes(chaveGroq));

    const autenticado = await conectar();
    await autenticar(autenticado, token);
    emitir(autenticado, 'get-groq-key');
    await esperar(300);
    assert.ok(nomes(autenticado).filter((nome) => nome === 'groq-key').length >= 2, 'o autenticado recebe a chave ao entrar e ao pedir');
  } finally {
    await encerrar();
  }
});

test('configuração do Firebase por HTTP exige token válido', async () => {
  const { token, porta, pasta, chaveFirebase, encerrar } = await subirServico();
  const base = `http://127.0.0.1:${porta}`;
  const caminhoConfig = path.join(pasta, 'firebase_config.json');
  const cabecalho = (valor) => ({ 'Content-Type': 'application/json', ...(valor ? { Authorization: `Bearer ${valor}` } : {}) });
  try {
    const leituraAnonima = await fetch(`${base}/api/get-firebase-config`);
    assert.equal(leituraAnonima.status, 401);
    assert.ok(!(await leituraAnonima.text()).includes(chaveFirebase));

    const leituraTokenFalso = await fetch(`${base}/api/get-firebase-config`, { headers: cabecalho('TOKENFALSO') });
    assert.equal(leituraTokenFalso.status, 401);

    const gravacaoAnonima = await fetch(`${base}/api/save-firebase-config`, { method: 'POST', headers: cabecalho(), body: JSON.stringify({ apiKey: 'invasor' }) });
    assert.equal(gravacaoAnonima.status, 401);
    assert.ok(fs.readFileSync(caminhoConfig, 'utf8').includes(chaveFirebase), 'anônimo não sobrescreve o arquivo');

    const leitura = await fetch(`${base}/api/get-firebase-config`, { headers: cabecalho(token) });
    assert.equal(leitura.status, 200);
    assert.deepEqual(await leitura.json(), { apiKey: chaveFirebase });

    const gravacao = await fetch(`${base}/api/save-firebase-config`, { method: 'POST', headers: cabecalho(token), body: JSON.stringify({ apiKey: 'novo' }) });
    assert.equal(gravacao.status, 200);
    assert.match(fs.readFileSync(caminhoConfig, 'utf8'), /novo/);

    const preflight = await fetch(`${base}/api/get-firebase-config`, { method: 'OPTIONS' });
    assert.equal(preflight.status, 204);
    assert.match(preflight.headers.get('access-control-allow-headers'), /Authorization/i);
  } finally {
    await encerrar();
  }
});

test('authenticate sem payload é recusado e não derruba o processo', async () => {
  const { servico, token, conectar, encerrar } = await subirServico();
  try {
    for (const carga of [undefined, null, 'texto', 42]) {
      const cliente = await conectar();
      emitir(cliente, 'authenticate', carga);
      await esperarEvento(cliente, 'authenticated');
      assert.deepEqual(cliente.eventos[0], ['authenticated', { success: false, error: 'Invalid token' }]);
    }
    assert.equal(servico.connectedClients.size, 0);

    const legitimo = await conectar();
    await autenticar(legitimo, token);
    assert.deepEqual(legitimo.eventos[0], ['authenticated', { success: true }]);
  } finally {
    await encerrar();
  }
});

test('regenerar o token desconecta e tira da sala quem usava o token antigo', async () => {
  const { servico, token, conectar, encerrar } = await subirServico();
  try {
    const antigo = await conectar();
    await autenticar(antigo, token);
    assert.equal(servico.connectedClients.size, 1);

    servico.revogarTodosOsTokens();
    const novo = servico.generateToken('Default Mobile');
    await esperar(300);

    assert.ok(nomes(antigo).includes('token-revoked'), 'o socket antigo é avisado');
    assert.equal(antigo.desconectado, true, 'o socket antigo é desconectado');
    assert.equal(servico.connectedClients.size, 0);
    assert.equal(servico.io.of('/').adapter.rooms.get('autenticados')?.size ?? 0, 0, 'sai da sala');

    servico.broadcastToMobile('aviso-pos-regeneracao', { texto: 'segredo' });
    await esperar(200);
    assert.ok(!nomes(antigo).includes('aviso-pos-regeneracao'));

    const reconectado = await conectar();
    await autenticar(reconectado, novo.token);
    assert.deepEqual(reconectado.eventos[0], ['authenticated', { success: true }]);
  } finally {
    await encerrar();
  }
});
