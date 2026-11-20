'use strict';
const test = require('node:test');
const assert = require('node:assert');
const net = require('net');
const { parseProxy, agentFor, throughProxy } = require('../electron/services/geo-proxy');

const USUARIO = 'usuario-falso';
const SENHA = 'senha-falsa';
const HOST = 'proxy.teste.local';
const comEsquema = (esquema, resto) => `${esquema}://${resto}`;
const USUARIO_CODIFICADO = 'us%40er';
const SENHA_CODIFICADA = 'pa%3Ass%25';
const SENHA_CODIFICADA_CURTA = 'pa%3Ass';
const SENHA_COM_PORCENTO_SOLTO = '100%zz';

test('parseProxy: socks5 com usuario:senha@host:porta', () => {
  assert.deepStrictEqual(parseProxy(`socks5://${USUARIO}:${SENHA}@${HOST}:1002`), {
    scheme: 'socks5', host: HOST, port: 1002, user: USUARIO, pass: SENHA, schemeGuessed: false
  });
});

test('parseProxy: socks5 no formato host:porta:usuario:senha', () => {
  assert.deepStrictEqual(parseProxy(`socks5://${HOST}:1002:${USUARIO}:${SENHA}`), {
    scheme: 'socks5', host: HOST, port: 1002, user: USUARIO, pass: SENHA, schemeGuessed: false
  });
});

test('parseProxy: senha do formato host:porta:usuario:senha pode ter dois-pontos', () => {
  assert.strictEqual(parseProxy(`socks5://${HOST}:1002:${USUARIO}:a:b`).pass, 'a:b');
});

test('parseProxy: decodifica %XX de usuario e senha no formato URL', () => {
  const p = parseProxy(`socks5://${USUARIO_CODIFICADO}:${SENHA_CODIFICADA}@${HOST}:1002`);
  assert.strictEqual(p.user, 'us@er');
  assert.strictEqual(p.pass, 'pa:ss%');
});

test('parseProxy: socks5h e socks4 mantem o esquema em minusculas', () => {
  assert.strictEqual(parseProxy(`SOCKS5H://${HOST}:1080`).scheme, 'socks5h');
  assert.strictEqual(parseProxy(`socks4://${HOST}:1080`).scheme, 'socks4');
});

