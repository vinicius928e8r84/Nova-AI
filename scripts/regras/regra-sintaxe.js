'use strict';

const { execFileSync } = require('child_process');
const { extensaoDe, casaAlgum } = require('./globs');

const id = 'sintaxe-valida';
const titulo = 'Os arquivos mudados compilam (node --check, py_compile, bash -n, JSON)';
const conserto = 'Conserte o erro de sintaxe indicado: o arquivo precisa ser lido pelo interpretador antes de ir para o app (AGENTS.md seção 5).';

function rodar(comando, args, entrada) {
  try {
    execFileSync(comando, args, { input: entrada, stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf8' });
    return null;
  } catch (erro) {
    if (erro.code === 'ENOENT') return { ausente: true };
    const saida = String(erro.stderr || erro.stdout || erro.message).split('\n').filter(Boolean);
    return { erro: saida.find(l => /Error|error/.test(l)) || saida[0] || 'erro' };
  }
}

function conferirJs(texto) {
  const comoCommonjs = rodar(process.execPath, ['--check', '--input-type=commonjs', '-'], texto);
  if (!comoCommonjs) return null;
  const comoModulo = rodar(process.execPath, ['--check', '--input-type=module', '-'], texto);
  return comoModulo ? comoCommonjs : null;
}

function conferir(caminho, texto) {
  const ext = extensaoDe(caminho);
  if (['js', 'cjs', 'mjs'].includes(ext)) return conferirJs(texto);
  if (ext === 'py') return rodar('python3', ['-I', '-c', 'import sys; compile(sys.stdin.read(), sys.argv[1], "exec")', caminho], texto);
  if (['sh', 'bash', 'command'].includes(ext)) return rodar('bash', ['-n'], texto);
  if (ext === 'json') {
    try {
      JSON.parse(texto);
      return null;
    } catch (erro) {
      return { erro: erro.message };
    }
  }
  return null;
}

function verificar(ctx) {
  const achados = [];
  for (const item of ctx.arquivos) {
    if (item.status === 'D' || ctx.mudancas.copias.has(item.caminho)) continue;
    if (casaAlgum(ctx.config.ignorarCodigo, item.caminho)) continue;
    const arquivo = ctx.ler(item.caminho);
    if (!arquivo || arquivo.binario) continue;
    const resultado = conferir(item.caminho, arquivo.texto);
    if (!resultado) continue;
    if (resultado.ausente) ctx.aviso(`${item.caminho}: interpretador ausente, sintaxe não conferida`);
    else achados.push({ arquivo: item.caminho, detalhe: resultado.erro });
  }
  return achados;
}

module.exports = { id, titulo, conserto, verificar };
