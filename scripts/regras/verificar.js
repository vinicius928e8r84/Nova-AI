#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { ErroDeUso, lerArquivo, lerMudancas, resolverBase, tentar } = require('./git');
const { classificar, resumo } = require('./risco');
const { extensaoDe } = require('./globs');
const caminhosSensiveis = require('./caminhos-sensiveis.json');
const { ARQUIVO_DA_LINHA_DE_BASE, gravarChave, lerDoDisco } = require('./linha-de-base');
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

const COM_LINHA_DE_BASE = REGRAS.filter(regra => regra.linhaDeBase);

const AJUDA = `uso: node scripts/regras/verificar.js [--raiz <pasta>] [--base <ref>] [--regra <id>]... [--lista]
                                     [--criar-linha-de-base | --atualizar-linha-de-base] [--regra <id>]

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

function lerArgumentos(argv) {
  const opcoes = { regras: [], raiz: null, base: null, lista: false, criar: false, atualizar: false, ajuda: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') opcoes.ajuda = true;
    else if (arg === '--lista') opcoes.lista = true;
    else if (arg === '--criar-linha-de-base') opcoes.criar = true;
    else if (arg === '--atualizar-linha-de-base') opcoes.atualizar = true;
    else if (['--raiz', '--base', '--regra'].includes(arg)) {
      const valor = argv[++i];
      if (valor === undefined || valor.startsWith('--')) throw new ErroDeUso(`${arg} precisa de um valor`);
      if (arg === '--regra') opcoes.regras.push(valor);
      else opcoes[arg.slice(2)] = valor;
    } else throw new ErroDeUso(`bandeira desconhecida: ${arg}`);
  }
  for (const id of opcoes.regras) if (!REGRAS.some(r => r.id === id)) throw new ErroDeUso(`regra desconhecida: ${id}`);
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

function linhasAcrescentadasDe(ctx, caminho) {
  const numeros = ctx.mudancas.acrescentadas.get(caminho);
  if (!numeros || !numeros.size || !caminhosSensiveis.extensoesDoConteudo.includes(extensaoDe(caminho))) return [];
  const arquivo = ctx.ler(caminho);
  if (!arquivo || arquivo.binario) return [];
  const linhas = arquivo.texto.split('\n');
  return [...numeros].map(n => linhas[n - 1] || '');
}

function formatar(regra, achados) {
  const porArquivo = new Map();
  for (const achado of achados) {
    if (!porArquivo.has(achado.arquivo)) porArquivo.set(achado.arquivo, []);
    porArquivo.get(achado.arquivo).push(achado);
  }
  const corpo = [];
  for (const [arquivo, lista] of porArquivo) {
    for (const achado of lista.slice(0, 10)) corpo.push(`    ${arquivo}${achado.linha ? `:${achado.linha}` : ''}: ${achado.detalhe}`);
    if (lista.length > 10) corpo.push(`    ${arquivo}: … e mais ${lista.length - 10}`);
  }
  return [`✗ ${regra.id} — ${regra.titulo}`, ...corpo, `  Conserto: ${regra.conserto}`].join('\n');
}

function regrasDaLinhaDeBase(opcoes) {
  const semLinhaDeBase = opcoes.regras.filter(id => !COM_LINHA_DE_BASE.some(regra => regra.id === id));
  if (semLinhaDeBase.length) {
    throw new ErroDeUso(`${semLinhaDeBase.join(', ')} não tem linha de base; as que têm: ${COM_LINHA_DE_BASE.map(regra => regra.id).join(', ')}`);
  }
  return COM_LINHA_DE_BASE.filter(regra => !opcoes.regras.length || opcoes.regras.includes(regra.id));
}

function criarLinhasDeBase(ctx, regras) {
  const atual = lerDoDisco(ctx.raiz) || {};
  const faltam = regras.filter(regra => !(regra.linhaDeBase.chave in atual));
  if (!faltam.length) {
    throw new ErroDeUso(`${ARQUIVO_DA_LINHA_DE_BASE} já tem a linha de base de ${regras.map(regra => regra.id).join(', ')}; ela só encolhe (--atualizar-linha-de-base)`);
  }
  for (const regra of faltam) {
    const porArquivo = regra.linhaDeBase.calcular(ctx);
    gravarChave(ctx.raiz, regra.linhaDeBase.chave, porArquivo);
    console.log(`linha de base de ${regra.id} criada com ${Object.keys(porArquivo).length} arquivo(s)`);
  }
  return 0;
}

function atualizarLinhasDeBase(ctx, regras) {
  const atual = lerDoDisco(ctx.raiz);
  if (!atual) throw new ErroDeUso(`${ARQUIVO_DA_LINHA_DE_BASE} não existe; crie-a com --criar-linha-de-base`);
  const resultados = regras.filter(regra => regra.linhaDeBase.ler(atual))
    .map(regra => ({ regra, ...regra.linhaDeBase.atualizar(ctx, regra.linhaDeBase.ler(atual)) }));
  const erros = resultados.flatMap(resultado => resultado.erros);
  if (erros.length) {
    console.log(`${erros.map(e => `✗ ${e}`).join('\n')}\nnada foi atualizado: a linha de base só encolhe`);
    return 1;
  }
  for (const { regra, nova } of resultados) {
    gravarChave(ctx.raiz, regra.linhaDeBase.chave, nova);
    console.log(`linha de base de ${regra.id} atualizada: ${Object.keys(nova).length} arquivo(s)`);
  }
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
  const raiz = opcoes.raiz ? path.resolve(opcoes.raiz) : path.resolve(__dirname, '..', '..');
  if (tentar(raiz, ['rev-parse', '--show-toplevel']) === null) throw new ErroDeUso(`${raiz} não é um repositório git`);
  const base = resolverBase(raiz, opcoes.base, env);
  if (!base) {
    console.log('aviso: sem base de comparação (primeiro push de uma branch); nada foi conferido');
    return 0;
  }
  const avisos = [];
  const ctx = contexto(raiz, base, env, avisos);

  if (opcoes.criar) return criarLinhasDeBase(ctx, regrasDaLinhaDeBase(opcoes));
  if (opcoes.atualizar) return atualizarLinhasDeBase(ctx, regrasDaLinhaDeBase(opcoes));

  const escolhidas = REGRAS.filter(regra => !opcoes.regras.length || opcoes.regras.includes(regra.id));
  const falhas = [];
  for (const regra of escolhidas) {
    const achados = regra.verificar(ctx);
    if (achados.length) falhas.push(formatar(regra, achados));
    else console.log(`✓ ${regra.id}`);
  }
  const risco = classificar(ctx.arquivos.map(item => ({ caminho: item.caminho, adicionadas: linhasAcrescentadasDe(ctx, item.caminho) })), caminhosSensiveis);
  console.log(risco.alta ? `risco: ALTA — a PR precisa de "Atenção: ALTA" e da seção Prova real:\n  ${resumo(risco.motivos).join('\n  ')}` : 'risco: nenhum caminho sensível mudou');
  for (const aviso of avisos) console.log(`aviso: ${aviso}`);
  if (falhas.length) {
    console.log(`\n${falhas.join('\n\n')}\n\nerror: ${falhas.length} regra(s) falharam em ${base.ref}..HEAD`);
    return 1;
  }
  console.log(`regras ok (${escolhidas.length}) em ${base.ref}..HEAD`);
  return 0;
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
