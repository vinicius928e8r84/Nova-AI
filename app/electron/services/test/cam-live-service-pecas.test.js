'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { register, CamLiveService, AMFReader, ByteWriter, parseTarget, FLV } = require('../cam-live-service');

const hex = (buffer) => Buffer.from(buffer).toString('hex');

test('ByteWriter escreve cada inteiro em ordem de rede, o u32le ao contrário, e corta o que passa do tamanho', () => {
  const w = new ByteWriter();
  w.u8(0x1ff).u16(0x0102).u24(0x010203).u32(0x01020304).u32(-1).u32le(0x01020304);
  assert.strictEqual(hex(w.data), 'ff' + '0102' + '010203' + '01020304' + 'ffffffff' + '04030201');
});

test('ByteWriter escreve texto com o tamanho em dois bytes e aceita Buffer, Uint8Array e pedaço de ArrayBuffer', () => {
  const w = new ByteWriter();
  w.str16('aé').bytes(Buffer.from([1, 2])).bytes(new Uint8Array([3, 4]));
  const grande = new Uint8Array([9, 8, 7, 6, 5]);
  w.bytes(grande.subarray(1, 3));
  assert.strictEqual(hex(w.data), '0003' + '61c3a9' + '0102' + '0304' + '0807');
});

const DOUBLE_UM = '3ff0000000000000';

test('ByteWriter.amf escreve null, indefinido, número, booleano e texto como no AMF0', () => {
  const casos = [
    [null, '05'], [undefined, '06'], [1, `00${DOUBLE_UM}`], [true, '0101'], [false, '0100'], ['ab', '020002' + '6162'], ['', '020000'],
  ];
  for (const [valor, esperado] of casos) assert.strictEqual(hex(new ByteWriter().amf(valor).data), esperado, String(valor));
});

test('ByteWriter.amf escreve objeto e vetor ECMA com o fim 00 00 09, e objeto dentro de objeto', () => {
  assert.strictEqual(hex(new ByteWriter().amf({ a: 1 }).data), `03` + `0001` + '61' + `00${DOUBLE_UM}` + '000009');
  assert.strictEqual(hex(new ByteWriter().amf({ __ecma: true, props: { a: 1, b: 'x' } }).data), '08' + '00000002' + '0001' + '61' + `00${DOUBLE_UM}` + '0001' + '62' + '020001' + '78' + '000009');
  assert.strictEqual(hex(new ByteWriter().amf({ o: { n: null } }).data), '03' + '0001' + '6f' + '03' + '0001' + '6e' + '05' + '000009' + '000009');
});

function lerTudo(buffer) {
  const leitor = new AMFReader(buffer);
  const valores = [];
  while (leitor.left > 0) valores.push(leitor.value());
  return valores;
}

test('AMFReader lê número, booleano, texto, null, indefinido, objeto, vetor ECMA, vetor estrito e texto longo', () => {
  const texto = Buffer.concat([
    Buffer.from('00' + DOUBLE_UM, 'hex'), Buffer.from('0101', 'hex'), Buffer.from('0200026869', 'hex'), Buffer.from('05', 'hex'), Buffer.from('06', 'hex'),
    Buffer.from('03' + '0001' + '61' + '0200017a' + '000009', 'hex'),
    Buffer.from('08' + '00000001' + '0001' + '62' + '0101' + '000009', 'hex'),
    Buffer.from('0a' + '00000002' + '05' + '0201' .slice(0, 0) + '0200016b', 'hex'),
    Buffer.from('0c' + '00000003' + '616263', 'hex'),
  ]);
  assert.deepStrictEqual(lerTudo(texto), [1, true, 'hi', null, undefined, { a: 'z' }, { b: true }, [null, 'k'], 'abc']);
});

test('AMFReader devolve indefinido para marca desconhecida e para o que está cortado, e left conta o que sobra', () => {
  assert.strictEqual(new AMFReader(Buffer.from([0x0f])).value(), undefined);
  assert.strictEqual(new AMFReader(Buffer.alloc(0)).value(), undefined);
  assert.strictEqual(new AMFReader(Buffer.from([0x00, 1, 2])).value(), undefined);
  const leitor = new AMFReader(Buffer.from([0x05, 0x05, 0x05]));
  assert.strictEqual(leitor.left, 3);
  leitor.value();
  assert.strictEqual(leitor.left, 2);
});

test('AMFReader lê de volta o que o ByteWriter escreveu', () => {
  const objeto = { app: 'live', n: 3.5, ligado: true, nada: null, dentro: { x: 'y' } };
  const lido = lerTudo(new ByteWriter().amf('connect').amf(7).amf(objeto).data);
  assert.deepStrictEqual(lido, ['connect', 7, objeto]);
});

