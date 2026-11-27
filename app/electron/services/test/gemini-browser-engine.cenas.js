'use strict';
const { descrever } = require('./gemini-browser-engine.palco');

const AUTH = 'gemini_account_auth.json';
const MODELO = 'gemini_browser_model.json';

function resposta(parts) {
  return JSON.stringify({ candidates: [{ content: { parts } }] });
}

function anotarEstado(palco) {
  const motor = palco.motor;
  palco.anotar(`estado ${descrever([motor.getAuthStatus(), motor.getSelectedModel(), motor.AVAILABLE_MODELS])}`);
}

async function carregarLogado(palco) {
  palco.cookiesDaSessao = [{ name: 'SID', value: 's' }];
  palco.carregar();
  await palco.assentar();
  palco.registro.length = 0;
  return palco.motor;
}

async function enviar(palco, pedido) {
  palco.anotar(`resultado ${descrever(await palco.motor.sendMessage(pedido))}`);
}

async function abrirLogin(palco) {
  const promessa = palco.motor.openGoogleLoginWindow({ janela: 'principal' });
  await palco.assentar();
  return { promessa };
}

async function anotarLogin(palco, promessa) {
  palco.anotar(`login ${descrever(await promessa)}`);
}

function prepararLogin(palco, cookies) {
  palco.navegador.context = palco.criarContexto(cookies);
}

async function navegar(palco, url, quadro) {
  palco.urlDoQuadro = url;
  await palco.pagina.emitir('framenavigated', quadro || palco.pagina.mainFrame());
  await palco.assentar();
}

const COOKIES_DO_NAVEGADOR = [
  { name: 'SID', value: '1', domain: '.google.com', path: '/', secure: true, httpOnly: true, expires: 1999999999 },
  { name: 'NID', value: '2', domain: 'gemini.google.com', expires: -1 },
  { name: 'OSID', value: '3', domain: '..x.com', path: '/a', expires: 0, secure: false },
  { name: 'Z', value: '4', domain: 'z.com' },
];

