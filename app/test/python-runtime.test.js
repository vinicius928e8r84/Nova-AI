'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { python, pathComBin } = require('../electron/services/python-runtime');

const antigoMac = (roots, existe, ferramenta) => {
  for (const root of roots) { const p = path.join(root, 'python-runtime-portable/run-python'); if (existe(p)) return p; }
  for (const root of roots) { const p = path.join(root, 'python-env/bin/python3'); if (existe(p)) return p; }
  return ferramenta('python3') || '/usr/bin/python3';
};

test('Mac: mesmo resultado do resolvedor anterior em todas as combinacoes', () => {
  const roots = ['/R/res', '/R/dev'];
  const arquivos = ['/R/res/python-runtime-portable/run-python', '/R/dev/python-runtime-portable/run-python', '/R/res/python-env/bin/python3', '/R/dev/python-env/bin/python3'];
  for (let mask = 0; mask < 16; mask++) {
    const existe = p => arquivos.some((a, i) => (mask >> i) & 1 && a === p);
    for (const ferramenta of [() => '/opt/homebrew/bin/python3', () => null]) {
      assert.strictEqual(python({ platform: 'darwin', roots, existe, ferramenta }), antigoMac(roots, existe, ferramenta));
    }
  }
});

test('Windows: resources\\python\\python.exe embutido, senao python do PATH', () => {
  const roots = [path.join('C:', 'res'), path.join('C:', 'dev')];
  const exe = path.join(roots[1], 'python/python.exe');
  assert.strictEqual(python({ platform: 'win32', roots, existe: p => p === exe }), exe);
  assert.strictEqual(python({ platform: 'win32', roots, existe: () => false }), 'python');
});

test('Windows nao procura os runtimes do Mac e Linux fica em python', () => {
  const visto = [];
  python({ platform: 'win32', roots: ['/r'], existe: p => { visto.push(p); return false; } });
  assert.deepStrictEqual(visto, [path.join('/r', 'python/python.exe')]);
  assert.strictEqual(python({ platform: 'linux', roots: ['/r'], existe: () => true }), 'python');
});

test('PATH: Mac igual ao de antes, Windows prefixa resources\\bin com ponto e virgula, Linux intacto', () => {
  assert.strictEqual(pathComBin('darwin', '/usr/bin', '/App/res'), `${path.join('/App/res', 'bin')}:/opt/homebrew/bin:/usr/local/bin:/usr/bin`);
  assert.strictEqual(pathComBin('win32', 'C:\\Windows', '/App/res'), `${path.join('/App/res', 'bin')};C:\\Windows`);
  assert.strictEqual(pathComBin('linux', '/usr/bin', '/App/res'), '/usr/bin');
});
