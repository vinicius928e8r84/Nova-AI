const { chromium } = require('playwright');
const { getDefaultUserAgent } = require('./platform-utils');
const {
    BROWSER_DATA_DIR, DOWNLOAD_DIR, appendBrowserLog, quarantineBrowserProfile, resolveCdpPort, getCdpPort,
    releaseCdpPortReservation, conferirPortaDoNavegador, ensureStandardDownloadPrefs, resolveDownloadFilename,
    findMatchingDownloadPath, escolherExecutavel,
} = require('./browser-perfil');
const { ferramentasDePagina } = require('./browser-ferramentas-pagina');
const { ferramentasDeElemento } = require('./browser-ferramentas-elemento');
const { ferramentasDeContexto } = require('./browser-ferramentas-contexto');
const path = require('path');
const fs = require('fs');
const { ipcMain } = require('electron');

const MENSAGENS_DE_NAVEGADOR_MORTO = [
    'Target closed',
    'browser has been closed',
    'Browser closed',
    'Session closed',
    'Target page, context or browser has been closed',
    'Connection closed',
    'Protocol error',
    'Execution context was destroyed',
    'context or browser has been closed',
];

const LIMITE_DE_MENSAGENS = 500;
const LIMITE_DE_ERROS = 200;

const esperar = ms => new Promise(r => setTimeout(r, ms));

function opcoesDeLancamento(executablePath, cdpPort) {
    return {
        executablePath: executablePath,
        headless: false,
        viewport: null,
        userAgent: getDefaultUserAgent(),
        acceptDownloads: true,
        timeout: 120000,
        args: [
            '--disable-blink-features=AutomationControlled',
            '--no-first-run',
            '--no-default-browser-check',
            '--enable-logging',
            `--remote-debugging-port=${cdpPort}`,
        ],
    };
}

function acrescentarComLimite(lista, item, limite) {
    lista.push(item);
    if (lista.length > limite) {
        lista.shift();
    }
}

function prepararPerfil() {
    if (!fs.existsSync(DOWNLOAD_DIR)) {
        fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
    }
    const isFirstRun = !fs.existsSync(BROWSER_DATA_DIR);
    if (isFirstRun) {
        console.info('[BrowserService] Creating persistent browser profile...');
    } else {
        console.info('[BrowserService] Loading saved browser profile...');
    }
    ensureStandardDownloadPrefs(BROWSER_DATA_DIR, DOWNLOAD_DIR);
    return isFirstRun;
}

function refDoTexto(raw) {
    const eMatch = raw.match(/^(?:@|ref=)?(e\d+)$/i);
    if (eMatch) return eMatch[1].toLowerCase();
    const numMatch = raw.match(/^\[?(\d+)\]?$/);
    return numMatch ? `e${numMatch[1]}` : null;
}

function localizarPorRef(page, info) {
    if (!info) return null;
    const locator = info.name
        ? page.getByRole(info.role, { name: info.name, exact: true })
        : page.getByRole(info.role);
    return info.nth != null ? locator.nth(info.nth) : locator;
}

function morteNaRecuperacao(toolName, relaunchErr) {
    return {
        success: false,
        toolName,
        error: `Browser was closed and could not be restarted: ${relaunchErr.message}`,
        errorCode: 'BROWSER_RELAUNCH_FAILED',
        errorCategory: 'permanent',
        retryable: false,
    };
}

function recuperacaoEmAndamento(toolName) {
    return {
        success: false,
        toolName,
        error: 'Browser recovery in progress. Please try again in a few seconds.',
        errorCode: 'BROWSER_RECOVERING',
        errorCategory: 'transient',
        retryable: true,
    };
}

class BrowserManagerService {
    constructor() {
        this.browser = null;
        this.context = null;
        this.activePage = null;
        this.stonicWin = null;
        this.elementMap = new Map();
        this._pendingFileChooser = null;
        this._pendingFileChooserTimeout = null;
        this.isInitialized = false;
        this.consoleMessages = [];
        this.pageErrors = [];
        this._dialogHandler = null;
        this._isRelaunching = false;
    }

    _isBrowserAlive() {
        try {
            if (!this.context) return false;
            if (this.browser && typeof this.browser.isConnected === 'function') {
                if (!this.browser.isConnected()) return false;
            }
            const pages = this.context.pages();
            return Array.isArray(pages);
        } catch {
            return false;
        }
    }

