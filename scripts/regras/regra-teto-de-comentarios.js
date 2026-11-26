'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const { arquivoNaBase, bytesDaBase } = require('./git');
const { linhasDeComentario } = require('./comentarios');
const { ehCodigoDeComentario } = require('./escopo');
const { ARQUIVO_DA_LINHA_DE_BASE, ehObjeto, lerJson } = require('./linha-de-base');
const { arquivosDoRepositorio, renomeados } = require('./regra-linhas');
const { permitida } = require('./regra-comentario');

const id = 'teto-de-comentarios';
const titulo = 'Catraca de comentários: nenhum arquivo tocado tem mais linhas de comentário do que tinha';
const CHAVE = 'comentarios';
const ATUALIZAR = `node scripts/regras/verificar.js --atualizar-linha-de-base --regra ${id}`;

const conserto = 'Apague o comentário. O que ele explicava vai para o nome da função ou da variável; a decisão (o porquê) vai para um ADR em docs/adr/; '
  + 'a gambiarra que ele desculpava vira uma issue. O teto de cada arquivo é o menor valor entre a linha de base '
  + `(${ARQUIVO_DA_LINHA_DE_BASE}, chave "${CHAVE}") e a contagem no ponto de partida da PR; arquivo que não está nela tem teto 0, `
  + 'e um arquivo que chegou a zero não pode voltar a ter comentário. Só um arquivo movido com `git mv` leva o seu teto. '
  + `Depois de apagar comentários, rode \`${ATUALIZAR}\` e versione o arquivo.`;

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

function lerPorArquivo(dados, origem) {
  const porArquivo = dados[CHAVE];
  if (!ehObjeto(porArquivo)) return null;
  for (const [caminho, valor] of Object.entries(porArquivo)) {
    if (!Number.isInteger(valor) || valor < 1) throw new Error(`${origem}: "${CHAVE}" ${caminho} = ${valor}; cada valor é um inteiro a partir de 1`);
  }
  return porArquivo;
}

function linhasDeBase(ctx, falha) {
  const noRamo = ctx.ler(ARQUIVO_DA_LINHA_DE_BASE);
  const doRamo = noRamo && !noRamo.binario ? lerPorArquivo(lerJson(noRamo.texto, ARQUIVO_DA_LINHA_DE_BASE), ARQUIVO_DA_LINHA_DE_BASE) : null;
  if (!doRamo) {
    falha(ARQUIVO_DA_LINHA_DE_BASE, `falta a chave "${CHAVE}" na linha de base deste ramo; ela é versionada junto com as regras`);
    return null;
  }
  const { ref, desde } = ctx.mudancas.base;
  const naBase = arquivoNaBase(ctx.raiz, desde, ARQUIVO_DA_LINHA_DE_BASE);
  const origem = `${ref}:${ARQUIVO_DA_LINHA_DE_BASE}`;
  const doTeto = naBase === null ? null : lerPorArquivo(lerJson(naBase, origem), origem);
  if (!doTeto) ctx.aviso(`${ref} ainda não tem a linha de base de ${id}: esta é a primeira, o teto de cada arquivo é a contagem no ponto de partida`);
  return { doRamo, doTeto };
}

const origemNaBase = item => (item.status === 'A' ? null : item.antigo || item.caminho);

function tetoDe(ctx, item, doTeto) {
  const origem = origemNaBase(item);
  if (origem === null) return 0;
  const contagemNaBase = contarNaBase(ctx, origem);
  const declarado = doTeto && origem in doTeto ? doTeto[origem] : contagemNaBase;
  return Math.min(declarado, contagemNaBase);
}

function acimaDoTeto(caminho, tem, teto) {
  const aviso = teto === 0 ? ' (arquivo novo ou sem comentário não ganha comentário)' : '';
  return `${tem} linha(s) de comentário; o teto é ${teto}${aviso}: apague ${tem - teto}`;
}

function conferirEntrada(item, tem, { doRamo, doTeto }, falha) {
  if (!doTeto || !(origemNaBase(item) in doTeto)) return;
  const entrada = doRamo[item.caminho] ?? doRamo[item.antigo] ?? 0;
  if (entrada < tem) falha(ARQUIVO_DA_LINHA_DE_BASE, `${id} ${item.caminho}: a entrada (${entrada}) está abaixo dos ${tem} comentário(s) que o arquivo tem`);
}

