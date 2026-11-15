'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

function sistema(opts) {
  const o = opts || {};
  const platform = o.platform || process.platform;
  const env = o.env || process.env;
  const win = platform === 'win32';
  return {
    platform,
    win,
    env,
    p: win ? path.win32 : path.posix,
    delimiter: win ? ';' : ':',
    home: o.homedir || os.homedir(),
    resourcesPath: 'resourcesPath' in o ? o.resourcesPath : process.resourcesPath,
    dirname: o.dirname || __dirname,
    cwd: o.cwd || process.cwd(),
    exists: o.exists || ((f) => { try { fs.accessSync(f, fs.constants.X_OK); return true; } catch { return false; } })
  };
}

function exe(name, opts) {
  return sistema(opts).win && !/\.exe$/i.test(name) ? name + '.exe' : name;
}

function openssh(name, opts) {
  const s = sistema(opts);
  if (!s.win) return '/usr/bin/' + name;
  const root = s.env.SystemRoot || s.env.windir || 'C:\\Windows';
  return s.p.join(root, 'System32', 'OpenSSH', name + '.exe');
}

const ssh = (opts) => openssh('ssh', opts);
const scp = (opts) => openssh('scp', opts);
const sshKeygen = (opts) => openssh('ssh-keygen', opts);

function nullDevice(opts) {
  return sistema(opts).win ? 'NUL' : '/dev/null';
}

function posixPath(file, opts) {
  return sistema(opts).win ? String(file).replace(/\\/g, '/') : String(file);
}

function ffmpegDirs(s) {
  const unix = [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    s.p.join(s.home, 'Library/Android/sdk/platform-tools')
  ];
  const win = [s.p.join(s.cwd, 'resources', 'bin')];
  return [
    s.resourcesPath && s.p.join(s.resourcesPath, 'bin'),
    s.p.join(s.dirname, '../../resources/bin'),
    ...(s.win ? win : unix),
    ...(s.env.PATH || s.env.Path || '').split(s.delimiter)
  ].filter(Boolean);
}

function tool(name, opts) {
  const s = sistema(opts);
  const file = exe(name, opts);
  return ffmpegDirs(s).map((d) => s.p.join(d, file)).find((f) => s.exists(f)) || null;
}

const ffmpeg = (opts) => tool('ffmpeg', opts);

function iosTool(name, opts) {
  const s = sistema(opts);
  const root = s.resourcesPath || s.p.resolve(s.dirname, '../../..');
  return s.p.join(root, 'ios-tools', 'bin', exe(name, opts));
}

module.exports = { ssh, scp, sshKeygen, nullDevice, posixPath, ffmpeg, tool, iosTool, exe };
