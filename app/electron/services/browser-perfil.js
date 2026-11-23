'use strict';

const path = require('path');
const fs = require('fs');
const net = require('net');
const http = require('http');
const { app } = require('electron');
const { findBundledChromiumExecutable } = require('./platform-utils');

const BROWSER_DATA_DIR = path.join(app.getPath('userData'), 'browser-data');
const DOWNLOAD_DIR = app.getPath('downloads');
const BROWSER_LOG_PATH = path.join(app.getPath('userData'), 'logs', 'browser-launch.log');
const QUARANTINE_PREFIX = 'browser-data.corrupt-';
const CDP_PORT_SCAN_START = 9222;
const CDP_PORT_SCAN_END = 9252;
const TAMANHO_MAXIMO_DO_LOG = 1024 * 1024;
const NAVEGADOR_EMBUTIDO = ['browsers', 'chromium-1208', 'chrome-win64', 'chrome.exe'];
const SEM_CDP = { reachable: false, chromeFamily: false, browser: null };

let _browserLogDirReady = false;
let resolvedCdpPort = null;
let cdpPortReservation = null;
let cdpPortPromise = null;

function recomecarLogGrande() {
    try {
        if (fs.statSync(BROWSER_LOG_PATH).size > TAMANHO_MAXIMO_DO_LOG) fs.unlinkSync(BROWSER_LOG_PATH);
    } catch { }
}

function appendBrowserLog(message) {
    try {
        if (!_browserLogDirReady) {
            fs.mkdirSync(path.dirname(BROWSER_LOG_PATH), { recursive: true });
            _browserLogDirReady = true;
        }
        recomecarLogGrande();
        fs.appendFileSync(BROWSER_LOG_PATH, `[${new Date().toISOString()}] ${message}\n`);
    } catch { }
}

function apagarQuarentenasAntigas(parent, destName) {
    try {
        for (const name of fs.readdirSync(parent)) {
            if (!name.startsWith(QUARANTINE_PREFIX) || name === destName) continue;
            fs.rmSync(path.join(parent, name), { recursive: true, force: true });
        }
    } catch { }
}

function quarantineBrowserProfile() {
    if (!fs.existsSync(BROWSER_DATA_DIR)) return false;
    const parent = path.dirname(BROWSER_DATA_DIR);
    const destName = `${QUARANTINE_PREFIX}${new Date().toISOString().replace(/[:.]/g, '-')}`;
    try {
        fs.renameSync(BROWSER_DATA_DIR, path.join(parent, destName));
        appendBrowserLog(`profile quarantined → ${destName}`);
    } catch (err) {
        appendBrowserLog(`profile quarantine FAILED (still locked?): ${err.message}`);
        return false;
    }
    apagarQuarentenasAntigas(parent, destName);
    return true;
}

function isChromeFamilyBrowser(browserField) {
    const b = String(browserField || '').toLowerCase();
    return ['chrome', 'chromium', 'edg'].some(nome => b.includes(nome));
}

function lerVersaoDoCdp(body) {
    try {
        const json = JSON.parse(body);
        return {
            reachable: true,
            chromeFamily: isChromeFamilyBrowser(json.Browser),
            browser: json.Browser || '(unknown)',
        };
    } catch {
        return { reachable: true, chromeFamily: false, browser: '(non-CDP HTTP service)' };
    }
}

function probeCdpEndpoint(port, timeoutMs = 1500) {
    return new Promise((resolve) => {
        const req = http.get(
            { host: '127.0.0.1', port, path: '/json/version', timeout: timeoutMs },
            (res) => {
                let body = '';
                res.on('data', (c) => { body += c; });
                res.on('end', () => resolve(lerVersaoDoCdp(body)));
            }
        );
        req.on('timeout', () => { req.destroy(); resolve({ ...SEM_CDP }); });
        req.on('error', () => resolve({ ...SEM_CDP }));
    });
}

function tryReservePort(port) {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.once('error', () => resolve(null));
        server.listen(port, '127.0.0.1', () => resolve(server));
    });
}

function reservarPorta(port, reservation) {
    resolvedCdpPort = port;
    cdpPortReservation = reservation;
    if (port !== CDP_PORT_SCAN_START) {
        console.warn(`[BrowserService] ⚠️ Default CDP port ${CDP_PORT_SCAN_START} unavailable — using port ${port} instead.`);
    } else {
        console.info(`[BrowserService] CDP port ${port} reserved.`);
    }
    return port;
}

async function experimentarPorta(port) {
    const reservation = await tryReservePort(port);
    if (reservation) return reservarPorta(port, reservation);
    const probe = await probeCdpEndpoint(port);
    if (probe.reachable && probe.chromeFamily) {
        console.info(`[BrowserService] Reusing existing Chrome-family CDP on port ${port} (Browser: ${probe.browser}).`);
        resolvedCdpPort = port;
        return port;
    }
    console.warn(`[BrowserService] ⚠️ Port ${port} is occupied by a non-Chrome app (${probe.browser || 'unknown — no CDP response'}). Skipping.`);
    return null;
}

async function procurarPorta() {
    for (let port = CDP_PORT_SCAN_START; port <= CDP_PORT_SCAN_END; port++) {
        const escolhida = await experimentarPorta(port);
        if (escolhida !== null) return escolhida;
    }
    console.error(`[BrowserService] ❌ No free CDP port in ${CDP_PORT_SCAN_START}-${CDP_PORT_SCAN_END}; falling back to ${CDP_PORT_SCAN_START}.`);
    resolvedCdpPort = CDP_PORT_SCAN_START;
    return resolvedCdpPort;
}

