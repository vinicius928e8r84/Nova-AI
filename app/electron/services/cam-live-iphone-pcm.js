'use strict';
const { ehBytes } = require('./cam-live-iphone-quadro');

const MAIOR_BLOCO = 64 * 1024;
const MAIOR_FILA = 128 * 1024;
const ESPERA_DO_DRENO = 500;

function recusa(error) {
  return { ok: false, error };
}

function codificadorPronto(servico) {
  if (!servico.running || !servico.encoder) return false;
  const entrada = servico.encoder.stdin;
  return !!entrada && !entrada.destroyed;
}

function blocoDePcm(dados) {
  return ehBytes(dados) ? Buffer.from(dados) : null;
}

function tamanhoInvalido(bytes) {
  if (bytes.length < 2 || bytes.length > MAIOR_BLOCO) return true;
  return bytes.length % 2 !== 0;
}

function precisaEsperar(servico, entrada) {
  return servico.pcmBlocked || entrada.writableLength > MAIOR_FILA;
}

function aguardarDreno(entrada) {
  return new Promise((resolve) => {
    const finish = (ok) => {
      clearTimeout(timer);
      entrada.removeListener('drain', onDrain);
      entrada.removeListener('close', onClose);
      entrada.removeListener('error', onClose);
      resolve(ok);
    };
    const onDrain = () => finish(true);
    const onClose = () => finish(false);
    const timer = setTimeout(() => finish(false), ESPERA_DO_DRENO);
    entrada.once('drain', onDrain); entrada.once('close', onClose); entrada.once('error', onClose);
  });
}

function drenoPerdido(servico, entrada, token, drenou) {
  if (!drenou || token !== servico.generation) return true;
  return !servico.running || entrada.destroyed;
}

async function esperarDreno(servico, entrada, token) {
  servico.pcmWaiting = true;
  const drenou = await aguardarDreno(entrada);
  servico.pcmWaiting = false;
  if (drenoPerdido(servico, entrada, token, drenou)) {
    servico.droppedPcm++;
    return { ok: false, backpressure: true, error: 'O encoder não liberou o áudio em 500 ms. Pare e inicie novamente o CAM LIVE.' };
  }
  servico.pcmBlocked = false;
  return null;
}

function gravarPcm(servico, bytes) {
  try {
    servico.pcmBlocked = !servico.encoder.stdin.write(bytes);
    servico.pcmAt = Date.now();
    return { ok: true, backpressure: servico.pcmBlocked };
  } catch (_) {
    return recusa('Não foi possível enviar o áudio ao encoder.');
  }
}

async function enviarPcm(servico, { data, sampleRate } = {}) {
  if (!codificadorPronto(servico)) return recusa('O encoder de áudio não está preparado.');
  if (Number(sampleRate) !== servico.sampleRate) return recusa('A taxa do áudio mudou. Pare e inicie novamente o CAM LIVE.');
  const bytes = blocoDePcm(data);
  if (!bytes) return recusa('PCM inválido.');
  if (tamanhoInvalido(bytes)) return recusa('Bloco de áudio PCM inválido ou excessivo.');
  if (servico.pcmWaiting) return { ok: false, backpressure: true, error: 'Já existe um bloco de áudio aguardando o encoder.' };
  const entrada = servico.encoder.stdin;
  if (precisaEsperar(servico, entrada)) {
    const recusado = await esperarDreno(servico, entrada, servico.generation);
    if (recusado) return recusado;
  }
  return gravarPcm(servico, bytes);
}

module.exports = { enviarPcm };
