'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');

const carregadorOriginal = Module._load;
const AGORA = Date.UTC(2026, 10, 20, 12, 0, 0);
const HORA = 60 * 60 * 1000;
const GB = 1024 * 1024 * 1024;

let cena;
const anota = (...entrada) => cena.diario.push(entrada);
const normalizar = (valor) => (valor instanceof Error ? `${valor.name}: ${valor.message}` : valor);

class PeerUser { constructor(id) { this.id = id; } }
class PeerChat { constructor(id) { this.id = id; } }
class SignIn { constructor(dados) { Object.assign(this, dados); } }
class AuthorizationSignUpRequired {}
class StringSession { constructor(valor) { this.valor = valor; } }
class NewMessage { constructor(opcoes) { this.opcoes = opcoes; } }

class ClienteFalso {
  constructor(sessao, apiId, apiHash, opcoes) {
    this.session = { save: () => 'sessao-gravada' };
    anota('cliente:novo', { sessao: sessao.valor, apiId, apiHash, opcoes });
  }
  async connect() { anota('cliente:connect'); await cena.conexao; if (cena.falhaConnect) throw new Error(cena.falhaConnect); }
  async isUserAuthorized() { return cena.autorizado; }
  async getMe() { anota('cliente:getMe'); if (cena.falhaGetMe) throw new Error(cena.falhaGetMe); return cena.eu; }
  async sendCode(credenciais, telefone) { anota('cliente:sendCode', credenciais, telefone); if (cena.falhaSendCode) throw new Error(cena.falhaSendCode); return { phoneCodeHash: 'hash-1' }; }
  async invoke(pedido) { anota('cliente:invoke', pedido.constructor.name, { ...pedido }); return cena.respostaDoSignIn(); }
  async signInWithPassword(credenciais, retornos) {
    anota('cliente:signInWithPassword', credenciais, retornos.password());
    if (cena.falhaSenha) {
      anota('onError', retornos.onError(new Error(cena.falhaSenha)));
      throw new Error(cena.falhaSenha);
    }
  }
  signInUserWithQrCode(credenciais, retornos) {
    anota('cliente:qr', credenciais);
    cena.retornosQr = retornos;
    return new Promise((resolve, reject) => { cena.concluirQr = resolve; cena.abortarQr = reject; });
  }
  addEventHandler(tratador, filtro) { anota('cliente:addEventHandler', filtro.constructor.name, filtro.opcoes); cena.tratador = tratador; }
  async getEntity(peer) {
    anota('cliente:getEntity', peer.id);
    if (!(peer.id in cena.entidades)) throw new Error('entidade desconhecida');
    return cena.entidades[peer.id];
  }
  async sendMessage(alvo, conteudo) { anota('cliente:sendMessage', alvo, conteudo); if (cena.falhaEnvio) throw new Error(cena.falhaEnvio); }
  async disconnect() { anota('cliente:disconnect'); if (cena.falhaDisconnect) throw new Error(cena.falhaDisconnect); }
  async logOut() { anota('cliente:logOut'); }
}

const falsos = {
  telegram: { TelegramClient: ClienteFalso, Api: { PeerUser, auth: { SignIn, AuthorizationSignUpRequired } } },
  'telegram/sessions': { StringSession },
  'telegram/events': { NewMessage },
  qrcode: { toDataURL: async (link) => { if (cena.falhaQrcode) throw new Error('qr quebrado'); return `data:${link}`; } },
  ws: class WebSocketFalso {},
  electron: { shell: { openExternal: (url) => anota('shell:openExternal', url) } },
  './mac-native': { run: (comando, args) => { anota('mac-native:run', comando, args); return Promise.resolve(); } },
  child_process: { exec: (comando) => anota('child_process:exec', comando) },
  os: {
    totalmem: () => 16 * GB, freemem: () => 4.5 * GB, loadavg: () => [1.234, 0, 0],
    cpus: () => [{ model: 'CPU Falsa' }], platform: () => 'plataforma', release: () => '9.9',
  },
};

let TelegramManager;
const consoleOriginal = { log: console.log, info: console.info, warn: console.warn, error: console.error };
const plataformaOriginal = Object.getOwnPropertyDescriptor(process, 'platform');

test.before(() => {
  Module._load = function (pedido, ...resto) {
    return Object.hasOwn(falsos, pedido) ? falsos[pedido] : carregadorOriginal.call(this, pedido, ...resto);
  };
  const caminho = path.resolve(__dirname, '../telegram-manager.js');
  delete require.cache[caminho];
  TelegramManager = require(caminho);
});

test.after(() => { Module._load = carregadorOriginal; });

test.beforeEach((t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: AGORA });
  cena = {
    diario: [], autorizado: true, eu: { id: 42n, firstName: 'Ana', username: 'ana_tg' }, entidades: {},
    respostaDoSignIn: async () => ({ user: { id: 42n } }),
  };
  for (const [nivel, saida] of [['log', 'stdout'], ['info', 'stdout'], ['warn', 'console.warn'], ['error', 'console.error']]) {
    console[nivel] = (...args) => anota(saida, ...args.map(normalizar));
  }
});

test.afterEach(() => {
  Object.assign(console, consoleOriginal);
  Object.defineProperty(process, 'platform', plataformaOriginal);
});

function montar(ajustes) {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-carac-'));
  const arquivoDeAjustes = path.join(pasta, 'telegram_settings.json');
  if (ajustes !== undefined) fs.writeFileSync(arquivoDeAjustes, typeof ajustes === 'string' ? ajustes : JSON.stringify(ajustes));
  const janela = { isDestroyed: () => false, webContents: { send: (canal, carga) => anota('janela', canal, carga) } };
  const gerente = new TelegramManager(janela, { getPath: (nome) => { anota('app:getPath', nome); return pasta; } });
  const sessao = path.join(pasta, '.telegram_auth', 'session.json');
  const lerJson = (arquivo) => JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  return { gerente, pasta, sessao, arquivoDeAjustes, lerAjustes: () => lerJson(arquivoDeAjustes), lerSessao: () => lerJson(sessao) };
}

