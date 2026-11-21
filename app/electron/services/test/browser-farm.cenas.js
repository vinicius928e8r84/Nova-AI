'use strict';
const { chamar, voltas, estadoDaFazenda } = require('./browser-farm.palco');

const ARQUIVO = '/dados/userData/farm_profiles.json';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BRAVE = 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
const FIREFOX = 'C:\\Program Files\\Mozilla Firefox\\firefox.exe';
const VIVALDI = 'C:\\Program Files\\Vivaldi\\Application\\vivaldi.exe';
const PASTA_DO_PERFIL = id => `/dados/userData/farm_profiles/${id}`;
const GEO_OK = { status: 200, corpo: JSON.stringify({ status: 'success', timezone: 'Asia/Karachi', lat: 24.8, lon: 67, countryCode: 'PK' }) };

const perfil = (id, campos = {}) => ({
  id, name: `Perfil ${id}`, ua: `UA-${id}`, proxy: '', email: '', status: 'idle', platform: 'windows',
  timezone: 'UTC', locale: 'en-US', latitude: null, longitude: null, browser: 'chrome', ...campos,
});

const PERFIS_VARIADOS = [
  { id: 'mac', platform: 'mac' },
  { id: 'linux', platform: 'linux', cpuCores: '8', ramSize: '16', deviceName: 'USER-PC-X6NAGE1', macAddress: '00-1B-21-29-FE-FA' },
  { id: 'android' },
  { id: 'ios', platform: 'ios', screenResolution: 'Based on User-Agent' },
  { id: 'windows', platform: 'windows', platformStr: 'Win32', webglVendor: 'v', webglRenderer: 'r', canvasNoiseSeed: 0, webglNoiseSeed: null },
  { id: 'pronto', platform: 'windows', cpuCores: '4', ramSize: '8', platformStr: 'Win32', webglVendor: 'v', webglRenderer: 'r', deviceName: 'PC', macAddress: 'M',
    screenResolution: '800x600', canvasNoiseSeed: 1, webglNoiseSeed: 2, audioNoiseSeed: 3, virtualCamId: 'c', virtualCamLabel: 'C', virtualMicId: 'm',
    virtualMicLabel: 'M', virtualSpeakerId: 's', virtualSpeakerLabel: 'S' },
];

const abrir = (id, plataforma) => (fazenda, roteiro) => chamar(roteiro, 'openLoginBrowser', () => fazenda.openLoginBrowser(id, plataforma));

function cena(nome, montagem, passos) {
  return { nome, ...montagem, passos };
}

