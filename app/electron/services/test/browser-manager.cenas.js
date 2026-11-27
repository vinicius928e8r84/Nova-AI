'use strict';

const path = require('path');

const falha = mensagem => ({ falha: mensagem });
const sequencia = (...passos) => ({ sequencia: passos });

const FERRAMENTAS = [
  ['browser-navigate', 'exemplo.com'],
  ['browser-go-back'],
  ['browser-go-forward'],
  ['browser-reload'],
  ['browser-snapshot'],
  ['browser-get-html', { selector: 'e1', maxChars: 10 }],
  ['browser-get-html', {}],
  ['browser-query-selector', { selector: 'a', limit: 3, maxTextChars: 20 }],
  ['browser-extract', 'e2'],
  ['browser-extract'],
  ['browser-screenshot', { fullPage: true }],
  ['browser-click', { selector: 'e5', doubleClick: true, button: 'right', modifiers: ['Shift', 'Alt'], delayMs: 10 }],
  ['browser-click', { selector: '#enviar' }],
  ['browser-type', { selector: 'e4', text: 'olá mundo' }],
  ['browser-fill-form', { fields: [{ selector: 'e4', text: 'a' }, { selector: '#b', text: 'b', clearFirst: false }], timeoutMs: 100 }],
  ['browser-hover', { selector: 'e3' }],
  ['browser-select', { selector: '#lista', value: 'dois' }],
  ['browser-press-key', 'Enter'],
  ['browser-scroll', { direction: 'down', amount: 300 }],
  ['browser-scroll-into-view', { selector: 'e2' }],
  ['browser-highlight', { selector: 'e2' }],
  ['browser-wait', { selector: 'e2' }],
  ['browser-execute-script', '() => ({ a: 1 })'],
  ['browser-handle-dialog', { accept: true, promptText: 'sim', timeoutMs: 50 }],
  ['browser-save-pdf', {}],
  ['browser-get-cookies'],
  ['browser-set-cookie', { cookie: { name: 'n', value: 'v' } }],
  ['browser-clear-cookies'],
  ['browser-get-storage', { kind: 'session', key: 'chave' }],
  ['browser-get-storage', {}],
  ['browser-set-storage', { key: 'k', value: 12345 }],
  ['browser-clear-storage', { kind: 'session' }],
  ['browser-clear-storage', {}],
  ['browser-resize-viewport', { width: 800, height: 600 }],
  ['browser-emulate-device', { deviceName: 'Pixel 5' }],
  ['browser-emulate-device', { deviceName: 'Nokia 3310' }],
  ['browser-emulate-color-scheme', {}],
  ['browser-set-offline', {}],
  ['browser-set-offline', { offline: false }],
  ['browser-set-extra-headers', { headers: { 'X-A': '1', 'X-B': '2' } }],
  ['browser-set-http-credentials', { username: 'u', password: 'p' }],
  ['browser-set-http-credentials', { clear: true }],
  ['browser-set-geolocation', { latitude: -23.5, longitude: -46.6 }],
  ['browser-set-geolocation', { clear: true }],
  ['browser-get-console', {}],
  ['browser-get-errors'],
  ['browser-get-tabs'],
  ['browser-new-tab', { url: 'nova.com' }],
  ['browser-switch-tab', { index: 0 }],
  ['browser-close-tab', {}],
  ['browser-drag-drop', { sourceSelector: 'e2', targetSelector: 'e3' }],
  ['browser-wait-download', { timeoutMs: 300 }],
  ['browser-download-by-click', { selector: 'e2', timeoutMs: 300 }],
  ['browser-upload-file', { selector: 'e4', filePath: '/nao/existe.png' }],
  ['browser-close'],
];

const CAMINHO_EMBUTIDO = path.join('resources', 'browsers', 'chromium-1208', 'chrome-win64', 'chrome.exe');

async function iniciar(palco, exportado) {
  exportado.registerBrowserHandlers();
  await palco.esgotar();
  await palco.rodar('launch', () => exportado.browserService.launch());
  await palco.rodar('snapshot', () => exportado.browserService.snapshot());
}

async function chamarTodos(palco, pedidos) {
  for (const [canal, ...argumentos] of pedidos) await palco.chamarCanal(canal, ...argumentos);
}

const servico = (palco, exportado, rotulo, fazer) => palco.rodar(rotulo, () => fazer(exportado.browserService));

