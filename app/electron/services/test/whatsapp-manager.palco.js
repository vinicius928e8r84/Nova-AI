'use strict';
const Module = require('module');
const path = require('path');
const { EventEmitter } = require('events');

const CAMINHO_DO_MANAGER = path.join(__dirname, '..', 'whatsapp-manager.js');
const PASTA_DO_USUARIO = '/dados';
const PASTA_DO_PROJETO = '/projeto';
const AGORA = 1790000000000;
const SORTEIO = 0.5;
const NIVEIS_DO_CONSOLE = ['log', 'info', 'warn', 'error'];

let carregamentoAtual = null;
const carregarOriginal = Module._load;

Module._load = function (pedido, pai, ...resto) {
  const falso = carregamentoAtual && pai?.filename === CAMINHO_DO_MANAGER ? carregamentoAtual.modulos[pedido] : undefined;
  if (falso !== undefined) return falso;
  return carregarOriginal.call(this, pedido, pai, ...resto);
};

const normalizar = texto => texto.replace(/\\/g, '/');

const REGISTROS_ESPECIAIS = [
  [valor => valor instanceof Error, valor => ({ erro: valor.constructor.name, mensagem: valor.message })],
  [valor => valor === undefined, () => '(undefined)'],
  [valor => typeof valor === 'function', () => '(função)'],
  [valor => typeof valor === 'number' && !Number.isFinite(valor), valor => String(valor)],
  [valor => typeof valor === 'string', normalizar],
  [valor => Array.isArray(valor), valor => valor.map(paraRegistro)],
  [valor => valor instanceof Set, valor => ({ conjunto: [...valor].map(paraRegistro) })],
];

function paraRegistro(valor) {
  const especial = REGISTROS_ESPECIAIS.find(([serve]) => serve(valor));
  if (especial) return especial[1](valor);
  if (typeof valor !== 'object' || valor === null) return valor;
  return Object.fromEntries(Object.entries(valor).map(([chave, item]) => [chave, paraRegistro(item)]));
}

function sistemaDeArquivosFalso(ambiente) {
  const cena = ambiente.cena;
  const arquivos = new Map(Object.entries(cena.arquivos || {}).map(([caminho, conteudo]) => [normalizar(caminho), conteudo]));
  const pastas = new Map(Object.entries(cena.pastas || {}).map(([caminho, nomes]) => [normalizar(caminho), nomes]));
  const existe = caminho => arquivos.has(normalizar(caminho)) || pastas.has(normalizar(caminho));
  return {
    existsSync: caminho => { const achou = existe(caminho); ambiente.anotar('fs.existsSync', caminho, achou); return achou; },
    mkdirSync: (caminho, opcoes) => { ambiente.anotar('fs.mkdirSync', caminho, opcoes); },
    unlinkSync: caminho => {
      ambiente.anotar('fs.unlinkSync', caminho);
      if (cena.falhaAoRemover) throw new Error('arquivo em uso');
    },
    readFileSync: (caminho, codificacao) => {
      ambiente.anotar('fs.readFileSync', caminho, codificacao);
      return arquivos.get(normalizar(caminho));
    },
    writeFileSync: (caminho, conteudo) => { ambiente.anotar('fs.writeFileSync', caminho, conteudo); },
    readdirSync: (caminho, opcoes) => {
      ambiente.anotar('fs.readdirSync', caminho, opcoes);
      if (cena.falhaAoListar) throw new Error('sem permissão');
      return (pastas.get(normalizar(caminho)) || []).map(nome => ({ name: nome, isDirectory: () => !nome.endsWith('.txt') }));
    },
  };
}

function clienteFalso(ambiente) {
  return class Client extends EventEmitter {
    constructor(opcoes) {
      super();
      if (!opcoes?.conectado) ambiente.anotar('new Client', opcoes);
      this.info = ambiente.cena.infoDoCliente === undefined ? { wid: { _serialized: '5511@c.us' }, pushname: 'Chefe' } : ambiente.cena.infoDoCliente;
      ambiente.clientes.push(this);
    }

    initialize() {
      ambiente.anotar('client.initialize');
      const resultado = ambiente.cena.iniciar;
      if (resultado instanceof Error) return Promise.reject(resultado);
      if (resultado === 'pendente') return new Promise(() => {});
      return Promise.resolve();
    }

    async logout() {
      ambiente.anotar('client.logout');
      if (ambiente.cena.falhaNoLogout) throw new Error('logout recusado');
    }

    async destroy() {
      ambiente.anotar('client.destroy');
      if (ambiente.cena.falhaNoDestroy) throw new Error('destroy recusado');
    }

    async sendMessage(chatId, conteudo, opcoes) {
      ambiente.anotar('client.sendMessage', chatId, conteudo, opcoes);
      if (ambiente.cena.falhaNoEnvio) throw new Error('envio recusado');
      return ambiente.cena.envioSemId ? {} : { id: { _serialized: `enviada-${ambiente.clientes.indexOf(this)}` } };
    }

    async getChatById(chatId) {
      ambiente.anotar('client.getChatById', chatId);
      return { sendStateTyping: async () => { ambiente.anotar('chat.sendStateTyping'); } };
    }
  };
}

