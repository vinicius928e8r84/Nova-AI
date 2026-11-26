#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { ErroDeUso, lerArquivo, lerMudancas, resolverBase, tentar } = require('./git');
const { classificar, resumo } = require('./risco');
const { soTiraComentario } = require('./so-tira-comentario');
const { extensaoDe } = require('./globs');
const caminhosSensiveis = require('./caminhos-sensiveis.json');
const { atualizarLinhasDeBase, criarLinhasDeBase, regrasDaLinhaDeBase } = require('./linha-de-base');
const linhas = require('./regra-linhas');

const REGRAS = [
  require('./regra-comentario'),
  require('./regra-teto-de-comentarios'),
  linhas,
  require('./regra-segredo-completa'),
  require('./regra-binario'),
  require('./regra-debug'),
  require('./regra-sintaxe'),
  require('./regra-eslint'),
  require('./regra-saude'),
  require('./regra-autoria'),
  require('./regra-tamanho'),
];

const AJUDA = `uso: node scripts/regras/verificar.js [--raiz <pasta>] [--base <ref>] [--regra <id>]... [--lista]
                                     [--criar-linha-de-base | --atualizar-linha-de-base]

Confere o que a mudança (merge-base com a base até a árvore de trabalho) acrescenta ou toca; linha que a mudança não toca nunca falha.

  --base <ref>                 a branch-alvo (padrão: $REGRAS_BASE, senão origin/main)
  --raiz <pasta>               outro repositório (os testes usam)
  --regra <id>                 roda só esta regra (pode repetir)
  --lista                      lista as regras e sai
  --criar-linha-de-base        cria em scripts/regras/linha-de-base.json a linha de base que ainda falta
                               (com --regra, só a dessa regra: limite-de-linhas, saude-do-codigo ou teto-de-comentarios)
  --atualizar-linha-de-base    baixa a linha de base depois de melhorar ou mover um arquivo (nunca sobe;
                               com --regra, só a dessa regra)
  --help                       esta ajuda

Sai com 0 se tudo passa, 1 se alguma regra falha, 2 em erro de uso.`;

const BANDEIRAS = new Map([
  ['--help', 'ajuda'], ['-h', 'ajuda'], ['--lista', 'lista'], ['--criar-linha-de-base', 'criar'], ['--atualizar-linha-de-base', 'atualizar'],
]);
const BANDEIRAS_COM_VALOR = ['--raiz', '--base', '--regra'];

function lerValor(argv, i) {
  const valor = argv[i + 1];
  if (valor === undefined || valor.startsWith('--')) throw new ErroDeUso(`${argv[i]} precisa de um valor`);
  return valor;
}

function guardarValor(opcoes, arg, valor) {
  if (arg === '--regra') opcoes.regras.push(valor);
  else opcoes[arg.slice(2)] = valor;
}

function lerBandeira(opcoes, argv, i) {
  const arg = argv[i];
  if (BANDEIRAS.has(arg)) opcoes[BANDEIRAS.get(arg)] = true;
  else if (!BANDEIRAS_COM_VALOR.includes(arg)) throw new ErroDeUso(`bandeira desconhecida: ${arg}`);
  else guardarValor(opcoes, arg, lerValor(argv, i));
  return BANDEIRAS_COM_VALOR.includes(arg) ? i + 2 : i + 1;
}

function conferirOpcoes(opcoes) {
  for (const id of opcoes.regras) if (!REGRAS.some(r => r.id === id)) throw new ErroDeUso(`regra desconhecida: ${id}`);
  if (opcoes.criar && opcoes.atualizar) throw new ErroDeUso('--criar-linha-de-base e --atualizar-linha-de-base não andam juntas');
  return opcoes;
}

