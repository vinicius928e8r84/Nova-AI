'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { AcessoDoAdmin, SessoesDoAdmin, VerificadorDoCodigo, gerarCodigo, gravarCodigo, ARQUIVO_DO_CODIGO } = require('../admin-acesso');
const { definirCodigoDoAdmin } = require('../../../scripts/definir-codigo-admin');
const { LimiteDeTentativas } = require('../limite-tentativas');

const CODIGO_DE_TESTE = 'codigo-de-teste-Zq7!';
const CODIGO_ERRADO = 'outro-codigo-Wx3#';
const DOZE_HORAS_MS = 12 * 60 * 60 * 1000;

const pastasCriadas = [];
function pastaVazia() {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-admin-acesso-'));
  pastasCriadas.push(pasta);
  return pasta;
}
test.after(() => pastasCriadas.forEach(pasta => fs.rmSync(pasta, { recursive: true, force: true })));

function conferirComLimite(limite) {
  return (cliente, validar) => {
    if (limite.bloqueado(cliente)) return 'bloqueado';
    if (validar()) {
      limite.registrarSucesso(cliente);
      return 'valido';
    }
    limite.registrarFalha(cliente);
    return 'invalido';
  };
}

function abrirServidor({ pasta = pastaVazia(), ambiente = {} } = {}) {
  const acesso = new AcessoDoAdmin({ pasta, ambiente, conferirCliente: conferirComLimite(new LimiteDeTentativas()) });
  const servidor = http.createServer((req, res) => {
    if (acesso.ehRota(req)) acesso.atender(req, res, 'cliente-de-teste');
    else {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise(resolve => servidor.listen(0, '127.0.0.1', () => resolve({
    servidor,
    endereco: `http://127.0.0.1:${servidor.address().port}`
  })));
}

const entrar = (endereco, codigo) => fetch(`${endereco}/api/admin-login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ codigo })
});
const perguntarSessao = (endereco, sessao) => fetch(`${endereco}/api/admin-sessao`, { headers: { 'X-Admin-Sessao': sessao } });

async function comServidor(opcoes, usar) {
  const { servidor, endereco } = await abrirServidor(opcoes);
  try {
    await usar(endereco);
  } finally {
    servidor.close();
  }
}

function pastaComCodigo(codigo) {
  const pasta = pastaVazia();
  gravarCodigo(pasta, codigo);
  return pasta;
}

test('código gravado só guarda o resumo, nunca o código', () => {
  const pasta = pastaComCodigo(CODIGO_DE_TESTE);
  assert.ok(!fs.readFileSync(path.join(pasta, ARQUIVO_DO_CODIGO), 'utf8').includes(CODIGO_DE_TESTE));
  const verificador = new VerificadorDoCodigo({ pasta, ambiente: {} });
  assert.strictEqual(verificador.confere(CODIGO_DE_TESTE), true);
  assert.strictEqual(verificador.confere(CODIGO_ERRADO), false);
});

test('sem código configurado nada confere, nem texto vazio nem o que não é texto', () => {
  const verificador = new VerificadorDoCodigo({ pasta: pastaVazia(), ambiente: {} });
  assert.strictEqual(verificador.configurado(), false);
  for (const codigo of ['', 'qualquer', undefined, null, 123, ['a']]) assert.strictEqual(verificador.confere(codigo), false);
});

test('variável de ambiente tem prioridade sobre o arquivo e o código do arquivo deixa de valer', () => {
  const pasta = pastaComCodigo(CODIGO_ERRADO);
  const verificador = new VerificadorDoCodigo({ pasta, ambiente: { NOVA_ADMIN_CODE: CODIGO_DE_TESTE } });
  assert.strictEqual(verificador.confere(CODIGO_DE_TESTE), true);
  assert.strictEqual(verificador.confere(CODIGO_ERRADO), false);
});

test('arquivo corrompido ou com resumo de tamanho errado conta como não configurado', () => {
  const pasta = pastaVazia();
  const caminho = path.join(pasta, ARQUIVO_DO_CODIGO);
  fs.writeFileSync(caminho, '{ isto não é json');
  assert.strictEqual(new VerificadorDoCodigo({ pasta, ambiente: {} }).configurado(), false);
  fs.writeFileSync(caminho, JSON.stringify({ sal: 'ab', hash: 'cd' }));
  assert.strictEqual(new VerificadorDoCodigo({ pasta, ambiente: {} }).configurado(), false);
});

test('o script gera um código forte, grava só o resumo e o código gerado confere', () => {
  const pasta = pastaVazia();
  const codigo = definirCodigoDoAdmin(pasta);
  assert.ok(codigo.length >= 16);
  assert.notStrictEqual(codigo, gerarCodigo());
  assert.ok(!fs.readFileSync(path.join(pasta, ARQUIVO_DO_CODIGO), 'utf8').includes(codigo));
  assert.strictEqual(new VerificadorDoCodigo({ pasta, ambiente: {} }).confere(codigo), true);
});

test('login pelo servidor: o código certo abre sessão e o errado é recusado', () => comServidor({ pasta: pastaComCodigo(CODIGO_DE_TESTE) }, async endereco => {
  const errado = await entrar(endereco, CODIGO_ERRADO);
  assert.strictEqual(errado.status, 401);
  assert.strictEqual((await errado.json()).sessao, undefined);

  const certo = await entrar(endereco, CODIGO_DE_TESTE);
  assert.strictEqual(certo.status, 200);
  const { sessao } = await certo.json();
  assert.match(sessao, /^[0-9a-f]{64}$/);

  assert.strictEqual((await perguntarSessao(endereco, sessao)).status, 200);
  assert.strictEqual((await perguntarSessao(endereco, 'inventada')).status, 401);
  assert.strictEqual((await perguntarSessao(endereco, '')).status, 401);

  await fetch(`${endereco}/api/admin-logout`, { method: 'POST', headers: { 'X-Admin-Sessao': sessao } });
  assert.strictEqual((await perguntarSessao(endereco, sessao)).status, 401);
}));

test('login sem código configurado responde 503 e nunca abre sessão', () => comServidor({}, async endereco => {
  assert.strictEqual((await entrar(endereco, '')).status, 503);
  assert.strictEqual((await entrar(endereco, 'qualquer')).status, 503);
}));

test('corpo que não é JSON, sem código ou com objeto no lugar do código é recusado', () => comServidor({ pasta: pastaComCodigo(CODIGO_DE_TESTE) }, async endereco => {
  const corpos = ['isto não é json', '{}', JSON.stringify({ codigo: { ne: 1 } })];
  for (const corpo of corpos) {
    const resposta = await fetch(`${endereco}/api/admin-login`, { method: 'POST', body: corpo });
    assert.strictEqual(resposta.status, 401);
  }
}));

test('corpo grande demais recebe 413 sem passar pela conferência do código', () => comServidor({ pasta: pastaComCodigo(CODIGO_DE_TESTE) }, async endereco => {
  const resposta = await fetch(`${endereco}/api/admin-login`, { method: 'POST', body: JSON.stringify({ codigo: 'x'.repeat(5000) }) });
  assert.strictEqual(resposta.status, 413);
  assert.strictEqual((await entrar(endereco, CODIGO_DE_TESTE)).status, 200);
}));

test('corpo enorme não é lido até o fim: o servidor fecha a conexão depois do limite', () => comServidor({ pasta: pastaComCodigo(CODIGO_DE_TESTE) }, async endereco => {
  const pedaco = Buffer.alloc(1024 * 1024, 97);
  const total = 64;
  let enviados = 0;
  const { status } = await new Promise(resolve => {
    const pedido = http.request(`${endereco}/api/admin-login`, { method: 'POST', headers: { 'Content-Length': pedaco.length * total } });
    let status = null;
    const terminar = () => resolve({ status });
    pedido.on('response', resposta => { status = resposta.statusCode; resposta.resume(); });
    pedido.on('error', terminar);
    pedido.on('close', terminar);
    const enviar = () => {
      while (enviados < total) {
        enviados += 1;
        if (!pedido.write(pedaco)) return pedido.once('drain', enviar);
      }
      pedido.end();
    };
    enviar();
  });
  assert.ok(status === 413 || status === null, `status ${status}`);
  assert.ok(enviados < total, `o cliente conseguiu enviar os ${total} MB inteiros (${enviados})`);
}));

test('depois de várias tentativas erradas o cliente é bloqueado até com o código certo', () => comServidor({ pasta: pastaComCodigo(CODIGO_DE_TESTE) }, async endereco => {
  for (let i = 0; i < 6; i++) await entrar(endereco, CODIGO_ERRADO);
  assert.strictEqual((await entrar(endereco, CODIGO_DE_TESTE)).status, 429);
}));

test('sessão vence depois de 12 horas e as mais antigas saem quando passa do limite', () => {
  let agora = 1000;
  const sessoes = new SessoesDoAdmin({ agora: () => agora });
  const primeira = sessoes.abrir();
  assert.strictEqual(sessoes.valida(primeira), true);
  agora += DOZE_HORAS_MS + 1;
  assert.strictEqual(sessoes.valida(primeira), false);
  const abertas = Array.from({ length: 60 }, () => sessoes.abrir());
  assert.ok(sessoes.validadeDe.size <= 50);
  assert.strictEqual(sessoes.valida(abertas.at(-1)), true);
  assert.strictEqual(sessoes.valida(abertas[0]), false);
});

test('admin.html não tem código escrito: a conferência vai ao servidor', () => {
  const pasta = path.join(__dirname, '..', '..', 'pwa');
  const arquivos = ['admin.html', ...fs.readdirSync(pasta).filter(nome => /^admin-.*\.js$/.test(nome))];
  const html = arquivos.map(nome => fs.readFileSync(path.join(pasta, nome), 'utf8')).join('\n');
  assert.doesNotMatch(html, /ADMIN_SECRET/);
  assert.doesNotMatch(html, /input\s*===/);
  assert.match(html, /\/api\/admin-login/);
});
