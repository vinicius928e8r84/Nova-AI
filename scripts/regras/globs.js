'use strict';

const escapar = texto => texto.replace(/[.+^$()|\\]/g, '\\$&');

const CURINGAS = [
  { inicio: '**/', regex: '(?:.*/)?' },
  { inicio: '**', regex: '.*' },
  { inicio: '*', regex: '[^/]*' },
  { inicio: '?', regex: '[^/]' },
];

function alternativas(glob, i) {
  const fim = glob.indexOf('}', i);
  return { regex: `(?:${glob.slice(i + 1, fim).split(',').map(escapar).join('|')})`, fim };
}

function classeDeCaracteres(glob, i) {
  const fim = glob.indexOf(']', i);
  return { regex: glob.slice(i, fim + 1), fim };
}

const GRUPOS = new Map([['{', alternativas], ['[', classeDeCaracteres]]);

function pedacoEm(glob, i) {
  const curinga = CURINGAS.find(({ inicio }) => glob.startsWith(inicio, i));
  if (curinga) return { regex: curinga.regex, fim: i + curinga.inicio.length - 1 };
  const grupo = GRUPOS.get(glob[i]);
  return grupo ? grupo(glob, i) : { regex: escapar(glob[i]), fim: i };
}

function traduzir(glob) {
  let saida = '';
  for (let i = 0; i < glob.length; i++) {
    const pedaco = pedacoEm(glob, i);
    saida += pedaco.regex;
    i = pedaco.fim;
  }
  return saida;
}

const cache = new Map();

function compilar(glob) {
  if (!cache.has(glob)) {
    const diretorio = glob.endsWith('/');
    const semBarraFinal = diretorio ? glob.slice(0, -1) : glob;
    const corpo = traduzir(semBarraFinal);
    const comCaminho = semBarraFinal.includes('/');
    let expressao;
    if (comCaminho) expressao = diretorio ? `^${corpo}/` : `^${corpo}$`;
    else if (diretorio) expressao = `(?:^|/)${corpo}/`;
    else expressao = `(?:^|/)${corpo}$`;
    cache.set(glob, new RegExp(expressao));
  }
  return cache.get(glob);
}

const casa = (glob, caminho) => compilar(glob).test(caminho);

const casaAlgum = (globs, caminho) => globs.some(glob => casa(typeof glob === 'string' ? glob : glob.glob, caminho));

const extensaoDe = caminho => {
  const m = /\.([A-Za-z0-9]+)$/.exec(caminho);
  return m ? m[1].toLowerCase() : '';
};

module.exports = { casa, casaAlgum, extensaoDe };
