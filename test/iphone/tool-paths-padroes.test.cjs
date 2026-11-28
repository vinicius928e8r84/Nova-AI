'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tp = require('../../app/electron/services/tool-paths');

const visitados = (nome, opcoes) => {
  const lista = [];
  tp.tool(nome, { ...opcoes, exists: (arquivo) => { lista.push(arquivo); return false; } });
  return lista;
};

const MAC = {
  platform: 'darwin',
  env: { PATH: '/p1:/p2' },
  homedir: '/h',
  resourcesPath: '/r',
  dirname: '/x/app/electron/services',
  cwd: '/c',
};
const WINDOWS = {
  platform: 'win32',
  env: { Path: 'C:\\p1;D:\\p2' },
  homedir: 'C:\\h',
  resourcesPath: 'C:\\r',
  dirname: 'C:\\x\\app\\electron\\services',
  cwd: 'C:\\c',
};

test('o ffmpeg procura nas pastas do Mac na ordem: app, resources, Homebrew, platform-tools do Android e PATH', () => {
  assert.deepEqual(visitados('ffmpeg', MAC), [
    '/r/bin/ffmpeg',
    '/x/app/resources/bin/ffmpeg',
    '/opt/homebrew/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    '/h/Library/Android/sdk/platform-tools/ffmpeg',
    '/p1/ffmpeg',
    '/p2/ffmpeg',
  ]);
});

test('o ffmpeg procura nas pastas do Windows na ordem: app, resources, a pasta de trabalho e PATH', () => {
  assert.deepEqual(visitados('ffmpeg', WINDOWS), [
    'C:\\r\\bin\\ffmpeg.exe',
    'C:\\x\\app\\resources\\bin\\ffmpeg.exe',
    'C:\\c\\resources\\bin\\ffmpeg.exe',
    'C:\\p1\\ffmpeg.exe',
    'D:\\p2\\ffmpeg.exe',
  ]);
});

test('o ffmpeg devolve a primeira pasta onde o arquivo existe', () => {
  assert.equal(tp.ffmpeg({ ...MAC, exists: (arquivo) => arquivo.startsWith('/usr/local') || arquivo.startsWith('/p') }), '/usr/local/bin/ffmpeg');
});

test('sem resourcesPath informado vale o do processo, e com a chave presente e vazia não vale nenhum', () => {
  const { resourcesPath, ...semAChave } = MAC;
  process.resourcesPath = '/do-processo';
  try {
    assert.equal(visitados('ffmpeg', semAChave)[0], '/do-processo/bin/ffmpeg');
    assert.equal(visitados('ffmpeg', { ...MAC, resourcesPath: undefined })[0], '/x/app/resources/bin/ffmpeg');
    assert.equal(visitados('ffmpeg', { ...MAC, resourcesPath: null })[0], '/x/app/resources/bin/ffmpeg');
    assert.equal(visitados('ffmpeg', { ...MAC, resourcesPath: '' })[0], '/x/app/resources/bin/ffmpeg');
  } finally {
    delete process.resourcesPath;
  }
  assert.equal(visitados('ffmpeg', semAChave)[0], '/x/app/resources/bin/ffmpeg');
});

test('o PATH vem de PATH, depois de Path, e some quando nenhum existe', () => {
  assert.deepEqual(visitados('ffmpeg', { ...MAC, env: { PATH: '/a', Path: '/b' } }).slice(-1), ['/a/ffmpeg']);
  assert.deepEqual(visitados('ffmpeg', { ...MAC, env: { Path: '/b' } }).slice(-1), ['/b/ffmpeg']);
  assert.deepEqual(visitados('ffmpeg', { ...MAC, env: {} }).slice(-1), ['/h/Library/Android/sdk/platform-tools/ffmpeg']);
});

test('ferramenta do iPhone sem resourcesPath fica três pastas acima do dirname, no Mac e no Windows', () => {
  assert.equal(tp.iosTool('iproxy', { ...MAC, resourcesPath: null, dirname: '/a/b/c/d' }), '/a/ios-tools/bin/iproxy');
  assert.equal(tp.iosTool('iproxy', { ...WINDOWS, resourcesPath: '', dirname: 'C:\\a\\b\\c\\d' }), 'C:\\a\\ios-tools\\bin\\iproxy.exe');
  assert.equal(tp.iosTool('iproxy', MAC), '/r/ios-tools/bin/iproxy');
});

test('valor vazio em qualquer opção cai no padrão do sistema', () => {
  const vazias = { platform: '', env: null, homedir: '', dirname: '', cwd: '', exists: null };
  const esperadoDoIcone = process.platform === 'darwin' ? 'nova-icon.png' : 'nova.ico';
  assert.equal(tp.iconFile(vazias), esperadoDoIcone);
  assert.equal(tp.iconFile(null), esperadoDoIcone);
  assert.equal(tp.iconFile(), esperadoDoIcone);
  assert.equal(tp.exe('ffmpeg', vazias), process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  assert.equal(tp.nullDevice(null), process.platform === 'win32' ? 'NUL' : '/dev/null');
});

test('o home, a pasta do módulo e a pasta de trabalho padrão entram na busca', () => {
  const pastasDoMac = visitados('ferramenta-que-nao-existe', { platform: 'darwin', env: {}, resourcesPath: null });
  assert.ok(pastasDoMac.includes(path.posix.join(os.homedir(), 'Library/Android/sdk/platform-tools', 'ferramenta-que-nao-existe')));
  assert.ok(pastasDoMac.includes(path.posix.join(path.dirname(require.resolve('../../app/electron/services/tool-paths')), '../../resources/bin', 'ferramenta-que-nao-existe')));
  const pastasDoWindows = visitados('ferramenta-que-nao-existe', { platform: 'win32', env: {}, resourcesPath: null });
  assert.ok(pastasDoWindows.includes(path.win32.join(process.cwd(), 'resources', 'bin', 'ferramenta-que-nao-existe.exe')));
});

test('sem a opção exists vale o arquivo executável de verdade', { skip: process.platform === 'win32' }, () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-padroes-'));
  try {
    fs.writeFileSync(path.join(pasta, 'so-executa'), '#!/bin/sh\n', { mode: 0o755 });
    fs.writeFileSync(path.join(pasta, 'so-le'), 'x\n', { mode: 0o644 });
    const opcoes = { platform: 'linux', env: { PATH: pasta }, resourcesPath: null, dirname: '/nao/existe/a/b', homedir: '/nao/existe' };
    assert.equal(tp.tool('so-executa', opcoes), path.join(pasta, 'so-executa'));
    assert.equal(tp.tool('so-le', opcoes), null);
    assert.equal(tp.tool('nao-existe', opcoes), null);
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
});

test('o GPS do Mac sem opções de pasta usa o home do sistema para o pymobiledevice3', () => {
  const lista = [];
  tp.gpsTool('pymobiledevice3', { platform: 'darwin', env: {}, resourcesPath: null, exists: (arquivo) => { lista.push(arquivo); return false; } });
  assert.deepEqual(lista, [
    path.posix.join(os.homedir(), '.local', 'bin', 'pymobiledevice3'),
    '/opt/homebrew/bin/pymobiledevice3',
    '/usr/local/bin/pymobiledevice3',
  ]);
});
