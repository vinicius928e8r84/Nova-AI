const fs = require('fs');
const axios = require('axios');
const { ipcMain } = require('electron');
const {
  getSecretKeyPath, getGroqKeyPath, getOpenRouterKeyPath, getThinkingSettingsPath,
  getGeminiPreferencePath, getChildAgentModelPath, getChildAgentKeyPath, getNovaVoicePath,
  getCustomModelsPath, getGoogleKeyPath, getVisualSettingsPath, getElevenLabsSettingsPath,
  getWaApiKeyPath, syncConfigurationBackup, restoreConfigurationBackup,
} = require('./main.caminhos');

const URL_DOS_MODELOS_DO_OPENROUTER = 'https://openrouter.ai/api/v1/models';
const VOZ_PADRAO_DA_ELEVENLABS = '21m00Tcm4TlvDq8ikWAM';
const MODELO_PADRAO_DO_AGENTE_FILHO = 'gemini-3.8-flash';
const VOZ_PADRAO_DA_NOVA = 'female';

const lerJson = (arquivo) => JSON.parse(fs.readFileSync(arquivo, 'utf8'));
const valorOuPadrao = (valor, padrao) => (valor !== undefined ? valor : padrao);
const sempre = (valor) => () => valor;
const doAmbienteOuNulo = (variavel) => () => process.env[variavel] || null;

function criarLeitor({ caminho, doArquivo, semArquivo, noErro = semArquivo }) {
  return async function ler() {
    try {
      const arquivo = caminho();
      return fs.existsSync(arquivo) ? doArquivo(lerJson(arquivo)) : semArquivo();
    } catch (erro) {
      return noErro(erro);
    }
  };
}

function criarGravador(caminho, montar) {
  return async function gravar(evento, valor) {
    try {
      fs.writeFileSync(caminho(), JSON.stringify(montar(valor), null, 2));
      return true;
    } catch (erro) {
      return false;
    }
  };
}

const comDataDaGravacao = (campo) => (valor) => ({ [campo]: valor, updatedAt: Date.now() });
const comoVeio = (valor) => valor;

const receitaDaChaveDoGemini = {
  caminho: getSecretKeyPath,
  doArquivo: (dados) => dados.apiKey || dados.geminiKey || process.env.GEMINI_API_KEY || null,
  semArquivo: doAmbienteOuNulo('GEMINI_API_KEY'),
};

const lerChaveDoGemini = criarLeitor(receitaDaChaveDoGemini);

function dadosAtuaisDaChaveDoGemini(arquivo) {
  if (!fs.existsSync(arquivo)) return {};
  try {
    return lerJson(arquivo);
  } catch (erro) {
    return {};
  }
}

async function gravarChaveDoGemini(evento, apiKey) {
  try {
    const arquivo = getSecretKeyPath();
    const dados = dadosAtuaisDaChaveDoGemini(arquivo);
    dados.apiKey = apiKey;
    dados.geminiKey = apiKey;
    dados.updatedAt = Date.now();
    fs.writeFileSync(arquivo, JSON.stringify(dados, null, 2));
    return true;
  } catch (erro) {
    return false;
  }
}

const lerChaveDaApi = (caminho, semArquivo) => criarLeitor({
  caminho,
  doArquivo: (dados) => dados.apiKey || null,
  semArquivo,
  noErro: sempre(null),
});

const lerChaveDoGroq = lerChaveDaApi(getGroqKeyPath, doAmbienteOuNulo('GROQ_API_KEY'));
const lerChaveDoOpenRouter = lerChaveDaApi(getOpenRouterKeyPath, doAmbienteOuNulo('OPENROUTER_API_KEY'));
const lerChaveDoGoogle = lerChaveDaApi(getGoogleKeyPath, doAmbienteOuNulo('GOOGLE_API_KEY'));
const lerChaveDaApiDoWhatsApp = lerChaveDaApi(getWaApiKeyPath, sempre(null));

