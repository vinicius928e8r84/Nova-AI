'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');
const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');

const toolPathsReais = require('../tool-paths');

const carregadorOriginal = Module._load;
const TMP = fs.realpathSync(os.tmpdir());
const pastasTemporarias = [];
const NOME_DO_CLOUDFLARED = toolPathsReais.exe('cloudflared');
const MODO_DO_BINARIO = process.platform === 'win32' ? { antes: 0o444, depois: 0o666 } : { antes: 0o644, depois: 0o755 };
const PORTA = 3456;
const CORS_PREFLIGHT = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
};
const CABECALHO_JSON = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

const cena = {};

function pastaTemporaria(prefixo) {
    const pasta = fs.mkdtempSync(path.join(TMP, prefixo));
    pastasTemporarias.push(pasta);
    return pasta;
}

function novaCena() {
    Object.assign(cena, {
        logs: [],
        servidores: [],
        ios: [],
        spawns: [],
        instalacoes: [],
        ferramentas: [],
        errosDeEscuta: [],
        errosDeInstalacao: null,
        erroDeSpawn: null,
        binDev: path.join(TMP, 'nao-existe-cloudflared'),
        ferramenta: null,
        dirEletron: pastaTemporaria('remote-eletron-'),
        interfaces: {
            lo: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
            en0: [{ family: 'IPv6', internal: false, address: 'fe80::1' }, { family: 'IPv4', internal: false, address: '192.168.0.7' }]
        }
    });
}

class ServidorHttpFalso extends EventEmitter {
    constructor(atender) {
        super();
        this.atender = atender;
        this.escutas = [];
        cena.servidores.push(this);
    }
    listen(porta, host, aoEscutar) {
        this.escutas.push([porta, host, typeof aoEscutar]);
        if (aoEscutar) this.once('listening', aoEscutar);
        const erro = cena.errosDeEscuta.shift();
        process.nextTick(() => (erro ? this.emit('error', erro) : this.emit('listening')));
    }
    close() { this.fechado = true; }
}

class ServidorIoFalso {
    constructor(servidorHttp, opcoes) {
        this.servidorHttp = servidorHttp;
        this.opcoes = opcoes;
        this.ouvintes = {};
        this.emitidos = [];
        this.sockets = { sockets: new Map() };
        cena.ios.push(this);
    }
    on(evento, fn) { this.ouvintes[evento] = fn; }
    emit(evento, dados) { this.emitidos.push([evento, dados]); }
    to(id) { return { emit: (evento, dados) => this.emitidos.push([id, evento, dados]) }; }
    close() { this.fechado = true; }
}

class ProcessoFalso extends EventEmitter {
    constructor() {
        super();
        this.stdout = new EventEmitter();
        this.stderr = new EventEmitter();
        this.mortes = 0;
    }
    kill() { this.mortes++; }
}

const falsos = {
    'socket.io': { Server: ServidorIoFalso },
    http: { createServer: (atender) => new ServidorHttpFalso(atender) },
    qrcode: { toDataURL: async (url) => `qr:${url}` },
    child_process: {
        spawn: (bin, args, opcoes) => {
            if (cena.erroDeSpawn) throw cena.erroDeSpawn;
            const processo = new ProcessoFalso();
            cena.spawns.push({ bin, args, opcoes, processo });
            return processo;
        }
    },
    cloudflared: {
        get bin() { return cena.binDev; },
        install: async (bin) => {
            cena.instalacoes.push(bin);
            if (cena.errosDeInstalacao) throw cena.errosDeInstalacao;
        }
    },
    './tool-paths': {
        tool: (nome) => { cena.ferramentas.push(nome); return cena.ferramenta; },
        exe: toolPathsReais.exe
    },
    electron: { app: { getPath: () => cena.dirEletron } },
    os: { ...os, networkInterfaces: () => cena.interfaces }
};

function texto(valor) {
    return valor instanceof Error ? `${valor.name}: ${valor.message}` : valor;
}

const consoleOriginal = { log: console.log, info: console.info, error: console.error, warn: console.warn };
Module._load = function (pedido, ...resto) {
    return Object.hasOwn(falsos, pedido) ? falsos[pedido] : carregadorOriginal.call(this, pedido, ...resto);
};
const RemoteAccessService = require('../remote-access');

const ambienteOriginal = { ...process.env };
const resourcesOriginal = process.resourcesPath;

