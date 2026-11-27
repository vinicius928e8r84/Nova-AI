'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const VARIAVEL = 'FREIOS_NOMES';
const PADRAO = ['.config', 'freios', 'nomes.txt'];
const AVISO_SEM_LISTA = `sem lista de nomes (aponte ${VARIAVEL} para um arquivo ou crie ~/${PADRAO.join('/')}, um nome por linha); `
  + 'nesta máquina só e-mail, IP e caminho são conferidos';

const dobrar = texto => texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const escapar = texto => texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function caminhoDaLista(env) {
  if (env[VARIAVEL]) return env[VARIAVEL];
  return path.join(env.HOME || env.USERPROFILE || os.homedir(), ...PADRAO);
}

function lerNomes(caminho) {
  try {
    const linhas = fs.readFileSync(caminho, 'utf8').split(/\r?\n/);
    return linhas.map(linha => linha.trim()).filter(linha => linha && !linha.startsWith('#'));
  } catch {
    return null;
  }
}

function comoBusca(nomes) {
  const alternativas = nomes.map(nome => escapar(dobrar(nome))).join('|');
  const padrao = new RegExp(String.raw`(?<![\p{L}\p{N}_])(?:${alternativas})(?![\p{L}\p{N}_])`, 'gu');
  return { achar: linha => dobrar(linha).match(padrao) || [] };
}

function abrirLista(ctx) {
  const nomes = lerNomes(caminhoDaLista(ctx.env));
  if (nomes === null) ctx.aviso(AVISO_SEM_LISTA);
  return nomes && nomes.length ? comoBusca(nomes) : null;
}

module.exports = { AVISO_SEM_LISTA, VARIAVEL, abrirLista };
