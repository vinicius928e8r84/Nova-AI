'use strict';
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CAMINHO_DO_MAIN = path.join(__dirname, '..', '..', 'electron', 'main.js');
const ARRANQUE_INTERROMPIDO = Symbol('arranque interrompido no primeiro show da janela');

let carregamentoAtual = null;
const carregarOriginal = Module._load;
Module._load = function (pedido, pai, ...resto) {
  const atual = carregamentoAtual;
  if (atual && pai?.filename === atual.caminho) {
    if (atual.ausentes.includes(pedido)) throw Object.assign(new Error(`Cannot find module '${pedido}'`), { code: 'MODULE_NOT_FOUND' });
    if (Object.prototype.hasOwnProperty.call(atual.modulos, pedido)) return atual.modulos[pedido];
    if (!Module.isBuiltin(pedido)) return atual.dubleDoModulo(pedido);
  }
  return carregarOriginal.call(this, pedido, pai, ...resto);
};

function chaveDoProprioObjeto(alvo, chave) {
  return typeof chave === 'symbol' || chave === 'then' || chave in alvo;
}

const raizesCriadas = [];
process.once('exit', () => {
  for (const raiz of raizesCriadas) fs.rmSync(raiz, { recursive: true, force: true });
});

function criarDuble(nome, registro) {
  const valores = new Map();
  return new Proxy(function () {}, {
    get(_, chave) {
      if (chave === 'then') return undefined;
      if (chave === Symbol.toPrimitive) return () => nome;
      if (typeof chave === 'symbol') return undefined;
      if (!valores.has(chave)) valores.set(chave, criarDuble(`${nome}.${String(chave)}`, registro));
      return valores.get(chave);
    },
    set(_, chave, valor) { valores.set(chave, valor); return true; },
    apply(_, __, args) { registro.push({ nome, args }); return criarDuble(`${nome}()`, registro); },
    construct(_, args) { registro.push({ nome: `new ${nome}`, args }); return criarDuble(`new ${nome}`, registro); },
  });
}

function comResto(objeto, nome, registro) {
  return new Proxy(objeto, {
    get(alvo, chave, receptor) {
      if (chaveDoProprioObjeto(alvo, chave)) return Reflect.get(alvo, chave, receptor);
      alvo[chave] = criarDuble(`${nome}.${chave}`, registro);
      return alvo[chave];
    },
  });
}

function criarJanela(registro, arranque) {
  const janela = {
    chamadas: [],
    enviados: [],
    destruida: false,
    maximizada: false,
    telaCheia: false,
    opcoes: null,
    isDestroyed: () => janela.destruida,
    isMaximized: () => janela.maximizada,
    isFullScreen: () => janela.telaCheia,
    isMinimized: () => false,
    show: () => {
      janela.chamadas.push(['show']);
      if (arranque.interromper) throw ARRANQUE_INTERROMPIDO;
    },
  };
  janela.webContents = comResto({ send: (canal, dados) => janela.enviados.push([canal, dados]) }, 'webContents', registro);
  return new Proxy(janela, {
    get(alvo, chave, receptor) {
      if (chaveDoProprioObjeto(alvo, chave)) return Reflect.get(alvo, chave, receptor);
      return (...args) => { alvo.chamadas.push([chave, ...args]); };
    },
  });
}

function criarElectron(raiz, registro, arranque, sobrepor) {
  const canais = { handle: new Map(), on: new Map() };
  const janelas = [];
  const estado = { focada: null };
  function BrowserWindow(opcoes) {
    const janela = criarJanela(registro, arranque);
    janela.opcoes = opcoes;
    janelas.push(janela);
    return janela;
  }
  BrowserWindow.getFocusedWindow = () => estado.focada;
  BrowserWindow.getAllWindows = () => janelas.slice();
  const prontoQuando = {
    then(aoFicarPronto) {
      try {
        aoFicarPronto();
      } catch (erro) {
        if (erro !== ARRANQUE_INTERROMPIDO) arranque.erros.push(erro);
      }
      return prontoQuando;
    },
  };
  const app = comResto({
    isPackaged: false,
    commandLine: { appendSwitch: () => {} },
    getPath: (nome) => {
      const pasta = path.join(raiz, nome);
      fs.mkdirSync(pasta, { recursive: true });
      return pasta;
    },
    setPath: () => {},
    on: () => {},
    once: () => {},
    quit: () => {},
    exit: () => {},
    getVersion: () => '0.0.0-teste',
    requestSingleInstanceLock: () => true,
    whenReady: () => prontoQuando,
  }, 'app', registro);
  const ipcMain = comResto({
    handle: (canal, tratador) => canais.handle.set(canal, tratador),
    on: (canal, ouvinte) => canais.on.set(canal, ouvinte),
  }, 'ipcMain', registro);
  const sobrepostos = Object.fromEntries(Object.entries(sobrepor).map(([nome, valor]) => [nome, valor && typeof valor === 'object' ? comResto(valor, nome, registro) : valor]));
  const electron = comResto({ app, ipcMain, BrowserWindow, ...sobrepostos }, 'electron', registro);
  return { electron, canais, janelas, estado };
}

