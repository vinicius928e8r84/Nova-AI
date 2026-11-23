'use strict';
const path = require('path');
const { descrever, definirAmbiente } = require('./antigravity-controller.palco');

const EXE_DO_PERFIL = path.posix.join('C:\\Users\\nova', 'AppData\\Local\\Programs\\Antigravity\\Antigravity.exe');
const EXE_LOCAL = path.posix.join('C:\\Users\\nova\\AppData\\Local', 'Programs\\Antigravity\\Antigravity.exe');
const EXE_DO_SISTEMA = 'C:\\Program Files\\Antigravity\\Antigravity.exe';
const ESTATISTICAS = 'PID:42|CPU:0|MEM:310|RESP:True|TITLE:main.js - Antigravity';
const RODANDO = { stdout: ' Antigravity 42 \n' };

async function anotarChamada(palco, nome, ...argumentos) {
  palco.anotar(`${nome} ${descrever(await palco.controlador[nome](...argumentos))}`);
}

function criarComScript(palco) {
  const controlador = palco.criar();
  palco.registro.length = 0;
  return controlador;
}

function criarNoMac(palco) {
  palco.usarPlataforma('darwin');
  return criarComScript(palco);
}

function anotarEstado(palco) {
  const { pendingPrompt, monitorInterval, scriptPath } = palco.controlador;
  palco.anotar(`estado ${descrever({ pendingPrompt, monitorando: Boolean(monitorInterval && monitorInterval.vivo), scriptPath })}`);
}

