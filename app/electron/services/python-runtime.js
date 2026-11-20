'use strict';
const fs = require('fs');
const path = require('path');

function pythonEmbutido(platform, roots, existe) {
  const candidatos = platform === 'darwin'
    ? ['python-runtime-portable/run-python', 'python-env/bin/python3']
    : platform === 'win32' ? ['python/python.exe'] : [];
  for (const candidato of candidatos) {
    for (const raiz of roots) {
      const arquivo = path.join(raiz, candidato);
      if (existe(arquivo)) return arquivo;
    }
  }
  return null;
}

function python({ platform = process.platform, roots, existe = fs.existsSync, ferramenta } = {}) {
  const raizes = roots || [process.resourcesPath, path.join(__dirname, '../../resources')].filter(Boolean);
  const embutido = pythonEmbutido(platform, raizes, existe);
  if (embutido) return embutido;
  if (platform === 'darwin') return (ferramenta || require('./mac-native').tool)('python3') || '/usr/bin/python3';
  return 'python';
}

function pathComBin(platform, atual, resourcesPath) {
  const bin = path.join(resourcesPath, 'bin');
  if (platform === 'darwin') return [bin, '/opt/homebrew/bin', '/usr/local/bin', atual].join(':');
  if (platform === 'win32') return [bin, atual].join(';');
  return atual;
}

module.exports = { python, pathComBin };
