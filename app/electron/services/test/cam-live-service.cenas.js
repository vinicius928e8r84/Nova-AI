'use strict';
const { chamar, voltas, mensagemDoServidor, comandoAmf } = require('./cam-live-service.palco');

const CONFIGURACAO = {
  url: 'rtmp://srv.local/live/', key: 'chave', dropMs: 700, pframeDropMs: 900, dyn: false, bitrate: 2500,
  width: 1280, height: 720, fps: 30, retryDelaySec: 2, maxRetries: 2,
};
const AVCC = Uint8Array.from([1, 0x64, 0, 0x1f, 0xff, 0xe1, 0, 2, 0x67, 0x42]);
const ASC = Uint8Array.from([0x11, 0x90]);
const CODIGOS = [null, undefined, '', 'ENOTFOUND', 'EHOSTUNREACH', 'ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'EADDRNOTAVAIL',
  'ENETUNREACH', 'EACCES', 'ECONNREFUSED', 'EOUTRO', 42];

function servico(modulo, roteiro, opcoes = {}) {
  return new modulo.CamLiveService({
    send: (canal, dados) => roteiro.anotar('send', canal, dados),
    studioFile: '/estudio/CamLive/studio.json',
    logFile: opcoes.semLog ? null : '/estudio/CamLive/camlive.log',
  });
}

const quadro = (i, key = i % 30 === 0) => ({ data: Uint8Array.from([0, 0, 0, 2, key ? 0x65 : 0x41, i & 0xff]), ptsUs: i * 33333, key });
const somDoQuadro = i => ({ data: Uint8Array.from([0x21, i & 0xff]), ptsUs: i * 33333 + 100 });

function socketDeMemoria(roteiro) {
  return {
    destroyed: false,
    writable: true,
    write: (buf, cb) => {
      roteiro.anotar('mem.write', buf);
      if (cb) setImmediate(() => cb(roteiro.falhaDeEscrita || undefined));
      return true;
    },
    end: () => roteiro.anotar('mem.end'),
    destroy: () => roteiro.anotar('mem.destroy'),
  };
}

function clienteDeLeitura(modulo, roteiro) {
  const cliente = new modulo.RtmpClient(texto => roteiro.anotar('log', texto));
  cliente.sock = socketDeMemoria(roteiro);
  cliente.phase = 'chunks';
  return cliente;
}

function estadoDoCliente(cliente) {
  return {
    inChunk: cliente.inChunk, bytesIn: cliente.bytesIn, lastAck: cliente.lastAck, resto: cliente.rb.length, phase: cliente.phase,
    estados: [...cliente.inState.entries()].map(([csid, st]) => ({ csid, ts: st.ts, len: st.len, type: st.type, sid: st.sid, delta: st.delta, ext: st.ext, got: st.got, partes: st.parts.length })),
  };
}

async function alimentar(cliente, roteiro, rotulo, bytes) {
  cliente.rb = cliente.rb.length ? Buffer.concat([cliente.rb, bytes]) : Buffer.from(bytes);
  await chamar(roteiro, `pump ${rotulo}`, () => cliente._pump());
  await voltas();
  roteiro.anotar(`estado ${rotulo}`, estadoDoCliente(cliente));
}

function pedidoPendente(cliente, roteiro, id) {
  cliente.pending.set(id, {
    resolve: v => roteiro.anotar(`pendente ${id} resolvido`, v),
    reject: e => roteiro.anotar(`pendente ${id} rejeitado`, e),
    t: setTimeout(() => roteiro.anotar(`pendente ${id} venceu`), 10000),
  });
}

function unidadesDoAmf({ ByteWriter, AMFReader }, roteiro) {
  const valores = [null, undefined, 1.5, -2, true, false, 'olá', { a: 1, b: 'x', c: { d: null } }, { __ecma: true, props: { w: 1280, ok: true } }, [1, 2]];
  for (const valor of valores) roteiro.anotar('amf', valor, new ByteWriter().amf(valor).data);
  const w = new ByteWriter().u8(0x1ff).u16(0xbeef).u24(0x123456).u32(-1).u32le(0x01020304).bytes(new Uint8Array([9, 8, 7]).subarray(1)).bytes([5, 6]).str16('ab');
  roteiro.anotar('escritor', w.data);
  const leituras = {
    numero: '00400c000000000000', numeroCurto: '00400c', bool: '0100', texto: '0200026f69', objeto: '030001610040000000000000000009',
    nulo: '05', indefinido: '06', ecma: '080000000100017802000179000009', lista: '0a0000000200410000000000000005', longo: '0c00000003616263',
    desconhecido: '07', vazio: '', objetoSemFim: '030001610100',
  };
  for (const [nome, hex] of Object.entries(leituras)) {
    const leitor = new AMFReader(Buffer.from(hex.length % 2 ? `${hex}0` : hex, 'hex'));
    roteiro.anotar(`ler ${nome}`, leitor.value(), leitor.p, leitor.left);
  }
}

