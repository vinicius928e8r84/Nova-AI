'use strict';

const zlib = require('zlib');
const { spawnSync } = require('child_process');

const ASSINATURA_AR = '!<arch>\n';
const CABECALHO_AR = 60;
const BLOCO_TAR = 512;
const LIMITE_DO_DESCOMPRESSOR = 1024 * 1024 * 1024;

const TIPOS_DE_ENTRADA = { '0': 'arquivo', '\0': 'arquivo', '5': 'pasta', '2': 'link', '1': 'link-duro' };

const DESCOMPRESSORES = {
  '': dados => dados,
  '.gz': dados => zlib.gunzipSync(dados),
  '.xz': dados => descomprimirFora(['xz', '-dc'], dados),
  '.lzma': dados => descomprimirFora(['xz', '-dc', '--format=lzma'], dados),
  '.zst': dados => descomprimirFora(['zstd', '-dc'], dados),
};

function descomprimirFora([programa, ...argumentos], dados) {
  const resultado = spawnSync(programa, argumentos, { input: dados, maxBuffer: LIMITE_DO_DESCOMPRESSOR });
  if (resultado.error) throw new Error(`o programa ${programa} não foi achado para abrir o pacote`);
  if (resultado.status !== 0) throw new Error(`o programa ${programa} falhou ao abrir o pacote`);
  return resultado.stdout;
}

function descomprimir(nomeDoMembro, dados) {
  const extensao = nomeDoMembro.replace(/^[^.]+\.tar/, '');
  const descompressor = DESCOMPRESSORES[extensao];
  if (!descompressor) throw new Error(`compressão não suportada em ${nomeDoMembro}`);
  return descompressor(dados);
}

function lerAr(buffer) {
  if (buffer.toString('latin1', 0, ASSINATURA_AR.length) !== ASSINATURA_AR) throw new Error('o arquivo não é um .deb (falta a assinatura ar)');
  const membros = [];
  let posicao = ASSINATURA_AR.length;
  while (posicao + CABECALHO_AR <= buffer.length) {
    const nome = buffer.toString('latin1', posicao, posicao + 16).trim().replace(/\/$/, '');
    const tamanho = parseInt(buffer.toString('latin1', posicao + 48, posicao + 58), 10);
    const inicio = posicao + CABECALHO_AR;
    if (!(tamanho >= 0) || inicio + tamanho > buffer.length) throw new Error(`o .deb está truncado no membro ${nome}`);
    membros.push({ nome, dados: buffer.subarray(inicio, inicio + tamanho) });
    posicao = inicio + tamanho + (tamanho % 2);
  }
  return membros;
}

function textoDoBloco(bloco, inicio, fim) {
  const texto = bloco.toString('utf8', inicio, fim);
  const fimDoTexto = texto.indexOf('\0');
  return fimDoTexto < 0 ? texto : texto.slice(0, fimDoTexto);
}

const octalDoBloco = (bloco, inicio, fim) => parseInt(textoDoBloco(bloco, inicio, fim).trim() || '0', 8);

function prefixoDoCaminho(bloco) {
  const formatoPosix = textoDoBloco(bloco, 257, 263) === 'ustar' && textoDoBloco(bloco, 263, 265) === '00';
  return formatoPosix ? textoDoBloco(bloco, 345, 500) : '';
}

function cabecalhoDoTar(bloco) {
  const prefixo = prefixoDoCaminho(bloco);
  const nome = textoDoBloco(bloco, 0, 100);
  return {
    caminho: prefixo ? `${prefixo}/${nome}` : nome,
    modo: octalDoBloco(bloco, 100, 108),
    tamanho: octalDoBloco(bloco, 124, 136),
    tipo: String.fromCharCode(bloco[156]),
    alvo: textoDoBloco(bloco, 157, 257),
    dono: textoDoBloco(bloco, 265, 297),
    grupo: textoDoBloco(bloco, 297, 329),
  };
}

function registrosPax(dados) {
  const campos = {};
  let posicao = 0;
  while (posicao < dados.length) {
    const espaco = dados.indexOf(0x20, posicao);
    const tamanho = parseInt(dados.toString('utf8', posicao, espaco), 10);
    const registro = dados.toString('utf8', espaco + 1, posicao + tamanho - 1);
    const igual = registro.indexOf('=');
    campos[registro.slice(0, igual)] = registro.slice(igual + 1);
    posicao += tamanho;
  }
  return campos;
}

const EXTENSOES_DO_TAR = {
  x: dados => {
    const campos = registrosPax(dados);
    return { caminho: campos.path, alvo: campos.linkpath };
  },
  L: dados => ({ caminho: textoDoBloco(dados, 0, dados.length) }),
  K: dados => ({ alvo: textoDoBloco(dados, 0, dados.length) }),
  g: () => ({}),
};

function normalizarCaminho(caminho) {
  return caminho.replace(/^(\.\/)+/, '').replace(/\/+$/, '');
}

function entradaDoTar(cabecalho, dados, sobrescrita) {
  const caminho = normalizarCaminho(sobrescrita.caminho || cabecalho.caminho);
  if (!caminho || caminho === '.') return null;
  return {
    caminho,
    tipo: TIPOS_DE_ENTRADA[cabecalho.tipo] || `tipo-${cabecalho.tipo}`,
    modo: (cabecalho.modo & 0o7777).toString(8).padStart(4, '0'),
    dono: cabecalho.dono,
    grupo: cabecalho.grupo,
    alvo: sobrescrita.alvo || cabecalho.alvo,
    dados,
  };
}

function lerTar(buffer) {
  const entradas = [];
  let posicao = 0;
  let sobrescrita = {};
  while (posicao + BLOCO_TAR <= buffer.length) {
    const bloco = buffer.subarray(posicao, posicao + BLOCO_TAR);
    if (bloco.every(byte => byte === 0)) break;
    const cabecalho = cabecalhoDoTar(bloco);
    const inicio = posicao + BLOCO_TAR;
    const dados = buffer.subarray(inicio, inicio + cabecalho.tamanho);
    posicao = inicio + Math.ceil(cabecalho.tamanho / BLOCO_TAR) * BLOCO_TAR;
    const extensao = EXTENSOES_DO_TAR[cabecalho.tipo];
    if (extensao) {
      sobrescrita = { ...sobrescrita, ...extensao(dados) };
      continue;
    }
    const entrada = entradaDoTar(cabecalho, dados, sobrescrita);
    sobrescrita = {};
    if (entrada) entradas.push(entrada);
  }
  return entradas;
}

module.exports = { lerAr, lerTar, descomprimir };