const semGetPath = () => cena.diario.filter(([tipo]) => tipo !== 'app:getPath');
const status = () => cena.diario.filter(([tipo]) => tipo === 'janela').map(([, , carga]) => carga.data);
const limparDiario = () => { cena.diario.length = 0; };

async function conectado(ajustes) {
  const montado = montar(ajustes);
  await montado.gerente.initialize({ apiId: 6, apiHash: 'h' });
  limparDiario();
  return montado;
}

function mensagem({ texto, de = 7n, peer = new PeerUser(7n), out = false, data = 1700000000, id = 99 }) {
  return { message: { message: texto, peerId: peer, senderId: de, out, date: data, id } };
}

const BASE = { connectionRetries: 5, useWSS: true };

test('getClientOptions escolhe o perfil do aparelho pelo apiId', () => {
  const { gerente } = montar();
  assert.deepStrictEqual(gerente.getClientOptions(6), { connectionRetries: 5, deviceModel: 'Samsung SM-S908B', systemVersion: 'Android 13', appVersion: '10.14.0', useWSS: true });
  assert.deepStrictEqual(gerente.getClientOptions('2040'), { connectionRetries: 5, deviceModel: 'Desktop', systemVersion: 'Windows 11', appVersion: '4.16.2', useWSS: true });
  assert.deepStrictEqual(gerente.getClientOptions('2496abc'), { connectionRetries: 5, deviceModel: 'WebK', systemVersion: 'Chrome/120.0.0.0', appVersion: '2.0.0', useWSS: true });
  const padrao = { connectionRetries: 5, deviceModel: 'Nova Desktop Assistant', systemVersion: 'Windows 11', appVersion: '1.0.11', useWSS: true };
  for (const apiId of ['999', undefined, 'abc', 'constructor']) assert.deepStrictEqual(gerente.getClientOptions(apiId), padrao);
  assert.deepStrictEqual(Object.keys(gerente.getClientOptions(6)), ['connectionRetries', 'deviceModel', 'systemVersion', 'appVersion', 'useWSS']);
});

test('getClientOptions monta o proxy MTProto so com ip, porta e segredo', () => {
  const completo = { useProxy: true, proxyType: 'mtproto', proxyIp: '1.2.3.4', proxyPort: '443x', proxySecret: 'seg' };
  const { gerente } = montar(completo);
  limparDiario();
  assert.deepStrictEqual(gerente.getClientOptions(999).proxy, { ip: '1.2.3.4', port: 443, MTProxy: true, secret: 'seg' });
  assert.deepStrictEqual(semGetPath(), [['stdout', '[Telegram] Connecting via MTProto proxy: 1.2.3.4:443x']]);
  for (const falta of ['proxyIp', 'proxyPort', 'proxySecret']) {
    const { gerente: g } = montar({ ...completo, [falta]: '' });
    limparDiario();
    assert.strictEqual('proxy' in g.getClientOptions(6), false);
    assert.deepStrictEqual(semGetPath(), []);
  }
});

test('getClientOptions monta o proxy SOCKS 4 ou 5 com credencial opcional', () => {
  const casos = [
    [{ proxyType: 'socks5', proxyUsername: 'u', proxyPassword: 'p' }, { ip: '5.6.7.8', port: 1080, socksType: 5, username: 'u', password: 'p' }, 'SOCKS5'],
    [{ proxyType: 'socks4' }, { ip: '5.6.7.8', port: 1080, socksType: 4 }, 'SOCKS4'],
    [{ proxyPassword: 'p' }, { ip: '5.6.7.8', port: 1080, socksType: 5, password: 'p' }, 'SOCKS5'],
    [{ proxyType: 'http', proxyUsername: 'u' }, { ip: '5.6.7.8', port: 1080, socksType: 5, username: 'u' }, 'SOCKS5'],
  ];
  for (const [extra, proxy, rotulo] of casos) {
    const { gerente } = montar({ useProxy: 1, proxyIp: '5.6.7.8', proxyPort: '1080', ...extra });
    limparDiario();
    const opcoes = gerente.getClientOptions(2040);
    assert.deepStrictEqual(opcoes, { ...BASE, deviceModel: 'Desktop', systemVersion: 'Windows 11', appVersion: '4.16.2', proxy });
    assert.deepStrictEqual(Object.keys(opcoes.proxy), Object.keys(proxy));
    assert.deepStrictEqual(semGetPath(), [['stdout', `[Telegram] Connecting via ${rotulo} proxy: 5.6.7.8:1080`]]);
  }
  for (const ajustes of [{ useProxy: true, proxyIp: '5.6.7.8' }, { useProxy: true, proxyPort: '1' }, { useProxy: false, proxyIp: '5.6.7.8', proxyPort: '1' }]) {
    const { gerente } = montar(ajustes);
    assert.strictEqual('proxy' in gerente.getClientOptions(6), false);
  }
});

test('getClientOptions registra o erro de leitura do ajuste e devolve o perfil', () => {
  for (const [conteudo, erro] of [['{quebrado', /JSON/], ['null', /Cannot read properties of null \(reading 'useProxy'\)/]]) {
    const { gerente } = montar(conteudo);
    limparDiario();
    assert.deepStrictEqual(gerente.getClientOptions(6), { ...BASE, deviceModel: 'Samsung SM-S908B', systemVersion: 'Android 13', appVersion: '10.14.0' });
    const entradas = semGetPath();
    assert.strictEqual(entradas.length, 1);
    assert.deepStrictEqual(entradas[0].slice(0, 2), ['console.error', '[Telegram-Manager] Error reading proxy config:']);
    assert.match(entradas[0][2], erro);
  }
  const { gerente } = montar();
  limparDiario();
  gerente.getClientOptions(6);
  assert.deepStrictEqual(cena.diario, [['app:getPath', 'userData']]);
});

