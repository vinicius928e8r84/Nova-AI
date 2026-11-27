'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { grupoDe, montarLista, formatarMarkdown, lerArgumentos } = require('../lista-do-painel');

const arquivo = (path, nota, linhas, hotspot = false) => ({ path: `Nova-AI/${path}`, code_health: { current_score: nota }, lines_of_code: linhas, hotspot });

test('separa produto, ferramenta e teste pelo caminho', () => {
  assert.equal(grupoDe('app/electron/main.js'), 'produto');
  assert.equal(grupoDe('MAC/proxy-iphone/tool/Upstream.m'), 'produto');
  assert.equal(grupoDe('MAC/integracao-iphone/conexao-usb/proxy-parse.js'), 'produto');
  assert.equal(grupoDe('app/wake_word_bg.py'), 'produto');
  assert.equal(grupoDe('scripts/regras/verificar.js'), 'ferramenta');
  assert.equal(grupoDe('app/scripts/postinstall.js'), 'ferramenta');
  assert.equal(grupoDe('MAC/controle-celular-plataformas/aplicar.py'), 'ferramenta');
  assert.equal(grupoDe('scripts/regras/test/saude.test.js'), 'teste');
  assert.equal(grupoDe('app/electron/services/testes/remote-access.test.js'), 'teste');
  assert.equal(grupoDe('MAC/proxy-iphone/tool/teste/upstream_test.m'), 'teste');
  assert.equal(grupoDe('app/test/ajuda/wake-word-palco.py'), 'teste');
});

test('ordena da pior nota para a melhor e deixa de fora quem não tem nota', () => {
  const lista = montarLista([
    arquivo('app/electron/a.js', 10, 50),
    arquivo('app/electron/main.js', 2.44, 3681, true),
    arquivo('app/electron/b.js', 5.5, 10),
    arquivo('app/electron/c.js', '-', 5),
  ]);
  assert.deepEqual(lista.grupos.produto.map(item => item.caminho), ['app/electron/main.js', 'app/electron/b.js', 'app/electron/a.js']);
  assert.deepEqual(lista.semNota, ['app/electron/c.js']);
  assert.equal(lista.grupos.produto[0].hotspot, true);
});

test('o Markdown traz o commit e quantos estão abaixo de 10 em cada grupo', () => {
  const lista = montarLista([arquivo('app/electron/main.js', 2.44, 3681, true), arquivo('scripts/x.js', 10, 20)]);
  const texto = formatarMarkdown(lista, { id: 154, data: '2026-11-26T17:52:22Z', commit: '352d0b3c879c08fda1a66eaf8ae72f156ac7c964' });
  assert.match(texto, /commit `352d0b3`/);
  assert.match(texto, /### Produto: 1 arquivos com nota, 1 abaixo de 10/);
  assert.match(texto, /### Ferramenta: 1 arquivos com nota, 0 abaixo de 10/);
  assert.match(texto, /\| 1 \| 2,44 \| 3\.681 \| sim \| `app\/electron\/main\.js` \|/);
});

test('recusa argumento desconhecido', () => {
  assert.deepEqual(lerArgumentos(['--analise', '154']), { analise: '154', json: false, ajuda: false });
  assert.throws(() => lerArgumentos(['--token', 'x']), /argumento desconhecido/);
});
