'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { carregarMain, comPlataforma } = require('./ajuda/carregar-main');
const { carregarComArranqueCompleto } = require('./ajuda/arranque-completo');

const SEM_ACESSO_REMOTO = ['./services/remote-access'];
const METODOS_DO_WHATSAPP = ['initialize', 'getState', 'updateMainWindow', 'logout', 'sendReply', 'sendReplyWithMimicry', 'shutdown'];
const METODOS_DO_TELEGRAM = [
  'initialize', 'autoConnect', 'getState', 'updateMainWindow', 'loadSettings', 'sendOtpCode', 'sendQrCode',
  'submitOtpCode', 'submitPassword', 'logout', 'sendReply',
];
const ESTADO_SEM_WHATSAPP = { status: 'disconnected', reason: null, isReady: false, isInitializing: false, qrCode: null, reconnectAttempts: 0 };
const ESTADO_SEM_TELEGRAM = { status: 'disconnected', reason: null, isReady: false, isInitializing: false };
const ESTADO_PRONTO = { status: 'connected', isReady: true };

function classeDeGerente(metodos) {
  const criados = [];
  const falhas = new Map();
  const respostas = new Map([['getState', ESTADO_PRONTO]]);
  class Gerente {
    constructor(janela, app) {
      if (falhas.has('constructor')) throw falhas.get('constructor');
      Object.assign(this, { janela, app, chamadas: [] });
      criados.push(this);
    }
  }
  for (const metodo of metodos) {
    Gerente.prototype[metodo] = function chamar(...argumentos) {
      this.chamadas.push([metodo, ...argumentos]);
      if (falhas.has(metodo)) throw falhas.get(metodo);
      return respostas.has(metodo) ? respostas.get(metodo) : `${metodo}-ok`;
    };
  }
  return Object.assign(Gerente, { criados, falhas, respostas });
}

function servicoDeAcessoRemoto() {
  const chamadas = [];
  const registrar = (nome, resposta) => (...argumentos) => {
    chamadas.push([nome, ...argumentos]);
    return typeof resposta === 'function' ? resposta(...argumentos) : resposta;
  };
  const servico = {
    chamadas,
    tokens: new Map(),
    publicUrl: 'https://tunel.example.com',
    status: { isRunning: true, port: 4100 },
    qr: (token) => ({ success: true, qrCode: `qr-de-${token}`, directUrl: `https://tunel.example.com/?t=${token}` }),
    falhaNoTunel: null,
  };
  let proximoToken = 1;
  Object.assign(servico, {
    getStatus: registrar('getStatus', () => servico.status),
    generateToken: registrar('generateToken', (nome) => {
      const token = `token-${proximoToken++}`;
      servico.tokens.set(token, { token, active: true, nome });
      return { token };
    }),
    generateQRCode: registrar('generateQRCode', async (token) => servico.qr(token)),
    revogarTodosOsTokens: registrar('revogarTodosOsTokens', () => servico.tokens.clear()),
    startCloudflaredTunnel: registrar('startCloudflaredTunnel', async () => {
      if (servico.falhaNoTunel) throw servico.falhaNoTunel;
    }),
    broadcastToMobile: registrar('broadcastToMobile'),
    setDesktopCallback: registrar('setDesktopCallback'),
    start: registrar('start', async () => {}),
    stop: registrar('stop', async () => {}),
  });
  return servico;
}

function carregarMensageria(opcoes = {}) {
  const WhatsApp = classeDeGerente(METODOS_DO_WHATSAPP);
  const Telegram = classeDeGerente(METODOS_DO_TELEGRAM);
  const modulos = { './services/whatsapp-manager': WhatsApp, './services/telegram-manager': Telegram, ...opcoes.modulos };
  const main = carregarMain({ ausentes: SEM_ACESSO_REMOTO, ...opcoes, modulos });
  return { main, WhatsApp, Telegram };
}

function carregarComServicoRemoto() {
  const servico = servicoDeAcessoRemoto();
  const { main } = carregarComArranqueCompleto({
    modulos: { './services/remote-access': function ServicoDeAcessoRemoto() { return servico; } },
  });
  return { main, servico };
}

const arquivoDe = (main, nome) => path.join(main.pasta('userData'), nome);
const lerJson = (main, nome) => JSON.parse(fs.readFileSync(arquivoDe(main, nome), 'utf8'));
const escreverJson = (main, nome, valor) => fs.writeFileSync(arquivoDe(main, nome), JSON.stringify(valor));
const bloquear = (main, nome) => fs.mkdirSync(arquivoDe(main, nome), { recursive: true });

