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

module.exports = { prepararPagina, abrirUrlPedida, gerarAmbiente, encerrarChrome };
