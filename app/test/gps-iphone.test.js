'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const childProcess = require('node:child_process');

const falsos = { ws: function () {}, axios: {}, electron: { app: { getPath: () => require('node:os').tmpdir() } } };
const carregar = Module._load;
Module._load = function (pedido) { return pedido in falsos ? falsos[pedido] : carregar.apply(this, arguments); };
const chamadas = [];
childProcess.execFile = (bin, args, opts, cb) => { chamadas.push({ bin, args, opts }); cb(null, '', ''); };
const Servico = require('../electron/services/physicalMobileService');
Module._load = carregar;

const servico = () => Object.assign(Object.create(Servico.prototype), { iosDeviceTimeZone: async () => 'America/Sao_Paulo' });

test('GPS sem idevicesetlocation mostra o motivo ao aplicar e ao resetar', async () => {
  const s = Object.assign(servico(), { idevicesetlocationPath: () => null, mountDeveloperImage: async () => true });
  assert.match((await s.iosSetLocation('ios-x', 1, 2)).error, /idevicesetlocation não encontrado/);
  assert.match((await s.iosStopLocation('ios-x')).error, /idevicesetlocation não encontrado/);
});

test('GPS roda pymobiledevice3 e idevicesetlocation sem janela de console no Windows', async () => {
  const s = Object.assign(servico(), { pymobiledevice3Path: () => 'C:\\P\\pymobiledevice3.exe', idevicesetlocationPath: () => 'C:\\T\\idevicesetlocation.exe' });
  chamadas.length = 0;
  await s.mountDeveloperImage('x');
  await s.runIdevicesetlocation('x', ['reset']);
  assert.deepEqual(chamadas.map((c) => c.opts.windowsHide), [true, true]);
});
