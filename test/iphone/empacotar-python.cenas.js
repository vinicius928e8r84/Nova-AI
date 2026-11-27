'use strict';

const fs = require('fs');
const path = require('path');
const { escrever, escreverMachO, VERSAO } = require('./empacotar-python.palco');

function trocarDependencias(caminhos, arquivo, dependencias) {
  escrever(path.join(caminhos.dependencias, arquivo), dependencias.map(dependencia => `${dependencia}\n`).join(''));
}

function criarDuasBibliotecasComOMesmoNome(caminhos, conteudos) {
  const [primeira, segunda] = ['a', 'b'].map(pasta => path.join(caminhos.homebrew, 'opt', pasta, 'lib', 'libx.dylib'));
  escreverMachO(primeira, conteudos[0], [], caminhos);
  escreverMachO(segunda, conteudos[1], [], caminhos);
  trocarDependencias(caminhos, 'Python', [primeira, segunda]);
}

const cenas = [
  { nome: 'runtime completo, com as chamadas e o manifesto em ordem alfabética', ordenar: true },
  { nome: 'uma só biblioteca nativa, com as chamadas na ordem da fila', minima: true },
  {
    nome: 'runtime que já existe',
    minima: true,
    ajustar: caminhos => fs.mkdirSync(path.join(caminhos.runtime, 'Python.framework', 'Versions', VERSAO), { recursive: true }),
  },
  {
    nome: 'duas bibliotecas com o mesmo nome e conteúdo diferente',
    minima: true,
    ajustar: caminhos => criarDuasBibliotecasComOMesmoNome(caminhos, ['a', 'b']),
  },
  {
    nome: 'duas bibliotecas com o mesmo nome e o mesmo conteúdo',
    minima: true,
    ajustar: caminhos => criarDuasBibliotecasComOMesmoNome(caminhos, ['igual', 'igual']),
  },
  {
    nome: 'dependência fora do Homebrew e do sistema',
    minima: true,
    ajustar: caminhos => trocarDependencias(caminhos, 'Python', [path.join(caminhos.raiz, 'fora', 'libx.dylib')]),
  },
  {
    nome: 'extensão do app que lista a si mesma entre as dependências',
    ordenar: true,
    ajustar: (caminhos, bibliotecas) => trocarDependencias(caminhos, 'nativo.so', [path.join(caminhos.pacotesDoApp, 'pacote', 'nativo.so'), bibliotecas.portaudio]),
  },
  {
    nome: 'sem o sounddevice.py no app',
    ordenar: true,
    ajustar: caminhos => fs.rmSync(path.join(caminhos.pacotesDoApp, 'sounddevice.py')),
  },
  {
    nome: 'sounddevice.py sem a linha do find_library',
    ordenar: true,
    ajustar: caminhos => escrever(path.join(caminhos.pacotesDoApp, 'sounddevice.py'), 'import os as _os\n'),
  },
  {
    nome: 'sem o portaudio do Homebrew',
    minima: true,
    ajustar: (caminhos, bibliotecas) => fs.rmSync(bibliotecas.portaudio),
  },
  { nome: 'install_name_tool falha', minima: true, env: { FALHAR: 'install_name_tool' } },
  { nome: 'codesign falha', minima: true, env: { FALHAR: 'codesign' } },
  { nome: 'otool falha', minima: true, env: { FALHAR: 'otool' } },
];

module.exports = { cenas };
