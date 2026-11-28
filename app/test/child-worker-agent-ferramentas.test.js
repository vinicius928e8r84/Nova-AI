'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const { EventEmitter } = require('events');

const PASTA_DOS_SERVICOS = path.join(__dirname, '..', 'electron', 'services');
const PREFIXO_DO_AGENTE = path.join(PASTA_DOS_SERVICOS, 'child-worker');

const rede = {};
const navegador = {};
const processos = { exec: (...argumentos) => processos.atual(...argumentos) };
const MODULOS_FALSOS = {
  electron: { net: { request: (...argumentos) => rede.atual(...argumentos) } },
  './browser-manager': { browserService: navegador },
  child_process: processos,
};

function carregarAgente() {
  const carregarOriginal = Module._load;
  Module._load = function (pedido, pai, ...resto) {
    if (pai?.filename?.startsWith(PREFIXO_DO_AGENTE) && pedido in MODULOS_FALSOS) return MODULOS_FALSOS[pedido];
    return carregarOriginal.call(this, pedido, pai, ...resto);
  };
  try {
    for (const chave of Object.keys(require.cache)) if (chave.startsWith(PREFIXO_DO_AGENTE)) delete require.cache[chave];
    return require(path.join(PASTA_DOS_SERVICOS, 'child-worker-agent.js'));
  } finally {
    Module._load = carregarOriginal;
  }
}

function criarAgente(app = {}) {
  const ChildWorkerAgent = carregarAgente();
  const enviados = [];
  const janela = { isDestroyed: () => false, webContents: { send: (canal, dados) => enviados.push({ canal, dados }) } };
  const agente = new ChildWorkerAgent(janela, app);
  agente.GEMINI_CANDIDATES = [{ model: 'm1', api: 'v1beta' }, { model: 'm2', api: 'v1beta' }];
  return { agente, enviados, logs: () => enviados.filter((e) => e.canal === 'swarm:log').map((e) => e.dados.text.replace(/^\[[^\]]*\] /, '')) };
}

async function semRuido(acao) {
  const log = console.log;
  const setTimeoutOriginal = global.setTimeout;
  const esperas = [];
  console.log = () => {};
  global.setTimeout = (funcao, ms, ...resto) => {
    if (ms >= 1000) esperas.push(ms);
    return setTimeoutOriginal(funcao, ms >= 1000 ? 0 : ms, ...resto);
  };
  try {
    return { valor: await acao(), esperas };
  } catch (erro) {
    return { erro, esperas };
  } finally {
    console.log = log;
    global.setTimeout = setTimeoutOriginal;
  }
}

function responderHttps(resposta, req, retorno) {
  if (resposta.erroDeRede) {
    req.emit('error', new Error(resposta.erroDeRede));
    return;
  }
  const res = new EventEmitter();
  res.statusCode = resposta.status ?? 200;
  retorno(res);
  const corpo = typeof resposta.corpo === 'string' ? resposta.corpo : JSON.stringify(resposta.corpo);
  res.emit('data', Buffer.from(corpo.slice(0, 5)));
  res.emit('data', Buffer.from(corpo.slice(5)));
  res.emit('end');
}

async function comHttps(respostas, acao) {
  const original = https.request;
  const pedidos = [];
  https.request = (opcoes, retorno) => {
    const req = new EventEmitter();
    const pedido = { opcoes, escrito: [] };
    pedidos.push(pedido);
    req.write = (texto) => pedido.escrito.push(texto);
    req.end = () => setImmediate(() => responderHttps(respostas.shift() ?? { erroDeRede: 'sem resposta no roteiro' }, req, retorno));
    return req;
  };
  try {
    const saida = await semRuido(acao);
    return { ...saida, pedidos };
  } finally {
    https.request = original;
  }
}

