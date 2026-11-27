'use strict';

const zlib = require('zlib');

const alinhar = (valor, multiplo) => Math.ceil(valor / multiplo) * multiplo;
const pad = (texto, tamanho) => texto.padEnd(tamanho, ' ');

const TIPOS_DE_BIBLIOTECA = { normal: 0xc, fraca: 0x80000018, reexportada: 0x8000001f };

function comandoDeBiblioteca({ nome, tipo = 'normal' }) {
  const tamanho = alinhar(24 + nome.length + 1, 8);
  const comando = Buffer.alloc(tamanho);
  comando.writeUInt32LE(TIPOS_DE_BIBLIOTECA[tipo], 0);
  comando.writeUInt32LE(tamanho, 4);
  comando.writeUInt32LE(24, 8);
  comando.write(nome, 24);
  return comando;
}

function blocoDeAssinatura(direitos) {
  const codeDirectory = Buffer.alloc(16);
  codeDirectory.writeUInt32BE(0xfade0c02, 0);
  codeDirectory.writeUInt32BE(16, 4);
  const xml = Buffer.from(direitos);
  const blocoDeDireitos = Buffer.alloc(8 + xml.length);
  blocoDeDireitos.writeUInt32BE(0xfade7171, 0);
  blocoDeDireitos.writeUInt32BE(blocoDeDireitos.length, 4);
  xml.copy(blocoDeDireitos, 8);
  const inicio = 12 + 16;
  const cabecalho = Buffer.alloc(inicio);
  cabecalho.writeUInt32BE(0xfade0cc0, 0);
  cabecalho.writeUInt32BE(inicio + codeDirectory.length + blocoDeDireitos.length, 4);
  cabecalho.writeUInt32BE(2, 8);
  cabecalho.writeUInt32BE(0, 12);
  cabecalho.writeUInt32BE(inicio, 16);
  cabecalho.writeUInt32BE(5, 20);
  cabecalho.writeUInt32BE(inicio + codeDirectory.length, 24);
  return Buffer.concat([cabecalho, codeDirectory, blocoDeDireitos]);
}

function tabelaDeSimbolos(simbolos) {
  const nomes = Buffer.from(`\0${simbolos.map(simbolo => `${simbolo.nome}\0`).join('')}`);
  const entradas = Buffer.alloc(simbolos.length * 16);
  let deslocamento = 1;
  simbolos.forEach((simbolo, indice) => {
    entradas.writeUInt32LE(deslocamento, indice * 16);
    entradas[indice * 16 + 4] = simbolo.tipo;
    deslocamento += simbolo.nome.length + 1;
  });
  return { entradas, nomes };
}

const IMPORTADO = 0x01;
const EXPORTADO = 0x0f;
const LOCAL = 0x0e;
const DEPURACAO = 0x2f;

function construirMacho({ importados = [], exportados = [], locais = [], bibliotecas = [], textos = [], seletores = [], codigo = 'codigo', direitos = null, rodape = 'u' } = {}) {
  const secoes = [
    ['__text', Buffer.from(codigo)],
    ['__cstring', Buffer.from(textos.map(texto => `${texto}\0`).join(''))],
    ['__objc_methname', Buffer.from(seletores.map(seletor => `${seletor}\0`).join(''))],
  ];
  const simbolos = [
    ...importados.map(nome => ({ nome, tipo: IMPORTADO })),
    ...exportados.map(nome => ({ nome, tipo: EXPORTADO })),
    ...locais.map(nome => ({ nome, tipo: LOCAL })),
    { nome: 'entrada-de-depuracao', tipo: DEPURACAO },
  ];
  const tabela = tabelaDeSimbolos(simbolos);
  const ligacoes = bibliotecas.map(comandoDeBiblioteca);
  const assinatura = direitos === null ? null : blocoDeAssinatura(direitos);
  const tamanhoDoSegmento = 72 + 80 * secoes.length;
  const comandos = tamanhoDoSegmento + 24 + ligacoes.reduce((soma, comando) => soma + comando.length, 0) + (assinatura ? 16 : 0);
  let posicao = 32 + comandos;
  const conteudos = [...secoes.map(([, dados]) => dados), tabela.entradas, tabela.nomes, ...(assinatura ? [assinatura] : [])];
  const posicoes = conteudos.map(dados => {
    const inicio = posicao;
    posicao += dados.length;
    return inicio;
  });
  const cabecalho = Buffer.alloc(32);
  cabecalho.writeUInt32LE(0xfeedfacf, 0);
  cabecalho.writeUInt32LE(3 + ligacoes.length + (assinatura ? 1 : 0), 16);
  cabecalho.writeUInt32LE(comandos, 20);
  const segmento = Buffer.alloc(tamanhoDoSegmento);
  segmento.writeUInt32LE(0x19, 0);
  segmento.writeUInt32LE(tamanhoDoSegmento, 4);
  segmento.write('__TEXT', 8);
  segmento.writeUInt32LE(secoes.length, 64);
  secoes.forEach(([nome, dados], indice) => {
    const base = 72 + indice * 80;
    segmento.write(nome, base);
    segmento.write('__TEXT', base + 16);
    segmento.writeBigUInt64LE(BigInt(dados.length), base + 40);
    segmento.writeUInt32LE(posicoes[indice], base + 48);
  });
  const simbolosComando = Buffer.alloc(24);
  simbolosComando.writeUInt32LE(2, 0);
  simbolosComando.writeUInt32LE(24, 4);
  simbolosComando.writeUInt32LE(posicoes[secoes.length], 8);
  simbolosComando.writeUInt32LE(simbolos.length, 12);
  simbolosComando.writeUInt32LE(posicoes[secoes.length + 1], 16);
  simbolosComando.writeUInt32LE(tabela.nomes.length, 20);
  const assinaturaComando = Buffer.alloc(16);
  assinaturaComando.writeUInt32LE(0x1d, 0);
  assinaturaComando.writeUInt32LE(16, 4);
  if (assinatura) assinaturaComando.writeUInt32LE(posicoes[secoes.length + 2], 8);
  const bytesDoRodape = Buffer.from(rodape);
  return Buffer.concat([cabecalho, segmento, simbolosComando, ...ligacoes, ...(assinatura ? [assinaturaComando] : []), ...conteudos, bytesDoRodape]);
}

