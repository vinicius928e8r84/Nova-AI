'use strict';

// Janela "Conectar iPhone por USB" desenhada dentro da própria janela do Nova.
//
// Este módulo roda no preload (mundo isolado): ele compartilha o DOM da página
// com o renderer, mas não as variáveis JavaScript dele. Por isso o modal não
// depende do bundle React e continua funcionando depois de uma atualização do
// app — o renderer só precisa disparar o canal 'physical-mobile:start-stream'.

const STYLE_ID = 'nova-iphone-setup-style';
const HOST_ATTR = 'data-nova-iphone-setup';
const OPEN_CHANNEL = 'nova:iphone-setup-open';
const PREPARE_CHANNEL = 'physical-mobile:iphone-prepare';
const CONSOLE_URL_CHANNEL = 'physical-mobile:ios-console-url';
const CONSOLE_WINDOW_CHANNEL = 'physical-mobile:ios-console';
const CONSOLE_OPEN_CHANNEL = 'nova:iphone-console-open';
const START_CHANNEL = 'physical-mobile:start-stream';

const CSS = `
[${HOST_ATTR}]{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;
  padding:24px;background:rgba(2,6,8,.74);-webkit-backdrop-filter:blur(7px);backdrop-filter:blur(7px);
  font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#d6e4e8;
  animation:nvios-fade .14s ease-out}
[${HOST_ATTR}] *{box-sizing:border-box}
[${HOST_ATTR}] [hidden]{display:none!important}
[${HOST_ATTR}] .nvios-card{width:min(540px,100%);max-height:calc(100vh - 48px);display:flex;flex-direction:column;
  background:linear-gradient(180deg,#0b151a,#070f13);border:1px solid rgba(0,213,237,.28);border-radius:16px;
  box-shadow:0 28px 90px rgba(0,0,0,.7),inset 0 1px 0 rgba(255,255,255,.04);overflow:hidden;
  animation:nvios-pop .16s ease-out}
[${HOST_ATTR}] .nvios-head{display:flex;align-items:center;gap:10px;padding:18px 20px 0;flex:0 0 auto}
[${HOST_ATTR}] .nvios-chip{font:600 10px/1 "JetBrains Mono",ui-monospace,monospace;letter-spacing:.14em;
  text-transform:uppercase;color:#00d5ed;background:rgba(0,213,237,.09);border:1px solid rgba(0,213,237,.32);
  border-radius:6px;padding:5px 8px}
[${HOST_ATTR}] .nvios-title{flex:1;margin:0;font-size:19px;font-weight:600;letter-spacing:.01em;color:#00d5ed}
[${HOST_ATTR}] .nvios-x{width:30px;height:30px;flex:0 0 auto;display:grid;place-items:center;background:transparent;
  border:1px solid transparent;border-radius:8px;color:#8fa4ab;font-size:18px;line-height:1;cursor:pointer;
  transition:background .12s,color .12s,border-color .12s}
[${HOST_ATTR}] .nvios-x:hover{background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.1);color:#eaf6f8}
[${HOST_ATTR}] .nvios-x:disabled{opacity:.3;cursor:not-allowed}
[${HOST_ATTR}] .nvios-device{margin:8px 20px 0;font:500 11px/1.5 "JetBrains Mono",ui-monospace,monospace;
  letter-spacing:.04em;color:#7f959d;word-break:break-word;flex:0 0 auto}
[${HOST_ATTR}] .nvios-scroll{padding:16px 20px 20px;overflow:auto}
[${HOST_ATTR}] .nvios-desc{margin:0 0 16px;font-size:13px;line-height:1.65;color:#9eafb6}
[${HOST_ATTR}] .nvios-label{display:block;margin-bottom:8px;font-size:12px;font-weight:600;
  letter-spacing:.04em;text-transform:uppercase;color:#b8cbd1}
[${HOST_ATTR}] .nvios-input{width:100%;padding:13px 14px;border-radius:10px;background:#0d1a21;
  border:1px solid #24404b;color:#eaf6f8;font-size:14px;outline:none;transition:border-color .12s,box-shadow .12s}
[${HOST_ATTR}] .nvios-input::placeholder{color:#5d757e}
[${HOST_ATTR}] .nvios-input:focus{border-color:rgba(0,213,237,.65);box-shadow:0 0 0 3px rgba(0,213,237,.14)}
[${HOST_ATTR}] .nvios-hint{margin:10px 0 0;font-size:12px;line-height:1.6;color:#778c94}
[${HOST_ATTR}] .nvios-error{margin:12px 0 0;padding:10px 12px;border-radius:9px;font-size:12.5px;line-height:1.5;
  color:#ffc2cf;background:rgba(255,84,119,.1);border:1px solid rgba(255,84,119,.35)}
[${HOST_ATTR}] .nvios-primary,.nvios-ghost{display:inline-flex;align-items:center;justify-content:center;
  width:100%;min-height:44px;padding:12px 16px;border-radius:10px;font-size:13.5px;font-weight:700;
  letter-spacing:.02em;cursor:pointer;transition:filter .12s,background .12s,border-color .12s}
[${HOST_ATTR}] .nvios-primary{background:#00d5ed;border:1px solid #00d5ed;color:#032127}
[${HOST_ATTR}] .nvios-primary:hover:not(:disabled){filter:brightness(1.08)}
[${HOST_ATTR}] .nvios-primary:disabled,.nvios-ghost:disabled{opacity:.55;cursor:progress}
[${HOST_ATTR}] .nvios-submit{margin-top:16px}
[${HOST_ATTR}] .nvios-ghost{background:transparent;border:1px solid #2b424c;color:#c2d4da}
[${HOST_ATTR}] .nvios-ghost:hover:not(:disabled){background:rgba(255,255,255,.05);border-color:#3d5b66}
[${HOST_ATTR}] .nvios-primary:focus-visible,[${HOST_ATTR}] .nvios-ghost:focus-visible,
[${HOST_ATTR}] .nvios-x:focus-visible,[${HOST_ATTR}] .nvios-input:focus-visible{
  outline:2px solid rgba(0,213,237,.75);outline-offset:2px}
[${HOST_ATTR}] .nvios-progress{display:flex;flex-direction:column;align-items:center;gap:10px;
  padding:26px 6px 10px;text-align:center}
[${HOST_ATTR}] .nvios-spinner{width:22px;height:22px;border-radius:50%;border:2px solid rgba(0,213,237,.22);
  border-top-color:#00d5ed;animation:nvios-spin .8s linear infinite}
[${HOST_ATTR}] .nvios-step{margin:0;max-width:400px;font-size:13px;line-height:1.6;color:#b8cbd1}
[${HOST_ATTR}] .nvios-elapsed{margin:0;font:500 11px/1 "JetBrains Mono",ui-monospace,monospace;
  letter-spacing:.06em;color:#6d838c}
[${HOST_ATTR}] .nvios-warn{margin:0;font-size:11.5px;color:#8a7f5c}
[${HOST_ATTR}] .nvios-msg{margin:0;font-size:13px;line-height:1.7;color:#cfe1e6;white-space:pre-wrap;word-break:break-word}
[${HOST_ATTR}] .nvios-msg::before{content:"✓  ";color:#28e6a4;font-weight:700}
[${HOST_ATTR}] .nvios-actions{display:flex;flex-direction:column;gap:10px;margin-top:18px}
[${HOST_ATTR}] .nvios-console{width:min(1180px,100%);height:min(880px,calc(100vh - 48px));max-height:none}
[${HOST_ATTR}] .nvios-console .nvios-head{padding-bottom:14px;border-bottom:1px solid rgba(0,213,237,.14)}
[${HOST_ATTR}] .nvios-console-window{width:auto;flex:0 0 auto;white-space:nowrap;min-height:32px;padding:7px 12px;font-size:12px;font-weight:600}
[${HOST_ATTR}] .nvios-console-retry{width:auto;flex:0 0 auto;white-space:nowrap;min-height:32px;padding:7px 12px;font-size:12px;font-weight:600}
[${HOST_ATTR}] .nvios-console .nvios-title{white-space:nowrap}
[${HOST_ATTR}] .nvios-webview-wrap{position:relative;flex:1 1 auto;display:flex;min-height:0;background:#050a10}
[${HOST_ATTR}] .nvios-webview{flex:1 1 auto;width:100%;height:100%;border:0;background:#050a10}
[${HOST_ATTR}] .nvios-webview-status{position:absolute;inset:0;display:grid;place-items:center;
  padding:24px;text-align:center;font-size:13px;line-height:1.6;color:#8fa4ab;background:#050a10}
@keyframes nvios-fade{from{opacity:0}to{opacity:1}}
@keyframes nvios-pop{from{opacity:0;transform:translateY(6px) scale(.985)}to{opacity:1;transform:none}}
@keyframes nvios-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){
  [${HOST_ATTR}],[${HOST_ATTR}] .nvios-card,[${HOST_ATTR}] .nvios-spinner{animation:none}
}
`;

