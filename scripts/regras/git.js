'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { casaAlgum } = require('./globs');

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

const ESCAPES = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 };

function desfazerAspas(texto) {
  const bytes = [];
  const miolo = Buffer.from(texto.slice(1, -1), 'utf8');
  for (let i = 0; i < miolo.length; i++) {
    const c = String.fromCharCode(miolo[i]);
    if (c !== '\\') {
      bytes.push(miolo[i]);
      continue;
    }
    const proximo = String.fromCharCode(miolo[i + 1]);
    if (/[0-7]/.test(proximo)) {
      bytes.push(parseInt(miolo.subarray(i + 1, i + 4).toString('latin1'), 8));
      i += 3;
    } else {
      bytes.push(ESCAPES[proximo] === undefined ? miolo[i + 1] : ESCAPES[proximo]);
      i += 1;
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

function nomeDoCabecalho(resto) {
  const bruto = resto.startsWith('"') ? desfazerAspas(resto.replace(/\t$/, '')) : resto.replace(/\t$/, '');
  return bruto.startsWith('b/') ? bruto.slice(2) : null;
}

const LINHAS_DO_HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

function linhasDoHunk(cabecalho) {
  const hunk = LINHAS_DO_HUNK.exec(cabecalho);
  if (!hunk) return [];
  const quantas = hunk[2] === undefined ? 1 : Number(hunk[2]);
  return Array.from({ length: quantas }, (_, i) => Number(hunk[1]) + i);
}

class LeitorDeDiff {
  constructor() {
    this.porArquivo = new Map();
    this.atual = null;
    this.noCabecalho = false;
  }

  ler(linha) {
    if (linha.startsWith('diff --git ')) this.abrirArquivo();
    else if (this.noCabecalho && linha.startsWith('+++ ')) this.nomearArquivo(linha.slice(4));
    else if (linha.startsWith('@@')) this.lerHunk(linha);
  }

  abrirArquivo() {
    this.noCabecalho = true;
    this.atual = null;
  }

  nomearArquivo(resto) {
    const nome = nomeDoCabecalho(resto);
    this.atual = null;
    if (nome === null) return;
    this.atual = new Set();
    this.porArquivo.set(nome, this.atual);
  }

  lerHunk(linha) {
    this.noCabecalho = false;
    if (!this.atual) return;
    for (const numero of linhasDoHunk(linha)) this.atual.add(numero);
  }
}

function linhasAcrescentadas(diff) {
  const leitor = new LeitorDeDiff();
  for (const linha of diff.split('\n')) leitor.ler(linha);
  return leitor.porArquivo;
}

const ehBinario = buffer => buffer.subarray(0, 8000).includes(0);
const BOM_LE = Buffer.from([0xff, 0xfe]);
const BOM_BE = Buffer.from([0xfe, 0xff]);
const temBom = (buffer, bom) => buffer.subarray(0, 2).equals(bom);
const comoLe = bytes => bytes.toString('utf16le');
const comoBe = bytes => Buffer.from(bytes).swap16().toString('utf16le');
const predomina = (muitos, poucos, casais) => muitos >= casais * 0.3 && poucos <= casais * 0.01;

function ordemPelosZeros(buffer, par) {
  const amostra = Math.min(par, 8000);
  const zeros = [0, 0];
  for (let i = 0; i < amostra; i++) if (buffer[i] === 0) zeros[i % 2]++;
  const casais = amostra / 2;
  if (predomina(zeros[1], zeros[0], casais)) return comoLe;
  if (predomina(zeros[0], zeros[1], casais)) return comoBe;
  return null;
}

function decodificarUtf16(buffer) {
  if (buffer.length < 2) return null;
  const par = buffer.length - (buffer.length % 2);
  if (temBom(buffer, BOM_LE)) return comoLe(buffer.subarray(2, par));
  if (temBom(buffer, BOM_BE)) return comoBe(buffer.subarray(2, par));
  const decodificar = ordemPelosZeros(buffer, par);
  return decodificar ? decodificar(buffer.subarray(0, par)) : null;
}

function lerBytes(completo) {
  try {
    return fs.readFileSync(completo);
  } catch {
    return null;
  }
}

function comoArquivo(buffer) {
  const comBom = temBom(buffer, BOM_LE) || temBom(buffer, BOM_BE);
  if (!comBom && !ehBinario(buffer)) return { buffer, binario: false, utf16: false, texto: buffer.toString('utf8') };
  const decodificado = decodificarUtf16(buffer);
  if (decodificado === null) return { buffer, binario: true, utf16: false, texto: null };
  return { buffer, binario: false, utf16: true, texto: decodificado };
}

function lerArquivo(raiz, caminho) {
  const buffer = lerBytes(path.join(raiz, caminho));
  return buffer === null ? null : comoArquivo(buffer);
}

function bytesDaBase(raiz, desde, caminho) {
  try {
    return git(raiz, ['show', `${desde}:${caminho}`], { encoding: 'buffer' });
  } catch {
    return null;
  }
}

function contarLinhas(texto) {
  if (texto === '') return 0;
  const quebras = texto.split('\n').length - 1;
  return texto.endsWith('\n') ? quebras : quebras + 1;
}

function hashesDaBase(raiz, desde) {
  const saida = git(raiz, ['ls-tree', '-r', '-z', desde]);
  const hashes = new Map();
  for (const entrada of saida.split('\0').filter(Boolean)) {
    const [, , hash] = entrada.split(/\s/);
    const caminho = entrada.slice(entrada.indexOf('\t') + 1);
    if (!hashes.has(hash)) hashes.set(hash, []);
    hashes.get(hash).push(caminho);
  }
  return hashes;
}

const todasAsLinhasDe = texto => new Set(Array.from({ length: contarLinhas(texto) }, (_, i) => i + 1));

function acrescentarSoltos(itens, soltos) {
  const conhecidos = new Set(itens.map(item => item.caminho));
  for (const caminho of soltos) {
    if (!conhecidos.has(caminho)) itens.push({ status: 'A', caminho });
  }
}

class ClassificadorDeMudancas {
  constructor(raiz, desde, config, acrescentadas) {
    this.raiz = raiz;
    this.config = config;
    this.acrescentadas = acrescentadas;
    this.hashes = hashesDaBase(raiz, desde);
    this.copias = new Set();
  }

  isento(caminho) {
    return Boolean(this.config) && casaAlgum(this.config.ignorarCodigo, caminho);
  }

  saiuDaIsencao(origens, caminho) {
    return origens.every(origem => this.isento(origem)) && !this.isento(caminho);
  }

  classificar(item) {
    if (item.status === 'R') this.classificarRenomeado(item);
    else if (item.status === 'A') this.classificarNovo(item.caminho);
  }

  classificarRenomeado({ antigo, caminho }) {
    if (!this.saiuDaIsencao([antigo], caminho)) return;
    const arquivo = lerArquivo(this.raiz, caminho);
    if (arquivo) this.marcarTudo(caminho, arquivo);
  }

  classificarNovo(caminho) {
    const arquivo = lerArquivo(this.raiz, caminho);
    if (!arquivo) return;
    const origens = this.hashes.get(git(this.raiz, ['hash-object', '--', caminho]).trim());
    if (!origens) this.marcarNovo(caminho, arquivo);
    else if (this.saiuDaIsencao(origens, caminho)) this.marcarTudo(caminho, arquivo);
    else this.marcarCopia(caminho);
  }

  marcarTudo(caminho, arquivo) {
    if (!arquivo.binario) this.acrescentadas.set(caminho, todasAsLinhasDe(arquivo.texto));
  }

  marcarNovo(caminho, arquivo) {
    if (!this.acrescentadas.has(caminho)) this.marcarTudo(caminho, arquivo);
  }

  marcarCopia(caminho) {
    this.copias.add(caminho);
    this.acrescentadas.set(caminho, new Set());
  }
}

function lerMudancas(raiz, base, config = null) {
  const { desde } = base;
  const itens = lerStatus(git(raiz, ['diff', '--name-status', '-M', '-z', '--no-color', '--no-ext-diff', desde]));
  const diff = git(raiz, ['diff', '-U0', '-M', '--text', '--ignore-cr-at-eol', '--no-textconv', '--no-color', '--no-ext-diff', desde]);
  const acrescentadas = linhasAcrescentadas(diff);
  acrescentarSoltos(itens, git(raiz, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean));
  const classificador = new ClassificadorDeMudancas(raiz, desde, config, acrescentadas);
  for (const item of itens) classificador.classificar(item);
  return { base, itens, acrescentadas, copias: classificador.copias };
}

const origemNaBase = item => (item.status === 'A' ? null : item.antigo || item.caminho);

function arquivoNaBase(raiz, desde, caminho) {
  try {
    return git(raiz, ['show', `${desde}:${caminho}`]);
  } catch {
    return null;
  }
}

module.exports = { ErroDeUso, arquivoNaBase, bytesDaBase, contarLinhas, git, lerArquivo, lerMudancas, lerStatus, origemNaBase, resolverBase, tentar };
