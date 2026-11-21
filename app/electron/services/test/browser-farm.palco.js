'use strict';
const crypto = require('crypto');
const Module = require('module');
const path = require('path');
const { EventEmitter } = require('events');

const SERVICOS = path.join(__dirname, '..');
const CAMINHO_DA_FAZENDA = path.join(SERVICOS, 'browserFarmService.js');
const MODULOS_DA_FAZENDA = ['browserFarmService.js', 'perfil-da-fazenda.js'];
const NIVEIS_DO_CONSOLE = { log: 'stdout', info: 'stdout', warn: 'stderr', error: 'stderr' };
const AGORA = 1700000000000;

let carregamentoAtual = null;
const carregarOriginal = Module._load;

const ehDaFazenda = pai => Boolean(pai?.filename) && path.dirname(pai.filename) === SERVICOS
  && (MODULOS_DA_FAZENDA.includes(path.basename(pai.filename)) || path.basename(pai.filename).startsWith('fazenda-'));

Module._load = function (pedido, pai, ...resto) {
  const falso = carregamentoAtual && ehDaFazenda(pai) ? carregamentoAtual.modulos.get(pedido) : null;
  if (falso) return falso();
  return carregarOriginal.call(this, pedido, pai, ...resto);
};

const resumo = texto => ({ tamanho: texto.length, sha256: crypto.createHash('sha256').update(texto).digest('hex').slice(0, 20) });

const CONVERSOES = [
  [valor => valor instanceof Error, valor => ({ erro: valor.constructor.name, mensagem: valor.message })],
  [valor => Buffer.isBuffer(valor), valor => ({ buffer: valor.toString('hex') })],
  [valor => valor === undefined, () => '(undefined)'],
  [valor => typeof valor === 'function', () => '(função)'],
  [valor => typeof valor === 'string' && valor.length > 300, resumo],
  [valor => valor instanceof Set || valor instanceof Map, valor => ({ chaves: [...valor.keys()] })],
  [Array.isArray, valor => valor.map(paraRegistro)],
  [valor => typeof valor !== 'object' || valor === null, valor => valor],
  [valor => valor.falso === true, valor => `(${valor.rotulo})`],
];

function paraRegistro(valor) {
  const conversao = CONVERSOES.find(([casa]) => casa(valor));
  if (conversao) return conversao[1](valor);
  return Object.fromEntries(Object.entries(valor).map(([chave, item]) => [chave, paraRegistro(item)]));
}

class Relogio {
  constructor() {
    this.agora = 0;
    this.fila = [];
    this.sequencia = 0;
  }

  agendar(fn, ms, repete) {
    const id = ++this.sequencia;
    const espera = Math.max(0, Number(ms) || 0);
    this.fila.push({ id, fn, quando: this.agora + espera, repete: repete ? Math.max(1, espera) : 0 });
    return { id, unref() {} };
  }

  cancelar(marca) {
    const id = marca?.id;
    this.fila = this.fila.filter(t => t.id !== id);
  }

  proximoAte(limite) {
    const vencidos = this.fila.filter(t => t.quando <= limite).sort((a, b) => a.quando - b.quando || a.id - b.id);
    return vencidos[0] || null;
  }

  disparar(tarefa) {
    this.agora = Math.max(this.agora, tarefa.quando);
    if (tarefa.repete) tarefa.quando += tarefa.repete;
    else this.cancelar(tarefa);
    tarefa.fn();
  }
}

const umaVolta = () => new Promise(resolver => setImmediate(resolver));

async function voltas(n = 6) {
  for (let i = 0; i < n; i++) await umaVolta();
}

