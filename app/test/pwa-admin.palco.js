'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PASTA_DA_PAGINA = path.join(__dirname, '..', 'electron', 'pwa');
const CAMINHO_DA_PAGINA = path.join(PASTA_DA_PAGINA, 'admin.html');
const SCRIPT = /<script([^>]*)>([\s\S]*?)<\/script>/g;
const IDENTIFICADOR = /\sid="([^"]+)"/g;
const VALORES_INICIAIS = { 'gen-plan': { value: 'pro' }, 'gen-qty': { value: '1' } };

const comFimDeLinhaLf = texto => texto.replace(/\r\n/g, '\n');

function formatar(valor) {
  if (Object.prototype.toString.call(valor) === '[object Error]') return `${valor.name}: ${valor.message}`;
  if (typeof valor === 'function') return '[função]';
  if (typeof valor === 'string') return valor;
  return JSON.stringify(valor);
}

function scriptsDaPagina() {
  const html = comFimDeLinhaLf(fs.readFileSync(CAMINHO_DA_PAGINA, 'utf8'));
  return [...html.matchAll(SCRIPT)].flatMap(([, atributos, corpo]) => {
    const origem = /src="([^"]+)"/.exec(atributos);
    if (!origem) return [{ nome: 'admin.html', codigo: corpo }];
    if (/^https?:/.test(origem[1])) return [];
    return [{ nome: origem[1], codigo: comFimDeLinhaLf(fs.readFileSync(path.join(PASTA_DA_PAGINA, origem[1]), 'utf8')) }];
  });
}

function identificadoresDaPagina() {
  const html = fs.readFileSync(CAMINHO_DA_PAGINA, 'utf8');
  return [...html.matchAll(IDENTIFICADOR)].map(([, id]) => id);
}

class ElementoDoPalco {
  constructor(palco, nome, inicial) {
    this.palco = palco;
    this.nome = nome;
    this.estado = { value: '', ...inicial };
    this.ouvintes = {};
    this.style = new Proxy({}, { set: (alvo, prop, valor) => { palco.anotar(`${nome}.style.${prop} =`, valor); alvo[prop] = valor; return true; } });
    this.classList = { add: classe => palco.anotar(`${nome}.classList.add`, classe), remove: classe => palco.anotar(`${nome}.classList.remove`, classe) };
  }

  addEventListener(tipo, ouvinte) {
    this.palco.anotar(`${this.nome}.on`, tipo);
    this.ouvintes[tipo] = [...(this.ouvintes[tipo] || []), ouvinte];
  }

  appendChild(filho) {
    this.palco.anotar(`${this.nome}.appendChild`, filho.nome, filho.estado.className, filho.estado.innerHTML);
  }
}

const PROPRIAS = new Set(['addEventListener', 'appendChild', 'style', 'classList', 'nome', 'estado', 'ouvintes']);

function criarElemento(palco, nome, inicial = {}) {
  const elemento = new ElementoDoPalco(palco, nome, inicial);
  return new Proxy(elemento, {
    get: (alvo, prop) => {
      if (!PROPRIAS.has(prop)) return alvo.estado[prop];
      return typeof alvo[prop] === 'function' ? alvo[prop].bind(alvo) : alvo[prop];
    },
    set: (alvo, prop, valor) => { palco.anotar(`${nome}.${String(prop)} =`, valor); alvo.estado[prop] = valor; return true; },
  });
}

class ArmazenamentoDoPalco {
  constructor(palco, nome, inicial = {}) {
    this.palco = palco;
    this.nome = nome;
    this.itens = new Map(Object.entries(inicial));
  }

  getItem(chave) { return this.itens.has(chave) ? this.itens.get(chave) : null; }

  setItem(chave, valor) { this.palco.anotar(`${this.nome}.setItem`, chave, valor); this.itens.set(chave, String(valor)); }

  removeItem(chave) { this.palco.anotar(`${this.nome}.removeItem`, chave); this.itens.delete(chave); }
}

class DocumentoDoBanco {
  constructor(palco, caminho, id) {
    this.palco = palco;
    this.caminho = caminho;
    this.id = id;
  }

  async operar(operacao, dados) {
    this.palco.anotar(`firestore ${this.caminho}/${this.id}.${operacao}`, dados);
    if (this.palco.cena.falhaNoBanco) throw new Error(this.palco.cena.falhaNoBanco);
  }

  update(dados) { return this.operar('update', dados); }

  set(dados) { return this.operar('set', dados); }

  delete() { return this.operar('delete'); }
}

class ConsultaDoBanco {
  constructor(palco, colecao) {
    this.palco = palco;
    this.colecao = colecao;
  }

  orderBy(campo, sentido) { this.palco.anotar(`firestore ${this.colecao}.orderBy`, campo, sentido); return this; }

  limit(quantos) { this.palco.anotar(`firestore ${this.colecao}.limit`, quantos); return this; }

  doc(id) { return new DocumentoDoBanco(this.palco, this.colecao, id); }

  async get() {
    this.palco.anotar(`firestore ${this.colecao}.get`);
    if (this.palco.cena.falhaNaConsulta) throw new Error(this.palco.cena.falhaNaConsulta);
    return this.palco.instantaneo(this.palco.cena.licencas || []);
  }

