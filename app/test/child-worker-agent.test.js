'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');
const path = require('path');
const { instalacaoPorSistema } = require('../electron/services/paridade-utils');

const CAMINHO_DO_AGENTE = path.join(__dirname, '..', 'electron', 'services', 'child-worker-agent.js');
const MODULOS_FALSOS = { electron: { net: {} }, './browser-manager': { browserService: {} } };

function carregarAgente() {
  const carregarOriginal = Module._load;
  Module._load = function (pedido, pai, ...resto) {
    if (pai?.filename === CAMINHO_DO_AGENTE && pedido in MODULOS_FALSOS) return MODULOS_FALSOS[pedido];
    return carregarOriginal.call(this, pedido, pai, ...resto);
  };
  try {
    delete require.cache[CAMINHO_DO_AGENTE];
    return require(CAMINHO_DO_AGENTE);
  } finally {
    Module._load = carregarOriginal;
  }
}

function criarJanela() {
  const enviados = [];
  return { enviados, isDestroyed: () => false, webContents: { send: (canal, dados) => enviados.push({ canal, dados }) } };
}

function criarAgente(respostas, observacoes = {}) {
  const ChildWorkerAgent = carregarAgente();
  const janela = criarJanela();
  const agente = new ChildWorkerAgent(janela, {});
  const prompts = [];
  const ferramentas = [];
  agente._last429 = true;
  agente.STEP_DELAY_MS = 1;
  agente.callAI = async (_chave, _groq, prompt) => { prompts.push(prompt); return respostas.shift(); };
  agente.dispatchTool = async (nome, args) => { ferramentas.push({ nome, args }); return observacoes[nome] ?? `obs de ${nome}`; };
  return { agente, janela, prompts, ferramentas };
}

function textosDoLog(janela) {
  return janela.enviados.filter(e => e.canal === 'swarm:log').map(e => e.dados.text.replace(/^\[[^\]]*\] /, ''));
}

async function semLogNoConsole(acao) {
  const original = console.log;
  console.log = () => {};
  try {
    return await acao();
  } finally {
    console.log = original;
  }
}

async function rodarTarefa(respostas, observacoes, ...argumentos) {
  const rodada = criarAgente(respostas, observacoes);
  rodada.resultado = await semLogNoConsole(() => rodada.agente.executeTask(...argumentos));
  rodada.logs = textosDoLog(rodada.janela);
  return rodada;
}

async function primeiroPromptNoSistema(plataforma) {
  const original = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: plataforma });
  try {
    const { prompts } = await rodarTarefa(['Thought: pronto\nAction: FINAL_ANSWER(feito)'], {}, 'instalar X', 'chave-abc');
    return prompts[0];
  } finally {
    Object.defineProperty(process, 'platform', original);
  }
}

const SHELL_POR_SISTEMA = [
  ['darwin', 'macOS with POSIX shell; use open, osascript and native macOS paths'],
  ['win32', 'Windows with PowerShell/CMD'],
];

for (const [plataforma, shell] of SHELL_POR_SISTEMA) {
  test(`prompt do executeTask no ${plataforma} traz o shell e a receita de instalação logo depois do execute_shell`, async () => {
    const prompt = await primeiroPromptNoSistema(plataforma);
    assert.ok(prompt.includes(`3. execute_shell(command) — Run commands for ${shell}\n${instalacaoPorSistema(plataforma)}\n4. browser_navigate(url)`));
  });
}

test('prompt do executeTask diz o limite de passos e termina com a tarefa e o histórico vazio', async () => {
  const prompt = await primeiroPromptNoSistema('darwin');
  assert.ok(prompt.includes('Minimum 2, maximum 8 steps before FINAL_ANSWER.'));
  assert.ok(prompt.endsWith('===TASK===\ninstalar X\n\n===HISTORY===\n\n\nThought:'));
});

const BUSCA_SEM_ACAO_E_RESPOSTA = [
  'Thought: vou buscar\nAction: web_search(gatos)',
  'Thought: sem acao',
  'Thought: achei\nAction: FINAL_ANSWER(gatos miam)',
];

