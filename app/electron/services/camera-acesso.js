'use strict';

const AJUSTES = {
  darwin: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera',
  win32: 'ms-settings:privacy-webcam',
};

async function liberar({ systemPreferences, shell, platform }) {
  const estado = systemPreferences.getMediaAccessStatus('camera');
  if (estado === 'granted') return { success: true, estado };
  if (estado === 'not-determined' && platform === 'darwin') {
    const concedido = await systemPreferences.askForMediaAccess('camera');
    return { success: concedido, estado: concedido ? 'granted' : 'denied' };
  }
  if (AJUSTES[platform]) await shell.openExternal(AJUSTES[platform]);
  return { success: false, estado };
}

module.exports = { liberar };
