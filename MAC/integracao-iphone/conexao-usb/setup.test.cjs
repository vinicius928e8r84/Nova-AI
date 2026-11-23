const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

// Testa o serviço isolado: o IPC real é registrado no main.js do app.
const sent = [];
let sshAttempts = 0;
const udids = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n';
const sandbox = {
  module: { exports: {} },
  __dirname,
  Buffer,
  console,
  setTimeout,
  clearTimeout,
  require(name) {
    if (name === '../tool-paths') return require('../../../app/electron/services/tool-paths');
    if (name === '../ios-tools') return { tool: (tool) => '/bundled/' + tool };
    if (name === './node_modules/ssh2') return { Client: class { constructor() { sshAttempts++; throw Error('SSH não deveria ser alcançado'); } } };
    if (name === 'child_process') return {
      execFile: (file, args, options, cb) => cb(null, udids),
      spawn: () => { sshAttempts++; throw Error('Túnel não deveria ser alcançado'); },
    };
    return require(name);
  },
};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../../app/electron/services/iphone-setup/setup.js'), 'utf8'), sandbox);
const setup = sandbox.module.exports;

const win = { isDestroyed: () => false, webContents: { send: (channel, data) => sent.push({ channel, data }) } };

// 1. O modal é pedido à janela principal, com id e nome do aparelho.
const pedido = setup.prompt(win, { id: 'ios-ABC123', name: 'iPhone 8 Plus (iOS 16.7.16)' });
assert.equal(pedido.success, true);
assert.equal(pedido.message, 'Informe a senha SSH no quadro do Nova.');
assert.equal(sent.length, 1);
assert.equal(sent[0].channel, 'nova:iphone-setup-open');
assert.equal(JSON.stringify(sent[0].data), JSON.stringify({ id: 'ios-ABC123', name: 'iPhone 8 Plus (iOS 16.7.16)' }));

// 2. Sem janela ou sem aparelho, nada é enviado.
assert.equal(setup.prompt({ isDestroyed: () => true }, { id: 'ios-ABC123' }).success, false);
assert.equal(setup.prompt(win, {}).success, false);
assert.equal(sent.length, 1);

(async () => {
  const id = 'ios-' + 'a'.repeat(40);

  const falha = async (deviceId, password) => {
    try { await setup.prepare(deviceId, password, {}); } catch (error) { return error.message; }
    return null;
  };

  // 3. Senha ausente, com quebra de linha ou grande demais é recusada antes de qualquer acesso.
  assert.equal(await falha(id, ''), 'Informe uma senha SSH válida.');
  assert.equal(await falha(id, 'bad\npassword'), 'Informe uma senha SSH válida.');
  assert.equal(await falha(id, 'x'.repeat(2000)), 'Informe uma senha SSH válida.');
  assert.equal(await falha('ios-curto', 'private'), 'Identificador do iPhone inválido.');

  // 4. Dois iPhones no cabo: recusa e não tenta SSH nem túnel.
  const dois = await falha(id, 'private');
  assert.equal(dois, 'Conecte somente o iPhone selecionado por USB.');
  assert.equal(sshAttempts, 0);
  assert.ok(!dois.includes('private'));

  console.log('OK: modal pedido à janela principal, recusa de senha inválida, bloqueio de múltiplos aparelhos e senha ausente das mensagens.');
})();
