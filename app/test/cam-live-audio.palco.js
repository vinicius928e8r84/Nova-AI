'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CAMINHO = path.join(__dirname, '..', 'dist', 'cam-live-audio.js');

const resumirAmostras = dados => {
  const lista = Array.from(dados);
  return { tamanho: lista.length, primeiros: lista.slice(0, 4), soma: Math.round(lista.reduce((soma, valor) => soma + valor, 0) * 1000) / 1000 };
};

const mensagemDe = erro => (erro && erro.message !== undefined ? `Error(${erro.message})` : erro);

class Parametro {
  constructor(palco, dono) {
    this.palco = palco;
    this.dono = dono;
    this.atual = 1;
  }

  get value() {
    return this.atual;
  }

  set value(valor) {
    this.palco.anotar('value', this.dono, valor);
    this.atual = valor;
  }

  setTargetAtTime(valor, quando, constante) {
    this.palco.anotar('setTargetAtTime', this.dono, valor, quando, constante);
    if (this.palco.opcoes.rampaLanca) throw new Error('sem rampa');
    this.atual = valor;
  }
}

class NoFalso {
  constructor(palco, nome) {
    this.palco = palco;
    this.nome = nome;
  }

  connect(destino) {
    this.palco.anotar('connect', this.nome, destino.nome);
  }

  disconnect(destino) {
    this.palco.anotar('disconnect', this.nome, destino ? destino.nome : '(todos)');
    if (this.palco.opcoes.disconnectLanca) throw new Error('já desligado');
  }
}

class GanhoFalso extends NoFalso {
  constructor(palco, nome) {
    super(palco, nome);
    this.gain = new Parametro(palco, nome);
  }
}

class AnalisadorFalso extends NoFalso {
  set fftSize(valor) {
    this.palco.anotar('fftSize', this.nome, valor);
  }

  set smoothingTimeConstant(valor) {
    this.palco.anotar('smoothingTimeConstant', this.nome, valor);
  }

  getFloatTimeDomainData(destino) {
    destino.fill(0);
    destino.set(this.palco.amostras[this.nome] || []);
  }
}

class PortaFalsa {
  constructor(palco) {
    this.palco = palco;
    this.onmessage = null;
  }

  close() {
    this.palco.anotar('port.close');
    if (this.palco.opcoes.portCloseLanca) throw new Error('porta presa');
  }
}

function classeDoContexto(palco) {
  return class ContextoFalso {
    constructor(opcoes) {
      palco.anotar('new AudioContext', opcoes);
      palco.contexto = this;
      this.state = palco.opcoes.estadoInicial || 'running';
      this.currentTime = 0.5;
      this.sampleRate = opcoes.sampleRate;
      this.destination = new NoFalso(palco, 'destino');
      this.audioWorklet = { addModule: url => palco.adicionarModulo(url) };
      palco.contagem = {};
    }

    criar(Classe, prefixo) {
      palco.contagem[prefixo] = (palco.contagem[prefixo] || 0) + 1;
      return new Classe(palco, `${prefixo}${palco.contagem[prefixo]}`);
    }

    createGain() {
      return this.criar(GanhoFalso, 'gain');
    }

    createAnalyser() {
      return this.criar(AnalisadorFalso, 'an');
    }

    createMediaElementSource(elemento) {
      palco.anotar('createMediaElementSource', elemento.nome);
      if (elemento.lanca) throw new Error(`fonte recusada: ${elemento.nome}`);
      return this.criar(NoFalso, 'src');
    }

    resume() {
      palco.anotar('resume');
      return palco.retomar(this);
    }
  };
}

