const path = require('path');
const fs = require('fs');

const CORS_PREFLIGHT = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};
const CABECALHOS_JSON = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
const METODOS_DAS_ROTAS_FIREBASE = new Map([
    ['/api/save-firebase-config', new Set(['POST', 'OPTIONS'])],
    ['/api/get-firebase-config', new Set(['GET', 'OPTIONS'])]
]);
const TIPOS_DE_ARQUIVO = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

function ehRotaDeConfigFirebase(req) {
    return METODOS_DAS_ROTAS_FIREBASE.get(req.url)?.has(req.method) === true;
}

function responderPreflight(res) {
    res.writeHead(204, CORS_PREFLIGHT);
    res.end();
}

function responderJson(res, status, corpo) {
    res.writeHead(status, CABECALHOS_JSON);
    res.end(JSON.stringify(corpo));
}

function responderJsonOuErro(res, produzirCorpo) {
    try {
        responderJson(res, 200, produzirCorpo());
    } catch (e) {
        responderJson(res, 500, { error: e.message });
    }
}

function servirPwa(req, res) {
    const pwaDir = path.join(__dirname, '../pwa');
    let filePath = path.join(pwaDir, req.url === '/' ? 'index.html' : req.url);

    if (!filePath.startsWith(pwaDir)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    if (!fs.existsSync(filePath)) {
        filePath = path.join(pwaDir, 'index.html');
    }

    const ext = path.extname(filePath);
    const contentType = TIPOS_DE_ARQUIVO[ext] || 'text/plain';

    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(500);
            res.end('Server Error');
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
        }
    });
}

module.exports = { ehRotaDeConfigFirebase, responderPreflight, responderJson, responderJsonOuErro, servirPwa };
