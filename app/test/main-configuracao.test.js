'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { carregarMain } = require('./ajuda/carregar-main');
const { carregarComArranqueCompleto } = require('./ajuda/arranque-completo');

const AUSENTE = Symbol('sem arquivo');
const AGORA = 1790000000000;
const VOZ_PADRAO_DA_ELEVENLABS = '21m00Tcm4TlvDq8ikWAM';
const MODELO_PADRAO_DO_FILHO = 'gemini-3.8-flash';

const LEITORES = [
  { canal: 'get-gemini-token', arquivo: 'secret_key.json', ambiente: 'GEMINI_API_KEY', cenas: [
    [AUSENTE, undefined, null],
    [AUSENTE, 'do-ambiente', 'do-ambiente'],
    ['{"apiKey":"a","geminiKey":"g"}', 'do-ambiente', 'a'],
    ['{"geminiKey":"g"}', 'do-ambiente', 'g'],
    ['{}', 'do-ambiente', 'do-ambiente'],
    ['{}', undefined, null],
    ['{"apiKey":""}', 'do-ambiente', 'do-ambiente'],
    ['{quebrado', 'do-ambiente', 'do-ambiente'],
    ['{quebrado', undefined, null],
    ['null', 'do-ambiente', 'do-ambiente'],
  ] },
  { canal: 'get-groq-token', arquivo: 'groq_key.json', ambiente: 'GROQ_API_KEY', cenas: [
    [AUSENTE, undefined, null],
    [AUSENTE, 'do-ambiente', 'do-ambiente'],
    ['{"apiKey":"a"}', 'do-ambiente', 'a'],
    ['{}', 'do-ambiente', null],
    ['{quebrado', 'do-ambiente', null],
    ['null', 'do-ambiente', null],
  ] },
  { canal: 'get-openrouter-token', arquivo: 'openrouter_key.json', ambiente: 'OPENROUTER_API_KEY', cenas: [
    [AUSENTE, undefined, null],
    [AUSENTE, 'do-ambiente', 'do-ambiente'],
    ['{"apiKey":"a"}', 'do-ambiente', 'a'],
    ['{}', 'do-ambiente', null],
    ['{quebrado', 'do-ambiente', null],
  ] },
  { canal: 'get-google-token', arquivo: 'google_key.json', ambiente: 'GOOGLE_API_KEY', cenas: [
    [AUSENTE, undefined, null],
    [AUSENTE, 'do-ambiente', 'do-ambiente'],
    ['{"apiKey":"a"}', 'do-ambiente', 'a'],
    ['{}', 'do-ambiente', null],
    ['{quebrado', 'do-ambiente', null],
  ] },
  { canal: 'get-wa-api-key', arquivo: 'wa_api_key.json', ambiente: 'WA_API_KEY', cenas: [
    [AUSENTE, 'do-ambiente', null],
    ['{"apiKey":"a"}', 'do-ambiente', 'a'],
    ['{}', 'do-ambiente', null],
    ['{quebrado', 'do-ambiente', null],
  ] },
  { canal: 'get-thinking-enabled', arquivo: 'thinking_settings.json', cenas: [
    [AUSENTE, undefined, true],
    ['{"enabled":false}', undefined, false],
    ['{"enabled":true}', undefined, true],
    ['{"enabled":0}', undefined, 0],
    ['{"enabled":null}', undefined, null],
    ['{}', undefined, true],
    ['{quebrado', undefined, true],
    ['null', undefined, true],
  ] },
  { canal: 'get-visual-feed-enabled', arquivo: 'visual_settings.json', cenas: [
    [AUSENTE, undefined, true],
    ['{"enabled":false}', undefined, false],
    ['{"enabled":true}', undefined, true],
    ['{}', undefined, true],
    ['{quebrado', undefined, true],
  ] },
  { canal: 'get-prefer-direct-gemini', arquivo: 'gemini_preference.json', cenas: [
    [AUSENTE, undefined, false],
    ['{"preferDirect":true}', undefined, true],
    ['{"preferDirect":false}', undefined, false],
    ['{}', undefined, false],
    ['{quebrado', undefined, false],
  ] },
  { canal: 'get-elevenlabs-settings', arquivo: 'elevenlabs_settings.json', cenas: [
    [AUSENTE, undefined, { apiKey: '', voiceId: VOZ_PADRAO_DA_ELEVENLABS }],
    ['{"apiKey":"k","voiceId":"v","extra":1}', undefined, { apiKey: 'k', voiceId: 'v', extra: 1 }],
    ['{}', undefined, {}],
    ['{quebrado', undefined, { apiKey: '', voiceId: VOZ_PADRAO_DA_ELEVENLABS }],
  ] },
  { canal: 'get-child-agent-model', arquivo: 'child_agent_model.json', cenas: [
    [AUSENTE, undefined, MODELO_PADRAO_DO_FILHO],
    ['{"model":"outro"}', undefined, 'outro'],
    ['{"model":""}', undefined, MODELO_PADRAO_DO_FILHO],
    ['{}', undefined, MODELO_PADRAO_DO_FILHO],
    ['{quebrado', undefined, MODELO_PADRAO_DO_FILHO],
  ] },
  { canal: 'get-child-agent-key', arquivo: 'child_agent_key.json', cenas: [
    [AUSENTE, undefined, ''],
    ['{"apiKey":"k"}', undefined, 'k'],
    ['{}', undefined, ''],
    ['{quebrado', undefined, ''],
  ] },
  { canal: 'get-nova-voice', arquivo: 'nova_voice.json', cenas: [
    [AUSENTE, undefined, 'female'],
    ['{"voice":"male"}', undefined, 'male'],
    ['{"voice":""}', undefined, 'female'],
    ['{}', undefined, 'female'],
    ['{quebrado', undefined, 'female'],
  ] },
  { canal: 'get-custom-models', arquivo: 'custom_models.json', cenas: [
    [AUSENTE, undefined, { openRouter: [], gemini: [] }],
    ['{"openRouter":["a"],"gemini":["b"]}', undefined, { openRouter: ['a'], gemini: ['b'] }],
    ['[]', undefined, []],
    ['{quebrado', undefined, { openRouter: [], gemini: [] }],
  ] },
];

