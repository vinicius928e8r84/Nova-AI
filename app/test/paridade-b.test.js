const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { hasUpdateConfig, edgeTtsBinary } = require('../electron/services/paridade-utils');

test('hasUpdateConfig: sem app-update.yml devolve false e com ele true', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-upd-'));
  assert.strictEqual(hasUpdateConfig(dir), false);
  assert.strictEqual(hasUpdateConfig(undefined), false);
  fs.writeFileSync(path.join(dir, 'app-update.yml'), 'provider: generic\n');
  assert.strictEqual(hasUpdateConfig(dir), true);
});

test('edgeTtsBinary: Mac e Windows por python -m com o python resolvido', () => {
  assert.strictEqual(edgeTtsBinary('darwin', () => '/py/python3'), '"/py/python3" -m edge_tts');
  assert.strictEqual(edgeTtsBinary('win32', () => 'python'), '"python" -m edge_tts');
  assert.strictEqual(edgeTtsBinary('linux', () => ''), 'edge-tts');
});

test('pkill do Mac: so casa o Chrome/Chromium da sessao, nao um bash com o texto', () => {
  const { spawn, spawnSync } = require('child_process');
  const { MAC_BROWSER_KILL_PATTERN } = require('../electron/services/paridade-utils');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-pk-'));
  const mk = (rel) => {
    const f = path.join(dir, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.symlinkSync(process.execPath, f);
    return f;
  };
  const IDLE = 'setTimeout(()=>{},60000)';
  const sess = '--user-data-dir=/Users/u/Library/Application Support/Nova AI/.wwebjs_auth/session-nova-desktop-client';
  const chromium = mk('Chromium.app/Contents/MacOS/Chromium');
  const chrome = mk('Google Chrome.app/Contents/MacOS/Google Chrome');
  const outro = mk('Outro/Chromium.app/Contents/MacOS/Chromium');
  const kids = [
    spawn(chromium, ['-e', IDLE, '--', sess], { stdio: 'ignore' }),
    spawn(chrome, ['-e', IDLE, '--', sess], { stdio: 'ignore' }),
  ];
  const vivos = [
    spawn(outro, ['-e', IDLE, '--', '--user-data-dir=/x/pessoal'], { stdio: 'ignore' }),
    spawn('bash', ['-c', 'sleep 60; : $0', sess], { stdio: 'ignore' }),
    spawn(process.execPath, ['-e', IDLE, '--', sess], { stdio: 'ignore' }),
  ];
  return (() => {
    return new Promise(r => setTimeout(r, 400)).then(() => {
      spawnSync('pkill', ['-f', '--', MAC_BROWSER_KILL_PATTERN]);
      return new Promise(r => setTimeout(r, 400));
    }).then(() => {
      kids.forEach(k => assert.strictEqual(k.signalCode, 'SIGTERM', 'deveria morrer'));
      vivos.forEach(k => assert.strictEqual(k.signalCode, null, 'nao deveria morrer'));
    }).finally(() => [...kids, ...vivos].forEach(k => { try { k.kill('SIGKILL'); } catch (e) {} }));
  })();
});

test('instalacaoPorSistema: Mac traz hdiutil/ditto/installer e Windows traz /S e msiexec', () => {
  const { instalacaoPorSistema } = require('../electron/services/paridade-utils');
  const mac = instalacaoPorSistema('darwin');
  assert.ok(mac.includes('hdiutil attach') && mac.includes('ditto') && mac.includes('installer -pkg') && mac.includes('administrator privileges'));
  assert.ok(!mac.includes('msiexec'));
  const win = instalacaoPorSistema('win32');
  assert.ok(win.includes('"ARQ" /S') && win.includes('msiexec /i "ARQ" /qn /norestart'));
  assert.ok(!win.includes('hdiutil'));
});

test('instalacaoPorSistema: todo caminho da receita vai entre aspas e o .dmg manda conferir depois', () => {
  const { instalacaoPorSistema } = require('../electron/services/paridade-utils');
  const mac = instalacaoPorSistema('darwin');
  assert.ok(mac.includes('ditto "TMP/X.app" "/Applications/X.app"'));
  assert.ok(mac.includes('-mountpoint "TMP"') && mac.includes('hdiutil detach "TMP"'));
  assert.ok(mac.includes('ls /Applications'));
  assert.ok(!/&;|&\s*;/.test(mac));
  const win = instalacaoPorSistema('win32');
  assert.ok(!/msiexec \/i ARQ/.test(win));
});

test('instalacaoPorSistema: a receita do Mac roda em segundo plano e a do Windows avisa do limite de 15 s', () => {
  const { instalacaoPorSistema } = require('../electron/services/paridade-utils');
  const mac = instalacaoPorSistema('darwin');
  const [receitaDmg, receitaPkg] = mac.split('| .pkg =');
  assert.ok(receitaDmg.includes('.dmg =') && receitaDmg.includes(' >/dev/null 2>&1 &'));
  assert.ok(receitaPkg.includes('installer -pkg') && receitaPkg.includes(' >/dev/null 2>&1 &'));
  assert.ok(mac.includes('pkgutil --pkgs'));
  assert.ok(/background/i.test(mac));
  const win = instalacaoPorSistema('win32');
  assert.ok(/background|15 s/i.test(win));
});

test('instalacaoPorSistema: sistema que nao e Mac nem Windows nao recebe receita', () => {
  const { instalacaoPorSistema } = require('../electron/services/paridade-utils');
  assert.strictEqual(instalacaoPorSistema('linux'), '');
});

test('macAntigravityStats: memória do ps, CPU 0 como no Windows; só o estouro de tempo vira não respondendo', async () => {
  const { macAntigravityStats } = require('../electron/services/paridade-utils');
  const falso = (osascript) => ({ run: async (file, args) => {
    if (file === '/usr/bin/pgrep') return '4242\n4300';
    if (file === '/bin/ps') { assert.deepStrictEqual(args, ['-p', '4242', '-o', 'rss=']); return ' 204800'; }
    return osascript();
  } });
  assert.deepStrictEqual(await macAntigravityStats(falso(async () => 'Projeto')), { pid: 4242, cpu: 0, memory: 200, responding: true, title: 'Projeto' });
  const semJanela = await macAntigravityStats(falso(async () => { throw Object.assign(new Error('-1719'), { killed: false }); }));
  assert.strictEqual(semJanela.responding, true);
  assert.strictEqual(semJanela.title, '');
  const travado = await macAntigravityStats(falso(async () => { throw Object.assign(new Error('timeout'), { killed: true, signal: 'SIGTERM' }); }));
  assert.strictEqual(travado.responding, false);
  await assert.rejects(macAntigravityStats({ run: async () => { throw new Error('sem processo'); } }));
});

test('pkill do CAM spoof no Mac: so mata o Chrome com o Y4M do nova_webcam_hijack', () => {
  const { spawn, spawnSync } = require('child_process');
  const { MAC_CAM_SPOOF_KILL_PATTERN } = require('../electron/services/paridade-utils');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-cam-'));
  const mk = (rel) => {
    const f = path.join(dir, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.symlinkSync(process.execPath, f);
    return f;
  };
  const IDLE = 'setTimeout(()=>{},60000)';
  const hijack = '/var/folders/x/T/nova_webcam_hijack';
  const chrome = mk('Google Chrome.app/Contents/MacOS/Google Chrome');
  const outro = mk('Outro/Chromium.app/Contents/MacOS/Chromium');
  const kids = [
    spawn(chrome, ['-e', IDLE, '--', `--use-file-for-fake-video-capture=${hijack}/fake_cam.y4m`, '--no-first-run'], { stdio: 'ignore' }),
  ];
  const vivos = [
    spawn(outro, ['-e', IDLE, '--', '--user-data-dir=/x/pessoal'], { stdio: 'ignore' }),
    spawn(chrome, ['-e', IDLE, '--', `--use-file-for-fake-video-capture=/x/nova_webcam_hijack_outro/a.y4m`], { stdio: 'ignore' }),
    spawn(chrome, ['-e', IDLE, '--', `--user-data-dir=${hijack}/chrome_profile`], { stdio: 'ignore' }),
    spawn('bash', ['-c', 'sleep 60; : $0', `--use-file-for-fake-video-capture=${hijack}/fake_cam.y4m`], { stdio: 'ignore' }),
    spawn(process.execPath, ['-e', IDLE, '--', `--use-file-for-fake-video-capture=${hijack}/fake_cam.y4m`], { stdio: 'ignore' }),
  ];
  return new Promise(r => setTimeout(r, 400)).then(() => {
    spawnSync('pkill', ['-f', '--', MAC_CAM_SPOOF_KILL_PATTERN]);
    return new Promise(r => setTimeout(r, 400));
  }).then(() => {
    kids.forEach(k => assert.strictEqual(k.signalCode, 'SIGTERM', 'deveria morrer'));
    vivos.forEach(k => assert.strictEqual(k.signalCode, null, 'nao deveria morrer'));
  }).finally(() => [...kids, ...vivos].forEach(k => { try { k.kill('SIGKILL'); } catch (e) {} }));
});
