'use strict';
const { mensagem } = require('./whatsapp-manager.palco');

const MEU_ID = '5511@c.us';
const CONTATO = '5522@c.us';
const GRUPO = '1203@g.us';
const AUDIO = { data: 'YXVkaW8=' };
const esperar = () => new Promise(resolver => setImmediate(resolver));
const AVANCA_ATE_O_DEDUPE = ms => ms < 5000;

const doDono = (body, extras = {}) => mensagem({ from: MEU_ID, to: MEU_ID, fromMe: true, body, id: { _serialized: `dono-${body}` }, ...extras });
const deContato = (body, extras = {}) => mensagem({ from: CONTATO, to: MEU_ID, body, id: { _serialized: `contato-${body}` }, ...extras });
const doGrupo = (body, extras = {}) => mensagem({ from: GRUPO, to: MEU_ID, body, id: { _serialized: `grupo-${body}` }, ...extras });

function pronto(manager, ambiente) {
  manager.bossName = 'Chefe';
  ambiente.conectar(manager);
}

const recebendo = (msg, liberar) => async ({ manager, ambiente }) => {
  pronto(manager, ambiente);
  await ambiente.concluir(manager.handleIncomingMessage(msg), liberar);
};

const comMensagens = (...mensagens) => async ({ manager, ambiente }) => {
  pronto(manager, ambiente);
  for (const msg of mensagens) await ambiente.concluir(manager.handleIncomingMessage(msg), AVANCA_ATE_O_DEDUPE);
};

