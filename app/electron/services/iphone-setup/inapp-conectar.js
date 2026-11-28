const { MARCACAO_DA_CONEXAO, MARCACAO_DO_CONSOLE, criarAnfitriao } = require('./inapp-visual');
const {
  MILISSEGUNDOS_ATE_FOCAR_A_SENHA, invocarComFalhaPadrao, pedirTelaDoConsole, abrirJanelaDoConsole, embutirTela, localizarQuadroDoConsole,
  mostrarAvisoNaTela, criarOuvinteDeEscape, criarOuvinteDeClique, restaurarFoco, desmontarAnfitriao,
} = require('./inapp-console');

const CANAL_DE_PREPARO = 'physical-mobile:iphone-prepare';
const AVISO_SEM_SENHA = 'Informe a senha SSH do usuário mobile.';
const AVISO_PREPARO_FALHOU = 'Não foi possível concluir. Verifique o cabo e tente novamente.';
const AVISO_CONECTADO = 'Conectado por USB.';
const AVISO_ROTULO_PADRAO = 'iPhone conectado por USB';
const TEXTO_DE_ENVIAR = 'Conectando…';
const TEXTO_DE_TENTAR_DE_NOVO = 'Tentar novamente';
const TEXTO_DE_ABRINDO_O_CONSOLE = 'Abrindo o controle…';
const TEXTO_DO_BOTAO_DO_CONSOLE = 'Abrir controle e tela do iPhone';
const LETRAS_DO_FIM_DO_ID = 8;
const MILISSEGUNDOS_ENTRE_ATUALIZACOES_DO_TEMPO = 500;
const SEGUNDOS_POR_MINUTO = 60;
const TRAVA_DO_PACOTE = /dpkg:|Segmentation fault|signal \(?11\)?|was killed by signal/i;
const EXPLICACAO_DA_TRAVA_DO_PACOTE = 'O iPhone travou ao instalar um pacote — não é a sua senha. Nada foi alterado neste computador. '
  + 'Não toque em "Tentar novamente": o aparelho precisa ser recuperado (modo seguro) e o pacote '
  + 'removido antes de tentar de novo. O detalhe técnico ficou registrado.';

const SELETORES_DAS_PECAS = {
  cartaoDeConexao: '.nvios-setup',
  cartaoDoConsole: '.nvios-console',
  aparelho: '.nvios-device',
  formulario: '.nvios-form',
  senha: '#nvios-pass',
  enviar: '.nvios-submit',
  erro: '.nvios-error',
  progresso: '.nvios-progress',
  tempo: '.nvios-elapsed',
  resultado: '.nvios-result',
  mensagem: '.nvios-msg',
  abrirConsole: '.nvios-console-open',
  concluir: '.nvios-done',
  fechar: '.nvios-setup .nvios-x',
};

let modalAberto = null;

const localizarPecas = (anfitriao) => Object.fromEntries(Object.entries(SELETORES_DAS_PECAS).map(([nome, seletor]) => [nome, anfitriao.querySelector(seletor)]));
const campoEmTexto = (pedido, campo) => String((pedido && pedido[campo]) || '');
const fimDoId = (id) => (id.length > LETRAS_DO_FIM_DO_ID ? '…' + id.slice(-LETRAS_DO_FIM_DO_ID) : id);
const explicarFalha = (texto) => (TRAVA_DO_PACOTE.test(String(texto || '')) ? EXPLICACAO_DA_TRAVA_DO_PACOTE : String(texto || ''));

function formatarTempo(segundos) {
  if (segundos < SEGUNDOS_POR_MINUTO) return segundos + ' s';
  return Math.floor(segundos / SEGUNDOS_POR_MINUTO) + ' min ' + (segundos % SEGUNDOS_POR_MINUTO) + ' s';
}

function rotuloDoAparelho(pedido) {
  const nome = campoEmTexto(pedido, 'name').trim();
  const fim = fimDoId(campoEmTexto(pedido, 'id'));
  if (nome && fim) return nome + ' · ' + fim;
  return nome || (fim ? 'iPhone ' + fim : AVISO_ROTULO_PADRAO);
}

class ModalDeConexao {
  constructor(doc, pedido, invoke) {
    this.doc = doc;
    this.invoke = invoke;
    this.anfitriao = criarAnfitriao(doc, MARCACAO_DA_CONEXAO + MARCACAO_DO_CONSOLE);
    this.pecas = localizarPecas(this.anfitriao);
    this.pecas.cartaoDoConsole.hidden = true;
    this.quadro = localizarQuadroDoConsole(this.anfitriao);
    this.focoAnterior = doc.activeElement;
    this.estado = { id: String(pedido.id), name: '', running: false, timer: null, startedAt: 0 };
    this.aoTeclar = criarOuvinteDeEscape(() => !this.estado.running, () => this.fechar());
  }

  ligarEventos() {
    const { pecas, quadro, anfitriao } = this;
    pecas.formulario.addEventListener('submit', (evento) => this.enviar(evento));
    pecas.fechar.addEventListener('click', () => this.fechar());
    pecas.concluir.addEventListener('click', () => this.fechar());
    quadro.botaoFechar.addEventListener('click', () => this.fechar());
    pecas.abrirConsole.addEventListener('click', () => this.abrirConsole());
    quadro.botaoJanela.addEventListener('click', () => this.abrirJanela());
    anfitriao.addEventListener('mousedown', criarOuvinteDeClique(anfitriao, () => !this.estado.running, () => this.fechar()));
    this.doc.addEventListener('keydown', this.aoTeclar, true);
  }

