'use strict';

const { test, beforeEach, afterEach, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { EventEmitter } = require('events');

const palco = {};

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
    return palco.aoSpawn(comando, args);
  },
  execSync: (comando) => {
    palco.comandos.push(comando);
    return palco.aoExecSync(comando);
  },
  spawnSync: () => ({ status: 0 }),
};

const carregarOriginal = Module._load;
Module._load = function (pedido, ...resto) {
  if (pedido === 'child_process') return childProcessFalso;
  if (pedido === 'chrome-remote-interface') return cdpFalso;
  return carregarOriginal.call(this, pedido, ...resto);
};
const GlobalSpoofService = require('../global-spoof-service');

const plataformaOriginal = Object.getOwnPropertyDescriptor(process, 'platform');
const matarDeVerdade = process.kill;
const raizes = [];
const servicos = [];

function usarPlataforma(nome) {
  Object.defineProperty(process, 'platform', { value: nome, configurable: true });
}

beforeEach(() => {
  Object.assign(palco, {
    spawns: [],
    comandos: [],
    aoSpawn: () => processoFalso(),
    aoExecSync: () => '',
    cliente: clienteCdpFalso(),
    sinais: [],
  });
  ffmpegFalso(0);
  process.kill = (pid, sinal) => { palco.sinais.push({ pid, sinal }); return true; };
});

afterEach(async () => {
  while (servicos.length) await servicos.pop().stopHijack();
  Object.defineProperty(process, 'platform', plataformaOriginal);
  process.kill = matarDeVerdade;
});

after(() => {
  Module._load = carregarOriginal;
  for (const raiz of raizes) fs.rmSync(raiz, { recursive: true, force: true });
});

function criarServico() {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-spoof-'));
  raizes.push(raiz);
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
  servicos.push(servico);
  return { servico, userData, tempDir: servico.tempDir };
}

function gravarPerfil(userData, perfil) {
  fs.writeFileSync(path.join(userData, 'farm_profiles.json'), JSON.stringify([perfil]));
}

function lerInject(tempDir) {
  return fs.readFileSync(path.join(tempDir, 'anti_detect_ext', 'inject.js'), 'utf8');
}

const ajustesDaInterface = (extras) => ({ device: { id: 'desktop' }, url: 'about:blank', ...extras });

test('perfil Default com o regional da interface: abre sem erro e o fuso e o idioma chegam ao disfarce', async () => {
  usarPlataforma('win32');
  const { servico, tempDir } = criarServico();
  const regional = { timezone: 'America/Sao_Paulo', language: 'pt-BR' };
  const resultado = await servico.startHijack(Buffer.alloc(0), ajustesDaInterface({ profile: 'Default', regional }));
  assert.strictEqual(resultado.success, true);
  const inject = lerInject(tempDir);
  assert.match(inject, /var _tTimezone = "America\/Sao_Paulo";/);
  assert.match(inject, /var _tLocale = "pt-BR";/);
});

test('perfil Default com o regional optimal que a interface manda: o fuso e o idioma ficam no padrão do disfarce', async () => {
  usarPlataforma('win32');
  const { servico, tempDir } = criarServico();
  const regional = { timezone: 'optimal', utcOffset: 4, language: 'optimal' };
  const resultado = await servico.startHijack(Buffer.alloc(0), ajustesDaInterface({ profile: 'Default', regional }));
  assert.strictEqual(resultado.success, true);
  const inject = lerInject(tempDir);
  assert.match(inject, /var _tTimezone = "Asia\/Dubai";/);
  assert.match(inject, /var _tLocale = "en-AE";/);
});