function classeDoEncoder(palco) {
  return class EncoderFalso {
    constructor({ output, error }) {
      palco.anotar('new AudioEncoder');
      palco.encoder = this;
      this.output = output;
      this.error = error;
      this.state = 'unconfigured';
      this.codificados = 0;
    }

    static isConfigSupported(config) {
      palco.anotar('isConfigSupported', config);
      return palco.suporte();
    }

    configure(config) {
      palco.anotar('configure', config);
      this.state = 'configured';
    }

    encode(dados) {
      palco.anotar('encode', dados.descricao);
      if (palco.opcoes.encodeLanca) throw new Error('encoder cheio');
      this.codificados += 1;
      if (palco.opcoes.encoderEmite) this.emitir(dados.descricao.timestamp);
    }

    emitir(timestamp) {
      const meta = this.codificados <= 2 ? { decoderConfig: { description: new Uint8Array([0x11, 0x90]).buffer } } : {};
      this.output({ byteLength: 3, timestamp, copyTo: destino => destino.set([1, 2, 3]) }, meta);
    }

    flush() {
      palco.anotar('flush');
      return palco.opcoes.flushLanca ? Promise.reject(new Error('flush falhou')) : Promise.resolve();
    }

    close() {
      palco.anotar('encoder.close');
      this.state = 'closed';
    }
  };
}

function classeDosDados(palco) {
  return class DadosFalsos {
    constructor(init) {
      this.descricao = { format: init.format, sampleRate: init.sampleRate, numberOfFrames: init.numberOfFrames, numberOfChannels: init.numberOfChannels, timestamp: init.timestamp, data: resumirAmostras(init.data) };
    }

    close() {
      palco.anotar('AudioData.close');
    }
  };
}

function classeDoNoDeWorklet(palco) {
  return class NoDeWorkletFalso extends NoFalso {
    constructor(contexto, nome, opcoes) {
      super(palco, 'worklet');
      palco.anotar('new AudioWorkletNode', nome, opcoes);
      if (palco.opcoes.workletNodeLanca) throw new Error('processador recusado');
      this.port = new PortaFalsa(palco);
      this.onprocessorerror = null;
      palco.no = this;
    }
  };
}

function montarJanela(palco) {
  const janela = {};
  const { opcoes } = palco;
  const Contexto = classeDoContexto(palco);
  if (opcoes.webkit) janela.webkitAudioContext = Contexto;
  else if (!opcoes.semAudioContext) janela.AudioContext = Contexto;
  const globais = {
    window: janela,
    console: { warn: (...args) => palco.anotar('console.warn', ...args) },
    performance: { now: () => palco.agora },
    setTimeout: (funcao, atraso) => {
      palco.anotar('setTimeout', atraso);
      queueMicrotask(funcao);
    },
    URL: { createObjectURL: () => 'blob:worklet', revokeObjectURL: url => palco.anotar('revokeObjectURL', url) },
    Blob: class { constructor(partes, opcoes) { palco.anotar('Blob', partes[0].length, opcoes); } },
  };
  if (!opcoes.semAudioEncoder) Object.assign(globais, { AudioEncoder: classeDoEncoder(palco), AudioData: classeDosDados(palco) });
  if (!opcoes.semWorkletNode) globais.AudioWorkletNode = classeDoNoDeWorklet(palco);
  return globais;
}

const RESPOSTAS_DO_RESUME = {
  resolve: contexto => {
    contexto.state = 'running';
    return Promise.resolve();
  },
  nunca: () => new Promise(() => {}),
  rejeita: () => Promise.reject(new Error('gesto exigido')),
};

const RESPOSTAS_DO_SUPORTE = {
  sim: () => Promise.resolve({ supported: true }),
  nao: () => Promise.resolve({ supported: false }),
  nulo: () => Promise.resolve(null),
  lanca: () => Promise.reject(new Error('sem codec')),
};

