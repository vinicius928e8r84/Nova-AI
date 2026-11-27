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

const tp = require('../../app/electron/services/tool-paths');
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
  assert.throws(() => tp.exigirOpenssh('ssh', win), /Recursos opcionais/);
});

test('Windows com OpenSSH e Mac devolvem o caminho de sempre', () => {
  assert.equal(tp.exigirOpenssh('ssh', winComSsh), 'C:\\Windows\\System32\\OpenSSH\\ssh.exe');
  assert.equal(tp.exigirOpenssh('ssh', { platform: 'darwin' }), '/usr/bin/ssh');
});

test('ios-devices lista o aparelho com windowsHide em todas as consultas', async () => {
  chamadas.length = 0;
  cp.execFile = (file, args, options, callback) => {
    chamadas.push({ via: 'execFile', file, options });
    process.nextTick(callback, null, args[0] === '-l' ? 'a'.repeat(25) + '\n' : 'x\n', '');
  };
  const caminho = require.resolve('../../app/electron/services/ios-tools');
  require.cache[caminho] = { id: caminho, filename: caminho, loaded: true, exports: { tool: (nome) => '/ios/' + nome } };
  const { listar } = require('../../app/electron/services/ios-devices');
  const lista = await listar();
  assert.equal(lista.length, 1);
  assert.equal(chamadas.length, 3);
  assert.ok(chamadas.every((c) => c.options.windowsHide === true));
});

test.after(() => { cp.execFile = originais.execFile; cp.spawn = originais.spawn; });

const semOpenSsh = (() => {
  const alvo = Object.getOwnPropertyDescriptor(process, 'platform');
  const fsOriginal = require('node:fs').accessSync;
  return {
    liga() {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      require('node:fs').accessSync = (f, ...r) => (/OpenSSH/i.test(String(f)) ? (() => { throw new Error('ENOENT'); })() : fsOriginal(f, ...r));
    },
    desliga() { Object.defineProperty(process, 'platform', alvo); require('node:fs').accessSync = fsOriginal; }
  };
})();

test('Windows sem OpenSSH: o Conectar mostra a mensagem do OpenSSH', async () => {
  chamadas.length = 0;
  semOpenSsh.liga();
  try {
    const Module = require('node:module');
    const resolver = Module._resolveFilename;
    Module._resolveFilename = function (pedido, ...r) { return /node_modules\/ssh2$/.test(pedido) ? __filename : resolver.call(this, pedido, ...r); };
    const setup = require('../../app/electron/services/iphone-setup/setup.js');
    const udid = 'a'.repeat(25);
    await assert.rejects(setup.prepare('ios-' + udid, 'senha', {}), /Recursos opcionais/);
  } finally { semOpenSsh.desliga(); }
  assert.equal(chamadas.length, 0);
});

test('Windows sem OpenSSH: o CAM LIVE mostra a mensagem do OpenSSH', async () => {
  semOpenSsh.liga();
  try {
    const Classe = require('../../app/electron/services/cam-live-iphone.js');
    const Alvo = Classe.CamLiveIphone || Classe.IphoneCamLive || Object.values(Classe).find((v) => typeof v === 'function' && v.prototype && v.prototype._readState);
    const instancia = Object.create(Alvo.prototype);
    instancia.mobile = { iosSsh: async () => ({ ok: false, error: 'x' }) };
    await assert.rejects(instancia._readState(), /Recursos opcionais/);
  } finally { semOpenSsh.desliga(); }
});