test('parseProxy: host:porta sem esquema vira socks5 sem credencial', () => {
  assert.deepStrictEqual(parseProxy(`${HOST}:1080`), {
    scheme: 'socks5', host: HOST, port: 1080, user: null, pass: null, schemeGuessed: true
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

test('parseProxy: http e https com usuario:senha@host:porta', () => {
  assert.deepStrictEqual(parseProxy(`http://${USUARIO}:${SENHA}@${HOST}:1000`), {
    scheme: 'http', host: HOST, port: 1000, user: USUARIO, pass: SENHA, schemeGuessed: false
  });
  assert.strictEqual(parseProxy(`https://${USUARIO}:${SENHA}@${HOST}:1001`).scheme, 'https');
});

test('parseProxy: formato do painel da Evomi host:porta:usuario:senha com e sem esquema', () => {
  const esperado = { scheme: 'http', host: HOST, port: 1000, user: USUARIO, pass: SENHA };
  assert.deepStrictEqual(parseProxy(`http://${HOST}:1000:${USUARIO}:${SENHA}`), { ...esperado, schemeGuessed: false });
  assert.deepStrictEqual(parseProxy(`${HOST}:1000:${USUARIO}:${SENHA}`), { ...esperado, schemeGuessed: true });
});

test('parseProxy: ordem invertida host:porta@usuario:senha', () => {
  const esperado = { scheme: 'https', host: HOST, port: 1001, user: USUARIO, pass: SENHA };
  assert.deepStrictEqual(parseProxy(comEsquema('https', `${HOST}:1001@${USUARIO}:${SENHA}`)), { ...esperado, schemeGuessed: false });
  assert.deepStrictEqual(parseProxy(`${HOST}:1001@${USUARIO}:${SENHA}`), { ...esperado, schemeGuessed: true });
});

test('parseProxy: usuario:senha@host:porta sem esquema decodifica %XX', () => {
  const p = parseProxy(`${USUARIO_CODIFICADO}:${SENHA_CODIFICADA_CURTA}@${HOST}:1002`);
  assert.strictEqual(p.user, 'us@er');
  assert.strictEqual(p.pass, 'pa:ss');
});

test('parseProxy: %XX invalido na senha nao derruba, fica como veio', () => {
  assert.strictEqual(parseProxy(`socks5://${USUARIO}:${SENHA_COM_PORCENTO_SOLTO}@${HOST}:1002`).pass, SENHA_COM_PORCENTO_SOLTO);
});

test('parseProxy: sem esquema a porta indica o tipo', () => {
  for (const porta of [1000, 3128, 8000, 8080, 8888]) assert.strictEqual(parseProxy(`${HOST}:${porta}`).scheme, 'http');
  assert.strictEqual(parseProxy(`${HOST}:1001`).scheme, 'https');
  assert.strictEqual(parseProxy(`${HOST}:1002`).scheme, 'socks5');
});

test('parseProxy: aspas e barra final da colagem sao removidas', () => {
  assert.strictEqual(parseProxy(`"http://${HOST}:8080/"`).host, HOST);
  assert.strictEqual(parseProxy(`'${HOST}:8080'`).port, 8080);
});

test('parseProxy: porta fora de 1-65535 e esquema desconhecido devolvem null', () => {
  assert.strictEqual(parseProxy(`${HOST}:0`), null);
  assert.strictEqual(parseProxy(`${HOST}:65536`), null);
  assert.strictEqual(parseProxy(`ftp://${HOST}:21`), null);
});

test('agentFor: socks vira SocksProxyAgent com as credenciais', () => {
  const agente = agentFor(parseProxy(`socks5://${USUARIO_CODIFICADO}:${SENHA_CODIFICADA_CURTA}@${HOST}:1002`));
  assert.strictEqual(agente.constructor.name, 'SocksProxyAgent');
  assert.strictEqual(agente.proxy.host, HOST);
  assert.strictEqual(agente.proxy.port, 1002);
  assert.strictEqual(agente.proxy.userId, 'us@er');
  assert.strictEqual(agente.proxy.password, 'pa:ss');
});

test('agentFor: http e https usam o agente de tunel CONNECT com o esquema do proxy', () => {
  const http = agentFor(parseProxy(`http://${USUARIO}:${SENHA}@${HOST}:1000`));
  const https = agentFor(parseProxy(`https://${USUARIO}:${SENHA}@${HOST}:1001`));
  assert.strictEqual(http.constructor.name, 'HttpsProxyAgent');
  assert.strictEqual(http.proxy.protocol, 'http:');
  assert.strictEqual(https.proxy.protocol, 'https:');
  assert.strictEqual(http.proxy.hostname, HOST);
  assert.strictEqual(http.proxy.port, '1000');
});

function proxyHttpFalso() {
  const recebidos = [];
  const servidor = net.createServer((socket) => {
    socket.once('data', (pedaco) => {
      const texto = pedaco.toString('latin1');
      if (texto.includes('\r\n\r\n')) recebidos.push(texto.split('\r\n'));
      socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    });
    socket.on('error', () => {});
  });
  return new Promise((ok) => servidor.listen(0, '127.0.0.1', () => ok({ servidor, recebidos, porta: servidor.address().port })));
}

test('throughProxy: proxy http abre tunel CONNECT para a consulta https com Basic auth', async () => {
  const { servidor, recebidos, porta } = await proxyHttpFalso();
  try {
    await assert.rejects(throughProxy(`http://127.0.0.1:${porta}:${USUARIO}:${SENHA}`));
  } finally {
    servidor.close();
  }
  assert.strictEqual(recebidos.length, 1);
  assert.strictEqual(recebidos[0][0], 'CONNECT ipwho.is:443 HTTP/1.1');
  const basic = Buffer.from(`${USUARIO}:${SENHA}`).toString('base64');
  assert.ok(recebidos[0].includes(`Proxy-Authorization: Basic ${basic}`));
});

test('throughProxy: ordem invertida com esquema https fala TLS com o proxy, nao CONNECT em texto puro', async () => {
  const { servidor, recebidos, porta } = await proxyHttpFalso();
  try {
    await assert.rejects(throughProxy(`https://127.0.0.1:${porta}@${USUARIO}:${SENHA}`));
  } finally {
    servidor.close();
  }
  assert.strictEqual(recebidos.length, 0);
});

test('throughProxy: proxy ilegivel rejeita com a mensagem de formato', async () => {
  await assert.rejects(
    throughProxy('isso nao e proxy'),
    { message: 'Proxy inválido: não achei host e porta na string' }
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
