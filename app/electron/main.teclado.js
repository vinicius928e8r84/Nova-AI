const { ipcMain } = require('electron');
const { exec } = require('child_process');
const macNative = require('./services/mac-native');

const TECLAS_DO_SENDKEYS = {
  'enter': '{ENTER}',
  'tab': '{TAB}',
  'escape': '{ESC}',
  'backspace': '{BACKSPACE}',
  'delete': '{DELETE}',
  'up': '{UP}',
  'down': '{DOWN}',
  'left': '{LEFT}',
  'right': '{RIGHT}',
  'home': '{HOME}',
  'end': '{END}',
  'pageup': '{PGUP}',
  'pagedown': '{PGDN}',
  'f1': '{F1}', 'f2': '{F2}', 'f3': '{F3}', 'f4': '{F4}',
  'f5': '{F5}', 'f6': '{F6}', 'f7': '{F7}', 'f8': '{F8}',
  'f9': '{F9}', 'f10': '{F10}', 'f11': '{F11}', 'f12': '{F12}',
  'ctrl+a': '^a', 'ctrl+c': '^c', 'ctrl+v': '^v', 'ctrl+x': '^x',
  'ctrl+z': '^z', 'ctrl+s': '^s', 'ctrl+enter': '^{ENTER}',
  'alt+f4': '%{F4}', 'alt+tab': '%{TAB}'
};

const ESCAPES_DO_SENDKEYS = [
  [/\+/g, '{+}'], [/\^/g, '{^}'], [/%/g, '{%}'], [/~/g, '{~}'],
  [/\(/g, '{(}'], [/\)/g, '{)}'], [/\[/g, '{[}'], [/\]/g, '{]}'],
  [/\{/g, '{{}'], [/\}/g, '{}}']
];

const escaparParaSendKeys = (texto) => ESCAPES_DO_SENDKEYS.reduce((atual, [padrao, troca]) => atual.replace(padrao, troca), texto);

const comandoDeTecla = (tecla, comEspera) => (comEspera
  ? `Add-Type -AssemblyName System.Windows.Forms; Start-Sleep -Seconds 8; [System.Windows.Forms.SendKeys]::SendWait('${tecla}')`
  : `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${tecla}')`);

const comandoDeTexto = (texto, comEnter) => (comEnter
  ? ['', '          Add-Type -AssemblyName System.Windows.Forms;',
    `          [System.Windows.Forms.SendKeys]::SendWait('${texto}');`,
    '          Start-Sleep -Seconds 5;',
    "          [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')",
    '        '].join('\n')
  : `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${texto}')`);

function rodarPowerShell(comando, limite, resultado) {
  return new Promise((resolve) => {
    exec(`powershell -Command "${comando}"`, { timeout: limite }, (error) => {
      resolve(error ? { error: error.message } : resultado);
    });
  });
}

async function pelaBibliotecaDoMac(chamada) {
  try { return await chamada(); } catch (e) { return { success: false, error: e.message }; }
}

async function pressionarTecla(evento, { key }) {
  if (process.platform === 'darwin') return pelaBibliotecaDoMac(() => macNative.pressKey(key));
  try {
    const teclaEmMinuscula = key.toLowerCase();
    const tecla = TECLAS_DO_SENDKEYS[teclaEmMinuscula] || key;
    const comEspera = teclaEmMinuscula === 'enter';
    return rodarPowerShell(comandoDeTecla(tecla, comEspera), 30000, { success: true, key: tecla, delayed: comEspera });
  } catch (e) { return { error: e.message }; }
}

async function digitarTexto(evento, { text, pressEnter }) {
  if (process.platform === 'darwin') return pelaBibliotecaDoMac(() => macNative.typeText(text, pressEnter));
  try {
    const comando = comandoDeTexto(escaparParaSendKeys(text), pressEnter);
    return rodarPowerShell(comando, 20000, { success: true, typed: text, enterPressed: pressEnter });
  } catch (e) { return { error: e.message }; }
}

function esperar(ms) {
  const inicio = Date.now();
  while (Date.now() - inicio < ms);
}

const teclaDeAtalho = () => (process.platform === 'darwin' ? 'command' : 'control');

const avisarFalhaDoProtocolo = (err) => {
  if (err) console.warn('[WhatsApp Robot] Could not open via protocol, trying direct exe...');
};

