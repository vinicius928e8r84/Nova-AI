'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { carregarMain } = require('./ajuda/carregar-main');
const { carregarComArranqueCompleto } = require('./ajuda/arranque-completo');

const SEM_FEED = { success: false, message: 'Esta instalação não tem feed de atualização.' };

function autoUpdaterFalso() {
  const autoUpdater = {
    chamadas: [],
    ouvintes: new Map(),
    falhar: null,
    resultado: { updateInfo: { version: '9.9.9' } },
    on: (evento, ouvinte) => autoUpdater.ouvintes.set(evento, ouvinte),
  };
  for (const metodo of ['checkForUpdates', 'downloadUpdate']) {
    autoUpdater[metodo] = async () => {
      autoUpdater.chamadas.push(metodo);
      if (autoUpdater.falhar) throw autoUpdater.falhar;
      return autoUpdater.resultado;
    };
  }
  autoUpdater.quitAndInstall = (...args) => autoUpdater.chamadas.push(['quitAndInstall', ...args]);
  return autoUpdater;
}

function opcoesDoAtualizador(autoUpdater, comFeed, extras = {}) {
  return {
    ...extras,
    modulos: {
      'electron-updater': { autoUpdater },
      './services/paridade-utils': { hasUpdateConfig: () => comFeed.valor, edgeTtsBinary: () => 'edge-tts' },
    },
  };
}