function modulosFalsos(ambiente) {
  const cena = ambiente.cena;
  class MessageMedia {
    constructor(...partes) { ambiente.anotar('new MessageMedia', ...partes); }
  }
  class FormData {
    append(...partes) { ambiente.anotar('form.append', ...partes.map(parte => (Buffer.isBuffer(parte) ? { buffer: parte.toString('base64') } : parte))); }
    getHeaders() { return { 'content-type': 'multipart/form-data' }; }
  }
  class Notification {
    constructor(opcoes) { this.opcoes = opcoes; }
    show() { ambiente.anotar('Notification.show', this.opcoes); }
  }
  return {
    'whatsapp-web.js': { Client: clienteFalso(ambiente), LocalAuth: class LocalAuth { constructor(opcoes) { this.opcoes = opcoes; } }, MessageMedia },
    qrcode: {
      toDataURL: async qr => {
        ambiente.anotar('qrcode.toDataURL', qr);
        if (cena.falhaNoQr) throw new Error('qr inválido');
        return `data:qr:${qr}`;
      },
    },
    axios: {
      post: async (...partes) => {
        ambiente.anotar('axios.post', ...partes);
        if (cena.falhaNaTranscricao) throw Object.assign(new Error('groq fora'), cena.falhaNaTranscricao);
        return { data: cena.respostaDaTranscricao };
      },
    },
    'form-data': FormData,
    'screenshot-desktop': async opcoes => {
      ambiente.anotar('screenshot', opcoes);
      if (cena.falhaNaCaptura) throw new Error('sem tela');
      return Buffer.from('imagem');
    },
    child_process: {
      spawnSync: (...partes) => { ambiente.anotar('spawnSync', ...partes); return {}; },
      exec: (...partes) => { ambiente.anotar('exec', ...partes); },
    },
    electron: {
      shell: { openExternal: url => { ambiente.anotar('shell.openExternal', url); } },
      Notification,
      dialog: { showMessageBox: (...partes) => { ambiente.anotar('dialog.showMessageBox', ...partes.slice(1)); return Promise.resolve({ response: 0 }); } },
    },
    './mac-native': {
      run: (...partes) => { ambiente.anotar('mac-native.run', ...partes); return Promise.resolve(); },
      browser: nome => { ambiente.anotar('mac-native.browser', nome); return cena.navegadorDoMac?.[nome] || null; },
    },
    './platform-utils': {
      findBundledChromiumExecutable: pastas => { ambiente.anotar('findBundledChromiumExecutable', pastas); return cena.chromiumBaixado || null; },
    },
    os: {
      totalmem: () => 16 * 1024 ** 3,
      freemem: () => 4 * 1024 ** 3,
      loadavg: () => [1.234, 0, 0],
      cpus: () => [{ model: 'CPU de teste' }],
      platform: () => 'plataforma-de-teste',
      release: () => '1.0',
      tmpdir: () => '/tmp',
    },
    fs: sistemaDeArquivosFalso(ambiente),
  };
}

function relogioFalso(ambiente) {
  let contador = 0;
  const setTimeoutFalso = (funcao, ms, ...argumentos) => {
    contador += 1;
    const alarme = { numero: contador };
    ambiente.alarmes.push({ alarme, funcao, ms, argumentos });
    ambiente.anotar('setTimeout', ms);
    return alarme;
  };
  const clearTimeoutFalso = alarme => {
    if (!alarme) return;
    ambiente.alarmes = ambiente.alarmes.filter(item => item.alarme !== alarme);
    ambiente.anotar('clearTimeout', alarme.numero);
  };
  return { setTimeoutFalso, clearTimeoutFalso };
}

const cedeAVez = () => new Promise(resolver => setImmediate(resolver));

