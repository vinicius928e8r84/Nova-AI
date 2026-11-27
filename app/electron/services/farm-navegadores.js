'use strict';

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const { findBundledChromiumExecutable, primeiroCaminhoExistente } = require('./platform-utils');

const naPastaDeRecursos = (...partes) => path.join(process.resourcesPath || '', 'browsers', ...partes);
const naPastaDoApp = (...partes) => path.join(app.getAppPath(), 'browsers', ...partes);
const naPastaLocalDoUsuario = caminho => path.join(process.env.LOCALAPPDATA || '', caminho);

const pastasDeNavegadoresEmbutidos = () => [
  process.resourcesPath && path.join(process.resourcesPath, 'browsers'),
  path.join(app.getAppPath(), 'browsers'),
];

const candidatosDoChrome = () => [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  naPastaLocalDoUsuario('Google\\Chrome\\Application\\chrome.exe'),
  findBundledChromiumExecutable(pastasDeNavegadoresEmbutidos()),
  naPastaDeRecursos('chrome', 'chrome.exe'),
  naPastaDoApp('chrome', 'chrome.exe'),
];

const candidatosDoBrave = () => [
  naPastaDeRecursos('brave', 'brave.exe'),
  naPastaDoApp('brave', 'brave.exe'),
  'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
  'C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
  naPastaLocalDoUsuario('BraveSoftware\\Brave-Browser\\Application\\brave.exe'),
];

const candidatosDoVivaldi = () => [
  naPastaDeRecursos('vivaldi', 'vivaldi.exe'),
  naPastaDoApp('vivaldi', 'vivaldi.exe'),
  path.join(__dirname, '../../browsers/vivaldi/vivaldi.exe'),
  path.join(__dirname, '../browsers/vivaldi/vivaldi.exe'),
  naPastaLocalDoUsuario('Vivaldi\\Application\\vivaldi.exe'),
  'C:\\Program Files\\Vivaldi\\Application\\vivaldi.exe',
  'C:\\Program Files (x86)\\Vivaldi\\Application\\vivaldi.exe',
];

const candidatosDoFirefox = () => [
  naPastaDeRecursos('firefox', 'firefox.exe'),
  naPastaDoApp('firefox', 'firefox.exe'),
  'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
  'C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe',
  naPastaLocalDoUsuario('Mozilla Firefox\\firefox.exe'),
];

const primeiroQueExiste = caminhos => caminhos.find(caminho => fs.existsSync(caminho));
const primeiroQueExisteOuNulo = caminhos => primeiroQueExiste(caminhos) ?? null;

const NAVEGADORES = {
  chrome: { candidatos: candidatosDoChrome, escolher: primeiroCaminhoExistente },
  brave: { candidatos: candidatosDoBrave, escolher: primeiroQueExiste },
  vivaldi: { candidatos: candidatosDoVivaldi, escolher: primeiroQueExisteOuNulo },
  firefox: { candidatos: candidatosDoFirefox, escolher: primeiroQueExisteOuNulo },
};

function executavelDoNavegador(nome) {
  if (process.platform === 'darwin') return require('./mac-native').browser(nome);
  const { candidatos, escolher } = NAVEGADORES[nome];
  return escolher(candidatos());
}

module.exports = { executavelDoNavegador };
