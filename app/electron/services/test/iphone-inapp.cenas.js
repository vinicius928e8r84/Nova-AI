'use strict';

const ID = 'ios-0123456789ABCDEF';
const PEDIDO = { id: ID, name: 'iPhone 8 Plus (iOS 16.7.16)' };
const SENHA_DIGITADA = 'senha-de-teste';
const URL_DO_CONSOLE = 'http://127.0.0.1:8765/';

const CANAL_DE_PREPARO = 'physical-mobile:iphone-prepare';
const CANAL_DA_URL = 'physical-mobile:ios-console-url';
const CANAL_DA_JANELA = 'physical-mobile:ios-console';
const CANAL_DE_INICIO = 'physical-mobile:start-stream';
const CANAL_DE_ABRIR_O_CONSOLE = 'nova:iphone-console-open';
const CANAL_DE_ABRIR_O_MODAL = 'nova:iphone-setup-open';

const TIPOS_DE_FALHA = {
  comErro: { success: false, error: 'O iPhone não respondeu.' },
  comMensagem: { success: false, message: 'Mensagem do app.' },
  semTexto: { success: false },
  nulo: null,
  rejeitaComTexto: new Error('rede caiu'),
  rejeitaSemTexto: new Error(''),
};

const respostaPor = (porCanal) => (canal, argumento) => {
  if (!(canal in porCanal)) return { success: true };
  const resposta = porCanal[canal];
  return typeof resposta === 'function' ? resposta(argumento) : resposta;
};

const depoisDe = (milissegundos, resposta) => () => new Promise((resolver) => setTimeout(() => resolver(resposta), milissegundos));
const conectar = (contexto) => contexto.attach({ ipcRenderer: contexto.ipc, invoke: contexto.invocar });
const abrirModal = (contexto, pedido = PEDIDO) => conectar(contexto).open(pedido);
const abrirConsoleSozinho = (contexto, ...pedido) => contexto.ipc.ouvintes.get(CANAL_DE_ABRIR_O_CONSOLE)({}, ...(pedido.length ? pedido : [PEDIDO]));
const abrirModalPeloCanal = (contexto, ...pedido) => contexto.ipc.ouvintes.get(CANAL_DE_ABRIR_O_MODAL)({}, ...(pedido.length ? pedido : [PEDIDO]));
const teclarEscape = (contexto) => contexto.documento.teclar('Escape');
const webviewDe = (contexto) => contexto.host().querySelector('.nvios-webview-wrap').filhos.find((filho) => filho.tagName === 'WEBVIEW') || null;
const invocacoes = (contexto) => contexto.diario.filter((item) => item[0] === 'invoke');
const focos = (contexto) => contexto.diario.filter((item) => item[0] === 'focus');

const descreverWebview = (visao) => visao && {
  tag: visao.tagName, classe: visao.className, src: visao.getAttribute('src'), allowpopups: visao.getAttribute('allowpopups'), ouvintes: [...visao.ouvintes.keys()],
};

async function digitarEEnviar(contexto, senha = SENHA_DIGITADA) {
  contexto.host().querySelector('#nvios-pass').value = senha;
  contexto.enviarFormulario();
  await contexto.avancar(0);
}

async function seguirParaOConsole(contexto) {
  contexto.responder = respostaPor({ [CANAL_DA_URL]: { success: true, url: URL_DO_CONSOLE } });
  await digitarEEnviar(contexto);
  contexto.clicar('.nvios-console-open');
  await contexto.avancar(0);
}

async function falharNoPreparo(contexto, resposta) {
  contexto.responder = respostaPor({ [CANAL_DE_PREPARO]: resposta });
  abrirModal(contexto);
  await contexto.avancar(30);
  contexto.diario.length = 0;
  await digitarEEnviar(contexto);
  const saida = { foto: contexto.foto(), diario: contexto.diario.slice() };
  teclarEscape(contexto);
  return saida;
}

