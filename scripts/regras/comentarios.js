'use strict';

const ASPAS = new Set(['"', "'"]);
const passoNaString = (texto, j) => (texto[j] === '\\' ? 2 : 1);
const fecha = (texto, j, aspa) => texto[j] === aspa || texto[j] === '\n';
const depoisDe = (separador, fonte, i) => i === 0 || separador.test(fonte[i - 1]);

function fimDaLinha(fonte, i) {
  const fim = fonte.indexOf('\n', i);
  return fim < 0 ? fonte.length : fim;
}

function fimDoFechamento(fonte, i, fechamento) {
  const fim = fonte.indexOf(fechamento, i);
  return fim < 0 ? fonte.length : fim + fechamento.length;
}

function fimDaString(texto, i) {
  const aspa = texto[i];
  let j = i + 1;
  while (j < texto.length && !fecha(texto, j, aspa)) j += passoNaString(texto, j);
  return Math.min(j, texto.length - 1);
}

const ANTES_DE_REGEX = '(,=:[!&|?{};+-*%<>~^';
const INCREMENTO_ANTES = /(?:\+\+|--)\s*$/;
const PALAVRA_ANTES_DE_REGEX = /(?<![\w$.])(?:return|typeof|case|in|of|void|delete|throw|else|do|yield|await)\s*$/;

function fimDoRegex(fonte, inicio) {
  let j = inicio + 1;
  let naClasse = false;
  while (j < fonte.length && fonte[j] !== '\n') {
    if (fonte[j] === '\\') {
      j += 2;
      continue;
    }
    if (fonte[j] === '[') naClasse = true;
    else if (fonte[j] === ']') naClasse = false;
    else if (fonte[j] === '/' && !naClasse) break;
    j++;
  }
  return j;
}

const noInicioDaLinha = (fonte, i) => /^[ \t]*$/.test(fonte.slice(fonte.lastIndexOf('\n', i - 1) + 1, i));

function abreComentarioDeLinhaJs(fonte, i) {
  if (fonte.startsWith('//', i) || fonte.startsWith('<!--', i)) return true;
  if (fonte.startsWith('-->', i)) return noInicioDaLinha(fonte, i);
  return i === 0 && fonte.startsWith('#!');
}

function fimDoComentarioJs(fonte, i) {
  if (abreComentarioDeLinhaJs(fonte, i)) return fimDaLinha(fonte, i);
  if (fonte.startsWith('/*', i)) return fimDoFechamento(fonte, i + 2, '*/');
  return null;
}

class LeitorJs {
  constructor(fonte) {
    this.fonte = fonte;
    this.comentarios = [];
    this.textos = [];
    this.inicioDoModelo = -1;
    this.profundidades = [];
    this.emModelo = false;
    this.anterior = '';
    this.cauda = '';
    this.i = 0;
  }

  ler() {
    while (this.i < this.fonte.length) {
      if (this.emModelo) this.passoNoModelo();
      else this.passoNoCodigo();
    }
    return { comentarios: this.comentarios, textos: this.textos };
  }

  passoNoModelo() {
    const c = this.fonte[this.i];
    if (c === '\\') this.i += 2;
    else if (c === '`') this.fecharModelo('`', 1);
    else if (this.fonte.startsWith('${', this.i)) {
      this.fecharModelo('{', 2);
      this.profundidades.push(0);
    } else this.i++;
  }

  fecharModelo(anterior, avanco) {
    this.textos.push([this.inicioDoModelo, this.i]);
    this.emModelo = false;
    this.anterior = anterior;
    this.i += avanco;
  }

  abrirModelo() {
    this.emModelo = true;
    this.inicioDoModelo = this.i + 1;
    this.i++;
  }

  passoNoCodigo() {
    const c = this.fonte[this.i];
    if (this.lerComentario()) return;
    if (ASPAS.has(c)) this.lerString(c);
    else if (c === '`') this.abrirModelo();
    else if (c === '/' && this.comecaRegex()) this.lerRegex();
    else if (!this.fecharInterpolacao(c)) this.seguir(c);
  }

  lerComentario() {
    const fim = fimDoComentarioJs(this.fonte, this.i);
    if (fim === null) return false;
    this.comentarios.push([this.i, fim]);
    this.i = fim;
    return true;
  }

  lerString(aspa) {
    const fim = fimDaString(this.fonte, this.i);
    this.textos.push([this.i + 1, fim]);
    this.i = fim + 1;
    this.anterior = aspa;
  }

  comecaRegex() {
    if (INCREMENTO_ANTES.test(this.cauda)) return false;
    return ANTES_DE_REGEX.includes(this.anterior) || PALAVRA_ANTES_DE_REGEX.test(this.cauda);
  }

