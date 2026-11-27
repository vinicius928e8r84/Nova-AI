const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const childProcess = require('child_process');

const DIST = path.join(__dirname, '../../app/dist');
const TIPOS_DAS_FIXTURES = [['.png', 'image/png'], ['.mp4', 'video/mp4']];
const MODULOS_DA_JANELA = /^\/cam-live(-dados|-modelo|-geometria)?\.js$/;
const ROTA_DO_IPC = /^\/ipc\/(invoke|send)\/(.+)$/;
const ESPERA_DO_RESULTADO_MS = 1200;
const CAMPOS_DO_FFPROBE = 'stream=codec_type,codec_name,profile,width,height,nb_read_frames,avg_frame_rate,channels,sample_rate';

const igual = (alvo) => (u) => u === alvo;
const comecaCom = (prefixo) => (u) => u.startsWith(prefixo);

function criarOuvinte(dir, portaRtmp) {
    const saida = path.join(dir, 'out.flv');
    let processo = null;
    return {
        saida,
        iniciar: () => { processo = childProcess.spawn('ffmpeg', ['-y', '-v', 'warning', '-listen', '1', '-i', `rtmp://127.0.0.1:${portaRtmp}/live/cam`, '-c', 'copy', '-f', 'flv', saida], { stdio: 'inherit' }); },
        parar: (sinal) => { if (processo) { try { processo.kill(sinal); } catch (_) {} } },
    };
}

function criarCanais() {
    const handlers = new Map(), ons = new Map();
    const ipcMain = { handle: (c, f) => handlers.set(c, f), on: (c, f) => ons.set(c, f) };
    return { handlers, ons, ipcMain };
}

function criarJanela(assinantes) {
    return { isDestroyed: () => false, webContents: { send: (ch, p) => { const m = `data: ${JSON.stringify({ ch, p })}\n\n`; assinantes.forEach((r) => r.write(m)); } } };
}

function servirAudio(res) {
    res.setHeader('content-type', 'application/javascript');
    try { return res.end(fs.readFileSync(path.join(DIST, 'cam-live-audio.js'))); } catch (_) { return res.end('/* cam-live-audio.js ainda não existe */'); }
}

function servirFixture(res, u) {
    const f = path.join(__dirname, 'fixtures', path.basename(u));
    if (!fs.existsSync(f)) { res.statusCode = 404; return res.end(); }
    const tipo = TIPOS_DAS_FIXTURES.find(([extensao]) => f.endsWith(extensao));
    res.setHeader('content-type', tipo ? tipo[1] : 'audio/wav');
    return res.end(fs.readFileSync(f));
}

function servirModulo(res, u) {
    res.setHeader('content-type', 'application/javascript');
    return res.end(fs.readFileSync(path.join(DIST, u)));
}

function abrirEventos(req, res, assinantes) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    res.write(': ok\n\n');
    assinantes.add(res);
    req.on('close', () => assinantes.delete(res));
}

function lerLog(res, dir) {
    try { return res.end(fs.readFileSync(path.join(dir, 'CamLive', 'camlive.log'), 'utf8')); } catch (_) { return res.end('(sem log)'); }
}

function medirResultado(res, ouvinte) {
    ouvinte.parar('SIGINT');
    setTimeout(() => {
        const pr = childProcess.spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', CAMPOS_DO_FFPROBE, '-of', 'json', ouvinte.saida]);
        res.setHeader('content-type', 'application/json');
        res.end(pr.stdout.length ? pr.stdout : JSON.stringify({ err: pr.stderr.toString() }));
    }, ESPERA_DO_RESULTADO_MS);
}

function decodificarCorpo(corpo) {
    const arg = corpo ? JSON.parse(corpo) : null;
    if (Array.isArray(arg?.data)) arg.data = Uint8Array.from(arg.data);
    return arg;
}

async function invocar(res, handler, arg) {
    const r = handler ? await handler({}, arg) : null;
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify(r === undefined ? null : r));
}

function enviar(res, ouvinteDoCanal, arg) {
    if (ouvinteDoCanal) ouvinteDoCanal({}, arg);
    res.end('{}');
}

async function responderIpc(res, u, corpo, { handlers, ons }) {
    const m = ROTA_DO_IPC.exec(u);
    if (!m) { res.statusCode = 404; return res.end(); }
    const arg = decodificarCorpo(corpo);
    if (arg?.__u8) return enviar(res, ons.get(m[2]), Uint8Array.from(arg.__u8));
    return m[1] === 'invoke' ? invocar(res, handlers.get(m[2]), arg) : enviar(res, ons.get(m[2]), arg);
}

function tratarIpc(req, res, u, canais) {
    let corpo = '';
    req.on('data', (d) => (corpo += d));
    req.on('end', () => responderIpc(res, u, corpo, canais));
}

function montarRotas({ pagina, extras, assinantes, ouvinte, dir }) {
    const comoRotas = Object.entries(extras).map(([alvo, tratador]) => [igual(alvo), tratador]);
    return [
        [igual('/'), (req, res) => { res.setHeader('content-type', 'text/html'); return res.end(pagina); }],
        [igual('/cam-live-audio.js'), (req, res) => servirAudio(res)],
        [comecaCom('/fixtures/'), (req, res, u) => servirFixture(res, u)],
        [(u) => MODULOS_DA_JANELA.test(u), (req, res, u) => servirModulo(res, u)],
        ...comoRotas,
        [igual('/events'), (req, res) => abrirEventos(req, res, assinantes)],
        [igual('/listen'), (req, res) => { ouvinte.parar('SIGKILL'); ouvinte.iniciar(); return res.end('listening'); }],
        [igual('/kill'), (req, res) => { ouvinte.parar('SIGKILL'); return res.end('killed'); }],
        [igual('/result'), (req, res) => medirResultado(res, ouvinte)],
        [igual('/log'), (req, res) => lerLog(res, dir)],
    ];
}

function criarTratador(contexto, canais) {
    const rotas = montarRotas(contexto);
    return (req, res) => {
        const u = req.url.split('?')[0];
        const rota = rotas.find(([casa]) => casa(u));
        return rota ? rota[1](req, res, u) : tratarIpc(req, res, u, canais);
    };
}

function criarBancada(portaPadrao, portaRtmpPadrao) {
    const porta = parseInt(process.env.PORT || `${portaPadrao}`, 10), portaRtmp = parseInt(process.env.RTMP_PORT || `${portaRtmpPadrao}`, 10);
    const assinantes = new Set();
    const canais = criarCanais();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'camlive-h-'));
    const ouvinte = criarOuvinte(dir, portaRtmp);
    const iniciar = (pagina, extras = {}) => http.createServer(criarTratador({ pagina, extras, assinantes, ouvinte, dir }, canais))
        .listen(porta, () => console.log(`harness em http://localhost:${porta}  (RTMP ffmpeg na ${portaRtmp})`));
    return { ipcMain: canais.ipcMain, win: criarJanela(assinantes), dir, iniciar };
}

module.exports = { criarBancada };
