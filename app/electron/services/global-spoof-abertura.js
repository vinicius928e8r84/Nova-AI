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

async function concluirLote(enviar, lote) {
  const falhas = (await Promise.all(lote.respostas)).filter(Boolean);
  if (!falhas.length) return {};
  await enviar('Target.closeTarget', { targetId: lote.alvo }).catch(() => {});
  throw falhas[0];
}

function enviarEmLoteNasAbasSemOpener(cliente) {
  const enviar = cliente.send.bind(cliente);
  const lotes = new Map();
  cliente.on('Target.attachedToTarget', ({ sessionId, targetInfo, waitingForDebugger }) => {
    if (waitingForDebugger && ehAbaSemOpener(targetInfo)) lotes.set(sessionId, { alvo: targetInfo.targetId, respostas: [] });
  });
  cliente.send = (metodo, params, sessao, ...resto) => {
    const lote = lotes.get(sessao);
    if (!lote) return enviar(metodo, params, sessao, ...resto);
    lote.respostas.push(enviar(metodo, params, sessao).then(() => null, (erro) => erro));
    if (metodo !== LIBERAR_ABA) return Promise.resolve({});
    lotes.delete(sessao);
    return concluirLote(enviar, lote);
  };
  return cliente;
}

async function conectarAoChrome(porta, tentativas = 30, intervalo = 200) {
  const CDP = require('chrome-remote-interface');
  for (let tentativa = 0; ; tentativa++) {
    try {
      const versao = await CDP.Version({ port: porta });
      const alvo = versao && versao.webSocketDebuggerUrl ? { target: versao.webSocketDebuggerUrl } : { port: porta };
      return enviarEmLoteNasAbasSemOpener(await CDP(alvo));
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

module.exports = { prepararPagina, abrirUrlPedida, enviarEmLoteNasAbasSemOpener, conectarAoChrome, gerarAmbiente, encerrarChrome };
