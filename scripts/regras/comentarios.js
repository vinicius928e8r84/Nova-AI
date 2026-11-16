'use strict';

const fimDaString = (texto, i) => {
  const aspa = texto[i];
  let j = i + 1;
  while (j < texto.length && texto[j] !== aspa && texto[j] !== '\n') j += texto[j] === '\\' ? 2 : 1;
  return Math.min(j, texto.length - 1);
};

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

function analisarJs(fonte) {
  const comentarios = [];
  const textos = [];
  let inicioDoModelo = -1;
  const profundidades = [];
  let emModelo = false;
  let anterior = '';
  let cauda = '';
  let i = 0;
  const seguir = ate => {
    cauda = (cauda + fonte.slice(i, ate)).slice(-16);
    i = ate;
  };
  while (i < fonte.length) {
    const c = fonte[i];
    const d = fonte[i + 1];
    if (emModelo) {
      if (c === '\\') i += 2;
      else if (c === '`') {
        textos.push([inicioDoModelo, i]);
        emModelo = false;
        anterior = '`';
        i++;
      } else if (c === '$' && d === '{') {
        textos.push([inicioDoModelo, i]);
        profundidades.push(0);
        emModelo = false;
        anterior = '{';
        i += 2;
      } else i++;
      continue;
    }
    if (c === '/' && d === '/') {
      const fim = fonte.indexOf('\n', i);
      const ate = fim < 0 ? fonte.length : fim;
      comentarios.push([i, ate]);
      i = ate;
      continue;
    }
    if (c === '/' && d === '*') {
      const fim = fonte.indexOf('*/', i + 2);
      const ate = fim < 0 ? fonte.length : fim + 2;
      comentarios.push([i, ate]);
      i = ate;
      continue;
    }
    if (c === '"' || c === "'") {
      const fim = fimDaString(fonte, i);
      textos.push([i + 1, fim]);
      i = fim + 1;
      anterior = c;
      continue;
    }
    if (c === '`') {
      emModelo = true;
      inicioDoModelo = i + 1;
      i++;
      continue;
    }
    if (c === '/' && (anterior === '' || ANTES_DE_REGEX.includes(anterior) || PALAVRA_ANTES_DE_REGEX.test(cauda)) && !INCREMENTO_ANTES.test(cauda)) {
      i = fimDoRegex(fonte, i) + 1;
      anterior = ')';
      continue;
    }
    if (c === '{' && profundidades.length) profundidades[profundidades.length - 1]++;
    if (c === '}' && profundidades.length) {
      if (profundidades[profundidades.length - 1] === 0) {
        profundidades.pop();
        emModelo = true;
        inicioDoModelo = i + 1;
        i++;
        continue;
      }
      profundidades[profundidades.length - 1]--;
    }
    if (!/\s/.test(c)) anterior = c;
    seguir(i + 1);
  }
  return { comentarios, textos };
}

const comentariosJs = fonte => analisarJs(fonte).comentarios;

function comentariosCss(fonte) {
  const comentarios = [];
  let i = 0;
  while (i < fonte.length) {
    const c = fonte[i];
    if (c === '/' && fonte[i + 1] === '*') {
      const fim = fonte.indexOf('*/', i + 2);
      const ate = fim < 0 ? fonte.length : fim + 2;
      comentarios.push([i, ate]);
      i = ate;
    } else if (c === '"' || c === "'") i = fimDaString(fonte, i) + 1;
    else i++;
  }
  return comentarios;
}

const mover = (trechos, deslocamento) => trechos.map(([de, ate]) => [de + deslocamento, ate + deslocamento]);
const TIPOS_DE_SCRIPT_JS = /^(?:|module|text\/javascript|application\/javascript|text\/babel)$/i;

