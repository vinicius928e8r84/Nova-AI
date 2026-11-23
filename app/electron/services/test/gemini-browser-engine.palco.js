'use strict';
const Module = require('module');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const carregadorOriginal = Module._load;
const CONSOLE_PARA_CANAL = { log: 'saida', info: 'saida', warn: 'aviso', error: 'erro' };
const RELOGIOS = ['setTimeout', 'clearTimeout', 'setInterval'];

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

function ciclo() {
  return new Promise(resolve => setImmediate(resolve));
}

class PaginaFalsa {
  constructor(palco) {
    this.palco = palco;
    this.ouvintes = {};
    this.quadroPrincipal = { url: () => this.palco.urlDoQuadro, nome: 'principal' };
  }

  on(evento, funcao) {
    this.palco.anotar(`pagina on ${evento}`);
    this.ouvintes[evento] = funcao;
  }

  mainFrame() { return this.quadroPrincipal; }

  async goto(url, opcoes) {
    this.palco.anotar(`pagina goto ${url} ${descrever(opcoes)}`);
    falharSeErro(this.palco.falhaNoGoto);
  }

  async close() {
    this.palco.anotar('pagina close');
    falharSeErro(this.palco.falhaAoFecharPagina);
  }

  async emitir(evento, argumento) {
    this.palco.anotar(`emite ${evento}`);
    await this.ouvintes[evento](argumento);
  }
}

class SessaoFalsa {
  constructor(palco, nome) {
    this.nome = nome;
    this.cookies = {
      get: async filtro => palco.lerCookies(filtro),
      set: async cookie => palco.gravarCookie(cookie),
    };
    this.webRequest = { onBeforeSendHeaders: funcao => palco.guardarCabecalhos(funcao) };
    this.clearStorageData = async opcoes => palco.limparSessao(opcoes);
  }
}

class JanelaFalsa {
  constructor(palco, opcoes) {
    this.palco = palco;
    this.destruida = palco.janelasDestruidas;
    const preferencias = { ...opcoes.webPreferences, session: opcoes.webPreferences.session.nome };
    palco.anotar(`janela nova ${descrever({ ...opcoes, webPreferences: preferencias })}`);
    this.webContents = {
      setAudioMuted: mudo => palco.anotar(`janela mudo ${mudo}`),
      once: (evento, funcao) => palco.aoCarregarJanela(evento, funcao),
      executeJavaScript: script => palco.executarNaPagina(script),
    };
  }

  loadURL(url) { this.palco.anotar(`janela loadURL ${url}`); }
  isDestroyed() { return this.destruida; }
  close() { this.palco.anotar('janela close'); }
}

class Palco {
  constructor(caminhoDoModulo) {
    this.caminhoDoModulo = caminhoDoModulo;
    this.raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-palco-'));
    this.registro = [];
    this.timers = [];
    this.intervalos = [];
    this.sessoes = {};
    this.cookiesDaSessao = [];
    this.respostasDaPagina = [];
    this.paginaCarrega = true;
    this.janelasDestruidas = false;
    this.pronto = true;
    this.urlDoQuadro = 'about:blank';
    this.navegador = this.criarNavegador();
    this.quandoPronto = new Promise(resolve => { this.ficarPronto = resolve; });
  }

  anotar(linha) {
    this.registro.push(linha.split(this.raiz).join('<tmp>').replace(/"updatedAt":\s*\d+/g, '"updatedAt":«agora»'));
  }

  criarNavegador() {
    const palco = this;
    return {
      isInitialized: true,
      context: null,
      async launch() {
        palco.anotar('navegador launch');
        falharSeErro(palco.falhaAoLancar);
        this.context = palco.contextoAoLancar;
      },
    };
  }

  criarContexto(cookies) {
    const palco = this;
    return {
      async cookies() { palco.anotar('contexto cookies'); return falharSeErro(cookies); },
      async newPage() { palco.anotar('contexto newPage'); palco.pagina = new PaginaFalsa(palco); return palco.pagina; },
    };
  }

  electron() {
    const palco = this;
    return {
      BrowserWindow: class extends JanelaFalsa { constructor(opcoes) { super(palco, opcoes); } },
      session: { fromPartition: nome => this.sessao(nome) },
      app: {
        getPath: nome => { this.anotar(`app getPath ${nome}`); return this.raiz; },
        isReady: () => this.pronto,
        whenReady: () => { this.anotar('app whenReady'); return this.quandoPronto; },
      },
    };
  }

