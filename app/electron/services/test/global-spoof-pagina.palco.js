'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { EventEmitter } = require('events');
const { marcarCaminhos } = require('./caminhos-do-palco');

const MODULO = path.join(__dirname, '..', 'global-spoof-service.js');
const AGORA = Date.UTC(2026, 10, 27, 12, 0, 0);
const DataReal = Date;

class DataFixa extends DataReal {
  constructor(...argumentos) {
    if (argumentos.length === 0) super(AGORA);
    else super(...argumentos);
  }

  static now() {
    return AGORA;
  }
}

const palco = { spawns: [], cliente: null };

function processoFalso() {
  const processo = new EventEmitter();
  Object.assign(processo, { pid: 4242, unref() {}, kill() {} });
  return processo;
}

function clienteCdpFalso() {
  const cliente = { enviados: [], ouvintes: {}, ligado: false };
  cliente.on = (evento, ouvinte) => { cliente.ouvintes[evento] = ouvinte; };
  cliente.send = async (metodo, params, sessao) => { cliente.enviados.push({ metodo, params, sessao }); return {}; };
  cliente.close = () => {};
  cliente.Browser = { grantPermissions: async () => {} };
  cliente.Fetch = { authRequired() {}, requestPaused() {} };
  cliente.Target = { setAutoAttach: async () => { cliente.ligado = true; } };
  return cliente;
}

const cdpFalso = async () => palco.cliente;
cdpFalso.Version = async () => ({ webSocketDebuggerUrl: 'ws://falso' });

const childProcessFalso = {
  spawn: (comando, args, opcoes) => {
    palco.spawns.push({ comando, args, opcoes });
    const processo = processoFalso();
    if (comando === 'ffmpeg-falso') {
      setImmediate(() => {
        try { fs.writeFileSync(args[args.length - 1], 'RIFF'); } catch {}
        processo.emit('close', 0);
      });
    }
    return processo;
  },
  execSync: () => '',
  spawnSync: () => ({ status: 0 }),
};

const carregarOriginal = Module._load;
Module._load = function (pedido, ...resto) {
  if (pedido === 'child_process') return childProcessFalso;
  if (pedido === 'chrome-remote-interface') return cdpFalso;
  return carregarOriginal.call(this, pedido, ...resto);
};
const GlobalSpoofService = require(MODULO);

function sorteioFixo() {
  let estado = 12345;
  return () => {
    estado = (estado * 1103515245 + 12345) % 2147483648;
    return estado / 2147483648;
  };
}

const impressao = (texto) => ({
  bytes: Buffer.byteLength(texto),
  sha256: crypto.createHash('sha256').update(texto).digest('hex'),
});

async function esperarAte(condicao) {
  for (let tentativa = 0; tentativa < 200 && !condicao(); tentativa++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  if (!condicao()) throw new Error('o CDP falso não foi ligado a tempo');
}

function criarServico(raiz) {
  const userData = path.join(raiz, 'userData');
  fs.mkdirSync(userData);
  const tmpdirOriginal = os.tmpdir;
  os.tmpdir = () => raiz;
  let servico;
  try {
    servico = new GlobalSpoofService(null, { getPath: () => userData }, null);
  } finally {
    os.tmpdir = tmpdirOriginal;
  }
  servico.ffmpegPath = 'ffmpeg-falso';
  servico._findChrome = () => 'chrome-falso';
  servico._generateY4M = async () => {};
  return { servico, userData };
}

async function scriptEnviadoAoCdp() {
  await esperarAte(() => palco.cliente.ligado);
  await palco.cliente.ouvintes['Target.attachedToTarget']({ sessionId: 'aba-1', targetInfo: { type: 'page', url: 'about:blank' }, waitingForDebugger: false });
  const envio = palco.cliente.enviados.find((e) => e.metodo === 'Page.addScriptToEvaluateOnNewDocument');
  return envio ? impressao(envio.params.source) : null;
}

function lerExtensao(tempDir) {
  const pasta = path.join(tempDir, 'anti_detect_ext');
  return {
    manifest: JSON.parse(fs.readFileSync(path.join(pasta, 'manifest.json'), 'utf8')),
    inject: impressao(fs.readFileSync(path.join(pasta, 'inject.js'), 'utf8')),
  };
}

async function rodarCena(cena) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-spoof-pagina-'));
  const original = {
    plataforma: Object.getOwnPropertyDescriptor(process, 'platform'),
    random: Math.random,
    bytes: crypto.randomBytes,
    uuid: crypto.randomUUID,
    kill: process.kill,
  };
  Object.defineProperty(process, 'platform', { value: cena.plataforma, configurable: true });
  Math.random = sorteioFixo();
  crypto.randomBytes = (tamanho) => Buffer.alloc(tamanho, 7);
  crypto.randomUUID = () => '11111111-2222-4333-8444-555555555555';
  process.kill = () => true;
  global.Date = DataFixa;
  palco.spawns = [];
  palco.cliente = clienteCdpFalso();
  try {
    const { servico, userData } = criarServico(raiz);
    if (cena.perfil) fs.writeFileSync(path.join(userData, 'farm_profiles.json'), JSON.stringify([{ id: 'profile_01', name: 'Fixo', ...cena.perfil }]));
    const retorno = await servico.startHijack(Buffer.alloc(0), { url: 'about:blank', ...cena.ajustes });
    const diario = { retorno };
    if (retorno.success) {
      const cdp = await scriptEnviadoAoCdp();
      const chrome = palco.spawns.find((s) => s.comando === 'chrome-falso');
      diario.argumentosDoChrome = chrome.args.map((argumento) => marcarCaminhos(argumento, [[raiz, '<raiz>']]));
      diario.extensao = lerExtensao(servico.tempDir);
      diario.scriptDoCdp = cdp;
      diario.perfisGravados = fs.existsSync(path.join(userData, 'farm_profiles.json'))
        ? marcarCaminhos(fs.readFileSync(path.join(userData, 'farm_profiles.json'), 'utf8'), [[raiz, '<raiz>']])
        : null;
    }
    await servico.stopHijack();
    diario.estadoFinal = { isHijacking: servico.isHijacking, status: servico.getStatus() };
    return diario;
  } finally {
    global.Date = DataReal;
    Object.defineProperty(process, 'platform', original.plataforma);
    Math.random = original.random;
    crypto.randomBytes = original.bytes;
    crypto.randomUUID = original.uuid;
    process.kill = original.kill;
    fs.rmSync(raiz, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}

module.exports = { rodarCena };