function conferirArquivo(ctx, item, bases, falha) {
  const { caminho } = item;
  const tem = contarNoArquivo(ctx, caminho, ctx.ler(caminho));
  const teto = tetoDe(ctx, item, bases.doTeto);
  if (tem > teto) return falha(caminho, acimaDoTeto(caminho, tem, teto));
  if (tem < teto) ctx.aviso(`${id}: a linha de base pode descer: ${caminho} ${teto} → ${tem} (${ATUALIZAR})`);
  return conferirEntrada(item, tem, bases, falha);
}

function conferirEntradaBaixada(ctx, caminho, valor, falha) {
  const tem = contarNoArquivo(ctx, caminho, ctx.ler(caminho));
  if (tem > valor) falha(ARQUIVO_DA_LINHA_DE_BASE, `${id} ${caminho}: a entrada (${valor}) está abaixo dos ${tem} comentário(s) que o arquivo tem`);
}

function compararComABase(ctx, { doRamo, doTeto }, falha) {
  const origem = renomeados(ctx.mudancas);
  for (const [caminho, valor] of Object.entries(doRamo)) {
    const antes = caminho in doTeto ? doTeto[caminho] : doTeto[origem.get(caminho)];
    if (antes === undefined) falha(ARQUIVO_DA_LINHA_DE_BASE, `${id} ${caminho} entrou na linha de base, que só desce: arquivo sem comentário não ganha comentário`);
    else if (valor > antes) falha(ARQUIVO_DA_LINHA_DE_BASE, `${id} ${caminho}: a linha de base subiu de ${antes} para ${valor}; ela só desce, arquivo a arquivo`);
    else if (valor < antes) conferirEntradaBaixada(ctx, caminho, valor, falha);
  }
}

function avisarDosQueSairam(ctx, doRamo) {
  for (const item of ctx.mudancas.itens) {
    const sumiu = item.status === 'D' ? item.caminho : item.antigo;
    if (sumiu && sumiu in doRamo) ctx.aviso(`${id}: ${sumiu} não existe mais neste caminho; a entrada dele pode sair da linha de base (${ATUALIZAR})`);
  }
}

function verificar(ctx) {
  const achados = [];
  const falha = (arquivo, detalhe) => achados.push({ arquivo, detalhe });
  const bases = linhasDeBase(ctx, falha);
  if (!bases) return achados;
  if (bases.doTeto) compararComABase(ctx, bases, falha);
  avisarDosQueSairam(ctx, bases.doRamo);
  for (const item of ctx.arquivos) {
    if (ctx.mudancas.copias.has(item.caminho)) continue;
    conferirArquivo(ctx, item, bases, falha);
  }
  return achados;
}

function calcularLinhaDeBase(ctx) {
  const contagens = {};
  for (const caminho of arquivosDoRepositorio(ctx.raiz).sort()) {
    const quantas = contarNoArquivo(ctx, caminho, ctx.ler(caminho));
    if (quantas > 0) contagens[caminho] = quantas;
  }
  return contagens;
}

function caminhosTocados(mudancas) {
  return new Set(mudancas.itens.flatMap(item => [item.caminho, item.antigo]).filter(Boolean));
}

function atualizarLinhaDeBase(ctx, atual) {
  const novoNome = new Map([...renomeados(ctx.mudancas)].map(([novo, antigo]) => [antigo, novo]));
  const tocados = caminhosTocados(ctx.mudancas);
  const nova = Object.fromEntries(Object.entries(atual).filter(([caminho]) => !tocados.has(caminho)));
  const erros = [];
  for (const caminho of Object.keys(atual).filter(c => tocados.has(c))) {
    const destino = novoNome.get(caminho) || caminho;
    const arquivo = ctx.ler(destino);
    if (!arquivo) continue;
    const quantas = contarNoArquivo(ctx, destino, arquivo);
    if (quantas > atual[caminho]) erros.push(`${destino}: ${quantas} linha(s) de comentário, mais que as ${atual[caminho]} da linha de base de ${id}; apague antes`);
    else if (quantas > 0) nova[destino] = quantas;
  }
  return { nova, erros };
}

const linhaDeBase = { chave: CHAVE, ler: dados => lerPorArquivo(dados, ARQUIVO_DA_LINHA_DE_BASE), calcular: calcularLinhaDeBase, atualizar: atualizarLinhaDeBase };

module.exports = { id, titulo, conserto, verificar, linhaDeBase, contarNoArquivo, linhasDeProsa };
