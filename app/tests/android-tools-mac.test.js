'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const m = require('../electron/services/android-tools-mac');

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
    const p = await m.installAdb(base, { http, runner: fakeRunner(['platform-tools/adb']) });
    assert.strictEqual(p, path.join(base, 'platform-tools', 'adb'));
    assert.ok(fs.statSync(p).mode & 0o100);
    assert.deepStrictEqual(fs.readdirSync(base), ['platform-tools']);
});

test('installAdb com hash errado falha e não instala', async () => {
    const base = tmp();
    const http = async ({ url }) => ({ data: url.endsWith('.xml') ? Buffer.from(xmlFor('c'.repeat(40))) : Buffer.from('zipdata') });
    await assert.rejects(m.installAdb(base, { http, runner: fakeRunner([]) }), /não confere/);
    assert.deepStrictEqual(fs.readdirSync(base), []);
});

test('installAdb sem hash no manifesto falha', async () => {
    const base = tmp();
    const http = async ({ url }) => ({ data: url.endsWith('.xml') ? Buffer.from('<x/>') : Buffer.from('z') });
    await assert.rejects(m.installAdb(base, { http, runner: fakeRunner([]) }), /hash oficial/);
});

test('installAdb propaga erro de rede com mensagem clara', async () => {
    const http = async () => { throw new Error('ENOTFOUND'); };
    await assert.rejects(m.installAdb(tmp(), { http }), /Falha ao baixar.*ENOTFOUND/);
});

test('installScrcpy confere sha256 fixo', async () => {
    const base = tmp();
    const bad = async () => ({ data: Buffer.from('outra coisa') });
    await assert.rejects(m.installScrcpy(base, { http: bad, arch: 'arm64' }), /não confere/);
    assert.strictEqual(m.scrcpyRelease('x64').url.startsWith('https://github.com/Genymobile/scrcpy/releases/download/'), true);
    assert.throws(() => m.scrcpyRelease('ia32'), /Arquitetura/);
});

test('ensureMacTools junta erros e não esconde falha', async () => {
    const base = tmp();
    const http = async () => { throw new Error('offline'); };
    const seen = [];
    const errors = await m.ensureMacTools({ baseDir: base, adbReady: false, scrcpyReady: false, force: false, progress: p => seen.push(p.stage), deps: { http, arch: 'arm64' } });
    assert.strictEqual(errors.length, 2);
    assert.deepStrictEqual(seen, ['adb', 'scrcpy']);
});

test('ensureMacTools não baixa o que já existe', async () => {
    let calls = 0;
    const http = async () => { calls++; throw new Error('x'); };
    const errors = await m.ensureMacTools({ baseDir: tmp(), adbReady: true, scrcpyReady: true, force: false, deps: { http } });
    assert.deepStrictEqual(errors, []);
    assert.strictEqual(calls, 0);
});

test('localToolPath', () => {
    const base = tmp();
    assert.strictEqual(m.localToolPath(base, 'adb'), null);
    fs.mkdirSync(path.join(base, 'platform-tools'));
    fs.writeFileSync(path.join(base, 'platform-tools', 'adb'), '', { mode: 0o755 });
    assert.strictEqual(m.localToolPath(base, 'adb'), path.join(base, 'platform-tools', 'adb'));
});