  lerRegex() {
    this.i = fimDoRegex(this.fonte, this.i) + 1;
    this.anterior = ')';
  }

  fecharInterpolacao(c) {
    const topo = this.profundidades.length - 1;
    if (topo < 0) return false;
    if (c === '{') this.profundidades[topo]++;
    if (c !== '}') return false;
    if (this.profundidades[topo] > 0) {
      this.profundidades[topo]--;
      return false;
    }
    this.profundidades.pop();
    this.abrirModelo();
    return true;
  }

  seguir(c) {
    if (!/\s/.test(c)) this.anterior = c;
    this.cauda = (this.cauda + c).slice(-16);
    this.i++;
  }
}

const analisarJs = fonte => new LeitorJs(fonte).ler();
const comentariosJs = fonte => analisarJs(fonte).comentarios;

function comentariosCss(fonte) {
  const comentarios = [];
  let i = 0;
  while (i < fonte.length) {
    if (fonte.startsWith('/*', i)) {
      const ate = fimDoFechamento(fonte, i + 2, '*/');
      comentarios.push([i, ate]);
      i = ate;
    } else if (ASPAS.has(fonte[i])) i = fimDaString(fonte, i) + 1;
    else i++;
  }
  return comentarios;
}

const mover = (trechos, deslocamento) => trechos.map(([de, ate]) => [de + deslocamento, ate + deslocamento]);
const TIPOS_DE_SCRIPT_JS = /^(?:|module|text\/javascript|application\/javascript|text\/babel)$/i;
const BLOCOS_COM_CODIGO = new Set(['style', 'script']);

function depoisDoAtributo(fonte, j) {
  if (!ASPAS.has(fonte[j])) return j + 1;
  const aspa = fonte.indexOf(fonte[j], j + 1);
  return aspa < 0 ? fonte.length : aspa + 1;
}

function fimDaAbertura(fonte, inicio) {
  let j = inicio;
  while (j < fonte.length && fonte[j] !== '>') j = depoisDoAtributo(fonte, j);
  return j;
}

function ehScriptJs(abertura) {
  const tipo = /\btype\s*=\s*["']?([^"'\s>]*)/i.exec(abertura);
  return TIPOS_DE_SCRIPT_JS.test(tipo ? tipo[1] : '');
}

function comentariosDoMiolo(nome, abertura, miolo) {
  if (nome === 'style') return comentariosCss(miolo);
  return ehScriptJs(abertura) ? comentariosJs(miolo) : [];
}

function lerTagHtml(fonte, i, comentarios) {
  const tag = fonte[i] === '<' && /^<([a-zA-Z][\w-]*)/.exec(fonte.slice(i, i + 40));
  if (!tag) return i + 1;
  const j = fimDaAbertura(fonte, i + tag[0].length);
  const nome = tag[1].toLowerCase();
  if (!BLOCOS_COM_CODIGO.has(nome)) return j + 1;
  const inicio = j + 1;
  const fechamento = fonte.slice(inicio).search(new RegExp(`</${nome}\\s*>`, 'i'));
  const ate = fechamento < 0 ? fonte.length : inicio + fechamento;
  comentarios.push(...mover(comentariosDoMiolo(nome, fonte.slice(i, j), fonte.slice(inicio, ate)), inicio));
  return ate;
}

function comentariosHtml(fonte) {
  const comentarios = [];
  let i = 0;
  while (i < fonte.length) {
    if (fonte.startsWith('<!--', i)) {
      const ate = fimDoFechamento(fonte, i + 4, '-->');
      comentarios.push([i, ate]);
      i = ate;
    } else i = lerTagHtml(fonte, i, comentarios);
  }
  return comentarios;
}

function depoisDaStringPy(fonte, i) {
  const tripla = fonte[i].repeat(3);
  if (!fonte.startsWith(tripla, i)) return fimDaString(fonte, i) + 1;
  let j = i + 3;
  while (j < fonte.length && !fonte.startsWith(tripla, j)) j += passoNaString(fonte, j);
  return Math.min(j + 3, fonte.length);
}

function comentariosPy(fonte) {
  const comentarios = [];
  let i = 0;
  while (i < fonte.length) {
    if (fonte[i] === '#') {
      const ate = fimDaLinha(fonte, i);
      comentarios.push([i, ate]);
      i = ate;
    } else if (ASPAS.has(fonte[i])) i = depoisDaStringPy(fonte, i);
    else i++;
  }
  return comentarios;
}

function depoisDosHeredocs(fonte, inicio, delimitadores) {
  let i = inicio;
  for (const delimitador of delimitadores) {
    while (i < fonte.length) {
      const fim = fonte.indexOf('\n', i);
      const linha = fonte.slice(i, fim < 0 ? fonte.length : fim);
      i = fim < 0 ? fonte.length : fim + 1;
      if (linha.replace(/^\t+/, '') === delimitador) break;
    }
  }
  return i;
}

const SEPARADOR_SH = /[\s;&|()]/;
const ABERTURA_DE_HEREDOC = /^<<-?\s*(?:'([^']+)'|"([^"]+)"|\\?([A-Za-z_]\w*))/;

