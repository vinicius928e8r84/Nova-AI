'use strict';

const PLATAFORMAS = ['mac', 'linux', 'android', 'ios', 'windows', undefined, 'freebsd'];

const PERFIL_COMPLETO = {
  id: 'profile_01',
  platform: 'windows',
  cpuCores: '8',
  ramSize: '16',
  platformStr: 'Win32',
  webglVendor: 'Google Inc. (NVIDIA)',
  webglRenderer: 'NVIDIA GeForce RTX 3060',
  deviceName: 'DESKTOP-ABC',
  macAddress: '00-1B-21-AA-BB-CC',
  screenResolution: '1920x1080',
  windowMode: 'maximized',
  canvasNoiseSeed: 0,
  webglNoiseSeed: 0,
  audioNoiseSeed: 0,
  virtualCamId: 'cam',
  virtualCamLabel: 'Cam',
  virtualMicId: 'mic',
  virtualMicLabel: 'Mic',
  virtualSpeakerId: 'spk',
  virtualSpeakerLabel: 'Spk',
};

const carregar = ({ servico }) => servico.loadProfiles();
const arquivoComPerfis = perfis => JSON.stringify(perfis);

const cenasDeEspecificacoes = PLATAFORMAS.map(plataforma => ({
  nome: `perfil vazio da plataforma ${plataforma} recebe as especificações sorteadas`,
  arquivo: arquivoComPerfis([{ id: 'profile_01', platform: plataforma }]),
  roteiro: carregar,
}));

const doze = plataforma => Array.from({ length: 12 }, (_, i) => ({ id: `profile_${i + 1}`, platform: plataforma }));

const cenasDeVariasEspecificacoes = ['windows', 'android'].map(plataforma => ({
  nome: `especificações: doze perfis vazios do ${plataforma} cobrem as listas de sorteio`,
  arquivo: arquivoComPerfis(doze(plataforma)),
  roteiro: carregar,
}));

const cenasDeSorteioPorCampo = [
  ['núcleos e memória Auto são sorteados de novo', { cpuCores: 'Auto', ramSize: 'Auto' }],
  ['nome, MAC e resolução antigos são trocados', { deviceName: 'USER-PC-X6NAGE1', macAddress: '00-1B-21-29-FE-FA', screenResolution: 'Based on User-Agent' }],
  ['sem o fornecedor do WebGL, a plataforma toda é refeita', { platform: 'android', webglVendor: '' }],
  ['sem a string da plataforma, o WebGL é refeito', { platform: 'mac', platformStr: '' }],
  ['sem o renderizador, o WebGL é refeito', { platform: 'windows', webglRenderer: '' }],
  ['sementes nulas ou indefinidas são sorteadas e o zero fica', { canvasNoiseSeed: null, webglNoiseSeed: undefined, audioNoiseSeed: 0 }],
  ['identificadores e rótulos de câmera, microfone e alto-falante faltando são criados', { virtualCamId: '', virtualMicLabel: '', virtualSpeakerId: null }],
].map(([nome, mudanca]) => ({
  nome: `especificações: ${nome}`,
  arquivo: arquivoComPerfis([{ ...PERFIL_COMPLETO, ...mudanca }]),
  roteiro: carregar,
}));

const cenasDeResolucaoPadrao = ['android', 'ios', 'mac', 'linux', 'windows'].map(plataforma => ({
  nome: `especificações: resolução padrão do ${plataforma} com a resolução antiga`,
  arquivo: arquivoComPerfis([{ ...PERFIL_COMPLETO, platform: plataforma, screenResolution: 'Based on User-Agent', windowMode: 'custom' }]),
  roteiro: carregar,
}));

const TELA = { bounds: { width: 2560, height: 1440 } };