const cenas = {
  'carrega sem arquivos com o app pronto e sem cookie de sessao': async palco => {
    palco.carregar();
    await palco.assentar();
    anotarEstado(palco);
  },

  'carrega login e modelo salvos com cookie OSID': async palco => {
    palco.gravarArquivo(AUTH, { loggedIn: 1, email: 'conta@exemplo' });
    palco.gravarArquivo(MODELO, { model: 'gemini-4-argon' });
    palco.cookiesDaSessao = [{ name: 'x', value: '1' }, { name: 'OSID', value: '2' }];
    palco.carregar();
    await palco.assentar();
    anotarEstado(palco);
  },

  'carrega arquivos corrompidos ou vazios': async palco => {
    palco.gravarArquivo(AUTH, '{quebrado');
    palco.gravarArquivo(MODELO, {});
    palco.cookiesDaSessao = [{ name: '__Secure-1PSID', value: 'v' }];
    palco.carregar();
    await palco.assentar();
    anotarEstado(palco);
  },

  'carrega login salvo sem email e preferencia sem modelo': async palco => {
    palco.gravarArquivo(AUTH, { loggedIn: false });
    palco.gravarArquivo(MODELO, { model: '' });
    palco.carregar();
    await palco.assentar();
    anotarEstado(palco);
  },

  'app ainda nao pronto espera o whenReady': async palco => {
    palco.pronto = false;
    palco.carregar();
    await palco.assentar();
    anotarEstado(palco);
    palco.ficarPronto();
    await palco.assentar();
    anotarEstado(palco);
  },

  'cookies da sessao falham no arranque': async palco => {
    palco.cookiesDaSessao = new Error('sessao travada');
    palco.carregar();
    await palco.assentar();
    anotarEstado(palco);
  },

  'troca o user agent de todo pedido da sessao': async palco => {
    palco.carregar();
    await palco.assentar();
    const detalhes = { url: 'https://gemini.google.com', requestHeaders: { 'User-Agent': 'Electron', Accept: '*/*' } };
    palco.trocarCabecalhos(detalhes, (...argumentos) => palco.anotar(`callback ${descrever(argumentos)}`));
  },

  'checkAutoLogin com cada cookie de sessao e com e sem email': async palco => {
    palco.gravarArquivo(AUTH, { loggedIn: false, email: 'e@x' });
    palco.carregar();
    await palco.assentar();
    const variantes = [[], [{ name: 'SID' }], [{ name: '__Secure-1PSID' }], [{ name: 'OSID' }], [{ name: 'HSID' }]];
    for (const cookies of variantes) {
      palco.cookiesDaSessao = cookies;
      palco.anotar(`check ${descrever(await palco.motor.checkAutoLogin())}`);
      anotarEstado(palco);
    }
    await palco.motor.logoutSession();
    palco.cookiesDaSessao = [{ name: 'SID' }];
    palco.anotar(`check ${descrever(await palco.motor.checkAutoLogin())}`);
  },

  'heartbeat derruba o login quando a sessao some': async palco => {
    await carregarLogado(palco);
    await palco.rodarIntervalos();
    anotarEstado(palco);
    palco.cookiesDaSessao = [];
    await palco.rodarIntervalos();
    anotarEstado(palco);
    palco.cookiesDaSessao = [{ name: 'SID' }];
    await palco.rodarIntervalos();
    anotarEstado(palco);
  },

  'setSelectedModel grava a preferencia': async palco => {
    palco.carregar();
    palco.motor.setSelectedModel('gemini-4-argon');
    palco.lerArquivo(MODELO);
    anotarEstado(palco);
    palco.motor.setSelectedModel(undefined);
    palco.lerArquivo(MODELO);
  },

  'logoutSession limpa a sessao e falha quando a limpeza falha': async palco => {
    await carregarLogado(palco);
    palco.anotar(`logout ${descrever(await palco.motor.logoutSession())}`);
    palco.lerArquivo(AUTH);
    anotarEstado(palco);
    palco.falhaAoLimpar = new Error('disco cheio');
    palco.anotar(`logout ${descrever(await palco.motor.logoutSession())}`);
  },

  'sendMessage sem login': async palco => {
    palco.carregar();
    await palco.assentar();
    await enviar(palco, { prompt: 'oi' });
  },

  'sendMessage com texto na primeira tentativa': async palco => {
    await carregarLogado(palco);
    palco.respostasDaPagina = [resposta([{ text: 'ola ' }, { text: 'mundo' }, {}])];
    await enviar(palco, { prompt: 'diga ola', apiKey: 'k' });
  },

  'sendMessage devolve imagens e texto vazio': async palco => {
    await carregarLogado(palco);
    palco.respostasDaPagina = [resposta([{ inlineData: { mimeType: 'image/png', data: 'AAA', extra: 1 } }, { text: '' }])];
    await enviar(palco, { prompt: 'desenhe', model: 'gemini-pro' });
  },

  'sendMessage com historico longo e imagem em data url': async palco => {
    await carregarLogado(palco);
    const history = Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? 'model' : 'user', text: `m${i}` }));
    palco.respostasDaPagina = [resposta([{ text: 'ok' }])];
    await enviar(palco, { prompt: 'segue', history, imageBase64: 'data:image/jpeg;base64,QUJD', model: 'gemini-advanced' });
  },

  'sendMessage com historico nulo, vazio e imagem sem prefixo': async palco => {
    await carregarLogado(palco);
    palco.respostasDaPagina = [resposta([{ text: 'a' }]), resposta([{ text: 'b' }]), resposta([{ text: 'c' }])];
    await enviar(palco, { prompt: 'p1', history: null, imageBase64: 'QUJD' });
    await enviar(palco, { prompt: 'p2', history: [] });
    await enviar(palco, { prompt: '', history: [{ role: 'user', text: 'h' }] });
  },

  'sendMessage com o apelido gemini-flash': async palco => {
    await carregarLogado(palco);
    palco.respostasDaPagina = [resposta([{ text: 'rapido' }])];
    await enviar(palco, { prompt: 'depressa', model: 'gemini-flash' });
  },

  'sendMessage com resposta vazia, sem candidatos e com candidatos vazios': async palco => {
    await carregarLogado(palco);
    palco.respostasDaPagina = ['', '{}', JSON.stringify({ candidates: [] }), resposta([{ text: 'enfim' }])];
    await enviar(palco, { prompt: 'sem nada' });
    palco.respostasDaPagina = ['', '{}', JSON.stringify({ candidates: [] }), '', '{}', '{"candidates":[]}'];
    await enviar(palco, { prompt: 'nunca vem' });
    palco.respostasDaPagina = ['{}', '{}', '{}', '{}', '{}', ''];
    await enviar(palco, { prompt: 'termina vazio' });
  },

  'sendMessage cai de tentativa em tentativa ate acertar': async palco => {
    await carregarLogado(palco);
    palco.respostasDaPagina = [
      JSON.stringify({ error: { message: 'recusado' } }),
      JSON.stringify({ error: { code: 7 } }),
      'nao e json',
      new Error('pagina caiu'),
      resposta([]),
      resposta([{ text: 'enfim' }]),
    ];
    await enviar(palco, { prompt: 'insista', model: 'modelo-fora-do-mapa' });
  },

  'sendMessage esgota todas as tentativas com erro': async palco => {
    await carregarLogado(palco);
    palco.respostasDaPagina = Array.from({ length: 6 }, (_, i) => JSON.stringify({ error: { message: `falha ${i}` } }));
    await enviar(palco, { prompt: 'nada', model: 'gemini-3.8-flash' });
  },

  'sendMessage esgota todas as tentativas sem texto nem erro': async palco => {
    await carregarLogado(palco);
    palco.respostasDaPagina = Array.from({ length: 6 }, () => resposta([{ text: '' }]));
    await enviar(palco, { prompt: 'vazio' });
  },

  'sendMessage espera 120 s quando a pagina nao carrega': async palco => {
    await carregarLogado(palco);
    palco.paginaCarrega = false;
    palco.motor.setSelectedModel('gemini-4-argon');
    palco.janelasDestruidas = true;
    palco.anotar(`resultado ${descrever(await palco.ateTerminar(palco.motor.sendMessage({ prompt: 'lento' })))}`);
  },

  'sendMessage fecha a janela so se ela ainda existe': async palco => {
    await carregarLogado(palco);
    palco.janelasDestruidas = true;
    palco.respostasDaPagina = [new Error('quebrou'), resposta([{ text: 'x' }])];
    await enviar(palco, { prompt: 'janela' });
  },

  'script da pagina leva o pedido escapado': async palco => {
    await carregarLogado(palco);
    palco.guardarScripts = true;
    palco.scripts = [];
    const pedidos = ['$& $1 $$ $` $\'', 'aspas "duplas" e \'simples\' e `crase` ${x}', '</script>\n\\n linha nova ✅', '__PEDIDO__'];
    for (const prompt of pedidos) {
      palco.respostasDaPagina = [resposta([{ text: 'ok' }])];
      await enviar(palco, { prompt });
    }
    palco.anotar(`trecho ${palco.scripts[0].slice(0, 400)}`);
    palco.anotar(`fim ${palco.scripts[0].slice(-300)}`);
  },

  'login com navegador desligado lanca, navega e transfere cookies': async palco => {
    await carregarLogado(palco);
    await palco.motor.logoutSession();
    palco.navegador.isInitialized = false;
    palco.contextoAoLancar = palco.criarContexto(COOKIES_DO_NAVEGADOR);
    palco.cookieQueFalha = 'NID';
    const { promessa } = await abrirLogin(palco);
    await navegar(palco, 'https://gemini.google.com/app', { url: () => 'https://gemini.google.com/' });
    await navegar(palco, 'https://accounts.google.com/x');
    await navegar(palco, 'https://gemini.google.com/app');
    await anotarLogin(palco, promessa);
    await palco.pagina.emitir('close');
    await navegar(palco, 'https://gemini.google.com/app');
    palco.lerArquivo(AUTH);
    anotarEstado(palco);
  },

  'login enquanto outro esta aberto e depois de fechar': async palco => {
    await carregarLogado(palco);
    prepararLogin(palco, []);
    const { promessa: primeiro } = await abrirLogin(palco);
    await anotarLogin(palco, palco.motor.openGoogleLoginWindow(null));
    palco.falhaAoFecharPagina = new Error('ja fechada');
    await palco.pagina.emitir('close');
    await anotarLogin(palco, primeiro);
    await palco.pagina.emitir('close');
    const { promessa: segundo } = await abrirLogin(palco);
    await palco.pagina.emitir('close');
    await anotarLogin(palco, segundo);
  },

  'login sem contexto do navegador libera a proxima tentativa': async palco => {
    await carregarLogado(palco);
    await anotarLogin(palco, palco.motor.openGoogleLoginWindow());
    palco.falhaAoLancar = new Error('chromium ausente');
    palco.navegador.isInitialized = false;
    await anotarLogin(palco, palco.motor.openGoogleLoginWindow());
    palco.navegador.isInitialized = true;
    palco.playwright = new Error('Cannot find module playwright');
    await anotarLogin(palco, palco.motor.openGoogleLoginWindow());
  },

  'login falha no goto': async palco => {
    await carregarLogado(palco);
    prepararLogin(palco, []);
    palco.falhaNoGoto = new Error('sem rede');
    await anotarLogin(palco, palco.motor.openGoogleLoginWindow());
    await anotarLogin(palco, palco.motor.openGoogleLoginWindow());
  },

  'login falha ao ler os cookies do navegador': async palco => {
    await carregarLogado(palco);
    prepararLogin(palco, new Error('contexto fechado'));
    const { promessa } = await abrirLogin(palco);
    await navegar(palco, 'https://gemini.google.com');
    await anotarLogin(palco, promessa);
    anotarEstado(palco);
  },

  'login com cookie sem dominio falha a transferencia': async palco => {
    await carregarLogado(palco);
    await palco.motor.logoutSession();
    prepararLogin(palco, [{ name: 'A', value: '1', domain: 'a.com' }, { name: 'B', value: '2' }]);
    const { promessa } = await abrirLogin(palco);
    await navegar(palco, 'https://gemini.google.com.br');
    await anotarLogin(palco, promessa);
    anotarEstado(palco);
  },
};

module.exports = { cenas };