    isRunning() {
        return this.isInitialized && this._isBrowserAlive();
    }

    _esquecerPrazoDoSeletor() {
        if (this._pendingFileChooserTimeout) {
            clearTimeout(this._pendingFileChooserTimeout);
            this._pendingFileChooserTimeout = null;
        }
    }

    async _forceClose() {
        console.info('[BrowserService] Force-closing browser (cleaning up dead/stale state)...');
        this.isInitialized = false;
        this.activePage = null;
        this.consoleMessages = [];
        this.pageErrors = [];
        this._esquecerPrazoDoSeletor();
        this._pendingFileChooser = null;
        if (this.context) {
            try {
                await this.context.close();
            } catch (closeErr) {
                console.warn('[BrowserService] Context close error (expected if browser was killed):', closeErr.message);
            }
            this.context = null;
        }
        this.browser = null;
    }

    _navegadorMorreu(firstError) {
        const msg = String(firstError?.message || firstError || '');
        return MENSAGENS_DE_NAVEGADOR_MORTO.some(trecho => msg.includes(trecho)) || !this._isBrowserAlive();
    }

    async _relancarParaRecuperar(toolName) {
        try {
            this._isRelaunching = true;
            await this._forceClose();
            await esperar(1000);
            await this.launch();
            console.info(`[BrowserService] ✅ Browser recovered! Retrying ${toolName}...`);
            return null;
        } catch (relaunchErr) {
            console.error('[BrowserService] Relaunch failed:', relaunchErr.message);
            return morteNaRecuperacao(toolName, relaunchErr);
        } finally {
            this._isRelaunching = false;
        }
    }

    async _recuperar(toolName) {
        if (this._isRelaunching) {
            await esperar(3000);
            if (!this._isBrowserAlive()) return recuperacaoEmAndamento(toolName);
        }
        return this._relancarParaRecuperar(toolName);
    }

    async _repetir(toolName, fn) {
        try {
            return await fn();
        } catch (retryError) {
            console.error(`[BrowserService] Retry of ${toolName} also failed:`, retryError.message);
            throw retryError;
        }
    }

    async _withAutoRecovery(toolName, fn) {
        try {
            return await fn();
        } catch (firstError) {
            if (!this._navegadorMorreu(firstError)) throw firstError;
            console.warn(`[BrowserService] Browser died during ${toolName}. Auto-recovering...`);
            const falhaNaRecuperacao = await this._recuperar(toolName);
            if (falhaNaRecuperacao) return falhaNaRecuperacao;
            return this._repetir(toolName, fn);
        }
    }