class Roteiro {
  constructor(cena) {
    this.cena = cena;
    this.registro = [];
    this.relogio = new Relogio();
    this.arquivos = { ...(cena.arquivos || {}) };
    this.pastas = { ...(cena.pastas || {}) };
    this.falhas = { ...(cena.falhas || {}) };
    this.respostas = Object.fromEntries(Object.entries(cena.respostas || {}).map(([tipo, valor]) => [tipo, [].concat(valor)]));
    this.rede = [...(cena.rede || [])];
    this.lancamentos = [...(cena.lancamentos || ['ok'])];
    this.carregamentos = [...(cena.carregamentos || ['dom-ready'])];
    this.semente = 7;
    this.contador = 0;
    this.janelas = [];
    this.contextos = [];
    this.sessoes = new Map();
    this.ipc = new Map();
  }

  anotar(...evento) {
    this.registro.push(evento.map(paraRegistro));
  }

  falhar(nome) {
    const falha = this.falhas[nome];
    if (!falha) return;
    if (Array.isArray(falha)) {
      const proxima = falha.shift();
      if (proxima) throw new Error(proxima);
      return;
    }
    throw falha instanceof Error ? falha : new Error(falha);
  }

  responder(tipo) {
    const fila = this.respostas[tipo];
    if (!fila || !fila.length) return undefined;
    const valor = fila.length > 1 ? fila.shift() : fila[0];
    if (valor instanceof Error) throw valor;
    return valor;
  }

  aleatorio() {
    this.semente = (this.semente * 1103515245 + 12345) % 2147483648;
    return this.semente / 2147483648;
  }

  async avancar(ms) {
    const limite = this.relogio.agora + ms;
    await voltas();
    for (let tarefa = this.relogio.proximoAte(limite); tarefa; tarefa = this.relogio.proximoAte(limite)) {
      this.relogio.disparar(tarefa);
      await voltas();
    }
    this.relogio.agora = limite;
    await voltas();
  }
}

function tipoDoScript(script) {
  if (typeof script === 'function') return 'rolagem';
  const tipos = [['isEmail', 'email'], ['notNowPatterns', 'popups'], ['Like button', 'like'], ['Subscribe/Follow', 'subscribe'],
    ['Comment box', 'comment'], ['Share button', 'share'], ['scrollBy({ top:', 'rolagem']];
  const achado = tipos.find(([marca]) => script.includes(marca));
  return achado ? achado[1] : 'outro';
}

function avaliar(roteiro, rotulo, script) {
  const tipo = tipoDoScript(script);
  roteiro.anotar(rotulo, tipo, typeof script === 'string' ? resumo(script) : '(função)');
  return roteiro.responder(tipo);
}

function paginaFalsa(roteiro, numero) {
  return {
    falso: true,
    rotulo: `página ${numero}`,
    bringToFront: async () => { roteiro.anotar(`page${numero}.bringToFront`); roteiro.falhar('bringToFront'); },
    goto: async (url, opcoes) => { roteiro.anotar(`page${numero}.goto`, url, opcoes); roteiro.falhar('goto'); },
    evaluate: async (script) => avaliar(roteiro, `page${numero}.evaluate`, script),
  };
}

class ContextoFalso extends EventEmitter {
  constructor(roteiro, pasta, opcoes) {
    super();
    this.falso = true;
    this.numero = roteiro.contextos.push(this);
    this.rotulo = `contexto ${this.numero}`;
    this.roteiro = roteiro;
    this.paginas = roteiro.cena.semPaginas ? [] : [paginaFalsa(roteiro, `${this.numero}.1`)];
    roteiro.anotar('launchPersistentContext', pasta, opcoes);
  }

  pages() {
    this.roteiro.falhar('pages');
    return this.paginas;
  }

  async newPage() {
    this.roteiro.anotar(`contexto${this.numero}.newPage`);
    const pagina = paginaFalsa(this.roteiro, `${this.numero}.nova`);
    this.paginas.push(pagina);
    return pagina;
  }

  async addInitScript(script) {
    this.roteiro.anotar(`contexto${this.numero}.addInitScript`, resumo(script));
    this.roteiro.falhar('addInitScript');
  }

  async close() {
    this.roteiro.anotar(`contexto${this.numero}.close`);
    this.paginas = [];
    this.emit('close');
    this.roteiro.falhar('closeContext');
  }
}

