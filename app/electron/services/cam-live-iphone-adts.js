'use strict';

const LIMITE_DA_SAIDA = 1024 * 1024;
const MAIOR_PACOTE = 8191;
const MENOR_CABECALHO = 7;

function cabecalhoReconhecido(bytes) {
  return bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0;
}

function tamanhoDoCabecalho(bytes) {
  return bytes[1] & 1 ? 7 : 9;
}

function tamanhoDoPacote(bytes) {
  return ((bytes[3] & 3) << 11) | (bytes[4] << 3) | (bytes[5] >> 5);
}

function ehAacLcMonoDe44k(bytes) {
  const perfil = (bytes[2] >> 6) & 3;
  const frequencia = (bytes[2] >> 2) & 15;
  const canais = ((bytes[2] & 1) << 2) | (bytes[3] >> 6);
  const quadrosExtras = bytes[6] & 3;
  return [perfil === 1, frequencia === 4, canais === 1, quadrosExtras === 0].every(Boolean);
}

function lerCabecalho(bytes) {
  if (!cabecalhoReconhecido(bytes)) throw new Error('Encoder retornou áudio sem cabeçalho ADTS válido.');
  const cabecalho = tamanhoDoCabecalho(bytes);
  const tamanho = tamanhoDoPacote(bytes);
  if (tamanho <= cabecalho || tamanho > MAIOR_PACOTE) throw new Error('Tamanho de pacote AAC inválido.');
  if (!ehAacLcMonoDe44k(bytes)) throw new Error('Áudio do iPhone exige AAC-LC mono de 44,1 kHz.');
  return { cabecalho, tamanho };
}

function excedeOLimite(pendente, recebido) {
  return recebido.length > LIMITE_DA_SAIDA || pendente.length + recebido.length > LIMITE_DA_SAIDA;
}

class AdtsParser {
  constructor(onPacket) { this.pending = Buffer.alloc(0); this.onPacket = onPacket; }
  push(chunk) {
    const incoming = Buffer.from(chunk);
    if (excedeOLimite(this.pending, incoming)) throw new Error('Saída AAC excedeu o limite.');
    this.pending = Buffer.concat([this.pending, incoming]);
    const packets = [];
    while (this.pending.length >= MENOR_CABECALHO) {
      const { cabecalho, tamanho } = lerCabecalho(this.pending);
      if (this.pending.length < tamanho) break;
      const packet = Buffer.from(this.pending.subarray(cabecalho, tamanho));
      packets.push(packet);
      if (this.onPacket) this.onPacket(packet);
      this.pending = this.pending.subarray(tamanho);
    }
    return packets;
  }
}

module.exports = { AdtsParser };
