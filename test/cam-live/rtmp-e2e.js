const { spawn, spawnSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const { CamLiveService } = require('../../app/electron/services/cam-live-service.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'camlive-'));
const W = 640, H = 360, FPS = 30, SECS = 4, PORT = 19350;
const h264 = path.join(dir, 'in.h264'), out = path.join(dir, 'out.flv');
spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `testsrc=size=${W}x${H}:rate=${FPS}`, '-t', String(SECS), '-c:v', 'libx264', '-profile:v', 'main', '-bf', '0', '-g', '30', '-pix_fmt', 'yuv420p', '-f', 'h264', h264]);
const raw = fs.readFileSync(h264);

const nals = []; let i = 0, start = -1;
while (i < raw.length - 3) {
  const sc3 = raw[i] === 0 && raw[i + 1] === 0 && raw[i + 2] === 1, sc4 = raw[i] === 0 && raw[i + 1] === 0 && raw[i + 2] === 0 && raw[i + 3] === 1;
  if (sc3 || sc4) { if (start >= 0) nals.push(raw.subarray(start, i)); i += sc4 ? 4 : 3; start = i; } else i++;
}
nals.push(raw.subarray(start));
let sps, pps; const frames = []; let cur = [];
for (const n of nals) {
  const t = n[0] & 0x1f;
  if (t === 7) sps = n; else if (t === 8) pps = n;
  else if (t === 1 || t === 5) { frames.push({ key: t === 5, nal: n }); }
}
const avcC = Buffer.concat([Buffer.from([1, sps[1], sps[2], sps[3], 0xff, 0xe1, sps.length >> 8, sps.length & 255]), sps, Buffer.from([1, pps.length >> 8, pps.length & 255]), pps]);
const toAvcc = (n) => { const b = Buffer.alloc(4 + n.length); b.writeUInt32BE(n.length); n.copy(b, 4); return b; };

const dyn = process.argv.includes('dyn'); const thr = parseInt((process.argv.find(a => a.startsWith('thr=')) || 'thr=0').slice(4), 10);
const listener = spawn('ffmpeg', ['-y', '-v', 'warning', '-listen', '1', '-i', `rtmp://127.0.0.1:${PORT}/live/test`, '-c', 'copy', '-f', 'flv', out], { stdio: ['ignore', 'inherit', 'inherit'] });
const events = [];
const svc = new CamLiveService({ send: (ch, p) => { events.push([ch, p]); if (ch === 'camlive:status') console.log('status:', p.status, p.error || ''); }, studioFile: path.join(dir, 's.json'), logFile: path.join(dir, 'log.txt') });
process.env.CAMLIVE_DEBUG = '1';

setTimeout(async () => {
  await svc.start({ url: `rtmp://127.0.0.1:${PORT}/live`, key: 'test', dropMs: 700, pframeDropMs: 900, dyn, bitrate: 600, throttleKbps: thr, width: W, height: H, fps: FPS, retryDelaySec: 1, maxRetries: 3 });
  svc.setAvcC(avcC);
  await new Promise(r => setTimeout(r, 700));
  const t0 = Date.now();
  for (let k = 0; k < frames.length; k++) {
    svc.packet({ data: toAvcc(frames[k].nal), ptsUs: k * 33333, key: frames[k].key });
    const wait = t0 + (k + 1) * 33.33 - Date.now(); if (wait > 0) await new Promise(r => setTimeout(r, wait));
  }
  await svc.stop();
  await new Promise(r => setTimeout(r, 800));
  listener.kill('SIGINT');
  await new Promise(r => setTimeout(r, 800));
  const pr = spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,profile,width,height,nb_read_frames', '-of', 'default=nw=1', out]);
  console.log('--- ffprobe ---\n' + pr.stdout.toString() + pr.stderr.toString());
  console.log('enviados:', frames.length, 'quadros'); console.log('set-bitrate:', events.filter(e => e[0] === 'camlive:set-bitrate').map(e => e[1].kbps).join(' → ')); const st = events.filter(e => e[0] === 'camlive:stats').pop(); console.log('últimas stats:', JSON.stringify(st && st[1]));
  console.log('log:\n' + fs.readFileSync(path.join(dir, 'log.txt'), 'utf8'));
  process.exit(0);
}, 800);
