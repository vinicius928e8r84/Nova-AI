const { ipcRenderer } = require('electron');

console.log('[NOVA-BRIDGE] WebView Bridge injected successfully.');

ipcRenderer.on('nova-bridge-init', (event, data) => {
    console.log('[NOVA-BRIDGE] Host connected:', data);
});

const observeChat = () => {
    const chatContainerSelector = 'body'; // Gemini's main body
    
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.type === 'childList' || mutation.type === 'characterData') {
                processNodes(mutation.addedNodes);
                if (mutation.target && mutation.target.nodeType === Node.TEXT_NODE) {
                    processTextNode(mutation.target);
                } else if (mutation.target && mutation.target.nodeType === Node.ELEMENT_NODE) {
                    processNodes([mutation.target]);
                }
            }
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
    });
    
    console.log('[NOVA-BRIDGE] Started observing DOM for commands.');
};

const COMMAND_REGEX = /\[\[NOVA_TOOL_CALL:\s*(\{.*?\})\s*\]\]/g;

function processNodes(nodes) {
    if (!nodes) return;
    nodes.forEach(node => {
        if (node.nodeType === Node.TEXT_NODE) {
            processTextNode(node);
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, null, false);
            let textNode;
            while ((textNode = walker.nextNode())) {
                processTextNode(textNode);
            }
        }
    });
}

function processTextNode(node) {
    if (!node.nodeValue) return;
    
    const text = node.nodeValue;
    let match;
    
    COMMAND_REGEX.lastIndex = 0; 
    let hasMatch = false;
    
    while ((match = COMMAND_REGEX.exec(text)) !== null) {
        hasMatch = true;
        const jsonStr = match[1];
        try {
            const commandData = JSON.parse(jsonStr);
            console.log('[NOVA-BRIDGE] Intercepted command:', commandData);
            
            ipcRenderer.sendToHost('nova-command', commandData);
            
        } catch (e) {
            console.error('[NOVA-BRIDGE] Failed to parse command JSON:', jsonStr, e);
        }
    }
    
    if (hasMatch) {
        const newText = text.replace(COMMAND_REGEX, '');
        node.nodeValue = newText;
        
        if (newText.trim() === '' && node.parentElement) {
            if (node.parentElement.innerText.trim() === '') {
                node.parentElement.style.display = 'none';
            }
        }
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', observeChat);
} else {
    observeChat();
}

window.NovaBridge = {
    sendFeedback: async (text) => {
        try {
            console.log('[NOVA-BRIDGE] Attempting to inject prompt:', text.substring(0, 60));

            let inputEl = null;

            const richTA = document.querySelector('rich-textarea');
            if (richTA) {
                if (richTA.shadowRoot) {
                    inputEl = richTA.shadowRoot.querySelector('[contenteditable="true"]') ||
                              richTA.shadowRoot.querySelector('textarea');
                }
                if (!inputEl) {
                    inputEl = richTA.querySelector('[contenteditable="true"]') ||
                              richTA.querySelector('textarea');
                }
            }

            if (!inputEl) {
                inputEl = document.querySelector('.ql-editor[contenteditable="true"]') ||
                          document.querySelector('div[contenteditable="true"]') ||
                          document.querySelector('textarea[aria-label]');
            }

            if (!inputEl) {
                console.error('[NOVA-BRIDGE] ❌ Input element not found.');
                return;
            }

            console.log('[NOVA-BRIDGE] ✓ Found input:', inputEl.tagName, inputEl.className.substring(0, 40));

            inputEl.focus();

            if (inputEl.tagName === 'TEXTAREA') {
                const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                    window.HTMLTextAreaElement.prototype, 'value'
                ).set;
                nativeInputValueSetter.call(inputEl, text);
            } else {
                inputEl.innerHTML = '';
                document.execCommand('insertText', false, text);

                if (!inputEl.textContent.trim()) {
                    inputEl.textContent = text;
                }
            }

            const eventTypes = ['input', 'change', 'keyup', 'compositionend'];
            eventTypes.forEach(evType => {
                inputEl.dispatchEvent(new Event(evType, { bubbles: true, cancelable: true }));
            });

            console.log('[NOVA-BRIDGE] ✓ Text injected. Waiting before clicking send...');

            const tryClickSend = (attempts) => {
                if (attempts <= 0) {
                    console.log('[NOVA-BRIDGE] Falling back to Enter key.');
                    inputEl.dispatchEvent(new KeyboardEvent('keydown', {
                        bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13
                    }));
                    return;
                }

                const selectors = [
                    'button[aria-label="Send message"]',
                    'button[mattooltip="Send message"]',
                    '.send-button',
                    'button.send-button',
                    '[data-test-id="send-button"]',
                    'button:has(svg path)',
                ];

                let btn = null;
                for (const sel of selectors) {
                    try { btn = document.querySelector(sel); if (btn) break; } catch(e) {}
                }

                if (!btn) {
                    btn = [...document.querySelectorAll('button')].find(b => {
                        const aria = (b.getAttribute('aria-label') || '').toLowerCase();
                        const title = (b.getAttribute('title') || '').toLowerCase();
                        return aria.includes('send') || title.includes('send');
                    });
                }

                if (btn && !btn.disabled) {
                    console.log('[NOVA-BRIDGE] ✓ Send button found. Clicking.');
                    btn.click();
                } else {
                    setTimeout(() => tryClickSend(attempts - 1), 300);
                }
            };

            setTimeout(() => tryClickSend(5), 500);

        } catch (e) {
            console.error('[NOVA-BRIDGE] sendFeedback error:', e);
        }
    }
};