const CENAS_DA_PORTA = [
  ['porta 9222 livre', {}],
  ['porta 9222 com Adobe e 9223 com Chrome para reaproveitar', { portas: { 9222: 'adobe', 9223: 'chrome' } }],
  ['portas com html, sem resposta e recusando antes da livre', { portas: { 9222: 'html', 9223: 'mudo', 9224: 'erro', 9225: 'vazio', 9226: 'livre' } }],
  ['Edge reaproveitado na 9222', { portas: { 9222: 'edge' } }],
  ['9222 com Adobe e 9223 livre', { portas: { 9222: 'adobe' } }],
  ['nenhuma porta livre de 9222 a 9252', { portas: Object.fromEntries(Array.from({ length: 31 }, (_, i) => [9222 + i, 'adobe'])) }],
].map(([nome, cenario]) => ({
  nome: 'porta CDP: ' + nome,
  cenario,
  rodar: async (palco, exportado) => {
    palco.anotar('getCdpPort antes', exportado.getCdpPort());
    const primeira = exportado.resolveCdpPort();
    const segunda = exportado.resolveCdpPort();
    palco.anotar('mesma promessa', primeira === segunda);
    await palco.rodar('resolveCdpPort', () => primeira);
    await palco.rodar('resolveCdpPort de novo', () => exportado.resolveCdpPort());
    palco.anotar('getCdpPort depois', exportado.getCdpPort());
    exportado.appendBrowserLog('linha de teste');
  },
}));

const lancamento = (nome, cenario, preparar, depois) => ({
  nome: 'lançamento: ' + nome,
  cenario,
  preparar,
  rodar: async (palco, exportado) => {
    exportado.registerBrowserHandlers();
    await palco.esgotar();
    if (cenario.cdpDepois) palco.cenario.portas = { 9222: cenario.cdpDepois };
    await servico(palco, exportado, 'launch', s => s.launch());
    palco.anotar('isRunning', exportado.browserService.isRunning());
    if (depois) await depois(palco, exportado);
    await palco.esgotar();
  },
});

const CENAS_DE_LANCAMENTO = [
  lancamento('primeira vez no Windows com o binário embutido', { cdpDepois: 'chrome' }, palco => palco.criarArquivo(CAMINHO_EMBUTIDO)),
  lancamento('perfil existente com o binário achado na varredura', { binarioEscaneado: '/opt/chromium/chrome', cdpDepois: 'adobe' }, palco => palco.criarArquivo('userData/browser-data/Default/Preferences', '{"download":"texto","profile":{"x":1}}')),
  lancamento('Mac sem binário embutido usa o Chrome do sistema', { plataforma: 'darwin' }, palco => palco.criarArquivo('userData/browser-data/Default/Preferences', '[1,2]')),
  lancamento('Windows sem binário usa o padrão do Playwright', { paginasIniciais: 0 }, palco => palco.criarArquivo('userData/browser-data/Default/Preferences', '{quebrado')),
  lancamento('falha uma vez e a nova tentativa abre', { roteiro: { 'chromium.launchPersistentContext': sequencia(falha('Timeout 120000ms exceeded'), undefined) } }),
  lancamento('falha duas vezes na primeira execução', { roteiro: { 'chromium.launchPersistentContext': falha('spawn chrome.exe ENOENT') } }),
  lancamento('falha duas vezes, perfil em quarentena e o limpo abre', { roteiro: { 'chromium.launchPersistentContext': sequencia(falha('crash 0x80000003'), falha('crash 0x80000003'), undefined) } }, palco => {
    palco.criarArquivo('userData/browser-data/Default/Cookies', 'cookies');
    palco.criarArquivo('userData/browser-data.corrupt-2026-01-01T00-00-00-000Z/velho', 'v');
    palco.criarArquivo('userData/outra-pasta/arquivo', 'fica');
  }),
  lancamento('quarentena e o perfil limpo também falha', { roteiro: { 'chromium.launchPersistentContext': sequencia(falha('crash A'), falha('crash B'), falha('crash C')) } }, palco => palco.criarArquivo('userData/browser-data/Local State', '{}')),
  lancamento('sem process.resourcesPath', { semRecursos: true }),
  lancamento('log grande é recomeçado e preferências com lista', {}, palco => {
    palco.criarArquivo('userData/logs/browser-launch.log', 'x'.repeat(1024 * 1024 + 1));
    palco.criarArquivo('userData/browser-data/Default/Preferences', '{"download":[1,2],"savefile":null,"profile":{"default_content_setting_values":"texto"}}');
  }),
  lancamento('log pequeno continua', {}, palco => palco.criarArquivo('userData/logs/browser-launch.log', 'linha antiga\n')),
  lancamento('contexto sem on', { roteiro: { 'context.close': falha('já morto') } }, null, async (palco, exportado) => {
    exportado.browserService.context.on = () => { throw new Error('sem on'); };
    await servico(palco, exportado, 'launch de novo vivo', s => s.launch());
    palco.contexto.conectado = false;
    palco.anotar('isRunning morto', exportado.browserService.isRunning());
    await servico(palco, exportado, 'launch com o navegador morto', s => s.launch());
    exportado.browserService.isInitialized = false;
    palco.contexto.conectado = false;
    await servico(palco, exportado, 'launch com contexto velho', s => s.launch());
  }),
];

