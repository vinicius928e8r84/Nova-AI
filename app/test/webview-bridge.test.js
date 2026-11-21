'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FONTE = fs.readFileSync(path.join(__dirname, '..', 'electron', 'webview-bridge.js'), 'utf8');
const NIVEL_DO_CHROMIUM = { log: 'info', info: 'info', error: 'error' };

const ehErro = valor => Boolean(valor) && typeof valor.stack === 'string';
const paraRegistro = valor => {
  if (!ehErro(valor)) return valor;
  return valor.name === 'SyntaxError' ? 'SyntaxError' : `${valor.name}: ${valor.message}`;
};
const retrato = palco => JSON.parse(JSON.stringify(palco.registro));

class Texto {
  constructor(palco, nodeValue, parentElement = null) {
    Object.assign(this, { palco, nodeType: 3, valor: nodeValue, parentElement, nome: nodeValue });
  }

  get nodeValue() {
    return this.valor;
  }

  set nodeValue(valor) {
    this.palco.registro.push(['nodeValue', this.nome, valor]);
    this.valor = valor;
  }
}

class Elemento {
  constructor(palco, tagName, dados = {}) {
    Object.assign(this, { palco, nodeType: 1, tagName, className: '', textos: [], seletores: {}, atributos: {}, innerText: '', disabled: false, ...dados });
    this.style = new Proxy({}, { set: (alvo, chave, valor) => { palco.registro.push(['style', this.tagName, chave, valor]); alvo[chave] = valor; return true; } });
  }

  querySelector(seletor) {
    this.palco.registro.push(['querySelector', this.tagName, seletor]);
    const achado = this.seletores[seletor];
    if (achado === 'lanca') throw new Error(`seletor inválido: ${seletor}`);
    return achado || null;
  }

  getAttribute(nome) {
    return nome in this.atributos ? this.atributos[nome] : null;
  }

  focus() {
    this.palco.registro.push(['focus', this.tagName]);
  }

  click() {
    this.palco.registro.push(['click', this.tagName, this.atributos['aria-label'] || this.atributos.title || '']);
  }

  dispatchEvent(evento) {
    this.palco.registro.push(['dispatchEvent', this.tagName, evento.type, evento.opcoes]);
  }

  set innerHTML(valor) {
    this.palco.registro.push(['innerHTML', this.tagName, valor]);
  }

  get textContent() {
    return this.conteudo || '';
  }

  set textContent(valor) {
    this.palco.registro.push(['textContent', this.tagName, valor]);
    this.conteudo = valor;
  }
}

function criarPalco({ readyState = 'complete', preencheNoExecCommand = false } = {}) {
  const palco = { registro: [], timers: [], ouvintesIpc: {}, observadores: [] };
  const registrar = (...itens) => palco.registro.push(itens);
  const documento = new Elemento(palco, '#document', { readyState, body: { nome: 'body' }, botoes: [] });
  documento.addEventListener = (tipo, ouvinte) => {
    registrar('addEventListener', tipo);
    palco.aoCarregar = ouvinte;
  };
  documento.querySelectorAll = seletor => {
    registrar('querySelectorAll', seletor);
    return documento.botoes;
  };
  documento.createTreeWalker = (no, filtro, f, e) => {
    registrar('createTreeWalker', no.tagName, filtro, f, e);
    const fila = [...no.textos];
    return { nextNode: () => fila.shift() || null };
  };
  documento.execCommand = (comando, ui, texto) => {
    registrar('execCommand', comando, ui, texto);
    if (preencheNoExecCommand) palco.focado.conteudo = texto;
  };
  class Evento {
    constructor(type, opcoes) {
      Object.assign(this, { type, opcoes });
    }
  }
  const textarea = { prototype: {} };
  Object.defineProperty(textarea.prototype, 'value', { set(valor) { registrar('value nativo', this.tagName, valor); } });
  const contexto = {
    require: modulo => {
      assert.equal(modulo, 'electron');
      return {
        ipcRenderer: {
          on: (canal, ouvinte) => { palco.ouvintesIpc[canal] = ouvinte; },
          sendToHost: (canal, dados) => {
            if (dados.lanca) throw new Error('host fora');
            registrar('sendToHost', canal, dados);
          },
        },
      };
    },
    console: Object.fromEntries(Object.keys(NIVEL_DO_CHROMIUM).map(nivel => [nivel, (...args) => registrar(NIVEL_DO_CHROMIUM[nivel], ...args.map(paraRegistro))])),
    document: documento,
    Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 },
    NodeFilter: { SHOW_TEXT: 4 },
    MutationObserver: class {
      constructor(callback) {
        palco.observadores.push(callback);
      }

      observe(alvo, opcoes) {
        registrar('observe', alvo.nome, opcoes);
      }
    },
    Event: Evento,
    KeyboardEvent: Evento,
    setTimeout: (funcao, atraso) => {
      registrar('setTimeout', atraso);
      palco.timers.push(funcao);
    },
    JSON,
    Object,
  };
  contexto.window = { HTMLTextAreaElement: textarea };
  palco.documento = documento;
  palco.carregar = () => {
    vm.createContext(contexto);
    vm.runInContext(FONTE, contexto);
    palco.ponte = contexto.window.NovaBridge;
  };
  palco.rodarTimers = () => {
    while (palco.timers.length) palco.timers.shift()();
  };
  palco.mutar = registros => palco.observadores.forEach(callback => callback(registros));
  palco.elemento = (tag, dados) => new Elemento(palco, tag, dados);
  palco.texto = (valor, pai) => new Texto(palco, valor, pai);
  return palco;
}

