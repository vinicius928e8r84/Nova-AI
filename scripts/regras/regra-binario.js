'use strict';

const { bytesDaBase } = require('./git');
const { ehCodigoDeComentario, ehCodigoDoLimite } = require('./escopo');
const { casaAlgum, extensaoDe } = require('./globs');

const id = 'sem-binario-nem-lixo';
const titulo = 'Nenhum instalador, binário, arquivo grande ou cópia de backup novo';
const conserto = 'Instaladores e binários (.dmg, .exe, .zip, .deb, .tgz…) ficam fora do git: .gitignore e AGENTS.md seção 4. Gere-os no CI ou publique como release. '
  + 'Cópias de backup (*.bak-*, *.orig, *.antes-*) não entram: o git já guarda o arquivo anterior. O que precisa ser guardado antes de trocar o do app vai em MAC/<área>/reservas/. Cópia idêntica de arquivo que já existe também conta.';

const BYTES_LIDOS_NO_COMECO = 512;
const MEGABYTE = 1024 * 1024;
const EM_RESERVAS = ['MAC/**/reservas/'];
const ENTRAM_COMO_NOVOS = new Set(['A', 'R']);
const EM_UTF16 = 'arquivo de código em UTF-16: o interpretador o lê de outro jeito; código entra em UTF-8';
const COM_BYTE_NULO = 'arquivo de código com byte nulo: as regras de linha não o leem';

const ehControleForaDosEspacos = byte => byte > 13 && byte < 32;
const ehByteDeBinario = byte => byte < 9 || ehControleForaDosEspacos(byte);
const eSuspeito = buffer => buffer.subarray(0, BYTES_LIDOS_NO_COMECO).some(ehByteDeBinario);

const assinaturaDe = (config, buffer) => {
  if (!eSuspeito(buffer)) return null;
  const achada = config.binarios.assinaturasProibidas.find(({ hex }) => buffer.subarray(0, hex.length / 2).toString('hex') === hex);
  return achada ? achada.nome : null;
};

const limiteEmBytes = config => config.binarios.tamanhoMaximoMB * MEGABYTE;
const emMB = bytes => (bytes / MEGABYTE).toFixed(1);
const cruzouOLimite = (agora, antes, maximo) => agora > maximo && antes <= maximo;
const lidoComoBinario = lido => Boolean(lido) && Boolean(lido.binario || lido.utf16);
const ehCodigo = (config, caminho, lido) => ehCodigoDoLimite(config, caminho) || ehCodigoDeComentario(config, caminho, lido.buffer.toString('latin1'));
const ehLixo = (config, caminho) => !casaAlgum(EM_RESERVAS, caminho) && casaAlgum(config.binarios.lixo, caminho);

function problemaDeCodigo(ctx, item) {
  if (item.status === 'D') return null;
  const lido = ctx.ler(item.caminho);
  if (!lidoComoBinario(lido) || !ehCodigo(ctx.config, item.caminho, lido)) return null;
  return lido.utf16 ? EM_UTF16 : COM_BYTE_NULO;
}

function verificarModificado(ctx, item, arquivo) {
  const antes = bytesDaBase(ctx.raiz, ctx.mudancas.base.desde, item.caminho);
  if (!antes) return null;
  const assinatura = assinaturaDe(ctx.config, arquivo.buffer);
  if (assinatura && assinatura !== assinaturaDe(ctx.config, antes)) return `o conteúdo passou a ser ${assinatura}`;
  if (cruzouOLimite(arquivo.buffer.length, antes.length, limiteEmBytes(ctx.config))) {
    return `${emMB(arquivo.buffer.length)} MB: passou do limite de ${ctx.config.binarios.tamanhoMaximoMB} MB`;
  }
  return null;
}

function problemaDoModificado(ctx, item) {
  const modificado = ctx.ler(item.caminho);
  if (!modificado || casaAlgum(EM_RESERVAS, item.caminho)) return null;
  return verificarModificado(ctx, item, modificado);
}

function problemaDoNome(config, caminho) {
  if (ehLixo(config, caminho)) return 'cópia de backup, sobra de editor, log ou pasta de dependências';
  const extensao = extensaoDe(caminho);
  if (config.binarios.extensoesProibidas.includes(extensao)) return `extensão .${extensao}: instalador, pacote ou binário não entra no repositório`;
  return null;
}

function problemaDoConteudo(ctx, caminho, arquivo) {
  if (ctx.mudancas.copias.has(caminho)) return null;
  const assinatura = assinaturaDe(ctx.config, arquivo.buffer);
  if (assinatura) return `o conteúdo é ${assinatura}, mesmo com outro nome`;
  if (arquivo.buffer.length <= limiteEmBytes(ctx.config)) return null;
  return `${emMB(arquivo.buffer.length)} MB, acima do limite de ${ctx.config.binarios.tamanhoMaximoMB} MB para arquivo novo`;
}

function problemaDoNovo(ctx, item) {
  const arquivo = ctx.ler(item.caminho);
  if (!arquivo) return null;
  return problemaDoNome(ctx.config, item.caminho) || problemaDoConteudo(ctx, item.caminho, arquivo);
}

function problemaDoArquivo(ctx, item) {
  const deCodigo = problemaDeCodigo(ctx, item);
  if (deCodigo) return deCodigo;
  if (item.status === 'M') return problemaDoModificado(ctx, item);
  return ENTRAM_COMO_NOVOS.has(item.status) ? problemaDoNovo(ctx, item) : null;
}

const verificar = ctx => ctx.arquivos
  .map(item => ({ arquivo: item.caminho, detalhe: problemaDoArquivo(ctx, item) }))
  .filter(achado => achado.detalhe);

module.exports = { id, titulo, conserto, verificar };