const SETUP_MARKUP = `
<div class="nvios-card nvios-setup" role="dialog" aria-modal="true" aria-labelledby="nvios-title">
  <div class="nvios-head">
    <span class="nvios-chip">USB</span>
    <h2 class="nvios-title" id="nvios-title">Conectar iPhone por USB</h2>
    <button class="nvios-x" type="button" aria-label="Fechar">&times;</button>
  </div>
  <p class="nvios-device"></p>
  <div class="nvios-scroll">
    <form class="nvios-form" novalidate>
      <p class="nvios-desc">Mantenha apenas este iPhone conectado, desbloqueado e com o jailbreak ativo. O OpenSSH precisa estar instalado pelo Sileo.</p>
      <label class="nvios-label" for="nvios-pass">Senha SSH do usuário mobile</label>
      <input class="nvios-input" id="nvios-pass" type="password" autocomplete="off" spellcheck="false"
        placeholder="Senha definida no ambiente do jailbreak">
      <p class="nvios-hint">É a senha do terminal, diferente do código da tela. Ela não fica salva neste computador: é usada só neste Conectar, para instalar a chave de acesso e a ponte de câmera. Depois disso o Nova entra no iPhone pela chave, sem pedir senha de novo.</p>
      <p class="nvios-error" role="alert" hidden></p>
      <button class="nvios-primary nvios-submit" type="submit">Conectar e preparar</button>
    </form>
    <div class="nvios-progress" hidden>
      <span class="nvios-spinner" aria-hidden="true"></span>
      <p class="nvios-step">Conectando por USB, verificando o jailbreak e preparando o acesso…</p>
      <p class="nvios-elapsed">0 s</p>
      <p class="nvios-warn">Não feche o Nova durante a preparação.</p>
    </div>
    <div class="nvios-result" hidden>
      <p class="nvios-msg" role="status"></p>
      <div class="nvios-actions">
        <button class="nvios-primary nvios-console-open" type="button">Abrir controle e tela do iPhone</button>
        <button class="nvios-ghost nvios-done" type="button">Fechar</button>
      </div>
    </div>
  </div>
</div>
`;