const COMANDO = '[[NOVA_TOOL_CALL: {"tool":"abrir","n":1}]]';
const OUTRO = '[[NOVA_TOOL_CALL: {"tool":"fechar"}]]';
const QUEBRADO = '[[NOVA_TOOL_CALL: {quebrado} ]]';
const FALHA_NO_HOST = '[[NOVA_TOOL_CALL: {"lanca":true}]]';

test('webview-bridge: carrega no DOMContentLoaded, ouve o host e intercepta comandos nas mutações', () => {
  const palco = criarPalco({ readyState: 'loading' });
  palco.carregar();
  palco.aoCarregar();
  palco.ouvintesIpc['nova-bridge-init']({}, { quem: 'host' });
  const vazio = palco.elemento('P', { innerText: '   ' });
  const cheio = palco.elemento('DIV', { innerText: 'resto' });
  const comPai = palco.texto(`  ${COMANDO} `, vazio);
  const comIrmao = palco.texto(`${OUTRO}${QUEBRADO} e mais`, cheio);
  const semPai = palco.texto(FALHA_NO_HOST);
  const caixa = palco.elemento('SECTION', { textos: [palco.texto('nada aqui'), palco.texto(`a ${COMANDO} b ${OUTRO}`, cheio)] });
  palco.mutar([
    { type: 'attributes', addedNodes: [palco.texto(COMANDO)], target: palco.texto(COMANDO) },
    { type: 'childList', addedNodes: [comIrmao, caixa, { nodeType: 8 }], target: palco.elemento('ARTICLE', { textos: [palco.texto(`${OUTRO}`, vazio)] }) },
    { type: 'characterData', addedNodes: null, target: comPai },
    { type: 'characterData', addedNodes: [], target: semPai },
    { type: 'childList', addedNodes: [palco.texto(''), palco.texto(`${COMANDO} só texto`, null), palco.texto(`${OUTRO} sobra`, palco.elemento('SPAN'))], target: null },
    { type: 'childList', addedNodes: [], target: { nodeType: 8 } },
  ]);
  assert.deepEqual(retrato(palco), [
    ['info', '[NOVA-BRIDGE] WebView Bridge injected successfully.'],
    ['addEventListener', 'DOMContentLoaded'],
    ['observe', 'body', { childList: true, subtree: true, characterData: true }],
    ['info', '[NOVA-BRIDGE] Started observing DOM for commands.'],
    ['info', '[NOVA-BRIDGE] Host connected:', { quem: 'host' }],
    ['info', '[NOVA-BRIDGE] Intercepted command:', { tool: 'fechar' }],
    ['sendToHost', 'nova-command', { tool: 'fechar' }],
    ['error', '[NOVA-BRIDGE] Failed to parse command JSON:', '{quebrado}', 'SyntaxError'],
    ['nodeValue', `${OUTRO}${QUEBRADO} e mais`, ' e mais'],
    ['createTreeWalker', 'SECTION', 4, null, false],
    ['info', '[NOVA-BRIDGE] Intercepted command:', { tool: 'abrir', n: 1 }],
    ['sendToHost', 'nova-command', { tool: 'abrir', n: 1 }],
    ['info', '[NOVA-BRIDGE] Intercepted command:', { tool: 'fechar' }],
    ['sendToHost', 'nova-command', { tool: 'fechar' }],
    ['nodeValue', `a ${COMANDO} b ${OUTRO}`, 'a  b '],
    ['createTreeWalker', 'ARTICLE', 4, null, false],
    ['info', '[NOVA-BRIDGE] Intercepted command:', { tool: 'fechar' }],
    ['sendToHost', 'nova-command', { tool: 'fechar' }],
    ['nodeValue', OUTRO, ''],
    ['style', 'P', 'display', 'none'],
    ['info', '[NOVA-BRIDGE] Intercepted command:', { tool: 'abrir', n: 1 }],
    ['sendToHost', 'nova-command', { tool: 'abrir', n: 1 }],
    ['nodeValue', `  ${COMANDO} `, '   '],
    ['style', 'P', 'display', 'none'],
    ['info', '[NOVA-BRIDGE] Intercepted command:', { lanca: true }],
    ['error', '[NOVA-BRIDGE] Failed to parse command JSON:', '{"lanca":true}', 'Error: host fora'],
    ['nodeValue', FALHA_NO_HOST, ''],
    ['info', '[NOVA-BRIDGE] Intercepted command:', { tool: 'abrir', n: 1 }],
    ['sendToHost', 'nova-command', { tool: 'abrir', n: 1 }],
    ['nodeValue', `${COMANDO} só texto`, ' só texto'],
    ['info', '[NOVA-BRIDGE] Intercepted command:', { tool: 'fechar' }],
    ['sendToHost', 'nova-command', { tool: 'fechar' }],
    ['nodeValue', `${OUTRO} sobra`, ' sobra'],
  ]);
});

