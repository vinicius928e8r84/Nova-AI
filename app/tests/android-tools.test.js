'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const m = require('../electron/services/android-tools');

const sha = (b, a) => crypto.createHash(a).update(b).digest('hex');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nova-adb-test-'));
const xmlFor = (hash) => `<remotePackage path="platform-tools"><archives><archive><complete><checksum type="sha1">${hash}</checksum><url>x-darwin.zip</url></complete><host-os>macosx</host-os></archive><archive><complete><checksum type="sha1">${'a'.repeat(40)}</checksum></complete><host-os>windows</host-os></archive></archives></remotePackage>`;

function fakeRunner(layout) {
    return async (file, args) => {
        const dest = args[args.length - 1];
        for (const f of layout) {
            fs.mkdirSync(path.dirname(path.join(dest, f)), { recursive: true });
            fs.writeFileSync(path.join(dest, f), 'bin');
        }
    };
}

test('parse pega só hashes macosx', () => {
    assert.deepStrictEqual(m.parseDarwinPlatformToolsSha1(xmlFor('b'.repeat(40))), ['b'.repeat(40)]);
});

test('recusa host não oficial', () => {
    assert.throws(() => m.assertOfficialUrl('https://evil.example.com/x.zip'));
    assert.throws(() => m.assertOfficialUrl('http://dl.google.com/x.zip'));
    m.assertOfficialUrl('https://dl.google.com/x.zip');
});

test('installAdb com hash correto instala', async () => {
    const base = tmp();
    const zip = Buffer.from('zipdata');
    const http = async ({ url }) => ({ data: url.endsWith('.xml') ? Buffer.from(xmlFor(sha(zip, 'sha1'))) : zip });
    const p = await m.installAdb(base, { http, platform: 'darwin', runner: fakeRunner(['platform-tools/adb']) });
    assert.strictEqual(p, path.join(base, 'platform-tools', 'adb'));
    assert.ok(fs.statSync(p).mode & 0o100);
    assert.deepStrictEqual(fs.readdirSync(base), ['platform-tools']);
});

test('installAdb com hash errado falha e não instala', async () => {
    const base = tmp();
    const http = async ({ url }) => ({ data: url.endsWith('.xml') ? Buffer.from(xmlFor('c'.repeat(40))) : Buffer.from('zipdata') });
    await assert.rejects(m.installAdb(base, { http, platform: 'darwin', runner: fakeRunner([]) }), /não confere/);
    assert.deepStrictEqual(fs.readdirSync(base), []);
});

test('installAdb sem hash no manifesto falha', async () => {
    const base = tmp();
    const http = async ({ url }) => ({ data: url.endsWith('.xml') ? Buffer.from('<x/>') : Buffer.from('z') });
    await assert.rejects(m.installAdb(base, { http, platform: 'darwin', runner: fakeRunner([]) }), /hash oficial/);
});

test('installAdb propaga erro de rede com mensagem clara', async () => {
    const http = async () => { throw new Error('ENOTFOUND'); };
    await assert.rejects(m.installAdb(tmp(), { http, platform: 'darwin' }), /Falha ao baixar.*ENOTFOUND/);
});

test('installScrcpy confere sha256 fixo', async () => {
    const base = tmp();
    const bad = async () => ({ data: Buffer.from('outra coisa') });
    await assert.rejects(m.installScrcpy(base, { http: bad, arch: 'arm64', platform: 'darwin' }), /não confere/);
    assert.strictEqual(m.scrcpyRelease('x64').url.startsWith('https://github.com/Genymobile/scrcpy/releases/download/'), true);
    assert.throws(() => m.scrcpyRelease('ia32'), /Arquitetura/);
});

test('ensureAndroidTools junta erros e não esconde falha', async () => {
    const base = tmp();
    const http = async () => { throw new Error('offline'); };
    const seen = [];
    const errors = await m.ensureAndroidTools({ baseDir: base, adbReady: false, scrcpyReady: false, force: false, progress: p => seen.push(p.stage), deps: { http, arch: 'arm64', platform: 'darwin' } });
    assert.strictEqual(errors.length, 2);
    assert.deepStrictEqual(seen, ['adb', 'scrcpy']);
});

test('ensureAndroidTools não baixa o que já existe', async () => {
    let calls = 0;
    const http = async () => { calls++; throw new Error('x'); };
    const errors = await m.ensureAndroidTools({ baseDir: tmp(), adbReady: true, scrcpyReady: true, force: false, deps: { http } });
    assert.deepStrictEqual(errors, []);
    assert.strictEqual(calls, 0);
});

test('localToolPath', () => {
    const base = tmp();
    assert.strictEqual(m.localToolPath(base, 'adb', 'darwin'), null);
    fs.mkdirSync(path.join(base, 'platform-tools'));
    fs.writeFileSync(path.join(base, 'platform-tools', 'adb'), '', { mode: 0o755 });
    assert.strictEqual(m.localToolPath(base, 'adb', 'darwin'), path.join(base, 'platform-tools', 'adb'));
});