test('executeTask roda a ferramenta pedida, leva a observação ao próximo passo e devolve o FINAL_ANSWER', async () => {
  const { resultado, ferramentas, prompts } = await rodarTarefa([...BUSCA_SEM_ACAO_E_RESPOSTA], { web_search: 'resultado da busca' }, 'pesquise gatos', 'chave-abc');
  assert.deepStrictEqual({ resultado, ferramentas }, { resultado: { success: true, finalAnswer: 'gatos miam' }, ferramentas: [{ nome: 'web_search', args: 'gatos' }] });
  assert.ok(prompts[1].endsWith('===HISTORY===\nThought: vou buscar\nObservation: resultado da busca\n\nThought:'));
});

test('executeTask sem Action no passo avisa a IA no histórico e segue para o próximo passo', async () => {
  const { prompts, logs } = await rodarTarefa([...BUSCA_SEM_ACAO_E_RESPOSTA], {}, 'pesquise gatos', 'chave-abc');
  assert.ok(prompts[2].includes('Thought: sem acao\nObservation: No action detected. Please specify an Action.\n'));
  assert.deepStrictEqual(logs.filter(l => l.includes('Executing')), ['GEMINI 3 Executing: web_search(gatos)']);
});

test('executeTask registra a chave e o modelo e põe o modelo escolhido antes dos padrões, sem repetir', async () => {
  const { logs, agente } = await rodarTarefa([...BUSCA_SEM_ACAO_E_RESPOSTA], {}, 'pesquise gatos', 'chave-abc', 'gemini-4-argon', 'groq');
  assert.deepStrictEqual(logs.slice(0, 3), ['GEMINI 3 System Check: [chave... (len: 9)]', 'GEMINI 3 Child Model: gemini-4-argon', 'GEMINI 3 Starting task: "pesquise gatos"']);
  assert.deepStrictEqual(agente.GEMINI_CANDIDATES, [{ model: 'gemini-4-argon', api: 'v1beta' }, { model: 'gemini-3.8-flash', api: 'v1beta' }]);
});

test('executeTask sem FINAL_ANSWER junta as observações e, sem chave, marca a chave como vazia', async () => {
  const rodada = criarAgente(Array(8).fill('Thought: de novo\nAction: browse_site(a)'), { browse_site: 'pagina' });
  rodada.agente.MAX_STEPS = 2;
  const resultado = await semLogNoConsole(() => rodada.agente.executeTask('ler', ''));
  assert.deepStrictEqual(resultado, { success: true, finalAnswer: 'pagina\n\npagina' });
  assert.strictEqual(textosDoLog(rodada.janela)[0], 'GEMINI 3 System Check: [EMPTY]');
});

test('executeTask devolve o erro da IA e volta a ficar livre', async () => {
  const rodada = criarAgente([]);
  rodada.agente.callAI = async () => { throw new Error('sem cota'); };
  const resultado = await semLogNoConsole(() => rodada.agente.executeTask('x', 'k'));
  assert.deepStrictEqual({ resultado, ocupado: rodada.agente.isWorking }, { resultado: { success: false, error: 'sem cota' }, ocupado: false });
  assert.ok(textosDoLog(rodada.janela).includes('GEMINI 3 CRITICAL ERROR: sem cota'));
});

test('executeTask recusa tarefa nova enquanto o agente está ocupado', async () => {
  const { agente, prompts } = criarAgente(['Thought: x\nAction: FINAL_ANSWER(y)']);
  agente.isWorking = true;
  assert.deepStrictEqual(await agente.executeTask('y', 'k'), { error: 'Agent already busy. Wait or cancel first.' });
  assert.deepStrictEqual(prompts, []);
});

