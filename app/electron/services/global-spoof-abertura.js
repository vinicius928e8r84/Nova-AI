'use strict';

async function prepararPagina(cliente, sessao, fonteDoDisfarce) {
  try {
    await cliente.send('Page.enable', {}, sessao);
    await cliente.send('Page.setBypassCSP', { enabled: true }, sessao);
    await cliente.send('Page.addScriptToEvaluateOnNewDocument', { source: fonteDoDisfarce }, sessao);
    return true;
  } catch {
    return false;
  }
}

const ehPrimeiraPagina = (alvo) => alvo.type === 'page' && alvo.url === 'about:blank' && !alvo.openerId;

async function abrirUrlPedida(cliente, sessao, alvo, url) {
  if (url && ehPrimeiraPagina(alvo)) await cliente.send('Page.navigate', { url }, sessao);
}

const ehAbaSemOpener = (alvo) => alvo.type === 'page' && Boolean(alvo.openerId) && alvo.canAccessOpener === false;

const LIBERAR_ABA = 'Runtime.runIfWaitingForDebugger';

const SEGURAR_DOCUMENTO = { patterns: [{ requestStage: 'Request', resourceType: 'Document' }] };

const DEIXAR_PEDIDO_SAIR = new Set(['Fetch.continueRequest', 'Fetch.continueWithAuth']);

class AbaSemOpenerSegurada {
  constructor(enviar, sessao) {
    this.enviar = enviar;
    this.sessao = sessao;
    this.respostas = [];
    this.servicoUsaFetch = false;
    this.documentoPedido = null;
    this.anotar('Fetch.enable', SEGURAR_DOCUMENTO);
  }

  anotar(metodo, params) {
    this.respostas.push(this.enviar(metodo, params, this.sessao).then(() => null, (erro) => erro));
  }

  receber(metodo, params) {
    if (DEIXAR_PEDIDO_SAIR.has(metodo)) return Promise.resolve({});
    if (metodo === 'Fetch.enable') this.servicoUsaFetch = true;
    this.anotar(metodo, params);
    return metodo === LIBERAR_ABA ? this.carregarDepoisDoDisfarce() : Promise.resolve({});
  }

  cancelarDocumento({ requestId, request }) {
    this.documentoPedido = this.documentoPedido || request;
    this.enviar('Fetch.failRequest', { requestId, errorReason: 'Aborted' }, this.sessao).catch(() => {});
  }

  async carregarDepoisDoDisfarce() {
    const falhas = (await Promise.all(this.respostas)).filter(Boolean);
    if (falhas.length) throw falhas[0];
    this.liberada = true;
    if (!this.servicoUsaFetch) await this.enviar('Fetch.disable', {}, this.sessao);
    if (this.documentoPedido) await this.enviar('Page.navigate', { url: this.documentoPedido.url, referrer: this.documentoPedido.headers.Referer }, this.sessao);
    return {};
  }
}

function segurarAbasSemOpenerAteODisfarce(cliente) {
  const enviar = cliente.send.bind(cliente);
  const seguradas = new Map();
  cliente.on('Target.attachedToTarget', ({ sessionId, targetInfo, waitingForDebugger }) => {
    if (waitingForDebugger && ehAbaSemOpener(targetInfo)) seguradas.set(sessionId, new AbaSemOpenerSegurada(enviar, sessionId));
  });
  cliente.on('Target.detachedFromTarget', ({ sessionId }) => seguradas.delete(sessionId));
  cliente.on('Fetch.requestPaused', (pedido, sessao) => {
    const aba = seguradas.get(sessao);
    if (aba && !aba.liberada) aba.cancelarDocumento(pedido);
  });
  cliente.send = (metodo, params, sessao, ...resto) => {
    const aba = seguradas.get(sessao);
    if (!aba || aba.liberada) return enviar(metodo, params, sessao, ...resto);
    return aba.receber(metodo, params);
  };
  return cliente;
}

async function conectarAoChrome(porta, tentativas = 30, intervalo = 200) {
  const CDP = require('chrome-remote-interface');
  for (let tentativa = 0; ; tentativa++) {
    try {
      const versao = await CDP.Version({ port: porta });
      const alvo = versao && versao.webSocketDebuggerUrl ? { target: versao.webSocketDebuggerUrl } : { port: porta };
      return segurarAbasSemOpenerAteODisfarce(await CDP(alvo));
    } catch (erro) {
      if (tentativa >= tentativas - 1) throw erro;
      await new Promise((resolve) => setTimeout(resolve, intervalo));
    }
  }
}

function gerarAmbiente(spawn, ffmpeg, args) {
  return new Promise((resolve) => {
    spawn(ffmpeg, args, { windowsHide: true }).on('error', resolve).on('close', () => {
      console.info('[GlobalSpoof] Ambient audio file generated.');
      resolve();
    });
  });
}

function encerrarChrome(spawn, pid) {
  if (process.platform === 'win32') {
    spawn('taskkill', ['/F', '/T', '/PID', String(pid)], { windowsHide: true, detached: true, stdio: 'ignore' }).unref();
  } else {
    process.kill(-pid);
  }
}

module.exports = { prepararPagina, abrirUrlPedida, segurarAbasSemOpenerAteODisfarce, conectarAoChrome, gerarAmbiente, encerrarChrome };
