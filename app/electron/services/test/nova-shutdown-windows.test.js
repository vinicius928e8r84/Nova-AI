'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createWindowsProcessCleanup, parseWindowsProcessTable } = require('../nova-shutdown');

const NOVA = 100;
const EXE = 'C:\\Users\\a\\AppData\\Local\\Programs\\Nova AI\\Nova AI.exe';

function linha(pid, parent, command, started = pid) {
  return { ProcessId: pid, ParentProcessId: parent, CommandLine: command, Started: started };
}

function criar(estado) {
  const mortos = [];
  const limpeza = createWindowsProcessCleanup({
    readTable: () => parseWindowsProcessTable(JSON.stringify(estado.vivos)),
    killTree: pid => {
      mortos.push(pid);
      const alvo = new Set([pid]);
      for (const l of estado.vivos) if (alvo.has(l.ParentProcessId)) alvo.add(l.ProcessId);
      estado.vivos = estado.vivos.filter(l => !alvo.has(l.ProcessId));
    },
    ownPid: NOVA,
    execPath: EXE,
  });
  return { limpeza, mortos };
}

test('mata so a raiz de cada arvore descendente do Nova e poupa helpers do Electron e estranhos', async () => {
  const estado = { vivos: [
    linha(4, 0, null),
    linha(NOVA, 4, `"${EXE}"`),
    linha(101, NOVA, `"${EXE}" --type=renderer`),
    linha(102, NOVA, 'ffmpeg.exe -i x'),
    linha(103, 102, 'conhost.exe'),
    linha(104, NOVA, 'cmd.exe /c webui-user.bat'),
    linha(105, 104, 'python.exe launch.py'),
    linha(900, 4, 'chrome.exe de outra pessoa'),
    linha(901, NOVA, 'powershell.exe -Command Get-CimInstance Win32_Process | ConvertTo-Json'),
  ] };
  const { limpeza, mortos } = criar(estado);
  const terminar = limpeza.terminate();
  await terminar;
  assert.deepStrictEqual(mortos.sort(), [102, 104]);
});

test('continua matando processo cujo pai ja morreu (orfao no Windows)', async () => {
  const estado = { vivos: [
    linha(NOVA, 4, `"${EXE}"`),
    linha(102, NOVA, 'chrome.exe --remote-debugging-port=9222'),
    linha(110, 102, 'chrome.exe --type=gpu-process'),
  ] };
  const { limpeza, mortos } = criar(estado);
  limpeza.collect();
  estado.vivos = [linha(NOVA, 4, `"${EXE}"`), linha(110, 102, 'chrome.exe --type=gpu-process')];
  await limpeza.terminate();
  assert.deepStrictEqual(mortos, [110]);
});

test('nao mata processo novo que reaproveitou o PID de um dono antigo', async () => {
  const estado = { vivos: [linha(NOVA, 4, `"${EXE}"`, 50), linha(102, NOVA, 'ffmpeg.exe', 60)] };
  const { limpeza, mortos } = criar(estado);
  limpeza.collect();
  estado.vivos = [linha(NOVA, 4, `"${EXE}"`, 50), linha(102, 4, 'notepad.exe', 999)];
  await limpeza.terminate();
  assert.deepStrictEqual(mortos, []);
});

test('repete ate a arvore sumir e para quando nao sobra nada', async () => {
  const estado = { vivos: [linha(NOVA, 4, `"${EXE}"`), linha(102, NOVA, 'ffmpeg.exe')] };
  const mortos = [];
  const limpeza = createWindowsProcessCleanup({
    readTable: () => parseWindowsProcessTable(JSON.stringify(estado.vivos)),
    killTree: pid => { mortos.push(pid); if (mortos.length === 2) estado.vivos = [estado.vivos[0]]; },
    ownPid: NOVA,
    execPath: EXE,
  });
  await limpeza.terminate();
  assert.deepStrictEqual(mortos, [102, 102]);
});

