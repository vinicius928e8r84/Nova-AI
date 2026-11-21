'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { encenar } = require('./ytdlp-manager.palco');

const MODULO = path.resolve(__dirname, '../ytdlp-manager.js');
const TASKKILL_DA_ARVORE = 'spawn taskkill ["/PID","4242","/T","/F"] {"windowsHide":true}';

function noSistema(plataforma, funcao) {
  const original = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { ...original, value: plataforma });
  try {
    return funcao();
  } finally {
    Object.defineProperty(process, 'platform', original);
  }
}

async function baixarComPid(palco, url, pid = 4242) {
  await palco.manager.manualDownload(url, 'mp3', 'video');
  palco.processo().pid = pid;
}

function encerramentos(registro) {
  return registro.filter(linha => linha === 'kill' || linha.startsWith('spawn taskkill'));
}

async function encerramentosDaCena(cena) {
  return encerramentos(await encenar(MODULO, cena));
}

test('Windows: cancelar mata a árvore do yt-dlp com taskkill /T /F', async () => {
  const vistos = await encerramentosDaCena(async palco => {
    await baixarComPid(palco, 'https://yt/c');
    palco.anotar(`cancelou ${noSistema('win32', () => palco.manager.cancelManualDownload())}`);
    palco.anotar(`ativo ${palco.manager.activeProcess}`);
  });
  assert.deepStrictEqual(vistos, [TASKKILL_DA_ARVORE]);
});

test('Windows: novo download manual mata a árvore do anterior', async () => {
  const vistos = await encerramentosDaCena(async palco => {
    await baixarComPid(palco, 'https://yt/1');
    await noSistema('win32', () => palco.manager.manualDownload('https://yt/2', 'mp3', 'video'));
  });
  assert.deepStrictEqual(vistos, [TASKKILL_DA_ARVORE]);
});

test('Windows: trocar o download pelo WhatsApp mata a árvore do atual', async () => {
  const vistos = await encerramentosDaCena(async palco => {
    palco.resultados.nova = { videos: [{ url: 'https://yt/n', title: 'Nova' }] };
    await baixarComPid(palco, 'https://yt/atual');
    await palco.manager.smartDownload('nova', 'mp3', 'video', 'chat-1');
    await noSistema('win32', () => palco.manager.handleConfirmation('haan'));
  });
  assert.deepStrictEqual(vistos, [TASKKILL_DA_ARVORE]);
});

test('Windows: sem taskkill, cai no kill do processo', async () => {
  const vistos = await encerramentosDaCena(async palco => {
    palco.killFalha = true;
    await baixarComPid(palco, 'https://yt/c');
    noSistema('win32', () => palco.manager.cancelManualDownload());
    palco.processo().falhar('spawn taskkill ENOENT');
  });
  assert.deepStrictEqual(vistos, [TASKKILL_DA_ARVORE, 'kill']);
});

test('Windows: processo sem pid (spawn falhou) só recebe kill', async () => {
  const vistos = await encerramentosDaCena(async palco => {
    await palco.manager.manualDownload('https://yt/c', 'mp3', 'video');
    noSistema('win32', () => palco.manager.cancelManualDownload());
  });
  assert.deepStrictEqual(vistos, ['kill']);
});

for (const plataforma of ['darwin', 'linux']) {
  test(`${plataforma}: cancelar e trocar continuam no kill do processo`, async () => {
    const vistos = await encerramentosDaCena(async palco => {
      await baixarComPid(palco, 'https://yt/1');
      await noSistema(plataforma, () => palco.manager.manualDownload('https://yt/2', 'mp3', 'video'));
      palco.processo().pid = 4243;
      noSistema(plataforma, () => palco.manager.cancelManualDownload());
    });
    assert.deepStrictEqual(vistos, ['kill', 'kill']);
  });
}
