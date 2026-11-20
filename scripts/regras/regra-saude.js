'use strict';

const { arquivoNaBase } = require('./git');
const { ignoradoComoCodigo } = require('./escopo');
const { ARQUIVO_DA_LINHA_DE_BASE, ehObjeto, lerJson } = require('./linha-de-base');
const { arquivosDoRepositorio, renomeados } = require('./regra-linhas');
const { COMO_INSTALAR } = require('./analisador/medir-js');
const { FerramentaAusente, medirFontes } = require('./analisador/medir');
const { LIMITES, pontuar } = require('./analisador/pontos');

const id = 'saude-do-codigo';
const titulo = 'Catraca de saúde do código: nenhum arquivo tocado piora (complexidade, aninhamento, condições, argumentos, tamanho)';
const CHAVE = id;
const ATUALIZAR = `node scripts/regras/verificar.js --atualizar-linha-de-base --regra ${id}`;

const conserto = 'Refatore de verdade a função que piorou: separe decidir de fazer (a decisão vira função pura com nome do domínio), '
  + 'dê nome à condição composta, troque a cascata por tabela quando ela é um mapa, agrupe argumentos num objeto que já existe no domínio '
  + 'e, se o arquivo passa do teto, divida-o por responsabilidade. Picar a função sem nome de domínio, trocar argumentos por um saco de opções '
  + 'ou esconder a lógica em closures não conta. Os limites (os do CodeScene menos um): complexidade até '
  + `${LIMITES.complexidade}, aninhamento até ${LIMITES.aninhamento}, ${LIMITES.blocos} bloco aninhado por função, `
  + `${LIMITES.operadores} operador lógico por condição, ${LIMITES.argumentos} argumentos, ${LIMITES.linhas} linhas por função, `
  + `complexidade média abaixo de ${LIMITES.mediaDoArquivo} e ${LIMITES.linhasDoPython} linhas de código por arquivo Python. `
  + `A folga da linha de base (${ARQUIVO_DA_LINHA_DE_BASE}, chave "${CHAVE}") é de cada arquivo: arquivo novo nasce dentro dos limites `
  + 'e código que sai para um módulo novo chega lá dentro deles; só um arquivo movido com `git mv` leva a sua. '
  + `Depois de melhorar ou mover um arquivo da linha de base, rode \`${ATUALIZAR}\` e versione o arquivo.`;

const EXTENSOES = /\.(?:js|mjs|cjs|py)$/;
const seAplica = (config, caminho) => EXTENSOES.test(caminho) && !ignoradoComoCodigo(config, caminho);

const somaDosPontos = medicao => pontuar(medicao).reduce((soma, excesso) => soma + excesso.pontos, 0);

function pontosPorUnidade(medicao) {
  const porUnidade = new Map();
  for (const excesso of pontuar(medicao)) {
    const rotulo = excesso.unidade === null ? 'o arquivo' : `${excesso.unidade} (linha ${excesso.linha})`;
    const grupo = porUnidade.get(rotulo) || { rotulo, unidade: excesso.unidade, linha: excesso.linha, pontos: 0, detalhes: [] };
    grupo.pontos += excesso.pontos;
    grupo.detalhes.push(excesso.detalhe);
    porUnidade.set(rotulo, grupo);
  }
  return [...porUnidade.values()].sort((a, b) => b.pontos - a.pontos);
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
  const doTeto = naBase === null ? null : lerPorArquivo(lerJson(naBase, `${ref}:${ARQUIVO_DA_LINHA_DE_BASE}`), `${ref}:${ARQUIVO_DA_LINHA_DE_BASE}`);
  if (!doTeto) ctx.aviso(`${ref} ainda não tem a linha de base de ${id}: esta é a primeira, nada a comparar`);
  return { doRamo, doTeto };
}

function arquivosMedidos(ctx) {
  return ctx.arquivos.filter(item => seAplica(ctx.config, item.caminho)).map(item => ({ ...item, arquivo: ctx.ler(item.caminho) }))
    .filter(({ arquivo }) => arquivo && !arquivo.binario);
}

function medirOuAvisar(ctx, fontes, falha) {
  try {
    return medirFontes(fontes, ctx.env);
  } catch (erro) {
    if (!(erro instanceof FerramentaAusente)) throw erro;
    if (ctx.env.REGRAS_EXIGE_FERRAMENTAS) falha(`(${id})`, `${erro.message} (no CI: ${COMO_INSTALAR})`);
    else ctx.aviso(`${erro.message}: regra ${id} pulada`);
    return null;
  }
}

function permitidoPara(item, doRamo, falha) {
  const { caminho, antigo, status } = item;
  if (status === 'A') {
    if (caminho in doRamo) falha(ARQUIVO_DA_LINHA_DE_BASE, `${id} ${caminho}: arquivo novo não herda folga; tire-o da linha de base (${ATUALIZAR})`);
    return { pode: 0, porque: 'arquivo novo nasce dentro dos limites; a folga de outro arquivo não vem junto' };
  }
  if (caminho in doRamo) return { pode: doRamo[caminho] };
  if (antigo && antigo in doRamo) return { pode: 0, porque: `o arquivo veio de ${antigo}: leve a entrada para o nome novo (${ATUALIZAR})` };
  return { pode: 0, porque: 'o arquivo não está na linha de base, então tem de ficar dentro dos limites' };
}

