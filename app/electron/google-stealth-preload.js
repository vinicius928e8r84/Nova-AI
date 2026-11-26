Object.defineProperty(navigator, 'webdriver', {
    get: () => undefined,
    configurable: true
});

if (!window.chrome) window.chrome = {};
if (!window.chrome.runtime) {
    window.chrome.runtime = { connect: () => {}, sendMessage: () => {}, id: undefined };
}

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

Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });

try { delete window.process; } catch (_) {}
try { delete window.require; } catch (_) {}
