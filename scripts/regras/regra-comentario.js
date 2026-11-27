'use strict';

const { execFileSync } = require('child_process');
const path = require('path');
const { linhasDeComentario } = require('./comentarios');
const { ehCodigoDeComentario } = require('./escopo');

const id = 'sem-comentario-novo';
const titulo = 'Nenhum comentário novo nas linhas acrescentadas';
const conserto = 'Apague o comentário. O que ele explicava vai para o nome da função ou da variável; a decisão (o porquê) vai para o corpo da PR '
  + 'ou para a documentação. Passam só a linha 1 `#!`, as diretivas de ferramenta (@ts-*, noqa, type: ignore, '
  + 'istanbul/c8 ignore, prettier-ignore, coding:) e o cabeçalho de licença (SPDX-License-Identifier, Copyright) nas 5 primeiras linhas. '
  + 'Um comentário que já existia numa linha que a mudança tocou, reindentou ou moveu também conta: apague-o.';

const DIRETIVAS = [
  /^@ts-(?:ignore|expect-error|nocheck|check)$/,
  /^noqa(?::\s*[A-Z]+\d*(?:\s*,\s*[A-Z]+\d*)*)?$/,
  /^type:\s*ignore(?:\[[\w,\s-]+\])?$/,
  /^istanbul\s+ignore\s+(?:next|if|else|file)$/,
  /^c8\s+ignore\s+(?:next|start|stop|file)(?:\s+\d+)?$/,
  /^prettier-ignore(?:-start|-end)?$/,
  /^(?:-\*-\s*coding:\s*[\w.-]+\s*-\*-|coding[:=]\s*[\w.-]+)$/,
];
const LICENCA = [
  /^SPDX-License-Identifier:\s*[\w.+-]+(?:\s+(?:AND|OR|WITH)\s+[\w.+-]+)*$/,
  /^(?:SPDX-FileCopyrightText:\s*)?(?:Copyright(?:\s+\(c\)|\s+©)?|©)\s+\d{4}(?:\s*[-,]\s*\d{4})*\s+[\p{L}.'-]+(?:\s[\p{L}.'-]+){0,3}$/u,
];
const ATE_A_LINHA_DA_LICENCA = 5;
const SHEBANG = /^#![ \t]*\/\S+(?:[ \t]+-\S*)*(?:[ \t]+[\w.+][\w.+-]*(?:[ \t]+-\S*)*)?[ \t\r]*$/;

const permitida = (linha, corpo, bruto) => {
  if (linha === 1 && SHEBANG.test(bruto)) return true;
  if (DIRETIVAS.some(d => d.test(corpo))) return true;
  return linha <= ATE_A_LINHA_DA_LICENCA && LICENCA.some(l => l.test(corpo));
};

function docstringsDePython(fonte) {
  try {
    const saida = execFileSync('python3', ['-I', path.join(__dirname, 'docstrings.py')], { input: fonte, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    return JSON.parse(saida);
  } catch {
    return [];
  }
}

const resumoDoComentario = corpo => (corpo.length > 70 ? `${corpo.slice(0, 67)}…` : corpo);

const ehComentarioNovo = (novas, { linha, corpo, bruto }) => novas.has(linha) && Boolean(corpo) && !permitida(linha, corpo, bruto);

function alvoComLinhasNovas(ctx, caminho) {
  const novas = ctx.mudancas.acrescentadas.get(caminho);
  if (!novas || novas.size === 0) return null;
  const arquivo = ctx.ler(caminho);
  if (!arquivo || arquivo.binario) return null;
  if (!ehCodigoDeComentario(ctx.config, caminho, arquivo.texto)) return null;
  return { caminho, texto: arquivo.texto, novas };
}

function achadosDeComentario({ caminho, texto, novas }) {
  return linhasDeComentario(caminho, texto)
    .filter(comentario => ehComentarioNovo(novas, comentario))
    .map(({ linha, corpo }) => ({ arquivo: caminho, linha, detalhe: `comentário novo: “${resumoDoComentario(corpo)}”` }));
}

function primeiraLinhaNovaDaDocstring([de, ate], novas, vistas) {
  for (let linha = de; linha <= ate; linha++) if (novas.has(linha) && !vistas.has(linha)) return linha;
  return null;
}

function achadosDeDocstring({ caminho, texto, novas }, vistas) {
  if (!caminho.endsWith('.py')) return [];
  return docstringsDePython(texto)
    .map(faixa => primeiraLinhaNovaDaDocstring(faixa, novas, vistas))
    .filter(linha => linha !== null)
    .map(linha => ({ arquivo: caminho, linha, detalhe: 'docstring nova (é um comentário com outro nome)' }));
}

function achadosDoArquivo(ctx, caminho) {
  const alvo = alvoComLinhasNovas(ctx, caminho);
  if (!alvo) return [];
  const doComentario = achadosDeComentario(alvo);
  const vistas = new Set(doComentario.map(({ linha }) => linha));
  return [...doComentario, ...achadosDeDocstring(alvo, vistas)];
}

const verificar = ctx => ctx.arquivos.flatMap(({ caminho }) => achadosDoArquivo(ctx, caminho));

module.exports = { id, titulo, conserto, verificar, permitida };