  sessao(nome) {
    this.anotar(`sessao ${nome}`);
    this.sessoes[nome] = this.sessoes[nome] || new SessaoFalsa(this, nome);
    return this.sessoes[nome];
  }

  lerCookies(filtro) {
    this.anotar(`sessao cookies.get ${descrever(filtro)}`);
    return falharSeErro(this.cookiesDaSessao).slice();
  }

  gravarCookie(cookie) {
    this.anotar(`sessao cookies.set ${descrever(cookie)}`);
    if (cookie.name === this.cookieQueFalha) throw new Error(`cookie ${cookie.name} recusado`);
  }

  limparSessao(opcoes) {
    this.anotar(`sessao clearStorageData ${descrever(opcoes)}`);
    falharSeErro(this.falhaAoLimpar);
  }

  guardarCabecalhos(funcao) {
    this.anotar('sessao onBeforeSendHeaders');
    this.trocarCabecalhos = funcao;
  }

  aoCarregarJanela(evento, funcao) {
    this.anotar(`janela once ${evento}`);
    if (this.paginaCarrega) setImmediate(funcao);
  }

  async executarNaPagina(script) {
    this.anotar(`pagina executa ${resumo(script)} ${script.length}`);
    if (this.guardarScripts) this.scripts.push(script);
    return falharSeErro(this.respostasDaPagina.shift());
  }

  setTimeout(funcao, ms) {
    this.anotar(`timer ${ms}`);
    const timer = { funcao, ms };
    this.timers.push(timer);
    return timer;
  }

  clearTimeout(timer) {
    this.anotar(`limpa timer ${timer.ms}`);
    this.timers = this.timers.filter(t => t !== timer);
  }

  setInterval(funcao, ms) {
    this.anotar(`intervalo ${ms}`);
    this.intervalos.push(funcao);
  }

  async rodarTimers() {
    for (const { funcao, ms } of this.timers.splice(0)) {
      this.anotar(`dispara timer ${ms}`);
      funcao();
    }
    await ciclo();
  }

  async rodarIntervalos() {
    for (const funcao of this.intervalos) {
      this.anotar('dispara intervalo');
      await funcao();
    }
    await this.assentar();
  }

  async assentar() {
    for (let i = 0; i < 20; i++) await ciclo();
  }

  async ateTerminar(promessa) {
    let terminou = false;
    promessa.then(() => { terminou = true; }, () => { terminou = true; });
    while (!terminou) {
      await ciclo();
      await this.rodarTimers();
    }
    return promessa;
  }

  gravarArquivo(nome, conteudo) {
    fs.writeFileSync(path.join(this.raiz, nome), typeof conteudo === 'string' ? conteudo : JSON.stringify(conteudo));
  }

  lerArquivo(nome) {
    const arquivo = path.join(this.raiz, nome);
    this.anotar(`arquivo ${nome} ${fs.existsSync(arquivo) ? fs.readFileSync(arquivo, 'utf8').replace(/\s+/g, ' ') : '«ausente»'}`);
  }

  falsos() {
    return {
      electron: () => this.electron(),
      axios: () => ({}),
      playwright: () => falharSeErro(this.playwright || { chromium: {} }),
      './browser-manager': () => ({ browserService: this.navegador }),
    };
  }

  carregar() {
    const resolvido = require.resolve(this.caminhoDoModulo);
    delete require.cache[resolvido];
    this.motor = require(resolvido);
    return this.motor;
  }

  instalar() {
    const falsos = this.falsos();
    Module._load = function (pedido, ...resto) {
      return falsos[pedido] ? falsos[pedido]() : carregadorOriginal.call(this, pedido, ...resto);
    };
    this.relogiosOriginais = RELOGIOS.map(nome => [nome, global[nome]]);
    for (const nome of RELOGIOS) global[nome] = (...argumentos) => this[nome](...argumentos);
    this.consolesOriginais = Object.keys(CONSOLE_PARA_CANAL).map(nome => [nome, console[nome]]);
    for (const [nome, canal] of Object.entries(CONSOLE_PARA_CANAL)) {
      console[nome] = (...argumentos) => this.anotar(`${canal} ${argumentos.map(descrever).join(' ')}`);
    }
  }

  desinstalar() {
    Module._load = carregadorOriginal;
    for (const [nome, original] of this.relogiosOriginais) global[nome] = original;
    for (const [nome, original] of this.consolesOriginais) console[nome] = original;
    fs.rmSync(this.raiz, { recursive: true, force: true });
  }
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

module.exports = { encenar, descrever };
