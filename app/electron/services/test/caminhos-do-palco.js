'use strict';

const path = require('path');

const SEPARADOR_DO_WINDOWS = /\\{1,2}/g;
const comBarraInvertidaDupla = caminho => JSON.stringify(caminho).slice(1, -1);
const formasDoCaminho = caminho => [...new Set([comBarraInvertidaDupla(caminho), caminho])];
const trechoDepoisDaMarca = marca => new RegExp(marca.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:\\\\{1,2}[^\\\\\'"\\n]*)+', 'g');

function marcarCaminhos(texto, trocas, separador = path.sep) {
  const marcado = trocas.reduce((atual, [de, para]) => formasDoCaminho(de).reduce((parcial, forma) => parcial.split(forma).join(para), atual), texto);
  if (separador !== '\\') return marcado;
  const marcas = [...new Set(trocas.map(([, para]) => para))];
  return marcas.reduce((atual, marca) => atual.replace(trechoDepoisDaMarca(marca), trecho => trecho.replace(SEPARADOR_DO_WINDOWS, '/')), marcado);
}

function relativoEmPosix(de, para, caminhos = path) {
  return caminhos.relative(de, para).split(caminhos.sep).join('/');
}

module.exports = { marcarCaminhos, relativoEmPosix };
