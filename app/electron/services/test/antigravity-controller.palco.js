'use strict';
const Module = require('module');
const crypto = require('crypto');
const path = require('path');

const carregadorOriginal = Module._load;
const RELOGIOS = ['setTimeout', 'setInterval', 'clearInterval'];
const AMBIENTE = ['USERPROFILE', 'LOCALAPPDATA'];
const TIPOS_DE_COMANDO = [
  ['-File', 'colar'],
  ['Win32FocusOnly', 'focar'],
  ['Win32MinA', 'minimizar'],
  ['Stop-Process', 'fechar'],
  ['PID:$id', 'estatisticas'],
  ['Get-Process', 'rodando'],
];

function descrever(valor) {
  if (valor instanceof Error) return `«${valor.name}: ${valor.message}»`;
  if (typeof valor === 'string') return valor;
  return JSON.stringify(valor, (_chave, v) => (v === undefined ? '«undefined»' : v));
}

function resumo(texto) {
  return crypto.createHash('sha256').update(texto).digest('hex').slice(0, 16);
}

function falharSeErro(valor) {
  if (valor instanceof Error) throw valor;
  return valor;
}

function tipoDoComando(comando) {
  const achado = TIPOS_DE_COMANDO.find(([trecho]) => comando.includes(trecho));
  return achado ? achado[1] : 'outro';
}

function ciclo() {
  return new Promise(resolve => setImmediate(resolve));
}

class JanelaFalsa {
  constructor(palco) {
    this.palco = palco;
    this.destruida = false;
    this.webContents = { send: (canal, dados) => palco.anotar(`tela ${canal} ${descrever(dados)}`) };
  }

  isDestroyed() { return this.destruida; }
  setAlwaysOnTop(valor) {
    this.palco.anotar(`janela setAlwaysOnTop ${valor}`);
    falharSeErro(this.palco.falhaNaJanela);
  }

  focus() { this.palco.anotar('janela focus'); }
}

class Palco {
  constructor(caminhoDoModulo) {
    this.caminhoDoModulo = caminhoDoModulo;
    this.registro = [];
    this.intervalos = [];
    this.respostas = {};
    this.arquivos = new Set();
    this.mac = {};
    this.janela = new JanelaFalsa(this);
  }

  anotar(linha) {
    this.registro.push(linha.replace(/^tela swarm:log (.*)\[\d{2}:\d{2}:\d{2}\]/, 'tela swarm:log $1[hora]').replace(/"timestamp":\d+/, '"timestamp":«agora»'));
  }

  responder(tipo, ...respostas) {
    this.respostas[tipo] = respostas;
  }

  proximaResposta(tipo) {
    const fila = this.respostas[tipo] || [];
    return fila.length > 1 ? fila.shift() : fila[0] || {};
  }

  exec(comando, ...resto) {
    const tipo = tipoDoComando(comando);
    const chamada = resto.pop();
    this.anotar(`exec ${tipo} ${resumo(comando)} ${comando.length} ${descrever(resto)}${tipo === 'colar' ? ` ${comando.slice(-14)}` : ''}`);
    const { erro = null, stdout, stderr } = this.proximaResposta(tipo);
    setImmediate(() => chamada(erro, stdout, stderr));
  }

  spawn(executavel, argumentos, opcoes) {
    this.anotar(`spawn ${executavel} ${descrever(argumentos)} ${descrever(opcoes)}`);
    falharSeErro(this.falhaNoSpawn);
    return { unref: () => this.anotar('unref') };
  }

  falsoFs() {
    return {
      writeFileSync: (arquivo, conteudo, codificacao) => {
        this.anotar(`grava ${arquivo} ${resumo(conteudo)} ${conteudo.length} ${codificacao}`);
        falharSeErro(this.falhaAoGravar);
        this.arquivos.add(arquivo);
      },
      existsSync: arquivo => {
        this.anotar(`existe? ${arquivo}`);
        return this.arquivos.has(arquivo);
      },
    };
  }

