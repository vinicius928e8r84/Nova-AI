const fs = require('fs');
const { ipcMain } = require('electron');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { analyzeUserGraph, getUserContext } = require('./services/user-profile-manager');
const {
  getMemoryPath, getUserProfilePath, getDashboardSettingsPath, getHistoryPath, getHistorySettingsPath,
  getContactsPath, getNotesPath, getTasksPath, getSecretKeyPath, getChatsPath,
} = require('./main.caminhos');

const MODELO_DO_PAINEL = 'gemini-3.8-flash';
const CIDADE_PADRAO_DO_PAINEL = 'Pakistan';
const GRAVACOES_ENTRE_ANALISES_DO_PERFIL = 10;
const MENSAGENS_PADRAO_DO_RESUMO = 5;
const LETRAS_DO_TITULO_DA_NOTA = 40;
const LETRAS_DO_AVISO_DA_NOTA = 50;

const lerJson = (arquivo) => JSON.parse(fs.readFileSync(arquivo, 'utf8'));
const listaVazia = () => [];
const objetoVazio = () => ({});
const chaveDoGeminiNoArquivo = (dados) => dados.apiKey || dados.geminiKey || process.env.GEMINI_API_KEY;

function criarLeitor(caminho, semArquivo, noErro) {
  return async function ler() {
    try {
      const arquivo = caminho();
      return fs.existsSync(arquivo) ? lerJson(arquivo) : semArquivo();
    } catch (erro) {
      return noErro();
    }
  };
}

function criarGravador(caminho) {
  return async function gravar(evento, valor) {
    try {
      fs.writeFileSync(caminho(), JSON.stringify(valor, null, 2));
      return true;
    } catch (erro) {
      return false;
    }
  };
}

function criarApagador(caminho) {
  return async function apagar() {
    try {
      const arquivo = caminho();
      if (fs.existsSync(arquivo)) fs.unlinkSync(arquivo);
      return true;
    } catch (erro) {
      return false;
    }
  };
}

const painelPadrao = () => ({ interests: ['Tech', 'Pakistan', 'Global Economy'], refreshInterval: 3600 });
const painelPadraoNaFalha = () => ({ interests: [], refreshInterval: 3600 });
const configuracoesPadraoDoHistorico = () => ({ maxContextMessages: 20, storeHistory: true });

const lerMemorias = criarLeitor(getMemoryPath, listaVazia, listaVazia);
const gravarMemorias = criarGravador(getMemoryPath);
const lerPerfilDoUsuario = criarLeitor(getUserProfilePath, objetoVazio, objetoVazio);
const gravarPerfilDoUsuario = criarGravador(getUserProfilePath);
const lerConfiguracoesDoPainel = criarLeitor(getDashboardSettingsPath, painelPadrao, painelPadraoNaFalha);
const gravarConfiguracoesDoPainel = criarGravador(getDashboardSettingsPath);
const lerHistorico = criarLeitor(getHistoryPath, listaVazia, listaVazia);
const gravarHistorico = criarGravador(getHistoryPath);
const apagarHistorico = criarApagador(getHistoryPath);
const lerConfiguracoesDoHistorico = criarLeitor(getHistorySettingsPath, configuracoesPadraoDoHistorico, configuracoesPadraoDoHistorico);
const gravarConfiguracoesDoHistorico = criarGravador(getHistorySettingsPath);
const lerContatos = criarLeitor(getContactsPath, listaVazia, listaVazia);
const gravarContatos = criarGravador(getContactsPath);
const lerNotas = criarLeitor(getNotesPath, listaVazia, listaVazia);
const gravarNotas = criarGravador(getNotesPath);
const lerTarefas = criarLeitor(getTasksPath, listaVazia, listaVazia);
const gravarTarefas = criarGravador(getTasksPath);
const apagarMemoriasDeLongoPrazo = criarApagador(getMemoryPath);