test('sendReply exige cliente pronto, destino e texto, e assina por padrao', async () => {
  const { gerente } = montar();
  assert.strictEqual(await gerente.sendReply('1', 'oi'), false);
  assert.deepStrictEqual(semGetPath().pop(), ['console.warn', '[Telegram] Send skipped. Client not ready.']);
  const { gerente: semLogin } = montar();
  cena.autorizado = false;
  await semLogin.initialize({ apiId: 6, apiHash: 'h' });
  limparDiario();
  assert.strictEqual(await semLogin.sendReply('1', 'oi'), false);
  assert.deepStrictEqual(cena.diario, [['console.warn', '[Telegram] Send skipped. Client not ready.']]);
  cena.autorizado = true;
  const { gerente: pronto } = await conectado();
  for (const [chat, texto] of [['', 'oi'], ['  ', 'oi'], [null, 'oi'], ['1', '   '], ['1', undefined]]) {
    assert.strictEqual(await pronto.sendReply(chat, texto), false);
  }
  assert.deepStrictEqual(cena.diario, Array(5).fill(['console.warn', '[Telegram] sendReply: invalid chatId or empty message.']));
  limparDiario();
  assert.strictEqual(await pronto.sendReply(77, '  ola  '), true);
  assert.strictEqual(await pronto.sendReply(' 77 ', 'cru', true), true);
  cena.falhaEnvio = 'FLOOD';
  assert.strictEqual(await pronto.sendReply('77', 'x'), false);
  assert.deepStrictEqual(cena.diario, [
    ['cliente:sendMessage', '77', { message: 'ola\n\n_[NOVA_AI_BOT]_' }], ['stdout', '[Telegram] Reply sent successfully.'],
    ['cliente:sendMessage', '77', { message: 'cru' }], ['stdout', '[Telegram] Reply sent successfully.'],
    ['cliente:sendMessage', '77', { message: 'x\n\n_[NOVA_AI_BOT]_' }], ['console.error', '[Telegram] Failed sending reply message:', 'FLOOD'],
  ]);
});

test('initialize autenticado conecta, grava a sessao e registra os eventos', async () => {
  const { gerente, lerSessao } = montar();
  limparDiario();
  assert.deepStrictEqual(await gerente.initialize({ sessionString: 'abc', apiId: '2496', apiHash: 'hh' }), { success: true, authenticated: true });
  assert.deepStrictEqual(semGetPath(), [
    ['janela', 'telegram-event', { event: 'status', data: { status: 'initializing' } }],
    ['cliente:novo', { sessao: 'abc', apiId: 2496, apiHash: 'hh', opcoes: { ...BASE, deviceModel: 'WebK', systemVersion: 'Chrome/120.0.0.0', appVersion: '2.0.0' } }],
    ['cliente:connect'],
    ['janela', 'telegram-event', { event: 'status', data: { status: 'connected' } }],
    ['cliente:getMe'],
    ['stdout', '[Telegram] 🤖 Authenticated as: Ana'],
    ['cliente:addEventHandler', 'NewMessage', {}],
  ]);
  assert.deepStrictEqual(lerSessao(), { sessionString: 'sessao-gravada', apiId: '2496', apiHash: 'hh' });
  assert.deepStrictEqual(gerente.getState(), { status: 'connected', reason: null, isReady: true, isInitializing: false, busyModeEnabled: false, busyStatusText: 'busy hain ya shayad kahin bahar gaye hain', qrCode: '' });
  assert.deepStrictEqual(await gerente.initialize({ apiId: 6, apiHash: 'h' }).then((r) => r.success), true);
});

test('initialize recusa chamada paralela e trata nao autenticado', async () => {
  const { gerente } = montar();
  cena.autorizado = false;
  let liberarConexao;
  cena.conexao = new Promise((resolve) => { liberarConexao = resolve; });
  const primeira = gerente.initialize({ apiId: 6, apiHash: 'h' });
  await new Promise(setImmediate);
  assert.deepStrictEqual(gerente.getState().isInitializing, true);
  assert.deepStrictEqual(await gerente.initialize({ apiId: 6, apiHash: 'h' }), { success: false, error: 'Already initializing' });
  liberarConexao();
  assert.deepStrictEqual(await primeira, { success: true, authenticated: false });
  assert.deepStrictEqual(status().pop(), { status: 'disconnected', reason: 'not-authenticated' });
  assert.deepStrictEqual(gerente.getState().isInitializing, false);
  assert.deepStrictEqual(gerente.getState().isReady, false);
});

test('initialize com chave recusada apaga a sessao salva; outro erro nao', async () => {
  for (const [erro, apaga] of [['AUTH_KEY_UNREGISTERED', true], ['HTTP 401', true], ['TIMEOUT', false]]) {
    const { gerente, sessao } = montar();
    fs.mkdirSync(path.dirname(sessao), { recursive: true });
    fs.writeFileSync(sessao, '{}');
    cena.falhaConnect = erro;
    limparDiario();
    assert.deepStrictEqual(await gerente.initialize({ apiId: 6, apiHash: 'h' }), { success: false, error: erro });
    assert.deepStrictEqual(semGetPath().slice(-2), [
      ['console.error', '[Telegram] Init error:', `Error: ${erro}`],
      ['janela', 'telegram-event', { event: 'status', data: { status: 'disconnected', reason: erro } }],
    ]);
    assert.strictEqual(fs.existsSync(sessao), !apaga);
    assert.strictEqual(gerente.getState().isInitializing, false);
  }
});

