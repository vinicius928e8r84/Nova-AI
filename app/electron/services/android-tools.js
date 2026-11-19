'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const ADB_ZIP_URLS = {
    darwin: 'https://dl.google.com/android/repository/platform-tools-latest-darwin.zip',
    win32: 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip'
};
const MANIFEST_HOST_OS = { darwin: 'macosx', win32: 'windows' };
const WINDOWS_SCRCPY = { name: 'scrcpy-win64-v5.0.1', sha256: 'b12a2c4ee8be317422451fc7dcf8ee20a71b5ea7ef9ad73ddd825a25316227a5' };
const EXPAND_ARCHIVE_SCRIPT = 'Expand-Archive -LiteralPath $env:NOVA_ARCHIVE -DestinationPath $env:NOVA_DESTINO -Force';
const ADB_MANIFEST_URL = 'https://dl.google.com/android/repository/repository2-3.xml';
const SCRCPY_VERSION = 'v5.0.1';
const SCRCPY_RELEASE = {
    arm64: { name: 'scrcpy-macos-aarch64-v5.0.1', sha256: '33611e51977a8289e2e124b220f727895181ef2eb9060e0987a4dc2db9cf0d6b' },
    x64: { name: 'scrcpy-macos-x86_64-v5.0.1', sha256: '31a5467a9e907f162b093267cbbab1276b15c6e709c2ea8159566a8d165beb50' }
};
const ALLOWED_HOSTS = ['dl.google.com', 'github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'];

function scrcpyRelease(arch, platform = 'darwin') {
    if (platform === 'win32') {
        if (arch !== 'x64') throw new Error('Arquitetura sem build oficial do scrcpy para Windows: ' + arch);
        return { ...WINDOWS_SCRCPY, kind: 'zip', url: `https://github.com/Genymobile/scrcpy/releases/download/${SCRCPY_VERSION}/${WINDOWS_SCRCPY.name}.zip` };
    }
    if (platform !== 'darwin') throw new Error('Download automático do scrcpy não existe para esta plataforma: ' + platform);
    const rel = SCRCPY_RELEASE[arch];
    if (!rel) throw new Error('Arquitetura sem build oficial do scrcpy para macOS: ' + arch);
    return {
        ...rel,
        kind: 'tgz',
        url: `https://github.com/Genymobile/scrcpy/releases/download/${SCRCPY_VERSION}/${rel.name}.tar.gz`
    };
}

function toolFileName(name, platform) {
    return platform === 'win32' ? name + '.exe' : name;
}

function hashHex(buffer, algorithm) {
    return crypto.createHash(algorithm).update(buffer).digest('hex');
}

function assertOfficialUrl(url) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.includes(parsed.hostname)) {
        throw new Error('Origem de download não oficial recusada: ' + parsed.hostname);
    }
}

function parsePlatformToolsSha1(xml, hostOs) {
    const hashes = [];
    const blocks = String(xml).split('<remotePackage ').filter(b => b.startsWith('path="platform-tools"'));
    for (const block of blocks) {
        const archives = block.split('<archive>').slice(1);
        for (const archive of archives) {
            if (!archive.includes(`<host-os>${hostOs}</host-os>`)) continue;
            const m = archive.match(/<checksum type="sha1">([0-9a-f]{40})<\/checksum>/i);
            if (m) hashes.push(m[1].toLowerCase());
        }
    }
    return hashes;
}

function parseDarwinPlatformToolsSha1(xml) {
    return parsePlatformToolsSha1(xml, MANIFEST_HOST_OS.darwin);
}

async function fetchBuffer(http, url, timeout = 120000) {
    assertOfficialUrl(url);
    let response;
    try {
        response = await http({ url, method: 'GET', responseType: 'arraybuffer', timeout, maxRedirects: 5,
            beforeRedirect: (options) => assertOfficialUrl(`${options.protocol}//${options.hostname || options.host}${options.path || ''}`)
        });
    } catch (e) {
        throw new Error(`Falha ao baixar ${url}: ${e.message}`);
    }
    return Buffer.from(response.data);
}