async function avancarRelogioAteTerminar(t, promessa) {
  let terminou = false;
  const resultado = promessa.finally(() => { terminou = true; });
  let passos = 0;
  for (;;) {
    await new Promise((resolver) => setImmediate(resolver));
    if (terminou) break;
    t.mock.timers.tick(500);
    passos++;
  }
  return { resposta: await resultado, passos };
}

const CANAIS_DO_WHATSAPP = [
  'whatsapp-init', 'whatsapp-get-state', 'get-whatsapp-settings', 'save-whatsapp-settings', 'whatsapp-logout', 'whatsapp-send-reply',
];
const CANAIS_DO_TELEGRAM = [
  'telegram-init', 'telegram-get-state', 'get-telegram-settings', 'save-telegram-settings', 'telegram-send-otp', 'telegram-send-qr',
  'telegram-submit-code', 'telegram-submit-password', 'telegram-logout', 'telegram-send-reply',
];
const CANAIS_DO_ACESSO_REMOTO = [
  'remote-access-status', 'remote-access-regenerate', 'remote-access-restart-tunnel',
  'remote-access-broadcast-response', 'remote-access-broadcast-thinking',
];

test('os 21 canais da mensageria ficam registrados como handle, e nenhum como on', () => {
  const { main } = carregarMensageria();
  for (const canal of [...CANAIS_DO_WHATSAPP, ...CANAIS_DO_TELEGRAM, ...CANAIS_DO_ACESSO_REMOTO]) {
    assert.strictEqual(typeof main.canais.handle.get(canal), 'function', canal);
    assert.strictEqual(main.canais.on.has(canal), false, canal);
  }
  assert.strictEqual(CANAIS_DO_WHATSAPP.length + CANAIS_DO_TELEGRAM.length + CANAIS_DO_ACESSO_REMOTO.length, 21);
});

test('whatsapp-get-state: sem gerente devolve o estado desconectado; com gerente devolve o dele; se ler falha, avisa o motivo', async () => {
  const { main, WhatsApp } = carregarMensageria();
  assert.deepStrictEqual(await main.invocar('whatsapp-get-state'), ESTADO_SEM_WHATSAPP);
  await main.invocar('whatsapp-init');
  assert.deepStrictEqual(await main.invocar('whatsapp-get-state'), ESTADO_PRONTO);
  WhatsApp.falhas.set('getState', new Error('leitura quebrou'));
  assert.deepStrictEqual(await main.invocar('whatsapp-get-state'), { ...ESTADO_SEM_WHATSAPP, reason: 'state-read-failed' });
});

test('whatsapp-init cria o gerente com a janela e o app uma vez só, e nas outras vezes só atualiza a janela', async () => {
  const { main, WhatsApp } = carregarMensageria();
  assert.deepStrictEqual(await main.invocar('whatsapp-init'), { success: true, state: ESTADO_PRONTO });
  assert.strictEqual(WhatsApp.criados.length, 1);
  const [gerente] = WhatsApp.criados;
  assert.strictEqual(gerente.janela, main.janelaPrincipal);
  assert.strictEqual(gerente.app, main.app);
  assert.deepStrictEqual(gerente.chamadas, [['initialize'], ['getState']]);

  await main.invocar('whatsapp-init');
  assert.strictEqual(WhatsApp.criados.length, 1);
  assert.deepStrictEqual(gerente.chamadas.slice(2), [['updateMainWindow', main.janelaPrincipal], ['initialize'], ['getState']]);
});

test('whatsapp-init devolve o erro de quem falha ao iniciar e tenta criar de novo se o construtor falhou', async () => {
  const { main, WhatsApp } = carregarMensageria();
  WhatsApp.falhas.set('constructor', new Error('sem chromium'));
  assert.deepStrictEqual(await main.invocar('whatsapp-init'), { success: false, error: 'sem chromium' });
  assert.strictEqual(WhatsApp.criados.length, 0);
  WhatsApp.falhas.clear();
  WhatsApp.falhas.set('initialize', new Error('sessão negada'));
  assert.deepStrictEqual(await main.invocar('whatsapp-init'), { success: false, error: 'sessão negada' });
  assert.strictEqual(WhatsApp.criados.length, 1);
});