async function resolveCdpPort() {
    if (resolvedCdpPort !== null) return resolvedCdpPort;
    if (cdpPortPromise) return cdpPortPromise;
    cdpPortPromise = procurarPorta();
    return cdpPortPromise;
}

function getCdpPort() {
    return resolvedCdpPort || CDP_PORT_SCAN_START;
}

function releaseCdpPortReservation() {
    if (cdpPortReservation) {
        try { cdpPortReservation.close(); } catch { }
        cdpPortReservation = null;
    }
}

function conferirPortaDoNavegador(cdpPort) {
    probeCdpEndpoint(cdpPort, 3000).then((probe) => {
        if (probe.reachable && probe.chromeFamily) {
            console.info(`[BrowserService] ✅ CDP verified on port ${cdpPort} (Browser: ${probe.browser}).`);
        } else {
            console.error(`[BrowserService] ❌ CDP on port ${cdpPort} is NOT our Chromium (got: ${probe.browser || 'no response'}). Browser sharing may fail — restart the app.`);
        }
    });
}

const ehObjetoSimples = valor => Boolean(valor) && typeof valor === 'object' && !Array.isArray(valor);

function safeReadJson(filePath) {
    try {
        if (!fs.existsSync(filePath)) return null;
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return ehObjetoSimples(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

function safeWriteJson(filePath, data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function setDeep(obj, keys, value) {
    let node = obj;
    for (const key of keys.slice(0, -1)) {
        if (!ehObjetoSimples(node[key])) node[key] = {};
        node = node[key];
    }
    node[keys[keys.length - 1]] = value;
}

function ensureStandardDownloadPrefs(userDataDir, downloadDir) {
    const preferencesPath = path.join(userDataDir, 'Default', 'Preferences');
    const prefs = safeReadJson(preferencesPath) || {};
    setDeep(prefs, ['download', 'default_directory'], downloadDir);
    setDeep(prefs, ['download', 'directory_upgrade'], true);
    setDeep(prefs, ['download', 'prompt_for_download'], false);
    setDeep(prefs, ['savefile', 'default_directory'], downloadDir);
    setDeep(prefs, ['profile', 'default_content_setting_values', 'automatic_downloads'], 1);
    safeWriteJson(preferencesPath, prefs);
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitizeFilename(filename) {
    return String(filename || '')
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
        .trim();
}

function extensionFromUrl(rawUrl) {
    try {
        const { pathname } = new URL(rawUrl);
        const ext = path.extname(pathname || '');
        return ext && ext.length <= 10 ? ext : '';
    } catch {
        return '';
    }
}

function resolveDownloadFilename(download) {
    const suggested = sanitizeFilename(download.suggestedFilename());
    const fallbackName = suggested || `download_${Date.now()}`;
    const inferredExt = path.extname(fallbackName) ? '' : extensionFromUrl(download.url());
    return inferredExt ? `${fallbackName}${inferredExt}` : fallbackName;
}

function findMatchingDownloadPath(filename, earliestMtimeMs = 0) {
    if (!fs.existsSync(DOWNLOAD_DIR)) return null;
    const parsed = path.parse(filename);
    const matcher = new RegExp(
        `^${escapeRegExp(parsed.name)}(?: \\((\\d+)\\))?${escapeRegExp(parsed.ext)}$`,
        'i'
    );
    const matches = fs.readdirSync(DOWNLOAD_DIR, { withFileTypes: true })
        .filter((entry) => entry.isFile() && matcher.test(entry.name))
        .map((entry) => {
            const fullPath = path.join(DOWNLOAD_DIR, entry.name);
            return { fullPath, mtimeMs: fs.statSync(fullPath).mtimeMs };
        })
        .filter((entry) => entry.mtimeMs >= earliestMtimeMs)
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
    return matches[0]?.fullPath || null;
}

function binarioAchado(rotulo, caminho) {
    console.info(rotulo, caminho);
    return caminho;
}

function escolherExecutavel() {
    const doSistema = process.platform === 'darwin' ? require('./mac-native').browser('chrome') : undefined;
    const bundledBrowserPath = path.join(process.resourcesPath, ...NAVEGADOR_EMBUTIDO);
    if (fs.existsSync(bundledBrowserPath)) return binarioAchado('[BrowserService] Using BUNDLED browser binary:', bundledBrowserPath);
    const devBrowserPath = path.join(__dirname, '../../browsers/chromium-1208/chrome-win64/chrome.exe');
    if (fs.existsSync(devBrowserPath)) return binarioAchado('[BrowserService] Using LOCAL DEV browser binary:', devBrowserPath);
    const scannedPath = findBundledChromiumExecutable([
        process.resourcesPath ? path.join(process.resourcesPath, 'browsers') : null,
        path.join(__dirname, '../../browsers'),
    ]);
    if (scannedPath) return binarioAchado('[BrowserService] Using bundled browser binary (platform scan):', scannedPath);
    console.info('[BrowserService] Using SYSTEM installed browser (fallback).');
    return doSistema;
}

module.exports = {
    BROWSER_DATA_DIR,
    DOWNLOAD_DIR,
    appendBrowserLog,
    quarantineBrowserProfile,
    resolveCdpPort,
    getCdpPort,
    releaseCdpPortReservation,
    conferirPortaDoNavegador,
    ensureStandardDownloadPrefs,
    resolveDownloadFilename,
    findMatchingDownloadPath,
    escolherExecutavel,
};
