'use strict';

const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

const LINHA_DO_PS = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+\s+\S+\s+\d+\s+\S+\s+\d+)\s+(.+)$/;

const ehZumbi = status => status.startsWith('Z');
const ehOPsDoNova = (parent, command) => Number(parent) === process.pid && command === '/bin/ps';

function entradaDaLinhaDoPs(line) {
  const match = line.match(LINHA_DO_PS);
  if (!match) return null;
  const [, pid, parent, uid, status, started, command] = match;
  if (ehZumbi(status) || ehOPsDoNova(parent, command)) return null;
  return [Number(pid), { parent: Number(parent), uid: Number(uid), identity: started + ' ' + command, command }];
}

function lerTabelaDoPs(output) {
  const entries = new Map();
  for (const line of output.split('\n')) {
    const entrada = entradaDaLinhaDoPs(line);
    if (entrada) entries.set(entrada[0], entrada[1]);
  }
  return entries;
}

function processTable() {
  const output = execFileSync('/bin/ps', ['-axww', '-o', 'pid=,ppid=,uid=,stat=,lstart=,comm='], {
    encoding: 'utf8',
    env: { ...process.env, LC_ALL: 'C' },
    timeout: 1000,
    maxBuffer: 4 * 1024 * 1024,
  });
  return lerTabelaDoPs(output);
}

const ehOrfaoDoUsuario = entry => entry.parent === 1 && entry.uid === process.getuid();
const ehDoProprioNova = (pid, entry, caminhoDosHelpers) => pid === process.pid || entry.command.startsWith(caminhoDosHelpers);
const ehOrfaoCandidato = (pid, entry, caminhoDosHelpers) => ehOrfaoDoUsuario(entry) && !ehDoProprioNova(pid, entry, caminhoDosHelpers);

function separarOrfaos(entries, inspecionados, caminhoDosHelpers) {
  const atuais = new Map();
  const candidatos = [];
  for (const [pid, entry] of entries) {
    if (!ehOrfaoCandidato(pid, entry, caminhoDosHelpers)) continue;
    atuais.set(pid, entry.identity);
    if (inspecionados.get(pid) !== entry.identity) candidatos.push(pid);
  }
  return { atuais, candidatos };
}

function lerAmbienteDosOrfaos(candidatos) {
  return execFileSync('/bin/ps', ['eww', '-p', candidatos.join(','), '-o', 'pid=,command='], {
    encoding: 'utf8',
    timeout: 1000,
    maxBuffer: 8 * 1024 * 1024,
  });
}

const pidDaLinhaDoAmbiente = line => Number(line.trimStart().split(/\s+/, 1)[0]);

function pidsComMarcaDoDono(output, ownerMarker) {
  return output.split('\n').filter(line => ownerMarker.test(line)).map(pidDaLinhaDoAmbiente);
}

function descartarDonosQueMudaram(owned, entries) {
  for (const [pid, identity] of owned) {
    if (entries.get(pid)?.identity !== identity) owned.delete(pid);
  }
}

function adotarDescendentes(owned, entries, caminhoDosHelpers) {
  const children = filhosPorPai(entries);
  const pending = [process.pid, ...owned.keys()];
  const visited = new Set(pending);
  for (const parent of pending) {
    for (const pid of (children.get(parent) ?? []).filter(filho => !visited.has(filho))) {
      visited.add(pid);
      pending.push(pid);
      const entry = entries.get(pid);
      if (!entry.command.startsWith(caminhoDosHelpers)) owned.set(pid, entry.identity);
    }
  }
}

