'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const RemoteAccessService = require('../remote-access');

const PASTA_DO_PWA = path.join(__dirname, '..', '..', 'pwa');
const LIGACAO_DO_ESTILO = /<link rel="stylesheet" href="([^"]+)">/;

function abrirAcessoRemoto() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-acesso-remoto-'));
  const servico = new RemoteAccessService({ getPath: () => userData });
  const servidor = http.createServer((req, res) => servico.servePWA(req, res));
  return new Promise(resolve => {
    servidor.listen(0, '127.0.0.1', () => resolve({
      servidor,
      userData,
      endereco: `http://127.0.0.1:${servidor.address().port}`,
    }));
  });
}

test('admin.html pelo acesso remoto chega com o estilo servido como CSS', async () => {
  const acesso = await abrirAcessoRemoto();
  try {
    const pagina = await fetch(`${acesso.endereco}/admin.html`);
    const html = await pagina.text();
    assert.strictEqual(pagina.status, 200);
    assert.strictEqual(pagina.headers.get('content-type'), 'text/html');
    assert.deepStrictEqual(html, fs.readFileSync(path.join(PASTA_DO_PWA, 'admin.html'), 'utf8'));

    const ligacao = html.match(LIGACAO_DO_ESTILO);
    assert.ok(ligacao, 'admin.html não liga uma folha de estilo');
    const estilo = await fetch(`${acesso.endereco}/${ligacao[1]}`);
    assert.strictEqual(estilo.status, 200);
    assert.strictEqual(estilo.headers.get('content-type'), 'text/css');
    assert.deepStrictEqual(await estilo.text(), fs.readFileSync(path.join(PASTA_DO_PWA, ligacao[1]), 'utf8'));
  } finally {
    acesso.servidor.close();
    fs.rmSync(acesso.userData, { recursive: true, force: true });
  }
});
