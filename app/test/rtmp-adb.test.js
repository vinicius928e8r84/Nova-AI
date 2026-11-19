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
  encaminharPortaAdb('C:\\Nova\\platform-tools\\adb.exe', (bin, args) => chamadas.push([bin, args]));
  assert.deepStrictEqual(chamadas, [['C:\\Nova\\platform-tools\\adb.exe', ['reverse', 'tcp:1935', 'tcp:11935']]]);
});

test('encaminharPortaAdb sem caminho cai no adb do PATH', () => {
  const chamadas = [];
  encaminharPortaAdb(undefined, (bin) => chamadas.push(bin));
  assert.deepStrictEqual(chamadas, ['adb']);
});

test('encaminharPortaAdb não lança quando o adb falha', () => {
  assert.doesNotThrow(() => encaminharPortaAdb('/x/adb', (b, a, cb) => cb(new Error('sem aparelho'))));
});
