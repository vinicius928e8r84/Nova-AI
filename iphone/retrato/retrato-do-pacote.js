#!/usr/bin/env node
'use strict';

const fs = require('fs');
const { tirarRetrato } = require('./retrato');
const { compararRetratos } = require('./comparar');

const AJUDA = `uso:
  node iphone/retrato/retrato-do-pacote.js tirar <pacote.deb> [retrato.json]
  node iphone/retrato/retrato-do-pacote.js comparar <antes.json> <depois.json> [--ignorar versao,bytes]

tirar: lê o .deb e escreve o retrato (controle, arquivos, e de cada binário Mach-O os símbolos importados e
exportados, as bibliotecas, os textos, os seletores e os direitos). Sem o segundo arquivo, escreve na saída padrão.
comparar: diz o que mudou entre dois retratos. Sai com 0 quando são iguais, 1 quando há diferença e 2 quando o uso está errado.
--ignorar versao: não conta o campo Version do controle (sobe em todo corte).
--ignorar bytes: não conta o tamanho dos binários, o sha256 do código deles nem o Installed-Size (mudam em todo corte).`;

function lerRetrato(caminho) {
  return JSON.parse(fs.readFileSync(caminho, 'utf8'));
}

function ignoradosDe(argumentos) {
  const posicao = argumentos.indexOf('--ignorar');
  if (posicao < 0) return { ignorar: [], restantes: argumentos };
  const restantes = argumentos.filter((_, indice) => indice !== posicao && indice !== posicao + 1);
  return { ignorar: (argumentos[posicao + 1] || '').split(',').filter(Boolean), restantes };
}

function comandoTirar([pacote, saida]) {
  const texto = `${JSON.stringify(tirarRetrato(fs.readFileSync(pacote)), null, 2)}\n`;
  if (saida) fs.writeFileSync(saida, texto);
  else process.stdout.write(texto);
  return 0;
}

function comandoComparar(argumentos) {
  const { ignorar, restantes } = ignoradosDe(argumentos);
  const [antes, depois] = restantes;
  const diferencas = compararRetratos(lerRetrato(antes), lerRetrato(depois), ignorar);
  if (diferencas.length === 0) {
    console.log('os retratos são iguais');
    return 0;
  }
  diferencas.forEach(linha => console.log(linha));
  console.log(`${diferencas.length} diferença(s)`);
  return 1;
}

const COMANDOS = { tirar: { aridade: [1, 2], executar: comandoTirar }, comparar: { aridade: [2, 4], executar: comandoComparar } };

const usoValido = (comando, resto) => Boolean(comando) && resto.length >= comando.aridade[0] && resto.length <= comando.aridade[1];

function principal(argumentos) {
  const comando = COMANDOS[argumentos[0]];
  const resto = argumentos.slice(1);
  if (!usoValido(comando, resto)) {
    console.error(AJUDA);
    return 2;
  }
  try {
    return comando.executar(resto);
  } catch (erro) {
    console.error(`erro: ${erro.message}`);
    return 2;
  }
}

if (require.main === module) process.exitCode = principal(process.argv.slice(2));

module.exports = { principal, ignoradosDe };
