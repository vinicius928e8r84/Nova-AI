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

function iconFile(opts) {
  return sistema(opts).platform === 'darwin' ? 'nova-icon.png' : 'nova.ico';
}

const ffmpeg = (opts) => tool('ffmpeg', opts);

function iosTool(name, opts) {
  const s = sistema(opts);
  const root = s.resourcesPath || s.p.resolve(s.dirname, '../../..');
  return s.p.join(root, 'ios-tools', 'bin', exe(name, opts));
}

function pythonScripts(s) {
  const appData = s.env.APPDATA;
  if (!appData) return [];
  const base = s.p.join(appData, 'Python');
  let versoes = [];
  try { versoes = (s.readdir || fs.readdirSync)(base); } catch { return []; }
  return versoes.filter((v) => /^Python3/i.test(v)).sort().map((v) => s.p.join(base, v, 'Scripts'));
}

function gpsTool(name, opts) {
  const s = sistema(opts);
  s.readdir = (opts || {}).readdir;
  const file = exe(name, opts);
  const resources = s.resourcesPath;
  const dirs = s.win
    ? [
        resources && s.p.join(resources, 'ios-tools', 'bin'),
        resources && s.p.join(resources, 'bin'),
        ...pythonScripts(s),
        ...(s.env.PATH || s.env.Path || '').split(s.delimiter)
      ]
    : name === 'pymobiledevice3'
      ? [s.p.join(s.home, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin']
      : [resources && s.p.join(resources, 'bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'];
  const override = name === 'pymobiledevice3' && s.env.NOVA_PYMOBILEDEVICE3;
  return [override, ...dirs.filter(Boolean).map((d) => s.p.join(d, file))].filter(Boolean).find((f) => s.exists(f)) || null;
}

module.exports = { gpsTool, ssh, scp, sshKeygen, nullDevice, posixPath, ffmpeg, tool, iosTool, exe, iconFile };