async function unidadesDoAlvo({ parseTarget, FLV }, roteiro) {
  for (const url of ['rtmp://a.b/live', 'RTMP://host:1940/app/sub///', 'rtmp://h', '  rtmp://h:19/x  ', 'rtmps://h/x', 'http://h/x', null, 'rtmp://h:/x']) {
    await chamar(roteiro, `parseTarget ${url}`, () => parseTarget(url, 'k'));
  }
  roteiro.anotar('FLV', FLV.sequenceHeader([1, 2]), FLV.frame({ key: true, data: [3] }), FLV.frame({ key: false, data: [4] }),
    FLV.endOfSequence(), FLV.audioSeq([5]), FLV.audio([6]));
}

function unidadesDoErro({ RtmpOutput }, roteiro) {
  roteiro.anotar('errText', CODIGOS.map(codigo => RtmpOutput.prototype._errText(codigo)));
}

async function mensagensDoCliente(modulo, roteiro) {
  const cliente = new modulo.RtmpClient();
  cliente.sock = socketDeMemoria(roteiro);
  cliente.streamId = 1;
  await chamar(roteiro, 'vídeo curto', () => cliente.sendVideo(Buffer.from([1, 2, 3]), 5));
  await chamar(roteiro, 'áudio vazio', () => cliente.sendAudio(Buffer.alloc(0), 0));
  await chamar(roteiro, 'vídeo longo', () => cliente.sendVideo(Buffer.alloc(9000, 7), 77));
  await chamar(roteiro, 'vídeo longo estendido', () => cliente.sendVideo(Buffer.alloc(5000, 8), 0x1000000));
  await chamar(roteiro, 'tempo negativo', () => cliente.sendAudio(Buffer.from([9]), -1));
  cliente.outChunk = 2;
  await chamar(roteiro, 'áudio em pedaços de 2', () => cliente.sendAudio(Buffer.from([1, 2, 3, 4, 5]), 0xffffff));
  cliente.sock = null;
  await chamar(roteiro, 'send sem socket', () => cliente.send(Buffer.from([1])));
  roteiro.anotar('lastErrno', cliente.lastErrno);
  cliente.sock = socketDeMemoria(roteiro);
  cliente.sock.destroyed = true;
  cliente.lastErrno = 'ECONNRESET';
  await chamar(roteiro, 'send destruído', () => cliente.send(Buffer.from([2])));
  roteiro.anotar('lastErrno', cliente.lastErrno);
  cliente.sock = socketDeMemoria(roteiro);
  roteiro.falhaDeEscrita = Object.assign(new Error('EPIPE escrita'), { code: 'EPIPE' });
  await chamar(roteiro, 'send com erro', () => cliente.send(Buffer.from([3])));
  roteiro.falhaDeEscrita = new Error('sem código');
  await chamar(roteiro, 'send com erro sem código', () => cliente.send(Buffer.from([4])));
  roteiro.anotar('lastErrno', cliente.lastErrno);
  roteiro.falhaDeEscrita = null;
  cliente.throttleKbps = 8;
  const lento = cliente.send(Buffer.alloc(100));
  await roteiro.avancar(99);
  roteiro.anotar('timers do throttle', roteiro.relogio.fila.length);
  await roteiro.avancar(1);
  await chamar(roteiro, 'send lento', () => lento);
}

