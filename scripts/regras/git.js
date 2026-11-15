'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const COMMIT_VAZIO = /^0+$/;

function git(raiz, args, opcoes = {}) {
  return execFileSync('git', ['-c', 'core.quotepath=false', ...args], {
    cwd: raiz, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 512 * 1024 * 1024, ...opcoes,
  });
}

function tentar(raiz, args) {
  try {
    return git(raiz, args).trim();
  } catch {
    return null;
  }
}

class ErroDeUso extends Error {}

function resolverBase(raiz, pedida, env = process.env) {
  const ref = pedida || env.REGRAS_BASE || 'origin/main';
  if (COMMIT_VAZIO.test(ref)) return null;
  const topo = tentar(raiz, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  if (!topo) throw new ErroDeUso(`a base ${ref} não é um commit deste repositório; use --base <ref> ou REGRAS_BASE (no CI, fetch-depth: 0)`);
  const desde = tentar(raiz, ['merge-base', 'HEAD', topo]);
  if (!desde) throw new ErroDeUso(`${ref} e o HEAD não têm ancestral comum; sem ele não há como saber o que a mudança acrescentou`);
  return { ref, topo, desde };
}

function lerStatus(texto) {
  const partes = texto.split('\0').filter(Boolean);
  const itens = [];
  for (let i = 0; i < partes.length;) {
    const status = partes[i][0];
    if (status === 'R' || status === 'C') {
      itens.push({ status, antigo: partes[i + 1], caminho: partes[i + 2] });
      i += 3;
    } else {
      itens.push({ status, caminho: partes[i + 1] });
      i += 2;
    }
  }
  return itens;
}

function linhasAcrescentadas(diff) {
  const porArquivo = new Map();
  let atual = null;
  let noCabecalho = false;
  for (const linha of diff.split('\n')) {
    if (linha.startsWith('diff --git ')) {
      noCabecalho = true;
      atual = null;
    } else if (noCabecalho && linha.startsWith('+++ ')) {
      const arquivo = /^\+\+\+ b\/(.+)$/.exec(linha);
      atual = arquivo ? new Set() : null;
      if (arquivo) porArquivo.set(arquivo[1], atual);
    } else if (linha.startsWith('@@')) {
      noCabecalho = false;
      const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(linha);
      if (hunk && atual) {
        const quantas = hunk[2] === undefined ? 1 : Number(hunk[2]);
        for (let i = 0; i < quantas; i++) atual.add(Number(hunk[1]) + i);
      }
    }
  }
  return porArquivo;
}

const ehBinario = buffer => buffer.subarray(0, 8000).includes(0);

function lerArquivo(raiz, caminho) {
  const completo = path.join(raiz, caminho);
  let buffer;
  try {
    buffer = fs.readFileSync(completo);
  } catch {
    return null;
  }
  return { buffer, binario: ehBinario(buffer), texto: ehBinario(buffer) ? null : buffer.toString('utf8') };
}

function contarLinhas(texto) {
  if (texto === '') return 0;
  const quebras = texto.split('\n').length - 1;
  return texto.endsWith('\n') ? quebras : quebras + 1;
}

function hashesDaBase(raiz, desde) {
  const saida = git(raiz, ['ls-tree', '-r', '-z', desde]);
  const hashes = new Set();
  for (const entrada of saida.split('\0').filter(Boolean)) hashes.add(entrada.split(/\s/)[2]);
  return hashes;
}

function lerMudancas(raiz, base) {
  const { desde } = base;
  const itens = lerStatus(git(raiz, ['diff', '--name-status', '-M', '-z', '--no-color', '--no-ext-diff', desde]));
  const diff = git(raiz, ['diff', '-U0', '-M', '--no-color', '--no-ext-diff', desde]);
  const acrescentadas = linhasAcrescentadas(diff);
  const novosSoltos = git(raiz, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean);
  const conhecidos = new Set(itens.map(item => item.caminho));
  for (const caminho of novosSoltos) {
    if (!conhecidos.has(caminho)) itens.push({ status: 'A', caminho });
  }
  const hashes = hashesDaBase(raiz, desde);
  const copias = new Set();
  for (const item of itens) {
    if (item.status !== 'A') continue;
    const arquivo = lerArquivo(raiz, item.caminho);
    if (!arquivo) continue;
    const hash = git(raiz, ['hash-object', '--', item.caminho]).trim();
    if (hashes.has(hash)) {
      copias.add(item.caminho);
      acrescentadas.set(item.caminho, new Set());
    } else if (!acrescentadas.has(item.caminho) && !arquivo.binario) {
      const total = contarLinhas(arquivo.texto);
      acrescentadas.set(item.caminho, new Set(Array.from({ length: total }, (_, i) => i + 1)));
    }
  }
  return { base, itens, acrescentadas, copias };
}

function arquivoNaBase(raiz, desde, caminho) {
  try {
    return git(raiz, ['show', `${desde}:${caminho}`]);
  } catch {
    return null;
  }
}

module.exports = { ErroDeUso, arquivoNaBase, contarLinhas, git, lerArquivo, lerMudancas, resolverBase, tentar };