function comentariosHtml(fonte) {
  const comentarios = [];
  let i = 0;
  while (i < fonte.length) {
    if (fonte.startsWith('<!--', i)) {
      const fim = fonte.indexOf('-->', i + 4);
      const ate = fim < 0 ? fonte.length : fim + 3;
      comentarios.push([i, ate]);
      i = ate;
      continue;
    }
    const tag = fonte[i] === '<' && /^<([a-zA-Z][\w-]*)/.exec(fonte.slice(i, i + 40));
    if (!tag) {
      i++;
      continue;
    }
    let j = i + tag[0].length;
    while (j < fonte.length && fonte[j] !== '>') {
      const aspa = fonte[j] === '"' || fonte[j] === "'" ? fonte.indexOf(fonte[j], j + 1) : -2;
      j = aspa === -1 ? fonte.length : aspa === -2 ? j + 1 : aspa + 1;
    }
    const abertura = fonte.slice(i, j);
    i = j + 1;
    const nome = tag[1].toLowerCase();
    if (nome !== 'style' && nome !== 'script') continue;
    const fecha = fonte.slice(i).search(new RegExp(`</${nome}\\s*>`, 'i'));
    const ate = fecha < 0 ? fonte.length : i + fecha;
    const miolo = fonte.slice(i, ate);
    if (nome === 'style') comentarios.push(...mover(comentariosCss(miolo), i));
    else {
      const tipo = /\btype\s*=\s*["']?([^"'\s>]*)/i.exec(abertura);
      if (TIPOS_DE_SCRIPT_JS.test(tipo ? tipo[1] : '')) comentarios.push(...mover(comentariosJs(miolo), i));
    }
    i = ate;
  }
  return comentarios;
}

function comentariosPy(fonte) {
  const comentarios = [];
  let i = 0;
  while (i < fonte.length) {
    const c = fonte[i];
    if (c === '#') {
      const fim = fonte.indexOf('\n', i);
      const ate = fim < 0 ? fonte.length : fim;
      comentarios.push([i, ate]);
      i = ate;
    } else if (c === '"' || c === "'") {
      if (fonte.startsWith(c.repeat(3), i)) {
        let j = i + 3;
        while (j < fonte.length && !fonte.startsWith(c.repeat(3), j)) j += fonte[j] === '\\' ? 2 : 1;
        i = Math.min(j + 3, fonte.length);
      } else {
        let j = i + 1;
        while (j < fonte.length && fonte[j] !== c && fonte[j] !== '\n') j += fonte[j] === '\\' ? 2 : 1;
        i = j + 1;
      }
    } else i++;
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

function comentariosSh(fonte) {
  const comentarios = [];
  const delimitadores = [];
  const pilha = [{ tipo: 'normal' }];
  const comecaPalavra = j => j === 0 || /[\s;&|()]/.test(fonte[j - 1]);
  let i = 0;
  while (i < fonte.length) {
    const c = fonte[i];
    const topo = pilha[pilha.length - 1];
    if (topo.tipo === 'simples') {
      if (c === "'") pilha.pop();
      i++;
    } else if (topo.tipo === 'ansi') {
      if (c === '\\') i++;
      else if (c === "'") pilha.pop();
      i++;
    } else if (topo.tipo === 'dupla') {
      if (c === '\\') i += 2;
      else if (c === '"') {
        pilha.pop();
        i++;
      } else if (c === '$' && fonte[i + 1] === '(') {
        pilha.push({ tipo: 'comando', fundo: 0 });
        i += 2;
      } else if (c === '`') {
        pilha.push({ tipo: 'crase' });
        i++;
      } else i++;
    } else if (c === '\\') {
      i += 2;
    } else if (c === "'" || c === '"') {
      pilha.push({ tipo: c === "'" ? 'simples' : 'dupla' });
      i++;
    } else if (c === '$' && fonte[i + 1] === "'") {
      pilha.push({ tipo: 'ansi' });
      i += 2;
    } else if (c === '$' && fonte[i + 1] === '(') {
      pilha.push({ tipo: 'comando', fundo: 0 });
      i += 2;
    } else if (c === '`') {
      if (topo.tipo === 'crase') pilha.pop();
      else pilha.push({ tipo: 'crase' });
      i++;
    } else if (topo.tipo === 'comando' && c === '(') {
      topo.fundo++;
      i++;
    } else if (topo.tipo === 'comando' && c === ')') {
      if (topo.fundo === 0) pilha.pop();
      else topo.fundo--;
      i++;
    } else if (c === '#' && comecaPalavra(i)) {
      const fim = fonte.indexOf('\n', i);
      const ate = fim < 0 ? fonte.length : fim;
      comentarios.push([i, ate]);
      i = ate;
    } else if (c === '<' && fonte[i + 1] === '<' && fonte[i + 2] === '<') {
      i += 3;
    } else if (c === '<' && fonte[i + 1] === '<') {
      const m = /^<<-?\s*(?:'([^']+)'|"([^"]+)"|\\?([A-Za-z_]\w*))/.exec(fonte.slice(i, i + 120));
      const linhaAteAqui = fonte.slice(fonte.lastIndexOf('\n', i) + 1, i);
      const naAritmetica = linhaAteAqui.lastIndexOf('((') > linhaAteAqui.lastIndexOf('))');
      if (m && !naAritmetica) delimitadores.push(m[1] || m[2] || m[3]);
      i += m ? m[0].length : 2;
    } else if (c === '\n' && delimitadores.length) {
      i = depoisDosHeredocs(fonte, i + 1, delimitadores.splice(0));
    } else {
      i++;
    }
  }
  return comentarios;
}

function comentariosHash(fonte) {
  const comentarios = [];
  let i = 0;
  while (i < fonte.length) {
    const c = fonte[i];
    if (c === '#' && (i === 0 || /\s/.test(fonte[i - 1]))) {
      const fim = fonte.indexOf('\n', i);
      const ate = fim < 0 ? fonte.length : fim;
      comentarios.push([i, ate]);
      i = ate;
    } else if (c === '"' || c === "'") i = fimDaString(fonte, i) + 1;
    else i++;
  }
  return comentarios;
}

function comentariosBat(fonte) {
  const comentarios = [];
  const inicio = /^[ \t]*(?:rem(?=[ \t]|$)|::)/gim;
  for (const m of fonte.matchAll(inicio)) {
    const de = m.index;
    const fim = fonte.indexOf('\n', de);
    comentarios.push([de, fim < 0 ? fonte.length : fim]);
  }
  return comentarios;
}

const COM_BARRAS = /\.(?:js|mjs|cjs|jsx|ts|tsx|c|cc|cpp|h|hpp|m|mm|x|swift|java|kt|go|rs)$/;
const BAT = /\.(?:cmd|bat)$/i;
const COM_HASH_POR_NOME = /(?:^|\/)(?:Makefile|GNUmakefile|Dockerfile)$/;
const COM_HASH = /\.(?:yml|yaml|toml|rb)$/;
const COM_TAGS = /\.(?:html|plist|xml)$/;
const SHELL = /\.(?:sh|bash|zsh|command)$/;

function linguagemDoShebang(fonte) {
  const primeira = fonte.slice(0, fonte.indexOf('\n') < 0 ? fonte.length : fonte.indexOf('\n'));
  if (!primeira.startsWith('#!')) return null;
  if (/\bpython/.test(primeira)) return 'py';
  if (/\b(?:node|deno|bun)\b/.test(primeira)) return 'js';
  if (/\b(?:ba|z|da|k)?sh\b/.test(primeira)) return 'sh';
  return null;
}

function trechosDeComentario(arquivo, fonte) {
  const semExtensao = !/\.[A-Za-z0-9]+$/.test(arquivo);
  const linguagem = semExtensao ? linguagemDoShebang(fonte) : null;
  if (COM_BARRAS.test(arquivo) || linguagem === 'js') return comentariosJs(fonte);
  if (arquivo.endsWith('.css')) return comentariosCss(fonte);
  if (arquivo.endsWith('.py') || linguagem === 'py') return comentariosPy(fonte);
  if (COM_TAGS.test(arquivo)) return comentariosHtml(fonte);
  if (SHELL.test(arquivo) || linguagem === 'sh') return comentariosSh(fonte);
  if (COM_HASH.test(arquivo) || COM_HASH_POR_NOME.test(arquivo)) return comentariosHash(fonte);
  if (BAT.test(arquivo)) return comentariosBat(fonte);
  return [];
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