function criarAmbiente(cena) {
  const ambiente = { cena, registro: [], alarmes: [], clientes: [], manager: null };
  ambiente.anotar = (...evento) => { ambiente.registro.push(evento.map(paraRegistro)); };
  ambiente.janela = {
    destruida: false,
    isDestroyed: () => ambiente.janela.destruida,
    webContents: { send: (...partes) => { ambiente.anotar('janela.send', ...partes); } },
  };
  ambiente.app = { getPath: nome => `${PASTA_DO_USUARIO}/${nome}` };
  ambiente.liberarAlarmes = async liberar => {
    const alvo = ambiente.alarmes.filter(item => liberar(item.ms));
    ambiente.alarmes = ambiente.alarmes.filter(item => !alvo.includes(item));
    for (const item of alvo) await item.funcao(...item.argumentos);
    return alvo.length;
  };
  ambiente.concluir = async (promessa, liberar = () => false) => {
    let pronta = false;
    const final = promessa.finally(() => { pronta = true; });
    final.catch(() => {});
    while (!pronta) {
      await cedeAVez();
      if (!pronta) await ambiente.liberarAlarmes(liberar);
    }
    return final;
  };
  ambiente.conectar = (manager = ambiente.manager) => {
    manager.client = new ambiente.Client({ conectado: true });
    manager.isReady = true;
    return manager.client;
  };
  return ambiente;
}

function trocar(objeto, chave, valor) {
  const original = Object.getOwnPropertyDescriptor(objeto, chave);
  Object.defineProperty(objeto, chave, { ...original, value: valor, configurable: true });
  return () => Object.defineProperty(objeto, chave, original);
}

function trocarVariavelDeAmbiente(chave, valor) {
  const original = process.env[chave];
  if (valor === undefined) delete process.env[chave];
  else process.env[chave] = valor;
  return () => {
    if (original === undefined) delete process.env[chave];
    else process.env[chave] = original;
  };
}

function trocarGlobais(ambiente) {
  const { setTimeoutFalso, clearTimeoutFalso } = relogioFalso(ambiente);
  return [
    trocar(global, 'setTimeout', setTimeoutFalso),
    trocar(global, 'clearTimeout', clearTimeoutFalso),
    trocar(Math, 'random', () => SORTEIO),
    trocar(Date, 'now', () => AGORA),
    trocar(process, 'cwd', () => PASTA_DO_PROJETO),
    trocar(process, 'platform', ambiente.cena.plataforma || 'win32'),
    ...NIVEIS_DO_CONSOLE.map(nivel => trocar(console, nivel, (...partes) => ambiente.anotar(`console.${nivel}`, ...partes))),
    ...['PUPPETEER_EXECUTABLE_PATH', 'GROQ_API_KEY'].map(chave => trocarVariavelDeAmbiente(chave, ambiente.cena.ambiente?.[chave])),
  ];
}

function instalar(ambiente) {
  const desfazer = trocarGlobais(ambiente);
  carregamentoAtual = { modulos: modulosFalsos(ambiente) };
  ambiente.Client = carregamentoAtual.modulos['whatsapp-web.js'].Client;
  return () => {
    carregamentoAtual = null;
    desfazer.reverse().forEach(refazer => refazer());
    delete require.cache[CAMINHO_DO_MANAGER];
  };
}

function mensagem(campos) {
  const { chat = {}, contato = {}, falhaNoDownload, midia, ...resto } = campos;
  return {
    from: '5522@c.us',
    to: '5511@c.us',
    fromMe: false,
    body: '',
    timestamp: 1790000000,
    id: { _serialized: `id-${resto.body || 'vazio'}` },
    downloadMedia: async () => {
      if (falhaNoDownload) throw new Error('download falhou');
      return midia;
    },
    getChat: async () => chat,
    getContact: async () => contato,
    ...resto,
  };
}

async function encenar(cena) {
  const ambiente = criarAmbiente(cena);
  const restaurar = instalar(ambiente);
  try {
    delete require.cache[CAMINHO_DO_MANAGER];
    const WhatsAppManager = require(CAMINHO_DO_MANAGER);
    ambiente.manager = new WhatsAppManager(ambiente.janela, ambiente.app);
    if (cena.preparar) cena.preparar(ambiente.manager, ambiente);
    const retorno = await cena.roteiro({ manager: ambiente.manager, ambiente });
    if (retorno !== undefined) ambiente.anotar('retorno', retorno);
  } catch (erro) {
    ambiente.anotar('lançou', erro);
  } finally {
    restaurar();
  }
  return ambiente.registro;
}

module.exports = { encenar, mensagem };