function naAritmetica(fonte, i) {
  const linhaAteAqui = fonte.slice(fonte.lastIndexOf('\n', i) + 1, i);
  return linhaAteAqui.lastIndexOf('((') > linhaAteAqui.lastIndexOf('))');
}

const TRATADOR_NO_CODIGO_SH = new Map([
  ['\\', 'pularEscape'], ["'", 'abrirSimples'], ['"', 'abrirDupla'], ['$', 'lerCifrao'], ['`', 'lerCrase'],
  ['(', 'abrirParentese'], [')', 'fecharParentese'], ['#', 'lerComentario'], ['<', 'lerRedirecionamento'], ['\n', 'lerFimDeLinha'],
]);

class LeitorSh {
  constructor(fonte) {
    this.fonte = fonte;
    this.comentarios = [];
    this.delimitadores = [];
    this.pilha = [{ tipo: 'normal' }];
    this.i = 0;
  }

  get topo() {
    return this.pilha[this.pilha.length - 1];
  }

  ler() {
    while (this.i < this.fonte.length) this.passo(this.fonte[this.i]);
    return this.comentarios;
  }

  passo(c) {
    const { tipo } = this.topo;
    if (tipo === 'simples') this.passoNaSimples(c);
    else if (tipo === 'ansi') this.passoNaAnsi(c);
    else if (tipo === 'dupla') this.passoNaDupla(c);
    else this.passoNoCodigo(c);
  }

  entrar(tipo, avanco) {
    this.pilha.push(tipo);
    this.i += avanco;
  }

  sair() {
    this.pilha.pop();
    this.i++;
  }

  passoNaSimples(c) {
    if (c === "'") this.pilha.pop();
    this.i++;
  }

  passoNaAnsi(c) {
    if (c === '\\') this.i++;
    else if (c === "'") this.pilha.pop();
    this.i++;
  }

  passoNaDupla(c) {
    if (c === '\\') this.i += 2;
    else if (c === '"') this.sair();
    else if (c === '`') this.lerCrase();
    else if (!this.abrirSubcomando()) this.i++;
  }

  passoNoCodigo(c) {
    const tratador = TRATADOR_NO_CODIGO_SH.get(c);
    if (!tratador || !this[tratador]()) this.i++;
  }

  pularEscape() {
    this.i += 2;
    return true;
  }

  abrirSimples() {
    this.entrar({ tipo: 'simples' }, 1);
    return true;
  }

  abrirDupla() {
    this.entrar({ tipo: 'dupla' }, 1);
    return true;
  }

  abrirSubcomando() {
    if (!this.fonte.startsWith('$(', this.i)) return false;
    this.entrar({ tipo: 'comando', fundo: 0 }, 2);
    return true;
  }

  lerCifrao() {
    if (!this.fonte.startsWith("$'", this.i)) return this.abrirSubcomando();
    this.entrar({ tipo: 'ansi' }, 2);
    return true;
  }

  lerCrase() {
    if (this.topo.tipo === 'crase') this.sair();
    else this.entrar({ tipo: 'crase' }, 1);
    return true;
  }

  abrirParentese() {
    if (this.topo.tipo !== 'comando') return false;
    this.topo.fundo++;
    this.i++;
    return true;
  }

  fecharParentese() {
    if (this.topo.tipo !== 'comando') return false;
    if (this.topo.fundo === 0) this.pilha.pop();
    else this.topo.fundo--;
    this.i++;
    return true;
  }

  lerComentario() {
    if (!depoisDe(SEPARADOR_SH, this.fonte, this.i)) return false;
    const ate = fimDaLinha(this.fonte, this.i);
    this.comentarios.push([this.i, ate]);
    this.i = ate;
    return true;
  }

  lerRedirecionamento() {
    if (this.fonte.startsWith('<<<', this.i)) this.i += 3;
    else if (this.fonte.startsWith('<<', this.i)) this.lerHeredoc();
    else return false;
    return true;
  }

