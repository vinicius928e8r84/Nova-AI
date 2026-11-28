const fs = require('fs');
const path = require('path');
const { app, ipcMain } = require('electron');
const WhatsAppManager = require('./services/whatsapp-manager');
const TelegramManager = require('./services/telegram-manager');
const { getWhatsAppSettingsPath } = require('./main.caminhos');

const TENTATIVAS_DA_ESPERA_PELO_TUNEL = 20;
const MILISSEGUNDOS_ENTRE_TENTATIVAS_DO_TUNEL = 500;
const NOME_DO_TOKEN_DO_CELULAR = 'Default Mobile';
const MOTIVO_DA_LEITURA_QUE_FALHOU = 'state-read-failed';
const ACESSO_REMOTO_PARADO = 'Remote Access Service not running';

let contexto = null;

const getTelegramSettingsPath = () => path.join(app.getPath('userData'), 'telegram_settings.json');

const falha = (erro) => ({ success: false, error: erro.message });
const semGerente = (nome) => ({ success: false, error: `${nome} Manager not initialized` });
const resultadoDoEnvio = (enviou, nome) => (enviou ? { success: true } : { success: false, error: `${nome} client is not ready or message failed to send.` });
const estadoDoGerente = (gerente) => (gerente ? gerente.getState() : null);

const estadoDoWhatsAppDesconectado = (motivo) => ({
  status: 'disconnected', reason: motivo, isReady: false, isInitializing: false, qrCode: null, reconnectAttempts: 0,
});
const estadoDoTelegramDesconectado = (motivo) => ({ status: 'disconnected', reason: motivo, isReady: false, isInitializing: false });

function garantirGerente(Gerente, propriedade) {
  if (contexto[propriedade]) contexto[propriedade].updateMainWindow(contexto.janela);
  else contexto[propriedade] = new Gerente(contexto.janela, app);
  return contexto[propriedade];
}

const garantirWhatsApp = () => garantirGerente(WhatsAppManager, 'whatsapp');
const garantirTelegram = () => garantirGerente(TelegramManager, 'telegram');

function criarLeitorDeEstado(propriedade, estadoDesconectado) {
  return async function lerEstado() {
    try {
      return contexto[propriedade] ? contexto[propriedade].getState() : estadoDesconectado(null);
    } catch (erro) {
      return estadoDesconectado(MOTIVO_DA_LEITURA_QUE_FALHOU);
    }
  };
}

function criarLeitorDePreferencias(caminho) {
  return async function lerPreferencias() {
    try {
      const arquivo = caminho();
      if (fs.existsSync(arquivo)) return JSON.parse(fs.readFileSync(arquivo, 'utf8'));
      return { autoConnect: false };
    } catch (erro) {
      return { autoConnect: false };
    }
  };
}

function criarGravadorDePreferencias(caminho, depoisDeGravar) {
  return async function gravarPreferencias(evento, preferencias) {
    try {
      const arquivo = caminho();
      const atuais = fs.existsSync(arquivo) ? JSON.parse(fs.readFileSync(arquivo, 'utf8')) : {};
      fs.writeFileSync(arquivo, JSON.stringify({ ...atuais, ...(preferencias || {}) }, null, 2));
      depoisDeGravar();
      return true;
    } catch (erro) {
      return false;
    }
  };
}

function criarSaida(propriedade) {
  return async function sair() {
    try {
      if (contexto[propriedade]) await contexto[propriedade].logout();
      return { success: true, state: estadoDoGerente(contexto[propriedade]) };
    } catch (erro) {
      return falha(erro);
    }
  };
}

const lerEstadoDoWhatsApp = criarLeitorDeEstado('whatsapp', estadoDoWhatsAppDesconectado);
const lerEstadoDoTelegram = criarLeitorDeEstado('telegram', estadoDoTelegramDesconectado);
const lerPreferenciasDoWhatsApp = criarLeitorDePreferencias(getWhatsAppSettingsPath);
const lerPreferenciasDoTelegram = criarLeitorDePreferencias(getTelegramSettingsPath);
const gravarPreferenciasDoWhatsApp = criarGravadorDePreferencias(getWhatsAppSettingsPath, () => {});
const gravarPreferenciasDoTelegram = criarGravadorDePreferencias(getTelegramSettingsPath, recarregarPreferenciasDoTelegram);
const sairDoWhatsApp = criarSaida('whatsapp');
const sairDoTelegram = criarSaida('telegram');

