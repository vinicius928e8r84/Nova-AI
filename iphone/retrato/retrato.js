'use strict';

const crypto = require('crypto');
const { lerAr, lerTar, descomprimir } = require('./ar-e-tar');
const { ehMacho, lerMacho } = require('./macho');

const FORMATO = 1;

function abrirMembro(membros, prefixo) {
  const membro = membros.find(candidato => candidato.nome.startsWith(`${prefixo}.tar`));
  if (!membro) throw new Error(`o .deb não tem ${prefixo}.tar`);
  return lerTar(descomprimir(membro.nome, membro.dados));
}

function camposDoControle(texto) {
  const campos = [];
  for (const linha of texto.split('\n')) {
    if (/^[ \t]/.test(linha) && campos.length) campos[campos.length - 1][1] += `\n${linha.trim()}`;
    else if (linha.includes(':')) campos.push([linha.slice(0, linha.indexOf(':')).trim(), linha.slice(linha.indexOf(':') + 1).trim()]);
  }
  return campos;
}

function lerControle(texto) {
  const campos = Object.fromEntries(camposDoControle(texto));
  return Object.fromEntries(Object.keys(campos).sort().map(chave => [chave, campos[chave]]));
}

function conteudoDoArquivo(dados, binario) {
  const conteudo = { tamanho: dados.length };
  if (!binario) conteudo.sha256 = crypto.createHash('sha256').update(dados).digest('hex');
  return conteudo;
}

function descricaoDaEntrada(entrada, binario) {
  const descricao = { tipo: entrada.tipo, modo: entrada.modo, dono: entrada.dono, grupo: entrada.grupo };
  if (entrada.tipo === 'arquivo') Object.assign(descricao, conteudoDoArquivo(entrada.dados, binario));
  else if (entrada.alvo) descricao.alvo = entrada.alvo;
  return descricao;
}

const porCaminho = (a, b) => Buffer.compare(Buffer.from(a.caminho), Buffer.from(b.caminho));

function entradasDoPacote(controle, dados) {
  const dosScripts = controle.filter(entrada => entrada.caminho !== 'control').map(entrada => ({ ...entrada, caminho: `DEBIAN/${entrada.caminho}` }));
  return [...dosScripts, ...dados].sort(porCaminho);
}

function textoDoControle(entradas) {
  const arquivo = entradas.find(entrada => entrada.caminho === 'control');
  if (!arquivo) throw new Error('o .deb não tem o arquivo control');
  return arquivo.dados.toString('utf8');
}

function incluirEntrada(retrato, entrada) {
  const binario = entrada.tipo === 'arquivo' && ehMacho(entrada.dados);
  retrato.arquivos[entrada.caminho] = descricaoDaEntrada(entrada, binario);
  if (binario) retrato.binarios[entrada.caminho] = lerMacho(entrada.dados);
}

function tirarRetrato(buffer) {
  const membros = lerAr(buffer);
  const controle = abrirMembro(membros, 'control');
  const retrato = { formato: FORMATO, controle: lerControle(textoDoControle(controle)), arquivos: {}, binarios: {} };
  entradasDoPacote(controle, abrirMembro(membros, 'data')).forEach(entrada => incluirEntrada(retrato, entrada));
  return retrato;
}

module.exports = { tirarRetrato, lerControle, FORMATO };
