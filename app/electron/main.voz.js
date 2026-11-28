const fs = require('fs');
const os = require('os');
const path = require('path');
const { ipcMain } = require('electron');
const pythonRuntime = require('./services/python-runtime');
const { edgeTtsBinary } = require('./services/paridade-utils');

const VOZ_PADRAO = 'en-US-ChristopherNeural';
const VOZ_DO_HINDI = 'hi-IN-MadhurNeural';
const VOZES_PELO_NOME = [
  ['Asad', 'ur-PK-AsadNeural'],
  ['Uzma', 'ur-PK-UzmaNeural'],
  ['Christopher', 'en-US-ChristopherNeural'],
];
const APRESENTACOES_PELA_VOZ = [
  ['ur-', 'السلام علیکم، میں نووا اے آئی ہوں، آپ کی خدمت میں حاضر ہوں'],
  ['hi-', 'नमस्ते, मैं Nova AI हूँ। आपकी सेवा में हाजिर हूँ।'],
];
const APRESENTACAO_EM_INGLES = 'Hello! I am Nova AI, your intelligent voice assistant. How can I help you today?';
const VALOR_DO_MEIO = 50;
const LIMITE_DO_ERRO_NA_TELA = 100;
const CANAL_DE_ESTADO = 'preview-voice-status';

function escolherVoz(aiVoice, aiLanguage) {
  const pelaVoz = VOZES_PELO_NOME.find(([trecho]) => aiVoice && aiVoice.includes(trecho));
  if (pelaVoz) return pelaVoz[1];
  return aiLanguage && aiLanguage.includes('Hindi') ? VOZ_DO_HINDI : VOZ_PADRAO;
}

function textoDaPrevia(scriptText, voz) {
  const texto = (scriptText || '').trim();
  if (texto) return texto;
  const apresentacao = APRESENTACOES_PELA_VOZ.find(([prefixo]) => voz.startsWith(prefixo));
  return apresentacao ? apresentacao[1] : APRESENTACAO_EM_INGLES;
}

const comSinal = (diferenca) => `${diferenca > 0 ? '+' : ''}${diferenca}`;
const ajusteDaVelocidade = (velocidade) => (velocidade !== VALOR_DO_MEIO ? `--rate "${comSinal((velocidade - VALOR_DO_MEIO) * 2)}%"` : '');
const ajusteDoTom = (tom) => (tom !== VALOR_DO_MEIO ? `--pitch "${comSinal(tom - VALOR_DO_MEIO)}Hz"` : '');

function arquivosDaPrevia(marca) {
  const pasta = os.tmpdir();
  return {
    audio: path.join(pasta, `nova_prev_${marca}.mp3`),
    legenda: path.join(pasta, `nova_prev_${marca}.vtt`),
    texto: path.join(pasta, `nova_prev_txt_${marca}.txt`),
  };
}

function comandoDoEdgeTts(arquivos, voz, aiSpeed, aiPitch) {
  return [
    edgeTtsBinary(process.platform, () => pythonRuntime.python()),
    `--file "${arquivos.texto}"`,
    `--write-media "${arquivos.audio}"`,
    `--write-subtitles "${arquivos.legenda}"`,
    `--voice ${voz}`,
    ajusteDaVelocidade(aiSpeed || VALOR_DO_MEIO),
    ajusteDoTom(aiPitch || VALOR_DO_MEIO),
  ].filter(Boolean).join(' ');
}

function apagarSemFalhar(arquivo) {
  try {
    fs.unlinkSync(arquivo);
  } catch (e) {}
}

function segundosDoTempo(tempo) {
  const [hms, ms] = tempo.split('.');
  const partes = hms.split(':').map(Number);
  return partes[0] * 3600 + partes[1] * 60 + partes[2] + (parseInt(ms || '0') / 1000);
}

function palavraComTempo(bloco) {
  const linhas = bloco.trim().split('\n');
  const linhaDoTempo = linhas.find((linha) => linha.includes('-->'));
  const linhaDaPalavra = linhas[linhas.length - 1];
  if (!linhaDoTempo || !linhaDaPalavra) return null;
  const [inicio, fim] = linhaDoTempo.split('-->').map((parte) => parte.trim());
  return { word: linhaDaPalavra.trim(), start: segundosDoTempo(inicio), end: segundosDoTempo(fim) };
}

function lerTemposDasPalavras(arquivoDeLegenda) {
  try {
    const bruto = fs.existsSync(arquivoDeLegenda) ? fs.readFileSync(arquivoDeLegenda, 'utf8') : '';
    const tempos = bruto.split(/\n\n+/).filter((bloco) => bloco.includes('-->')).map(palavraComTempo).filter(Boolean);
    apagarSemFalhar(arquivoDeLegenda);
    return tempos;
  } catch (e) {
    return [];
  }
}

const audioGerado = (arquivo) => fs.existsSync(arquivo) && fs.statSync(arquivo).size > 0;

function avisarEstado(evento, state, message, extras) {
  evento.sender.send(CANAL_DE_ESTADO, { state, message, ...extras });
}

function terminarComErro(evento, resolver, mensagemNaTela, erro) {
  avisarEstado(evento, 'error', mensagemNaTela);
  resolver({ success: false, error: erro });
}

function tocarPrevia(evento, exec, arquivos, resolver) {
  avisarEstado(evento, 'playing', '🔊 Reproduzindo...', { wordTimings: lerTemposDasPalavras(arquivos.legenda) });
  exec(`ffplay -nodisp -autoexit -loglevel quiet "${arquivos.audio}"`, () => {
    apagarSemFalhar(arquivos.audio);
    avisarEstado(evento, 'done', '✅ Pronto!');
    resolver({ success: true });
  });
}

function aoGerarAVoz(evento, exec, arquivos, resolver) {
  return function seguirDepoisDoEdgeTts(err) {
    apagarSemFalhar(arquivos.texto);
    if (err) return terminarComErro(evento, resolver, `❌ edge-tts: ${err.message.slice(0, LIMITE_DO_ERRO_NA_TELA)}`, err.message);
    if (!audioGerado(arquivos.audio)) return terminarComErro(evento, resolver, '❌ Arquivo de áudio vazio', 'Audio empty');
    return tocarPrevia(evento, exec, arquivos, resolver);
  };
}

async function preverVoz(evento, { aiVoice, aiLanguage, aiSpeed, aiPitch, scriptText }) {
  return new Promise((resolver) => {
    try {
      const { exec } = require('child_process');
      const arquivos = arquivosDaPrevia(Date.now());
      const voz = escolherVoz(aiVoice, aiLanguage);
      fs.writeFileSync(arquivos.texto, '\uFEFF' + textoDaPrevia(scriptText, voz), 'utf8');
      const comando = comandoDoEdgeTts(arquivos, voz, aiSpeed, aiPitch);
      avisarEstado(evento, 'generating', '🎙️ Gerando voz...');
      exec(comando, aoGerarAVoz(evento, exec, arquivos, resolver));
    } catch (e) {
      resolver({ success: false, error: e.message });
    }
  });
}

function registrarVoz() {
  ipcMain.handle('preview-voice', preverVoz);
}

module.exports = { registrarVoz };
