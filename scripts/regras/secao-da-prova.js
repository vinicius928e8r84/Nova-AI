'use strict';

const { BLOQUEADA, FRASE, SECAO_DA_PROVA } = require('./registro-da-pr');
const { fechaACerca, tituloDe } = require('./corpo-da-pr');

const CERCA = /^ {0,3}(`{3,}|~{3,})/;
const nomeDoTitulo = texto => texto.replace(/[*_`]/g, '').trim().toLowerCase();

const secaoDaProva = (head, nota, cobertura) => [
  `## ${SECAO_DA_PROVA}`, '', cobertura === 'parcial' ? BLOQUEADA : FRASE, `Head: ${head}`, ...(nota ? ['', nota.trim()] : []),
].join('\n');

const linhasVisiveis = linhas => linhas.join('\n').replace(/<!--[^]*?(?:-->|$)/g, trecho => trecho.replace(/[^\n]/g, ' ')).split('\n');

function cercaDepoisDe(cerca, linha) {
  const abre = CERCA.exec(linha);
  if (!abre) return cerca;
  if (!cerca) return abre[1];
  return fechaACerca(abre[1], cerca, linha) ? null : cerca;
}

const tituloForaDeCerca = (linha, cerca) => (cerca || CERCA.test(linha) ? null : tituloDe(linha));

function titulosForaDeCerca(visiveis) {
  let cerca = null;
  const titulos = [];
  visiveis.forEach((linha, indice) => {
    cerca = cercaDepoisDe(cerca, linha);
    const titulo = tituloForaDeCerca(linha, cerca);
    if (titulo) titulos.push({ indice, ...titulo });
  });
  return titulos;
}

function limitesDaSecao(titulos, totalDeLinhas) {
  const inicio = titulos.findIndex(titulo => nomeDoTitulo(titulo.texto) === SECAO_DA_PROVA.toLowerCase());
  if (inicio < 0) return null;
  const seguinte = titulos.slice(inicio + 1).find(titulo => titulo.nivel <= titulos[inicio].nivel);
  return { inicio: titulos[inicio].indice, fim: seguinte ? seguinte.indice : totalDeLinhas };
}

function corpoComAProva(corpo, secao) {
  const linhas = String(corpo || '').split(/\r?\n/);
  const limites = limitesDaSecao(titulosForaDeCerca(linhasVisiveis(linhas)), linhas.length);
  if (!limites) return `${linhas.join('\n').replace(/\s+$/, '')}\n\n${secao}\n`;
  return [...linhas.slice(0, limites.inicio), secao, '', ...linhas.slice(limites.fim)].join('\n');
}

module.exports = { corpoComAProva, secaoDaProva };