async function comRede(comportamento, acao) {
  const pedidos = [];
  rede.atual = (opcoes) => {
    if (comportamento.lancar) throw new Error(comportamento.lancar);
    const req = new EventEmitter();
    const pedido = { opcoes, cabecalhos: {}, escrito: [] };
    pedidos.push(pedido);
    req.setHeader = (nome, valor) => { pedido.cabecalhos[nome] = valor; };
    req.write = (texto) => pedido.escrito.push(texto);
    req.end = () => setImmediate(() => {
      if (comportamento.erroNoPedido) { req.emit('error', new Error(comportamento.erroNoPedido)); return; }
      const res = new EventEmitter();
      res.statusCode = comportamento.status ?? 200;
      req.emit('response', res);
      if (comportamento.erroNaResposta) { res.emit('error', new Error(comportamento.erroNaResposta)); return; }
      res.emit('data', Buffer.from(comportamento.corpo ?? ''));
      res.emit('end');
    });
    return req;
  };
  const saida = await semRuido(acao);
  return { ...saida, pedidos };
}

const RETRY_INFO = '@type';
const erroDaApi = (code, extra = {}) => ({ corpo: { error: { code, message: `falha ${code}`, ...extra } } });
const textoDoGemini = (texto) => ({ corpo: { candidates: [{ content: { parts: [{ text: texto }] } }] } });

test('callGemini devolve o texto cortado do primeiro modelo, com a chave na URL, o corpo e o tamanho nos cabeçalhos', async () => {
  const { agente, logs } = criarAgente();
  const { valor, pedidos } = await comHttps([textoDoGemini('  oi  ')], () => agente.callGemini('CHAVE', 'pergunta'));
  assert.strictEqual(valor, 'oi');
  assert.deepStrictEqual(logs(), ['GEMINI 3 ✓ Neural Engine: m1']);
  const corpo = JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'pergunta' }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 2048 } });
  assert.deepStrictEqual(pedidos, [{
    opcoes: {
      hostname: 'generativelanguage.googleapis.com',
      path: '/v1beta/models/m1:generateContent?key=CHAVE',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(corpo) },
    },
    escrito: [corpo],
  }]);
});

test('callGemini com erro 400 ou 403 para tudo e avisa a chave inválida', async () => {
  for (const code of [400, 403]) {
    const { agente, logs } = criarAgente();
    const { erro, pedidos } = await comHttps([erroDaApi(code, { message: 'x'.repeat(200) }), textoDoGemini('nunca')], () => agente.callGemini('K', 'p'));
    assert.strictEqual(erro.message, 'AUTH_FAILED: Invalid API key. Check Sub-Agent Key in Settings.');
    assert.strictEqual(pedidos.length, 1);
    assert.deepStrictEqual(logs(), [
      `GEMINI 3 ❌ AUTH ERROR [HTTP 200]: ${'x'.repeat(120)}`,
      'GEMINI 3 Fix: Settings → API Keys → enter a valid Sub-Agent Key from aistudio.google.com/apikey',
    ]);
  }
});

test('callGemini com 429 espera o retryDelay mais 2 s (no máximo 25 s, 15 s sem a dica), tenta duas vezes por modelo e acaba em QUOTA_EXHAUSTED', async () => {
  const { agente, logs } = criarAgente();
  const comDica = (retryDelay) => erroDaApi(429, { details: [{ 'x': 1 }, { [RETRY_INFO]: 'type.googleapis.com/google.rpc.RetryInfo', retryDelay }] });
  const respostas = [comDica('3.5s'), comDica('40s'), erroDaApi(429), erroDaApi(429, { details: [] })];
  const { erro, esperas, pedidos } = await comHttps(respostas, () => agente.callGemini('K', 'p'));
  assert.strictEqual(erro.message, 'QUOTA_EXHAUSTED: All Gemini models rate-limited. Try again later.');
  assert.deepStrictEqual(esperas, [5500, 25000, 15000, 15000]);
  assert.strictEqual(pedidos.length, 4);
  assert.deepStrictEqual(pedidos.map((p) => p.opcoes.path.split('/')[3].split(':')[0]), ['m1', 'm1', 'm2', 'm2']);
  assert.deepStrictEqual(logs(), [
    'GEMINI 3 ⏳ m1 [429] Rate limit. Waiting 5.5s...', 'GEMINI 3 ⏳ m1 [429] Rate limit. Waiting 25s...',
    'GEMINI 3 ⏳ m2 [429] Rate limit. Waiting 15s...', 'GEMINI 3 ⏳ m2 [429] Rate limit. Waiting 15s...',
  ]);
  assert.strictEqual(agente._last429, true);
});