function criarPalco(opcoes) {
  const palco = { opcoes, registro: [], agora: 1000, amostras: {}, elementos: {}, contexto: null, encoder: null, no: null };
  palco.anotar = (...itens) => palco.registro.push(itens);
  palco.retomar = contexto => RESPOSTAS_DO_RESUME[opcoes.resume || 'resolve'](contexto);
  palco.suporte = () => RESPOSTAS_DO_SUPORTE[opcoes.suporte || 'sim']();
  palco.adicionarModulo = url => {
    palco.anotar('addModule', url);
    return opcoes.addModuleFalha ? Promise.reject(new Error('worklet recusado')) : Promise.resolve();
  };
  return palco;
}

function elementoDe(palco, nome) {
  if (nome === null) return null;
  if (!palco.elementos[nome]) palco.elementos[nome] = { nome, lanca: (palco.opcoes.fonteLanca || []).includes(nome) };
  return palco.elementos[nome];
}

function callbacksDaCaptura(palco, pedido) {
  const { lancaNoPacote, ...resto } = pedido;
  return {
    ...resto,
    onAsc: pedido.onAsc ? asc => palco.anotar('onAsc', Array.from(asc)) : undefined,
    onPacket: pedido.onPacket ? pacote => {
      palco.anotar('onPacket', pacote.data.length, pacote.ptsUs);
      if (lancaNoPacote) throw new Error('consumidor caiu');
    } : undefined,
    onPcm: pedido.onPcm ? pcm => palco.anotar('onPcm', resumirAmostras(pcm.data), pcm.sampleRate) : undefined,
    onError: pedido.onError ? texto => palco.anotar('onError', texto) : undefined,
  };
}

function blocoDe(n, valorL, valorR) {
  const l = new Float32Array(n).map((_, i) => valorL + i / 10000);
  const r = new Float32Array(n).map((_, i) => valorR - i / 10000);
  return [l, r];
}

const chamarSeLigado = (ouvinte, evento) => (ouvinte ? ouvinte(evento) : 'sem ouvinte');

const ACOES = {
  attach: (palco, id, nome) => palco.api.attach(id, elementoDe(palco, nome)),
  detach: (palco, id) => palco.api.detach(id),
  setParams: (palco, id, params) => palco.api.setParams(id, params),
  levels: palco => palco.api.levels(),
  resume: palco => palco.api.resume(),
  supported: palco => palco.api.supported(),
  startCapture: (palco, pedido) => palco.api.startCapture(pedido && callbacksDaCaptura(palco, pedido)),
  stopCapture: palco => palco.api.stopCapture(),
  bloco: (palco, n, valorL, valorR) => chamarSeLigado(palco.no.port.onmessage, { data: blocoDe(n, valorL, valorR) }),
  erroDoEncoder: (palco, texto) => palco.encoder.error(new Error(texto)),
  erroDoProcessador: palco => chamarSeLigado(palco.no.onprocessorerror),
  estadoDoEncoder: (palco, estado) => { palco.encoder.state = estado; },
  agora: (palco, ms) => { palco.agora = ms; },
  estado: (palco, estado) => { palco.contexto.state = estado; },
  amostras: (palco, nome, valores) => { palco.amostras[nome] = valores; },
  opcao: (palco, nome, valor) => { palco.opcoes[nome] = valor; },
};

const esvaziarFila = () => new Promise(resolve => setImmediate(resolve));

async function encenar(cena, caminho = CAMINHO) {
  const palco = criarPalco({ ...cena.opcoes });
  const contexto = vm.createContext(montarJanela(palco));
  vm.runInContext(fs.readFileSync(caminho, 'utf8'), contexto, { filename: caminho });
  palco.api = contexto.window.CamLiveAudio;
  palco.anotar('api', Object.keys(palco.api));
  for (const [acao, ...args] of cena.passos) {
    palco.anotar('>', acao, ...args);
    const retorno = await ACOES[acao](palco, ...args);
    await esvaziarFila();
    if (retorno !== undefined) palco.anotar('<', mensagemDe(retorno));
  }
  return JSON.parse(JSON.stringify(palco.registro));
}

module.exports = { encenar };