test('as preferências do WhatsApp e do Telegram: sem arquivo ou com arquivo quebrado vale autoConnect falso, e gravar junta com o que já havia', async () => {
  const { main, Telegram } = carregarMensageria();
  const pares = [
    { ler: 'get-whatsapp-settings', gravar: 'save-whatsapp-settings', arquivo: 'whatsapp_settings.json' },
    { ler: 'get-telegram-settings', gravar: 'save-telegram-settings', arquivo: 'telegram_settings.json' },
  ];
  for (const { ler, gravar, arquivo } of pares) {
    assert.deepStrictEqual(await main.invocar(ler), { autoConnect: false });
    assert.strictEqual(await main.invocar(gravar, { autoConnect: true, extra: 1 }), true);
    assert.deepStrictEqual(lerJson(main, arquivo), { autoConnect: true, extra: 1 });
    assert.strictEqual(fs.readFileSync(arquivoDe(main, arquivo), 'utf8'), JSON.stringify({ autoConnect: true, extra: 1 }, null, 2));
    assert.strictEqual(await main.invocar(gravar, { autoConnect: false }), true);
    assert.deepStrictEqual(await main.invocar(ler), { autoConnect: false, extra: 1 });
    assert.strictEqual(await main.invocar(gravar, null), true);
    assert.strictEqual(await main.invocar(gravar), true);
    assert.deepStrictEqual(lerJson(main, arquivo), { autoConnect: false, extra: 1 });
    fs.writeFileSync(arquivoDe(main, arquivo), '{quebrado');
    assert.deepStrictEqual(await main.invocar(ler), { autoConnect: false });
    assert.strictEqual(await main.invocar(gravar, { a: 1 }), false);
    fs.rmSync(arquivoDe(main, arquivo));
    bloquear(main, arquivo);
    assert.deepStrictEqual(await main.invocar(ler), { autoConnect: false });
    assert.strictEqual(await main.invocar(gravar, { a: 1 }), false);
  }
  assert.strictEqual(Telegram.criados.length, 0);
});

test('save-telegram-settings manda o gerente do Telegram reler as preferências, e não cria gerente se não havia', async () => {
  const { main, Telegram } = carregarMensageria();
  await main.invocar('save-telegram-settings', { autoConnect: true });
  assert.strictEqual(Telegram.criados.length, 0);
  await main.invocar('telegram-init');
  assert.strictEqual(await main.invocar('save-telegram-settings', { autoConnect: false }), true);
  assert.deepStrictEqual(Telegram.criados[0].chamadas.at(-1), ['loadSettings']);
  Telegram.falhas.set('loadSettings', new Error('não leu'));
  assert.strictEqual(await main.invocar('save-telegram-settings', { autoConnect: true }), false);
  assert.deepStrictEqual(lerJson(main, 'telegram_settings.json'), { autoConnect: true });
});

test('whatsapp-logout: sem gerente responde sucesso sem estado; com gerente sai e devolve o estado; se sair falha, devolve o erro', async () => {
  const { main, WhatsApp } = carregarMensageria();
  assert.deepStrictEqual(await main.invocar('whatsapp-logout'), { success: true, state: null });
  await main.invocar('whatsapp-init');
  assert.deepStrictEqual(await main.invocar('whatsapp-logout'), { success: true, state: ESTADO_PRONTO });
  assert.deepStrictEqual(WhatsApp.criados[0].chamadas.slice(-2), [['logout'], ['getState']]);
  WhatsApp.falhas.set('logout', new Error('já saiu'));
  assert.deepStrictEqual(await main.invocar('whatsapp-logout'), { success: false, error: 'já saiu' });
});