const CENAS_DOS_PERFIS = [
  cena('carrega perfis e completa as especificações', { arquivos: { [ARQUIVO]: JSON.stringify(PERFIS_VARIADOS) } }, (fazenda, roteiro) => {
    roteiro.anotar('loadProfiles', fazenda.loadProfiles());
  }),
  cena('carrega perfis completos sem gravar', { arquivos: { [ARQUIVO]: JSON.stringify([PERFIS_VARIADOS[5]]) } }, (fazenda, roteiro) => {
    roteiro.anotar('loadProfiles', fazenda.loadProfiles());
  }),
  cena('sem arquivo cria seis perfis', {}, (fazenda, roteiro) => roteiro.anotar('loadProfiles', fazenda.loadProfiles())),
  cena('arquivo corrompido e falha ao gravar', { arquivos: { [ARQUIVO]: '{x' }, falhas: { writeFileSync: 'EACCES' } }, (fazenda, roteiro) => {
    roteiro.anotar('loadProfiles', fazenda.loadProfiles());
  }),
  cena('adiciona, atualiza e apaga perfis', { perfis: [perfil('profile_03'), { id: 'outro' }, null, perfil('profile_x')] }, async (fazenda, roteiro) => {
    roteiro.anotar('addProfile', fazenda.addProfile('Novo', 'brave'));
    roteiro.anotar('addProfile padrão', fazenda.addProfile());
    roteiro.anotar('addProfile sem navegador', fazenda.addProfile('', ''));
    await chamar(roteiro, 'updateProfile com nulo', () => fazenda.updateProfile('profile_03', {}));
    fazenda.profiles = fazenda.profiles.filter(Boolean);
    roteiro.anotar('updateProfile', fazenda.updateProfile('profile_03', { proxy: '1.2.3.4:80' }));
    roteiro.anotar('updateProfile ausente', fazenda.updateProfile('nada', {}));
    const janela = { isDestroyed: () => false, close: () => roteiro.anotar('janela.close') };
    fazenda.profileWindows.set('profile_03', janela);
    fazenda.playwrightContexts.set('profile_03', { close: async () => { roteiro.anotar('contexto.close'); throw new Error('x'); } });
    roteiro.anotar('deleteProfile', fazenda.deleteProfile('profile_03'));
    fazenda.profileWindows.set('outro', { isDestroyed: () => true, close: () => roteiro.anotar('não fecha') });
    roteiro.anotar('deleteProfile destruída', fazenda.deleteProfile('outro'));
  }),
  cena('adiciona em lista vazia', { perfis: [] }, (fazenda, roteiro) => roteiro.anotar('addProfile', fazenda.addProfile('Primeiro'))),
  cena('tamanho da janela por plataforma', {}, (fazenda, roteiro) => {
    const casos = [{ windowMode: 'maximized', platform: 'android' }, { windowMode: 'maximized', platform: 'ios' }, { windowMode: 'maximized' },
      { screenResolution: '1024x768' }, { screenResolution: 'xx' }, { screenResolution: 'abc' }, { platform: 'android' }, { platform: 'mac' },
      { platform: 'linux' }, {}];
    for (const caso of casos) roteiro.anotar('tamanho', caso, fazenda._getProfileWindowSize(caso));
  }),
  cena('tamanho maximizado sem tela e com erro', { tela: null }, (fazenda, roteiro) => {
    roteiro.anotar('sem tela', fazenda._getProfileWindowSize({ windowMode: 'maximized' }));
    roteiro.cena.tela = { bounds: {} };
    roteiro.anotar('sem medidas', fazenda._getProfileWindowSize({ windowMode: 'maximized', platform: 'mac' }));
    roteiro.falhas.screen = 'sem display';
    roteiro.anotar('com erro', fazenda._getProfileWindowSize({ windowMode: 'maximized' }));
  }),
  cena('executáveis no Windows', { localAppData: 'C:\\Local', resourcesPath: 'C:\\res', arquivos: { [BRAVE]: '', [VIVALDI]: '', [FIREFOX]: '', [CHROME]: '' } }, (fazenda, roteiro) => {
    roteiro.anotar('chrome', fazenda.getChromeExecutablePath());
    roteiro.anotar('brave', fazenda.getBraveExecutablePath());
    roteiro.anotar('vivaldi', fazenda.getVivaldiExecutablePath());
    roteiro.anotar('firefox', fazenda.getFirefoxExecutablePath());
    roteiro.arquivos = {};
    roteiro.anotar('nenhum', fazenda.getChromeExecutablePath(), fazenda.getBraveExecutablePath(), fazenda.getVivaldiExecutablePath(), fazenda.getFirefoxExecutablePath());
  }),
  cena('executáveis no Mac', { plataforma: 'darwin', navegadoresDoMac: { chrome: '/Chrome', firefox: '/Firefox' } }, (fazenda, roteiro) => {
    roteiro.anotar('mac', fazenda.getChromeExecutablePath(), fazenda.getBraveExecutablePath(), fazenda.getVivaldiExecutablePath(), fazenda.getFirefoxExecutablePath());
  }),
];