function lancador(roteiro, nome) {
  return {
    launchPersistentContext: async (pasta, opcoes) => {
      roteiro.anotar(`${nome}.launch`);
      const resultado = roteiro.lancamentos.length > 1 ? roteiro.lancamentos.shift() : roteiro.lancamentos[0];
      if (resultado !== 'ok') throw new Error(resultado);
      return new ContextoFalso(roteiro, pasta, opcoes);
    },
  };
}

class ConteudoFalso extends EventEmitter {
  constructor(roteiro, numero) {
    super();
    this.roteiro = roteiro;
    this.numero = numero;
  }

  setUserAgent(ua) { this.roteiro.anotar(`janela${this.numero}.setUserAgent`, ua); }
  stop() { this.roteiro.anotar(`janela${this.numero}.stop`); this.roteiro.falhar('stop'); }

  async executeJavaScript(script) {
    return avaliar(this.roteiro, `janela${this.numero}.executeJavaScript`, script);
  }
}

function carregarNaJanela(roteiro, janela, url) {
  roteiro.anotar(`janela${janela.numero}.loadURL`, url);
  const modo = roteiro.carregamentos.length > 1 ? roteiro.carregamentos.shift() : roteiro.carregamentos[0];
  if (modo === 'rejeita') return Promise.reject(new Error('ERR_ABORTED'));
  if (modo !== 'pendura') setImmediate(() => janela.webContents.emit(modo));
  return new Promise(() => {});
}

function janelaFalsa(roteiro) {
  return class BrowserWindow extends EventEmitter {
    constructor(opcoes) {
      super();
      this.falso = true;
      this.numero = roteiro.janelas.push(this);
      this.rotulo = `janela ${this.numero}`;
      this.destruida = false;
      this.webContents = new ConteudoFalso(roteiro, this.numero);
      roteiro.anotar('new BrowserWindow', { ...opcoes, webPreferences: { ...opcoes.webPreferences, session: opcoes.webPreferences.session.rotulo } });
    }

    isDestroyed() { return this.destruida; }
    loadURL(url) { return carregarNaJanela(roteiro, this, url); }
    maximize() { roteiro.anotar(`janela${this.numero}.maximize`); }
    focus() { roteiro.anotar(`janela${this.numero}.focus`); }

    close() {
      roteiro.anotar(`janela${this.numero}.close`);
      this.destruida = true;
      this.emit('closed');
    }
  };
}

function sessaoFalsa(roteiro, nome, opcoes) {
  if (roteiro.sessoes.has(nome)) return roteiro.sessoes.get(nome);
  const sessao = new EventEmitter();
  Object.assign(sessao, {
    falso: true,
    rotulo: `sessão ${nome}`,
    setUserAgent: ua => roteiro.anotar(`${nome}.setUserAgent`, ua),
    setProxy: async (config) => { roteiro.anotar(`${nome}.setProxy`, config); roteiro.falhar('setProxy'); },
  });
  const removerOriginal = sessao.removeAllListeners.bind(sessao);
  sessao.removeAllListeners = (evento) => { roteiro.anotar(`${nome}.removeAllListeners`, evento); return removerOriginal(evento); };
  roteiro.anotar('session.fromPartition', nome, opcoes);
  roteiro.sessoes.set(nome, sessao);
  return sessao;
}

function requisicaoFalsa(roteiro, opcoes) {
  const req = new EventEmitter();
  roteiro.anotar('net.request', { ...opcoes, session: opcoes.session?.rotulo });
  req.setTimeout = (ms, cb) => { roteiro.anotar('req.setTimeout', ms); req.prazo = setTimeout(cb, ms); };
  req.abort = () => roteiro.anotar('req.abort');
  req.end = () => {
    roteiro.anotar('req.end');
    const resposta = roteiro.rede.shift() || { pendura: true };
    setImmediate(() => responderRequisicao(req, resposta));
  };
  return req;
}

