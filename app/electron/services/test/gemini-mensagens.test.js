'use strict';
const test = require('node:test');
const assert = require('node:assert');

const { partesDoPedido, parteDaImagem } = require('../gemini-mensagens');

test('parteDaImagem lê o tipo e o conteúdo de um data url', () => {
  assert.deepStrictEqual(parteDaImagem('data:image/jpeg;base64,QUJD'), { inlineData: { mimeType: 'image/jpeg', data: 'QUJD' } });
  assert.deepStrictEqual(parteDaImagem('data:application/pdf;base64,REVG'), { inlineData: { mimeType: 'application/pdf', data: 'REVG' } });
});

test('parteDaImagem sem prefixo assume image/png e mantém o texto', () => {
  assert.deepStrictEqual(parteDaImagem('QUJD'), { inlineData: { mimeType: 'image/png', data: 'QUJD' } });
});

test('partesDoPedido põe o contexto, o pedido e a imagem nesta ordem', () => {
  const historico = [{ role: 'user', text: 'oi' }, { role: 'model', text: 'ola' }];
  const partes = partesDoPedido('segue', 'data:image/gif;base64,R0lG', historico);
  assert.deepStrictEqual(partes, [
    { text: '[Conversation Context]\nUser: oi\nNova: ola\n\n[Current Request]' },
    { text: 'segue' },
    { inlineData: { mimeType: 'image/gif', data: 'R0lG' } },
  ]);
  assert.deepStrictEqual(partesDoPedido('só texto', null, []), [{ text: 'só texto' }]);
});
