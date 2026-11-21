'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { ComOuvintes, DocumentoFalso, NoDeTexto } = require('./ajuda/dom-falso');

const CAMINHO_DO_CONTENT = path.join(__dirname, '..', 'electron', 'nova-grab-extension', 'content.js');
const TEXTO_LONGO = 160;
const URL_DE_VIDEO = 'https://www.youtube.com/watch?v=abc123';

function resumir(texto) {
  if (texto.length <= TEXTO_LONGO) return texto;
  const resumo = crypto.createHash('sha256').update(texto).digest('hex').slice(0, 16);
  return `sha256:${resumo} (${texto.length} caracteres)`;
}

function vazio(valor) {
  if (Array.isArray(valor)) return valor.length === 0;
  if (valor && typeof valor === 'object') return Object.keys(valor).length === 0;
  return valor === undefined || valor === '';
}

function semVazios(objeto) {
  return Object.fromEntries(Object.entries(objeto).filter(([, valor]) => !vazio(valor)));
}

function retratoDoEstilo(estilo) {
  return semVazios(Object.fromEntries(Object.keys(estilo).map(nome => [nome, resumir(estilo[nome])])));
}

function retratoDoNo(no) {
  if (no instanceof NoDeTexto) return resumir(no.texto);
  return semVazios({
    tag: no.tagName,
    id: no.id,
    classe: no.className,
    estilo: retratoDoEstilo(no.style),
    atributos: no.atributos,
    valor: no.value,
    onclick: typeof no.onclick === 'function' ? 'sim' : '',
    ouvintes: no.tiposOuvidos(),
    nos: no.nos.map(retratoDoNo),
  });
}

function paraRegistro(valor) {
  return valor === undefined ? '(undefined)' : JSON.parse(JSON.stringify(valor));
}

class RelogioFalso {
  constructor(registro) {
    this.registro = registro;
    this.agora = 0;
    this.ultimoId = 0;
    this.agendados = new Map();
  }

  agendar(tipo, funcao, atraso) {
    this.ultimoId += 1;
    this.agendados.set(this.ultimoId, { tipo, funcao, atraso, quando: this.agora + atraso });
    this.registro.push([tipo, atraso, this.ultimoId]);
    return this.ultimoId;
  }

  cancelar(id) {
    this.registro.push(['clearInterval', id]);
    this.agendados.delete(id);
  }

  proximoAte(fim) {
    const vencidos = [...this.agendados].filter(([, agendado]) => agendado.quando <= fim);
    vencidos.sort(([idA, a], [idB, b]) => a.quando - b.quando || idA - idB);
    return vencidos[0];
  }

  disparar([id, agendado]) {
    this.agora = agendado.quando;
    if (agendado.tipo === 'setInterval') agendado.quando += agendado.atraso;
    else this.agendados.delete(id);
    agendado.funcao();
  }

  avancar(ms) {
    const fim = this.agora + ms;
    for (let vencido = this.proximoAte(fim); vencido; vencido = this.proximoAte(fim)) this.disparar(vencido);
    this.agora = fim;
  }
}

class PalcoNovaGrab {
  constructor(url) {
    this.registro = [];
    this.relogio = new RelogioFalso(this.registro);
    this.documento = new DocumentoFalso();
    this.ouvintesDaJanela = new ComOuvintes();
    this.observadores = [];
    this.janela = this.criarJanela(url);
  }

  criarJanela(url) {
    const { registro, relogio, ouvintesDaJanela, observadores } = this;
    const anotar = nome => (...args) => registro.push([nome, ...args.map(paraRegistro)]);
    const janela = {
      document: this.documento,
      location: { href: url },
      console: { log: anotar('console.log'), info: anotar('console.info'), warn: anotar('console.warn'), error: anotar('console.error') },
      setTimeout: (funcao, atraso) => relogio.agendar('setTimeout', funcao, atraso),
      setInterval: (funcao, atraso) => relogio.agendar('setInterval', funcao, atraso),
      clearInterval: id => relogio.cancelar(id),
      addEventListener: (tipo, ouvinte) => ouvintesDaJanela.addEventListener(tipo, ouvinte),
      removeEventListener: (tipo, ouvinte) => ouvintesDaJanela.removeEventListener(tipo, ouvinte),
      MutationObserver: class {
        constructor(aviso) {
          observadores.push(aviso);
        }

        observe(alvo, opcoes) {
          registro.push(['observe', alvo.tagName, paraRegistro(opcoes)]);
        }
      },
    };
    janela.window = janela;
    return vm.createContext(janela);
  }

  carregar(caminho) {
    vm.runInContext(fs.readFileSync(caminho, 'utf8'), this.janela, { filename: caminho });
  }

  tentar(rotulo, acao) {
    try {
      acao();
    } catch (erro) {
      this.registro.push(['erro', rotulo, erro?.constructor?.name, erro?.message]);
    }
  }

  evento(nome, extras = {}) {
    return {
      ...extras,
      preventDefault: () => this.registro.push([nome, 'preventDefault']),
      stopPropagation: () => this.registro.push([nome, 'stopPropagation']),
    };
  }

  porId(id) {
    return this.documento.getElementById(id);
  }

  clicar(elemento, rotulo) {
    this.registro.push(['clique', rotulo]);
    if (typeof elemento?.onclick !== 'function') {
      this.registro.push(['sem onclick', rotulo]);
      return;
    }
    this.tentar(rotulo, () => elemento.onclick(this.evento(rotulo)));
  }

  arrastar(alca, de, para) {
    alca.disparar('mousedown', this.evento('mousedown', { clientX: de[0], clientY: de[1] }));
    this.documento.disparar('mousemove', this.evento('mousemove', { clientX: para[0], clientY: para[1] }));
    this.documento.disparar('mouseup', this.evento('mouseup'));
  }

  navegar(url, comEvento) {
    this.janela.location.href = url;
    if (comEvento) this.ouvintesDaJanela.disparar('yt-navigate-finish', {});
  }

  mutar() {
    for (const aviso of this.observadores) aviso([]);
  }

  progresso(dados) {
    this.tentar('__novaUpdateProgress', () => this.janela.__novaUpdateProgress(dados));
  }

  avancar(ms) {
    this.tentar(`avancar ${ms}`, () => this.relogio.avancar(ms));
  }

  foto(rotulo) {
    this.registro.push(['foto', rotulo, {
      dom: retratoDoNo(this.documento.documentElement),
      documento: this.documento.tiposOuvidos(),
      janela: this.ouvintesDaJanela.tiposOuvidos(),
      estado: paraRegistro(this.janela.__novaActiveDownloadState),
    }]);
  }
}

async function encenar(cena, caminho = CAMINHO_DO_CONTENT) {
  const palco = new PalcoNovaGrab(cena.url || URL_DE_VIDEO);
  if (cena.pagina) cena.pagina(palco.documento);
  palco.carregar(caminho);
  await cena.passos(palco);
  return palco.registro;
}

module.exports = { CAMINHO_DO_CONTENT, URL_DE_VIDEO, PalcoNovaGrab, encenar };
