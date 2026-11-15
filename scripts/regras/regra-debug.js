'use strict';

const { analisarJs, comentariosPy, indiceDeLinhas, linhaDoIndice } = require('./comentarios');
const { casaAlgum } = require('./globs');
const { ehJs } = require('./escopo');

const id = 'sem-depuracao-esquecida';
const titulo = 'Nenhum console.log, debugger ou depuração esquecida nas linhas novas';
const conserto = 'Tire a linha de depuração. O que o app precisa registrar usa console.info, console.warn ou console.error (ou o registro que o módulo já tem). '
  + 'Scripts de linha de comando, testes e ferramentas de MAC/ podem imprimir (lista em scripts/regras/configuracao.json).';

const PADROES_JS = [
  { regex: /\bconsole\.(?:log|debug|trace|dir)\s*\(/, nome: 'console.log' },
  { regex: /\bdebugger\b/, nome: 'debugger' },
  { regex: /\b(?:it|test|describe)\.only\s*\(/, nome: '.only esquecido em teste' },
];
const PADROES_PY = [
  { regex: /\bbreakpoint\s*\(\s*\)/, nome: 'breakpoint()' },
  { regex: /\bpdb\.set_trace\s*\(/, nome: 'pdb.set_trace()' },
  { regex: /^\s*(?:import pdb|from pdb import)\b/, nome: 'import pdb' },
];

function linhasDeCodigo(arquivo, texto) {
  const inicios = indiceDeLinhas(texto);
  const trechos = ehJs(arquivo) ? (({ comentarios, textos }) => [...comentarios, ...textos])(analisarJs(texto)) : comentariosPy(texto);
  const linhas = texto.split('\n');
  const limpas = linhas.slice();
  for (const [de, ate] of trechos) {
    for (let linha = linhaDoIndice(inicios, de); linha <= linhaDoIndice(inicios, Math.max(de, ate - 1)); linha++) {
      const inicio = inicios[linha - 1];
      const dentroDe = Math.max(de, inicio) - inicio;
      const dentroAte = Math.min(ate, inicio + linhas[linha - 1].length) - inicio;
      limpas[linha - 1] = limpas[linha - 1].slice(0, dentroDe) + ' '.repeat(Math.max(0, dentroAte - dentroDe)) + limpas[linha - 1].slice(dentroAte);
    }
  }
  return limpas;
}

function verificar(ctx) {
  const achados = [];
  for (const item of ctx.arquivos) {
    const { caminho } = item;
    const js = ehJs(caminho);
    if (!js && !caminho.endsWith('.py')) continue;
    if (casaAlgum(ctx.config.ignorarCodigo, caminho)) continue;
    const novas = ctx.mudancas.acrescentadas.get(caminho);
    if (!novas || novas.size === 0) continue;
    const arquivo = ctx.ler(caminho);
    if (!arquivo || arquivo.binario) continue;
    const permiteConsole = casaAlgum(ctx.config.consolePermitidoEm, caminho);
    const padroes = (js ? PADROES_JS : PADROES_PY).filter(p => !(permiteConsole && p.nome === 'console.log'));
    const limpas = linhasDeCodigo(caminho, arquivo.texto);
    for (const numero of [...novas].sort((a, b) => a - b)) {
      const achado = padroes.find(p => p.regex.test(limpas[numero - 1] || ''));
      if (achado) achados.push({ arquivo: caminho, linha: numero, detalhe: `${achado.nome} novo` });
    }
  }
  return achados;
}

module.exports = { id, titulo, conserto, verificar };