test.beforeEach(() => {
    novaCena();
    for (const nivel of ['log', 'info', 'error', 'warn']) console[nivel] = (...args) => cena.logs.push([nivel === 'info' ? 'log' : nivel, ...args.map(texto)]);
    delete process.env.NOVA_SMOKE_TEST;
    delete process.env.NOVA_REMOTE_TUNNEL;
    delete process.env.NODE_ENV;
    delete process.env.GROQ_API_KEY;
});

test.afterEach(() => {
    Object.assign(console, consoleOriginal);
    for (const chave of Object.keys(process.env)) if (!(chave in ambienteOriginal)) delete process.env[chave];
    Object.assign(process.env, ambienteOriginal);
    process.resourcesPath = resourcesOriginal;
});

test.after(() => {
    Module._load = carregadorOriginal;
    for (const pasta of pastasTemporarias) fs.rmSync(pasta, { recursive: true, force: true, maxRetries: 3 });
});

function novoServico() {
    const dados = pastaTemporaria('remote-dados-');
    const servico = new RemoteAccessService({ getPath: () => dados });
    servico.desktop = [];
    servico.setDesktopCallback((evento, info) => servico.desktop.push([evento, info]));
    servico.dados = dados;
    cena.logs.length = 0;
    return servico;
}

const esvaziar = () => new Promise((r) => setImmediate(r));

async function servicoIniciado() {
    const servico = novoServico();
    await servico.start();
    cena.logs.length = 0;
    return { servico, servidor: cena.servidores[0], io: cena.ios[0] };
}

test('construtor sem tokens salvos gera um token padrão e grava remote_tokens.json', () => {
    const servico = novoServico();
    const [dados] = servico.tokens.values();
    assert.match(dados.token, /^[0-9A-F]{8}$/);
    assert.strictEqual(dados.deviceName, 'Default Mobile');
    assert.strictEqual(dados.active, true);
    const gravado = JSON.parse(fs.readFileSync(path.join(servico.dados, 'remote_tokens.json'), 'utf8'));
    assert.deepStrictEqual(Object.keys(gravado.tokens), [dados.token]);
});

test('start com NOVA_SMOKE_TEST=1 não sobe servidor', async () => {
    process.env.NOVA_SMOKE_TEST = '1';
    const servico = novoServico();
    assert.strictEqual(await servico.start(), undefined);
    assert.strictEqual(cena.servidores.length, 0);
    assert.deepStrictEqual(cena.logs, []);
});

test('start sobe http e socket.io em 127.0.0.1 e devolve os endereços, túnel desligado', async () => {
    const servico = novoServico();
    const resultado = await servico.start();
    assert.deepStrictEqual(resultado, {
        success: true,
        port: PORTA,
        localUrl: 'http://localhost:3456',
        localNetworkUrl: 'http://192.168.0.7:3456',
        publicUrl: null,
        localIp: '192.168.0.7'
    });
    assert.deepStrictEqual(Object.keys(resultado), ['success', 'port', 'localUrl', 'localNetworkUrl', 'publicUrl', 'localIp']);
    const [servidor] = cena.servidores;
    const [io] = cena.ios;
    assert.deepStrictEqual(servidor.escutas, [[PORTA, '127.0.0.1', 'function']]);
    assert.strictEqual(io.servidorHttp, servidor);
    assert.deepStrictEqual(io.opcoes, { cors: { origin: '*', methods: ['GET', 'POST'] }, transports: ['websocket', 'polling'] });
    assert.deepStrictEqual(Object.keys(io.ouvintes), ['connection']);
    assert.strictEqual(servico.isRunning, true);
    assert.deepStrictEqual(cena.logs, [
        ['log', '[RemoteAccess] WebSocket server started on port 3456'],
        ['log', '[RemoteAccess] Public internet tunnel OFF (LAN/internet exposure disabled).']
    ]);
});

test('start sem interface de rede externa usa localhost como IP local', async () => {
    cena.interfaces = { lo: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }] };
    const resultado = await novoServico().start();
    assert.strictEqual(resultado.localIp, 'localhost');
    assert.strictEqual(resultado.localNetworkUrl, 'http://localhost:3456');
});

