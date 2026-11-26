'use strict';

const fs = require('fs');
const path = require('path');
const { contarLinhas, git, arquivoNaBase } = require('./git');
const { ehCodigoDoLimite } = require('./escopo');
const { ARQUIVO_DA_LINHA_DE_BASE, gravarChave } = require('./linha-de-base');

const id = 'limite-de-linhas';
const titulo = 'Arquivo de código com no máximo 1000 linhas';
const ATUALIZAR = `node scripts/regras/verificar.js --atualizar-linha-de-base --regra ${id}`;

const conserto = 'Divida o arquivo por responsabilidade em módulos menores (no máximo 1000 linhas cada) e leve o código novo para um módulo novo, '
  + 'não para o arquivo grande. A linha de base (scripts/regras/linha-de-base.json) lista os arquivos que já passavam do limite: ela só encolhe. '
  + 'O teto de cada um deles é o tamanho que ele tem na branch-alvo: encolher passa sem editar a linha de base, que pode ser baixada com '
  + '`node scripts/regras/verificar.js --atualizar-linha-de-base`.';

function lerLista(texto, origem) {
  let dados;
  try {
    dados = JSON.parse(texto);
  } catch (erro) {
    throw new Error(`${origem} não é um JSON válido (${erro.message})`);
  }
  if (!dados || typeof dados.arquivos !== 'object') throw new Error(`${origem} precisa ter o objeto "arquivos"`);
  return dados.arquivos;
}

function renomeados(mudancas) {
  const mapa = new Map();
  for (const item of mudancas.itens) if (item.status === 'R') mapa.set(item.caminho, item.antigo);
  return mapa;
}

function tamanhoNaBase(ctx, caminho, antigo) {
  const texto = arquivoNaBase(ctx.raiz, ctx.mudancas.base.desde, antigo !== undefined ? antigo : caminho);
  return texto === null ? undefined : contarLinhas(texto);
}

function tetoDoArquivo(ctx, doTeto, caminho, antigo) {
  const daLista = caminho in doTeto ? doTeto[caminho] : doTeto[antigo];
  if (daLista === undefined) return undefined;
  const real = tamanhoNaBase(ctx, caminho, antigo);
  return real === undefined ? daLista : Math.min(daLista, real);
}

function conferirGrande({ aviso, falha, caminho, linhas, teto, daLinhaDeBase, limite }) {
  if (linhas > teto) {
    falha(caminho, `${linhas} linhas; o teto é ${teto} (o menor entre a linha de base e o tamanho na branch-alvo): arquivo grande não pode crescer (${linhas - teto} linhas a mais)`);
  } else if (daLinhaDeBase === undefined) {
    falha(caminho, `${linhas} linhas e saiu da linha de base sem ficar abaixo de ${limite}`);
  } else if (daLinhaDeBase < linhas) {
    falha(caminho, `tem ${linhas} linhas e a linha de base do ramo diz ${daLinhaDeBase}: a linha de base só pode descer até o tamanho do arquivo`);
  } else if (daLinhaDeBase > linhas) {
    aviso(`${id}: a linha de base pode descer: ${caminho} ${daLinhaDeBase} → ${linhas} (${ATUALIZAR})`);
  }
}

