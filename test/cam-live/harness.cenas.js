'use strict';

const { cenasDeRotas, descrever } = require('./harness-rotas.cenas');

function registrarServico(registro) {
  return opcoes => {
    const { ipcMain, getWindow, userDataDir } = opcoes;
    registro.anotar('register', { chaves: Object.keys(opcoes), userDataDir, destruida: getWindow().isDestroyed() });
    ipcMain.handle('camlive:eco', (_evento, argumento) => ({ recebido: descrever(argumento) }));
    ipcMain.handle('camlive:mudo', () => undefined);
    ipcMain.handle('camlive:avisar', (_evento, argumento) => {
      getWindow().webContents.send('camlive:avisado', argumento);
      return { ok: true };
    });
    ipcMain.on('camlive:soltar', (evento, argumento) => registro.anotar('on camlive:soltar', { evento, argumento: descrever(argumento) }));
  };
}

const modulos = registro => ({ 'app/electron/services/cam-live-service.js': { register: registrarServico(registro) } });

async function invocarNoServico(bancada) {
  await bancada.post('/ipc/invoke/camlive:eco', '{"nome":"a","lista":[1,2]}');
  await bancada.post('/ipc/invoke/camlive:eco', '');
  await bancada.post('/ipc/invoke/camlive:eco', '{"data":[1,2,255],"id":7}');
  await bancada.post('/ipc/invoke/camlive:eco', '{"data":"texto"}');
  await bancada.post('/ipc/invoke/camlive:eco', '{"__u8":[9,8]}');
  await bancada.post('/ipc/invoke/camlive:mudo', 'null');
  await bancada.post('/ipc/invoke/camlive:semcanal', '{"a":1}');
}

async function enviarAoServico(bancada) {
  await bancada.post('/ipc/send/camlive:soltar', '{"nome":"a"}');
  await bancada.post('/ipc/send/camlive:soltar', '');
  await bancada.post('/ipc/send/camlive:soltar', '{"data":[4,5],"id":1}');
  await bancada.post('/ipc/send/camlive:soltar', '{"__u8":[1,2,3]}');
  await bancada.post('/ipc/send/camlive:semcanal', '{"nome":"a"}');
  await bancada.post('/ipc/send/camlive:semcanal', '{"__u8":[1]}');
}

async function eventosDoServico(bancada) {
  const primeiro = await bancada.abrirEventos();
  const segundo = await bancada.abrirEventos();
  await bancada.post('/ipc/invoke/camlive:avisar', '{"n":1}');
  await primeiro.esperarTexto('"n":1');
  await segundo.esperarTexto('"n":1');
  bancada.anotar('primeiro fluxo', primeiro.lido());
  bancada.anotar('segundo fluxo', segundo.lido());
}

async function portasDoAmbiente(bancada) {
  await bancada.get('/listen');
}

const cenasDoHarness = [
  { nome: 'harness: sobe com as portas padrão', modulos, roteiro: portasDoAmbiente },
  { nome: 'harness: sobe com as portas do ambiente', modulos, ambiente: { PORT: '9001', RTMP_PORT: '19999' }, roteiro: portasDoAmbiente },
  { nome: 'harness: sobe com portas que não são número', modulos, ambiente: { PORT: 'abc', RTMP_PORT: '' }, roteiro: portasDoAmbiente },
  { nome: 'harness: invoke chega ao serviço', modulos, roteiro: invocarNoServico },
  { nome: 'harness: send chega ao serviço', modulos, roteiro: enviarAoServico },
  { nome: 'harness: os eventos do serviço chegam à página', modulos, roteiro: eventosDoServico },
  ...cenasDeRotas('harness', modulos),
];

module.exports = cenasDoHarness;
