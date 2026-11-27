const fs = require('fs');
const path = require('path');
const toolPaths = require('./tool-paths');

const TAMANHO_POR_PROPORCAO = new Map([['9:16', '720x1280'], ['1:1', '1080x1080']]);
const TAMANHO_PADRAO = '1280x720';
const ZOOM_PADRAO = quadros => `zoompan=z='min(1+0.20*on/${quadros},1.20)':d=${quadros}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`;
const MOVIMENTOS = new Map([
    ['pan_right', quadros => `zoompan=z='1.12':d=${quadros}:x='(iw-iw/zoom)*on/${quadros}':y='ih/2-(ih/zoom/2)'`],
    ['pan_left', quadros => `zoompan=z='1.12':d=${quadros}:x='(iw-iw/zoom)*(1-on/${quadros})':y='ih/2-(ih/zoom/2)'`],
    ['zoom_out', quadros => `zoompan=z='max(1.20-0.20*on/${quadros},1.0)':d=${quadros}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`],
    ['orbit', quadros => `zoompan=z='1.15+0.05*sin(on/20)':d=${quadros}:x='(iw-iw/zoom)/2+sin(on/25)*30':y='(ih-ih/zoom)/2+cos(on/25)*20'`]
]);

function raizesDoFfmpeg() {
    const raizes = [];
    if (process.resourcesPath) raizes.push(path.join(process.resourcesPath, 'bin'));
    raizes.push(path.join(process.cwd(), 'resources', 'bin'));
    raizes.push(path.join(__dirname, '..', '..', '..', 'bin'));
    raizes.push(path.join(__dirname, '..', '..', 'resources', 'bin'));
    return raizes;
}

function localizarFfmpeg() {
    const nome = toolPaths.exe('ffmpeg');
    const empacotado = raizesDoFfmpeg().map(raiz => path.join(raiz, nome)).find(candidato => fs.existsSync(candidato));
    return empacotado || 'ffmpeg';
}

function roteiroDoFfmpeg({ imagePath, outFilePath, duration, aspectRatio, motionPreset }) {
    const dur = Math.max(3, Math.min(15, duration || 5));
    const totalFrames = dur * 30;
    const tamanho = TAMANHO_POR_PROPORCAO.get(aspectRatio) || TAMANHO_PADRAO;
    const movimento = MOVIMENTOS.get(motionPreset) || ZOOM_PADRAO;
    const filtro = `${movimento(totalFrames)}:s=${tamanho}:fps=30,fade=t=in:st=0:d=0.4,fade=t=out:st=${dur - 0.4}:d=0.4,format=yuv420p`;
    return [
        '-y',
        '-i', imagePath,
        '-vf', filtro,
        '-c:v', 'libx264',
        '-t', String(dur),
        '-pix_fmt', 'yuv420p',
        '-preset', 'fast',
        '-crf', '18',
        outFilePath
    ];
}

module.exports = { localizarFfmpeg, roteiroDoFfmpeg };
