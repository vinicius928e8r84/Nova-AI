'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { liberar } = require('../camera-acesso');

const montar = (estado, platform, concede = true) => {
  const abertos = [];
  const pedidos = [];
  return {
    abertos,
    pedidos,
    args: {
      platform,
      systemPreferences: {
        getMediaAccessStatus: () => estado,
        askForMediaAccess: async tipo => { pedidos.push(tipo); return concede; },
      },
      shell: { openExternal: async url => { abertos.push(url); } },
    },
  };
};

const URL_MAC = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera';
const URL_WIN = 'ms-settings:privacy-webcam';

for (const platform of ['darwin', 'win32']) {
  test(`${platform}: concedida não abre Ajustes`, async () => {
    const m = montar('granted', platform);
    assert.deepStrictEqual(await liberar(m.args), { success: true, estado: 'granted' });
    assert.deepStrictEqual(m.abertos, []);
  });
  for (const estado of ['denied', 'restricted']) {
    test(`${platform}: ${estado} abre os Ajustes de câmera`, async () => {
      const m = montar(estado, platform);
      assert.deepStrictEqual(await liberar(m.args), { success: false, estado });
      assert.deepStrictEqual(m.abertos, [platform === 'darwin' ? URL_MAC : URL_WIN]);
    });
  }
}

test('darwin: não determinada pede permissão ao sistema', async () => {
  const m = montar('not-determined', 'darwin', true);
  assert.deepStrictEqual(await liberar(m.args), { success: true, estado: 'granted' });
  assert.deepStrictEqual(m.pedidos, ['camera']);
  assert.deepStrictEqual(m.abertos, []);
});

test('darwin: não determinada e recusada devolve falha sem abrir Ajustes', async () => {
  const m = montar('not-determined', 'darwin', false);
  assert.deepStrictEqual(await liberar(m.args), { success: false, estado: 'denied' });
  assert.deepStrictEqual(m.abertos, []);
});

test('win32: não determinada abre os Ajustes', async () => {
  const m = montar('not-determined', 'win32');
  assert.deepStrictEqual(await liberar(m.args), { success: false, estado: 'not-determined' });
  assert.deepStrictEqual(m.abertos, [URL_WIN]);
  assert.deepStrictEqual(m.pedidos, []);
});

test('outra plataforma não abre nada', async () => {
  const m = montar('denied', 'linux');
  assert.deepStrictEqual(await liberar(m.args), { success: false, estado: 'denied' });
  assert.deepStrictEqual(m.abertos, []);
});

test('linux: não determinada não pergunta nem abre nada', async () => {
  const m = montar('not-determined', 'linux');
  assert.deepStrictEqual(await liberar(m.args), { success: false, estado: 'not-determined' });
  assert.deepStrictEqual(m.pedidos, []);
  assert.deepStrictEqual(m.abertos, []);
});

test('darwin: negada não pergunta ao sistema de novo', async () => {
  const m = montar('denied', 'darwin');
  await liberar(m.args);
  assert.deepStrictEqual(m.pedidos, []);
});
