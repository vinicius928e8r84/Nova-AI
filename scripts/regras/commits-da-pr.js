'use strict';

const { git } = require('./git');

const FIM_DE_CAMPO = '\x1f';
const INICIO_DE_COMMIT = '\x1e';
const FORMATO = ['%H', '%ae', '%ce', '%aI', '%s'].join(FIM_DE_CAMPO);

function lerCommit(bloco) {
  const [cabecalho, ...restante] = bloco.split('\n');
  const [sha, autor, committer, dataDoAutor, assunto] = cabecalho.split(FIM_DE_CAMPO);
  return { sha, autor, committer, dataDoAutor, assunto, arquivos: restante.filter(Boolean) };
}

function commitsDaPr(raiz, topo) {
  const saida = git(raiz, ['log', '--no-merges', '-M', '--name-only', `--format=${INICIO_DE_COMMIT}${FORMATO}`, `${topo}..HEAD`]);
  return saida.split(INICIO_DE_COMMIT).filter(bloco => bloco.trim()).map(lerCommit);
}

const commitsJulgados = (commits, config) => commits.filter(commit => Date.parse(commit.dataDoAutor) >= Date.parse(config.julgaCommitsAPartirDe));

function arquivosSemCommit(raiz) {
  const mudados = git(raiz, ['diff', '--name-only', '-z', 'HEAD']);
  const novos = git(raiz, ['ls-files', '--others', '--exclude-standard', '-z']);
  return `${mudados}${novos}`.split('\0').filter(Boolean);
}

function arquivosJulgados(ctx) {
  const julgados = new Set(arquivosSemCommit(ctx.raiz));
  for (const commit of commitsJulgados(commitsDaPr(ctx.raiz, ctx.mudancas.base.topo), ctx.config)) {
    for (const arquivo of commit.arquivos) julgados.add(arquivo);
  }
  return julgados;
}

module.exports = { arquivosJulgados, commitsDaPr, commitsJulgados };
