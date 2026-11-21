const fs = require('fs');
const path = require('path');
const { app } = require('electron');
let GoogleGenerativeAI;
try {
    GoogleGenerativeAI = require('@google/generative-ai').GoogleGenerativeAI;
} catch(e) {
    console.error('[UserProfileManager] @google/generative-ai not found');
}

/**
 * Strips HTML from text
 */
const stripHtml = (html) => {
    return (html || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
};

const LIMITE_DA_AMOSTRA = 50000;
const CONVERSAS_NA_AMOSTRA = 5;
const ATIVIDADES_NA_AMOSTRA = 100;
const MODELOS_DO_PERFIL = ['gemini-3.8-flash', 'gemini-4-argon'];
const FALHAS_ATE_DESLIGAR = 3;
const ESPERA_ENTRE_TENTATIVAS = 15 * 60 * 1000;

const caminhoDoContexto = () => path.join(app.getPath('userData'), 'nova_user_context.json');

const autorDaMensagem = mensagem => (mensagem.role === 'user' ? 'User' : 'NOVA');

const amostraDaConversa = chat => {
    const chatText = (chat.messages || []).map(m => `${autorDaMensagem(m)}: ${m.text}`).join('\n');
    return `--- RECENT CHAT ---\n${chatText}\n`;
};

const amostrasDasConversas = chats => (Array.isArray(chats) ? chats.slice(0, CONVERSAS_NA_AMOSTRA).map(amostraDaConversa) : []);

const caminhoDoCofre = () => [
    path.join(path.dirname(app.getPath('exe')), 'Nova_Vault', 'MyActivity.json'),
    path.join(__dirname, '..', '..', 'Nova_Vault', 'MyActivity.json'),
].find(caminho => fs.existsSync(caminho)) || null;

const amostraDaAtividade = entry => {
    const title = entry.title || '';
    const htmlChunks = (entry.safeHtmlItem || []).map(h => stripHtml(h.html)).join(' ');
    const temConteudo = htmlChunks.length > 0 || title.length > 0;
    return temConteudo ? `--- VAULT MEMORY ---\n${title}\n${htmlChunks.substring(0, 300)}` : null;
};

const juntarAmostrasDoCofre = (amostras) => {
    const jsonPath = caminhoDoCofre();
    if (!jsonPath) return;
    try {
        JSON.parse(fs.readFileSync(jsonPath, 'utf8')).slice(0, ATIVIDADES_NA_AMOSTRA).forEach(entry => {
            const amostra = amostraDaAtividade(entry);
            if (amostra) amostras.push(amostra);
        });
    } catch(e) {
        console.error('[UserProfileManager] Failed to read MyActivity.json', e);
    }
};

const gatherMemorySamples = (chats = []) => {
    const amostras = amostrasDasConversas(chats);
    juntarAmostrasDoCofre(amostras);
    return amostras.join('\n\n').substring(0, LIMITE_DA_AMOSTRA);
};

const temComoAnalisar = (apiKey) => {
    if (!apiKey) {
        console.warn('[UserProfileManager] No API key provided for context sync.');
        return false;
    }
    if (!GoogleGenerativeAI) {
      console.warn('[UserProfileManager] GoogleGenerativeAI not initialized.');
      return false;
    }
    return true;
};

const falhasDaAnalise = () => global.profileAnalysisFailCount || 0;
const analiseDesligada = () => falhasDaAnalise() >= FALHAS_ATE_DESLIGAR;
const analiseRecente = () => Date.now() - (global.lastAnalysisAttemptTime || 0) < ESPERA_ENTRE_TENTATIVAS;

const promptDoPerfil = sampledData => `You are a Psychological & Operations Profiler. Analyze the following user data and extract their persona, language style, and interests.
USER DATA:
${sampledData}`;

const perfilDoModelo = async (apiKey, modelName, prompt) => {
    console.info(`[UserProfileManager] Sync Attempt: ${modelName} (v1beta)`);
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: modelName }, { apiVersion: 'v1beta' });
    const result = await model.generateContent(prompt, { timeout: 30000 });
    const response = await result.response;
    return response.text();
};

const primeiroPerfilDosModelos = async (apiKey, prompt) => {
    for (const modelName of MODELOS_DO_PERFIL) {
        try {
            const profileContext = await perfilDoModelo(apiKey, modelName, prompt);
            if (profileContext) return profileContext;
        } catch (err) {
            console.warn(`[UserProfileManager] ${modelName} failed: ${err.message.split('\n')[0]}`);
            if (err.message.includes('404')) return null;
        }
    }
    return null;
};

const gravarPerfil = (contextFilePath, profileContext) => {
    fs.writeFileSync(contextFilePath, JSON.stringify({
        lastUpdated: Date.now(),
        context: profileContext.trim()
    }, null, 2));
    console.info('[UserProfileManager] ✓ User profile synced successfully.');
    global.lastAnalysisFailureTime = 0;
    return profileContext.trim();
};

const sincronizarPerfil = async (apiKey, chats, contextFilePath) => {
    const sampledData = gatherMemorySamples(chats);
    if (!sampledData.trim()) return null;
    const profileContext = await primeiroPerfilDosModelos(apiKey, promptDoPerfil(sampledData));
    if (!profileContext) throw new Error("All models and API versions exhausted.");
    return gravarPerfil(contextFilePath, profileContext);
};

const contarFalha = () => {
    global.profileAnalysisFailCount = falhasDaAnalise() + 1;
    if (analiseDesligada()) {
        console.error('[UserProfileManager] Analysis failed 3 times. DISABLING background tasks for this session.');
    } else {
        console.warn(`[UserProfileManager] Attempt ${global.profileAnalysisFailCount} failed. Retrying later...`);
    }
};

const analyzeUserGraph = async (apiKey, chats = []) => {
    if (!temComoAnalisar(apiKey)) return null;
    const contextFilePath = caminhoDoContexto();
    if (analiseDesligada() || analiseRecente()) return null;
    global.lastAnalysisAttemptTime = Date.now();
    try {
        return await sincronizarPerfil(apiKey, chats, contextFilePath);
    } catch (e) {
        contarFalha();
    }
    return null;
};

/**
 * Retrieves the cached context from disk
 */
const getUserContext = () => {
    const contextFilePath = caminhoDoContexto();
    if (!fs.existsSync(contextFilePath)) return '';
    try {
        return JSON.parse(fs.readFileSync(contextFilePath, 'utf-8')).context;
    } catch(e) {
        return '';
    }
};

module.exports = {
    analyzeUserGraph,
    getUserContext
};
