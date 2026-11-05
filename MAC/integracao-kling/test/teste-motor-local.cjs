// Teste do motor local do Kling: imagem de teste -> MP4 (sem chave de API, sem rede)
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const SERVICE = process.argv[2];
const ffmpeg = '/Applications/Nova AI Mac.app/Contents/Resources/bin/ffmpeg';

// 1. Resolve o serviço
const KlingVideoService = require(SERVICE);
const fakeApp = { getPath: (k) => (k === 'downloads' ? '/tmp/nova-test-downloads' : '/tmp') };
const svc = new KlingVideoService(fakeApp);

// 2. Caminho do FFmpeg deve achar o binário do macOS
const resolved = svc._resolveFfmpegPath();
console.log('ffmpeg resolvido:', resolved);
if (resolved !== '/Applications/Nova AI Mac.app/Contents/Resources/bin/ffmpeg') {
  console.error('FALHOU: esperava o ffmpeg embutido do macOS');
  process.exit(1);
}

// 3. Pasta de saída deve ser a mesma da biblioteca (app/youtube_auto/exports)
const dir = svc._getExportDir();
console.log('pasta de saída:', dir);
if (!dir.includes('youtube_auto/exports')) { console.error('FALHOU: pasta errada'); process.exit(1); }

// 4. Gera imagem de teste 640x400
const testImg = '/tmp/nova-kling-test-img.png';
execFileSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x400:duration=1', '-frames:v', '1', testImg], { stdio: 'ignore' });

// 5. Conversão completa (motor local, 3s, zoom)
svc.convertPictureToVideo({
  imagePath: testImg, prompt: 'teste', duration: 3, aspectRatio: '9:16',
  motionPreset: 'zoom', apiKey: '', onProgress: (p) => process.stdout.write(`  ${p.percent}% ${p.message}\n`)
}).then((r) => {
  console.log('resultado:', JSON.stringify({ success: r.success, engine: r.engine, file: r.fileName, sizeBytes: r.sizeBytes }));
  const ok = r.success && fs.existsSync(r.videoPath) && r.sizeBytes > 0;
  if (ok) {
    const probe = execFileSync(ffmpeg, ['-i', r.videoPath, '-f', 'null', '-'], { stdio: ['ignore','pipe','pipe'], encoding: 'utf8' });
    fs.rmSync(testImg, { force: true });
    fs.rmSync(r.videoPath, { force: true }); // limpa o vídeo de teste da biblioteca
    console.log('PASSOU: vídeo gerado, válido no FFmpeg e removido da biblioteca');
  } else { console.error('FALHOU: vídeo não gerado'); process.exit(1); }
}).catch((e) => { console.error('FALHOU:', e.message); process.exit(1); });
