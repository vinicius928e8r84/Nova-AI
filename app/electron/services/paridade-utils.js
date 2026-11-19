const fs = require('fs');
const path = require('path');

function hasUpdateConfig(resourcesPath = process.resourcesPath) {
  try {
    return !!resourcesPath && fs.existsSync(path.join(resourcesPath, 'app-update.yml'));
  } catch (_) {
    return false;
  }
}

function edgeTtsBinary(platform, macPython) {
  if (platform === 'darwin') return `"${macPython()}" -m edge_tts`;
  if (platform === 'win32') return 'python -m edge_tts';
  return 'edge-tts';
}

const MAC_BROWSER_KILL_PATTERN = '^/.*/Contents/MacOS/(Google Chrome|Chromium)[^/]* (.* )?--user-data-dir=[^=]*/\\.wwebjs_auth/session-nova-desktop-client( |$)';

function instalacaoPorSistema(platform) {
  if (platform === 'darwin') {
    return 'INSTALL (macOS, runs in background because execute_shell kills after 15 s): .dmg = (hdiutil attach -nobrowse -readonly -mountpoint TMP "ARQ" && ditto TMP/X.app /Applications/X.app; hdiutil detach TMP) >/dev/null 2>&1 &; .pkg = osascript -e \'do shell script "installer -pkg " & quoted form of "ARQ" & " -target /" with administrator privileges\' >/dev/null 2>&1 & (asks the Mac password once; ARQ without single quotes; check with pkgutil --pkgs afterwards).';
  }
  if (platform === 'win32') {
    return 'INSTALL (Windows, keeps running in background after execute_shell\'s 15 s limit): .exe = "ARQ" /S; .msi = msiexec /i ARQ /qn /norestart (asks UAC when needed; check the installed program afterwards).';
  }
  return '';
}

const MAC_CAM_SPOOF_KILL_PATTERN = '^/.*/Contents/MacOS/(Google Chrome|Chromium)[^/]* (.* )?--use-file-for-fake-video-capture=[^=]*/nova_webcam_hijack/';

module.exports = { hasUpdateConfig, edgeTtsBinary, MAC_BROWSER_KILL_PATTERN, MAC_CAM_SPOOF_KILL_PATTERN, instalacaoPorSistema };