async function leituraDoCliente(modulo, roteiro) {
  const cliente = clienteDeLeitura(modulo, roteiro);
  const tamanho = Buffer.alloc(4);
  tamanho.writeUInt32BE(256);
  await alimentar(cliente, roteiro, 'chunk size', mensagemDoServidor({ csid: 2, tipo: 1, corpo: tamanho }));
  await alimentar(cliente, roteiro, 'chunk size curto', mensagemDoServidor({ csid: 2, tipo: 1, corpo: Buffer.from([1, 2]) }));
  await alimentar(cliente, roteiro, 'ping', mensagemDoServidor({ csid: 2, tipo: 4, corpo: Buffer.from([0, 6, 0, 0, 1, 2]) }));
  await alimentar(cliente, roteiro, 'evento que não é ping', mensagemDoServidor({ csid: 2, tipo: 4, corpo: Buffer.from([0, 0, 0, 0, 0, 1]) }));
  await alimentar(cliente, roteiro, 'janela de ack', mensagemDoServidor({ csid: 2, tipo: 6, corpo: Buffer.from([0, 0x26, 0x25, 0xa0, 2]) }));
  await alimentar(cliente, roteiro, 'janela curta', mensagemDoServidor({ csid: 2, tipo: 6, corpo: Buffer.from([0, 1]) }));
  pedidoPendente(cliente, roteiro, 7);
  pedidoPendente(cliente, roteiro, 8);
  await alimentar(cliente, roteiro, '_result', mensagemDoServidor({ corpo: comandoAmf(['_result', 7, null, 'ok']) }));
  await alimentar(cliente, roteiro, '_error com código', mensagemDoServidor({ corpo: comandoAmf(['_error', 8, null, { code: 'NetStream.Publish.BadName' }]) }));
  pedidoPendente(cliente, roteiro, 9);
  await alimentar(cliente, roteiro, '_error sem objeto', mensagemDoServidor({ corpo: comandoAmf(['_error', 9, null, 'x']) }));
  await alimentar(cliente, roteiro, '_result sem pendente', mensagemDoServidor({ corpo: comandoAmf(['_result', 99]) }));
  await alimentar(cliente, roteiro, '_result sem número', mensagemDoServidor({ corpo: comandoAmf(['_result', 'x']) }));
  await alimentar(cliente, roteiro, 'onStatus', mensagemDoServidor({ csid: 5, corpo: comandoAmf(['onStatus', 0, null, { code: 'NetStream.Publish.Start' }]) }));
  await alimentar(cliente, roteiro, 'onStatus sem código', mensagemDoServidor({ csid: 5, corpo: comandoAmf(['onStatus', 0, null, 'nada']) }));
  await alimentar(cliente, roteiro, 'comando com muitos valores', mensagemDoServidor({ corpo: comandoAmf(Array.from({ length: 20 }, (_, i) => i)) }));
  pedidoPendente(cliente, roteiro, 10);
  await alimentar(cliente, roteiro, '_result com muitos valores', mensagemDoServidor({ corpo: comandoAmf(['_result', 10, ...Array.from({ length: 15 }, (_, i) => i)]) }));
  const relogioDoCanal = clienteDeLeitura(modulo, roteiro);
  await alimentar(relogioDoCanal, roteiro, 'tempo perto do limite', Buffer.from([0x09, 0xff, 0xff, 0xff, 0, 0, 0, 9, 0, 0, 0, 0, 0xff, 0xff, 0xff, 0xf0]));
  await alimentar(relogioDoCanal, roteiro, 'delta que dá a volta', Buffer.from([0x89, 0, 0, 0x20]));
  await alimentar(cliente, roteiro, 'tipo desconhecido', mensagemDoServidor({ csid: 6, tipo: 9, corpo: Buffer.from([1, 2, 3]) }));
  await alimentar(cliente, roteiro, 'csid de dois bytes', Buffer.concat([Buffer.from([0x00, 10, 0, 0, 1, 0, 0, 2, 9, 0, 0, 0, 0]), Buffer.from([1, 2])]));
  await alimentar(cliente, roteiro, 'csid de três bytes', Buffer.concat([Buffer.from([0x01, 4, 1, 0, 0, 2, 0, 0, 2, 9, 1, 0, 0, 0]), Buffer.from([3, 4])]));
  await alimentar(cliente, roteiro, 'fmt1', Buffer.from([0x46, 0, 0, 5, 0, 0, 1, 8, 0xaa]));
  await alimentar(cliente, roteiro, 'fmt2', Buffer.from([0x86, 0, 0, 7, 0xbb]));
  await alimentar(cliente, roteiro, 'fmt3', Buffer.from([0xc6, 0xcc]));
  await alimentar(cliente, roteiro, 'estendido fmt0', Buffer.from([0x07, 0xff, 0xff, 0xff, 0, 1, 0x2c, 9, 1, 0, 0, 0, 1, 0, 0, 0, ...Buffer.alloc(256, 1)]));
  await alimentar(cliente, roteiro, 'estendido fmt3', Buffer.from([0xc7, 1, 0, 0, 0, ...Buffer.alloc(44, 2)]));
  await alimentar(cliente, roteiro, 'estendido fmt1', Buffer.from([0x47, 0xff, 0xff, 0xff, 0, 0, 1, 9, 0, 0, 0, 5, 3]));
  const truncados = [[], [0x00], [0x01, 4], [0x03, 0, 0], [0x03, 0, 0, 1, 0, 0], [0x03, 0, 0, 1, 0, 0, 1, 9, 1, 0], [0x08, 0xff, 0xff, 0xff, 0, 0, 1, 9, 0, 0, 0, 0, 1], [0xc8], [0x03, 0, 0, 1, 0, 0, 3, 9, 0, 0, 0, 0, 1]];
  for (const bytes of truncados) {
    const outro = clienteDeLeitura(modulo, roteiro);
    outro.inState.set(8, { ts: 0, len: 4, type: 9, sid: 0, delta: 0, ext: true, parts: [], got: 0 });
    await alimentar(outro, roteiro, `truncado ${Buffer.from(bytes).toString('hex')}`, Buffer.from(bytes));
  }
}

