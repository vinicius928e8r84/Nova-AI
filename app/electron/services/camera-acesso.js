'use strict';

const AJUSTES = {
  darwin: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera',
  win32: 'ms-settings:privacy-webcam',
};

const sistemaPodePerguntar = (estado, platform) => estado === 'not-determined' && platform === 'darwin';

async function perguntarAoSistema(systemPreferences) {
  const concedido = await systemPreferences.askForMediaAccess('camera');
  return { success: concedido, estado: concedido ? 'granted' : 'denied' };
}

async function abrirAjustesDaCamera(shell, platform) {
  if (AJUSTES[platform]) await shell.openExternal(AJUSTES[platform]);
}

async function liberar({ systemPreferences, shell, platform }) {
  const estado = systemPreferences.getMediaAccessStatus('camera');
  if (estado === 'granted') return { success: true, estado };
  if (sistemaPodePerguntar(estado, platform)) return perguntarAoSistema(systemPreferences);
  await abrirAjustesDaCamera(shell, platform);
  return { success: false, estado };
}

module.exports = { liberar };