function carregarRobo() {
  try {
    const robo = require('@jitsi/robotjs');
    console.info(`[WhatsApp Robot] RobotJS loaded successfully`);
    return { robo };
  } catch (err) {
    console.error(`[WhatsApp Robot] RobotJS not available:`, err.message);
    return null;
  }
}

function anunciarInicioDoWhatsApp(nome, mensagem) {
  console.info(`\n========== WHATSAPP AUTOMATION START ==========`);
  console.info(`[WhatsApp Robot] Contact: ${nome}`);
  console.info(`[WhatsApp Robot] Message: ${mensagem}`);
  console.info(`[WhatsApp Robot] Time: ${new Date().toLocaleTimeString()}`);
  console.info(`[WhatsApp Robot] Method: RobotJS (Native Node.js)`);
}

function abrirWhatsAppDesktop() {
  console.info(`[WhatsApp Robot] Step 1: Opening WhatsApp Desktop...`);
  exec(process.platform === 'darwin' ? 'open -a WhatsApp' : 'start whatsapp:', avisarFalhaDoProtocolo);
  console.info(`[WhatsApp Robot] Waiting 4 seconds for WhatsApp to load...`);
  esperar(4000);
  console.info(`[WhatsApp Robot] Step 1 Complete`);
}

function abrirNovaConversa(robo) {
  console.info(`[WhatsApp Robot] Step 2: Pressing Ctrl+N to open new chat...`);
  robo.keyTap('n', teclaDeAtalho());
  esperar(1500);
  console.info(`[WhatsApp Robot] Step 2 Complete`);
}

function escolherContato(robo, nome) {
  console.info(`[WhatsApp Robot] Step 3: Typing contact name: ${nome}`);
  robo.typeString(nome);
  esperar(1500);
  console.info(`[WhatsApp Robot] Step 3 Complete`);

  console.info(`[WhatsApp Robot] Step 4: Pressing Enter to select contact...`);
  robo.keyTap('enter');
  esperar(1000);
  console.info(`[WhatsApp Robot] Step 4 Complete`);
}

function enviarMensagemDoWhatsApp(robo, mensagem) {
  console.info(`[WhatsApp Robot] Step 5: Typing message (${mensagem.length} characters)...`);
  robo.typeString(mensagem);
  esperar(800);
  console.info(`[WhatsApp Robot] Step 5 Complete`);

  console.info(`[WhatsApp Robot] Step 6: Pressing Enter to send message...`);
  robo.keyTap('enter');
  console.info(`[WhatsApp Robot] Step 6 Complete`);
}

function relatarFalhaCritica(error) {
  console.error(`\n========== CRITICAL ERROR ==========`);
  console.error(error);
  console.error(`========== ERROR END ==========\n`);
  return { success: false, error: error.message };
}

function recusarPedidoIncompleto(nome, mensagem) {
  console.error('[WhatsApp Robot] Missing name or message:', { name: nome, message: mensagem });
  return { success: false, error: 'Contact name and message are required' };
}

const lerPedidoDoWhatsApp = (args) => ({ nome: String(args?.name || ''), mensagem: String(args?.message || '') });

async function enviarWhatsAppPeloTeclado(evento, args) {
  try {
    const { nome, mensagem } = lerPedidoDoWhatsApp(args);
    if (!nome || !mensagem) return recusarPedidoIncompleto(nome, mensagem);

    anunciarInicioDoWhatsApp(nome, mensagem);
    const carregado = carregarRobo();
    if (!carregado) return { success: false, error: 'RobotJS module not installed. Run: npm install robotjs' };

    abrirWhatsAppDesktop();
    abrirNovaConversa(carregado.robo);
    escolherContato(carregado.robo, nome);
    enviarMensagemDoWhatsApp(carregado.robo, mensagem);

    console.info(`\n✅✅✅ WHATSAPP AUTOMATION SUCCESS ✅✅✅\n`);
    return {
      success: true,
      output: 'Message sent successfully using RobotJS',
      method: 'robotjs_native'
    };
  } catch (error) {
    return relatarFalhaCritica(error);
  }
}

function registrarTeclado() {
  ipcMain.handle('send-whatsapp-keyboard', enviarWhatsAppPeloTeclado);
  ipcMain.handle('keyboard-press', pressionarTecla);
  ipcMain.handle('keyboard-type', digitarTexto);
}

module.exports = { registrarTeclado };