function comNodeEnv(valor, funcao) {
  const antes = process.env.NODE_ENV;
  if (valor === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = valor;
  try {
    return funcao();
  } finally {
    if (antes === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = antes;
  }
}

const NIVEL_NO_REGISTRO = { info: 'log' };

function anotandoConsole(funcao) {
  const antes = { log: console.log, info: console.info, warn: console.warn, error: console.error };
  const chamadas = [];
  for (const nivel of Object.keys(antes)) console[nivel] = (...partes) => chamadas.push([NIVEL_NO_REGISTRO[nivel] || nivel, ...partes]);
  try {
    funcao();
  } finally {
    Object.assign(console, antes);
  }
  return chamadas;
}

test('o atualizador nasce com o download manual, a instalação ao sair e o registro que avisa a janela', () => {
  const autoUpdater = autoUpdaterFalso();
  const main = carregarMain(opcoesDoAtualizador(autoUpdater, { valor: true }));
  assert.strictEqual(autoUpdater.autoDownload, false);
  assert.strictEqual(autoUpdater.autoInstallOnAppQuit, true);
  assert.strictEqual(autoUpdater.forceDevUpdateConfig, undefined);

  const chamadas = anotandoConsole(() => {
    autoUpdater.logger.info('informação');
    autoUpdater.logger.warn('cuidado');
    autoUpdater.logger.error('erro');
  });
  assert.deepStrictEqual(chamadas, [['log', 'informação'], ['warn', 'cuidado'], ['error', 'erro']]);
  assert.deepStrictEqual(main.janelaPrincipal.enviados, [
    ['update-log', 'informação'], ['update-log', 'WARN: cuidado'], ['update-log', 'ERROR: erro'],
  ]);

  main.janelaPrincipal.destruida = true;
  anotandoConsole(() => autoUpdater.logger.info('depois de fechar'));
  assert.strictEqual(main.janelaPrincipal.enviados.length, 3);
});

test('em desenvolvimento o atualizador força a configuração de desenvolvimento', () => {
  const autoUpdater = autoUpdaterFalso();
  comNodeEnv('development', () => carregarMain(opcoesDoAtualizador(autoUpdater, { valor: true })));
  assert.strictEqual(autoUpdater.forceDevUpdateConfig, true);
});

test('check-for-update: em desenvolvimento, sem feed, com feed e com erro', async () => {
  const feed = { valor: true };
  const autoUpdater = autoUpdaterFalso();
  const emDesenvolvimento = carregarMain(opcoesDoAtualizador(autoUpdater, feed));
  assert.deepStrictEqual(await emDesenvolvimento.invocar('check-for-update'), { success: false, message: 'Bypassed in dev mode' });
  assert.deepStrictEqual(autoUpdater.chamadas, []);

  const main = carregarMain(opcoesDoAtualizador(autoUpdater, feed, { empacotado: true }));
  feed.valor = false;
  assert.deepStrictEqual(await main.invocar('check-for-update'), SEM_FEED);
  assert.deepStrictEqual(autoUpdater.chamadas, []);

  feed.valor = true;
  assert.deepStrictEqual(await main.invocar('check-for-update'), { success: true, version: '9.9.9' });
  autoUpdater.resultado = undefined;
  assert.deepStrictEqual(await main.invocar('check-for-update'), { success: true, version: undefined });
  autoUpdater.falhar = new Error('sem rede');
  assert.deepStrictEqual(await main.invocar('check-for-update'), { error: 'sem rede' });
  assert.deepStrictEqual(autoUpdater.chamadas, ['checkForUpdates', 'checkForUpdates', 'checkForUpdates']);
});

test('download-update: sem feed, com feed e com erro, sem olhar se o app é empacotado', async () => {
  const feed = { valor: false };
  const autoUpdater = autoUpdaterFalso();
  const main = carregarMain(opcoesDoAtualizador(autoUpdater, feed));
  assert.deepStrictEqual(await main.invocar('download-update'), SEM_FEED);
  assert.deepStrictEqual(autoUpdater.chamadas, []);
  feed.valor = true;
  assert.deepStrictEqual(await main.invocar('download-update'), { success: true });
  autoUpdater.falhar = new Error('disco cheio');
  assert.deepStrictEqual(await main.invocar('download-update'), { error: 'disco cheio' });
  assert.deepStrictEqual(autoUpdater.chamadas, ['downloadUpdate', 'downloadUpdate']);
});

test('install-update: sem feed não fecha o app; com feed fecha e instala sem pedir confirmação', async () => {
  const feed = { valor: false };
  const autoUpdater = autoUpdaterFalso();
  const main = carregarMain(opcoesDoAtualizador(autoUpdater, feed));
  assert.deepStrictEqual(await main.invocar('install-update'), SEM_FEED);
  assert.deepStrictEqual(autoUpdater.chamadas, []);
  feed.valor = true;
  assert.deepStrictEqual(await main.invocar('install-update'), { success: true });
  assert.deepStrictEqual(autoUpdater.chamadas, [['quitAndInstall', false, true]]);
});

test('get-app-version devolve a versão do app', async () => {
  const main = carregarMain(opcoesDoAtualizador(autoUpdaterFalso(), { valor: true }));
  assert.strictEqual(await main.invocar('get-app-version'), '0.0.0-teste');
});

test('os seis eventos do atualizador contam no console e mandam à janela criada o que mandam hoje', () => {
  const autoUpdater = autoUpdaterFalso();
  const { main } = carregarComArranqueCompleto(opcoesDoAtualizador(autoUpdater, { valor: true }));
  assert.deepStrictEqual([...autoUpdater.ouvintes.keys()], [
    'checking-for-update', 'update-available', 'update-not-available', 'download-progress', 'update-downloaded', 'error',
  ]);
  const janela = main.janelaPrincipal;
  janela.enviados.length = 0;
  const disparar = (evento, dados) => anotandoConsole(() => autoUpdater.ouvintes.get(evento)(dados));

  assert.deepStrictEqual(disparar('checking-for-update'), [['log', '🔍 [NOVA UPDATE] Checking for updates...']]);
  assert.deepStrictEqual(janela.enviados, []);

  assert.deepStrictEqual(disparar('update-available', { version: '2.0.0', releaseDate: '2026-11-01' }), [
    ['log', '🎉 [NOVA UPDATE] Update available:', '2.0.0'],
    ['log', '   Release Date:', '2026-11-01'],
    ['log', '   Current Version:', '0.0.0-teste'],
  ]);
  assert.deepStrictEqual(janela.enviados.pop(), ['update-available', { version: '2.0.0', releaseDate: '2026-11-01' }]);

  assert.deepStrictEqual(disparar('update-not-available', {}), [['log', '✓ [NOVA UPDATE] No updates available. Current version is latest:', '0.0.0-teste']]);
  assert.deepStrictEqual(janela.enviados, []);

  const progresso = { percent: 41.6, bytesPerSecond: 2048, transferred: 3 * 1024 * 1024, total: 10 * 1024 * 1024 };
  assert.deepStrictEqual(disparar('download-progress', progresso), [['log', '📥 [NOVA UPDATE] Download progress: 42% (3.0MB / 10.0MB)']]);
  assert.deepStrictEqual(janela.enviados.pop(), ['update-download-progress', { percent: 42, bytesPerSecond: 2048, transferred: 3 * 1024 * 1024, total: 10 * 1024 * 1024 }]);

  assert.deepStrictEqual(disparar('update-downloaded', { version: '2.0.0' }), [['log', '✅ [NOVA UPDATE] Update downloaded successfully:', '2.0.0']]);
  assert.deepStrictEqual(janela.enviados.pop(), ['update-downloaded', { version: '2.0.0' }]);
  assert.deepStrictEqual(disparar('update-downloaded', undefined), [['log', '✅ [NOVA UPDATE] Update downloaded successfully:', undefined]]);
  assert.deepStrictEqual(janela.enviados.pop(), ['update-downloaded', { version: undefined }]);

  const erro = Object.assign(new Error('quebrou'), { code: 'ERR_X' });
  assert.deepStrictEqual(disparar('error', erro), [
    ['error', '❌ [NOVA UPDATE ERROR]:', 'quebrou'],
    ['error', 'Full error details:', erro],
  ]);
  assert.deepStrictEqual(janela.enviados.pop(), ['update-error', { message: 'quebrou', code: 'ERR_X', stack: erro.stack }]);
});

test('a busca na abertura: só empacotado espera 5 s e só busca com feed', async () => {
  const feed = { valor: true };
  const emDesenvolvimento = autoUpdaterFalso();
  const desenvolvimento = carregarComArranqueCompleto(opcoesDoAtualizador(emDesenvolvimento, feed));
  const buscasEmDesenvolvimento = desenvolvimento.temporizadores.filter((t) => t.tipo === 'timeout' && t.espera === 5000);
  assert.deepStrictEqual(emDesenvolvimento.chamadas, []);

  const autoUpdater = autoUpdaterFalso();
  const { temporizadores } = carregarComArranqueCompleto(opcoesDoAtualizador(autoUpdater, feed, { empacotado: true }));
  const buscas = temporizadores.filter((t) => t.tipo === 'timeout' && t.espera === 5000);
  assert.strictEqual(buscas.length, buscasEmDesenvolvimento.length + 1);
  const busca = buscas[buscas.length - 1];
  assert.deepStrictEqual(autoUpdater.chamadas, []);

  feed.valor = false;
  busca.funcao();
  assert.deepStrictEqual(autoUpdater.chamadas, []);

  feed.valor = true;
  busca.funcao();
  assert.deepStrictEqual(autoUpdater.chamadas, ['checkForUpdates']);

  autoUpdater.falhar = new Error('sem rede');
  const falha = [];
  const antes = { log: console.log, info: console.info };
  console.log = (...partes) => falha.push(['log', ...partes]);
  console.info = console.log;
  try {
    busca.funcao();
    await new Promise((resolver) => setImmediate(resolver));
  } finally {
    Object.assign(console, antes);
  }
  assert.deepStrictEqual(falha, [['log', '[AutoUpdater] Production check failed:', 'sem rede']]);
});