function processosProibidos() {
  const proibido = (nome) => (...args) => { throw new Error(`main.js tentou ${nome} um processo de verdade: ${JSON.stringify(args[0])}`); };
  return { spawn: proibido('spawn'), exec: proibido('exec'), execFile: proibido('execFile'), execSync: proibido('execSync'), spawnSync: proibido('spawnSync'), fork: proibido('fork') };
}

function silenciado(funcao) {
  const antes = { log: console.log, info: console.info, warn: console.warn, error: console.error };
  console.log = () => {};
  console.info = () => {};
  console.warn = () => {};
  console.error = () => {};
  const restaurar = () => Object.assign(console, antes);
  try {
    const resultado = funcao();
    if (resultado && typeof resultado.then === 'function') return resultado.finally(restaurar);
    restaurar();
    return resultado;
  } catch (erro) {
    restaurar();
    throw erro;
  }
}

function guardarEstadoDoProcesso() {
  const ouvintesDeSinal = { SIGTERM: process.listeners('SIGTERM'), SIGINT: process.listeners('SIGINT') };
  const resourcesPathAntes = process.resourcesPath;
  const pathAntes = process.env.PATH;
  return () => {
    if (resourcesPathAntes === undefined) delete process.resourcesPath;
    else process.resourcesPath = resourcesPathAntes;
    process.env.PATH = pathAntes;
    for (const sinal of Object.keys(ouvintesDeSinal)) {
      for (const ouvinte of process.listeners(sinal)) {
        if (!ouvintesDeSinal[sinal].includes(ouvinte)) process.removeListener(sinal, ouvinte);
      }
    }
  };
}

function carregarMain({ electron: sobreporElectron = {}, modulos = {}, ausentes = [], preparar = () => {} } = {}) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-main-'));
  raizesCriadas.push(raiz);
  preparar(raiz);
  const registro = [];
  const arranque = { interromper: true, erros: [] };
  const falso = criarElectron(raiz, registro, arranque, sobreporElectron);
  const dubles = new Map();
  const restaurarProcesso = guardarEstadoDoProcesso();
  carregamentoAtual = {
    caminho: CAMINHO_DO_MAIN,
    ausentes,
    modulos: {
      electron: falso.electron,
      child_process: processosProibidos(),
      './services/tool-paths': { iconFile: () => 'nova.png' },
      './services/python-runtime': { pathComBin: (plataforma, atual) => atual, python: () => 'python-teste' },
      ...modulos,
    },
    dubleDoModulo: (pedido) => {
      if (!dubles.has(pedido)) dubles.set(pedido, criarDuble(pedido, registro));
      return dubles.get(pedido);
    },
  };
  process.resourcesPath = raiz;
  try {
    delete require.cache[CAMINHO_DO_MAIN];
    silenciado(() => require(CAMINHO_DO_MAIN));
  } finally {
    restaurarProcesso();
    arranque.interromper = false;
  }
  if (arranque.erros.length) throw arranque.erros[0];

  const tratador = (canal) => {
    const encontrado = falso.canais.handle.get(canal);
    if (!encontrado) throw new Error(`canal sem handle: ${canal}`);
    return encontrado;
  };
  return {
    raiz,
    registro,
    canais: falso.canais,
    janelas: falso.janelas,
    janelaPrincipal: falso.janelas[0],
    focar: (janela) => { falso.estado.focada = janela; },
    pasta: (nome) => path.join(raiz, nome),
    invocar: (canal, ...args) => silenciado(() => Promise.resolve(tratador(canal)({ sender: {} }, ...args))),
    emitir: (canal, ...args) => {
      const ouvinte = falso.canais.on.get(canal);
      if (!ouvinte) throw new Error(`canal sem on: ${canal}`);
      const evento = { sender: {}, returnValue: undefined };
      silenciado(() => ouvinte(evento, ...args));
      return evento;
    },
  };
}

function comPlataforma(plataforma, funcao) {
  const original = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { ...original, value: plataforma });
  const restaurar = () => Object.defineProperty(process, 'platform', original);
  try {
    const resultado = funcao();
    if (resultado && typeof resultado.then === 'function') return resultado.finally(restaurar);
    restaurar();
    return resultado;
  } catch (erro) {
    restaurar();
    throw erro;
  }
}

module.exports = { carregarMain, comPlataforma };
