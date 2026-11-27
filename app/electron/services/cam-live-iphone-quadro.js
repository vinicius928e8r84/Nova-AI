'use strict';

const MAIOR_QUADRO = 2 * 1024 * 1024;
const MAIOR_LADO = 4096;
const MARCADORES_SEM_DIMENSAO = [0xc4, 0xc8, 0xcc];

function ehBytes(dados) {
  return Buffer.isBuffer(dados) || dados instanceof Uint8Array;
}

function encerraOsSegmentos(marcador) {
  return marcador === 0xd9 || marcador === 0xda;
}

function ehMarcadorSemTamanho(marcador) {
  if (marcador === 0x01) return true;
  return marcador >= 0xd0 && marcador <= 0xd7;
}

function ehInicioDeQuadro(marcador) {
  if (MARCADORES_SEM_DIMENSAO.includes(marcador)) return false;
  return marcador >= 0xc0 && marcador <= 0xcf;
}

function proximoMarcador(bytes, posicao) {
  if (bytes[posicao] !== 0xff) return null;
  let inicio = posicao + 1;
  while (bytes[inicio] === 0xff) inicio++;
  return { marcador: bytes[inicio], corpo: inicio + 1 };
}

function tamanhoDoSegmento(bytes, posicao) {
  if (posicao + 2 > bytes.length) return null;
  const tamanho = bytes.readUInt16BE(posicao);
  return tamanho < 2 || posicao + tamanho > bytes.length ? null : tamanho;
}

function dimensoesDoSegmento(bytes, posicao, tamanho) {
  if (tamanho < 8) return null;
  return { width: bytes.readUInt16BE(posicao + 5), height: bytes.readUInt16BE(posicao + 3) };
}

function dimensoesDoJpeg(bytes) {
  let posicao = 2;
  while (posicao + 3 < bytes.length) {
    const achado = proximoMarcador(bytes, posicao);
    if (!achado || encerraOsSegmentos(achado.marcador)) return null;
    posicao = achado.corpo;
    if (ehMarcadorSemTamanho(achado.marcador)) continue;
    const tamanho = tamanhoDoSegmento(bytes, posicao);
    if (tamanho === null) return null;
    if (ehInicioDeQuadro(achado.marcador)) return dimensoesDoSegmento(bytes, posicao, tamanho);
    posicao += tamanho;
  }
  return null;
}

function tamanhoAceito(bytes) {
  return bytes.length >= 4 && bytes.length <= MAIOR_QUADRO;
}

function comecaEmSoi(bytes) {
  return bytes[0] === 0xff && bytes[1] === 0xd8;
}

function terminaEmEoi(bytes) {
  return bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
}

function delimitadoPorSoiEEoi(bytes) {
  return [tamanhoAceito, comecaEmSoi, terminaEmEoi].every((confere) => confere(bytes));
}

function ladoAceito(lado) {
  return lado >= 1 && lado <= MAIOR_LADO;
}

function dimensoesAceitas(tamanho) {
  if (!tamanho) return false;
  return ladoAceito(tamanho.width) && ladoAceito(tamanho.height);
}

function quadroJpeg(dados) {
  if (!ehBytes(dados)) return { ok: false, error: 'Quadro JPEG inválido.' };
  const bytes = Buffer.from(dados);
  if (!delimitadoPorSoiEEoi(bytes)) return { ok: false, error: 'Quadro JPEG inválido ou maior que 2 MiB.' };
  if (!dimensoesAceitas(dimensoesDoJpeg(bytes))) return { ok: false, error: 'O JPEG precisa ter dimensões válidas de até 4096×4096.' };
  return { ok: true, bytes };
}

module.exports = { ehBytes, quadroJpeg };