const EVENTOS = ['input', 'change', 'keyup', 'compositionend'].map(tipo => ['dispatchEvent', 'TEXTAREA', tipo, { bubbles: true, cancelable: true }]);
const eventosDe = tag => EVENTOS.map(([nome, , tipo, opcoes]) => [nome, tag, tipo, opcoes]);
const SELETORES_DO_ENVIAR = [
  'button[aria-label="Send message"]', 'button[mattooltip="Send message"]', '.send-button', 'button.send-button', '[data-test-id="send-button"]', 'button:has(svg path)',
];
const consultasDoEnviar = ate => SELETORES_DO_ENVIAR.slice(0, ate).map(seletor => ['querySelector', '#document', seletor]);

test('webview-bridge: textarea na sombra do rich-textarea, botão desabilitado e depois clicado', async () => {
  const palco = criarPalco();
  palco.carregar();
  const campo = palco.elemento('TEXTAREA', { className: 'campo-de-texto-com-um-nome-de-classe-bem-comprido' });
  const sombra = palco.elemento('#shadow', { seletores: { textarea: campo } });
  palco.documento.seletores['rich-textarea'] = palco.elemento('RICH-TEXTAREA', { shadowRoot: sombra });
  const botao = palco.elemento('BUTTON', { disabled: true, atributos: { 'aria-label': 'Send message' } });
  palco.documento.seletores['.send-button'] = botao;
  palco.registro.length = 0;
  await palco.ponte.sendFeedback(`${'p'.repeat(70)}`);
  palco.timers.shift()();
  botao.disabled = false;
  palco.rodarTimers();
  assert.deepEqual(retrato(palco), [
    ['info', '[NOVA-BRIDGE] Attempting to inject prompt:', 'p'.repeat(60)],
    ['querySelector', '#document', 'rich-textarea'],
    ['querySelector', '#shadow', '[contenteditable="true"]'],
    ['querySelector', '#shadow', 'textarea'],
    ['info', '[NOVA-BRIDGE] ✓ Found input:', 'TEXTAREA', 'campo-de-texto-com-um-nome-de-classe-bem'],
    ['focus', 'TEXTAREA'],
    ['value nativo', 'TEXTAREA', 'p'.repeat(70)],
    ...EVENTOS,
    ['info', '[NOVA-BRIDGE] ✓ Text injected. Waiting before clicking send...'],
    ['setTimeout', 500],
    ...consultasDoEnviar(3),
    ['setTimeout', 300],
    ...consultasDoEnviar(3),
    ['info', '[NOVA-BRIDGE] ✓ Send button found. Clicking.'],
    ['click', 'BUTTON', 'Send message'],
  ]);
});

