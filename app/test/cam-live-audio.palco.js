'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { mock } = require('node:test');

const ARQUIVO = path.join(__dirname, '..', 'dist', 'cam-live-audio.js');
const palco = { eventos: [], cena: null, contextos: [], codificadores: [], nosDoWorklet: [], contadores: {}, agora: 1000 };

const anotar = (tipo, dados) => palco.eventos.push([tipo, dados]);

function resumir(valor) {
  if (ArrayBuffer.isView(valor)) return { tipo: valor.constructor.name, tamanho: valor.length, soma: Array.from(valor).reduce((a, b) => a + b, 0) };
  if (typeof valor === 'function') return '<função>';
  return valor;
}

function rotular(tipo) {
  palco.contadores[tipo] = (palco.contadores[tipo] || 0) + 1;
  return `${tipo}#${palco.contadores[tipo]}`;
}

function registrado(alvo, rotulo) {
  return new Proxy(alvo, {
    set(objeto, nome, valor) {
      anotar('propriedade', [rotulo, nome, resumir(valor)]);
      objeto[nome] = valor;
      return true;
    },
  });
}

function criarParametro(rotulo) {
  return registrado({
    value: 0,
    setTargetAtTime(valor, tempo, constante) {
      anotar('parametro.setTargetAtTime', [rotulo, valor, tempo, constante]);
      if (palco.cena.alvoFalha) throw new Error('sem setTargetAtTime');
    },
  }, rotulo);
}

function criarNo(tipo, extras = {}) {
  const rotulo = rotular(tipo);
  const no = registrado({
    rotulo,
    connect(para) {
      anotar('connect', [rotulo, para.rotulo]);
    },
    disconnect(para) {
      anotar('disconnect', [rotulo, para ? para.rotulo : null]);
      if (palco.cena.desconectarFalha) throw new Error('já desconectado');
    },
    ...extras,
  }, rotulo);
  return no;
}

function criarGanho() {
  const ganho = criarNo('ganho');
  ganho.gain = criarParametro(`${ganho.rotulo}.gain`);
  return ganho;
}

function criarAnalisador() {
  const analisador = criarNo('analisador', {
    getFloatTimeDomainData(vetor) {
      const pico = (palco.cena.picos || {})[analisador.rotulo];
      anotar('analisador.getFloatTimeDomainData', [analisador.rotulo, vetor.length]);
      if (pico === 'lanca') throw new Error('sem dados');
      vetor.fill(0);
      vetor[3] = pico || 0;
    },
  });
  return analisador;
}

class ContextoFalso {
  constructor(opcoes) {
    anotar('contexto.criar', [opcoes]);
    this.state = palco.cena.estadoDoContexto || 'running';
    this.currentTime = 12.5;
    this.sampleRate = opcoes.sampleRate;
    this.destination = criarNo('destino');
    this.audioWorklet = {
      addModule: async (url) => {
        anotar('worklet.addModule', [url]);
        if (palco.cena.moduloFalha) throw new Error('módulo recusado');
      },
    };
    palco.contextos.push(this);
  }

  createGain() {
    return criarGanho();
  }

  createAnalyser() {
    return criarAnalisador();
  }

  createMediaElementSource(elemento) {
    anotar('contexto.createMediaElementSource', [elemento.rotulo]);
    if (palco.cena.fonteFalha) throw new Error('elemento já ligado');
    return criarNo('fonte', { elemento: elemento.rotulo });
  }

  resume() {
    anotar('contexto.resume', []);
    if (palco.cena.retomaNunca) return new Promise(() => {});
    if (palco.cena.retomaFalha) return Promise.reject(new Error('sem gesto'));
    this.state = 'running';
    return Promise.resolve();
  }
}

class CodificadorFalso {
  constructor(inicial) {
    this.inicial = inicial;
    this.state = 'unconfigured';
    palco.codificadores.push(this);
  }

  static async isConfigSupported(configuracao) {
    anotar('codificador.isConfigSupported', [configuracao]);
    if (palco.cena.suporteLanca) throw new Error('sem suporte');
    return palco.cena.suporte === undefined ? { supported: true } : palco.cena.suporte;
  }

