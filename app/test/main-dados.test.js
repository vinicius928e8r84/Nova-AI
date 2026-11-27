'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { carregarMain } = require('./ajuda/carregar-main');

const AUSENTE = Symbol('sem arquivo');
const AGORA = 1790000000000;
const PADRAO_DO_PAINEL = { interests: ['Tech', 'Pakistan', 'Global Economy'], refreshInterval: 3600 };
const PADRAO_DO_PAINEL_COM_FALHA = { interests: [], refreshInterval: 3600 };
const PADRAO_DO_HISTORICO = { maxContextMessages: 20, storeHistory: true };

const PARES = [
  { ler: 'load-memories', gravar: 'save-memories', arquivo: 'memories.json', vazio: [], comFalha: [], valor: [{ id: '1', content: 'a' }] },
  { ler: 'load-user-profile', gravar: 'save-user-profile', arquivo: 'user_profile.json', vazio: {}, comFalha: {}, valor: { nome: 'Ana', idade: 3 } },
  { ler: 'load-dashboard-settings', gravar: 'save-dashboard-settings', arquivo: 'dashboard_settings.json', vazio: PADRAO_DO_PAINEL, comFalha: PADRAO_DO_PAINEL_COM_FALHA, valor: { interests: ['Rio'], refreshInterval: 60 } },
  { ler: 'load-history', gravar: 'save-history', arquivo: 'history.json', vazio: [], comFalha: [], valor: [{ role: 'user', text: 'oi' }] },
  { ler: 'load-history-settings', gravar: 'save-history-settings', arquivo: 'history_settings.json', vazio: PADRAO_DO_HISTORICO, comFalha: PADRAO_DO_HISTORICO, valor: { maxContextMessages: 5, storeHistory: false } },
  { ler: 'load-contacts', gravar: 'save-contacts', arquivo: 'contacts.json', vazio: [], comFalha: [], valor: [{ nome: 'Bia', telefone: '1' }] },
  { ler: 'load-notes', gravar: 'save-notes', arquivo: 'notes.json', vazio: [], comFalha: [], valor: [{ id: 'n1', title: 't' }] },
  { ler: 'load-tasks', gravar: 'save-tasks', arquivo: 'tasks.json', vazio: [], comFalha: [], valor: [{ id: 't1', done: false }] },
];

function gravar(arquivo, conteudo) {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  fs.writeFileSync(arquivo, conteudo);
}

const caminhoDe = (main, arquivo) => path.join(main.pasta('userData'), arquivo);
const textoGravado = (main, arquivo) => fs.readFileSync(caminhoDe(main, arquivo), 'utf8');
const bloquear = (main, arquivo) => fs.mkdirSync(caminhoDe(main, arquivo), { recursive: true });

function chamarDireto(main, canal, ...argumentos) {
  return Promise.resolve(main.canais.handle.get(canal)({ sender: {} }, ...argumentos));
}

const NIVEL_ANOTADO = { log: 'log', info: 'log', error: 'error' };

function anotandoConsole(niveis, funcao) {
  const antes = niveis.map((nome) => console[nome]);
  const chamadas = [];
  for (const nome of niveis) console[nome] = (...partes) => chamadas.push([NIVEL_ANOTADO[nome], ...partes]);
  const restaurar = () => niveis.forEach((nome, indice) => { console[nome] = antes[indice]; });
  return Promise.resolve().then(funcao).then((resultado) => ({ resultado, chamadas })).finally(restaurar);
}

function comRelogioFixo(t) {
  t.mock.timers.enable({ apis: ['Date'], now: AGORA });
}