const CENAS_DE_MENSAGEM = [
  { nome: 'mensagem ausente não faz nada', roteiro: async ({ manager }) => { await manager.handleIncomingMessage(null); } },
  {
    nome: 'voz: o áudio vira texto pela transcrição e segue como mensagem do celular',
    ambiente: { GROQ_API_KEY: 'chave-do-ambiente' },
    respostaDaTranscricao: { text: '  oi chefe  ' },
    roteiro: recebendo(deContato('', { hasMedia: true, type: 'ptt', midia: AUDIO })),
  },
  {
    nome: 'voz: chave da Groq guardada em arquivo tem prioridade sobre a do ambiente',
    ambiente: { GROQ_API_KEY: 'chave-do-ambiente' },
    arquivos: { '/dados/userData/groq_key.json': '{"apiKey":"chave-do-arquivo"}' },
    respostaDaTranscricao: { text: 'olá' },
    roteiro: recebendo(deContato('', { hasMedia: true, type: 'audio', midia: AUDIO })),
  },
  {
    nome: 'voz: sem chave da Groq a transcrição é pulada e a mensagem vazia é ignorada',
    roteiro: recebendo(deContato('', { hasMedia: true, type: 'ptt', midia: AUDIO })),
  },
  {
    nome: 'voz: transcrição vazia avisa e a mensagem vazia é ignorada',
    ambiente: { GROQ_API_KEY: 'k' },
    respostaDaTranscricao: { text: '   ' },
    roteiro: recebendo(deContato('', { hasMedia: true, type: 'ptt', midia: AUDIO })),
  },
  {
    nome: 'voz: erro da Groq com corpo da resposta é registrado e a mensagem é ignorada',
    ambiente: { GROQ_API_KEY: 'k' },
    falhaNaTranscricao: { response: { data: { erro: 'limite' } } },
    roteiro: recebendo(deContato('', { hasMedia: true, type: 'ptt', midia: AUDIO })),
  },
  {
    nome: 'voz: falha ao baixar a mídia é registrada e a mensagem é ignorada',
    roteiro: recebendo(deContato('', { hasMedia: true, type: 'ptt', falhaNoDownload: true })),
  },
  {
    nome: 'voz: mídia sem dados não chama a transcrição',
    roteiro: recebendo(deContato('', { hasMedia: true, type: 'ptt', midia: {} })),
  },
  {
    nome: 'mensagem comum do contato vai para a interface com os campos do celular',
    roteiro: recebendo(deContato('  oi tudo bem  ')),
  },
  {
    nome: 'mensagem sem id usa o instante como id',
    roteiro: recebendo(deContato('sem id', { id: undefined })),
  },
  {
    nome: 'mesma mensagem repetida pelo id é ignorada',
    roteiro: comMensagens(deContato('repetida'), deContato('repetida')),
  },
  {
    nome: 'mesmo texto no mesmo chat com outro id é ignorado até o prazo de 5 segundos passar',
    roteiro: async ({ manager, ambiente }) => {
      pronto(manager, ambiente);
      await manager.handleIncomingMessage(deContato('de novo', { id: { _serialized: 'a' } }));
      await manager.handleIncomingMessage(deContato('de novo', { id: { _serialized: 'b' } }));
      await ambiente.liberarAlarmes(ms => ms === 5000);
      await manager.handleIncomingMessage(deContato('de novo', { id: { _serialized: 'c' } }));
    },
  },
  {
    nome: 'eco do próprio robô (assinatura, robô ou espaço invisível) é ignorado',
    roteiro: comMensagens(
      deContato('resposta [NOVA_AI_BOT]'),
      deContato('olá 🤖'),
      deContato('invisível\u200B'),
    ),
  },
  {
    nome: 'mensagem enviada por mim para outra pessoa é ignorada',
    roteiro: recebendo(mensagem({ from: MEU_ID, to: CONTATO, fromMe: true, body: 'para você', id: { _serialized: 'minha' } })),
  },
  {
    nome: 'conversa comigo mesmo sem comando de dono dispara o pulso e vai para a interface',
    roteiro: recebendo(doDono('anota aí')),
  },
  {
    nome: 'comando de trancar o computador no Windows usa o rundll32 e responde',
    plataforma: 'win32',
    roteiro: recebendo(doDono('!lock'), AVANCA_ATE_O_DEDUPE),
  },
  {
    nome: 'comando de trancar o computador no Mac usa o CGSession e responde',
    plataforma: 'darwin',
    roteiro: recebendo(doDono('Lock PC'), AVANCA_ATE_O_DEDUPE),
  },
  {
    nome: 'trancar também vale em "laptop band" e "lock"',
    roteiro: comMensagens(doDono('laptop band'), doDono('lock')),
  },
  {
    nome: 'comando de navegador completa o endereço sem protocolo e mantém o que já tem http',
    roteiro: comMensagens(doDono('!browser exemplo.com'), doDono('!browser http://local.test/x')),
  },
  {
    nome: 'comando de status mostra memória, processador e modo ocupado',
    roteiro: comMensagens(doDono('!sysinfo'), doDono('sysinfo'), doDono('!status')),
  },
  {
    nome: 'ocupado ligado e desligado grava as preferências e avisa a janela',
    arquivos: { '/dados/userData/whatsapp_settings.json': '{"outra":1}' },
    roteiro: comMensagens(doDono('!busy on'), doDono('!busy off')),
  },
  {
    nome: 'ocupado com a janela destruída grava as preferências sem avisar a janela',
    roteiro: async args => {
      args.ambiente.janela.destruida = true;
      await comMensagens(doDono('!busy on'))(args);
    },
  },
  {
    nome: 'ocupado: preset conhecido, texto livre e texto curto demais',
    roteiro: comMensagens(doDono('!busy driving'), doDono('!busy Reunião longa'), doDono('!busy ab')),
  },
  {
    nome: 'ocupado: falha ao gravar as preferências é registrada',
    arquivos: { '/dados/userData/whatsapp_settings.json': '{quebrado' },
    roteiro: comMensagens(doDono('!busy on')),
  },
  {
    nome: 'captura de tela por !ss e pelos gatilhos envia a imagem ao próprio chat',
    roteiro: async ({ manager, ambiente }) => {
      pronto(manager, ambiente);
      await manager.handleIncomingMessage(doDono('!ss'));
      await esperar();
      await manager.handleIncomingMessage(doDono('screen bhejo'));
      await esperar();
    },
  },
  {
    nome: 'captura de tela com falha avisa no chat',
    falhaNaCaptura: true,
    roteiro: async ({ manager, ambiente }) => {
      pronto(manager, ambiente);
      await manager.handleIncomingMessage(doDono('!ss'));
      await esperar();
      await esperar();
    },
  },
  {
    nome: 'captura de tela com cliente desconectado só avisa no log',
    roteiro: async ({ manager }) => {
      manager.bossName = 'Chefe';
      await manager.handleScreenshotCommand(MEU_ID);
    },
  },
  {
    nome: 'grupo: menção ao nome do dono e palavra urgente geram alerta, conversa comum não',
    roteiro: comMensagens(doGrupo('Chefe, vem cá'), doGrupo('pagamento: payment hoje'), doGrupo('bom dia pessoal')),
  },
  {
    nome: 'conversa privada urgente mostra a notificação com o nome do contato',
    roteiro: recebendo(deContato('é urgent, me liga', { contato: { name: 'Ana' }, chat: { name: 'Chat da Ana' } })),
  },
  {
    nome: 'conversa privada urgente sem nome usa o nome do chat e corta o texto longo',
    roteiro: recebendo(deContato(`emergency ${'x'.repeat(60)}`, { chat: { name: 'Chat' } })),
  },
  {
    nome: 'conversa privada urgente sem contato nem chat usa "Someone"',
    roteiro: recebendo(deContato('call me', { chat: {}, contato: {} })),
  },
  {
    nome: 'falha ao montar a notificação é registrada e a mensagem segue',
    roteiro: recebendo(deContato('jaldi', { getChat: async () => { throw new Error('sem chat'); } })),
  },
  {
    nome: 'modo ocupado ligado registra a resposta automática e segue',
    roteiro: async ({ manager, ambiente }) => {
      pronto(manager, ambiente);
      manager.busyModeEnabled = true;
      await manager.handleIncomingMessage(deContato('tem alguém aí'));
    },
  },
];

