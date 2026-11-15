'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { menuTemplate, extraShutdownTasks, runShutdownTasks } = require('../nova-desktop-parity');

const roles = tpl => tpl.flatMap(m => m.submenu.map(i => i.role).filter(Boolean));

test('darwin mantem o menu de antes', () => {
  const tpl = menuTemplate('darwin');
  assert.deepStrictEqual(tpl.map(m => m.label), ['Nova AI', 'Editar', 'Visualizar', 'Janela']);
  assert.ok(roles(tpl).includes('about') && roles(tpl).includes('zoom'));
});

test('win32 tem recarregar e DevTools', () => {
  const r = roles(menuTemplate('win32'));
  assert.ok(r.includes('reload') && r.includes('toggleDevTools') && r.includes('copy'));
});

test('linux continua sem menu', () => assert.strictEqual(menuTemplate('linux'), null));

test('tarefas extras param todos os servicos e toleram falha', async () => {
  const calls = [];
  const app = {
    camLiveService: { iphone: { stop: () => calls.push('camIphone') }, stop: () => calls.push('cam') },
    liveCamBridgeService: { stopServer: () => calls.push('bridge') },
  };
  const tasks = extraShutdownTasks({
    app,
    getIosBridge: () => ({ stop: () => { calls.push('ios'); throw new Error('x'); } }),
    rtmp: { stopBroadcast: () => calls.push('bc'), stopRtmpServer: () => calls.push('rtmp') },
    getTelegram: () => ({ stopConnectionCheck: () => calls.push('tg') }),
  });
  const logs = [];
  await runShutdownTasks(tasks, (...a) => logs.push(a));
  assert.deepStrictEqual(calls.sort(), ['bc', 'bridge', 'cam', 'camIphone', 'ios', 'rtmp', 'tg']);
  assert.strictEqual(logs.length, 1);
});

test('sem servicos criados nao lanca', async () => {
  const tasks = extraShutdownTasks({
    app: {}, getIosBridge: () => ({ stop() {} }),
    rtmp: { stopBroadcast() {}, stopRtmpServer() {} }, getTelegram: () => null,
  });
  const logs = [];
  await runShutdownTasks(tasks, (...a) => logs.push(a));
  assert.strictEqual(logs.length, 0);
});
