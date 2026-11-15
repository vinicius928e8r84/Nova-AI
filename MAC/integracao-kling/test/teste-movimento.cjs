// Valida que TODOS os presets produzem movimento real em vários tipos de imagem
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const FF = '/Applications/Nova AI Mac.app/Contents/Resources/bin/ffmpeg';
const S = require(process.argv[2]);
const svc = new S({ getPath: () => '/tmp' });

const mk = (out, args) => { execFileSync(FF, ['-y', ...args, out], { stdio: 'ignore' }); return out; };
const imgs = {
  'jpg-retrato': mk('/tmp/mv-foto.jpg', ['-f','lavfi','-i','testsrc2=size=3024x4032:duration=1','-frames:v','1','-q:v','2']),
  'png-paisagem': mk('/tmp/mv-img.png', ['-f','lavfi','-i','testsrc2=size=4000x3000:duration=1','-frames:v','1']),
  'jpg-pequeno': mk('/tmp/mv-peq.jpg', ['-f','lavfi','-i','testsrc2=size=800x600:duration=1','-frames:v','1','-q:v','2']),
  'jpg-12mp': mk('/tmp/mv-12mp.jpg', ['-f','lavfi','-i','testsrc2=size=4032x3024:duration=1','-frames:v','1','-q:v','3']),
};
// webp via sips (ffmpeg embutido decodifica, mas não codifica webp)
try { execFileSync('sips', ['-s','format','webp','/tmp/mv-img.png','--out','/tmp/mv-img.webp'], { stdio: 'ignore' }); imgs['webp'] = '/tmp/mv-img.webp'; } catch {}

const psnr = (a, b) => { const r = spawnSync(FF, ['-i', a, '-i', b, '-filter_complex', 'psnr', '-f', 'null', '-'], { encoding: 'utf8' }); const m = (r.stderr || '').match(/average:([0-9.inf]+)/); return m ? parseFloat(m[1]) : Infinity; };

(async () => {
  let fail = 0, total = 0;
  for (const preset of ['zoom', 'pan_right', 'pan_left', 'zoom_out', 'orbit']) {
    for (const [label, img] of Object.entries(imgs)) {
      total++;
      const r = await svc.convertPictureToVideo({ imagePath: img, prompt: 't', duration: 10, aspectRatio: '9:16', motionPreset: preset, apiKey: '', onProgress: () => {} });
      execFileSync(FF, ['-y','-i', r.videoPath, '-ss','1','-frames:v','1', '/tmp/mv-f1.png'], { stdio: 'ignore' });
      execFileSync(FF, ['-y','-i', r.videoPath, '-ss','8','-frames:v','1', '/tmp/mv-f8.png'], { stdio: 'ignore' });
      const p = psnr('/tmp/mv-f1.png', '/tmp/mv-f8.png');
      const moving = p < 40;
      if (!moving) fail++;
      console.log(`${preset.padEnd(9)} ${label.padEnd(13)} PSNR=${p.toFixed(1).padStart(7)} ${moving ? 'MOVE' : '*** PARADO ***'}`);
      fs.rmSync(r.videoPath, { force: true });
    }
  }
  console.log(fail === 0 ? `\nTODOS OS ${total} TESTES COM MOVIMENTO` : `\n${fail}/${total} FALHARAM`);
  process.exit(fail ? 1 : 0);
})();
