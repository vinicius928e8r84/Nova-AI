'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const idioma = require('../electron/services/idioma-ipc');

const mainJs = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');

test('idioma-ipc registra sozinho os canais de idioma que a interface usa', () => {
    const canais = [];
    idioma.register({ log() {} }, { handle: (canal) => canais.push(canal) }, { exec: async () => ({ code: 0, stdout: '', stderr: '' }) });
    for (const canal of ['spoofer:get-language', 'spoofer:apply-language', 'spoofer:revert-language']) assert.ok(canais.includes(canal), canal);
});

test('main.js registra idioma-ipc e não referencia mais identidade-ipc', () => {
    assert.match(mainJs, /require\('\.\/services\/idioma-ipc'\)\.register\(app, ipcMain\)/);
    assert.doesNotMatch(mainJs, /identidade-ipc/);
    assert.equal(fs.existsSync(path.join(__dirname, '..', 'electron', 'services', 'identidade-ipc.js')), false);
    const fisico = fs.readFileSync(path.join(__dirname, '..', 'electron', 'services', 'physicalMobileService.js'), 'utf8');
    assert.doesNotMatch(fisico, /languageForCountry/);
});

test('não sobra cópia do módulo apagado nem instalador que o recoloca', () => {
    const pasta = path.join(__dirname, '..', '..', 'iphone', 'identidade-iphone');
    assert.equal(fs.existsSync(pasta), false);
});
