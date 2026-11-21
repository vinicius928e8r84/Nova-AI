'use strict';
const { chamar, voltas, estadoDoGerente } = require('./whatsapp-manager.palco');

const DONO = 'eu@c.us';
const AMIGO = 'amigo@c.us';
const GRUPO = 'turma@g.us';
function mensagem(roteiro, campos = {}) {
  roteiro.mensagens = (roteiro.mensagens || 0) + 1;
  return {
    body: 'oi', from: AMIGO, to: DONO, fromMe: false, timestamp: 1234, id: { _serialized: `m${roteiro.mensagens}` },
    downloadMedia: async () => {
      roteiro.anotar('msg.downloadMedia');
      roteiro.falhar('downloadMedia');
      return roteiro.cena.midia;
    },
    getChat: async () => {
      roteiro.anotar('msg.getChat');
      roteiro.falhar('getChat');
      return { name: 'Conversa' };
    },
    getContact: async () => {
      roteiro.anotar('msg.getContact');
      return roteiro.cena.contato;
    },
    ...campos,
  };
}

const doDono = (roteiro, body, campos = {}) => mensagem(roteiro, { body, from: DONO, to: DONO, fromMe: true, ...campos });

async function conectar(gerente, roteiro) {
  const inicio = chamar(roteiro, 'initialize', () => gerente.initialize());
  await voltas();
  roteiro.cliente.emit('ready');
  await inicio;
  roteiro.anotar('conectado', estadoDoGerente(gerente));
}

async function receber(gerente, roteiro, msg, evento = 'message') {
  roteiro.cliente.emit(evento, msg);
  await roteiro.avancar(6000);
}

function conectadoERecebe(...fabricas) {
  return async (gerente, roteiro) => {
    await conectar(gerente, roteiro);
    for (const fabrica of fabricas) await receber(gerente, roteiro, fabrica(roteiro));
  };
}

const comandos = (...textos) => conectadoERecebe(...textos.map(texto => roteiro => doDono(roteiro, texto)));

function cena(nome, montagem, passos) {
  return { nome, ...montagem, passos };
}

