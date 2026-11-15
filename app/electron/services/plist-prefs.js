const { execFile } = require('child_process');
const fs = require('fs');

function plutilMac(args) {
    return new Promise((res, rej) => {
        execFile('/usr/bin/plutil', args, (err, stdout) => (err ? rej(err) : res(stdout)));
    });
}

function lerPlistJs(arquivo) {
    const buf = fs.readFileSync(arquivo);
    if (buf.slice(0, 6).toString('latin1') === 'bplist') {
        const bplistParser = require('bplist-parser');
        const lista = bplistParser.parseBuffer(buf);
        return (lista && lista[0]) || {};
    }
    return require('plist').parse(buf.toString('utf8')) || {};
}

function gravarPlistXmlJs(arquivo, obj) {
    fs.writeFileSync(arquivo, require('plist').build(obj));
}

async function aplicarIdiomaLocale(arquivo, language, locale, plataforma = process.platform) {
    if (plataforma === 'win32') {
        const obj = lerPlistJs(arquivo);
        obj.AppleLanguages = [language];
        obj.AppleLocale = locale;
        gravarPlistXmlJs(arquivo, obj);
        return;
    }
    await plutilMac(['-convert', 'xml1', arquivo]).catch(() => {});
    await plutilMac(['-replace', 'AppleLanguages', '-json', JSON.stringify([language]), arquivo]);
    await plutilMac(['-replace', 'AppleLocale', '-string', locale, arquivo]);
}

async function lerPrimeiroIdioma(arquivo, plataforma = process.platform) {
    if (plataforma === 'win32') {
        try {
            const langs = lerPlistJs(arquivo).AppleLanguages;
            return Array.isArray(langs) && langs.length ? String(langs[0]).trim() : null;
        } catch (_) {
            return null;
        }
    }
    try {
        const out = await plutilMac(['-extract', 'AppleLanguages.0', 'raw', '-o', '-', arquivo]);
        return String(out || '').trim();
    } catch (_) {
        return null;
    }
}

module.exports = { aplicarIdiomaLocale, lerPrimeiroIdioma };
