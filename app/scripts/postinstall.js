// Pos-instalacao: recompila os modulos nativos para o Electron (electron-builder install-app-deps).
// No Mac a falha continua sendo fatal (igual ao comportamento anterior).
// No Windows/Linux, sem compilador C++, usa o binario prebuilt do better-sqlite3.
const { spawnSync } = require('child_process');
const path = require('path');
const raiz = path.join(__dirname, '..');
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const r = spawnSync(npx, ['electron-builder', 'install-app-deps'], { cwd: raiz, stdio: 'inherit', shell: process.platform === 'win32' });
if (r.status === 0) process.exit(0);
if (process.platform === 'darwin') process.exit(r.status ?? 1);
console.warn('[postinstall] install-app-deps falhou (sem compilador C++?). Usando binarios prebuilt para o Electron.');
const versao = require(path.join(raiz, 'node_modules', 'electron', 'package.json')).version;
const p = spawnSync(process.execPath, [path.join(raiz, 'node_modules', 'prebuild-install', 'bin.js'), '--runtime=electron', `--target=${versao}`, `--arch=${process.arch}`, `--platform=${process.platform}`], { cwd: path.join(raiz, 'node_modules', 'better-sqlite3'), stdio: 'inherit' });
process.exit(p.error ? 1 : (p.status ?? 1));
