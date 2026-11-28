'use strict';

const crypto = require('crypto');
const Module = require('module');
const path = require('path');
const { mock } = require('node:test');
const { marcarCaminhos } = require('./caminhos-do-palco');

const PASTA_DOS_SERVICOS = path.join(__dirname, '..');
const RAIZ_FALSA = path.join(path.sep, 'nova-falso');
const EXE = path.join(RAIZ_FALSA, 'instalado', 'Nova AI Mac');
const DADOS = path.join(RAIZ_FALSA, 'dados');
const AGORA = Date.UTC(2026, 10, 28, 12, 0, 0);
const DO_PERFIL = /user-profile-/;
const GLOBAIS = ['profileAnalysisFailCount', 'lastAnalysisAttemptTime', 'lastAnalysisFailureTime'];
const TEXTO_LONGO = 2000;

const CAMINHOS = {
  cofre: path.join(path.dirname(EXE), 'Nova_Vault', 'MyActivity.json'),
  cofreAlternativo: path.join(PASTA_DOS_SERVICOS, '..', '..', 'Nova_Vault', 'MyActivity.json'),
  contexto: path.join(DADOS, 'nova_user_context.json'),
};

const palco = { eventos: [], arquivos: new Map(), cena: null };

const anotar = (tipo, dados) => palco.eventos.push([tipo, dados]);

function criarFs() {
  return {
    existsSync: (caminho) => {
      anotar('fs.existe', [caminho]);
      return palco.arquivos.has(caminho);
    },
    readFileSync: (caminho, codificacao) => {
      anotar('fs.ler', [caminho, codificacao]);
      if (!palco.arquivos.has(caminho)) throw new Error(`ENOENT: ${caminho}`);
      return palco.arquivos.get(caminho);
    },
    writeFileSync: (caminho, conteudo) => {
      anotar('fs.escrever', [caminho, conteudo]);
      if (palco.cena.escritaFalha) throw new Error(palco.cena.escritaFalha);
      palco.arquivos.set(caminho, conteudo);
    },
  };
}

function criarGoogle() {
  class GoogleGenerativeAI {
    constructor(chave) {
      anotar('google.criar', [chave]);
    }

    getGenerativeModel(configuracao, opcoes) {
      anotar('google.modelo', [configuracao, opcoes]);
      return {
        generateContent: async (prompt, requisicao) => {
          anotar('google.gerar', [configuracao.model, prompt, requisicao]);
          return palco.cena.modelos[configuracao.model]();
        },
      };
    }
  }
  return { GoogleGenerativeAI };
}

const FALSOS = {
  fs: criarFs,
  electron: () => ({ app: { getPath: (nome) => (nome === 'exe' ? EXE : DADOS) } }),
  '@google/generative-ai': () => {
    if (palco.cena.semBiblioteca) throw new Error('Cannot find module');
    return criarGoogle();
  },
};

const carregarOriginal = Module._load;

const ehPedidoDoPerfil = (pedido, pai) => Boolean(pai) && Boolean(FALSOS[pedido]) && DO_PERFIL.test(pai.filename || '');

Module._load = function (pedido, pai, ...resto) {
  if (ehPedidoDoPerfil(pedido, pai)) return FALSOS[pedido]();
  return carregarOriginal.call(this, pedido, pai, ...resto);
};

function descarregarModulos() {
  for (const arquivo of Object.keys(require.cache)) {
    if (arquivo.startsWith(PASTA_DOS_SERVICOS + path.sep) && DO_PERFIL.test(path.basename(arquivo))) delete require.cache[arquivo];
  }
}

function instalarConsole() {
  const originais = {};
  for (const nivel of ['log', 'info', 'warn', 'error']) {
    originais[nivel] = console[nivel];
    console[nivel] = (...partes) => anotar(`console.${nivel === 'info' ? 'log' : nivel}`, partes.map(String));
  }
  return () => Object.assign(console, originais);
}

function resumir(texto) {
  if (typeof texto !== 'string' || texto.length <= TEXTO_LONGO) return texto;
  return `sha256:${crypto.createHash('sha256').update(texto).digest('hex').slice(0, 16)} (${texto.length} caracteres, começa com ${JSON.stringify(texto.slice(0, 60))})`;
}

function normalizar(valor) {
  const texto = JSON.stringify(valor, (chave, item) => (item === undefined ? '(indefinido)' : resumir(item)));
  return JSON.parse(marcarCaminhos(texto, [[PASTA_DOS_SERVICOS, '<servicos>'], [RAIZ_FALSA, '<falso>']]));
}

function lerGlobais() {
  return Object.fromEntries(GLOBAIS.map((nome) => [nome, global[nome] === undefined ? '(indefinido)' : global[nome]]));
}

function prepararGlobais(inicial = {}) {
  for (const nome of GLOBAIS) delete global[nome];
  Object.assign(global, inicial);
}

async function rodarCena(cena) {
  palco.eventos = [];
  palco.cena = { modelos: {}, ...cena };
  palco.arquivos = new Map(Object.entries(cena.arquivos || {}).map(([nome, conteudo]) => [CAMINHOS[nome], conteudo]));
  prepararGlobais(cena.globais);
  descarregarModulos();
  const restaurarConsole = instalarConsole();
  mock.timers.enable({ apis: ['Date'], now: AGORA });
  try {
    const perfil = require('../user-profile-manager');
    const retornos = await cena.roteiro(perfil, { agora: AGORA });
    return normalizar({
      retornos,
      eventos: palco.eventos,
      globais: lerGlobais(),
      arquivos: Object.fromEntries([...palco.arquivos].map(([caminho, conteudo]) => [caminho, conteudo])),
    });
  } finally {
    mock.timers.reset();
    restaurarConsole();
    prepararGlobais();
  }
}

module.exports = { rodarCena };