const GRAVADORES = [
  ['save-groq-token', 'k', 'groq_key.json', { apiKey: 'k', updatedAt: AGORA }],
  ['save-openrouter-token', 'k', 'openrouter_key.json', { apiKey: 'k', updatedAt: AGORA }],
  ['save-google-token', 'k', 'google_key.json', { apiKey: 'k', updatedAt: AGORA }],
  ['save-wa-api-key', 'k', 'wa_api_key.json', { apiKey: 'k', updatedAt: AGORA }],
  ['save-thinking-enabled', false, 'thinking_settings.json', { enabled: false, updatedAt: AGORA }],
  ['save-visual-feed-enabled', false, 'visual_settings.json', { enabled: false, updatedAt: AGORA }],
  ['save-prefer-direct-gemini', true, 'gemini_preference.json', { preferDirect: true, updatedAt: AGORA }],
  ['save-child-agent-model', 'm', 'child_agent_model.json', { model: 'm', updatedAt: AGORA }],
  ['save-child-agent-key', 'k', 'child_agent_key.json', { apiKey: 'k', updatedAt: AGORA }],
  ['save-nova-voice', 'male', 'nova_voice.json', { voice: 'male', updatedAt: AGORA }],
  ['save-elevenlabs-settings', { apiKey: 'k', voiceId: 'v' }, 'elevenlabs_settings.json', { apiKey: 'k', voiceId: 'v' }],
  ['save-custom-models', { openRouter: ['a'], gemini: [] }, 'custom_models.json', { openRouter: ['a'], gemini: [] }],
];

const VARIAVEIS_DE_AMBIENTE = ['GEMINI_API_KEY', 'GROQ_API_KEY', 'OPENROUTER_API_KEY', 'GOOGLE_API_KEY', 'WA_API_KEY'];

function guardarAmbiente() {
  return Object.fromEntries(VARIAVEIS_DE_AMBIENTE.map((nome) => [nome, process.env[nome]]));
}

