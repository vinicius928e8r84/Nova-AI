'use strict';

const fs = require('fs');
const path = require('path');
const { ErroDeUso } = require('./git');

const ARQUIVO_DA_LINHA_DE_BASE = 'scripts/regras/linha-de-base.json';

const ehObjeto = valor => Boolean(valor) && typeof valor === 'object' && !Array.isArray(valor);

function lerJson(texto, origem) {
  let dados;
  try {
    dados = JSON.parse(texto);
  } catch (erro) {
    throw new Error(`${origem} não é um JSON válido (${erro.message})`);
  }
  if (!ehObjeto(dados)) throw new Error(`${origem} precisa ser um objeto JSON`);
  return dados;
}

function lerDoDisco(raiz) {
  const completo = path.join(raiz, ARQUIVO_DA_LINHA_DE_BASE);
  return fs.existsSync(completo) ? lerJson(fs.readFileSync(completo, 'utf8'), ARQUIVO_DA_LINHA_DE_BASE) : null;
}

const emOrdem = porArquivo => Object.fromEntries(Object.entries(porArquivo).sort(([a], [b]) => a.localeCompare(b)));

function gravarChave(raiz, chave, porArquivo) {
  const dados = { ...(lerDoDisco(raiz) || {}), [chave]: emOrdem(porArquivo) };
  fs.writeFileSync(path.join(raiz, ARQUIVO_DA_LINHA_DE_BASE), `${JSON.stringify(dados, null, 2)}\n`);
}

function regrasDaLinhaDeBase(regras, pedidas) {
  const comLinhaDeBase = regras.filter(regra => regra.linhaDeBase);
  const semLinhaDeBase = pedidas.filter(id => !comLinhaDeBase.some(regra => regra.id === id));
  if (semLinhaDeBase.length) {
    throw new ErroDeUso(`${semLinhaDeBase.join(', ')} não tem linha de base; as que têm: ${comLinhaDeBase.map(regra => regra.id).join(', ')}`);
  }
  return pedidas.length ? comLinhaDeBase.filter(regra => pedidas.includes(regra.id)) : comLinhaDeBase;
}

function criarLinhasDeBase(ctx, regras) {
  const atual = lerDoDisco(ctx.raiz) || {};
  const faltam = regras.filter(regra => !(regra.linhaDeBase.chave in atual));
  if (!faltam.length) {
    throw new ErroDeUso(`${ARQUIVO_DA_LINHA_DE_BASE} já tem a linha de base de ${regras.map(regra => regra.id).join(', ')}; ela só encolhe (--atualizar-linha-de-base)`);
  }
  for (const regra of faltam) {
    const porArquivo = regra.linhaDeBase.calcular(ctx);
    gravarChave(ctx.raiz, regra.linhaDeBase.chave, porArquivo);
    console.log(`linha de base de ${regra.id} criada com ${Object.keys(porArquivo).length} arquivo(s)`);
  }
  return 0;
}

function atualizacoes(ctx, regras, atual) {
  return regras.filter(regra => regra.linhaDeBase.ler(atual))
    .map(regra => ({ regra, ...regra.linhaDeBase.atualizar(ctx, regra.linhaDeBase.ler(atual)) }));
}

function atualizarLinhasDeBase(ctx, regras) {
  const atual = lerDoDisco(ctx.raiz);
  if (!atual) throw new ErroDeUso(`${ARQUIVO_DA_LINHA_DE_BASE} não existe; crie-a com --criar-linha-de-base`);
  const resultados = atualizacoes(ctx, regras, atual);
  const erros = resultados.flatMap(resultado => resultado.erros);
  if (erros.length) {
    console.log(`${erros.map(e => `✗ ${e}`).join('\n')}\nnada foi atualizado: a linha de base só encolhe`);
    return 1;
  }
  for (const { regra, nova } of resultados) {
    gravarChave(ctx.raiz, regra.linhaDeBase.chave, nova);
    console.log(`linha de base de ${regra.id} atualizada: ${Object.keys(nova).length} arquivo(s)`);
  }
  return 0;
}

module.exports = { ARQUIVO_DA_LINHA_DE_BASE, atualizarLinhasDeBase, criarLinhasDeBase, ehObjeto, gravarChave, lerDoDisco, lerJson, regrasDaLinhaDeBase };
