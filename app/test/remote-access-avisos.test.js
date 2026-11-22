'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const WebSocket = require('ws');
const { Server } = require('socket.io');
const RemoteAccessService = require('../electron/services/remote-access');

const abrirCliente = (porta) => new Promise((resolve, reject) => {
  const ws = new WebSocket(`ws://127.0.0.1:${porta}/socket.io/?EIO=4&transport=websocket`);
  const cliente = { ws, eventos: [] };
  ws.on('error', reject);
  ws.on('message', (bruto) => {
    const texto = bruto.toString();
    if (texto === '2') return ws.send('3');
    if (texto.startsWith('0')) return ws.send('40');
    if (texto.startsWith('40')) return resolve(cliente);
    if (texto.startsWith('42')) cliente.eventos.push(JSON.parse(texto.slice(2)));
  });
});

const emitir = (cliente, evento, dados) => cliente.ws.send(`42${JSON.stringify([evento, dados])}`);
const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nomes = (cliente) => cliente.eventos.map(([evento]) => evento);

async function esperarEvento(cliente, evento) {
  for (let i = 0; i < 100 && !nomes(cliente).includes(evento); i++) await esperar(20);
}

test('aviso ao celular vai só para quem se autenticou', async () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-access-'));
  const servico = new RemoteAccessService({ getPath: () => pasta });
  const { token } = servico.tokens.values().next().value;
  servico.httpServer = http.createServer();
  servico.io = new Server(servico.httpServer);
  servico.setupSocketHandlers();
  await new Promise((resolve) => servico.httpServer.listen(0, '127.0.0.1', resolve));
  const { port } = servico.httpServer.address();

  const autenticado = await abrirCliente(port);
  const anonimo = await abrirCliente(port);
  emitir(autenticado, 'authenticate', { token });
  await esperarEvento(autenticado, 'authenticated');

  servico.broadcastToMobile('aviso-teste', { texto: 'segredo' });
  await esperar(300);

  try {
    assert.ok(nomes(autenticado).includes('aviso-teste'), 'o autenticado recebe o aviso');
    assert.deepEqual(nomes(anonimo), [], 'quem não se autenticou não recebe nada');
  } finally {
    autenticado.ws.close();
    anonimo.ws.close();
    servico.io.close();
    fs.rmSync(pasta, { recursive: true, force: true });
  }
});
