'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { tamanhoDeArquivo } = require('../configuracao.json');

const DOCS = path.join(__dirname, '..', '..', '..', 'docs');
const PASTA_DAS_PARTES = path.join(DOCS, 'historico');
const ESPERADO = { secoes: 77, sha256: 'ebf68c1673c7abea8638a45cdccf81a8a356a733608ef88470510b5a6ab6543d' };

const comFimDeLinhaLf = texto => texto.replace(/\r\n/g, '\n');

function arquivosDoHistorico() {
  const partes = fs.existsSync(PASTA_DAS_PARTES) ? fs.readdirSync(PASTA_DAS_PARTES).sort().map(nome => path.join(PASTA_DAS_PARTES, nome)) : [];
  return [path.join(DOCS, 'historico.md'), ...partes];
}

function secoesDe(arquivo) {
  const texto = comFimDeLinhaLf(fs.readFileSync(arquivo, 'utf8'));
  return texto.split(/^(?=## )/m).filter(trecho => trecho.startsWith('## ')).map(trecho => trecho.trimEnd());
}

test('o histórico do Mac, inteiro ou em partes, tem as mesmas seções, com o mesmo texto', () => {
  const secoes = arquivosDoHistorico().flatMap(secoesDe).sort();
  assert.deepEqual({
    secoes: secoes.length,
    sha256: crypto.createHash('sha256').update(secoes.join('\u0000')).digest('hex'),
  }, ESPERADO);
});

test('o índice liga cada parte do histórico, e o índice e as partes cabem no limite de bytes', () => {
  const indice = fs.readFileSync(path.join(DOCS, 'historico.md'), 'utf8');
  const ligadas = [...indice.matchAll(/\]\((historico\/[^)]+\.md)\)/g)].map(achado => achado[1]);
  const partes = fs.readdirSync(PASTA_DAS_PARTES).map(nome => `historico/${nome}`);
  assert.deepEqual([...ligadas].sort(), partes.sort());
  for (const arquivo of ['historico.md', ...ligadas]) {
    assert.ok(fs.statSync(path.join(DOCS, arquivo)).size <= tamanhoDeArquivo.bytesMaximos, arquivo);
  }
});