const CENAS_DE_ENVIO = [
  {
    nome: 'envio sem cliente conectado é pulado',
    roteiro: async ({ manager }) => [await manager.sendReply(CONTATO, 'oi'), await manager.sendReplyWithMimicry(CONTATO, 'oi'), await manager.sendToOwner('oi')],
  },
  {
    nome: 'envio recusa chat inválido, "self" e texto vazio',
    roteiro: async ({ manager, ambiente }) => {
      pronto(manager, ambiente);
      return [await manager.sendReply('', 'oi'), await manager.sendReply('self', 'oi'), await manager.sendReply(CONTATO, '  ')];
    },
  },
  {
    nome: 'envio com assinatura, sem assinatura e guarda o id enviado por dois minutos',
    roteiro: async ({ manager, ambiente }) => {
      pronto(manager, ambiente);
      const retornos = [await manager.sendReply(CONTATO, ' olá '), await manager.sendReply(CONTATO, 'sem assinar', true)];
      const antes = [...manager.processedMessageIds];
      await ambiente.liberarAlarmes(ms => ms === 120000);
      return { retornos, antes, depois: [...manager.processedMessageIds] };
    },
  },
  {
    nome: 'envio cuja resposta não traz id não guarda nada',
    envioSemId: true,
    roteiro: async ({ manager, ambiente }) => {
      pronto(manager, ambiente);
      return [await manager.sendReply(CONTATO, 'oi'), [...manager.processedMessageIds]];
    },
  },
  {
    nome: 'envio que falha devolve falso',
    falhaNoEnvio: true,
    roteiro: async ({ manager, ambiente }) => {
      pronto(manager, ambiente);
      return manager.sendReply(CONTATO, 'oi');
    },
  },
  {
    nome: 'envio com imitação digita antes de enviar e guarda o id',
    roteiro: async ({ manager, ambiente }) => {
      pronto(manager, ambiente);
      const retorno = await ambiente.concluir(manager.sendReplyWithMimicry(CONTATO, 'uma resposta de teste'), AVANCA_ATE_O_DEDUPE);
      return [retorno, [...manager.processedMessageIds]];
    },
  },
  {
    nome: 'envio com imitação sem assinatura, texto curto e chat vazio',
    roteiro: async ({ manager, ambiente }) => {
      pronto(manager, ambiente);
      const semAssinatura = await ambiente.concluir(manager.sendReplyWithMimicry(CONTATO, 'ok', false), AVANCA_ATE_O_DEDUPE);
      return [semAssinatura, await manager.sendReplyWithMimicry('  ', 'ok')];
    },
  },
  {
    nome: 'envio com imitação longo limita a digitação a 4 segundos e falha devolve falso',
    falhaNoEnvio: true,
    roteiro: async ({ manager, ambiente }) => {
      pronto(manager, ambiente);
      return ambiente.concluir(manager.sendReplyWithMimicry(CONTATO, 'x'.repeat(500)), AVANCA_ATE_O_DEDUPE);
    },
  },
  {
    nome: 'envio ao dono usa o próprio id e devolve falso quando falha',
    roteiro: async ({ manager, ambiente }) => {
      pronto(manager, ambiente);
      const certo = await manager.sendToOwner('aviso');
      ambiente.cena.falhaNoEnvio = true;
      return [certo, await manager.sendToOwner('aviso')];
    },
  },
];

