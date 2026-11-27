'use strict';

const configuracao = require('../configuracao.json');
const { lerArquivo, lerMudancas, resolverBase } = require('../git');

function contextoDoRepositorio(repo, config = configuracao) {
  const base = resolverBase(repo.raiz, 'main');
  const mudancas = lerMudancas(repo.raiz, base, config);
  const cache = new Map();
  const ler = caminho => {
    if (!cache.has(caminho)) cache.set(caminho, lerArquivo(repo.raiz, caminho));
    return cache.get(caminho);
  };
  const arquivos = mudancas.itens.filter(item => item.status !== 'D');
  return { raiz: repo.raiz, config, mudancas, arquivos, ler, env: {}, aviso() {} };
}

module.exports = { contextoDoRepositorio };
