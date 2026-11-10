'use strict';

const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

function processTable() {
  const output = execFileSync('/bin/ps', ['-axww', '-o', 'pid=,ppid=,uid=,stat=,lstart=,comm='], {
    encoding: 'utf8',
    env: { ...process.env, LC_ALL: 'C' },
    timeout: 1000,
    maxBuffer: 4 * 1024 * 1024,
  });
  const entries = new Map();
  for (const line of output.split('\n')) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+\s+\S+\s+\d+\s+\S+\s+\d+)\s+(.+)$/);
    if (!match) continue;
    const [, pid, parent, uid, status, started, command] = match;
    if (status.startsWith('Z') || (Number(parent) === process.pid && command === '/bin/ps')) continue;
    entries.set(Number(pid), { parent: Number(parent), uid: Number(uid), identity: started + ' ' + command, command });
  }
  return entries;
}

function createProcessCleanup(electronHelpersPath) {
  const owned = new Map();
  const owner = randomUUID();
  const ownerMarker = new RegExp(`(?:^|\\s)NOVA_PROCESS_OWNER=${owner}(?:\\s|$)`);
  process.env.NOVA_PROCESS_OWNER = owner;
  let inspectedOrphans = new Map();

  function collectOrphans(entries) {
    const candidates = [];
    const current = new Map();
    for (const [pid, entry] of entries) {
      if (entry.parent !== 1 || entry.uid !== process.getuid() || pid === process.pid ||
          entry.command.startsWith(electronHelpersPath)) continue;
      current.set(pid, entry.identity);
      if (inspectedOrphans.get(pid) !== entry.identity) candidates.push(pid);
    }
    if (!candidates.length) {
      inspectedOrphans = current;
      return;
    }
    const output = execFileSync('/bin/ps', ['eww', '-p', candidates.join(','), '-o', 'pid=,command='], {
      encoding: 'utf8',
      timeout: 1000,
      maxBuffer: 8 * 1024 * 1024,
    });
    for (const line of output.split('\n')) {
      if (!ownerMarker.test(line)) continue;
      const pid = Number(line.trimStart().split(/\s+/, 1)[0]);
      if (current.has(pid)) owned.set(pid, current.get(pid));
    }
    inspectedOrphans = current;
  }

  function collect() {
    const entries = processTable();
    const children = new Map();
    for (const [pid, entry] of entries) {
      if (!children.has(entry.parent)) children.set(entry.parent, []);
      children.get(entry.parent).push(pid);
    }

    // Keep track of children seen before their parent exits and launchd adopts them.
    for (const [pid, identity] of owned) {
      if (entries.get(pid)?.identity !== identity) owned.delete(pid);
    }

    // A daemon such as ADB can reparent itself to launchd before shutdown starts.
    try { collectOrphans(entries); }
    catch (error) { console.error('[Shutdown] Orphan scan failed:', error.code ?? error.status); }

    const pending = [process.pid, ...owned.keys()];
    const visited = new Set(pending);
    for (const parent of pending) {
      for (const pid of children.get(parent) ?? []) {
        if (visited.has(pid)) continue;
        visited.add(pid);
        pending.push(pid);
        const entry = entries.get(pid);
        // Electron closes its own helpers when the main process exits.
        if (!entry.command.startsWith(electronHelpersPath)) owned.set(pid, entry.identity);
      }
    }
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

  return {
    collect,
    async terminate() {
      const signaled = new Map();
      const deadline = Date.now() + 800;
      while (true) {
        signalOwned('SIGTERM', signaled);
        if (owned.size === 0 || Date.now() >= deadline) break;
        await delay(75);
      }
      if (owned.size) {
        signalOwned('SIGKILL');
        await delay(75);
        collect();
        if (owned.size) console.error('[Shutdown] Processes still present:', [...owned.keys()]);
      }
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
      const scans = setInterval(collect, 75);
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
      // A renderer can veto the normal quit (for example, through beforeunload).
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

module.exports = { createProcessCleanup, registerShutdown };