function trocarVariavel(nome, valor) {
  if (valor === undefined) delete process.env[nome];
  else process.env[nome] = valor;
}

function restaurarAmbiente(antes) {
  for (const nome of VARIAVEIS_DE_AMBIENTE) trocarVariavel(nome, antes[nome]);
}

function ehPromessa(resultado) {
  return Boolean(resultado) && typeof resultado.then === 'function';
}

function comAmbiente(valores, funcao) {
  const antes = guardarAmbiente();
  restaurarAmbiente({});
  for (const [nome, valor] of Object.entries(valores)) trocarVariavel(nome, valor);
  try {
    const resultado = funcao();
    if (ehPromessa(resultado)) return resultado.finally(() => restaurarAmbiente(antes));
    restaurarAmbiente(antes);
    return resultado;
  } catch (erro) {
    restaurarAmbiente(antes);
    throw erro;
  }
}

function gravar(arquivo, conteudo) {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  fs.writeFileSync(arquivo, conteudo);
}

function lerGravado(main, arquivo) {
  return JSON.parse(fs.readFileSync(path.join(main.pasta('userData'), arquivo), 'utf8'));
}

function textoGravado(main, arquivo) {
  return fs.readFileSync(path.join(main.pasta('userData'), arquivo), 'utf8');
}

function chamarDireto(main, canal, ...argumentos) {
  return Promise.resolve(main.canais.handle.get(canal)({ sender: {} }, ...argumentos));
}

const NIVEIS_DO_MESMO_REGISTRO = { log: ['log', 'info'] };

function anotandoConsole(nivel, funcao) {
  const niveis = NIVEIS_DO_MESMO_REGISTRO[nivel] || [nivel];
  const antes = niveis.map((nome) => console[nome]);
  const chamadas = [];
  for (const nome of niveis) console[nome] = (...partes) => chamadas.push(partes);
  const restaurar = () => niveis.forEach((nome, indice) => { console[nome] = antes[indice]; });
  return Promise.resolve().then(funcao).then((resultado) => ({ resultado, chamadas }), (erro) => { throw erro; }).finally(restaurar);
}

function relogioFixo(t) {
  t.mock.method(Date, 'now', () => AGORA);
}

for (const { canal, arquivo, ambiente, cenas } of LEITORES) {
  test(`${canal}: cada estado do arquivo ${arquivo} devolve o que devolve hoje`, async () => {
    const main = carregarMain();
    const caminho = path.join(main.pasta('userData'), arquivo);
    for (const [conteudo, valorDoAmbiente, esperado] of cenas) {
      fs.rmSync(caminho, { recursive: true, force: true });
      if (conteudo !== AUSENTE) gravar(caminho, conteudo);
      const resposta = await comAmbiente({ [ambiente]: valorDoAmbiente }, () => main.invocar(canal));
      assert.deepStrictEqual(resposta, esperado, `${canal} com ${conteudo === AUSENTE ? 'sem arquivo' : conteudo} e ambiente ${valorDoAmbiente}`);
    }
  });
}

for (const [canal, argumento, arquivo, esperado] of GRAVADORES) {
  test(`${canal}: grava ${arquivo} com o texto de hoje e devolve false quando não consegue gravar`, async (t) => {
    relogioFixo(t);
    const main = carregarMain();
    assert.strictEqual(await main.invocar(canal, argumento), true);
    assert.deepStrictEqual(lerGravado(main, arquivo), esperado);
    assert.strictEqual(textoGravado(main, arquivo), JSON.stringify(esperado, null, 2));

    const bloqueado = carregarMain();
    fs.mkdirSync(path.join(bloqueado.pasta('userData'), arquivo), { recursive: true });
    assert.strictEqual(await bloqueado.invocar(canal, argumento), false);
  });
}

test('save-elevenlabs-settings sem configurações não grava e devolve false', async () => {
  const main = carregarMain();
  assert.strictEqual(await main.invocar('save-elevenlabs-settings', undefined), false);
  assert.ok(!fs.existsSync(path.join(main.pasta('userData'), 'elevenlabs_settings.json')));
});