const CENAS_DA_CONEXAO = [
  cena('estado inicial', {}, (gerente, roteiro) => roteiro.anotar('getState', gerente.getState())),
  cena('inicializa, mostra o QR e conecta', { pastas: ['/dados/userData/.wwebjs_auth'] }, async (gerente, roteiro) => {
    const inicio = chamar(roteiro, 'initialize', () => gerente.initialize());
    await voltas();
    roteiro.cliente.emit('qr', 'QR1');
    roteiro.cliente.emit('qr', 'QR1');
    roteiro.cliente.emit('loading_screen', 50, 'carregando');
    roteiro.cliente.emit('authenticated');
    roteiro.cliente.emit('ready');
    roteiro.cliente.emit('remote_session_saved');
    await inicio;
    await chamar(roteiro, 'initialize conectado', () => gerente.initialize());
  }),
  cena('QR que não vira imagem', { falhas: { qrcode: 'sem canvas' } }, async (gerente, roteiro) => {
    const inicio = chamar(roteiro, 'initialize', () => gerente.initialize());
    await voltas();
    roteiro.cliente.emit('qr', 'QR2');
    await inicio;
  }),
  cena('inicializar duas vezes ao mesmo tempo', { inicializacoes: ['pendurado'] }, async (gerente, roteiro) => {
    chamar(roteiro, 'initialize', () => gerente.initialize());
    await voltas();
    await chamar(roteiro, 'initialize de novo', () => gerente.initialize());
    gerente.clearAllTimers();
  }),
  cena('cliente sem pronto é refeito', { inicializacoes: ['ok'] }, async (gerente, roteiro) => {
    await chamar(roteiro, 'initialize', () => gerente.initialize());
    gerente.isInitializing = false;
    await chamar(roteiro, 'initialize com cliente sem pronto', () => gerente.initialize({ isReconnect: true }));
    gerente.clearAllTimers();
  }),
  cena('navegador do ambiente no Windows', { plataforma: 'win32', ambiente: { PUPPETEER_EXECUTABLE_PATH: 'C:\\meu\\chrome.exe' }, arquivos: { 'C:\\meu\\chrome.exe': '' } },
    async (gerente, roteiro) => {
      await chamar(roteiro, 'initialize', () => gerente.initialize());
      gerente.clearAllTimers();
    }),
  cena('erro de perfil travado recupera e reagenda', { inicializacoes: [new Error('The browser is already running for /x'), 'pendurado'] }, async (gerente, roteiro) => {
    const inicio = chamar(roteiro, 'initialize', () => gerente.initialize());
    await roteiro.avancar(1300);
    await inicio;
    await roteiro.avancar(2100);
    gerente.clearAllTimers();
  }),
  cena('erro de SingletonLock e de userDataDir', { inicializacoes: [new Error('SingletonLock'), new Error('bad userDataDir'), 'pendurado'] }, async (gerente, roteiro) => {
    const inicio = chamar(roteiro, 'initialize', () => gerente.initialize());
    await roteiro.avancar(1300);
    await inicio;
    await roteiro.avancar(3300);
    await roteiro.avancar(4100);
    gerente.clearAllTimers();
  }),
  cena('erro comum destrói e reagenda com espera crescente', { inicializacoes: [new Error('net::ERR'), new Error(''), 'x'] }, async (gerente, roteiro) => {
    await chamar(roteiro, 'initialize', () => gerente.initialize());
    await roteiro.avancar(2100);
    await roteiro.avancar(4100);
    gerente.clearAllTimers();
  }),
  cena('erro de um cliente antigo é ignorado', {}, async (gerente, roteiro) => {
    let rejeitar = null;
    roteiro.inicializacoes = [() => new Promise((_, rejeita) => { rejeitar = rejeita; }), 'pendurado'];
    const primeira = chamar(roteiro, 'initialize', () => gerente.initialize());
    await voltas();
    gerente.client = null;
    gerente.isInitializing = false;
    chamar(roteiro, 'initialize nova', () => gerente.initialize());
    await voltas();
    rejeitar(new Error('tarde'));
    await primeira;
    gerente.clearAllTimers();
  }),
  cena('tempo de inicialização esgota', { inicializacoes: ['pendurado'] }, async (gerente, roteiro) => {
    chamar(roteiro, 'initialize', () => gerente.initialize());
    await roteiro.avancar(60000);
    await roteiro.avancar(10);
    gerente.clearAllTimers();
  }),
  cena('limite de reconexões avisa', { plataforma: 'darwin' }, async (gerente, roteiro) => {
    gerente.reconnectAttempts = gerente.maxReconnectAttempts;
    gerente.scheduleReconnect('teste');
    await voltas();
    gerente.reconnectAttempts = 7;
    gerente.scheduleReconnect();
    gerente.scheduleReconnect('já agendado');
    gerente.clearAllTimers();
    gerente.manualLogout = true;
    gerente.scheduleReconnect('logout');
  }),
  cena('falha de autenticação e desconexão', {}, async (gerente, roteiro) => {
    await conectar(gerente, roteiro);
    roteiro.cliente.emit('auth_failure', 'sessão inválida');
    await voltas();
    gerente.clearAllTimers();
    await conectar(gerente, roteiro);
    roteiro.cliente.emit('disconnected', 'LOGOUT');
    await voltas();
    gerente.clearAllTimers();
    await conectar(gerente, roteiro);
    roteiro.cliente.emit('disconnected');
    await voltas();
    gerente.clearAllTimers();
  }),
  cena('pronto sem info usa Boss', { info: null }, conectar),
  cena('destruir com falhas', { falhas: { removeAllListeners: 'x', logout: 'sem rede', destroy: new Error('já fechado') } }, async (gerente, roteiro) => {
    await conectar(gerente, roteiro);
    await chamar(roteiro, 'logout', () => gerente.logout());
    await chamar(roteiro, 'destroy sem cliente', () => gerente.destroyClient());
  }),
  cena('logout e shutdown', {}, async (gerente, roteiro) => {
    await conectar(gerente, roteiro);
    await chamar(roteiro, 'logout', () => gerente.logout());
    await conectar(gerente, roteiro);
    await chamar(roteiro, 'shutdown', () => gerente.shutdown());
    gerente.destroying = true;
    gerente.client = roteiro.cliente;
    await chamar(roteiro, 'destroy destruindo', () => gerente.destroyClient());
  }),
];

