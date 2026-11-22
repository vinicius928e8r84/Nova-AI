'use strict';

const MENSAGENS_DO_SPOOF = [
  { type: 'load-video', hasVideo: true },
  { type: 'load-video', hasVideo: false },
  { type: 'spoof-state', hasVideo: true },
  { type: 'spoof-state' },
  { type: 'play' },
  { type: 'pause' },
  { type: 'restart' },
  { type: 'speed', speed: 2 },
  { type: 'speed', speed: 0 },
  { type: 'speed' },
  { type: 'outro' },
  { type: 'constructor' },
  { type: 'toString' },
  {},
  null,
  [],
  'texto',
];

async function receberNoSpoof(pagina, mensagens) {
  const socket = pagina.socket();
  for (const mensagem of mensagens) {
    pagina.anotar('>> mensagem', JSON.stringify(mensagem));
    socket.onmessage({ data: JSON.stringify(mensagem) });
    await pagina.esperarPromessas();
  }
  pagina.anotar('>> mensagem', 'não é json');
  socket.onmessage({ data: '{quebrado' });
}

async function relogioDoSpoof(pagina) {
  const video = pagina.valores('spoofVideo');
  video.paused = false;
  video.currentTime = 7325.9;
  await pagina.rodarTemporizador('setInterval');
  video.currentTime = 3600.4;
  await pagina.rodarTemporizador('setInterval');
  video.currentTime = 0;
  pagina.avancarRelogio(61500);
  await pagina.rodarTemporizador('setInterval');
  video.paused = true;
  await pagina.rodarTemporizador('setInterval');
}

async function botoesDoSpoof(pagina) {
  for (const botao of ['btnHud', 'btnHud', 'btnFlip', 'btnFlip', 'btnFit', 'btnSound', 'btnSound', 'btnFull']) {
    await pagina.disparar(botao, 'click');
  }
  pagina.documento.fullscreenElement = {};
  await pagina.disparar('btnFull', 'click');
}

async function videoDoSpoof(pagina) {
  const video = pagina.elemento('spoofVideo');
  pagina.anotar('>> video.onerror');
  video.onerror();
  pagina.anotar('>> video.onloadeddata');
  video.onloadeddata();
  await pagina.esperarPromessas();
  pagina.valores('spoofVideo').paused = true;
  await pagina.disparar('body', 'click');
}

async function reconexao(pagina) {
  pagina.anotar('>> ws.onclose');
  pagina.socket().onclose();
  await pagina.rodarTemporizador('setTimeout');
}

const roteiroDoSpoof = async pagina => {
  await receberNoSpoof(pagina, MENSAGENS_DO_SPOOF);
  await relogioDoSpoof(pagina);
  await botoesDoSpoof(pagina);
  await videoDoSpoof(pagina);
  await reconexao(pagina);
  await receberNoSpoof(pagina, [{ type: 'play' }]);
};

async function enviarQuadros(pagina) {
  const video = pagina.valores('video');
  video.videoWidth = 640;
  await pagina.rodarTemporizador('setInterval');
  pagina.avancarRelogio(1000);
  await pagina.rodarTemporizador('setInterval');
  video.videoWidth = 0;
  await pagina.rodarTemporizador('setInterval');
  video.videoWidth = 640;
  pagina.socket().readyState = 3;
  await pagina.rodarTemporizador('setInterval');
  pagina.socket().readyState = 1;
  pagina.avancarRelogio(999);
  await pagina.rodarTemporizador('setInterval');
}

const roteiroDaCameraDoCelular = async pagina => {
  pagina.anotar('>> ws.onopen');
  pagina.socket().onopen();
  await pagina.disparar('startBtn', 'click');
  await enviarQuadros(pagina);
  pagina.anotar('>> ws.onopen transmitindo');
  pagina.socket().onopen();
  await pagina.disparar('flipBtn', 'click');
  await pagina.disparar('flipBtn', 'click');
  await pagina.disparar('stopBtn', 'click');
  await pagina.disparar('stopBtn', 'click');
  await reconexao(pagina);
};

const roteiroDaWebcamDoPc = async pagina => {
  pagina.anotar('>> ws.onopen');
  pagina.socket().onopen();
  pagina.anotar('>> ws.onmessage');
  pagina.socket().onmessage({ data: 'data:image/jpeg;base64,QUFB' });
  await reconexao(pagina);
};

module.exports = [
  { nome: 'spoof: mensagens, relógio, botões e reconexão', pagina: 'SPOOF_DO_CELULAR', roteiro: roteiroDoSpoof },
  { nome: 'spoof: play e tela cheia recusados, http', pagina: 'SPOOF_DO_CELULAR', roteiro: roteiroDoSpoof, cenario: { playFalha: true, telaCheiaFalha: true, protocolo: 'http:' } },
  { nome: 'spoof: socket fechado', pagina: 'SPOOF_DO_CELULAR', roteiro: roteiroDoSpoof, cenario: { wsEstado: 3 } },
  { nome: 'câmera do celular: transmitir, virar, parar e reconectar', pagina: 'CAMERA_DO_CELULAR', roteiro: roteiroDaCameraDoCelular },
  { nome: 'câmera do celular: câmera negada, http', pagina: 'CAMERA_DO_CELULAR', roteiro: roteiroDaCameraDoCelular, cenario: { cameraNegada: true, protocolo: 'http:' } },
  { nome: 'câmera do celular: play recusado', pagina: 'CAMERA_DO_CELULAR', roteiro: roteiroDaCameraDoCelular, cenario: { playFalha: true } },
  { nome: 'webcam do pc: abrir, receber e reconectar', pagina: 'WEBCAM_DO_PC', roteiro: roteiroDaWebcamDoPc },
];
