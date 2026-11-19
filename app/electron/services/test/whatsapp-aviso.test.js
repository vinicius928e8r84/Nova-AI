'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { textoDoAviso, avisarFalhaRepetida } = require('../whatsapp-aviso');

test('mac aponta Gerenciamento de apps e Microfone', () => {
  const t = textoDoAviso('darwin');
  assert.match(t, /Gerenciamento de apps/);
  assert.match(t, /Microfone/);
});

test('windows aponta firewall, antivirus e pasta', () => {
  const t = textoDoAviso('win32');
  assert.match(t, /firewall/i);
  assert.match(t, /antiv[ií]rus/i);
  assert.match(t, /pasta/i);
});

test('outro sistema recebe o aviso generico', () => {
  const t = textoDoAviso('linux');
  assert.match(t, /8 tentativas/);
  assert.doesNotMatch(t, /Gerenciamento de apps|firewall/i);
});

test('todo texto informa a falha repetida', () => {
  for (const p of ['darwin', 'win32', 'linux']) assert.match(textoDoAviso(p), /8 tentativas/);
});

test('avisa pela interface com o texto do sistema', () => {
  const vistos = [];
  const texto = avisarFalhaRepetida({ platform: 'win32', mostrar: m => vistos.push(m) });
  assert.deepStrictEqual(vistos, [texto]);
  assert.strictEqual(texto, textoDoAviso('win32'));
});

test('falha ao mostrar o aviso nao propaga', () => {
  assert.doesNotThrow(() => avisarFalhaRepetida({ platform: 'darwin', mostrar: () => { throw new Error('x'); } }));
});