const CENAS_DO_SISTEMA = [
  cena('travas do perfil e processos no Linux', { arquivos: { '/dados/userData/.wwebjs_auth/session-nova-desktop-client/SingletonLock': '', '/dados/userData/.wwebjs_auth/session-nova-desktop-client/DevToolsActivePort': '' }, falhas: {} },
    async (gerente, roteiro) => {
      gerente.clearSessionProfileLocks();
      roteiro.falhas.unlinkSync = 'EPERM';
      gerente.clearSessionProfileLocks();
      gerente.killSessionBrowserProcesses();
      gerente.ensureRuntimeDirectories();
    }),
  cena('processos no Mac e no Windows', { plataforma: 'darwin' }, (gerente, roteiro) => {
    gerente.killSessionBrowserProcesses();
    roteiro.falhas.spawnSync = 'sem pkill';
    gerente.killSessionBrowserProcesses();
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    gerente.killSessionBrowserProcesses();
    roteiro.falhas.spawnSync = '';
    gerente.killSessionBrowserProcesses();
  }),
  cena('recupera de perfil travado', {}, async (gerente, roteiro) => {
    const recuperacao = chamar(roteiro, 'recoverFromProfileLock', () => gerente.recoverFromProfileLock('travado'));
    await roteiro.avancar(1200);
    await recuperacao;
  }),
  cena('navegador no Windows: pastas, chromium e padrão', {
    plataforma: 'win32', resourcesPath: '/res',
    pastas: ['/res/browsers', '/dados/userData/browsers'],
    subpastas: { '/res/browsers': [['chromium-999', true], ['chromium-1300', true], ['chromium-x.txt', false], ['firefox', true]] },
    arquivos: { '/res/browsers/chromium-999/chrome-win64/chrome.exe': '' },
  }, (gerente, roteiro) => {
    roteiro.anotar('resolveBrowserExecutable', gerente.resolveBrowserExecutable());
    roteiro.falhas.readdirSync = 'EACCES';
    delete roteiro.arquivos['/res/browsers/chromium-999/chrome-win64/chrome.exe'];
    roteiro.anotar('sem nada', gerente.resolveBrowserExecutable());
    roteiro.arquivos['C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'] = '';
    roteiro.anotar('edge', gerente.resolveBrowserExecutable());
  }),
  cena('navegador no Mac', { plataforma: 'darwin', ambiente: { PUPPETEER_EXECUTABLE_PATH: '/nao/existe' }, navegadoresDoMac: { edge: '/Edge' } }, (gerente, roteiro) => {
    roteiro.anotar('resolveBrowserExecutable', gerente.resolveBrowserExecutable());
    roteiro.arquivos['/nao/existe'] = '';
    roteiro.anotar('do ambiente', gerente.resolveBrowserExecutable());
  }),
];

