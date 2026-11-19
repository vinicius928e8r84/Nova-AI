const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');
const bplistCreator = require('bplist-creator');
const bplistParser = require('bplist-parser');
const plist = require('plist');

const FIXTURE = path.join(__dirname, 'fixtures', 'GlobalPreferences-exemplo.plist');
const chamadas = [];
const execFileOriginal = childProcess.execFile;
childProcess.execFile = (cmd, args, cb) => {
    chamadas.push([cmd, ...args]);
    const saida = args.includes('-extract') ? 'pt-BR\n' : '';
    process.nextTick(() => cb(null, saida));
};
const plistPrefs = require('../plist-prefs');
test.after(() => { childProcess.execFile = execFileOriginal; });

function copiaTmp(nome) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plist-prefs-'));
    const destino = path.join(dir, nome);
    fs.copyFileSync(FIXTURE, destino);
    return destino;
}

test('win32: XML troca idioma/região e preserva as outras chaves', async () => {
    const f = copiaTmp('a.plist');
    await plistPrefs.aplicarIdiomaLocale(f, 'pt-BR', 'pt_BR', 'win32');
    const obj = plist.parse(fs.readFileSync(f, 'utf8'));
    assert.deepStrictEqual(obj.AppleLanguages, ['pt-BR']);
    assert.strictEqual(obj.AppleLocale, 'pt_BR');
    assert.deepStrictEqual(obj.AppleKeyboards, ['en_US@sw=QWERTY;hw=Automatic']);
    assert.strictEqual(await plistPrefs.lerPrimeiroIdioma(f, 'win32'), 'pt-BR');
});

test('win32: plist binário vira XML com idioma/região novos', async () => {
    const f = copiaTmp('b.plist');
    const original = plist.parse(fs.readFileSync(f, 'utf8'));
    fs.writeFileSync(f, bplistCreator(original));
    assert.strictEqual(fs.readFileSync(f).slice(0, 6).toString('latin1'), 'bplist');
    assert.strictEqual(await plistPrefs.lerPrimeiroIdioma(f, 'win32'), 'en-US');
    await plistPrefs.aplicarIdiomaLocale(f, 'es-MX', 'es_MX', 'win32');
    const obj = plist.parse(fs.readFileSync(f, 'utf8'));
    assert.deepStrictEqual(obj.AppleLanguages, ['es-MX']);
    assert.strictEqual(obj.AppleLocale, 'es_MX');
    assert.ok(bplistParser.parseBuffer(bplistCreator(obj))[0].AppleKeyboards);
});

test('win32: arquivo ausente ou inválido devolve null na leitura', async () => {
    assert.strictEqual(await plistPrefs.lerPrimeiroIdioma(path.join(os.tmpdir(), 'nao-existe.plist'), 'win32'), null);
    const f = copiaTmp('c.plist');
    fs.writeFileSync(f, '<<<lixo');
    assert.strictEqual(await plistPrefs.lerPrimeiroIdioma(f, 'win32'), null);
});

test('darwin: mantém exatamente os comandos plutil de antes', async () => {
    chamadas.length = 0;
    await plistPrefs.aplicarIdiomaLocale('/tmp/x.plist', 'pt-BR', 'pt_BR', 'darwin');
    assert.deepStrictEqual(chamadas, [
        ['/usr/bin/plutil', '-convert', 'xml1', '/tmp/x.plist'],
        ['/usr/bin/plutil', '-replace', 'AppleLanguages', '-json', '["pt-BR"]', '/tmp/x.plist'],
        ['/usr/bin/plutil', '-replace', 'AppleLocale', '-string', 'pt_BR', '/tmp/x.plist'],
    ]);
    chamadas.length = 0;
    assert.strictEqual(await plistPrefs.lerPrimeiroIdioma('/tmp/x.plist', 'darwin'), 'pt-BR');
    assert.deepStrictEqual(chamadas, [['/usr/bin/plutil', '-extract', 'AppleLanguages.0', 'raw', '-o', '-', '/tmp/x.plist']]);
});