function recarregarPreferenciasDoTelegram() {
  if (contexto.telegram) contexto.telegram.loadSettings();
}

async function iniciarWhatsApp() {
  try {
    await garantirWhatsApp().initialize();
    return { success: true, state: contexto.whatsapp.getState() };
  } catch (erro) {
    return falha(erro);
  }
}

async function responderNoWhatsApp(evento, { chatId, message, isMimicry = false, removeSignature = false }) {
  try {
    const gerente = contexto.whatsapp;
    if (!gerente) return semGerente('WhatsApp');
    const enviou = isMimicry
      ? await gerente.sendReplyWithMimicry(chatId, message, !removeSignature)
      : await gerente.sendReply(chatId, message, removeSignature);
    return resultadoDoEnvio(enviou, 'WhatsApp');
  } catch (erro) {
    return falha(erro);
  }
}

const trouxeAsChavesDoTelegram = (argumentos) => argumentos?.apiId && argumentos?.apiHash;

async function iniciarTelegram(evento, argumentos) {
  try {
    const gerente = garantirTelegram();
    if (trouxeAsChavesDoTelegram(argumentos)) {
      return await gerente.initialize({
        apiId: argumentos.apiId, apiHash: argumentos.apiHash, sessionString: argumentos.sessionString || '',
      });
    }
    await gerente.autoConnect();
    return { success: true, state: contexto.telegram.getState() };
  } catch (erro) {
    return falha(erro);
  }
}

async function pedirCodigoPorMensagemAoTelegram(evento, { phone, apiId, apiHash }) {
  try {
    return await garantirTelegram().sendOtpCode({ phone, apiId, apiHash });
  } catch (erro) {
    return falha(erro);
  }
}

async function pedirCodigoPorQrAoTelegram(evento, { apiId, apiHash }) {
  try {
    return await garantirTelegram().sendQrCode({ apiId, apiHash });
  } catch (erro) {
    return falha(erro);
  }
}

async function enviarCodigoAoTelegram(evento, { code }) {
  try {
    if (!contexto.telegram) return semGerente('Telegram');
    return await contexto.telegram.submitOtpCode({ code });
  } catch (erro) {
    return falha(erro);
  }
}

async function enviarSenhaAoTelegram(evento, { password }) {
  try {
    if (!contexto.telegram) return semGerente('Telegram');
    return await contexto.telegram.submitPassword({ password });
  } catch (erro) {
    return falha(erro);
  }
}

async function responderNoTelegram(evento, { chatId, message, removeSignature = false }) {
  try {
    if (!contexto.telegram) return semGerente('Telegram');
    const enviou = await contexto.telegram.sendReply(chatId, message, removeSignature);
    return resultadoDoEnvio(enviou, 'Telegram');
  } catch (erro) {
    return falha(erro);
  }
}

function primeiroTokenAtivo(servico) {
  const ativos = Array.from(servico.tokens.values()).filter(t => t.active);
  return ativos.length > 0 ? ativos[0].token : null;
}

const camposDoQr = (qr) => ({ qrCode: qr.success ? qr.qrCode : null, directUrl: qr.success ? qr.directUrl : null });

async function lerAcessoRemoto() {
  const servico = contexto.acessoRemoto;
  if (!servico) return { isRunning: false };
  const status = servico.getStatus();
  const token = primeiroTokenAtivo(servico) || servico.generateToken(NOME_DO_TOKEN_DO_CELULAR).token;
  const qr = await servico.generateQRCode(token);
  return { ...status, activeToken: token, ...camposDoQr(qr) };
}

