'use strict';

const { casaAlgum, extensaoDe } = require('./globs');
const configuracaoPadrao = require('./caminhos-sensiveis.json');

function classificar(arquivos, configuracao = configuracaoPadrao) {
  const motivos = [];
  const padroes = configuracao.conteudo.map(regra => ({ ...regra, regex: new RegExp(regra.padrao, 'i') }));
  for (const { caminho, adicionadas = [] } of arquivos) {
    for (const regra of configuracao.caminhos) {
      if (casaAlgum(regra.globs, caminho)) motivos.push({ arquivo: caminho, id: regra.id, motivo: regra.motivo, tipo: 'caminho' });
    }
    if (!configuracao.extensoesDoConteudo.includes(extensaoDe(caminho))) continue;
    for (const regra of padroes) {
      const linha = adicionadas.findIndex(texto => regra.regex.test(texto));
      if (linha >= 0) motivos.push({ arquivo: caminho, id: regra.id, motivo: regra.motivo, tipo: 'conteudo' });
    }
  }
  return { alta: motivos.length > 0, motivos };
}

function resumo(motivos, limite = 8) {
  const unicos = [...new Map(motivos.map(m => [`${m.arquivo} ${m.id}`, m])).values()];
  const linhas = unicos.slice(0, limite).map(m => `${m.arquivo} (${m.id}: ${m.motivo})`);
  if (unicos.length > limite) linhas.push(`… e mais ${unicos.length - limite}`);
  return linhas;
}

module.exports = { classificar, resumo };