test('whatsapp-send-reply escolhe o envio comum ou o com imitação, inverte a assinatura na imitação e traduz as falhas', async () => {
  const { main, WhatsApp } = carregarMensageria();
  const NAO_INICIADO = { success: false, error: 'WhatsApp Manager not initialized' };
  assert.deepStrictEqual(await main.invocar('whatsapp-send-reply', { chatId: 'c', message: 'm' }), NAO_INICIADO);
  await main.invocar('whatsapp-init');
  const [gerente] = WhatsApp.criados;
  const antes = gerente.chamadas.length;

  WhatsApp.respostas.set('sendReply', true);
  WhatsApp.respostas.set('sendReplyWithMimicry', true);
  assert.deepStrictEqual(await main.invocar('whatsapp-send-reply', { chatId: 'c1', message: 'oi' }), { success: true });
  assert.deepStrictEqual(await main.invocar('whatsapp-send-reply', { chatId: 'c2', message: 'oi', removeSignature: true }), { success: true });
  assert.deepStrictEqual(await main.invocar('whatsapp-send-reply', { chatId: 'c3', message: 'oi', isMimicry: true }), { success: true });
  assert.deepStrictEqual(await main.invocar('whatsapp-send-reply', { chatId: 'c4', message: 'oi', isMimicry: true, removeSignature: true }), { success: true });
  assert.deepStrictEqual(gerente.chamadas.slice(antes), [
    ['sendReply', 'c1', 'oi', false],
    ['sendReply', 'c2', 'oi', true],
    ['sendReplyWithMimicry', 'c3', 'oi', true],
    ['sendReplyWithMimicry', 'c4', 'oi', false],
  ]);

  WhatsApp.respostas.set('sendReply', false);
  assert.deepStrictEqual(await main.invocar('whatsapp-send-reply', { chatId: 'c', message: 'm' }), { success: false, error: 'WhatsApp client is not ready or message failed to send.' });
  WhatsApp.falhas.set('sendReply', new Error('rede caiu'));
  assert.deepStrictEqual(await main.invocar('whatsapp-send-reply', { chatId: 'c', message: 'm' }), { success: false, error: 'rede caiu' });
});

test('telegram-get-state: sem gerente devolve o estado desconectado; com gerente devolve o dele; se ler falha, avisa o motivo', async () => {
  const { main, Telegram } = carregarMensageria();
  assert.deepStrictEqual(await main.invocar('telegram-get-state'), ESTADO_SEM_TELEGRAM);
  await main.invocar('telegram-init');
  assert.deepStrictEqual(await main.invocar('telegram-get-state'), ESTADO_PRONTO);
  Telegram.falhas.set('getState', new Error('leitura quebrou'));
  assert.deepStrictEqual(await main.invocar('telegram-get-state'), { ...ESTADO_SEM_TELEGRAM, reason: 'state-read-failed' });
});

test('telegram-init com chave e hash inicia com a sessão (vazia se faltar); sem os dois só conecta sozinho e devolve o estado', async () => {
  const { main, Telegram } = carregarMensageria();
  Telegram.respostas.set('initialize', { success: true, via: 'initialize' });
  assert.deepStrictEqual(await main.invocar('telegram-init', { apiId: '7', apiHash: 'h' }), { success: true, via: 'initialize' });
  const [gerente] = Telegram.criados;
  assert.strictEqual(gerente.janela, main.janelaPrincipal);
  assert.strictEqual(gerente.app, main.app);
  assert.deepStrictEqual(gerente.chamadas, [['initialize', { apiId: '7', apiHash: 'h', sessionString: '' }]]);

  await main.invocar('telegram-init', { apiId: '7', apiHash: 'h', sessionString: 'sessao' });
  assert.strictEqual(Telegram.criados.length, 1);
  assert.deepStrictEqual(gerente.chamadas.slice(1), [
    ['updateMainWindow', main.janelaPrincipal],
    ['initialize', { apiId: '7', apiHash: 'h', sessionString: 'sessao' }],
  ]);

  for (const argumentos of [[], [null], [{}], [{ apiId: '7' }], [{ apiHash: 'h' }], [{ apiId: '', apiHash: 'h' }]]) {
    gerente.chamadas.length = 0;
    assert.deepStrictEqual(await main.invocar('telegram-init', ...argumentos), { success: true, state: ESTADO_PRONTO });
    assert.deepStrictEqual(gerente.chamadas, [['updateMainWindow', main.janelaPrincipal], ['autoConnect'], ['getState']]);
  }
});

test('telegram-init devolve o erro de quem falha, no construtor, no initialize ou no autoConnect', async () => {
  const { main, Telegram } = carregarMensageria();
  Telegram.falhas.set('constructor', new Error('sem api'));
  assert.deepStrictEqual(await main.invocar('telegram-init'), { success: false, error: 'sem api' });
  Telegram.falhas.clear();
  Telegram.falhas.set('autoConnect', new Error('sem sessão'));
  assert.deepStrictEqual(await main.invocar('telegram-init'), { success: false, error: 'sem sessão' });
  Telegram.falhas.clear();
  Telegram.falhas.set('initialize', new Error('chave inválida'));
  assert.deepStrictEqual(await main.invocar('telegram-init', { apiId: '1', apiHash: 'h' }), { success: false, error: 'chave inválida' });
});

