'use strict';

const { execFileSync } = require('child_process');
const { extensaoDe, casaAlgum } = require('./globs');

const id = 'sintaxe-valida';
const titulo = 'Os arquivos mudados compilam (node --check, py_compile, bash -n, JSON)';
const conserto = 'Conserte o erro de sintaxe indicado: o arquivo precisa ser lido pelo interpretador antes de ir para o app (AGENTS.md seção 5).';

function linhaDoErro(erro) {
  const saida = String(erro.stderr || erro.stdout || erro.message).split('\n').filter(Boolean);
  return saida.find(l => /Error|error/.test(l)) || saida[0] || 'erro';
}

function rodar(comando, args, entrada) {
  try {
    execFileSync(comando, args, { input: entrada, stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf8' });
    return null;
  } catch (erro) {
    if (erro.code === 'ENOENT') return { ausente: true };
    return { erro: linhaDoErro(erro) };
  }
}

function conferirJs(texto) {
  const comoCommonjs = rodar(process.execPath, ['--check', '--input-type=commonjs', '-'], texto);
  if (!comoCommonjs) return null;
  const comoModulo = rodar(process.execPath, ['--check', '--input-type=module', '-'], texto);
  return comoModulo ? comoCommonjs : null;
}

const conferirPython = (texto, caminho) => rodar('python3', ['-I', '-c', 'import sys; compile(sys.stdin.read(), sys.argv[1], "exec")', caminho], texto);
const conferirShell = texto => rodar('bash', ['-n'], texto);

function conferirJson(texto) {
  try {
    JSON.parse(texto);
    return null;
  } catch (erro) {
    return { erro: erro.message };
  }
}

const CONFERIR_POR_EXTENSAO = new Map([
  ...['js', 'cjs', 'mjs'].map(ext => [ext, conferirJs]),
  ['py', conferirPython],
  ...['sh', 'bash', 'command'].map(ext => [ext, conferirShell]),
  ['json', conferirJson],
]);

function conferir(caminho, texto) {
  const conferirTexto = CONFERIR_POR_EXTENSAO.get(extensaoDe(caminho));
  return conferirTexto ? conferirTexto(texto, caminho) : null;
}

function ficaDeFora(ctx, item) {
  if (item.status === 'D') return true;
  if (ctx.mudancas.copias.has(item.caminho)) return true;
  return casaAlgum(ctx.config.ignorarCodigo, item.caminho);
}

function arquivoDeTexto(ctx, item) {
  if (ficaDeFora(ctx, item)) return null;
  const arquivo = ctx.ler(item.caminho);
  return arquivo && !arquivo.binario ? arquivo : null;
}

function conferirItem(ctx, item) {
  const arquivo = arquivoDeTexto(ctx, item);
  return arquivo ? conferir(item.caminho, arquivo.texto) : null;
}

function verificar(ctx) {
  const achados = [];
  for (const item of ctx.arquivos) {
    const resultado = conferirItem(ctx, item);
    if (!resultado) continue;
    if (resultado.ausente) ctx.aviso(`${item.caminho}: interpretador ausente, sintaxe não conferida`);
    else achados.push({ arquivo: item.caminho, detalhe: resultado.erro });
  }
  return achados;
}

module.exports = { id, titulo, conserto, verificar };