test('autoConnect usa a sessao salva so quando ela esta completa', async () => {
  const { gerente, sessao } = montar();
  limparDiario();
  await gerente.autoConnect();
  assert.deepStrictEqual(semGetPath(), []);
  assert.strictEqual(fs.existsSync(path.dirname(sessao)), true);
  for (const incompleta of [{ sessionString: 's', apiId: 6 }, { apiId: 6, apiHash: 'h' }, { sessionString: '', apiId: 6, apiHash: 'h' }]) {
    fs.writeFileSync(sessao, JSON.stringify(incompleta));
    await gerente.autoConnect();
  }
  assert.deepStrictEqual(semGetPath(), []);
  fs.writeFileSync(sessao, JSON.stringify({ sessionString: 's', apiId: 2040, apiHash: 'h', extra: 1 }));
  await gerente.autoConnect();
  assert.deepStrictEqual(semGetPath().slice(0, 3), [
    ['stdout', '[Telegram] Auto-connecting saved session...'],
    ['janela', 'telegram-event', { event: 'status', data: { status: 'initializing' } }],
    ['cliente:novo', { sessao: 's', apiId: 2040, apiHash: 'h', opcoes: { ...BASE, deviceModel: 'Desktop', systemVersion: 'Windows 11', appVersion: '4.16.2' } }],
  ]);
  for (const [conteudo, erro] of [['{x', /JSON/], ['null', /Cannot read properties of null \(reading 'sessionString'\)/]]) {
    fs.writeFileSync(sessao, conteudo);
    limparDiario();
    await gerente.autoConnect();
    const entradas = semGetPath();
    assert.deepStrictEqual(entradas.map((e) => e.slice(0, 2)), [['console.error', '[Telegram] Failed auto-connecting session:']]);
    assert.match(entradas[0][2], erro);
  }
});

test('sendOtpCode guarda o login pendente e submitOtpCode conclui', async () => {
  const { gerente, lerSessao } = montar();
  assert.deepStrictEqual(await gerente.submitOtpCode({ code: '1' }), { success: false, error: 'No login flow active' });
  limparDiario();
  assert.deepStrictEqual(await gerente.sendOtpCode({ phone: '+55', apiId: '6', apiHash: 'h' }), { success: true });
  assert.deepStrictEqual(await gerente.submitOtpCode({ code: '123' }), { success: true, authenticated: true });
  assert.deepStrictEqual(semGetPath(), [
    ['janela', 'telegram-event', { event: 'status', data: { status: 'connecting' } }],
    ['cliente:novo', { sessao: '', apiId: 6, apiHash: 'h', opcoes: { ...BASE, deviceModel: 'Samsung SM-S908B', systemVersion: 'Android 13', appVersion: '10.14.0' } }],
    ['cliente:connect'],
    ['cliente:sendCode', { apiId: 6, apiHash: 'h' }, '+55'],
    ['janela', 'telegram-event', { event: 'status', data: { status: 'wait_code' } }],
    ['cliente:invoke', 'SignIn', { phoneNumber: '+55', phoneCodeHash: 'hash-1', phoneCode: '123' }],
    ['janela', 'telegram-event', { event: 'status', data: { status: 'connected' } }],
    ['cliente:getMe'],
    ['stdout', '[Telegram] 🤖 Logged in as: Ana'],
    ['cliente:addEventHandler', 'NewMessage', {}],
  ]);
  assert.deepStrictEqual(lerSessao(), { sessionString: 'sessao-gravada', apiId: '6', apiHash: 'h' });
  assert.strictEqual(gerente.pendingLogin, null);
  assert.strictEqual(gerente.isReady, true);
});

test('sendOtpCode com falha volta a desconectado', async () => {
  const { gerente } = montar();
  cena.falhaSendCode = 'PHONE_NUMBER_INVALID';
  assert.deepStrictEqual(await gerente.sendOtpCode({ phone: '+1', apiId: 6, apiHash: 'h' }), { success: false, error: 'PHONE_NUMBER_INVALID' });
  assert.deepStrictEqual(status(), [{ status: 'connecting' }, { status: 'disconnected', reason: 'PHONE_NUMBER_INVALID' }]);
  assert.strictEqual(gerente.pendingLogin, null);
});

test('submitOtpCode pede senha, recusa cadastro novo e repassa erro', async () => {
  const casos = [
    [async () => { throw new Error('SESSION_PASSWORD_NEEDED'); }, { success: true, requiresPassword: true }],
    [async () => new AuthorizationSignUpRequired(), { success: false, error: 'SIGN_UP_REQUIRED: This phone number is not registered on Telegram. Please register it using the official app first.' }],
    [async () => { throw new Error('PHONE_CODE_INVALID'); }, { success: false, error: 'PHONE_CODE_INVALID' }],
  ];
  for (const [resposta, esperado] of casos) {
    const { gerente } = montar();
    await gerente.sendOtpCode({ phone: '+55', apiId: 6, apiHash: 'h' });
    cena.respostaDoSignIn = resposta;
    limparDiario();
    assert.deepStrictEqual(await gerente.submitOtpCode({ code: '1' }), esperado);
    assert.notStrictEqual(gerente.pendingLogin, null);
    assert.strictEqual(gerente.isReady, false);
    const ultimo = semGetPath().pop();
    if (esperado.requiresPassword) assert.deepStrictEqual(ultimo, ['janela', 'telegram-event', { event: 'status', data: { status: 'wait_password' } }]);
    else assert.deepStrictEqual(ultimo, ['console.error', '[Telegram] OTP verification failed:', `Error: ${esperado.error}`]);
  }
});