test('start com porta ocupada tenta a seguinte até conseguir', async () => {
    const ocupada = Object.assign(new Error('ocupada'), { code: 'EADDRINUSE' });
    cena.errosDeEscuta.push(ocupada, ocupada);
    const servico = novoServico();
    const resultado = await servico.start();
    assert.deepStrictEqual(cena.servidores[0].escutas, [[3456, '127.0.0.1', 'function'], [3457, '127.0.0.1', 'undefined'], [3458, '127.0.0.1', 'undefined']]);
    assert.strictEqual(resultado.port, 3458);
    assert.strictEqual(resultado.localUrl, 'http://localhost:3458');
    assert.deepStrictEqual(cena.logs[0], ['log', '[RemoteAccess] WebSocket server started on port 3458']);
});

test('start com outro erro de escuta devolve success false', async () => {
    cena.errosDeEscuta.push(Object.assign(new Error('boom'), { code: 'EACCES' }));
    const servico = novoServico();
    assert.deepStrictEqual(await servico.start(), { success: false, error: 'boom' });
    assert.strictEqual(servico.isRunning, false);
    assert.deepStrictEqual(cena.logs, [['error', '[RemoteAccess] Failed to start server:', 'Error: boom']]);
});

test('start com NOVA_REMOTE_TUNNEL=1 espera o túnel depois de escutar', async () => {
    process.env.NOVA_REMOTE_TUNNEL = '1';
    const servico = novoServico();
    const chamadas = [];
    servico.startCloudflaredTunnel = async () => { chamadas.push(servico.isRunning); servico.publicUrl = 'https://x.trycloudflare.com'; };
    const resultado = await servico.start();
    assert.deepStrictEqual(chamadas, [true]);
    assert.strictEqual(resultado.publicUrl, 'https://x.trycloudflare.com');
    assert.deepStrictEqual(cena.logs, [['log', '[RemoteAccess] WebSocket server started on port 3456']]);
});

test('start com túnel que falha registra o erro e segue com success', async () => {
    process.env.NOVA_REMOTE_TUNNEL = '1';
    const servico = novoServico();
    servico.startCloudflaredTunnel = async () => { throw new Error('sem túnel'); };
    const resultado = await servico.start();
    assert.strictEqual(resultado.success, true);
    assert.deepStrictEqual(cena.logs, [
        ['log', '[RemoteAccess] WebSocket server started on port 3456'],
        ['error', '[RemoteAccess] Tunnel startup failed:', 'Error: sem túnel']
    ]);
});

test('start já rodando sem túnel e com túnel desligado só avisa', async () => {
    const { servico } = await servicoIniciado();
    assert.deepStrictEqual(await servico.start(), { success: true, port: PORTA, url: null });
    assert.strictEqual(cena.servidores.length, 1);
    assert.deepStrictEqual(cena.logs, [
        ['log', '[RemoteAccess] Server already running'],
        ['log', '[RemoteAccess] Tunnel not active, attempting to restart tunnel...'],
        ['log', '[RemoteAccess] Public tunnel disabled (use NOVA_REMOTE_TUNNEL=1 to enable).']
    ]);
});

test('start já rodando com túnel ligado reabre o túnel sem esperar e registra a falha', async () => {
    const { servico } = await servicoIniciado();
    process.env.NOVA_REMOTE_TUNNEL = '1';
    let chamadas = 0;
    servico.startCloudflaredTunnel = async () => { chamadas++; throw new Error('de novo não'); };
    assert.deepStrictEqual(await servico.start(), { success: true, port: PORTA, url: null });
    assert.strictEqual(chamadas, 1);
    await esvaziar();
    assert.deepStrictEqual(cena.logs, [
        ['log', '[RemoteAccess] Server already running'],
        ['log', '[RemoteAccess] Tunnel not active, attempting to restart tunnel...'],
        ['error', '[RemoteAccess] Failed to restart tunnel:', 'Error: de novo não']
    ]);
});

test('start já rodando com URL pública ou processo do túnel não reabre', async () => {
    const { servico } = await servicoIniciado();
    process.env.NOVA_REMOTE_TUNNEL = '1';
    let chamadas = 0;
    servico.startCloudflaredTunnel = async () => { chamadas++; };
    servico.publicUrl = 'https://y.trycloudflare.com';
    assert.deepStrictEqual(await servico.start(), { success: true, port: PORTA, url: 'https://y.trycloudflare.com' });
    servico.publicUrl = null;
    servico.cloudflaredProcess = new ProcessoFalso();
    assert.deepStrictEqual(await servico.start(), { success: true, port: PORTA, url: null });
    assert.strictEqual(chamadas, 0);
    assert.deepStrictEqual(cena.logs, [['log', '[RemoteAccess] Server already running'], ['log', '[RemoteAccess] Server already running']]);
});

