'use strict';

const TITULO = /^ {0,3}(#{1,6})[ \t]+(.*)$/;
const CERCA = /^ {0,3}(`{3,}|~{3,})/;
const CITACAO = /^ {0,3}>/;

function tituloDe(linha) {
  const achado = TITULO.exec(linha.split('\r')[0]);
  if (!achado) return null;
  const texto = achado[2].trimEnd();
  let fim = texto.length;
  while (fim > 0 && texto[fim - 1] === '#') fim--;
  const comFecho = fim < texto.length && (fim === 0 || /\s/.test(texto[fim - 1]));
  return { nivel: achado[1].length, texto: (comFecho ? texto.slice(0, fim) : texto).trim() };
}

const ehDescartavel = (caractere, marcas) => /\s/.test(caractere) || marcas.includes(caractere);

function aparar(texto, doInicio, doFim) {
  let inicio = 0;
  let fim = texto.length;
  while (inicio < fim && ehDescartavel(texto[inicio], doInicio)) inicio++;
  while (fim > inicio && ehDescartavel(texto[fim - 1], doFim)) fim--;
  return texto.slice(inicio, fim);
}

const semMarcacao = texto => aparar(texto.replace(/[*_`]/g, ''), '-', '.!');
const semCaixaNemAcento = texto => texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const igual = (a, b) => semCaixaNemAcento(a) === semCaixaNemAcento(b);

const linhasSemComentario = markdown => String(markdown || '').replace(/<!--[^]*?(?:-->|$)/g, '').split(/\r?\n/);
const fechaACerca = (marca, cerca, linha) => marca[0] === cerca[0] && marca.length >= cerca.length && linha.trim() === marca;

function linhaQueVale(crua) {
  const titulo = tituloDe(crua);
  return { texto: semMarcacao(titulo ? titulo.texto : crua), nivel: titulo ? titulo.nivel : 0 };
}

function linhasDoCorpo(markdown) {
  let cerca = null;
  return linhasSemComentario(markdown).map(crua => {
    const abre = CERCA.exec(crua);
    const vale = !abre && !cerca && !CITACAO.test(crua);
    if (abre && !cerca) cerca = abre[1];
    else if (abre && fechaACerca(abre[1], cerca, crua)) cerca = null;
    return { crua, vale, ...(vale ? linhaQueVale(crua) : { nivel: 0 }) };
  });
}

const linhasQueValem = markdown => linhasDoCorpo(markdown).filter(linha => linha.vale).map(({ texto, nivel }) => ({ texto, nivel }));

function trechoDaSecao(linhas, nome) {
  const inicio = linhas.findIndex(linha => linha.nivel && igual(linha.texto, nome));
  if (inicio < 0) return null;
  const resto = linhas.slice(inicio + 1);
  const fim = resto.findIndex(linha => linha.nivel && linha.nivel <= linhas[inicio].nivel);
  return fim < 0 ? resto : resto.slice(0, fim);
}

const valoresDe = (textos, campo) => textos.filter(texto => texto.includes(':'))
  .map(texto => [texto.slice(0, texto.indexOf(':')), texto.slice(texto.indexOf(':') + 1).trim()])
  .filter(([nome, valor]) => valor && igual(nome, campo)).map(([, valor]) => valor);

const hexasDe = textos => textos.join('\n').toLowerCase().match(/[0-9a-f]+/g) || [];

module.exports = { hexasDe, igual, linhasDoCorpo, linhasQueValem, semCaixaNemAcento, tituloDe, trechoDaSecao, valoresDe };