    async resolveBrowserDownloadPath(download, startedAt, timeoutMs = 10000) {
        const filename = resolveDownloadFilename(download);
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const resolvedPath = findMatchingDownloadPath(filename, startedAt - 2000);
            if (resolvedPath) {
                return {
                    filename: path.basename(resolvedPath),
                    path: resolvedPath,
                };
            }
            await esperar(250);
        }
        const fallbackPath = path.join(DOWNLOAD_DIR, filename);
        return {
            filename: path.basename(fallbackPath),
            path: fallbackPath,
        };
    }

    async _jaEstaAberto() {
        if (this.isInitialized && this.context) {
            if (this._isBrowserAlive()) return true;
            console.warn('[BrowserService] Browser was marked as initialized but is dead. Cleaning up...');
            await this._forceClose();
        }
        if (this.context && !this._isBrowserAlive()) {
            console.warn('[BrowserService] Found stale context. Cleaning up before launch...');
            await this._forceClose();
        }
        return false;
    }

    async _abrirComNovaTentativa(launchOptions, launchStarted) {
        try {
            this.context = await chromium.launchPersistentContext(BROWSER_DATA_DIR, launchOptions);
        } catch (firstErr) {
            appendBrowserLog(`LAUNCH ATTEMPT 1 FAILED after ${Date.now() - launchStarted}ms: ${firstErr.message}`);
            const retryStarted = Date.now();
            this.context = await chromium.launchPersistentContext(BROWSER_DATA_DIR, launchOptions);
            appendBrowserLog(`launch retry OK in ${Date.now() - retryStarted}ms`);
        }
    }

    async _abrirComPerfilLimpo(launchOptions, launchStarted, err) {
        appendBrowserLog(`launch failed twice — retrying with a fresh profile`);
        const cleanStarted = Date.now();
        try {
            ensureStandardDownloadPrefs(BROWSER_DATA_DIR, DOWNLOAD_DIR);
            this.context = await chromium.launchPersistentContext(BROWSER_DATA_DIR, launchOptions);
        } catch (cleanErr) {
            appendBrowserLog(`LAUNCH FAILED after ${Date.now() - launchStarted}ms (clean profile also failed: ${cleanErr.message}): ${err.message}`);
            throw err;
        }
        appendBrowserLog(`clean-profile launch OK in ${Date.now() - cleanStarted}ms`);
    }

    async _abrirContexto(launchOptions, launchStarted, isFirstRun) {
        try {
            await this._abrirComNovaTentativa(launchOptions, launchStarted);
        } catch (err) {
            if (isFirstRun || !quarantineBrowserProfile()) {
                appendBrowserLog(`LAUNCH FAILED after ${Date.now() - launchStarted}ms: ${err.message}`);
                throw err;
            }
            await this._abrirComPerfilLimpo(launchOptions, launchStarted, err);
        }
        appendBrowserLog(`launch OK in ${Date.now() - launchStarted}ms`);
    }

    _registrarFechamento(launchStarted) {
        try {
            this.context.on('close', () => {
                appendBrowserLog(`browser closed (uptime ${Math.round((Date.now() - launchStarted) / 1000)}s)`);
            });
        } catch { }
    }

    async _escolherAbaDoContexto() {
        const pages = this.context.pages();
        this.activePage = pages.length > 0 ? pages[0] : await this.context.newPage();
    }

    async launch() {
        if (await this._jaEstaAberto()) return;
        const isFirstRun = prepararPerfil();
        const executablePath = escolherExecutavel();
        const cdpPort = await resolveCdpPort();
        releaseCdpPortReservation();
        console.info(`[BrowserService] Launching Chromium with CDP port ${cdpPort}...`);
        const launchStarted = Date.now();
        appendBrowserLog(`launch: exe=${executablePath || 'playwright-default'} port=${cdpPort} firstRun=${isFirstRun}`);
        await this._abrirContexto(opcoesDeLancamento(executablePath, cdpPort), launchStarted, isFirstRun);
        this._registrarFechamento(launchStarted);
        conferirPortaDoNavegador(cdpPort);
        this.browser = this.context.browser();
        await this._escolherAbaDoContexto();
        this._attachPageListeners(this.activePage);
        this.isInitialized = true;
        console.info('[BrowserService] ✅ Browser launched successfully.');
    }

    _attachPageListeners(page) {
        if (!page) return;
        page.on('console', (msg) => {
            acrescentarComLimite(this.consoleMessages, {
                level: msg.type(),
                text: msg.text(),
                timestamp: new Date().toISOString()
            }, LIMITE_DE_MENSAGENS);
        });
        page.on('pageerror', (error) => {
            acrescentarComLimite(this.pageErrors, {
                message: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            }, LIMITE_DE_ERROS);
        });
    }

    async _relancar() {
        await this._forceClose();
        await esperar(500);
        await this.launch();
    }

    async _abaUtilizavel() {
        if (this.activePage && !this.activePage.isClosed()) return;
        const pages = this.context.pages();
        if (pages.length > 0) {
            this.activePage = pages[0];
        } else {
            this.activePage = await this.context.newPage();
            this._attachPageListeners(this.activePage);
        }
    }

    async getPage() {
        if (!this.context || !this._isBrowserAlive()) {
            console.warn('[BrowserService] Browser context is dead or missing. Relaunching...');
            await this._relancar();
        }
        try {
            await this._abaUtilizavel();
        } catch (pageErr) {
            console.warn('[BrowserService] getPage() failed — browser likely closed. Relaunching...');
            await this._relancar();
        }
        return this.activePage;
    }

    resolveElement(page, selectorOrRef) {
        const raw = String(selectorOrRef).trim();
        if (!raw) return null;
        const ref = refDoTexto(raw);
        if (ref) return localizarPorRef(page, this.elementMap.get(ref));
        try {
            return page.locator(raw).first();
        } catch (e) {
            return null;
        }
    }

    async close() {
        const startTime = Date.now();
        try {
            if (this.context || this.isInitialized) {
                await this._forceClose();
                return {
                    success: true,
                    toolName: 'browser_close',
                    result: 'Browser closed.',
                    debugInfo: { executionTimeMs: Date.now() - startTime }
                };
            }
            return {
                success: true,
                toolName: 'browser_close',
                result: 'Browser was not open.',
                debugInfo: { executionTimeMs: Date.now() - startTime }
            };
        } catch (e) {
            this.browser = null;
            this.context = null;
            this.activePage = null;
            this.isInitialized = false;
            return {
                success: true,
                toolName: 'browser_close',
                result: 'Browser state cleaned up (was already dead).',
                debugInfo: { executionTimeMs: Date.now() - startTime }
            };
        }
    }
}