function run(file, args, options = {}) {
    return new Promise((resolve, reject) => {
        execFile(file, args, { timeout: 120000, windowsHide: true, ...options }, (err, stdout, stderr) => {
            if (err) reject(new Error(`${path.basename(file)} falhou: ${(stderr || err.message).toString().trim()}`));
            else resolve(stdout);
        });
    });
}

async function extractInto(archivePath, kind, destDir, runner = run, platform = 'darwin') {
    fs.mkdirSync(destDir, { recursive: true });
    if (platform === 'win32') {
        await runner('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', EXPAND_ARCHIVE_SCRIPT],
            { env: { ...process.env, NOVA_ARCHIVE: archivePath, NOVA_DESTINO: destDir } });
    } else if (kind === 'zip') await runner('/usr/bin/ditto', ['-x', '-k', archivePath, destDir]);
    else await runner('/usr/bin/tar', ['-xzf', archivePath, '-C', destDir]);
}

function replaceDir(from, to) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    const old = to + '.old';
    fs.rmSync(old, { recursive: true, force: true });
    const hadOld = fs.existsSync(to);
    if (hadOld) fs.renameSync(to, old);
    try {
        fs.renameSync(from, to);
    } catch (e) {
        if (hadOld) fs.renameSync(old, to);
        throw e;
    }
    fs.rmSync(old, { recursive: true, force: true });
}

function sweepTemp(baseDir) {
    let names = [];
    try { names = fs.readdirSync(baseDir); } catch { return; }
    for (const n of names) {
        if (/^(adb|scrcpy)-tmp-/.test(n)) fs.rmSync(path.join(baseDir, n), { recursive: true, force: true });
    }
}

function markExecutable(dir, names) {
    for (const n of names) {
        const p = path.join(dir, n);
        if (fs.existsSync(p)) fs.chmodSync(p, 0o755);
    }
}

async function installAdb(baseDir, deps = {}) {
    const http = deps.http || require('axios');
    const runner = deps.runner || run;
    const platform = deps.platform || process.platform;
    if (!ADB_ZIP_URLS[platform]) throw new Error('Download automático do ADB não existe para esta plataforma: ' + platform);
    const adbExe = toolFileName('adb', platform);
    const zip = await fetchBuffer(http, ADB_ZIP_URLS[platform]);
    const manifest = (await fetchBuffer(http, ADB_MANIFEST_URL, 60000)).toString('utf8');
    const official = parsePlatformToolsSha1(manifest, MANIFEST_HOST_OS[platform]);
    if (!official.length) throw new Error('Não foi possível obter o hash oficial do ADB no manifesto do Google; instalação cancelada.');
    const got = hashHex(zip, 'sha1');
    if (!official.includes(got)) throw new Error('Hash do ADB não confere com o manifesto oficial do Google; arquivo descartado.');
    const work = fs.mkdtempSync(path.join(baseDir, 'adb-tmp-'));
    try {
        const zipPath = path.join(work, 'platform-tools.zip');
        fs.writeFileSync(zipPath, zip);
        const out = path.join(work, 'out');
        await extractInto(zipPath, 'zip', out, runner, platform);
        const src = path.join(out, 'platform-tools');
        if (!fs.existsSync(path.join(src, adbExe))) throw new Error('O pacote do ADB baixado não contém o executável adb.');
        if (platform !== 'win32') markExecutable(src, ['adb', 'fastboot']);
        const dest = path.join(baseDir, 'platform-tools');
        replaceDir(src, dest);
        return path.join(dest, adbExe);
    } finally {
        fs.rmSync(work, { recursive: true, force: true });
    }
}

