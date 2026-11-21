'use strict';

const AAC = { t0Ms: 900, bitrateKbps: 96, onAsc: true, onPacket: true, onError: true };

const CENAS = [
  {
    nome: 'mixer: attach inválido, idempotente, troca de elemento, fonte reaproveitada e parâmetros pendentes',
    passos: [
      ['attach', undefined, 'v1'], ['attach', null, 'v1'], ['attach', 'a', null],
      ['setParams', 'a', { volume: 0.5, muted: true }], ['setParams', 'b', null],
      ['attach', 'a', 'v1'], ['attach', 'a', 'v1'], ['attach', 'a', 'v2'], ['attach', 7, 'v1'], ['attach', 'b', 'v2'],
      ['detach', 'nao-existe'], ['detach', 7], ['attach', '7', 'v1'],
    ],
  },
  {
    nome: 'parâmetros: volume fora da faixa, NaN e texto, visível, mudo e monitor, com rampa que lança',
    opcoes: { rampaLanca: true },
    passos: [
      ['attach', 'c', 'v1'],
      ['setParams', 'c', { volume: 2 }], ['setParams', 'c', { volume: -1 }], ['setParams', 'c', { volume: 'alto' }],
      ['setParams', 'c', { volume: 0.3, visible: false }], ['setParams', 'c', { visible: 1, muted: 0, monitor: 'sim' }],
      ['setParams', 'c', { muted: true }], ['setParams', 'c', {}], ['setParams', 'p', { monitor: true, visible: 0 }], ['attach', 'p', 'v2'],
    ],
  },
  {
    nome: 'níveis e retomada: sem contexto, com amostras, contexto suspenso, fechado e recriado',
    opcoes: { estadoInicial: 'suspended' },
    passos: [
      ['levels'], ['resume'], ['attach', 'n', 'v1'], ['resume'],
      ['amostras', 'an1', [0.5, -0.9, 0.1]], ['amostras', 'an2', [0.000001]], ['levels'],
      ['estado', 'closed'], ['levels'], ['resume'], ['attach', 'n2', 'v3'], ['levels'],
    ],
  },
  {
    nome: 'retomada que falha e Web Audio ausente',
    opcoes: { estadoInicial: 'suspended', resume: 'rejeita' },
    passos: [['attach', 'x', 'v1'], ['resume'], ['estado', 'interrupted'], ['resume']],
  },
  {
    nome: 'sem AudioContext o attach falha e a captura explica',
    opcoes: { semAudioContext: true },
    passos: [['attach', 'x', 'v1'], ['startCapture', { rawPcm: true, onPcm: true }], ['levels'], ['resume']],
  },
  {
    nome: 'webkitAudioContext e fonte recusada',
    opcoes: { webkit: true, fonteLanca: ['ruim'] },
    passos: [['attach', 'r', 'ruim'], ['attach', 'b', 'bom']],
  },
  {
    nome: 'suporte: sem AudioEncoder, memorizado',
    opcoes: { semAudioEncoder: true },
    passos: [['supported'], ['supported'], ['startCapture', AAC]],
  },
  {
    nome: 'suporte: sem AudioWorkletNode',
    opcoes: { semWorkletNode: true },
    passos: [['supported']],
  },
  {
    nome: 'suporte: recusado, nulo e com erro',
    opcoes: { suporte: 'nao' },
    passos: [['supported'], ['opcao', 'suporte', 'nulo'], ['supported']],
  },
  {
    nome: 'suporte que lança',
    opcoes: { suporte: 'lanca' },
    passos: [['supported']],
  },
  {
    nome: 'captura AAC: validações, blocos que cruzam o limite, ASC uma vez, pacotes e parada com silêncio',
    opcoes: { encoderEmite: true },
    passos: [
      ['startCapture', null], ['startCapture', { onPacket: false }], ['startCapture', { rawPcm: true }],
      ['agora', 2000], ['startCapture', AAC], ['startCapture', AAC],
      ['bloco', 128, 0.1, 0.2], ['bloco', 1000, 0.3, -0.3], ['bloco', 1000, 2, -2], ['agora', 9000], ['bloco', 128, 0, 0],
      ['stopCapture'], ['stopCapture'], ['bloco', 128, 0.1, 0.1],
    ],
  },
  {
    nome: 'captura AAC sem t0Ms, sem bitrate e sem onAsc; consumidor que lança vira erro uma vez só',
    opcoes: { encoderEmite: true },
    passos: [
      ['agora', 5000], ['startCapture', { onPacket: true, lancaNoPacote: true, onError: true }],
      ['bloco', 1024, 0.1, 0.1], ['bloco', 1024, 0.1, 0.1], ['erroDoEncoder', 'depois'], ['stopCapture'],
    ],
  },
  {
    nome: 'captura AAC: erro do encoder, do processador e encode que lança; flush e porta que lançam',
    opcoes: { flushLanca: true, portCloseLanca: true, disconnectLanca: true },
    passos: [
      ['startCapture', { onPacket: true, onError: true, bitrateKbps: -5, t0Ms: 'x' }], ['erroDoEncoder', 'codec caiu'], ['erroDoProcessador'],
      ['bloco', 1024, 0.1, 0.1], ['stopCapture'],
      ['startCapture', { onPacket: true }], ['erroDoProcessador'], ['stopCapture'],
      ['opcao', 'encodeLanca', true], ['startCapture', { onPacket: true, onError: true }], ['bloco', 1024, 0.1, 0.1], ['stopCapture'],
    ],
  },
  {
    nome: 'captura AAC parada sem bloco incompleto, sem base e depois de falha',
    opcoes: { encoderEmite: true },
    passos: [
      ['startCapture', { onPacket: true }], ['stopCapture'],
      ['startCapture', { onPacket: true }], ['bloco', 1024, 0.2, 0.2], ['stopCapture'],
      ['startCapture', { onPacket: true }], ['bloco', 100, 0.2, 0.2], ['erroDoProcessador'], ['stopCapture'],
    ],
  },
  {
    nome: 'captura AAC com o encoder fechado por fora: blocos ignorados e parada sem flush',
    opcoes: { encoderEmite: true },
    passos: [
      ['startCapture', { onPacket: true }], ['bloco', 1024, 0.1, 0.1], ['estadoDoEncoder', 'closed'], ['bloco', 1024, 0.1, 0.1], ['stopCapture'],
      ['startCapture', { onPacket: true }], ['bloco', 600, 0.1, 0.1], ['estadoDoEncoder', 'unconfigured'], ['stopCapture'],
    ],
  },
  {
    nome: 'captura PCM: amostras somadas, saturadas e arredondadas; contexto recriado refaz o worklet',
    passos: [
      ['agora', 3000], ['startCapture', { rawPcm: true, onPcm: true }], ['bloco', 1024, 0.5, 0.25], ['bloco', 1024, 3, 3], ['bloco', 1024, -3, -3],
      ['bloco', 500, -0.5, 0.1], ['stopCapture'],
      ['estado', 'closed'], ['startCapture', { rawPcm: true, onPcm: true }], ['stopCapture'],
    ],
  },
  {
    nome: 'captura com contexto suspenso: retomada que nunca chega, que chega e que lança',
    opcoes: { estadoInicial: 'suspended', resume: 'nunca' },
    passos: [
      ['startCapture', { rawPcm: true, onPcm: true }],
      ['opcao', 'resume', 'resolve'], ['startCapture', { rawPcm: true, onPcm: true }], ['stopCapture'],
      ['estado', 'suspended'], ['opcao', 'resume', 'rejeita'], ['startCapture', { rawPcm: true, onPcm: true }],
    ],
  },
  {
    nome: 'captura que falha ao montar: worklet recusado e nó do processador que lança',
    opcoes: { addModuleFalha: true },
    passos: [
      ['startCapture', AAC], ['opcao', 'addModuleFalha', false], ['opcao', 'workletNodeLanca', true], ['startCapture', AAC],
      ['opcao', 'workletNodeLanca', false], ['startCapture', { rawPcm: true, onPcm: true }], ['stopCapture'], ['bloco', 128, 0.1, 0.2], ['erroDoProcessador'],
    ],
  },
];

module.exports = { CENAS };
