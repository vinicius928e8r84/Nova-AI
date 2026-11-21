'use strict';
const Module = require('module');
const path = require('path');

const CAMINHO_DO_STUDIO = path.join(__dirname, '..', 'nova-studio-controller.js');
const NIVEIS_DO_CONSOLE = { log: 'stdout', info: 'stdout', warn: 'stderr', error: 'stderr' };

let carregamentoAtual = null;
const carregarOriginal = Module._load;

function moduloDaVez(pedido, pai) {
  if (!carregamentoAtual) return undefined;
  if (pai?.filename !== carregamentoAtual.caminho) return undefined;
  return carregamentoAtual.modulos.get(pedido);
}

Module._load = function (pedido, pai, ...resto) {
  const modulo = moduloDaVez(pedido, pai);
  if (modulo) return modulo();
  return carregarOriginal.call(this, pedido, pai, ...resto);
};

function paraRegistro(valor) {
  if (valor instanceof Error) return { erro: valor.constructor.name, mensagem: valor.message };
  if (valor === undefined) return '(undefined)';
  if (Array.isArray(valor)) return valor.map(paraRegistro);
  if (typeof valor !== 'object' || valor === null) return valor;
  return Object.fromEntries(Object.entries(valor).map(([chave, item]) => [chave, paraRegistro(item)]));
}

class Roteiro {
  constructor(registro, filas) {
    this.registro = registro;
    this.filas = filas;
  }

  anotar(...evento) {
    this.registro.push(evento.map(paraRegistro));
  }

  proximo(fila) {
    const valor = this.filas[fila].shift();
    if (valor instanceof Error) throw valor;
    return valor;
  }
}

function conversaFalsa(roteiro) {
  return {
    sendMessage: async (partes) => {
      roteiro.anotar('chat.sendMessage', partes);
      const texto = roteiro.proximo('chat');
      return { response: { text: () => texto } };
    },
  };
}

function geminiFalso(roteiro) {
  return class GoogleGenerativeAI {
    constructor(chave) {
      roteiro.anotar('new GoogleGenerativeAI', chave);
    }

    getGenerativeModel(configuracao, opcoes) {
      roteiro.anotar('getGenerativeModel', configuracao, opcoes);
      return {
        startChat: (inicio) => {
          roteiro.anotar('startChat', inicio);
          return conversaFalsa(roteiro);
        },
      };
    }
  };
}

function imagemFalsa(roteiro) {
  return class GoogleGenAI {
    constructor(opcoes) {
      roteiro.anotar('new GoogleGenAI', opcoes);
      this.models = {
        generateImages: async (pedido) => {
          roteiro.anotar('generateImages', pedido);
          return roteiro.proximo('imagens');
        },
      };
    }
  };
}

function motorFalso(roteiro, motor) {
  return {
    getAuthStatus: () => {
      roteiro.anotar('motor.getAuthStatus');
      return { isLoggedIn: motor.logado };
    },
    getSelectedModel: () => {
      roteiro.anotar('motor.getSelectedModel');
      return motor.modelo;
    },
    sendMessage: async (mensagem) => {
      roteiro.anotar('motor.sendMessage', mensagem);
      return roteiro.proximo('motor');
    },
  };
}

function areaDeTransferenciaFalsa(roteiro, falha) {
  return {
    writeText: (texto) => {
      roteiro.anotar('clipboard.writeText', texto);
      if (falha) throw new Error(falha);
    },
  };
}

function modulosFalsos(roteiro, cena) {
  const motor = cena.motor ? motorFalso(roteiro, cena.motor) : null;
  return new Map([
    ['axios', () => ({})],
    ['@google/generative-ai', () => ({ GoogleGenerativeAI: geminiFalso(roteiro) })],
    ['@google/genai', () => ({ GoogleGenAI: imagemFalsa(roteiro) })],
    ['electron', () => ({ clipboard: areaDeTransferenciaFalsa(roteiro, cena.falhaDoClipboard) })],
    ['./gemini-browser-engine', () => {
      if (!motor) throw new Error('motor ausente');
      return motor;
    }],
  ]);
}

function appFalso(roteiro) {
  return {
    getGeminiToken: async () => {
      roteiro.anotar('app.getGeminiToken');
      return roteiro.proximo('tokens');
    },
  };
}

function capturarConsole(roteiro) {
  const originais = {};
  for (const [nivel, saida] of Object.entries(NIVEIS_DO_CONSOLE)) {
    originais[nivel] = console[nivel];
    console[nivel] = (...args) => roteiro.anotar(saida, ...args);
  }
  return () => Object.assign(console, originais);
}

function filasDaCena(cena) {
  return {
    tokens: [...(cena.tokens || [])],
    chat: [...(cena.chat || [])],
    imagens: [...(cena.imagens || [])],
    motor: [...(cena.motor?.respostas || [])],
  };
}

const proximaVolta = () => new Promise(resolver => setImmediate(resolver));

async function encenar(cena, caminho = CAMINHO_DO_STUDIO) {
  const registro = [];
  const roteiro = new Roteiro(registro, filasDaCena(cena));
  const devolverConsole = capturarConsole(roteiro);
  carregamentoAtual = { caminho, modulos: modulosFalsos(roteiro, cena) };
  try {
    delete require.cache[caminho];
    const NovaStudioController = require(caminho);
    carregamentoAtual = null;
    const studio = new NovaStudioController({ janela: 'principal' }, appFalso(roteiro));
    await proximaVolta();
    await cena.passos(studio, roteiro, NovaStudioController);
  } finally {
    carregamentoAtual = null;
    devolverConsole();
  }
  return registro;
}

async function chamar(roteiro, rotulo, acao) {
  try {
    roteiro.anotar(rotulo, await acao());
  } catch (erro) {
    roteiro.anotar(`${rotulo} lançou`, erro);
  }
}

module.exports = { CAMINHO_DO_STUDIO, encenar, chamar };
