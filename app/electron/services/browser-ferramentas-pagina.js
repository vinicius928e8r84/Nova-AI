'use strict';

const path = require('path');
const { app } = require('electron');
const { DOWNLOAD_DIR } = require('./browser-perfil');
const {
    ERRO_TRANSITORIO, ERRO_PERMANENTE, ARGUMENTO_INVALIDO, NAVEGACAO_LENTA, PAGINA_QUEBROU,
    sucesso, falhou, semElemento, montarSnapshot, textoDaArvoreCdp,
} = require('./browser-respostas');

const TEMPO_MAXIMO_DE_ESPERA = 30000;

const ROLAGENS = new Map([
    ['top', page => page.evaluate(() => window.scrollTo(0, 0))],
    ['bottom', page => page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))],
    ['left', (page, amount) => page.evaluate((val) => window.scrollBy(-val, 0), amount || 500)],
    ['right', (page, amount) => page.evaluate((val) => window.scrollBy(val, 0), amount || 500)],
]);

function rolarNaVertical(page, direction, amount) {
    const y = direction === 'down' ? (amount || 500) : -(amount || 500);
    return page.evaluate((val) => window.scrollBy(0, val), y);
}

const ESPERAS = [
    ['text', (page, { text, timeout }) => page.waitForFunction(
        (t) => document.body.innerText.includes(t),
        text,
        { timeout: timeout || 20000 }
    ), ({ text }) => `Text "${text}" appeared`],
    ['textGone', (page, { textGone, timeout }) => page.waitForFunction(
        (t) => !document.body.innerText.includes(t),
        textGone,
        { timeout: timeout || 20000 }
    ), ({ textGone }) => `Text "${textGone}" disappeared`],
    ['url', (page, { url, timeout }) => page.waitForURL(url, { timeout: timeout || 20000 }), (opcoes, page) => `URL matched: ${page.url()}`],
    ['loadState', (page, { loadState, timeout }) => page.waitForLoadState(loadState, { timeout: timeout || 20000 }), ({ loadState }) => `Load state "${loadState}" reached`],
    ['jsFunction', (page, { jsFunction, timeout }) => page.waitForFunction(jsFunction, { timeout: timeout || 20000 }), () => `JS condition met`],
];

const NAVEGACOES = {
    browser_go_back: { ir: page => page.goBack({ waitUntil: 'domcontentloaded', timeout: 10000 }), feito: 'Went back to', falha: 'Go back failed', dica: 'There may be no previous page in history.' },
    browser_go_forward: { ir: page => page.goForward({ waitUntil: 'domcontentloaded', timeout: 10000 }), feito: 'Went forward to', falha: 'Go forward failed', dica: 'There may be no next page in history.' },
};

const lerElementosDaPagina = ({ sel, lim, maxChars }) => {
    const ouVazio = valor => valor || '';
    const elements = Array.from(document.querySelectorAll(sel)).slice(0, lim);
    return elements.map((el, i) => ({
        index: i,
        tag: el.tagName.toLowerCase(),
        text: ouVazio(el.innerText || el.textContent).trim().substring(0, maxChars),
        value: ouVazio(el.value),
        href: ouVazio(el.href),
        id: ouVazio(el.id),
        className: ouVazio(el.className),
        type: ouVazio(el.type),
        placeholder: ouVazio(el.placeholder),
    }));
};

const opcoesDaEspera = opts => ((typeof opts === 'object' && opts !== null) ? opts : { selector: opts });

async function esperarRedeQuieta(page) {
    try { await page.waitForLoadState('networkidle', { timeout: 5000 }); } catch (e) { }
}

async function compactarImagem(buffer, toolName, startTime) {
    const { Jimp } = require('jimp');
    const image = await Jimp.read(buffer);
    if (image.bitmap.width > 1280) {
        image.resize({ w: 1280 });
    }
    const compressedBuffer = await image.getBuffer('image/jpeg', { quality: 60 });
    return sucesso(toolName, startTime, {
        result: `Screenshot captured (${image.bitmap.width}x${image.bitmap.height} JPEG)`,
        data: { image: compressedBuffer.toString('base64'), mimeType: 'image/jpeg' },
    }, { sizeKB: Math.round(compressedBuffer.length / 1024) });
}

