const test = require('node:test');
const assert = require('node:assert');
const toolPaths = require('../tool-paths');

function achar(plataforma, existentes) {
    return toolPaths.tool('cloudflared', {
        platform: plataforma,
        resourcesPath: plataforma === 'win32' ? 'C:\\Nova\\resources' : '/Nova/resources',
        dirname: plataforma === 'win32' ? 'C:\\Nova\\app\\electron\\services' : '/Nova/app/electron/services',
        cwd: plataforma === 'win32' ? 'C:\\Nova' : '/Nova',
        homedir: plataforma === 'win32' ? 'C:\\Users\\a' : '/Users/a',
        env: { PATH: plataforma === 'win32' ? 'C:\\Tools' : '/opt/tools' },
        exists: (f) => existentes.includes(f)
    });
}

test('Windows acha cloudflared.exe em resources\\bin', () => {
    assert.strictEqual(achar('win32', ['C:\\Nova\\resources\\bin\\cloudflared.exe']), 'C:\\Nova\\resources\\bin\\cloudflared.exe');
});

test('Windows acha cloudflared.exe no PATH', () => {
    assert.strictEqual(achar('win32', ['C:\\Tools\\cloudflared.exe']), 'C:\\Tools\\cloudflared.exe');
});

test('Mac acha cloudflared no Homebrew', () => {
    assert.strictEqual(achar('darwin', ['/opt/homebrew/bin/cloudflared']), '/opt/homebrew/bin/cloudflared');
});

test('sem binário devolve null', () => {
    assert.strictEqual(achar('win32', []), null);
});
