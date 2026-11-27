const { app, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const { hasUpdateConfig } = require('./services/paridade-utils');

const ESPERA_DA_BUSCA_NA_ABERTURA = 5000;

const REGISTROS_DO_ATUALIZADOR = {
  info: { nivel: 'info', marcar: (texto) => texto },
  warn: { nivel: 'warn', marcar: (texto) => `WARN: ${texto}` },
  error: { nivel: 'error', marcar: (texto) => `ERROR: ${texto}` },
};

let janelaDoApp = () => null;

function janelaViva() {
  const janela = janelaDoApp();
  return janela && !janela.isDestroyed() ? janela : null;
}

function criarRegistro({ nivel, marcar }) {
  return (texto) => {
    console[nivel](texto);
    const janela = janelaViva();
    if (janela) janela.webContents.send('update-log', marcar(texto));
  };
}

function criarRegistroDoAtualizador() {
  const registros = {};
  for (const [nome, receita] of Object.entries(REGISTROS_DO_ATUALIZADOR)) registros[nome] = criarRegistro(receita);
  return registros;
}

function configurarAtualizador(obterJanela) {
  janelaDoApp = obterJanela;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  if (process.env.NODE_ENV === 'development') {
    autoUpdater.forceDevUpdateConfig = true;
    console.info('FORCE DEV UPDATE CONFIG ENABLED');
  }
  autoUpdater.logger = criarRegistroDoAtualizador();
}

const semFeedDeAtualizacao = () => ({ success: false, message: 'Esta instalação não tem feed de atualização.' });

async function verificarAtualizacao() {
  if (!app.isPackaged) return { success: false, message: 'Bypassed in dev mode' };
  if (!hasUpdateConfig()) return semFeedDeAtualizacao();
  try {
    const resultado = await autoUpdater.checkForUpdates();
    return { success: true, version: resultado?.updateInfo?.version };
  } catch (erro) {
    return { error: erro.message };
  }
}

async function baixarAtualizacao() {
  if (!hasUpdateConfig()) return semFeedDeAtualizacao();
  try {
    await autoUpdater.downloadUpdate();
    return { success: true };
  } catch (erro) {
    return { error: erro.message };
  }
}

async function instalarAtualizacao() {
  if (!hasUpdateConfig()) return semFeedDeAtualizacao();
  autoUpdater.quitAndInstall(false, true);
  return { success: true };
}

async function lerVersaoDoApp() {
  return app.getVersion();
}

function registrarAtualizador() {
  ipcMain.handle('check-for-update', verificarAtualizacao);
  ipcMain.handle('download-update', baixarAtualizacao);
  ipcMain.handle('install-update', instalarAtualizacao);
  ipcMain.handle('get-app-version', lerVersaoDoApp);
}

function enviarParaAJanela(janela, canal, dados) {
  if (janela) janela.webContents.send(canal, dados);
}

function avisarVerificacao() {
  console.info('🔍 [NOVA UPDATE] Checking for updates...');
}

function avisarAtualizacaoDisponivel(janela, info) {
  console.info('🎉 [NOVA UPDATE] Update available:', info.version);
  console.info('   Release Date:', info.releaseDate);
  console.info('   Current Version:', app.getVersion());
  enviarParaAJanela(janela, 'update-available', { version: info.version, releaseDate: info.releaseDate });
}

function avisarSemAtualizacao() {
  console.info('✓ [NOVA UPDATE] No updates available. Current version is latest:', app.getVersion());
}

const emMegabytes = (bytes) => (bytes / 1024 / 1024).toFixed(1);

function avisarProgressoDoDownload(janela, progresso) {
  const percent = Math.round(progresso.percent);
  console.info(`📥 [NOVA UPDATE] Download progress: ${percent}% (${emMegabytes(progresso.transferred)}MB / ${emMegabytes(progresso.total)}MB)`);
  enviarParaAJanela(janela, 'update-download-progress', {
    percent,
    bytesPerSecond: progresso.bytesPerSecond,
    transferred: progresso.transferred,
    total: progresso.total,
  });
}

function avisarDownloadConcluido(janela, info) {
  console.info('✅ [NOVA UPDATE] Update downloaded successfully:', info?.version);
  enviarParaAJanela(janela, 'update-downloaded', { version: info?.version });
}

function avisarErroDoAtualizador(janela, erro) {
  console.error('❌ [NOVA UPDATE ERROR]:', erro.message);
  console.error('Full error details:', erro);
  enviarParaAJanela(janela, 'update-error', { message: erro.message, code: erro.code, stack: erro.stack });
}

function ligarEventosDoAtualizador(janela) {
  autoUpdater.on('checking-for-update', avisarVerificacao);
  autoUpdater.on('update-available', (info) => avisarAtualizacaoDisponivel(janela, info));
  autoUpdater.on('update-not-available', avisarSemAtualizacao);
  autoUpdater.on('download-progress', (progresso) => avisarProgressoDoDownload(janela, progresso));
  autoUpdater.on('update-downloaded', (info) => avisarDownloadConcluido(janela, info));
  autoUpdater.on('error', (erro) => avisarErroDoAtualizador(janela, erro));
}

function buscarAtualizacaoSeHouverFeed() {
  if (!hasUpdateConfig()) return;
  autoUpdater.checkForUpdates().catch((erro) => {
    console.info('[AutoUpdater] Production check failed:', erro.message);
  });
}

function buscarAtualizacaoNaAbertura() {
  if (!app.isPackaged) {
    console.info('✓ [Dev Mode] Auto-Updater strictly bypassed to prevent Code 2 errors.');
    return;
  }
  setTimeout(buscarAtualizacaoSeHouverFeed, ESPERA_DA_BUSCA_NA_ABERTURA);
}

function ligarAtualizador(janela) {
  ligarEventosDoAtualizador(janela);
  buscarAtualizacaoNaAbertura();
}

module.exports = { configurarAtualizador, registrarAtualizador, ligarAtualizador };
