'use strict';

const fs = require('fs');
const path = require('path');
const { RAIZ } = require('./harness.palco');

const DIST = path.join(RAIZ, 'app/dist');
const FIXTURES = path.join(__dirname, 'fixtures');
const MODULOS_DA_JANELA = ['cam-live.js', 'cam-live-audio.js', 'cam-live-dados.js', 'cam-live-modelo.js', 'cam-live-geometria.js'];
const FIXTURES_DA_BANCADA = ['photo.png', 'clip.mp4', 'tone.wav', 'tiny.jpg'];
const SAIDA_DO_FFPROBE = JSON.stringify({ streams: [{ codec_type: 'video', codec_name: 'h264', width: 1280, height: 720, nb_read_frames: '30' }] });

const descrever = valor => JSON.parse(JSON.stringify(valor === undefined ? null : valor, (chave, item) => (item instanceof Uint8Array ? { uint8: Array.from(item) } : item)));

async function paginaDaBancada(bancada) {
  await bancada.getImpressao('/');
  await bancada.getImpressao('/?semana=1');
}

async function modulosDaJanela(bancada) {
  for (const modulo of MODULOS_DA_JANELA) await bancada.get(`/${modulo}`, path.join(DIST, modulo));
  await bancada.get('/cam-live-outro.js');
  await bancada.get('/cam-live/cam-live.js');
}

async function fixturesDaBancada(bancada) {
  for (const fixture of FIXTURES_DA_BANCADA) await bancada.get(`/fixtures/${fixture}`, path.join(FIXTURES, fixture));
  await bancada.get('/fixtures/nada.png');
  await bancada.get('/fixtures/../harness.js');
}

async function ouvinteDoFfmpeg(bancada) {
  await bancada.get('/kill');
  await bancada.get('/listen');
  await bancada.get('/listen');
  await bancada.get('/kill');
  await bancada.get('/kill');
}

async function resultadoDoFfprobe(bancada) {
  await bancada.get('/result');
  await bancada.get('/listen');
  await bancada.get('/result');
}

async function logDaBancada(bancada) {
  await bancada.get('/log');
  fs.mkdirSync(path.join(bancada.pasta(), 'CamLive'));
  fs.writeFileSync(path.join(bancada.pasta(), 'CamLive', 'camlive.log'), 'linha um\nlinha dois\n');
  await bancada.get('/log');
}

async function rotasDesconhecidas(bancada) {
  await bancada.get('/nada');
  await bancada.post('/nada', '{}');
  await bancada.post('/ipc/outro/canal', '{}');
  await bancada.post('/ipc/invoke/', '{}');
  await bancada.post('/ipc/send/', '{}');
}

async function fluxoDeEventos(bancada) {
  const fluxo = await bancada.abrirEventos();
  await fluxo.esperarTexto(': ok');
  bancada.anotar('cabeçalhos do /events', fluxo.cabecalhos);
  bancada.anotar('corpo do /events', fluxo.lido());
}

function cenasDeRotas(prefixo, modulos) {
  const cena = (nome, roteiro, extras = {}) => ({ nome: `${prefixo}: ${nome}`, modulos, roteiro, ...extras });
  return [
    cena('a página da bancada', paginaDaBancada),
    cena('os módulos da janela vêm de app/dist', modulosDaJanela),
    cena('as fixtures da bancada', fixturesDaBancada),
    cena('o ouvinte do ffmpeg', ouvinteDoFfmpeg),
    cena('o ouvinte do ffmpeg que não morre', ouvinteDoFfmpeg, { cenario: { matarFalha: true } }),
    cena('o resultado do ffprobe', resultadoDoFfprobe, { cenario: { ffprobe: { stdout: SAIDA_DO_FFPROBE } } }),
    cena('o resultado do ffprobe sem saída', resultadoDoFfprobe, { cenario: { ffprobe: { stderr: 'arquivo vazio' } } }),
    cena('o log da bancada', logDaBancada),
    cena('as rotas desconhecidas', rotasDesconhecidas),
    cena('o fluxo de eventos', fluxoDeEventos),
  ];
}

module.exports = { cenasDeRotas, descrever };