const CENAS_DO_LOGIN = [
  cena('login: perfil ausente e pedido repetido', { perfis: [perfil('p1')] }, async (fazenda, roteiro) => {
    await chamar(roteiro, 'ausente', () => fazenda.openLoginBrowser('nada'));
    fazenda.launchingProfiles.add('p1');
    await chamar(roteiro, 'repetido', () => fazenda.openLoginBrowser('p1'));
  }),
  cena('login: contexto aberto vem para frente', { perfis: [perfil('p1')] }, async (fazenda, roteiro) => {
    const pagina = { bringToFront: async () => roteiro.anotar('bringToFront') };
    fazenda.playwrightContexts.set('p1', { pages: () => [pagina] });
    await chamar(roteiro, 'com página', () => fazenda.openLoginBrowser('p1'));
    fazenda.playwrightContexts.set('p1', { pages: () => { throw new Error('fechado'); } });
    fazenda.profileWindows.set('p1', { isDestroyed: () => false, focus: () => roteiro.anotar('focus') });
    await chamar(roteiro, 'contexto quebrado e janela aberta', () => fazenda.openLoginBrowser('p1'));
  }),
  cena('login: outro perfil já aberto', { perfis: [perfil('p1')], arquivos: { [CHROME]: '' } }, async (fazenda, roteiro) => {
    fazenda.activeRunProfiles.add('p9');
    await abrir('p1')(fazenda, roteiro);
  }),
  cena('login: aloha sem executável lança', { perfis: [perfil('p1', { browser: undefined })] }, abrir('p1')),
  cena('login com Chrome, geo do proxy, e-mail detectado e fechamento', {
    perfis: [perfil('p1', { timezone: 'optimal', locale: 'optimal', proxy: 'socks5://u:s@9.9.9.9:1080', hardwareAcceleration: 'disable', disableTlsFeatures: 'open', windowMode: 'maximized' })],
    arquivos: { [CHROME]: '' }, pastas: { [PASTA_DO_PERFIL('p1')]: ['SingletonLock', 'Default', 'SingletonCookie'] }, rede: [GEO_OK],
    respostas: { email: [null, '  ana@exemplo.com  ', 'ana@exemplo.com', new Error('página fechou')] },
  }, async (fazenda, roteiro) => {
    await abrir('p1', 'tiktok')(fazenda, roteiro);
    await roteiro.avancar(2000);
    await roteiro.avancar(2000);
    await roteiro.avancar(2000);
    await roteiro.avancar(2000);
    await roteiro.avancar(2000);
    roteiro.contextos[0].emit('close');
    await voltas();
  }),
  cena('login: três tentativas falham', { perfis: [perfil('p1', { browser: 'brave' })], arquivos: { [BRAVE]: '' }, lancamentos: ['crash 1', 'crash 2', 'crash 3'],
    pastas: { [PASTA_DO_PERFIL('p1')]: ['SingletonLock'] }, falhas: { unlinkSync: 'EBUSY', rmSync: 'EPERM' } }, async (fazenda, roteiro) => {
    const abertura = chamar(roteiro, 'openLoginBrowser', () => fazenda.openLoginBrowser('p1'));
    await roteiro.avancar(3000);
    await roteiro.avancar(3500);
    await abertura;
  }),
  cena('login: Firefox na segunda tentativa, sem páginas e com e-mail', { perfis: [perfil('p1', { browser: 'firefox', email: 'x@y.com', latitude: 1, longitude: 2, platform: 'android' })],
    arquivos: { [FIREFOX]: '' }, lancamentos: ['crash', 'ok'], semPaginas: true, falhas: { readdirSync: 'EACCES' }, pastas: { [PASTA_DO_PERFIL('p1')]: [] } },
  async (fazenda, roteiro) => {
    const abertura = chamar(roteiro, 'openLoginBrowser', () => fazenda.openLoginBrowser('p1'));
    await roteiro.avancar(3000);
    await abertura;
    roteiro.contextos[0].paginas = [];
    await roteiro.avancar(2000);
  }),
  cena('login: geo sem sucesso e vivaldi', { perfis: [perfil('p1', { browser: 'vivaldi', timezone: 'optimal' })], arquivos: { [VIVALDI]: '' }, rede: [{ status: 200, corpo: '{"status":"fail"}' }] },
    async (fazenda, roteiro) => {
      await abrir('p1')(fazenda, roteiro);
      roteiro.contextos[0].paginas = [];
      await roteiro.avancar(2000);
    }),
  cena('login pela janela do Electron com proxy e e-mail', {
    perfis: [perfil('p1', { browser: 'opera', proxy: 'h:1:usuario:senha', windowMode: 'maximized', platform: 'mac' })],
    respostas: { email: [undefined, 'bia@x.com', new Error('x')] },
  }, async (fazenda, roteiro) => {
    await abrir('p1', 'instagram')(fazenda, roteiro);
    const sessao = roteiro.sessoes.get('persist:farm_p1');
    sessao.emit('login', { preventDefault: () => roteiro.anotar('preventDefault') }, {}, { isProxy: true }, (u, s) => roteiro.anotar('callback', u, s));
    sessao.emit('login', { preventDefault: () => roteiro.anotar('não') }, {}, { isProxy: false }, () => roteiro.anotar('não'));
    const janela = roteiro.janelas[0];
    janela.webContents.emit('did-navigate');
    janela.webContents.emit('did-finish-load');
    await roteiro.avancar(2000);
    await roteiro.avancar(2000);
    await roteiro.avancar(2000);
    janela.close();
    await roteiro.avancar(2000);
  }),
  cena('login pela janela com proxy sem usuário e erro de proxy', { perfis: [perfil('p1', { browser: 'opera', proxy: 'h:8080', email: 'a@b.c' }), perfil('p2', { browser: 'opera', proxy: 'h' })] },
    async (fazenda, roteiro) => {
      await abrir('p1')(fazenda, roteiro);
      roteiro.falhas.setProxy = 'proxy inválido';
      await abrir('p2')(fazenda, roteiro);
      roteiro.janelas[0].destruida = true;
      await roteiro.avancar(2000);
    }),
];

