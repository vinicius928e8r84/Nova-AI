'use strict';

const { commitsDaPr, commitsJulgados } = require('./commits-da-pr');

const id = 'autoria';
const titulo = 'Os commits novos da PR têm o e-mail do repositório';
const conserto = 'Refaça a autoria dos commits novos com o e-mail do repositório (chave autoria em scripts/regras/configuracao.json): '
  + '`git config user.email <e-mail>` e `git rebase --exec "git commit --amend --no-edit --reset-author" <branch-alvo>`. '
  + 'Commits de antes de julgaCommitsAPartirDe não são julgados.';

const minusculos = emails => new Set(emails.map(email => email.toLowerCase()));

function problemasDe(commit, aceitos) {
  const problemas = [];
  if (!aceitos.autores.has(commit.autor.toLowerCase())) problemas.push(`autor ${commit.autor}`);
  if (!aceitos.committers.has(commit.committer.toLowerCase())) problemas.push(`committer ${commit.committer}`);
  return problemas;
}

function verificar(ctx) {
  const { emailsDeAutor, emailsDeCommitter } = ctx.config.autoria;
  const aceitos = { autores: minusculos(emailsDeAutor), committers: minusculos([...emailsDeAutor, ...emailsDeCommitter]) };
  const achados = [];
  for (const commit of commitsJulgados(commitsDaPr(ctx.raiz, ctx.mudancas.base.topo), ctx.config)) {
    const problemas = problemasDe(commit, aceitos);
    if (problemas.length) achados.push({ arquivo: commit.sha.slice(0, 7), detalhe: `${commit.assunto}: ${problemas.join(', ')}` });
  }
  return achados;
}

module.exports = { id, titulo, conserto, verificar };
