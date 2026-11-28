'use strict';
const test = require('node:test');
const assert = require('node:assert');
const https = require('https');
const { EventEmitter } = require('events');
const { byIp, throughProxy, normalize } = require('../electron/services/geo-proxy');

const USUARIO = 'usuario-falso';
const SENHA = 'senha-falsa';
const HOST = 'proxy.teste.local';
const getOriginal = https.get;
test.after(() => { https.get = getOriginal; });

const RESPOSTA_COMPLETA = {
  ip: '203.0.113.7',
  city: 'Recife',
  region: 'Pernambuco',
  country: 'Brazil',
  country_code: 'BR',
  latitude: -8.05,
  longitude: -34.9,
  timezone: { id: 'America/Recife', utc: '-03:00' },
  connection: { isp: 'Provedor Teste', asn: 1 },
};

const NORMALIZADA_COMPLETA = {
  ip: '203.0.113.7',
  city: 'Recife',
  region: 'Pernambuco',
  country: 'Brazil',
  countryCode: 'BR',
  lat: -8.05,
  lon: -34.9,
  timezone: 'America/Recife',
  isp: 'Provedor Teste',
};

const TUDO_NULO = { ip: null, city: null, region: null, country: null, countryCode: null, lat: undefined, lon: undefined, timezone: null, isp: null };

function consultaFalsa(comportamento) {
  const pedidos = [];
  https.get = (url, opcoes, aoResponder) => {
    const pedido = new EventEmitter();
    pedido.destroy = (erro) => pedido.emit('error', erro);
    pedidos.push({ url, opcoes });
    setImmediate(() => comportamento(pedido, aoResponder));
    return pedido;
  };
  return pedidos;
}

function responderCom(corpo, statusCode = 200) {
  return (pedido, aoResponder) => {
    const resposta = new EventEmitter();
    resposta.statusCode = statusCode;
    resposta.setEncoding = () => {};
    aoResponder(resposta);
    const pedacos = typeof corpo === 'string' ? [corpo] : [JSON.stringify(corpo).slice(0, 10), JSON.stringify(corpo).slice(10)];
    for (const pedaco of pedacos) resposta.emit('data', pedaco);
    resposta.emit('end');
  };
}

test('normalize: a resposta completa vira os campos do Nova, com o fuso e o provedor dentro dos objetos', () => {
  assert.deepStrictEqual(normalize(RESPOSTA_COMPLETA), NORMALIZADA_COMPLETA);
});

test('normalize: campo ausente ou vazio vira null, e latitude e longitude ficam como vieram', () => {
  assert.deepStrictEqual(normalize({}), TUDO_NULO);
  assert.deepStrictEqual(normalize({ ip: '', city: '', region: '', country: '', country_code: '' }), TUDO_NULO);
  assert.deepStrictEqual(normalize({ latitude: 0, longitude: 0 }), { ...TUDO_NULO, lat: 0, lon: 0 });
  assert.deepStrictEqual(normalize({ latitude: null, longitude: '' }), { ...TUDO_NULO, lat: null, lon: '' });
});

test('normalize: o fuso e o provedor so valem quando vem o objeto com o campo', () => {
  const casos = [
    [{ timezone: null }, null],
    [{ timezone: {} }, null],
    [{ timezone: { id: '' } }, null],
    [{ timezone: 'America/Recife' }, null],
    [{ timezone: { id: 'Asia/Tokyo' } }, 'Asia/Tokyo'],
  ];
  for (const [entrada, fuso] of casos) assert.strictEqual(normalize(entrada).timezone, fuso, JSON.stringify(entrada));
  const provedores = [
    [{ connection: null }, null],
    [{ connection: {} }, null],
    [{ connection: { isp: '' } }, null],
    [{ connection: { isp: 'Outro Provedor' } }, 'Outro Provedor'],
  ];
  for (const [entrada, provedor] of provedores) assert.strictEqual(normalize(entrada).isp, provedor, JSON.stringify(entrada));
});

