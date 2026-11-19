const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { hasUpdateConfig, edgeTtsBinary, downloadFile } = require('../electron/services/paridade-utils');

test('hasUpdateConfig: sem app-update.yml devolve false e com ele true', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-upd-'));
  assert.strictEqual(hasUpdateConfig(dir), false);
  assert.strictEqual(hasUpdateConfig(undefined), false);
  fs.writeFileSync(path.join(dir, 'app-update.yml'), 'provider: generic\n');
  assert.strictEqual(hasUpdateConfig(dir), true);
});

test('edgeTtsBinary: Mac igual ao de antes, Windows por python -m', () => {
  assert.strictEqual(edgeTtsBinary('darwin', () => '/py/python3'), '"/py/python3" -m edge_tts');
  assert.strictEqual(edgeTtsBinary('win32', () => { throw new Error('nao deve chamar'); }), 'python -m edge_tts');
  assert.strictEqual(edgeTtsBinary('linux', () => ''), 'edge-tts');
});

test('downloadFile: segue redirecionamento, reporta progresso e trata 404', async () => {
  const body = Buffer.alloc(50000, 7);
  const srv = http.createServer((req, res) => {
    if (req.url === '/r') { res.writeHead(302, { Location: '/f' }); return res.end(); }
    if (req.url === '/f') { res.writeHead(200, { 'Content-Length': body.length }); return res.end(body); }
    res.writeHead(404); res.end();
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nova-dl-')), 'a.bin');
  const pcts = [];
  await downloadFile(`${base}/r`, out, { onProgress: p => pcts.push(p) });
  assert.strictEqual(fs.statSync(out).size, body.length);
  assert.strictEqual(pcts[pcts.length - 1], 100);
  await assert.rejects(downloadFile(`${base}/x`, out + '2'), /HTTP 404/);
  srv.close();
});

test('downloadFile: redirecionamento ftp:, file: ou Location invalida rejeita sem derrubar o processo', async () => {
  const srv = http.createServer((req, res) => {
    const loc = { '/ftp': 'ftp://127.0.0.1/x', '/file': 'file:///etc/passwd', '/bad': 'http://[' }[req.url];
    if (loc) { res.writeHead(302, { Location: loc }); return res.end(); }
    res.writeHead(404); res.end();
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nova-dl-')), 'a.bin');
  await assert.rejects(downloadFile(`${base}/ftp`, out), /Protocolo nao suportado/);
  await assert.rejects(downloadFile(`${base}/file`, out), /Protocolo nao suportado/);
  await assert.rejects(downloadFile(`${base}/bad`, out), /Invalid URL/);
  assert.strictEqual(fs.existsSync(out), false);
  srv.close();
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
