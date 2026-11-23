'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { spawn, execFileSync } = require('node:child_process');
const { createProcessCleanup } = require('../nova-shutdown');

function vivo(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

test('Mac: mata a ferramenta filha do Nova e poupa o app que o usuario abriu por fora', { skip: process.platform === 'win32' }, async () => {
  const limpeza = createProcessCleanup('/nao-existe/Frameworks/');
  const ferramenta = spawn('sleep', ['30'], { stdio: 'ignore' });
  const { NOVA_PROCESS_OWNER, ...envSemDono } = process.env;
  const alheio = { pid: Number(execFileSync('/bin/sh', ['-c', 'sleep 31 >/dev/null 2>&1 </dev/null & echo $!'], { env: envSemDono, encoding: 'utf8' })) };
  try {
    limpeza.collect();
    await limpeza.terminate();
    await new Promise(resolve => ferramenta.exitCode !== null || ferramenta.signalCode !== null ? resolve() : ferramenta.once('exit', resolve));
    assert.strictEqual(vivo(ferramenta.pid), false);
    assert.strictEqual(vivo(alheio.pid), true);
  } finally {
    try { process.kill(alheio.pid, 'SIGKILL'); } catch {}
    try { process.kill(ferramenta.pid, 'SIGKILL'); } catch {}
  }
});