const CENAS_DE_RECUPERACAO = [
  {
    nome: 'recuperação: Target closed ao abrir, relança e repete',
    cenario: { roteiro: { 'chromium.launchPersistentContext': sequencia(falha('Target closed'), falha('Target closed'), undefined) } },
    rodar: async (palco, exportado) => {
      exportado.registerBrowserHandlers();
      await palco.esgotar();
      await chamarTodos(palco, [['browser-navigate', 'https://site.com'], ['browser-get-tabs']]);
    },
  },
  {
    nome: 'recuperação: relançar também falha',
    cenario: { roteiro: { 'chromium.launchPersistentContext': falha('Browser closed.') } },
    rodar: async (palco, exportado) => {
      exportado.registerBrowserHandlers();
      await palco.esgotar();
      await chamarTodos(palco, [['browser-navigate', 'site.com']]);
    },
  },
  {
    nome: 'recuperação: a repetição também falha',
    cenario: { roteiro: { 'chromium.launchPersistentContext': sequencia(falha('Protocol error (Target.attach)'), falha('Protocol error (Target.attach)'), undefined, falha('Execution context was destroyed'), falha('Execution context was destroyed')) } },
    rodar: async (palco, exportado) => {
      exportado.registerBrowserHandlers();
      await palco.esgotar();
      palco.roteiro['browser.isConnected'] = p => p.contexto.rotulo !== 'contexto1';
      await chamarTodos(palco, [['browser-reload'], ['browser-go-back']]);
    },
  },
  {
    nome: 'recuperação: outra recuperação em andamento',
    rodar: async (palco, exportado) => {
      exportado.registerBrowserHandlers();
      await palco.esgotar();
      await servico(palco, exportado, 'launch', s => s.launch());
      exportado.browserService._isRelaunching = true;
      palco.roteiro['context.pages'] = falha('Connection closed');
      await chamarTodos(palco, [['browser-fill-form', { fields: null }]]);
      palco.roteiro['context.pages'] = undefined;
      await chamarTodos(palco, [['browser-fill-form', { fields: null }]]);
      exportado.browserService._isRelaunching = false;
      await chamarTodos(palco, [['browser-fill-form', { fields: 7 }], ['browser-wait'], ['browser-upload-file', { filePaths: [] }]]);
    },
  },
  {
    nome: 'recuperação: mensagens que contam como navegador morto',
    rodar: async (palco, exportado) => {
      await iniciar(palco, exportado);
      const mensagens = ['Target closed', 'browser has been closed', 'Browser closed', 'Session closed', 'Target page, context or browser has been closed',
        'Connection closed', 'Protocol error', 'Execution context was destroyed', 'context or browser has been closed', 'outra coisa qualquer'];
      for (const mensagem of mensagens) {
        let vezes = 0;
        await servico(palco, exportado, 'recuperação ' + mensagem, s => s._withAutoRecovery('ferramenta_x', async () => {
          vezes += 1;
          if (vezes === 1) throw new Error('falhou: ' + mensagem);
          return { vezes };
        }));
      }
      await servico(palco, exportado, 'recuperação com erro que não é Error', s => s._withAutoRecovery('ferramenta_y', () => Promise.reject('texto solto')));
      await servico(palco, exportado, 'recuperação com null', s => s._withAutoRecovery('ferramenta_z', () => Promise.reject(null)));
    },
  },
  {
    nome: 'getPage: aba fechada, sem abas e aba que lança',
    rodar: async (palco, exportado) => {
      await iniciar(palco, exportado);
      palco.contexto.paginas[0].fechada = true;
      await servico(palco, exportado, 'getPage com aba fechada', s => s.getPage().then(p => p.rotulo));
      palco.contexto.paginas = [];
      exportado.browserService.activePage = null;
      await servico(palco, exportado, 'getPage sem abas', s => s.getPage().then(p => p.rotulo));
      palco.roteiro['page.isClosed'] = sequencia(falha('Target page, context or browser has been closed'), false);
      await servico(palco, exportado, 'getPage com aba que lança', s => s.getPage().then(p => p.rotulo));
      exportado.browserService.context = null;
      await servico(palco, exportado, 'getPage sem contexto', s => s.getPage().then(p => p.rotulo));
    },
  },
];