test('save-wa-api-key avisa no console só depois de gravar', async (t) => {
  relogioFixo(t);
  const main = carregarMain();
  const gravou = await anotandoConsole('log', () => chamarDireto(main, 'save-wa-api-key', 'k'));
  assert.strictEqual(gravou.resultado, true);
  assert.deepStrictEqual(gravou.chamadas, [['[Main] WhatsApp dedicated API key saved.']]);

  const bloqueado = carregarMain();
  fs.mkdirSync(path.join(bloqueado.pasta('userData'), 'wa_api_key.json'), { recursive: true });
  const falhou = await anotandoConsole('log', () => chamarDireto(bloqueado, 'save-wa-api-key', 'k'));
  assert.strictEqual(falhou.resultado, false);
  assert.deepStrictEqual(falhou.chamadas, []);
});

test('save-gemini-token: grava apiKey e geminiKey, mantém os outros campos e ignora JSON quebrado', async (t) => {
  relogioFixo(t);
  const main = carregarMain();
  assert.strictEqual(await main.invocar('save-gemini-token', 'nova'), true);
  assert.strictEqual(textoGravado(main, 'secret_key.json'), JSON.stringify({ apiKey: 'nova', geminiKey: 'nova', updatedAt: AGORA }, null, 2));

  gravar(path.join(main.pasta('userData'), 'secret_key.json'), JSON.stringify({ outro: 1, apiKey: 'velha', updatedAt: 1 }));
  assert.strictEqual(await main.invocar('save-gemini-token', 'segunda'), true);
  assert.strictEqual(textoGravado(main, 'secret_key.json'), JSON.stringify({ outro: 1, apiKey: 'segunda', updatedAt: AGORA, geminiKey: 'segunda' }, null, 2));

  gravar(path.join(main.pasta('userData'), 'secret_key.json'), '{quebrado');
  assert.strictEqual(await main.invocar('save-gemini-token', 'terceira'), true);
  assert.deepStrictEqual(lerGravado(main, 'secret_key.json'), { apiKey: 'terceira', geminiKey: 'terceira', updatedAt: AGORA });

  gravar(path.join(main.pasta('userData'), 'secret_key.json'), 'null');
  assert.strictEqual(await main.invocar('save-gemini-token', 'quarta'), false);
  assert.strictEqual(textoGravado(main, 'secret_key.json'), 'null');

  const bloqueado = carregarMain();
  fs.mkdirSync(path.join(bloqueado.pasta('userData'), 'secret_key.json'), { recursive: true });
  assert.strictEqual(await bloqueado.invocar('save-gemini-token', 'k'), false);
});

test('cada gravador seguido do leitor devolve o que foi gravado', async (t) => {
  relogioFixo(t);
  const main = carregarMain();
  const pares = [
    ['save-groq-token', 'get-groq-token', 'k1'], ['save-openrouter-token', 'get-openrouter-token', 'k2'],
    ['save-google-token', 'get-google-token', 'k3'], ['save-wa-api-key', 'get-wa-api-key', 'k4'],
    ['save-gemini-token', 'get-gemini-token', 'k5'], ['save-thinking-enabled', 'get-thinking-enabled', false],
    ['save-visual-feed-enabled', 'get-visual-feed-enabled', false], ['save-prefer-direct-gemini', 'get-prefer-direct-gemini', true],
    ['save-child-agent-model', 'get-child-agent-model', 'm'], ['save-child-agent-key', 'get-child-agent-key', 'k6'],
    ['save-nova-voice', 'get-nova-voice', 'male'], ['save-elevenlabs-settings', 'get-elevenlabs-settings', { apiKey: 'k', voiceId: 'v' }],
    ['save-custom-models', 'get-custom-models', { openRouter: ['a'], gemini: ['b'] }],
  ];
  for (const [gravador, leitor, valor] of pares) {
    assert.strictEqual(await main.invocar(gravador, valor), true, gravador);
    assert.deepStrictEqual(await comAmbiente({}, () => main.invocar(leitor)), valor, leitor);
  }
});

