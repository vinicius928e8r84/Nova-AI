'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const { FerramentaAusente, medirJs } = require('./medir-js');

const MEDIDOR_DO_PYTHON = path.join(__dirname, 'medir_py.py');
const ehPython = arquivo => arquivo.endsWith('.py');

function motivoDeNaoTerRodado(resultado) {
  if (resultado.error) return resultado.error.message;
  const saiuSemMedir = resultado.status !== 0 && !resultado.stdout && !resultado.stderr.includes('Traceback');
  return saiuSemMedir ? `saiu com código ${resultado.status}: ${resultado.stderr.trim() || 'sem mensagem'}` : null;
}

function rodarOPython(fontes, env = process.env) {
  const python = env.PYTHON || 'python3';
  const resultado = spawnSync(python, ['-I', MEDIDOR_DO_PYTHON], {
    input: JSON.stringify(fontes), encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
  });
  const motivo = motivoDeNaoTerRodado(resultado);
  if (motivo) throw new FerramentaAusente(`a regra saude-do-codigo lê o Python com \`${python}\`, que não rodou (${motivo}); instale o Python 3 ou aponte PYTHON=`);
  if (resultado.status !== 0) throw new Error(`o medidor de Python falhou (${MEDIDOR_DO_PYTHON}):\n${resultado.stderr}`);
  return JSON.parse(resultado.stdout);
}

function medirFontes(fontes, env = process.env) {
  const doPython = {};
  const medidas = {};
  for (const [arquivo, fonte] of Object.entries(fontes)) {
    if (ehPython(arquivo)) doPython[arquivo] = fonte;
    else medidas[arquivo] = medirJs(fonte);
  }
  if (Object.keys(doPython).length) Object.assign(medidas, rodarOPython(doPython, env));
  return medidas;
}

module.exports = { FerramentaAusente, medirFontes, rodarOPython, ehPython };