const ferramentasCom = (nome, cenario, ajustar, pedidos = FERRAMENTAS) => ({
  nome: 'ferramentas: ' + nome,
  cenario,
  rodar: async (palco, exportado) => {
    await iniciar(palco, exportado);
    if (ajustar) ajustar(palco, exportado);
    await chamarTodos(palco, typeof pedidos === 'function' ? pedidos(palco) : pedidos);
  },
});

const PAGINA_QUE_FALHA = Object.fromEntries([
  'page.goto', 'page.waitForLoadState', 'page.title', 'page.goBack', 'page.goForward', 'page.reload', 'page.evaluate', 'page.screenshot',
  'page.keyboard.press', 'page.waitForFunction', 'page.waitForURL', 'page.waitForSelector', 'page.waitForTimeout', 'page.pdf',
  'page.setViewportSize', 'page.setExtraHTTPHeaders', 'page.emulateMedia', 'page.bringToFront', 'page.waitForEvent',
  'locator.ariaSnapshot', 'locator.innerHTML', 'locator.innerText', 'locator.click', 'locator.dblclick', 'locator.fill',
  'locator.pressSequentially', 'locator.selectText', 'locator.hover', 'locator.scrollIntoViewIfNeeded', 'locator.selectOption',
  'locator.waitFor', 'locator.setInputFiles', 'locator.dragTo', 'locator.elementHandle', 'locator.screenshot',
  'context.cookies', 'context.addCookies', 'context.clearCookies', 'context.setOffline', 'context.setHTTPCredentials',
  'context.setGeolocation', 'context.grantPermissions', 'context.newPage', 'context.newCDPSession', 'context.close', 'jimp.read',
].map(chave => [chave, falha('Erro genérico de ' + chave)]));

const CANAIS_COM_TEXTO_LIVRE = new Set(['browser-navigate', 'browser-execute-script', 'browser-press-key']);

function trocarSeletores(argumentos) {
  const trocado = { ...argumentos };
  for (const campo of ['selector', 'sourceSelector']) if (campo in trocado) trocado[campo] = 'e99';
  return trocado;
}

function comRefDesconhecida([canal, argumentos]) {
  if (argumentos && typeof argumentos === 'object') return [canal, trocarSeletores(argumentos)];
  const ehSeletor = typeof argumentos === 'string' && !CANAIS_COM_TEXTO_LIVRE.has(canal);
  return [canal, ehSeletor ? 'e99' : argumentos];
}

const CENAS_DE_FERRAMENTAS = [
  ferramentasCom('todas com a página respondendo', {}),
  ferramentasCom('todas com a página falhando', {}, palco => Object.assign(palco.roteiro, PAGINA_QUE_FALHA)),
  ferramentasCom('todas com refs desconhecidas', {}, (palco, exportado) => exportado.browserService.elementMap.clear(), FERRAMENTAS.map(comRefDesconhecida)),
  ferramentasCom('alvo do arrasto desconhecido', {}, null, [['browser-drag-drop', { sourceSelector: 'e2', targetSelector: 'e98' }], ['browser-drag-drop', { sourceSelector: '   ', targetSelector: 'e2' }]]),
  ...[
    'strict mode violation: locator resolved to 3 elements',
    'strict mode violation: muitos',
    'Timeout 5000ms exceeded. waiting for locator to be visible',
    'waiting for element not visible',
    '<div> intercepts pointer events',
    'element does not receive pointer events',
    'element is not visible',
    'Timeout 5000ms exceeded.',
    'timeout curto',
  ].map(mensagem => ferramentasCom('erro de elemento "' + mensagem + '"', { roteiro: { 'locator.click': falha(mensagem), 'locator.fill': falha(mensagem), 'locator.hover': falha(mensagem) } }, null, [
    ['browser-click', { selector: 'e2' }], ['browser-type', { selector: 'e4', text: 'x' }], ['browser-hover', { selector: 'e3' }],
  ])),
];