test('parseTarget separa servidor, porta, aplicação e monta o tcUrl; a porta padrão é 1935', () => {
  assert.deepStrictEqual(parseTarget('rtmp://exemplo.test/live', 'k'), { host: 'exemplo.test', port: 1935, app: 'live', key: 'k', tcUrl: 'rtmp://exemplo.test:1935/live' });
  assert.deepStrictEqual(parseTarget('rtmp://exemplo.test:1936/app/sub/', 'k'), { host: 'exemplo.test', port: 1936, app: 'app/sub', key: 'k', tcUrl: 'rtmp://exemplo.test:1936/app/sub' });
  assert.deepStrictEqual(parseTarget('RTMP://Host', 'k'), { host: 'Host', port: 1935, app: '', key: 'k', tcUrl: 'rtmp://Host:1935/' });
  assert.deepStrictEqual(parseTarget('  rtmp://h:1/a//  ', undefined), { host: 'h', port: 1, app: 'a', key: undefined, tcUrl: 'rtmp://h:1/a' });
});

test('parseTarget recusa rtmps e o que não é endereço RTMP, dizendo o texto recebido', () => {
  assert.throws(() => parseTarget('rtmps://x/y', 'k'), { message: 'rtmps ainda não é suportado (use rtmp://)' });
  assert.throws(() => parseTarget('http://x', 'k'), { message: "URL inválida 'http://x'" });
  assert.throws(() => parseTarget('', 'k'), { message: "URL inválida ''" });
  assert.throws(() => parseTarget(null, 'k'), { message: "URL inválida 'null'" });
  assert.throws(() => parseTarget('rtmp://:1935/live', 'k'), { message: "URL inválida 'rtmp://:1935/live'" });
});

test('FLV monta os pacotes de vídeo e de áudio do jeito que o servidor espera', () => {
  assert.strictEqual(hex(FLV.sequenceHeader([1, 2])), '1700000000' + '0102');
  assert.strictEqual(hex(FLV.frame({ key: true, data: [9] })), '1701000000' + '09');
  assert.strictEqual(hex(FLV.frame({ key: false, data: Buffer.from([9, 8]) })), '2701000000' + '0908');
  assert.strictEqual(hex(FLV.endOfSequence()), '1702000000');
  assert.strictEqual(hex(FLV.audioSeq([0x11, 0x90])), 'af00' + '1190');
  assert.strictEqual(hex(FLV.audio([5])), 'af01' + '05');
});

function pastaTemporaria() {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-camlive-pecas-'));
  process.once('exit', () => fs.rmSync(raiz, { recursive: true, force: true }));
  return raiz;
}

test('o estúdio: sem arquivo ou com JSON quebrado devolve null; salvar cria a pasta, grava com recuo de dois e devolve ok', () => {
  const raiz = pastaTemporaria();
  const servico = new CamLiveService({ send: () => {}, studioFile: path.join(raiz, 'a', 'b', 'studio.json'), logFile: null });
  assert.strictEqual(servico.loadStudio(), null);
  assert.deepStrictEqual(servico.saveStudio({ cenas: [1, 2] }), { ok: true });
  assert.strictEqual(fs.readFileSync(path.join(raiz, 'a', 'b', 'studio.json'), 'utf8'), JSON.stringify({ cenas: [1, 2] }, null, 2));
  assert.deepStrictEqual(servico.loadStudio(), { cenas: [1, 2] });
  fs.writeFileSync(path.join(raiz, 'a', 'b', 'studio.json'), '{quebrado');
  assert.strictEqual(servico.loadStudio(), null);
});

test('o estúdio: se não dá para gravar devolve ok false com a mensagem do sistema', () => {
  const raiz = pastaTemporaria();
  fs.writeFileSync(path.join(raiz, 'arquivo'), 'x');
  const servico = new CamLiveService({ send: () => {}, studioFile: path.join(raiz, 'arquivo', 'studio.json'), logFile: null });
  const resposta = servico.saveStudio({});
  assert.strictEqual(resposta.ok, false);
  assert.strictEqual(typeof resposta.error, 'string');
  assert.ok(resposta.error.length > 0);
});

