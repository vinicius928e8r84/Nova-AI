'use strict';

const TAGS_SEM_FECHAMENTO = new Set(['img', 'input', 'br']);
const PEDACO_DE_HTML = /<(\/?)([\w-]+)([^>]*)>|([^<]+)/g;
const ATRIBUTO_DE_HTML = /([\w-]+)="([^"]*)"/g;
const PARTE_DE_SELETOR = /^([\w-]*)((?:[#.][\w-]+)*)$/;
const ATRIBUTOS_QUE_SAO_PROPRIEDADES = { id: 'id', class: 'className' };

function criarEstilo() {
  const estado = { cssText: '', propriedades: new Map() };
  return new Proxy(estado, {
    get: (alvo, nome) => (nome === 'cssText' ? alvo.cssText : alvo.propriedades.get(nome) ?? ''),
    set: (alvo, nome, valor) => {
      if (nome !== 'cssText') {
        alvo.propriedades.set(nome, String(valor));
        return true;
      }
      alvo.cssText = String(valor);
      alvo.propriedades.clear();
      return true;
    },
    ownKeys: (alvo) => ['cssText', ...[...alvo.propriedades.keys()].sort()],
    getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
  });
}

class NoDeTexto {
  constructor(texto) {
    this.texto = texto;
    this.parentNode = null;
  }

  get textContent() {
    return this.texto;
  }
}

function lerSeletor(texto) {
  return texto.split(',').map(grupo => grupo.trim().split(/\s+/).map(lerParteDoSeletor));
}

function lerParteDoSeletor(parte) {
  const [, tag, resto] = PARTE_DE_SELETOR.exec(parte);
  const marcas = resto.match(/[#.][\w-]+/g) || [];
  return {
    tag: tag.toUpperCase(),
    ids: marcas.filter(marca => marca.startsWith('#')).map(marca => marca.slice(1)),
    classes: marcas.filter(marca => marca.startsWith('.')).map(marca => marca.slice(1)),
  };
}

function casaParte(elemento, parte) {
  if (parte.tag && parte.tag !== elemento.tagName) return false;
  if (!parte.ids.every(id => id === elemento.id)) return false;
  const classes = elemento.className.split(/\s+/);
  return parte.classes.every(classe => classes.includes(classe));
}

function casaGrupo(elemento, grupo) {
  if (!casaParte(elemento, grupo[grupo.length - 1])) return false;
  let indice = grupo.length - 2;
  for (let acima = elemento.parentNode; acima instanceof ElementoFalso && indice >= 0; acima = acima.parentNode) {
    if (casaParte(acima, grupo[indice])) indice -= 1;
  }
  return indice < 0;
}

function* descendentes(no) {
  for (const filho of no.nos) {
    if (!(filho instanceof ElementoFalso)) continue;
    yield filho;
    yield* descendentes(filho);
  }
}

class ComOuvintes {
  constructor() {
    this.ouvintes = new Map();
  }

  addEventListener(tipo, ouvinte) {
    if (!this.ouvintes.has(tipo)) this.ouvintes.set(tipo, []);
    this.ouvintes.get(tipo).push(ouvinte);
  }

  removeEventListener(tipo, ouvinte) {
    const lista = this.ouvintes.get(tipo) || [];
    if (lista.includes(ouvinte)) lista.splice(lista.indexOf(ouvinte), 1);
  }

  disparar(tipo, evento = {}) {
    for (const ouvinte of [...(this.ouvintes.get(tipo) || [])]) ouvinte(evento);
  }

  tiposOuvidos() {
    return [...this.ouvintes].filter(([, lista]) => lista.length > 0).map(([tipo, lista]) => `${tipo}×${lista.length}`);
  }
}

class ElementoFalso extends ComOuvintes {
  constructor(tag, documento) {
    super();
    this.tagName = tag.toUpperCase();
    this.ownerDocument = documento;
    this.nos = [];
    this.parentNode = null;
    this.id = '';
    this.className = '';
    this.style = criarEstilo();
    this.atributos = {};
    this.offsetLeft = 0;
    this.offsetTop = 0;
    this.retangulo = { top: 0, right: 0, left: 0, bottom: 0, width: 0, height: 0 };
  }

  appendChild(filho) {
    if (filho.parentNode) filho.remove();
    filho.parentNode = this;
    this.nos.push(filho);
    return filho;
  }

  remove() {
    if (!this.parentNode) return;
    const irmaos = this.parentNode.nos;
    irmaos.splice(irmaos.indexOf(this), 1);
    this.parentNode = null;
  }

  get textContent() {
    return this.nos.map(no => no.textContent).join('');
  }

  set textContent(texto) {
    this.trocarNos(texto === '' ? [] : [new NoDeTexto(String(texto))]);
  }

  set innerHTML(html) {
    this.trocarNos(lerHtml(String(html), this.ownerDocument));
  }

  trocarNos(nos) {
    for (const no of this.nos) no.parentNode = null;
    this.nos = [];
    for (const no of nos) this.appendChild(no);
  }

  getBoundingClientRect() {
    return { ...this.retangulo };
  }

  querySelector(seletor) {
    const grupos = lerSeletor(seletor);
    for (const elemento of descendentes(this)) {
      if (grupos.some(grupo => casaGrupo(elemento, grupo))) return elemento;
    }
    return null;
  }
}

function aplicarAtributo(elemento, nome, valor) {
  const propriedade = ATRIBUTOS_QUE_SAO_PROPRIEDADES[nome];
  if (nome === 'style') elemento.style.cssText = valor;
  else if (propriedade) elemento[propriedade] = valor;
  else elemento.atributos[nome] = valor;
}

function abrirTag(atual, tag, atributos) {
  const elemento = atual.ownerDocument.createElement(tag);
  for (const [, nome, valor] of atributos.matchAll(ATRIBUTO_DE_HTML)) aplicarAtributo(elemento, nome, valor);
  atual.appendChild(elemento);
  return TAGS_SEM_FECHAMENTO.has(tag.toLowerCase()) ? atual : elemento;
}

function passoDoHtml(atual, [, fecha, tag, atributos, texto]) {
  if (texto !== undefined) {
    atual.appendChild(new NoDeTexto(texto));
    return atual;
  }
  return fecha ? atual.parentNode : abrirTag(atual, tag, atributos);
}

function lerHtml(html, documento) {
  const raiz = documento.createElement('template');
  let atual = raiz;
  for (const pedaco of html.matchAll(PEDACO_DE_HTML)) atual = passoDoHtml(atual, pedaco);
  const nos = [...raiz.nos];
  raiz.trocarNos([]);
  return nos;
}

class DocumentoFalso extends ComOuvintes {
  constructor() {
    super();
    this.title = '';
    this.documentElement = this.createElement('html');
    this.head = this.documentElement.appendChild(this.createElement('head'));
    this.body = this.documentElement.appendChild(this.createElement('body'));
  }

  createElement(tag) {
    return new ElementoFalso(tag, this);
  }

  querySelector(seletor) {
    return this.documentElement.querySelector(seletor);
  }

  getElementById(id) {
    for (const elemento of descendentes(this.documentElement)) {
      if (elemento.id === id) return elemento;
    }
    return null;
  }
}

module.exports = { ComOuvintes, DocumentoFalso, ElementoFalso, NoDeTexto };
