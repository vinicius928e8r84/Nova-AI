'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tp = require('../../../app/electron/services/tool-paths');
const macNative = require('../../../app/electron/services/mac-native');

const win = { platform: 'win32', env: { SystemRoot: 'C:\\Windows', Path: 'C:\\a;D:\\b' }, homedir: 'C:\\Users\\n', resourcesPath: 'C:\\app\\resources', dirname: 'C:\\app\\electron\\services', cwd: 'C:\\app' };
const mac = { platform: 'darwin' };

test('Mac mantém os caminhos fixos de antes', () => {
  assert.equal(tp.ssh(mac), '/usr/bin/ssh');
  assert.equal(tp.scp(mac), '/usr/bin/scp');
  assert.equal(tp.sshKeygen(mac), '/usr/bin/ssh-keygen');
  assert.equal(tp.nullDevice(mac), '/dev/null');
  assert.equal(tp.posixPath('/Users/x/Application Support/k', mac), '/Users/x/Application Support/k');
  assert.equal(tp.exe('ffmpeg', mac), 'ffmpeg');
});

test('Windows usa System32\\OpenSSH, NUL e barras', () => {
  assert.equal(tp.ssh(win), 'C:\\Windows\\System32\\OpenSSH\\ssh.exe');
  assert.equal(tp.scp(win), 'C:\\Windows\\System32\\OpenSSH\\scp.exe');
  assert.equal(tp.sshKeygen(win), 'C:\\Windows\\System32\\OpenSSH\\ssh-keygen.exe');
  assert.equal(tp.nullDevice(win), 'NUL');
  assert.equal(tp.posixPath('C:\\Users\\n\\AppData\\k', win), 'C:/Users/n/AppData/k');
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
  const p = { key: '/Users/x/Library/Application Support/k', knownHosts: '/Users/x/Library/Application Support/kh' };
  assert.deepEqual(ssh.sshOptions(p), ['-i', p.key, '-o', 'IdentitiesOnly=yes', '-o', 'UserKnownHostsFile="' + p.knownHosts + '"', '-o', 'GlobalKnownHostsFile=/dev/null']);
  const orig = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'win32' });
  try {
    const o = ssh.sshOptions({ key: 'C:\\U\\id', knownHosts: 'C:\\U\\kh' });
    assert.deepEqual(o, ['-i', 'C:/U/id', '-o', 'IdentitiesOnly=yes', '-o', 'UserKnownHostsFile=C:/U/kh', '-o', 'GlobalKnownHostsFile=NUL']);
  } finally { Object.defineProperty(process, 'platform', orig); }
});