test('perfil salvo com fuso e idioma fixos continua mandando mais que o regional da interface', async () => {
  usarPlataforma('win32');
  const { servico, userData, tempDir } = criarServico();
  gravarPerfil(userData, { id: 'profile_01', name: 'Fixo', timezone: 'Europe/Lisbon', locale: 'pt-PT' });
  const regional = { timezone: 'America/Sao_Paulo', language: 'pt-BR' };
  const resultado = await servico.startHijack(Buffer.alloc(0), ajustesDaInterface({ profile: 'profile_01', regional }));
  assert.strictEqual(resultado.success, true);
  const inject = lerInject(tempDir);
  assert.match(inject, /var _tTimezone = "Europe\/Lisbon";/);
  assert.match(inject, /var _tLocale = "pt-PT";/);
});

async function esperarAte(condicao, motivo = 'o CDP falso não foi ligado a tempo') {
  for (let tentativa = 0; tentativa < 100 && !condicao(); tentativa++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(condicao(), motivo);
}

async function abrirComUrl(url) {
  usarPlataforma('win32');
  const { servico } = criarServico();
  await servico.startHijack(Buffer.alloc(0), ajustesDaInterface({ profile: 'Default', url }));
  await esperarAte(() => palco.cliente.ligado);
  return palco.cliente;
}

async function anexarAlvo(cliente, sessionId, targetInfo) {
  await cliente.ouvintes['Target.attachedToTarget']({ sessionId, targetInfo, waitingForDebugger: false });
}

const metodosDaSessao = (cliente, sessao) => cliente.enviados.filter((e) => e.sessao === sessao).map((e) => e.metodo);

test('o Chrome abre em about:blank e a URL pedida só carrega depois do disfarce registrado na aba', async () => {
  const url = 'https://example.com/pagina';
  const cliente = await abrirComUrl(url);
  const argumentosDoChrome = palco.spawns.find((s) => s.comando === 'chrome-falso').args;
  assert.ok(argumentosDoChrome.includes('about:blank'));
  assert.ok(!argumentosDoChrome.some((a) => a.includes('example.com')));
  await anexarAlvo(cliente, 'aba-1', { type: 'page', url: 'about:blank' });
  const metodos = metodosDaSessao(cliente, 'aba-1');
  assert.ok(metodos.indexOf('Page.addScriptToEvaluateOnNewDocument') >= 0);
  assert.ok(metodos.indexOf('Page.navigate') > metodos.indexOf('Page.addScriptToEvaluateOnNewDocument'));
  const navegacao = cliente.enviados.find((e) => e.metodo === 'Page.navigate');
  assert.deepStrictEqual(navegacao.params, { url });
});

test('só a primeira aba em branco navega: iframe e janela aberta por outra página ficam como estão', async () => {
  const cliente = await abrirComUrl('https://example.com/pagina');
  await anexarAlvo(cliente, 'quadro-1', { type: 'iframe', url: 'about:blank' });
  await anexarAlvo(cliente, 'popup-1', { type: 'page', url: 'about:blank', openerId: 'aba-1' });
  await anexarAlvo(cliente, 'aba-2', { type: 'page', url: 'https://example.org/' });
  assert.ok(!cliente.enviados.some((e) => e.metodo === 'Page.navigate'));
});

test('se o disfarce não for registrado na aba, a URL pedida não é aberta (a aba fica em branco)', async () => {
  const cliente = await abrirComUrl('https://example.com/pagina');
  const enviar = cliente.send;
  cliente.send = async (metodo, params, sessao) => {
    if (metodo === 'Page.addScriptToEvaluateOnNewDocument') throw new Error('sem disfarce');
    return enviar(metodo, params, sessao);
  };
  await anexarAlvo(cliente, 'aba-1', { type: 'page', url: 'about:blank' });
  assert.ok(!cliente.enviados.some((e) => e.metodo === 'Page.navigate'));
});

const execSyncReal = carregarOriginal.call(Module, 'child_process').execSync;
const eWindows = plataformaOriginal.value === 'win32';

function abrirChromeOrfao(marca) {
  const pasta = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nova-orfao-')), marca);
  fs.mkdirSync(pasta);
  const executavel = path.join(pasta, 'chrome.exe');
  fs.copyFileSync(process.execPath, executavel);
  const orfao = carregarOriginal.call(Module, 'child_process').spawn(executavel, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  raizes.push(path.dirname(pasta));
  return orfao;
}

const estaVivo = (pid) => { try { matarDeVerdade(pid, 0); return true; } catch { return false; } };

test('no Windows a limpeza acha o Chrome órfão do spoof e o encerra', { skip: !eWindows }, async () => {
  const marca = `nova_webcam_hijack_teste_${process.pid}`;
  const orfao = abrirChromeOrfao(marca);
  const outro = abrirChromeOrfao(`outra_pasta_${process.pid}`);
  try {
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.ok(estaVivo(orfao.pid) && estaVivo(outro.pid));
    usarPlataforma('win32');
    const { servico } = criarServico();
    palco.aoExecSync = (comando) => execSyncReal(comando.replace('nova_webcam_hijack', marca), { stdio: 'ignore', timeout: 20000 });
    await servico.startHijack(Buffer.alloc(0), ajustesDaInterface({ profile: 'Default' }));
    await esperarAte(() => !estaVivo(orfao.pid), 'o Chrome órfão continuou vivo');
    assert.ok(estaVivo(outro.pid), 'um Chrome fora do spoof não pode ser encerrado');
  } finally {
    for (const processo of [orfao, outro]) if (estaVivo(processo.pid)) processo.kill();
  }
});

const vm = require('vm');

function rodarDisfarceNaPagina(fonte, agenteDoUsuario) {
  class MediaStreamTrack { getSettings() { return {}; } }
  class MediaDevices { enumerateDevices() { return Promise.resolve([{ kind: 'videoinput', deviceId: 'nativo', label: 'Câmera real' }]); } }
  const pagina = vm.createContext({
    MediaStreamTrack,
    MediaDevices,
    document: { addEventListener() {}, documentElement: {} },
    fetch: () => Promise.resolve('chegou'),
    console,
    setTimeout,
  });
  pagina.window = pagina;
  pagina.navigator = vm.runInContext('({})', pagina);
  pagina.navigator.userAgent = agenteDoUsuario;
  vm.runInContext(fonte, pagina);
  return pagina;
}

const rotuloDaTrilha = (pagina) => Object.getOwnPropertyDescriptor(pagina.MediaStreamTrack.prototype, 'label').get.call({ kind: 'video' });

for (const [nome, dispositivo, agenteDoUsuario] of [
  ['desktop', { id: 'desktop' }, 'Mozilla/5.0 (Windows NT 10.0)'],
  ['iPhone', { id: 'iphone-15' }, 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)'],
]) {
  test(`${nome}: o rótulo da trilha da câmera é o mesmo da lista de dispositivos`, async () => {
    usarPlataforma('win32');
    const { servico, userData, tempDir } = criarServico();
    gravarPerfil(userData, { id: 'profile_01', name: 'Fixo', timezone: 'Europe/Lisbon', locale: 'pt-PT', virtualCamLabel: 'USB Camera' });
    await servico.startHijack(Buffer.alloc(0), { device: dispositivo, url: 'about:blank', profile: 'profile_01' });
    const pagina = rodarDisfarceNaPagina(lerInject(tempDir), agenteDoUsuario);
    const lista = await pagina.MediaDevices.prototype.enumerateDevices();
    assert.strictEqual(lista[0].label, 'USB Camera');
    assert.strictEqual(rotuloDaTrilha(pagina), lista[0].label);
  });
}

async function abrirPaginaComPerfil(perfil, dispositivo = { id: 'desktop' }) {
  usarPlataforma('win32');
  const { servico, userData, tempDir } = criarServico();
  const escolha = perfil ? { profile: 'profile_01' } : { profile: 'Default' };
  if (perfil) gravarPerfil(userData, { id: 'profile_01', name: 'Fixo', ...perfil });
  await servico.startHijack(Buffer.alloc(0), { device: dispositivo, url: 'about:blank', ...escolha });
  return rodarDisfarceNaPagina(lerInject(tempDir), 'Mozilla/5.0 (Windows NT 10.0)');
}

test('perfil Default e perfil sem o campo: a proteção contra varredura de portas fica ligada', async () => {
  for (const perfil of [null, { timezone: 'Europe/Lisbon', locale: 'pt-PT' }]) {
    const pagina = await abrirPaginaComPerfil(perfil);
    await assert.rejects(pagina.fetch('http://localhost:9222/json'), /Port Scan Protection/);
  }
});

test('perfil que desliga a proteção de propósito continua deixando o fetch para localhost passar', async () => {
  const pagina = await abrirPaginaComPerfil({ timezone: 'Europe/Lisbon', locale: 'pt-PT', portScanProtection: 'disable' });
  assert.strictEqual(await pagina.fetch('http://localhost:9222/json'), 'chegou');
});

function ffmpegFalso(demora) {
  palco.aoSpawn = (comando, args) => {
    const processo = processoFalso();
    if (comando === 'ffmpeg-falso') {
      setTimeout(() => {
        try { fs.writeFileSync(args[args.length - 1], 'RIFF'); } catch {}
        processo.emit('close', 0);
      }, demora);
    }
    return processo;
  };
}

async function abrirSemAudioPath(sistema) {
  usarPlataforma(sistema);
  const { servico, tempDir } = criarServico();
  ffmpegFalso(80);
  await servico.startHijack(Buffer.alloc(0), ajustesDaInterface({ profile: 'Default' }));
  return path.join(tempDir, 'room_ambience.wav');
}

for (const [sistema, tocador] of [['win32', 'powershell'], ['darwin', '/usr/bin/afplay']]) {
  test(`${sistema}: sem audioPath o WAV de ambiente já existe na primeira abertura e toca`, async () => {
    const wav = await abrirSemAudioPath(sistema);
    const argumentosDoChrome = palco.spawns.find((s) => s.comando === 'chrome-falso').args;
    assert.ok(argumentosDoChrome.includes(`--use-file-for-fake-audio-capture=${wav}`));
    const reproducao = palco.spawns.find((s) => s.comando === tocador);
    assert.ok(reproducao, 'o áudio falso não foi tocado');
    assert.ok(reproducao.args.join(' ').includes(wav));
    assert.ok(!reproducao.args.join(' ').includes('undefined'));
  });
}

for (const [sistema, tocador] of [['win32', 'powershell'], ['darwin', '/usr/bin/afplay']]) {
  test(`${sistema}: com audioPath, o arquivo escolhido é o que toca`, async () => {
    usarPlataforma(sistema);
    const { servico, tempDir } = criarServico();
    const escolhido = path.join(tempDir, 'minha-voz.wav');
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(escolhido, 'RIFF');
    await servico.startHijack(Buffer.alloc(0), ajustesDaInterface({ profile: 'Default', audioPath: escolhido }));
    const reproducao = palco.spawns.find((s) => s.comando === tocador);
    assert.ok(reproducao.args.join(' ').includes(escolhido));
  });
}

test('darwin: o stopHijack encerra o grupo do Chrome sem chamar o taskkill', async () => {
  usarPlataforma('darwin');
  const { servico } = criarServico();
  await servico.startHijack(Buffer.alloc(0), ajustesDaInterface({ profile: 'Default' }));
  await servico.stopHijack();
  assert.ok(!palco.spawns.some((s) => s.comando === 'taskkill'));
  assert.ok(palco.sinais.some((s) => s.pid === -4242));
});

test('win32: o stopHijack continua usando o taskkill pelo PID do Chrome', async () => {
  usarPlataforma('win32');
  const { servico } = criarServico();
  await servico.startHijack(Buffer.alloc(0), ajustesDaInterface({ profile: 'Default' }));
  await servico.stopHijack();
  const taskkill = palco.spawns.find((s) => s.comando === 'taskkill');
  assert.deepStrictEqual(taskkill.args, ['/F', '/T', '/PID', '4242']);
  assert.ok(!palco.sinais.some((s) => s.pid === -4242));
});