const CENAS_DE_CONEXAO = [
  {
    nome: 'iniciar ignora quando já está iniciando e quando já está conectado',
    roteiro: async ({ manager, ambiente }) => {
      manager.isInitializing = true;
      await manager.initialize();
      manager.isInitializing = false;
      pronto(manager, ambiente);
      await manager.initialize();
      return manager.getState();
    },
  },
  {
    nome: 'iniciar monta o cliente com as opções, usa o navegador do ambiente e espera o aviso do cliente',
    ambiente: { PUPPETEER_EXECUTABLE_PATH: '/navegador/chrome' },
    arquivos: { '/navegador/chrome': 'x' },
    iniciar: 'pendente',
    roteiro: async ({ manager }) => {
      manager.initialize();
      await esperar();
      return manager.getState();
    },
  },
  {
    nome: 'iniciar derruba o cliente antigo que nunca ficou pronto e reconecta com o status certo',
    iniciar: 'pendente',
    roteiro: async ({ manager, ambiente }) => {
      ambiente.conectar(manager);
      manager.isReady = false;
      manager.reconnectAttempts = 2;
      manager.initialize({ isReconnect: true });
      await esperar();
      return manager.getState();
    },
  },
  {
    nome: 'iniciar com erro de rede marca desconectado, derruba o cliente e agenda nova tentativa',
    iniciar: new Error('net::ERR_INTERNET_DISCONNECTED'),
    roteiro: async ({ manager }) => {
      await manager.initialize();
      return manager.getState();
    },
  },
  {
    nome: 'iniciar com erro de mensagem vazia usa o nome do erro como motivo',
    iniciar: Object.assign(new Error(''), { message: '' }),
    roteiro: async ({ manager }) => {
      await manager.initialize();
      return manager.getState();
    },
  },
  {
    nome: 'iniciar com perfil travado no Windows mata o navegador, limpa os arquivos de trava e reconecta',
    plataforma: 'win32',
    iniciar: new Error('The browser is already running for /dados/userData'),
    arquivos: { '/dados/userData/.wwebjs_auth/session-nova-desktop-client/SingletonLock': '', '/dados/userData/.wwebjs_auth/session-nova-desktop-client/DevToolsActivePort': '' },
    roteiro: async ({ manager, ambiente }) => {
      await ambiente.concluir(manager.initialize(), ms => ms === 1200);
      return manager.getState();
    },
  },
  {
    nome: 'iniciar com perfil travado no Mac usa o pkill e continua se não conseguir remover a trava',
    plataforma: 'darwin',
    iniciar: new Error('SingletonLock presente'),
    arquivos: { '/dados/userData/.wwebjs_auth/session-nova-desktop-client/SingletonCookie': '' },
    falhaAoRemover: true,
    roteiro: async ({ manager, ambiente }) => {
      await ambiente.concluir(manager.initialize(), ms => ms === 1200);
      return manager.getState();
    },
  },
  {
    nome: 'iniciar com perfil travado em outro sistema não mata nada',
    plataforma: 'linux',
    iniciar: new Error('userDataDir em uso'),
    roteiro: async ({ manager, ambiente }) => {
      await ambiente.concluir(manager.initialize(), ms => ms === 1200);
      return manager.getState();
    },
  },
  {
    nome: 'iniciar cujo cliente foi trocado no meio do caminho não mexe no estado',
    iniciar: 'sob-comando',
    roteiro: async ({ manager, ambiente }) => {
      const iniciando = manager.initialize();
      await esperar();
      manager.client = null;
      ambiente.falharInicio(new Error('falha'));
      await iniciando;
      return manager.getState();
    },
  },
  {
    nome: 'tentativas esgotadas avisam por diálogo e param de reconectar',
    iniciar: new Error('falha'),
    roteiro: async ({ manager }) => {
      manager.reconnectAttempts = manager.maxReconnectAttempts;
      await manager.initialize();
      return manager.getState();
    },
  },
  {
    nome: 'espera da reconexão cresce em dobro até o teto de 30 segundos',
    roteiro: async ({ manager }) => {
      for (let tentativa = 0; tentativa < 6; tentativa++) {
        manager.reconnectTimer = null;
        manager.scheduleReconnect('teste');
      }
      manager.scheduleReconnect('repetida');
      manager.manualLogout = true;
      manager.reconnectTimer = null;
      manager.scheduleReconnect('manual');
      return manager.getState();
    },
  },
  {
    nome: 'tempo de iniciar estourado reconstrói o cliente e agenda nova tentativa',
    roteiro: async ({ manager, ambiente }) => {
      ambiente.conectar(manager);
      manager.startInitTimeout();
      await ambiente.liberarAlarmes(ms => ms === manager.maxInitTimeMs);
      return manager.getState();
    },
  },
];

