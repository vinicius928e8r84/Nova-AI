'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const ADB_ZIP_URL = 'https://dl.google.com/android/repository/platform-tools-latest-darwin.zip';
const ADB_MANIFEST_URL = 'https://dl.google.com/android/repository/repository2-3.xml';
const SCRCPY_VERSION = 'v5.0.1';
const SCRCPY_RELEASE = {
    arm64: { name: 'scrcpy-macos-aarch64-v5.0.1', sha256: '33611e51977a8289e2e124b220f727895181ef2eb9060e0987a4dc2db9cf0d6b' },
    x64: { name: 'scrcpy-macos-x86_64-v5.0.1', sha256: '31a5467a9e907f162b093267cbbab1276b15c6e709c2ea8159566a8d165beb50' }
};
const ALLOWED_HOSTS = ['dl.google.com', 'github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'];

function scrcpyRelease(arch) {
    const rel = SCRCPY_RELEASE[arch];
    if (!rel) throw new Error('Arquitetura sem build oficial do scrcpy para macOS: ' + arch);
    return {
        ...rel,
        url: `https://github.com/Genymobile/scrcpy/releases/download/${SCRCPY_VERSION}/${rel.name}.tar.gz`
    };
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

function parseDarwinPlatformToolsSha1(xml) {
    const hashes = [];
    const blocks = String(xml).split('<remotePackage ').filter(b => b.startsWith('path="platform-tools"'));
    for (const block of blocks) {
        const archives = block.split('<archive>').slice(1);
        for (const archive of archives) {
            if (!/<host-os>macosx<\/host-os>/.test(archive)) continue;
            const m = archive.match(/<checksum type="sha1">([0-9a-f]{40})<\/checksum>/i);
            if (m) hashes.push(m[1].toLowerCase());
        }
    }
    return hashes;
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

function run(file, args) {
    return new Promise((resolve, reject) => {
        execFile(file, args, { timeout: 120000 }, (err, stdout, stderr) => {
            if (err) reject(new Error(`${path.basename(file)} falhou: ${(stderr || err.message).toString().trim()}`));
            else resolve(stdout);
        });
    });
}

async function extractInto(archivePath, kind, destDir, runner = run) {
    fs.mkdirSync(destDir, { recursive: true });
    if (kind === 'zip') await runner('/usr/bin/ditto', ['-x', '-k', archivePath, destDir]);
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
    const zip = await fetchBuffer(http, ADB_ZIP_URL);
    const manifest = (await fetchBuffer(http, ADB_MANIFEST_URL, 60000)).toString('utf8');
    const official = parseDarwinPlatformToolsSha1(manifest);
    if (!official.length) throw new Error('Não foi possível obter o hash oficial do ADB no manifesto do Google; instalação cancelada.');
    const got = hashHex(zip, 'sha1');
    if (!official.includes(got)) throw new Error('Hash do ADB não confere com o manifesto oficial do Google; arquivo descartado.');
    const work = fs.mkdtempSync(path.join(baseDir, 'adb-tmp-'));
    try {
        const zipPath = path.join(work, 'platform-tools.zip');
        fs.writeFileSync(zipPath, zip);
        const out = path.join(work, 'out');
        await extractInto(zipPath, 'zip', out, runner);
        const src = path.join(out, 'platform-tools');
        if (!fs.existsSync(path.join(src, 'adb'))) throw new Error('O pacote do ADB baixado não contém o executável adb.');
        markExecutable(src, ['adb', 'fastboot']);
        const dest = path.join(baseDir, 'platform-tools');
        replaceDir(src, dest);
        return path.join(dest, 'adb');
    } finally {
        fs.rmSync(work, { recursive: true, force: true });
    }
}

async function installScrcpy(baseDir, deps = {}) {
    const http = deps.http || require('axios');
    const runner = deps.runner || run;
    const rel = scrcpyRelease(deps.arch || process.arch);
    const tgz = await fetchBuffer(http, rel.url);
    if (hashHex(tgz, 'sha256') !== rel.sha256) throw new Error('Hash do scrcpy não confere com o valor oficial da release; arquivo descartado.');
    const work = fs.mkdtempSync(path.join(baseDir, 'scrcpy-tmp-'));
    try {
        const tgzPath = path.join(work, 'scrcpy.tar.gz');
        fs.writeFileSync(tgzPath, tgz);
        const out = path.join(work, 'out');
        await extractInto(tgzPath, 'tgz', out, runner);
        const src = path.join(out, rel.name);
        if (!fs.existsSync(path.join(src, 'scrcpy')) || !fs.existsSync(path.join(src, 'scrcpy-server'))) {
            throw new Error('O pacote do scrcpy baixado não contém scrcpy e scrcpy-server.');
        }
        markExecutable(src, ['scrcpy', 'adb']);
        const dest = path.join(baseDir, 'scrcpy');
        replaceDir(src, dest);
        return path.join(dest, 'scrcpy');
    } finally {
        fs.rmSync(work, { recursive: true, force: true });
    }
}

function localToolPath(baseDir, name) {
    const p = name === 'adb' ? path.join(baseDir, 'platform-tools', 'adb') : path.join(baseDir, 'scrcpy', 'scrcpy');
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch { return null; }
}

async function ensureMacTools({ baseDir, adbReady, scrcpyReady, force, progress = () => {}, deps = {} }) {
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

module.exports = {
    ensureMacTools, installAdb, installScrcpy, localToolPath, parseDarwinPlatformToolsSha1,
    scrcpyRelease, assertOfficialUrl, replaceDir, sweepTemp, fetchBuffer, SCRCPY_VERSION
};
