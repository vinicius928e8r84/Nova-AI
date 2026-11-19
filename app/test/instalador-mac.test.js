const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { instalarNoMac } = require('../electron/services/instalador-mac');

function gravador(falhas = () => false) {
  const chamadas = [];
  const run = async (comando, args) => {
    chamadas.push([comando, ...args]);
    if (falhas(comando, args)) throw new Error('falhou');
    if (args[0] === 'attach') return '/dev/disk4s1\tApple_HFS\t/Volumes/Meu App\n';
    return '';
  };
  return { chamadas, run };
}

test('pkg: instala no usuário sem pedir senha', async () => {
  const { chamadas, run } = gravador();
  await instalarNoMac('/tmp/a.pkg', { run });
  assert.deepStrictEqual(chamadas, [['/usr/sbin/installer', '-pkg', '/tmp/a.pkg', '-target', 'CurrentUserHomeDirectory']]);
});

test('pkg: se o usuário não basta, cai no diálogo de administrador', async () => {
  const { chamadas, run } = gravador(c => c === '/usr/sbin/installer');
  await instalarNoMac("/tmp/o'a.pkg", { run });
  assert.strictEqual(chamadas.length, 2);
  assert.strictEqual(chamadas[1][0], '/usr/bin/osascript');
  assert.match(chamadas[1][2], /with administrator privileges$/);
  assert.match(chamadas[1][2], /-pkg '\/tmp\/o'\\\\''a\.pkg' -target \//);
});

test('dmg: monta, copia o .app para ~/Applications e desmonta', async () => {
  const casa = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-casa-'));
  const { chamadas, run } = gravador();
  await instalarNoMac('/tmp/a.dmg', { run, casa, listar: () => ['LEIA.txt', 'Meu.app'] });
  assert.deepStrictEqual(chamadas.map(c => c[0].split('/').pop() + ':' + c[1]), ['hdiutil:attach', 'ditto:/Volumes/Meu App/Meu.app', 'hdiutil:detach']);
  assert.strictEqual(chamadas[1][2], path.join(casa, 'Applications', 'Meu.app'));
  assert.ok(fs.existsSync(path.join(casa, 'Applications')));
});

test('dmg sem .app: desmonta mesmo assim e falha', async () => {
  const { chamadas, run } = gravador();
  await assert.rejects(instalarNoMac('/tmp/a.dmg', { run, casa: os.tmpdir(), listar: () => ['x.txt'] }), /sem \.app/);
  assert.strictEqual(chamadas[chamadas.length - 1][1], 'detach');
});

test('outro tipo: só abre', async () => {
  const { chamadas, run } = gravador();
  await instalarNoMac('/tmp/a.zip', { run });
  assert.deepStrictEqual(chamadas, [['/usr/bin/open', '/tmp/a.zip']]);
});