const EVENTOS_DO_CLIENTE = [
  {
    nome: 'qr: codifica, manda à interface e ignora o mesmo código repetido',
    roteiro: async ({ manager, ambiente }) => {
      const cliente = ambiente.conectar(manager);
      manager.registerClientEvents(cliente);
      cliente.emit('qr', 'codigo-1');
      cliente.emit('qr', 'codigo-1');
      await esperar();
      return manager.getState();
    },
  },
  {
    nome: 'qr: falha ao codificar é registrada e o código fica sem imagem',
    falhaNoQr: true,
    roteiro: async ({ manager, ambiente }) => {
      const cliente = ambiente.conectar(manager);
      manager.registerClientEvents(cliente);
      cliente.emit('qr', 'codigo-2');
      await esperar();
      return manager.getState();
    },
  },
  {
    nome: 'carregando, autenticado e pronto atualizam o estado e avisam a interface',
    roteiro: async ({ manager, ambiente }) => {
      const cliente = ambiente.conectar(manager);
      manager.registerClientEvents(cliente);
      manager.reconnectAttempts = 3;
      cliente.emit('loading_screen', 50, 'carregando');
      cliente.emit('authenticated');
      cliente.emit('remote_session_saved');
      cliente.emit('ready');
      return manager.getState();
    },
  },
  {
    nome: 'pronto sem nome no perfil usa Boss',
    infoDoCliente: {},
    roteiro: async ({ manager, ambiente }) => {
      const cliente = ambiente.conectar(manager);
      manager.registerClientEvents(cliente);
      cliente.emit('ready');
      return [manager.bossName, manager.getState()];
    },
  },
  {
    nome: 'falha de autenticação e desconexão derrubam o cliente e agendam reconexão',
    roteiro: async ({ manager, ambiente }) => {
      const cliente = ambiente.conectar(manager);
      manager.registerClientEvents(cliente);
      cliente.emit('auth_failure', 'sessão inválida');
      await esperar();
      const segundo = ambiente.conectar(manager);
      manager.registerClientEvents(segundo);
      manager.reconnectTimer = null;
      segundo.emit('disconnected', 'LOGOUT');
      await esperar();
      return manager.getState();
    },
  },
  {
    nome: 'mensagem recebida vai ao tratador e mensagem criada só vai quando é minha',
    roteiro: async ({ manager, ambiente }) => {
      const cliente = ambiente.conectar(manager);
      manager.registerClientEvents(cliente);
      manager.bossName = 'Chefe';
      cliente.emit('message', deContato('chegou'));
      await esperar();
      cliente.emit('message_create', deContato('criada por outro'));
      await esperar();
      cliente.emit('message_create', doDono('criada por mim'));
      await esperar();
    },
  },
  {
    nome: 'sair derruba a sessão e desligar preserva a sessão',
    roteiro: async ({ manager, ambiente }) => {
      ambiente.conectar(manager);
      await manager.logout();
      ambiente.conectar(manager);
      await manager.shutdown();
      return manager.getState();
    },
  },
  {
    nome: 'derrubar o cliente registra falhas de sair e de destruir e não derruba duas vezes ao mesmo tempo',
    falhaNoLogout: true,
    falhaNoDestroy: true,
    roteiro: async ({ manager, ambiente }) => {
      ambiente.conectar(manager);
      const primeiro = manager.destroyClient({ preserveSession: false });
      const segundo = manager.destroyClient();
      await Promise.all([primeiro, segundo]);
      await manager.destroyClient();
      return manager.destroying;
    },
  },
  {
    nome: 'janela destruída ou com erro no envio não derruba o aviso à interface',
    roteiro: async ({ manager, ambiente }) => {
      manager.sendToFrontend('a', 1);
      ambiente.janela.webContents.send = () => { throw new Error('janela quebrou'); };
      manager.sendToFrontend('b', 2);
      ambiente.janela.destruida = true;
      manager.sendToFrontend('c', 3);
      manager.updateMainWindow(null);
      manager.sendToFrontend('d', 4);
    },
  },
];

