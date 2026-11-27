'use strict';
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { marcarCaminhos } = require('./caminhos-do-palco');

const PASTA_DOS_SERVICOS = path.join(__dirname, '..');
const PASTA_DO_ELECTRON = path.join(PASTA_DOS_SERVICOS, '..');
const PASTA_DO_APP = path.join(PASTA_DO_ELECTRON, '..');
const PASTA_DOS_RECURSOS = '/RES';
const PASTA_DO_APP_EMPACOTADO = '/APP';
const LOCAL_DO_USUARIO = 'C:\\Local';
const ARQUIVO_DOS_PERFIS = 'farm_profiles.json';
const SERVICO_OU_MODULO_DO_FARM = /^(browserFarmService|farm-[a-z-]+)\.js$/;

const semente = () => {
  let estado = 20261127;
  return () => {
    estado = (estado * 1664525 + 1013904223) % 4294967296;
    return estado / 4294967296;
  };
};

function substituir(alvo, chave, valor) {
  const existia = Object.prototype.hasOwnProperty.call(alvo, chave);
  const antes = alvo[chave];
  if (valor === undefined) delete alvo[chave];
  else Object.defineProperty(alvo, chave, { value: valor, configurable: true, writable: true, enumerable: true });
  return () => {
    if (existia) Object.defineProperty(alvo, chave, { value: antes, configurable: true, writable: true, enumerable: true });
    else delete alvo[chave];
  };
}

function descrever(valor) {
  if (valor === undefined) return '<undefined>';
  if (valor instanceof Error) return { erro: valor.name, mensagem: valor.message };
  return valor;
}

function normalizador(pastaDeDados) {
  const trocas = [[pastaDeDados, '<dados>'], [PASTA_DOS_SERVICOS, '<servicos>'], [PASTA_DO_ELECTRON, '<electron>'], [PASTA_DO_APP, '<app>']];
  const texto = valor => marcarCaminhos(valor, trocas).replace(/\\/g, '/');
  return valor => {
    const serializado = JSON.stringify(valor === undefined ? null : valor, (_, item) => {
      const descrito = descrever(item);
      return typeof descrito === 'string' ? texto(descrito) : descrito;
    });
    return JSON.parse(serializado);
  };
}

function sessaoFalsa(ambiente) {
  return {
    setProxy: async opcoes => { ambiente.anotar('session.setProxy', opcoes); },
    on: evento => { ambiente.anotar('session.on', evento); },
  };
}

function requisicaoFalsa(ambiente, opcoes) {
  ambiente.anotar('net.request', { method: opcoes.method, url: opcoes.url });
  const ouvintes = {};
  return {
    on: (evento, funcao) => { ouvintes[evento] = funcao; },
    end: () => {
      if (ambiente.resposta === 'erro') return ouvintes.error(new Error('sem rede'));
      const dados = {};
      ouvintes.response({ on: (evento, funcao) => { dados[evento] = funcao; } });
      dados.data(Buffer.from(ambiente.resposta));
      return dados.end();
    },
  };
}

function eletronFalso(ambiente) {
  return {
    app: {
      getPath: nome => { ambiente.anotar('app.getPath', nome); return ambiente.pastaDeDados; },
      getAppPath: () => { ambiente.anotar('app.getAppPath'); return PASTA_DO_APP_EMPACOTADO; },
    },
    BrowserWindow: class {},
    session: { fromPartition: nome => { ambiente.anotar('session.fromPartition', nome); return sessaoFalsa(ambiente); } },
    ipcMain: { handle() {} },
    net: { request: opcoes => requisicaoFalsa(ambiente, opcoes) },
    screen: {
      getPrimaryDisplay: () => {
        ambiente.anotar('screen.getPrimaryDisplay');
        if (ambiente.tela === 'erro') throw new Error('sem tela');
        return ambiente.tela;
      },
    },
  };
}

function utilitariosDePlataformaFalsos(ambiente) {
  return {
    findBundledChromiumExecutable: pastas => {
      ambiente.anotar('findBundledChromiumExecutable', pastas);
      return ambiente.empacotado ?? null;
    },
    primeiroCaminhoExistente: caminhos => {
      ambiente.anotar('primeiroCaminhoExistente', caminhos);
      return caminhos.filter(Boolean).find(caminho => ambiente.existe(caminho)) ?? null;
    },
  };
}

function sistemaDeArquivosFalso(ambiente) {
  const dentroDaPastaDeDados = caminho => String(caminho).startsWith(ambiente.pastaDeDados);
  return {
    ...fs,
    existsSync: caminho => {
      if (dentroDaPastaDeDados(caminho)) return fs.existsSync(caminho);
      const existe = ambiente.existentes.some(item => ambiente.texto(String(caminho)) === item);
      ambiente.anotar('fs.existsSync', caminho, existe);
      return existe;
    },
    writeFileSync: (caminho, conteudo) => {
      const dados = JSON.parse(conteudo);
      ambiente.anotar('fs.writeFileSync', caminho, { indentado: conteudo === JSON.stringify(dados, null, 2), dados });
      return fs.writeFileSync(caminho, conteudo);
    },
  };
}

