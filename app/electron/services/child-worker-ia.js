'use strict';

const https = require('https');
const { URL } = require('url');

const MODELOS_DO_GROQ = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'gemma2-9b-it', 'llama3-8b-8192'];
const TENTATIVAS_POR_MODELO = 2;
const ESPERA_SEM_DICA_DO_429_EM_S = 15;
const ESPERA_MAXIMA_DO_429_EM_S = 25;
const FOLGA_DO_429_EM_S = 2;
const ESPERA_ENTRE_TENTATIVAS_DE_COTA_EM_MS = 30000;
const TAMANHO_MINIMO_DA_CHAVE_DO_GROQ = 20;
const LIMITE_DA_RESPOSTA_ILEGIVEL = 150;

const DESISTIR_DO_MODELO = Object.freeze({});
const REPETIR_O_MODELO = Object.freeze({ repetir: true });
const CHAVE_RECUSADA = Object.freeze({ chaveRecusada: true });

const esperar = (milissegundos) => new Promise((resolve) => setTimeout(resolve, milissegundos));
const textoDoCandidato = (resposta) => resposta.candidates?.[0]?.content?.parts?.[0]?.text;
const cabecalhosDeJson = (corpo) => ({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(corpo) });

function postar(opcoes, corpo, lerResposta) {
    return new Promise((resolve, reject) => {
        const pedido = https.request(opcoes, (resposta) => lerResposta(resposta, resolve, reject));
        pedido.on('error', reject);
        pedido.write(corpo);
        pedido.end();
    });
}

function jsonDoGemini(texto, status) {
    try {
        const resposta = JSON.parse(texto);
        resposta._httpStatus = status;
        return resposta;
    } catch (erro) {
        throw new Error(`JSON parse failed [${status}]: ${texto.substring(0, LIMITE_DA_RESPOSTA_ILEGIVEL)}`);
    }
}

function lerRespostaDoGemini(resposta, resolve, reject) {
    let dados = '';
    resposta.on('data', (pedaco) => { dados += pedaco.toString(); });
    resposta.on('end', () => {
        try {
            resolve(jsonDoGemini(dados, resposta.statusCode));
        } catch (erro) {
            reject(erro);
        }
    });
    resposta.on('error', reject);
}

function postarNoGemini(url, corpo) {
    const endereco = new URL(url);
    const opcoes = {
        hostname: endereco.hostname,
        path: endereco.pathname + endereco.search,
        method: 'POST',
        headers: cabecalhosDeJson(corpo),
    };
    return postar(opcoes, corpo, lerRespostaDoGemini);
}

function segundosDeEsperaDoGemini(erro) {
    const detalhes = erro.details || [];
    const dica = detalhes.find((detalhe) => detalhe['@type']?.includes('RetryInfo'));
    if (!dica?.retryDelay) return ESPERA_SEM_DICA_DO_429_EM_S;
    return Math.min(parseFloat(dica.retryDelay) + FOLGA_DO_429_EM_S, ESPERA_MAXIMA_DO_429_EM_S);
}

async function esperarACota(agente, modelo, resposta) {
    agente._last429 = true;
    const segundos = segundosDeEsperaDoGemini(resposta.error);
    agente.log('ceo', `⏳ ${modelo} [429] Rate limit. Waiting ${segundos}s...`);
    await esperar(segundos * 1000);
    return REPETIR_O_MODELO;
}

function recusarChave(agente, resposta, status) {
    agente.log('ceo', `❌ AUTH ERROR [HTTP ${status}]: ${String(resposta.error.message).substring(0, 120)}`);
    agente.log('ceo', 'Fix: Settings → API Keys → enter a valid Sub-Agent Key from aistudio.google.com/apikey');
    return CHAVE_RECUSADA;
}

function lerTextoDoGemini(agente, modelo, resposta, status) {
    const texto = textoDoCandidato(resposta);
    if (texto) {
        agente.log('ceo', `✓ Neural Engine: ${modelo}`);
        return { texto: texto.trim() };
    }
    const motivo = resposta.promptFeedback?.blockReason;
    agente.log('ceo', `⚠ ${modelo} [HTTP ${status}] Empty response${motivo ? ` (blocked: ${motivo})` : ''}. Trying next...`);
    return DESISTIR_DO_MODELO;
}

function registrarErroDoGemini(agente, modelo, resposta, status) {
    const erro = resposta.error;
    if (erro.code === 404 || erro.status === 'NOT_FOUND') {
        agente.log('ceo', `⚠ ${modelo} [404] Not available. Trying next...`);
    } else {
        agente.log('ceo', `⚠ ${modelo} [HTTP ${status} / code ${erro.code}]: ${String(erro.message).substring(0, 80)}`);
    }
    return DESISTIR_DO_MODELO;
}

function interpretarRespostaDoGemini(agente, modelo, resposta) {
    const status = resposta._httpStatus || '?';
    const codigo = resposta.error?.code;
    if (codigo === 400 || codigo === 403) return recusarChave(agente, resposta, status);
    if (codigo === 429) return esperarACota(agente, modelo, resposta);
    if (resposta.error) return registrarErroDoGemini(agente, modelo, resposta, status);
    return lerTextoDoGemini(agente, modelo, resposta, status);
}

