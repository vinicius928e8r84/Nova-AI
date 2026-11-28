'use strict';

const { TIPO, comandoAmf, inteiro32 } = require('./cam-live-service.palco');

const AVCC = Buffer.from('0164001fffe1000a67640020acd940a03d9010000003001000000300f0', 'hex');
const ASC = Buffer.from('1190', 'hex');
const bytes = (tamanho, valor) => Buffer.alloc(tamanho, valor);

const configuracao = (a, extras = {}) => ({
  url: a.url, key: 'chave-de-teste', width: 640, height: 360, fps: 30, bitrate: 600, audio: 128,
  dropMs: 700, pframeDropMs: 900, dyn: false, throttleKbps: 0, maxRetries: 3, retryDelaySec: 1, ...extras,
});

const quadro = (ptsUs, tamanho, chave = false) => ({ data: bytes(tamanho, (ptsUs / 1000) & 0xff), ptsUs, key: chave });
const audio = (ptsUs, tamanho) => ({ data: bytes(tamanho, 0xa0 + (tamanho & 0x0f)), ptsUs });

const estaAoVivo = (a, vezes = 1) => () => a.eventos.filter(([canal, carga]) => canal === 'camlive:status' && carga.status === 'AO VIVO').length >= vezes;

async function iniciarComCabecalhos(a, extras) {
  const retorno = await a.servico.start(configuracao(a, extras));
  await a.asentar();
  await a.ate(estaAoVivo(a));
  a.servico.setAvcC(AVCC);
  a.servico.setAsc(ASC);
  return retorno;
}

async function transmissaoCompleta(a) {
  const retornos = { inicio: await iniciarComCabecalhos(a) };
  a.servico.audioPacket(audio(0, 10));
  a.servico.packet(quadro(1000000, 100, true));
  a.servico.packet(quadro(1033333, 50));
  a.servico.audioPacket(audio(1040000, 20));
  a.servico.packet(quadro(1066666, 10000));
  await a.asentar();
  retornos.segundoInicio = await a.servico.start(configuracao(a));
  retornos.parada = await a.servico.stop();
  retornos.segundaParada = await a.servico.stop();
  return retornos;
}

async function tempoEstendido(a) {
  const retornos = { inicio: await iniciarComCabecalhos(a) };
  a.servico.packet(quadro(0, 30, true));
  a.servico.packet(quadro(20000000000, 5000, true));
  a.servico.audioPacket(audio(20000001000, 7000));
  await a.asentar();
  retornos.parada = await a.servico.stop();
  return retornos;
}

async function esperaPelaChave(a) {
  const retornos = { inicio: await iniciarComCabecalhos(a) };
  a.servico.packet(quadro(100000, 40));
  a.servico.packet(quadro(133333, 40));
  a.servico.packet(quadro(166666, 60, true));
  a.servico.packet(quadro(200000, 40));
  await a.asentar();
  retornos.parada = await a.servico.stop();
  return retornos;
}

async function connectRecusado(a) {
  const retornos = { inicio: await a.servico.start(configuracao(a, { maxRetries: 2 })) };
  await a.asentar();
  await a.avancar(1000);
  await a.avancar(1000);
  await a.avancar(1000);
  return retornos;
}

async function portaFechada(a) {
  return { inicio: await a.servico.start(configuracao(a, { maxRetries: 0 })) };
}

async function enderecosInvalidos(a) {
  const retornos = {};
  for (const [nome, url] of [['http', 'http://exemplo.test/live'], ['rtmps', 'rtmps://exemplo.test/live'], ['vazio', '']]) {
    retornos[nome] = await a.servico.start(configuracao(a, { url }));
    await a.asentar();
  }
  return retornos;
}

async function semRespostaAoConnect(a) {
  const retornos = { inicio: await a.servico.start(configuracao(a, { maxRetries: 0 })) };
  await a.asentar();
  await a.avancar(10000);
  return retornos;
}

async function servidorCaiNoMeio(a) {
  const retornos = { inicio: await iniciarComCabecalhos(a) };
  a.servico.packet(quadro(1000000, 80, true));
  await a.asentar();
  await a.avancar(1000);
  await a.ate(estaAoVivo(a, 2));
  a.servico.packet(quadro(2000000, 90, true));
  await a.asentar();
  retornos.parada = await a.servico.stop();
  return retornos;
}

const mensagemLonga = (conexao, codigo) => conexao.enviarComando(5, 1, 'onStatus', 0, null, { level: 'status', code: codigo, description: 'x'.repeat(300) });