const CENAS_DE_LEITURA = [
  ferramentasCom('snapshot com refs, nth e cliques por ref', {}, null, [
    ['browser-click', { selector: 'e5' }], ['browser-click', { selector: '@E6' }], ['browser-click', { selector: 'ref=e2' }],
    ['browser-click', { selector: '[3]' }], ['browser-click', { selector: '4' }], ['browser-click', { selector: '[7' }],
    ['browser-click', { selector: 'button.primario' }], ['browser-click', { selector: '' }], ['browser-click', { selector: 'e7' }],
  ]),
  ferramentasCom('snapshot vazio e com só espaços', { roteiro: { 'locator.ariaSnapshot': sequencia('   \n ', '', '- /comentario\nsem traço\n- heading "Só título"') } }, null, [
    ['browser-snapshot'], ['browser-snapshot'], ['browser-snapshot'],
  ]),
  ferramentasCom('snapshot pela árvore do CDP', {
    roteiro: {
      'locator.ariaSnapshot': falha('ariaSnapshot indisponível'),
      'cdp.send': sequencia(
        { nodes: [{ ignored: true, role: { value: 'button' } }, { role: { value: 'generic' }, name: { value: 'g' } }, { role: { value: 'none' } }, { role: { value: 'Button' }, name: { value: '  Enviar  ' } }, { role: { value: 'textbox' } }, { role: { value: 'paragraph' } }, { role: { value: 'heading' }, name: { value: 'x'.repeat(150) } }, {}] },
        { nodes: [] },
        { nodes: Array.from({ length: 700 }, (_, i) => ({ role: { value: i % 10 ? 'link' : 'generic' }, name: { value: 'l' + i } })) },
        null,
      ),
    },
  }, null, [['browser-snapshot'], ['browser-snapshot'], ['browser-snapshot'], ['browser-snapshot'], ['browser-snapshot']]),
  ferramentasCom('snapshot com a árvore do CDP falhando', { roteiro: { 'locator.ariaSnapshot': falha('x'), 'context.newCDPSession': falha('sem cdp') } }, null, [['browser-snapshot']]),
  ferramentasCom('snapshot com título que falha', { roteiro: { 'page.title': sequencia('ok', falha('título caiu')) } }, null, [['browser-snapshot']]),
  ferramentasCom('esperas', { roteiro: { 'page.waitForFunction': sequencia(undefined, undefined, undefined, falha('Timeout 20000ms exceeded.'), falha('erro de script')) } }, null, [
    ['browser-wait', { timeMs: 45000 }], ['browser-wait', { timeMs: 10 }], ['browser-wait', { text: 'Pronto', timeout: 5 }], ['browser-wait', { textGone: 'Carregando' }],
    ['browser-wait', { url: '**/fim' }], ['browser-wait', { loadState: 'load', timeout: 7 }], ['browser-wait', { jsFunction: '() => true' }],
    ['browser-wait', { selector: 'e2', state: 'hidden', timeout: 3 }], ['browser-wait', { selector: '#css' }], ['browser-wait', { timeout: 1500 }],
    ['browser-wait', {}], ['browser-wait', 'e3'], ['browser-wait', null], ['browser-wait', { text: 'x' }], ['browser-wait', { textGone: 'y' }],
  ]),
  ferramentasCom('rolagens', {}, null, ['top', 'bottom', 'left', 'right', 'down', 'up', 'diagonal'].flatMap(direcao => [
    ['browser-scroll', { direction: direcao }], ['browser-scroll', { direction: direcao, amount: 120 }],
  ])),
  ferramentasCom('captura de tela pouco acima de 1280', { larguraDaImagem: 1281 }, null, [['browser-screenshot']]),
  ferramentasCom('capturas de tela', { larguraDaImagem: 1920 }, null, [
    ['browser-screenshot', { selector: 'e2' }], ['browser-screenshot', { selector: 'e99' }], ['browser-screenshot'], ['browser-screenshot', null],
  ]),
  ferramentasCom('captura com locator sem imagem e jimp que falha', { roteiro: { 'locator.screenshot': null, 'image.getBuffer': falha('jpeg indisponível') } }, null, [
    ['browser-screenshot', { selector: 'e2' }],
  ]),
  ferramentasCom('html, consulta, extração e script', { roteiro: { 'page.evaluate': sequencia('<p>abcdefghijklmnop</p>', [{ index: 0 }, { index: 1 }], 'texto', undefined, { n: [1, 2] }, 'x'.repeat(6000), falha('SyntaxError: Unexpected token')) } }, null, [
    ['browser-get-html', { maxChars: 5 }], ['browser-query-selector', { selector: 'li' }], ['browser-extract'], ['browser-execute-script', 'void 0'],
    ['browser-execute-script', 'obj'], ['browser-execute-script', 'longo'], ['browser-execute-script', 'quebrado'],
    ['browser-get-html', { selector: 'e2' }], ['browser-get-html', { selector: 'e2', maxChars: 3 }],
  ]),
];

