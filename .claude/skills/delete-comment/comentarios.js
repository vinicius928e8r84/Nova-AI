#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { blocosDe, deixariaVazio, removerBlocos } = require('./blocos');

const RAIZ = path.resolve(__dirname, '..', '..', '..');
const REGRAS = path.join(RAIZ, 'scripts', 'regras');
const python = () => process.env.PYTHON || 'python3';
const imprimir = texto => process.stdout.write(`${texto}\n`);

const AJUDA = `uso: node .claude/skills/delete-comment/comentarios.js <comando>

  listar <arquivo>... [--json]      cada comentário de prosa (e docstring) do arquivo, agrupado em blocos, com as linhas
  apagar <arquivo> <linhas>...      apaga os blocos que cobrem as linhas dadas (12, 12-15); o resto do arquivo não muda
  restantes [prefixo] [--por-pasta] quanto comentário ainda há, por arquivo ou por pasta, e o total de linhas a menos
  conferir <ref>                    diz, arquivo a arquivo, se a mudança desde <ref> só tirou comentário`;

const lerTexto = arquivo => fs.readFileSync(path.join(RAIZ, arquivo), 'utf8');
const resumir = texto => (texto.length > 150 ? `${texto.slice(0, 147)}...` : texto);
const intervalo = bloco => (bloco.ate > bloco.de ? `${bloco.de}-${bloco.ate}` : String(bloco.de));

function listar(arquivos, json) {
  const saida = arquivos.map(arquivo => ({ arquivo, blocos: blocosDe(arquivo, lerTexto(arquivo), python()).map(({ id, de, ate, tipo, inteira, texto }) => ({ id, de, ate, tipo, inteira, texto })) }));
  if (json) return imprimir(JSON.stringify(saida, null, 2));
  for (const { arquivo, blocos } of saida) {
    for (const bloco of blocos) imprimir(`${arquivo}:${intervalo(bloco)}\t${bloco.tipo}\t${resumir(bloco.texto)}`);
  }
  return undefined;
}

function lerAlvos(alvos) {
  return alvos.map(alvo => {
    const [de, ate = de] = alvo.split('-').map(Number);
    if (!Number.isInteger(de) || !Number.isInteger(ate)) throw new Error(`linha inválida: ${alvo}`);
    return { de, ate };
  });
}

const cobre = (alvo, bloco) => bloco.de <= alvo.ate && bloco.ate >= alvo.de;

function escolher(blocos, alvos) {
  const escolhidos = new Set();
  for (const alvo of alvos) {
    const achados = blocos.filter(bloco => cobre(alvo, bloco));
    if (!achados.length) throw new Error(`nenhum comentário nas linhas ${alvo.de}-${alvo.ate}`);
    achados.forEach(bloco => escolhidos.add(bloco));
  }
  return [...escolhidos];
}

function apagar(arquivo, alvos) {
  const fonte = lerTexto(arquivo);
  const escolhidos = escolher(blocosDe(arquivo, fonte, python()), lerAlvos(alvos));
  const vazio = escolhidos.find(bloco => deixariaVazio(fonte, bloco));
  if (vazio) throw new Error(`a docstring das linhas ${intervalo(vazio)} é o único corpo do bloco: apague o bloco ou troque por pass`);
  fs.writeFileSync(path.join(RAIZ, arquivo), removerBlocos(fonte, escolhidos));
  const linhas = escolhidos.reduce((soma, bloco) => soma + (bloco.ate - bloco.de + 1), 0);
  imprimir(`${arquivo}: ${escolhidos.length} bloco(s), ${linhas} linha(s) de comentário apagadas`);
}

function contagens(prefixo) {
  const { contarNoArquivo } = require(path.join(REGRAS, 'regra-teto-de-comentarios'));
  const { arquivosDoRepositorio } = require(path.join(REGRAS, 'regra-linhas'));
  const { lerArquivo } = require(path.join(REGRAS, 'git'));
  const ctx = { config: require(path.join(REGRAS, 'configuracao.json')), env: process.env, aviso: texto => console.error(texto) };
  const porArquivo = new Map();
  for (const arquivo of arquivosDoRepositorio(RAIZ).filter(caminho => caminho.startsWith(prefixo))) {
    const quantas = contarNoArquivo(ctx, arquivo, lerArquivo(RAIZ, arquivo));
    if (quantas) porArquivo.set(arquivo, quantas);
  }
  return porArquivo;
}

const pastaDe = arquivo => arquivo.split('/').slice(0, 3).join('/');

function agrupar(porArquivo) {
  const porPasta = new Map();
  for (const [arquivo, quantas] of porArquivo) porPasta.set(pastaDe(arquivo), (porPasta.get(pastaDe(arquivo)) || 0) + quantas);
  return porPasta;
}

function restantes(prefixo, porPasta) {
  const porArquivo = contagens(prefixo);
  const linhas = porPasta ? agrupar(porArquivo) : porArquivo;
  for (const [nome, quantas] of [...linhas].sort((a, b) => b[1] - a[1])) imprimir(`${String(quantas).padStart(5)}  ${nome}`);
  imprimir(`${String([...porArquivo.values()].reduce((soma, quantas) => soma + quantas, 0)).padStart(5)}  total em ${porArquivo.size} arquivo(s)`);
}

function conferir(ref) {
  const { conferirMudanca } = require(path.join(REGRAS, 'so-tira-comentario'));
  const { git } = require(path.join(REGRAS, 'git'));
  const desde = git(RAIZ, ['merge-base', ref, 'HEAD']).trim();
  const resultados = conferirMudanca(RAIZ, desde, 'HEAD');
  for (const r of resultados) imprimir(r.ok ? `ok   ${r.caminho} (${r.saiu} a menos)` : `não  ${r.caminho}: ${r.motivo}`);
  return resultados.every(r => r.ok) ? 0 : 1;
}

const COMANDOS = {
  listar: ([...resto]) => listar(resto.filter(a => a !== '--json'), resto.includes('--json')),
  apagar: ([arquivo, ...alvos]) => apagar(arquivo, alvos),
  restantes: ([...resto]) => restantes(resto.find(a => !a.startsWith('--')) || '', resto.includes('--por-pasta')),
  conferir: ([ref]) => conferir(ref),
};

function main(argv) {
  const [comando, ...resto] = argv;
  if (!COMANDOS[comando]) {
    imprimir(AJUDA);
    return 2;
  }
  try {
    return COMANDOS[comando](resto) || 0;
  } catch (erro) {
    console.error(`erro: ${erro.message}`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { main };
