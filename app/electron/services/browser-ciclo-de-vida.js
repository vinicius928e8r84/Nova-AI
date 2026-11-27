'use strict';

const { chromium } = require('playwright');
const { getDefaultUserAgent } = require('./platform-utils');
const {
    BROWSER_DATA_DIR, DOWNLOAD_DIR, appendBrowserLog, quarantineBrowserProfile, resolveCdpPort,
    releaseCdpPortReservation, conferirPortaDoNavegador, ensureStandardDownloadPrefs, escolherExecutavel,
} = require('./browser-perfil');
const fs = require('fs');

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

const ferramentasDeCicloDeVida = {
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
    },

    isRunning() {
        return this.isInitialized && this._isBrowserAlive();
    },

    _esquecerPrazoDoSeletor() {
        if (this._pendingFileChooserTimeout) {
            clearTimeout(this._pendingFileChooserTimeout);
            this._pendingFileChooserTimeout = null;
        }
    },

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
    },

    _navegadorMorreu(firstError) {
        const msg = String(firstError?.message || firstError || '');
        return MENSAGENS_DE_NAVEGADOR_MORTO.some(trecho => msg.includes(trecho)) || !this._isBrowserAlive();
    },

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
    },

    async _recuperar(toolName) {
        if (this._isRelaunching) {
            await esperar(3000);
            if (!this._isBrowserAlive()) return recuperacaoEmAndamento(toolName);
        }
        return this._relancarParaRecuperar(toolName);
    },

    async _repetir(toolName, fn) {
        try {
            return await fn();
        } catch (retryError) {
            console.error(`[BrowserService] Retry of ${toolName} also failed:`, retryError.message);
            throw retryError;
        }
    },

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
    },

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
    },

    async _abrirComNovaTentativa(launchOptions, launchStarted) {
        try {
            this.context = await chromium.launchPersistentContext(BROWSER_DATA_DIR, launchOptions);
        } catch (firstErr) {
            appendBrowserLog(`LAUNCH ATTEMPT 1 FAILED after ${Date.now() - launchStarted}ms: ${firstErr.message}`);
            const retryStarted = Date.now();
            this.context = await chromium.launchPersistentContext(BROWSER_DATA_DIR, launchOptions);
            appendBrowserLog(`launch retry OK in ${Date.now() - retryStarted}ms`);
        }
    },

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
    },

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
    },

    _registrarFechamento(launchStarted) {
        try {
            this.context.on('close', () => {
                appendBrowserLog(`browser closed (uptime ${Math.round((Date.now() - launchStarted) / 1000)}s)`);
            });
        } catch { }
    },

    async _escolherAbaDoContexto() {
        const pages = this.context.pages();
        this.activePage = pages.length > 0 ? pages[0] : await this.context.newPage();
    },

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
    },

    async _relancar() {
        await this._forceClose();
        await esperar(500);
        await this.launch();
    },
};

module.exports = { ferramentasDeCicloDeVida, esperar };