const PASSOS_DO_LOGIN_DO_TELEGRAM = [
  { canal: 'telegram-send-otp', argumentos: { phone: '+550000', apiId: '1', apiHash: 'h' }, metodo: 'sendOtpCode', criaGerente: true },
  { canal: 'telegram-send-qr', argumentos: { apiId: '1', apiHash: 'h' }, metodo: 'sendQrCode', criaGerente: true },
  { canal: 'telegram-submit-code', argumentos: { code: '12345' }, metodo: 'submitOtpCode', criaGerente: false },
  { canal: 'telegram-submit-password', argumentos: { password: 'segredo' }, metodo: 'submitPassword', criaGerente: false },
];

for (const { canal, argumentos, metodo, criaGerente } of PASSOS_DO_LOGIN_DO_TELEGRAM) {
  test(`${canal} repassa os dados ao ${metodo}, devolve a resposta dele e traduz a falha`, async () => {
    const { main, Telegram } = carregarMensageria();
    Telegram.respostas.set(metodo, { success: true, de: metodo });
    if (criaGerente) {
      assert.deepStrictEqual(await main.invocar(canal, argumentos), { success: true, de: metodo });
      assert.strictEqual(Telegram.criados.length, 1);
      assert.strictEqual(Telegram.criados[0].janela, main.janelaPrincipal);
      assert.deepStrictEqual(Telegram.criados[0].chamadas, [[metodo, argumentos]]);
      assert.deepStrictEqual(await main.invocar(canal, argumentos), { success: true, de: metodo });
      assert.strictEqual(Telegram.criados.length, 1);
      assert.deepStrictEqual(Telegram.criados[0].chamadas.slice(1), [['updateMainWindow', main.janelaPrincipal], [metodo, argumentos]]);
    } else {
      assert.deepStrictEqual(await main.invocar(canal, argumentos), { success: false, error: 'Telegram Manager not initialized' });
      assert.strictEqual(Telegram.criados.length, 0);
      await main.invocar('telegram-init');
      assert.deepStrictEqual(await main.invocar(canal, argumentos), { success: true, de: metodo });
      assert.deepStrictEqual(Telegram.criados[0].chamadas.at(-1), [metodo, argumentos]);
    }
    Telegram.falhas.set(metodo, new Error('o telegram recusou'));
    assert.deepStrictEqual(await main.invocar(canal, argumentos), { success: false, error: 'o telegram recusou' });
  });
}

test('telegram-logout: sem gerente responde sucesso sem estado; com gerente sai e devolve o estado; se sair falha, devolve o erro', async () => {
  const { main, Telegram } = carregarMensageria();
  assert.deepStrictEqual(await main.invocar('telegram-logout'), { success: true, state: null });
  await main.invocar('telegram-init');
  assert.deepStrictEqual(await main.invocar('telegram-logout'), { success: true, state: ESTADO_PRONTO });
  assert.deepStrictEqual(Telegram.criados[0].chamadas.slice(-2), [['logout'], ['getState']]);
  Telegram.falhas.set('logout', new Error('já saiu'));
  assert.deepStrictEqual(await main.invocar('telegram-logout'), { success: false, error: 'já saiu' });
});

test('telegram-send-reply repassa a assinatura (falsa por padrão) e traduz as falhas', async () => {
  const { main, Telegram } = carregarMensageria();
  assert.deepStrictEqual(await main.invocar('telegram-send-reply', { chatId: 'c', message: 'm' }), { success: false, error: 'Telegram Manager not initialized' });
  await main.invocar('telegram-init');
  const [gerente] = Telegram.criados;
  Telegram.respostas.set('sendReply', true);
  assert.deepStrictEqual(await main.invocar('telegram-send-reply', { chatId: 'c1', message: 'oi' }), { success: true });
  assert.deepStrictEqual(await main.invocar('telegram-send-reply', { chatId: 'c2', message: 'oi', removeSignature: true }), { success: true });
  assert.deepStrictEqual(gerente.chamadas.slice(-2), [['sendReply', 'c1', 'oi', false], ['sendReply', 'c2', 'oi', true]]);
  Telegram.respostas.set('sendReply', false);
  assert.deepStrictEqual(await main.invocar('telegram-send-reply', { chatId: 'c', message: 'm' }), { success: false, error: 'Telegram client is not ready or message failed to send.' });
  Telegram.falhas.set('sendReply', new Error('rede caiu'));
  assert.deepStrictEqual(await main.invocar('telegram-send-reply', { chatId: 'c', message: 'm' }), { success: false, error: 'rede caiu' });
});

