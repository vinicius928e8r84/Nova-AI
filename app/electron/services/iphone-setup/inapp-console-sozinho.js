const { MARCACAO_DO_CONSOLE, criarAnfitriao } = require('./inapp-visual');
const {
  AVISO_CARREGANDO, pedirTelaDoConsole, abrirJanelaDoConsole, embutirTela, localizarQuadroDoConsole, mostrarAvisoNaTela,
  criarOuvinteDeEscape, criarOuvinteDeClique, restaurarFoco, desmontarAnfitriao,
} = require('./inapp-console');

const CANAL_DE_INICIO_DO_CONSOLE = 'physical-mobile:start-stream';

let consoleAberto = null;

class ConsoleSozinho {
  constructor(doc, pedido, invoke) {
    this.doc = doc;
    this.invoke = invoke;
    this.anfitriao = criarAnfitriao(doc, MARCACAO_DO_CONSOLE);
    this.quadro = localizarQuadroDoConsole(this.anfitriao);
    this.botaoRefazer = this.anfitriao.querySelector('.nvios-console-retry');
    this.id = String(pedido.id);
    this.focoAnterior = doc.activeElement;
    this.aoTeclar = criarOuvinteDeEscape(() => true, () => this.fechar());
  }

  fechar() {
    desmontarAnfitriao(this.doc, this.anfitriao, this.aoTeclar);
    consoleAberto = null;
    restaurarFoco(this.focoAnterior);
  }

  mostrarErro(texto) {
    mostrarAvisoNaTela(this.quadro, texto);
    this.botaoRefazer.hidden = false;
  }

  montar(url) {
    if (embutirTela(this.doc, url, this.quadro, (texto) => this.mostrarErro(texto))) this.quadro.botaoFechar.focus();
  }

  async carregar() {
    this.botaoRefazer.hidden = false;
    this.quadro.status.hidden = false;
    this.quadro.status.textContent = AVISO_CARREGANDO;
    const { url, falha } = await pedirTelaDoConsole(this.invoke, this.id);
    if (url) this.montar(url);
    else this.mostrarErro(falha);
  }

  async abrirJanela() {
    const falha = await abrirJanelaDoConsole(this.invoke, this.id, this.quadro.botaoJanela);
    if (falha === null) this.fechar();
    else this.mostrarErro(falha);
  }

  async refazer() {
    this.botaoRefazer.disabled = true;
    this.fechar();
    try { await this.invoke(CANAL_DE_INICIO_DO_CONSOLE, this.id); } catch (erro) {}
  }

  ligarEventos() {
    this.quadro.botaoFechar.addEventListener('click', () => this.fechar());
    this.anfitriao.addEventListener('mousedown', criarOuvinteDeClique(this.anfitriao, () => true, () => this.fechar()));
    this.doc.addEventListener('keydown', this.aoTeclar, true);
    this.quadro.botaoJanela.addEventListener('click', () => this.abrirJanela());
    this.botaoRefazer.addEventListener('click', () => this.refazer());
  }

  mostrar() {
    this.ligarEventos();
    consoleAberto = { focus: () => this.quadro.botaoFechar.focus() };
    this.doc.body.appendChild(this.anfitriao);
    this.carregar();
  }
}

function abrirConsoleSozinho(pedido, invoke) {
  if (!pedido || !pedido.id) return;
  if (consoleAberto) {
    consoleAberto.focus();
    return;
  }
  new ConsoleSozinho(document, pedido, invoke).mostrar();
}

module.exports = { abrirConsoleSozinho };
