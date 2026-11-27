'use strict';

const { bytesDaBase } = require('./git');
const { arquivosJulgados } = require('./commits-da-pr');
const { ignoradoComoCodigo } = require('./escopo');
const { casaAlgum } = require('./globs');

const id = 'limite-de-tamanho';
const titulo = 'Arquivo de texto com no máximo 20000 bytes (5000 tokens)';
const conserto = 'Divida o arquivo por responsabilidade e leve o conteúdo novo para um arquivo novo, não para o grande. '
  + 'O teto de um arquivo que já passava do limite é o tamanho dele na branch-alvo: ele pode ser editado e encolhido, nunca crescer; '
  + 'depois que a PR é mesclada, o teto dele é o tamanho novo, então o teto só desce. Só são julgados os arquivos que um commit com data de autor a partir de julgaCommitsAPartirDe tocou, ou que ainda não têm commit. O limite e os tokens por byte ficam na chave tamanhoDeArquivo de scripts/regras/configuracao.json.';

const bytesComFimDeLinhaLf = buffer => {
  let total = buffer.length;
  for (let i = buffer.indexOf('\r\n'); i !== -1; i = buffer.indexOf('\r\n', i + 2)) total--;
  return total;
};

const foraDoTeto = (config, caminho) => ignoradoComoCodigo(config, caminho) || casaAlgum(config.tamanhoDeArquivo.foraDoTeto, caminho);

const tokensDe = (bytes, config) => Math.ceil(bytes / config.bytesPorToken);

const medida = (bytes, config) => `${bytes} bytes (${tokensDe(bytes, config)} tokens)`;

function origemNaBase(ctx, item) {
  if (item.status === 'M') return item.caminho;
  if (item.status === 'R' && !foraDoTeto(ctx.config, item.antigo)) return item.antigo;
  return null;
}

function tamanhoNaBase(ctx, item) {
  const origem = origemNaBase(ctx, item);
  const anterior = origem && bytesDaBase(ctx.raiz, ctx.mudancas.base.desde, origem);
  return anterior ? bytesComFimDeLinhaLf(anterior) : null;
}

function problemaDe(ctx, item, bytes) {
  const config = ctx.config.tamanhoDeArquivo;
  const antes = tamanhoNaBase(ctx, item);
  const acima = `${medida(bytes, config)}, acima do limite de ${medida(config.bytesMaximos, config)}`;
  if (antes === null || antes <= config.bytesMaximos) return acima;
  if (bytes <= antes) return null;
  const aMais = bytes - antes;
  return `${medida(bytes, config)}; na branch-alvo ele tem ${antes}: arquivo grande não pode crescer (${aMais} ${aMais === 1 ? 'byte' : 'bytes'} a mais)`;
}

function textoGrande(arquivo, maximo) {
  if (!arquivo) return false;
  return !arquivo.binario && arquivo.buffer.length > maximo;
}

function verificar(ctx) {
  const { bytesMaximos } = ctx.config.tamanhoDeArquivo;
  const julgados = arquivosJulgados(ctx);
  const achados = [];
  for (const item of ctx.arquivos) {
    if (!julgados.has(item.caminho) || foraDoTeto(ctx.config, item.caminho)) continue;
    const arquivo = ctx.ler(item.caminho);
    if (!textoGrande(arquivo, bytesMaximos)) continue;
    const bytes = bytesComFimDeLinhaLf(arquivo.buffer);
    const detalhe = bytes > bytesMaximos ? problemaDe(ctx, item, bytes) : null;
    if (detalhe) achados.push({ arquivo: item.caminho, detalhe });
  }
  return achados;
}

module.exports = { id, titulo, conserto, verificar };
