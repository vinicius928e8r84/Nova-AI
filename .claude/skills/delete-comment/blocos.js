'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const REGRAS = path.join(__dirname, '..', '..', '..', 'scripts', 'regras');
const { indiceDeLinhas, linhaDoIndice, linhasDeComentario, trechosDeComentario } = require(path.join(REGRAS, 'comentarios'));
const { permitida } = require(path.join(REGRAS, 'regra-comentario'));

const SO_ESPACO = /^[ \t\r]*$/;
const INICIO_DE_BLOCO = /^(?:\/\*|<!--)/;
const BLOCO_DE_PYTHON = /:\s*$/;

const identacaoDe = linha => /^[ \t]*/.exec(linha)[0];

function linhaDe(fonte, posicao) {
  const inicio = fonte.lastIndexOf('\n', posicao - 1) + 1;
  const fim = fonte.indexOf('\n', posicao);
  return { inicio, fim: fim < 0 ? fonte.length : fim };
}

function descreverTrecho(fonte, inicios, [de, fimBruto]) {
  const ate = fonte[fimBruto - 1] === String.fromCharCode(13) ? fimBruto - 1 : fimBruto;
  const primeira = linhaDe(fonte, de);
  const ultima = linhaDe(fonte, Math.max(de, ate - 1));
  return {
    inicio: de,
    fim: ate,
    de: linhaDoIndice(inicios, de),
    ate: linhaDoIndice(inicios, Math.max(de, ate - 1)),
    tipo: INICIO_DE_BLOCO.test(fonte.slice(de, ate)) ? 'bloco' : 'linha',
    inteira: SO_ESPACO.test(fonte.slice(primeira.inicio, de)) && SO_ESPACO.test(fonte.slice(ate, ultima.fim)),
    identacao: identacaoDe(fonte.slice(primeira.inicio, primeira.fim)),
  };
}

const eProsa = item => Boolean(item) && Boolean(item.corpo) && !permitida(item.linha, item.corpo, item.bruto);

const ehProsa = (trecho, linhas) => {
  for (let linha = trecho.de; linha <= trecho.ate; linha++) {
    if (eProsa(linhas.get(linha))) return true;
  }
  return false;
};

const seguem = (anterior, atual) => anterior.tipo === 'linha' && atual.tipo === 'linha' && anterior.inteira && atual.inteira
  && atual.de === anterior.ate + 1 && atual.identacao === anterior.identacao;

function juntar(trechos) {
  const grupos = [];
  for (const trecho of trechos) {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && seguem(ultimo, trecho)) Object.assign(ultimo, { fim: trecho.fim, ate: trecho.ate });
    else grupos.push({ ...trecho });
  }
  return grupos;
}

function textoDo(fonte, bloco, linhas) {
  const corpos = [];
  for (let linha = bloco.de; linha <= bloco.ate; linha++) {
    const item = linhas.get(linha);
    if (item && item.corpo) corpos.push(item.corpo);
  }
  return corpos.join(' ');
}

function docstringsDe(arquivo, fonte, inicios, python) {
  if (!arquivo.endsWith('.py')) return [];
  const resultado = spawnSync(python, ['-I', path.join(REGRAS, 'docstrings.py')], { input: fonte, encoding: 'utf8' });
  if (resultado.status !== 0) throw new Error(`não consegui ler as docstrings com ${python} (aponte PYTHON=)`);
  return JSON.parse(resultado.stdout).map(([de, ate]) => ({
    inicio: inicios[de - 1], fim: linhaDe(fonte, inicios[ate - 1]).fim, de, ate, tipo: 'docstring', inteira: true, identacao: identacaoDe(fonte.slice(inicios[de - 1])),
  }));
}

function blocosDe(arquivo, fonte, python = 'python3') {
  const inicios = indiceDeLinhas(fonte);
  const linhas = new Map(linhasDeComentario(arquivo, fonte).map(item => [item.linha, item]));
  const trechos = trechosDeComentario(arquivo, fonte).sort((a, b) => a[0] - b[0]).map(trecho => descreverTrecho(fonte, inicios, trecho));
  const prosa = juntar(trechos.filter(trecho => ehProsa(trecho, linhas)));
  const todos = [...prosa, ...docstringsDe(arquivo, fonte, inicios, python)].sort((a, b) => a.inicio - b.inicio);
  return todos.map((bloco, i) => ({ id: i + 1, ...bloco, texto: bloco.tipo === 'docstring' ? fonte.slice(bloco.inicio, bloco.fim).trim().replace(/\s+/g, ' ') : textoDo(fonte, bloco, linhas) }));
}

function linhasDoTexto(texto) {
  return texto.split('\n').map(linha => linha.replace(/\r$/, ''));
}

function deixariaVazio(fonte, bloco) {
  if (bloco.tipo !== 'docstring') return false;
  const antes = linhasDoTexto(fonte.slice(0, bloco.inicio)).filter(linha => linha.trim());
  const depois = linhasDoTexto(fonte.slice(bloco.fim)).filter(linha => linha.trim());
  const abre = antes.length && BLOCO_DE_PYTHON.test(antes[antes.length - 1]);
  return Boolean(abre) && (!depois.length || identacaoDe(depois[0]).length <= identacaoDe(antes[antes.length - 1]).length);
}

function limitesDaRemocao(fonte, bloco) {
  const primeira = linhaDe(fonte, bloco.inicio);
  const ultima = linhaDe(fonte, Math.max(bloco.inicio, bloco.fim - 1));
  const antes = fonte.slice(primeira.inicio, bloco.inicio);
  const depois = fonte.slice(bloco.fim, ultima.fim);
  if (SO_ESPACO.test(antes) && SO_ESPACO.test(depois)) return { de: primeira.inicio, ate: Math.min(ultima.fim + 1, fonte.length), linhaInteira: true };
  if (SO_ESPACO.test(depois)) return { de: bloco.inicio - /[ \t]*$/.exec(antes)[0].length, ate: bloco.fim, linhaInteira: false };
  return { de: bloco.inicio, ate: bloco.fim + (depois.startsWith(' ') ? 1 : 0), linhaInteira: false };
}

const ehLinhaEmBranco = (fonte, inicio) => SO_ESPACO.test(fonte.slice(inicio, linhaDe(fonte, inicio).fim));

function fecharOBuraco(fonte, posicao) {
  if (posicao >= fonte.length || !ehLinhaEmBranco(fonte, posicao)) return fonte;
  const anteriorEmBranco = posicao === 0 || ehLinhaEmBranco(fonte, linhaDe(fonte, posicao - 1).inicio);
  if (!anteriorEmBranco) return fonte;
  const fim = linhaDe(fonte, posicao).fim;
  return fonte.slice(0, posicao) + fonte.slice(Math.min(fim + 1, fonte.length));
}

function removerBloco(fonte, bloco) {
  const { de, ate, linhaInteira } = limitesDaRemocao(fonte, bloco);
  const restante = fonte.slice(0, de) + fonte.slice(ate);
  return linhaInteira ? fecharOBuraco(restante, de) : restante;
}

function removerBlocos(fonte, blocos) {
  return [...blocos].sort((a, b) => b.inicio - a.inicio).reduce((texto, bloco) => removerBloco(texto, bloco), fonte);
}

module.exports = { blocosDe, deixariaVazio, removerBlocos };