const CENAS_DAS_MENSAGENS = [
  cena('mensagem de outra pessoa vai para a janela', {}, conectadoERecebe(r => mensagem(r, { body: '  Olá Nova  ' }))),
  cena('mensagem nula e message_create de outro', {}, async (gerente, roteiro) => {
    await conectar(gerente, roteiro);
    await chamar(roteiro, 'handleIncomingMessage nula', () => gerente.handleIncomingMessage(null));
    await receber(gerente, roteiro, mensagem(roteiro), 'message_create');
    await receber(gerente, roteiro, doDono(roteiro, 'pelo create'), 'message_create');
  }),
  cena('repetidas por id e por texto', {}, async (gerente, roteiro) => {
    await conectar(gerente, roteiro);
    const msg = mensagem(roteiro, { body: 'igual' });
    roteiro.cliente.emit('message', msg);
    roteiro.cliente.emit('message', msg);
    roteiro.cliente.emit('message', mensagem(roteiro, { body: 'igual' }));
    roteiro.cliente.emit('message', mensagem(roteiro, { body: 'igual', id: undefined }));
    await roteiro.avancar(4500);
    roteiro.cliente.emit('message', mensagem(roteiro, { body: 'igual', id: undefined }));
    await roteiro.avancar(1500);
    roteiro.cliente.emit('message', mensagem(roteiro, { body: 'igual', id: undefined }));
    await roteiro.avancar(6000);
  }),
  cena('marcas do robô, eco para convidado e corpo vazio', {}, conectadoERecebe(
    r => mensagem(r, { body: `x ${'[NOVA_AI_BOT]'}` }), r => mensagem(r, { body: 'robô 🤖' }), r => mensagem(r, { body: 'a\u200Bb' }),
    r => mensagem(r, { fromMe: true, from: DONO, to: AMIGO, body: 'resposta minha' }), r => mensagem(r, { body: '   ' }), r => mensagem(r, { body: undefined, from: undefined, to: undefined }),
  )),
  cena('voz transcrita vira texto', { midia: { data: 'b2dn' }, ambiente: { GROQ_API_KEY: 'gsk_env' }, transcricao: { data: { text: '  fala transcrita  ' } } },
    conectadoERecebe(r => mensagem(r, { hasMedia: true, type: 'ptt', body: '' }))),
  cena('voz com chave do arquivo e transcrição vazia', { midia: { data: 'b2dn' }, arquivos: { '/dados/userData/groq_key.json': '{"apiKey":"gsk_arquivo"}' }, transcricao: { data: { text: '' } } },
    conectadoERecebe(r => mensagem(r, { hasMedia: true, type: 'audio', body: 'legenda' }))),
  cena('voz sem chave, sem mídia e com erro', { midia: { data: 'b2dn' }, arquivos: { '/dados/userData/groq_key.json': '{}' } }, async (gerente, roteiro) => {
    await conectar(gerente, roteiro);
    await receber(gerente, roteiro, mensagem(roteiro, { hasMedia: true, type: 'ptt', body: 'a' }));
    roteiro.cena.midia = {};
    await receber(gerente, roteiro, mensagem(roteiro, { hasMedia: true, type: 'ptt', body: 'b' }));
    roteiro.falhas.downloadMedia = 'mídia expirou';
    await receber(gerente, roteiro, mensagem(roteiro, { hasMedia: true, type: 'audio', body: 'c' }));
    await receber(gerente, roteiro, mensagem(roteiro, { hasMedia: true, type: 'image', body: 'foto' }));
  }),
  cena('transcrição com erro da API', { ambiente: { GROQ_API_KEY: 'k' }, falhas: { axios: Object.assign(new Error('401'), { response: { data: { error: 'chave' } } }) } }, async (gerente, roteiro) => {
    await chamar(roteiro, 'transcribeAudio', () => gerente.transcribeAudio('b2dn'));
    roteiro.falhas.axios = new Error('timeout');
    await chamar(roteiro, 'transcribeAudio sem resposta', () => gerente.transcribeAudio('b2dn'));
    roteiro.falhas.axios = null;
    roteiro.cena.transcricao = null;
    await chamar(roteiro, 'transcribeAudio sem dados', () => gerente.transcribeAudio('b2dn'));
  }),
  cena('dono trava o PC no Windows', { plataforma: 'win32' }, comandos('!lock', 'LOCK PC', 'laptop band karo', 'lock laptop')),
  cena('dono trava o Mac', { plataforma: 'darwin' }, async (gerente, roteiro) => {
    await comandos('computer lock')(gerente, roteiro);
    roteiro.falhas['macNative.run'] = 'sem CGSession';
    await receber(gerente, roteiro, doDono(roteiro, 'system lock'));
  }),
  cena('dono abre o navegador', {}, comandos('!browser exemplo.com', '!BROWSER   https://a.b/c  ', '!browser http')),
  cena('dono pede o status do sistema', {}, comandos('!sysinfo', 'sysinfo', '!status')),
  cena('dono liga e desliga o modo ocupado', { arquivos: { '/dados/userData/whatsapp_settings.json': '{"outro":1,"busyStatus":"velho"}' } }, comandos('!busy on', '!busy off')),
  cena('dono escolhe status pronto e personalizado', {}, comandos('!busy driving', '!busy Sleep', '!busy em reunião longa', '!busy abc', '!busy constructor')),
  cena('salvar status com janela destruída e falha de escrita', { janela: 'destruida', falhas: { writeFileSync: 'disco cheio' } }, comandos('!busy travel', '!busy on')),
  cena('dono pede captura de tela', {}, comandos('!ss', 'manda screen lo agora', 'PC SCREEN dikhao')),
  cena('captura de tela falha e avisa', { falhas: { screenshot: 'sem tela' } }, comandos('take ss')),
  cena('captura de tela falha e o aviso também', { falhas: { screenshot: 'sem tela', sendMessage: 'offline' } }, comandos('screenshot')),
  cena('captura sem id enviado e sem cliente pronto', { semIdEnviado: true }, async (gerente, roteiro) => {
    await comandos('capture screen')(gerente, roteiro);
    gerente.isReady = false;
    await chamar(roteiro, 'handleScreenshotCommand', () => gerente.handleScreenshotCommand(DONO));
  }),
  cena('dono manda texto comum', {}, comandos('lembrar de comprar pão')),
  cena('grupo com menção, urgência e conversa', {}, conectadoERecebe(
    r => mensagem(r, { from: GRUPO, body: 'ana, olha isso' }), r => mensagem(r, { from: GRUPO, body: 'Reunião sobre PAYMENT' }),
    r => mensagem(r, { from: AMIGO, to: GRUPO, body: 'bom dia' }), r => doDono(r, '!lock', { from: GRUPO, to: GRUPO }),
  )),
  cena('urgente de contato com nome, apelido, conversa e ninguém', { contato: { name: 'Bia' } }, async (gerente, roteiro) => {
    await conectar(gerente, roteiro);
    await receber(gerente, roteiro, mensagem(roteiro, { body: 'URGENT preciso de ajuda com uma coisa muito longa que passa de cinquenta' }));
    roteiro.cena.contato = { pushname: 'bia123' };
    await receber(gerente, roteiro, mensagem(roteiro, { body: 'me liga, call me' }));
    roteiro.cena.contato = null;
    await receber(gerente, roteiro, mensagem(roteiro, { body: 'jaldi' }));
    roteiro.falhas.getChat = 'sem conversa';
    await receber(gerente, roteiro, mensagem(roteiro, { body: 'zaroori' }));
  }),
  cena('modo ocupado só registra', {}, async (gerente, roteiro) => {
    await conectar(gerente, roteiro);
    gerente.busyModeEnabled = true;
    await receber(gerente, roteiro, mensagem(roteiro, { body: 'tá aí?' }));
  }),
];

