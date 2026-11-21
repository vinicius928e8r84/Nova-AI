#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { ErroDeUso, lerArquivo, lerMudancas, resolverBase, tentar } = require('./git');
const { classificar, resumo } = require('./risco');
const { extensaoDe } = require('./globs');
const caminhosSensiveis = require('./caminhos-sensiveis.json');
const { atualizarLinhasDeBase, criarLinhasDeBase, regrasDaLinhaDeBase } = require('./linha-de-base');
const linhas = require('./regra-linhas');

const REGRAS = [
  require('./regra-comentario'),
  linhas,
  require('./regra-segredo'),
  require('./regra-binario'),
  require('./regra-debug'),
  require('./regra-sintaxe'),
  require('./regra-eslint'),
  require('./regra-saude'),
];

const AJUDA = `uso: node scripts/regras/verificar.js [--raiz <pasta>] [--base <ref>] [--regra <id>]... [--lista]
                                     [--criar-linha-de-base | --atualizar-linha-de-base]

Confere o que a mudança (merge-base com a base até a árvore de trabalho) acrescenta ou toca; linha que a mudança não toca nunca falha.

  --base <ref>                 a branch-alvo (padrão: $REGRAS_BASE, senão origin/main)
  --raiz <pasta>               outro repositório (os testes usam)
  --regra <id>                 roda só esta regra (pode repetir)
  --lista                      lista as regras e sai
  --criar-linha-de-base        cria em scripts/regras/linha-de-base.json a linha de base que ainda falta
                               (com --regra, só a dessa regra: limite-de-linhas ou saude-do-codigo)
  --atualizar-linha-de-base    baixa a linha de base depois de melhorar ou mover um arquivo (nunca sobe;
                               com --regra, só a dessa regra)
  --help                       esta ajuda

Sai com 0 se tudo passa, 1 se alguma regra falha, 2 em erro de uso.`;

const BANDEIRAS_SEM_VALOR = new Map([
  ['--help', 'ajuda'],
  ['-h', 'ajuda'],
  ['--lista', 'lista'],
  ['--criar-linha-de-base', 'criar'],
  ['--atualizar-linha-de-base', 'atualizar'],
]);
const BANDEIRAS_COM_VALOR = new Set(['--raiz', '--base', '--regra']);

function guardarValor(opcoes, bandeira, valor) {
  if (valor === undefined || valor.startsWith('--')) throw new ErroDeUso(`${bandeira} precisa de um valor`);
  if (bandeira === '--regra') opcoes.regras.push(valor);
  else opcoes[bandeira.slice(2)] = valor;
}

function lerBandeiras(argv) {
  const opcoes = { regras: [], raiz: null, base: null, lista: false, criar: false, atualizar: false, ajuda: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (BANDEIRAS_SEM_VALOR.has(arg)) opcoes[BANDEIRAS_SEM_VALOR.get(arg)] = true;
    else if (BANDEIRAS_COM_VALOR.has(arg)) guardarValor(opcoes, arg, argv[++i]);
    else throw new ErroDeUso(`bandeira desconhecida: ${arg}`);
  }
  return opcoes;
}

function lerArgumentos(argv) {
  const opcoes = lerBandeiras(argv);
  const desconhecida = opcoes.regras.find(id => !REGRAS.some(r => r.id === id));
  if (desconhecida !== undefined) throw new ErroDeUso(`regra desconhecida: ${desconhecida}`);
  if (opcoes.criar && opcoes.atualizar) throw new ErroDeUso('--criar-linha-de-base e --atualizar-linha-de-base não andam juntas');
  return opcoes;
}

function contexto(raiz, base, env, avisos) {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'configuracao.json'), 'utf8'));
  const mudancas = lerMudancas(raiz, base, config);
  const cache = new Map();
  const ler = caminho => {
    if (!cache.has(caminho)) cache.set(caminho, lerArquivo(raiz, caminho));
    return cache.get(caminho);
  };
  const arquivos = mudancas.itens.filter(item => item.status !== 'D');
  return { raiz, config, mudancas, arquivos, ler, env, aviso: texto => avisos.push(texto) };
}

const MAXIMO_POR_ARQUIVO = 10;

const semLinhaNova = numeros => !numeros || !numeros.size;
const temConteudoConferido = caminho => caminhosSensiveis.extensoesDoConteudo.includes(extensaoDe(caminho));

function linhasAcrescentadasDe(ctx, caminho) {
  const numeros = ctx.mudancas.acrescentadas.get(caminho);
  if (semLinhaNova(numeros) || !temConteudoConferido(caminho)) return [];
  const arquivo = ctx.ler(caminho);
  if (!arquivo || arquivo.binario) return [];
  const texto = arquivo.texto.split('\n');
  return [...numeros].map(n => texto[n - 1] || '');
}

