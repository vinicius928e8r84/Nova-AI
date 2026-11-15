'use strict';

const { casaAlgum, extensaoDe } = require('./globs');

const ignoradoComoCodigo = (config, caminho) => casaAlgum(config.ignorarCodigo, caminho);

const ehCodigoDeComentario = (config, caminho) => config.extensoesDeComentario.includes(extensaoDe(caminho)) && !ignoradoComoCodigo(config, caminho);

const ehCodigoDoLimite = (config, caminho) => config.extensoesDoLimite.includes(extensaoDe(caminho)) && !ignoradoComoCodigo(config, caminho);

const ehJs = caminho => /\.(?:js|mjs|cjs|jsx|ts|tsx)$/.test(caminho);

module.exports = { ehCodigoDeComentario, ehCodigoDoLimite, ehJs, ignoradoComoCodigo };
