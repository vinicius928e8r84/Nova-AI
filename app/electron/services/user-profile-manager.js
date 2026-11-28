const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { reunirAmostras } = require('./user-profile-amostras');
let GoogleGenerativeAI;
try {
    GoogleGenerativeAI = require('@google/generative-ai').GoogleGenerativeAI;
} catch(e) {
    console.error('[UserProfileManager] @google/generative-ai not found');
}

const MODELOS = ['gemini-3.8-flash', 'gemini-4-argon'];
const FALHAS_PARA_DESLIGAR = 3;
const INTERVALO_ENTRE_TENTATIVAS = 15 * 60 * 1000;

const arquivoDoContexto = () => path.join(app.getPath('userData'), 'nova_user_context.json');

const montarPrompt = (amostras) => `You are a Psychological & Operations Profiler. Analyze the following user data and extract their persona, language style, and interests.
USER DATA:
${amostras}`;

function avisoDeQuemFalta(apiKey) {
    if (!apiKey) return 'No API key provided for context sync.';
    if (!GoogleGenerativeAI) return 'GoogleGenerativeAI not initialized.';
    return null;
}

const analiseDesligada = () => (global.profileAnalysisFailCount || 0) >= FALHAS_PARA_DESLIGAR;

const tentouHaPouco = () => Date.now() - (global.lastAnalysisAttemptTime || 0) < INTERVALO_ENTRE_TENTATIVAS;

async function perguntarAoModelo(modelName, apiKey, prompt) {
    console.info(`[UserProfileManager] Sync Attempt: ${modelName} (v1beta)`);
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: modelName }, { apiVersion: 'v1beta' });

    const result = await model.generateContent(prompt, { 
        timeout: 30000 
    });

    const response = await result.response;
    return response.text();
}

async function consultarModelos(apiKey, prompt) {
    for (const modelName of MODELOS) {
        try {
            const texto = await perguntarAoModelo(modelName, apiKey, prompt);
            if (texto) return texto;
        } catch (err) {
            console.warn(`[UserProfileManager] ${modelName} failed: ${err.message.split('\n')[0]}`);
            if (err.message.includes('404')) break;
        }
    }
    return null;
}

function gravarContexto(contexto) {
    const limpo = contexto.trim();
    fs.writeFileSync(arquivoDoContexto(), JSON.stringify({
        lastUpdated: Date.now(),
        context: limpo
    }, null, 2));
    console.info('[UserProfileManager] ✓ User profile synced successfully.');
    global.lastAnalysisFailureTime = 0;
    return limpo;
}

function registrarFalha() {
    global.profileAnalysisFailCount = (global.profileAnalysisFailCount || 0) + 1;
    if (global.profileAnalysisFailCount >= FALHAS_PARA_DESLIGAR) {
        console.error('[UserProfileManager] Analysis failed 3 times. DISABLING background tasks for this session.');
    } else {
        console.warn(`[UserProfileManager] Attempt ${global.profileAnalysisFailCount} failed. Retrying later...`);
    }
}

async function sincronizarPerfil(apiKey, chats) {
    const amostras = reunirAmostras(chats);
    if (!amostras || amostras.trim().length === 0) return null;

    const contexto = await consultarModelos(apiKey, montarPrompt(amostras));
    if (!contexto) throw new Error("All models and API versions exhausted.");

    return gravarContexto(contexto);
}

const analyzeUserGraph = async (apiKey, chats = []) => {
    const aviso = avisoDeQuemFalta(apiKey);
    if (aviso) {
        console.warn(`[UserProfileManager] ${aviso}`);
        return null;
    }
    if (analiseDesligada() || tentouHaPouco()) return null;

    global.lastAnalysisAttemptTime = Date.now();

    try {
        return await sincronizarPerfil(apiKey, chats);
    } catch (e) {
        registrarFalha();
    }
    return null;
};

const getUserContext = () => {
    const contextFilePath = arquivoDoContexto();
    if (fs.existsSync(contextFilePath)) {
        try {
            const data = JSON.parse(fs.readFileSync(contextFilePath, 'utf-8'));
            return data.context;
        } catch(e) {}
    }
    return '';
};

module.exports = {
    analyzeUserGraph,
    getUserContext
};