const CONSOLE_MARKUP = `
<div class="nvios-card nvios-console" role="dialog" aria-modal="true" aria-label="Controle e tela do iPhone">
  <div class="nvios-head">
    <span class="nvios-chip">USB</span>
    <h2 class="nvios-title">Controle e tela do iPhone</h2>
    <button class="nvios-ghost nvios-console-retry" type="button" hidden>Refazer conexão</button>
    <button class="nvios-ghost nvios-console-window" type="button">Abrir em janela</button>
    <button class="nvios-x nvios-console-close" type="button" aria-label="Fechar">&times;</button>
  </div>
  <div class="nvios-webview-wrap">
    <div class="nvios-webview-status">Carregando o controle do iPhone…</div>
  </div>
</div>
`;

const MENSAGEM_DE_CONECTAR = 'Não foi possível concluir. Verifique o cabo e tente novamente.';
const MENSAGEM_DE_CONTROLE = 'O controle do iPhone não abriu.';
const MENSAGEM_DE_JANELA = 'Não foi possível abrir a janela do controle.';
const SEM_WEBVIEW = 'Esta versão do Nova não permite embutir a tela. Use "Abrir em janela".';
const FALHA_AO_CARREGAR = 'Não foi possível carregar a tela do iPhone. Confira o cabo e tente de novo, ou use "Abrir em janela".';
const FALHA_DO_APARELHO = /dpkg:|Segmentation fault|signal \(?11\)?|was killed by signal/i;
const APARELHO_TRAVOU = 'O iPhone travou ao instalar um pacote — não é a sua senha. Nada foi alterado neste computador. '
  + 'Não toque em "Tentar novamente": o aparelho precisa ser recuperado (modo seguro) e o pacote '
  + 'removido antes de tentar de novo. O detalhe técnico ficou registrado.';
const UM_MINUTO_S = 60;
const PASSO_DO_CRONOMETRO_MS = 500;
const ESPERA_PARA_FOCAR_A_SENHA_MS = 30;

const SELETORES_DA_TELA = {
  wrap: '.nvios-webview-wrap',
  status: '.nvios-webview-status',
  fechar: '.nvios-console-close',
  janela: '.nvios-console-window',
  refazer: '.nvios-console-retry',
};