test('callGemini volta ao mesmo modelo depois do 429 e _last429 é zerado a cada chamada', async () => {
  const { agente } = criarAgente();
  agente._last429 = true;
  const { valor } = await comHttps([erroDaApi(429), textoDoGemini('depois')], () => agente.callGemini('K', 'p'));
  assert.strictEqual(valor, 'depois');
  assert.strictEqual(agente._last429, true);
  await comHttps([textoDoGemini('de primeira')], () => agente.callGemini('K', 'p'));
  assert.strictEqual(agente._last429, false);
});

test('callGemini com 404 (por código ou por status) passa ao modelo seguinte e acaba em ALL_MODELS_404', async () => {
  const { agente, logs } = criarAgente();
  const { erro, pedidos } = await comHttps([erroDaApi(404), { corpo: { error: { status: 'NOT_FOUND', code: 500 } } }], () => agente.callGemini('K', 'p'));
  assert.strictEqual(erro.message, 'ALL_MODELS_404: All Gemini models returned 404. Key may not have access — using Groq.');
  assert.strictEqual(pedidos.length, 2);
  assert.deepStrictEqual(logs(), ['GEMINI 3 ⚠ m1 [404] Not available. Trying next...', 'GEMINI 3 ⚠ m2 [404] Not available. Trying next...']);
});

test('callGemini com outro erro, resposta vazia ou erro de rede registra e passa ao modelo seguinte, e o texto do segundo modelo vale', async () => {
  const { agente, logs } = criarAgente();
  const { valor } = await comHttps([erroDaApi(500, { message: 'y'.repeat(100) }), textoDoGemini('do segundo')], () => agente.callGemini('K', 'p'));
  assert.strictEqual(valor, 'do segundo');
  assert.deepStrictEqual(logs(), [`GEMINI 3 ⚠ m1 [HTTP 200 / code 500]: ${'y'.repeat(80)}`, 'GEMINI 3 ✓ Neural Engine: m2']);

  const vazias = criarAgente();
  const bloqueada = await comHttps([{ corpo: { promptFeedback: { blockReason: 'SAFETY' } }, status: 503 }, { corpo: {} }], () => vazias.agente.callGemini('K', 'p'));
  assert.strictEqual(bloqueada.erro.message.slice(0, 14), 'ALL_MODELS_404');
  assert.deepStrictEqual(vazias.logs(), [
    'GEMINI 3 ⚠ m1 [HTTP 503] Empty response (blocked: SAFETY). Trying next...', 'GEMINI 3 ⚠ m2 [HTTP 200] Empty response. Trying next...',
  ]);

  const rede1 = criarAgente();
  const caiu = await comHttps([{ erroDeRede: 'z'.repeat(100) }, { corpo: 'isso não é json', status: 502 }], () => rede1.agente.callGemini('K', 'p'));
  assert.strictEqual(caiu.erro.message.slice(0, 14), 'ALL_MODELS_404');
  assert.deepStrictEqual(rede1.logs(), [`GEMINI 3 ⚠ m1 network error: ${'z'.repeat(80)}`, 'GEMINI 3 ⚠ m2 network error: JSON parse failed [502]: isso não é json']);
});

test('callGemini sem modelo nenhum acaba em ALL_MODELS_404 sem pedir nada', async () => {
  const { agente } = criarAgente();
  agente.GEMINI_CANDIDATES = [];
  const { erro, pedidos } = await comHttps([], () => agente.callGemini('K', 'p'));
  assert.strictEqual(erro.message.slice(0, 14), 'ALL_MODELS_404');
  assert.strictEqual(pedidos.length, 0);
});

const respostaDoGroq = (texto) => ({ corpo: { choices: [{ message: { content: texto } }] } });

