const { browserService } = require('./browser-manager');

const YOUTUBE = 'https://www.youtube.com';
const VOLTAS_ATE_O_LINK = 20;

const janelaAberta = janela => Boolean(janela) && !janela.isDestroyed();

const avisoDaTentativa = (searchQuery, attempt) => (attempt === 1
    ? `Initializing Direct RPA Sequence for: "${searchQuery}"...`
    : `System Fallback [Attempt ${attempt}]: Selecting alternative media result...`);

class NovaHumanController {
    constructor(mainWindow, app) {
        this.mainWindow = mainWindow;
        this.app = app;
        this.lastQuery = '';
        this.currentAttempt = 1;
    }

    log(text) {
        if (!janelaAberta(this.mainWindow)) return;
        const ts = new Date().toLocaleTimeString([], { hour12: false });
        this.mainWindow.webContents.send('swarm:log', {
            agent: 'nova',
            text: `[${ts}] [NOVA] → ${text}`
        });
    }

    async abrirNavegador() {
        await browserService.launch();
        const page = await browserService.getPage();
        await page.bringToFront();
        return page;
    }

    async pesquisarDoZero(page, searchQuery) {
        this.log(`Navigating to YouTube Media Database...`);
        await browserService.navigate(YOUTUBE);
        await page.waitForTimeout(1500);
        await page.bringToFront();
        this.log(`Manually typing query: "${searchQuery}"`);
        await browserService.type('input#search', searchQuery, { delay: 120, pressEnter: true });
        await page.waitForTimeout(2000);
        if (page.url().includes('/results')) return;
        this.log(`Search not triggered via Enter. Clicking Search Icon manually...`);
        await page.click('button#search-icon-legacy');
        await page.waitForTimeout(1000);
    }

    async voltarParaPesquisa(page, searchQuery) {
        this.log(`Returning to Search interface...`);
        await page.bringToFront();
        if (page.url().includes('watch?v=')) {
            await page.goBack();
        } else {
            await browserService.navigate(`${YOUTUBE}/results?search_query=${encodeURIComponent(searchQuery)}`);
        }
        await page.waitForTimeout(2000);
    }

    async escolherResultado(page, attempt) {
        this.log(`Analyzing search results (Waiting up to 20s)...`);
        await page.bringToFront();
        await page.waitForSelector('ytd-video-renderer', { visible: true, timeout: 20000 });
        await page.waitForTimeout(1500);
        const results = page.locator('ytd-video-renderer a#video-title');
        const count = await results.count();
        if (count === 0) throw new Error('No videos found.');
        const index = Math.min(attempt - 1, count - 1);
        this.log(`Selecting Media Result #${index + 1}...`);
        await results.nth(index).scrollIntoViewIfNeeded();
        await page.waitForTimeout(800);
        await results.nth(index).click();
    }

    async esperarLinkDoVideo(page) {
        this.log(`Stabilizing encrypted media link...`);
        for (let i = 0; i < VOLTAS_ATE_O_LINK; i++) {
            await page.waitForTimeout(500);
            const currentUrl = page.url();
            if (currentUrl.includes('/watch?v=')) return this.confirmarReproducao(page, currentUrl);
        }
        throw new Error('Link stabilization failed.');
    }

    async confirmarReproducao(page, finalUrl) {
        this.log(`Playback confirmed. Capturing link...`);
        await page.waitForTimeout(1500);
        return finalUrl;
    }

    focarApp() {
        if (!janelaAberta(this.mainWindow)) return;
        this.mainWindow.show();
        this.mainWindow.focus();
    }

    async executeHumanDownload(searchQuery, attempt = 1) {
        this.lastQuery = searchQuery;
        this.currentAttempt = attempt;
        this.log(avisoDaTentativa(searchQuery, attempt));
        try {
            const page = await this.abrirNavegador();
            if (attempt === 1) await this.pesquisarDoZero(page, searchQuery);
            else await this.voltarParaPesquisa(page, searchQuery);
            await this.escolherResultado(page, attempt);
            const finalUrl = await this.esperarLinkDoVideo(page);
            this.log(`Media Link Captured Successfully.`);
            await page.waitForTimeout(1000);
            this.focarApp();
            return { success: true, url: finalUrl, query: searchQuery };
        } catch (e) {
            this.log(`Extraction Interrupted: ${e.message}`);
            return { success: false, error: e.message };
        }
    }

    async cleanup() {
        try {
            await browserService.close();
            this.log(`Sub-system cleanup complete.`);
        } catch (e) {}
    }
}

module.exports = NovaHumanController;
