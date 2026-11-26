const { browserService } = require('./browser-manager');

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

    async executeHumanDownload(searchQuery, attempt = 1) {
        this.lastQuery = searchQuery;
        this.currentAttempt = attempt;

        this.log(attempt === 1 
            ? `Initializing Direct RPA Sequence for: "${searchQuery}"...` 
            : `System Fallback [Attempt ${attempt}]: Selecting alternative media result...`
        );

        try {
            await browserService.launch();
            const page = await browserService.getPage();
            
            await page.bringToFront();

            if (attempt === 1) {
                this.log(`Navigating to YouTube Media Database...`);
                await browserService.navigate('https://www.youtube.com');
                await page.waitForTimeout(1500);
                
                await page.bringToFront();
                this.log(`Manually typing query: "${searchQuery}"`);
                await browserService.type('input#search', searchQuery, { delay: 120, pressEnter: true });
                
                await page.waitForTimeout(2000);
                
                if (!page.url().includes('/results')) {
                    this.log(`Search not triggered via Enter. Clicking Search Icon manually...`);
                    await page.click('button#search-icon-legacy');
                    await page.waitForTimeout(1000);
                }
            } else {
                this.log(`Returning to Search interface...`);
                await page.bringToFront();
                
                if (page.url().includes('watch?v=')) {
                    await page.goBack();
                } else {
                    await browserService.navigate(`https://www.youtube.com/results?search_query=${encodeURIComponent(searchQuery)}`);
                }
                await page.waitForTimeout(2000);
            }

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
            
            this.log(`Stabilizing encrypted media link...`);
            let finalUrl = '';
            for (let i = 0; i < 20; i++) {
                await page.waitForTimeout(500);
                const currentUrl = page.url();
                if (currentUrl.includes('/watch?v=')) {
                    finalUrl = currentUrl;
                    this.log(`Playback confirmed. Capturing link...`);
                    await page.waitForTimeout(1500);
                    break;
                }
            }

            if (!finalUrl) throw new Error('Link stabilization failed.');

            this.log(`Media Link Captured Successfully.`);
            await page.waitForTimeout(1000);

            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.show();
                this.mainWindow.focus();
            }

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