function oQuePiorou(atuais, daBase) {
  if (!daBase) return { titulo: 'onde estão os pontos', grupos: atuais, antes: null };
  const antes = new Map(daBase.map(grupo => [grupo.unidade, grupo.pontos]));
  const piores = atuais.filter(grupo => grupo.pontos > (antes.get(grupo.unidade) || 0));
  return piores.length ? { titulo: 'o que piorou em relação à base', grupos: piores, antes } : { titulo: 'onde estão os pontos', grupos: atuais, antes: null };
}

function achadosDoExcesso(excesso, daBase) {
  const { caminho, tem, pode, porque, medicao } = excesso;
  const { titulo: rotulo, grupos, antes } = oQuePiorou(pontosPorUnidade(medicao), daBase && pontosPorUnidade(daBase));
  const cabeca = { arquivo: caminho, detalhe: `${tem} ponto(s) acima dos limites; a linha de base permite ${pode}${porque ? ` (${porque})` : ''}. ${rotulo}:` };
  const linhas = grupos.slice(0, 9).map(grupo => ({
    arquivo: caminho, linha: grupo.linha,
    detalhe: `${grupo.rotulo}: ${grupo.pontos} ponto(s)${antes ? `; eram ${antes.get(grupo.unidade) || 0} na base` : ''} — ${grupo.detalhes.join(', ')}`,
  }));
  return [cabeca, ...linhas];
}

function fontesDaBase(ctx, excessos) {
  const fontes = {};
  for (const { caminho, origem } of excessos) {
    const texto = origem ? arquivoNaBase(ctx.raiz, ctx.mudancas.base.desde, origem) : null;
    if (texto !== null) fontes[caminho] = texto;
  }
  return fontes;
}

const origemNaBase = item => (item.status === 'A' ? null : item.antigo || item.caminho);

function compararComAFolga(ctx, item, { doRamo, medicao }, falha) {
  const tem = somaDosPontos(medicao);
  const { pode, porque } = permitidoPara(item, doRamo, falha);
  if (tem < pode) ctx.aviso(`${id}: a linha de base pode descer: ${item.caminho} ${pode} → ${tem} (${ATUALIZAR})`);
  return tem > pode ? { caminho: item.caminho, origem: origemNaBase(item), tem, pode, porque, medicao } : null;
}

function conferirArquivos(ctx, doRamo, falha) {
  const itens = arquivosMedidos(ctx);
  const medicoes = medirOuAvisar(ctx, Object.fromEntries(itens.map(item => [item.caminho, item.arquivo.texto])), falha);
  if (!medicoes) return [];
  const excessos = itens.map(item => compararComAFolga(ctx, item, { doRamo, medicao: medicoes[item.caminho] }, falha)).filter(Boolean);
  if (!excessos.length) return [];
  const daBase = medirOuAvisar(ctx, fontesDaBase(ctx, excessos), falha) || {};
  return excessos.flatMap(excesso => achadosDoExcesso(excesso, daBase[excesso.caminho]));
}

function compararComABase(ctx, { doRamo, doTeto }, falha) {
  const origem = renomeados(ctx.mudancas);
  for (const [caminho, valor] of Object.entries(doRamo)) {
    const antes = origem.has(caminho) ? doTeto[origem.get(caminho)] : doTeto[caminho];
    if (antes === undefined) {
      falha(ARQUIVO_DA_LINHA_DE_BASE, `${id} ${caminho} entrou na linha de base, que só desce: arquivo novo nasce dentro dos limites, e a folga de um arquivo não passa para outro`);
    } else if (valor > antes) {
      falha(ARQUIVO_DA_LINHA_DE_BASE, `${id} ${caminho}: a linha de base subiu de ${antes} para ${valor}; ela só desce, arquivo a arquivo`);
    }
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
  const doArquivo = conferirArquivos(ctx, bases.doRamo, falha);
  return [...achados, ...doArquivo];
}

function pontosDoRepositorio(ctx, caminhos) {
  const fontes = {};
  for (const caminho of caminhos) {
    const arquivo = ctx.ler(caminho);
    if (arquivo && !arquivo.binario) fontes[caminho] = arquivo.texto;
  }
  const medicoes = medirFontes(fontes, ctx.env);
  return Object.fromEntries(Object.entries(medicoes).map(([caminho, medicao]) => [caminho, somaDosPontos(medicao)]));
}

function calcularLinhaDeBase(ctx) {
  const caminhos = arquivosDoRepositorio(ctx.raiz).filter(caminho => seAplica(ctx.config, caminho));
  return Object.fromEntries(Object.entries(pontosDoRepositorio(ctx, caminhos)).filter(([, pontos]) => pontos > 0));
}

function atualizarLinhaDeBase(ctx, atual) {
  const novoNome = new Map([...renomeados(ctx.mudancas)].map(([novo, antigo]) => [antigo, novo]));
  const destinos = Object.keys(atual).map(caminho => [caminho, novoNome.get(caminho) || caminho]);
  const pontos = pontosDoRepositorio(ctx, destinos.map(([, destino]) => destino));
  const nova = {};
  const erros = [];
  for (const [caminho, destino] of destinos) {
    if (!(destino in pontos)) continue;
    if (pontos[destino] > atual[caminho]) erros.push(`${destino}: ${pontos[destino]} ponto(s), mais que os ${atual[caminho]} da linha de base de ${id}; refatore antes`);
    else if (pontos[destino] > 0) nova[destino] = pontos[destino];
  }
  return { nova, erros };
}

const linhaDeBase = { chave: CHAVE, ler: dados => lerPorArquivo(dados, ARQUIVO_DA_LINHA_DE_BASE), calcular: calcularLinhaDeBase, atualizar: atualizarLinhaDeBase };

module.exports = { id, titulo, conserto, verificar, seAplica, linhaDeBase, LIMITES };