const SELETORES_DO_CONECTAR = {
  cartao: '.nvios-setup',
  cartaoDoControle: '.nvios-console',
  aparelho: '.nvios-device',
  form: '.nvios-form',
  senha: '#nvios-pass',
  enviar: '.nvios-submit',
  erro: '.nvios-error',
  progresso: '.nvios-progress',
  decorrido: '.nvios-elapsed',
  resultado: '.nvios-result',
  mensagem: '.nvios-msg',
  abrirControle: '.nvios-console-open',
  pronto: '.nvios-done',
  fechar: '.nvios-setup .nvios-x',
};

let active = null;
let activeConsole = null;

function ensureStyle(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  (doc.head || doc.documentElement).appendChild(style);
}

const campoDoAparelho = (payload, campo) => String((payload && payload[campo]) || '');
const fimDoId = id => (id.length > 8 ? '…' + id.slice(-8) : id);

function deviceLine(payload) {
  const name = campoDoAparelho(payload, 'name').trim();
  const tail = fimDoId(campoDoAparelho(payload, 'id'));
  if (name && tail) return name + ' · ' + tail;
  if (name) return name;
  return tail ? 'iPhone ' + tail : 'iPhone conectado por USB';
}

function rotuloDoAparelho(id, name) {
  if (name && id) return name + ' · …' + id.slice(-8);
  return deviceLine({ id, name });
}

function explicarFalha(text) {
  const t = String(text || '');
  return FALHA_DO_APARELHO.test(t) ? APARELHO_TRAVOU : t;
}

function erroDoConectar(result) {
  if (!result) return MENSAGEM_DE_CONECTAR;
  return result.error || result.message || MENSAGEM_DE_CONECTAR;
}

const formatarDecorrido = seconds => (seconds < UM_MINUTO_S
  ? seconds + ' s'
  : Math.floor(seconds / UM_MINUTO_S) + ' min ' + (seconds % UM_MINUTO_S) + ' s');

const temId = payload => Boolean(payload && payload.id);
const deuCerto = result => Boolean(result && result.success);
const urlDoResultado = result => (deuCerto(result) ? result.url : null);
const erroOuPadrao = (result, padrao) => (result && result.error) || padrao;
const temFoco = elemento => Boolean(elemento && elemento.focus);

const acharElementos = (host, seletores) => Object.fromEntries(
  Object.entries(seletores).map(([nome, seletor]) => [nome, host.querySelector(seletor)]),
);

function criarWebview(doc) {
  try {
    return doc.createElement('webview');
  } catch (e) {
    return null;
  }
}

function limparCampo(campo) {
  try {
    campo.value = '';
  } catch (e) {
    return;
  }
}

function devolverFoco(anterior) {
  try {
    if (temFoco(anterior)) anterior.focus();
  } catch (e) {
    return;
  }
}

class TelaDoControle {
  constructor(host) {
    Object.assign(this, acharElementos(host, SELETORES_DA_TELA));
  }

  mostrarAviso(texto) {
    this.status.hidden = false;
    this.status.textContent = texto;
  }

  embutir(view, url, aoFalhar) {
    view.className = 'nvios-webview';
    view.setAttribute('src', url);
    view.setAttribute('allowpopups', '');
    view.addEventListener('did-finish-load', () => { this.status.hidden = true; });
    view.addEventListener('did-fail-load', aoFalhar);
    this.wrap.appendChild(view);
    this.fechar.focus();
  }
}

class JanelaDoIphone {
  constructor(doc, markup, invoke) {
    ensureStyle(doc);
    this.doc = doc;
    this.invoke = invoke;
    this.host = doc.createElement('div');
    this.host.setAttribute(HOST_ATTR, '');
    this.host.innerHTML = markup;
    this.tela = new TelaDoControle(this.host);
    this.anterior = doc.activeElement;
    this.aoTeclar = event => this.onKeydown(event);
  }

  podeFechar() {
    return true;
  }

  onKeydown(event) {
    if (event.key !== 'Escape' || !this.podeFechar()) return;
    event.preventDefault();
    event.stopPropagation();
    this.close();
  }

  aoApertarFora(event) {
    if (event.target === this.host && this.podeFechar()) this.close();
  }

  ouvirTecladoEFora() {
    this.host.addEventListener('mousedown', event => this.aoApertarFora(event));
    this.doc.addEventListener('keydown', this.aoTeclar, true);
  }

  desmontar() {
    this.doc.removeEventListener('keydown', this.aoTeclar, true);
    this.host.remove();
  }

