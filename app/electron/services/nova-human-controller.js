const { browserService } = require('./browser-manager');
const { abrirBusca, abrirResultado, capturarLink } = require('./nova-human-youtube');

const abertura = (tentativa, consulta) => (tentativa === 1
    ? `Initializing Direct RPA Sequence for: "${consulta}"...`
    : `System Fallback [Attempt ${tentativa}]: Selecting alternative media result...`);

class NovaHumanController {
    constructor(mainWindow, app) {
        this.mainWindow = mainWindow;
        this.app = app;
        this.lastQuery = '';
        this.currentAttempt = 1;
    }

    log(text) {
        if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
        const ts = new Date().toLocaleTimeString([], { hour12: false });
        this.mainWindow.webContents.send('swarm:log', { 
            agent: 'nova', 
            text: `[${ts}] [NOVA] → ${text}` 
        });
    }

    mostrarJanela() {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.show();
            this.mainWindow.focus();
        }
    }

    async executeHumanDownload(searchQuery, attempt = 1) {
        this.lastQuery = searchQuery;
        this.currentAttempt = attempt;

        this.log(abertura(attempt, searchQuery));

        try {
            await browserService.launch();
            const page = await browserService.getPage();

            await page.bringToFront();

            await abrirBusca(this, page, searchQuery, attempt);
            await abrirResultado(this, page, attempt);
            const finalUrl = await capturarLink(this, page);

            this.mostrarJanela();

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