function requisicao(url, method) {
    return Object.assign(new EventEmitter(), { url, method });
}

function resposta() {
    return {
        cabecalhos: [],
        fins: [],
        writeHead(...args) { this.cabecalhos.push(args); },
        end(...args) { this.fins.push(args); }
    };
}

function atenderComPwaEspiado(servidor, servico, url, method) {
    const pwa = [];
    servico.servePWA = (req, res) => pwa.push([req.url, req.method, res]);
    const res = resposta();
    const req = requisicao(url, method);
    assert.strictEqual(servidor.atender(req, res), undefined);
    return { req, res, pwa };
}

test('rotas de config do Firebase respondem ao preflight OPTIONS com CORS', async () => {
    const { servico, servidor } = await servicoIniciado();
    for (const url of ['/api/save-firebase-config', '/api/get-firebase-config']) {
        const { res, pwa } = atenderComPwaEspiado(servidor, servico, url, 'OPTIONS');
        assert.deepStrictEqual(res.cabecalhos, [[204, CORS_PREFLIGHT]]);
        assert.deepStrictEqual(res.fins, [[]]);
        assert.deepStrictEqual(pwa, []);
    }
});

test('POST /api/save-firebase-config grava o corpo formatado e responde success', async () => {
    const { servico, servidor } = await servicoIniciado();
    const { req, res, pwa } = atenderComPwaEspiado(servidor, servico, '/api/save-firebase-config', 'POST');
    req.emit('data', '{"projectId":');
    req.emit('data', Buffer.from(' "nova"}'));
    assert.deepStrictEqual(res.cabecalhos, []);
    req.emit('end');
    assert.strictEqual(fs.readFileSync(path.join(servico.dados, 'firebase_config.json'), 'utf8'), '{\n  "projectId": "nova"\n}');
    assert.deepStrictEqual(res.cabecalhos, [[200, CABECALHO_JSON]]);
    assert.deepStrictEqual(res.fins, [['{"success":true}']]);
    assert.deepStrictEqual(pwa, []);
});

test('POST /api/save-firebase-config com JSON inválido responde 500 com a mensagem', async () => {
    const { servico, servidor } = await servicoIniciado();
    const { req, res } = atenderComPwaEspiado(servidor, servico, '/api/save-firebase-config', 'POST');
    req.emit('data', '{x');
    req.emit('end');
    let mensagem;
    try { JSON.parse('{x'); } catch (e) { mensagem = e.message; }
    assert.deepStrictEqual(res.cabecalhos, [[500, CABECALHO_JSON]]);
    assert.deepStrictEqual(res.fins, [[JSON.stringify({ error: mensagem })]]);
    assert.strictEqual(fs.existsSync(path.join(servico.dados, 'firebase_config.json')), false);
});

test('GET /api/get-firebase-config devolve {} sem arquivo, o arquivo salvo, ou 500 se corrompido', async () => {
    const { servico, servidor } = await servicoIniciado();
    const caminho = path.join(servico.dados, 'firebase_config.json');
    const ler = () => atenderComPwaEspiado(servidor, servico, '/api/get-firebase-config', 'GET').res;
    let res = ler();
    assert.deepStrictEqual(res.cabecalhos, [[200, CABECALHO_JSON]]);
    assert.deepStrictEqual(res.fins, [['{}']]);
    fs.writeFileSync(caminho, '{ "apiKey": "k", "n": [1, 2] }');
    res = ler();
    assert.deepStrictEqual(res.fins, [['{"apiKey":"k","n":[1,2]}']]);
    fs.writeFileSync(caminho, 'quebrado');
    res = ler();
    assert.deepStrictEqual(res.cabecalhos, [[500, CABECALHO_JSON]]);
    assert.strictEqual(res.cabecalhos.length, 1);
    assert.match(JSON.parse(res.fins[0][0]).error, /JSON/);
});