const CENAS_DO_ENVIO = [
  cena('sendReply e sendToOwner', {}, async (gerente, roteiro) => {
    await chamar(roteiro, 'sendReply sem cliente', () => gerente.sendReply(AMIGO, 'oi'));
    await chamar(roteiro, 'sendToOwner sem cliente', () => gerente.sendToOwner('oi'));
    await conectar(gerente, roteiro);
    await chamar(roteiro, 'sendReply self', () => gerente.sendReply('self', 'oi'));
    await chamar(roteiro, 'sendReply vazio', () => gerente.sendReply(` ${AMIGO} `, '   '));
    await chamar(roteiro, 'sendReply sem chat', () => gerente.sendReply(null, 'oi'));
    await chamar(roteiro, 'sendReply com assinatura', () => gerente.sendReply(AMIGO, ' oi '));
    await chamar(roteiro, 'sendReply sem assinatura', () => gerente.sendReply(AMIGO, 'oi', true));
    await chamar(roteiro, 'sendToOwner', () => gerente.sendToOwner('aviso'));
    await roteiro.avancar(130000);
    roteiro.falhas.sendMessage = 'offline';
    await chamar(roteiro, 'sendReply com erro', () => gerente.sendReply(AMIGO, 'oi'));
    await chamar(roteiro, 'sendToOwner com erro', () => gerente.sendToOwner('aviso'));
  }),
  cena('sendReply sem id enviado', { semIdEnviado: true }, async (gerente, roteiro) => {
    await conectar(gerente, roteiro);
    await chamar(roteiro, 'sendReply', () => gerente.sendReply(AMIGO, 'oi'));
  }),
  cena('resposta com digitação humana', {}, async (gerente, roteiro) => {
    await chamar(roteiro, 'sem cliente', () => gerente.sendReplyWithMimicry(AMIGO, 'oi'));
    await conectar(gerente, roteiro);
    await chamar(roteiro, 'sem chat', () => gerente.sendReplyWithMimicry('  ', 'oi'));
    const curta = chamar(roteiro, 'curta com assinatura', () => gerente.sendReplyWithMimicry(AMIGO, 'oi'));
    await roteiro.avancar(1749);
    roteiro.anotar('ainda esperando', roteiro.relogio.fila.length);
    await roteiro.avancar(1001);
    await curta;
    const longa = chamar(roteiro, 'longa sem assinatura', () => gerente.sendReplyWithMimicry(AMIGO, 'x'.repeat(300), false));
    await roteiro.avancar(1750 + 3990);
    roteiro.anotar('longa ainda digitando', roteiro.relogio.fila.length);
    await roteiro.avancar(260);
    await longa;
    const media = chamar(roteiro, 'média', () => gerente.sendReplyWithMimicry(AMIGO, 'y'.repeat(100)));
    await roteiro.avancar(6000);
    await media;
    roteiro.falhas.getChatById = 'chat sumiu';
    await chamar(roteiro, 'com erro', () => gerente.sendReplyWithMimicry(AMIGO, 'oi'));
  }),
  cena('janela ausente, destruída e com erro', { janela: false }, async (gerente, roteiro) => {
    gerente.sendToFrontend('teste', { a: 1 });
    gerente.updateMainWindow({ isDestroyed: () => true });
    gerente.sendToFrontend('teste', { a: 2 });
    gerente.updateMainWindow({ isDestroyed: () => false, webContents: { send: () => { throw new Error('ipc fechado'); } } });
    gerente.sendToFrontend('teste', { a: 3 });
    gerente.setStatus('x', { reason: 'r', extra: 1 });
    roteiro.anotar('getState', gerente.getState());
  }),
];

const CENAS = [...CENAS_DA_CONEXAO, ...CENAS_DO_SISTEMA, ...CENAS_DAS_MENSAGENS, ...CENAS_DO_ENVIO];

module.exports = { CENAS };
