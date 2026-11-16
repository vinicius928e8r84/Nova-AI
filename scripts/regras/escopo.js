'use strict';

const { casaAlgum, extensaoDe } = require('./globs');

const ignoradoComoCodigo = (config, caminho) => casaAlgum(config.ignorarCodigo, caminho);

const temShebang = texto => typeof texto === 'string' && texto.startsWith('#!');

const ehCodigoDeComentario = (config, caminho, texto) => {
  if (ignoradoComoCodigo(config, caminho)) return false;
  const extensao = extensaoDe(caminho);
  const nome = caminho.split('/').pop();
  return config.extensoesDeComentario.includes(extensao) || (config.nomesDeComentario || []).includes(nome) || (extensao === '' && temShebang(texto));
};

const ehCodigoDoLimite = (config, caminho) => config.extensoesDoLimite.includes(extensaoDe(caminho)) && !ignoradoComoCodigo(config, caminho);

const ehJs = caminho => /\.(?:js|mjs|cjs|jsx|ts|tsx)$/.test(caminho);

module.exports = { ehCodigoDeComentario, ehCodigoDoLimite, ehJs, ignoradoComoCodigo };