test('o log acrescenta uma linha com a data ao arquivo, ignora quem não tem arquivo e escreve no console só com CAMLIVE_DEBUG', () => {
  const raiz = pastaTemporaria();
  const arquivo = path.join(raiz, 'camlive.log');
  const servico = new CamLiveService({ send: () => {}, studioFile: path.join(raiz, 's.json'), logFile: arquivo });
  servico.log('primeira');
  servico.log('segunda');
  const linhas = fs.readFileSync(arquivo, 'utf8').split('\n');
  assert.match(linhas[0], /^\d{4}-\d{2}-\d{2}T[\d:.]+Z primeira$/);
  assert.match(linhas[1], /^\d{4}-\d{2}-\d{2}T[\d:.]+Z segunda$/);
  assert.strictEqual(linhas[2], '');
  new CamLiveService({ send: () => {}, studioFile: path.join(raiz, 's.json'), logFile: null }).log('sem arquivo');

  const anteriores = { log: console.log, info: console.info, debug: process.env.CAMLIVE_DEBUG };
  const chamadas = [];
  console.log = (...partes) => chamadas.push(partes);
  console.info = (...partes) => chamadas.push(partes);
  try {
    servico.log('sem depuração');
    process.env.CAMLIVE_DEBUG = '1';
    servico.log('com depuração');
  } finally {
    console.log = anteriores.log;
    console.info = anteriores.info;
    if (anteriores.debug === undefined) delete process.env.CAMLIVE_DEBUG;
    else process.env.CAMLIVE_DEBUG = anteriores.debug;
  }
  assert.deepStrictEqual(chamadas, [['[camlive]', 'com depuração']]);
});

function registrarComFalsos({ janela, celular }) {
  const raiz = pastaTemporaria();
  const canais = { handle: {}, on: {} };
  const ipcMain = { handle: (canal, tratador) => { canais.handle[canal] = tratador; }, on: (canal, ouvinte) => { canais.on[canal] = ouvinte; } };
  const servico = register({ ipcMain, getWindow: () => janela, userDataDir: raiz, getMobileService: () => celular });
  return { raiz, canais, servico };
}

test('register liga os onze canais, guarda o iPhone no serviço do celular e devolve o serviço do CAM LIVE', () => {
  const celular = {};
  const { canais, servico } = registrarComFalsos({ janela: null, celular });
  assert.deepStrictEqual(Object.keys(canais.handle), ['camlive:start', 'camlive:stop', 'camlive:frame', 'camlive:pcm', 'camlive:studio-load', 'camlive:studio-save']);
  assert.deepStrictEqual(Object.keys(canais.on), ['camlive:avcc', 'camlive:packet', 'camlive:aasc', 'camlive:apacket', 'camlive:log']);
  assert.ok(servico instanceof CamLiveService);
  assert.strictEqual(celular.camLiveIphone, servico.iphone);
});

test('register: o estúdio e o log ficam em CamLive dentro da pasta de dados, e a parada sem transmissão devolve ok', async () => {
  const { raiz, canais } = registrarComFalsos({ janela: null, celular: {} });
  assert.strictEqual(await canais.handle['camlive:studio-load'](), null);
  assert.deepStrictEqual(await canais.handle['camlive:studio-save']({}, { a: 1 }), { ok: true });
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(raiz, 'CamLive', 'studio.json'), 'utf8')), { a: 1 });
  assert.deepStrictEqual(await canais.handle['camlive:studio-load'](), { a: 1 });
  canais.on['camlive:log']({}, 12345);
  assert.match(fs.readFileSync(path.join(raiz, 'CamLive', 'camlive.log'), 'utf8'), / 12345\n$/);
  assert.deepStrictEqual(await canais.handle['camlive:stop'](), { ok: true });
});

test('register: o que o serviço avisa vai para a janela, e janela destruída ou ausente não recebe nada', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  const enviados = [];
  const janela = { destruida: false, isDestroyed() { return this.destruida; }, webContents: { send: (canal, carga) => enviados.push([canal, carga]) } };
  const { canais } = registrarComFalsos({ janela, celular: {} });
  assert.deepStrictEqual(await canais.handle['camlive:start']({}, { url: 'http://exemplo.test', key: 'k', maxRetries: 0 }), { ok: true });
  assert.deepStrictEqual(enviados.map(([canal, carga]) => [canal, carga.status]), [['camlive:status', 'Conectando…'], ['camlive:status', 'Pronto'], ['camlive:stats', undefined]]);
  assert.strictEqual(enviados[1][1].error, "URL inválida 'http://exemplo.test'");
  janela.destruida = true;
  enviados.length = 0;
  await canais.handle['camlive:start']({}, { url: 'http://exemplo.test', key: 'k', maxRetries: 0 });
  assert.deepStrictEqual(enviados, []);
});