test('callGroq recusa chave curta ou vazia e devolve o texto cortado do primeiro modelo com o cabeçalho de autorização', async () => {
  const { agente, logs } = criarAgente();
  for (const chave of [undefined, '', 'x'.repeat(19)]) {
    const { erro, pedidos } = await comHttps([], () => agente.callGroq(chave, 'p'));
    assert.strictEqual(erro.message, 'No Groq key available');
    assert.strictEqual(pedidos.length, 0);
  }
  const chave = 'g'.repeat(20);
  const { valor, pedidos } = await comHttps([respostaDoGroq(' oi do groq ')], () => agente.callGroq(chave, 'pergunta'));
  assert.strictEqual(valor, 'oi do groq');
  const corpo = JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: 'pergunta' }], max_tokens: 2048, temperature: 0.2 });
  assert.deepStrictEqual(pedidos, [{
    opcoes: {
      hostname: 'api.groq.com', path: '/openai/v1/chat/completions', method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${chave}`, 'Content-Length': Buffer.byteLength(corpo) },
    },
    escrito: [corpo],
  }]);
  assert.deepStrictEqual(logs(), ['GEMINI 3 ✓ Groq llama-3.3-70b-versatile (fallback) responding']);
});

test('callGroq passa por erro da API, erro de leitura, resposta sem texto e rede, na ordem dos modelos, e acaba com a mensagem final', async () => {
  const { agente, logs } = criarAgente();
  const chave = 'g'.repeat(20);
  const respostas = [
    { corpo: { error: { message: 'm'.repeat(100) } }, status: 429 },
    { corpo: 'não é json', status: 500 },
    { corpo: { choices: [{ message: { content: '' } }] } },
    { erroDeRede: 'q'.repeat(100) },
  ];
  const { erro, pedidos } = await comHttps(respostas, () => agente.callGroq(chave, 'p'));
  assert.strictEqual(erro.message, 'Groq fallback also failed. Check Groq API key in Settings → Groq Influx Key.');
  assert.deepStrictEqual(pedidos.map((p) => JSON.parse(p.escrito[0]).model), ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'gemma2-9b-it', 'llama3-8b-8192']);
  assert.deepStrictEqual(logs(), [
    `GEMINI 3 ⚠ Groq llama-3.3-70b-versatile [429]: ${'m'.repeat(60)}`,
    'GEMINI 3 ⚠ Groq llama-3.1-8b-instant error: Groq parse error [500]',
    `GEMINI 3 ⚠ Groq llama3-8b-8192 error: ${'q'.repeat(60)}`,
  ]);
  const semMensagem = criarAgente();
  await comHttps([{ corpo: { error: {} }, status: 400 }, respostaDoGroq('ok')], () => semMensagem.agente.callGroq(chave, 'p'));
  assert.deepStrictEqual(semMensagem.logs(), ['GEMINI 3 ⚠ Groq llama-3.3-70b-versatile [400]: undefined', 'GEMINI 3 ✓ Groq llama-3.1-8b-instant (fallback) responding']);
});

function agenteComIa(respostasDoGemini, resposta = 'do groq') {
  const criado = criarAgente();
  const chamadas = [];
  criado.agente.callGemini = async (chave, prompt) => {
    chamadas.push(['gemini', chave, prompt]);
    const proxima = respostasDoGemini.shift();
    if (proxima instanceof Error) throw proxima;
    return proxima;
  };
  criado.agente.callGroq = async (chave, prompt) => { chamadas.push(['groq', chave, prompt]); return resposta; };
  return { ...criado, chamadas };
}

test('callAI devolve o Gemini quando responde, e cai direto no Groq com chave inválida ou modelos 404', async () => {
  const bom = agenteComIa(['do gemini']);
  assert.strictEqual((await semRuido(() => bom.agente.callAI('A', 'G', 'p'))).valor, 'do gemini');
  assert.deepStrictEqual(bom.chamadas, [['gemini', 'A', 'p']]);
  const auth = agenteComIa([new Error('AUTH_FAILED: x')]);
  assert.strictEqual((await semRuido(() => auth.agente.callAI('A', 'G', 'p'))).valor, 'do groq');
  assert.deepStrictEqual(auth.chamadas, [['gemini', 'A', 'p'], ['groq', 'G', 'p']]);
  assert.deepStrictEqual(auth.logs(), ['GEMINI 3 ⚡ Gemini auth failed → switching to Groq fallback...']);
  const nao = agenteComIa([new Error('ALL_MODELS_404: x')]);
  await semRuido(() => nao.agente.callAI('A', 'G', 'p'));
  assert.deepStrictEqual(nao.logs(), ['GEMINI 3 ⚡ All Gemini models unavailable (404) → trying Groq immediately...']);
});

test('callAI com cota esgotada espera 30 s e tenta de novo até o limite de tentativas, depois cai no Groq', async () => {
  const cota = () => new Error('QUOTA_EXHAUSTED: x');
  const a = agenteComIa([cota(), 'na segunda']);
  const r1 = await semRuido(() => a.agente.callAI('A', 'G', 'p'));
  assert.strictEqual(r1.valor, 'na segunda');
  assert.deepStrictEqual(r1.esperas, [30000]);
  assert.deepStrictEqual(a.logs(), ['GEMINI 3 ⏳ Gemini quota limited. Waiting 30s then retry... (1/2)']);
  const b = agenteComIa([cota(), cota(), cota()]);
  const r2 = await semRuido(() => b.agente.callAI('A', 'G', 'p', 3));
  assert.strictEqual(r2.valor, 'do groq');
  assert.deepStrictEqual(r2.esperas, [30000, 30000]);
  assert.deepStrictEqual(b.logs(), [
    'GEMINI 3 ⏳ Gemini quota limited. Waiting 30s then retry... (1/3)', 'GEMINI 3 ⏳ Gemini quota limited. Waiting 30s then retry... (2/3)',
    'GEMINI 3 ⚡ Gemini still limited → trying Groq fallback...',
  ]);
  const c = agenteComIa([new Error('qualquer')]);
  const r3 = await semRuido(() => c.agente.callAI('A', 'G', 'p', 1));
  assert.strictEqual(r3.valor, 'do groq');
  assert.deepStrictEqual(c.logs(), ['GEMINI 3 ⚡ Gemini still limited → trying Groq fallback...']);
  const d = agenteComIa([]);
  assert.strictEqual((await semRuido(() => d.agente.callAI('A', 'G', 'p', 0))).valor, 'do groq');
  assert.deepStrictEqual(d.chamadas, [['groq', 'G', 'p']]);
});

function rodar(agente, nome, args) {
  return agente.dispatchTool(nome, args);
}

test('dispatchTool: nome maiúsculo vale, ferramenta desconhecida e erro de ferramenta viram texto', async () => {
  const { agente } = criarAgente();
  assert.strictEqual(await rodar(agente, 'Foo', ''), 'Error: Unknown tool "Foo".');
  assert.strictEqual(await rodar(agente, 'QUALQUER', ''), 'Error: Unknown tool "QUALQUER".');
  const texto = await rodar(agente, 'browser_click', undefined);
  assert.ok(texto.startsWith('Tool error (browser_click): '), texto);
  assert.ok((await rodar(agente, undefined, '')).startsWith('Tool error (undefined): '));
  navegador.click = async () => { throw new Error('quebrou'); };
  assert.strictEqual(await rodar(agente, 'BROWSER_CLICK', '[1]'), 'Tool error (BROWSER_CLICK): quebrou');
});

test('dispatchTool nas ferramentas do navegador: cada uma chama o serviço com os argumentos limpos e devolve o que ele devolve', async () => {
  const { agente } = criarAgente();
  const chamadas = [];
  const anotar = (nome, retorno) => async (...argumentos) => { chamadas.push([nome, ...argumentos]); return retorno; };
  Object.assign(navegador, {
    launch: anotar('launch'), navigate: anotar('navigate', 'navegou'), snapshot: anotar('snapshot', { result: '' }),
    click: anotar('click', { result: 'clicou' }), visionClick: anotar('visionClick', 'viu'), type: anotar('type', { result: 'digitou' }),
    scroll: anotar('scroll', 'rolou'), extract: anotar('extract', 'extraiu'),
  });
  assert.strictEqual(await rodar(agente, 'browser_navigate', '  https://x  '), 'navegou');
  assert.strictEqual(await rodar(agente, 'browser_snapshot', 'TRUE'), 'Snapshot taken successfully.');
  assert.strictEqual(await rodar(agente, 'browser_snapshot', ''), 'Snapshot taken successfully.');
  assert.strictEqual(await rodar(agente, 'browser_click', ' [12] '), 'clicou');
  assert.strictEqual(await rodar(agente, 'browser_vision_click', ' Entrar '), 'viu');
  assert.strictEqual(await rodar(agente, 'browser_type', ' [3] | a|b '), 'digitou');
  assert.strictEqual(await rodar(agente, 'browser_type', 'sem barra'), 'Error: Format must be selector|text');
  assert.strictEqual(await rodar(agente, 'browser_scroll', ' UP '), 'rolou');
  assert.strictEqual(await rodar(agente, 'browser_scroll', '  '), 'rolou');
  assert.strictEqual(await rodar(agente, 'browser_extract', ' h1 '), 'extraiu');
  assert.strictEqual(await rodar(agente, 'browser_extract', ' '), 'extraiu');
  assert.deepStrictEqual(chamadas, [
    ['launch'], ['navigate', 'https://x'], ['snapshot', true], ['snapshot', ''], ['click', '[12]'], ['visionClick', 'Entrar'],
    ['type', '[3]', 'a|b', true], ['scroll', 'up'], ['scroll', 'down'], ['extract', 'h1'], ['extract', undefined],
  ]);
  navegador.snapshot = async () => ({ result: 'página' });
  assert.strictEqual(await rodar(agente, 'browser_snapshot', 'false'), 'página');
});

test('dispatchTool idm_download: usa o formato best sem o segundo argumento, e avisa quando o baixador não existe', async () => {
  const baixadas = [];
  const comBaixador = criarAgente({ ytdlpManager: { manualDownload: async (...argumentos) => baixadas.push(argumentos) } });
  assert.strictEqual(await rodar(comBaixador.agente, 'idm_download', ' https://v | audio '), 'OK: Download started via IDM-style downloader for https://v');
  assert.strictEqual(await rodar(comBaixador.agente, 'idm_download', 'https://w'), 'OK: Download started via IDM-style downloader for https://w');
  assert.deepStrictEqual(baixadas, [['https://v', 'audio', 'video'], ['https://w', 'best', 'video']]);
  assert.strictEqual(await rodar(criarAgente({}).agente, 'idm_download', 'https://v'), 'Error: Downloader not ready.');
  assert.strictEqual(await rodar(criarAgente(null).agente, 'idm_download', 'https://v'), 'Error: Downloader not ready.');
});

test('dispatchTool write_file e read_file trabalham dentro de Documents/Nova Data da pasta pessoal', async (t) => {
  const casa = fs.mkdtempSync(path.join(os.tmpdir(), 'casa-do-teste-'));
  const original = os.homedir;
  os.homedir = () => casa;
  t.after(() => { os.homedir = original; fs.rmSync(casa, { recursive: true, force: true }); });
  const { agente } = criarAgente();
  assert.strictEqual(await rodar(agente, 'write_file', 'sem barra'), 'Error: Format must be filename|content');
  const destino = path.resolve(casa, 'Documents', 'Nova Data', 'a', 'b.txt');
  assert.strictEqual(await rodar(agente, 'write_file', ' a/b.txt | olá | mundo '), `OK: Saved 11 chars to ${destino}`);
  assert.strictEqual(fs.readFileSync(destino, 'utf8'), 'olá | mundo');
  assert.strictEqual(await rodar(agente, 'read_file', ' a/b.txt '), 'olá | mundo');
  const faltando = path.resolve(casa, 'Documents', 'Nova Data', 'nada.txt');
  assert.strictEqual(await rodar(agente, 'read_file', 'nada.txt'), `Error: File not found at ${faltando}`);
  fs.writeFileSync(destino, 'x'.repeat(3500));
  assert.strictEqual((await rodar(agente, 'read_file', 'a/b.txt')).length, 3000);
});

test('dispatchTool execute_shell: usa o limite de 15 s, devolve a saída cortada, a frase padrão ou o erro', async () => {
  const { agente } = criarAgente();
  const comandos = [];
  const respostas = [[null, '  saída  ', ''], [null, '', ''], [null, undefined, ''], [new Error('falhou'), '', 'stderr dele'], [new Error('falhou'), '', '']];
  processos.atual = (comando, opcoes, retorno) => { comandos.push([comando, opcoes]); retorno(...respostas.shift()); };
  assert.strictEqual(await rodar(agente, 'execute_shell', 'ls'), 'saída');
  assert.strictEqual(await rodar(agente, 'execute_shell', 'ls'), 'Command executed successfully.');
  assert.strictEqual(await rodar(agente, 'execute_shell', 'ls'), 'Command executed successfully.');
  assert.strictEqual(await rodar(agente, 'execute_shell', 'ls'), 'Error: stderr dele');
  assert.strictEqual(await rodar(agente, 'execute_shell', 'ls'), 'Error: falhou');
  assert.deepStrictEqual(comandos[0], ['ls', { timeout: 15000 }]);
});

test('dispatchTool web_search: lista até três resultados fora do Google, e cai no texto limpo quando o regex não acha nada', async () => {
  const { agente } = criarAgente();
  const link = (url, titulo) => `<a href="/url?q=${url}&sa=U"><h3 class="x"><div>${titulo}</div></h3>`;
  const html = [link('https://google.com/a', 'Do Google'), link('https://um.com', 'Um &amp; &quot;dois&quot;'), link('https://dois.com', 'Dois'),
    link('https://tres.com', 'Três'), link('https://quatro.com', 'Quatro')].join('');
  const { valor, pedidos } = await comRede({ corpo: html }, () => rodar(agente, 'web_search', 'gatos & cães'));
  assert.strictEqual(valor, 'Google Results for "gatos & cães":\n\n1. Um & "dois"\n   https://um.com\n\n2. Dois\n   https://dois.com\n\n3. Três\n   https://tres.com');
  assert.deepStrictEqual(pedidos.map((p) => p.opcoes), [{ method: 'GET', url: `https://www.google.com/search?q=${encodeURIComponent('gatos & cães')}`, useSessionCookies: true }]);
  const limpo = await comRede({ corpo: '<script>x()</script><style>p{}</style><p>Olá   <b>mundo</b></p>' }, () => rodar(agente, 'web_search', 'q'));
  assert.strictEqual(limpo.valor, 'Google search results for "q":\nOlá mundo\n\n(Regex failed, try browse_site with a URL)');
  const longo = await comRede({ corpo: `<p>${'a'.repeat(3000)}</p>` }, () => rodar(agente, 'web_search', 'q'));
  assert.strictEqual(longo.valor.split('\n')[1].length, 1500);
});

test('dispatchTool web_search: resposta vazia, JSON e falha de rede viram texto de erro', async () => {
  const { agente } = criarAgente();
  const vazia = await comRede({ corpo: '' }, () => rodar(agente, 'web_search', 'q'));
  assert.strictEqual(vazia.valor, 'web_search error: Empty or invalid response from Google.');
  const json = await comRede({ corpo: '{"a":1}' }, () => rodar(agente, 'web_search', 'q'));
  assert.strictEqual(json.valor, 'web_search error: Empty or invalid response from Google.');
  const falha = await comRede({ erroNoPedido: 'sem rede' }, () => rodar(agente, 'web_search', 'q'));
  assert.strictEqual(falha.valor, 'web_search error: Net request error: sem rede');
  const leitura = await comRede({ erroNaResposta: 'cortou' }, () => rodar(agente, 'web_search', 'q'));
  assert.strictEqual(leitura.valor, 'web_search error: Net response error: cortou');
  const fatal = await comRede({ lancar: 'estourou' }, () => rodar(agente, 'web_search', 'q'));
  assert.strictEqual(fatal.valor, 'web_search error: _electronPost fatal: estourou');
});

test('_electronPost com corpo manda POST com o cabeçalho e devolve o JSON lido, ou o texto quando não é JSON', async () => {
  const { agente } = criarAgente();
  const json = await comRede({ corpo: '{"a":1}' }, () => agente._electronPost('https://x', '{"b":2}'));
  assert.deepStrictEqual(json.valor, { a: 1 });
  assert.deepStrictEqual(json.pedidos, [{ opcoes: { method: 'POST', url: 'https://x', useSessionCookies: true }, cabecalhos: { 'Content-Type': 'application/json' }, escrito: ['{"b":2}'] }]);
  const texto = await comRede({ corpo: 'puro' }, () => agente._electronPost('https://x'));
  assert.strictEqual(texto.valor, 'puro');
  assert.deepStrictEqual(texto.pedidos[0].opcoes.method, 'GET');
});

test('dispatchTool browse_site: limpa aspas, põe https, tira scripts e tags, corta em 4000 e avisa os erros', async () => {
  const { agente } = criarAgente();
  const ok = await comRede({ corpo: '<script>a</script><style>b</style><h1>Oi</h1>  <p>você</p>' }, () => rodar(agente, 'browse_site', ' "exemplo.com/x" '));
  assert.strictEqual(ok.valor, 'Content from https://exemplo.com/x:\nOi você');
  assert.deepStrictEqual(ok.pedidos[0].opcoes, { method: 'GET', url: 'https://exemplo.com/x', redirect: 'follow' });
  const http = await comRede({ corpo: 'a' }, () => rodar(agente, 'browse_site', "'http://plain.com'"));
  assert.strictEqual(http.valor, 'Content from http://plain.com:\na');
  const longo = await comRede({ corpo: 'b'.repeat(5000) }, () => rodar(agente, 'browse_site', 'x.com'));
  assert.strictEqual(longo.valor.split('\n')[1].length, 4000);
  const status = await comRede({ status: 404 }, () => rodar(agente, 'browse_site', 'x.com'));
  assert.strictEqual(status.valor, 'Browse error: Server returned status 404 for https://x.com');
  assert.strictEqual((await comRede({ erroNoPedido: 'caiu' }, () => rodar(agente, 'browse_site', 'x.com'))).valor, 'Browse error: caiu');
  assert.strictEqual((await comRede({ erroNaResposta: 'cortou' }, () => rodar(agente, 'browse_site', 'x.com'))).valor, 'Browse error: cortou');
  assert.strictEqual((await comRede({ lancar: 'estourou' }, () => rodar(agente, 'browse_site', 'x.com'))).valor, 'Browse error: estourou');
});

test('log mostra GEMINI 3 para o ceo e o nome em maiúsculas para os outros, e só escreve no console quando a janela some', () => {
  const { agente, enviados } = criarAgente();
  const linhas = [];
  const original = console.log;
  console.log = (...argumentos) => linhas.push(argumentos);
  try {
    agente.log('ceo', 'a');
    agente.log('researcher', 'b');
    agente.mainWindow.isDestroyed = () => true;
    agente.log('ceo', 'c');
    agente.setStatus('researcher', 'busy');
  } finally {
    console.log = original;
  }
  assert.deepStrictEqual(enviados.map((e) => e.dados.text.replace(/^\[[^\]]*\] /, '')), ['GEMINI 3 a', 'RESEARCHER b']);
  assert.deepStrictEqual(linhas, [['[ChildWorker:ceo]', 'a'], ['[ChildWorker:researcher]', 'b'], ['[ChildWorker:ceo]', 'c']]);
  assert.match(enviados[0].dados.text, /^\[\d{2}:\d{2}:\d{2}\] GEMINI 3 a$/);
});

test('setStatus, updateUISubAgent e cancel mandam os eventos certos', async () => {
  const { agente, enviados } = criarAgente();
  agente.setStatus('researcher', 'busy');
  agente.setStatus('x', 'done', 50);
  agente.updateUISubAgent('Web_Search');
  agente.updateUISubAgent('execute_shell');
  agente.updateUISubAgent('browse_site');
  assert.deepStrictEqual(enviados.map((e) => [e.canal, e.dados]), [
    ['swarm:status', { agentId: 'researcher', status: 'busy', progress: 0 }],
    ['swarm:status', { agentId: 'x', status: 'done', progress: 50 }],
    ['swarm:status', { agentId: 'researcher', status: 'busy', progress: 0 }],
    ['swarm:status', { agentId: 'researcher', status: 'busy', progress: 0 }],
  ]);
  agente.isWorking = true;
  const { esperas } = await semRuido(() => agente.cancel());
  assert.deepStrictEqual([agente.isCancelled, agente.isWorking, esperas], [true, false, []]);
  assert.deepStrictEqual(enviados.slice(4).map((e) => e.canal), ['swarm:log', 'swarm:status']);
  assert.strictEqual(enviados[5].dados.status, 'idle');
});