const gravarChaveDoGroq = criarGravador(getGroqKeyPath, comDataDaGravacao('apiKey'));
const gravarChaveDoOpenRouter = criarGravador(getOpenRouterKeyPath, comDataDaGravacao('apiKey'));
const gravarChaveDoGoogle = criarGravador(getGoogleKeyPath, comDataDaGravacao('apiKey'));
const gravarChaveDaApiDoWhatsApp = criarGravador(getWaApiKeyPath, comDataDaGravacao('apiKey'));

async function gravarChaveDoWhatsApp(evento, apiKey) {
  const gravou = await gravarChaveDaApiDoWhatsApp(evento, apiKey);
  if (gravou) console.info('[Main] WhatsApp dedicated API key saved.');
  return gravou;
}

const lerPreferenciaLigadaPorPadrao = (caminho, campo) => criarLeitor({
  caminho,
  doArquivo: (dados) => valorOuPadrao(dados[campo], true),
  semArquivo: sempre(true),
});

const lerRaciocinioLigado = lerPreferenciaLigadaPorPadrao(getThinkingSettingsPath, 'enabled');
const lerVisualLigado = lerPreferenciaLigadaPorPadrao(getVisualSettingsPath, 'enabled');
const gravarRaciocinioLigado = criarGravador(getThinkingSettingsPath, comDataDaGravacao('enabled'));
const gravarVisualLigado = criarGravador(getVisualSettingsPath, comDataDaGravacao('enabled'));

const lerPreferenciaPeloGeminiDireto = criarLeitor({
  caminho: getGeminiPreferencePath,
  doArquivo: (dados) => valorOuPadrao(dados.preferDirect, false),
  semArquivo: sempre(false),
});
const gravarPreferenciaPeloGeminiDireto = criarGravador(getGeminiPreferencePath, comDataDaGravacao('preferDirect'));

const configuracaoPadraoDaElevenLabs = () => ({ apiKey: '', voiceId: VOZ_PADRAO_DA_ELEVENLABS });
const lerConfiguracaoDaElevenLabs = criarLeitor({
  caminho: getElevenLabsSettingsPath,
  doArquivo: comoVeio,
  semArquivo: configuracaoPadraoDaElevenLabs,
});
const gravarConfiguracaoDaElevenLabs = criarGravador(getElevenLabsSettingsPath, comoVeio);

const lerModeloDoAgenteFilho = criarLeitor({
  caminho: getChildAgentModelPath,
  doArquivo: (dados) => dados.model || MODELO_PADRAO_DO_AGENTE_FILHO,
  semArquivo: sempre(MODELO_PADRAO_DO_AGENTE_FILHO),
});
const lerChaveDoAgenteFilho = criarLeitor({
  caminho: getChildAgentKeyPath,
  doArquivo: (dados) => dados.apiKey || '',
  semArquivo: sempre(''),
});
const lerVozDaNova = criarLeitor({
  caminho: getNovaVoicePath,
  doArquivo: (dados) => dados.voice || VOZ_PADRAO_DA_NOVA,
  semArquivo: sempre(VOZ_PADRAO_DA_NOVA),
});
const gravarModeloDoAgenteFilho = criarGravador(getChildAgentModelPath, comDataDaGravacao('model'));
const gravarChaveDoAgenteFilho = criarGravador(getChildAgentKeyPath, comDataDaGravacao('apiKey'));
const gravarVozDaNova = criarGravador(getNovaVoicePath, comDataDaGravacao('voice'));

const modelosPropriosVazios = () => ({ openRouter: [], gemini: [] });
const lerModelosProprios = criarLeitor({
  caminho: getCustomModelsPath,
  doArquivo: comoVeio,
  semArquivo: modelosPropriosVazios,
});
const gravarModelosProprios = criarGravador(getCustomModelsPath, comoVeio);

function chaveParaListarModelos() {
  const arquivo = getOpenRouterKeyPath();
  const doArquivo = fs.existsSync(arquivo) ? lerJson(arquivo).apiKey : undefined;
  return doArquivo || process.env.OPENROUTER_API_KEY;
}

