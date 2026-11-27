'use strict';

const id = 'sem-config-do-codescene';
const titulo = 'Nenhuma configuração do CodeScene no repositório (.codescene/ e code-health-rules.json)';
const conserto = 'Tire do commit o arquivo sob .codescene/ e todo code-health-rules.json: as regras do CodeScene ficam no servidor, não no repositório. '
  + 'Não existe linha de exceção; para afrouxar esta regra, abra uma PR de regras com atenção ALTA e o dono revisa.';

const PASTA = '.codescene/';
const NOME = 'code-health-rules.json';

const ehConfiguracaoDoCodescene = caminho => caminho.startsWith(PASTA) || caminho === NOME || caminho.endsWith(`/${NOME}`);

function verificar(ctx) {
  return ctx.arquivos
    .filter(item => ehConfiguracaoDoCodescene(item.caminho))
    .map(item => ({ arquivo: item.caminho, detalhe: 'configuração do CodeScene não entra no repositório' }));
}

module.exports = { id, titulo, conserto, verificar };