function comChaveDoGemini(valor, funcao) {
  const antes = process.env.GEMINI_API_KEY;
  if (valor === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = valor;
  const restaurar = () => {
    if (antes === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = antes;
  };
  return Promise.resolve().then(funcao).finally(restaurar);
}

for (const { ler, arquivo, vazio, comFalha, valor } of PARES) {
  test(`${ler}: sem arquivo devolve o padrão, com arquivo devolve o conteúdo e com JSON quebrado ou pasta no lugar devolve o padrão da falha`, async () => {
    const main = carregarMain();
    assert.deepStrictEqual(await main.invocar(ler), vazio);
    gravar(caminhoDe(main, arquivo), JSON.stringify(valor));
    assert.deepStrictEqual(await main.invocar(ler), valor);
    gravar(caminhoDe(main, arquivo), '{quebrado');
    assert.deepStrictEqual(await main.invocar(ler), comFalha);
    gravar(caminhoDe(main, arquivo), 'null');
    assert.strictEqual(await main.invocar(ler), null);

    const bloqueado = carregarMain();
    bloquear(bloqueado, arquivo);
    assert.deepStrictEqual(await bloqueado.invocar(ler), comFalha);
  });
}

for (const { gravar: canal, ler, arquivo, valor } of PARES) {
  test(`${canal}: grava ${arquivo} com recuo de dois espaços, devolve true e o ${ler} devolve o mesmo; sem poder gravar devolve false`, async () => {
    const main = carregarMain();
    assert.strictEqual(await main.invocar(canal, valor), true);
    assert.strictEqual(textoGravado(main, arquivo), JSON.stringify(valor, null, 2));
    assert.deepStrictEqual(await main.invocar(ler), valor);

    const bloqueado = carregarMain();
    bloquear(bloqueado, arquivo);
    assert.strictEqual(await bloqueado.invocar(canal, valor), false);
  });
}

test('os canais de gravação com valor indefinido não gravam nada e devolvem false', async () => {
  const main = carregarMain();
  for (const { gravar: canal, arquivo } of PARES) {
    assert.strictEqual(await main.invocar(canal, undefined), false, canal);
    assert.ok(!fs.existsSync(caminhoDe(main, arquivo)), arquivo);
  }
});

test('clear-history apaga history.json e devolve true, com ou sem arquivo; devolve false se não consegue apagar', async () => {
  const main = carregarMain();
  gravar(caminhoDe(main, 'history.json'), '[1]');
  assert.strictEqual(await main.invocar('clear-history'), true);
  assert.ok(!fs.existsSync(caminhoDe(main, 'history.json')));
  assert.strictEqual(await main.invocar('clear-history'), true);

  const bloqueado = carregarMain();
  bloquear(bloqueado, 'history.json');
  assert.strictEqual(await bloqueado.invocar('clear-history'), false);
});

test('load-chats: lê chats.json; sem ele, devolve o histórico antigo como um chat legado; sem nenhum dos dois, []', async () => {
  const main = carregarMain();
  assert.deepStrictEqual(await main.invocar('load-chats'), []);

  gravar(caminhoDe(main, 'history.json'), '[]');
  assert.deepStrictEqual(await main.invocar('load-chats'), []);

  const mensagens = [{ role: 'user', text: 'oi' }];
  gravar(caminhoDe(main, 'history.json'), JSON.stringify(mensagens));
  const antes = Date.now();
  const [legado] = await main.invocar('load-chats');
  const depois = Date.now();
  assert.deepStrictEqual({ ...legado, timestamp: 0 }, { id: 'legacy-history', title: 'Chat Legado', messages: mensagens, timestamp: 0, model: 'Claude 4.5 Sonnet' });
  assert.ok(legado.timestamp >= antes && legado.timestamp <= depois);
  assert.strictEqual((await main.invocar('load-chats')).length, 1);

  const chats = [{ id: 'c1', messages: [] }];
  gravar(caminhoDe(main, 'chats.json'), JSON.stringify(chats));
  assert.deepStrictEqual(await main.invocar('load-chats'), chats);

  gravar(caminhoDe(main, 'chats.json'), '{quebrado');
  assert.deepStrictEqual(await main.invocar('load-chats'), []);

  const quebrado = carregarMain();
  gravar(caminhoDe(quebrado, 'history.json'), '{quebrado');
  assert.deepStrictEqual(await quebrado.invocar('load-chats'), []);
});

function usuarioFalso() {
  const chamadas = { analisar: [], contexto: 0 };
  const analise = { resultado: { grafo: true }, erro: null };
  return {
    chamadas,
    analise,
    modulo: {
      analyzeUserGraph: (apiKey, chats) => {
        chamadas.analisar.push([apiKey, chats]);
        return analise.erro ? Promise.reject(analise.erro) : Promise.resolve(analise.resultado);
      },
      getUserContext: () => { chamadas.contexto++; return { contexto: 'do usuário' }; },
    },
  };
}

const DEZ = Array.from({ length: 10 }, (_, i) => i + 1);

async function gravarDezConversas(main, chats, invocar = (canal, ...argumentos) => main.invocar(canal, ...argumentos)) {
  let ultimo;
  for (let gravacao = 0; gravacao < DEZ.length; gravacao++) ultimo = await invocar('save-chats', chats);
  return ultimo;
}

test('save-chats grava chats.json e a cada décima gravação da sessão pede a análise do perfil com a chave do secret_key.json', async () => {
  const usuario = usuarioFalso();
  const main = carregarMain({ modulos: { './services/user-profile-manager': usuario.modulo } });
  gravar(caminhoDe(main, 'secret_key.json'), JSON.stringify({ apiKey: 'a', geminiKey: 'g' }));
  const chats = [{ id: 'c1' }];
  for (const n of DEZ) {
    assert.strictEqual(await main.invocar('save-chats', chats), true);
    assert.strictEqual(usuario.chamadas.analisar.length, n === 10 ? 1 : 0, `depois da gravação ${n}`);
  }
  assert.deepStrictEqual(usuario.chamadas.analisar, [['a', chats]]);
  assert.strictEqual(textoGravado(main, 'chats.json'), JSON.stringify(chats, null, 2));
  await gravarDezConversas(main, chats);
  assert.strictEqual(usuario.chamadas.analisar.length, 2);
});

test('save-chats na décima gravação: usa geminiKey sem apiKey, o ambiente sem as duas, e nada sem chave ou sem arquivo', async () => {
  const cenas = [
    [AUSENTE, 'do-ambiente', []],
    ['{"geminiKey":"g"}', 'do-ambiente', ['g']],
    ['{}', 'do-ambiente', ['do-ambiente']],
    ['{}', undefined, []],
    ['{"apiKey":"a"}', undefined, ['a']],
  ];
  for (const [conteudo, ambiente, esperado] of cenas) {
    const usuario = usuarioFalso();
    const main = carregarMain({ modulos: { './services/user-profile-manager': usuario.modulo } });
    if (conteudo !== AUSENTE) gravar(caminhoDe(main, 'secret_key.json'), conteudo);
    assert.strictEqual(await comChaveDoGemini(ambiente, () => gravarDezConversas(main, [])), true);
    assert.deepStrictEqual(usuario.chamadas.analisar.map(([chave]) => chave), esperado, `${conteudo.toString()} / ${ambiente}`);
  }
});

test('save-chats na décima gravação com secret_key.json quebrado: chats.json já foi gravado e o canal devolve false', async () => {
  const usuario = usuarioFalso();
  const main = carregarMain({ modulos: { './services/user-profile-manager': usuario.modulo } });
  gravar(caminhoDe(main, 'secret_key.json'), '{quebrado');
  for (const n of DEZ.slice(0, 9)) assert.strictEqual(await main.invocar('save-chats', [n]), true);
  assert.strictEqual(await main.invocar('save-chats', [10]), false);
  assert.strictEqual(textoGravado(main, 'chats.json'), JSON.stringify([10], null, 2));
  assert.deepStrictEqual(usuario.chamadas.analisar, []);
});

test('save-chats: a falha da análise do perfil só vai para o console e a gravação continua devolvendo true', async () => {
  const usuario = usuarioFalso();
  usuario.analise.erro = new Error('sem rede');
  const main = carregarMain({ modulos: { './services/user-profile-manager': usuario.modulo } });
  gravar(caminhoDe(main, 'secret_key.json'), '{"apiKey":"a"}');
  const { resultado, chamadas } = await anotandoConsole(['error'], async () => {
    const ultimo = await gravarDezConversas(main, [], (canal, ...argumentos) => chamarDireto(main, canal, ...argumentos));
    await new Promise((resolve) => setImmediate(resolve));
    return ultimo;
  });
  assert.strictEqual(resultado, true);
  assert.deepStrictEqual(chamadas, [['error', '[Continuous Learning] Sync error:', usuario.analise.erro]]);
});

test('get-user-context devolve o que o gerenciador de perfil devolve, a cada chamada', async () => {
  const usuario = usuarioFalso();
  const main = carregarMain({ modulos: { './services/user-profile-manager': usuario.modulo } });
  assert.deepStrictEqual(await main.invocar('get-user-context'), { contexto: 'do usuário' });
  assert.deepStrictEqual(await main.invocar('get-user-context'), { contexto: 'do usuário' });
  assert.strictEqual(usuario.chamadas.contexto, 2);
});

test('sync-user-context: usa apiKey, depois geminiKey, depois o ambiente; devolve a análise e null quando ela falha', async () => {
  const cenas = [
    [AUSENTE, 'do-ambiente', 'do-ambiente'],
    [AUSENTE, undefined, undefined],
    ['{"apiKey":"a","geminiKey":"g"}', 'do-ambiente', 'a'],
    ['{"geminiKey":"g"}', 'do-ambiente', 'g'],
    ['{}', 'do-ambiente', 'do-ambiente'],
  ];
  for (const [conteudo, ambiente, chaveEsperada] of cenas) {
    const usuario = usuarioFalso();
    const main = carregarMain({ modulos: { './services/user-profile-manager': usuario.modulo } });
    if (conteudo !== AUSENTE) gravar(caminhoDe(main, 'secret_key.json'), conteudo);
    const chats = [{ id: 'c' }];
    const resposta = await comChaveDoGemini(ambiente, () => main.invocar('sync-user-context', chats));
    assert.deepStrictEqual(resposta, { grafo: true });
    assert.deepStrictEqual(usuario.chamadas.analisar, [[chaveEsperada, chats]], `${conteudo.toString()} / ${ambiente}`);
  }

  const falha = usuarioFalso();
  falha.analise.erro = new Error('quebrou');
  const comErro = carregarMain({ modulos: { './services/user-profile-manager': falha.modulo } });
  assert.strictEqual(await comErro.invocar('sync-user-context', []), null);

  const quebrado = usuarioFalso();
  const comArquivoQuebrado = carregarMain({ modulos: { './services/user-profile-manager': quebrado.modulo } });
  gravar(caminhoDe(comArquivoQuebrado, 'secret_key.json'), '{quebrado');
  assert.strictEqual(await comArquivoQuebrado.invocar('sync-user-context', []), null);
  assert.deepStrictEqual(quebrado.chamadas.analisar, []);
});

test('save-quick-note: acrescenta no começo de notes.json uma nota do WhatsApp com título cortado em 40 letras e avisa no console', async (t) => {
  comRelogioFixo(t);
  const main = carregarMain();
  const curto = await anotandoConsole(['log', 'info', 'error'], () => chamarDireto(main, 'save-quick-note', { text: 'comprar pão', timestamp: 77 }));
  const notaCurta = { id: `qn_${AGORA}`, title: 'comprar pão', content: 'comprar pão', timestamp: 77, createdAt: new Date(AGORA).toISOString(), source: 'whatsapp' };
  assert.deepStrictEqual(curto.resultado, { success: true, note: notaCurta });
  assert.deepStrictEqual(curto.chamadas, [['log', '[Main] Quick note saved via WhatsApp:', 'comprar pão']]);
  assert.strictEqual(textoGravado(main, 'notes.json'), JSON.stringify([notaCurta], null, 2));

  const texto = 'x'.repeat(60);
  const longa = await main.invocar('save-quick-note', { text: texto });
  assert.strictEqual(longa.note.title, `${'x'.repeat(40)}...`);
  assert.strictEqual(longa.note.content, texto);
  assert.strictEqual(longa.note.timestamp, AGORA);
  assert.deepStrictEqual(JSON.parse(textoGravado(main, 'notes.json')).map((nota) => nota.content), [texto, 'comprar pão']);

  const justo = await main.invocar('save-quick-note', { text: 'y'.repeat(40) });
  assert.strictEqual(justo.note.title, 'y'.repeat(40));
});

test('save-quick-note: notes.json quebrado recomeça a lista; sem texto ou sem poder gravar devolve success false com a mensagem', async (t) => {
  comRelogioFixo(t);
  const main = carregarMain();
  gravar(caminhoDe(main, 'notes.json'), '{quebrado');
  const recomeco = await main.invocar('save-quick-note', { text: 'a' });
  assert.strictEqual(recomeco.success, true);
  assert.deepStrictEqual(JSON.parse(textoGravado(main, 'notes.json')).map((nota) => nota.content), ['a']);

  const semTexto = await anotandoConsole(['error'], () => chamarDireto(main, 'save-quick-note', { timestamp: 1 }));
  assert.strictEqual(semTexto.resultado.success, false);
  assert.match(semTexto.resultado.error, /reading 'length'/);
  assert.strictEqual(semTexto.chamadas.length, 1);
  assert.strictEqual(semTexto.chamadas[0][1], '[Main] save-quick-note error:');

  const bloqueado = carregarMain();
  bloquear(bloqueado, 'notes.json');
  const falhou = await anotandoConsole(['error'], () => chamarDireto(bloqueado, 'save-quick-note', { text: 'b' }));
  assert.strictEqual(falhou.resultado.success, false);
  assert.strictEqual(typeof falhou.resultado.error, 'string');
});

test('chat:get-recall-summary: sem histórico, as últimas mensagens (5 por padrão) com User e Nova, e a mensagem de erro quando quebra', async () => {
  const main = carregarMain();
  assert.strictEqual(await main.invocar('chat:get-recall-summary'), 'No previous history found.');
  const historico = Array.from({ length: 8 }, (_, i) => ({ role: i % 2 ? 'model' : 'user', text: `m${i}` }));
  gravar(caminhoDe(main, 'history.json'), JSON.stringify(historico));
  assert.strictEqual(await main.invocar('chat:get-recall-summary'), 'Nova: m3\nUser: m4\nNova: m5\nUser: m6\nNova: m7');
  assert.strictEqual(await main.invocar('chat:get-recall-summary', 2), 'User: m6\nNova: m7');
  assert.strictEqual(await main.invocar('chat:get-recall-summary', 0), 'Nova: m3\nUser: m4\nNova: m5\nUser: m6\nNova: m7');
  assert.strictEqual(await main.invocar('chat:get-recall-summary', 100).then((texto) => texto.split('\n').length), 8);
  gravar(caminhoDe(main, 'history.json'), '[]');
  assert.strictEqual(await main.invocar('chat:get-recall-summary'), '');
  gravar(caminhoDe(main, 'history.json'), '{quebrado');
  assert.strictEqual(await main.invocar('chat:get-recall-summary'), 'Error recalling history.');
});

function geminiFalso(texto) {
  const registro = { chaves: [], modelos: [], prompts: [] };
  const resposta = { texto, erro: null };
  class GoogleGenerativeAI {
    constructor(chave) { registro.chaves.push(chave); }
    getGenerativeModel(...argumentos) {
      registro.modelos.push(argumentos);
      return {
        generateContent: async (prompt) => {
          registro.prompts.push(prompt);
          if (resposta.erro) throw resposta.erro;
          return { response: { text: () => resposta.texto } };
        },
      };
    }
  }
  return { registro, resposta, modulo: { GoogleGenerativeAI } };
}

test('fetch-dashboard-data: sem chave devolve o aviso de erro e não chama o Gemini', async () => {
  const gemini = geminiFalso('{}');
  const main = carregarMain({ modulos: { '@google/generative-ai': gemini.modulo } });
  const resposta = await comChaveDoGemini(undefined, () => main.invocar('fetch-dashboard-data', { location: 'Rio', interests: ['a'] }));
  assert.deepStrictEqual(resposta, { headlines: ['Error: API Key missing'], weather: { today: 'Error ⚠️' } });
  assert.deepStrictEqual(gemini.registro.chaves, []);
});

test('fetch-dashboard-data: pergunta ao Gemini com a ferramenta de busca, devolve o JSON achado no texto e avisa quando não acha', async () => {
  const gemini = geminiFalso('antes {"headlines":["h1"],"weather":{"today":"sol"}} depois');
  const main = carregarMain({ modulos: { '@google/generative-ai': gemini.modulo } });
  const resposta = await comChaveDoGemini('chave-do-ambiente', () => main.invocar('fetch-dashboard-data', { location: 'Rio', interests: ['Tech', 'Música'] }));
  assert.deepStrictEqual(resposta, { headlines: ['h1'], weather: { today: 'sol' } });
  assert.deepStrictEqual(gemini.registro.chaves, ['chave-do-ambiente']);
  assert.deepStrictEqual(gemini.registro.modelos, [[{ model: 'gemini-3.8-flash', tools: [{ googleSearch: {} }] }, { apiVersion: 'v1beta' }]]);
  assert.deepStrictEqual(gemini.registro.prompts, ['Search for top 5 news headlines for: Tech, Música in Rio. Also get weather. Respond in ENGLISH and return JSON: {"headlines": [...], "weather": {"today": "...", "tomorrow": "...", "dayAfter": "..."}}']);

  await comChaveDoGemini('k', () => main.invocar('fetch-dashboard-data', { interests: ['x'] }));
  assert.ok(gemini.registro.prompts[1].startsWith('Search for top 5 news headlines for: x in Pakistan. Also get weather.'));

  gemini.resposta.texto = 'sem json aqui';
  assert.deepStrictEqual(await comChaveDoGemini('k', () => main.invocar('fetch-dashboard-data', { interests: ['x'] })), { headlines: ['Error parsing data'], weather: { today: 'N/A' } });
});

test('fetch-dashboard-data: erro do Gemini, JSON inválido no texto e interesses ausentes viram o aviso com a mensagem do erro', async () => {
  const gemini = geminiFalso('{}');
  const main = carregarMain({ modulos: { '@google/generative-ai': gemini.modulo } });
  gemini.resposta.erro = new Error('cota esgotada');
  assert.deepStrictEqual(await comChaveDoGemini('k', () => main.invocar('fetch-dashboard-data', { interests: ['x'] })), { headlines: ['Error: cota esgotada'], weather: { today: 'Error ⚠️' } });

  gemini.resposta.erro = null;
  gemini.resposta.texto = '{nao é json}';
  const invalido = await comChaveDoGemini('k', () => main.invocar('fetch-dashboard-data', { interests: ['x'] }));
  assert.strictEqual(invalido.headlines.length, 1);
  assert.ok(invalido.headlines[0].startsWith('Error: '));
  assert.deepStrictEqual(invalido.weather, { today: 'Error ⚠️' });

  const semInteresses = await comChaveDoGemini('k', () => main.invocar('fetch-dashboard-data', { location: 'Rio' }));
  assert.ok(semInteresses.headlines[0].startsWith('Error: '));
  assert.deepStrictEqual(semInteresses.weather, { today: 'Error ⚠️' });
});

test('os vinte e sete canais dos dados estão registrados como handle', () => {
  const main = carregarMain();
  const canais = [
    ...PARES.flatMap(({ ler, gravar: canal }) => [ler, canal]),
    'clear-history', 'load-chats', 'save-chats', 'get-user-context', 'sync-user-context', 'save-quick-note',
    'ltm:save-insight', 'ltm:get-insights', 'ltm:clear-all', 'chat:get-recall-summary', 'fetch-dashboard-data',
  ];
  assert.strictEqual(canais.length, 27);
  for (const canal of canais) assert.ok(main.canais.handle.has(canal), canal);
});