async function renovarAcessoRemoto() {
  const servico = contexto.acessoRemoto;
  if (!servico) return { success: false, error: ACESSO_REMOTO_PARADO };
  servico.revogarTodosOsTokens();
  const token = servico.generateToken(NOME_DO_TOKEN_DO_CELULAR).token;
  const status = servico.getStatus();
  const qr = await servico.generateQRCode(token);
  return { success: true, activeToken: token, ...camposDoQr(qr), ...status };
}

async function esperarPeloEnderecoDoTunel() {
  let tentativas = 0;
  while (!contexto.acessoRemoto.publicUrl && tentativas < TENTATIVAS_DA_ESPERA_PELO_TUNEL) {
    await new Promise(resolve => setTimeout(resolve, MILISSEGUNDOS_ENTRE_TENTATIVAS_DO_TUNEL));
    tentativas++;
  }
}

async function reiniciarTunelDoAcessoRemoto() {
  if (!contexto.acessoRemoto) return { success: false, error: ACESSO_REMOTO_PARADO };
  try {
    console.info('[RemoteAccess] Restarting tunnel via IPC...');
    contexto.acessoRemoto.publicUrl = null;
    await contexto.acessoRemoto.startCloudflaredTunnel();
    await esperarPeloEnderecoDoTunel();
    const status = contexto.acessoRemoto.getStatus();
    const token = primeiroTokenAtivo(contexto.acessoRemoto);
    const qr = token ? await contexto.acessoRemoto.generateQRCode(token) : { success: false };
    return { success: true, activeToken: token, ...camposDoQr(qr), ...status };
  } catch (erro) {
    return falha(erro);
  }
}

async function transmitirRespostaAoCelular(evento, { message, timestamp }) {
  if (contexto.acessoRemoto) contexto.acessoRemoto.broadcastToMobile('ai-response', { message, timestamp });
}

async function transmitirPensamentoAoCelular() {
  if (contexto.acessoRemoto) contexto.acessoRemoto.broadcastToMobile('ai-thinking');
}

function registrarWhatsApp() {
  ipcMain.handle('whatsapp-init', iniciarWhatsApp);
  ipcMain.handle('whatsapp-get-state', lerEstadoDoWhatsApp);
  ipcMain.handle('get-whatsapp-settings', lerPreferenciasDoWhatsApp);
  ipcMain.handle('save-whatsapp-settings', gravarPreferenciasDoWhatsApp);
  ipcMain.handle('whatsapp-logout', sairDoWhatsApp);
  ipcMain.handle('whatsapp-send-reply', responderNoWhatsApp);
}

function registrarTelegram() {
  ipcMain.handle('telegram-init', iniciarTelegram);
  ipcMain.handle('telegram-get-state', lerEstadoDoTelegram);
  ipcMain.handle('get-telegram-settings', lerPreferenciasDoTelegram);
  ipcMain.handle('save-telegram-settings', gravarPreferenciasDoTelegram);
  ipcMain.handle('telegram-send-otp', pedirCodigoPorMensagemAoTelegram);
  ipcMain.handle('telegram-send-qr', pedirCodigoPorQrAoTelegram);
  ipcMain.handle('telegram-submit-code', enviarCodigoAoTelegram);
  ipcMain.handle('telegram-submit-password', enviarSenhaAoTelegram);
  ipcMain.handle('telegram-logout', sairDoTelegram);
  ipcMain.handle('telegram-send-reply', responderNoTelegram);
}

function registrarAcessoRemoto() {
  ipcMain.handle('remote-access-status', lerAcessoRemoto);
  ipcMain.handle('remote-access-regenerate', renovarAcessoRemoto);
  ipcMain.handle('remote-access-restart-tunnel', reiniciarTunelDoAcessoRemoto);
  ipcMain.handle('remote-access-broadcast-response', transmitirRespostaAoCelular);
  ipcMain.handle('remote-access-broadcast-thinking', transmitirPensamentoAoCelular);
}

function registrarMensageria(contextoDoMain) {
  contexto = contextoDoMain;
  registrarWhatsApp();
  registrarTelegram();
  registrarAcessoRemoto();
}

module.exports = { registrarMensageria };
