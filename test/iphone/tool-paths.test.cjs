'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tp = require('../../../app/electron/services/tool-paths');
const macNative = require('../../../app/electron/services/mac-native');

const win = { platform: 'win32', env: { SystemRoot: 'C:\\Windows', Path: 'C:\\a;D:\\b' }, homedir: 'C:\\Users\\usuario', resourcesPath: 'C:\\app\\resources', dirname: 'C:\\app\\electron\\services', cwd: 'C:\\app' };
const mac = { platform: 'darwin' };

test('Mac mantém os caminhos fixos de antes', () => {
  assert.equal(tp.ssh(mac), '/usr/bin/ssh');
  assert.equal(tp.scp(mac), '/usr/bin/scp');
  assert.equal(tp.sshKeygen(mac), '/usr/bin/ssh-keygen');
  assert.equal(tp.nullDevice(mac), '/dev/null');
  assert.equal(tp.posixPath('/Users/usuario/Application Support/k', mac), '/Users/usuario/Application Support/k');
  assert.equal(tp.exe('ffmpeg', mac), 'ffmpeg');
});

test('Windows usa System32\\OpenSSH, NUL e barras', () => {
  assert.equal(tp.ssh(win), 'C:\\Windows\\System32\\OpenSSH\\ssh.exe');
  assert.equal(tp.scp(win), 'C:\\Windows\\System32\\OpenSSH\\scp.exe');
  assert.equal(tp.sshKeygen(win), 'C:\\Windows\\System32\\OpenSSH\\ssh-keygen.exe');
  assert.equal(tp.nullDevice(win), 'NUL');
  assert.equal(tp.posixPath('C:\\Users\\usuario\\AppData\\k', win), 'C:/Users/usuario/AppData/k');
  assert.equal(tp.exe('iproxy', win), 'iproxy.exe');
  assert.equal(tp.exe('iproxy.exe', win), 'iproxy.exe');
  assert.equal(tp.iosTool('iproxy', win), 'C:\\app\\resources\\ios-tools\\bin\\iproxy.exe');
});

test('ffmpeg no Windows procura .exe e separa o PATH por ponto e vírgula', () => {
  const visto = [];
  const achado = tp.ffmpeg({ ...win, exists: (f) => { visto.push(f); return f === 'D:\\b\\ffmpeg.exe'; } });
  assert.equal(achado, 'D:\\b\\ffmpeg.exe');
  assert.ok(visto.includes('C:\\a\\ffmpeg.exe'));
  assert.ok(visto.includes('C:\\app\\resources\\bin\\ffmpeg.exe'));
  assert.equal(tp.ffmpeg({ ...win, exists: () => false }), null);
});

test('ffmpeg no Mac devolve o mesmo que mac-native.tool', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-'));
  fs.writeFileSync(path.join(dir, 'ffmpeg'), '#!/bin/sh\n', { mode: 0o755 });
  const antes = process.env.PATH;
  process.env.PATH = dir + path.delimiter + antes;
  try {
    assert.equal(tp.ffmpeg(), macNative.tool('ffmpeg'));
    assert.equal(tp.ffmpeg(), path.join(dir, 'ffmpeg'));
    process.env.PATH = '/nao/existe';
    assert.equal(tp.ffmpeg({ platform: 'darwin' }), macNative.tool('ffmpeg'));
  } finally { process.env.PATH = antes; fs.rmSync(dir, { recursive: true, force: true }); }
});

test('sshOptions no Mac não muda e no Windows usa NUL e /', () => {
  const ssh = require('../../../app/electron/services/iphone-ssh');
  const p = { key: '/Users/usuario/Library/Application Support/k', knownHosts: '/Users/usuario/Library/Application Support/kh' };
  assert.deepEqual(ssh.sshOptions(p), ['-i', p.key, '-o', 'IdentitiesOnly=yes', '-o', 'UserKnownHostsFile="' + p.knownHosts + '"', '-o', 'GlobalKnownHostsFile=/dev/null']);
  const orig = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'win32' });
  try {
    const o = ssh.sshOptions({ key: 'C:\\U\\id', knownHosts: 'C:\\U\\kh' });
    assert.deepEqual(o, ['-i', 'C:/U/id', '-o', 'IdentitiesOnly=yes', '-o', 'UserKnownHostsFile=C:/U/kh', '-o', 'GlobalKnownHostsFile=NUL']);
  } finally { Object.defineProperty(process, 'platform', orig); }
});

