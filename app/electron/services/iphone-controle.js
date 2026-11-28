const fs = require('fs');
const path = require('path');
const iosModelo = require('./ios-modelo');
const { ehIphone, executarIdeviceinstaller } = require('./iphone-comando');

const ARQUIVO_DOS_MODELOS = path.join(__dirname, 'iosModels.json');
const ARQUIVO_DAS_CHAVES_DOS_APARELHOS = 'iphone-hosts.json';
const ENDERECO_DA_PONTE = 'http://127.0.0.1:';
const AVISO_MODELO_SO_IPHONE = 'O modelo é aplicável apenas ao iPhone.';
const AVISO_CONSOLE_JA_ABERTO = 'iPhone Console já estava aberto — trazido pra frente.';
const AVISO_CONSOLE_ABERTO = 'Controle do iPhone aberto. Se pedir senha, use a do CatVNC (Ajustes > CatVNC).';
const ESQUEMA_NO_INICIO = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;

const APELIDOS_DOS_PACOTES = {
  'com.whatsapp': 'net.whatsapp.Whatsapp',
  'com.whatsapp.w4b': 'net.whatsapp.Whatsapp',
  'com.instagram.android': 'com.burbn.instagram',
  'com.android.chrome': 'com.apple.mobilesafari',
  'com.facebook.katana': 'com.facebook.Facebook',
  'com.google.android.youtube': 'com.google.ios.youtube',
  'com.tencent.mm': 'com.tencent.xinWeChat',
  'com.zhiliaoapp.musically': 'com.zhiliaoapp.musically',
};

const ATALHOS_DOS_AJUSTES = {
  wifi: { on: 'Nova WiFi On', off: 'Nova WiFi Off' },
  bluetooth: { on: 'Nova BT On', off: 'Nova BT Off' },
};

const recusaDeModeloParaQuemNaoEIphone = () => ({ success: false, error: AVISO_MODELO_SO_IPHONE });
const resultadoDoSsh = (resposta) => (resposta.ok ? { success: true } : { success: false, error: resposta.error });
const executarUiopen = async (servico, argumentos) => resultadoDoSsh(await servico.iosSsh('uiopen ' + argumentos));

function listarModelosDoIphone() {
  try {
    const banco = JSON.parse(fs.readFileSync(ARQUIVO_DOS_MODELOS, 'utf8'));
    return { success: true, models: banco.models || [] };
  } catch (erro) {
    console.error('[novamodel] banco de modelos iOS ausente:', erro.message);
    return { success: false, models: [], error: 'Banco de modelos iOS não encontrado.' };
  }
}

async function aplicarModeloDoIphone(servico, idDoAparelho, productType) {
  if (!ehIphone(idDoAparelho)) return recusaDeModeloParaQuemNaoEIphone();
  if (!iosModelo.isValidProductType(productType)) return { success: false, error: 'productType inválido.' };
  const banco = servico.getIosModels();
  const achado = banco.success ? iosModelo.findModel(banco.models, productType) : null;
  if (banco.success && !achado) return { success: false, error: `Modelo "${productType}" não está no banco iOS.` };
  const resposta = await iosModelo.applyModel((comando) => servico.iosSsh(comando), productType);
  if (!resposta.success) return resposta;
  return { success: true, applied: { productType, name: achado ? achado.name : productType } };
}

async function limparModeloDoIphone(servico, idDoAparelho) {
  if (!ehIphone(idDoAparelho)) return recusaDeModeloParaQuemNaoEIphone();
  return iosModelo.clearModel((comando) => servico.iosSsh(comando));
}

async function lerModeloDoIphone(servico, idDoAparelho) {
  if (!ehIphone(idDoAparelho)) return recusaDeModeloParaQuemNaoEIphone();
  return iosModelo.getModel((comando) => servico.iosSsh(comando));
}

async function listarIphones() {
  try {
    const ferramentas = require('./ios-tools');
    if (!ferramentas.has('idevice_id') || !ferramentas.has('ideviceinfo')) return [];
    return await require('./ios-devices').listar();
  } catch (erro) {
    return [];
  }
}

function iphonePreparado(pastaDoServico, udid) {
  try {
    const arquivo = path.join(pastaDoServico, ARQUIVO_DAS_CHAVES_DOS_APARELHOS);
    if (!fs.existsSync(arquivo)) return false;
    const chaves = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
    return !!(chaves && chaves[udid]);
  } catch (erro) {
    return false;
  }
}

function janelasDoConsole(servico) {
  if (!servico.iosConsoleWindows) servico.iosConsoleWindows = new Map();
  return servico.iosConsoleWindows;
}

