'use strict';

const { analisarJs, comentariosPy, indiceDeLinhas, linhaDoIndice } = require('./comentarios');
const { casaAlgum } = require('./globs');
const { ehJs } = require('./escopo');

const id = 'sem-depuracao-esquecida';
const titulo = 'Nenhum console.log, debugger ou depuração esquecida nas linhas novas';
const conserto = 'Tire a linha de depuração. O que o app precisa registrar usa console.info, console.warn ou console.error (ou o registro que o módulo já tem). '
  + 'Scripts de linha de comando, testes e ferramentas de iphone/, interface/ e distribuicao/ podem imprimir (lista em scripts/regras/configuracao.json).';

const PADROES_JS = [
  { regex: /\bconsole\s*\.\s*(?:log|debug|trace|dir)\b/, nome: 'console.log' },
  { regex: /\bconsole\s*\[\s*['"`](?:log|debug|trace|dir)['"`]\s*\]/, nome: 'console.log', comTextos: true },
  { regex: /\bdebugger\b/, nome: 'debugger' },
  { regex: /\b(?:it|test|describe)\.only\s*\(/, nome: '.only esquecido em teste' },
];
const PADROES_PY = [
  { regex: /\bbreakpoint\s*\(\s*\)/, nome: 'breakpoint()' },
  { regex: /\bpdb\.set_trace\s*\(/, nome: 'pdb.set_trace()' },
  { regex: /^\s*(?:import pdb|from pdb import)\b/, nome: 'import pdb' },
];

function trechosQueNaoSaoCodigo(arquivo, texto, comTextos) {
  if (!ehJs(arquivo)) return comentariosPy(texto);
  const { comentarios, textos } = analisarJs(texto);
  return comTextos ? [...comentarios] : [...comentarios, ...textos];
}

class LinhasLimpas {
  constructor(texto) {
    this.inicios = indiceDeLinhas(texto);
    this.linhas = texto.split('\n');
    this.limpas = this.linhas.slice();
  }

  apagar([de, ate]) {
    const ultima = linhaDoIndice(this.inicios, Math.max(de, ate - 1));
    for (let linha = linhaDoIndice(this.inicios, de); linha <= ultima; linha++) this.apagarNaLinha(linha, de, ate);
  }

  apagarNaLinha(linha, de, ate) {
    const inicio = this.inicios[linha - 1];
    const dentroDe = Math.max(de, inicio) - inicio;
    const dentroAte = Math.min(ate, inicio + this.linhas[linha - 1].length) - inicio;
    const atual = this.limpas[linha - 1];
    this.limpas[linha - 1] = atual.slice(0, dentroDe) + ' '.repeat(Math.max(0, dentroAte - dentroDe)) + atual.slice(dentroAte);
  }
}

function linhasDeCodigo(arquivo, texto, comTextos) {
  const linhas = new LinhasLimpas(texto);
  for (const trecho of trechosQueNaoSaoCodigo(arquivo, texto, comTextos)) linhas.apagar(trecho);
  return linhas.limpas;
}

const ehCodigoConferido = caminho => ehJs(caminho) || caminho.endsWith('.py');

function linhasNovasDoArquivo(ctx, caminho) {
  if (!ehCodigoConferido(caminho)) return null;
  if (casaAlgum(ctx.config.ignorarCodigo, caminho)) return null;
  const novas = ctx.mudancas.acrescentadas.get(caminho);
  return novas && novas.size > 0 ? novas : null;
}

function padroesDoArquivo(ctx, caminho) {
  const permiteConsole = casaAlgum(ctx.config.consolePermitidoEm, caminho);
  return (ehJs(caminho) ? PADROES_JS : PADROES_PY).filter(p => !(permiteConsole && p.nome === 'console.log'));
}

function achadosDoArquivo(ctx, caminho, novas) {
  const arquivo = ctx.ler(caminho);
  if (!arquivo || arquivo.binario) return [];
  const padroes = padroesDoArquivo(ctx, caminho);
  const limpas = linhasDeCodigo(caminho, arquivo.texto, false);
  const comTextos = linhasDeCodigo(caminho, arquivo.texto, true);
  const achados = [];
  for (const numero of [...novas].sort((a, b) => a - b)) {
    const achado = padroes.find(p => p.regex.test((p.comTextos ? comTextos : limpas)[numero - 1] || ''));
    if (achado) achados.push({ arquivo: caminho, linha: numero, detalhe: `${achado.nome} novo` });
  }
  return achados;
}

function verificar(ctx) {
  const achados = [];
  for (const { caminho } of ctx.arquivos) {
    const novas = linhasNovasDoArquivo(ctx, caminho);
    if (novas) achados.push(achadosDoArquivo(ctx, caminho, novas));
  }
  return achados.flat();
}

module.exports = { id, titulo, conserto, verificar };