  configure(configuracao) {
    anotar('codificador.configure', [configuracao]);
    this.state = 'configured';
  }

  encode(dados) {
    anotar('codificador.encode', [dados.inicial.timestamp]);
    if (palco.cena.encodeFalha) throw new Error('encode quebrou');
  }

  async flush() {
    anotar('codificador.flush', []);
    if (palco.cena.flushFalha) throw new Error('flush quebrou');
  }

  close() {
    anotar('codificador.close', []);
    this.state = 'closed';
    if (palco.cena.fecharFalha) throw new Error('close quebrou');
  }
}

class DadosFalsos {
  constructor(inicial) {
    this.inicial = inicial;
    anotar('audiodata.criar', [{ ...inicial, data: resumir(inicial.data) }]);
  }

  close() {
    anotar('audiodata.close', []);
  }
}

class NoDoWorkletFalso {
  constructor(contexto, nome, opcoes) {
    anotar('worklet.no', [nome, opcoes]);
    Object.assign(this, criarNo('worklet', { port: registrado({ close: () => anotar('porta.close', []) }, 'porta') }));
    this.onprocessorerror = null;
    palco.nosDoWorklet.push(this);
  }
}

class BlobFalso {
  constructor(partes, opcoes) {
    const texto = partes.join('');
    anotar('blob.criar', [{ tipo: opcoes.type, bytes: texto.length, sha256: crypto.createHash('sha256').update(texto).digest('hex').slice(0, 16), primeiraLinha: texto.split('\n')[0] }]);
  }
}

function criarSandbox(console) {
  const construtores = palco.cena.semAudioContext ? {} : { AudioContext: ContextoFalso };
  const webkit = palco.cena.comWebkit ? { webkitAudioContext: ContextoFalso } : {};
  const suporte = { AudioEncoder: CodificadorFalso, AudioData: DadosFalsos, AudioWorkletNode: NoDoWorkletFalso };
  for (const nome of palco.cena.semGlobais || []) delete suporte[nome];
  return {
    window: { ...construtores, ...webkit },
    performance: { now: () => palco.agora },
    URL: { createObjectURL: () => { anotar('url.createObjectURL', []); return 'blob:falso'; }, revokeObjectURL: (url) => anotar('url.revokeObjectURL', [url]) },
    Blob: BlobFalso,
    setTimeout: (...argumentos) => globalThis.setTimeout(...argumentos),
    console,
    ...suporte,
  };
}

function criarConsole() {
  const registro = {};
  for (const nivel of ['log', 'warn', 'error']) registro[nivel] = (...partes) => anotar(`console.${nivel}`, partes.map(String));
  return registro;
}

async function descarregar() {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
}

function criarAmbiente() {
  return {
    api: () => palco.janela.CamLiveAudio,
    midia: (rotulo) => ({ rotulo }),
    contextos: () => palco.contextos,
    codificadores: () => palco.codificadores,
    nosDoWorklet: () => palco.nosDoWorklet,
    avancar: async (ms) => {
      await descarregar();
      mock.timers.tick(ms);
      await descarregar();
    },
    relogio: (valor) => { palco.agora = valor; },
    anotar,
  };
}

const normalizar = (valor) => JSON.parse(JSON.stringify(valor, (chave, item) => (item === undefined ? '(indefinido)' : resumir(item))));

async function rodarCena(cena) {
  Object.assign(palco, { eventos: [], cena, contextos: [], codificadores: [], nosDoWorklet: [], contadores: {}, agora: 1000 });
  mock.timers.enable({ apis: ['setTimeout'] });
  const sandbox = criarSandbox(criarConsole());
  palco.janela = sandbox.window;
  try {
    vm.runInNewContext(fs.readFileSync(ARQUIVO, 'utf8'), sandbox, { filename: ARQUIVO });
    const retornos = await cena.roteiro(criarAmbiente());
    return normalizar({ retornos, eventos: palco.eventos });
  } finally {
    mock.timers.reset();
  }
}

module.exports = { rodarCena };
