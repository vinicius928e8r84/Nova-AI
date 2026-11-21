'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { textoDoAviso, avisarFalhaRepetida } = require('../whatsapp-aviso');

test('mac aponta Gerenciamento de apps e Microfone', () => {
  const t = textoDoAviso('darwin', 8);
  assert.match(t, /Gerenciamento de apps/);
  assert.match(t, /Microfone/);
});

test('windows aponta firewall, antivirus e pasta', () => {
  const t = textoDoAviso('win32', 8);
  assert.match(t, /firewall/i);
  assert.match(t, /antiv[ií]rus/i);
  assert.match(t, /pasta/i);
});

test('outro sistema recebe o aviso generico', () => {
  const t = textoDoAviso('linux', 8);
  assert.match(t, /8 tentativas/);
  assert.doesNotMatch(t, /Gerenciamento de apps|firewall/i);
});

test('todo texto informa a falha repetida', () => {
  for (const p of ['darwin', 'win32', 'linux']) assert.match(textoDoAviso(p, 8), /8 tentativas/);
});

test('avisa pela interface com o texto do sistema', async () => {
  const vistos = [];
  const texto = avisarFalhaRepetida({ platform: 'win32', tentativas: 8, mostrar: m => vistos.push(m) });
  await new Promise(r => setImmediate(r));
  assert.deepStrictEqual(vistos, [texto]);
  assert.strictEqual(texto, textoDoAviso('win32', 8));
});

test('o numero de tentativas vem do parametro', () => {
  assert.match(textoDoAviso('darwin', 5), /5 tentativas/);
});

async function registrandoErros(acao) {
  const erros = [];
  const original = console.error;
  console.error = (...a) => erros.push(a.join(' '));
  try {
    acao();
    await new Promise(r => setImmediate(r));
  } finally {
    console.error = original;
  }
  return erros;
}

test('falha sincrona ao mostrar o aviso e registrada', async () => {
  const erros = await registrandoErros(() => avisarFalhaRepetida({ platform: 'darwin', tentativas: 8, mostrar: () => { throw new Error('boom'); } }));
  assert.strictEqual(erros.length, 1);
  assert.match(erros[0], /\[WhatsApp\].*boom/);
});

test('promessa rejeitada ao mostrar o aviso e registrada', async () => {
  const erros = await registrandoErros(() => avisarFalhaRepetida({ platform: 'win32', tentativas: 8, mostrar: () => Promise.reject(new Error('negado')) }));
  assert.strictEqual(erros.length, 1);
  assert.match(erros[0], /\[WhatsApp\].*negado/);
});