async function installScrcpy(baseDir, deps = {}) {
    const http = deps.http || require('axios');
    const runner = deps.runner || run;
    const platform = deps.platform || process.platform;
    const rel = deps.release || scrcpyRelease(deps.arch || process.arch, platform);
    const tgz = await fetchBuffer(http, rel.url);
    if (hashHex(tgz, 'sha256') !== rel.sha256) throw new Error('Hash do scrcpy não confere com o valor oficial da release; arquivo descartado.');
    const work = fs.mkdtempSync(path.join(baseDir, 'scrcpy-tmp-'));
    try {
        const tgzPath = path.join(work, rel.kind === 'zip' ? 'scrcpy.zip' : 'scrcpy.tar.gz');
        fs.writeFileSync(tgzPath, tgz);
        const out = path.join(work, 'out');
        await extractInto(tgzPath, rel.kind, out, runner, platform);
        const src = path.join(out, rel.name);
        const scrcpyExe = toolFileName('scrcpy', platform);
        if (!fs.existsSync(path.join(src, scrcpyExe)) || !fs.existsSync(path.join(src, 'scrcpy-server'))) {
            throw new Error('O pacote do scrcpy baixado não contém scrcpy e scrcpy-server.');
        }
        if (platform !== 'win32') markExecutable(src, ['scrcpy', 'adb']);
        const dest = path.join(baseDir, 'scrcpy');
        replaceDir(src, dest);
        return path.join(dest, scrcpyExe);
    } finally {
        fs.rmSync(work, { recursive: true, force: true });
    }
}

function localToolPath(baseDir, name, platform = process.platform) {
    const exe = toolFileName(name, platform);
    const p = name === 'adb' ? path.join(baseDir, 'platform-tools', exe) : path.join(baseDir, 'scrcpy', exe);
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch { return null; }
}

async function ensureAndroidTools({ baseDir, adbReady, scrcpyReady, force, progress = () => {}, deps = {} }) {
    const errors = [];
    sweepTemp(baseDir);
    if (!adbReady || force) {
        progress({ stage: 'adb', message: 'Baixando Motor ADB Android (fonte oficial do Google)...' });
        try { await installAdb(baseDir, deps); } catch (e) { errors.push('ADB: ' + e.message); }
    }
    if (!scrcpyReady || force) {
        progress({ stage: 'scrcpy', message: 'Baixando Motor de Espelhamento de Tela (release oficial do scrcpy)...' });
        try { await installScrcpy(baseDir, deps); } catch (e) { errors.push('scrcpy: ' + e.message); }
    }
    return errors;
}

async function ensureForService(service, force, platform = process.platform, extraDeps = {}) {
    const mac = platform === 'darwin';
    const readyMessage = mac ? 'Native macOS tools ready.' : 'Ferramentas prontas.';
    const adbOk = fs.existsSync(service.adbPath), scrcpyOk = fs.existsSync(service.scrcpyPath);
    if (adbOk && scrcpyOk && !force) {
        return { success: true, message: readyMessage, adbPath: service.adbPath, scrcpyPath: service.scrcpyPath };
    }
    if (service.isProvisioning) return { success: true, message: 'Configuração em andamento...' };
    service.isProvisioning = true;
    const report = (p) => service.sendToFrontend('physical-mobile:setup-progress', p);
    report({ stage: 'starting', message: 'Configurando Motor de Controle Móvel...' });
    try {
        const errors = await ensureAndroidTools({
            baseDir: service.baseDir, adbReady: adbOk, scrcpyReady: scrcpyOk, force, progress: report, deps: { ...extraDeps, platform }
        });
        const adb = service.adbPath, scrcpy = service.scrcpyPath;
        const ready = fs.existsSync(adb) && fs.existsSync(scrcpy);
        if (errors.length || !ready) {
            const message = 'Não foi possível instalar adb/scrcpy automaticamente. ' + (errors.join(' | ') || 'Arquivos não encontrados após a instalação.') + (mac ? ' Alternativa: brew install android-platform-tools scrcpy' : '');
            console.error('[PhysicalMobile] ensureTools:', message);
            report({ stage: 'error', message });
            return { success: false, error: message, adbPath: adb, scrcpyPath: scrcpy };
        }
        report({ stage: 'done', message: 'Motores prontos!' });
        return { success: true, message: readyMessage, adbPath: adb, scrcpyPath: scrcpy };
    } finally {
        service.isProvisioning = false;
    }
}

module.exports = {
    ensureAndroidTools, ensureForService, installAdb, installScrcpy, localToolPath, parseDarwinPlatformToolsSha1, parsePlatformToolsSha1,
    scrcpyRelease, assertOfficialUrl, replaceDir, sweepTemp, fetchBuffer, SCRCPY_VERSION
};