test('replaceDir mantém a instalação anterior se o rename falhar', () => {
    const base = tmp();
    const to = path.join(base, 'dest');
    fs.mkdirSync(to);
    fs.writeFileSync(path.join(to, 'velho'), '1');
    assert.throws(() => m.replaceDir(path.join(base, 'nao-existe'), to));
    assert.ok(fs.existsSync(path.join(to, 'velho')));
    assert.ok(!fs.existsSync(to + '.old'));
});

test('replaceDir troca e remove a cópia antiga', () => {
    const base = tmp();
    const to = path.join(base, 'dest');
    const from = path.join(base, 'novo');
    fs.mkdirSync(to);
    fs.mkdirSync(from);
    fs.writeFileSync(path.join(from, 'novo'), '2');
    m.replaceDir(from, to);
    assert.ok(fs.existsSync(path.join(to, 'novo')));
    assert.ok(!fs.existsSync(to + '.old'));
});

test('sweepTemp remove temporários órfãos e preserva o resto', () => {
    const base = tmp();
    fs.mkdirSync(path.join(base, 'adb-tmp-x'));
    fs.mkdirSync(path.join(base, 'scrcpy-tmp-y'));
    fs.mkdirSync(path.join(base, 'platform-tools'));
    m.sweepTemp(base);
    assert.deepStrictEqual(fs.readdirSync(base), ['platform-tools']);
});

test('fetchBuffer revalida cada redirect via beforeRedirect', async () => {
    let cfg;
    const http = async (c) => { cfg = c; return { data: Buffer.from('ok') }; };
    await m.fetchBuffer(http, 'https://dl.google.com/x');
    assert.doesNotThrow(() => cfg.beforeRedirect({ protocol: 'https:', hostname: 'objects.githubusercontent.com', path: '/a' }));
    assert.throws(() => cfg.beforeRedirect({ protocol: 'https:', hostname: 'evil.example.com', path: '/a' }));
    assert.throws(() => cfg.beforeRedirect({ protocol: 'http:', hostname: 'dl.google.com', path: '/a' }));
});

test('ensureForService devolve pronto sem baixar e falha com mensagem clara', async () => {
    const base = tmp();
    const eventos = [];
    const svc = { baseDir: base, adbPath: path.join(base, 'adb'), scrcpyPath: path.join(base, 'scrcpy'), isProvisioning: false, sendToFrontend: (e, p) => eventos.push(p) };
    fs.writeFileSync(svc.adbPath, 'x');
    fs.writeFileSync(svc.scrcpyPath, 'x');
    const ok = await m.ensureForService(svc, false, 'darwin');
    assert.strictEqual(ok.success, true);
    assert.strictEqual(eventos.length, 0);
    const emAndamento = { ...svc, isProvisioning: true };
    const busy = await m.ensureForService(emAndamento, true, 'darwin');
    assert.strictEqual(busy.success, true);
    assert.strictEqual(emAndamento.isProvisioning, true);
});

const xmlWin = (hash) => `<remotePackage path="platform-tools"><archives><archive><complete><checksum type="sha1">${'a'.repeat(40)}</checksum></complete><host-os>macosx</host-os></archive><archive><complete><checksum type="sha1">${hash}</checksum></complete><host-os>windows</host-os></archive></archives></remotePackage>`;

function winRunner(layout, chamadas = []) {
    return async (file, args, opts) => {
        chamadas.push({ file, args, opts });
        for (const f of layout) {
            fs.mkdirSync(path.dirname(path.join(opts.env.NOVA_DESTINO, f)), { recursive: true });
            fs.writeFileSync(path.join(opts.env.NOVA_DESTINO, f), 'bin');
        }
    };
}

test('parse pega só hashes windows', () => {
    assert.deepStrictEqual(m.parsePlatformToolsSha1(xmlWin('d'.repeat(40)), 'windows'), ['d'.repeat(40)]);
});

test('scrcpyRelease do Windows é a v5.0.1 com sha256 fixo', () => {
    const rel = m.scrcpyRelease('x64', 'win32');
    assert.strictEqual(rel.url, 'https://github.com/Genymobile/scrcpy/releases/download/v5.0.1/scrcpy-win64-v5.0.1.zip');
    assert.strictEqual(rel.sha256, 'b12a2c4ee8be317422451fc7dcf8ee20a71b5ea7ef9ad73ddd825a25316227a5');
    assert.throws(() => m.scrcpyRelease('arm64', 'win32'), /Windows/);
});

