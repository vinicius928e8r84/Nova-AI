'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');
const path = require('path');
const { EventEmitter } = require('events');

const SCRIPT = path.join(__dirname, '..', 'geo-proxy.cjs');
const MODULOS_DO_APP = '/Applications/Nova AI Mac.app/Contents/Resources/app/node_modules';
const MODULOS_DO_REPOSITORIO = path.resolve(__dirname, '../../../node_modules');
const carregadorOriginal = Module._load;

let cena;

class SocksProxyAgentFalso {
  constructor(url) { this.url = url; }
}

function getFalso(url, opcoes, aoResponder) {
  cena.pedidos.push({ url, opcoes: { ...opcoes, agent: opcoes.agent && opcoes.agent.url } });
  const req = new EventEmitter();
  req.destroy = (erro) => { cena.diario.push(`destroy: ${erro.message}`); req.emit('error', erro); };
  setImmediate(() => cena.resposta(req, aoResponder));
  return req;
}

function carregarAgente(pedido) {
  const pasta = path.dirname(pedido);
  cena.diario.push(`procura: ${pasta}`);
  if (cena.agenteEm !== pasta) throw new Error(`sem agente em ${pasta}`);
  return { SocksProxyAgent: SocksProxyAgentFalso };
}

const responder = (status, ...pedacos) => (req, aoResponder) => {
  const res = new EventEmitter();
  res.statusCode = status;
  res.setEncoding = (codificacao) => cena.diario.push(`codificação: ${codificacao}`);
  aoResponder(res);
  for (const pedaco of pedacos) res.emit('data', pedaco);
  res.emit('end');
};

const esgotar = (req) => req.emit('timeout');
const cair = (req) => req.emit('error', new Error('ECONNREFUSED'));

const COMPLETO = JSON.stringify({
  success: true, ip: '203.0.113.7', city: 'Lisboa', region: 'Lisboa', country: 'Portugal', country_code: 'PT',
  latitude: 38.7, longitude: -9.1, timezone: { id: 'Europe/Lisbon', utc: '+00:00' },
});

async function rodar({ argumento, ambiente, resposta = responder(200, COMPLETO), agenteEm = MODULOS_DO_APP }) {
  cena = { pedidos: [], diario: [], saida: [], erros: [], saiu: null, resposta, agenteEm };
  const anteriores = { argv: process.argv, proxy: process.env.NOVA_PROXY, log: console.log, error: console.error, exit: process.exit };
  process.argv = argumento === undefined ? ['node', SCRIPT] : ['node', SCRIPT, argumento];
  if (ambiente === undefined) delete process.env.NOVA_PROXY; else process.env.NOVA_PROXY = ambiente;
  console.log = (...partes) => cena.saida.push(partes.join(' '));
  console.error = (...partes) => cena.erros.push(partes.join(' '));
  process.exit = (codigo) => { cena.saiu = codigo; };
  Module._load = function (pedido, ...resto) {
    if (pedido === 'https') return { get: getFalso };
    if (path.basename(pedido) === 'socks-proxy-agent') return carregarAgente(pedido);
    return carregadorOriginal.call(this, pedido, ...resto);
  };
  try {
    delete require.cache[SCRIPT];
    require(SCRIPT);
    for (let volta = 0; volta < 5; volta++) await new Promise((pronto) => setImmediate(pronto));
  } finally {
    Module._load = carregadorOriginal;
    Object.assign(console, { log: anteriores.log, error: anteriores.error });
    process.exit = anteriores.exit;
    process.argv = anteriores.argv;
    if (anteriores.proxy === undefined) delete process.env.NOVA_PROXY; else process.env.NOVA_PROXY = anteriores.proxy;
  }
  const { pedidos, diario, saida, erros, saiu } = cena;
  return { pedidos, diario, saida, erros, saiu };
}

const PEDIDO_DIRETO = { url: 'https://ipwho.is/', opcoes: { agent: undefined, timeout: 15000, headers: { 'User-Agent': 'nova-geo/1.0' } } };
const pedidoVia = (agent) => ({ ...PEDIDO_DIRETO, opcoes: { ...PEDIDO_DIRETO.opcoes, agent } });

test('sem proxy: consulta direta e imprime a localização inteira', async () => {
  const r = await rodar({ resposta: responder(200, COMPLETO.slice(0, 20), COMPLETO.slice(20)) });
  assert.deepStrictEqual(r.pedidos, [PEDIDO_DIRETO]);
  assert.deepStrictEqual(r.diario, ['codificação: utf8']);
  assert.deepStrictEqual(r.saida, [JSON.stringify({
    via: 'direto', ip: '203.0.113.7', city: 'Lisboa', region: 'Lisboa', country: 'Portugal', country_code: 'PT',
    lat: 38.7, lon: -9.1, timezone: 'Europe/Lisbon', utc_offset: '+00:00',
  }, null, 2)]);
  assert.deepStrictEqual([r.erros, r.saiu], [[], null]);
});

