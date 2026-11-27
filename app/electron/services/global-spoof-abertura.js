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

module.exports = { prepararPagina, abrirUrlPedida };