function responderRequisicao(req, resposta) {
  if (resposta.pendura) return;
  if (resposta.erro) return req.emit('error', new Error(resposta.erro));
  const res = new EventEmitter();
  res.statusCode = resposta.status ?? 200;
  req.emit('response', res);
  if (resposta.corpo !== undefined) res.emit('data', Buffer.from(resposta.corpo));
  res.emit('end');
}

function electronFalso(roteiro) {
  return {
    BrowserWindow: janelaFalsa(roteiro),
    session: { fromPartition: (nome, opcoes) => sessaoFalsa(roteiro, nome, opcoes) },
    app: { getPath: nome => `/dados/${nome}`, getAppPath: () => '/app' },
    ipcMain: { handle: (canal, fn) => { roteiro.anotar('ipcMain.handle', canal); roteiro.ipc.set(canal, fn); } },
    net: { request: opcoes => requisicaoFalsa(roteiro, opcoes) },
    screen: {
      getPrimaryDisplay: () => {
        roteiro.falhar('screen');
        return roteiro.cena.tela === undefined ? { bounds: { width: 2560, height: 1440 } } : roteiro.cena.tela;
      },
    },
  };
}

function fsFalso(roteiro) {
  const existe = alvo => alvo in roteiro.arquivos || alvo in roteiro.pastas;
  return {
    existsSync: (alvo) => { roteiro.anotar('fs.existsSync', alvo, existe(alvo)); return existe(alvo); },
    readFileSync: (alvo, cod) => { roteiro.anotar('fs.readFileSync', alvo, cod); return roteiro.arquivos[alvo]; },
    writeFileSync: (alvo, conteudo) => { roteiro.anotar('fs.writeFileSync', alvo, conteudo); roteiro.falhar('writeFileSync'); },
    mkdirSync: (alvo, opcoes) => roteiro.anotar('fs.mkdirSync', alvo, opcoes),
    readdirSync: (alvo) => { roteiro.anotar('fs.readdirSync', alvo); roteiro.falhar('readdirSync'); return roteiro.pastas[alvo] || []; },
    unlinkSync: alvo => { roteiro.anotar('fs.unlinkSync', alvo); roteiro.falhar('unlinkSync'); },
    rmSync: (alvo, opcoes) => { roteiro.anotar('fs.rmSync', alvo, opcoes); roteiro.falhar('rmSync'); },
  };
}

function cryptoFalso(roteiro) {
  return {
    ...crypto,
    randomBytes: (n) => {
      roteiro.contador += 1;
      return Buffer.alloc(n, roteiro.contador);
    },
  };
}

function modulosFalsos(roteiro) {
  return new Map([
    ['electron', () => electronFalso(roteiro)],
    ['playwright', () => ({ chromium: lancador(roteiro, 'chromium'), firefox: lancador(roteiro, 'firefox') })],
    ['fs', () => fsFalso(roteiro)],
    ['crypto', () => cryptoFalso(roteiro)],
    ['os', () => ({ hostname: () => 'maquina', platform: () => 'plataforma' })],
    ['systeminformation', () => ({ uuid: async () => { roteiro.falhar('uuid'); return roteiro.cena.uuid ?? { os: 'uuid-do-sistema' }; } })],
    ['./platform-utils', () => ({
      findBundledChromiumExecutable: (raizes) => { roteiro.anotar('findBundledChromiumExecutable', raizes); return roteiro.cena.chromiumEmbutido || null; },
      primeiroCaminhoExistente: (caminhos) => {
        roteiro.anotar('primeiroCaminhoExistente', caminhos);
        return caminhos.find(c => c && c in roteiro.arquivos) || null;
      },
    })],
    ['./mac-native', () => ({ browser: nome => { roteiro.anotar('macNative.browser', nome); return roteiro.cena.navegadoresDoMac?.[nome] || null; } })],
  ]);
}

function capturarConsole(roteiro) {
  const originais = {};
  for (const [nivel, saida] of Object.entries(NIVEIS_DO_CONSOLE)) {
    originais[nivel] = console[nivel];
    console[nivel] = (...args) => roteiro.anotar(saida, ...args);
  }
  return () => Object.assign(console, originais);
}

