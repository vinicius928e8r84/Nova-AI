'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { copiarFontes, normalizar, cortarNoErroDeSintaxe, trocarErroDoNode, ultimaLinha, rodarPython, impressaoDoArquivo } = require('./script-python.palco');

const RAIZ_DO_REPOSITORIO = path.join(__dirname, '..', '..');
const APP_INSTALADO = '/Applications/Nova AI Mac.app/Contents/Resources';
const PASTA_DAS_FIXTURES = path.join(__dirname, 'fixtures');

function caminhosDaCena(raiz) {
  return {
    entrada: path.join(raiz, 'entrada.txt'),
    saida: path.join(raiz, 'saida.js'),
    scripts: path.join(raiz, 'scripts'),
    instalado: path.join(raiz, 'instalado'),
  };
}

function prepararCena(patch, cena, raiz) {
  const caminhos = caminhosDaCena(raiz);
  const trocas = [[APP_INSTALADO, caminhos.instalado]];
  copiarFontes(path.join(RAIZ_DO_REPOSITORIO, patch.pasta), caminhos.scripts, { trocas });
  fs.mkdirSync(path.join(caminhos.instalado, 'app', 'dist', 'assets'), { recursive: true });
  const fixture = fs.readFileSync(path.join(PASTA_DAS_FIXTURES, patch.fixture), 'utf8');
  fs.writeFileSync(caminhos.entrada, cena.entrada ? cena.entrada(fixture) : fixture);
  return caminhos;
}

function diarioDaExecucao(patch, resposta, caminhos, raiz) {
  const saidas = {};
  for (const [rotulo, caminho] of Object.entries(patch.saidas(caminhos))) saidas[rotulo] = impressaoDoArquivo(caminho);
  return {
    codigo: resposta.codigo,
    stdout: trocarErroDoNode(normalizar(resposta.stdout, [raiz])),
    erro: ultimaLinha(cortarNoErroDeSintaxe(normalizar(resposta.stderr, [raiz]))),
    saidas,
  };
}

function rodarCena(python, patch, cena) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'patch-da-interface-'));
  try {
    const caminhos = prepararCena(patch, cena, raiz);
    const argumentos = cena.argumentos ? cena.argumentos(caminhos) : patch.argumentos(caminhos);
    const resposta = rodarPython(python, { cwd: raiz, script: path.join(caminhos.scripts, patch.script), argumentos, env: cena.env });
    return diarioDaExecucao(patch, resposta, caminhos, raiz);
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
  }
}

module.exports = { rodarCena };