function cabecalhoDoTar({ nome, prefixo = '', modo = 0o644, tamanho = 0, tipo = '0', alvo = '', mtime = 0, dono = 'root', grupo = 'wheel' }) {
  const bloco = Buffer.alloc(512);
  bloco.write(nome, 0);
  bloco.write(`${modo.toString(8).padStart(7, '0')}\0`, 100);
  bloco.write('0000000\0', 108);
  bloco.write('0000000\0', 116);
  bloco.write(`${tamanho.toString(8).padStart(11, '0')}\0`, 124);
  bloco.write(`${mtime.toString(8).padStart(11, '0')}\0`, 136);
  bloco.write('        ', 148);
  bloco.write(tipo, 156);
  bloco.write(alvo, 157);
  bloco.write('ustar\0', 257);
  bloco.write('00', 263);
  bloco.write(dono, 265);
  bloco.write(grupo, 297);
  bloco.write(prefixo, 345);
  const soma = bloco.reduce((total, byte) => total + byte, 0);
  bloco.write(`${soma.toString(8).padStart(6, '0')}\0 `, 148);
  return bloco;
}

function entradaDoTar(entrada) {
  const dados = entrada.dados === undefined ? Buffer.alloc(0) : Buffer.from(entrada.dados);
  const cabecalho = cabecalhoDoTar({ ...entrada, tamanho: dados.length });
  return Buffer.concat([cabecalho, dados, Buffer.alloc(alinhar(dados.length, 512) - dados.length)]);
}

function construirTar(entradas) {
  return Buffer.concat([...entradas.map(entradaDoTar), Buffer.alloc(1024)]);
}

function membroDoAr(nome, dados) {
  const cabecalho = Buffer.from(`${pad(`${nome}/`, 16)}${pad('0', 12)}${pad('0', 6)}${pad('0', 6)}${pad('100644', 8)}${pad(String(dados.length), 10)}\`\n`);
  return Buffer.concat([cabecalho, dados, Buffer.alloc(dados.length % 2)]);
}

function construirDeb({ controle, scripts = {}, arquivos = [], mtime = 0, compressao = 'gz' } = {}) {
  const comprimir = dados => (compressao === 'gz' ? zlib.gzipSync(dados) : dados);
  const sufixo = compressao === 'gz' ? '.gz' : '';
  const entradasDeControle = [
    { nome: './', tipo: '5', modo: 0o755, mtime },
    { nome: './control', dados: controle, mtime },
    ...Object.entries(scripts).map(([nome, dados]) => ({ nome: `./${nome}`, dados, modo: 0o755, mtime })),
  ];
  const entradasDeDados = arquivos.map(arquivo => ({ mtime, ...arquivo }));
  return Buffer.concat([
    Buffer.from('!<arch>\n'),
    membroDoAr('debian-binary', Buffer.from('2.0\n')),
    membroDoAr(`control.tar${sufixo}`, comprimir(construirTar(entradasDeControle))),
    membroDoAr(`data.tar${sufixo}`, comprimir(construirTar(entradasDeDados))),
  ]);
}

module.exports = { construirMacho, construirTar, construirDeb, membroDoAr };
