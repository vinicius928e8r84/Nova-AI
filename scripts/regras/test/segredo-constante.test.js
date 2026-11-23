'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { criar } = require('./auxiliar');
const { acharNaLinha } = require('../regra-segredo');

function tentar(arquivos, base = {}) {
  const repo = criar(base);
  repo.escrever(arquivos);
  const resultado = repo.rodar('--regra', 'sem-segredo');
  repo.limpar();
  return resultado;
}

const VALOR_CURTO = 'qw@123';
const PAGINA_COM_CODIGO_NO_NAVEGADOR = [
  '<script>',
  `  const ADMIN_SECRET = "${VALOR_CURTO}";`,
  '  if (digitado === ADMIN_SECRET) abrir();',
  '</script>',
  '',
].join('\n');

test('constante com nome de segredo e valor curto escrito no HTML falha, sem mostrar o valor', () => {
  const r = tentar({ 'app/electron/pwa/admin.html': PAGINA_COM_CODIGO_NO_NAVEGADOR });
  assert.equal(r.codigo, 1, r.saida);
  assert.ok(r.saida.includes('app/electron/pwa/admin.html:2'), r.saida);
  assert.ok(!r.saida.includes(VALOR_CURTO), 'o valor não pode aparecer na saída');
});

test('constante de segredo escrita em JS, em Python e com dois pontos falha', () => {
  const linhas = [
    `const SENHA_DO_PAINEL='${VALOR_CURTO}';`,
    `ADMIN_PASSWORD = "${VALOR_CURTO}"`,
    `const config = { PASSCODE: '${VALOR_CURTO}' };`,
  ];
  for (const linha of linhas) assert.equal(acharNaLinha(linha), 'constante de segredo com valor escrito', linha);
});

test('constante lida do ambiente, com placeholder, vazia ou com nome que não é de segredo passa', () => {
  const linhas = [
    'const ADMIN_SECRET = process.env.NOVA_ADMIN_CODE;',
    'const ADMIN_SECRET = "seu_valor_aqui";',
    'const ADMIN_SECRET = "";',
    'const ADMIN_SECRET = "senha";',
    'const MAX_PASSWORD_LENGTH = 128;',
    `const CHAVE_DA_SESSAO = '${VALOR_CURTO}';`,
    `const secret = "${VALOR_CURTO}";`,
  ];
  for (const linha of linhas) assert.equal(acharNaLinha(linha), null, linha);
});

test('a mesma constante em arquivo de teste passa, porque ali o valor é de mentira', () => {
  const r = tentar({ 'app/test/exemplo.test.js': PAGINA_COM_CODIGO_NO_NAVEGADOR });
  assert.equal(r.codigo, 0, r.saida);
});

test('constante antiga que a PR não toca não falha; a nova na mesma página falha', () => {
  const base = { 'app/electron/pwa/admin.html': PAGINA_COM_CODIGO_NO_NAVEGADOR };
  const intocada = tentar({ 'app/electron/pwa/admin.html': `${PAGINA_COM_CODIGO_NO_NAVEGADOR}<p>fim</p>\n` }, base);
  assert.equal(intocada.codigo, 0, intocada.saida);
  const nova = tentar({ 'app/electron/pwa/admin.html': `${PAGINA_COM_CODIGO_NO_NAVEGADOR}<script>const OUTRO_SECRET = "${VALOR_CURTO}";</script>\n` }, base);
  assert.equal(nova.codigo, 1, nova.saida);
});
