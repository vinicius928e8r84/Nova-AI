'use strict';
const Module = require('module');
const path = require('path');
const { EventEmitter } = require('events');

const SERVICOS = path.join(__dirname, '..');
const CAMINHO_DO_GERENTE = path.join(SERVICOS, 'whatsapp-manager.js');
const NIVEIS_DO_CONSOLE = { log: 'stdout', info: 'stdout', warn: 'stderr', error: 'stderr' };
const AGORA = 1700000000000;

let carregamentoAtual = null;
const carregarOriginal = Module._load;

const ehDoWhatsApp = pai => Boolean(pai?.filename) && path.dirname(pai.filename) === SERVICOS && path.basename(pai.filename).startsWith('whatsapp-');

Module._load = function (pedido, pai, ...resto) {
  const falso = carregamentoAtual && ehDoWhatsApp(pai) ? carregamentoAtual.modulos.get(pedido) : null;
  if (falso) return falso();
  return carregarOriginal.call(this, pedido, pai, ...resto);
};

const CONVERSOES = [
  [valor => valor instanceof Error, valor => ({ erro: valor.constructor.name, mensagem: valor.message })],
  [valor => Buffer.isBuffer(valor), valor => ({ buffer: valor.toString('base64') })],
  [valor => valor === undefined, () => '(undefined)'],
  [valor => Number.isNaN(valor) || valor === Infinity, valor => String(valor)],
  [valor => typeof valor === 'function', valor => `(função ${valor.name})`],
  [valor => valor instanceof Set, valor => ({ conjunto: [...valor] })],
  [Array.isArray, valor => valor.map(paraRegistro)],
  [valor => typeof valor !== 'object' || valor === null, valor => valor],
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

  agendar(fn, ms) {
    const id = ++this.sequencia;
    this.fila.push({ id, fn, quando: this.agora + Math.max(0, Number(ms) || 0) });
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
}

const umaVolta = () => new Promise(resolver => setImmediate(resolver));

async function voltas(n = 4) {
  for (let i = 0; i < n; i++) await umaVolta();
}

class Roteiro {
  constructor(cena) {
    this.cena = cena;
    this.registro = [];
    this.relogio = new Relogio();
    this.arquivos = { ...(cena.arquivos || {}) };
    this.pastas = new Set(cena.pastas || []);
    this.inicializacoes = [...(cena.inicializacoes || ['ok'])];
    this.falhas = { ...(cena.falhas || {}) };
    this.clientes = [];
    this.enviadas = 0;
  }

  anotar(...evento) {
    this.registro.push(evento.map(paraRegistro));
  }

  falhar(nome) {
    const falha = this.falhas[nome];
    if (falha) throw falha instanceof Error ? falha : new Error(falha);
  }

  get cliente() {
    return this.clientes[this.clientes.length - 1];
  }

  async avancar(ms) {
    const limite = this.relogio.agora + ms;
    await voltas();
    for (let tarefa = this.relogio.proximoAte(limite); tarefa; tarefa = this.relogio.proximoAte(limite)) {
      this.relogio.agora = Math.max(this.relogio.agora, tarefa.quando);
      this.relogio.cancelar(tarefa);
      tarefa.fn();
      await voltas();
    }
    this.relogio.agora = limite;
    await voltas();
  }
}

function clienteFalso(roteiro) {
  return class Client extends EventEmitter {
    constructor(opcoes) {
      super();
      roteiro.anotar('new Client', opcoes);
      this.info = roteiro.cena.info === undefined ? { pushname: 'Ana', wid: { _serialized: 'eu@c.us' } } : roteiro.cena.info;
      roteiro.clientes.push(this);
    }

    initialize() {
      roteiro.anotar('client.initialize');
      const resultado = roteiro.inicializacoes.length > 1 ? roteiro.inicializacoes.shift() : roteiro.inicializacoes[0];
      if (resultado === 'pendurado') return new Promise(() => {});
      if (typeof resultado === 'function') return resultado();
      return resultado instanceof Error ? Promise.reject(resultado) : Promise.resolve();
    }

    removeAllListeners() {
      roteiro.anotar('client.removeAllListeners');
      roteiro.falhar('removeAllListeners');
      return super.removeAllListeners();
    }

    async logout() { roteiro.anotar('client.logout'); roteiro.falhar('logout'); }
    async destroy() { roteiro.anotar('client.destroy'); roteiro.falhar('destroy'); }

    async sendMessage(chat, conteudo, opcoes) {
      roteiro.anotar('client.sendMessage', chat, conteudo, opcoes);
      roteiro.falhar('sendMessage');
      roteiro.enviadas += 1;
      return roteiro.cena.semIdEnviado ? {} : { id: { _serialized: `enviada-${roteiro.enviadas}` } };
    }

    async getChatById(id) {
      roteiro.anotar('client.getChatById', id);
      roteiro.falhar('getChatById');
      return { sendStateTyping: async () => roteiro.anotar('chat.sendStateTyping') };
    }
  };
}

function fsFalso(roteiro) {
  return {
    existsSync: (alvo) => {
      const existe = alvo in roteiro.arquivos || roteiro.pastas.has(alvo);
      roteiro.anotar('fs.existsSync', alvo, existe);
      return existe;
    },
    mkdirSync: (pasta, opcoes) => roteiro.anotar('fs.mkdirSync', pasta, opcoes),
    unlinkSync: (alvo) => {
      roteiro.anotar('fs.unlinkSync', alvo);
      roteiro.falhar('unlinkSync');
    },
    readFileSync: (alvo, codificacao) => {
      roteiro.anotar('fs.readFileSync', alvo, codificacao);
      return roteiro.arquivos[alvo];
    },
    writeFileSync: (alvo, conteudo) => {
      roteiro.anotar('fs.writeFileSync', alvo, conteudo);
      roteiro.falhar('writeFileSync');
    },
    readdirSync: (pasta, opcoes) => {
      roteiro.anotar('fs.readdirSync', pasta, opcoes);
      roteiro.falhar('readdirSync');
      return (roteiro.cena.subpastas?.[pasta] || []).map(([name, pasta]) => ({ name, isDirectory: () => pasta }));
    },
  };
}

function osFalso() {
  return {
    totalmem: () => 16 * 1024 ** 3,
    freemem: () => 5.5 * 1024 ** 3,
    loadavg: () => [1.234, 1, 1],
    cpus: () => [{ model: 'CPU Falsa 9000' }],
    platform: () => 'plataforma',
    release: () => '1.2.3',
    tmpdir: () => '/tmp',
  };
}

function electronFalso(roteiro) {
  return {
    dialog: { showMessageBox: async (janela, opcoes) => roteiro.anotar('dialog.showMessageBox', Boolean(janela), opcoes) },
    shell: { openExternal: (url) => roteiro.anotar('shell.openExternal', url) },
    Notification: class Notification {
      constructor(opcoes) { roteiro.anotar('new Notification', opcoes); }
      show() { roteiro.anotar('notification.show'); }
    },
  };
}

function formularioFalso(roteiro) {
  return class FormData {
    append(nome, valor, opcoes) { roteiro.anotar('form.append', nome, valor, opcoes); }
    getHeaders() { return { 'content-type': 'multipart/form-data; boundary=x' }; }
  };
}

function axiosFalso(roteiro) {
  return {
    post: async (url, corpo, opcoes) => {
      roteiro.anotar('axios.post', url, opcoes);
      roteiro.falhar('axios');
      return roteiro.cena.transcricao;
    },
  };
}

function modulosFalsos(roteiro) {
  const passo = nome => (...args) => {
    roteiro.anotar(nome, ...args);
    roteiro.falhar(nome);
    return roteiro.cena.retornos?.[nome];
  };
  return new Map([
    ['whatsapp-web.js', () => ({
      Client: clienteFalso(roteiro),
      LocalAuth: class LocalAuth { constructor(opcoes) { this.opcoes = opcoes; } },
      MessageMedia: class MessageMedia { constructor(...args) { this.args = args; } },
    })],
    ['qrcode', () => ({ toDataURL: async (qr) => { roteiro.anotar('qrcode.toDataURL', qr); roteiro.falhar('qrcode'); return `data:${qr}`; } })],
    ['fs', () => fsFalso(roteiro)],
    ['os', () => osFalso()],
    ['child_process', () => ({ spawnSync: passo('spawnSync'), exec: passo('exec') })],
    ['axios', () => axiosFalso(roteiro)],
    ['form-data', () => formularioFalso(roteiro)],
    ['screenshot-desktop', () => async (opcoes) => { roteiro.anotar('screenshot', opcoes); roteiro.falhar('screenshot'); return Buffer.from('png'); }],
    ['electron', () => electronFalso(roteiro)],
    ['./mac-native', () => ({
      run: async (...args) => { roteiro.anotar('macNative.run', ...args); roteiro.falhar('macNative.run'); },
      browser: nome => { roteiro.anotar('macNative.browser', nome); return roteiro.cena.navegadoresDoMac?.[nome] || null; },
    })],
    ['./platform-utils', () => ({ findBundledChromiumExecutable: passo('findBundledChromiumExecutable') })],
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

const GLOBAIS_DE_TEMPO = ['setTimeout', 'clearTimeout'];
const VARIAVEIS = ['PUPPETEER_EXECUTABLE_PATH', 'GROQ_API_KEY'];

function prenderProcesso(roteiro) {
  const originais = Object.fromEntries(GLOBAIS_DE_TEMPO.map(nome => [nome, global[nome]]));
  const ambiente = Object.fromEntries(VARIAVEIS.map(nome => [nome, process.env[nome]]));
  const plataforma = Object.getOwnPropertyDescriptor(process, 'platform');
  const { resourcesPath } = process;
  const { cwd } = process;
  const { now } = Date;
  const { random } = Math;
  global.setTimeout = (fn, ms, ...args) => roteiro.relogio.agendar(() => fn(...args), ms);
  global.clearTimeout = marca => roteiro.relogio.cancelar(marca);
  for (const nome of VARIAVEIS) delete process.env[nome];
  Object.assign(process.env, roteiro.cena.ambiente || {});
  Object.defineProperty(process, 'platform', { value: roteiro.cena.plataforma || 'linux', configurable: true });
  process.resourcesPath = roteiro.cena.resourcesPath;
  process.cwd = () => '/trabalho';
  Date.now = () => AGORA + roteiro.relogio.agora;
  Math.random = () => 0.5;
  return () => {
    Object.assign(global, originais);
    for (const nome of VARIAVEIS) delete process.env[nome];
    for (const [nome, valor] of Object.entries(ambiente)) if (valor !== undefined) process.env[nome] = valor;
    Object.defineProperty(process, 'platform', plataforma);
    process.resourcesPath = resourcesPath;
    process.cwd = cwd;
    Date.now = now;
    Math.random = random;
  };
}

function limparCache() {
  for (const caminho of Object.keys(require.cache)) {
    if (path.dirname(caminho) === SERVICOS && path.basename(caminho).startsWith('whatsapp-')) delete require.cache[caminho];
  }
}

function janelaFalsa(roteiro) {
  const janela = roteiro.cena.janela ?? 'viva';
  if (!janela) return null;
  return {
    isDestroyed: () => janela === 'destruida',
    webContents: {
      send: (canal, dados) => {
        roteiro.anotar('janela.send', canal, dados);
        roteiro.falhar('janela.send');
      },
    },
  };
}

function appFalso(roteiro) {
  return { getPath: nome => { roteiro.anotar('app.getPath', nome); return `/dados/${nome}`; } };
}

const estadoDoGerente = gerente => ({
  ...gerente.getState(),
  busyModeEnabled: gerente.busyModeEnabled,
  busyStatusText: gerente.busyStatusText,
  bossName: gerente.bossName,
  manualLogout: gerente.manualLogout,
  destroying: gerente.destroying,
  lastQr: gerente.lastQr,
  temCliente: Boolean(gerente.client),
  processados: [...gerente.processedMessageIds],
});

async function encenar(cena, caminho = CAMINHO_DO_GERENTE) {
  const roteiro = new Roteiro(cena);
  const devolverConsole = capturarConsole(roteiro);
  const devolverProcesso = prenderProcesso(roteiro);
  carregamentoAtual = { modulos: modulosFalsos(roteiro) };
  try {
    limparCache();
    const WhatsAppManager = require(caminho);
    const gerente = new WhatsAppManager(janelaFalsa(roteiro), appFalso(roteiro));
    await cena.passos(gerente, roteiro);
    await voltas();
    roteiro.anotar('estado final', estadoDoGerente(gerente), roteiro.relogio.fila.length);
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

module.exports = { CAMINHO_DO_GERENTE, encenar, chamar, voltas, estadoDoGerente };