function createProcessCleanup(electronHelpersPath) {
  const owned = new Map();
  const owner = randomUUID();
  const ownerMarker = new RegExp(`(?:^|\\s)NOVA_PROCESS_OWNER=${owner}(?:\\s|$)`);
  process.env.NOVA_PROCESS_OWNER = owner;
  let inspectedOrphans = new Map();

  function collectOrphans(entries) {
    const { atuais, candidatos } = separarOrfaos(entries, inspectedOrphans, electronHelpersPath);
    if (candidatos.length) {
      for (const pid of pidsComMarcaDoDono(lerAmbienteDosOrfaos(candidatos), ownerMarker)) {
        if (atuais.has(pid)) owned.set(pid, atuais.get(pid));
      }
    }
    inspectedOrphans = atuais;
  }

  function collect() {
    const entries = processTable();
    descartarDonosQueMudaram(owned, entries);
    try { collectOrphans(entries); }
    catch (error) { console.error('[Shutdown] Orphan scan failed:', error.code ?? error.status); }
    adotarDescendentes(owned, entries, electronHelpersPath);
  }

  function signalOwned(signal, signaled = new Map()) {
    collect();
    for (const [pid, identity] of owned) {
      if (signaled.get(pid) === identity) continue;
      try {
        process.kill(pid, signal);
        signaled.set(pid, identity);
      } catch (error) {
        if (error.code !== 'ESRCH') console.error('[Shutdown]', signal, pid, error.message);
      }
    }
  }

  async function pedirQueSaiam() {
    const signaled = new Map();
    const deadline = Date.now() + 800;
    while (true) {
      signalOwned('SIGTERM', signaled);
      if (owned.size === 0 || Date.now() >= deadline) break;
      await delay(75);
    }
  }

  async function forcarSaida() {
    signalOwned('SIGKILL');
    await delay(75);
    collect();
    if (owned.size) console.error('[Shutdown] Processes still present:', [...owned.keys()]);
  }

  return {
    collect,
    async terminate() {
      await pedirQueSaiam();
      if (owned.size) await forcarSaida();
    },
  };
}

const WINDOWS_NOVA_TOOLS = new Set([
  'ffmpeg', 'ffprobe', 'scrcpy', 'adb', 'iproxy', 'ssh', 'python', 'pythonw', 'py',
  'cmd', 'powershell', 'pwsh', 'node', 'yt-dlp', 'cloudflared',
]);
const WINDOWS_AUTOMATED_BROWSERS = new Set(['chrome', 'msedge']);

function windowsExecutableName(command) {
  const first = command.match(/^\s*(?:"([^"]+)"|(\S+))/);
  const file = first ? (first[1] || first[2]) : '';
  return path.win32.basename(file).toLowerCase().replace(/\.exe$/, '');
}

function isNovaWindowsTool(command) {
  const name = windowsExecutableName(command);
  if (WINDOWS_AUTOMATED_BROWSERS.has(name)) return command.includes('--remote-debugging');
  return WINDOWS_NOVA_TOOLS.has(name);
}

const WINDOWS_TABLE_SCRIPT = [
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  "$tabela = @(Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ ProcessId = $_.ProcessId; ParentProcessId = $_.ParentProcessId; CommandLine = $_.CommandLine; Started = $(if ($_.CreationDate) { $_.CreationDate.ToFileTimeUtc() } else { 0 }) } })",
  'ConvertTo-Json -InputObject $tabela -Compress',
].join('; ');

function windowsProcessTable() {
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_TABLE_SCRIPT], {
    encoding: 'utf8',
    timeout: 3000,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  return parseWindowsProcessTable(output);
}

function linhaDeProcessoValida(row) {
  if (!row) return false;
  return Number.isInteger(row.ProcessId) && row.ProcessId !== 0;
}

function parseWindowsProcessTable(output) {
  const parsed = JSON.parse(output);
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  const entries = new Map();
  for (const row of rows) {
    if (!linhaDeProcessoValida(row)) continue;
    const command = row.CommandLine || '';
    entries.set(row.ProcessId, {
      parent: row.ParentProcessId,
      started: Number(row.Started) || 0,
      identity: row.Started + ' ' + command,
      command,
    });
  }
  return entries;
}

const PAPEL_ALHEIO = 'alheio';
const PAPEL_HELPER = 'helper';
const PAPEL_FERRAMENTA = 'ferramenta';

function filhosPorPai(entries) {
  const children = new Map();
  for (const [pid, entry] of entries) {
    if (!children.has(entry.parent)) children.set(entry.parent, []);
    children.get(entry.parent).push(pid);
  }
  return children;
}

function nasceuAntesDoPai(entry, parentStarted) {
  if (!entry.started || !parentStarted) return false;
  return entry.started < parentStarted;
}

function windowsKillTree(pid) {
  try {
    execFileSync('taskkill', ['/T', '/F', '/PID', String(pid)], { timeout: 5000, windowsHide: true, stdio: 'ignore' });
  } catch (error) {
    if (error.status !== 128) console.error('[Shutdown] taskkill', pid, error.status ?? error.code);
  }
}

