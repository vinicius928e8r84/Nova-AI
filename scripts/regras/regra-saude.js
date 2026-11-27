'use strict';

const { arquivoNaBase, origemNaBase } = require('./git');
const { ignoradoComoCodigo } = require('./escopo');
const { COMO_INSTALAR } = require('./analisador/medir-js');
const { FerramentaAusente, medirFontes } = require('./analisador/medir');
const { LIMITES, pontuar } = require('./analisador/pontos');

const id = 'saude-do-codigo';
const titulo = 'Catraca de saúde do código: nenhum arquivo tocado piora (complexidade, aninhamento, condições, argumentos, tamanho)';

const conserto = 'Refatore de verdade a função que piorou: separe decidir de fazer (a decisão vira função pura com nome do domínio), '
  + 'dê nome à condição composta, troque a cascata por tabela quando ela é um mapa, agrupe argumentos num objeto que já existe no domínio '
  + 'e, se o arquivo passa do teto, divida-o por responsabilidade. Picar a função sem nome de domínio, trocar argumentos por um saco de opções '
  + 'ou esconder a lógica em closures não conta. Os limites (os do CodeScene menos um): complexidade até '
  + `${LIMITES.complexidade}, aninhamento até ${LIMITES.aninhamento}, ${LIMITES.blocos} bloco aninhado por função, `
  + `${LIMITES.operadores} operador lógico por condição, ${LIMITES.argumentos} argumentos, ${LIMITES.linhas} linhas por função, `
  + `complexidade média abaixo de ${LIMITES.mediaDoArquivo} e ${LIMITES.linhasDoPython} linhas de código por arquivo Python. `
  + 'O teto de cada arquivo é a soma de pontos que ele tem na branch-alvo (no nome antigo, se foi movido com `git mv`): '
  + 'arquivo novo ou cópia nasce dentro dos limites, e a folga de um arquivo não passa para outro.';

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

function oQuePiorou(atuais, daBase) {
  if (!daBase) return { titulo: 'onde estão os pontos', grupos: atuais, antes: null };
  const antes = new Map(daBase.map(grupo => [grupo.unidade, grupo.pontos]));
  const piores = atuais.filter(grupo => grupo.pontos > (antes.get(grupo.unidade) || 0));
  return piores.length ? { titulo: 'o que piorou em relação à base', grupos: piores, antes } : { titulo: 'onde estão os pontos', grupos: atuais, antes: null };
}

const MOTIVO_DO_ARQUIVO_NOVO = ' (arquivo novo nasce dentro dos limites; a folga de outro arquivo não vem junto)';

function achadosDoExcesso(excesso, daBase) {
  const { caminho, tem, pode, novo, medicao } = excesso;
  const { titulo: rotulo, grupos, antes } = oQuePiorou(pontosPorUnidade(medicao), daBase && pontosPorUnidade(daBase));
  const cabeca = { arquivo: caminho, detalhe: `${tem} ponto(s) acima dos limites; o teto é ${pode}, a medida dele na branch-alvo${novo ? MOTIVO_DO_ARQUIVO_NOVO : ''}. ${rotulo}:` };
  const linhas = grupos.slice(0, 9).map(grupo => ({
    arquivo: caminho, linha: grupo.linha,
    detalhe: `${grupo.rotulo}: ${grupo.pontos} ponto(s)${antes ? `; eram ${antes.get(grupo.unidade) || 0} na base` : ''} — ${grupo.detalhes.join(', ')}`,
  }));
  return [cabeca, ...linhas];
}

function textoDaBase(ctx, item) {
  const origem = origemNaBase(item);
  return origem !== null && seAplica(ctx.config, origem) ? arquivoNaBase(ctx.raiz, ctx.mudancas.base.desde, origem) : null;
}

function fontesDaBase(ctx, itens) {
  const fontes = {};
  for (const item of itens) {
    const texto = textoDaBase(ctx, item);
    if (texto !== null) fontes[item.caminho] = texto;
  }
  return fontes;
}

function excessoDoArquivo(item, medicao, daBase) {
  const tem = somaDosPontos(medicao);
  const pode = daBase ? somaDosPontos(daBase) : 0;
  return tem > pode ? { caminho: item.caminho, novo: origemNaBase(item) === null, tem, pode, medicao } : null;
}

function conferirArquivos(ctx, falha) {
  const itens = arquivosMedidos(ctx);
  const medicoes = medirOuAvisar(ctx, Object.fromEntries(itens.map(item => [item.caminho, item.arquivo.texto])), falha);
  if (!medicoes) return [];
  const comPontos = itens.filter(item => somaDosPontos(medicoes[item.caminho]) > 0);
  if (!comPontos.length) return [];
  const daBase = medirOuAvisar(ctx, fontesDaBase(ctx, comPontos), falha) || {};
  return comPontos.flatMap(item => {
    const excesso = excessoDoArquivo(item, medicoes[item.caminho], daBase[item.caminho]);
    return excesso ? achadosDoExcesso(excesso, daBase[item.caminho]) : [];
  });
}

function verificar(ctx) {
  const achados = [];
  const falha = (arquivo, detalhe) => achados.push({ arquivo, detalhe });
  achados.push(...conferirArquivos(ctx, falha));
  return achados;
}

module.exports = { id, titulo, conserto, verificar, seAplica, LIMITES };
