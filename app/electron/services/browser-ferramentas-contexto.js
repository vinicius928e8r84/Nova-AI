'use strict';

const { ERRO_TRANSITORIO, ERRO_PERMANENTE, ARGUMENTO_INVALIDO, KNOWN_DEVICES, sucesso, falhou } = require('./browser-respostas');

const transitorio = rotulo => e => ({ error: `${rotulo}: ${e.message}`, ...ERRO_TRANSITORIO });

function linhaDaAba(t) {
    return `${t.isActive ? '→ ' : '  '}[${t.index}] ${t.title} (${t.url})`;
}

const ferramentasDeContexto = {
    async _naPagina(toolName, agir, falha) {
        const startTime = Date.now();
        const page = await this.getPage();
        try {
            return await agir(page, startTime);
        } catch (e) {
            return falhou(toolName, startTime, falha(e));
        }
    },

    async _noContexto(toolName, agir, falha) {
        const startTime = Date.now();
        try {
            if (!this.context) await this.launch();
            return await agir(startTime);
        } catch (e) {
            return falhou(toolName, startTime, falha(e));
        }
    },

    async getCookies() {
        return this._noContexto('browser_get_cookies', async startTime => {
            const cookies = await this.context.cookies();
            return sucesso('browser_get_cookies', startTime, { result: `Found ${cookies.length} cookies`, data: { cookies, count: cookies.length } });
        }, transitorio('Get cookies failed'));
    },

    async setCookie(cookie) {
        return this._noContexto('browser_set_cookie', async startTime => {
            if (!cookie.url && !cookie.domain) {
                const page = await this.getPage();
                cookie.url = page.url();
            }
            await this.context.addCookies([cookie]);
            return sucesso('browser_set_cookie', startTime, { result: `Cookie "${cookie.name}" set`, data: { name: cookie.name } });
        }, e => ({ error: `Set cookie failed: ${e.message}`, ...ERRO_PERMANENTE, retrySuggestion: 'Cookie must have name, value, and either url or domain.' }));
    },

    async clearCookies() {
        return this._noContexto('browser_clear_cookies', async startTime => {
            await this.context.clearCookies();
            return sucesso('browser_clear_cookies', startTime, { result: 'All cookies cleared' });
        }, transitorio('Clear cookies failed'));
    },

    async getStorage(kind = 'local', key = null) {
        return this._naPagina('browser_get_storage', async (page, startTime) => {
            const values = await page.evaluate(({ kind, key }) => {
                const store = kind === 'session' ? sessionStorage : localStorage;
                if (key) return { [key]: store.getItem(key) };
                const result = {};
                for (let i = 0; i < store.length; i++) {
                    const k = store.key(i);
                    result[k] = store.getItem(k);
                }
                return result;
            }, { kind, key });
            const count = Object.keys(values).length;
            return sucesso('browser_get_storage', startTime, { result: `${kind}Storage: ${count} item(s)`, data: { kind, values, count } });
        }, transitorio('Get storage failed'));
    },

    async setStorage(key, value, kind = 'local') {
        return this._naPagina('browser_set_storage', async (page, startTime) => {
            await page.evaluate(({ kind, key, value }) => {
                const store = kind === 'session' ? sessionStorage : localStorage;
                store.setItem(key, value);
            }, { kind, key, value });
            return sucesso('browser_set_storage', startTime, { result: `Set ${kind}Storage["${key}"] = "${String(value).substring(0, 50)}"` });
        }, transitorio('Set storage failed'));
    },

    async clearStorage(kind = 'local') {
        return this._naPagina('browser_clear_storage', async (page, startTime) => {
            await page.evaluate((kind) => {
                const store = kind === 'session' ? sessionStorage : localStorage;
                store.clear();
            }, kind);
            return sucesso('browser_clear_storage', startTime, { result: `${kind}Storage cleared` });
        }, transitorio('Clear storage failed'));
    },

    async resizeViewport(width, height) {
        return this._naPagina('browser_resize_viewport', async (page, startTime) => {
            await page.setViewportSize({ width, height });
            return sucesso('browser_resize_viewport', startTime, { result: `Viewport resized to ${width}x${height}`, data: { width, height } });
        }, transitorio('Resize viewport failed'));
    },

    async emulateDevice(deviceName) {
        return this._naPagina('browser_emulate_device', async (page, startTime) => {
            const device = KNOWN_DEVICES[deviceName];
            if (!device) {
                const available = Object.keys(KNOWN_DEVICES).join(', ');
                return falhou('browser_emulate_device', startTime, { error: `Unknown device "${deviceName}". Available: ${available}`, ...ARGUMENTO_INVALIDO });
            }
            await page.setViewportSize(device.viewport);
            await page.setExtraHTTPHeaders({ 'User-Agent': device.userAgent });
            return sucesso('browser_emulate_device', startTime, {
                result: `Emulating ${deviceName}: ${device.viewport.width}x${device.viewport.height}`,
                data: { device: deviceName, viewport: device.viewport },
            });
        }, transitorio('Device emulation failed'));
    },

    async emulateColorScheme(scheme = 'dark') {
        return this._naPagina('browser_emulate_color_scheme', async (page, startTime) => {
            await page.emulateMedia({ colorScheme: scheme });
            return sucesso('browser_emulate_color_scheme', startTime, { result: `Color scheme set to "${scheme}"`, data: { colorScheme: scheme } });
        }, transitorio('Color scheme emulation failed'));
    },

    async setOffline(offline = true) {
        return this._noContexto('browser_set_offline', async startTime => {
            await this.context.setOffline(offline);
            return sucesso('browser_set_offline', startTime, { result: `Browser is now ${offline ? 'OFFLINE' : 'ONLINE'}`, data: { offline } });
        }, transitorio('Set offline failed'));
    },

    async setExtraHeaders(headers) {
        return this._naPagina('browser_set_extra_headers', async (page, startTime) => {
            await page.setExtraHTTPHeaders(headers);
            return sucesso('browser_set_extra_headers', startTime, {
                result: `Extra headers set: ${Object.keys(headers).join(', ')}`,
                data: { headers: Object.keys(headers) },
            });
        }, transitorio('Set headers failed'));
    },

    async setHttpCredentials(username, password, clear = false) {
        return this._noContexto('browser_set_http_credentials', async startTime => {
            await this.context.setHTTPCredentials(clear ? null : { username, password });
            return sucesso('browser_set_http_credentials', startTime, { result: clear ? 'HTTP credentials cleared' : `HTTP credentials set for user "${username}"` });
        }, transitorio('Set credentials failed'));
    },

    async setGeolocation(latitude, longitude, accuracy = 100, clear = false) {
        return this._noContexto('browser_set_geolocation', async startTime => {
            if (clear) {
                await this.context.setGeolocation(null);
            } else {
                await this.context.setGeolocation({ latitude, longitude, accuracy });
                await this.context.grantPermissions(['geolocation']);
            }
            return sucesso('browser_set_geolocation', startTime, {
                result: clear ? 'Geolocation cleared' : `Geolocation set: ${latitude}, ${longitude} (accuracy: ${accuracy}m)`,
                data: clear ? {} : { latitude, longitude, accuracy },
            });
        }, transitorio('Set geolocation failed'));
    },

    async getConsoleMessages(level = null) {
        const startTime = Date.now();
        try {
            const messages = level
                ? this.consoleMessages.filter(m => m.level === level)
                : this.consoleMessages;
            return sucesso('browser_get_console', startTime, {
                result: `${messages.length} console message(s)${level ? ` of type "${level}"` : ''}`,
                data: { messages, count: messages.length },
            });
        } catch (e) {
            return falhou('browser_get_console', startTime, transitorio('Get console failed')(e));
        }
    },

    async getPageErrors() {
        const startTime = Date.now();
        try {
            return sucesso('browser_get_errors', startTime, {
                result: `${this.pageErrors.length} JavaScript error(s) found`,
                data: { errors: this.pageErrors, count: this.pageErrors.length },
            });
        } catch (e) {
            return falhou('browser_get_errors', startTime, transitorio('Get errors failed')(e));
        }
    },

    async _abas() {
        const pages = this.context.pages();
        const tabs = [];
        for (let i = 0; i < pages.length; i++) {
            const p = pages[i];
            tabs.push({
                index: i,
                title: await p.title().catch(() => 'Untitled'),
                url: p.url(),
                isActive: p === this.activePage
            });
        }
        return tabs;
    },

    async getTabs() {
        return this._noContexto('browser_get_tabs', async startTime => {
            const tabs = await this._abas();
            return sucesso('browser_get_tabs', startTime, { result: `${tabs.length} tabs open:\n${tabs.map(linhaDaAba).join('\n')}`, data: tabs });
        }, e => ({ error: `Failed to list tabs: ${e.message}`, errorCode: 'BROWSER_NOT_RUNNING', errorCategory: 'transient', retryable: true }));
    },

    async switchTab(index) {
        return this._noContexto('browser_switch_tab', async startTime => {
            const pages = this.context.pages();
            if (index < 0 || index >= pages.length) {
                return falhou('browser_switch_tab', startTime, {
                    error: `Tab index ${index} out of range. Have ${pages.length} tabs (0-${pages.length - 1}).`,
                    ...ARGUMENTO_INVALIDO,
                    retrySuggestion: 'Use browser_get_tabs to see available tab indices.',
                }, { tabCount: pages.length });
            }
            this.activePage = pages[index];
            await this.activePage.bringToFront();
            const title = await this.activePage.title();
            return sucesso('browser_switch_tab', startTime, { result: `Switched to tab ${index}: "${title}"`, data: { index, title, url: this.activePage.url() } });
        }, transitorio('Tab switch failed'));
    },

    async newTab(url) {
        return this._noContexto('browser_new_tab', async startTime => {
            const newPage = await this.context.newPage();
            this.activePage = newPage;
            this._attachPageListeners(newPage);
            if (url) {
                if (!url.startsWith('http')) url = 'https://' + url;
                await newPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            }
            const title = await newPage.title();
            const tabCount = this.context.pages().length;
            return sucesso('browser_new_tab', startTime, {
                result: `New tab opened${url ? `: ${title}` : ''}. Total tabs: ${tabCount}`,
                data: { title, url: newPage.url(), tabCount },
            });
        }, transitorio('New tab failed'));
    },

    async closeTab(index) {
        return this._noContexto('browser_close_tab', async startTime => {
            const pages = this.context.pages();
            if (pages.length <= 1) {
                return falhou('browser_close_tab', startTime, { error: 'Cannot close the last tab. Use browser_close to close the entire browser.', ...ARGUMENTO_INVALIDO });
            }
            const tabIndex = index !== undefined ? index : pages.indexOf(this.activePage);
            if (tabIndex < 0 || tabIndex >= pages.length) {
                return falhou('browser_close_tab', startTime, { error: `Tab index ${tabIndex} not valid.`, ...ARGUMENTO_INVALIDO });
            }
            const closedTitle = await pages[tabIndex].title().catch(() => 'Untitled');
            await pages[tabIndex].close();
            const remaining = this.context.pages();
            this.activePage = remaining[0];
            return sucesso('browser_close_tab', startTime, {
                result: `Closed tab "${closedTitle}". ${remaining.length} tabs remaining.`,
                data: { closedTitle, remainingTabs: remaining.length },
            });
        }, transitorio('Close tab failed'));
    },
};

module.exports = { ferramentasDeContexto };
