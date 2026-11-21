'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const EXPAND_ARCHIVE_SCRIPT = 'Expand-Archive -LiteralPath $env:NOVA_ARCHIVE -DestinationPath $env:NOVA_DESTINO -Force';
const ADB_MANIFEST_URL = 'https://dl.google.com/android/repository/repository2-3.xml';
const SCRCPY_VERSION = 'v5.0.1';
const SCRCPY_DOWNLOAD_BASE = `https://github.com/Genymobile/scrcpy/releases/download/${SCRCPY_VERSION}/`;
const ALLOWED_HOSTS = ['dl.google.com', 'github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'];

function extrairComPowerShell(runner, extracao) {
    return runner('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', EXPAND_ARCHIVE_SCRIPT],
        { env: { ...process.env, NOVA_ARCHIVE: extracao.arquivo, NOVA_DESTINO: extracao.destino } });
}

function extrairComUtilitariosDoMac(runner, extracao) {
    if (extracao.tipo === 'zip') return runner('/usr/bin/ditto', ['-x', '-k', extracao.arquivo, extracao.destino]);
    return runner('/usr/bin/tar', ['-xzf', extracao.arquivo, '-C', extracao.destino]);
}

const PERFIL_UNIX = {
    sufixoExecutavel: '',
    marcaExecutavel: true,
    extrair: extrairComUtilitariosDoMac,
    mensagemPronto: 'Ferramentas prontas.',
    dicaDeInstalacaoManual: ''
};

const PERFIS_POR_PLATAFORMA = {
    darwin: {
        ...PERFIL_UNIX,
        adbZipUrl: 'https://dl.google.com/android/repository/platform-tools-latest-darwin.zip',
        hostOsNoManifesto: 'macosx',
        scrcpy: {
            sistema: 'macOS',
            tipo: 'tgz',
            extensao: '.tar.gz',
            builds: {
                arm64: { name: 'scrcpy-macos-aarch64-v5.0.1', sha256: '33611e51977a8289e2e124b220f727895181ef2eb9060e0987a4dc2db9cf0d6b' },
                x64: { name: 'scrcpy-macos-x86_64-v5.0.1', sha256: '31a5467a9e907f162b093267cbbab1276b15c6e709c2ea8159566a8d165beb50' }
            }
        },
        mensagemPronto: 'Native macOS tools ready.',
        dicaDeInstalacaoManual: ' Alternativa: brew install android-platform-tools scrcpy'
    },
    win32: {
        sufixoExecutavel: '.exe',
        marcaExecutavel: false,
        extrair: extrairComPowerShell,
        adbZipUrl: 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip',
        hostOsNoManifesto: 'windows',
        scrcpy: {
            sistema: 'Windows',
            tipo: 'zip',
            extensao: '.zip',
            builds: {
                x64: { name: 'scrcpy-win64-v5.0.1', sha256: 'b12a2c4ee8be317422451fc7dcf8ee20a71b5ea7ef9ad73ddd825a25316227a5' }
            }
        },
        mensagemPronto: 'Ferramentas prontas.',
        dicaDeInstalacaoManual: ''
    }
};

function perfilDaPlataforma(platform) {
    return Object.hasOwn(PERFIS_POR_PLATAFORMA, platform) ? PERFIS_POR_PLATAFORMA[platform] : PERFIL_UNIX;
}

function buildDoScrcpy(scrcpy, arch) {
    if (!Object.hasOwn(scrcpy.builds, arch)) throw new Error(`Arquitetura sem build oficial do scrcpy para ${scrcpy.sistema}: ` + arch);
    return scrcpy.builds[arch];
}

