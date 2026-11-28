'use strict';

const https = require('https');
const { URL } = require('url');

const MODELOS_DA_API = [
  { model: 'gemini-3.8-flash', api: 'v1beta' },
  { model: 'gemini-4-argon', api: 'v1beta' },
];
const STATUS_QUE_ENCERRAM_A_BUSCA = [400, 403];
const LETRAS_DO_AVISO = 80;

const corpoDoPedido = (prompt) => JSON.stringify({
  contents: [{ role: 'user', parts: [{ text: prompt }] }],
  generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
});

async function tentarPelaSessaoDoNavegador(prompt) {
  try {
    const motor = require('./gemini-browser-engine');
    const sessao = motor.getAuthStatus();
    if (!(sessao && sessao.isLoggedIn)) return null;
    console.info('[SwarmOrchestrator] Using Pro Core (Browser Session)');
    const resposta = await motor.sendMessage({ prompt });
    if (resposta.success && resposta.text) return resposta.text.trim();
    console.warn('[SwarmOrchestrator] Pro Core failed, falling back to API Key.');
  } catch (e) {
    console.warn('[SwarmOrchestrator] Pro Core error:', e.message);
  }
  return null;
}

function lerRespostaEmJson(resposta, resolve, reject) {
  let dados = '';
  resposta.on('data', (pedaco) => { dados += pedaco; });
  resposta.on('end', () => {
    try {
      resolve({ json: JSON.parse(dados), status: resposta.statusCode });
    } catch (e) {
      reject(new Error(`Parse error [${resposta.statusCode}]`));
    }
  });
}

function pedirAoModelo(apiKey, corpo, { model, api }) {
  const url = new URL(`https://generativelanguage.googleapis.com/${api}/models/${model}:generateContent?key=${apiKey}`);
  return new Promise((resolve, reject) => {
    const opcoes = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(corpo) },
    };
    const requisicao = https.request(opcoes, (resposta) => lerRespostaEmJson(resposta, resolve, reject));
    requisicao.on('error', reject);
    requisicao.write(corpo);
    requisicao.end();
  });
}

function textoDaResposta(json) {
  return json.candidates?.[0]?.content?.parts?.[0]?.text;
}

async function tentarUmModelo(apiKey, corpo, modelo) {
  try {
    const resultado = await pedirAoModelo(apiKey, corpo, modelo);
    if (resultado.json.error) {
      console.warn(`[SwarmOrchestrator] ${modelo.model} [${resultado.status}]: ${resultado.json.error.message?.substring(0, LETRAS_DO_AVISO)}`);
      return { parar: STATUS_QUE_ENCERRAM_A_BUSCA.includes(resultado.status) };
    }
    const texto = textoDaResposta(resultado.json);
    return texto ? { achou: true, texto: texto.trim() } : {};
  } catch (e) {
    console.warn(`[SwarmOrchestrator] ${modelo.model} failed: ${e.message.substring(0, LETRAS_DO_AVISO)}`);
    return {};
  }
}

async function tentarPelaApi(apiKey, prompt) {
  const corpo = corpoDoPedido(prompt);
  for (const modelo of MODELOS_DA_API) {
    const resposta = await tentarUmModelo(apiKey, corpo, modelo);
    if (resposta.parar) break;
    if (resposta.achou) return resposta.texto;
  }
  throw new Error('Intent detection: all models failed');
}

async function gerarTextoComGemini(apiKey, prompt) {
  const dosNavegador = await tentarPelaSessaoDoNavegador(prompt);
  if (dosNavegador !== null) return dosNavegador;
  return tentarPelaApi(apiKey, prompt);
}

module.exports = { gerarTextoComGemini };