function createWindowsProcessCleanup({
  readTable = windowsProcessTable,
  killTree = windowsKillTree,
  ownPid = process.pid,
  execPath = process.execPath,
} = {}) {
  const owned = new Map();
  let lastEntries = new Map();
  const executable = path.win32.basename(execPath).toLowerCase();

  function isElectronHelper(command) {
    return command.includes(' --type=') && command.toLowerCase().includes(executable);
  }

  function isTableReader(command) {
    return command.includes('Get-CimInstance Win32_Process');
  }

  function papelDoFilho(entry, parent, parentStarted) {
    if (nasceuAntesDoPai(entry, parentStarted)) return PAPEL_ALHEIO;
    if (isTableReader(entry.command)) return PAPEL_ALHEIO;
    if (isElectronHelper(entry.command)) return PAPEL_HELPER;
    if (owned.has(parent) || isNovaWindowsTool(entry.command)) return PAPEL_FERRAMENTA;
    return PAPEL_ALHEIO;
  }

  function percorrerArvoreDoNova(entries) {
    const children = filhosPorPai(entries);
    const pending = [ownPid, ...owned.keys()];
    const visited = new Set(pending);

    function adotar(pid, papel) {
      visited.add(pid);
      pending.push(pid);
      if (papel === PAPEL_FERRAMENTA) owned.set(pid, entries.get(pid).identity);
    }

    function visitarFilhosDe(parent) {
      const parentStarted = entries.get(parent)?.started ?? 0;
      const naoVistos = (children.get(parent) ?? []).filter(pid => !visited.has(pid));
      for (const pid of naoVistos) {
        const papel = papelDoFilho(entries.get(pid), parent, parentStarted);
        if (papel !== PAPEL_ALHEIO) adotar(pid, papel);
      }
    }

    for (const parent of pending) visitarFilhosDe(parent);
  }

  function collect() {
    const entries = readTable();
    lastEntries = entries;
    descartarDonosQueMudaram(owned, entries);
    percorrerArvoreDoNova(entries);
  }

  function rootsOwned() {
    return [...owned.keys()].filter(pid => {
      const seen = new Set([pid]);
      let current = lastEntries.get(pid)?.parent;
      while (current !== undefined && !seen.has(current)) {
        if (owned.has(current)) return false;
        seen.add(current);
        current = lastEntries.get(current)?.parent;
      }
      return true;
    });
  }

  return {
    collect,
    scanEveryMs: 0,
    async terminate() {
      for (let round = 0; round < 3; round++) {
        collect();
        if (owned.size === 0) return;
        for (const pid of rootsOwned()) killTree(pid);
        await delay(100);
      }
      collect();
      if (owned.size) console.error('[Shutdown] Processes still present:', [...owned.keys()]);
    },
  };
}

function registerShutdown(app, stopServices, processCleanup) {
  let state = 'running';
  app.on('before-quit', event => {
    if (state === 'finished') return;
    event.preventDefault();
    if (state === 'stopping') return;
    state = 'stopping';

    async function shutdown() {
      const collect = () => {
        try { processCleanup.collect(); }
        catch (error) { console.error('[Shutdown] Process scan:', error.message); }
      };

      collect();
      const scans = processCleanup.scanEveryMs === 0 ? null : setInterval(collect, processCleanup.scanEveryMs ?? 75);
      let timeout;
      try {
        await Promise.race([
          Promise.resolve().then(stopServices),
          new Promise(resolve => { timeout = setTimeout(resolve, 2000); }),
        ]);
      } catch (error) {
        console.error('[Shutdown] Service cleanup:', error.message);
      } finally {
        clearInterval(scans);
        clearTimeout(timeout);
      }
      await processCleanup.terminate();
    }

    shutdown().catch(error => {
      console.error('[Shutdown] Process cleanup:', error.message);
    }).finally(() => {
      state = 'finished';
      setTimeout(() => {
        processCleanup.terminate().catch(error => {
          console.error('[Shutdown] Final process cleanup:', error.message);
        }).finally(() => app.exit(0));
      }, 1500);
      app.quit();
    });
  });
  return () => state !== 'running';
}

module.exports = { createProcessCleanup, createWindowsProcessCleanup, parseWindowsProcessTable, registerShutdown };