const CENAS_DO_NAVEGADOR = [
  {
    nome: 'navegador no Windows: o do ambiente vem primeiro quando existe',
    ambiente: { PUPPETEER_EXECUTABLE_PATH: 'C:\\navegador\\chrome.exe' },
    arquivos: { 'C:\\navegador\\chrome.exe': '' },
    roteiro: async ({ manager }) => manager.resolveBrowserExecutable(),
  },
  {
    nome: 'navegador no Windows: pastas de navegadores, versão mais nova primeiro',
    pastas: { '/dados/userData/browsers': ['chromium-1100', 'chromium-1300', 'leia.txt', 'chromium-1208'] },
    arquivos: { '/dados/userData/browsers/chromium-1300/chrome-win64/chrome.exe': '' },
    roteiro: async ({ manager }) => manager.resolveBrowserExecutable(),
  },
  {
    nome: 'navegador no Windows: erro ao listar a pasta é registrado e cai nos instalados',
    pastas: { '/projeto/browsers': [] },
    falhaAoListar: true,
    arquivos: { 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe': '' },
    roteiro: async ({ manager }) => manager.resolveBrowserExecutable(),
  },
  {
    nome: 'navegador no Windows: Edge é o último dos instalados',
    arquivos: { 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe': '' },
    roteiro: async ({ manager }) => manager.resolveBrowserExecutable(),
  },
  {
    nome: 'navegador no Windows: sem nenhum devolve nulo e deixa o padrão do Puppeteer',
    roteiro: async ({ manager }) => manager.resolveBrowserExecutable(),
  },
  {
    nome: 'navegador no Mac: ambiente, baixado, Chrome, Edge e nenhum',
    plataforma: 'darwin',
    chromiumBaixado: null,
    navegadorDoMac: { edge: '/Apps/Edge' },
    roteiro: async ({ manager }) => manager.resolveBrowserExecutable(),
  },
  {
    nome: 'navegador no Mac: o baixado no usuário vem antes dos instalados',
    plataforma: 'darwin',
    chromiumBaixado: '/dados/userData/browsers/chromium/chrome',
    navegadorDoMac: { chrome: '/Apps/Chrome' },
    roteiro: async ({ manager }) => manager.resolveBrowserExecutable(),
  },
  {
    nome: 'navegador no Mac: o do ambiente vem antes de tudo',
    plataforma: 'darwin',
    ambiente: { PUPPETEER_EXECUTABLE_PATH: '/navegador/chrome' },
    arquivos: { '/navegador/chrome': '' },
    roteiro: async ({ manager }) => manager.resolveBrowserExecutable(),
  },
];

const CENAS = [...CENAS_DE_MENSAGEM, ...CENAS_DE_ENVIO, ...CENAS_DE_CONEXAO, ...EVENTOS_DO_CLIENTE, ...CENAS_DO_NAVEGADOR];

module.exports = { CENAS };
