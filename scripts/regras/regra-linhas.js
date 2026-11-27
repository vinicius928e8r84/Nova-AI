'use strict';

const fs = require('fs');
const path = require('path');
const { arquivoNaBase, contarLinhas, git, origemNaBase } = require('./git');
const { ehCodigoDoLimite } = require('./escopo');

const id = 'limite-de-linhas';
const titulo = 'Arquivo de código com no máximo 1000 linhas';

const conserto = 'Divida o arquivo por responsabilidade em módulos menores (no máximo 1000 linhas cada) e leve o código novo para um módulo novo, '
  + 'não para o arquivo grande. O teto de um arquivo que já passava do limite é o tamanho que ele tem na branch-alvo: '
  + 'ele pode ser editado e encolhido, nunca crescer, e depois que a PR é mesclada o teto passa a ser o tamanho novo. '
  + 'Só um arquivo movido com `git mv` leva o seu teto; arquivo novo e cópia têm de caber no limite.';

function tamanhoNaBase(ctx, item) {
  const origem = origemNaBase(item);
  if (origem === null || !ehCodigoDoLimite(ctx.config, origem)) return 0;
  const texto = arquivoNaBase(ctx.raiz, ctx.mudancas.base.desde, origem);
  return texto === null ? 0 : contarLinhas(texto);
}

function detalheDoExcesso(linhas, limite, naBase) {
  if (naBase > limite) return `${linhas} linhas; o teto é ${naBase}, o tamanho dele na branch-alvo: arquivo grande não pode crescer (${linhas - naBase} linhas a mais)`;
  return `${linhas} linhas, ${linhas - limite} acima do limite de ${limite}; arquivo novo, ou que na branch-alvo cabia no limite, tem de caber nele`;
}

function achadoDoArquivo(ctx, item) {
  const arquivo = ctx.ler(item.caminho);
  if (!arquivo || arquivo.binario) return null;
  const linhas = contarLinhas(arquivo.texto);
  const limite = ctx.config.limiteDeLinhas;
  if (linhas <= limite) return null;
  const naBase = tamanhoNaBase(ctx, item);
  return linhas > Math.max(limite, naBase) ? { arquivo: item.caminho, detalhe: detalheDoExcesso(linhas, limite, naBase) } : null;
}

function verificar(ctx) {
  return ctx.arquivos.filter(item => ehCodigoDoLimite(ctx.config, item.caminho)).map(item => achadoDoArquivo(ctx, item)).filter(Boolean);
}

function arquivosDoRepositorio(raiz) {
  return git(raiz, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean)
    .filter(caminho => fs.existsSync(path.join(raiz, caminho)));
}

module.exports = { id, titulo, conserto, verificar, arquivosDoRepositorio };
