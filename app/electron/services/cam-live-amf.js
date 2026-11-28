'use strict';

const MARCA = { numero: 0x00, booleano: 0x01, texto: 0x02, objeto: 0x03, nulo: 0x05, indefinido: 0x06, vetorEcma: 0x08, fimDoObjeto: 0x09, vetor: 0x0a, textoLongo: 0x0c };

function duploEmBytes(valor) {
  const bytes = Buffer.alloc(8);
  bytes.writeDoubleBE(valor);
  return bytes;
}

function escreverNumero(escritor, valor) {
  escritor.u8(MARCA.numero);
  escritor.parts.push(duploEmBytes(valor));
  return escritor;
}

function escreverBooleano(escritor, valor) {
  return escritor.u8(MARCA.booleano).u8(valor ? 1 : 0);
}

function escreverVetorEcma(escritor, valor) {
  escritor.u8(MARCA.vetorEcma).u32(Object.keys(valor.props).length);
  return escritor._props(valor.props);
}

const ehNulo = (valor) => valor === null;
const ehIndefinido = (valor) => valor === undefined;
const ehNumero = (valor) => typeof valor === 'number';
const ehBooleano = (valor) => typeof valor === 'boolean';
const ehTexto = (valor) => typeof valor === 'string';

function ehVetorEcma(valor) {
  return Boolean(valor && valor.__ecma);
}

const ESCRITORES_DE_AMF = [
  [ehNulo, (escritor) => escritor.u8(MARCA.nulo)],
  [ehIndefinido, (escritor) => escritor.u8(MARCA.indefinido)],
  [ehNumero, escreverNumero],
  [ehBooleano, escreverBooleano],
  [ehTexto, (escritor, valor) => escritor.u8(MARCA.texto).str16(valor)],
  [ehVetorEcma, escreverVetorEcma],
];

class ByteWriter {
  constructor() { this.parts = []; }

  u8(v) { this.parts.push(Buffer.from([v & 0xff])); return this; }

  u16(v) { const b = Buffer.alloc(2); b.writeUInt16BE(v); this.parts.push(b); return this; }

  u24(v) { this.parts.push(Buffer.from([(v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff])); return this; }

  u32(v) { const b = Buffer.alloc(4); b.writeUInt32BE(v >>> 0); this.parts.push(b); return this; }

  u32le(v) { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); this.parts.push(b); return this; }

  bytes(buf) { this.parts.push(Buffer.from(buf.buffer ? Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength) : buf)); return this; }

  str16(s) { const d = Buffer.from(s, 'utf8'); this.u16(d.length); this.parts.push(d); return this; }

  amf(valor) {
    const escritor = ESCRITORES_DE_AMF.find(([serve]) => serve(valor));
    if (escritor) return escritor[1](this, valor);
    this.u8(MARCA.objeto);
    return this._props(valor);
  }

  _props(objeto) {
    for (const chave of Object.keys(objeto)) {
      this.str16(chave);
      this.amf(objeto[chave]);
    }
    return this.u16(0).u8(MARCA.fimDoObjeto);
  }

  get data() { return Buffer.concat(this.parts); }
}

const ecma = (props) => ({ __ecma: true, props });

function lerNumero(leitor) {
  if (leitor.left < 8) return undefined;
  const valor = leitor.b.readDoubleBE(leitor.p);
  leitor.p += 8;
  return valor;
}

function lerBooleano(leitor) {
  return leitor.b[leitor.p++] !== 0;
}

function lerTextoDeTamanho(leitor, tamanho) {
  const texto = leitor.b.toString('utf8', leitor.p, leitor.p + tamanho);
  leitor.p += tamanho;
  return texto;
}

function lerTexto(leitor) {
  const tamanho = leitor.b.readUInt16BE(leitor.p);
  leitor.p += 2;
  return lerTextoDeTamanho(leitor, tamanho);
}

function lerTextoLongo(leitor) {
  const tamanho = leitor.b.readUInt32BE(leitor.p);
  leitor.p += 4;
  return lerTextoDeTamanho(leitor, tamanho);
}

function lerVetorEcma(leitor) {
  leitor.p += 4;
  return leitor._props();
}

function lerVetor(leitor) {
  const quantidade = leitor.b.readUInt32BE(leitor.p);
  leitor.p += 4;
  const itens = [];
  for (let i = 0; i < quantidade; i++) itens.push(leitor.value());
  return itens;
}

const LEITORES_DE_AMF = {
  [MARCA.numero]: lerNumero,
  [MARCA.booleano]: lerBooleano,
  [MARCA.texto]: lerTexto,
  [MARCA.objeto]: (leitor) => leitor._props(),
  [MARCA.nulo]: () => null,
  [MARCA.indefinido]: () => undefined,
  [MARCA.vetorEcma]: lerVetorEcma,
  [MARCA.vetor]: lerVetor,
  [MARCA.textoLongo]: lerTextoLongo,
};

class AMFReader {
  constructor(buf) { this.b = buf; this.p = 0; }

  get left() { return this.b.length - this.p; }

  value() {
    if (this.left < 1) return undefined;
    const ler = LEITORES_DE_AMF[this.b[this.p++]];
    return ler ? ler(this) : undefined;
  }

  _props() {
    const objeto = {};
    while (this.left >= 3) {
      const tamanho = this.b.readUInt16BE(this.p);
      this.p += 2;
      if (tamanho === 0) {
        this.p++;
        return objeto;
      }
      const chave = lerTextoDeTamanho(this, tamanho);
      objeto[chave] = this.value();
    }
    return objeto;
  }
}

const FLV = {
  sequenceHeader: (avcC) => Buffer.concat([Buffer.from([0x17, 0x00, 0, 0, 0]), Buffer.from(avcC)]),
  frame: (p) => Buffer.concat([Buffer.from([p.key ? 0x17 : 0x27, 0x01, 0, 0, 0]), Buffer.from(p.data)]),
  endOfSequence: () => Buffer.from([0x17, 0x02, 0, 0, 0]),
  audioSeq: (asc) => Buffer.concat([Buffer.from([0xaf, 0x00]), Buffer.from(asc)]),
  audio: (data) => Buffer.concat([Buffer.from([0xaf, 0x01]), Buffer.from(data)]),
};

module.exports = { ByteWriter, AMFReader, FLV, ecma };