test('método ou caminho fora das rotas do Firebase vai para o PWA', async () => {
    const { servico, servidor } = await servicoIniciado();
    const casos = [
        ['/api/save-firebase-config', 'GET'],
        ['/api/save-firebase-config', 'PUT'],
        ['/api/get-firebase-config', 'POST'],
        ['/api/get-firebase-config', 'DELETE'],
        ['/api/save-firebase-config/', 'POST'],
        ['/', 'GET'],
        ['/', 'OPTIONS'],
        ['/app.js', 'GET'],
        ['constructor', 'OPTIONS'],
        ['__proto__', 'GET']
    ];
    for (const [url, method] of casos) {
        const { res, pwa } = atenderComPwaEspiado(servidor, servico, url, method);
        assert.deepStrictEqual(pwa.map(([u, m]) => [u, m]), [[url, method]]);
        assert.strictEqual(pwa[0][2], res);
        assert.deepStrictEqual(res.cabecalhos, []);
    }
});

test('a raiz serve o index.html do PWA', async () => {
    const { servidor } = await servicoIniciado();
    const res = resposta();
    servidor.atender(requisicao('/', 'GET'), res);
    await new Promise((r) => { const olhar = () => (res.fins.length ? r() : setTimeout(olhar, 5)); olhar(); });
    assert.deepStrictEqual(res.cabecalhos, [[200, { 'Content-Type': 'text/html' }]]);
    assert.deepStrictEqual(res.fins[0][0], fs.readFileSync(path.join(__dirname, '..', '..', 'pwa', 'index.html')));
});

function socketFalso(id) {
    return {
        id,
        ouvintes: {},
        emitidos: [],
        desconexoes: 0,
        on(evento, fn) { this.ouvintes[evento] = fn; },
        emit(evento, dados) { this.emitidos.push([evento, dados]); },
        disconnect() { this.desconexoes++; }
    };
}

async function conectado() {
    const iniciado = await servicoIniciado();
    const socket = socketFalso('s1');
    iniciado.io.ouvintes.connection(socket);
    const [token] = iniciado.servico.tokens.keys();
    return { ...iniciado, socket, token };
}

test('conexão registra os eventos do celular na ordem de sempre', async () => {
    const { socket } = await conectado();
    assert.deepStrictEqual(Object.keys(socket.ouvintes), ['authenticate', 'chat-message', 'switch-model', 'disconnect', 'get-groq-key']);
    assert.deepStrictEqual(cena.logs, [['log', '[RemoteAccess] New connection attempt: s1']]);
});

test('authenticate com token inválido recusa e desconecta', async () => {
    const { servico, socket } = await conectado();
    socket.ouvintes.authenticate({ token: 'ERRADO00' });
    assert.deepStrictEqual(socket.emitidos, [['authenticated', { success: false, error: 'Invalid token' }]]);
    assert.strictEqual(socket.desconexoes, 1);
    assert.strictEqual(servico.connectedClients.size, 0);
    assert.deepStrictEqual(servico.desktop, []);
    assert.throws(() => socket.ouvintes.authenticate(undefined), TypeError);
});

test('authenticate com token válido registra o cliente, avisa o desktop e manda a chave do Groq', async () => {
    const { servico, socket, token } = await conectado();
    fs.writeFileSync(path.join(servico.dados, 'groq_key.json'), JSON.stringify({ apiKey: 'gk-arquivo' }));
    process.env.GROQ_API_KEY = 'gk-ambiente';
    const antes = Date.now();
    socket.ouvintes.authenticate({ token });
    const cliente = servico.connectedClients.get('s1');
    assert.deepStrictEqual(Object.keys(cliente), ['token', 'deviceName', 'connectedAt']);
    assert.strictEqual(cliente.token, token);
    assert.strictEqual(cliente.deviceName, 'Default Mobile');
    assert.ok(cliente.connectedAt >= antes);
    assert.ok(servico.tokens.get(token).lastUsed >= antes);
    assert.deepStrictEqual(socket.emitidos, [['authenticated', { success: true }], ['groq-key', { apiKey: 'gk-arquivo' }]]);
    assert.strictEqual(socket.desconexoes, 0);
    assert.deepStrictEqual(servico.desktop, [['client-connected', { deviceName: 'Default Mobile', socketId: 's1' }]]);
    assert.deepStrictEqual(cena.logs.slice(1), [['log', '[RemoteAccess] Client authenticated: Default Mobile']]);
});

