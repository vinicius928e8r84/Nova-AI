'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { CamLiveIphone } = require('../../app/electron/services/cam-live-iphone');
const IosCamera = require('../../app/electron/services/ios-camera');

const ready = {
  version: '0.1-39', hooksReady: true, photoPrepareHookReady: true,
  photoStillHookReady: true, photoPortRemapHookReady: true,
};
const frame = readFileSync(join(__dirname, '../integracao-camlive/test/fixtures/tiny.jpg'));

function setup() {
  const writes = [];
  const mobile = {
    getIosDevices: async () => [{ id: 'ios-teste', ios: true }],
    iosSsh: async () => ({ ok: true, stdout: JSON.stringify(ready) }),
    iosCamera: () => camera,
  };
  let tunnels = 0;
  const live = new CamLiveIphone({
    getMobileService: () => mobile,
    ffmpegPath: '/mock/ffmpeg',
    spawnProcess(file) {
      const child = Object.assign(new EventEmitter(), {
        stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
        kill: () => queueMicrotask(() => child.emit('exit')),
      });
      if (file === '/usr/bin/ssh') {
        tunnels++;
        queueMicrotask(() => child.stderr.write('remote forward success'));
      } else {
        queueMicrotask(() => child.emit('spawn'));
      }
      return child;
    },
  });
  mobile.camLiveIphone = live;
  const camera = new IosCamera(mobile);
  camera.ssh = async () => JSON.stringify(ready);
  camera.writeControl = async config => { writes.push(config.mode); };
  camera.liberarPortaCamera = async () => {};
  const currentFrame = async () => {
    const response = await fetch('http://127.0.0.1:' + live.media.server.address().port + live.media.framePath);
    assert.equal(response.status, 200);
    return Buffer.from(await response.arrayBuffer());
  };
  return { camera, live, writes, currentFrame, tunnels: () => tunnels };
}

test('injeção antes da live: preto, imagem ao iniciar, preto ao parar', async t => {
  const { camera, live, writes, currentFrame, tunnels } = setup();
  t.after(async () => { await camera.stopCamSpoof(); await live.stop(); });
  assert.equal((await camera.ligarInjecao()).success, true);
  const idle = await currentFrame();
  assert.equal(idle.readUInt16BE(0), 0xffd8);
  assert.equal((await live.start()).ok, true);
  assert.equal(tunnels(), 1);
  assert.equal(live.frame(frame).ok, true);
  assert.deepEqual(await currentFrame(), frame);
  await live.stop();
  assert.deepEqual(await currentFrame(), idle);
  assert.deepEqual(writes, ['inject']);
  assert.equal(live.cameraEnabled, true);
});

test('live antes da injeção: câmera real, live preservada em ambos os cliques', async t => {
  const { camera, live, writes, currentFrame, tunnels } = setup();
  t.after(async () => { await camera.stopCamSpoof(); await live.stop(); });
  assert.equal((await live.start()).ok, true);
  assert.deepEqual(writes, []);
  live.frame(frame);
  const encoder = live.encoder;
  assert.equal((await camera.ligarInjecao()).success, true);
  assert.equal((await camera.stopCamSpoof()).success, true);
  assert.deepEqual(writes, ['inject', 'observe']);
  assert.equal(live.running, true);
  assert.equal(live.encoder, encoder);
  assert.equal(tunnels(), 1);
  assert.deepEqual(await currentFrame(), frame);
  await live.stop();
  assert.equal(live.media, null);
  assert.deepEqual(writes, ['inject', 'observe']);
});