  macNative() {
    const chamar = nome => async (...argumentos) => {
      this.anotar(`mac ${nome} ${descrever(argumentos)}`);
      return falharSeErro(this.mac[nome]);
    };
    return { pressKey: chamar('pressKey'), typeText: chamar('typeText'), run: chamar('run'), apple: chamar('apple') };
  }

  falsos() {
    return {
      child_process: () => ({ exec: (...a) => this.exec(...a), spawn: (...a) => this.spawn(...a) }),
      electron: () => ({ clipboard: { writeText: texto => this.anotar(`clipboard ${descrever(texto)}`) } }),
      fs: () => this.falsoFs(),
      os: () => ({ tmpdir: () => '/tmp-falso', homedir: () => '/casa-falsa' }),
      path: () => path.posix,
      './mac-native': () => this.macNative(),
      './paridade-utils': () => ({ macAntigravityStats: async mac => this.estatisticasDoMac(mac) }),
    };
  }

  estatisticasDoMac(mac) {
    this.anotar(`paridade macAntigravityStats ${typeof mac.run}`);
    return falharSeErro(this.statsMac);
  }

  setTimeout(funcao, ms) {
    this.anotar(`espera ${ms}`);
    setImmediate(funcao);
  }

  setInterval(funcao, ms) {
    this.anotar(`intervalo ${ms}`);
    const intervalo = { funcao, ms, vivo: true };
    this.intervalos.push(intervalo);
    return intervalo;
  }

  clearInterval(intervalo) {
    this.anotar(`limpa intervalo ${intervalo.ms}`);
    intervalo.vivo = false;
  }

  async rodarIntervalos(vezes = 1) {
    for (let i = 0; i < vezes; i++) {
      for (const intervalo of this.intervalos.filter(item => item.vivo)) await intervalo.funcao();
      await this.assentar();
    }
  }

  async assentar() {
    for (let i = 0; i < 10; i++) await ciclo();
  }

  criar() {
    const resolvido = require.resolve(this.caminhoDoModulo);
    delete require.cache[resolvido];
    const Controlador = require(resolvido);
    this.controlador = new Controlador(this.janela, { nome: 'app' });
    return this.controlador;
  }

  instalar() {
    const falsos = this.falsos();
    Module._load = function (pedido, ...resto) {
      return falsos[pedido] ? falsos[pedido]() : carregadorOriginal.call(this, pedido, ...resto);
    };
    this.originais = {
      plataforma: Object.getOwnPropertyDescriptor(process, 'platform'),
      relogios: RELOGIOS.map(nome => [nome, global[nome]]),
      ambiente: AMBIENTE.map(nome => [nome, process.env[nome]]),
    };
    this.usarPlataforma('win32');
    for (const nome of RELOGIOS) global[nome] = (...argumentos) => this[nome](...argumentos);
    definirAmbiente('USERPROFILE', 'C:\\Users\\nova');
    definirAmbiente('LOCALAPPDATA', 'C:\\Users\\nova\\AppData\\Local');
  }

  usarPlataforma(plataforma) {
    Object.defineProperty(process, 'platform', { value: plataforma, configurable: true });
  }

  desinstalar() {
    Module._load = carregadorOriginal;
    Object.defineProperty(process, 'platform', this.originais.plataforma);
    for (const [nome, original] of this.originais.relogios) global[nome] = original;
    for (const [nome, original] of this.originais.ambiente) definirAmbiente(nome, original);
  }
}

function definirAmbiente(nome, valor) {
  if (valor === undefined) delete process.env[nome];
  else process.env[nome] = valor;
}

async function encenar(caminhoDoModulo, cena) {
  const palco = new Palco(caminhoDoModulo);
  palco.instalar();
  try {
    await cena(palco);
    await palco.assentar();
  } catch (erro) {
    palco.anotar(`cena lancou ${descrever(erro)}`);
  } finally {
    palco.desinstalar();
  }
  return palco.registro;
}

module.exports = { encenar, descrever, definirAmbiente };