test('chat-message exige autenticação e encaminha mensagem e anexos ao desktop', async () => {
    const { servico, socket, token } = await conectado();
    const semLogin = socket.ouvintes['chat-message']({ message: 'oi' });
    assert.ok(semLogin instanceof Promise);
    await semLogin;
    assert.deepStrictEqual(socket.emitidos, [['error', { message: 'Não autenticado' }]]);
    assert.deepStrictEqual(servico.desktop, []);
    socket.ouvintes.authenticate({ token });
    socket.emitidos.length = 0;
    servico.desktop.length = 0;
    cena.logs.length = 0;
    await socket.ouvintes['chat-message']({ message: 'olá', attachments: [{ nome: 'a.png' }], extra: 1 });
    assert.deepStrictEqual(servico.desktop, [['mobile-message', { message: 'olá', attachments: [{ nome: 'a.png' }], socketId: 's1', deviceName: 'Default Mobile' }]]);
    assert.deepStrictEqual(socket.emitidos, []);
    assert.deepStrictEqual(cena.logs, [['log', '[RemoteAccess] Message from Default Mobile:', 'olá']]);
    await assert.rejects(socket.ouvintes['chat-message'](undefined), TypeError);
});

test('switch-model sem autenticação é ignorado e com autenticação vai ao desktop', async () => {
    const { servico, socket, token } = await conectado();
    assert.strictEqual(socket.ouvintes['switch-model']({ model: 'gemini' }), undefined);
    assert.deepStrictEqual(servico.desktop, []);
    socket.ouvintes.authenticate({ token });
    servico.desktop.length = 0;
    cena.logs.length = 0;
    socket.ouvintes['switch-model']({ model: 'gemini', outro: true });
    assert.deepStrictEqual(servico.desktop, [['model-select', { model: 'gemini', socketId: 's1' }]]);
    assert.deepStrictEqual(cena.logs, [['log', '[RemoteAccess] Model switch request from Default Mobile:', 'gemini']]);
});

test('disconnect tira o cliente autenticado e avisa o desktop; sem cliente não faz nada', async () => {
    const { servico, socket, token } = await conectado();
    socket.ouvintes.disconnect();
    assert.deepStrictEqual(servico.desktop, []);
    socket.ouvintes.authenticate({ token });
    servico.desktop.length = 0;
    cena.logs.length = 0;
    socket.ouvintes.disconnect();
    assert.strictEqual(servico.connectedClients.size, 0);
    assert.deepStrictEqual(servico.desktop, [['client-disconnected', { deviceName: 'Default Mobile', socketId: 's1' }]]);
    assert.deepStrictEqual(cena.logs, [['log', '[RemoteAccess] Client disconnected: Default Mobile']]);
});

test('get-groq-key usa o ambiente sem arquivo e não emite sem chave', async () => {
    const { socket } = await conectado();
    socket.ouvintes['get-groq-key']();
    assert.deepStrictEqual(socket.emitidos, []);
    process.env.GROQ_API_KEY = 'gk-ambiente';
    socket.ouvintes['get-groq-key']();
    assert.deepStrictEqual(socket.emitidos, [['groq-key', { apiKey: 'gk-ambiente' }]]);
});

function servicoDeTunel() {
    const servico = novoServico();
    servico.isRunning = true;
    servico.recuos = 0;
    servico.startFallbackTunnel = () => { servico.recuos++; };
    return servico;
}

function binarioTemporario() {
    const bin = path.join(pastaTemporaria('remote-bin-'), NOME_DO_CLOUDFLARED);
    fs.writeFileSync(bin, '');
    fs.chmodSync(bin, MODO_DO_BINARIO.antes);
    return bin;
}

const ARGUMENTOS_DO_TUNEL = ['tunnel', '--url', 'http://localhost:3456', '--no-autoupdate'];
const OPCOES_DO_TUNEL = { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] };

test('túnel em desenvolvimento com binário presente dá permissão e dispara o cloudflared na hora', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    process.env.NODE_ENV = 'development';
    cena.binDev = binarioTemporario();
    const servico = servicoDeTunel();
    const anterior = new ProcessoFalso();
    servico.cloudflaredProcess = anterior;
    const promessa = servico.startCloudflaredTunnel();
    assert.strictEqual(anterior.mortes, 1);
    assert.strictEqual(cena.spawns.length, 1);
    await promessa;
    const [{ bin, args, opcoes, processo }] = cena.spawns;
    assert.strictEqual(bin, cena.binDev);
    assert.deepStrictEqual(args, ARGUMENTOS_DO_TUNEL);
    assert.deepStrictEqual(opcoes, OPCOES_DO_TUNEL);
    assert.strictEqual(servico.cloudflaredProcess, processo);
    assert.strictEqual(fs.statSync(cena.binDev).mode & 0o777, MODO_DO_BINARIO.depois);
    assert.deepStrictEqual(cena.ferramentas, []);
    assert.deepStrictEqual(cena.logs, [
        ['log', '[RemoteAccess] Starting Cloudflare Tunnel...'],
        ['log', '[RemoteAccess] Using binary path:', cena.binDev],
        ['log', '[RemoteAccess] ✅ Binary found at:', cena.binDev],
        ['log', '[RemoteAccess] Cloudflared process spawned']
    ]);
});