function modulosFalsos(ambiente) {
  return {
    electron: eletronFalso(ambiente),
    playwright: { chromium: {}, firefox: {} },
    systeminformation: {},
    fs: sistemaDeArquivosFalso(ambiente),
    './platform-utils': utilitariosDePlataformaFalsos(ambiente),
    './mac-native': { browser: nome => { ambiente.anotar('mac-native.browser', nome); return `/mac/${nome}`; } },
  };
}

function interceptarOsRequiresDoFarm(ambiente) {
  const falsos = modulosFalsos(ambiente);
  const original = Module._load;
  Module._load = function carregar(pedido, pai, ...resto) {
    const doFarm = pai && SERVICO_OU_MODULO_DO_FARM.test(path.basename(pai.filename || ''));
    if (doFarm && Object.prototype.hasOwnProperty.call(falsos, pedido)) return falsos[pedido];
    return original.call(this, pedido, pai, ...resto);
  };
  return () => { Module._load = original; };
}

function esquecerOsModulosDoFarm() {
  for (const arquivo of Object.keys(require.cache)) {
    if (path.dirname(arquivo) === PASTA_DOS_SERVICOS && SERVICO_OU_MODULO_DO_FARM.test(path.basename(arquivo))) delete require.cache[arquivo];
  }
}

function anotarConsole(ambiente) {
  const originais = {};
  for (const nivel of ['log', 'info', 'warn', 'error']) {
    originais[nivel] = console[nivel];
    console[nivel] = (...partes) => ambiente.anotar(`console.${nivel}`, ...partes);
  }
  return () => Object.assign(console, originais);
}

function ajustarOProcesso(ambiente, cena) {
  const desfazer = [
    substituir(process, 'platform', cena.sistema || 'win32'),
    substituir(process, 'resourcesPath', cena.semRecursos ? undefined : PASTA_DOS_RECURSOS),
    substituir(process.env, 'LOCALAPPDATA', cena.semLocal ? undefined : LOCAL_DO_USUARIO),
    substituir(Math, 'random', () => { ambiente.sorteios += 1; return ambiente.sortear(); }),
    substituir(crypto, 'randomBytes', tamanho => { ambiente.bytesSorteados += 1; return Buffer.alloc(tamanho, ambiente.bytesSorteados); }),
    substituir(global, 'setTimeout', (funcao, espera) => { ambiente.anotar('setTimeout', espera); return 0; }),
  ];
  return () => desfazer.reverse().forEach(refazer => refazer());
}

function criarAmbiente(cena) {
  const pastaDeDados = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-farm-perfil-'));
  const ambiente = {
    pastaDeDados,
    chamadas: [],
    sorteios: 0,
    bytesSorteados: 0,
    sortear: semente(),
    existentes: cena.existentes || [],
    empacotado: cena.empacotado,
    tela: cena.tela,
    resposta: cena.resposta,
    texto: valor => normalizador(pastaDeDados)(valor),
  };
  ambiente.anotar = (...partes) => ambiente.chamadas.push(partes);
  ambiente.existe = caminho => ambiente.existentes.includes(ambiente.texto(caminho));
  if (cena.arquivo !== undefined) fs.writeFileSync(path.join(pastaDeDados, ARQUIVO_DOS_PERFIS), cena.arquivo);
  return ambiente;
}

function arquivoDosPerfisDepois(pastaDeDados) {
  const arquivo = path.join(pastaDeDados, ARQUIVO_DOS_PERFIS);
  return fs.existsSync(arquivo) ? fs.readFileSync(arquivo, 'utf8') : '<sem arquivo>';
}

async function encenar(cena) {
  const ambiente = criarAmbiente(cena);
  const desfazer = [interceptarOsRequiresDoFarm(ambiente), ajustarOProcesso(ambiente, cena), anotarConsole(ambiente)];
  let resultado;
  try {
    esquecerOsModulosDoFarm();
    const Servico = require('../browserFarmService');
    const servico = new Servico(null);
    if (cena.perfis) servico.profiles = JSON.parse(JSON.stringify(cena.perfis));
    resultado = await cena.roteiro({ servico, ambiente });
  } catch (erro) {
    resultado = erro;
  } finally {
    desfazer.reverse().forEach(refazer => refazer());
  }
  const normalizar = normalizador(ambiente.pastaDeDados);
  const registro = {
    resultado: normalizar(resultado),
    chamadas: normalizar(ambiente.chamadas),
    sorteios: ambiente.sorteios,
    bytesSorteados: ambiente.bytesSorteados,
    arquivoDosPerfis: arquivoDosPerfisDepois(ambiente.pastaDeDados),
  };
  fs.rmSync(ambiente.pastaDeDados, { recursive: true, force: true });
  return registro;
}

module.exports = { encenar };