test('GPS do iPhone: Mac mantém a lista de antes e Windows procura .exe, Scripts do Python e PATH', () => {
  const visto = (opts, nome) => { const v = []; tp.gpsTool(nome, { ...opts, exists: (f) => { v.push(f); return false; } }); return v; };
  const macOpts = { platform: 'darwin', homedir: '/Users/usuario', resourcesPath: '/App/Resources', env: { PATH: '/nao/entra' } };
  assert.deepEqual(visto(macOpts, 'idevicesetlocation'), ['/App/Resources/bin/idevicesetlocation', '/opt/homebrew/bin/idevicesetlocation', '/usr/local/bin/idevicesetlocation', '/usr/bin/idevicesetlocation']);
  assert.deepEqual(visto({ ...macOpts, env: { NOVA_PYMOBILEDEVICE3: '/custom/pmd3' } }, 'pymobiledevice3'), ['/custom/pmd3', '/Users/usuario/.local/bin/pymobiledevice3', '/opt/homebrew/bin/pymobiledevice3', '/usr/local/bin/pymobiledevice3']);
  const winOpts = { ...win, env: { ...win.env, APPDATA: 'C:\\Users\\usuario\\AppData\\Roaming' }, readdir: () => ['Python311', 'Python312', 'Outro'] };
  assert.deepEqual(visto(winOpts, 'pymobiledevice3'), [
    'C:\\app\\resources\\ios-tools\\bin\\pymobiledevice3.exe',
    'C:\\app\\resources\\bin\\pymobiledevice3.exe',
    'C:\\Users\\usuario\\AppData\\Roaming\\Python\\Python311\\Scripts\\pymobiledevice3.exe',
    'C:\\Users\\usuario\\AppData\\Roaming\\Python\\Python312\\Scripts\\pymobiledevice3.exe',
    'C:\\a\\pymobiledevice3.exe',
    'D:\\b\\pymobiledevice3.exe'
  ]);
  assert.equal(tp.gpsTool('idevicesetlocation', { ...winOpts, exists: (f) => f === 'D:\\b\\idevicesetlocation.exe' }), 'D:\\b\\idevicesetlocation.exe');
  assert.equal(tp.gpsTool('idevicesetlocation', { ...winOpts, exists: () => false }), null);
});

test('ícone, yt-dlp e ffmpeg seguem o sistema nos dois lados', () => {
  assert.equal(tp.iconFile(mac), 'nova-icon.png');
  assert.equal(tp.iconFile(win), 'nova.ico');
  assert.equal(tp.exe('yt-dlp', mac), 'yt-dlp');
  assert.equal(tp.exe('yt-dlp', win), 'yt-dlp.exe');
  assert.equal(tp.exe('ffmpeg', mac), 'ffmpeg');
  assert.equal(tp.exe('ffmpeg', win), 'ffmpeg.exe');
  const dentro = { ...win, exists: (f) => f === 'C:\\app\\resources\\bin\\ffmpeg.exe' };
  assert.equal(tp.ffmpeg(dentro), 'C:\\app\\resources\\bin\\ffmpeg.exe');
  assert.equal(tp.ffmpeg({ ...win, exists: () => false }), null);
});

test('spoof e pré-escuta não montam caminho de ffmpeg nem reabrem arquivo apagado', () => {
  const lerFonte = (f) => fs.readFileSync(path.join(__dirname, '../../../app/electron', f), 'utf8');
  const spoof = lerFonte('services/global-spoof-service.js');
  assert.match(spoof, /^const toolPaths = require\('\.\/tool-paths'\);$/m);
  assert.match(spoof, /this\.ffmpegPath\s*=\s*toolPaths\.ffmpeg\(\) \|\| 'ffmpeg';/);
  assert.doesNotMatch(spoof, /altPath/);
  assert.doesNotMatch(lerFonte('main.js'), /if \(playErr\)/);
});