const CASOS_DE_JANELA = [
  ['maximizada no celular', { platform: 'android', windowMode: 'maximized' }, TELA],
  ['maximizada no ios', { platform: 'ios', windowMode: 'maximized' }, TELA],
  ['maximizada no desktop com a tela lida', { platform: 'mac', windowMode: 'maximized' }, TELA],
  ['maximizada sem plataforma', { windowMode: 'maximized' }, TELA],
  ['maximizada com tela de largura zero', { platform: 'linux', windowMode: 'maximized' }, { bounds: { width: 0, height: 0 } }],
  ['maximizada sem bounds', { platform: 'linux', windowMode: 'maximized' }, {}],
  ['maximizada sem tela', { platform: 'linux', windowMode: 'maximized' }, null],
  ['maximizada com a leitura da tela falhando', { platform: 'windows', windowMode: 'maximized' }, 'erro'],
  ['resolução 800x600', { screenResolution: '800x600' }, TELA],
  ['resolução abcxdef', { screenResolution: 'abcxdef' }, TELA],
  ['resolução 0x0', { screenResolution: '0x0' }, TELA],
  ['resolução 1024x', { screenResolution: '1024x' }, TELA],
  ['resolução maximizada ignora a resolução', { windowMode: 'maximized', platform: 'android', screenResolution: '800x600' }, TELA],
  ['sem resolução no celular', { platform: 'android' }, TELA],
  ['sem resolução no ios', { platform: 'ios' }, TELA],
  ['sem resolução no mac', { platform: 'mac' }, TELA],
  ['sem resolução no linux', { platform: 'linux' }, TELA],
  ['sem resolução no windows', { platform: 'windows' }, TELA],
  ['sem resolução e sem plataforma', {}, TELA],
  ['resolução sem x', { screenResolution: '1280', platform: 'mac' }, TELA],
];

const cenasDeJanela = CASOS_DE_JANELA.map(([nome, perfil, tela]) => ({
  nome: `tamanho da janela: ${nome}`,
  tela,
  roteiro: ({ servico }) => servico._getProfileWindowSize(perfil),
}));

const cenasDePerfilNovo = [
  ['seis perfis padrão', ({ servico }) => servico._makeDefaultProfiles(6)],
  ['nenhum perfil padrão', ({ servico }) => servico._makeDefaultProfiles(0)],
  ['dez perfis padrão voltam aos primeiros user agents', ({ servico }) => servico._makeDefaultProfiles(10)],
].map(([nome, roteiro]) => ({ nome: `perfis padrão: ${nome}`, roteiro }));

const adicionando = (nome, perfis, ...argumentos) => ({
  nome: `perfil novo: ${nome}`,
  perfis,
  roteiro: ({ servico }) => ({ perfil: servico.addProfile(...argumentos), perfis: servico.profiles.map(item => item && item.id) }),
});

const cenasDeAdicionar = [
  adicionando('sem perfis, sem nome e sem navegador', []),
  adicionando('com o nome e o navegador dados', [{ id: 'profile_01' }], 'Meu perfil', 'firefox'),
  adicionando('navegador vazio vira chrome', [{ id: 'profile_01' }], 'Outro', ''),
  adicionando('o próximo número vem do maior id, mesmo com buraco', [{ id: 'profile_03' }, { id: 'profile_10' }, { id: 'profile_02' }]),
  adicionando('ids fora do padrão e perfis vazios não contam', [{ id: 'abc' }, { id: 'profile_x' }, null, {}, { id: 'profile_7' }]),
  adicionando('só ids fora do padrão começam em um', [{ id: 'abc' }, null]),
  adicionando('o user agent usa o tamanho da lista, não o número', Array.from({ length: 9 }, (_, i) => ({ id: `profile_${i + 20}` }))),
  adicionando('numeração de três dígitos', [{ id: 'profile_99' }, { id: 'profile_100' }]),
];

const PERFIL_ANTIGO = { id: 'profile_01', name: 'Profile 01', platform: 'android', cpuCores: 'Auto' };

const cenasDeCarga = [
  { nome: 'carga: sem arquivo cria os seis perfis e grava', roteiro: carregar },
  { nome: 'carga: JSON quebrado volta aos seis perfis e grava', arquivo: '{quebrado', roteiro: carregar },
  { nome: 'carga: lista vazia não grava', arquivo: '[]', roteiro: carregar },
  { nome: 'carga: perfil incompleto é completado e gravado', arquivo: arquivoComPerfis([PERFIL_ANTIGO]), roteiro: carregar },
  { nome: 'carga: perfis completos não são regravados', arquivo: arquivoComPerfis([PERFIL_COMPLETO, { ...PERFIL_COMPLETO, id: 'profile_02' }]), roteiro: carregar },
  { nome: 'carga: item nulo na lista passa sem erro', arquivo: arquivoComPerfis([null, PERFIL_COMPLETO]), roteiro: carregar },
  { nome: 'carga: o arquivo não é uma lista e cai nos seis perfis', arquivo: '{"a":1}', roteiro: carregar },
];

