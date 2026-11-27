'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const Module = require('module');

const processosReais = require('child_process');
const carregarOriginal = Module._load;
const abaQueRecusaOAgente = { pedida: false, sessao: null };

function recusarOAgenteNaAbaPedida(cliente) {
  const enviar = cliente.send.bind(cliente);
  cliente.on('Target.attachedToTarget', ({ sessionId, targetInfo }) => {
    if (abaQueRecusaOAgente.pedida && targetInfo.openerId) abaQueRecusaOAgente.sessao = sessionId;
  });
  cliente.send = (metodo, params, sessao, ...resto) => {
    const recusar = metodo === 'Network.setUserAgentOverride' && sessao === abaQueRecusaOAgente.sessao;
    return enviar(metodo, recusar ? { ...params, userAgent: undefined } : params, sessao, ...resto);
  };
  return cliente;
}

function comAbaQueRecusaOAgente(CDP) {
  return Object.assign(async (...args) => recusarOAgenteNaAbaPedida(await CDP(...args)), CDP);
}

Module._load = function (pedido, ...resto) {
  if (pedido === 'chrome-remote-interface') return comAbaQueRecusaOAgente(carregarOriginal.call(this, pedido, ...resto));
  if (pedido !== 'child_process') return carregarOriginal.call(this, pedido, ...resto);
  const semLimpezaDeOrfaos = { execSync: () => '', spawnSync: () => ({ status: 0 }) };
  const eOChrome = (args) => args.some((argumento) => argumento.startsWith('--remote-debugging-port='));
  const semJanela = (comando, args, opcoes) => processosReais.spawn(comando, eOChrome(args) ? [...args, '--headless=new'] : args, opcoes);
  return { ...processosReais, ...semLimpezaDeOrfaos, spawn: semJanela };
};
const GlobalSpoofService = require('../global-spoof-service');
const CDP = require('chrome-remote-interface');

const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-aba-sem-opener-'));
const pedidos = [];
let servico;
let servidor;

function criarServico() {
  const userData = path.join(raiz, 'userData');
  fs.mkdirSync(userData);
  const tmpdirOriginal = os.tmpdir;
  os.tmpdir = () => raiz;
  try {
    servico = new GlobalSpoofService(null, { getPath: () => userData }, null);
  } finally {
    os.tmpdir = tmpdirOriginal;
  }
  servico._generateY4M = async () => {};
}

const paginaQueRegistraODisfarce = (nome) => `<!doctype html><head><script>document.title = '${nome} disfarce=' + Boolean(window.__nova_stealth_applied);</script></head><body>${nome}</body>`;

function abrirServidor() {
  servidor = http.createServer((requisicao, resposta) => {
    pedidos.push(requisicao.url);
    resposta.setHeader('content-type', 'text/html');
    resposta.end(paginaQueRegistraODisfarce(requisicao.url.slice(1) || 'primeira'));
  });
  return new Promise((resolve) => servidor.listen(0, '127.0.0.1', () => resolve(servidor.address().port)));
}

const portaEstaLivre = (porta) => new Promise((resolve) => {
  const tentativa = net.createServer().once('error', () => resolve(false));
  tentativa.listen(porta, '127.0.0.1', () => tentativa.close(() => resolve(true)));
});

async function acharPortaDeDepuracaoLivre() {
  for (let porta = 9222; porta < 10222; porta++) {
    if (await portaEstaLivre(porta)) return porta;
  }
  throw new Error('nenhuma porta de depuração livre');
}