function agruparPorArquivo(achados) {
  const porArquivo = new Map();
  for (const achado of achados) {
    if (!porArquivo.has(achado.arquivo)) porArquivo.set(achado.arquivo, []);
    porArquivo.get(achado.arquivo).push(achado);
  }
  return porArquivo;
}

const linhaDoAchado = (arquivo, achado) => `    ${arquivo}${achado.linha ? `:${achado.linha}` : ''}: ${achado.detalhe}`;

function linhasDoArquivo(arquivo, lista) {
  const saida = lista.slice(0, MAXIMO_POR_ARQUIVO).map(achado => linhaDoAchado(arquivo, achado));
  if (lista.length > MAXIMO_POR_ARQUIVO) saida.push(`    ${arquivo}: … e mais ${lista.length - MAXIMO_POR_ARQUIVO}`);
  return saida;
}

function formatar(regra, achados) {
  const corpo = [...agruparPorArquivo(achados)].flatMap(([arquivo, lista]) => linhasDoArquivo(arquivo, lista));
  return [`✗ ${regra.id} — ${regra.titulo}`, ...corpo, `  Conserto: ${regra.conserto}`].join('\n');
}

function raizDoRepositorio(opcoes) {
  const raiz = opcoes.raiz ? path.resolve(opcoes.raiz) : path.resolve(__dirname, '..', '..');
  if (tentar(raiz, ['rev-parse', '--show-toplevel']) === null) throw new ErroDeUso(`${raiz} não é um repositório git`);
  return raiz;
}

const regrasEscolhidas = pedidas => REGRAS.filter(regra => !pedidas.length || pedidas.includes(regra.id));

function rodarRegras(ctx, regras) {
  const falhas = [];
  for (const regra of regras) {
    const achados = regra.verificar(ctx);
    if (achados.length) falhas.push(formatar(regra, achados));
    else console.log(`✓ ${regra.id}`);
  }
  return falhas;
}

function relatarRisco(ctx) {
  const risco = classificar(ctx.arquivos.map(item => ({ caminho: item.caminho, adicionadas: linhasAcrescentadasDe(ctx, item.caminho) })), caminhosSensiveis);
  console.log(risco.alta ? `risco: ALTA — a PR precisa de "Atenção: ALTA" e da seção Prova real:\n  ${resumo(risco.motivos).join('\n  ')}` : 'risco: nenhum caminho sensível mudou');
}

function conferir(ctx, pedidas, avisos) {
  const escolhidas = regrasEscolhidas(pedidas);
  const falhas = rodarRegras(ctx, escolhidas);
  relatarRisco(ctx);
  for (const aviso of avisos) console.log(`aviso: ${aviso}`);
  if (falhas.length) {
    console.log(`\n${falhas.join('\n\n')}\n\nerror: ${falhas.length} regra(s) falharam em ${ctx.mudancas.base.ref}..HEAD`);
    return 1;
  }
  console.log(`regras ok (${escolhidas.length}) em ${ctx.mudancas.base.ref}..HEAD`);
  return 0;
}

function main(argv, env = process.env) {
  const opcoes = lerArgumentos(argv);
  if (opcoes.ajuda) {
    console.log(AJUDA);
    return 0;
  }
  if (opcoes.lista) {
    for (const regra of REGRAS) console.log(`${regra.id}: ${regra.titulo}`);
    return 0;
  }
  const raiz = raizDoRepositorio(opcoes);
  const base = resolverBase(raiz, opcoes.base, env);
  if (!base) {
    console.log('aviso: sem base de comparação (primeiro push de uma branch); nada foi conferido');
    return 0;
  }
  const avisos = [];
  const ctx = contexto(raiz, base, env, avisos);
  if (opcoes.criar) return criarLinhasDeBase(ctx, regrasDaLinhaDeBase(REGRAS, opcoes.regras));
  if (opcoes.atualizar) return atualizarLinhasDeBase(ctx, regrasDaLinhaDeBase(REGRAS, opcoes.regras));
  return conferir(ctx, opcoes.regras, avisos);
}

function rodar(argv) {
  try {
    return main(argv);
  } catch (erro) {
    console.log(`error: ${erro.message}${erro instanceof ErroDeUso ? '\nhelp: node scripts/regras/verificar.js --help' : ''}`);
    return erro instanceof ErroDeUso ? 2 : 1;
  }
}

module.exports = { REGRAS, main, rodar };

if (require.main === module) process.exitCode = rodar(process.argv.slice(2));
