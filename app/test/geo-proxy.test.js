'use strict';
const test = require('node:test');
const assert = require('node:assert');
const net = require('net');
const { parseProxy, throughProxy } = require('../electron/services/geo-proxy');

const USUARIO = 'usuario-falso';
const SENHA = 'senha-falsa';
const HOST = 'proxy.teste.local';

test('parseProxy: socks5 com usuario:senha@host:porta', () => {
  assert.deepStrictEqual(parseProxy(`socks5://${USUARIO}:${SENHA}@${HOST}:1002`), {
    scheme: 'socks5', host: HOST, port: 1002, user: USUARIO, pass: SENHA
  });
});

test('parseProxy: socks5 no formato host:porta:usuario:senha', () => {
  assert.deepStrictEqual(parseProxy(`socks5://${HOST}:1002:${USUARIO}:${SENHA}`), {
    scheme: 'socks5', host: HOST, port: 1002, user: USUARIO, pass: SENHA
  });
});

test('parseProxy: senha do formato host:porta:usuario:senha pode ter dois-pontos', () => {
  assert.strictEqual(parseProxy(`socks5://${HOST}:1002:${USUARIO}:a:b`).pass, 'a:b');
});

test('parseProxy: decodifica %XX de usuario e senha no formato URL', () => {
  const p = parseProxy(`socks5://us%40er:pa%3Ass%25@${HOST}:1002`);
  assert.strictEqual(p.user, 'us@er');
  assert.strictEqual(p.pass, 'pa:ss%');
});

test('parseProxy: socks5h e socks4 mantem o esquema em minusculas', () => {
  assert.strictEqual(parseProxy(`SOCKS5H://${HOST}:1080`).scheme, 'socks5h');
  assert.strictEqual(parseProxy(`socks4://${HOST}:1080`).scheme, 'socks4');
});

test('parseProxy: host:porta sem esquema vira socks5 sem credencial', () => {
  assert.deepStrictEqual(parseProxy(`${HOST}:1080`), {
    scheme: 'socks5', host: HOST, port: 1080, user: null, pass: null
  });
});

test('parseProxy: host curto (menos de 3 letras) continua valido', () => {
  assert.strictEqual(parseProxy('px:1080').host, 'px');
  assert.strictEqual(parseProxy(`socks5://${USUARIO}:${SENHA}@a:1080`).host, 'a');
});

test('parseProxy: espacos nas pontas sao ignorados', () => {
  assert.strictEqual(parseProxy(`  ${HOST}:1080  `).host, HOST);
});

test('parseProxy: vazio e nulo devolvem null', () => {
  assert.strictEqual(parseProxy(''), null);
  assert.strictEqual(parseProxy(null), null);
  assert.strictEqual(parseProxy(undefined), null);
});

test('parseProxy: lixo sem porta devolve null', () => {
  assert.strictEqual(parseProxy(HOST), null);
  assert.strictEqual(parseProxy(`socks5://${HOST}`), null);
});

test('parseProxy: esquema http e https ainda nao e reconhecido', () => {
  assert.strictEqual(parseProxy(`http://${HOST}:8080`), null);
  assert.strictEqual(parseProxy(`https://${HOST}:8080`), null);
});

test('parseProxy: ordem invertida host:porta@usuario:senha ainda nao e reconhecida', () => {
  assert.strictEqual(parseProxy(`socks5://${HOST}:1002@${USUARIO}:${SENHA}`), null);
});

test('throughProxy: proxy ilegivel rejeita com a mensagem de formato', async () => {
  await assert.rejects(
    throughProxy('isso nao e proxy'),
    { message: 'Proxy inválido: use socks5://host:porta:usuario:senha' }
  );
});

test('throughProxy: proxy socks5 inalcancavel rejeita', async () => {
  const livre = await new Promise((ok) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const porta = s.address().port;
      s.close(() => ok(porta));
    });
  });
  await assert.rejects(throughProxy(`socks5://${USUARIO}:${SENHA}@127.0.0.1:${livre}`));
});