  async pedir(canal, argumento, padrao) {
    try {
      return await this.invoke(canal, argumento);
    } catch (err) {
      return { success: false, error: (err && err.message) || padrao };
    }
  }

  exibirControle(result) {
    const url = urlDoResultado(result);
    if (url) this.montarControle(url);
    else this.avisarNoControle(erroOuPadrao(result, MENSAGEM_DE_CONTROLE));
  }

  montarControle(url) {
    const view = criarWebview(this.doc);
    if (!view) {
      this.semWebview();
      return;
    }
    this.tela.embutir(view, url, () => this.falhaAoCarregar());
  }

  async abrirEmJanela() {
    this.tela.janela.disabled = true;
    const result = await this.pedir(CONSOLE_WINDOW_CHANNEL, this.id, MENSAGEM_DE_JANELA);
    this.tela.janela.disabled = false;
    if (deuCerto(result)) this.close();
    else this.avisarNoControle(erroOuPadrao(result, MENSAGEM_DE_JANELA));
  }
}

class ModalDoConectar extends JanelaDoIphone {
  constructor(doc, payload, invoke) {
    super(doc, SETUP_MARKUP + CONSOLE_MARKUP, invoke);
    this.el = acharElementos(this.host, SELETORES_DO_CONECTAR);
    this.el.cartaoDoControle.hidden = true;
    this.id = String(payload.id);
    this.name = '';
    this.running = false;
    this.timer = null;
    this.startedAt = 0;
    this.el.form.addEventListener('submit', event => this.submit(event));
    this.el.fechar.addEventListener('click', () => this.close());
    this.el.pronto.addEventListener('click', () => this.close());
    this.tela.fechar.addEventListener('click', () => this.close());
    this.el.abrirControle.addEventListener('click', () => this.openConsole());
    this.tela.janela.addEventListener('click', () => this.abrirEmJanela());
    this.ouvirTecladoEFora();
  }

  mostrar(payload) {
    this.name = String(payload.name || '');
    this.applyDeviceLabels();
    this.doc.body.appendChild(this.host);
    setTimeout(() => this.el.senha.focus(), ESPERA_PARA_FOCAR_A_SENHA_MS);
  }

  update(next) {
    if (next && next.id) this.id = String(next.id);
    if (next && next.name) this.name = String(next.name);
    this.applyDeviceLabels();
  }

  focusPassword() {
    if (!this.running) this.el.senha.focus();
  }

  applyDeviceLabels() {
    this.el.aparelho.textContent = rotuloDoAparelho(this.id, this.name);
  }

  podeFechar() {
    return !this.running;
  }

  setRunning(running) {
    this.running = running;
    this.el.form.hidden = running;
    this.el.progresso.hidden = !running;
    this.el.fechar.disabled = running;
    if (running) this.iniciarCronometro();
    else this.pararCronometro();
  }

  iniciarCronometro() {
    this.startedAt = Date.now();
    this.el.decorrido.textContent = '0 s';
    this.timer = setInterval(() => this.mostrarDecorrido(), PASSO_DO_CRONOMETRO_MS);
  }

  mostrarDecorrido() {
    const seconds = Math.max(0, Math.round((Date.now() - this.startedAt) / 1000));
    this.el.decorrido.textContent = formatarDecorrido(seconds);
  }

  pararCronometro() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  showError(text) {
    const { erro, enviar, form, resultado, progresso, senha } = this.el;
    erro.textContent = explicarFalha(text);
    erro.hidden = false;
    enviar.disabled = false;
    enviar.textContent = 'Tentar novamente';
    form.hidden = false;
    resultado.hidden = true;
    progresso.hidden = true;
    senha.disabled = false;
    senha.focus();
    senha.select();
  }

  showSuccess(text) {
    this.el.erro.hidden = true;
    this.el.form.hidden = true;
    this.el.progresso.hidden = true;
    this.el.resultado.hidden = false;
    this.el.mensagem.textContent = text || 'Conectado por USB.';
  }

  async submit(event) {
    event.preventDefault();
    if (this.running) return;
    this.el.erro.hidden = true;
    const tentativa = this.el.senha.value;
    if (!tentativa) {
      this.showError('Informe a senha SSH do usuário mobile.');
      return;
    }
    this.comecarConexao();
    const result = await this.pedir(PREPARE_CHANNEL, { id: this.id, password: tentativa }, MENSAGEM_DE_CONECTAR);
    this.terminarConexao(result, tentativa);
  }