const cabecalhosDoOpenRouter = (chave) => ({
  'Authorization': `Bearer ${chave}`,
  'HTTP-Referer': 'https://nova.ai',
  'X-Title': 'Nova AI',
});

async function listarModelosDoOpenRouter() {
  try {
    const chave = chaveParaListarModelos();
    if (!chave) return { error: 'OpenRouter Key missing' };
    const resposta = await axios.get(URL_DOS_MODELOS_DO_OPENROUTER, { headers: cabecalhosDoOpenRouter(chave) });
    return resposta.data;
  } catch (erro) {
    console.error('[Electron] Error fetching models:', erro.message);
    return { error: erro.message };
  }
}

const edicaoLocal = () => ({ plan: 'pro', status: 'active', edition: 'mac-local', activationRequired: false });
const lerEdicaoLocal = async () => edicaoLocal();
const verificarEdicaoLocal = async () => ({ success: true, ...edicaoLocal() });
const guardarLicenca = async () => true;

async function sincronizarBackupDaConfiguracao(evento, { action }) {
  if (action === 'export') return syncConfigurationBackup();
  if (action === 'import') return restoreConfigurationBackup();
  return { success: false, error: 'Invalid action' };
}

function registrarChaves() {
  ipcMain.handle('get-gemini-token', lerChaveDoGemini);
  ipcMain.handle('save-gemini-token', gravarChaveDoGemini);
  ipcMain.handle('get-groq-token', lerChaveDoGroq);
  ipcMain.handle('save-groq-token', gravarChaveDoGroq);
  ipcMain.handle('get-wa-api-key', lerChaveDaApiDoWhatsApp);
  ipcMain.handle('save-wa-api-key', gravarChaveDoWhatsApp);
  ipcMain.handle('get-openrouter-token', lerChaveDoOpenRouter);
  ipcMain.handle('save-openrouter-token', gravarChaveDoOpenRouter);
  ipcMain.handle('get-google-token', lerChaveDoGoogle);
  ipcMain.handle('save-google-token', gravarChaveDoGoogle);
  ipcMain.handle('get-openrouter-models', listarModelosDoOpenRouter);
  ipcMain.handle('get-child-agent-key', lerChaveDoAgenteFilho);
  ipcMain.handle('save-child-agent-key', gravarChaveDoAgenteFilho);
}

function registrarPreferencias() {
  ipcMain.handle('get-thinking-enabled', lerRaciocinioLigado);
  ipcMain.handle('save-thinking-enabled', gravarRaciocinioLigado);
  ipcMain.handle('get-prefer-direct-gemini', lerPreferenciaPeloGeminiDireto);
  ipcMain.handle('save-prefer-direct-gemini', gravarPreferenciaPeloGeminiDireto);
  ipcMain.handle('get-elevenlabs-settings', lerConfiguracaoDaElevenLabs);
  ipcMain.handle('save-elevenlabs-settings', gravarConfiguracaoDaElevenLabs);
  ipcMain.handle('get-visual-feed-enabled', lerVisualLigado);
  ipcMain.handle('save-visual-feed-enabled', gravarVisualLigado);
  ipcMain.handle('get-child-agent-model', lerModeloDoAgenteFilho);
  ipcMain.handle('save-child-agent-model', gravarModeloDoAgenteFilho);
  ipcMain.handle('get-nova-voice', lerVozDaNova);
  ipcMain.handle('save-nova-voice', gravarVozDaNova);
  ipcMain.handle('get-custom-models', lerModelosProprios);
  ipcMain.handle('save-custom-models', gravarModelosProprios);
}

function registrarLicencaEBackup() {
  ipcMain.handle('license:get-status', lerEdicaoLocal);
  ipcMain.handle('license:verify', verificarEdicaoLocal);
  ipcMain.handle('license:save', guardarLicenca);
  ipcMain.handle('sync-configuration-backup', sincronizarBackupDaConfiguracao);
}

function registrarConfiguracao() {
  registrarChaves();
  registrarPreferencias();
  registrarLicencaEBackup();
}

module.exports = { registrarConfiguracao };
