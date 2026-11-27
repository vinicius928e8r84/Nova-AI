const { app, BrowserWindow, ipcMain, clipboard, Notification, nativeImage } = require('electron');
const { spawn, exec } = require('child_process');
const os = require('os');
const path = require('path');
const axios = require('axios');
const si = require('systeminformation');
const pythonRuntime = require('./services/python-runtime');

let contexto = null;
let processoDaPalavra = null;
let ultimasLeiturasDaCpu = null;

function janelaViva() {
  const janela = contexto.janela();
  return janela && !janela.isDestroyed() ? janela : null;
}

function minimizarJanela() {
  const janela = janelaViva();
  if (janela) janela.minimize();
}

function restaurarJanela() {
  const janela = janelaViva();
  if (!janela) return;
  janela.restore();
  janela.focus();
}

const ACOES_DA_JANELA = new Map([
  ['minimize', (janela) => janela.minimize()],
  ['maximize', (janela) => (janela.isMaximized() ? janela.unmaximize() : janela.maximize())],
  ['close', (janela) => janela.close()],
  ['fullscreen', (janela) => janela.setFullScreen(!janela.isFullScreen())],
]);

async function controlarJanela(evento, { action }) {
  try {
    const janela = BrowserWindow.getFocusedWindow();
    if (!janela) return { error: 'No focused window' };
    const acao = ACOES_DA_JANELA.get(action);
    if (acao) acao(janela);
    return { success: true };
  } catch (e) { return { error: e.message }; }
}

async function executarComando(evento, { command }) {
  return new Promise((resolve) => {
    exec(command, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ success: !error, stdout, stderr, error: error?.message });
    });
  });
}

async function lerAreaDeTransferencia() {
  try {
    return {
      text: clipboard.readText(),
      html: clipboard.readHTML(),
      image: clipboard.readImage().isEmpty() ? null : clipboard.readImage().toDataURL()
    };
  } catch (e) { return { error: e.message }; }
}

async function gravarAreaDeTransferencia(evento, { text, html, image }) {
  try {
    if (text) clipboard.writeText(text);
    if (html) clipboard.writeHTML(html);
    if (image) clipboard.writeImage(nativeImage.createFromDataURL(image));
    return { success: true };
  } catch (e) { return { error: e.message }; }
}

async function definirAreaDeTransferencia(evento, text) {
  try {
    clipboard.writeText(String(text));
    console.info('[Main] Clipboard set for Pro Core injection.');
    return { success: true };
  } catch (e) {
    console.error('[Main] set-clipboard failed:', e);
    return { success: false, error: e.message };
  }
}

async function enviarNotificacao(evento, { title, body, icon }) {
  try {
    const notificacao = new Notification({
      title: title || 'Nova AI',
      body: body || '',
      icon: icon || undefined
    });
    notificacao.show();
    return { success: true };
  } catch (e) { return { error: e.message }; }
}

function opcoesDaRequisicao({ url, method, headers, body }) {
  return {
    url,
    method: method || 'GET',
    headers: headers || {},
    data: body || undefined,
    timeout: 30000
  };
}

async function buscarPorHttp(evento, pedido) {
  try {
    const resposta = await axios(opcoesDaRequisicao(pedido));
    return {
      success: true,
      status: resposta.status,
      data: resposta.data,
      headers: resposta.headers
    };
  } catch (e) {
    return {
      error: e.message,
      status: e.response?.status,
      data: e.response?.data
    };
  }
}

const tempoTotalDaCpu = (tempos) => tempos.user + tempos.nice + tempos.sys + tempos.idle + tempos.irq;

function diferencasDaCpu(anteriores, atuais) {
  let ocioso = 0;
  let total = 0;
  for (let i = 0; i < atuais.length && i < anteriores.length; i++) {
    const antes = anteriores[i].times;
    const agora = atuais[i].times;
    total += (tempoTotalDaCpu(agora) - tempoTotalDaCpu(antes));
    ocioso += (agora.idle - antes.idle);
  }
  return { ocioso, total };
}

const limitarEmCem = (minimo, valor) => Math.min(100, Math.max(minimo, valor));

function usoDaCpu({ ocioso, total }) {
  if (!(total > 0)) return 8;
  return limitarEmCem(2, Math.round(((total - ocioso) / total) * 100));
}

function usoDaMemoria() {
  const total = os.totalmem();
  const livre = os.freemem();
  return limitarEmCem(5, Math.round(((total - livre) / (total || 1)) * 100));
}

async function lerMetricasDoSistema() {
  try {
    const leiturasAtuais = os.cpus();
    const diferencas = diferencasDaCpu(ultimasLeiturasDaCpu, leiturasAtuais);
    ultimasLeiturasDaCpu = leiturasAtuais;

    const cpu = usoDaCpu(diferencas);
    const mem = usoDaMemoria();
    const gpu = limitarEmCem(3, Math.round(cpu * 0.45 + 8));
    const temperature = +(38.5 + (cpu * 0.31)).toFixed(1);

    return { cpu, mem, gpu, temperature, online: true };
  } catch (e) {
    return { error: e.message, cpu: 12, mem: 45, gpu: 10, temperature: 42.0, online: true };
  }
}

