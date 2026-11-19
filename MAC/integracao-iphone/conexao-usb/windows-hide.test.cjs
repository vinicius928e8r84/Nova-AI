'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');

const chamadas = [];
const originais = { execFile: cp.execFile, spawn: cp.spawn };
cp.execFile = (file, args, options, callback) => {
  chamadas.push({ via: 'execFile', file, options });
  if (typeof options === 'function') callback = options;
  process.nextTick(callback, null, '', '');
  return {};
};
cp.spawn = (file, args, options) => {
  chamadas.push({ via: 'spawn', file, options });
  const filho = new (require('node:events'))();
  filho.unref = () => {};
  return filho;
};

const tp = require('../../../app/electron/services/tool-paths');
const win = { platform: 'win32', env: { SystemRoot: 'C:\\Windows' }, exists: () => false };
const winComSsh = { ...win, exists: () => true };

test('execSsh esconde a janela do filho', async () => {
  chamadas.length = 0;
  await new Promise((resolve) => tp.execSsh(['-V'], { timeout: 5 }, resolve, { platform: 'darwin' }));
  assert.equal(chamadas[0].options.windowsHide, true);
  assert.equal(chamadas[0].options.timeout, 5);
});

test('Windows sem Cliente OpenSSH dá erro claro e não executa nada', async () => {
  chamadas.length = 0;
  const erro = await new Promise((resolve) => tp.execSsh(['-V'], {}, resolve, win));
  assert.match(erro.message, /Cliente OpenSSH.*Recursos opcionais/);
  assert.equal(chamadas.length, 0);
  assert.throws(() => tp.sshExigido(win), /Recursos opcionais/);
});

test('Windows com OpenSSH e Mac devolvem o caminho de sempre', () => {
  assert.equal(tp.sshExigido(winComSsh), 'C:\\Windows\\System32\\OpenSSH\\ssh.exe');
  assert.equal(tp.sshExigido({ platform: 'darwin' }), '/usr/bin/ssh');
});

test('ios-devices lista o aparelho com windowsHide em todas as consultas', async () => {
  chamadas.length = 0;
  cp.execFile = (file, args, options, callback) => {
    chamadas.push({ via: 'execFile', file, options });
    process.nextTick(callback, null, args[0] === '-l' ? 'a'.repeat(25) + '\n' : 'x\n', '');
  };
  const caminho = require.resolve('../../../app/electron/services/ios-tools');
  require.cache[caminho] = { id: caminho, filename: caminho, loaded: true, exports: { tool: (nome) => '/ios/' + nome } };
  const { listar } = require('../../../app/electron/services/ios-devices');
  const lista = await listar();
  assert.equal(lista.length, 1);
  assert.equal(chamadas.length, 3);
  assert.ok(chamadas.every((c) => c.options.windowsHide === true));
});

test.after(() => { cp.execFile = originais.execFile; cp.spawn = originais.spawn; });