const COMANDOS_DAS_RECEITAS = [
  ['darwin', '{ hdiutil attach -nobrowse -readonly -mountpoint "TMP" "ARQ" && ditto "TMP/X.app" "/Applications/X.app"; hdiutil detach "TMP"; } >/dev/null 2>&1 &'],
  ['darwin', 'osascript -e \'do shell script "installer -pkg " & quoted form of "ARQ" & " -target /" with administrator privileges\' >/dev/null 2>&1 &'],
  ['win32', '"ARQ" /S'],
  ['win32', 'msiexec /i "ARQ" /qn /norestart'],
];

for (const [plataforma, comando] of COMANDOS_DAS_RECEITAS) {
  test(`receita do ${plataforma} chega inteira ao execute_shell pelo leitor ReAct: ${comando.slice(0, 24)}`, async () => {
    assert.ok(instalacaoPorSistema(plataforma).includes(comando));
    const { ferramentas } = await rodarTarefa([`Thought: instalar\nAction: execute_shell(${comando})`, 'Thought: ok\nAction: FINAL_ANSWER(instalado)'], {}, 'instalar', 'k');
    assert.deepStrictEqual(ferramentas, [{ nome: 'execute_shell', args: comando }]);
  });
}

test('receita do .dmg, lida pelo leitor ReAct, roda no sh e chama hdiutil e ditto em segundo plano', { skip: process.platform === 'win32' }, async () => {
  const fs = require('fs');
  const os = require('os');
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-receita-dmg-'));
  const registro = path.join(pasta, 'chamadas.log');
  for (const programa of ['hdiutil', 'ditto']) {
    fs.writeFileSync(path.join(pasta, programa), `#!/bin/sh\necho "${programa} $*" >> "${registro}"\n`, { mode: 0o755 });
  }
  const caminhoOriginal = process.env.PATH;
  process.env.PATH = `${pasta}${path.delimiter}${caminhoOriginal}`;
  try {
    const comando = COMANDOS_DAS_RECEITAS[0][1].replaceAll('TMP', `${pasta}/mnt`).replaceAll('ARQ', `${pasta}/App.dmg`).replaceAll('X.app', 'App.app');
    const { agente, ferramentas } = await rodarTarefa([`Thought: instalar\nAction: execute_shell(${comando})`, 'Thought: ok\nAction: FINAL_ANSWER(instalado)'], {}, 'instalar', 'k');
    assert.strictEqual(await agente._execShell(ferramentas[0].args), 'Command executed successfully.');
    const detachRegistrado = () => fs.existsSync(registro) && fs.readFileSync(registro, 'utf8').includes('detach');
    for (let tentativa = 0; tentativa < 50 && !detachRegistrado(); tentativa++) {
      await new Promise(r => setTimeout(r, 20));
    }
    assert.deepStrictEqual(fs.readFileSync(registro, 'utf8').trim().split('\n'), [
      `hdiutil attach -nobrowse -readonly -mountpoint ${pasta}/mnt ${pasta}/App.dmg`,
      `ditto ${pasta}/mnt/App.app /Applications/App.app`,
      `hdiutil detach ${pasta}/mnt`,
    ]);
  } finally {
    process.env.PATH = caminhoOriginal;
    fs.rmSync(pasta, { recursive: true, force: true });
  }
});

test('executeTask espera entre os passos, nunca antes do primeiro, e sem Thought registra Analyzing...', async () => {
  const rodada = criarAgente(['Action: web_search(a)', 'Thought: b\nAction: web_search(b)', 'Thought: fim\nAction: FINAL_ANSWER(ok)']);
  rodada.agente.STEP_DELAY_MS = 7;
  const esperas = [];
  const setTimeoutOriginal = global.setTimeout;
  global.setTimeout = (funcao, ms, ...resto) => {
    if (ms === 7) esperas.push(ms);
    return setTimeoutOriginal(funcao, ms, ...resto);
  };
  try {
    await semLogNoConsole(() => rodada.agente.executeTask('x', 'k'));
  } finally {
    global.setTimeout = setTimeoutOriginal;
  }
  assert.deepStrictEqual(esperas, [7, 7]);
  assert.ok(rodada.prompts[1].includes('===HISTORY===\nThought: Analyzing...\nObservation: obs de web_search\n'));
});
