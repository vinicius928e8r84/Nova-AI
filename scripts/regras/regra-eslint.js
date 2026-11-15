'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const { casaAlgum } = require('./globs');
const { ehJs } = require('./escopo');

const id = 'eslint-nas-linhas-novas';
const titulo = 'ESLint (variável não declarada, não usada, código inalcançável…) só nas linhas novas';
const conserto = 'Conserte o que o ESLint aponta na linha nova: apague a variável, a função ou o import que ninguém usa (código morto), declare o que falta, '
  + 'use === no lugar de ==. As regras estão em scripts/regras/eslint.config.mjs. Linhas antigas do mesmo arquivo não são cobradas.';

const CONFIGURACAO = path.join(__dirname, 'eslint.config.mjs');
const SO_JS = /\.(?:js|mjs|cjs)$/;

function localizar(env) {
  if (env.ESLINT_BIN) return [process.execPath, [env.ESLINT_BIN]];
  const teste = spawnSync('npx', ['--no-install', 'eslint', '--version'], { encoding: 'utf8' });
  return teste.status === 0 ? ['npx', ['--no-install', 'eslint']] : null;
}

function verificar(ctx) {
  const arquivos = ctx.arquivos.filter(item => item.status !== 'D' && SO_JS.test(item.caminho) && ehJs(item.caminho)
    && !casaAlgum(ctx.config.ignorarCodigo, item.caminho) && !ctx.mudancas.copias.has(item.caminho)
    && (ctx.mudancas.acrescentadas.get(item.caminho) || { size: 0 }).size > 0).map(item => item.caminho);
  if (!arquivos.length) return [];
  const comando = localizar(ctx.env);
  if (!comando) {
    if (ctx.env.REGRAS_EXIGE_FERRAMENTAS) return [{ arquivo: '(eslint)', detalhe: 'ESLint não está instalado (defina ESLINT_BIN)' }];
    ctx.aviso('ESLint não está instalado: regra pulada (defina ESLINT_BIN ou rode npm i -g eslint@9)');
    return [];
  }
  const [bin, prefixo] = comando;
  const resultado = spawnSync(bin, [...prefixo, '--config', CONFIGURACAO, '--format', 'json', '--no-warn-ignored', '--', ...arquivos], {
    cwd: ctx.raiz, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
  });
  let relatorio;
  try {
    relatorio = JSON.parse(resultado.stdout);
  } catch {
    return [{ arquivo: '(eslint)', detalhe: `o ESLint não produziu relatório: ${`${resultado.stderr}\n${resultado.stdout}`.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 3).join(' | ')}` }];
  }
  const achados = [];
  for (const arquivo of relatorio) {
    const caminho = path.relative(ctx.raiz, arquivo.filePath).split(path.sep).join('/');
    const novas = ctx.mudancas.acrescentadas.get(caminho) || new Set();
    for (const m of arquivo.messages) {
      if (!m.fatal && !novas.has(m.line)) continue;
      achados.push({ arquivo: caminho, linha: m.line, detalhe: `${m.message}${m.ruleId ? ` (${m.ruleId})` : ''}` });
    }
  }
  return achados;
}

module.exports = { id, titulo, conserto, verificar };
