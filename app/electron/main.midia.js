const fs = require('fs');
const path = require('path');
const { app, ipcMain, dialog, shell, desktopCapturer } = require('electron');
const RtmpServerService = require('./services/rtmp-server');
const toolPaths = require('./services/tool-paths');

const EXTENSAO_PADRAO_DA_GRAVACAO = 'mp4';
const LARGURA_MAXIMA_DA_CAPTURA = 1024;
const MINIATURA_DAS_TELAS = { width: 320, height: 180 };
const PREFIXO_DE_CAMERA_SEM_DRIVER = 'NO_DRIVER:';
const GUIA_DO_DRIVER_DA_CAMERA = 'https://github.com/CatxFish/obs-virtual-cam/releases/tag/2.0.4';
const SERVICO_NAO_INICIADO = 'Service not initialized';

let contexto = null;

const camera = () => contexto.cameraVirtual();
const falhaDoServico = (erro) => ({ success: false, error: erro.message });

function caminhoDoWebviewBridge(evento) {
  evento.returnValue = path.join(__dirname, 'webview-bridge.js');
}

function caminhoDoPreloadFurtivo(evento) {
  evento.returnValue = path.join(__dirname, 'google-stealth-preload.js');
}

function criarPassoDeTransmissao(passo) {
  return async function executarPasso() {
    try {
      await passo();
      return { success: true };
    } catch (err) {
      return falhaDoServico(err);
    }
  };
}

const iniciarTransmissaoRtmp = criarPassoDeTransmissao(() => RtmpServerService.startBroadcast(app.physicalMobileService?.adbPath));
const pararTransmissaoRtmp = criarPassoDeTransmissao(() => RtmpServerService.stopBroadcast());

function receberPedacoDeVideoRtmp(evento, buffer) {
  RtmpServerService.receiveVideoChunk(buffer);
}

const resumirFonteDoGravador = (fonte) => ({ id: fonte.id, name: fonte.name, thumbnail: fonte.thumbnail.toDataURL() });

async function listarFontesDoGravador() {
  try {
    const fontes = await desktopCapturer.getSources({ types: ['window', 'screen'], fetchWindowIcons: true });
    return fontes.map(resumirFonteDoGravador);
  } catch (e) {
    console.error('[Main] get-sources failed:', e);
    return [];
  }
}

function opcoesDoDialogoDaGravacao(extensao) {
  return {
    title: 'Salvar Gravação de Tela',
    defaultPath: path.join(app.getPath('videos'), `Nova_Record_${Date.now()}.${extensao}`),
    filters: [
      { name: 'Video File', extensions: [extensao] },
      { name: 'All Files', extensions: ['*'] },
    ],
  };
}

function argumentosDoRemux(temporario, destino) {
  const base = ['-y', '-i', temporario, '-c', 'copy'];
  return destino.toLowerCase().endsWith('.mp4') ? [...base, '-movflags', '+faststart', destino] : [...base, destino];
}

function remuxarGravacao(ffmpeg, argumentos) {
  const { execFile } = require('child_process');
  console.info('[Main] FFmpeg path for remuxing:', ffmpeg);
  return new Promise((resolve, reject) => {
    execFile(ffmpeg, argumentos, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        console.error('[Main] FFmpeg remuxing error:', error, stderr);
        reject(error);
      } else {
        console.info('[Main] FFmpeg remuxing complete.');
        resolve();
      }
    });
  });
}

const apagarSeExistir = (arquivo) => {
  if (fs.existsSync(arquivo)) fs.unlinkSync(arquivo);
};

function tentarApagar(arquivo) {
  try {
    apagarSeExistir(arquivo);
  } catch (_) {}
}

function gravarDiretoNoDestino(buffer, destino) {
  try {
    fs.writeFileSync(destino, Buffer.from(buffer));
    shell.showItemInFolder(destino);
    return { success: true, filePath: destino, fallback: true };
  } catch (fallbackError) {
    console.error('[Main] Fallback write failed:', fallbackError);
    return null;
  }
}

async function salvarGravacaoDeTela(evento, { buffer, extension }) {
  const temporario = path.join(app.getPath('temp'), `nova_temp_rec_${Date.now()}.webm`);
  let destino = null;
  try {
    fs.writeFileSync(temporario, Buffer.from(buffer));
    const { filePath } = await dialog.showSaveDialog(contexto.janela(), opcoesDoDialogoDaGravacao(extension || EXTENSAO_PADRAO_DA_GRAVACAO));
    if (!filePath) {
      apagarSeExistir(temporario);
      return { success: false, cancelled: true };
    }
    destino = filePath;
    await remuxarGravacao(toolPaths.ffmpeg() || 'ffmpeg', argumentosDoRemux(temporario, filePath));
    apagarSeExistir(temporario);
    shell.showItemInFolder(filePath);
    return { success: true, filePath };
  } catch (e) {
    console.error('[Main] save-recording failed, falling back to direct write:', e);
    const gravadoDireto = destino ? gravarDiretoNoDestino(buffer, destino) : null;
    if (gravadoDireto) return gravadoDireto;
    tentarApagar(temporario);
    return { success: false, error: e.message };
  }
}

function abrirGuiaDoDriverDaCamera() {
  shell.openExternal(GUIA_DO_DRIVER_DA_CAMERA);
  return { success: true };
}

const ACOES_DA_CAMERA_VIRTUAL = new Map([
  ['detect', (cam) => cam.detectDriver()],
  ['list-profiles', (cam) => cam.globalSpoof.listProfiles()],
  ['hijack', (cam, { buffer, settings }) => cam.startHijack(buffer, settings)],
  ['restore', (cam) => cam.stopHijack()],
  ['status', (cam) => cam.getStatus()],
  ['install-driver', (cam) => cam.installDriver()],
  ['install-guide', abrirGuiaDoDriverDaCamera],
]);