function pedidoDeNoticiasDoPainel(interesses, cidade) {
  const assuntos = interesses.join(', ');
  const lugar = cidade || CIDADE_PADRAO_DO_PAINEL;
  return `Search for top 5 news headlines for: ${assuntos} in ${lugar}. Also get weather. Respond in ENGLISH and return JSON: {"headlines": [...], "weather": {"today": "...", "tomorrow": "...", "dayAfter": "..."}}`;
}

function pedirNoticiasAoGemini(apiKey, interesses, cidade) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: MODELO_DO_PAINEL,
    tools: [{ googleSearch: {} }],
  }, { apiVersion: 'v1beta' });
  return model.generateContent(pedidoDeNoticiasDoPainel(interesses, cidade));
}

async function buscarDadosDoPainel(evento, { location, interests }) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('API Key missing');
    const resultado = await pedirNoticiasAoGemini(apiKey, interests, location);
    const texto = resultado.response.text();
    const json = texto.match(/\{[\s\S]*\}/);
    return json ? JSON.parse(json[0]) : { headlines: ['Error parsing data'], weather: { today: 'N/A' } };
  } catch (erro) {
    return { headlines: [`Error: ${erro.message}`], weather: { today: 'Error ⚠️' } };
  }
}

function conversaDoHistoricoAntigo() {
  const arquivo = getHistoryPath();
  if (!fs.existsSync(arquivo)) return [];
  const mensagens = lerJson(arquivo);
  if (!mensagens || mensagens.length === 0) return [];
  return [{ id: 'legacy-history', title: 'Chat Legado', messages: mensagens, timestamp: Date.now(), model: 'Claude 4.5 Sonnet' }];
}

async function lerConversas() {
  try {
    const arquivo = getChatsPath();
    return fs.existsSync(arquivo) ? lerJson(arquivo) : conversaDoHistoricoAntigo();
  } catch (erro) {
    return [];
  }
}

function aprenderComAsConversas(chats) {
  const arquivo = getSecretKeyPath();
  if (!fs.existsSync(arquivo)) return;
  const apiKey = chaveDoGeminiNoArquivo(lerJson(arquivo));
  if (apiKey) analyzeUserGraph(apiKey, chats).catch((erro) => console.error('[Continuous Learning] Sync error:', erro));
}

let gravacoesDeConversas = 0;

async function gravarConversas(evento, chats) {
  try {
    fs.writeFileSync(getChatsPath(), JSON.stringify(chats, null, 2));
    gravacoesDeConversas++;
    if (gravacoesDeConversas % GRAVACOES_ENTRE_ANALISES_DO_PERFIL === 0) aprenderComAsConversas(chats);
    return true;
  } catch (erro) {
    return false;
  }
}

const lerContextoDoUsuario = () => getUserContext();

async function sincronizarContextoDoUsuario(evento, chats) {
  try {
    const arquivo = getSecretKeyPath();
    const apiKey = fs.existsSync(arquivo) ? chaveDoGeminiNoArquivo(lerJson(arquivo)) : process.env.GEMINI_API_KEY;
    return await analyzeUserGraph(apiKey, chats);
  } catch (erro) {
    return null;
  }
}

function notasSalvas(arquivo) {
  if (!fs.existsSync(arquivo)) return [];
  try {
    return lerJson(arquivo);
  } catch (erro) {
    return [];
  }
}

function tituloDaNota(texto) {
  return texto.length > LETRAS_DO_TITULO_DA_NOTA ? texto.substring(0, LETRAS_DO_TITULO_DA_NOTA) + '...' : texto;
}

function montarNotaRapida(texto, timestamp) {
  return {
    id: `qn_${Date.now()}`,
    title: tituloDaNota(texto),
    content: texto,
    timestamp: timestamp || Date.now(),
    createdAt: new Date().toISOString(),
    source: 'whatsapp',
  };
}

async function guardarNotaRapida(evento, { text, timestamp }) {
  try {
    const arquivo = getNotesPath();
    const notas = notasSalvas(arquivo);
    const nota = montarNotaRapida(text, timestamp);
    notas.unshift(nota);
    fs.writeFileSync(arquivo, JSON.stringify(notas, null, 2));
    console.info('[Main] Quick note saved via WhatsApp:', text.substring(0, LETRAS_DO_AVISO_DA_NOTA));
    return { success: true, note: nota };
  } catch (erro) {
    console.error('[Main] save-quick-note error:', erro);
    return { success: false, error: erro.message };
  }
}

