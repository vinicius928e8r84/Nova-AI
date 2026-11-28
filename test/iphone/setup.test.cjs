const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

const sent = [];
let sshAttempts = 0;
const udids = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n';
const substitutos = {
  '../ios-tools': { tool: (tool) => '/bundled/' + tool },
  './node_modules/ssh2': { Client: class { constructor() { sshAttempts++; throw Error('SSH não deveria ser alcançado'); } } },
  child_process: {
    execFile: (file, args, options, cb) => cb(null, udids),
    spawn: () => { sshAttempts++; throw Error('Túnel não deveria ser alcançado'); },
  },
};
const carregarOriginal = Module._load;
Module._load = function (pedido, ...resto) {
  return Object.prototype.hasOwnProperty.call(substitutos, pedido) ? substitutos[pedido] : carregarOriginal.call(this, pedido, ...resto);
};
const setup = require(path.join(__dirname, '../../app/electron/services/iphone-setup/setup.js'));

const win = { isDestroyed: () => false, webContents: { send: (channel, data) => sent.push({ channel, data }) } };

const pedido = setup.prompt(win, { id: 'ios-ABC123', name: 'iPhone 8 Plus (iOS 16.7.16)' });
assert.equal(pedido.success, true);
assert.equal(pedido.message, 'Informe a senha SSH no quadro do Nova.');
assert.equal(sent.length, 1);
assert.equal(sent[0].channel, 'nova:iphone-setup-open');
assert.equal(JSON.stringify(sent[0].data), JSON.stringify({ id: 'ios-ABC123', name: 'iPhone 8 Plus (iOS 16.7.16)' }));

assert.equal(setup.prompt({ isDestroyed: () => true }, { id: 'ios-ABC123' }).success, false);
assert.equal(setup.prompt(win, {}).success, false);
assert.equal(sent.length, 1);

(async () => {
  const id = 'ios-' + 'a'.repeat(40);

  const falha = async (deviceId, password) => {
    try { await setup.prepare(deviceId, password, {}); } catch (error) { return error.message; }
    return null;
  };

  assert.equal(await falha(id, ''), 'Informe uma senha SSH válida.');
  assert.equal(await falha(id, 'bad\npassword'), 'Informe uma senha SSH válida.');
  assert.equal(await falha(id, 'x'.repeat(2000)), 'Informe uma senha SSH válida.');
  assert.equal(await falha('ios-curto', 'private'), 'Identificador do iPhone inválido.');

  const dois = await falha(id, 'private');
  assert.equal(dois, 'Conecte somente o iPhone selecionado por USB.');
  assert.equal(sshAttempts, 0);
  assert.ok(!dois.includes('private'));

  console.log('OK: modal pedido à janela principal, recusa de senha inválida, bloqueio de múltiplos aparelhos e senha ausente das mensagens.');
})();