test('os canais que desmontam o argumento na assinatura rejeitam a chamada sem argumento, e os de leitura não precisam dele', async () => {
  const { main } = carregarMensageria();
  const desmontam = [
    'whatsapp-send-reply', 'telegram-send-otp', 'telegram-send-qr', 'telegram-submit-code', 'telegram-submit-password',
    'telegram-send-reply', 'remote-access-broadcast-response',
  ];
  for (const canal of desmontam) await assert.rejects(main.invocar(canal), { name: 'TypeError' }, canal);
  for (const canal of ['whatsapp-get-state', 'telegram-get-state', 'whatsapp-logout', 'telegram-logout', 'remote-access-broadcast-thinking']) {
    await assert.doesNotReject(main.invocar(canal), canal);
  }
});

test('sem o serviço de acesso remoto os cinco canais respondem o que respondem hoje', async () => {
  const { main } = carregarMensageria();
  assert.deepStrictEqual(await main.invocar('remote-access-status'), { isRunning: false });
  const parado = { success: false, error: 'Remote Access Service not running' };
  assert.deepStrictEqual(await main.invocar('remote-access-regenerate'), parado);
  assert.deepStrictEqual(await main.invocar('remote-access-restart-tunnel'), parado);
  assert.strictEqual(await main.invocar('remote-access-broadcast-response', { message: 'm', timestamp: 1 }), undefined);
  assert.strictEqual(await main.invocar('remote-access-broadcast-thinking'), undefined);
});

test('o serviço de acesso remoto nasce na abertura, recebe o app e repassa os eventos do celular à janela', () => {
  const { main, servico } = carregarComServicoRemoto();
  assert.deepStrictEqual(servico.chamadas.map(([nome]) => nome), ['setDesktopCallback', 'start']);
  const [, aoReceber] = servico.chamadas[0];
  main.janelaPrincipal.enviados.length = 0;
  aoReceber('mensagem', { texto: 'oi' });
  assert.deepStrictEqual(main.janelaPrincipal.enviados, [['remote-mobile-event', { event: 'mensagem', data: { texto: 'oi' } }]]);
});

test('remote-access-status usa o primeiro token ativo, ou cria o "Default Mobile", e junta o QR ao estado', async () => {
  const { main, servico } = carregarComServicoRemoto();
  servico.chamadas.length = 0;
  assert.deepStrictEqual(await main.invocar('remote-access-status'), {
    isRunning: true, port: 4100, activeToken: 'token-1', qrCode: 'qr-de-token-1', directUrl: 'https://tunel.example.com/?t=token-1',
  });
  assert.deepStrictEqual(servico.chamadas, [
    ['getStatus'], ['generateToken', 'Default Mobile'], ['generateQRCode', 'token-1'],
  ]);

  servico.chamadas.length = 0;
  servico.tokens.set('inativo', { token: 'inativo', active: false });
  servico.tokens.set('segundo', { token: 'segundo', active: true });
  const resposta = await main.invocar('remote-access-status');
  assert.strictEqual(resposta.activeToken, 'token-1');
  assert.deepStrictEqual(servico.chamadas, [['getStatus'], ['generateQRCode', 'token-1']]);
});

test('remote-access-status e regenerate deixam o QR e o endereço nulos quando o QR falha, e a ordem das chaves decide quem ganha', async () => {
  const { main, servico } = carregarComServicoRemoto();
  servico.qr = () => ({ success: false });
  assert.deepStrictEqual(await main.invocar('remote-access-status'), {
    isRunning: true, port: 4100, activeToken: 'token-1', qrCode: null, directUrl: null,
  });
  servico.qr = (token) => ({ success: true, qrCode: `qr-de-${token}`, directUrl: 'https://tunel.example.com/direto' });
  servico.status = { isRunning: true, qrCode: 'qr-do-estado', activeToken: 'token-do-estado', success: 'do-estado' };
  const status = await main.invocar('remote-access-status');
  assert.deepStrictEqual(status, { isRunning: true, qrCode: 'qr-de-token-1', directUrl: 'https://tunel.example.com/direto', activeToken: 'token-1', success: 'do-estado' });
  const regenerada = await main.invocar('remote-access-regenerate');
  assert.deepStrictEqual(regenerada, {
    success: 'do-estado', isRunning: true, activeToken: 'token-do-estado', qrCode: 'qr-do-estado', directUrl: 'https://tunel.example.com/direto',
  });
});

