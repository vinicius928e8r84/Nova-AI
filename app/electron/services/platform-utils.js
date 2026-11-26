const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const isLinux = process.platform === 'linux';

function getChromiumCandidateSubpaths() {
    if (isWindows) {
        return [
            path.join('chrome-win64', 'chrome.exe'),
            path.join('chrome-win', 'chrome.exe'),
        ];
    }
    if (isMac) {
        return [
            path.join('chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
            path.join('chrome-mac-x64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
            path.join('chrome-mac', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
            path.join('chrome-mac-arm64', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
            path.join('chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
        ];
    }
    return [
        path.join('chrome-linux', 'chrome'),
    ];
}

function revisaoDoChromium(nomeDaPasta) {
    const revisao = Number(nomeDaPasta.slice('chromium-'.length));
    return Number.isInteger(revisao) ? revisao : -1;
}

function revisoesDoChromiumDaMaiorParaMenor(browsersDir) {
    try {
        return fs.readdirSync(browsersDir)
            .filter((e) => e.startsWith('chromium-'))
            .sort((a, b) => revisaoDoChromium(b) - revisaoDoChromium(a));
    } catch {
        return [];
    }
}

function executavelNaPastaDeNavegadores(browsersDir, candidates) {
    if (!browsersDir || !fs.existsSync(browsersDir)) return null;
    return revisoesDoChromiumDaMaiorParaMenor(browsersDir)
        .flatMap((entry) => candidates.map((sub) => path.join(browsersDir, entry, sub)))
        .find((exePath) => fs.existsSync(exePath)) ?? null;
}

function findBundledChromiumExecutable(searchDirs) {
    const candidates = getChromiumCandidateSubpaths();
    for (const browsersDir of searchDirs) {
        const exePath = executavelNaPastaDeNavegadores(browsersDir, candidates);
        if (exePath) return exePath;
    }
    return null;
}

function primeiroCaminhoExistente(caminhos) {
    return caminhos.filter(Boolean).find((caminho) => fs.existsSync(caminho)) ?? null;
}

function findBundledBinDir() {
    return primeiroCaminhoExistente([
        process.resourcesPath ? path.join(process.resourcesPath, 'bin') : null,
        path.join(__dirname, '..', '..', 'bin'),
    ]);
}

function getDefaultUserAgent() {
    if (isMac) {
        return 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
    }
    if (isLinux) {
        return 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
    }
    return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
}

function execPromise(command, options = {}) {
    return new Promise((resolve, reject) => {
        exec(command, { timeout: 15000, ...options }, (error, stdout, stderr) => {
            if (error) reject(error);
            else resolve(stdout.toString().trim());
        });
    });
}

const MAC_APP_MAP = {
    'notepad': 'TextEdit',
    'textedit': 'TextEdit',
    'calculator': 'Calculator',
    'calc': 'Calculator',
    'paint': 'Preview',
    'preview': 'Preview',
    'chrome': 'Google Chrome',
    'google chrome': 'Google Chrome',
    'firefox': 'Firefox',
    'edge': 'Microsoft Edge',
    'microsoft edge': 'Microsoft Edge',
    'safari': 'Safari',
    'explorer': 'Finder',
    'file explorer': 'Finder',
    'finder': 'Finder',
    'cmd': 'Terminal',
    'command prompt': 'Terminal',
    'terminal': 'Terminal',
    'powershell': 'Terminal',
    'iterm': 'iTerm',
    'task manager': 'Activity Monitor',
    'activity monitor': 'Activity Monitor',
    'word': 'Microsoft Word',
    'microsoft word': 'Microsoft Word',
    'excel': 'Microsoft Excel',
    'microsoft excel': 'Microsoft Excel',
    'powerpoint': 'Microsoft PowerPoint',
    'microsoft powerpoint': 'Microsoft PowerPoint',
    'outlook': 'Microsoft Outlook',
    'onenote': 'Microsoft OneNote',
    'teams': 'Microsoft Teams',
    'microsoft teams': 'Microsoft Teams',
    'vs code': 'Visual Studio Code',
    'vscode': 'Visual Studio Code',
    'visual studio code': 'Visual Studio Code',
    'spotify': 'Spotify',
    'discord': 'Discord',
    'slack': 'Slack',
    'zoom': 'zoom.us',
    'whatsapp': 'WhatsApp',
    'telegram': 'Telegram',
    'obs': 'OBS',
    'obs studio': 'OBS',
    'steam': 'Steam',
    'vlc': 'VLC',
    'gimp': 'GIMP',
    'blender': 'Blender',
};

const MAC_SCHEME_MAP = {
    'settings': 'x-apple.systempreferences:',
    'system settings': 'x-apple.systempreferences:',
    'system preferences': 'x-apple.systempreferences:',
};

async function macOpenApplication(appName) {
    const name=String(appName).toLowerCase().trim();
    const mac=require('./mac-native');
    const args=MAC_SCHEME_MAP[name] ? [MAC_SCHEME_MAP[name]] : ['-a',MAC_APP_MAP[name] || appName];
    await mac.run('/usr/bin/open',args);
    return 'open '+args.join(' ');
}

async function macGetActiveWindow() {
    const script = `
tell application "System Events"
  set frontApp to first application process whose frontmost is true
  set appName to name of frontApp
  set winTitle to ""
  try
    set winTitle to name of front window of frontApp
  end try
  set appPid to unix id of frontApp
  set posList to {0, 0}
  set sizeList to {0, 0}
  try
    set posList to position of front window of frontApp
    set sizeList to size of front window of frontApp
  end try
  return appName & "||" & winTitle & "||" & appPid & "||" & (item 1 of posList) & "||" & (item 2 of posList) & "||" & (item 1 of sizeList) & "||" & (item 2 of sizeList)
end tell`;

    const output = await execPromise(
        `osascript -e '${script.replace(/'/g, "'\\''")}'`,
        { timeout: 10000 }
    );
    const [appName, winTitle, pid, x, y, width, height] = output.split('||');
    return {
        title: winTitle || appName,
        processName: appName,
        pid: parseInt(pid, 10) || 0,
        x: parseInt(x, 10) || 0,
        y: parseInt(y, 10) || 0,
        width: parseInt(width, 10) || 0,
        height: parseInt(height, 10) || 0,
    };
}

async function macListWindows() {
    const script = `
tell application "System Events"
  set out to ""
  repeat with proc in (every application process whose visible is true)
    set procName to name of proc
    try
      repeat with w in (every window of proc)
        set out to out & procName & "||" & (name of w) & "\n"
      end repeat
    end try
  end repeat
  return out
end tell`;

    const output = await execPromise(
        `osascript -e '${script.replace(/'/g, "'\\''")}'`,
        { timeout: 10000 }
    );

    const windows = [];
    for (const line of output.split('\n')) {
        if (!line.trim()) continue;
        const [processName, title] = line.split('||');
        if (title && title.trim()) {
            windows.push({ title: title.trim(), processName: processName.trim(), pid: 0 });
        }
    }
    return windows;
}

module.exports = {
    isWindows,
    isMac,
    isLinux,
    execPromise,
    getChromiumCandidateSubpaths,
    findBundledChromiumExecutable,
    primeiroCaminhoExistente,
    findBundledBinDir,
    getDefaultUserAgent,
    macOpenApplication,
    macGetActiveWindow,
    macListWindows,
};
