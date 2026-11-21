const { ipcRenderer } = require('electron');

console.log('[NOVA-BRIDGE] WebView Bridge injected successfully.');

ipcRenderer.on('nova-bridge-init', (event, data) => {
    console.log('[NOVA-BRIDGE] Host connected:', data);
});

const COMMAND_REGEX = /\[\[NOVA_TOOL_CALL:\s*(\{.*?\})\s*\]\]/g;
const MUDANCAS_COM_TEXTO = new Set(['childList', 'characterData']);
const CAMPOS_DO_RICH_TEXTAREA = ['[contenteditable="true"]', 'textarea'];
const CAMPOS_DA_PAGINA = ['.ql-editor[contenteditable="true"]', 'div[contenteditable="true"]', 'textarea[aria-label]'];
const EVENTOS_DE_MUDANCA = ['input', 'change', 'keyup', 'compositionend'];
const SELETORES_DO_ENVIAR = [
    'button[aria-label="Send message"]',
    'button[mattooltip="Send message"]',
    '.send-button',
    'button.send-button',
    '[data-test-id="send-button"]',
    'button:has(svg path)',
];
const TENTATIVAS_DE_ENVIO = 5;
const ESPERA_ANTES_DE_ENVIAR_MS = 500;
const ESPERA_ENTRE_TENTATIVAS_MS = 300;

function processarTextosDoElemento(elemento) {
    const walker = document.createTreeWalker(elemento, NodeFilter.SHOW_TEXT, null, false);
    for (let textNode = walker.nextNode(); textNode; textNode = walker.nextNode()) processTextNode(textNode);
}

function processarNo(node) {
    if (node.nodeType === Node.TEXT_NODE) processTextNode(node);
    else if (node.nodeType === Node.ELEMENT_NODE) processarTextosDoElemento(node);
}

function processNodes(nodes) {
    if (!nodes) return;
    nodes.forEach(node => processarNo(node));
}

function processarMutacao(mutation) {
    if (!MUDANCAS_COM_TEXTO.has(mutation.type)) return;
    processNodes(mutation.addedNodes);
    if (mutation.target) processarNo(mutation.target);
}

const observeChat = () => {
    const observer = new MutationObserver(mutations => mutations.forEach(mutation => processarMutacao(mutation)));
    observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
    });
    console.info('[NOVA-BRIDGE] Started observing DOM for commands.');
};

function enviarComando(jsonStr) {
    try {
        const commandData = JSON.parse(jsonStr);
        console.info('[NOVA-BRIDGE] Intercepted command:', commandData);
        ipcRenderer.sendToHost('nova-command', commandData);
    } catch (e) {
        console.error('[NOVA-BRIDGE] Failed to parse command JSON:', jsonStr, e);
    }
}

const estaVazio = texto => texto.trim() === '';

function paiFicouVazio(node, newText) {
    if (!estaVazio(newText) || !node.parentElement) return false;
    return estaVazio(node.parentElement.innerText);
}

function esconderComandos(node, text) {
    const newText = text.replace(COMMAND_REGEX, '');
    node.nodeValue = newText;
    if (paiFicouVazio(node, newText)) node.parentElement.style.display = 'none';
}

function processTextNode(node) {
    if (!node.nodeValue) return;
    const text = node.nodeValue;
    const comandos = [...text.matchAll(COMMAND_REGEX)].map(match => match[1]);
    comandos.forEach(jsonStr => enviarComando(jsonStr));
    if (comandos.length) esconderComandos(node, text);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', observeChat);
} else {
    observeChat();
}

const primeiroQueCasa = (raiz, seletores) => seletores.reduce((achado, seletor) => achado || raiz.querySelector(seletor), null);

function campoDoRichTextarea() {
    const richTA = document.querySelector('rich-textarea');
    if (!richTA) return null;
    const naSombra = richTA.shadowRoot ? primeiroQueCasa(richTA.shadowRoot, CAMPOS_DO_RICH_TEXTAREA) : null;
    return naSombra || primeiroQueCasa(richTA, CAMPOS_DO_RICH_TEXTAREA);
}

const acharCampo = () => campoDoRichTextarea() || primeiroQueCasa(document, CAMPOS_DA_PAGINA);

function escreverNoTextarea(inputEl, text) {
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    nativeInputValueSetter.call(inputEl, text);
}

function escreverNoEditavel(inputEl, text) {
    inputEl.innerHTML = '';
    document.execCommand('insertText', false, text);
    if (!inputEl.textContent.trim()) inputEl.textContent = text;
}

function escreverTexto(inputEl, text) {
    inputEl.focus();
    if (inputEl.tagName === 'TEXTAREA') escreverNoTextarea(inputEl, text);
    else escreverNoEditavel(inputEl, text);
    EVENTOS_DE_MUDANCA.forEach(evType => inputEl.dispatchEvent(new Event(evType, { bubbles: true, cancelable: true })));
}

function consultarSemErro(seletor) {
    try {
        return document.querySelector(seletor);
    } catch {
        return null;
    }
}

function ehBotaoDeEnviar(botao) {
    const aria = (botao.getAttribute('aria-label') || '').toLowerCase();
    const title = (botao.getAttribute('title') || '').toLowerCase();
    return aria.includes('send') || title.includes('send');
}

const botaoPorSeletor = () => SELETORES_DO_ENVIAR.reduce((achado, seletor) => achado || consultarSemErro(seletor), null);
const acharBotaoDeEnviar = () => botaoPorSeletor() || [...document.querySelectorAll('button')].find(ehBotaoDeEnviar);
const estaPronto = botao => Boolean(botao) && !botao.disabled;

function apertarEnter(inputEl) {
    console.info('[NOVA-BRIDGE] Falling back to Enter key.');
    inputEl.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13
    }));
}

function tentarEnviar(inputEl, attempts) {
    if (attempts <= 0) {
        apertarEnter(inputEl);
        return;
    }
    const btn = acharBotaoDeEnviar();
    if (!estaPronto(btn)) {
        setTimeout(() => tentarEnviar(inputEl, attempts - 1), ESPERA_ENTRE_TENTATIVAS_MS);
        return;
    }
    console.info('[NOVA-BRIDGE] ✓ Send button found. Clicking.');
    btn.click();
}

window.NovaBridge = {
    sendFeedback: async (text) => {
        try {
            console.info('[NOVA-BRIDGE] Attempting to inject prompt:', text.substring(0, 60));
            const inputEl = acharCampo();
            if (!inputEl) {
                console.error('[NOVA-BRIDGE] ❌ Input element not found.');
                return;
            }
            console.info('[NOVA-BRIDGE] ✓ Found input:', inputEl.tagName, inputEl.className.substring(0, 40));
            escreverTexto(inputEl, text);
            console.info('[NOVA-BRIDGE] ✓ Text injected. Waiting before clicking send...');
            setTimeout(() => tentarEnviar(inputEl, TENTATIVAS_DE_ENVIO), ESPERA_ANTES_DE_ENVIAR_MS);
        } catch (e) {
            console.error('[NOVA-BRIDGE] sendFeedback error:', e);
        }
    }
};
