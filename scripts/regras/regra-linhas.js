'use strict';

const fs = require('fs');
const path = require('path');
const { contarLinhas, git, arquivoNaBase } = require('./git');
const { ehCodigoDoLimite } = require('./escopo');
const { ARQUIVO_DA_LINHA_DE_BASE, gravarChave } = require('./linha-de-base');

const id = 'limite-de-linhas';
const titulo = 'Arquivo de código com no máximo 1000 linhas';

const conserto = 'Divida o arquivo por responsabilidade em módulos menores (no máximo 1000 linhas cada) e leve o código novo para um módulo novo, '
  + 'não para o arquivo grande. A linha de base (scripts/regras/linha-de-base.json) lista os arquivos que já passavam do limite: ela só encolhe. '
  + 'Depois de encolher um deles, rode `node scripts/regras/verificar.js --atualizar-linha-de-base` e versione o arquivo.';

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

const CAMPO_QUE_SUMIU = new Map([['D', 'caminho'], ['R', 'antigo']]);
const caminhoQueSumiu = item => (CAMPO_QUE_SUMIU.has(item.status) ? item[CAMPO_QUE_SUMIU.get(item.status)] : null);

function linhasDoArquivo(ctx, item) {
  if (item.status === 'D' || !ehCodigoDoLimite(ctx.config, item.caminho)) return null;
  const arquivo = ctx.ler(item.caminho);
  if (!arquivo || arquivo.binario) return null;
  return contarLinhas(arquivo.texto);
}

function listasDaLinhaDeBase(ctx, noRamo, naBase) {
  const doRamo = lerLista(noRamo.texto, ARQUIVO_DA_LINHA_DE_BASE);
  const primeira = naBase === null;
  const doTeto = primeira ? doRamo : lerLista(naBase, `${ctx.mudancas.base.ref}:${ARQUIVO_DA_LINHA_DE_BASE}`);
  if (primeira) ctx.aviso(`${ctx.mudancas.base.ref} ainda não tem ${ARQUIVO_DA_LINHA_DE_BASE}: esta é a primeira linha de base, nada a comparar`);
  return { doRamo, doTeto, primeira };
}

class ConferenciaDeLinhas {
  constructor(ctx, { doRamo, doTeto, primeira }) {
    this.ctx = ctx;
    this.limite = ctx.config.limiteDeLinhas;
    this.doRamo = doRamo;
    this.doTeto = doTeto;
    this.primeira = primeira;
    this.origem = renomeados(ctx.mudancas);
    this.achados = [];
  }

  anotar(arquivo, problema) {
    if (problema) this.achados.push({ arquivo, detalhe: problema });
  }

  conferir() {
    for (const item of this.ctx.mudancas.itens) this.conferirTamanho(item);
    for (const item of this.ctx.mudancas.itens) this.conferirSumido(caminhoQueSumiu(item));
    if (!this.primeira) this.conferirLista();
    return this.achados;
  }

  conferirLista() {
    for (const [caminho, valor] of Object.entries(this.doRamo)) this.anotar(caminho, this.problemaNaLista(caminho, valor));
  }

  conferirTamanho(item) {
    const linhas = linhasDoArquivo(this.ctx, item);
    if (linhas !== null) this.anotar(item.caminho, this.problemaDoTamanho(item.caminho, linhas));
  }

  tetoDe(caminho) {
    if (caminho in this.doTeto) return this.doTeto[caminho];
    const antigo = this.origem.get(caminho);
    return antigo !== undefined ? this.doTeto[antigo] : undefined;
  }

  problemaDoTamanho(caminho, linhas) {
    const { limite } = this;
    if (linhas <= limite) return caminho in this.doRamo ? `tem ${linhas} linhas, dentro do limite de ${limite}: tire-o da linha de base (--atualizar-linha-de-base)` : null;
    const teto = this.tetoDe(caminho);
    if (teto === undefined) return `${linhas} linhas, ${linhas - limite} acima do limite de ${limite}; arquivo novo (ou que não estava na linha de base) tem de caber no limite`;
    if (linhas > teto) return `${linhas} linhas; a linha de base o deixa em ${teto}: arquivo grande não pode crescer (${linhas - teto} linhas a mais)`;
    return this.problemaNoRamo(caminho, linhas);
  }

  problemaNoRamo(caminho, linhas) {
    const noRamo = this.doRamo[caminho];
    if (noRamo === undefined) return `${linhas} linhas e saiu da linha de base sem ficar abaixo de ${this.limite}`;
    if (noRamo === linhas) return null;
    return `tem ${linhas} linhas e a linha de base do ramo diz ${noRamo}: ajuste com --atualizar-linha-de-base (o teto é o tamanho de hoje)`;
  }

  conferirSumido(sumiu) {
    if (sumiu && sumiu in this.doRamo) this.anotar(sumiu, 'o arquivo não existe mais neste caminho: tire-o da linha de base (--atualizar-linha-de-base)');
  }

  problemaNaLista(caminho, valor) {
    const anterior = caminho in this.doTeto ? this.doTeto[caminho] : this.doTeto[this.origem.get(caminho)];
    if (anterior === undefined) return `entrou na linha de base, que só encolhe: arquivo acima de ${this.limite} linhas tem de ser dividido, não listado`;
    return valor > anterior ? `a linha de base subiu de ${anterior} para ${valor}: ela só encolhe` : null;
  }
}

function verificar(ctx) {
  const naBase = arquivoNaBase(ctx.raiz, ctx.mudancas.base.desde, ARQUIVO_DA_LINHA_DE_BASE);
  const noRamo = ctx.ler(ARQUIVO_DA_LINHA_DE_BASE);
  if (!noRamo || noRamo.binario) {
    return [{ arquivo: ARQUIVO_DA_LINHA_DE_BASE, detalhe: 'a linha de base não existe neste ramo; ela é versionada junto com as regras' }];
  }
  return new ConferenciaDeLinhas(ctx, listasDaLinhaDeBase(ctx, noRamo, naBase)).conferir();
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