test('get-openrouter-models: sem chave, com chave do ambiente, com chave do arquivo e com erro', async () => {
  const pedidos = [];
  let resposta = { data: { data: [{ id: 'modelo' }] } };
  const axios = { get: async (url, opcoes) => { pedidos.push([url, opcoes]); if (resposta instanceof Error) throw resposta; return resposta; } };
  const main = carregarMain({ modulos: { axios } });
  const arquivo = path.join(main.pasta('userData'), 'openrouter_key.json');
  const cabecalhos = (chave) => ({ headers: { Authorization: `Bearer ${chave}`, 'HTTP-Referer': 'https://nova.ai', 'X-Title': 'Nova AI' } });

  assert.deepStrictEqual(await comAmbiente({}, () => main.invocar('get-openrouter-models')), { error: 'OpenRouter Key missing' });
  assert.deepStrictEqual(pedidos, []);

  assert.deepStrictEqual(await comAmbiente({ OPENROUTER_API_KEY: 'do-ambiente' }, () => main.invocar('get-openrouter-models')), { data: [{ id: 'modelo' }] });
  assert.deepStrictEqual(pedidos.pop(), ['https://openrouter.ai/api/v1/models', cabecalhos('do-ambiente')]);

  gravar(arquivo, '{"apiKey":"do-arquivo"}');
  await comAmbiente({ OPENROUTER_API_KEY: 'do-ambiente' }, () => main.invocar('get-openrouter-models'));
  assert.deepStrictEqual(pedidos.pop(), ['https://openrouter.ai/api/v1/models', cabecalhos('do-arquivo')]);

  gravar(arquivo, '{}');
  await comAmbiente({ OPENROUTER_API_KEY: 'do-ambiente' }, () => main.invocar('get-openrouter-models'));
  assert.deepStrictEqual(pedidos.pop(), ['https://openrouter.ai/api/v1/models', cabecalhos('do-ambiente')]);

  gravar(arquivo, '{}');
  assert.deepStrictEqual(await comAmbiente({}, () => main.invocar('get-openrouter-models')), { error: 'OpenRouter Key missing' });

  resposta = new Error('sem rede');
  const falha = await anotandoConsole('error', () => comAmbiente({ OPENROUTER_API_KEY: 'k' }, () => chamarDireto(main, 'get-openrouter-models')));
  assert.deepStrictEqual(falha.resultado, { error: 'sem rede' });
  assert.deepStrictEqual(falha.chamadas, [['[Electron] Error fetching models:', 'sem rede']]);

  gravar(arquivo, '{quebrado');
  const quebrado = await comAmbiente({ OPENROUTER_API_KEY: 'k' }, () => main.invocar('get-openrouter-models'));
  assert.deepStrictEqual(Object.keys(quebrado), ['error']);
  assert.strictEqual(typeof quebrado.error, 'string');
});

test('app.getGeminiToken lê o mesmo arquivo do get-gemini-token e avisa no console quando quebra', async () => {
  const { main } = carregarComArranqueCompleto();
  const arquivo = path.join(main.pasta('userData'), 'secret_key.json');
  const cenas = [
    [AUSENTE, undefined, null],
    [AUSENTE, 'do-ambiente', 'do-ambiente'],
    ['{"apiKey":"a","geminiKey":"g"}', 'do-ambiente', 'a'],
    ['{"geminiKey":"g"}', 'do-ambiente', 'g'],
    ['{}', 'do-ambiente', 'do-ambiente'],
    ['{quebrado', 'do-ambiente', 'do-ambiente'],
    ['{quebrado', undefined, null],
  ];
  for (const [conteudo, valorDoAmbiente, esperado] of cenas) {
    fs.rmSync(arquivo, { force: true });
    if (conteudo !== AUSENTE) gravar(arquivo, conteudo);
    const { resultado, chamadas } = await anotandoConsole('error', () => comAmbiente({ GEMINI_API_KEY: valorDoAmbiente }, () => main.app.getGeminiToken()));
    assert.strictEqual(resultado, esperado);
    const quebrou = conteudo === '{quebrado';
    assert.strictEqual(chamadas.length, quebrou ? 1 : 0);
    if (quebrou) assert.strictEqual(chamadas[0][0], '[Brain-Link] Error fetching token:');
  }
});