test('submitPassword conclui o login de dois fatores', async () => {
  const { gerente, lerSessao } = montar();
  assert.deepStrictEqual(await gerente.submitPassword({ password: 'x' }), { success: false, error: 'No login flow active' });
  await gerente.sendOtpCode({ phone: '+55', apiId: '2040', apiHash: 'h2' });
  limparDiario();
  cena.eu = { id: 1n, username: 'so_usuario' };
  assert.deepStrictEqual(await gerente.submitPassword({ password: 'segredo' }), { success: true, authenticated: true });
  assert.deepStrictEqual(semGetPath(), [
    ['cliente:signInWithPassword', { apiId: 2040, apiHash: 'h2' }, 'segredo'],
    ['janela', 'telegram-event', { event: 'status', data: { status: 'connected' } }],
    ['cliente:getMe'],
    ['stdout', '[Telegram] 🤖 Logged in as (2FA): so_usuario'],
    ['cliente:addEventHandler', 'NewMessage', {}],
  ]);
  assert.deepStrictEqual(lerSessao(), { sessionString: 'sessao-gravada', apiId: '2040', apiHash: 'h2' });
  assert.strictEqual(gerente.bossName, 'so_usuario');
});

test('submitPassword com senha errada mantem o login pendente', async () => {
  const { gerente } = montar();
  await gerente.sendOtpCode({ phone: '+55', apiId: 6, apiHash: 'h' });
  cena.falhaSenha = 'PASSWORD_HASH_INVALID';
  cena.eu = {};
  limparDiario();
  assert.deepStrictEqual(await gerente.submitPassword({ password: 'errada' }), { success: false, error: 'PASSWORD_HASH_INVALID' });
  assert.deepStrictEqual(semGetPath(), [
    ['cliente:signInWithPassword', { apiId: 6, apiHash: 'h' }, 'errada'],
    ['console.error', '[Telegram] 2FA Password error callback:', 'Error: PASSWORD_HASH_INVALID'],
    ['onError', true],
    ['console.error', '[Telegram] 2FA authentication failed:', 'Error: PASSWORD_HASH_INVALID'],
  ]);
  assert.notStrictEqual(gerente.pendingLogin, null);
});

test('sendQrCode mostra o QR, pede a senha e conclui o login', async () => {
  const { gerente, lerSessao } = montar();
  limparDiario();
  assert.deepStrictEqual(await gerente.sendQrCode({ apiId: 6, apiHash: 'h' }), { success: true });
  await cena.retornosQr.qrCode({ token: Buffer.from('tok') });
  assert.strictEqual(gerente.getState().qrCode, 'data:tg://login?token=dG9r');
  cena.falhaQrcode = true;
  await cena.retornosQr.qrCode({ token: Buffer.from('tok2') });
  assert.strictEqual(gerente.getState().qrCode, 'tg://login?token=dG9rMg');
  const senha = cena.retornosQr.password('dica');
  assert.deepStrictEqual(await gerente.submitPassword({ password: 'p' }), { success: true, authenticated: true });
  assert.strictEqual(await senha, 'p');
  assert.strictEqual(gerente.passwordResolver, null);
  cena.eu = { id: 1n };
  cena.concluirQr();
  await new Promise(setImmediate);
  assert.deepStrictEqual(semGetPath(), [
    ['janela', 'telegram-event', { event: 'status', data: { status: 'connecting' } }],
    ['cliente:novo', { sessao: '', apiId: 6, apiHash: 'h', opcoes: { ...BASE, deviceModel: 'Samsung SM-S908B', systemVersion: 'Android 13', appVersion: '10.14.0' } }],
    ['cliente:connect'],
    ['cliente:qr', { apiId: 6, apiHash: 'h' }],
    ['janela', 'telegram-event', { event: 'status', data: { status: 'wait_qr', qrUrl: 'data:tg://login?token=dG9r' } }],
    ['console.error', '[Telegram] QR generation failed:', 'Error: qr quebrado'],
    ['janela', 'telegram-event', { event: 'status', data: { status: 'wait_qr', qrUrl: 'tg://login?token=dG9rMg' } }],
    ['janela', 'telegram-event', { event: 'status', data: { status: 'wait_password' } }],
    ['janela', 'telegram-event', { event: 'status', data: { status: 'connected' } }],
    ['cliente:getMe'],
    ['stdout', '[Telegram] 🤖 Logged in via QR Code as: Boss'],
    ['cliente:addEventHandler', 'NewMessage', {}],
  ]);
  assert.deepStrictEqual(lerSessao(), { sessionString: 'sessao-gravada', apiId: 6, apiHash: 'h' });
  assert.deepStrictEqual([gerente.isReady, gerente.pendingLogin, gerente.getState().qrCode], [true, null, '']);
});

test('login por QR concluido sem a senha descarta o pedido de senha', async () => {
  const { gerente } = montar();
  await gerente.sendQrCode({ apiId: 6, apiHash: 'h' });
  cena.retornosQr.password();
  assert.strictEqual(typeof gerente.passwordResolver, 'function');
  cena.concluirQr();
  await new Promise(setImmediate);
  assert.strictEqual(gerente.passwordResolver, null);
});

