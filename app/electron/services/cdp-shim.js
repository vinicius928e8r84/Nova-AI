const http = require('http');
const net = require('net');

const SHIM_PORT_START = 9333;
const SHIM_PORT_END = 9353;

const LAZY_BROWSER_PATH = '/devtools/browser/stonic';

const LAUNCH_TIMEOUT_MS = 60000;
const UPSTREAM_TIMEOUT_MS = 2500;

const ALLOWED_PATHS = new Set(['/json/version', '/json', '/json/list']);

let server = null;
let browserWsUrl = null;
let launchPromise = null;

function ensureBrowserLaunched() {
    if (launchPromise) return launchPromise;
    const { browserService } = require('./browser-manager');
    launchPromise = Promise.resolve()
        .then(() => browserService.launch())
        .finally(() => { launchPromise = null; });
    return launchPromise;
}

function browserIsRunning() {
    try {
        const { browserService } = require('./browser-manager');
        return browserService.isRunning();
    } catch {
        return false;
    }
}

function withTimeout(promise, ms, message) {
    let timer = null;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function fetchFromChromium(port, pathname) {
    return new Promise((resolve, reject) => {
        const req = http.get(
            { host: '127.0.0.1', port, path: pathname, timeout: UPSTREAM_TIMEOUT_MS },
            (res) => {
                let body = '';
                res.on('data', (chunk) => { body += chunk; });
                res.on('end', () => resolve({
                    status: res.statusCode || 200,
                    contentType: res.headers['content-type'] || 'application/json',
                    body,
                }));
            }
        );
        req.on('timeout', () => { req.destroy(); reject(new Error(`CDP probe on port ${port} timed out`)); });
        req.on('error', reject);
    });
}

async function chromiumBrowserWsPath(port) {
    const { body } = await fetchFromChromium(port, '/json/version');
    const wsUrl = String(JSON.parse(body).webSocketDebuggerUrl || '');
    if (!wsUrl) throw new Error('Chromium did not report a webSocketDebuggerUrl');
    return new URL(wsUrl).pathname;
}

function hostIsLoopback(hostHeader) {
    if (!hostHeader) return false;
    const host = String(hostHeader).split(':')[0].toLowerCase();
    return host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1';
}

function sendJsonError(res, status, message) {
    const body = JSON.stringify({ error: message });
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
    res.end(body);
}

function sendJson(res, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
    res.end(body);
}

function caminhoDoPedido(url) {
    try {
        return new URL(url, 'http://127.0.0.1').pathname;
    } catch {
        return null;
    }
}

const ehPedidoDeDescoberta = (req, pathname) => req.method === 'GET' && ALLOWED_PATHS.has(pathname);

async function handleRequest(req, res) {
    if (!hostIsLoopback(req.headers.host)) {
        return sendJsonError(res, 403, 'Forbidden');
    }

    const pathname = caminhoDoPedido(req.url);
    if (pathname === null) return sendJsonError(res, 400, 'Bad request');

    if (!ehPedidoDeDescoberta(req, pathname)) {
        return sendJsonError(res, 404, 'Not found');
    }

    if (!browserIsRunning()) {
        if (pathname === '/json/version') {
            return sendJson(res, {
                Browser: 'Chrome/Stonic (not started)',
                'Protocol-Version': '1.3',
                webSocketDebuggerUrl: browserWsUrl,
            });
        }
        return sendJson(res, []);
    }
    return repassarDoChromium(res, pathname);
}

async function repassarDoChromium(res, pathname) {
    const { getCdpPort } = require('./browser-manager');
    const cdpPort = getCdpPort();

    try {
        const upstream = await fetchFromChromium(cdpPort, pathname);
        if (pathname === '/json/version') {
            const payload = JSON.parse(upstream.body);
            payload.webSocketDebuggerUrl = browserWsUrl;
            return sendJson(res, payload);
        }
        res.writeHead(upstream.status, { 'Content-Type': upstream.contentType });
        res.end(upstream.body);
    } catch (err) {
        console.error(`[CDP Shim] Could not reach Chromium CDP on ${cdpPort}:`, err.message);
        sendJsonError(res, 502, `Chromium CDP unreachable on port ${cdpPort}`);
    }
}

function recusarUpgrade(clientSocket, { line, reason }) {
    console.warn('[CDP Shim] Rejected websocket upgrade:', reason);
    try { require('./browser-manager').appendBrowserLog(`shim reject (${line}): ${reason}`); } catch {}
    try {
        const body = `CDP shim: ${reason}\n`;
        clientSocket.write(
            `HTTP/1.1 ${line}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`
        );
    } catch {}
    clientSocket.destroy();
}

function motivoDaRecusa(req, pathname) {
    if (!hostIsLoopback(req.headers.host)) return { line: '403 Forbidden', reason: 'non-loopback Host' };

    if (req.headers.origin) return { line: '403 Forbidden', reason: `Origin header present (${req.headers.origin})` };
    if (pathname === null) return { line: '400 Bad Request', reason: 'unparseable request URL' };
    if (!pathname.startsWith('/devtools/')) return { line: '404 Not Found', reason: `path ${pathname}` };
    return null;
}

async function alvoComNavegadorAberto(browserManager, req, pathname) {
    await withTimeout(ensureBrowserLaunched(), LAUNCH_TIMEOUT_MS, 'Chromium did not come up in time');
    const cdpPort = browserManager.getCdpPort();
    const targetPath = pathname.startsWith('/devtools/browser/')
        ? await chromiumBrowserWsPath(cdpPort)
        : req.url;
    return { cdpPort, targetPath };
}

function handshakeParaChromium(headers, { cdpPort, targetPath }) {
    const lines = [`GET ${targetPath} HTTP/1.1`];
    for (const [name, value] of Object.entries(headers)) {
        if (name.toLowerCase() === 'host') continue;
        for (const v of Array.isArray(value) ? value : [value]) lines.push(`${name}: ${v}`);
    }
    lines.push(`Host: 127.0.0.1:${cdpPort}`);
    return lines.join('\r\n') + '\r\n\r\n';
}

async function handleUpgrade(req, clientSocket, head) {
    const pathname = caminhoDoPedido(req.url);
    const recusa = motivoDaRecusa(req, pathname);
    if (recusa) return recusarUpgrade(clientSocket, recusa);

    const browserManager = require('./browser-manager');
    const connectStarted = Date.now();
    let alvo;
    try {
        alvo = await alvoComNavegadorAberto(browserManager, req, pathname);
    } catch (err) {
        console.error('[CDP Shim] Browser unavailable for CDP connect:', err.message);
        return recusarUpgrade(clientSocket, { line: '503 Service Unavailable', reason: `browser unavailable: ${err.message}` });
    }
    try { browserManager.appendBrowserLog(`shim connect OK in ${Date.now() - connectStarted}ms (port ${alvo.cdpPort})`); } catch {}
    emendarNoChromium(req, clientSocket, head, alvo);
}

function emendarNoChromium(req, clientSocket, head, { cdpPort, targetPath }) {
    const upstream = net.connect(cdpPort, '127.0.0.1', () => {
        upstream.write(handshakeParaChromium(req.headers, { cdpPort, targetPath }));
        if (head && head.length) upstream.write(head);

        clientSocket.setNoDelay(true);
        upstream.setNoDelay(true);
        upstream.pipe(clientSocket);
        clientSocket.pipe(upstream);
        console.log(`[CDP Shim] CDP client attached to Chromium (port ${cdpPort}, ${targetPath}).`);
    });

    const teardown = (who) => (err) => {
        if (err) console.warn(`[CDP Shim] CDP tunnel ${who} error:`, err.message);
        clientSocket.destroy();
        upstream.destroy();
    };
    upstream.on('error', teardown('upstream'));
    clientSocket.on('error', teardown('client'));
    upstream.on('close', () => clientSocket.destroy());
    clientSocket.on('close', () => upstream.destroy());
}

function listenOn(port) {
    return new Promise((resolve) => {
        const candidate = http.createServer((req, res) => {
            handleRequest(req, res).catch((err) => {
                console.error('[CDP Shim] Unhandled error:', err.message);
                try { sendJsonError(res, 500, 'Internal error'); } catch { }
            });
        });
        candidate.on('upgrade', (req, socket, head) => {
            handleUpgrade(req, socket, head).catch((err) => {
                console.error('[CDP Shim] Unhandled upgrade error:', err.message);
                socket.destroy();
            });
        });
        candidate.once('error', () => resolve(null));
        candidate.listen(port, '127.0.0.1', () => resolve(candidate));
    });
}

async function startCdpShim() {
    if (browserWsUrl) return browserWsUrl;

    const override = parseInt(process.env.STONIC_CDP_SHIM_PORT || '', 10);
    const ports = Number.isInteger(override) && override > 0
        ? [override]
        : Array.from(
            { length: SHIM_PORT_END - SHIM_PORT_START + 1 },
            (_, i) => SHIM_PORT_START + i
        );

    for (const port of ports) {
        const bound = await listenOn(port);
        if (bound) {
            server = bound;
            browserWsUrl = `ws://127.0.0.1:${port}${LAZY_BROWSER_PATH}`;
            console.log(`[CDP Shim] Listening on 127.0.0.1:${port} — browser opens on first CDP connect.`);
            return browserWsUrl;
        }
    }

    throw new Error(`No free port for the CDP shim in ${SHIM_PORT_START}-${SHIM_PORT_END}`);
}

function stopCdpShim() {
    if (server) {
        try { server.close(); } catch { }
        server = null;
        browserWsUrl = null;
    }
}

module.exports = { startCdpShim, stopCdpShim };
