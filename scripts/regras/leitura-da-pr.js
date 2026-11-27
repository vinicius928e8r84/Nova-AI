'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { git, tentar } = require('./git');
const { soTiraComentario } = require('./so-tira-comentario');

const QUEM_REGISTRA = ['OWNER', 'MEMBER', 'COLLABORATOR'];
const ANALISADOR = path.join(__dirname, 'analisador');

function adicionadasDoArquivo(arquivo) {
  if (arquivo.patch === undefined && arquivo.changes > 0) return null;
  return String(arquivo.patch || '').split('\n').filter(linha => linha.startsWith('+') && !linha.startsWith('+++')).map(linha => linha.slice(1));
}

function instalarOAcorn() {
  const acorn = path.join(ANALISADOR, 'node_modules', 'acorn');
  if (fs.existsSync(acorn) || !fs.existsSync(path.join(ANALISADOR, 'package-lock.json'))) return;
  spawnSync('npm', ['ci', '--no-audit', '--no-fund', '--ignore-scripts', '--prefix', ANALISADOR], { stdio: 'ignore' });
}

function trazerAHistoria(raiz, pr) {
  if (tentar(raiz, ['rev-parse', '--is-shallow-repository']) === 'true') tentar(raiz, ['fetch', '--no-tags', '--unshallow', 'origin']);
  if (tentar(raiz, ['cat-file', '-e', `${pr.head.sha}^{commit}`]) === null) tentar(raiz, ['fetch', '--no-tags', 'origin', `refs/pull/${pr.number}/head`]);
}

function arquivosSoComComentarioRemovido(env, pr) {
  try {
    const raiz = env.GITHUB_WORKSPACE || process.cwd();
    instalarOAcorn();
    trazerAHistoria(raiz, pr);
    const desde = git(raiz, ['merge-base', `origin/${pr.base.ref}`, pr.head.sha]).trim();
    return soTiraComentario(raiz, desde, pr.head.sha, env);
  } catch {
    return new Set();
  }
}

async function lerDoApi(env, caminho) {
  const resposta = await fetch(`${env.GITHUB_API_URL || 'https://api.github.com'}/repos/${env.GITHUB_REPOSITORY}/${caminho}`, {
    headers: { accept: 'application/vnd.github+json', ...(env.GITHUB_TOKEN ? { authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}) },
  });
  if (!resposta.ok) throw new Error(`o GitHub respondeu ${resposta.status} a ${caminho}`);
  return resposta.json();
}

async function lerTodasAsPaginas(env, caminho) {
  const itens = [];
  for (let pagina = 1; ; pagina++) {
    const lote = await lerDoApi(env, `${caminho}?per_page=100&page=${pagina}`);
    itens.push(...lote);
    if (lote.length < 100) return itens;
  }
}

const registrosPorData = (comentarios, revisoes) => [...comentarios, ...revisoes]
  .filter(registro => QUEM_REGISTRA.includes(registro.author_association))
  .map(registro => ({ corpo: registro.body || '', quando: registro.submitted_at || registro.created_at || '' }))
  .sort((a, b) => a.quando.localeCompare(b.quando)).map(registro => registro.corpo);

function arquivosDaPr(arquivosDoGitHub) {
  const arquivos = [];
  for (const arquivo of arquivosDoGitHub) {
    arquivos.push({ caminho: arquivo.filename, adicionadas: adicionadasDoArquivo(arquivo) });
    if (arquivo.previous_filename) arquivos.push({ caminho: arquivo.previous_filename, adicionadas: [] });
  }
  return arquivos;
}

async function lerDoGitHub(env) {
  const pr = await lerDoApi(env, `pulls/${env.PR}`);
  const registros = registrosPorData(await lerTodasAsPaginas(env, `issues/${env.PR}/comments`), await lerTodasAsPaginas(env, `pulls/${env.PR}/reviews`));
  const arquivos = arquivosDaPr(await lerTodasAsPaginas(env, `pulls/${env.PR}/files`));
  return { corpo: pr.body, rotulos: pr.labels.map(rotulo => rotulo.name), registros, head: pr.head.sha, arquivos, autor: pr.user && pr.user.login, semComentario: arquivosSoComComentarioRemovido(env, pr) };
}

module.exports = { arquivosSoComComentarioRemovido, lerDoGitHub };