function lerArgumentos(argv) {
  const opcoes = { regras: [], raiz: null, base: null, lista: false, criar: false, atualizar: false, ajuda: false };
  for (let i = 0; i < argv.length;) i = lerBandeira(opcoes, argv, i);
  return conferirOpcoes(opcoes);
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

const temConteudoSensivel = caminho => caminhosSensiveis.extensoesDoConteudo.includes(extensaoDe(caminho));

function textoDasLinhas(ctx, caminho, numeros) {
  const arquivo = ctx.ler(caminho);
  if (!arquivo || arquivo.binario) return [];
  const todas = arquivo.texto.split('\n');
  return [...numeros].map(n => todas[n - 1] || '');
}

function linhasAcrescentadasDe(ctx, caminho) {
  const numeros = ctx.mudancas.acrescentadas.get(caminho);
  if (!numeros || !numeros.size || !temConteudoSensivel(caminho)) return [];
  return textoDasLinhas(ctx, caminho, numeros);
}

function arquivosQueSoTiramComentario(ctx) {
  try {
    return soTiraComentario(ctx.raiz, ctx.mudancas.base.desde, 'HEAD', ctx.env);
  } catch {
    return new Set();
  }
}

function agruparPorArquivo(achados) {
  const porArquivo = new Map();
  for (const achado of achados) {
    if (!porArquivo.has(achado.arquivo)) porArquivo.set(achado.arquivo, []);
    porArquivo.get(achado.arquivo).push(achado);
  }
  return porArquivo;
}

function linhasDoArquivo(arquivo, lista) {
  const corpo = lista.slice(0, 10).map(achado => `    ${arquivo}${achado.linha ? `:${achado.linha}` : ''}: ${achado.detalhe}`);
  if (lista.length > 10) corpo.push(`    ${arquivo}: … e mais ${lista.length - 10}`);
  return corpo;
}

function formatar(regra, achados) {
  const corpo = [...agruparPorArquivo(achados)].flatMap(([arquivo, lista]) => linhasDoArquivo(arquivo, lista));
  return [`✗ ${regra.id} — ${regra.titulo}`, ...corpo, `  Conserto: ${regra.conserto}`].join('\n');
}

function descreverRisco(ctx) {
  const soTiram = arquivosQueSoTiramComentario(ctx);
  const risco = classificar(ctx.arquivos.filter(item => !soTiram.has(item.caminho)).map(item => ({ caminho: item.caminho, adicionadas: linhasAcrescentadasDe(ctx, item.caminho) })), caminhosSensiveis);
  if (soTiram.size) console.log(`${soTiram.size} arquivo(s) só tiram comentário (o código fica igual) e não entram na classificação de risco`);
  console.log(risco.alta ? `risco: ALTA — a PR precisa de "Atenção: ALTA" e da seção Prova real:\n  ${resumo(risco.motivos).join('\n  ')}` : 'risco: nenhum caminho sensível mudou');
}

function responderSemRodar(opcoes) {
  if (opcoes.ajuda) console.log(AJUDA);
  else for (const regra of REGRAS) console.log(`${regra.id}: ${regra.titulo}`);
  return 0;
}

function abrirRepositorio(opcoes, env) {
  const raiz = opcoes.raiz ? path.resolve(opcoes.raiz) : path.resolve(__dirname, '..', '..');
  if (tentar(raiz, ['rev-parse', '--show-toplevel']) === null) throw new ErroDeUso(`${raiz} não é um repositório git`);
  return { raiz, base: resolverBase(raiz, opcoes.base, env) };
}

function mexerNaLinhaDeBase(opcoes, ctx) {
  const regras = regrasDaLinhaDeBase(REGRAS, opcoes.regras);
  return opcoes.criar ? criarLinhasDeBase(ctx, regras) : atualizarLinhasDeBase(ctx, regras);
}

function rodarRegras(escolhidas, ctx) {
  const falhas = [];
  for (const regra of escolhidas) {
    const achados = regra.verificar(ctx);
    if (achados.length) falhas.push(formatar(regra, achados));
    else console.log(`✓ ${regra.id}`);
  }
  return falhas;
}

function encerrar(falhas, escolhidas, base) {
  if (falhas.length) {
    console.log(`\n${falhas.join('\n\n')}\n\nerror: ${falhas.length} regra(s) falharam em ${base.ref}..HEAD`);
    return 1;
  }
  console.log(`regras ok (${escolhidas.length}) em ${base.ref}..HEAD`);
  return 0;
}

function conferirMudanca(opcoes, ctx, base) {
  const escolhidas = REGRAS.filter(regra => !opcoes.regras.length || opcoes.regras.includes(regra.id));
  const falhas = rodarRegras(escolhidas, ctx);
  descreverRisco(ctx);
  return { falhas, escolhidas, base };
}

function main(argv, env = process.env) {
  const opcoes = lerArgumentos(argv);
  if (opcoes.ajuda || opcoes.lista) return responderSemRodar(opcoes);
  const { raiz, base } = abrirRepositorio(opcoes, env);
  if (!base) {
    console.log('aviso: sem base de comparação (primeiro push de uma branch); nada foi conferido');
    return 0;
  }
  const avisos = [];
  const ctx = contexto(raiz, base, env, avisos);
  if (opcoes.criar || opcoes.atualizar) return mexerNaLinhaDeBase(opcoes, ctx);
  const { falhas, escolhidas } = conferirMudanca(opcoes, ctx, base);
  for (const aviso of avisos) console.log(`aviso: ${aviso}`);
  return encerrar(falhas, escolhidas, base);
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
