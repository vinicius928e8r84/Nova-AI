'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { carregarMain } = require('./ajuda/carregar-main');

function rtmpFalso() {
  const rtmp = { chamadas: [], falhar: null };
  for (const metodo of ['startBroadcast', 'stopBroadcast']) {
    rtmp[metodo] = async () => {
      rtmp.chamadas.push(metodo);
      if (rtmp.falhar === metodo) throw new Error(`${metodo} quebrou`);
    };
  }
  rtmp.receiveVideoChunk = (pedaco) => rtmp.chamadas.push(['receiveVideoChunk', pedaco]);
  rtmp.startRtmpServer = () => rtmp.chamadas.push('startRtmpServer');
  return rtmp;
}

test('main.js registra 226 canais handle e 11 on, e os de rtmp, license e ltm', () => {
  const main = carregarMain();
  assert.strictEqual(main.canais.handle.size, 226);
  assert.strictEqual(main.canais.on.size, 11);
  for (const canal of ['rtmp:start-broadcast', 'rtmp:stop-broadcast', 'license:get-status', 'license:verify', 'license:save', 'ltm:save-insight', 'ltm:get-insights', 'ltm:clear-all']) {
    assert.ok(main.canais.handle.has(canal), canal);
  }
  assert.ok(main.canais.on.has('rtmp:video-chunk'));
});

test('rtmp:start-broadcast e rtmp:stop-broadcast: sucesso e erro com a mensagem', async () => {
  const rtmp = rtmpFalso();
  const main = carregarMain({ modulos: { './services/rtmp-server': rtmp } });
  rtmp.chamadas.length = 0;
  assert.deepStrictEqual(await main.invocar('rtmp:start-broadcast'), { success: true });
  assert.deepStrictEqual(await main.invocar('rtmp:stop-broadcast'), { success: true });
  rtmp.falhar = 'startBroadcast';
  assert.deepStrictEqual(await main.invocar('rtmp:start-broadcast'), { success: false, error: 'startBroadcast quebrou' });
  rtmp.falhar = 'stopBroadcast';
  assert.deepStrictEqual(await main.invocar('rtmp:stop-broadcast'), { success: false, error: 'stopBroadcast quebrou' });
  assert.deepStrictEqual(rtmp.chamadas, ['startBroadcast', 'stopBroadcast', 'startBroadcast', 'stopBroadcast']);
});

test('rtmp:video-chunk repassa o mesmo buffer ao servidor RTMP e nao responde', () => {
  const rtmp = rtmpFalso();
  const main = carregarMain({ modulos: { './services/rtmp-server': rtmp } });
  rtmp.chamadas.length = 0;
  const pedaco = Buffer.from([1, 2, 3]);
  const evento = main.emitir('rtmp:video-chunk', pedaco);
  assert.strictEqual(rtmp.chamadas.length, 1);
  assert.strictEqual(rtmp.chamadas[0][0], 'receiveVideoChunk');
  assert.strictEqual(rtmp.chamadas[0][1], pedaco);
  assert.strictEqual(evento.returnValue, undefined);
});

test('license:*: edicao local pro ativa, sem chave, sem servico de licenca', async () => {
  const main = carregarMain();
  const status = { plan: 'pro', status: 'active', edition: 'mac-local', activationRequired: false };
  assert.deepStrictEqual(await main.invocar('license:get-status'), status);
  assert.deepStrictEqual(await main.invocar('license:verify', { key: 'qualquer' }), { success: true, ...status });
  assert.strictEqual(await main.invocar('license:save', { key: 'qualquer' }), true);
  assert.deepStrictEqual(fs.readdirSync(main.pasta('userData')), []);
});

test('ltm:save-insight grava em userData/memories.json com id e timestamp do relogio', async () => {
  const main = carregarMain();
  const arquivo = path.join(main.pasta('userData'), 'memories.json');
  const relogio = Date.now;
  let agora = 1700000000000;
  Date.now = () => agora;
  try {
    assert.strictEqual(await main.invocar('ltm:save-insight', { content: 'Gosta de cafe', category: 'preferencia' }), true);
    agora += 5;
    assert.strictEqual(await main.invocar('ltm:save-insight', { content: 'Mora em Recife', category: 'fato' }), true);
  } finally {
    Date.now = relogio;
  }
  const texto = fs.readFileSync(arquivo, 'utf8');
  const esperado = [
    { id: '1700000000000', content: 'Gosta de cafe', category: 'preferencia', timestamp: 1700000000000 },
    { id: '1700000000005', content: 'Mora em Recife', category: 'fato', timestamp: 1700000000005 },
  ];
  assert.deepStrictEqual(JSON.parse(texto), esperado);
  assert.strictEqual(texto, JSON.stringify(esperado, null, 2));
});

test('ltm:save-insight devolve false quando memories.json esta corrompido e nao o reescreve', async () => {
  const main = carregarMain();
  const arquivo = path.join(main.pasta('userData'), 'memories.json');
  fs.writeFileSync(arquivo, '{quebrado');
  assert.strictEqual(await main.invocar('ltm:save-insight', { content: 'x', category: 'y' }), false);
  assert.strictEqual(fs.readFileSync(arquivo, 'utf8'), '{quebrado');
});

test('ltm:get-insights: vazio sem arquivo, tudo sem busca, filtro sem caixa por conteudo, [] se corrompido', async () => {
  const main = carregarMain();
  const arquivo = path.join(main.pasta('userData'), 'memories.json');
  assert.deepStrictEqual(await main.invocar('ltm:get-insights'), []);
  const memorias = [
    { id: '1', content: 'Gosta de CAFE forte', category: 'preferencia' },
    { id: '2', content: 'Mora em Recife', category: 'cafe' },
    { id: '3', content: 'cafezinho as 15h', category: 'rotina' },
  ];
  fs.writeFileSync(arquivo, JSON.stringify(memorias));
  assert.deepStrictEqual(await main.invocar('ltm:get-insights'), memorias);
  assert.deepStrictEqual(await main.invocar('ltm:get-insights', ''), memorias);
  assert.deepStrictEqual(await main.invocar('ltm:get-insights', null), memorias);
  assert.deepStrictEqual(await main.invocar('ltm:get-insights', 'Cafe'), [memorias[0], memorias[2]]);
  assert.deepStrictEqual(await main.invocar('ltm:get-insights', 'nada disso'), []);
  fs.writeFileSync(arquivo, 'nao e json');
  assert.deepStrictEqual(await main.invocar('ltm:get-insights', 'cafe'), []);
});

test('ltm:clear-all apaga memories.json e devolve true, com ou sem arquivo', async () => {
  const main = carregarMain();
  const arquivo = path.join(main.pasta('userData'), 'memories.json');
  fs.writeFileSync(arquivo, '[]');
  fs.writeFileSync(path.join(main.pasta('userData'), 'history.json'), '[]');
  assert.strictEqual(await main.invocar('ltm:clear-all'), true);
  assert.strictEqual(fs.existsSync(arquivo), false);
  assert.ok(fs.existsSync(path.join(main.pasta('userData'), 'history.json')));
  assert.strictEqual(await main.invocar('ltm:clear-all'), true);
});