test('sendQrCode com erro ou abandono volta a desconectado', async () => {
  const { gerente } = montar();
  await gerente.sendQrCode({ apiId: 6, apiHash: 'h' });
  limparDiario();
  assert.strictEqual(await cena.retornosQr.onError(new Error('QR_EXPIRED')), true);
  cena.abortarQr(new Error('AUTH_USER_CANCEL'));
  await new Promise(setImmediate);
  assert.deepStrictEqual(semGetPath(), [
    ['console.error', '[Telegram] QR Code Login error:', 'QR_EXPIRED'],
    ['janela', 'telegram-event', { event: 'status', data: { status: 'disconnected', reason: 'QR_EXPIRED' } }],
    ['console.error', '[Telegram] QR code login failed/aborted:', 'AUTH_USER_CANCEL'],
    ['janela', 'telegram-event', { event: 'status', data: { status: 'disconnected', reason: 'AUTH_USER_CANCEL' } }],
  ]);
  const { gerente: outro } = montar();
  cena.falhaConnect = 'NETWORK';
  assert.deepStrictEqual(await outro.sendQrCode({ apiId: 6, apiHash: 'h' }), { success: false, error: 'NETWORK' });
  assert.deepStrictEqual(semGetPath().slice(-2), [
    ['console.error', '[Telegram] Failed initiating QR login:', 'Error: NETWORK'],
    ['janela', 'telegram-event', { event: 'status', data: { status: 'disconnected', reason: 'NETWORK' } }],
  ]);
});

test('novo login desconecta o cliente pendente anterior', async () => {
  const { gerente } = montar();
  await gerente.sendOtpCode({ phone: '+55', apiId: 6, apiHash: 'h' });
  cena.falhaDisconnect = 'ja fechado';
  limparDiario();
  await gerente.sendQrCode({ apiId: 6, apiHash: 'h' });
  assert.deepStrictEqual(semGetPath().slice(0, 3), [
    ['stdout', '[Telegram] Disconnecting previous pending login client...'],
    ['cliente:disconnect'],
    ['console.warn', '[Telegram] Error disconnecting pending login client:', 'ja fechado'],
  ]);
});

test('logout encerra o cliente, limpa o estado e apaga a sessao', async () => {
  const { gerente, sessao } = await conectado();
  assert.deepStrictEqual(await gerente.logout(), { success: true });
  assert.deepStrictEqual(semGetPath(), [['cliente:logOut'], ['janela', 'telegram-event', { event: 'status', data: { status: 'disconnected' } }]]);
  assert.strictEqual(fs.existsSync(sessao), false);
  assert.deepStrictEqual([gerente.client, gerente.isReady, gerente.connectionCheckInterval], [null, false, null]);
  const { gerente: pendente } = montar();
  await pendente.sendOtpCode({ phone: '+55', apiId: 6, apiHash: 'h' });
  pendente.client = pendente.pendingLogin.client;
  limparDiario();
  assert.deepStrictEqual(await pendente.logout(), { success: true });
  assert.deepStrictEqual(semGetPath().filter(([tipo]) => tipo.startsWith('cliente')), [['cliente:disconnect'], ['cliente:disconnect']]);
});

test('a conferencia periodica invalida a sessao com chave recusada', async (t) => {
  const { gerente, sessao } = await conectado();
  cena.falhaGetMe = 'TIMEOUT';
  t.mock.timers.tick(15000);
  await new Promise(setImmediate);
  assert.deepStrictEqual(semGetPath(), [['cliente:getMe'], ['console.error', '[Telegram-Monitor] Connection check encountered error:', 'TIMEOUT']]);
  assert.strictEqual(fs.existsSync(sessao), true);
  limparDiario();
  cena.falhaGetMe = 'AUTH_KEY_UNREGISTERED';
  cena.falhaDisconnect = 'socket';
  t.mock.timers.tick(15000);
  await new Promise(setImmediate);
  assert.deepStrictEqual(semGetPath(), [
    ['cliente:getMe'],
    ['console.error', '[Telegram-Monitor] Connection check encountered error:', 'AUTH_KEY_UNREGISTERED'],
    ['console.warn', '[Telegram-Monitor] Authorization key is unregistered. Logging out/invalidating session...'],
    ['janela', 'telegram-event', { event: 'status', data: { status: 'disconnected', reason: 'session-expired' } }],
    ['cliente:disconnect'],
    ['console.warn', '[Telegram-Monitor] Error during disconnect:', 'socket'],
    ['stdout', '[Telegram-Monitor] Invalid session file deleted.'],
  ]);
  assert.deepStrictEqual([gerente.client, gerente.isReady, gerente.connectionCheckInterval, fs.existsSync(sessao)], [null, false, null, false]);
  limparDiario();
  t.mock.timers.tick(60000);
  assert.deepStrictEqual(cena.diario, []);
});

test('mensagem de convidado vai para a interface uma vez so', async (t) => {
  const { gerente } = await conectado();
  const evento = mensagem({ texto: '  ola nova  ' });
  await cena.tratador(evento);
  await cena.tratador(evento);
  assert.deepStrictEqual(semGetPath(), [
    ['cliente:getMe'],
    ['stdout', '[TG-Bridge] body="ola nova" | fromMe=false | isSelf=false | targetId=7'],
    ['janela', 'telegram-event', { event: 'mobile-message', data: { message: 'ola nova', chatId: '7', fromMe: false, isSelfChat: false, bossName: 'Ana', timestamp: 1700000000, messageId: '99' } }],
    ['cliente:getMe'],
    ['stdout', '[TG-Bridge] body="ola nova" | fromMe=false | isSelf=false | targetId=7'],
  ]);
  t.mock.timers.tick(10000);
  limparDiario();
  await cena.tratador(evento);
  assert.strictEqual(semGetPath().filter(([tipo]) => tipo === 'janela').length, 1);
  assert.strictEqual(gerente.processedMessageIds.size, 1);
});

