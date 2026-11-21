'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const COPIAS = ['dist', 'public'].map(pasta => path.join(__dirname, '..', pasta, 'audio-processor-worklet.js'));

function carregarProcessador(arquivo) {
  const registrados = {};
  const contexto = {
    Math, Int16Array, Float32Array,
    AudioWorkletProcessor: class { constructor() { this.port = { enviadas: [], postMessage(...args) { this.enviadas.push(args); } }; } },
    registerProcessor: (nome, classe) => { registrados[nome] = classe; },
  };
  vm.runInNewContext(fs.readFileSync(arquivo, 'utf8'), contexto);
  return new registrados['audio-capture-processor']();
}

const ENTRADAS_SEM_AUDIO = [[], [undefined], [null], [[]], [[undefined]], [[null]], [[new Float32Array(0)]]];

const AMOSTRAS = [-2, -1, -0.75, -0.5, -0.0001, 0, 0.0001, 0.5, 0.999, 1, 3, NaN, -0];
const PCM_ESPERADO = [-32768, -32768, -24576, -16384, -3, 0, 3, 16383, 32734, 32767, 32767, 0, 0];

for (const arquivo of COPIAS) {
  const nome = path.relative(path.join(__dirname, '..'), arquivo);

  test(`${nome}: sem áudio no primeiro canal não manda mensagem e segue vivo`, () => {
    const processador = carregarProcessador(arquivo);
    for (const inputs of ENTRADAS_SEM_AUDIO) assert.strictEqual(processador.process(inputs, [], {}), true);
    assert.deepStrictEqual(processador.port.enviadas, []);
  });

  test(`${nome}: converte o primeiro canal para PCM16 e transfere o buffer`, () => {
    const processador = carregarProcessador(arquivo);
    const segundoCanal = new Float32Array([0.25]);
    assert.strictEqual(processador.process([[new Float32Array(AMOSTRAS), segundoCanal], [new Float32Array([1])]], [], {}), true);
    assert.strictEqual(processador.port.enviadas.length, 1);
    const [mensagem, transferidos] = processador.port.enviadas[0];
    assert.deepStrictEqual(Object.keys(mensagem), ['type', 'data']);
    assert.strictEqual(mensagem.type, 'audio-data');
    assert.strictEqual(transferidos.length, 1);
    assert.strictEqual(transferidos[0], mensagem.data);
    assert.deepStrictEqual(Array.from(new Int16Array(mensagem.data)), PCM_ESPERADO);
  });

  test(`${nome}: cada chamada manda um buffer novo`, () => {
    const processador = carregarProcessador(arquivo);
    processador.process([[new Float32Array([0.5])]]);
    processador.process([[new Float32Array([-0.5, 1])]]);
    const buffers = processador.port.enviadas.map(([mensagem]) => mensagem.data);
    assert.notStrictEqual(buffers[0], buffers[1]);
    assert.deepStrictEqual(buffers.map(buffer => Array.from(new Int16Array(buffer))), [[16383], [-16384, 32767]]);
  });
}
