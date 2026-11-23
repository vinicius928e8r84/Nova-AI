const fs = require('fs');
const path = require('path');

function hasUpdateConfig(resourcesPath = process.resourcesPath) {
  try {
    return !!resourcesPath && fs.existsSync(path.join(resourcesPath, 'app-update.yml'));
  } catch (_) {
    return false;
  }
}

function edgeTtsBinary(platform, python) {
  if (platform === 'darwin' || platform === 'win32') return `"${python()}" -m edge_tts`;
  return 'edge-tts';
}

const MAC_BROWSER_KILL_PATTERN = '^/.*/Contents/MacOS/(Google Chrome|Chromium|Microsoft Edge)[^/]* (.* )?--user-data-dir=[^=]*/\\.wwebjs_auth/session-nova-desktop-client( |$)';

const AVISO_DE_PARENTESES = ' Rename ARQ first if its name has parentheses: the Action parser stops at the first closing parenthesis.';

function instalacaoPorSistema(platform) {
  if (platform === 'darwin') {
    return 'INSTALL (macOS, runs in background because execute_shell kills after 15 s): .dmg = { hdiutil attach -nobrowse -readonly -mountpoint "TMP" "ARQ" && ditto "TMP/X.app" "/Applications/X.app"; hdiutil detach "TMP"; } >/dev/null 2>&1 & (check with ls /Applications afterwards) | .pkg = osascript -e \'do shell script "installer -pkg " & quoted form of "ARQ" & " -target /" with administrator privileges\' >/dev/null 2>&1 & (asks the Mac password once; ARQ without single quotes; check with pkgutil --pkgs afterwards).' + AVISO_DE_PARENTESES;
  }
  if (platform === 'win32') {
    return 'INSTALL (Windows, keeps running in background after execute_shell\'s 15 s limit): .exe = "ARQ" /S; .msi = msiexec /i "ARQ" /qn /norestart (asks UAC when needed; check the installed program afterwards).' + AVISO_DE_PARENTESES;
  }
  return '';
}

async function macAntigravityStats(mac) {
  const pid = Number((await mac.run('/usr/bin/pgrep', ['-x', 'Antigravity'])).split('\n')[0]);
  if (!pid) return null;
  const rss = Number((await mac.run('/bin/ps', ['-p', String(pid), '-o', 'rss='])).trim());
  let title = '';
  let responding = true;
  try {
    title = await mac.run('/usr/bin/osascript', ['-e', 'tell application "System Events" to tell process "Antigravity" to return name of front window'], { timeout: 3000 });
  } catch (e) {
    responding = !e.killed;
  }
  return { pid, cpu: 0, memory: Math.round(rss / 1024), responding, title };
}

const MAC_CAM_SPOOF_KILL_PATTERN = '^/.*/Contents/MacOS/(Google Chrome|Chromium)[^/]* (.* )?--use-file-for-fake-video-capture=[^=]*/nova_webcam_hijack/';

module.exports = { hasUpdateConfig, edgeTtsBinary, macAntigravityStats, MAC_BROWSER_KILL_PATTERN, MAC_CAM_SPOOF_KILL_PATTERN, instalacaoPorSistema };