function verificar(ctx) {
  const { config, mudancas } = ctx;
  const limite = config.limiteDeLinhas;
  const achados = [];
  const falha = (arquivo, detalhe) => achados.push({ arquivo, detalhe });
  const naBase = arquivoNaBase(ctx.raiz, mudancas.base.desde, ARQUIVO_DA_LINHA_DE_BASE);
  const noRamo = ctx.ler(ARQUIVO_DA_LINHA_DE_BASE);
  if (!noRamo || noRamo.binario) {
    falha(ARQUIVO_DA_LINHA_DE_BASE, 'a linha de base não existe neste ramo; ela é versionada junto com as regras');
    return achados;
  }
  const doRamo = lerLista(noRamo.texto, ARQUIVO_DA_LINHA_DE_BASE);
  const primeira = naBase === null;
  const doTeto = primeira ? doRamo : lerLista(naBase, `${mudancas.base.ref}:${ARQUIVO_DA_LINHA_DE_BASE}`);
  if (primeira) ctx.aviso(`${mudancas.base.ref} ainda não tem ${ARQUIVO_DA_LINHA_DE_BASE}: esta é a primeira linha de base, nada a comparar`);
  const origem = renomeados(mudancas);

  for (const item of mudancas.itens) {
    if (item.status === 'D') continue;
    const { caminho } = item;
    if (!ehCodigoDoLimite(config, caminho)) continue;
    const arquivo = ctx.ler(caminho);
    if (!arquivo || arquivo.binario) continue;
    const linhas = contarLinhas(arquivo.texto);
    const antigo = origem.get(caminho);
    const teto = tetoDoArquivo(ctx, doTeto, caminho, antigo);
    if (linhas <= limite) {
      if (caminho in doRamo) falha(caminho, `tem ${linhas} linhas, dentro do limite de ${limite}: tire-o da linha de base (--atualizar-linha-de-base)`);
      continue;
    }
    if (teto === undefined) {
      falha(caminho, `${linhas} linhas, ${linhas - limite} acima do limite de ${limite}; arquivo novo (ou que não estava na linha de base) tem de caber no limite`);
      continue;
    }
    conferirGrande({ aviso: texto => ctx.aviso(texto), falha, caminho, linhas, teto, daLinhaDeBase: doRamo[caminho], limite });
  }

  for (const item of mudancas.itens) {
    const sumiu = item.status === 'D' ? item.caminho : item.status === 'R' ? item.antigo : null;
    if (sumiu && sumiu in doRamo) falha(sumiu, 'o arquivo não existe mais neste caminho: tire-o da linha de base (--atualizar-linha-de-base)');
  }

  if (!primeira) {
    for (const [caminho, valor] of Object.entries(doRamo)) {
      const anterior = caminho in doTeto ? doTeto[caminho] : doTeto[origem.get(caminho)];
      if (anterior === undefined) falha(caminho, `entrou na linha de base, que só encolhe: arquivo acima de ${limite} linhas tem de ser dividido, não listado`);
      else if (valor > anterior) falha(caminho, `a linha de base subiu de ${anterior} para ${valor}: ela só encolhe`);
    }
  }
  return achados;
}

function arquivosDoRepositorio(raiz) {
  return git(raiz, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean)
    .filter(caminho => fs.existsSync(path.join(raiz, caminho)));
}

function calcularLinhaDeBase(ctx) {
  const arquivos = {};
  for (const caminho of arquivosDoRepositorio(ctx.raiz).sort()) {
    if (!ehCodigoDoLimite(ctx.config, caminho)) continue;
    const arquivo = ctx.ler(caminho);
    if (!arquivo || arquivo.binario) continue;
    const linhas = contarLinhas(arquivo.texto);
    if (linhas > ctx.config.limiteDeLinhas) arquivos[caminho] = linhas;
  }
  return arquivos;
}

function atualizarLinhaDeBase(ctx) {
  const atual = lerLista(fs.readFileSync(path.join(ctx.raiz, ARQUIVO_DA_LINHA_DE_BASE), 'utf8'), ARQUIVO_DA_LINHA_DE_BASE);
  const origem = renomeados(ctx.mudancas);
  const novoNome = new Map([...origem].map(([novo, antigo]) => [antigo, novo]));
  const nova = {};
  const erros = [];
  for (const [caminho, valor] of Object.entries(atual)) {
    const destino = novoNome.get(caminho) || caminho;
    const arquivo = ctx.ler(destino);
    if (!arquivo || arquivo.binario) continue;
    const linhas = contarLinhas(arquivo.texto);
    if (linhas > ctx.config.limiteDeLinhas && linhas > valor) erros.push(`${destino}: ${linhas} linhas, mais que as ${valor} da linha de base; divida o arquivo`);
    else if (linhas > ctx.config.limiteDeLinhas) nova[destino] = linhas;
  }
  return { nova, erros };
}

function gravar(raiz, arquivos) {
  gravarChave(raiz, 'arquivos', arquivos);
}

const linhaDeBase = { chave: 'arquivos', ler: dados => dados.arquivos, calcular: calcularLinhaDeBase, atualizar: atualizarLinhaDeBase };

module.exports = { id, titulo, conserto, verificar, linhaDeBase, ARQUIVO_DA_LINHA_DE_BASE, arquivosDoRepositorio, atualizarLinhaDeBase, calcularLinhaDeBase, gravar, renomeados };
