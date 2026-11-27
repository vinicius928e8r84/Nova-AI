'use strict';

const { bytesDaBase } = require('./git');
const { ehCodigoDeComentario, ehCodigoDoLimite } = require('./escopo');
const { casaAlgum, extensaoDe } = require('./globs');

const RESERVAS = ['**/reservas/'];

const id = 'sem-binario-nem-lixo';
const titulo = 'Nenhum instalador, binário, arquivo grande ou cópia de backup novo';
const conserto = 'Instaladores e binários (.dmg, .exe, .zip, .deb, .tgz…) ficam fora do git: .gitignore e AGENTS.md seção 4. Gere-os no CI ou publique como release. '
  + 'Cópias de backup (*.bak-*, *.orig, *.antes-*) não entram: o git já guarda o arquivo anterior. O que precisa ser guardado antes de trocar o do app vai fora do repositório, em ~/Nova-AI-reservas/AAAAMMDD-HHMMSS-<branch>/ (AGENTS.md seção 5). Cópia idêntica de arquivo que já existe também conta.';

const MEGA = 1024 * 1024;
const BYTES_DO_COMECO = 512;

const ehControleAntesDaTabulacao = byte => byte < 9;
const ehControleDepoisDoRetorno = byte => byte > 13 && byte < 32;
const ehByteDeControle = byte => ehControleAntesDaTabulacao(byte) || ehControleDepoisDoRetorno(byte);

const eSuspeito = buffer => buffer.subarray(0, BYTES_DO_COMECO).some(ehByteDeControle);

const assinaturaDe = (config, buffer) => {
  if (!eSuspeito(buffer)) return null;
  for (const { nome, hex } of config.binarios.assinaturasProibidas) {
    if (buffer.subarray(0, hex.length / 2).toString('hex') === hex) return nome;
  }
  return null;
};

const limiteEmBytes = config => config.binarios.tamanhoMaximoMB * MEGA;

const emMegabytes = bytes => (bytes / MEGA).toFixed(1);

function verificarModificado(ctx, item, arquivo) {
  const maximo = limiteEmBytes(ctx.config);
  const antes = bytesDaBase(ctx.raiz, ctx.mudancas.base.desde, item.caminho);
  if (!antes) return null;
  const assinatura = assinaturaDe(ctx.config, arquivo.buffer);
  if (assinatura && assinatura !== assinaturaDe(ctx.config, antes)) return `o conteúdo passou a ser ${assinatura}`;
  if (arquivo.buffer.length > maximo && antes.length <= maximo) {
    return `${emMegabytes(arquivo.buffer.length)} MB: passou do limite de ${ctx.config.binarios.tamanhoMaximoMB} MB`;
  }
  return null;
}

function motivoDeCodigoIlegivel(ctx, caminho) {
  const lido = ctx.ler(caminho);
  const ilegivel = lido && (lido.binario || lido.utf16);
  if (!ilegivel) return null;
  const eCodigo = ehCodigoDoLimite(ctx.config, caminho) || ehCodigoDeComentario(ctx.config, caminho, lido.buffer.toString('latin1'));
  if (!eCodigo) return null;
  return lido.utf16 ? 'arquivo de código em UTF-16: o interpretador o lê de outro jeito; código entra em UTF-8' : 'arquivo de código com byte nulo: as regras de linha não o leem';
}

function motivoDoArquivoNovo(ctx, caminho, arquivo) {
  const { binarios } = ctx.config;
  if (casaAlgum(RESERVAS, caminho)) return 'cópia de backup em reservas/: a cópia do arquivo anterior do app instalado fica fora do repositório, em ~/Nova-AI-reservas/AAAAMMDD-HHMMSS-<branch>/';
  if (casaAlgum(binarios.lixo, caminho)) return 'cópia de backup, sobra de editor, log ou pasta de dependências';
  if (binarios.extensoesProibidas.includes(extensaoDe(caminho))) return `extensão .${extensaoDe(caminho)}: instalador, pacote ou binário não entra no repositório`;
  if (ctx.mudancas.copias.has(caminho)) return null;
  const assinatura = assinaturaDe(ctx.config, arquivo.buffer);
  if (assinatura) return `o conteúdo é ${assinatura}, mesmo com outro nome`;
  if (arquivo.buffer.length > limiteEmBytes(ctx.config)) return `${emMegabytes(arquivo.buffer.length)} MB, acima do limite de ${binarios.tamanhoMaximoMB} MB para arquivo novo`;
  return null;
}

const ehNovoOuRenomeado = status => status === 'A' || status === 'R';

function motivoDoItem(ctx, item) {
  const ilegivel = item.status === 'D' ? null : motivoDeCodigoIlegivel(ctx, item.caminho);
  if (ilegivel) return ilegivel;
  if (item.status === 'M') {
    const modificado = ctx.ler(item.caminho);
    return modificado ? verificarModificado(ctx, item, modificado) : null;
  }
  if (!ehNovoOuRenomeado(item.status)) return null;
  const arquivo = ctx.ler(item.caminho);
  return arquivo ? motivoDoArquivoNovo(ctx, item.caminho, arquivo) : null;
}

function verificar(ctx) {
  return ctx.arquivos
    .map(item => ({ item, detalhe: motivoDoItem(ctx, item) }))
    .filter(({ detalhe }) => detalhe)
    .map(({ item, detalhe }) => ({ arquivo: item.caminho, detalhe }));
}

module.exports = { id, titulo, conserto, verificar };