const CENAS_DE_ACAO = [
  ferramentasCom('digitação nas quatro combinações', {}, null, [
    ['browser-type', { selector: 'e4', text: 'devagar e limpando', clearFirst: true, slowly: true }],
    ['browser-type', { selector: 'e4', text: 'devagar sem limpar', clearFirst: false, slowly: true }],
    ['browser-type', { selector: 'e4', text: 'rápido sem limpar', clearFirst: false }],
    ['browser-type', { selector: 'e4', text: 'um texto bem comprido que passa dos cinquenta caracteres com folga' }],
  ]),
  ferramentasCom('digitação devagar com selectText que falha', { roteiro: { 'locator.selectText': falha('não dá') } }, null, [
    ['browser-type', { selector: 'e4', text: 'abc', slowly: true }],
  ]),
  ferramentasCom('formulário misto', { roteiro: { 'locator.fill': sequencia(undefined, falha('campo travado')) } }, null, [
    ['browser-fill-form', { fields: [{ selector: 'e4', text: 'um' }, { selector: 'e99', text: 'dois' }, { selector: '#c', text: 'três' }, { selector: '#d', text: 'quatro', clearFirst: false }] }],
    ['browser-fill-form', { fields: [{ selector: 'e98', text: 'x' }] }],
    ['browser-fill-form', { fields: [] }],
  ]),
  ferramentasCom('destaque sem alça e arrastar', { roteiro: { 'locator.elementHandle': sequencia(null, undefined) } }, null, [
    ['browser-highlight', { selector: 'e2' }], ['browser-highlight', { selector: 'e2' }], ['browser-drag-drop', { sourceSelector: 'e2', targetSelector: '#alvo' }],
  ]),
  ferramentasCom('navegação sem http, com networkidle falhando', { roteiro: { 'page.waitForLoadState': falha('networkidle demorou') } }, null, [
    ['browser-navigate', 'site.com/a'], ['browser-navigate', 'http://site.com/b'], ['browser-reload'],
  ]),
  ferramentasCom('cliques com seletor de arquivo e envio depois', {
    eventos: { filechooser: palco => Promise.resolve(palco.seletorDeArquivo()) },
  }, palco => {
    palco.seletorDeArquivo = () => {
      const seletor = { tipo: 'chooser', rotulo: 'seletor de arquivo' };
      seletor.setFiles = arquivos => palco.responder(seletor, 'setFiles', [arquivos], () => undefined);
      return seletor;
    };
    palco.criarArquivo('arquivos/foto.png', 'png');
  }, palco => [
    ['browser-click', { selector: 'e5' }],
    ['browser-click', { selector: 'e5' }],
    ['browser-upload-file', { filePath: path.join(palco.raiz, 'arquivos', 'foto.png') }],
    ['browser-upload-file', { filePaths: [path.join(palco.raiz, 'arquivos', 'foto.png')] }],
  ]),
];