test('normalize: resposta sem corpo, ou com success false, lanca a mensagem do servico ou a padrao', () => {
  const padrao = /^Error: geolocalização falhou$/;
  for (const vazio of [null, undefined, 0, '']) assert.throws(() => normalize(vazio), padrao);
  assert.throws(() => normalize({ success: false }), padrao);
  assert.throws(() => normalize({ success: false, message: '' }), padrao);
  assert.throws(() => normalize({ success: false, message: 'Invalid IP address' }), /^Error: Invalid IP address$/);
  assert.deepStrictEqual(normalize({ success: true, message: 'ignorada', ip: '1.2.3.4' }), { ...TUDO_NULO, ip: '1.2.3.4' });
  assert.deepStrictEqual(normalize({ success: undefined, ip: '1.2.3.4' }), { ...TUDO_NULO, ip: '1.2.3.4' });
});

test('byIp: consulta o ipwho.is com o IP limpo, o agente ausente, 15 s de limite e o User-Agent do Nova', async () => {
  const pedidos = consultaFalsa(responderCom(RESPOSTA_COMPLETA));
  assert.deepStrictEqual(await byIp('  203.0.113.7  '), NORMALIZADA_COMPLETA);
  assert.strictEqual(pedidos.length, 1);
  assert.strictEqual(pedidos[0].url, 'https://ipwho.is/203.0.113.7');
  assert.deepStrictEqual(pedidos[0].opcoes, { agent: undefined, timeout: 15000, headers: { 'User-Agent': 'nova-geo/1.0' } });
});

test('byIp: o IPv6 vai codificado na URL', async () => {
  const pedidos = consultaFalsa(responderCom(RESPOSTA_COMPLETA));
  await byIp('2001:DB8::1');
  assert.strictEqual(pedidos[0].url, 'https://ipwho.is/2001%3ADB8%3A%3A1');
});

test('byIp: recusa o que nao parece IP sem consultar nada, e aceita o que so tem hexadecimal e dois-pontos', async () => {
  const pedidos = consultaFalsa(responderCom(RESPOSTA_COMPLETA));
  const recusados = [['', '(vazio)'], [null, '(vazio)'], [undefined, '(vazio)'], ['1.2.3', '1.2.3'], ['xyz', 'xyz'], ['1.2.3.4/24', '1.2.3.4/24'], ['a b', 'a b']];
  for (const [entrada, mostrado] of recusados) {
    await assert.rejects(byIp(entrada), (erro) => erro.message === `IP inválido: ${mostrado}`, String(entrada));
  }
  assert.strictEqual(pedidos.length, 0);
  await byIp('dead');
  assert.strictEqual(pedidos[0].url, 'https://ipwho.is/dead');
});

test('byIp: a resposta com success false rejeita com a mensagem do servico', async () => {
  consultaFalsa(responderCom({ success: false, message: 'Reserved range' }));
  await assert.rejects(byIp('127.0.0.1'), /^Error: Reserved range$/);
});

test('byIp: o corpo que nao e JSON rejeita dizendo o status HTTP', async () => {
  consultaFalsa(responderCom('<html>', 502));
  await assert.rejects(byIp('1.2.3.4'), /^Error: resposta não-JSON \(HTTP 502\)$/);
});

test('byIp: o limite de tempo destroi a consulta e rejeita com a mensagem de timeout', async () => {
  consultaFalsa((pedido) => pedido.emit('timeout'));
  await assert.rejects(byIp('1.2.3.4'), /^Error: timeout na consulta de geolocalização$/);
});

test('byIp: o erro de rede da consulta chega como veio', async () => {
  consultaFalsa((pedido) => pedido.emit('error', new Error('ECONNRESET')));
  await assert.rejects(byIp('1.2.3.4'), /^Error: ECONNRESET$/);
});

test('throughProxy: consulta a raiz do ipwho.is com o agente do proxy e devolve o resultado normalizado', async () => {
  const pedidos = consultaFalsa(responderCom(RESPOSTA_COMPLETA));
  assert.deepStrictEqual(await throughProxy(`socks5://${USUARIO}:${SENHA}@${HOST}:1002`), NORMALIZADA_COMPLETA);
  assert.strictEqual(pedidos[0].url, 'https://ipwho.is/');
  assert.strictEqual(pedidos[0].opcoes.agent.constructor.name, 'SocksProxyAgent');
  assert.strictEqual(pedidos[0].opcoes.timeout, 15000);
});
