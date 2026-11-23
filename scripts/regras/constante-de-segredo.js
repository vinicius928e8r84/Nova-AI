'use strict';

const CONSTANTE_DE_SEGREDO = /\b[A-Z0-9_]{0,40}(?:SECRET|PASSWORD|PASSWD|PASSCODE|SENHA|SEGREDO)[A-Z0-9_]{0,40}\s{0,5}[:=]\s{0,5}['"]([^'"\s]{6,512})['"]/;
const CAMINHO_DE_TESTE = /(?:^|\/)(?:test|testes|__tests__)\/|\.test\.[cm]?[jt]s$/;
const PLACEHOLDER = /x{4,}|\*{3,}|example|exemplo|sample|your|seu[_-]|changeme|placeholder|dummy|fake|falso|<[^>]*>|\$\{|%\(|\{\{|process\.env|os\.environ|\.\.\./i;
const VALOR_DE_EXEMPLO = /^(?:senha|password|passwd|pass|pwd|secret|segredo|usuario|user|username|usr|xxx+|\*+|porta|port|host|s3nh[a0-9]*|<[^>]*>|\{[^}]*\}|\$\{?\w*\}?|%\w*|\.\.\.)$/i;
const DETALHE = 'parece constante de segredo com valor escrito (o valor não é mostrado)';

const valorEscrito = valor => !PLACEHOLDER.test(valor) && !VALOR_DE_EXEMPLO.test(valor);

const constanteDeSegredoNaLinha = texto => {
  const constante = CONSTANTE_DE_SEGREDO.exec(texto);
  return constante && valorEscrito(constante[1]) ? 'constante de segredo com valor escrito' : null;
};

function linhasNovasDeTexto(ctx, caminho) {
  const arquivo = ctx.ler(caminho);
  if (!arquivo) return [];
  if (arquivo.binario) return [];
  const linhas = arquivo.texto.split('\n');
  const novas = ctx.mudancas.acrescentadas.get(caminho) || [];
  return [...novas].sort((a, b) => a - b).map(numero => ({ numero, texto: linhas[numero - 1] || '' }));
}

function achadosDoArquivo(ctx, caminho) {
  if (CAMINHO_DE_TESTE.test(caminho)) return [];
  return linhasNovasDeTexto(ctx, caminho)
    .filter(({ texto }) => constanteDeSegredoNaLinha(texto))
    .map(({ numero }) => ({ arquivo: caminho, linha: numero, detalhe: DETALHE }));
}

const achadosDeConstante = ctx => ctx.arquivos.flatMap(({ caminho }) => achadosDoArquivo(ctx, caminho));

module.exports = { constanteDeSegredoNaLinha, achadosDeConstante };