test('mensagem vazia, do proprio bot ou resposta enviada ao convidado e ignorada', async () => {
  await conectado();
  for (const evento of [{}, { message: null }, { message: { message: '' } }]) await cena.tratador(evento);
  assert.deepStrictEqual(cena.diario, []);
  const ignoradas = [
    mensagem({ texto: 'oi [NOVA_AI_BOT]' }), mensagem({ texto: 'robo 🤖', data: 2 }), mensagem({ texto: 'a\u200Bb', data: 3 }),
    mensagem({ texto: 'respondi', out: true, data: 4 }), mensagem({ texto: 'sem remetente', de: null, data: 5 }),
  ];
  for (const evento of ignoradas) await cena.tratador(evento);
  const janela = semGetPath().filter(([tipo]) => tipo === 'janela');
  assert.deepStrictEqual(janela.map(([, , carga]) => carga.data.chatId), ['']);
  assert.ok(semGetPath().some(([, texto]) => texto === '[TG-Bridge] body="respondi" | fromMe=true | isSelf=false | targetId=7'));
});

test('comando de bloqueio no chat proprio usa o bloqueio do sistema', async () => {
  for (const [plataforma, esperado] of [
    ['darwin', ['mac-native:run', '/System/Library/CoreServices/Menu Extras/User.menu/Contents/Resources/CGSession', ['-suspend']]],
    ['win32', ['child_process:exec', 'rundll32.exe user32.dll,LockWorkStation']],
  ]) {
    await conectado();
    Object.defineProperty(process, 'platform', { value: plataforma });
    for (const [i, texto] of ['!lock', 'LOCK PC', 'meu laptop band karo', 'Lock Laptop', 'system lock'].entries()) {
      limparDiario();
      await cena.tratador(mensagem({ texto, de: 42n, out: true, data: i }));
      assert.deepStrictEqual(semGetPath().slice(2), [
        ['stdout', '[ROOT_CMD_TG] 🔒 Instant System Lock Triggered'],
        esperado,
        ['cliente:sendMessage', '42', { message: '🔒 ✅ *[ROOT_CMD]* PC/Laptop instantly lock kar diya gaya hai Boss!\n\n_[NOVA_AI_BOT]_' }],
        ['stdout', '[Telegram] Reply sent successfully.'],
      ]);
    }
  }
});

test('comando !browser abre o endereco com https quando falta o protocolo', async () => {
  await conectado();
  for (const [i, [texto, url]] of [['!browser exemplo.com ', 'https://exemplo.com'], ['!BROWSER http://a.b/C', 'http://a.b/C'], ['!browser httpx.io', 'httpx.io']].entries()) {
    limparDiario();
    await cena.tratador(mensagem({ texto, de: 42n, data: i }));
    assert.deepStrictEqual(semGetPath().slice(2), [
      ['stdout', `[ROOT_CMD_TG] 🌐 Opening browser: ${url}`],
      ['shell:openExternal', url],
      ['cliente:sendMessage', '42', { message: `✅ *[ROOT_CMD]* Browser mein kholna shuru kar diya:\n${url}\n\n_[NOVA_AI_BOT]_` }],
      ['stdout', '[Telegram] Reply sent successfully.'],
    ]);
  }
});

test('comandos de status e modo ocupado respondem no chat proprio', async () => {
  const { gerente, lerAjustes } = await conectado({ proxyIp: '9.9.9.9', busyStatusText: 'fora' });
  const enviados = [];
  for (const [i, texto] of ['!sysinfo', '!busy on', 'SYSINFO', '!busy off', '!Status'].entries()) {
    limparDiario();
    await cena.tratador(mensagem({ texto, de: 42n, data: i }));
    enviados.push(semGetPath().filter(([tipo]) => tipo === 'cliente:sendMessage').map(([, , c]) => c.message));
    if (i === 1) assert.deepStrictEqual(lerAjustes(), { proxyIp: '9.9.9.9', busyStatusText: 'fora', busyModeEnabled: true, tgNotificationFilterEnabled: false, tgMonitoredGroups: [], tgNotificationMessage: '⚠️ Nova Predefined Group Notification: Active monitored group message detected!', tgNotificationCooldowns: {} });
  }
  const status = (ocupado) => `*🖥️ NOVA SYSTEM STATUS*\n\n*CPU:* CPU Falsa\n*CPU Load:* 1.23%\n*RAM:* 4.50 GB Free / 16.00 GB Total\n*Platform:* plataforma 9.9\n*Boss Name:* Ana\n*Busy Mode:* ${ocupado}\n\n_[NOVA_AI_BOT]_`;
  assert.deepStrictEqual(enviados, [
    [status('🔴 OFF')],
    ['✅ *[ROOT_CMD]* Busy Mode *ACTIVE*. Guests ko auto-reply milega.\n\n_[NOVA_AI_BOT]_'],
    [status('🟢 ON')],
    ['✅ *[ROOT_CMD]* Busy Mode *DISABLED*.\n\n_[NOVA_AI_BOT]_'],
    [status('🔴 OFF')],
  ]);
  assert.strictEqual(lerAjustes().busyModeEnabled, false);
  assert.strictEqual(gerente.busyModeEnabled, false);
});

test('mensagem do chat proprio que nao e comando vai para a interface', async () => {
  await conectado();
  for (const [i, texto] of ['!busy', 'lock it', '!browser', 'oi nova'].entries()) {
    limparDiario();
    await cena.tratador(mensagem({ texto, de: 42n, out: true, data: i, id: i }));
    assert.deepStrictEqual(semGetPath().slice(2), [
      ['janela', 'telegram-event', { event: 'mobile-message', data: { message: texto, chatId: '42', fromMe: true, isSelfChat: true, bossName: 'Ana', timestamp: i, messageId: String(i) } }],
    ]);
  }
});

const AJUSTES_DO_FILTRO = { tgNotificationFilterEnabled: true, tgMonitoredGroups: [' Equipe Nova '], tgNotificationMessage: 'aviso do grupo' };

