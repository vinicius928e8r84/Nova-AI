'use strict';
const crypto = require('crypto');
const Module = require('module');
const path = require('path');

const CAMINHO_DO_PERFIL = path.join(__dirname, '..', 'user-profile-manager.js');
const RAIZ_DO_APP = path.join(__dirname, '..', '..', '..');
const NIVEIS_DO_CONSOLE = { log: 'stdout', info: 'stdout', warn: 'stderr', error: 'stderr' };
const GLOBAIS = ['profileAnalysisFailCount', 'lastAnalysisAttemptTime', 'lastAnalysisFailureTime'];
const AGORA = 1700000000000;

let carregamentoAtual = null;
const carregarOriginal = Module._load;

Module._load = function (pedido, pai, ...resto) {
  const falso = carregamentoAtual && pai?.filename === carregamentoAtual.caminho ? carregamentoAtual.modulos.get(pedido) : null;
  if (falso) return falso();
  return carregarOriginal.call(this, pedido, pai, ...resto);
};

const resumoDoPedido = pedido => ({ tamanho: pedido.length, sha256: crypto.createHash('sha256').update(pedido).digest('hex'), fim: pedido.slice(-120) });

const relativo = texto => texto.split(RAIZ_DO_APP).join('<app>');

function paraRegistro(valor) {
  if (valor instanceof Error) return { erro: valor.constructor.name, mensagem: relativo(valor.message) };
  if (valor === undefined) return '(undefined)';
  if (typeof valor === 'string') return relativo(valor);
  if (Array.isArray(valor)) return valor.map(paraRegistro);
  if (typeof valor !== 'object' || valor === null) return valor;
  return Object.fromEntries(Object.entries(valor).map(([chave, item]) => [chave, paraRegistro(item)]));
}

class Roteiro {
  constructor(cena) {
    this.registro = [];
    this.respostas = [...(cena.respostas || [])];
    this.arquivos = { ...(cena.arquivos || {}) };
  }

  anotar(...evento) {
    this.registro.push(evento.map(paraRegistro));
  }

  proximaResposta() {
    const resposta = this.respostas.shift();
    if (resposta instanceof Error) throw resposta;
    return resposta;
  }

  conteudo(caminho) {
    const chave = relativo(caminho);
    if (!(chave in this.arquivos)) throw new Error(`ENOENT: ${chave}`);
    return this.arquivos[chave];
  }
}

function fsFalso(roteiro) {
  return {
    existsSync: (caminho) => {
      const existe = relativo(caminho) in roteiro.arquivos;
      roteiro.anotar('fs.existsSync', caminho, existe);
      return existe;
    },
    readFileSync: (caminho, codificacao) => {
      roteiro.anotar('fs.readFileSync', caminho, codificacao);
      return roteiro.conteudo(caminho);
    },
    writeFileSync: (caminho, conteudo) => roteiro.anotar('fs.writeFileSync', caminho, conteudo),
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
        generateContent: async (pedido, opcoesDoPedido) => {
          roteiro.anotar('generateContent', resumoDoPedido(pedido), opcoesDoPedido);
          const texto = roteiro.proximaResposta();
          return { response: Promise.resolve({ text: () => texto }) };
        },
      };
    }
  };
}

function modulosFalsos(roteiro, cena) {
  return new Map([
    ['fs', () => fsFalso(roteiro)],
    ['electron', () => ({ app: { getPath: nome => (nome === 'exe' ? '/instalado/Nova/Nova AI' : `/dados/${nome}`) } })],
    ['@google/generative-ai', () => {
      if (cena.semGemini) throw new Error('Cannot find module');
      return { GoogleGenerativeAI: geminiFalso(roteiro) };
    }],
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

function prepararGlobais(cena) {
  const originais = Object.fromEntries(GLOBAIS.map(nome => [nome, global[nome]]));
  for (const nome of GLOBAIS) delete global[nome];
  Object.assign(global, cena.globais || {});
  const agoraOriginal = Date.now;
  Date.now = () => AGORA;
  return () => {
    Date.now = agoraOriginal;
    Object.assign(global, originais);
  };
}

const globaisDepois = () => Object.fromEntries(GLOBAIS.map(nome => [nome, global[nome]]));

async function encenar(cena, caminho = CAMINHO_DO_PERFIL) {
  const roteiro = new Roteiro(cena);
  const devolverConsole = capturarConsole(roteiro);
  const devolverGlobais = prepararGlobais(cena);
  carregamentoAtual = { caminho, modulos: modulosFalsos(roteiro, cena) };
  try {
    delete require.cache[caminho];
    const perfil = require(caminho);
    carregamentoAtual = null;
    await cena.passos(perfil, roteiro);
    roteiro.anotar('globais', globaisDepois());
  } finally {
    carregamentoAtual = null;
    devolverGlobais();
    devolverConsole();
  }
  return roteiro.registro;
}

async function chamar(roteiro, rotulo, acao) {
  try {
    roteiro.anotar(rotulo, await acao());
  } catch (erro) {
    roteiro.anotar(`${rotulo} lançou`, erro);
  }
}

module.exports = { AGORA, CAMINHO_DO_PERFIL, encenar, chamar };