test('saída do cloudflared com URL pública grava o arquivo de acesso e avisa o desktop uma vez', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    process.env.NODE_ENV = 'development';
    cena.binDev = binarioTemporario();
    const servico = servicoDeTunel();
    await servico.startCloudflaredTunnel();
    const { processo } = cena.spawns[0];
    cena.logs.length = 0;
    processo.stdout.emit('data', Buffer.from('INF Requesting new quick Tunnel...'));
    assert.strictEqual(servico.publicUrl, null);
    processo.stderr.emit('data', Buffer.from('INF |  https://Abc-123.TryCloudflare.com  |'));
    processo.stdout.emit('data', 'https://outro.trycloudflare.com');
    assert.strictEqual(servico.publicUrl, 'https://Abc-123.TryCloudflare.com');
    assert.deepStrictEqual(servico.desktop, [['tunnel-ready', { url: 'https://Abc-123.TryCloudflare.com', provider: 'cloudflare' }]]);
    const [token] = servico.tokens.keys();
    const arquivo = path.join(cena.dirEletron, 'REMOTE_ACCESS_INFO.txt');
    assert.ok(fs.readFileSync(arquivo, 'utf8').includes(`https://Abc-123.TryCloudflare.com?token=${token}`));
    assert.deepStrictEqual(cena.logs, [
        ['log', '[RemoteAccess] ✅ Cloudflared URL Ready: https://Abc-123.TryCloudflare.com'],
        ['log', `[RemoteAccess] Saved remote info to ${arquivo}`]
    ]);
    t.mock.timers.tick(15000);
    assert.strictEqual(servico.recuos, 0);
});

test('sem URL em 15 s cai no túnel reserva, só se o serviço ainda roda', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    process.env.NODE_ENV = 'development';
    cena.binDev = binarioTemporario();
    const servico = servicoDeTunel();
    await servico.startCloudflaredTunnel();
    cena.logs.length = 0;
    t.mock.timers.tick(14999);
    assert.strictEqual(servico.recuos, 0);
    t.mock.timers.tick(1);
    assert.strictEqual(servico.recuos, 1);
    assert.deepStrictEqual(cena.logs, [['log', '[RemoteAccess] Cloudflare timeout, trying fallback...']]);
    await servico.startCloudflaredTunnel();
    servico.isRunning = false;
    t.mock.timers.tick(15000);
    assert.strictEqual(servico.recuos, 1);
});

test('cloudflared que fecha com erro antes da URL cai no reserva; fechar sempre limpa a URL', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    process.env.NODE_ENV = 'development';
    cena.binDev = binarioTemporario();
    const servico = servicoDeTunel();
    await servico.startCloudflaredTunnel();
    const { processo } = cena.spawns[0];
    cena.logs.length = 0;
    processo.emit('close', 0);
    assert.strictEqual(servico.recuos, 0);
    processo.emit('close', 1);
    assert.strictEqual(servico.recuos, 1);
    servico.publicUrl = 'https://z.trycloudflare.com';
    processo.emit('close', 2);
    assert.strictEqual(servico.recuos, 1);
    assert.strictEqual(servico.publicUrl, null);
    processo.emit('error', new Error('ENOENT'));
    assert.strictEqual(servico.recuos, 2);
    assert.deepStrictEqual(cena.logs, [
        ['log', '[RemoteAccess] Cloudflared exited with code 0'],
        ['log', '[RemoteAccess] Cloudflared exited with code 1'],
        ['log', '[RemoteAccess] Cloudflared exited with code 2'],
        ['error', '[RemoteAccess] Cloudflared spawn error:', 'Error: ENOENT']
    ]);
});

