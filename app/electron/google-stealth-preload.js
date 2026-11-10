/**
 * google-stealth-preload.js
 * Runs BEFORE page scripts in every Google webview/BrowserWindow.
 * Removes Electron/bot fingerprints so Google login works.
 */

// 1. Hide webdriver (main bot-detection signal)
Object.defineProperty(navigator, 'webdriver', {
    get: () => undefined,
    configurable: true
});

// 2. Fake Chrome runtime
if (!window.chrome) window.chrome = {};
if (!window.chrome.runtime) {
    window.chrome.runtime = { connect: () => {}, sendMessage: () => {}, id: undefined };
}

// 3. Fix plugins list (empty = bot signal)
Object.defineProperty(navigator, 'plugins', {
    get: () => {
        const arr = [
            { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
            { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
            { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' }
        ];
        arr.__proto__ = PluginArray.prototype;
        return arr;
    }
});

// 4. Fix languages
Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });

// 5. Remove Electron-specific globals
try { delete window.process; } catch (_) {}
try { delete window.require; } catch (_) {}
