'use strict';

const LIMITE_DO_QUADRO = 8 * 1024 * 1024;
const LIMITE_DA_FILA_DO_CLIENTE = 1024 * 1024;
const INICIO_DO_JPEG = Buffer.from([255, 216]);
const FIM_DO_JPEG = Buffer.from([255, 217]);

const tamanhoAceito = (quadro) => quadro.length >= 4 && quadro.length <= LIMITE_DO_QUADRO;

const comecaComoJpeg = (quadro) => quadro[0] === 255 && quadro[1] === 216;

const quadroValido = (quadro) => tamanhoAceito(quadro) && comecaComoJpeg(quadro);

const parteMultipart = (quadro) => Buffer.concat([
  Buffer.from('--nova\r\nContent-Type: image/jpeg\r\nContent-Length: ' + quadro.length + '\r\n\r\n'),
  quadro,
  Buffer.from('\r\n'),
]);

function entregarAoCliente(clientes, resposta, quadro) {
  if (resposta.destroyed || resposta.writableEnded) {
    clientes.delete(resposta);
    return;
  }
  if (resposta.writableLength > LIMITE_DA_FILA_DO_CLIENTE) return;
  resposta.write(parteMultipart(quadro));
}

function entregarQuadro(clientes, quadro) {
  for (const resposta of clientes) entregarAoCliente(clientes, resposta, quadro);
}

function separarQuadros(pendente, aoQuadro) {
  let resto = pendente;
  for (let fim = resto.indexOf(FIM_DO_JPEG); fim >= 0; fim = resto.indexOf(FIM_DO_JPEG)) {
    const inicio = resto.indexOf(INICIO_DO_JPEG);
    if (inicio >= 0 && inicio < fim) aoQuadro(resto.subarray(inicio, fim + 2).toString('base64'));
    resto = resto.subarray(fim + 2);
  }
  return resto.length > LIMITE_DO_QUADRO ? Buffer.alloc(0) : resto;
}

const argumentosDoDecoder = (video) => [
  '-nostdin', '-loglevel', 'error', '-re', '-stream_loop', '-1', '-i', video, '-an',
  '-vf', 'fps=15,scale=1280:1280:force_original_aspect_ratio=decrease',
  '-f', 'image2pipe', '-vcodec', 'mjpeg', '-q:v', '4', 'pipe:1',
];

class LeitorDoDecoder {
  constructor(decoder, aoQuadro) {
    this.erro = '';
    this.pendente = Buffer.alloc(0);
    decoder.stderr.on('data', (parte) => {
      this.erro = (this.erro + parte).slice(-2000);
    });
    decoder.stdout.on('data', (parte) => {
      this.pendente = separarQuadros(Buffer.concat([this.pendente, parte]), aoQuadro);
    });
  }
}

module.exports = { quadroValido, entregarQuadro, separarQuadros, argumentosDoDecoder, LeitorDoDecoder };