test('sem permissão para chmod o túnel segue e só registra', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    process.env.NODE_ENV = 'development';
    cena.binDev = binarioTemporario();
    const negado = Object.assign(new Error(`EPERM: operation not permitted, chmod '${cena.binDev}'`), { code: 'EPERM' });
    const chmod = t.mock.method(fs, 'chmodSync', () => { throw negado; });
    const servico = servicoDeTunel();
    await servico.startCloudflaredTunnel();
    assert.deepStrictEqual(chmod.mock.calls.map((c) => c.arguments), [[cena.binDev, 0o755]]);
    assert.strictEqual(cena.spawns.length, 1);
    assert.deepStrictEqual(cena.logs.slice(2, 4), [
        ['log', '[RemoteAccess] ✅ Binary found at:', cena.binDev],
        ['log', '[RemoteAccess] Could not set permissions (Windows - not needed):', negado.message]
    ]);
});

test('túnel em desenvolvimento sem binário tenta instalar e dispara mesmo assim', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    process.env.NODE_ENV = 'development';
    const servico = servicoDeTunel();
    cena.errosDeInstalacao = new Error('sem rede');
    await servico.startCloudflaredTunnel();
    assert.deepStrictEqual(cena.instalacoes, [cena.binDev]);
    assert.strictEqual(cena.spawns.length, 1);
    assert.strictEqual(cena.spawns[0].bin, cena.binDev);
    assert.strictEqual(servico.recuos, 0);
    assert.deepStrictEqual(cena.logs, [
        ['log', '[RemoteAccess] Starting Cloudflare Tunnel...'],
        ['log', '[RemoteAccess] Using binary path:', cena.binDev],
        ['warn', '[RemoteAccess] Cloudflared binary not found at:', cena.binDev],
        ['error', '[RemoteAccess] Manual install failed:', 'Error: sem rede'],
        ['log', '[RemoteAccess] Cloudflared process spawned']
    ]);
});

test('túnel em produção usa o cloudflared achado pelo tool-paths', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    cena.ferramenta = binarioTemporario();
    const servico = servicoDeTunel();
    await servico.startCloudflaredTunnel();
    assert.deepStrictEqual(cena.ferramentas, ['cloudflared']);
    assert.strictEqual(cena.spawns[0].bin, cena.ferramenta);
    assert.deepStrictEqual(cena.instalacoes, []);
});

test('túnel em produção sem binário em resources cai no reserva sem disparar', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    process.resourcesPath = path.join(TMP, 'nao-existe-resources');
    const esperado = path.join(process.resourcesPath, NOME_DO_CLOUDFLARED);
    const servico = servicoDeTunel();
    await servico.startCloudflaredTunnel();
    assert.strictEqual(cena.spawns.length, 0);
    assert.strictEqual(servico.recuos, 1);
    assert.deepStrictEqual(cena.logs, [
        ['log', '[RemoteAccess] Starting Cloudflare Tunnel...'],
        ['log', '[RemoteAccess] Using binary path:', esperado],
        ['warn', '[RemoteAccess] Cloudflared binary not found at:', esperado],
        ['error', '[RemoteAccess] Binary missing in production build!'],
        ['log', '[RemoteAccess] Checked path:', esperado],
        ['log', '[RemoteAccess] Resources path:', process.resourcesPath]
    ]);
});

test('túnel em produção sem resourcesPath ou com spawn quebrado registra a falha e cai no reserva', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    delete process.resourcesPath;
    const servico = servicoDeTunel();
    await servico.startCloudflaredTunnel();
    assert.strictEqual(servico.recuos, 1);
    assert.deepStrictEqual(cena.logs.map((l) => l.slice(0, 2)), [
        ['log', '[RemoteAccess] Starting Cloudflare Tunnel...'],
        ['error', '[RemoteAccess] Failed to start Cloudflare Tunnel:']
    ]);
    assert.match(cena.logs[1][2], /^TypeError/);
    cena.logs.length = 0;
    process.env.NODE_ENV = 'development';
    cena.binDev = binarioTemporario();
    cena.erroDeSpawn = new Error('spawn EACCES');
    await servico.startCloudflaredTunnel();
    assert.strictEqual(servico.recuos, 2);
    assert.deepStrictEqual(cena.logs.at(-1), ['error', '[RemoteAccess] Failed to start Cloudflare Tunnel:', 'Error: spawn EACCES']);
});
