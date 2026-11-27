'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PASTA_DOS_GANCHOS = '.githooks';

function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { codigo: r.status, saida: (r.stdout || '').trim() };
}

function raizDoRepositorio() {
  const r = git(['rev-parse', '--show-toplevel'], __dirname);
  return r.codigo === 0 && r.saida ? r.saida : null;
}

function ligar() {
  const raiz = raizDoRepositorio();
  if (!raiz || !fs.existsSync(path.join(raiz, PASTA_DOS_GANCHOS))) return 'sem repositório com ganchos: nada a ligar';
  const atual = git(['config', '--get', 'core.hooksPath'], raiz).saida;
  if (atual === PASTA_DOS_GANCHOS) return `core.hooksPath já é ${PASTA_DOS_GANCHOS}`;
  if (atual) return `core.hooksPath já aponta para ${atual}: mantido`;
  const r = git(['config', 'core.hooksPath', PASTA_DOS_GANCHOS], raiz);
  return r.codigo === 0 ? `core.hooksPath ligado em ${PASTA_DOS_GANCHOS}` : 'não foi possível ligar o core.hooksPath';
}

if (require.main === module) console.log(ligar());

module.exports = { ligar };