test('grupo monitorado recebe o aviso uma vez por dia', async (t) => {
  const { lerAjustes } = await conectado(AJUSTES_DO_FILTRO);
  cena.entidades = { 5: { title: 'equipe nova' }, 6: { title: 'Outro' }, 8: {} };
  const grupo = (id) => mensagem({ texto: 'oi', peer: new PeerChat(id) });
  await cena.tratador(grupo(5));
  t.mock.timers.setTime(AGORA + 23 * HORA);
  await cena.tratador(grupo(5));
  await cena.tratador(grupo(6));
  await cena.tratador(grupo(8));
  await cena.tratador(grupo(404));
  const recebida = ['stdout', '[Telegram-Filter] Received group/channel message. Enabled: true, Monitored: [" Equipe Nova "]'];
  assert.deepStrictEqual(semGetPath(), [
    recebida, ['cliente:getEntity', 5], ['stdout', '[Telegram-Filter] Resolved group title: "equipe nova"'],
    ['stdout', '[Telegram-Filter] Message detected in monitored group: "equipe nova". Dispatching predefined message...'],
    ['cliente:sendMessage', { title: 'equipe nova' }, { message: 'aviso do grupo' }],
    ['stdout', '[Telegram-Filter] Predefined notification successfully sent to group: "equipe nova"'],
    recebida, ['cliente:getEntity', 5], ['stdout', '[Telegram-Filter] Resolved group title: "equipe nova"'],
    ['stdout', '[Telegram-Filter] Group "equipe nova" is under cooldown. (Remaining: 60 minutes)'],
    recebida, ['cliente:getEntity', 6], ['stdout', '[Telegram-Filter] Resolved group title: "Outro"'],
    recebida, ['cliente:getEntity', 8], ['stdout', '[Telegram-Filter] Resolved group title: ""'],
    recebida, ['cliente:getEntity', 404], ['console.error', '[Telegram-Filter] Error in monitored group message processing:', 'entidade desconhecida'],
  ]);
  assert.deepStrictEqual(lerAjustes().tgNotificationCooldowns, { 'equipe nova': new Date(AGORA).toISOString() });
});

test('aviso de grupo respeita o intervalo gravado e falha de envio', async () => {
  const casos = [
    [new Date(AGORA - 25 * HORA).toISOString(), true],
    [new Date(AGORA - HORA).toISOString(), 'Remaining: 1380 minutes'],
    ['data invalida', 'Remaining: NaN minutes'],
    ['', true],
  ];
  for (const [ultimo, esperado] of casos) {
    await conectado({ ...AJUSTES_DO_FILTRO, tgNotificationCooldowns: { 'Equipe Nova': ultimo } });
    cena.entidades = { 5: { title: 'Equipe Nova' } };
    await cena.tratador(mensagem({ texto: 'x', peer: new PeerChat(5) }));
    const enviou = semGetPath().some(([tipo]) => tipo === 'cliente:sendMessage');
    if (esperado === true) assert.strictEqual(enviou, true);
    else assert.match(semGetPath().pop()[1], new RegExp(esperado));
  }
  const { gerente, lerAjustes } = await conectado(AJUSTES_DO_FILTRO);
  cena.entidades = { 5: { title: 'Equipe Nova' } };
  cena.falhaEnvio = 'CHAT_WRITE_FORBIDDEN';
  await cena.tratador(mensagem({ texto: 'x', peer: new PeerChat(5) }));
  assert.deepStrictEqual(semGetPath().pop(), ['console.error', '[Telegram-Filter] Error in monitored group message processing:', 'CHAT_WRITE_FORBIDDEN']);
  assert.deepStrictEqual(Object.keys(lerAjustes().tgNotificationCooldowns), ['Equipe Nova']);
  assert.strictEqual(gerente.tgNotificationCooldowns['Equipe Nova'], new Date(AGORA).toISOString());
});

test('filtro desligado ou sem grupos so registra a mensagem de grupo', async () => {
  for (const ajustes of [{ ...AJUSTES_DO_FILTRO, tgNotificationFilterEnabled: false }, { ...AJUSTES_DO_FILTRO, tgMonitoredGroups: [] }, { ...AJUSTES_DO_FILTRO, tgMonitoredGroups: 'Equipe Nova' }]) {
    const { gerente } = await conectado(ajustes);
    cena.entidades = { 5: { title: 'Equipe Nova' } };
    await cena.tratador(mensagem({ texto: 'x', peer: new PeerChat(5) }));
    assert.deepStrictEqual(semGetPath().map(([tipo]) => tipo), ['stdout']);
    assert.match(semGetPath()[0][1], /^\[Telegram-Filter\] Received group\/channel message\. Enabled: /);
    assert.deepStrictEqual(gerente.processedMessageIds.size, 0);
  }
});

test('loadSettings le os ajustes e mantem o padrao do que falta', () => {
  const { gerente } = montar({ busyModeEnabled: 1, tgMonitoredGroups: 'x', tgNotificationMessage: '', tgNotificationFilterEnabled: 'sim' });
  assert.deepStrictEqual(
    [gerente.busyModeEnabled, gerente.busyStatusText, gerente.tgNotificationFilterEnabled, gerente.tgMonitoredGroups, gerente.tgNotificationMessage, gerente.tgNotificationCooldowns],
    [true, 'busy hain ya shayad kahin bahar gaye hain', true, [], '⚠️ Nova Predefined Group Notification: Active monitored group message detected!', {}],
  );
  const { gerente: quebrado } = montar('{');
  assert.strictEqual(quebrado.busyModeEnabled, false);
  assert.deepStrictEqual(cena.diario.filter(([tipo]) => tipo === 'console.error').map((e) => e[1]), ['[Telegram] Failed to load settings:']);
});