async function abrirControleComResposta(contexto, resposta) {
  contexto.responder = respostaPor({ [CANAL_DA_URL]: resposta });
  abrirModal(contexto);
  contexto.diario.length = 0;
  contexto.clicar('.nvios-console-open');
  const emAndamento = contexto.foto()['.nvios-console-open'];
  await contexto.avancar(0);
  const saida = { emAndamento, foto: contexto.foto(), visao: descreverWebview(webviewDe(contexto)), diario: contexto.diario.slice() };
  teclarEscape(contexto);
  return saida;
}

async function abrirEmJanelaComResposta(contexto, resposta) {
  contexto.responder = respostaPor({ [CANAL_DA_JANELA]: resposta });
  abrirModal(contexto);
  contexto.diario.length = 0;
  contexto.clicar('.nvios-console-window');
  const emAndamento = contexto.foto()['.nvios-console-window'];
  await contexto.avancar(0);
  const saida = { emAndamento, hosts: contexto.hosts().length, foto: contexto.host() ? contexto.foto() : null, diario: contexto.diario.slice() };
  if (contexto.host()) teclarEscape(contexto);
  return saida;
}

async function abrirConsoleSozinhoComResposta(contexto, resposta) {
  contexto.responder = respostaPor({ [CANAL_DA_URL]: resposta });
  contexto.diario.length = 0;
  abrirConsoleSozinho(contexto);
  await contexto.avancar(0);
  const saida = { foto: contexto.foto(), visao: descreverWebview(webviewDe(contexto)), diario: contexto.diario.slice() };
  teclarEscape(contexto);
  return saida;
}

async function emSerie(cenarios, executar) {
  const saidas = {};
  for (const [nome, cenario] of Object.entries(cenarios)) saidas[nome] = await executar(cenario);
  return saidas;
}

const FORMAS_DE_FECHAR_O_MODAL = (contexto) => ({
  x: () => contexto.clicar('.nvios-setup .nvios-x'),
  concluir: async () => { await digitarEEnviar(contexto); contexto.clicar('.nvios-done'); },
  fundo: () => contexto.host().disparar('mousedown', { target: contexto.host() }),
  dentro: () => contexto.host().disparar('mousedown', { target: contexto.host().querySelector('.nvios-card') }),
  esc: () => teclarEscape(contexto),
  outraTecla: () => contexto.documento.teclar('Enter'),
  botaoDoConsole: async () => { await seguirParaOConsole(contexto); contexto.clicar('.nvios-console-close'); },
});

const FORMAS_DE_USAR_O_CONSOLE_SOZINHO = (contexto) => ({
  janelaCerta: () => contexto.clicar('.nvios-console-window'),
  janelaComErro: () => { contexto.responder = respostaPor({ [CANAL_DA_JANELA]: { success: false, error: 'Janela recusada.' } }); contexto.clicar('.nvios-console-window'); },
  janelaSemErro: () => { contexto.responder = respostaPor({ [CANAL_DA_JANELA]: { success: false } }); contexto.clicar('.nvios-console-window'); },
  janelaRejeita: () => { contexto.responder = respostaPor({ [CANAL_DA_JANELA]: new Error('') }); contexto.clicar('.nvios-console-window'); },
  refazer: () => contexto.clicar('.nvios-console-retry'),
  refazerRejeita: () => { contexto.responder = respostaPor({ [CANAL_DE_INICIO]: new Error('sem app') }); contexto.clicar('.nvios-console-retry'); },
  esc: () => teclarEscape(contexto),
  outraTecla: () => contexto.documento.teclar('Enter'),
  fundo: () => contexto.host().disparar('mousedown', { target: contexto.host() }),
  dentro: () => contexto.host().disparar('mousedown', { target: contexto.host().querySelector('.nvios-card') }),
  botaoFechar: () => contexto.clicar('.nvios-console-close'),
});

