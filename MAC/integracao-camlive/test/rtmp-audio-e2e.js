// Serviço + áudio: vídeo H.264 e áudio AAC reais (gerados pelo ffmpeg) publicados por RTMP; ffmpeg -listen recebe.
const { spawn, spawnSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const { CamLiveService } = require('../../../app/electron/services/cam-live-service.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'camlive-a-'));
const W = 640, H = 360, FPS = 30, SECS = 4, PORT = 19360;
const h264 = path.join(dir, 'in.h264'), adts = path.join(dir, 'in.aac'), out = path.join(dir, 'out.flv');
spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `testsrc=size=${W}x${H}:rate=${FPS}`, '-t', String(SECS), '-c:v', 'libx264', '-profile:v', 'main', '-bf', '0', '-g', '30', '-pix_fmt', 'yuv420p', '-f', 'h264', h264]);
spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=' + SECS, '-ar', '48000', '-ac', '2', '-c:a', 'aac', '-b:a', '128k', '-f', 'adts', adts]);

// vídeo: Annex-B -> AVCC
const raw = fs.readFileSync(h264); const nals = []; let i = 0, start = -1;
while (i < raw.length - 3) { const a = raw[i] === 0 && raw[i + 1] === 0 && raw[i + 2] === 1, b = raw[i] === 0 && raw[i + 1] === 0 && raw[i + 2] === 0 && raw[i + 3] === 1; if (a || b) { if (start >= 0) nals.push(raw.subarray(start, i)); i += b ? 4 : 3; start = i; } else i++; }
nals.push(raw.subarray(start));
let sps, pps; const vframes = [];
for (const n of nals) { const t = n[0] & 31; if (t === 7) sps = n; else if (t === 8) pps = n; else if (t === 1 || t === 5) vframes.push({ key: t === 5, nal: n }); }
const avcC = Buffer.concat([Buffer.from([1, sps[1], sps[2], sps[3], 0xff, 0xe1, sps.length >> 8, sps.length & 255]), sps, Buffer.from([1, pps.length >> 8, pps.length & 255]), pps]);
const avcc = (n) => { const b = Buffer.alloc(4 + n.length); b.writeUInt32BE(n.length); n.copy(b, 4); return b; };

// áudio: ADTS -> quadros AAC brutos + AudioSpecificConfig
const ab = fs.readFileSync(adts); const aframes = []; let p = 0, asc = null;
while (p + 7 <= ab.length) {
  if (ab[p] !== 0xff || (ab[p + 1] & 0xf0) !== 0xf0) { p++; continue; }
  const prot = ab[p + 1] & 1, len = ((ab[p + 3] & 3) << 11) | (ab[p + 4] << 3) | (ab[p + 5] >> 5), hdr = prot ? 7 : 9;
  if (!asc) { const obj = ((ab[p + 2] >> 6) & 3) + 1, sf = (ab[p + 2] >> 2) & 15, ch = ((ab[p + 2] & 1) << 2) | (ab[p + 3] >> 6); asc = Buffer.from([(obj << 3) | (sf >> 1), ((sf & 1) << 7) | (ch << 3)]); }
  aframes.push(ab.subarray(p + hdr, p + len)); p += len;
}
const listener = spawn('ffmpeg', ['-y', '-v', 'warning', '-listen', '1', '-i', `rtmp://127.0.0.1:${PORT}/live/test`, '-c', 'copy', '-f', 'flv', out], { stdio: ['ignore', 'inherit', 'inherit'] });
const svc = new CamLiveService({ send: (ch, pl) => { if (ch === 'camlive:status') console.log('status:', pl.status); }, studioFile: path.join(dir, 's.json'), logFile: path.join(dir, 'log.txt') });
setTimeout(async () => {
  await svc.start({ url: `rtmp://127.0.0.1:${PORT}/live`, key: 'test', dropMs: 700, pframeDropMs: 900, dyn: false, bitrate: 600, audio: 128, width: W, height: H, fps: FPS, retryDelaySec: 1, maxRetries: 3 });
  svc.setAvcC(avcC); svc.setAsc(asc);
  await new Promise(r => setTimeout(r, 700));
  const t0 = Date.now(); let ai = 0;
  for (let k = 0; k < vframes.length; k++) {
    const vt = k * 33333;
    svc.packet({ data: avcc(vframes[k].nal), ptsUs: vt, key: vframes[k].key });
    while (ai < aframes.length && ai * 21333 <= vt + 33333) { svc.audioPacket({ data: aframes[ai], ptsUs: ai * 21333 }); ai++; }
    const w = t0 + (k + 1) * 33.33 - Date.now(); if (w > 0) await new Promise(r => setTimeout(r, w));
  }
  await svc.stop(); await new Promise(r => setTimeout(r, 800)); listener.kill('SIGINT'); await new Promise(r => setTimeout(r, 800));
  const pr = spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_type,codec_name,width,height,sample_rate,channels,nb_read_frames,duration', '-of', 'default=nw=1', out]);
  console.log('--- ffprobe ---\n' + pr.stdout.toString());
  const vd = spawnSync('ffmpeg', ['-v', 'info', '-i', out, '-af', 'volumedetect', '-vn', '-f', 'null', '-'], { encoding: 'utf8' });
  console.log((vd.stderr.match(/mean_volume:.*|max_volume:.*/g) || ['sem volumedetect']).join('\n'));
  console.log(`enviados: ${vframes.length} quadros de vídeo, ${ai} de áudio`);
  process.exit(0);
}, 800);
