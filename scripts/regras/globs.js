'use strict';

const escapar = texto => texto.replace(/[.+^$()|\\]/g, '\\$&');

function traduzir(glob) {
  let saida = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        saida += '(?:.*/)?';
        i += 2;
      } else {
        saida += '.*';
        i += 1;
      }
    } else if (c === '*') {
      saida += '[^/]*';
    } else if (c === '?') {
      saida += '[^/]';
    } else if (c === '{') {
      const fim = glob.indexOf('}', i);
      saida += `(?:${glob.slice(i + 1, fim).split(',').map(escapar).join('|')})`;
      i = fim;
    } else if (c === '[') {
      const fim = glob.indexOf(']', i);
      saida += glob.slice(i, fim + 1);
      i = fim;
    } else {
      saida += escapar(c);
    }
  }
  return saida;
}

const cache = new Map();

function compilar(glob) {
  if (!cache.has(glob)) {
    const diretorio = glob.endsWith('/');
    const corpo = traduzir(diretorio ? glob.slice(0, -1) : glob);
    const ancorado = glob.includes('/') && !diretorio ? `^${corpo}$` : null;
    let expressao;
    if (ancorado) expressao = ancorado;
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
