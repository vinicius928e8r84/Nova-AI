const CANAL_DA_URL_DO_CONSOLE = 'physical-mobile:ios-console-url';
const CANAL_DA_JANELA_DO_CONSOLE = 'physical-mobile:ios-console';
const AVISO_CONSOLE_NAO_ABRIU = 'O controle do iPhone não abriu.';
const AVISO_JANELA_NAO_ABRIU = 'Não foi possível abrir a janela do controle.';
const AVISO_SEM_WEBVIEW = 'Esta versão do Nova não permite embutir a tela. Use "Abrir em janela".';
const AVISO_TELA_NAO_CARREGOU = 'Não foi possível carregar a tela do iPhone. Confira o cabo e tente de novo, ou use "Abrir em janela".';
const AVISO_CARREGANDO = 'Carregando o controle do iPhone…';
const MILISSEGUNDOS_ATE_FOCAR_A_SENHA = 30;

const ESCAPE = 'Escape';

async function invocarComFalhaPadrao(invoke, canal, argumento, mensagemPadrao) {
  try {
    return await invoke(canal, argumento);
  } catch (erro) {
    return { success: false, error: (erro && erro.message) || mensagemPadrao };
  }
}

const textoDaFalha = (resultado, mensagemPadrao) => (resultado && resultado.error) || mensagemPadrao;

async function pedirTelaDoConsole(invoke, id) {
  const resultado = await invocarComFalhaPadrao(invoke, CANAL_DA_URL_DO_CONSOLE, id, AVISO_CONSOLE_NAO_ABRIU);
  if (resultado?.success && resultado?.url) return { url: resultado.url };
  return { falha: textoDaFalha(resultado, AVISO_CONSOLE_NAO_ABRIU) };
}

async function abrirJanelaDoConsole(invoke, id, botao) {
  botao.disabled = true;
  const resultado = await invocarComFalhaPadrao(invoke, CANAL_DA_JANELA_DO_CONSOLE, id, AVISO_JANELA_NAO_ABRIU);
  botao.disabled = false;
  if (resultado && resultado.success) return null;
  return textoDaFalha(resultado, AVISO_JANELA_NAO_ABRIU);
}

function criarWebview(doc, url, aoCarregar, aoFalhar) {
  let visao;
  try {
    visao = doc.createElement('webview');
  } catch (erro) {
    visao = null;
  }
  if (!visao) return null;
  visao.className = 'nvios-webview';
  visao.setAttribute('src', url);
  visao.setAttribute('allowpopups', '');
  visao.addEventListener('did-finish-load', aoCarregar);
  visao.addEventListener('did-fail-load', aoFalhar);
  return visao;
}

function embutirTela(doc, url, quadro, mostrarFalha) {
  const visao = criarWebview(
    doc,
    url,
    () => { quadro.status.hidden = true; },
    () => mostrarFalha(AVISO_TELA_NAO_CARREGOU),
  );
  if (!visao) {
    mostrarFalha(AVISO_SEM_WEBVIEW);
    return false;
  }
  quadro.moldura.appendChild(visao);
  return true;
}

function localizarQuadroDoConsole(anfitriao) {
  return {
    moldura: anfitriao.querySelector('.nvios-webview-wrap'),
    status: anfitriao.querySelector('.nvios-webview-status'),
    botaoFechar: anfitriao.querySelector('.nvios-console-close'),
    botaoJanela: anfitriao.querySelector('.nvios-console-window'),
  };
}

function mostrarAvisoNaTela(quadro, texto) {
  quadro.status.hidden = false;
  quadro.status.textContent = texto;
}

function criarOuvinteDeEscape(podeFechar, fechar) {
  return function aoTeclar(evento) {
    if (evento.key !== ESCAPE || !podeFechar()) return;
    evento.preventDefault();
    evento.stopPropagation();
    fechar();
  };
}

function criarOuvinteDeClique(anfitriao, podeFechar, fechar) {
  return function aoApertar(evento) {
    if (evento.target === anfitriao && podeFechar()) fechar();
  };
}

function restaurarFoco(anterior) {
  try {
    if (anterior && anterior.focus) anterior.focus();
  } catch (erro) {}
}

function desmontarAnfitriao(doc, anfitriao, aoTeclar) {
  doc.removeEventListener('keydown', aoTeclar, true);
  anfitriao.remove();
}

module.exports = {
  AVISO_CARREGANDO, MILISSEGUNDOS_ATE_FOCAR_A_SENHA, textoDaFalha, invocarComFalhaPadrao, pedirTelaDoConsole, abrirJanelaDoConsole, embutirTela,
  localizarQuadroDoConsole, mostrarAvisoNaTela, criarOuvinteDeEscape, criarOuvinteDeClique, restaurarFoco, desmontarAnfitriao,
};
