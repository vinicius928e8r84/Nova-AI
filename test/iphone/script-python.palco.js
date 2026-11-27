'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const sha256 = conteudo => crypto.createHash('sha256').update(conteudo).digest('hex');

function acharPython() {
  if (process.platform === 'win32') return null;
  return ['python3', 'python'].find(comando => {
    const resposta = spawnSync(comando, ['--version'], { encoding: 'utf8' });
    return !resposta.error && resposta.status === 0;
  }) || null;
}

function trocarTextos(texto, trocas) {
  return trocas.reduce((atual, [de, para]) => atual.split(de).join(para), texto);
}

function copiarFontes(pasta, destino, { trocas = [], subpastas = [] } = {}) {
  fs.mkdirSync(destino, { recursive: true });
  const nomes = fs.readdirSync(pasta).filter(nome => nome.endsWith('.py'));
  for (const nome of nomes) {
    fs.writeFileSync(path.join(destino, nome), trocarTextos(fs.readFileSync(path.join(pasta, nome), 'utf8'), trocas));
  }
  for (const subpasta of subpastas.filter(nome => fs.existsSync(path.join(pasta, nome)))) {
    copiarFontes(path.join(pasta, subpasta), path.join(destino, subpasta), { trocas });
  }
}

function normalizar(texto, raizes) {
  const variantes = raizes.flatMap(raiz => [fs.realpathSync(raiz), raiz]);
  return variantes.reduce((atual, raiz) => atual.split(raiz).join('<raiz>'), texto);
}

function cortarNoErroDeSintaxe(texto) {
  const posicao = texto.indexOf('SyntaxError');
  return posicao < 0 ? texto : `${texto.slice(0, posicao)}SyntaxError…`;
}

const MENSAGEM_DO_NODE = /SyntaxError|bundle\.mjs:\d+/;

function trocarErroDoNode(texto) {
  return MENSAGEM_DO_NODE.test(texto) ? '<mensagem do node com SyntaxError>\n' : texto;
}

function ultimaLinha(texto) {
  return texto.split('\n').map(linha => linha.trimEnd()).filter(Boolean).pop() || '';
}

function ambienteDoScript(extras) {
  const { NODE_TEST_CONTEXT, ...ambiente } = process.env;
  return { ...ambiente, PYTHONDONTWRITEBYTECODE: '1', PYTHONUTF8: '1', ...extras };
}

function rodarPython(python, { cwd, script, argumentos = [], env = {} }) {
  const resposta = spawnSync(python, [script, ...argumentos], { cwd, encoding: 'utf8', env: ambienteDoScript(env) });
  return { codigo: resposta.status, stdout: resposta.stdout, stderr: resposta.stderr };
}

function impressaoDoArquivo(caminho) {
  if (!fs.existsSync(caminho)) return null;
  const conteudo = fs.readFileSync(caminho);
  return { bytes: conteudo.length, sha256: sha256(conteudo) };
}

module.exports = { sha256, acharPython, copiarFontes, normalizar, cortarNoErroDeSintaxe, trocarErroDoNode, ultimaLinha, rodarPython, impressaoDoArquivo };