async function ackDoCliente(modulo, roteiro) {
  const cliente = clienteDeLeitura(modulo, roteiro);
  cliente.inChunk = 3000000;
  await alimentar(cliente, roteiro, 'mensagem de 2,6 MB', mensagemDoServidor({ csid: 6, tipo: 9, corpo: Buffer.alloc(2600000, 3), pedaco: 3000000 }));
  await alimentar(cliente, roteiro, 'mais um byte', mensagemDoServidor({ csid: 6, tipo: 9, corpo: Buffer.from([1]) }));
}

async function handshakeDoCliente(modulo, roteiro) {
  for (const versao of [3, 6]) {
    const cliente = clienteDeLeitura(modulo, roteiro);
    cliente.phase = 'hs';
    cliente.hsWait = { resolve: () => roteiro.anotar('hs resolvido'), reject: e => roteiro.anotar('hs rejeitado', e) };
    await alimentar(cliente, roteiro, `parcial v${versao}`, Buffer.from([versao, ...Buffer.alloc(100)]));
    await alimentar(cliente, roteiro, `completo v${versao}`, Buffer.concat([Buffer.alloc(2972, 0x33), mensagemDoServidor({ csid: 2, tipo: 1, corpo: Buffer.from([0, 0, 1, 0]) })]));
  }
  const parado = clienteDeLeitura(modulo, roteiro);
  parado.phase = 'dead';
  await alimentar(parado, roteiro, 'morto', Buffer.from([1, 2, 3]));
}

const ALVO = { host: 'srv.local', port: 1935, app: 'live', key: 'chave', tcUrl: 'rtmp://srv.local:1935/live' };

async function conectarCliente(modulo, roteiro, { fechar = true, esperar = 0 } = {}) {
  const cliente = new modulo.RtmpClient(texto => roteiro.anotar('log', texto));
  cliente.onClose = () => roteiro.anotar('onClose');
  const conexao = chamar(roteiro, 'connect', () => cliente.connect(ALVO));
  await roteiro.avancar(esperar);
  await conexao;
  roteiro.anotar('cliente', { streamId: cliente.streamId, txid: cliente.txid, lastErrno: cliente.lastErrno, connectTimeMs: cliente.connectTimeMs, closed: cliente.closed, phase: cliente.phase, pendentes: cliente.pending.size });
  if (fechar) {
    cliente.close();
    await roteiro.avancar(300);
    roteiro.anotar('depois do close', { streamId: cliente.streamId, closed: cliente.closed });
  }
  return cliente;
}

async function esperarAoVivo(svc, roteiro) {
  for (let volta = 0; volta < 400 && !svc.output?.isActive; volta++) await voltas(1);
  roteiro.anotar('ao vivo', Boolean(svc.output?.isActive));
}

