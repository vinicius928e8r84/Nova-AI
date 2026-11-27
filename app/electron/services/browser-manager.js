const {
    DOWNLOAD_DIR, appendBrowserLog, resolveCdpPort, getCdpPort, resolveDownloadFilename, findMatchingDownloadPath,
} = require('./browser-perfil');
const { ferramentasDeCicloDeVida, esperar } = require('./browser-ciclo-de-vida');
const { ferramentasDePagina } = require('./browser-ferramentas-pagina');
const { ferramentasDeElemento } = require('./browser-ferramentas-elemento');
const { ferramentasDeContexto } = require('./browser-ferramentas-contexto');
const path = require('path');
const { ipcMain } = require('electron');

const LIMITE_DE_MENSAGENS = 500;
const LIMITE_DE_ERROS = 200;

function acrescentarComLimite(lista, item, limite) {
    lista.push(item);
    if (lista.length > limite) {
        lista.shift();
    }
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

for (const ferramentas of [ferramentasDeCicloDeVida, ferramentasDePagina, ferramentasDeElemento, ferramentasDeContexto]) {
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