function falhaDoComandoDaCamera(err) {
  console.error('[Main:GlobalSpoof] Command failed:', err.message);
  const semDriver = err.message && err.message.startsWith(PREFIXO_DE_CAMERA_SEM_DRIVER);
  return {
    error: semDriver ? err.message.replace('NO_DRIVER: ', '') : err.message,
    noDriver: semDriver,
  };
}

async function controlarCameraVirtual(evento, payload) {
  const cam = camera();
  if (!cam) return { error: 'Virtual Camera Service not initialized' };
  const { action } = payload;
  try {
    const acao = ACOES_DA_CAMERA_VIRTUAL.get(action);
    if (!acao) return { error: `Unsupported action: ${action}` };
    return await acao(cam, payload);
  } catch (err) {
    return falhaDoComandoDaCamera(err);
  }
}

async function atualizarRegionalDoNavegador(regional) {
  try {
    const { browserService } = require('./services/browser-manager');
    if (browserService && typeof browserService.updateRegional === 'function') {
      await browserService.updateRegional(regional);
    }
  } catch (err) {
    console.error('[Main] Failed to update browserService regional:', err.message);
  }
}

async function atualizarRegionalDaCamera(evento, regional) {
  const cam = camera();
  if (!cam) return { success: false, error: SERVICO_NAO_INICIADO };
  try {
    const resultado = await cam.globalSpoof.updateRegional(regional);
    await atualizarRegionalDoNavegador(regional);
    return resultado;
  } catch (err) {
    return falhaDoServico(err);
  }
}

async function atualizarTransformacaoDaCamera(evento, { zoom, rotate, mirror }) {
  const cam = camera();
  if (!cam) return { success: false };
  try {
    cam.globalSpoof.broadcastTransform(zoom, rotate, mirror);
    return { success: true };
  } catch (err) {
    return falhaDoServico(err);
  }
}

async function disfarcarNomeDaCameraNoRegistro() {
  const cam = camera();
  if (!cam) return { success: false, error: SERVICO_NAO_INICIADO };
  try {
    const resultado = await cam.globalSpoof.spoofRegistryName();
    if (resultado.success) cam.globalSpoof.registrySpoofed = true;
    return resultado;
  } catch (err) {
    return falhaDoServico(err);
  }
}

function receberQuadroDaCameraVirtual(evento, arrayBuffer) {
  const cam = camera();
  if (cam) cam.writeChunk(Buffer.from(arrayBuffer));
}

function reduzirCapturaGrande(imagem) {
  const tamanho = imagem.getSize();
  if (tamanho.width <= LARGURA_MAXIMA_DA_CAPTURA) return imagem;
  const escala = LARGURA_MAXIMA_DA_CAPTURA / tamanho.width;
  return imagem.resize({ width: LARGURA_MAXIMA_DA_CAPTURA, height: Math.round(tamanho.height * escala), quality: 'better' });
}

async function tirarCapturaDaTela() {
  try {
    const { screen, desktopCapturer: capturador } = require('electron');
    const { width, height } = screen.getPrimaryDisplay().size;
    const fontes = await capturador.getSources({ types: ['screen'], thumbnailSize: { width, height } });
    if (!fontes || fontes.length === 0) return { success: false, error: 'No screen sources found' };
    const png = reduzirCapturaGrande(fontes[0].thumbnail).toPNG();
    return { success: true, data: png.toString('base64'), mimeType: 'image/png' };
  } catch (e) {
    console.error('[Screenshot] Error:', e.message);
    return { success: false, error: e.message };
  }
}

const descreverTela = (fonte) => ({
  id: fonte.id,
  name: fonte.name,
  thumbnail: fonte.thumbnail.toDataURL(),
  width: fonte.thumbnail.getSize().width,
  height: fonte.thumbnail.getSize().height,
  display_id: fonte.display_id || '',
});

async function listarTelas() {
  try {
    const fontes = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: MINIATURA_DAS_TELAS });
    console.info('[Electron] Screen sources available:', fontes.map((fonte) => `${fonte.id} | ${fonte.name}`));
    return fontes.map(descreverTela);
  } catch (e) {
    console.error('[Electron] get-screen-sources error:', e.message);
    return { error: e.message };
  }
}

function registrarMidia(contextoDoMain) {
  contexto = contextoDoMain;

  ipcMain.on('get-webview-bridge-path', caminhoDoWebviewBridge);
  ipcMain.on('get-stealth-preload-path', caminhoDoPreloadFurtivo);
  ipcMain.handle('rtmp:start-broadcast', iniciarTransmissaoRtmp);
  ipcMain.handle('rtmp:stop-broadcast', pararTransmissaoRtmp);
  ipcMain.on('rtmp:video-chunk', receberPedacoDeVideoRtmp);
  ipcMain.handle('screen-recorder:get-sources', listarFontesDoGravador);
  ipcMain.handle('screen-recorder:save', salvarGravacaoDeTela);
  ipcMain.handle('virtual-cam:control', controlarCameraVirtual);
  ipcMain.handle('virtual-cam:update-regional', atualizarRegionalDaCamera);
  ipcMain.handle('virtual-cam:update-transform', atualizarTransformacaoDaCamera);
  ipcMain.handle('virtual-cam:spoof-registry', disfarcarNomeDaCameraNoRegistro);
  ipcMain.on('virtual-cam:stream-chunk', receberQuadroDaCameraVirtual);
  ipcMain.handle('take-screenshot', tirarCapturaDaTela);
  ipcMain.handle('get-screen-sources', listarTelas);
}

module.exports = { registrarMidia };
