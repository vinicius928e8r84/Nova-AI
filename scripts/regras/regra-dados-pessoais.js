'use strict';

const { casaAlgum } = require('./globs');
const { tiposDaLinha } = require('./dados-pessoais');
const { abrirLista } = require('./lista-de-nomes');

const id = 'sem-dado-pessoal';
const titulo = 'Nenhum e-mail, IP, caminho de usuário ou nome de pessoa nas linhas novas';
const conserto = 'Troque o dado por um exemplo: e-mail @example.com (ou o noreply do GitHub), IP de documentação '
  + '(192.0.2.x, 198.51.100.x, 203.0.113.x) ou 127.0.0.1, caminho com <usuário>, $USER, ~ ou %USERPROFILE% no lugar do nome. '
  + 'O valor não é mostrado de propósito: este log pode ser público. Se o dado já foi publicado numa branch, apagar o commit depois não o recupera. '
  + 'Os nomes vêm de uma lista fora do repositório: o arquivo apontado por FREIOS_NOMES ou ~/.config/freios/nomes.txt, um nome por linha (# comenta). '
  + 'Uma exceção é um glob com motivo na chave dadosPessoais de scripts/regras/configuracao.json, só por PR de regras com atenção ALTA. '
  + 'Só a linha nova reprova: o que já estava na base não é julgado.';

function achadosDoArquivo(ctx, caminho, nomes) {
  const arquivo = ctx.ler(caminho);
  const novas = ctx.mudancas.acrescentadas.get(caminho);
  if (!arquivo || arquivo.binario || !novas || !novas.size) return [];
  const linhas = arquivo.texto.split('\n');
  return [...novas].sort((a, b) => a - b).flatMap(numero => tiposDaLinha(linhas[numero - 1] || '', nomes)
    .map(tipo => ({ arquivo: caminho, linha: numero, detalhe: `${tipo} (o valor não é mostrado)` })));
}

function verificar(ctx) {
  const nomes = abrirLista(ctx);
  return ctx.arquivos
    .filter(({ caminho }) => !casaAlgum(ctx.config.dadosPessoais.excecoes, caminho))
    .flatMap(({ caminho }) => achadosDoArquivo(ctx, caminho, nomes));
}

module.exports = { id, titulo, conserto, verificar };