async function publicar(svc, roteiro, quantos, comSom = false) {
  for (let i = 0; i < quantos; i++) {
    svc.packet(quadro(i));
    if (comSom) svc.audioPacket(somDoQuadro(i));
    await roteiro.avancar(33);
  }
}

async function transmitir(modulo, roteiro, { cfg = {}, quadros = 4, comSom = false, avcc = true } = {}) {
  const svc = servico(modulo, roteiro);
  if (avcc) svc.setAvcC(AVCC);
  if (comSom) svc.setAsc(ASC);
  await chamar(roteiro, 'start', () => svc.start({ ...CONFIGURACAO, ...cfg }));
  await esperarAoVivo(svc, roteiro);
  roteiro.servidor.lento = Boolean(roteiro.cena.lentoAoVivo);
  await roteiro.avancar(50);
  await publicar(svc, roteiro, quadros, comSom);
  return svc;
}

async function parar(svc, roteiro) {
  const parada = chamar(roteiro, 'stop', () => svc.stop());
  await roteiro.avancar(400);
  await parada;
}

function cena(nome, montagem, passos) {
  return { nome, ...montagem, passos };
}

const CENAS = [
  cena('amf: escrita e leitura', {}, unidadesDoAmf),
  cena('alvo e corpos FLV', {}, unidadesDoAlvo),
  cena('textos de erro', {}, unidadesDoErro),
  cena('cliente: mensagens em pedaços e escrita', {}, mensagensDoCliente),
  cena('cliente: leitura dos pedaços e mensagens do servidor', {}, leituraDoCliente),
  cena('cliente: confirmação depois de 2,5 MB', {}, ackDoCliente),
  cena('cliente: handshake', {}, handshakeDoCliente),
  cena('cliente: conecta, publica e fecha', {}, (modulo, roteiro) => conectarCliente(modulo, roteiro)),
  cena('cliente: connect recusado pelo servidor',
    { respostas: { connect: txid => mensagemDoServidor({ corpo: comandoAmf(['_result', txid, null, { code: 'NetConnection.Connect.Rejected' }]) }) } },
    (modulo, roteiro) => conectarCliente(modulo, roteiro)),
  cena('cliente: connect com _error',
    { respostas: { connect: txid => mensagemDoServidor({ corpo: comandoAmf(['_error', txid, null, { code: 'NetConnection.Connect.Failed' }]) }) } },
    (modulo, roteiro) => conectarCliente(modulo, roteiro)),
  cena('cliente: connect sem objeto de código',
    { respostas: { connect: txid => mensagemDoServidor({ corpo: comandoAmf(['_result', txid]) }) } },
    (modulo, roteiro) => conectarCliente(modulo, roteiro)),
  cena('cliente: createStream sem id',
    { respostas: { createStream: txid => mensagemDoServidor({ corpo: comandoAmf(['_result', txid, null, 'x']) }) } },
    (modulo, roteiro) => conectarCliente(modulo, roteiro)),
  cena('cliente: handshake com versão errada', { handshake: 'versao' }, (modulo, roteiro) => conectarCliente(modulo, roteiro)),
  cena('cliente: servidor recusa a conexão', { conexoes: ['ECONNREFUSED'] }, (modulo, roteiro) => conectarCliente(modulo, roteiro)),
  cena('cliente: connect demora 30 s', { conexoes: ['pendurado'] }, (modulo, roteiro) => conectarCliente(modulo, roteiro, { esperar: 30000 })),
  cena('cliente: comando sem resposta em 10 s', { respostas: { connect: null } }, (modulo, roteiro) => conectarCliente(modulo, roteiro, { esperar: 10000 })),
  cena('cliente: queda fecha os pendentes', { respostas: { createStream: null } }, async (modulo, roteiro) => {
    const cliente = new modulo.RtmpClient(texto => roteiro.anotar('log', texto));
    cliente.onClose = () => roteiro.anotar('onClose');
    const conexao = chamar(roteiro, 'connect', () => cliente.connect(ALVO));
    await roteiro.avancar(10);
    roteiro.servidor.socket.emit('close');
    await conexao;
    await voltas();
    cliente._closed();
    roteiro.anotar('cliente', { closed: cliente.closed, pendentes: cliente.pending.size });
  }),
  cena('serviço: transmite vídeo e para', {}, async (modulo, roteiro) => {
    const svc = await transmitir(modulo, roteiro, { quadros: 3 });
    svc._stats();
    await roteiro.avancar(1000);
    await parar(svc, roteiro);
  }),
  cena('serviço: vídeo e áudio com AudioSpecificConfig', {}, async (modulo, roteiro) => {
    const svc = await transmitir(modulo, roteiro, { quadros: 3, comSom: true, cfg: { audio: 128 } });
    await parar(svc, roteiro);
  }),
  cena('serviço: áudio sem AudioSpecificConfig não sai', {}, async (modulo, roteiro) => {
    const svc = await transmitir(modulo, roteiro, { quadros: 2 });
    svc.audioPacket(somDoQuadro(5));
    await roteiro.avancar(40);
    await parar(svc, roteiro);
  }),
  cena('serviço: espera o quadro-chave e ignora o áudio antes dele', {}, async (modulo, roteiro) => {
    const svc = servico(modulo, roteiro);
    svc.setAvcC(AVCC);
    svc.setAsc(ASC);
    await chamar(roteiro, 'start', () => svc.start(CONFIGURACAO));
    await esperarAoVivo(svc, roteiro);
    svc.audioPacket(somDoQuadro(0));
    svc.packet(quadro(1, false));
    svc.packet(quadro(2, true));
    svc.packet(quadro(3, false));
    await roteiro.avancar(50);
    await parar(svc, roteiro);
  }),
  cena('serviço: fila cheia descarta quadros sem bitrate dinâmico', { lentoAoVivo: true }, async (modulo, roteiro) => {
    const svc = await transmitir(modulo, roteiro, { quadros: 0 });
    for (let i = 0; i < 40; i++) svc.packet(quadro(i, i % 10 === 0));
    roteiro.anotar('fila', svc.output.packets.length, svc.output.dropped, svc.output.minPriority, svc.output.congestion);
    svc._stats();
    roteiro.servidor.lento = false;
    roteiro.servidor.liberar();
    await parar(svc, roteiro);
  }),
  cena('serviço: bitrate dinâmico baixa e volta a subir', { lentoAoVivo: true }, async (modulo, roteiro) => {
    const svc = await transmitir(modulo, roteiro, { quadros: 0, cfg: { dyn: true, bitrate: 3000, audio: 64 } });
    const grande = i => ({ ...quadro(i, i % 30 === 0), data: new Uint8Array(4000) });
    for (let i = 0; i < 40; i++) {
      svc.packet(grande(i));
      await roteiro.avancar(40);
      roteiro.servidor.liberar();
      await roteiro.avancar(1);
    }
    roteiro.anotar('estimativa', svc.output.dbr.est, svc.output.dbr.cur);
    for (let i = 40; i < 52; i++) svc.packet(grande(i));
    roteiro.anotar('dbr na fila', { est: svc.output.dbr.est, cur: svc.output.dbr.cur, prev: svc.output.dbr.prev, fila: svc.output.packets.length, congestion: svc.output.congestion });
    roteiro.servidor.lento = false;
    roteiro.servidor.liberar();
    for (let i = 52; i < 90; i++) {
      svc.packet(quadro(i, i % 30 === 0));
      await roteiro.avancar(1500);
    }
    roteiro.anotar('dbr depois', { est: svc.output.dbr.est, cur: svc.output.dbr.cur, prev: svc.output.dbr.prev, inc: svc.output.dbr.inc });
    svc.output.dbr.cur = 1000;
    await parar(svc, roteiro);
  }),
  cena('serviço: bitrate dinâmico não descarta quadros', { lentoAoVivo: true }, async (modulo, roteiro) => {
    const svc = await transmitir(modulo, roteiro, { quadros: 0, cfg: { dyn: true } });
    for (let i = 0; i < 40; i++) svc.packet(quadro(i, i % 10 === 0));
    roteiro.anotar('fila', svc.output.packets.length, svc.output.dropped, svc.output.congestion);
    roteiro.servidor.lento = false;
    roteiro.servidor.liberar();
    await parar(svc, roteiro);
  }),
  cena('serviço: bitrate dinâmico volta ao anterior sem estimativa', {}, async (modulo, roteiro) => {
    const svc = await transmitir(modulo, roteiro, { quadros: 1, cfg: { dyn: true, bitrate: 1000 } });
    const saida = svc.output;
    roteiro.anotar('sem anterior', saida._dbrLowered());
    saida.dbr.prev = 800;
    roteiro.anotar('com anterior', saida._dbrLowered(), saida.dbr);
    saida.dbr.est = 450;
    saida.dbr.cur = 1000;
    roteiro.anotar('com estimativa', saida._dbrLowered(), saida.dbr);
    saida.dbr.est = 30;
    saida.dbr.cur = 1000;
    roteiro.anotar('estimativa mínima', saida._dbrLowered(), saida.dbr);
    saida.dbr.est = 450;
    saida.dbr.cur = 450;
    saida.dbr.prev = 450;
    roteiro.anotar('mesmo bitrate', saida._dbrLowered(), saida.dbr);
    await parar(svc, roteiro);
  }),
  cena('serviço: queda reconecta e desiste depois do limite', {}, async (modulo, roteiro) => {
    const svc = await transmitir(modulo, roteiro, { quadros: 2 });
    roteiro.servidor.socket.emit('close');
    await roteiro.avancar(10);
    await roteiro.avancar(2100);
    await esperarAoVivo(svc, roteiro);
    await publicar(svc, roteiro, 2);
    roteiro.servidor.conexoes = ['ECONNRESET'];
    roteiro.servidor.socket.emit('close');
    await roteiro.avancar(2100);
    await roteiro.avancar(2100);
    await roteiro.avancar(2100);
    roteiro.anotar('estado', { status: svc.status, error: svc.error, retries: svc.retries, output: svc.output === null });
  }),
  cena('serviço: servidor desligado esgota as tentativas', { conexoes: ['ECONNREFUSED'] }, async (modulo, roteiro) => {
    const svc = servico(modulo, roteiro);
    await chamar(roteiro, 'start', () => svc.start({ ...CONFIGURACAO, maxRetries: 1 }));
    await roteiro.avancar(10);
    await roteiro.avancar(2100);
    roteiro.anotar('estado', { status: svc.status, error: svc.error, retries: svc.retries });
  }),
  cena('serviço: parar durante a espera de reconexão', { conexoes: ['ECONNREFUSED'] }, async (modulo, roteiro) => {
    const svc = servico(modulo, roteiro);
    await chamar(roteiro, 'start', () => svc.start(CONFIGURACAO));
    await roteiro.avancar(10);
    await parar(svc, roteiro);
    await roteiro.avancar(2100);
  }),
  cena('serviço: endereço inválido e rtmps', {}, async (modulo, roteiro) => {
    for (const url of ['ftp://x', 'rtmps://x/y']) {
      const svc = servico(modulo, roteiro);
      await chamar(roteiro, 'start', () => svc.start({ ...CONFIGURACAO, url }));
      await roteiro.avancar(10);
    }
  }),
  cena('serviço: erro do encoder', {}, async (modulo, roteiro) => {
    const svc = await transmitir(modulo, roteiro, { quadros: 2 });
    svc.output.encodedPacket(null);
    await roteiro.avancar(400);
    roteiro.anotar('estado', { status: svc.status, error: svc.error });
  }),
  cena('serviço: sem avcC a transmissão cai', {}, async (modulo, roteiro) => {
    const svc = await transmitir(modulo, roteiro, { quadros: 1, avcc: false, cfg: { maxRetries: 0 } });
    await roteiro.avancar(400);
    roteiro.anotar('estado', { status: svc.status, error: svc.error });
  }),
  cena('serviço: erro de escrita cai com o errno', {}, async (modulo, roteiro) => {
    const svc = await transmitir(modulo, roteiro, { quadros: 1, cfg: { maxRetries: 0 } });
    roteiro.falhaDeEscrita = Object.assign(new Error('write EPIPE'), { code: 'ETIMEDOUT' });
    svc.packet(quadro(1));
    await roteiro.avancar(400);
    roteiro.anotar('estado', { status: svc.status, error: svc.error });
  }),
  cena('serviço: start repetido, stop parado e stop conectando', { conexoes: ['pendurado'] }, async (modulo, roteiro) => {
    const svc = servico(modulo, roteiro, { semLog: true });
    await chamar(roteiro, 'stop parado', () => svc.stop());
    await chamar(roteiro, 'start', () => svc.start(CONFIGURACAO));
    await chamar(roteiro, 'start de novo', () => svc.start(CONFIGURACAO));
    svc.packet(quadro(0));
    svc.audioPacket(somDoQuadro(0));
    const parada = chamar(roteiro, 'stop conectando', () => svc.stop());
    await roteiro.avancar(31000);
    await parada;
    roteiro.anotar('depois', { status: svc.status, output: svc.output === null });
  }),
  cena('serviço: pacotes sem saída e log de depuração', {}, async (modulo, roteiro) => {
    const svc = servico(modulo, roteiro);
    svc.packet(quadro(0));
    svc.audioPacket(somDoQuadro(0));
    svc._stats();
    const originais = { log: console.log, info: console.info };
    console.log = console.info = (...args) => roteiro.anotar('stdout', ...args);
    process.env.CAMLIVE_DEBUG = '1';
    try {
      svc.log('com depuração');
    } finally {
      delete process.env.CAMLIVE_DEBUG;
      Object.assign(console, originais);
    }
  }),
  cena('estúdio: carrega e grava', { estudio: '{"cenas":[1]}' }, (modulo, roteiro) => {
    const svc = servico(modulo, roteiro);
    roteiro.anotar('load', svc.loadStudio());
    roteiro.anotar('save', svc.saveStudio({ cenas: [2] }));
  }),
  cena('estúdio: sem arquivo e sem permissão', { falhaDoDisco: true }, (modulo, roteiro) => {
    const svc = servico(modulo, roteiro);
    roteiro.anotar('load', svc.loadStudio());
    roteiro.anotar('save', svc.saveStudio({ cenas: [2] }));
  }),
  cena('registro dos canais IPC', { conexoes: ['pendurado'] }, async (modulo, roteiro) => {
    const canais = new Map();
    const registrar = tipo => (canal, fn) => {
      roteiro.anotar(`ipcMain.${tipo}`, canal);
      canais.set(canal, fn);
    };
    const janela = { destruida: false };
    const getWindow = () => ({ isDestroyed: () => janela.destruida, webContents: { send: (canal, dados) => roteiro.anotar('janela.send', canal, dados) } });
    const celular = {};
    const svc = modulo.register({ ipcMain: { handle: registrar('handle'), on: registrar('on') }, getWindow, userDataDir: '/dados', getMobileService: () => celular });
    roteiro.anotar('celular recebeu o iphone', celular.camLiveIphone === svc.iphone);
    await chamar(roteiro, 'start iphone', () => canais.get('camlive:start')(null, { target: 'iphone' }));
    await chamar(roteiro, 'start rtmp', () => canais.get('camlive:start')(null, CONFIGURACAO));
    await chamar(roteiro, 'frame', () => canais.get('camlive:frame')(null, [1]));
    await chamar(roteiro, 'pcm', () => canais.get('camlive:pcm')(null, [2]));
    await chamar(roteiro, 'studio-load', () => canais.get('camlive:studio-load')());
    await chamar(roteiro, 'studio-save', () => canais.get('camlive:studio-save')(null, { a: 1 }));
    canais.get('camlive:avcc')(null, [1, 2]);
    canais.get('camlive:aasc')(null, [3]);
    canais.get('camlive:packet')(null, quadro(0));
    canais.get('camlive:apacket')(null, somDoQuadro(0));
    canais.get('camlive:log')(null, 12);
    svc.iphone.enviar('camlive:iphone', { ok: 1 });
    janela.destruida = true;
    svc.iphone.enviar('camlive:iphone', { ok: 2 });
    const parada = chamar(roteiro, 'stop', () => canais.get('camlive:stop')());
    await roteiro.avancar(31000);
    await parada;
  }),
  cena('registro sem janela e com celular quebrado', { falhaDoDisco: true }, (modulo, roteiro) => {
    const svc = modulo.register({ ipcMain: { handle: () => {}, on: () => {} }, getWindow: null, userDataDir: '/dados', getMobileService: () => { throw new Error('sem celular'); } });
    svc.sendToRenderer('camlive:status', {});
    svc.iphone.enviar('camlive:iphone', {});
    const semCelular = modulo.register({ ipcMain: { handle: () => {}, on: () => {} }, getWindow: () => null, userDataDir: '/dados' });
    semCelular.sendToRenderer('camlive:status', {});
    roteiro.anotar('registrou', Boolean(svc.iphone), Boolean(semCelular.iphone));
  }),
];

module.exports = { CENAS };