async function perguntarAoModelo(agente, { model, api }, apiKey, corpo) {
    try {
        const url = `https://generativelanguage.googleapis.com/${api}/models/${model}:generateContent?key=${apiKey}`;
        const resposta = await postarNoGemini(url, corpo);
        return await interpretarRespostaDoGemini(agente, model, resposta);
    } catch (erro) {
        agente.log('ceo', `⚠ ${model} network error: ${String(erro.message).substring(0, 80)}`);
        return DESISTIR_DO_MODELO;
    }
}

async function tentarModelo(agente, candidato, apiKey, corpo) {
    for (let tentativa = 0; tentativa < TENTATIVAS_POR_MODELO; tentativa++) {
        const resultado = await perguntarAoModelo(agente, candidato, apiKey, corpo);
        if (resultado !== REPETIR_O_MODELO) return resultado;
    }
    return DESISTIR_DO_MODELO;
}

function erroDeFimDosModelos(cotaEsgotada) {
    if (cotaEsgotada) return new Error('QUOTA_EXHAUSTED: All Gemini models rate-limited. Try again later.');
    return new Error('ALL_MODELS_404: All Gemini models returned 404. Key may not have access — using Groq.');
}

async function chamarGemini(agente, apiKey, prompt) {
    const corpo = JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 2048 }
    });
    agente._last429 = false;
    for (const candidato of agente.GEMINI_CANDIDATES) {
        const resultado = await tentarModelo(agente, candidato, apiKey, corpo);
        if (resultado.texto !== undefined) return resultado.texto;
        if (resultado === CHAVE_RECUSADA) throw new Error('AUTH_FAILED: Invalid API key. Check Sub-Agent Key in Settings.');
    }
    throw erroDeFimDosModelos(agente._last429);
}

function pedidoDoGroq(groqKey, corpo) {
    return {
        hostname: 'api.groq.com',
        path: '/openai/v1/chat/completions',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}`, 'Content-Length': Buffer.byteLength(corpo) },
    };
}

function lerRespostaDoGroq(resposta, resolve, reject) {
    let dados = '';
    resposta.on('data', (pedaco) => { dados += pedaco; });
    resposta.on('end', () => {
        try {
            resolve({ json: JSON.parse(dados), status: resposta.statusCode });
        } catch (erro) {
            reject(new Error(`Groq parse error [${resposta.statusCode}]`));
        }
    });
}

async function perguntarAoGroq(agente, groqKey, model, prompt) {
    const corpo = JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], max_tokens: 2048, temperature: 0.2 });
    const { json, status } = await postar(pedidoDoGroq(groqKey, corpo), corpo, lerRespostaDoGroq);
    if (json.error) {
        agente.log('ceo', `⚠ Groq ${model} [${status}]: ${json.error.message?.substring(0, 60)}`);
        return null;
    }
    const texto = json.choices?.[0]?.message?.content;
    if (!texto) return null;
    agente.log('ceo', `✓ Groq ${model} (fallback) responding`);
    return texto.trim();
}

async function tentarModeloDoGroq(agente, groqKey, model, prompt) {
    try {
        return await perguntarAoGroq(agente, groqKey, model, prompt);
    } catch (erro) {
        agente.log('ceo', `⚠ Groq ${model} error: ${erro.message.substring(0, 60)}`);
        return null;
    }
}

async function chamarGroq(agente, groqKey, prompt) {
    if (!groqKey || groqKey.length < TAMANHO_MINIMO_DA_CHAVE_DO_GROQ) throw new Error('No Groq key available');
    for (const model of MODELOS_DO_GROQ) {
        const texto = await tentarModeloDoGroq(agente, groqKey, model, prompt);
        if (texto !== null) return texto;
    }
    throw new Error('Groq fallback also failed. Check Groq API key in Settings → Groq Influx Key.');
}

async function deveTentarOGeminiDeNovo(agente, erro, tentativa, maximo) {
    const mensagem = String(erro.message);
    if (mensagem.startsWith('AUTH_FAILED')) {
        agente.log('ceo', '⚡ Gemini auth failed → switching to Groq fallback...');
        return false;
    }
    if (mensagem.startsWith('ALL_MODELS_404')) {
        agente.log('ceo', '⚡ All Gemini models unavailable (404) → trying Groq immediately...');
        return false;
    }
    if (tentativa >= maximo) {
        agente.log('ceo', '⚡ Gemini still limited → trying Groq fallback...');
        return false;
    }
    agente.log('ceo', `⏳ Gemini quota limited. Waiting 30s then retry... (${tentativa}/${maximo})`);
    await esperar(ESPERA_ENTRE_TENTATIVAS_DE_COTA_EM_MS);
    return true;
}

async function escolherIa(agente, { apiKey, groqKey }, prompt, maxAttempts) {
    for (let tentativa = 1; tentativa <= maxAttempts; tentativa++) {
        try {
            return await agente.callGemini(apiKey, prompt);
        } catch (erro) {
            if (!await deveTentarOGeminiDeNovo(agente, erro, tentativa, maxAttempts)) break;
        }
    }
    return agente.callGroq(groqKey, prompt);
}

module.exports = { chamarGemini, chamarGroq, escolherIa };