const CENAS_DA_REDE = [
  cena('checkProxy', {
    perfis: [perfil('p1', { proxy: 'http://u:s@h:1' }), perfil('p2'), perfil('p3', { proxy: '   ' }), perfil('p4', { proxy: 'h:2' })],
    rede: [{ status: 204 }, { status: 500 }, { erro: 'ECONNREFUSED' }, { erro: '' }, { pendura: true }, { status: 302 }, { status: 199 }],
  }, async (fazenda, roteiro) => {
    await chamar(roteiro, 'ausente', () => fazenda.checkProxy('nada'));
    await chamar(roteiro, 'sem proxy', () => fazenda.checkProxy('p2'));
    await chamar(roteiro, 'proxy em branco', () => fazenda.checkProxy('p3'));
    await chamar(roteiro, 'ok', () => fazenda.checkProxy('p1'));
    roteiro.sessoes.get('persist:farm_p1').emit('login', { preventDefault: () => roteiro.anotar('preventDefault') }, {}, { isProxy: true }, (u, s) => roteiro.anotar('callback', u, s));
    await chamar(roteiro, 'status ruim', () => fazenda.checkProxy('p4'));
    await chamar(roteiro, 'erro', () => fazenda.checkProxy('p4'));
    await chamar(roteiro, 'erro sem mensagem', () => fazenda.checkProxy('p4'));
    const lenta = chamar(roteiro, 'tempo esgotado', () => fazenda.checkProxy('p4'));
    await roteiro.avancar(5000);
    await lenta;
    await chamar(roteiro, 'redirecionado', () => fazenda.checkProxy('p4'));
    await chamar(roteiro, 'informativo', () => fazenda.checkProxy('p4'));
    roteiro.falhas.setProxy = 'sem sessão';
    await chamar(roteiro, 'exceção', () => fazenda.checkProxy('p4'));
  }),
  cena('geo do perfil', { rede: [GEO_OK, { status: 200, corpo: '{"status":"success"}' }, { status: 200, corpo: 'nada' }, { erro: 'x' }, { pendura: true }] }, async (fazenda, roteiro) => {
    await chamar(roteiro, 'geo com proxy', () => fazenda.getOptimalGeoDetails({ id: 'g1', proxy: 'u:s@h:1' }));
    await chamar(roteiro, 'geo vazia', () => fazenda.getOptimalGeoDetails({ id: 'g2' }));
    await chamar(roteiro, 'geo inválida', () => fazenda.getOptimalGeoDetails({ id: 'g3', proxy: 'h:1' }));
    roteiro.falhas.setProxy = 'x';
    await chamar(roteiro, 'geo com erro', () => fazenda.getOptimalGeoDetails({ id: 'g4', proxy: 'h:1' }));
    const lenta = chamar(roteiro, 'geo lenta', () => fazenda.getOptimalGeoDetails({ id: 'g5' }));
    await roteiro.avancar(3000);
    await lenta;
  }),
  cena('formatos de proxy', { rede: Array.from({ length: 8 }, () => ({ status: 204 })) }, async (fazenda, roteiro) => {
    for (const proxy of ['h:1:u:s', 'u:s@h:1', 'u@h', 'h:1', 'h', 'HTTPS://h:2', 'a:b:c', '  socks://x  ']) {
      fazenda.profiles = [perfil('x', { proxy })];
      await chamar(roteiro, `proxy ${proxy}`, () => fazenda.checkProxy('x'));
    }
  }),
];

