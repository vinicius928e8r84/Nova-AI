'use strict';

const { git } = require('./git');

const id = 'autoria';
const titulo = 'Os commits novos da PR têm o e-mail do repositório';
const conserto = 'Refaça a autoria dos commits novos com o e-mail do repositório (chave autoria em scripts/regras/configuracao.json): '
  + '`git config user.email <e-mail>` e `git rebase --exec "git commit --amend --no-edit --reset-author" <branch-alvo>`. '
  + 'Commits de antes de julgaCommitsAPartirDe não são julgados.';

const FIM_DE_CAMPO = '\x1f';
const FIM_DE_COMMIT = '\x1e';

function lerCommit(registro) {
  const [sha, autor, committer, dataDoAutor, assunto] = registro.split(FIM_DE_CAMPO);
  return { sha, autor, committer, dataDoAutor, assunto };
}

function commitsDaPr(raiz, topo) {
  const saida = git(raiz, ['log', '--no-merges', `--format=%H${FIM_DE_CAMPO}%ae${FIM_DE_CAMPO}%ce${FIM_DE_CAMPO}%aI${FIM_DE_CAMPO}%s${FIM_DE_COMMIT}`, `${topo}..HEAD`]);
  return saida.split(FIM_DE_COMMIT).map(registro => registro.trim()).filter(Boolean).map(lerCommit);
}

const minusculos = emails => new Set(emails.map(email => email.toLowerCase()));

function problemasDe(commit, aceitos) {
  const problemas = [];
  if (!aceitos.autores.has(commit.autor.toLowerCase())) problemas.push(`autor ${commit.autor}`);
  if (!aceitos.committers.has(commit.committer.toLowerCase())) problemas.push(`committer ${commit.committer}`);
  return problemas;
}

function verificar(ctx) {
  const { emailsDeAutor, emailsDeCommitter, julgaCommitsAPartirDe } = ctx.config.autoria;
  const aceitos = { autores: minusculos(emailsDeAutor), committers: minusculos([...emailsDeAutor, ...emailsDeCommitter]) };
  const corte = Date.parse(julgaCommitsAPartirDe);
  const achados = [];
  for (const commit of commitsDaPr(ctx.raiz, ctx.mudancas.base.topo)) {
    if (Date.parse(commit.dataDoAutor) < corte) continue;
    const problemas = problemasDe(commit, aceitos);
    if (problemas.length) achados.push({ arquivo: commit.sha.slice(0, 7), detalhe: `${commit.assunto}: ${problemas.join(', ')}` });
  }
  return achados;
}

module.exports = { id, titulo, conserto, verificar };