const cenas = {
  'construtor grava o script e loga': async palco => {
    palco.criar();
    anotarEstado(palco);
  },

  'construtor sem conseguir gravar o script': async palco => {
    palco.falhaAoGravar = new Error('somente leitura');
    palco.criar();
    anotarEstado(palco);
  },

  'log sem janela ou com janela destruida nao envia': async palco => {
    const controlador = criarComScript(palco);
    controlador.log('com janela');
    palco.janela.destruida = true;
    controlador.log('destruida');
    controlador.mainWindow = null;
    controlador.log('sem janela');
  },

  'colar no Windows: SUCCESS, ERROR, inesperado e vazio': async palco => {
    criarComScript(palco);
    palco.responder('colar', { stdout: ' SUCCESS:Prompt pasted \n' }, { stdout: 'ERROR:No window' }, { stdout: 'algo', stderr: 'aviso' }, { stdout: null, stderr: 'so stderr' }, {});
    for (const enviar of [true, false, undefined, true, true]) await anotarChamada(palco, 'runPowerShellAutomation', 'prompt "x"', enviar);
  },

  'colar no Windows regrava o script quando ele sumiu': async palco => {
    const controlador = criarComScript(palco);
    palco.arquivos.clear();
    palco.responder('colar', { stdout: 'SUCCESS' });
    await anotarChamada(palco, 'runPowerShellAutomation', 'a');
    controlador.scriptPath = null;
    await anotarChamada(palco, 'runPowerShellAutomation', 'b');
  },

  'ensureAntigravityRunning: ja rodando': async palco => {
    criarComScript(palco);
    palco.responder('rodando', RODANDO);
    await anotarChamada(palco, 'ensureAntigravityRunning');
  },

  'ensureAntigravityRunning: abre e acha a janela na terceira olhada': async palco => {
    criarComScript(palco);
    palco.arquivos.add(EXE_LOCAL);
    palco.responder('rodando', { stdout: '  \n' });
    palco.responder('estatisticas', { stdout: 'NOT_RUNNING' }, { stdout: 'PID:1|TITLE:' }, { stdout: ESTATISTICAS });
    await anotarChamada(palco, 'ensureAntigravityRunning');
  },

  'ensureAntigravityRunning: abre e nunca acha a janela': async palco => {
    criarComScript(palco);
    palco.arquivos.add(EXE_DO_SISTEMA);
    await anotarChamada(palco, 'ensureAntigravityRunning');
  },

  'ensureAntigravityRunning: nao consegue abrir': async palco => {
    criarComScript(palco);
    await anotarChamada(palco, 'ensureAntigravityRunning');
  },

  'launchAntigravity: cada caminho, nenhum e spawn que falha': async palco => {
    criarComScript(palco);
    for (const exe of [EXE_DO_SISTEMA, EXE_LOCAL, EXE_DO_PERFIL]) {
      palco.arquivos.add(exe);
      await anotarChamada(palco, 'launchAntigravity');
    }
    palco.falhaNoSpawn = new Error('EACCES');
    await anotarChamada(palco, 'launchAntigravity');
    palco.arquivos.clear();
    definirAmbiente('LOCALAPPDATA', undefined);
    await anotarChamada(palco, 'launchAntigravity');
  },

  'focusEditor no Windows rodando e sem rodar': async palco => {
    criarComScript(palco);
    palco.responder('rodando', RODANDO);
    palco.responder('colar', { stdout: 'SUCCESS:Focused' });
    await anotarChamada(palco, 'focusEditor');
    palco.responder('rodando', {});
    palco.responder('colar', { stdout: 'ERROR:x' });
    await anotarChamada(palco, 'focusEditor');
  },

  'getProcessStats no Windows le cada formato de saida': async palco => {
    criarComScript(palco);
    const saidas = ['NOT_RUNNING', '', null, 'sem pid', ESTATISTICAS, 'PID:7|RESP:False|MEM:abc|TITLE:a:b|c', 'lixo PID:|X', 'PID:9|resp:True|Title:T|:vazio|semdois'];
    palco.responder('estatisticas', ...saidas.map(stdout => ({ stdout })));
    for (let i = 0; i < saidas.length; i++) await anotarChamada(palco, 'getProcessStats');
  },

  'monitoramento envia status e para quando o processo some': async palco => {
    const controlador = criarComScript(palco);
    palco.responder('estatisticas', { stdout: ESTATISTICAS.replace('main.js', 'x'.repeat(50)) }, { stdout: 'NOT_RUNNING' });
    controlador.startMonitoring();
    await palco.rodarIntervalos();
    palco.janela.destruida = true;
    await palco.rodarIntervalos();
    palco.janela.destruida = false;
    await palco.rodarIntervalos();
    anotarEstado(palco);
  },

  'monitoramento desiste depois de 30 voltas e reinicia limpando o anterior': async palco => {
    const controlador = criarComScript(palco);
    palco.responder('estatisticas', { stdout: ESTATISTICAS });
    controlador.startMonitoring();
    controlador.startMonitoring();
    await palco.rodarIntervalos(31);
    anotarEstado(palco);
    controlador.stopMonitoring();
  },

  'monitoramento anota erro de getProcessStats': async palco => {
    const controlador = criarComScript(palco);
    controlador.getProcessStats = async () => { throw new Error('ps quebrou'); };
    controlador.startMonitoring();
    await palco.rodarIntervalos();
    controlador.stopMonitoring();
  },

  'restoreWindow com janela, com erro e destruida': async palco => {
    const controlador = criarComScript(palco);
    controlador.restoreWindow();
    palco.falhaNaJanela = new Error('nao deixa');
    controlador.restoreWindow();
    palco.janela.destruida = true;
    controlador.restoreWindow();
  },

  'preparePrompt no Windows: so focar sem conseguir abrir': async palco => {
    criarComScript(palco);
    await anotarChamada(palco, 'preparePrompt', '__JUST_FOCUS__');
    anotarEstado(palco);
  },

  'preparePrompt no Windows: so focar com e sem janela': async palco => {
    criarComScript(palco);
    palco.responder('rodando', RODANDO);
    palco.responder('focar', { stdout: ' SUCCESS ' }, { stdout: 'NOT_FOUND' });
    await anotarChamada(palco, 'preparePrompt', '__JUST_FOCUS__');
    await anotarChamada(palco, 'preparePrompt', '__JUST_FOCUS__');
    anotarEstado(palco);
  },

  'preparePrompt no Windows: sem conseguir abrir guarda o pedido': async palco => {
    criarComScript(palco);
    await anotarChamada(palco, 'preparePrompt', 'x'.repeat(70));
    anotarEstado(palco);
  },

  'preparePrompt no Windows: cola, monitora e confirma': async palco => {
    const controlador = criarComScript(palco);
    palco.responder('rodando', RODANDO);
    palco.responder('colar', { stdout: 'SUCCESS:Prompt pasted and Enter sent.' });
    await anotarChamada(palco, 'preparePrompt', 'crie um app');
    anotarEstado(palco);
    palco.anotar(`confirm ${await controlador.confirmAndExecute()}`);
    anotarEstado(palco);
  },

  'preparePrompt no Windows: colagem falha': async palco => {
    criarComScript(palco);
    palco.responder('rodando', RODANDO);
    palco.responder('colar', { stdout: 'ERROR:No Antigravity main window found' });
    await anotarChamada(palco, 'preparePrompt', 'crie');
    anotarEstado(palco);
  },

  'confirmAndExecute com foco pendente e sem monitor': async palco => {
    const controlador = criarComScript(palco);
    controlador.pendingPrompt = '__JUST_FOCUS__';
    palco.anotar(`confirm ${await controlador.confirmAndExecute()}`);
    anotarEstado(palco);
    controlador.pendingPrompt = 'outro';
    palco.anotar(`confirm ${await controlador.confirmAndExecute()}`);
    anotarEstado(palco);
  },

  'minimizar, maximizar e fechar no Windows': async palco => {
    const controlador = criarComScript(palco);
    palco.responder('rodando', RODANDO);
    palco.responder('colar', { stdout: 'SUCCESS' });
    await anotarChamada(palco, 'minimizeEditor');
    await anotarChamada(palco, 'maximizeEditor');
    controlador.startMonitoring();
    await anotarChamada(palco, 'closeEditor');
    anotarEstado(palco);
  },

  'Mac: colar abre, aperta cmd+l e digita': async palco => {
    criarNoMac(palco);
    await anotarChamada(palco, 'runPowerShellAutomation', 'oi mac', false);
    await anotarChamada(palco, 'runPowerShellAutomation', 'oi mac');
    palco.mac.pressKey = new Error('sem acessibilidade');
    await anotarChamada(palco, 'runPowerShellAutomation', 'oi mac', true);
    palco.mac.run = new Error('Unable to find application');
    await anotarChamada(palco, 'runPowerShellAutomation', 'oi mac', true);
  },

  'Mac: garantir, abrir, focar e maximizar': async palco => {
    criarNoMac(palco);
    for (const nome of ['ensureAntigravityRunning', 'launchAntigravity', 'focusEditor', 'maximizeEditor']) await anotarChamada(palco, nome);
    palco.mac.run = new Error('open falhou');
    for (const nome of ['ensureAntigravityRunning', 'focusEditor']) await anotarChamada(palco, nome);
  },

  'Mac: estatisticas pela paridade e erro vira null': async palco => {
    criarNoMac(palco);
    palco.statsMac = { pid: 3, title: 'T' };
    await anotarChamada(palco, 'getProcessStats');
    palco.statsMac = new Error('pgrep falhou');
    await anotarChamada(palco, 'getProcessStats');
  },

  'Mac: preparePrompt focar, colar com monitor e falhar': async palco => {
    criarNoMac(palco);
    palco.statsMac = null;
    await anotarChamada(palco, 'preparePrompt', '__JUST_FOCUS__');
    await anotarChamada(palco, 'preparePrompt', 'pedido mac');
    await palco.rodarIntervalos();
    palco.mac.typeText = new Error('digitacao falhou');
    await anotarChamada(palco, 'preparePrompt', 'pedido mac');
    anotarEstado(palco);
  },

  'Mac: minimizar e fechar com e sem erro': async palco => {
    criarNoMac(palco);
    await anotarChamada(palco, 'minimizeEditor');
    await anotarChamada(palco, 'closeEditor');
    palco.mac.apple = new Error('osascript falhou');
    await anotarChamada(palco, 'minimizeEditor');
    await anotarChamada(palco, 'closeEditor');
  },
};

module.exports = { cenas };