const CENAS = [
  {
    nome: 'attach liga os dois canais do app e devolve open; sem invoke usa o ipcRenderer.invoke',
    roteiro: async (contexto) => {
      const { open } = contexto.attach({ ipcRenderer: contexto.ipc });
      open(PEDIDO);
      await contexto.avancar(30);
      await digitarEEnviar(contexto);
      return { canais: [...contexto.ipc.ouvintes.keys()], tipoDoRetorno: typeof open, foto: contexto.foto() };
    },
  },
  {
    nome: 'abrir sem id não faz nada; com id monta o estilo uma vez e o modal com o console escondido',
    roteiro: async (contexto) => {
      const { open } = conectar(contexto);
      open(undefined);
      open({});
      const semHost = contexto.host() === null;
      open(PEDIDO);
      const antesDoFoco = focos(contexto);
      await contexto.avancar(30);
      const estilos = contexto.documento.head.elementos().map((elemento) => [elemento.tagName, elemento.id, elemento.textContent.length]);
      return { semHost, estilos, antesDoFoco, depoisDoFoco: focos(contexto), foto: contexto.foto(), atributos: [...contexto.host().atributos.keys()] };
    },
  },
  {
    nome: 'o rótulo do aparelho usa nome e fim do id, só o id curto ou o texto padrão',
    roteiro: async (contexto) => {
      const { open } = conectar(contexto);
      const pedidos = {
        comNomeEIdLongo: { id: ID, name: ' iPhone 8 ' },
        semNomeEIdLongo: { id: ID },
        semNomeEIdCurto: { id: 'ios-ab' },
        idDeOitoLetras: { id: '12345678', name: '' },
        numeroComoId: { id: 987654321 },
      };
      return emSerie(pedidos, (pedido) => {
        open(pedido);
        const rotulo = contexto.host().querySelector('.nvios-device').textContent;
        teclarEscape(contexto);
        return rotulo;
      });
    },
  },
  {
    nome: 'abrir de novo atualiza o rótulo e foca a senha, e não monta outro modal',
    roteiro: async (contexto) => {
      const { open } = conectar(contexto);
      open(PEDIDO);
      await contexto.avancar(30);
      contexto.diario.length = 0;
      open({ id: 'ios-OUTROIDENTIFICADOR', name: 'Outro nome' });
      const depoisDoNome = contexto.host().querySelector('.nvios-device').textContent;
      open({ id: 'ios-SEMNOME00000001' });
      const depoisSemNome = contexto.host().querySelector('.nvios-device').textContent;
      open({ name: 'sem id' });
      return { hosts: contexto.hosts().length, depoisDoNome, depoisSemNome, rotuloFinal: contexto.host().querySelector('.nvios-device').textContent, focos: focos(contexto) };
    },
  },
  {
    nome: 'enviar sem senha mostra o erro e deixa o campo pronto para tentar de novo',
    roteiro: async (contexto) => {
      abrirModal(contexto);
      contexto.enviarFormulario();
      await contexto.avancar(0);
      return { foto: contexto.foto(), diario: contexto.diario.slice() };
    },
  },
  {
    nome: 'preparar com sucesso mostra o progresso com o tempo passando e depois o resultado',
    responder: respostaPor({ [CANAL_DE_PREPARO]: depoisDe(75000, { success: true, message: 'Conectado!' }) }),
    roteiro: async (contexto) => {
      abrirModal(contexto);
      await digitarEEnviar(contexto);
      const rodando = { foto: contexto.foto(), intervalos: contexto.intervalosAtivos() };
      const tempos = [];
      for (const passo of [1000, 4000, 54500, 15000]) {
        await contexto.avancar(passo);
        tempos.push(contexto.host().querySelector('.nvios-elapsed').textContent);
      }
      await contexto.avancar(5000);
      return { rodando, tempos, final: contexto.foto(), intervalos: contexto.intervalosAtivos(), diario: contexto.diario.slice() };
    },
  },
  {
    nome: 'preparar com sucesso sem mensagem usa a frase padrão e leva o foco ao botão do console',
    responder: respostaPor({ [CANAL_DE_PREPARO]: { success: true } }),
    roteiro: async (contexto) => {
      abrirModal(contexto);
      await digitarEEnviar(contexto);
      return { foto: contexto.foto(), focos: focos(contexto) };
    },
  },
  {
    nome: 'enquanto prepara, fechar pelo X, pelo fundo, pelo Esc e enviar de novo não fazem nada',
    responder: respostaPor({ [CANAL_DE_PREPARO]: depoisDe(3000, { success: true }) }),
    roteiro: async (contexto) => {
      abrirModal(contexto);
      await digitarEEnviar(contexto);
      contexto.clicar('.nvios-setup .nvios-x');
      contexto.host().disparar('mousedown', { target: contexto.host() });
      teclarEscape(contexto);
      contexto.enviarFormulario();
      await contexto.avancar(0);
      const durante = { hosts: contexto.hosts().length, invocacoes: invocacoes(contexto).length, foto: contexto.foto() };
      await contexto.avancar(3000);
      return { durante, depois: contexto.foto() };
    },
  },
  {
    nome: 'preparar com falha devolve a senha ao campo e mostra o erro; sem texto usa a frase padrão',
    roteiro: async (contexto) => emSerie({
      ...TIPOS_DE_FALHA,
      comErroDeSenha: { success: false, error: 'Senha SSH errada.' },
      travaDoDpkg: { success: false, error: 'dpkg: erro ao processar o pacote (Segmentation fault)' },
      travaPorSinal: { success: false, error: 'o processo was killed by signal 9' },
    }, (resposta) => falharNoPreparo(contexto, resposta)),
  },
  {
    nome: 'abrir o controle monta a tela embutida e esconde o formulário; carregar e falhar atualizam o aviso',
    roteiro: async (contexto) => {
      abrirModal(contexto);
      contexto.responder = respostaPor({ [CANAL_DA_URL]: { success: true, url: URL_DO_CONSOLE } });
      contexto.clicar('.nvios-console-open');
      const botaoEnquanto = contexto.foto()['.nvios-console-open'];
      await contexto.avancar(0);
      const visao = webviewDe(contexto);
      const aposMontar = contexto.foto();
      visao.disparar('did-fail-load');
      const falhou = contexto.foto()['.nvios-webview-status'];
      visao.disparar('did-finish-load');
      return { botaoEnquanto, visao: descreverWebview(visao), aposMontar, falhou, carregou: contexto.foto()['.nvios-webview-status'], focos: focos(contexto) };
    },
  },
  {
    nome: 'abrir o controle sem webview na página mostra o aviso no lugar da tela',
    ambiente: { webviewIndisponivel: true },
    roteiro: async (contexto) => {
      abrirModal(contexto);
      contexto.responder = respostaPor({ [CANAL_DA_URL]: { success: true, url: URL_DO_CONSOLE } });
      contexto.clicar('.nvios-console-open');
      await contexto.avancar(0);
      return { foto: contexto.foto(), visao: descreverWebview(webviewDe(contexto)), focos: focos(contexto) };
    },
  },
  {
    nome: 'abrir o controle: resposta sem URL, com erro e promessa rejeitada têm cada uma o seu aviso',
    roteiro: async (contexto) => emSerie({ semUrl: { success: true }, ...TIPOS_DE_FALHA }, (resposta) => abrirControleComResposta(contexto, resposta)),
  },
  {
    nome: 'abrir em janela fecha o modal se der certo e mostra o erro do app se não der',
    roteiro: async (contexto) => emSerie({ certo: { success: true }, ...TIPOS_DE_FALHA }, (resposta) => abrirEmJanelaComResposta(contexto, resposta)),
  },
  {
    nome: 'fechar o modal pelo X, pelo Concluir, pelo fundo, pelo Esc e pelo botão do console devolve o foco e solta os ouvintes',
    roteiro: async (contexto) => {
      const { open } = conectar(contexto);
      contexto.responder = respostaPor({ [CANAL_DA_URL]: { success: true, url: URL_DO_CONSOLE } });
      return emSerie(FORMAS_DE_FECHAR_O_MODAL(contexto), async (fechar) => {
        open(PEDIDO);
        await contexto.avancar(30);
        contexto.diario.length = 0;
        await fechar();
        const saida = { hosts: contexto.hosts().length, ouvintesDeTeclas: contexto.documento.ouvintesDeTeclas.length, diario: contexto.diario.slice() };
        if (contexto.hosts().length) teclarEscape(contexto);
        return saida;
      });
    },
  },
  {
    nome: 'o canal do console abre só o console, ignora pedido sem id e foca o que já está aberto',
    responder: respostaPor({ [CANAL_DA_URL]: { success: true, url: URL_DO_CONSOLE } }),
    roteiro: async (contexto) => {
      conectar(contexto);
      abrirConsoleSozinho(contexto, {});
      abrirConsoleSozinho(contexto, undefined);
      abrirConsoleSozinho(contexto, null);
      const vazio = contexto.hosts().length;
      abrirConsoleSozinho(contexto);
      const aoAbrir = contexto.foto();
      await contexto.avancar(0);
      const visao = webviewDe(contexto);
      const montado = { visao: descreverWebview(visao), foto: contexto.foto() };
      visao.disparar('did-fail-load');
      const falhou = contexto.foto()['.nvios-webview-status'];
      visao.disparar('did-finish-load');
      const carregou = contexto.foto()['.nvios-webview-status'];
      abrirConsoleSozinho(contexto);
      return { vazio, aoAbrir, montado, falhou, carregou, hosts: contexto.hosts().length, focos: focos(contexto), diario: contexto.diario.slice() };
    },
  },
  {
    nome: 'o console sozinho sem URL, com erro ou rejeitado mostra o aviso e o botão de refazer',
    roteiro: async (contexto) => {
      conectar(contexto);
      return emSerie({ semUrl: { success: true }, ...TIPOS_DE_FALHA }, (resposta) => abrirConsoleSozinhoComResposta(contexto, resposta));
    },
  },
  {
    nome: 'o console sozinho sem webview na página mostra o aviso e o botão de refazer',
    ambiente: { webviewIndisponivel: true },
    roteiro: async (contexto) => {
      conectar(contexto);
      return abrirConsoleSozinhoComResposta(contexto, { success: true, url: URL_DO_CONSOLE });
    },
  },
  {
    nome: 'o console sozinho: abrir em janela, refazer a conexão, Esc, fundo e botão de fechar',
    roteiro: async (contexto) => {
      conectar(contexto);
      return emSerie(FORMAS_DE_USAR_O_CONSOLE_SOZINHO(contexto), async (acao) => {
        contexto.responder = respostaPor({ [CANAL_DA_URL]: { success: true, url: URL_DO_CONSOLE } });
        abrirConsoleSozinho(contexto);
        await contexto.avancar(0);
        contexto.diario.length = 0;
        await acao();
        await contexto.avancar(0);
        const saida = { hosts: contexto.hosts().length, ouvintesDeTeclas: contexto.documento.ouvintesDeTeclas.length, diario: contexto.diario.slice(), foto: contexto.host() ? contexto.foto() : null };
        if (contexto.hosts().length) teclarEscape(contexto);
        return saida;
      });
    },
  },
  {
    nome: 'o canal do modal abre o modal de conexão e o segundo pedido só atualiza',
    roteiro: async (contexto) => {
      conectar(contexto);
      abrirModalPeloCanal(contexto);
      abrirModalPeloCanal(contexto, { id: 'ios-OUTROIDENTIFICADOR', name: 'Outro' });
      return { hosts: contexto.hosts().length, foto: contexto.foto() };
    },
  },
];

module.exports = { CENAS };