const GLOBAIS_DE_TEMPO = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'];

function prenderProcesso(roteiro) {
  const originais = Object.fromEntries(GLOBAIS_DE_TEMPO.map(nome => [nome, global[nome]]));
  const plataforma = Object.getOwnPropertyDescriptor(process, 'platform');
  const { resourcesPath } = process;
  const local = process.env.LOCALAPPDATA;
  const { now } = Date;
  const { random } = Math;
  const { toLocaleString, toLocaleTimeString } = Date.prototype;
  global.setTimeout = (fn, ms, ...args) => roteiro.relogio.agendar(() => fn(...args), ms, false);
  global.setInterval = (fn, ms) => roteiro.relogio.agendar(fn, ms, true);
  global.clearTimeout = global.clearInterval = marca => roteiro.relogio.cancelar(marca);
  Object.defineProperty(process, 'platform', { value: roteiro.cena.plataforma || 'win32', configurable: true });
  process.resourcesPath = roteiro.cena.resourcesPath;
  if (roteiro.cena.localAppData) process.env.LOCALAPPDATA = roteiro.cena.localAppData;
  else delete process.env.LOCALAPPDATA;
  Date.now = () => AGORA + roteiro.relogio.agora;
  Math.random = () => roteiro.aleatorio();
  Date.prototype.toLocaleString = function () { return `data(${roteiro.relogio.agora})`; };
  Date.prototype.toLocaleTimeString = function () { return `hora(${roteiro.relogio.agora})`; };
  return () => {
    Object.assign(global, originais);
    Object.defineProperty(process, 'platform', plataforma);
    process.resourcesPath = resourcesPath;
    if (local === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = local;
    Date.now = now;
    Math.random = random;
    Object.assign(Date.prototype, { toLocaleString, toLocaleTimeString });
  };
}

function limparCache() {
  for (const caminho of Object.keys(require.cache)) {
    if (ehDaFazenda({ filename: caminho })) delete require.cache[caminho];
  }
}

function janelaPrincipal(roteiro) {
  const tipo = roteiro.cena.janelaPrincipal ?? 'viva';
  if (!tipo) return null;
  return {
    isDestroyed: () => tipo === 'destruida',
    webContents: { send: (canal, dados) => roteiro.anotar('principal.send', canal, dados) },
  };
}

const estadoDaFazenda = fazenda => ({
  perfis: fazenda.profiles,
  isRunning: fazenda.isRunning,
  shouldStop: fazenda.shouldStop,
  janelas: [...fazenda.profileWindows.keys()],
  contextos: [...fazenda.playwrightContexts.keys()],
  lancando: [...fazenda.launchingProfiles],
  ativos: [...fazenda.activeRunProfiles],
});

async function encenar(cena, caminho = CAMINHO_DA_FAZENDA) {
  const roteiro = new Roteiro(cena);
  const devolverConsole = capturarConsole(roteiro);
  const devolverProcesso = prenderProcesso(roteiro);
  carregamentoAtual = { modulos: modulosFalsos(roteiro) };
  try {
    limparCache();
    const BrowserFarmService = require(caminho);
    const fazenda = new BrowserFarmService(janelaPrincipal(roteiro));
    if (cena.perfis) fazenda.profiles = JSON.parse(JSON.stringify(cena.perfis));
    await cena.passos(fazenda, roteiro);
    await voltas();
    roteiro.anotar('estado final', estadoDaFazenda(fazenda), roteiro.relogio.fila.length);
  } finally {
    carregamentoAtual = null;
    limparCache();
    devolverProcesso();
    devolverConsole();
  }
  return roteiro.registro;
}

async function chamar(roteiro, rotulo, acao) {
  try {
    const resultado = await acao();
    await voltas();
    roteiro.anotar(rotulo, resultado);
  } catch (erro) {
    roteiro.anotar(`${rotulo} lançou`, erro);
  }
}

module.exports = { CAMINHO_DA_FAZENDA, encenar, chamar, voltas, estadoDaFazenda };