test('formatos de proxy: do Nova, URL com usuário, só host e porta, e pelo NOVA_PROXY', async () => {
  const casos = [
    [{ argumento: '  socks5://h.exemplo.com:1080:usu%rio:se/nha  ' }, 'socks5://usu%25rio:se%2Fnha@h.exemplo.com:1080'],
    [{ argumento: 'SOCKS5H://eu:senha@h.exemplo.com:1' }, 'socks5://eu:senha@h.exemplo.com:1'],
    [{ argumento: 'h:2', ambiente: 'ignorado:9' }, 'socks5://h:2'],
    [{ ambiente: 'socks5h://10.0.0.1:3' }, 'socks5://10.0.0.1:3'],
  ];
  for (const [entrada, agente] of casos) {
    const r = await rodar(entrada);
    assert.deepStrictEqual(r.pedidos, [pedidoVia(agente)], JSON.stringify(entrada));
    assert.strictEqual(JSON.parse(r.saida[0]).via, 'proxy');
    assert.deepStrictEqual(r.diario, [`procura: ${MODULOS_DO_APP}`, 'codificação: utf8']);
  }
});

test('agente: cai para o node_modules do repositório e falha sem nenhum', async () => {
  const doRepositorio = await rodar({ argumento: 'h:1', agenteEm: MODULOS_DO_REPOSITORIO });
  assert.deepStrictEqual(doRepositorio.diario.slice(0, 2), [`procura: ${MODULOS_DO_APP}`, `procura: ${MODULOS_DO_REPOSITORIO}`]);
  assert.deepStrictEqual(doRepositorio.pedidos, [pedidoVia('socks5://h:1')]);
  const semAgente = await rodar({ argumento: 'h:1', agenteEm: null });
  assert.deepStrictEqual(semAgente.pedidos, []);
  assert.deepStrictEqual([semAgente.erros, semAgente.saiu], [['ERRO: socks-proxy-agent não encontrado (instale com npm i socks-proxy-agent).'], 1]);
});

test('erros: formato, resposta não-JSON, falha do ipwho.is, timeout e conexão', async () => {
  const casos = [
    [{ argumento: 'lixo' }, 'ERRO: Formato de proxy não reconhecido: use socks5://host:porta:usuario:senha'],
    [{ resposta: responder(502, '<html>'.repeat(30)) }, `ERRO: resposta não-JSON (HTTP 502): ${'<html>'.repeat(30).slice(0, 120)}`],
    [{ resposta: responder(200, '{"success":false,"message":"limite"}') }, 'ERRO: ipwho.is falhou: limite'],
    [{ resposta: responder(200, '{"success":false,"message":""}') }, 'ERRO: ipwho.is falhou: sem detalhes'],
    [{ resposta: responder(200, 'null') }, 'ERRO: ipwho.is falhou: sem detalhes'],
    [{ resposta: responder(200, '0') }, 'ERRO: ipwho.is falhou: sem detalhes'],
    [{ resposta: esgotar }, 'ERRO: timeout ao consultar o ipwho.is'],
    [{ resposta: cair }, 'ERRO: ECONNREFUSED'],
  ];
  for (const [entrada, erro] of casos) {
    const r = await rodar(entrada);
    assert.deepStrictEqual([r.saida, r.erros, r.saiu], [[], [erro], 1], JSON.stringify(entrada));
  }
  const esgotado = await rodar({ resposta: esgotar });
  assert.deepStrictEqual(esgotado.diario, ['destroy: timeout ao consultar o ipwho.is']);
});

test('fuso ausente ou incompleto vira null, e campos faltando somem do JSON', async () => {
  const respostas = [
    [{ success: true }, { via: 'direto', timezone: null, utc_offset: null }],
    [{ ip: '1.2.3.4', timezone: 'texto' }, { via: 'direto', ip: '1.2.3.4', timezone: null, utc_offset: null }],
    [{ timezone: { id: '', utc: '-03:00' } }, { via: 'direto', timezone: null, utc_offset: '-03:00' }],
    [{ success: 0, timezone: 0 }, { via: 'direto', timezone: null, utc_offset: null }],
  ];
  for (const [dados, esperado] of respostas) {
    const r = await rodar({ resposta: responder(200, JSON.stringify(dados)) });
    assert.deepStrictEqual(JSON.parse(r.saida[0]), esperado);
  }
});