test('webview-bridge: editável filho direto, seletor que lança e botão achado pelo aria-label ou pelo título', async () => {
  for (const [atributos, preenche] of [[{ 'aria-label': 'SEND now' }, false], [{ title: 'Send' }, true]]) {
    const palco = criarPalco({ preencheNoExecCommand: preenche });
    palco.carregar();
    const campo = palco.elemento('DIV');
    palco.focado = campo;
    palco.documento.seletores['rich-textarea'] = palco.elemento('RICH-TEXTAREA', { seletores: { '[contenteditable="true"]': campo } });
    palco.documento.seletores['button:has(svg path)'] = 'lanca';
    palco.documento.botoes = [palco.elemento('BUTTON', { atributos: { 'aria-label': 'Menu' } }), palco.elemento('BUTTON', { atributos })];
    palco.registro.length = 0;
    await palco.ponte.sendFeedback('olá');
    palco.rodarTimers();
    assert.deepEqual(retrato(palco), [
      ['info', '[NOVA-BRIDGE] Attempting to inject prompt:', 'olá'],
      ['querySelector', '#document', 'rich-textarea'],
      ['querySelector', 'RICH-TEXTAREA', '[contenteditable="true"]'],
      ['info', '[NOVA-BRIDGE] ✓ Found input:', 'DIV', ''],
      ['focus', 'DIV'],
      ['innerHTML', 'DIV', ''],
      ['execCommand', 'insertText', false, 'olá'],
      ...(preenche ? [] : [['textContent', 'DIV', 'olá']]),
      ...eventosDe('DIV'),
      ['info', '[NOVA-BRIDGE] ✓ Text injected. Waiting before clicking send...'],
      ['setTimeout', 500],
      ...consultasDoEnviar(6),
      ['querySelectorAll', 'button'],
      ['info', '[NOVA-BRIDGE] ✓ Send button found. Clicking.'],
      ['click', 'BUTTON', atributos['aria-label'] || atributos.title],
    ]);
  }
});

test('webview-bridge: campos de reserva da página, Enter depois de 5 tentativas, sem campo e erro no texto', async () => {
  const palco = criarPalco();
  palco.carregar();
  const campo = palco.elemento('TEXTAREA');
  palco.documento.seletores['textarea[aria-label]'] = campo;
  palco.documento.seletores['rich-textarea'] = palco.elemento('RICH-TEXTAREA', { shadowRoot: palco.elemento('#shadow') });
  palco.registro.length = 0;
  await palco.ponte.sendFeedback('x');
  palco.rodarTimers();
  const tentativa = [...consultasDoEnviar(6), ['querySelectorAll', 'button']];
  assert.deepEqual(retrato(palco), [
    ['info', '[NOVA-BRIDGE] Attempting to inject prompt:', 'x'],
    ['querySelector', '#document', 'rich-textarea'],
    ['querySelector', '#shadow', '[contenteditable="true"]'],
    ['querySelector', '#shadow', 'textarea'],
    ['querySelector', 'RICH-TEXTAREA', '[contenteditable="true"]'],
    ['querySelector', 'RICH-TEXTAREA', 'textarea'],
    ['querySelector', '#document', '.ql-editor[contenteditable="true"]'],
    ['querySelector', '#document', 'div[contenteditable="true"]'],
    ['querySelector', '#document', 'textarea[aria-label]'],
    ['info', '[NOVA-BRIDGE] ✓ Found input:', 'TEXTAREA', ''],
    ['focus', 'TEXTAREA'],
    ['value nativo', 'TEXTAREA', 'x'],
    ...EVENTOS,
    ['info', '[NOVA-BRIDGE] ✓ Text injected. Waiting before clicking send...'],
    ['setTimeout', 500],
    ...[5, 4, 3, 2, 1].flatMap(() => [...tentativa, ['setTimeout', 300]]),
    ['info', '[NOVA-BRIDGE] Falling back to Enter key.'],
    ['dispatchEvent', 'TEXTAREA', 'keydown', { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13 }],
  ]);
  delete palco.documento.seletores['textarea[aria-label]'];
  delete palco.documento.seletores['rich-textarea'];
  palco.registro.length = 0;
  await palco.ponte.sendFeedback('y');
  await palco.ponte.sendFeedback(null);
  assert.deepEqual(retrato(palco), [
    ['info', '[NOVA-BRIDGE] Attempting to inject prompt:', 'y'],
    ['querySelector', '#document', 'rich-textarea'],
    ['querySelector', '#document', '.ql-editor[contenteditable="true"]'],
    ['querySelector', '#document', 'div[contenteditable="true"]'],
    ['querySelector', '#document', 'textarea[aria-label]'],
    ['error', '[NOVA-BRIDGE] ❌ Input element not found.'],
    ['error', '[NOVA-BRIDGE] sendFeedback error:', 'TypeError: Cannot read properties of null (reading \'substring\')'],
  ]);
});