async function esperarAte(condicao, tentativas, motivo) {
  for (let tentativa = 0; tentativa < tentativas; tentativa++) {
    const resultado = await condicao();
    if (resultado) return resultado;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.fail(await motivo());
}

const abasAbertas = async (porta) => (await CDP.List({ port: porta })).filter((alvo) => alvo.type === 'page');

async function abrirServicoNaPorta(porta, ajustes) {
  const sorteioOriginal = Math.random;
  Math.random = () => (porta - 9222) / 1000;
  try {
    return await servico.startHijack(Buffer.alloc(0), ajustes);
  } finally {
    Math.random = sorteioOriginal;
  }
}

async function abrirComNoopener(aba, url) {
  const cliente = await CDP({ target: aba.webSocketDebuggerUrl });
  try {
    await cliente.Runtime.evaluate({ expression: `window.open(${JSON.stringify(url)}, '_blank', 'noopener')`, userGesture: true });
  } finally {
    await cliente.close();
  }
}

function apagar(pasta) {
  try {
    fs.rmSync(pasta, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

const estaVivo = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

after(async () => {
  Module._load = carregarOriginal;
  const pidDoChrome = servico && servico.chromePid;
  if (servico) await servico.stopHijack();
  if (pidDoChrome) await esperarAte(() => !estaVivo(pidDoChrome), 50, () => `o Chrome de teste (PID ${pidDoChrome}) continuou vivo`);
  if (servidor) servidor.close();
  await esperarAte(() => apagar(raiz), 100, () => `não deu para apagar ${raiz}`);
});

const chromeDoSpoof = { origem: null, porta: null, primeira: null };

async function abrirChromeDoSpoof(t) {
  if (process.platform !== 'win32') return t.skip('só roda no Windows: nos outros sistemas o Chrome do spoof é achado e encerrado de outro jeito');
  if (chromeDoSpoof.primeira) return true;
  criarServico();
  const caminhoDoChrome = servico._findChrome();
  if (!caminhoDoChrome || !fs.existsSync(caminhoDoChrome)) return t.skip('sem Chrome instalado nesta máquina');
  const origem = `http://127.0.0.1:${await abrirServidor()}`;
  const porta = await acharPortaDeDepuracaoLivre();
  const aberto = await abrirServicoNaPorta(porta, { device: { id: 'desktop' }, url: `${origem}/`, profile: 'Default', audioPath: path.join(raiz, 'sem-audio.wav') });
  assert.strictEqual(aberto.success, true);
  chromeDoSpoof.primeira = await esperarAte(async () => (await abasAbertas(porta).catch(() => [])).find((aba) => aba.url === `${origem}/`), 100, () => 'a primeira aba não carregou a URL pedida');
  Object.assign(chromeDoSpoof, { origem, porta });
  return true;
}

test('no Windows, com o Chrome instalado: a aba aberta com window.open e noopener carrega a URL e já recebe o disfarce na primeira carga', async (t) => {
  if (!await abrirChromeDoSpoof(t)) return;
  const { origem, porta, primeira } = chromeDoSpoof;

  await abrirComNoopener(primeira, `${origem}/segunda`);

  const segunda = await esperarAte(async () => (await abasAbertas(porta)).find((aba) => aba.url === `${origem}/segunda`), 40, async () => `a aba aberta com noopener ficou em branco: abas ${JSON.stringify((await abasAbertas(porta)).map((aba) => aba.url))}`);
  assert.strictEqual(segunda.title, 'segunda disfarce=true');
  assert.strictEqual(pedidos.filter((url) => url === '/segunda').length, 1);
});

test('no Windows, com o Chrome instalado: se o Chrome recusa o disfarce na aba aberta com noopener, o site não recebe nenhum pedido e a aba fica em branco', async (t) => {
  if (!await abrirChromeDoSpoof(t)) return;
  const { origem, porta, primeira } = chromeDoSpoof;
  abaQueRecusaOAgente.pedida = true;

  await abrirComNoopener(primeira, `${origem}/terceira`);

  await esperarAte(() => abaQueRecusaOAgente.sessao, 40, () => 'a aba nova não foi anexada');
  await new Promise((resolve) => setTimeout(resolve, 3000));
  assert.deepStrictEqual(pedidos.filter((url) => url === '/terceira'), []);
  assert.deepStrictEqual((await abasAbertas(porta)).map((aba) => aba.url).sort(), ['', `${origem}/`, `${origem}/segunda`]);
});