const mensagensDoServidor = [
  (conexao) => mensagemLonga(conexao, 'NetStream.Teste.Longa128'),
  (conexao) => conexao.enviar({ csid: 2, tipo: TIPO.controle, corpo: Buffer.concat([Buffer.from([0, 6]), inteiro32(777)]) }),
  (conexao) => conexao.enviar({ csid: 2, tipo: TIPO.banda, corpo: Buffer.concat([inteiro32(2500000), Buffer.from([2])]) }),
  (conexao) => conexao.enviar({ csid: 2, tipo: TIPO.janela, corpo: inteiro32(2500000) }),
  (conexao) => conexao.definirBlocoDeSaida(4096),
  (conexao) => mensagemLonga(conexao, 'NetStream.Teste.Longa4096'),
  (conexao) => conexao.enviar({ csid: 2, tipo: TIPO.controle, corpo: Buffer.concat([Buffer.from([0, 0]), inteiro32(1)]) }),
  (conexao) => conexao.enviar({ csid: 3, tipo: TIPO.comando, corpo: comandoAmf('_result', 'nao-e-numero', null) }),
  (conexao) => conexao.enviar({ csid: 3, tipo: TIPO.comando, corpo: comandoAmf('_result', 999, null) }),
];

async function mensagensDeControle(a) {
  const retornos = { inicio: await iniciarComCabecalhos(a) };
  a.servico.packet(quadro(1000000, 60, true));
  await a.asentar();
  retornos.parada = await a.servico.stop();
  return retornos;
}

const mensagemGrande = (conexao) => {
  conexao.definirBlocoDeSaida(65536);
  conexao.enviar({ csid: 6, tipo: TIPO.audio, idDoFluxo: 1, corpo: bytes(2600000, 3) });
};

async function confirmacaoDeBytes(a) {
  const retornos = { inicio: await iniciarComCabecalhos(a) };
  await a.asentar();
  retornos.parada = await a.servico.stop();
  return retornos;
}

async function filaCongestionada(a) {
  const retornos = { inicio: await iniciarComCabecalhos(a, { throttleKbps: 100 }) };
  for (let i = 0; i < 45; i++) a.servico.packet(quadro(1000000 + i * 33333, 1000, i === 0));
  await a.asentar();
  await a.avancar(1000);
  for (let i = 0; i < 45; i++) await a.avancar(80);
  retornos.parada = await a.parar();
  return retornos;
}

async function bitrateDinamico(a) {
  const retornos = { inicio: await iniciarComCabecalhos(a, { throttleKbps: 100, dyn: true, bitrate: 600, audio: 0 }) };
  for (let rodada = 0; rodada < 70; rodada++) {
    for (let i = 0; i < 3; i++) a.servico.packet(quadro(1000000 + (rodada * 3 + i) * 33333, 1000, rodada === 0 && i === 0));
    await a.avancar(80);
  }
  retornos.parada = await a.parar();
  return retornos;
}

module.exports = [
  { nome: 'transmissão completa: vídeo em blocos, áudio, segunda partida recusada e parada do usuário', roteiro: transmissaoCompleta },
  { nome: 'tempo estendido: o tempo acima de 16777215 ms usa o campo extra em cada bloco', roteiro: tempoEstendido },
  { nome: 'quadro que não é chave espera a chave e pede um novo quadro-chave', roteiro: esperaPelaChave },
  { nome: 'connect recusado pelo servidor: tenta de novo duas vezes e desiste', servidor: { codigoDoConnect: 'NetConnection.Connect.Rejected' }, roteiro: connectRecusado },
  { nome: 'porta sem servidor: desiste na hora com a mensagem de conexão recusada', porta: 1, roteiro: portaFechada },
  { nome: 'endereços inválidos: http, rtmps e vazio', roteiro: enderecosInvalidos },
  { nome: 'servidor que não responde ao connect: espera dez segundos e desiste', servidor: { responderConnect: false }, roteiro: semRespostaAoConnect },
  { nome: 'servidor que fecha no meio: reconecta, manda os cabeçalhos de novo e espera a chave', servidor: { cairDepoisDeVideos: 2 }, roteiro: servidorCaiNoMeio },
  { nome: 'mensagens de controle do servidor: ping, banda, tamanho de bloco e respostas sem dono', servidor: { extrasNoConnect: mensagensDoServidor }, roteiro: mensagensDeControle },
  { nome: 'o servidor manda 2,6 MB e o cliente confirma o que recebeu', servidor: { aoPublicar: mensagemGrande }, roteiro: confirmacaoDeBytes },
  { nome: 'fila congestionada: descarta quadros P e depois tudo abaixo do alto', roteiro: filaCongestionada },
  { nome: 'bitrate dinâmico: baixa quando a fila cresce e sobe de novo', roteiro: bitrateDinamico },
];
