'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const { bytesDaBase, git, lerStatus } = require('./git');
const { extensaoDe } = require('./globs');

const COMPARADOR_DE_PYTHON = path.join(__dirname, 'comparar_py.py');
const EXTENSOES_DE_JS = ['js', 'mjs', 'cjs'];
const PROTEGIDOS = ['.github/', 'scripts/regras/', 'scripts/ci/'];

const DE_FERRAMENTA = /^(?:#!|[*!]|@ts-|@license|@preserve|@vite-ignore|@__PURE__|#__PURE__|@jsx|@flow|@refresh|@generated|@jest|@vitest|[#@]\s*sourceMappingURL|[#@]\s*sourceURL|webpack[A-Z]|eslint|istanbul|c8\s|prettier-ignore|noqa|type:|pylint|mypy|pyright|fmt:|isort|coding[:=]|-\*-|SPDX-|Copyright|<reference)/i;

const ehDeFerramenta = texto => DE_FERRAMENTA.test(texto.replace(/^(?:\/\/+|\/\*+|#+)\s*/, '').replace(/\s*\*\/\s*$/, '').trim());
const protegido = caminho => PROTEGIDOS.some(pasta => caminho.startsWith(pasta));
const ehPython = caminho => extensaoDe(caminho) === 'py';
const ehJs = caminho => EXTENSOES_DE_JS.includes(extensaoDe(caminho));

function carregarAcorn() {
  try {
    return require(path.join(__dirname, 'analisador', 'node_modules', 'acorn'));
  } catch {
    throw new Error('o acorn não está instalado; rode `npm ci --prefix scripts/regras/analisador`');
  }
}

function lerJs(acorn, texto, modo) {
  const comentarios = [];
  const marcas = [];
  const leitor = acorn.tokenizer(texto, {
    ecmaVersion: 'latest', sourceType: modo, allowHashBang: true, locations: true,
    onComment: (bloco, conteudo, inicio, fim) => comentarios.push(texto.slice(inicio, fim)),
  });
  let anterior = null;
  for (const token of leitor) {
    const quebra = anterior !== null && token.loc.start.line > anterior.loc.end.line;
    marcas.push(`${token.type.label}|${texto.slice(token.start, token.end)}|${quebra ? 'quebra' : 'junto'}`);
    anterior = token;
  }
  return { marcas, comentarios };
}

function lerJsEmQualquerModo(acorn, texto) {
  try {
    return lerJs(acorn, texto, 'script');
  } catch {
    return lerJs(acorn, texto, 'module');
  }
}

function retirados(antes, depois) {
  const restam = new Map();
  for (const comentario of depois) restam.set(comentario, (restam.get(comentario) || 0) + 1);
  const saiu = [];
  for (const comentario of antes) {
    if (restam.get(comentario)) restam.set(comentario, restam.get(comentario) - 1);
    else saiu.push(comentario);
  }
  const entrou = [...restam.values()].some(quantos => quantos > 0);
  return { saiu, entrou };
}

function veredito({ saiu, entrou }, motivoDoCodigo) {
  if (motivoDoCodigo) return { ok: false, motivo: motivoDoCodigo };
  if (entrou) return { ok: false, motivo: 'a mudança acrescenta ou altera um comentário' };
  if (saiu.some(ehDeFerramenta)) return { ok: false, motivo: 'a mudança tira uma diretiva de ferramenta (shebang, @ts-, eslint, licença…)' };
  return { ok: true, saiu: saiu.length };
}

function compararJs(antes, depois) {
  const acorn = carregarAcorn();
  let lidoAntes;
  let lidoDepois;
  try {
    lidoAntes = lerJsEmQualquerModo(acorn, antes);
    lidoDepois = lerJsEmQualquerModo(acorn, depois);
  } catch (erro) {
    return { ok: false, motivo: `o acorn não leu o arquivo (${erro.message})` };
  }
  const igual = lidoAntes.marcas.length === lidoDepois.marcas.length && lidoAntes.marcas.every((marca, i) => marca === lidoDepois.marcas[i]);
  return veredito(retirados(lidoAntes.comentarios, lidoDepois.comentarios), igual ? null : 'o código mudou (os tokens ou as quebras de linha entre eles)');
}

function compararPython(antes, depois, env) {
  const python = env.PYTHON || 'python3';
  const resultado = spawnSync(python, ['-I', COMPARADOR_DE_PYTHON], { input: JSON.stringify({ antes, depois }), encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (resultado.status !== 0) return { ok: false, motivo: `o ${python} não rodou o comparador de Python` };
  const lido = JSON.parse(resultado.stdout);
  if (!lido.ok) return { ok: false, motivo: lido.motivo };
  if (lido.docstringsRemovidas && lido.usaDoc) return { ok: false, motivo: 'o arquivo usa __doc__: tirar a docstring muda o que ele faz' };
  const parcial = veredito(retirados(lido.comentariosAntes, lido.comentariosDepois), null);
  return parcial.ok ? { ...parcial, saiu: parcial.saiu + lido.docstringsRemovidas } : parcial;
}

function comparar(caminho, antes, depois, env = process.env) {
  return ehPython(caminho) ? compararPython(antes, depois, env) : compararJs(antes, depois);
}

function textoDe(bytes) {
  return bytes === null || bytes.subarray(0, 8000).includes(0) ? null : bytes.toString('utf8');
}

function arquivosDoDiff(raiz, desde, ate) {
  return lerStatus(git(raiz, ['diff', '--name-status', '-M', '-z', '--no-color', '--no-ext-diff', desde, ate]));
}

const cobre = item => item.status === 'M' && !protegido(item.caminho) && (ehJs(item.caminho) || ehPython(item.caminho));

function avaliar(entrada, item) {
  const { caminho } = item;
  if (!cobre(item)) return { caminho, ok: false, motivo: 'tipo de mudança ou de arquivo que a verificação não cobre' };
  const antes = textoDe(bytesDaBase(entrada.raiz, entrada.desde, caminho));
  const depois = textoDe(bytesDaBase(entrada.raiz, entrada.ate, caminho));
  if (antes === null || depois === null) return { caminho, ok: false, motivo: 'não consegui ler o arquivo' };
  return { caminho, ...comparar(caminho, antes, depois, entrada.env) };
}

function conferirMudanca(raiz, desde, ate, env = process.env) {
  return arquivosDoDiff(raiz, desde, ate).map(item => avaliar({ raiz, desde, ate, env }, item));
}

function soTiraComentario(raiz, desde, ate, env = process.env) {
  const resultados = conferirMudanca(raiz, desde, ate, env);
  return new Set(resultados.filter(resultado => resultado.ok).map(resultado => resultado.caminho));
}

module.exports = { comparar, conferirMudanca, soTiraComentario };

if (require.main === module) {
  const [desde, ate = 'HEAD'] = process.argv.slice(2);
  if (!desde) {
    console.log('uso: node scripts/regras/so-tira-comentario.js <ref de partida> [<ref de chegada>]\nlista, arquivo a arquivo, se a mudança só tira comentário (o código fica igual, token a token em JavaScript, árvore em Python)');
    process.exitCode = 2;
  } else {
    const raiz = path.resolve(__dirname, '..', '..');
    const resultados = conferirMudanca(raiz, git(raiz, ['merge-base', desde, ate]).trim(), ate);
    for (const r of resultados) console.log(r.ok ? `ok  ${r.caminho} (${r.saiu} comentario(s) a menos)` : `não ${r.caminho}: ${r.motivo}`);
    process.exitCode = resultados.length && resultados.every(r => r.ok) ? 0 : 1;
  }
}