for (const ferramentas of [ferramentasDePagina, ferramentasDeElemento, ferramentasDeContexto]) {
    for (const [nome, descritor] of Object.entries(Object.getOwnPropertyDescriptors(ferramentas))) {
        Object.defineProperty(BrowserManagerService.prototype, nome, { ...descritor, enumerable: false });
    }
}

const browserService = new BrowserManagerService();

function registerBrowserHandlers() {
    resolveCdpPort().catch((err) => console.error('[BrowserService] CDP port resolution failed:', err.message));

    const r = (toolName, fn) => browserService._withAutoRecovery(toolName, fn);

    ipcMain.handle('browser-navigate',         async (e, url) => r('browser_navigate', () => browserService.navigate(url)));
    ipcMain.handle('browser-go-back',          async () => r('browser_go_back', () => browserService.goBack()));
    ipcMain.handle('browser-go-forward',       async () => r('browser_go_forward', () => browserService.goForward()));
    ipcMain.handle('browser-reload',           async () => r('browser_reload', () => browserService.reload()));

    ipcMain.handle('browser-snapshot',         async (e, s) => r('browser_snapshot', () => browserService.snapshot(s)));
    ipcMain.handle('browser-get-html',         async (e, { selector, maxChars }) => r('browser_get_html', () => browserService.getHtml(selector, maxChars)));
    ipcMain.handle('browser-query-selector',   async (e, { selector, limit, maxTextChars }) => r('browser_query_selector', () => browserService.querySelector(selector, limit, maxTextChars)));
    ipcMain.handle('browser-extract',          async (e, s) => r('browser_extract', () => browserService.extract(s)));
    ipcMain.handle('browser-screenshot',       async (e, a) => r('browser_screenshot', () => browserService.screenshot(a)));

    ipcMain.handle('browser-click',            async (e, { selector, doubleClick, button, modifiers, delayMs }) => r('browser_click', () => browserService.click(selector, { doubleClick, button, modifiers, delayMs })));
    ipcMain.handle('browser-type',             async (e, { selector, text, clearFirst, slowly }) => r('browser_type', () => browserService.type(selector, text, clearFirst, slowly)));
    ipcMain.handle('browser-fill-form',        async (e, { fields, timeoutMs }) => r('browser_fill_form', () => browserService.fillForm(fields, timeoutMs)));
    ipcMain.handle('browser-hover',            async (e, { selector }) => r('browser_hover', () => browserService.hover(selector)));
    ipcMain.handle('browser-select',           async (e, { selector, value }) => r('browser_select', () => browserService.select(selector, value)));
    ipcMain.handle('browser-press-key',        async (e, k) => r('browser_press_key', () => browserService.pressKey(k)));
    ipcMain.handle('browser-scroll',           async (e, { direction, amount }) => r('browser_scroll', () => browserService.scroll(direction, amount)));
    ipcMain.handle('browser-scroll-into-view', async (e, { selector }) => r('browser_scroll_into_view', () => browserService.scrollIntoView(selector)));
    ipcMain.handle('browser-highlight',        async (e, { selector }) => r('browser_highlight', () => browserService.highlight(selector)));

    ipcMain.handle('browser-wait',             async (e, opts) => r('browser_wait', () => browserService.wait(opts)));

    ipcMain.handle('browser-execute-script',   async (e, s) => r('browser_execute_script', () => browserService.executeScript(s)));

    ipcMain.handle('browser-upload-file',      async (e, { selector, filePath, filePaths, timeoutMs }) => r('browser_upload_file', () => browserService.uploadFile(selector, filePaths || filePath, timeoutMs)));

    ipcMain.handle('browser-wait-download',    async (e, { timeoutMs }) => r('browser_wait_download', () => browserService.waitDownload(timeoutMs)));
    ipcMain.handle('browser-download-by-click',async (e, { selector, timeoutMs }) => r('browser_download_by_click', () => browserService.downloadByClick(selector, timeoutMs)));

    ipcMain.handle('browser-handle-dialog',    async (e, { accept, promptText, timeoutMs }) => r('browser_handle_dialog', () => browserService.handleDialog(accept, promptText, timeoutMs)));

    ipcMain.handle('browser-save-pdf',         async (e, { savePath }) => r('browser_save_pdf', () => browserService.savePdf(savePath)));

    ipcMain.handle('browser-get-cookies',      async () => r('browser_get_cookies', () => browserService.getCookies()));
    ipcMain.handle('browser-set-cookie',       async (e, { cookie }) => r('browser_set_cookie', () => browserService.setCookie(cookie)));
    ipcMain.handle('browser-clear-cookies',    async () => r('browser_clear_cookies', () => browserService.clearCookies()));

    ipcMain.handle('browser-get-storage',      async (e, { kind, key }) => r('browser_get_storage', () => browserService.getStorage(kind, key)));
    ipcMain.handle('browser-set-storage',      async (e, { key, value, kind }) => r('browser_set_storage', () => browserService.setStorage(key, value, kind)));
    ipcMain.handle('browser-clear-storage',    async (e, { kind }) => r('browser_clear_storage', () => browserService.clearStorage(kind)));

    ipcMain.handle('browser-resize-viewport',          async (e, { width, height }) => r('browser_resize_viewport', () => browserService.resizeViewport(width, height)));
    ipcMain.handle('browser-emulate-device',           async (e, { deviceName }) => r('browser_emulate_device', () => browserService.emulateDevice(deviceName)));
    ipcMain.handle('browser-emulate-color-scheme',     async (e, { scheme }) => r('browser_emulate_color_scheme', () => browserService.emulateColorScheme(scheme)));
    ipcMain.handle('browser-set-offline',              async (e, { offline }) => r('browser_set_offline', () => browserService.setOffline(offline)));
    ipcMain.handle('browser-set-extra-headers',        async (e, { headers }) => r('browser_set_extra_headers', () => browserService.setExtraHeaders(headers)));
    ipcMain.handle('browser-set-http-credentials',     async (e, { username, password, clear }) => r('browser_set_http_credentials', () => browserService.setHttpCredentials(username, password, clear)));
    ipcMain.handle('browser-set-geolocation',          async (e, { latitude, longitude, accuracy, clear }) => r('browser_set_geolocation', () => browserService.setGeolocation(latitude, longitude, accuracy, clear)));

    ipcMain.handle('browser-get-console',      async (e, { level }) => r('browser_get_console', () => browserService.getConsoleMessages(level)));
    ipcMain.handle('browser-get-errors',       async () => r('browser_get_errors', () => browserService.getPageErrors()));

    ipcMain.handle('browser-get-tabs',         async () => r('browser_get_tabs', () => browserService.getTabs()));
    ipcMain.handle('browser-switch-tab',       async (e, { index }) => r('browser_switch_tab', () => browserService.switchTab(index)));
    ipcMain.handle('browser-new-tab',          async (e, { url }) => r('browser_new_tab', () => browserService.newTab(url)));
    ipcMain.handle('browser-close-tab',        async (e, { index }) => r('browser_close_tab', () => browserService.closeTab(index)));

    ipcMain.handle('browser-drag-drop',        async (e, { sourceSelector, targetSelector }) => r('browser_drag_drop', () => browserService.dragDrop(sourceSelector, targetSelector)));

    ipcMain.handle('browser-close',            async () => browserService.close());

    console.info('[BrowserService] ✅ All 46 browser handlers registered (with auto-recovery)');
}

module.exports = { registerBrowserHandlers, browserService, resolveCdpPort, getCdpPort, appendBrowserLog };
