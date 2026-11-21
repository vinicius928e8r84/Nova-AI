'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawnSync } = require('child_process');

const esperado = require('./wake-word-bg.esperado.json');

const ALVO = path.resolve(__dirname, '../wake_word_bg.py');
const PALCO = path.resolve(__dirname, 'ajuda/wake-word-palco.py');
const PYTHON = process.platform === 'win32' ? 'python' : 'python3';

const FALAS_VARIADAS = [
  ['texto', 'Hey Nic open the notes'],
  ['texto', 'unicorn nic play music'],
  ['texto', 'what time is it'],
  ['texto', 'play some music'],
  ['texto', 'nic'],
  ['desconhecido', ''],
  ['requisicao', 'sem rede'],
  ['erro', 'quota "excedida"'],
  ['escuta_falha', 'microfone caiu'],
  ['texto', 'olá electronic mundo'],
];

const cenas = {
  'sem sounddevice: microfone padrão ouve, reconhece e sai com 0': { sounddevice: 'ausente', falas: FALAS_VARIADAS },
  'sounddevice com OSError cai no microfone padrão': { sounddevice: 'oserror', falas: [['texto', 'tonic water']] },
  'microfone padrão não cria (sem PyAudio)': { sounddevice: 'ausente', microfone_falha: true },
  'microfone padrão não abre (sem entrada)': { sounddevice: 'ausente', entrada_falha: true },
  'Mac: consulta a entrada, abre o RawInputStream, lê e fecha': { falas: [['texto', 'Hey Nic open the notes'], ['requisicao', 'sem rede']] },
  'Mac: consulta de dispositivo falha': { consulta_falha: true },
  'Mac: RawInputStream não abre': { stream_falha: true },
};

test('toda cena tem registro esperado', () => {
  assert.deepStrictEqual(Object.keys(cenas), Object.keys(esperado));
});

for (const [nome, cena] of Object.entries(cenas)) {
  test(`wake_word_bg.py: ${nome}`, t => {
    const rodada = spawnSync(PYTHON, ['-I', PALCO, ALVO, JSON.stringify(cena)], { encoding: 'utf8', windowsHide: true });
    if (rodada.error && rodada.error.code === 'ENOENT') return t.skip(`${PYTHON} não está no PATH`);
    assert.strictEqual(rodada.stderr, '');
    assert.strictEqual(rodada.status, 0);
    assert.deepStrictEqual(JSON.parse(rodada.stdout), esperado[nome]);
  });
}