test('remote-access-regenerate revoga todos os tokens, cria um novo e devolve o QR dele', async () => {
  const { main, servico } = carregarComServicoRemoto();
  await main.invocar('remote-access-status');
  servico.chamadas.length = 0;
  assert.deepStrictEqual(await main.invocar('remote-access-regenerate'), {
    success: true, activeToken: 'token-2', qrCode: 'qr-de-token-2', directUrl: 'https://tunel.example.com/?t=token-2', isRunning: true, port: 4100,
  });
  assert.deepStrictEqual(servico.chamadas, [
    ['revogarTodosOsTokens'], ['generateToken', 'Default Mobile'], ['getStatus'], ['generateQRCode', 'token-2'],
  ]);
  assert.deepStrictEqual([...servico.tokens.keys()], ['token-2']);
  servico.qr = () => ({ success: false });
  const semQr = await main.invocar('remote-access-regenerate');
  assert.deepStrictEqual([semQr.qrCode, semQr.directUrl], [null, null]);
});

test('remote-access-restart-tunnel zera o endereço, sobe o túnel, espera até 20 vezes meio segundo e devolve o estado com o QR', async (t) => {
  const { main, servico } = carregarComServicoRemoto();
  await main.invocar('remote-access-status');
  servico.chamadas.length = 0;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  servico.startCloudflaredTunnel = async () => {
    servico.chamadas.push(['startCloudflaredTunnel', servico.publicUrl]);
    setTimeout(() => { servico.publicUrl = 'https://novo.example.com'; }, 1200);
  };
  const { resposta, passos } = await avancarRelogioAteTerminar(t, main.invocar('remote-access-restart-tunnel'));
  assert.strictEqual(passos, 3);
  assert.deepStrictEqual(resposta, {
    success: true, activeToken: 'token-1', qrCode: 'qr-de-token-1', directUrl: 'https://tunel.example.com/?t=token-1', isRunning: true, port: 4100,
  });
  assert.deepStrictEqual(servico.chamadas, [['startCloudflaredTunnel', null], ['getStatus'], ['generateQRCode', 'token-1']]);
  assert.strictEqual(servico.publicUrl, 'https://novo.example.com');
});

test('remote-access-restart-tunnel desiste de esperar depois de 20 tentativas e, sem token ativo, não gera QR nem token', async (t) => {
  const { main, servico } = carregarComServicoRemoto();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  servico.startCloudflaredTunnel = async () => {};
  const { resposta, passos } = await avancarRelogioAteTerminar(t, main.invocar('remote-access-restart-tunnel'));
  assert.strictEqual(passos, 20);
  assert.deepStrictEqual(resposta, { success: true, activeToken: null, qrCode: null, directUrl: null, isRunning: true, port: 4100 });
  assert.deepStrictEqual(servico.chamadas.map(([nome]) => nome).filter((nome) => /token|QR/i.test(nome)), []);
  assert.strictEqual(servico.publicUrl, null);
});

test('remote-access-restart-tunnel devolve o erro de quem falha ao subir o túnel', async () => {
  const { main, servico } = carregarComServicoRemoto();
  servico.falhaNoTunel = new Error('cloudflared ausente');
  assert.deepStrictEqual(await main.invocar('remote-access-restart-tunnel'), { success: false, error: 'cloudflared ausente' });
});

test('os dois broadcast mandam a resposta e o "pensando" ao celular e não devolvem nada', async () => {
  const { main, servico } = carregarComServicoRemoto();
  servico.chamadas.length = 0;
  assert.strictEqual(await main.invocar('remote-access-broadcast-response', { message: 'olá', timestamp: 99 }), undefined);
  assert.strictEqual(await main.invocar('remote-access-broadcast-thinking'), undefined);
  assert.deepStrictEqual(servico.chamadas, [['broadcastToMobile', 'ai-response', { message: 'olá', timestamp: 99 }], ['broadcastToMobile', 'ai-thinking']]);
});