  lerHeredoc() {
    const m = ABERTURA_DE_HEREDOC.exec(this.fonte.slice(this.i, this.i + 120));
    if (m && !naAritmetica(this.fonte, this.i)) this.delimitadores.push(m[1] || m[2] || m[3]);
    this.i += m ? m[0].length : 2;
  }

  lerFimDeLinha() {
    if (!this.delimitadores.length) return false;
    this.i = depoisDosHeredocs(this.fonte, this.i + 1, this.delimitadores.splice(0));
    return true;
  }
}

const comentariosSh = fonte => new LeitorSh(fonte).ler();

function comentariosHash(fonte) {
  const comentarios = [];
  let i = 0;
  while (i < fonte.length) {
    const c = fonte[i];
    if (c === '#' && depoisDe(/\s/, fonte, i)) {
      const ate = fimDaLinha(fonte, i);
      comentarios.push([i, ate]);
      i = ate;
    } else if (ASPAS.has(c)) i = fimDaString(fonte, i) + 1;
    else i++;
  }
  return comentarios;
}

function comentariosBat(fonte) {
  const inicio = /(?:^|[&|])[ \t]*@?(?:rem(?=[ \t]|$)|::)/gim;
  return [...fonte.matchAll(inicio)].map(m => [m.index, fimDaLinha(fonte, m.index)]);
}

const LEITORES = [
  { extensao: /\.(?:js|mjs|cjs|jsx|ts|tsx|c|cc|cpp|h|hpp|m|mm|x|swift|java|kt|go|rs)$/, shebang: 'js', ler: comentariosJs },
  { extensao: /\.css$/, ler: comentariosCss },
  { extensao: /\.py$/, shebang: 'py', ler: comentariosPy },
  { extensao: /\.(?:html|plist|xml)$/, ler: comentariosHtml },
  { extensao: /\.(?:sh|bash|zsh|command)$/, shebang: 'sh', ler: comentariosSh },
  { extensao: /\.(?:yml|yaml|toml|rb)$|(?:^|\/)(?:Makefile|GNUmakefile|Dockerfile)$/, ler: comentariosHash },
  { extensao: /\.(?:cmd|bat)$/i, ler: comentariosBat },
];

const SHEBANGS = [[/\bpython/, 'py'], [/\b(?:node|deno|bun)\b/, 'js'], [/\b(?:ba|z|da|k)?sh\b/, 'sh']];

function linguagemDoShebang(fonte) {
  const primeira = fonte.slice(0, fimDaLinha(fonte, 0));
  if (!primeira.startsWith('#!')) return null;
  const achado = SHEBANGS.find(([padrao]) => padrao.test(primeira));
  return achado ? achado[1] : null;
}

function trechosDeComentario(arquivo, fonte) {
  const linguagem = /\.[A-Za-z0-9]+$/.test(arquivo) ? null : linguagemDoShebang(fonte);
  const leitor = LEITORES.find(({ extensao, shebang }) => extensao.test(arquivo) || shebang === linguagem);
  return leitor ? leitor.ler(fonte) : [];
}

function indiceDeLinhas(fonte) {
  const inicios = [0];
  for (let i = 0; i < fonte.length; i++) if (fonte[i] === '\n') inicios.push(i + 1);
  return inicios;
}

function linhaDoIndice(inicios, indice) {
  let baixo = 0;
  let alto = inicios.length - 1;
  while (baixo < alto) {
    const meio = Math.ceil((baixo + alto) / 2);
    if (inicios[meio] <= indice) baixo = meio;
    else alto = meio - 1;
  }
  return baixo + 1;
}

const COMECO = /^\s*(?:\/\/+|\/\*+|<!--|#+)\s*/;
const FIM = /\s*(?:\*\/|-->)\s*$/;

function linhasDeComentario(arquivo, fonte) {
  const inicios = indiceDeLinhas(fonte);
  const saida = [];
  for (const [de, ate] of trechosDeComentario(arquivo, fonte).sort((a, b) => a[0] - b[0])) {
    const primeira = linhaDoIndice(inicios, de);
    const partes = fonte.slice(de, ate).split('\n');
    partes.forEach((texto, k) => {
      const semInicio = k === 0 ? texto.replace(COMECO, '') : texto.replace(/^\s*\*+(?!\/)\s?/, '');
      const corpo = (k === partes.length - 1 ? semInicio.replace(FIM, '') : semInicio).trim();
      saida.push({ linha: primeira + k, corpo, bruto: texto });
    });
  }
  return saida;
}

module.exports = { analisarJs, comentariosCss, comentariosHash, comentariosHtml, comentariosJs, comentariosPy, comentariosSh, linhaDoIndice, indiceDeLinhas, linhasDeComentario, trechosDeComentario };
