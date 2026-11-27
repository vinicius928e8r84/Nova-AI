'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { segurarAbasSemOpenerAteODisfarce } = require('../global-spoof-abertura');

const LIBERAR = 'Runtime.runIfWaitingForDebugger';
const PRAZO_EM_MS = 300;
const DOCUMENTO = { requestId: 'documento-1', resourceType: 'Document', request: { url: 'https://site.example.com/b', headers: { Referer: 'https://site.example.com/a' } } };

function criarTrava() {
  let destravar;
  const destravada = new Promise((resolve) => { destravar = resolve; });
  return { destravada, destravar };
}

class ChromeFalso {
  constructor(comFalha) {
    this.comFalha = comFalha;
    this.enviados = [];
    this.ouvintes = {};
    this.pausadas = new Set();
    this.destravar = new Map();
  }

  on(evento, ouvinte) {
    this.ouvintes[evento] = ouvinte;
  }

  travaDe(sessao) {
    if (!this.destravar.has(sessao)) this.destravar.set(sessao, criarTrava());
    return this.destravar.get(sessao);
  }

  async responderDepoisDaNavegacao(metodo, sessao) {
    if (this.pausadas.has(sessao)) await this.travaDe(sessao).destravada;
    if (metodo === this.comFalha) throw new Error(`${metodo} recusado`);
    return {};
  }

  liberar(sessao) {
    if (this.pausadas.has(sessao)) setTimeout(() => this.ouvintes['Fetch.requestPaused'](DOCUMENTO, sessao), 5);
    return {};
  }

  async send(metodo, params, sessao) {
    this.enviados.push({ metodo, params, sessao });
    if (metodo === 'Fetch.failRequest') this.travaDe(sessao).destravar();
    if (metodo.startsWith('Fetch.')) return {};
    if (metodo === LIBERAR) return this.liberar(sessao);
    return this.responderDepoisDaNavegacao(metodo, sessao);
  }
}

const criarChrome = ({ comFalha } = {}) => new ChromeFalso(comFalha);

async function anexar(chrome, sessionId, targetInfo, { pausada = true } = {}) {
  if (pausada) chrome.pausadas.add(sessionId);
  await chrome.ouvintes['Target.attachedToTarget']({ sessionId, targetInfo, waitingForDebugger: pausada });
}

const abaSemOpener = { targetId: 'aba-nova', type: 'page', url: '', openerId: 'aba-1', canAccessOpener: false };

const dentroDoPrazo = (promessa) => Promise.race([promessa, new Promise((_, rejeitar) => setTimeout(() => rejeitar(new Error('travou esperando a resposta do Chrome')), PRAZO_EM_MS))]);

async function disfarcarELiberar(cliente, sessao, comandos = ['Page.enable', 'Page.addScriptToEvaluateOnNewDocument']) {
  for (const metodo of comandos) await cliente.send(metodo, {}, sessao);
  await cliente.send(LIBERAR, {}, sessao);
}

const metodosEnviados = (chrome) => chrome.enviados.map((e) => e.metodo);

test('aba sem opener: segura o documento, cancela o pedido, espera o disfarce e só então navega para a URL pedida', async () => {
  const chrome = criarChrome();
  const cliente = segurarAbasSemOpenerAteODisfarce(chrome);
  await anexar(chrome, 'sessao-nova', abaSemOpener);
  await dentroDoPrazo(disfarcarELiberar(cliente, 'sessao-nova'));
  assert.deepStrictEqual(metodosEnviados(chrome), ['Fetch.enable', 'Page.enable', 'Page.addScriptToEvaluateOnNewDocument', LIBERAR, 'Fetch.failRequest', 'Fetch.disable', 'Page.navigate']);
  assert.deepStrictEqual(chrome.enviados[0].params, { patterns: [{ requestStage: 'Request', resourceType: 'Document' }] });
  assert.deepStrictEqual(chrome.enviados[4].params, { requestId: 'documento-1', errorReason: 'Aborted' });
  assert.deepStrictEqual(chrome.enviados[6].params, { url: 'https://site.example.com/b', referrer: 'https://site.example.com/a' });
});

test('aba sem opener: se um comando do disfarce falha, a liberação falha, nenhum pedido sai e a aba não navega', async () => {
  const chrome = criarChrome({ comFalha: 'Page.addScriptToEvaluateOnNewDocument' });
  const cliente = segurarAbasSemOpenerAteODisfarce(chrome);
  await anexar(chrome, 'sessao-nova', abaSemOpener);
  await assert.rejects(dentroDoPrazo(disfarcarELiberar(cliente, 'sessao-nova')), /recusado/);
  chrome.ouvintes['Fetch.requestPaused']({ ...DOCUMENTO, requestId: 'documento-2' }, 'sessao-nova');
  await cliente.send('Fetch.continueRequest', { requestId: 'documento-2' }, 'sessao-nova');
  assert.deepStrictEqual(metodosEnviados(chrome), ['Fetch.enable', 'Page.enable', 'Page.addScriptToEvaluateOnNewDocument', LIBERAR, 'Fetch.failRequest', 'Fetch.failRequest']);
});

test('aba sem opener com proxy: o serviço não solta o documento segurado e, depois do disfarce, continua dono do Fetch', async () => {
  const chrome = criarChrome();
  const cliente = segurarAbasSemOpenerAteODisfarce(chrome);
  await anexar(chrome, 'sessao-nova', abaSemOpener);
  chrome.ouvintes['Fetch.requestPaused'] = ((cancelar) => (pedido, sessao) => {
    cancelar(pedido, sessao);
    cliente.send('Fetch.continueRequest', { requestId: pedido.requestId }, sessao);
  })(chrome.ouvintes['Fetch.requestPaused']);
  await dentroDoPrazo(disfarcarELiberar(cliente, 'sessao-nova', ['Fetch.enable', 'Page.enable']));
  assert.deepStrictEqual(metodosEnviados(chrome), ['Fetch.enable', 'Fetch.enable', 'Page.enable', LIBERAR, 'Fetch.failRequest', 'Page.navigate']);
  await cliente.send('Fetch.continueRequest', { requestId: 'documento-3' }, 'sessao-nova');
  assert.strictEqual(metodosEnviados(chrome).at(-1), 'Fetch.continueRequest');
});

test('a primeira aba e a janela que pode falar com a aba de origem continuam esperando cada resposta', async () => {
  const chrome = criarChrome();
  const cliente = segurarAbasSemOpenerAteODisfarce(chrome);
  await anexar(chrome, 'sessao-1', { targetId: 'aba-1', type: 'page', url: 'about:blank', canAccessOpener: false }, { pausada: false });
  await anexar(chrome, 'sessao-popup', { targetId: 'popup', type: 'page', url: '', openerId: 'aba-1', canAccessOpener: true });
  const envio = cliente.send('Page.enable', {}, 'sessao-popup');
  let respondeu = false;
  envio.then(() => { respondeu = true; });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.strictEqual(respondeu, false, 'o comando da aba com opener não pode ser dado como respondido antes do Chrome responder');
  chrome.destravar.get('sessao-popup').destravar();
  await dentroDoPrazo(envio);
  await dentroDoPrazo(cliente.send('Page.enable', {}, 'sessao-1'));
  assert.ok(!metodosEnviados(chrome).some((metodo) => metodo.startsWith('Fetch.')));
});
