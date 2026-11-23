'use strict';
const fs = require('fs');
const path = require('path');

const EMBUTIDOS_POR_SISTEMA = new Map([
  ['darwin', ['python-runtime-portable/run-python', 'python-env/bin/python3']],
  ['win32', ['python/python.exe']],
]);

const raizesPadrao = () => [process.resourcesPath, path.join(__dirname, '../../resources')].filter(Boolean);

function pythonEmbutido(platform, roots, existe) {
  const candidatos = EMBUTIDOS_POR_SISTEMA.get(platform) || [];
  return candidatos
    .flatMap(candidato => roots.map(raiz => path.join(raiz, candidato)))
    .find(arquivo => existe(arquivo)) ?? null;
}

function pythonDoSistema(platform, ferramenta) {
  if (platform !== 'darwin') return 'python';
  const acharFerramenta = ferramenta || require('./mac-native').tool;
  return acharFerramenta('python3') || '/usr/bin/python3';
}

function python({ platform = process.platform, roots, existe = fs.existsSync, ferramenta } = {}) {
  return pythonEmbutido(platform, roots || raizesPadrao(), existe) || pythonDoSistema(platform, ferramenta);
}

function pathComBin(platform, atual, resourcesPath) {
  const bin = path.join(resourcesPath, 'bin');
  if (platform === 'darwin') return [bin, '/opt/homebrew/bin', '/usr/local/bin', atual].join(':');
  if (platform === 'win32') return [bin, atual].join(';');
  return atual;
}

module.exports = { python, pathComBin };