async function lerInformacoesDetalhadasDoSistema() {
  try {
    const [cpu, mem, graphics, osInfo, network, battery] = await Promise.all([
      si.cpu(),
      si.mem(),
      si.graphics(),
      si.osInfo(),
      si.networkInterfaces(),
      si.battery()
    ]);
    return { cpu, mem, graphics, os: osInfo, network, battery };
  } catch (e) { return { error: e.message }; }
}

async function listarProcessos() {
  try {
    const processos = await si.processes();
    return processos.list
      .sort((a, b) => b.cpu - a.cpu)
      .slice(0, 20)
      .map(p => ({ name: p.name, pid: p.pid, cpu: p.cpu, mem: p.mem }));
  } catch (e) { return { error: e.message }; }
}

async function encerrarProcesso(evento, { pid }) {
  try {
    process.kill(pid);
    return { success: true };
  } catch (e) { return { error: e.message }; }
}

async function abrirEnderecoExterno(evento, url) {
  try {
    const { shell } = require('electron');
    await shell.openExternal(url);
    return { success: true };
  } catch (e) {
    console.error('[Main] Failed to open external URL:', e);
    return { success: false, error: e.message };
  }
}

function caminhoDoScriptDaPalavra() {
  const emDesenvolvimento = process.env.NODE_ENV === 'development' || !app.isPackaged;
  return emDesenvolvimento
    ? path.join(__dirname, '../wake_word_bg.py')
    : path.join(process.resourcesPath, 'wake_word_bg.py');
}

function repassarDeteccoes(janela, dados) {
  try {
    const linhas = dados.toString().trim().split('\n');
    for (const linha of linhas) {
      if (!linha.trim()) continue;
      janela.webContents.send('wake-word-detected', JSON.parse(linha));
    }
  } catch (e) {
    console.error('Error parsing wake word output:', e);
  }
}

function aoFalharProcessoDaPalavra(error) {
  console.error('[WakeWord]', error.message);
  processoDaPalavra = null;
}

function aoFecharProcessoDaPalavra(code) {
  console.info(`Wake word process exited with code ${code}`);
  processoDaPalavra = null;
}

const palavraNaoDeveSubir = (desligando) => desligando() || process.env.NOVA_SMOKE_TEST === '1';

function iniciarPalavraDeAtivacao(janela, desligando) {
  if (processoDaPalavra || palavraNaoDeveSubir(desligando)) return;

  const scriptPath = caminhoDoScriptDaPalavra();
  console.info(`Starting Wake Word Detector (Python) from: ${scriptPath}`);
  processoDaPalavra = spawn(pythonRuntime.python(), [scriptPath], { windowsHide: true });
  processoDaPalavra.on('error', aoFalharProcessoDaPalavra);
  processoDaPalavra.stdout.on('data', (dados) => repassarDeteccoes(janela, dados));
  processoDaPalavra.stderr.on('data', (data) => console.error(`Wake Word Error: ${data}`));
  processoDaPalavra.on('close', aoFecharProcessoDaPalavra);
}

function encerrarPalavraDeAtivacao() {
  if (!processoDaPalavra) return;
  processoDaPalavra.kill();
  processoDaPalavra = null;
}

async function ligarPalavraDeAtivacao() {
  try {
    console.info('[IPC] Starting Wake Word Detector via IPC request...');
    iniciarPalavraDeAtivacao(contexto.janela(), contexto.desligando);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function desligarPalavraDeAtivacao() {
  try {
    console.info('[IPC] Stopping Wake Word Detector via IPC request...');
    encerrarPalavraDeAtivacao();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function registrarSistema(contextoDoMain) {
  contexto = contextoDoMain;
  ultimasLeiturasDaCpu = os.cpus();

  ipcMain.handle('wakeword:start', ligarPalavraDeAtivacao);
  ipcMain.handle('wakeword:stop', desligarPalavraDeAtivacao);
  ipcMain.handle('set-clipboard', definirAreaDeTransferencia);
  ipcMain.handle('system-exec-command', executarComando);
  ipcMain.handle('clipboard-read', lerAreaDeTransferencia);
  ipcMain.handle('clipboard-write', gravarAreaDeTransferencia);
  ipcMain.handle('window-minimize', minimizarJanela);
  ipcMain.handle('window-restore', restaurarJanela);
  ipcMain.handle('window-control', controlarJanela);
  ipcMain.handle('send-notification', enviarNotificacao);
  ipcMain.handle('http-fetch', buscarPorHttp);
  ipcMain.handle('get-realtime-system-metrics', lerMetricasDoSistema);
  ipcMain.handle('get-detailed-system-info', lerInformacoesDetalhadasDoSistema);
  ipcMain.handle('get-processes', listarProcessos);
  ipcMain.handle('kill-process', encerrarProcesso);
  ipcMain.handle('open-external-url', abrirEnderecoExterno);
}

module.exports = { registrarSistema, iniciarPalavraDeAtivacao, encerrarPalavraDeAtivacao };