const opcoesDaJanelaDoConsole = () => ({
  width: 1100, height: 820, title: 'iPhone Console', backgroundColor: '#050a10',
  webPreferences: { contextIsolation: true, nodeIntegration: false },
});

async function abrirConsoleDoIphone(servico, idDoAparelho) {
  try {
    const { BrowserWindow } = require('electron');
    const ponte = require('./ios-bridge');
    if (!ponte.isRunning || !ponte.isRunning()) ponte.start();
    const existente = janelasDoConsole(servico).get(idDoAparelho);
    if (existente && !existente.isDestroyed()) {
      existente.focus();
      return { success: true, message: AVISO_CONSOLE_JA_ABERTO };
    }
    const janela = new BrowserWindow(opcoesDaJanelaDoConsole());
    janela.loadURL(ENDERECO_DA_PONTE + ponte.PORT + '/');
    servico.iosConsoleWindows.set(idDoAparelho, janela);
    janela.on('closed', () => { servico.iosConsoleWindows.delete(idDoAparelho); });
    return { success: true, message: AVISO_CONSOLE_ABERTO };
  } catch (erro) {
    return { success: false, error: erro.message };
  }
}

function fecharSemFalhar(janela) {
  try {
    janela.close();
  } catch (erro) {}
}

async function fecharConsoleDoIphone(servico, idDoAparelho) {
  const janela = servico.iosConsoleWindows && servico.iosConsoleWindows.get(idDoAparelho);
  if (janela && !janela.isDestroyed()) fecharSemFalhar(janela);
  return { success: true };
}

function appsDaLista(saida) {
  return saida.split('\n')
    .filter((linha) => linha.trim() && !linha.startsWith('CFBundleIdentifier'))
    .map((linha) => linha.split(',').map((campo) => campo.trim().replace(/^"|"$/g, '')))
    .filter((campos) => campos[0])
    .map((campos) => ({ packageName: campos[0], name: campos[2] || campos[0] }));
}

async function listarAppsDoIphone() {
  const resposta = await executarIdeviceinstaller(['list']);
  if (!resposta.ok && !resposta.stdout) return { success: false, error: resposta.error, apps: [] };
  return { success: true, apps: appsDaLista(resposta.stdout) };
}

const abrirAppDoIphone = (servico, pacote) => executarUiopen(servico, '--bundleid ' + JSON.stringify(String(pacote)));
const desinstalarAppDoIphone = async (servico, pacote) => resultadoDoSsh(await executarIdeviceinstaller(['uninstall', String(pacote)]));

const ACOES_DO_APP = new Map([
  ['list', listarAppsDoIphone],
  ['launch', abrirAppDoIphone],
  ['open', abrirAppDoIphone],
  ['start', abrirAppDoIphone],
  ['uninstall', desinstalarAppDoIphone],
  ['remove', desinstalarAppDoIphone],
]);

async function controlarAppDoIphone(servico, pacote, acao) {
  const nomeDaAcao = String(acao || '').toLowerCase();
  const executar = ACOES_DO_APP.get(nomeDaAcao);
  if (!executar) return { success: false, error: 'Ação não suportada no iOS: ' + nomeDaAcao };
  return executar(servico, APELIDOS_DOS_PACOTES[String(pacote)] || pacote);
}

function enderecoParaAbrir(url, busca) {
  let alvo = String(url || '');
  if (!alvo && busca) alvo = 'https://www.google.com/search?q=' + encodeURIComponent(busca);
  if (alvo && !ESQUEMA_NO_INICIO.test(alvo)) alvo = 'https://' + alvo;
  return alvo;
}

async function abrirEnderecoNoIphone(servico, url, busca) {
  const alvo = enderecoParaAbrir(url, busca);
  if (!alvo) return { success: false, error: 'Sem URL.' };
  return executarUiopen(servico, JSON.stringify(alvo));
}

async function alternarAjusteDoIphone(servico, ajuste, ligar) {
  const nomes = ATALHOS_DOS_AJUSTES[String(ajuste).toLowerCase()];
  if (!nomes) return { success: false, error: 'Unsupported setting.' };
  const endereco = 'shortcuts://run-shortcut?name=' + encodeURIComponent(ligar ? nomes.on : nomes.off);
  return executarUiopen(servico, JSON.stringify(endereco));
}

module.exports = {
  listarModelosDoIphone, aplicarModeloDoIphone, limparModeloDoIphone, lerModeloDoIphone, listarIphones, iphonePreparado,
  abrirConsoleDoIphone, fecharConsoleDoIphone, controlarAppDoIphone, abrirEnderecoNoIphone, alternarAjusteDoIphone,
};