  mostrar(pedido) {
    this.ligarEventos();
    this.estado.name = String(pedido.name || '');
    this.atualizarRotulo();
    this.doc.body.appendChild(this.anfitriao);
    setTimeout(() => this.pecas.senha.focus(), MILISSEGUNDOS_ATE_FOCAR_A_SENHA);
  }

  atualizarRotulo() {
    const { id, name } = this.estado;
    if (name && id) this.pecas.aparelho.textContent = name + ' · …' + id.slice(-LETRAS_DO_FIM_DO_ID);
    else this.pecas.aparelho.textContent = rotuloDoAparelho({ id, name });
  }

  atualizar(pedido) {
    if (pedido && pedido.id) this.estado.id = String(pedido.id);
    if (pedido && pedido.name) this.estado.name = String(pedido.name);
    this.atualizarRotulo();
  }

  focarSenha() {
    if (!this.estado.running) this.pecas.senha.focus();
  }

  iniciarContagem() {
    const { estado, pecas } = this;
    estado.startedAt = Date.now();
    pecas.tempo.textContent = '0 s';
    estado.timer = setInterval(() => {
      const segundos = Math.max(0, Math.round((Date.now() - estado.startedAt) / 1000));
      pecas.tempo.textContent = formatarTempo(segundos);
    }, MILISSEGUNDOS_ENTRE_ATUALIZACOES_DO_TEMPO);
  }

  pararContagem() {
    if (!this.estado.timer) return;
    clearInterval(this.estado.timer);
    this.estado.timer = null;
  }

  executar(executando) {
    const { estado, pecas } = this;
    estado.running = executando;
    pecas.formulario.hidden = executando;
    pecas.progresso.hidden = !executando;
    pecas.fechar.disabled = executando;
    if (executando) this.iniciarContagem();
    else this.pararContagem();
  }

  mostrarErro(texto) {
    const { pecas } = this;
    pecas.erro.textContent = explicarFalha(texto);
    pecas.erro.hidden = false;
    pecas.enviar.disabled = false;
    pecas.enviar.textContent = TEXTO_DE_TENTAR_DE_NOVO;
    pecas.formulario.hidden = false;
    pecas.resultado.hidden = true;
    pecas.progresso.hidden = true;
    pecas.senha.disabled = false;
    pecas.senha.focus();
    pecas.senha.select();
  }

  mostrarSucesso(texto) {
    const { pecas } = this;
    pecas.erro.hidden = true;
    pecas.formulario.hidden = true;
    pecas.progresso.hidden = true;
    pecas.resultado.hidden = false;
    pecas.mensagem.textContent = texto || AVISO_CONECTADO;
  }

  async enviar(evento) {
    evento.preventDefault();
    if (this.estado.running) return;
    const { pecas } = this;
    pecas.erro.hidden = true;
    const senha = pecas.senha.value;
    if (!senha) return this.mostrarErro(AVISO_SEM_SENHA);
    pecas.senha.value = '';
    pecas.senha.disabled = true;
    pecas.enviar.disabled = true;
    pecas.enviar.textContent = TEXTO_DE_ENVIAR;
    this.executar(true);
    const resultado = await invocarComFalhaPadrao(this.invoke, CANAL_DE_PREPARO, { id: this.estado.id, password: senha }, AVISO_PREPARO_FALHOU);
    this.executar(false);
    pecas.senha.disabled = false;
    if (resultado && resultado.success) return this.concluirPreparo(resultado);
    pecas.senha.value = senha;
    this.mostrarErro((resultado && (resultado.error || resultado.message)) || AVISO_PREPARO_FALHOU);
    pecas.senha.focus();
    pecas.senha.select();
  }

  concluirPreparo(resultado) {
    this.mostrarSucesso(resultado.message);
    this.pecas.abrirConsole.focus();
  }

  fechar() {
    if (this.estado.running) return;
    try { this.pecas.senha.value = ''; } catch (erro) {}
    desmontarAnfitriao(this.doc, this.anfitriao, this.aoTeclar);
    if (this.estado.timer) clearInterval(this.estado.timer);
    modalAberto = null;
    restaurarFoco(this.focoAnterior);
  }

  mostrarMensagemDoConsole(texto) {
    this.pecas.cartaoDeConexao.hidden = true;
    this.pecas.cartaoDoConsole.hidden = false;
    mostrarAvisoNaTela(this.quadro, texto);
  }

  montarConsole(url) {
    this.pecas.cartaoDeConexao.hidden = true;
    this.pecas.cartaoDoConsole.hidden = false;
    if (embutirTela(this.doc, url, this.quadro, (texto) => mostrarAvisoNaTela(this.quadro, texto))) this.quadro.botaoFechar.focus();
  }

  async abrirConsole() {
    const botao = this.pecas.abrirConsole;
    botao.disabled = true;
    botao.textContent = TEXTO_DE_ABRINDO_O_CONSOLE;
    const { url, falha } = await pedirTelaDoConsole(this.invoke, this.estado.id);
    botao.disabled = false;
    botao.textContent = TEXTO_DO_BOTAO_DO_CONSOLE;
    if (url) this.montarConsole(url);
    else this.mostrarMensagemDoConsole(falha);
  }

  async abrirJanela() {
    const falha = await abrirJanelaDoConsole(this.invoke, this.estado.id, this.quadro.botaoJanela);
    if (falha === null) this.fechar();
    else this.mostrarMensagemDoConsole(falha);
  }
}

function abrirModalDeConexao(pedido, invoke) {
  if (modalAberto) {
    modalAberto.atualizar(pedido);
    modalAberto.focarSenha();
    return;
  }
  if (!pedido || !pedido.id) return;
  modalAberto = new ModalDeConexao(document, pedido, invoke);
  modalAberto.mostrar(pedido);
}

module.exports = { abrirModalDeConexao };