test('tabela com um unico processo vem como objeto e ainda e lida', () => {
  const t = parseWindowsProcessTable(JSON.stringify(linha(7, 4, 'a.exe')));
  assert.strictEqual(t.get(7).command, 'a.exe');
  assert.strictEqual(t.get(7).parent, 4);
});

test('pid do Nova reaproveitado: processo antigo cujo pai morto tinha o mesmo PID nao morre', async () => {
  const estado = { vivos: [
    linha(NOVA, 4, `"${EXE}"`, 2000),
    linha(500, NOVA, '"C:\\Program Files\\Obsidian\\Obsidian.exe"', 1000),
  ] };
  const { limpeza, mortos } = criar(estado);
  await limpeza.terminate();
  assert.deepStrictEqual(mortos, []);
});

test('nao percorre a partir do leitor da tabela: o conhost dele nao vira dono', async () => {
  const estado = { vivos: [
    linha(NOVA, 4, `"${EXE}"`),
    linha(102, NOVA, 'ffmpeg.exe'),
    linha(200, NOVA, 'powershell.exe -Command Get-CimInstance Win32_Process'),
    linha(201, 200, 'conhost.exe'),
  ] };
  const { limpeza, mortos } = criar(estado);
  await limpeza.terminate();
  assert.deepStrictEqual(mortos, [102]);
});

test('registerShutdown nao varre a cada intervalo quando a limpeza pede scanEveryMs 0', async () => {
  const { EventEmitter } = require('node:events');
  const { registerShutdown } = require('../nova-shutdown');
  let leituras = 0;
  const limpeza = createWindowsProcessCleanup({
    readTable: () => { leituras++; return parseWindowsProcessTable(JSON.stringify([linha(NOVA, 4, `"${EXE}"`)])); },
    killTree: () => {},
    ownPid: NOVA,
    execPath: EXE,
  });
  const app = new EventEmitter();
  app.exit = () => {};
  let saiu;
  const fim = new Promise(resolve => { saiu = resolve; });
  app.quit = () => {
    const ev = { prevented: false, preventDefault() { this.prevented = true; } };
    app.emit('before-quit', ev);
    if (!ev.prevented) saiu();
  };
  registerShutdown(app, () => new Promise(resolve => setTimeout(resolve, 400)), limpeza);
  app.quit();
  await fim;
  assert.ok(leituras <= 3, `leituras: ${leituras}`);
});

test('Antigravity no Windows abre por cmd start, sem ficar filho do Nova', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const Module = require('node:module');
  const childProcess = require('node:child_process');
  const casa = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-'));
  fs.writeFileSync(path.join(casa, 'AppData\\Local\\Programs\\Antigravity\\Antigravity.exe'), '');
  const chamadas = [];
  const spawnOriginal = childProcess.spawn;
  const requireOriginal = Module.prototype.require;
  childProcess.spawn = (...args) => { chamadas.push(args); return { unref() {} }; };
  Module.prototype.require = function (id) {
    return id === 'electron' ? { clipboard: {} } : requireOriginal.apply(this, arguments);
  };
  const usuario = process.env.USERPROFILE;
  process.env.USERPROFILE = casa;
  try {
    const AntigravityController = require('../antigravity-controller');
    const controle = Object.create(AntigravityController.prototype);
    controle.log = () => {};
    assert.strictEqual(await controle.launchAntigravity(), true);
  } finally {
    childProcess.spawn = spawnOriginal;
    Module.prototype.require = requireOriginal;
    process.env.USERPROFILE = usuario;
    fs.rmSync(casa, { recursive: true, force: true });
  }
  assert.strictEqual(chamadas.length, 1);
  assert.strictEqual(chamadas[0][0], 'cmd.exe');
  assert.deepStrictEqual(chamadas[0][1].slice(0, 3), ['/c', 'start', '']);
});
