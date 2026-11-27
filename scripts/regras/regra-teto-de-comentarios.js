'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const { bytesDaBase, origemNaBase } = require('./git');
const { linhasDeComentario } = require('./comentarios');
const { ehCodigoDeComentario } = require('./escopo');
const { permitida } = require('./regra-comentario');

const id = 'teto-de-comentarios';
const titulo = 'Catraca de comentários: nenhum arquivo tocado tem mais linhas de comentário do que tinha';

const conserto = 'Apague o comentário. O que ele explicava vai para o nome da função ou da variável; a decisão (o porquê) vai para um ADR em docs/adr/; '
  + 'a gambiarra que ele desculpava vira uma issue. O teto de cada arquivo é a contagem que ele tem na branch-alvo; '
  + 'arquivo novo ou que não está lá tem teto 0, e um arquivo que chegou a zero não pode voltar a ter comentário. '
  + 'Só um arquivo movido com `git mv` leva o seu teto; cópia não leva.';

const DOCSTRINGS = path.join(__dirname, 'docstrings.py');

function trechosDeDocstring(ctx, texto) {
  const python = ctx.env.PYTHON || 'python3';
  const resultado = spawnSync(python, ['-I', DOCSTRINGS], { input: texto, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (resultado.status === 0) return JSON.parse(resultado.stdout);
  const motivo = `não consegui ler as docstrings com \`${python}\` (instale o Python 3 ou aponte PYTHON=)`;
  if (ctx.env.REGRAS_EXIGE_FERRAMENTAS) throw new Error(`${id}: ${motivo}`);
  ctx.aviso(`${id}: ${motivo}; as docstrings ficaram fora da contagem`);
  return [];
}

function linhasDeDocstring(ctx, texto) {
  const linhas = texto.split('\n');
  return trechosDeDocstring(ctx, texto).reduce((soma, [de, ate]) => soma + linhas.slice(de - 1, ate).filter(linha => linha.trim()).length, 0);
}

function linhasDeProsa(caminho, texto) {
  return linhasDeComentario(caminho, texto).filter(({ linha, corpo, bruto }) => corpo && !permitida(linha, corpo, bruto)).length;
}

const temTexto = arquivo => Boolean(arquivo) && !arquivo.binario;

function contarNoArquivo(ctx, caminho, arquivo) {
  if (!temTexto(arquivo)) return 0;
  if (!ehCodigoDeComentario(ctx.config, caminho, arquivo.texto)) return 0;
  const dePython = caminho.endsWith('.py') ? linhasDeDocstring(ctx, arquivo.texto) : 0;
  return linhasDeProsa(caminho, arquivo.texto) + dePython;
}

function contarNaBase(ctx, caminho) {
  const bytes = bytesDaBase(ctx.raiz, ctx.mudancas.base.desde, caminho);
  if (bytes === null || bytes.subarray(0, 8000).includes(0)) return 0;
  return contarNoArquivo(ctx, caminho, { binario: false, texto: bytes.toString('utf8') });
}

function tetoDe(ctx, item) {
  const origem = origemNaBase(item);
  return origem === null ? 0 : contarNaBase(ctx, origem);
}

function acimaDoTeto(tem, teto) {
  const aviso = teto === 0 ? ' (arquivo novo ou sem comentário não ganha comentário)' : '';
  return `${tem} linha(s) de comentário; o teto é ${teto}, a contagem dele na branch-alvo${aviso}: apague ${tem - teto}`;
}

function conferirArquivo(ctx, item, falha) {
  const tem = contarNoArquivo(ctx, item.caminho, ctx.ler(item.caminho));
  const teto = tetoDe(ctx, item);
  if (tem > teto) falha(item.caminho, acimaDoTeto(tem, teto));
}

function verificar(ctx) {
  const achados = [];
  const falha = (arquivo, detalhe) => achados.push({ arquivo, detalhe });
  for (const item of ctx.arquivos) {
    if (!ctx.mudancas.copias.has(item.caminho)) conferirArquivo(ctx, item, falha);
  }
  return achados;
}

module.exports = { id, titulo, conserto, verificar, contarNoArquivo, linhasDeProsa };