function scrcpyRelease(arch, platform = 'darwin') {
    const { scrcpy } = perfilDaPlataforma(platform);
    if (!scrcpy) throw new Error('Download automático do scrcpy não existe para esta plataforma: ' + platform);
    const build = buildDoScrcpy(scrcpy, arch);
    return { ...build, kind: scrcpy.tipo, url: SCRCPY_DOWNLOAD_BASE + build.name + scrcpy.extensao };
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

async function extractInto(ambiente, extracao) {
    fs.mkdirSync(extracao.destino, { recursive: true });
    await ambiente.perfil.extrair(ambiente.runner, extracao);
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

function ambienteDeInstalacao(deps) {
    const http = deps.http || require('axios');
    const runner = deps.runner || run;
    const plataforma = deps.platform || process.platform;
    return { http, runner, plataforma, perfil: perfilDaPlataforma(plataforma) };
}

function pacoteDoAdb(perfil) {
    const adbExe = 'adb' + perfil.sufixoExecutavel;
    return {
        ferramenta: 'adb',
        nomeDoArquivo: 'platform-tools.zip',
        tipo: 'zip',
        pastaExtraida: 'platform-tools',
        pastaFinal: 'platform-tools',
        obrigatorios: [adbExe],
        principal: adbExe,
        executaveis: ['adb', 'fastboot'],
        erroIncompleto: 'O pacote do ADB baixado não contém o executável adb.'
    };
}

function nomeDoArquivoDoScrcpy(tipo) {
    return tipo === 'zip' ? 'scrcpy.zip' : 'scrcpy.tar.gz';
}

function pacoteDoScrcpy(perfil, rel) {
    const scrcpyExe = 'scrcpy' + perfil.sufixoExecutavel;
    return {
        ferramenta: 'scrcpy',
        nomeDoArquivo: nomeDoArquivoDoScrcpy(rel.kind),
        tipo: rel.kind,
        pastaExtraida: rel.name,
        pastaFinal: 'scrcpy',
        obrigatorios: [scrcpyExe, 'scrcpy-server'],
        principal: scrcpyExe,
        executaveis: ['scrcpy', 'adb'],
        erroIncompleto: 'O pacote do scrcpy baixado não contém scrcpy e scrcpy-server.'
    };
}

function pacoteCompleto(pasta, obrigatorios) {
    return obrigatorios.every(nome => fs.existsSync(path.join(pasta, nome)));
}

async function instalarPacote(baseDir, ambiente, pacote, conteudo) {
    const work = fs.mkdtempSync(path.join(baseDir, pacote.ferramenta + '-tmp-'));
    try {
        const arquivo = path.join(work, pacote.nomeDoArquivo);
        fs.writeFileSync(arquivo, conteudo);
        const destinoDaExtracao = path.join(work, 'out');
        await extractInto(ambiente, { arquivo, tipo: pacote.tipo, destino: destinoDaExtracao });
        const src = path.join(destinoDaExtracao, pacote.pastaExtraida);
        if (!pacoteCompleto(src, pacote.obrigatorios)) throw new Error(pacote.erroIncompleto);
        if (ambiente.perfil.marcaExecutavel) markExecutable(src, pacote.executaveis);
        const dest = path.join(baseDir, pacote.pastaFinal);
        replaceDir(src, dest);
        return path.join(dest, pacote.principal);
    } finally {
        fs.rmSync(work, { recursive: true, force: true });
    }
}

async function hashesOficiaisDoAdb(http, hostOs) {
    const manifest = (await fetchBuffer(http, ADB_MANIFEST_URL, 60000)).toString('utf8');
    const oficiais = parsePlatformToolsSha1(manifest, hostOs);
    if (!oficiais.length) throw new Error('Não foi possível obter o hash oficial do ADB no manifesto do Google; instalação cancelada.');
    return oficiais;
}

async function baixarAdbConferido(ambiente) {
    const zip = await fetchBuffer(ambiente.http, ambiente.perfil.adbZipUrl);
    const oficiais = await hashesOficiaisDoAdb(ambiente.http, ambiente.perfil.hostOsNoManifesto);
    if (!oficiais.includes(hashHex(zip, 'sha1'))) throw new Error('Hash do ADB não confere com o manifesto oficial do Google; arquivo descartado.');
    return zip;
}

async function installAdb(baseDir, deps = {}) {
    const ambiente = ambienteDeInstalacao(deps);
    if (!ambiente.perfil.adbZipUrl) throw new Error('Download automático do ADB não existe para esta plataforma: ' + ambiente.plataforma);
    const zip = await baixarAdbConferido(ambiente);
    return instalarPacote(baseDir, ambiente, pacoteDoAdb(ambiente.perfil), zip);
}

async function installScrcpy(baseDir, deps = {}) {
    const ambiente = ambienteDeInstalacao(deps);
    const rel = deps.release || scrcpyRelease(deps.arch || process.arch, ambiente.plataforma);
    const pacote = await fetchBuffer(ambiente.http, rel.url);
    if (hashHex(pacote, 'sha256') !== rel.sha256) throw new Error('Hash do scrcpy não confere com o valor oficial da release; arquivo descartado.');
    return instalarPacote(baseDir, ambiente, pacoteDoScrcpy(ambiente.perfil, rel), pacote);
}

function localToolPath(baseDir, name) {
    const p = name === 'adb' ? path.join(baseDir, 'platform-tools', 'adb') : path.join(baseDir, 'scrcpy', 'scrcpy');
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

function caminhosDasFerramentas(service) {
    return { adbPath: service.adbPath, scrcpyPath: service.scrcpyPath };
}

function ferramentasInstaladas(caminhos) {
    return fs.existsSync(caminhos.adbPath) && fs.existsSync(caminhos.scrcpyPath);
}

function situacaoDasFerramentas(caminhos) {
    return { adbPronto: fs.existsSync(caminhos.adbPath), scrcpyPronto: fs.existsSync(caminhos.scrcpyPath) };
}

function nadaAInstalar(situacao, force) {
    return situacao.adbPronto && situacao.scrcpyPronto && !force;
}

function respostaPronta(perfil, caminhos) {
    return { success: true, message: perfil.mensagemPronto, ...caminhos };
}

function mensagemDeFalha(perfil, errors) {
    const motivo = errors.join(' | ') || 'Arquivos não encontrados após a instalação.';
    return 'Não foi possível instalar adb/scrcpy automaticamente. ' + motivo + perfil.dicaDeInstalacaoManual;
}

function informarProgresso(service, progresso) {
    service.sendToFrontend('physical-mobile:setup-progress', progresso);
}

function progressoDoServico(service) {
    return (progresso) => informarProgresso(service, progresso);
}

function concluirProvisionamento(service, perfil, errors) {
    const caminhos = caminhosDasFerramentas(service);
    if (errors.length || !ferramentasInstaladas(caminhos)) {
        const message = mensagemDeFalha(perfil, errors);
        console.error('[PhysicalMobile] ensureTools:', message);
        informarProgresso(service, { stage: 'error', message });
        return { success: false, error: message, ...caminhos };
    }
    informarProgresso(service, { stage: 'done', message: 'Motores prontos!' });
    return respostaPronta(perfil, caminhos);
}

async function ensureForService(service, force, platform = process.platform, extraDeps = {}) {
    const perfil = perfilDaPlataforma(platform);
    const antes = caminhosDasFerramentas(service);
    const situacao = situacaoDasFerramentas(antes);
    if (nadaAInstalar(situacao, force)) return respostaPronta(perfil, antes);
    if (service.isProvisioning) return { success: true, message: 'Configuração em andamento...' };
    service.isProvisioning = true;
    const progress = progressoDoServico(service);
    progress({ stage: 'starting', message: 'Configurando Motor de Controle Móvel...' });
    try {
        const errors = await ensureAndroidTools({
            baseDir: service.baseDir, adbReady: situacao.adbPronto, scrcpyReady: situacao.scrcpyPronto, force, progress, deps: { ...extraDeps, platform }
        });
        return concluirProvisionamento(service, perfil, errors);
    } finally {
        service.isProvisioning = false;
    }
}

module.exports = {
    ensureAndroidTools, ensureForService, installAdb, installScrcpy, localToolPath, parsePlatformToolsSha1,
    scrcpyRelease, assertOfficialUrl, replaceDir, sweepTemp, fetchBuffer, SCRCPY_VERSION
};
