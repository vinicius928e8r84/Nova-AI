'use strict';

const { bytesDaBase } = require('./git');
const { ehCodigoDeComentario, ehCodigoDoLimite } = require('./escopo');
const { casaAlgum, extensaoDe } = require('./globs');

const RESERVAS = ['MAC/**/reservas/', '{iphone,interface,distribuicao}/**/reservas/'];

const id = 'sem-binario-nem-lixo';
const titulo = 'Nenhum instalador, binário, arquivo grande ou cópia de backup novo';
const conserto = 'Instaladores e binários (.dmg, .exe, .zip, .deb, .tgz…) ficam fora do git: .gitignore e AGENTS.md seção 4. Gere-os no CI ou publique como release. '
  + 'Cópias de backup (*.bak-*, *.orig, *.antes-*) não entram: o git já guarda o arquivo anterior. O que precisa ser guardado antes de trocar o do app vai em MAC/<área>/reservas/. Cópia idêntica de arquivo que já existe também conta.';

const eSuspeito = buffer => {
  for (const byte of buffer.subarray(0, 512)) if (byte === 0 || (byte < 9) || (byte > 13 && byte < 32)) return true;
  return false;
};

const assinaturaDe = (config, buffer) => {
  if (!eSuspeito(buffer)) return null;
  for (const { nome, hex } of config.binarios.assinaturasProibidas) {
    if (buffer.subarray(0, hex.length / 2).toString('hex') === hex) return nome;
  }
  return null;
};

function verificarModificado(ctx, item, arquivo, maximo) {
  const antes = bytesDaBase(ctx.raiz, ctx.mudancas.base.desde, item.caminho);
  if (!antes) return null;
  const assinatura = assinaturaDe(ctx.config, arquivo.buffer);
  if (assinatura && assinatura !== assinaturaDe(ctx.config, antes)) return `o conteúdo passou a ser ${assinatura}`;
  if (arquivo.buffer.length > maximo && antes.length <= maximo) {
    return `${(arquivo.buffer.length / 1048576).toFixed(1)} MB: passou do limite de ${ctx.config.binarios.tamanhoMaximoMB} MB`;
  }
  return null;
}

function verificar(ctx) {
  const achados = [];
  const { binarios } = ctx.config;
  const maximo = binarios.tamanhoMaximoMB * 1024 * 1024;
  for (const item of ctx.arquivos) {
    const { caminho } = item;
    if (item.status !== 'D') {
      const lido = ctx.ler(caminho);
      const codigo = lido && (lido.binario || lido.utf16) && (ehCodigoDoLimite(ctx.config, caminho) || ehCodigoDeComentario(ctx.config, caminho, lido.buffer.toString('latin1')));
      if (codigo) {
        achados.push({ arquivo: caminho, detalhe: lido.utf16 ? 'arquivo de código em UTF-16: o interpretador o lê de outro jeito; código entra em UTF-8' : 'arquivo de código com byte nulo: as regras de linha não o leem' });
        continue;
      }
    }
    if (item.status === 'M') {
      const modificado = ctx.ler(caminho);
      const problema = modificado && !casaAlgum(RESERVAS, caminho) ? verificarModificado(ctx, item, modificado, maximo) : null;
      if (problema) achados.push({ arquivo: caminho, detalhe: problema });
      continue;
    }
    if (item.status !== 'A' && item.status !== 'R') continue;
    const arquivo = ctx.ler(caminho);
    if (!arquivo) continue;
    const emReservas = casaAlgum(RESERVAS, caminho);
    if (!emReservas && casaAlgum(binarios.lixo, caminho)) {
      achados.push({ arquivo: caminho, detalhe: 'cópia de backup, sobra de editor, log ou pasta de dependências' });
      continue;
    }
    if (binarios.extensoesProibidas.includes(extensaoDe(caminho))) {
      achados.push({ arquivo: caminho, detalhe: `extensão .${extensaoDe(caminho)}: instalador, pacote ou binário não entra no repositório` });
      continue;
    }
    if (ctx.mudancas.copias.has(caminho)) continue;
    const assinatura = assinaturaDe(ctx.config, arquivo.buffer);
    if (assinatura) {
      achados.push({ arquivo: caminho, detalhe: `o conteúdo é ${assinatura}, mesmo com outro nome` });
      continue;
    }
    if (arquivo.buffer.length > maximo) {
      achados.push({ arquivo: caminho, detalhe: `${(arquivo.buffer.length / 1048576).toFixed(1)} MB, acima do limite de ${binarios.tamanhoMaximoMB} MB para arquivo novo` });
    }
  }
  return achados;
}

module.exports = { id, titulo, conserto, verificar };
