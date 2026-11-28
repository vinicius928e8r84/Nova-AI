const ID_DO_ESTILO = 'nova-iphone-setup-style';
const ATRIBUTO_DO_ANFITRIAO = 'data-nova-iphone-setup';

const ESTILO_DO_MODAL = `
[${ATRIBUTO_DO_ANFITRIAO}]{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;
  padding:24px;background:rgba(2,6,8,.74);-webkit-backdrop-filter:blur(7px);backdrop-filter:blur(7px);
  font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#d6e4e8;
  animation:nvios-fade .14s ease-out}
[${ATRIBUTO_DO_ANFITRIAO}] *{box-sizing:border-box}
[${ATRIBUTO_DO_ANFITRIAO}] [hidden]{display:none!important}
[${ATRIBUTO_DO_ANFITRIAO}] .nvios-card{width:min(540px,100%);max-height:calc(100vh - 48px);display:flex;flex-direction:column;
  background:linear-gradient(180deg,#0b151a,#070f13);border:1px solid rgba(0,213,237,.28);border-radius:16px;
  box-shadow:0 28px 90px rgba(0,0,0,.7),inset 0 1px 0 rgba(255,255,255,.04);overflow:hidden;
  animation:nvios-pop .16s ease-out}
[${ATRIBUTO_DO_ANFITRIAO}] .nvios-head{display:flex;align-items:center;gap:10px;padding:18px 20px 0;flex:0 0 auto}
[${ATRIBUTO_DO_ANFITRIAO}] .nvios-chip{font:600 10px/1 "JetBrains Mono",ui-monospace,monospace;letter-spacing:.14em;
  text-transform:uppercase;color:#00d5ed;background:rgba(0,213,237,.09);border:1px solid rgba(0,213,237,.32);
  border-radius:6px;padding:5px 8px}
[${ATRIBUTO_DO_ANFITRIAO}] .nvios-title{flex:1;margin:0;font-size:19px;font-weight:600;letter-spacing:.01em;color:#00d5ed}
[${ATRIBUTO_DO_ANFITRIAO}] .nvios-x{width:30px;height:30px;flex:0 0 auto;display:grid;place-items:center;background:transparent;
  border:1px solid transparent;border-radius:8px;color:#8fa4ab;font-size:18px;line-height:1;cursor:pointer;
  transition:background .12s,color .12s,border-color .12s}
[${ATRIBUTO_DO_ANFITRIAO}] .nvios-x:hover{background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.1);color:#eaf6f8}
[${ATRIBUTO_DO_ANFITRIAO}] .nvios-x:disabled{opacity:.3;cursor:not-allowed}
[${ATRIBUTO_DO_ANFITRIAO}] .nvios-device{margin:8px 20px 0;font:500 11px/1.5 "JetBrains Mono",ui-monospace,monospace;
  letter-spacing:.04em;color:#7f959d;word-break:break-word;flex:0 0 auto}
[${ATRIBUTO_DO_ANFITRIAO}] .nvios-scroll{padding:16px 20px 20px;overflow:auto}
[${ATRIBUTO_DO_ANFITRIAO}] .nvios-desc{margin:0 0 16px;font-size:13px;line-height:1.65;color:#9eafb6}
[${ATRIBUTO_DO_ANFITRIAO}] .nvios-label{display:block;margin-bottom:8px;font-size:12px;font-weight:600;
  letter-spacing:.04em;text-transform:uppercase;color:#b8cbd1}
[${ATRIBUTO_DO_ANFITRIAO}] .nvios-input{width:100%;padding:13px 14px;border-radius:10px;background:#0d1a21;
  border:1px solid #24404b;color:#eaf6f8;font-size:14px;outline:none;transition:border-color .12s,box-shadow .12s}
[${ATRIBUTO_DO_ANFITRIAO}] .nvios-input::placeholder{color:#5d757e}
[${ATRIBUTO_DO_ANFITRIAO}] .nvios-input:focus{border-color:rgba(0,213,237,.65);box-shadow:0 0 0 3px rgba(0,213,237,.14)}
[${ATRIBUTO_DO_ANFITRIAO}] .nvios-hint{margin:10px 0 0;font-size:12px;line-height:1.6;color:#778c94}
[${ATRIBUTO_DO_ANFITRIAO}] .nvios-error{margin:12px 0 0;padding:10px 12px;border-radius:9px;font-size:12.5px;line-height:1.5;
  color:#ffc2cf;background:rgba(255,84,119,.1);border:1px solid rgba(255,84,119,.35)}
[${ATRIBUTO_DO_ANFITRIAO}] .nvios-primary,.nvios-ghost{display:inline-flex;align-items:center;justify-content:center;
  width:100%;min-height:44px;padding:12px 16px;border-radius:10px;font-size:13.5px;font-weight:700;
  letter-spacing:.02em;cursor:pointer;transition:filter .12s,background .12s,border-color .12s}
[${ATRIBUTO_DO_ANFITRIAO}] .nvios-primary{background:#00d5ed;border:1px solid #00d5ed;color:#032127}
[${ATRIBUTO_DO_ANFITRIAO}] .nvios-primary:hover:not(:disabled){filter:brightness(1.08)}
[${ATRIBUTO_DO_ANFITRIAO}] .nvios-primary:disabled,.nvios-ghost:disabled{opacity:.55;cursor:progress}
[${ATRIBUTO_DO_ANFITRIAO}] .nvios-submit{margin-top:16px}
[${ATRIBUTO_DO_ANFITRIAO}] .nvios-ghost{background:transparent;border:1px solid #2b424c;color:#c2d4da}
[${ATRIBUTO_DO_ANFITRIAO}] .nvios-ghost:hover:not(:disabled){background:rgba(255,255,255,.05);border-color:#3d5b66}
[${ATRIBUTO_DO_ANFITRIAO}] .nvios-primary:focus-visible,[${ATRIBUTO_DO_ANFITRIAO}] .nvios-ghost:focus-visible,
[${ATRIBUTO_DO_ANFITRIAO}] .nvios-x:focus-visible,[${ATRIBUTO_DO_ANFITRIAO}] .nvios-input:focus-visible{
  outline:2px solid rgba(0,213,237,.75);outline-offset:2px}
[${ATRIBUTO_DO_ANFITRIAO}] .nvios-progress{display:flex;flex-direction:column;align-items:center;gap:10px;
  padding:26px 6px 10px;text-align:center}
[${ATRIBUTO_DO_ANFITRIAO}] .nvios-spinner{width:22px;height:22px;border-radius:50%;border:2px solid rgba(0,213,237,.22);
  border-top-color:#00d5ed;animation:nvios-spin .8s linear infinite}
[${ATRIBUTO_DO_ANFITRIAO}] .nvios-step{margin:0;max-width:400px;font-size:13px;line-height:1.6;color:#b8cbd1}
[${ATRIBUTO_DO_ANFITRIAO}] .nvios-elapsed{margin:0;font:500 11px/1 "JetBrains Mono",ui-monospace,monospace;
  letter-spacing:.06em;color:#6d838c}
[${ATRIBUTO_DO_ANFITRIAO}] .nvios-warn{margin:0;font-size:11.5px;color:#8a7f5c}
[${ATRIBUTO_DO_ANFITRIAO}] .nvios-msg{margin:0;font-size:13px;line-height:1.7;color:#cfe1e6;white-space:pre-wrap;word-break:break-word}
[${ATRIBUTO_DO_ANFITRIAO}] .nvios-msg::before{content:"✓  ";color:#28e6a4;font-weight:700}
[${ATRIBUTO_DO_ANFITRIAO}] .nvios-actions{display:flex;flex-direction:column;gap:10px;margin-top:18px}
[${ATRIBUTO_DO_ANFITRIAO}] .nvios-console{width:min(1180px,100%);height:min(880px,calc(100vh - 48px));max-height:none}
[${ATRIBUTO_DO_ANFITRIAO}] .nvios-console .nvios-head{padding-bottom:14px;border-bottom:1px solid rgba(0,213,237,.14)}
[${ATRIBUTO_DO_ANFITRIAO}] .nvios-console-window{width:auto;flex:0 0 auto;white-space:nowrap;min-height:32px;padding:7px 12px;font-size:12px;font-weight:600}
[${ATRIBUTO_DO_ANFITRIAO}] .nvios-console-retry{width:auto;flex:0 0 auto;white-space:nowrap;min-height:32px;padding:7px 12px;font-size:12px;font-weight:600}
[${ATRIBUTO_DO_ANFITRIAO}] .nvios-console .nvios-title{white-space:nowrap}
[${ATRIBUTO_DO_ANFITRIAO}] .nvios-webview-wrap{position:relative;flex:1 1 auto;display:flex;min-height:0;background:#050a10}
[${ATRIBUTO_DO_ANFITRIAO}] .nvios-webview{flex:1 1 auto;width:100%;height:100%;border:0;background:#050a10}
[${ATRIBUTO_DO_ANFITRIAO}] .nvios-webview-status{position:absolute;inset:0;display:grid;place-items:center;
  padding:24px;text-align:center;font-size:13px;line-height:1.6;color:#8fa4ab;background:#050a10}
@keyframes nvios-fade{from{opacity:0}to{opacity:1}}
@keyframes nvios-pop{from{opacity:0;transform:translateY(6px) scale(.985)}to{opacity:1;transform:none}}
@keyframes nvios-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){
  [${ATRIBUTO_DO_ANFITRIAO}],[${ATRIBUTO_DO_ANFITRIAO}] .nvios-card,[${ATRIBUTO_DO_ANFITRIAO}] .nvios-spinner{animation:none}
}
`;

const MARCACAO_DA_CONEXAO = `
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

const MARCACAO_DO_CONSOLE = `
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

function garantirEstilo(doc) {
  if (doc.getElementById(ID_DO_ESTILO)) return;
  const estilo = doc.createElement('style');
  estilo.id = ID_DO_ESTILO;
  estilo.textContent = ESTILO_DO_MODAL;
  (doc.head || doc.documentElement).appendChild(estilo);
}

function criarAnfitriao(doc, marcacao) {
  garantirEstilo(doc);
  const anfitriao = doc.createElement('div');
  anfitriao.setAttribute(ATRIBUTO_DO_ANFITRIAO, '');
  anfitriao.innerHTML = marcacao;
  return anfitriao;
}

module.exports = { MARCACAO_DA_CONEXAO, MARCACAO_DO_CONSOLE, criarAnfitriao };