const CENAS_DE_ARQUIVOS = [
  {
    nome: 'envio de arquivo: resolução esperta do caminho',
    rodar: async (palco, exportado) => {
      await iniciar(palco, exportado);
      const pasta = path.join(palco.raiz, 'arquivos');
      palco.criarArquivo('arquivos/final thumbnail.png', 'png');
      palco.criarArquivo('arquivos/Video.MP4', 'mp4');
      palco.criarArquivo('arquivos/nota.final', 'nota');
      palco.criarArquivo('arquivos/exato.bin', 'bin');
      for (let i = 0; i < 12; i += 1) palco.criarArquivo(`outra/arquivo-${String(i).padStart(2, '0')}.txt`, 'x');
      palco.roteiro['handle.evaluate'] = sequencia(undefined, falha('evento falhou'));
      await chamarTodos(palco, [
        ['browser-upload-file', { selector: 'e4', filePath: path.join(pasta, 'exato.bin') }],
        ['browser-upload-file', { selector: 'e4', filePath: path.join(pasta, 'final thumbnail') }],
        ['browser-upload-file', { selector: '#arquivo', filePaths: [path.join(pasta, 'NOTA'), null, path.join(pasta, 'sumiu')] }],
        ['browser-upload-file', { selector: 'e99', filePath: path.join(pasta, 'exato.bin'), timeoutMs: 40 }],
        ['browser-upload-file', { filePath: path.join(palco.raiz, 'outra', 'ausente.png') }],
        ['browser-upload-file', { filePath: path.join(palco.raiz, 'nenhuma', 'ausente.png') }],
        ['browser-upload-file', { filePath: '' }],
        ['browser-upload-file', { filePath: path.join(pasta, 'final') }],
        ['browser-upload-file', { filePath: path.join(pasta, 'exato.bin', 'dentro') }],
      ]);
      palco.roteiro['locator.elementHandle'] = null;
      palco.roteiro['locator.setInputFiles'] = falha('input não aceita');
      await chamarTodos(palco, [
        ['browser-upload-file', { selector: 'e4', filePath: path.join(pasta, 'exato.bin') }],
      ]);
      palco.roteiro['locator.setInputFiles'] = undefined;
      await chamarTodos(palco, [['browser-upload-file', { selector: 'e4', filePath: path.join(pasta, 'exato.bin') }]]);
    },
  },
  {
    nome: 'envio de arquivo: resolução esperta por maiúsculas (só em sistema que diferencia maiúsculas: no Windows e no Mac o arquivo é achado direto)',
    soComMaiusculasDiferentes: true,
    rodar: async (palco, exportado) => {
      await iniciar(palco, exportado);
      palco.criarArquivo('arquivos/Video.MP4', 'mp4');
      await chamarTodos(palco, [
        ['browser-upload-file', { selector: '#arquivo', filePaths: [path.join(palco.raiz, 'arquivos', 'video.mp4')] }],
      ]);
    },
  },
  {
    nome: 'downloads: nome sugerido, cópia numerada e espera até o prazo',
    cenario: {
      eventos: {
        download: palco => Promise.resolve(palco.proximoDownload()),
        dialog: palco => Promise.resolve(palco.proximoDialogo()),
      },
    },
    rodar: async (palco, exportado) => {
      await iniciar(palco, exportado);
      const downloads = [
        { nome: 'relatório.pdf', url: 'https://x/relatório.pdf' },
        { nome: '', url: 'https://x/arquivo.zip?token=1' },
        { nome: 'sem<ext>', url: 'https://x/sem-extensao' },
        { nome: 'planilha', url: 'nao é url' },
        { nome: 'video', url: 'https://x/a.extensaomuitolonga' },
        { nome: 'imagem', url: 'https://x/imagem.tiff22' },
        { nome: 'velho.txt', url: 'https://x/velho.txt' },
      ];
      palco.proximoDownload = () => {
        const dados = downloads.shift() || { nome: 'fim.txt', url: 'https://x/fim.txt' };
        const download = { tipo: 'download', rotulo: 'download ' + dados.nome };
        download.suggestedFilename = () => palco.responder(download, 'suggestedFilename', [], () => dados.nome);
        download.url = () => palco.responder(download, 'url', [], () => dados.url);
        return download;
      };
      const dialogos = [['prompt', 'Seu nome?'], ['confirm', 'Certeza?']];
      palco.proximoDialogo = () => {
        const [tipo, mensagem] = dialogos.shift() || ['alert', 'Oi'];
        const dialogo = { tipo: 'dialog', rotulo: 'diálogo ' + tipo };
        dialogo.type = () => palco.responder(dialogo, 'type', [], () => tipo);
        dialogo.message = () => palco.responder(dialogo, 'message', [], () => mensagem);
        dialogo.accept = texto => palco.responder(dialogo, 'accept', [texto], () => undefined);
        dialogo.dismiss = () => palco.responder(dialogo, 'dismiss', [], () => undefined);
        return dialogo;
      };
      palco.criarArquivo('downloads/relatório (2).pdf', 'velho', palco.relogio.agora - 60000);
      palco.criarArquivo('downloads/relatório (1).pdf', 'novo', palco.relogio.agora);
      palco.criarArquivo('downloads/RELATÓRIO.PDF', 'maiúsculo', palco.relogio.agora - 1000);
      palco.criarArquivo('downloads/outro.pdf', 'outro', palco.relogio.agora);
      palco.criarArquivo('downloads/velho.txt', 'antigo', palco.relogio.agora - 3600000);
      await chamarTodos(palco, [
        ['browser-wait-download', {}],
        ['browser-wait-download', { timeoutMs: 600 }],
        ['browser-download-by-click', { selector: 'e2', timeoutMs: 700 }],
        ['browser-download-by-click', { selector: '#baixar', timeoutMs: 260 }],
        ['browser-wait-download', { timeoutMs: 100 }],
        ['browser-wait-download', { timeoutMs: 100 }],
        ['browser-wait-download', { timeoutMs: 400 }],
        ['browser-handle-dialog', { accept: true, promptText: 'Ana' }],
        ['browser-handle-dialog', { accept: false }],
        ['browser-handle-dialog', { accept: true }],
        ['browser-save-pdf', { savePath: '/tmp/x.pdf' }],
      ]);
    },
  },
];