function rodar(montagem) {
  return async (fazenda, roteiro) => {
    const execucao = chamar(roteiro, 'runFarm', () => fazenda.runFarm(montagem));
    for (let i = 0; i < 40; i++) await roteiro.avancar(1000);
    await execucao;
  };
}

const CONFIG = { targetUrl: 'https://www.youtube.com/watch?v=1', action: 'like', batchSize: 2, launchDelay: 1, actionDelay: 2, commentText: '' };

const CENAS_DA_EXECUCAO = [
  cena('execução sem perfis e sem URL', { perfis: [] }, async (fazenda, roteiro) => {
    const semPerfis = chamar(roteiro, 'sem perfis', () => fazenda.runFarm({ ...CONFIG, profileIds: [] }));
    await roteiro.avancar(1000);
    await semPerfis;
    fazenda.profiles = [perfil('p1')];
    const semUrl = chamar(roteiro, 'sem url', () => fazenda.runFarm({ ...CONFIG, targetUrl: '  ' }));
    await roteiro.avancar(1000);
    await semUrl;
  }),
  cena('execução com Chrome: curtir em dois lotes', {
    perfis: [perfil('p1', { timezone: 'optimal' }), perfil('p2', { proxy: 'u:s@h:1', locale: 'optimal' }), perfil('p3', { browser: 'brave' })],
    arquivos: { [CHROME]: '', [BRAVE]: '' }, rede: [GEO_OK, { erro: 'x' }],
    respostas: { email: [null, 'novo@x.com', new Error('x')], like: [null, { success: false, error: 'Like button not found' }], popups: [true, new Error('x'), false] },
  }, rodar({ ...CONFIG, profileIds: ['p1', 'p2', 'p3'] })),
  cena('execução com Firefox: comentar com espera longa e goto falhando', {
    perfis: [perfil('p1', { browser: 'firefox', windowMode: 'maximized', platform: 'ios' })], arquivos: { [FIREFOX]: '' }, semPaginas: true, falhas: { goto: 'timeout', addInitScript: 'x' },
    respostas: { comment: { success: true } },
  }, rodar({ ...CONFIG, action: 'comment', actionDelay: 7, commentText: 'Muito bom "mesmo"' })),
  cena('execução: assistir, compartilhar, inscrever e ação desconhecida', {
    perfis: [perfil('p1'), perfil('p2'), perfil('p3'), perfil('p4')], arquivos: { [CHROME]: '' },
    respostas: { share: new Error('sem dom'), subscribe: { success: true } },
  }, async (fazenda, roteiro) => {
    for (const [id, action] of [['p1', 'watch'], ['p2', 'share'], ['p3', 'subscribe'], ['p4', 'dançar']]) {
      const execucao = chamar(roteiro, `runFarm ${action}`, () => fazenda.runFarm({ ...CONFIG, profileIds: [id], action, targetUrl: 'https://www.tiktok.com/@a' }));
      for (let i = 0; i < 60; i++) await roteiro.avancar(1000);
      await execucao;
    }
  }),
  cena('execução: Chrome falha três vezes', { perfis: [perfil('p1')], arquivos: { [CHROME]: '' }, lancamentos: ['a', 'b', 'c'] }, rodar(CONFIG)),
  cena('execução: parar no meio da espera', { perfis: [perfil('p1'), perfil('p2'), perfil('p3')], arquivos: { [CHROME]: '' } }, async (fazenda, roteiro) => {
    const execucao = chamar(roteiro, 'runFarm', () => fazenda.runFarm({ ...CONFIG, batchSize: 1, launchDelay: 3 }));
    for (let i = 0; i < 9; i++) await roteiro.avancar(1000);
    fazenda.stopFarm();
    for (let i = 0; i < 20; i++) await roteiro.avancar(1000);
    await execucao;
  }),
  cena('execução: parar antes da ação', { perfis: [perfil('p1')], arquivos: { [CHROME]: '' } }, async (fazenda, roteiro) => {
    const execucao = chamar(roteiro, 'runFarm', () => fazenda.runFarm({ ...CONFIG, actionDelay: 10 }));
    for (let i = 0; i < 25; i++) await roteiro.avancar(500);
    fazenda.shouldStop = true;
    for (let i = 0; i < 20; i++) await roteiro.avancar(1000);
    await execucao;
  }),
  cena('execução: nova execução troca o runId', { perfis: [perfil('p1')], arquivos: { [CHROME]: '' } }, async (fazenda, roteiro) => {
    const primeira = chamar(roteiro, 'primeira', () => fazenda.runFarm(CONFIG));
    await roteiro.avancar(1500);
    const segunda = chamar(roteiro, 'segunda', () => fazenda.runFarm({ ...CONFIG, action: 'share' }));
    for (let i = 0; i < 40; i++) await roteiro.avancar(1000);
    await primeira;
    await segunda;
  }),
  cena('execução pela janela do Electron', {
    perfis: [perfil('p1', { browser: 'opera', proxy: 'u:s@h:1', windowMode: 'maximized' }), perfil('p2', { browser: 'opera', proxy: 'h:1' }), perfil('p3', { browser: 'opera' })],
    carregamentos: ['dom-ready', 'pendura', 'rejeita'], respostas: { email: ['c@d.com', null, new Error('x')], like: [{ success: true }, null, new Error('x')] },
    falhas: { stop: 'já parou' },
  }, async (fazenda, roteiro) => {
    const execucao = chamar(roteiro, 'runFarm', () => fazenda.runFarm({ ...CONFIG, batchSize: 3, actionDelay: 6 }));
    for (let i = 0; i < 50; i++) await roteiro.avancar(1000);
    await execucao;
  }),
  cena('execução pela janela: proxy com erro e parada', { perfis: [perfil('p1', { browser: 'opera', proxy: 'h:1' })], falhas: { setProxy: 'x' } }, async (fazenda, roteiro) => {
    const execucao = chamar(roteiro, 'runFarm', () => fazenda.runFarm(CONFIG));
    await roteiro.avancar(1200);
    fazenda.shouldStop = true;
    for (let i = 0; i < 20; i++) await roteiro.avancar(1000);
    await execucao;
  }),
  cena('execução quebra e janela principal destruída', { perfis: [perfil('p1')], janelaPrincipal: 'destruida' }, async (fazenda, roteiro) => {
    fazenda._runSingleProfile = async () => { throw new Error('quebrou'); };
    await rodar(CONFIG)(fazenda, roteiro);
  }),
];

