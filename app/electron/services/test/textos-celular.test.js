const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const base = path.join(__dirname, '..');
const arquivos = ['ios-camera.js', 'physicalMobileService.js', 'iphone-comando.js', 'iphone-proxy.js', 'iphone-controle.js', 'iphone-fuso.js', 'iphone-setup/inapp.js', 'iphone-setup/inapp-visual.js', 'iphone-setup/inapp-console.js', 'iphone-setup/inapp-conectar.js', 'iphone-setup/inapp-console-sozinho.js', 'iphone-setup/setup.js', 'iphone-setup/setup-ssh.js', 'iphone-setup/setup-chaves.js', 'iphone-setup/setup-pacotes.js'];

for (const arquivo of arquivos) {
    test(`${arquivo} não cita Mac nem instalar-iphone.command nas mensagens`, () => {
        const linhas = fs.readFileSync(path.join(base, arquivo), 'utf8').split('\n');
        const achadas = linhas.filter((l) => !l.trim().startsWith("//") && /(no|neste|do|o) Mac\b|instalar-iphone\.command/.test(l));
        assert.deepStrictEqual(achadas, []);
    });
}