const CENAS_DE_CONTEXTO = [
  {
    nome: 'abas, cookies e mensagens do console',
    cenario: { paginasIniciais: 3, roteiro: { 'page.title': sequencia('A', falha('aba travada'), 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P') } },
    rodar: async (palco, exportado) => {
      await iniciar(palco, exportado);
      for (let i = 0; i < 503; i += 1) palco.emitirNaPagina(0, 'console', { type: () => (i % 3 ? 'log' : 'error'), text: () => 'mensagem ' + i });
      for (let i = 0; i < 202; i += 1) palco.emitirNaPagina(0, 'pageerror', { message: 'erro ' + i, stack: 'pilha ' + i });
      await chamarTodos(palco, [
        ['browser-get-console', { level: 'error' }], ['browser-get-console', {}], ['browser-get-errors'],
        ['browser-get-tabs'], ['browser-switch-tab', { index: 2 }], ['browser-switch-tab', { index: 5 }], ['browser-switch-tab', { index: -1 }],
        ['browser-new-tab', {}], ['browser-new-tab', { url: 'https://abc.com' }], ['browser-get-tabs'],
        ['browser-close-tab', { index: 9 }], ['browser-close-tab', { index: -1 }], ['browser-close-tab', { index: 1 }], ['browser-close-tab', {}],
        ['browser-set-cookie', { cookie: { name: 'a', value: '1', domain: '.x.com' } }], ['browser-set-cookie', { cookie: { name: 'b', value: '2', url: 'https://y' } }],
        ['browser-set-cookie', { cookie: { name: 'c', value: '3' } }],
      ]);
      palco.emitirNaPagina(palco.contexto.paginas.length - 1, 'console', { type: () => 'warning', text: () => 'na aba nova' });
      palco.emitirNaPagina(palco.contexto.paginas.length - 1, 'pageerror', { message: 'erro da aba nova', stack: 's' });
      await chamarTodos(palco, [['browser-get-console', { level: 'warning' }], ['browser-get-errors']]);
      await chamarTodos(palco, [['browser-switch-tab', { index: 1 }], ['browser-close-tab', {}]]);
      palco.contexto.paginas.splice(1);
      await chamarTodos(palco, [['browser-close-tab', {}], ['browser-close'], ['browser-close'], ['browser-get-cookies'], ['browser-close']]);
    },
  },
  {
    nome: 'ferramentas de contexto abrem o navegador quando não há',
    rodar: async (palco, exportado) => {
      exportado.registerBrowserHandlers();
      await palco.esgotar();
      for (const pedido of [['browser-get-cookies'], ['browser-close'], ['browser-clear-cookies'], ['browser-close'], ['browser-set-offline', {}], ['browser-close'],
        ['browser-set-http-credentials', { username: 'u' }], ['browser-close'], ['browser-set-geolocation', { latitude: 1, longitude: 2, accuracy: 5 }], ['browser-close'],
        ['browser-get-tabs'], ['browser-close'], ['browser-switch-tab', { index: 0 }], ['browser-close'], ['browser-new-tab', {}], ['browser-close'],
        ['browser-close-tab', { index: 0 }], ['browser-close'], ['browser-set-cookie', { cookie: { name: 'z' } }], ['browser-close']]) {
        await chamarTodos(palco, [pedido]);
      }
      await chamarTodos(palco, [['browser-get-console'], ['browser-click'], ['browser-set-cookie', {}]]);
      palco.anotar('canais', [...palco.canais.keys()]);
    },
  },
];

module.exports = [
  ...CENAS_DA_PORTA, ...CENAS_DE_LANCAMENTO, ...CENAS_DE_RECUPERACAO, ...CENAS_DE_FERRAMENTAS,
  ...CENAS_DE_LEITURA, ...CENAS_DE_ACAO, ...CENAS_DE_ARQUIVOS, ...CENAS_DE_CONTEXTO,
];