const ferramentasDePagina = {
    async navigate(url) {
        const startTime = Date.now();
        const page = await this.getPage();
        if (!url.startsWith('http')) url = 'https://' + url;
        console.info(`[BrowserService] Navigating to ${url}`);
        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await esperarRedeQuieta(page);
            console.info('[BrowserService] Emitting sync signal for URL:', page.url());
            app.emit('sync-stonic-neural-browser', page.url());
            const title = await page.title();
            return sucesso('browser_navigate', startTime, { result: `Navigated to: ${title} (${page.url()})`, data: { title, url: page.url() } });
        } catch (e) {
            return falhou('browser_navigate', startTime, {
                error: `Navigation failed: ${e.message}`,
                ...NAVEGACAO_LENTA,
                retrySuggestion: 'Check if the URL is correct. Also try adding https:// prefix.',
            }, { url });
        }
    },

    async _irNoHistorico(toolName) {
        const { ir, feito, falha, dica } = NAVEGACOES[toolName];
        const startTime = Date.now();
        const page = await this.getPage();
        try {
            await ir(page);
            app.emit('sync-stonic-neural-browser', page.url());
            const title = await page.title();
            return sucesso(toolName, startTime, { result: `${feito}: ${title} (${page.url()})`, data: { title, url: page.url() } });
        } catch (e) {
            return falhou(toolName, startTime, { error: `${falha}: ${e.message}`, ...NAVEGACAO_LENTA, retrySuggestion: dica });
        }
    },

    goBack() {
        return this._irNoHistorico('browser_go_back');
    },

    goForward() {
        return this._irNoHistorico('browser_go_forward');
    },

    async reload() {
        const startTime = Date.now();
        const page = await this.getPage();
        try {
            await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
            await esperarRedeQuieta(page);
            app.emit('sync-stonic-neural-browser', page.url());
            const title = await page.title();
            return sucesso('browser_reload', startTime, { result: `Page reloaded: ${title}`, data: { title, url: page.url() } });
        } catch (e) {
            return falhou('browser_reload', startTime, { error: `Reload failed: ${e.message}`, ...NAVEGACAO_LENTA });
        }
    },

    async _textoAcessivel(page) {
        try {
            return await page.locator(':root').ariaSnapshot();
        } catch (ariaErr) {
            return this._fallbackCdpSnapshot(page);
        }
    },

    async snapshot() {
        const startTime = Date.now();
        const page = await this.getPage();
        this.elementMap.clear();
        try {
            const ariaText = await this._textoAcessivel(page);
            if (!ariaText || !ariaText.trim()) {
                return sucesso('browser_snapshot', startTime, { result: 'Page has no accessible elements. The page may still be loading.', data: { elementCount: 0 } });
            }
            const { compactedLines, counter, interactiveCount } = montarSnapshot(ariaText, this.elementMap);
            const title = await page.title();
            const snapshotText = `SNAPSHOT — "${title}" (${page.url()})\n${compactedLines.join('\n')}\n\n${interactiveCount} interactive elements. Use [ref=eN] to interact (e.g. browser_click with ref "e3").`;
            return sucesso('browser_snapshot', startTime, {
                result: snapshotText,
                data: { title, url: page.url(), elementCount: counter, interactiveCount },
            });
        } catch (e) {
            return falhou('browser_snapshot', startTime, {
                error: `Snapshot failed: ${e.message}`,
                ...PAGINA_QUEBROU,
                retrySuggestion: 'The page may still be loading. Wait a moment and try again.',
            });
        }
    },

    async _fallbackCdpSnapshot(page) {
        try {
            const cdpSession = await page.context().newCDPSession(page);
            const { nodes } = await cdpSession.send('Accessibility.getFullAXTree');
            await cdpSession.detach();
            if (!nodes || nodes.length === 0) return '';
            return textoDaArvoreCdp(nodes);
        } catch (e) {
            return '';
        }
    },

    async getHtml(selector, maxChars = 100000) {
        const startTime = Date.now();
        const page = await this.getPage();
        try {
            let html;
            if (selector) {
                const locator = await this.resolveElement(page, selector);
                if (!locator) {
                    return semElemento('browser_get_html', startTime, { error: `Element "${selector}" not found.`, retrySuggestion: 'Take a browser_snapshot to find the correct element ref.' });
                }
                html = await locator.innerHTML();
            } else {
                html = await page.evaluate(() => document.documentElement.outerHTML);
            }
            const truncated = html.substring(0, maxChars);
            return sucesso('browser_get_html', startTime, { result: truncated, data: { chars: truncated.length, truncated: html.length > maxChars } });
        } catch (e) {
            return falhou('browser_get_html', startTime, { error: `Get HTML failed: ${e.message}`, ...ERRO_TRANSITORIO });
        }
    },

    async querySelector(selector, limit = 20, maxTextChars = 500) {
        const startTime = Date.now();
        const page = await this.getPage();
        try {
            const results = await page.evaluate(lerElementosDaPagina, { sel: selector, lim: limit, maxChars: maxTextChars });
            return sucesso('browser_query_selector', startTime, {
                result: `Found ${results.length} element(s) matching "${selector}"`,
                data: { matches: results, count: results.length },
            });
        } catch (e) {
            return falhou('browser_query_selector', startTime, {
                error: `Query selector failed: ${e.message}`,
                ...ERRO_PERMANENTE,
                retrySuggestion: 'Check the CSS selector syntax.',
            });
        }
    },

    async extract(selector) {
        const startTime = Date.now();
        const page = await this.getPage();
        try {
            let text;
            if (!selector) {
                text = await page.evaluate(() => document.body.innerText.substring(0, 50000));
            } else {
                const locator = await this.resolveElement(page, selector);
                if (!locator) {
                    return semElemento('browser_extract_text', startTime, { error: `Element "${selector}" not found.`, retrySuggestion: 'Take a browser_snapshot to verify the element exists.' }, { selector });
                }
                text = await locator.innerText();
            }
            return sucesso('browser_extract_text', startTime, { result: text, data: { charCount: text.length } });
        } catch (e) {
            return falhou('browser_extract_text', startTime, { error: `Text extraction failed: ${e.message}`, ...ERRO_TRANSITORIO });
        }
    },

    async executeScript(script) {
        const startTime = Date.now();
        const page = await this.getPage();
        try {
            const result = await page.evaluate(script);
            const resultStr = JSON.stringify(result);
            const truncated = resultStr ? resultStr.substring(0, 5000) : '';
            return sucesso('browser_execute_script', startTime, { result: `Script executed. Result: ${truncated}`, data: result });
        } catch (e) {
            return falhou('browser_execute_script', startTime, {
                error: `Script error: ${e.message}`,
                ...ERRO_PERMANENTE,
                retrySuggestion: 'Check the JavaScript code for syntax errors.',
            });
        }
    },

    async _capturarTela(page, opts) {
        const fullPage = opts?.fullPage || false;
        const selector = opts?.selector;
        let buffer;
        if (selector) {
            const locator = await this.resolveElement(page, selector);
            if (locator) {
                buffer = await locator.screenshot();
            }
        }
        if (!buffer) {
            buffer = await page.screenshot({ fullPage });
        }
        return buffer;
    },

    async screenshot(opts) {
        const startTime = Date.now();
        const page = await this.getPage();
        try {
            const buffer = await this._capturarTela(page, opts);
            try {
                return await compactarImagem(buffer, 'browser_screenshot', startTime);
            } catch (err) {
                return sucesso('browser_screenshot', startTime, {
                    result: 'Screenshot captured (uncompressed PNG)',
                    data: { image: buffer.toString('base64'), mimeType: 'image/png' },
                }, { compressionFailed: true });
            }
        } catch (e) {
            return falhou('browser_screenshot', startTime, { error: `Screenshot failed: ${e.message}`, ...PAGINA_QUEBROU });
        }
    },

    async _esperarElemento(page, { selector, state, timeout }) {
        const waitState = state || 'visible';
        const locator = await this.resolveElement(page, selector);
        if (locator) {
            await locator.waitFor({ state: waitState, timeout: timeout || 10000 });
        } else {
            await page.waitForSelector(selector, { state: waitState, timeout: timeout || 10000 });
        }
        return `Element "${selector}" is now ${waitState}`;
    },

    async _esperarCondicao(page, opcoes) {
        const { selector, timeout, timeMs } = opcoes;
        if (timeMs) {
            const clampedMs = Math.min(timeMs, TEMPO_MAXIMO_DE_ESPERA);
            await page.waitForTimeout(clampedMs);
            return `Waited ${clampedMs}ms`;
        }
        const espera = ESPERAS.find(([campo]) => opcoes[campo]);
        if (espera) {
            await espera[1](page, opcoes);
            return espera[2](opcoes, page);
        }
        if (selector) return this._esperarElemento(page, opcoes);
        if (timeout) {
            await page.waitForTimeout(timeout);
            return `Waited for ${timeout}ms`;
        }
        return null;
    },

    async wait(opts) {
        const startTime = Date.now();
        const page = await this.getPage();
        const {
            selector, state, timeout,
            text, textGone, url, loadState, jsFunction, timeMs
        } = opcoesDaEspera(opts);
        try {
            const result = await this._esperarCondicao(page, { selector, state, timeout, text, textGone, url, loadState, jsFunction, timeMs });
            if (result !== null) return sucesso('browser_wait', startTime, { result });
            return falhou('browser_wait', startTime, {
                error: 'No wait condition specified. Provide: selector, text, textGone, url, loadState, jsFunction, timeMs, or timeout.',
                ...ARGUMENTO_INVALIDO,
            });
        } catch (e) {
            return falhou('browser_wait', startTime, {
                error: `Wait failed: ${e.message}`,
                errorCode: e.message.includes('Timeout') ? 'NAVIGATION_TIMEOUT' : 'UNKNOWN_ERROR',
                errorCategory: 'timeout',
                retryable: true,
                retrySuggestion: 'The condition was not met within the timeout. Try increasing the timeout or check if the condition is correct.',
            });
        }
    },

    async scroll(direction, amount) {
        const startTime = Date.now();
        const page = await this.getPage();
        try {
            const rolar = ROLAGENS.get(direction) || ((pagina, quanto) => rolarNaVertical(pagina, direction, quanto));
            await rolar(page, amount);
            return sucesso('browser_scroll', startTime, { result: `Scrolled ${direction}${amount ? ` by ${amount}px` : ''}` }, { direction, amount });
        } catch (e) {
            return falhou('browser_scroll', startTime, { error: `Scroll failed: ${e.message}`, ...ERRO_TRANSITORIO });
        }
    },

    async pressKey(key) {
        const startTime = Date.now();
        const page = await this.getPage();
        try {
            await page.keyboard.press(key);
            return sucesso('browser_press_key', startTime, { result: `Pressed '${key}' in browser` }, { key });
        } catch (e) {
            return falhou('browser_press_key', startTime, { error: `Key press failed: ${e.message}`, ...ERRO_TRANSITORIO }, { key });
        }
    },

    async savePdf(savePath = null) {
        const startTime = Date.now();
        const page = await this.getPage();
        try {
            const filename = `page-${Date.now()}.pdf`;
            const fullPath = savePath || path.join(DOWNLOAD_DIR, filename);
            await page.pdf({ path: fullPath, format: 'A4' });
            return sucesso('browser_save_pdf', startTime, { result: `Page saved as PDF: ${fullPath}`, data: { path: fullPath } });
        } catch (e) {
            return falhou('browser_save_pdf', startTime, {
                error: `PDF save failed: ${e.message}. Note: PDF export requires headless browser mode.`,
                ...ERRO_PERMANENTE,
                retrySuggestion: 'PDF export only works in headless mode. Use browser_screenshot for a visual capture instead.',
            });
        }
    },
};

module.exports = { ferramentasDePagina };
