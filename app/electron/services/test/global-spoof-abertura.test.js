'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { enviarEmLoteNasAbasSemOpener } = require('../global-spoof-abertura');

const LIBERAR = 'Runtime.runIfWaitingForDebugger';
const PRAZO_EM_MS = 300;

function criarChrome({ comFalha } = {}) {
  const chrome = { enviados: [], ouvintes: {}, liberacoes: new Map() };
  const liberacaoDe = (sessao) => {
    if (!chrome.liberacoes.has(sessao)) {
      let liberar;
      const liberada = new Promise((resolve) => { liberar = resolve; });
      chrome.liberacoes.set(sessao, { liberada, liberar });
    }
    return chrome.liberacoes.get(sessao);
  };
  chrome.on = (evento, ouvinte) => { chrome.ouvintes[evento] = ouvinte; };
  chrome.send = async (metodo, params, sessao) => {
    chrome.enviados.push({ metodo, params, sessao });
    if (metodo === LIBERAR) {
      liberacaoDe(sessao).liberar();
      return {};
    }
    if (chrome.pausadas && chrome.pausadas.has(sessao)) await liberacaoDe(sessao).liberada;
    if (metodo === comFalha) throw new Error(`${metodo} recusado`);
    return {};
  };
  return chrome;
}

async function anexar(chrome, sessionId, targetInfo, { pausada = true } = {}) {
  chrome.pausadas = chrome.pausadas || new Set();
  if (pausada) chrome.pausadas.add(sessionId);
  await chrome.ouvintes['Target.attachedToTarget']({ sessionId, targetInfo, waitingForDebugger: pausada });
}

const abaSemOpener = { targetId: 'aba-nova', type: 'page', url: '', openerId: 'aba-1', canAccessOpener: false };

const dentroDoPrazo = (promessa) => Promise.race([promessa, new Promise((_, rejeitar) => setTimeout(() => rejeitar(new Error('travou esperando a resposta do Chrome')), PRAZO_EM_MS))]);

async function disfarcarELiberar(cliente, sessao) {
  await cliente.send('Page.enable', {}, sessao);
  await cliente.send('Page.addScriptToEvaluateOnNewDocument', { source: 'disfarce' }, sessao);
  await cliente.send(LIBERAR, {}, sessao);
}

test('aba sem opener: os comandos de disfarce e a liberação saem juntos, nessa ordem, sem esperar resposta', async () => {
  const chrome = criarChrome();
  const cliente = enviarEmLoteNasAbasSemOpener(chrome);
  await anexar(chrome, 'sessao-nova', abaSemOpener);
  await dentroDoPrazo(disfarcarELiberar(cliente, 'sessao-nova'));
  assert.deepStrictEqual(chrome.enviados.map((e) => e.metodo), ['Page.enable', 'Page.addScriptToEvaluateOnNewDocument', LIBERAR]);
});

test('aba sem opener: se um comando do disfarce falha, a liberação falha e a aba é fechada', async () => {
  const chrome = criarChrome({ comFalha: 'Page.addScriptToEvaluateOnNewDocument' });
  const cliente = enviarEmLoteNasAbasSemOpener(chrome);
  await anexar(chrome, 'sessao-nova', abaSemOpener);
  await assert.rejects(dentroDoPrazo(disfarcarELiberar(cliente, 'sessao-nova')), /recusado/);
  const fechamento = chrome.enviados.find((e) => e.metodo === 'Target.closeTarget');
  assert.deepStrictEqual(fechamento.params, { targetId: 'aba-nova' });
  assert.strictEqual(fechamento.sessao, undefined);
});

test('a primeira aba e a janela que pode falar com a aba de origem continuam esperando cada resposta', async () => {
  const chrome = criarChrome();
  const cliente = enviarEmLoteNasAbasSemOpener(chrome);
  await anexar(chrome, 'sessao-1', { targetId: 'aba-1', type: 'page', url: 'about:blank', canAccessOpener: false }, { pausada: false });
  await anexar(chrome, 'sessao-popup', { targetId: 'popup', type: 'page', url: '', openerId: 'aba-1', canAccessOpener: true });
  const envio = cliente.send('Page.enable', {}, 'sessao-popup');
  await new Promise((resolve) => setTimeout(resolve, 20));
  let respondeu = false;
  envio.then(() => { respondeu = true; });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.strictEqual(respondeu, false, 'o comando da aba com opener não pode ser dado como respondido antes do Chrome responder');
  await cliente.send(LIBERAR, {}, 'sessao-popup');
  await dentroDoPrazo(envio);
  await dentroDoPrazo(cliente.send('Page.enable', {}, 'sessao-1'));
});