const CENAS_DOS_EXTRAS = [
  cena('scripts furtivos por perfil', {}, (fazenda, roteiro) => {
    const casos = [{ platform: 'mac' }, { platform: 'linux' }, {}, { platform: 'ios' }, { platform: 'windows' },
      { platform: 'windows', canvasNoise: false, webglNoise: false, audioNoise: false, webglImageNoise: false, mediaDeviceNoise: false, clientRectsNoise: false,
        speechVoicesNoise: false, webgpuMode: 'disabled', cpuCores: '12', ramSize: '32', doNotTrack: 'enable', portScanProtection: 'disable', webglVendor: 'V', webglRenderer: 'R', platformStr: 'P' },
      { cpuCores: 'Auto', ramSize: 'Auto', doNotTrack: 'disable', canvasNoiseSeed: 5, webglNoiseSeed: 6, audioNoiseSeed: 0.5 }];
    for (const caso of casos) {
      const script = fazenda.getStealthSpoofScript(caso);
      roteiro.anotar('script', script, caso);
    }
    roteiro.anotar('script completo', fazenda.getStealthSpoofScript({ platform: 'android' }).split('\n').length);
  }),
  cena('cópia de segurança e restauração', { perfis: [perfil('p1')] }, async (fazenda, roteiro) => {
    await chamar(roteiro, 'backup', () => fazenda.backupProfiles());
    const texto = await fazenda._encrypt(JSON.stringify([perfil('r1')]));
    await chamar(roteiro, 'restore texto', () => fazenda.restoreProfiles(texto));
    roteiro.arquivos['/backup.nvm'] = await fazenda._encrypt(JSON.stringify({ profiles: [perfil('r2')] }));
    await chamar(roteiro, 'restore arquivo', () => fazenda.restoreProfiles('/backup.nvm'));
    roteiro.arquivos['/vazio.nvm'] = await fazenda._encrypt(JSON.stringify({}));
    await chamar(roteiro, 'restore sem perfis', () => fazenda.restoreProfiles('/vazio.nvm'));
    await chamar(roteiro, 'restore inválido', () => fazenda.restoreProfiles('sem-dois-pontos'));
    await chamar(roteiro, 'restore adulterado', () => fazenda.restoreProfiles('00:zz'));
  }),
  cena('chave sem uuid do sistema e falha ao cifrar', { uuid: { hardware: 'hw' }, perfis: [perfil('p1')] }, async (fazenda, roteiro) => {
    await chamar(roteiro, 'encrypt', () => fazenda._encrypt('abc'));
    roteiro.cena.uuid = {};
    await chamar(roteiro, 'encrypt padrão', () => fazenda._encrypt('abc'));
    roteiro.falhas.uuid = 'sem si';
    await chamar(roteiro, 'encrypt sem si', () => fazenda._encrypt('abc'));
    await chamar(roteiro, 'encrypt inválido', () => fazenda._encrypt(null));
    await chamar(roteiro, 'backup falha', () => fazenda.backupProfiles());
    roteiro.falhas.writeFileSync = 'cheio';
    fazenda._encrypt = async () => 'x:y';
    await chamar(roteiro, 'backup sem disco', () => fazenda.backupProfiles());
  }),
  cena('status, log e IPC', { perfis: [perfil('p1', { email: 'e@x' })] }, async (fazenda, roteiro) => {
    fazenda._updateStatus('p1', 'success');
    fazenda._updateStatus('p1', 'running');
    fazenda._updateStatus('nada', 'error');
    fazenda._log('p1', 'mensagem');
    fazenda.registerIPC();
    const ipc = roteiro.ipc;
    await chamar(roteiro, 'farm:load-profiles', () => ipc.get('farm:load-profiles')());
    await chamar(roteiro, 'farm:add-profile', () => ipc.get('farm:add-profile')(null, { name: 'n', browser: 'b' }));
    await chamar(roteiro, 'farm:add-profile vazio', () => ipc.get('farm:add-profile')(null, undefined));
    await chamar(roteiro, 'farm:update-profile', () => ipc.get('farm:update-profile')(null, { profileId: 'p1', patch: { a: 1 } }));
    await chamar(roteiro, 'farm:delete-profile', () => ipc.get('farm:delete-profile')(null, 'p1'));
    await chamar(roteiro, 'farm:open-login-browser', () => ipc.get('farm:open-login-browser')(null, { profileId: 'nada' }));
    await chamar(roteiro, 'farm:check-proxy', () => ipc.get('farm:check-proxy')(null, 'nada'));
    const run = chamar(roteiro, 'farm:run', () => ipc.get('farm:run')(null, { ...CONFIG, profileIds: ['nada'] }));
    await roteiro.avancar(1000);
    await run;
    fazenda.runFarm = () => Promise.reject(new Error('quebrou'));
    await chamar(roteiro, 'farm:run com erro', () => ipc.get('farm:run')(null, CONFIG));
    fazenda.runFarm = () => { throw new Error('síncrono'); };
    await chamar(roteiro, 'farm:run síncrono', () => ipc.get('farm:run')(null, CONFIG));
    await chamar(roteiro, 'farm:stop', () => ipc.get('farm:stop')());
    await chamar(roteiro, 'farm:backup', () => ipc.get('farm:backup')());
    await chamar(roteiro, 'farm:restore', () => ipc.get('farm:restore')(null, 'x'));
    roteiro.anotar('estado', estadoDaFazenda(fazenda));
  }),
  cena('stopFarm fecha janelas e contextos', { janelaPrincipal: false }, (fazenda, roteiro) => {
    fazenda.profileWindows.set('a', { isDestroyed: () => false, close: () => roteiro.anotar('fecha a') });
    fazenda.profileWindows.set('b', { isDestroyed: () => true, close: () => roteiro.anotar('fecha b') });
    fazenda.playwrightContexts.set('c', { close: () => { roteiro.anotar('fecha c'); return Promise.reject(new Error('x')); } });
    fazenda.stopFarm();
    fazenda._updateStatus('a', 'idle');
    fazenda._log('a', 'sem janela');
  }),
];

const CENAS = [...CENAS_DOS_PERFIS, ...CENAS_DO_LOGIN, ...CENAS_DA_REDE, ...CENAS_DA_EXECUCAO, ...CENAS_DOS_EXTRAS];

module.exports = { CENAS };
