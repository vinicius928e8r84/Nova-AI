const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');

const carregarOriginal = Module._load;
Module._load = function (pedido, ...resto) {
  if (pedido === 'node-media-server') return class {};
  return carregarOriginal.call(this, pedido, ...resto);
};
const { encaminharPortaAdb } = require('../electron/services/rtmp-server');
Module._load = carregarOriginal;

test('encaminharPortaAdb usa o adb informado, com argumentos separados', () => {
  const chamadas = [];
  encaminharPortaAdb(process.execPath, (bin, args, opcoes) => chamadas.push([bin, args, opcoes.windowsHide]));
  assert.deepStrictEqual(chamadas, [[process.execPath, ['reverse', 'tcp:1935', 'tcp:11935'], true]]);
});

test('encaminharPortaAdb sem caminho cai no adb do PATH', () => {
  const chamadas = [];
  encaminharPortaAdb(undefined, (bin) => chamadas.push(bin));
  assert.deepStrictEqual(chamadas, ['adb']);
});

test('encaminharPortaAdb com caminho que não existe cai no adb do PATH', () => {
  const chamadas = [];
  encaminharPortaAdb('C:\\nao\\existe\\platform-tools\\adb.exe', (bin) => chamadas.push(bin));
  assert.deepStrictEqual(chamadas, ['adb']);
});

test('encaminharPortaAdb não lança quando o adb falha', () => {
  assert.doesNotThrow(() => encaminharPortaAdb('/x/adb', (b, a, o, cb) => cb(new Error('sem aparelho'))));
});
