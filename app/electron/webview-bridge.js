const { ipcRenderer } = require('electron');

console.info('[NOVA-BRIDGE] WebView Bridge injected successfully.');

ipcRenderer.on('nova-bridge-init', (event, data) => {
    console.info('[NOVA-BRIDGE] Host connected:', data);
});

const COMMAND_REGEX = /\[\[NOVA_TOOL_CALL:\s*(\{.*?\})\s*\]\]/g;

const SELETORES_DO_BOTAO_DE_ENVIO = [
    'button[aria-label="Send message"]',
    'button[mattooltip="Send message"]',
    '.send-button',
    'button.send-button',
    '[data-test-id="send-button"]',
    'button:has(svg path)',
];

const EVENTOS_DE_MUDANCA = ['input', 'change', 'keyup', 'compositionend'];

function processarMutacao(mutation) {
    if (mutation.type !== 'childList' && mutation.type !== 'characterData') return;
    processNodes(mutation.addedNodes);
    const alvo = mutation.target;
    if (alvo && alvo.nodeType === Node.TEXT_NODE) {
        processTextNode(alvo);
    } else if (alvo && alvo.nodeType === Node.ELEMENT_NODE) {
        processNodes([alvo]);
    }
}

const observeChat = () => {
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) processarMutacao(mutation);
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
    });

    console.info('[NOVA-BRIDGE] Started observing DOM for commands.');
};

function processarTextosDe(elemento) {
    const walker = document.createTreeWalker(elemento, NodeFilter.SHOW_TEXT, null, false);
    let textNode;
    while ((textNode = walker.nextNode())) {
        processTextNode(textNode);
    }
}

function processarNo(node) {
    if (node.nodeType === Node.TEXT_NODE) {
        processTextNode(node);
    } else if (node.nodeType === Node.ELEMENT_NODE) {
        processarTextosDe(node);
    }
}

function processNodes(nodes) {
    if (!nodes) return;
    nodes.forEach(processarNo);
}

function encaminharComando(jsonStr) {
    try {
        const commandData = JSON.parse(jsonStr);
        console.info('[NOVA-BRIDGE] Intercepted command:', commandData);

        ipcRenderer.sendToHost('nova-command', commandData);

    } catch (e) {
        console.error('[NOVA-BRIDGE] Failed to parse command JSON:', jsonStr, e);
    }
}

function encaminharComandosDe(text) {
    let match;
    let hasMatch = false;

    COMMAND_REGEX.lastIndex = 0;

    while ((match = COMMAND_REGEX.exec(text)) !== null) {
        hasMatch = true;
        encaminharComando(match[1]);
    }
    return hasMatch;
}

function esconderPaiSeFicouVazio(node) {
    const pai = node.parentElement;
    if (pai && pai.innerText.trim() === '') {
        pai.style.display = 'none';
    }
}

function processTextNode(node) {
    if (!node.nodeValue) return;

    const text = node.nodeValue;

    if (!encaminharComandosDe(text)) return;

    const newText = text.replace(COMMAND_REGEX, '');
    node.nodeValue = newText;

    if (newText.trim() === '') esconderPaiSeFicouVazio(node);
}

function campoDentroDe(raiz) {
    return raiz.querySelector('[contenteditable="true"]') || raiz.querySelector('textarea');
}

function campoDoRichTextarea() {
    const richTA = document.querySelector('rich-textarea');
    if (!richTA) return null;

    const naSombra = richTA.shadowRoot ? campoDentroDe(richTA.shadowRoot) : null;
    return naSombra || campoDentroDe(richTA);
}

function acharCampoDeTexto() {
    return campoDoRichTextarea() ||
        document.querySelector('.ql-editor[contenteditable="true"]') ||
        document.querySelector('div[contenteditable="true"]') ||
        document.querySelector('textarea[aria-label]');
}

function escreverNoCampo(inputEl, text) {
    if (inputEl.tagName === 'TEXTAREA') {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype, 'value'
        ).set;
        nativeInputValueSetter.call(inputEl, text);
        return;
    }

    inputEl.innerHTML = '';
    document.execCommand('insertText', false, text);

    if (!inputEl.textContent.trim()) {
        inputEl.textContent = text;
    }
}

function avisarMudancaDoCampo(inputEl) {
    EVENTOS_DE_MUDANCA.forEach(evType => {
        inputEl.dispatchEvent(new Event(evType, { bubbles: true, cancelable: true }));
    });
}

function botaoPorSeletor() {
    for (const sel of SELETORES_DO_BOTAO_DE_ENVIO) {
        try {
            const btn = document.querySelector(sel);
            if (btn) return btn;
        } catch(e) {}
    }
    return null;
}

const mencionaSend = (botao, atributo) => (botao.getAttribute(atributo) || '').toLowerCase().includes('send');

const ehBotaoDeEnvio = (botao) => mencionaSend(botao, 'aria-label') || mencionaSend(botao, 'title');

const botaoPeloTexto = () => [...document.querySelectorAll('button')].find(ehBotaoDeEnvio);

function enterComoUltimoRecurso(inputEl) {
    console.info('[NOVA-BRIDGE] Falling back to Enter key.');
    inputEl.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13
    }));
}

function tryClickSend(inputEl, attempts) {
    if (attempts <= 0) {
        enterComoUltimoRecurso(inputEl);
        return;
    }

    const btn = botaoPorSeletor() || botaoPeloTexto();

    if (btn && !btn.disabled) {
        console.info('[NOVA-BRIDGE] ✓ Send button found. Clicking.');
        btn.click();
    } else {
        setTimeout(() => tryClickSend(inputEl, attempts - 1), 300);
    }
}

async function sendFeedback(text) {
    try {
        console.info('[NOVA-BRIDGE] Attempting to inject prompt:', text.substring(0, 60));

        const inputEl = acharCampoDeTexto();

        if (!inputEl) {
            console.error('[NOVA-BRIDGE] ❌ Input element not found.');
            return;
        }

        console.info('[NOVA-BRIDGE] ✓ Found input:', inputEl.tagName, inputEl.className.substring(0, 40));

        inputEl.focus();

        escreverNoCampo(inputEl, text);
        avisarMudancaDoCampo(inputEl);

        console.info('[NOVA-BRIDGE] ✓ Text injected. Waiting before clicking send...');

        setTimeout(() => tryClickSend(inputEl, 5), 500);

    } catch (e) {
        console.error('[NOVA-BRIDGE] sendFeedback error:', e);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', observeChat);
} else {
    observeChat();
}

window.NovaBridge = { sendFeedback };