async function guardarInsight(evento, { content, category }) {
  try {
    const arquivo = getMemoryPath();
    const memorias = fs.existsSync(arquivo) ? lerJson(arquivo) : [];
    memorias.push({ id: Date.now().toString(), content, category, timestamp: Date.now() });
    fs.writeFileSync(arquivo, JSON.stringify(memorias, null, 2));
    return true;
  } catch (erro) {
    return false;
  }
}

async function lerInsights(evento, busca) {
  try {
    const arquivo = getMemoryPath();
    if (!fs.existsSync(arquivo)) return [];
    const memorias = lerJson(arquivo);
    if (!busca) return memorias;
    return memorias.filter((memoria) => memoria.content.toLowerCase().includes(busca.toLowerCase()));
  } catch (erro) {
    return [];
  }
}

const linhaDoResumo = (mensagem) => `${mensagem.role === 'user' ? 'User' : 'Nova'}: ${mensagem.text}`;

async function resumirConversaAnterior(evento, limite) {
  try {
    const arquivo = getHistoryPath();
    if (!fs.existsSync(arquivo)) return 'No previous history found.';
    const ultimas = lerJson(arquivo).slice(-(limite || MENSAGENS_PADRAO_DO_RESUMO));
    return ultimas.map(linhaDoResumo).join('\n');
  } catch (erro) {
    return 'Error recalling history.';
  }
}

function registrarMemoriasPerfilEPainel() {
  ipcMain.handle('load-memories', lerMemorias);
  ipcMain.handle('save-memories', gravarMemorias);
  ipcMain.handle('load-user-profile', lerPerfilDoUsuario);
  ipcMain.handle('save-user-profile', gravarPerfilDoUsuario);
  ipcMain.handle('load-dashboard-settings', lerConfiguracoesDoPainel);
  ipcMain.handle('save-dashboard-settings', gravarConfiguracoesDoPainel);
  ipcMain.handle('fetch-dashboard-data', buscarDadosDoPainel);
}

function registrarHistoricoEConversas() {
  ipcMain.handle('load-history', lerHistorico);
  ipcMain.handle('save-history', gravarHistorico);
  ipcMain.handle('clear-history', apagarHistorico);
  ipcMain.handle('load-chats', lerConversas);
  ipcMain.handle('save-chats', gravarConversas);
  ipcMain.handle('get-user-context', lerContextoDoUsuario);
  ipcMain.handle('sync-user-context', sincronizarContextoDoUsuario);
  ipcMain.handle('load-history-settings', lerConfiguracoesDoHistorico);
  ipcMain.handle('save-history-settings', gravarConfiguracoesDoHistorico);
}

function registrarContatosNotasETarefas() {
  ipcMain.handle('load-contacts', lerContatos);
  ipcMain.handle('save-contacts', gravarContatos);
  ipcMain.handle('load-notes', lerNotas);
  ipcMain.handle('save-notes', gravarNotas);
  ipcMain.handle('save-quick-note', guardarNotaRapida);
  ipcMain.handle('load-tasks', lerTarefas);
  ipcMain.handle('save-tasks', gravarTarefas);
}

function registrarMemoriaDeLongoPrazo() {
  ipcMain.handle('ltm:save-insight', guardarInsight);
  ipcMain.handle('ltm:get-insights', lerInsights);
  ipcMain.handle('ltm:clear-all', apagarMemoriasDeLongoPrazo);
  ipcMain.handle('chat:get-recall-summary', resumirConversaAnterior);
}

function registrarDados() {
  registrarMemoriasPerfilEPainel();
  registrarHistoricoEConversas();
  registrarContatosNotasETarefas();
  registrarMemoriaDeLongoPrazo();
}

module.exports = { registrarDados };