  comecarConexao() {
    this.el.senha.value = '';
    this.el.senha.disabled = true;
    this.el.enviar.disabled = true;
    this.el.enviar.textContent = 'Conectando…';
    this.setRunning(true);
  }

  terminarConexao(result, tentativa) {
    this.setRunning(false);
    this.el.senha.disabled = false;
    if (deuCerto(result)) this.conectou(result);
    else this.naoConectou(result, tentativa);
  }

  conectou(result) {
    this.showSuccess(result.message);
    this.el.abrirControle.focus();
  }

  naoConectou(result, tentativa) {
    this.el.senha.value = tentativa;
    this.showError(erroDoConectar(result));
    this.el.senha.focus();
    this.el.senha.select();
  }

  close() {
    if (this.running) return;
    limparCampo(this.el.senha);
    this.desmontar();
    if (this.timer) clearInterval(this.timer);
    active = null;
    devolverFoco(this.anterior);
  }

  async openConsole() {
    const botao = this.el.abrirControle;
    botao.disabled = true;
    botao.textContent = 'Abrindo o controle…';
    const result = await this.pedir(CONSOLE_URL_CHANNEL, this.id, MENSAGEM_DE_CONTROLE);
    botao.disabled = false;
    botao.textContent = 'Abrir controle e tela do iPhone';
    this.exibirControle(result);
  }

  mostrarCartaoDoControle() {
    this.el.cartao.hidden = true;
    this.el.cartaoDoControle.hidden = false;
  }

  montarControle(url) {
    this.mostrarCartaoDoControle();
    super.montarControle(url);
  }

  semWebview() {
    this.tela.status.textContent = SEM_WEBVIEW;
  }

  falhaAoCarregar() {
    this.tela.mostrarAviso(FALHA_AO_CARREGAR);
  }

  avisarNoControle(text) {
    this.mostrarCartaoDoControle();
    this.tela.mostrarAviso(text);
  }
}

class ControleDireto extends JanelaDoIphone {
  constructor(doc, payload, invoke) {
    super(doc, CONSOLE_MARKUP, invoke);
    this.id = String(payload.id);
    this.tela.fechar.addEventListener('click', () => this.close());
    this.ouvirTecladoEFora();
    this.tela.janela.addEventListener('click', () => this.abrirEmJanela());
    this.tela.refazer.addEventListener('click', () => this.refazerConexao());
  }

  mostrar() {
    this.doc.body.appendChild(this.host);
    this.carregar();
  }

  focus() {
    this.tela.fechar.focus();
  }

  close() {
    this.desmontar();
    activeConsole = null;
    devolverFoco(this.anterior);
  }

  showError(text) {
    this.tela.mostrarAviso(text);
    this.tela.refazer.hidden = false;
  }

  async carregar() {
    this.tela.refazer.hidden = false;
    this.tela.mostrarAviso('Carregando o controle do iPhone…');
    this.exibirControle(await this.pedir(CONSOLE_URL_CHANNEL, this.id, MENSAGEM_DE_CONTROLE));
  }

  semWebview() {
    this.showError(SEM_WEBVIEW);
  }

  falhaAoCarregar() {
    this.showError(FALHA_AO_CARREGAR);
  }

  avisarNoControle(text) {
    this.showError(text);
  }

  async refazerConexao() {
    this.tela.refazer.disabled = true;
    this.close();
    await this.pedir(START_CHANNEL, this.id, null);
  }
}

function open(payload, invoke) {
  if (active) {
    active.update(payload);
    active.focusPassword();
    return;
  }
  if (!temId(payload)) return;
  active = new ModalDoConectar(document, payload, invoke);
  active.mostrar(payload);
}

function openConsoleOnly(payload, invoke) {
  if (!temId(payload)) return;
  if (activeConsole) {
    activeConsole.focus();
    return;
  }
  activeConsole = new ControleDireto(document, payload, invoke);
  activeConsole.mostrar();
}

// Chamado uma única vez pelo preload. `invoke` existe para os testes em
// navegador/Electron trocarem o IPC por uma função de mentira.
function attach({ ipcRenderer, invoke }) {
  const run = invoke || ((channel, ...args) => ipcRenderer.invoke(channel, ...args));
  ipcRenderer.on(OPEN_CHANNEL, (_event, payload) => open(payload, run));
  ipcRenderer.on(CONSOLE_OPEN_CHANNEL, (_event, payload) => openConsoleOnly(payload, run));
  return { open: (payload) => open(payload, run) };
}

module.exports = { attach };