const NAVEGADORES = ['getChromeExecutablePath', 'getBraveExecutablePath', 'getVivaldiExecutablePath', 'getFirefoxExecutablePath'];
const buscarTodos = ({ servico }) => Object.fromEntries(NAVEGADORES.map(metodo => [metodo, servico[metodo]()]));

const cenasDeExecutaveis = [
  { nome: 'executáveis: no Windows sem nada instalado', roteiro: buscarTodos },
  {
    nome: 'executáveis: no Windows com cada navegador no Program Files',
    existentes: [
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
      'C:/Program Files/Vivaldi/Application/vivaldi.exe',
      'C:/Program Files/Mozilla Firefox/firefox.exe',
    ],
    roteiro: buscarTodos,
  },
  {
    nome: 'executáveis: no Windows com cada navegador no Program Files (x86) e no perfil do usuário',
    existentes: [
      'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
      'C:/Local/BraveSoftware/Brave-Browser/Application/brave.exe',
      'C:/Program Files (x86)/Vivaldi/Application/vivaldi.exe',
      'C:/Local/Mozilla Firefox/firefox.exe',
    ],
    roteiro: buscarTodos,
  },
  {
    nome: 'executáveis: no Windows com o Chrome do usuário e o Vivaldi da pasta do app',
    existentes: ['C:/Local/Google/Chrome/Application/chrome.exe', '/RES/browsers/vivaldi/vivaldi.exe'],
    roteiro: buscarTodos,
  },
  {
    nome: 'executáveis: no Windows empacotado com o Chromium embutido',
    empacotado: '/RES/browsers/chromium-1208/chrome-win64/chrome.exe',
    existentes: [
      '/RES/browsers/chromium-1208/chrome-win64/chrome.exe',
      '/RES/browsers/brave/brave.exe',
      '/APP/browsers/firefox/firefox.exe',
      '<app>/browsers/vivaldi/vivaldi.exe',
    ],
    roteiro: buscarTodos,
  },
  {
    nome: 'executáveis: no Windows com os navegadores só na pasta do app',
    existentes: ['/APP/browsers/chrome/chrome.exe', '/APP/browsers/brave/brave.exe', '<electron>/browsers/vivaldi/vivaldi.exe', '/APP/browsers/firefox/firefox.exe'],
    roteiro: buscarTodos,
  },
  { nome: 'executáveis: no Windows sem pasta de recursos e sem pasta local', semRecursos: true, semLocal: true, roteiro: buscarTodos },
  { nome: 'executáveis: no Mac vêm do mac-native', sistema: 'darwin', roteiro: buscarTodos },
];

const GEO_POR_PAIS = ['US', 'GB', 'PK', 'FR', 'DE', 'CA', 'AU', 'IN', 'AE', 'SA', 'br', 'gb', 'XX', '', undefined, null];

const respostaDoGeo = (countryCode, extras = {}) => JSON.stringify({ status: 'success', timezone: 'America/Sao_Paulo', lat: 1.5, lon: 2.5, countryCode, ...extras });
const consultandoGeo = ({ servico }, perfil = { id: 'profile_01', proxy: '' }) => servico.getOptimalGeoDetails(perfil);

const cenasDeIdioma = [
  ...GEO_POR_PAIS.map(pais => ({
    nome: `idioma do país: ${pais === undefined ? 'sem país' : JSON.stringify(pais)}`,
    resposta: respostaDoGeo(pais),
    roteiro: consultandoGeo,
  })),
  { nome: 'idioma do país: resposta sem fuso, latitude e longitude usa os padrões', resposta: JSON.stringify({ status: 'success' }), roteiro: consultandoGeo },
  { nome: 'idioma do país: status diferente de success dá nulo', resposta: JSON.stringify({ status: 'fail' }), roteiro: consultandoGeo },
  { nome: 'idioma do país: JSON quebrado dá nulo', resposta: 'não é json', roteiro: consultandoGeo },
  { nome: 'idioma do país: erro de rede dá nulo', resposta: 'erro', roteiro: consultandoGeo },
];

const CENAS = [
  ...cenasDeEspecificacoes,
  ...cenasDeVariasEspecificacoes,
  ...cenasDeSorteioPorCampo,
  ...cenasDeResolucaoPadrao,
  ...cenasDeJanela,
  ...cenasDePerfilNovo,
  ...cenasDeAdicionar,
  ...cenasDeCarga,
  ...cenasDeExecutaveis,
  ...cenasDeIdioma,
];

module.exports = { CENAS };
