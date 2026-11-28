const { ehIphone, executarNoIphoneComLimite } = require('./iphone-comando');

const NOVAPROXY = '/var/jb/usr/bin/novaproxy ';
const LIMITE_DO_NOVAPROXY_EM_MS = 30000;
const LIMITE_DE_LIMPAR_E_LER_EM_MS = 15000;
const LIMITE_DE_CONFERIR_EM_MS = 40000;
const AVISO_SO_IPHONE = 'O proxy está disponível apenas para iPhone.';
const AVISO_SEM_FALA = 'Falha ao falar com o proxy do iPhone.';

const ORIENTACOES_DO_NOVAPROXY = [
  {
    quando: /No such file|not found|command not found/i,
    orientacao: 'O novaproxy ainda não está instalado no iPhone. Rode o instalador uma vez.',
  },
  {
    quando: /password is required|a password is required/i,
    orientacao: 'A regra de sudo do novaproxy não está ativa no iPhone. Reinstale o pacote.',
  },
  {
    quando: /must have a tty|requiretty/i,
    orientacao: 'O sudo do iPhone exige terminal. Reinstale o pacote (a regra NOPASSWD não entrou).',
  },
];

const respostaDoNovaproxy = (erro, stdout, stderr) => ({
  ok: !erro, stdout: String(stdout || '').trim(), error: erro ? (String(stderr || '').trim() || erro.message) : null,
});

const recusaDeQuemNaoEIphone = () => ({ success: false, error: AVISO_SO_IPHONE });
const entreAspasSimples = (texto) => "'" + texto.replace(/'/g, "'\\''") + "'";
const campoDaLinha = (linha, expressao, padrao) => (linha.match(expressao) || [])[1] || padrao;

function rodarNovaproxy(argumentos, limiteEmMs = LIMITE_DO_NOVAPROXY_EM_MS) {
  return executarNoIphoneComLimite(NOVAPROXY + argumentos, limiteEmMs, respostaDoNovaproxy);
}

function traduzirErroDoNovaproxy(bruto) {
  const texto = String(bruto || '').trim();
  const conhecido = ORIENTACOES_DO_NOVAPROXY.find(({ quando }) => quando.test(texto));
  return conhecido ? conhecido.orientacao : texto || AVISO_SEM_FALA;
}

function falhaDoNovaproxy(resposta) {
  return { success: false, error: traduzirErroDoNovaproxy(resposta.error) };
}

async function definirProxyDoIphone(idDoAparelho, proxy) {
  if (!ehIphone(idDoAparelho)) return recusaDeQuemNaoEIphone();
  const bruto = String(proxy || '').trim();
  if (!bruto) return { success: false, error: 'Proxy vazio.' };
  const resposta = await rodarNovaproxy('proxy set ' + entreAspasSimples(bruto));
  return resposta.ok ? { success: true, message: resposta.stdout } : falhaDoNovaproxy(resposta);
}

async function limparProxyDoIphone(idDoAparelho) {
  if (!ehIphone(idDoAparelho)) return recusaDeQuemNaoEIphone();
  const resposta = await rodarNovaproxy('proxy clear', LIMITE_DE_LIMPAR_E_LER_EM_MS);
  return resposta.ok ? { success: true, message: resposta.stdout } : falhaDoNovaproxy(resposta);
}

function estadoDoProxy(linha) {
  return {
    success: true,
    on: /^on\s/.test(linha),
    upstream: campoDaLinha(linha, /upstream=([^\s]+)/, ''),
    wifi: campoDaLinha(linha, /wifi=(\w+)/, 'unknown'),
    daemon: /daemon=running/.test(linha),
    raw: linha,
  };
}

async function lerProxyDoIphone(idDoAparelho) {
  if (!ehIphone(idDoAparelho)) return recusaDeQuemNaoEIphone();
  const resposta = await rodarNovaproxy('proxy status', LIMITE_DE_LIMPAR_E_LER_EM_MS);
  return resposta.ok ? estadoDoProxy(resposta.stdout) : falhaDoNovaproxy(resposta);
}

async function conferirProxyDoIphone(idDoAparelho) {
  if (!ehIphone(idDoAparelho)) return recusaDeQuemNaoEIphone();
  const resposta = await rodarNovaproxy('proxy check', LIMITE_DE_CONFERIR_EM_MS);
  return resposta.ok ? { success: true, ip: resposta.stdout } : falhaDoNovaproxy(resposta);
}

module.exports = {
  rodarNovaproxy, traduzirErroDoNovaproxy, definirProxyDoIphone, limparProxyDoIphone, lerProxyDoIphone, conferirProxyDoIphone,
};
