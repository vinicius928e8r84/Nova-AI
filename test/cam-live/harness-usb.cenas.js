'use strict';

const { cenasDeRotas } = require('./harness-rotas.cenas');

const CABECALHO_DO_JPEG = [255, 216];

function criarMidiaUsb(registro) {
  return class MidiaUsb {
    frame(bytes) {
      registro.anotar('UsbMedia.frame', Array.from(bytes));
      const jpeg = CABECALHO_DO_JPEG.every((byte, posicao) => bytes[posicao] === byte);
      return jpeg ? { ok: true } : { ok: false, error: 'não é JPEG' };
    }
  };
}

const modulos = registro => ({
  'app/electron/services/cam-live-service.js': {},
  'app/electron/services/cam-live-iphone.js': { UsbMedia: criarMidiaUsb(registro) },
});

async function contagens(bancada) {
  await bancada.get('/counts');
}

async function estudioInicioEParada(bancada) {
  await bancada.post('/ipc/invoke/camlive:studio-load', 'null');
  await bancada.post('/ipc/invoke/camlive:studio-save', '{"items":[]}');
  await bancada.post('/ipc/invoke/camlive:start', '{"width":1280,"height":720}');
  await bancada.post('/ipc/invoke/camlive:start', '{"width":1920,"height":1080}');
  await bancada.get('/counts');
  await bancada.post('/ipc/invoke/camlive:stop', 'null');
  await bancada.get('/counts');
}

async function quadros(bancada) {
  await bancada.post('/ipc/invoke/camlive:frame', '{"__bin":[255,216,255,217]}');
  await bancada.post('/ipc/invoke/camlive:frame', '{"__bin":[1,2]}');
  await bancada.post('/ipc/invoke/camlive:frame', '{"__bin":[]}');
  await bancada.post('/ipc/invoke/camlive:frame', '{"__bin":[255,216]}');
  await bancada.get('/counts');
}

async function audioPcm(bancada) {
  await bancada.post('/ipc/invoke/camlive:pcm', '{"sampleRate":48000,"data":[1,2,3,4]}');
  await bancada.post('/ipc/invoke/camlive:pcm', '{"sampleRate":44100,"data":{"__bin":[5,6]}}');
  await bancada.post('/ipc/invoke/camlive:pcm', '{"sampleRate":48000,"data":[7]}');
  await bancada.get('/counts');
}

async function canaisSemTratador(bancada) {
  await bancada.post('/ipc/send/camlive:log', '{"nivel":"info"}');
  await bancada.post('/ipc/send/camlive:log', '{"__u8":[1,2]}');
  await bancada.post('/ipc/send/camlive:outro', '{"a":1}');
  await bancada.post('/ipc/invoke/camlive:outro', '{"a":1}');
  await bancada.post('/ipc/invoke/camlive:outro', '');
}

const cenasDoHarnessUsb = [
  { nome: 'harness USB: sobe com as portas padrão', modulos, roteiro: contagens },
  { nome: 'harness USB: sobe com as portas do ambiente', modulos, ambiente: { PORT: '9002', RTMP_PORT: '19998' }, roteiro: bancada => bancada.get('/listen') },
  { nome: 'harness USB: o estúdio, o início e a parada', modulos, roteiro: estudioInicioEParada },
  { nome: 'harness USB: os quadros passam pela mídia USB', modulos, roteiro: quadros },
  { nome: 'harness USB: o áudio PCM é contado', modulos, roteiro: audioPcm },
  { nome: 'harness USB: os canais sem tratador', modulos, roteiro: canaisSemTratador },
  ...cenasDeRotas('harness USB', modulos),
];

module.exports = cenasDoHarnessUsb;
