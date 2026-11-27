'use strict';

const MODEL_ID_MAP = {
    'gemini-pro':      'gemini-3.8-flash',
    'gemini-flash':    'gemini-3.8-flash',
    'gemini-advanced': 'gemini-advanced',
    'gemini-3.8-flash':'gemini-3.8-flash',
    'gemini-4-argon':  'gemini-4-argon',
    
};

const MODELOS_DE_RESERVA = ['gemini-3.8-flash', 'gemini-4-argon'];
const VERSOES_DA_API = ['v1beta', 'v1'];

function tentativasDeEnvio(modelKey) {
    return [modelKey, ...MODELOS_DE_RESERVA].flatMap((modelo) => {
        const apiModelId = MODEL_ID_MAP[modelo] || modelo;
        return VERSOES_DA_API.map(apiVer => ({ apiModelId, apiVer }));
    });
}

function partesDoPedido(prompt, imageBase64, history) {
    const parts = [];
    if (history && history.length > 0) {
        parts.push({ text: `[Conversation Context]\n${contextoDaConversa(history)}\n\n[Current Request]` });
    }
    parts.push({ text: prompt });
    if (imageBase64) {
        parts.push(parteDaImagem(imageBase64));
    }
    return parts;
}

function contextoDaConversa(history) {
    return history.slice(-10).map(h => `${h.role === 'user' ? 'User' : 'Nova'}: ${h.text}`).join('\n');
}

function parteDaImagem(imageBase64) {
    const mimeType = imageBase64.match(/^data:([a-z/]+);base64,/)?.[1] || 'image/png';
    const rawB64   = imageBase64.replace(/^data:[a-z/]+;base64,/, '');
    return { inlineData: { mimeType, data: rawB64 } };
}

function respostaDoGemini(response, apiModelId) {
    const responseParts = partesDaResposta(JSON.parse(response));
    const text = responseParts.map(p => p.text || '').join('') || '';
    const images = responseParts.filter(p => p.inlineData).map(imagemDaParte);
    if (text || images.length > 0) {
        return { success: true, text, images, model: apiModelId };
    }
    return null;
}

function partesDaResposta(parsed) {
    if (parsed.error) {
        throw new Error(parsed.error.message || JSON.stringify(parsed.error));
    }
    return parsed.candidates?.[0]?.content?.parts || [];
}

function imagemDaParte(p) {
    return { mimeType: p.inlineData.mimeType, data: p.inlineData.data };
}

module.exports = { tentativasDeEnvio, partesDoPedido, parteDaImagem, respostaDoGemini };
