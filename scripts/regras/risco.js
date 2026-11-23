'use strict';

const { casaAlgum, extensaoDe } = require('./globs');
const configuracaoPadrao = require('./caminhos-sensiveis.json');

const DIFF_AUSENTE = { id: 'diff-ausente', motivo: 'o GitHub não devolveu o diff deste arquivo, então o conteúdo sensível não pôde ser conferido' };

const motivoDe = (arquivo, regra, tipo) => ({ arquivo, id: regra.id, motivo: regra.motivo, tipo });

function motivosDoCaminho(caminho, regrasDeCaminho) {
  return regrasDeCaminho
    .filter(regra => casaAlgum(regra.globs, caminho))
    .map(regra => motivoDe(caminho, regra, 'caminho'));
}

function motivosDoConteudo(caminho, adicionadas, padroes) {
  if (adicionadas === null) return [motivoDe(caminho, DIFF_AUSENTE, 'conteudo')];
  return padroes
    .filter(regra => adicionadas.some(texto => regra.regex.test(texto)))
    .map(regra => motivoDe(caminho, regra, 'conteudo'));
}

function motivosDoArquivo({ caminho, adicionadas = [] }, configuracao, padroes) {
  const doCaminho = motivosDoCaminho(caminho, configuracao.caminhos);
  if (!configuracao.extensoesDoConteudo.includes(extensaoDe(caminho))) return doCaminho;
  return [...doCaminho, ...motivosDoConteudo(caminho, adicionadas, padroes)];
}

function classificar(arquivos, configuracao = configuracaoPadrao) {
  const padroes = configuracao.conteudo.map(regra => ({ ...regra, regex: new RegExp(regra.padrao, 'i') }));
  const motivos = arquivos.flatMap(arquivo => motivosDoArquivo(arquivo, configuracao, padroes));
  return { alta: motivos.length > 0, motivos };
}

function resumo(motivos, limite = 8) {
  const unicos = [...new Map(motivos.map(m => [`${m.arquivo} ${m.id}`, m])).values()];
  const linhas = unicos.slice(0, limite).map(m => `${m.arquivo} (${m.id}: ${m.motivo})`);
  if (unicos.length > limite) linhas.push(`… e mais ${unicos.length - limite}`);
  return linhas;
}

module.exports = { classificar, resumo };