  onSnapshot(aoReceber, aoFalhar) {
    this.palco.anotar(`firestore ${this.colecao}.onSnapshot`);
    this.palco.escuta = { aoReceber, aoFalhar };
    return () => this.palco.anotar('firestore escuta encerrada');
  }
}

class Palco {
  constructor(cena) {
    this.cena = cena;
    this.diario = [];
    this.porNome = new Map();
    this.criados = 0;
    this.aoCarregar = [];
    this.elementos = new Map(identificadoresDaPagina().filter(id => !(cena.sem || []).includes(id)).map(id => [id, criarElemento(this, id, VALORES_INICIAIS[id])]));
    this.cartao = criarElemento(this, 'admin-card');
    this.sessionStorage = new ArmazenamentoDoPalco(this, 'sessionStorage', cena.sessao);
    this.localStorage = new ArmazenamentoDoPalco(this, 'localStorage', cena.armazenado);
    this.sorteios = 0;
  }

  anotar(...partes) { this.diario.push(partes.map(formatar).join(' ')); }

  async esperar() {
    for (let volta = 0; volta < 10; volta++) await new Promise(pronto => setImmediate(pronto));
  }

  instantaneo(itens) {
    const documentos = itens.map(({ id, dados }) => ({ id, data: () => dados }));
    return { empty: documentos.length === 0, size: documentos.length, forEach: funcao => documentos.forEach(funcao) };
  }

  documento() {
    return {
      getElementById: id => this.elementos.get(id) || null,
      querySelector: seletor => (seletor === '.admin-card' ? this.cartao : null),
      createElement: tag => criarElemento(this, `novo-${tag}-${++this.criados}`),
    };
  }

  async buscar(url, opcoes = {}) {
    this.anotar('fetch', opcoes.method || 'GET', url, opcoes.headers, opcoes.body);
    const resposta = (this.cena.respostas || {})[url];
    if (!resposta) throw new Error('rede indisponível');
    if (resposta.falha) throw new Error(resposta.falha);
    return { ok: resposta.ok !== false, json: async () => resposta.corpo };
  }

  firebase() {
    const palco = this;
    const banco = { collection: nome => new ConsultaDoBanco(palco, nome) };
    const firestore = () => banco;
    firestore.FieldValue = { serverTimestamp: () => 'SERVIDOR-AGORA' };
    return {
      apps: [],
      initializeApp(configuracao) {
        palco.anotar('firebase.initializeApp', configuracao);
        if (palco.cena.falhaNaInicializacao) throw new Error(palco.cena.falhaNaInicializacao);
        this.apps.push(configuracao);
      },
      firestore,
    };
  }

  janela() {
    return {
      addEventListener: (tipo, ouvinte) => { this.anotar('window.on', tipo); this.aoCarregar.push(ouvinte); },
      location: { reload: () => this.anotar('location.reload()') },
    };
  }

  navegador() {
    return {
      clipboard: {
        writeText: async (texto) => {
          this.anotar('clipboard.writeText', texto);
          if (this.cena.areaDeTransferenciaNegada) throw new Error('negado');
        },
      },
    };
  }

  contexto() {
    const registrar = rotulo => (...partes) => this.anotar(rotulo, ...partes);
    const respostas = [...(this.cena.digitado || [])];
    const contexto = {
      console: { log: registrar('console.log'), error: registrar('console.error') },
      document: this.documento(),
      navigator: this.navegador(),
      localStorage: this.localStorage,
      sessionStorage: this.sessionStorage,
      firebase: this.firebase(),
      fetch: (url, opcoes) => this.buscar(url, opcoes),
      alert: registrar('alert'),
      confirm: (pergunta) => { this.anotar('confirm', pergunta); return this.cena.confirma !== false; },
      prompt: (pergunta, padrao) => { this.anotar('prompt', pergunta, padrao); return respostas.length ? respostas.shift() : null; },
      window: this.janela(),
    };
    return contexto;
  }
}

function sortear(contexto, palco) {
  const { Math: matematica, Date: data } = vm.runInContext('({ Math, Date })', contexto);
  matematica.random = () => { palco.sorteios += 1; return ((palco.sorteios * 37) % 100) / 100; };
  data.prototype.toLocaleDateString = function () { return `data:${this.toISOString().slice(0, 10)}`; };
  data.prototype.toLocaleString = function () { return `data-hora:${this.toISOString().slice(0, 19)}`; };
}

async function encenar(cena) {
  const palco = new Palco(cena);
  const contexto = vm.createContext(palco.contexto());
  sortear(contexto, palco);
  for (const { nome, codigo } of scriptsDaPagina()) vm.runInContext(codigo, contexto, { filename: nome });
  palco.chamar = (expressao) => vm.runInContext(expressao, contexto);
  palco.disparar = (id, tipo, evento = {}) => (palco.elementos.get(id).ouvintes[tipo] || []).forEach(ouvinte => ouvinte(evento));
  palco.preencher = (id, valores) => Object.assign(palco.elementos.get(id).estado, valores);
  palco.carregar = async () => { for (const ouvinte of palco.aoCarregar) ouvinte(); await palco.esperar(); };
  await cena.acao(palco);
  await palco.esperar();
  return palco.diario;
}

module.exports = { encenar, scriptsDaPagina };
