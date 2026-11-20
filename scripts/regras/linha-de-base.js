'use strict';

const fs = require('fs');
const path = require('path');

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

module.exports = { ARQUIVO_DA_LINHA_DE_BASE, ehObjeto, gravarChave, lerDoDisco, lerJson };
