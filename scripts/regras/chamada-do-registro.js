'use strict';

const { execFileSync } = require('child_process');
const { ATENCOES, atencaoValida } = require('./registro-da-pr');

class ErroDeUso extends Error {}

const COMANDOS = ['conferir', 'revisao', 'prova'];
const OPCOES_COM_VALOR = ['pr', 'head', 'veredito', 'autor', 'revisor', 'risco', 'cobertura', 'nota', 'repo'];
const OPCOES_PEDIDAS = { conferir: [], revisao: ['head', 'autor', 'revisor', 'risco'], prova: ['head', 'cobertura', 'nota'] };
const COBERTURAS = ['total', 'parcial'];

const ehPedidoDeAjuda = comando => !comando || ['--help', '-h'].includes(comando);
const pediuAjuda = (comando, resto) => ehPedidoDeAjuda(comando) || resto.includes('--help');
const nomeDaOpcao = argumento => argumento.replace(/^--/, '');
const ehOpcaoComValor = argumento => argumento.startsWith('--') && OPCOES_COM_VALOR.includes(nomeDaOpcao(argumento));

function valorDaOpcao(resto, i) {
  const valor = resto[i + 1];
  if (valor === undefined || valor.startsWith('--')) throw new ErroDeUso(`${resto[i]} precisa de um valor`);
  return valor;
}

function lerOpcao(resto, i, opcoes) {
  const argumento = resto[i];
  if (argumento === '--publicar') {
    opcoes.publicar = true;
    return i + 1;
  }
  if (!ehOpcaoComValor(argumento)) throw new ErroDeUso(`opção desconhecida: ${argumento}`);
  opcoes[nomeDaOpcao(argumento)] = valorDaOpcao(resto, i);
  return i + 2;
}

function lerOpcoes(comando, resto) {
  const opcoes = { comando, veredito: 'CLEAN', publicar: false };
  for (let i = 0; i < resto.length;) i = lerOpcao(resto, i, opcoes);
  return opcoes;
}

function exigirOpcoes(comando, opcoes) {
  if (!/^\d+$/.test(opcoes.pr || '')) throw new ErroDeUso('--pr <número> é obrigatório');
  const faltam = OPCOES_PEDIDAS[comando].filter(nome => !String(opcoes[nome] || '').trim());
  if (faltam.length) throw new ErroDeUso(`${comando} pede ${faltam.map(nome => `--${nome}`).join(', ')}`);
}

function riscoInformado(valor) {
  if (valor === undefined) return undefined;
  const risco = atencaoValida(valor.trim());
  if (!risco) throw new ErroDeUso(`--risco é ${ATENCOES.join(', ').toLowerCase()}`);
  return risco;
}

function coberturaInformada(valor) {
  if (valor !== undefined && !COBERTURAS.includes(valor)) throw new ErroDeUso(`--cobertura é ${COBERTURAS.join(' ou ')}`);
  return valor;
}

const normalizar = opcoes => ({
  ...opcoes, risco: riscoInformado(opcoes.risco), cobertura: coberturaInformada(opcoes.cobertura), head: opcoes.head && opcoes.head.trim().toLowerCase(),
});

function lerArgumentos(argv) {
  const [comando, ...resto] = argv;
  if (pediuAjuda(comando, resto)) return { ajuda: true };
  if (!COMANDOS.includes(comando)) throw new ErroDeUso(`comando desconhecido: ${comando}`);
  const opcoes = lerOpcoes(comando, resto);
  exigirOpcoes(comando, opcoes);
  return normalizar(opcoes);
}

function tentarComando(comando, args) {
  try {
    return execFileSync(comando, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

const repositorioDoRemoto = () => (/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/.exec(tentarComando('git', ['remote', 'get-url', 'origin'])) || [])[1];

function ambiente(env, opcoes) {
  const repo = opcoes.repo || env.GITHUB_REPOSITORY || repositorioDoRemoto();
  if (!repo) throw new ErroDeUso('não sei qual é o repositório: passe --repo <dono/repo>');
  return { ...env, GITHUB_REPOSITORY: repo, PR: opcoes.pr, GITHUB_TOKEN: env.GITHUB_TOKEN || env.GH_TOKEN || tentarComando('gh', ['auth', 'token']) };
}

module.exports = { ErroDeUso, ambiente, lerArgumentos };