test('installAdb no Windows confere sha1, extrai sem interpolar o caminho e instala adb.exe', async () => {
    const base = path.join(tmp(), 'com espaço \'; $(x)');
    fs.mkdirSync(base, { recursive: true });
    const zip = Buffer.from('zipwin');
    const urls = [];
    const http = async ({ url }) => { urls.push(url); return { data: url.endsWith('.xml') ? Buffer.from(xmlWin(sha(zip, 'sha1'))) : zip }; };
    const chamadas = [];
    const p = await m.installAdb(base, { http, platform: 'win32', runner: winRunner(['platform-tools/adb.exe'], chamadas) });
    assert.strictEqual(p, path.join(base, 'platform-tools', 'adb.exe'));
    assert.ok(urls[0].endsWith('platform-tools-latest-windows.zip'));
    assert.strictEqual(chamadas.length, 1);
    assert.strictEqual(chamadas[0].file, 'powershell.exe');
    assert.ok(chamadas[0].args.every(a => !a.includes(base)));
    assert.match(chamadas[0].args.join(' '), /Expand-Archive -LiteralPath \$env:NOVA_ARCHIVE/);
    assert.ok(chamadas[0].opts.env.NOVA_ARCHIVE.endsWith('platform-tools.zip'));
    assert.deepStrictEqual(fs.readdirSync(base), ['platform-tools']);
});

test('installAdb no Windows recusa hash do macOS e não instala', async () => {
    const base = tmp();
    const zip = Buffer.from('zipwin');
    const http = async ({ url }) => ({ data: url.endsWith('.xml') ? Buffer.from(xmlWin('c'.repeat(40))) : zip });
    await assert.rejects(m.installAdb(base, { http, platform: 'win32', runner: winRunner([]) }), /não confere/);
    assert.deepStrictEqual(fs.readdirSync(base), []);
});

test('installAdb recusa plataforma sem download', async () => {
    await assert.rejects(m.installAdb(tmp(), { platform: 'linux', http: async () => ({ data: '' }) }), /plataforma/);
});

test('installScrcpy no Windows confere sha256 e instala scrcpy.exe', async () => {
    const base = tmp();
    const bad = async () => ({ data: Buffer.from('outra coisa') });
    await assert.rejects(m.installScrcpy(base, { http: bad, platform: 'win32', arch: 'x64' }), /não confere/);
    assert.deepStrictEqual(fs.readdirSync(base), []);
});

test('installScrcpy no Windows com pacote bom troca a pasta e devolve scrcpy.exe', async () => {
    const base = tmp();
    const zip = Buffer.from('zipscrcpy');
    const release = { ...m.scrcpyRelease('x64', 'win32'), sha256: sha(zip, 'sha256') };
    const http = async () => ({ data: zip });
    const runner = winRunner([`${release.name}/scrcpy.exe`, `${release.name}/scrcpy-server`, `${release.name}/adb.exe`]);
    const p = await m.installScrcpy(base, { http, platform: 'win32', release, runner });
    assert.strictEqual(p, path.join(base, 'scrcpy', 'scrcpy.exe'));
    assert.ok(fs.existsSync(path.join(base, 'scrcpy', 'scrcpy-server')));
    assert.deepStrictEqual(fs.readdirSync(base), ['scrcpy']);
});

test('installScrcpy no Windows sem scrcpy.exe no pacote falha', async () => {
    const base = tmp();
    const zip = Buffer.from('zipscrcpy');
    const release = { ...m.scrcpyRelease('x64', 'win32'), sha256: sha(zip, 'sha256') };
    await assert.rejects(m.installScrcpy(base, { http: async () => ({ data: zip }), platform: 'win32', release, runner: winRunner([]) }), /não contém/);
});

test('localToolPath no Windows usa .exe', () => {
    const base = tmp();
    fs.mkdirSync(path.join(base, 'scrcpy'));
    fs.writeFileSync(path.join(base, 'scrcpy', 'scrcpy.exe'), '', { mode: 0o755 });
    assert.strictEqual(m.localToolPath(base, 'scrcpy', 'win32'), path.join(base, 'scrcpy', 'scrcpy.exe'));
    assert.strictEqual(m.localToolPath(base, 'adb', 'win32'), null);
});

test('ensureForService no Windows falha com mensagem clara e sem dica do brew', async () => {
    const base = tmp();
    const eventos = [];
    const svc = { baseDir: base, adbPath: path.join(base, 'adb.exe'), scrcpyPath: path.join(base, 'scrcpy.exe'), isProvisioning: false, sendToFrontend: (e, p) => eventos.push(p) };
    const http = async () => { throw new Error('offline'); };
    const falha = await m.ensureForService(svc, false, 'win32', { http });
    assert.strictEqual(falha.success, false);
    assert.doesNotMatch(falha.error, /brew/);
    assert.strictEqual(eventos[eventos.length - 1].stage, 'error');
    assert.strictEqual(svc.isProvisioning, false);
});

test('plataforma sem build oficial não baixa o scrcpy do macOS', async () => {
    assert.throws(() => m.scrcpyRelease('x64', 'linux'), /plataforma/);
    const base = tmp();
    let baixou = false;
    const http = async () => { baixou = true; return { data: Buffer.from('x') }; };
    await assert.rejects(m.installScrcpy(base, { http, platform: 'linux', arch: 'x64' }), /plataforma/);
    assert.strictEqual(baixou, false);
});