function carregarComDesligamento(opcoes = {}) {
  const desligamento = { aoSair: null, extras: [] };
  const servico = servicoDeAcessoRemoto();
  const modulos = {
    './services/remote-access': function ServicoDeAcessoRemoto() { return servico; },
    './services/nova-shutdown': {
      registerShutdown: (app, aoSair) => { desligamento.aoSair = aoSair; return () => false; },
      createWindowsProcessCleanup: () => ({}),
      createProcessCleanup: () => ({}),
    },
    './services/nova-desktop-parity': {
      menuTemplate: () => [],
      guardBeforeQuit: () => {},
      extraShutdownTasks: (dependencias) => { desligamento.extras.push(dependencias); return []; },
      runShutdownTasks: async (tarefas) => { for (const tarefa of tarefas) await tarefa(); },
    },
  };
  const { temporizadores, ...resto } = comPlataforma('win32', () => carregarComArranqueCompleto({ ...opcoes, modulos: { ...opcoes.modulos, ...modulos } }));
  return { ...resto, temporizadores, desligamento, servico };
}

function carregarMensageriaComDesligamento() {
  const WhatsApp = classeDeGerente(METODOS_DO_WHATSAPP);
  const Telegram = classeDeGerente(METODOS_DO_TELEGRAM);
  const carregado = carregarComDesligamento({ modulos: { './services/whatsapp-manager': WhatsApp, './services/telegram-manager': Telegram } });
  return { ...carregado, WhatsApp, Telegram };
}

test('o gerente que whatsapp-init criou é o mesmo que o desligamento encerra, e depois dele o estado volta a desconectado', async () => {
  const { main, desligamento, servico, WhatsApp } = carregarMensageriaComDesligamento();
  await main.invocar('whatsapp-init');
  assert.strictEqual(WhatsApp.criados.length, 1);
  await desligamento.aoSair();
  assert.deepStrictEqual(WhatsApp.criados[0].chamadas.at(-1), ['shutdown']);
  assert.deepStrictEqual(servico.chamadas.at(-1), ['stop']);
  assert.deepStrictEqual(await main.invocar('whatsapp-get-state'), ESTADO_SEM_WHATSAPP);
  assert.deepStrictEqual(await main.invocar('remote-access-status'), { isRunning: false });
  await main.invocar('whatsapp-init');
  assert.strictEqual(WhatsApp.criados.length, 2);
});

test('o gerente que telegram-init criou é o que o desligamento entrega como getTelegram, e o desligamento não o apaga', async () => {
  const { main, desligamento, Telegram } = carregarMensageriaComDesligamento();
  await main.invocar('telegram-init');
  await desligamento.aoSair();
  const [dependencias] = desligamento.extras;
  assert.strictEqual(dependencias.getTelegram(), Telegram.criados[0]);
  assert.deepStrictEqual(await main.invocar('telegram-get-state'), ESTADO_PRONTO);
});

test('a conexão automática da abertura usa o gerente que o canal já criou, e o canal usa o que ela criou', async () => {
  const { main, temporizadores, WhatsApp, Telegram } = carregarMensageriaComDesligamento();
  const na = (espera) => temporizadores.filter((t) => t.tipo === 'timeout' && t.espera === espera);
  escreverJson(main, 'whatsapp_settings.json', { autoConnect: true });
  assert.strictEqual(na(5000).length, 1);
  assert.strictEqual(na(6000).length, 1);

  await main.invocar('telegram-init');
  await na(6000)[0].funcao();
  assert.strictEqual(Telegram.criados.length, 1);
  assert.deepStrictEqual(Telegram.criados[0].chamadas.slice(-2), [['updateMainWindow', main.janelaPrincipal], ['autoConnect']]);

  await na(5000)[0].funcao();
  assert.strictEqual(WhatsApp.criados.length, 1);
  assert.deepStrictEqual(WhatsApp.criados[0].chamadas, [['initialize']]);
  assert.deepStrictEqual(await main.invocar('whatsapp-init'), { success: true, state: ESTADO_PRONTO });
  assert.strictEqual(WhatsApp.criados.length, 1);
  assert.deepStrictEqual(WhatsApp.criados[0].chamadas.slice(1), [['updateMainWindow', main.janelaPrincipal], ['initialize'], ['getState']]);
});
