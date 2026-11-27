'use strict';
const { AdtsParser } = require('./cam-live-iphone-adts');

function argumentosDoCodificador(taxa) {
  return ['-nostdin', '-hide_banner', '-loglevel', 'error', '-probesize', '32', '-analyzeduration', '0', '-f', 's16le', '-ar', String(taxa), '-ac', '1', '-i', 'pipe:0', '-vn', '-c:a', 'aac', '-profile:a', 'aac_low', '-ar', '44100', '-ac', '1', '-b:a', '96k', '-flush_packets', '1', '-f', 'adts', 'pipe:1'];
}

function entregarPacote(servico, pacote, token) {
  if (token !== servico.generation || !servico.media) return;
  servico.media.audioPacket(pacote);
  servico._updateSource(token);
}

function lerSaida(servico, parser, dados, token) {
  if (token !== servico.generation) return;
  try { parser.push(dados); } catch (e) { servico._fail(e, token); }
}

function ligarSaida(servico, child, token) {
  const parser = new AdtsParser((pacote) => entregarPacote(servico, pacote, token));
  child.stdout.on('data', (dados) => lerSaida(servico, parser, dados, token));
  child.stderr.on('data', (dados) => { servico.encoderError = (servico.encoderError + dados.toString()).slice(-2048); });
}

function ligarEntrada(servico, child, token) {
  child.stdin.on('drain', () => { servico.pcmBlocked = false; });
  child.stdin.on('error', () => servico._fail(new Error('A entrada de áudio do CAM LIVE foi interrompida.'), token));
}

function aguardarPartida(servico, child, token) {
  return new Promise((resolve, reject) => {
    let spawned = false;
    const falhar = (error) => (spawned ? servico._fail(error, token) : reject(error));
    child.once('spawn', () => { spawned = true; resolve(); });
    child.once('error', () => falhar(new Error('Não foi possível iniciar o encoder de áudio incluído no Nova.')));
    child.once('exit', () => falhar(new Error('O encoder de áudio do CAM LIVE foi encerrado.' + (servico.encoderError ? ' ' + servico.encoderError : ''))));
  });
}

async function iniciarCodificador(servico, token) {
  const ffmpeg = servico.ffmpegPath || require('./tool-paths').ffmpeg();
  if (!ffmpeg) throw new Error('FFmpeg não está incluído no Nova. Reinstale o aplicativo completo.');
  const child = servico.spawnProcess(ffmpeg, argumentosDoCodificador(servico.sampleRate), { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  servico.encoder = child; servico.encoderError = '';
  ligarSaida(servico, child, token);
  ligarEntrada(servico, child, token);
  await aguardarPartida(servico, child, token);
}

module.exports = { iniciarCodificador };
