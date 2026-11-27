'use strict';

const crypto = require('crypto');

const MAGIA_64_BITS = 0xfeedfacf;
const MAGIA_FAT = 0xcafebabe;
const CABECALHO = 32;
const COMANDO_SEGMENTO = 0x19;
const COMANDO_SIMBOLOS = 0x2;
const COMANDO_ASSINATURA = 0x1d;
const MAGIA_SUPERBLOCO = 0xfade0cc0;
const MAGIA_DIREITOS_XML = 0xfade7171;

const COMANDOS_DE_BIBLIOTECA = new Map([
  [0xc, ''],
  [0x80000018, ' (fraca)'],
  [0x8000001f, ' (reexportada)'],
  [0x20, ' (preguiçosa)'],
  [0x80000023, ' (acima)'],
]);

const SECAO_DOS_TEXTOS = '__TEXT,__cstring';
const SECAO_DOS_SELETORES = '__TEXT,__objc_methname';
const SECAO_DO_CODIGO = '__TEXT,__text';

function ehMacho(buffer) {
  if (buffer.length < CABECALHO) return false;
  if (buffer.readUInt32BE(0) === MAGIA_FAT) throw new Error('binário Mach-O com várias arquiteturas (fat) não é suportado');
  return buffer.readUInt32LE(0) === MAGIA_64_BITS;
}

function listarComandos(buffer) {
  const total = buffer.readUInt32LE(16);
  const comandos = [];
  let posicao = CABECALHO;
  for (let indice = 0; indice < total; indice++) {
    const tamanho = buffer.readUInt32LE(posicao + 4);
    comandos.push({ tipo: buffer.readUInt32LE(posicao), posicao, tamanho });
    posicao += tamanho;
  }
  return comandos;
}

function textoAte0(buffer, inicio, limite) {
  let fim = inicio;
  while (fim < limite && buffer[fim] !== 0) fim++;
  return buffer.toString('utf8', inicio, fim);
}

function secoesDoSegmento(buffer, comando) {
  const total = buffer.readUInt32LE(comando.posicao + 64);
  const secoes = [];
  for (let indice = 0; indice < total; indice++) {
    const base = comando.posicao + 72 + indice * 80;
    secoes.push({
      nome: `${textoAte0(buffer, base + 16, base + 32)},${textoAte0(buffer, base, base + 16)}`,
      tamanho: Number(buffer.readBigUInt64LE(base + 40)),
      posicao: buffer.readUInt32LE(base + 48),
    });
  }
  return secoes;
}

function textosDaSecao(buffer, secao) {
  if (!secao) return [];
  const conteudo = buffer.subarray(secao.posicao, secao.posicao + secao.tamanho);
  const textos = conteudo.toString('utf8').split('\0').filter(texto => texto.length > 0);
  return [...new Set(textos)].sort();
}

function resumoDoCodigo(buffer, secao) {
  if (!secao) return null;
  return crypto.createHash('sha256').update(buffer.subarray(secao.posicao, secao.posicao + secao.tamanho)).digest('hex');
}

function simbolosDaTabela(buffer, comando) {
  const inicioDosSimbolos = buffer.readUInt32LE(comando.posicao + 8);
  const total = buffer.readUInt32LE(comando.posicao + 12);
  const inicioDosNomes = buffer.readUInt32LE(comando.posicao + 16);
  const tamanhoDosNomes = buffer.readUInt32LE(comando.posicao + 20);
  const simbolos = [];
  for (let indice = 0; indice < total; indice++) {
    const base = inicioDosSimbolos + indice * 16;
    const nome = textoAte0(buffer, inicioDosNomes + buffer.readUInt32LE(base), inicioDosNomes + tamanhoDosNomes);
    simbolos.push({ nome, tipo: buffer[base + 4] });
  }
  return simbolos;
}

const ehExterno = simbolo => (simbolo.tipo & 0xe0) === 0 && (simbolo.tipo & 0x01) === 1;
const ehImportado = simbolo => ehExterno(simbolo) && (simbolo.tipo & 0x0e) === 0;
const ehExportado = simbolo => ehExterno(simbolo) && [0x0e, 0x02].includes(simbolo.tipo & 0x0e);
const nomesOrdenados = simbolos => [...new Set(simbolos.map(simbolo => simbolo.nome))].sort();

function bibliotecasLigadas(buffer, comandos) {
  const ligadas = comandos.filter(comando => COMANDOS_DE_BIBLIOTECA.has(comando.tipo));
  return ligadas
    .map(comando => {
      const inicio = comando.posicao + buffer.readUInt32LE(comando.posicao + 8);
      return textoAte0(buffer, inicio, comando.posicao + comando.tamanho) + COMANDOS_DE_BIBLIOTECA.get(comando.tipo);
    })
    .sort();
}

function direitosDaAssinatura(buffer, comando) {
  if (!comando) return [];
  const inicio = buffer.readUInt32LE(comando.posicao + 8);
  if (buffer.readUInt32BE(inicio) !== MAGIA_SUPERBLOCO) return [];
  const total = buffer.readUInt32BE(inicio + 8);
  for (let indice = 0; indice < total; indice++) {
    const bloco = inicio + buffer.readUInt32BE(inicio + 16 + indice * 8);
    if (buffer.readUInt32BE(bloco) === MAGIA_DIREITOS_XML) {
      return buffer.toString('utf8', bloco + 8, bloco + buffer.readUInt32BE(bloco + 4)).split('\n').map(linha => linha.trim()).filter(Boolean);
    }
  }
  return [];
}

function lerMacho(buffer) {
  const comandos = listarComandos(buffer);
  const secoes = comandos.filter(comando => comando.tipo === COMANDO_SEGMENTO).flatMap(comando => secoesDoSegmento(buffer, comando));
  const secao = nome => secoes.find(candidata => candidata.nome === nome);
  const tabela = comandos.find(comando => comando.tipo === COMANDO_SIMBOLOS);
  const simbolos = tabela ? simbolosDaTabela(buffer, tabela) : [];
  const assinatura = comandos.find(comando => comando.tipo === COMANDO_ASSINATURA);
  return {
    assinado: Boolean(assinatura),
    bibliotecas: bibliotecasLigadas(buffer, comandos),
    codigo: resumoDoCodigo(buffer, secao(SECAO_DO_CODIGO)),
    direitos: direitosDaAssinatura(buffer, assinatura),
    seletores: textosDaSecao(buffer, secao(SECAO_DOS_SELETORES)),
    simbolosExportados: nomesOrdenados(simbolos.filter(ehExportado)),
    simbolosImportados: nomesOrdenados(simbolos.filter(ehImportado)),
    textos: textosDaSecao(buffer, secao(SECAO_DOS_TEXTOS)),
  };
}

module.exports = { ehMacho, lerMacho };
