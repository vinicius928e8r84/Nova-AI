'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { marcarCaminhos } = require('./caminhos-do-palco');

const ADB = process.execPath;
const PASTA_DOS_SERVICOS = path.resolve(__dirname, '..');
const PASTA_DO_ELECTRON = path.resolve(PASTA_DOS_SERVICOS, '..');
const PASTA_DO_APP = path.resolve(PASTA_DOS_SERVICOS, '..', '..');
const CWD_FALSO = path.join(os.tmpdir(), 'cwd-do-teste');
const RECURSOS_FALSOS = path.join(os.tmpdir(), 'recursos-do-teste');

const respostas = { comandos: [], responder: () => ({}) };

function responder(comando, callback) {
  const { erro = null, stdout = '', stderr = '' } = respostas.responder(comando) || {};
  callback(erro ? Object.assign(new Error(erro), { stderr }) : null, stdout, stderr);
}

const processosFalsos = {
  exec(comando, opcoes, callback) {
    const cb = typeof opcoes === 'function' ? opcoes : callback;
    const texto = comando.split(`"${ADB}"`).join('ADB');
    respostas.comandos.push(texto);
    responder(texto, cb);
  },
  execFile(arquivo, argumentos, opcoes, callback) {
    const texto = [arquivo === ADB ? 'ADB' : arquivo, ...argumentos].join(' ');
    respostas.comandos.push(texto);
    responder(texto, callback);
  },
  spawn() {
    return Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
  },
};

const macNativo = { achados: new Map(), tool: (nome) => macNativo.achados.get(nome) || null };
const ferramentasLocais = { achados: new Map(), localToolPath: (base, nome) => ferramentasLocais.achados.get(nome) || null };

const carregadorOriginal = Module._load;
function carregadorDoTeste(pedido, ...resto) {
  if (pedido === 'child_process') return processosFalsos;
  if (pedido === 'ws') return function WebSocket() {};
  if (pedido === 'axios') return { get: async () => { throw new Error('axios fora do teste'); } };
  if (pedido === './mac-native') return macNativo;
  if (pedido === './android-tools') return ferramentasLocais;
  return carregadorOriginal.call(this, pedido, ...resto);
}

process.env.NOVA_SMOKE_TEST = '1';
for (const nivel of ['log', 'info', 'warn', 'error']) console[nivel] = () => {};
const caminhoDoServico = path.resolve(__dirname, '../physicalMobileService.js');
Module._load = carregadorDoTeste;
for (const [chave] of Object.entries(require.cache)) {
  if (chave === caminhoDoServico) delete require.cache[chave];
}
const Servico = require(caminhoDoServico);

const pastasCriadas = [];
test.after(() => {
  Module._load = carregadorOriginal;
  for (const pasta of pastasCriadas) fs.rmSync(pasta, { recursive: true, force: true });
});

function novoServico() {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'celular-caminhos-'));
  pastasCriadas.push(pasta);
  const servico = new Servico(null, { getPath: () => pasta });
  servico.getIosDevices = async () => [];
  return servico;
}

function comAmbiente(plataforma, existentes, fn) {
  const guardado = {
    platform: Object.getOwnPropertyDescriptor(process, 'platform'),
    resourcesPath: Object.getOwnPropertyDescriptor(process, 'resourcesPath'),
    cwd: process.cwd,
    env: { ...process.env },
    existsSync: fs.existsSync,
  };
  const consultas = [];
  Object.defineProperty(process, 'platform', { value: plataforma, configurable: true });
  Object.defineProperty(process, 'resourcesPath', { value: RECURSOS_FALSOS, configurable: true, writable: true });
  process.cwd = () => CWD_FALSO;
  Object.assign(process.env, {
    LOCALAPPDATA: 'LOCAL', USERPROFILE: 'PERFIL', PROGRAMFILES: 'PROGRAMAS', 'PROGRAMFILES(X86)': 'PROGRAMAS86',
  });
  fs.existsSync = (caminho) => {
    consultas.push(caminho);
    return existentes(caminho);
  };
  const restaurar = () => {
    Object.defineProperty(process, 'platform', guardado.platform);
    if (guardado.resourcesPath) Object.defineProperty(process, 'resourcesPath', guardado.resourcesPath);
    else delete process.resourcesPath;
    process.cwd = guardado.cwd;
    for (const chave of ['LOCALAPPDATA', 'USERPROFILE', 'PROGRAMFILES', 'PROGRAMFILES(X86)']) {
      if (guardado.env[chave] === undefined) delete process.env[chave];
      else process.env[chave] = guardado.env[chave];
    }
    fs.existsSync = guardado.existsSync;
  };
  try {
    return { resultado: fn(), consultas };
  } finally {
    restaurar();
  }
}

function legivel(caminho, base) {
  const trocas = [[base, 'BASE'], [PASTA_DO_ELECTRON, 'ELECTRON'], [PASTA_DO_APP, 'APP'], [CWD_FALSO, 'CWD'], [RECURSOS_FALSOS, 'RECURSOS']];
  return marcarCaminhos(caminho, trocas).replace(/\\/g, '/');
}

const CANDIDATOS_DO_ADB = [
  'APP/resources/bin/adb.exe',
  'APP/resources/platform-tools/adb.exe',
  'CWD/resources/bin/adb.exe',
  'CWD/resources/platform-tools/adb.exe',
  'RECURSOS/bin/adb.exe',
  'RECURSOS/platform-tools/adb.exe',
  'BASE/platform-tools/adb.exe',
  'BASE/adb.exe',
  'ELECTRON/resources/bin/adb.exe',
  'ELECTRON/resources/platform-tools/adb.exe',
  'LOCAL/Android/Sdk/platform-tools/adb.exe',
  'PERFIL/AppData/Local/Android/Sdk/platform-tools/adb.exe',
  'PROGRAMAS/Android/platform-tools/adb.exe',
  'PROGRAMAS86/Android/platform-tools/adb.exe',
  'PERFIL/platform-tools/adb.exe',
  'C:/platform-tools/adb.exe',
  'C:/Android/platform-tools/adb.exe',
  'C:/Android/Sdk/platform-tools/adb.exe',
  'PROGRAMAS/BlueStacks_nxt/HD-Adb.exe',
  'PROGRAMAS/Nox/bin/nox_adb.exe',
  'PROGRAMAS/LDPlayer/LDPlayer9/adb.exe',
];

const CANDIDATOS_DO_SCRCPY = [
  'APP/resources/bin/scrcpy.exe',
  'APP/resources/scrcpy/scrcpy.exe',
  'CWD/resources/bin/scrcpy.exe',
  'CWD/resources/scrcpy/scrcpy.exe',
  'RECURSOS/bin/scrcpy.exe',
  'RECURSOS/scrcpy/scrcpy.exe',
  'BASE/scrcpy/scrcpy.exe',
  'BASE/scrcpy.exe',
  'ELECTRON/resources/bin/scrcpy.exe',
  'ELECTRON/resources/scrcpy/scrcpy.exe',
  'PROGRAMAS/scrcpy/scrcpy.exe',
  'LOCAL/Programs/scrcpy/scrcpy.exe',
  'PERFIL/scrcpy/scrcpy.exe',
  'C:/scrcpy/scrcpy.exe',
];

const FERRAMENTAS = [
  ['resolveAdbPath', '_adbPath', CANDIDATOS_DO_ADB, 'BASE/platform-tools/adb.exe', 'adb'],
  ['resolveScrcpyPath', '_scrcpyPath', CANDIDATOS_DO_SCRCPY, 'BASE/scrcpy/scrcpy.exe', 'scrcpy'],
];

for (const [metodo, memoria, candidatos, padrao] of FERRAMENTAS) {
  test(`${metodo} no Windows: sem nada no disco confere cada candidato na ordem e devolve o caminho padrão sem guardá-lo`, () => {
    const servico = novoServico();
    servico[memoria] = null;
    const { resultado, consultas } = comAmbiente('win32', () => false, () => servico[metodo]());
    assert.deepStrictEqual(consultas.map((c) => legivel(c, servico.baseDir)), candidatos);
    assert.strictEqual(legivel(resultado, servico.baseDir), padrao);
    assert.strictEqual(servico[memoria], null);
  });

  test(`${metodo} no Windows: guarda o primeiro candidato que existe e na vez seguinte confere só o guardado`, () => {
    const servico = novoServico();
    servico[memoria] = null;
    const terceiro = candidatos[2];
    const existe = (caminho) => legivel(caminho, servico.baseDir) === terceiro;
    const primeira = comAmbiente('win32', existe, () => servico[metodo]());
    assert.strictEqual(legivel(primeira.resultado, servico.baseDir), terceiro);
    assert.deepStrictEqual(primeira.consultas.map((c) => legivel(c, servico.baseDir)), candidatos.slice(0, 3));
    assert.strictEqual(servico[memoria], primeira.resultado);
    const segunda = comAmbiente('win32', () => true, () => servico[metodo]());
    assert.strictEqual(segunda.resultado, primeira.resultado);
    assert.deepStrictEqual(segunda.consultas, [primeira.resultado]);
  });

  test(`${metodo} no Windows: o caminho guardado que sumiu do disco manda procurar de novo`, () => {
    const servico = novoServico();
    servico[memoria] = path.join(os.tmpdir(), 'sumiu', 'ferramenta.exe');
    const ultimo = candidatos[candidatos.length - 1];
    const { resultado, consultas } = comAmbiente('win32', (caminho) => legivel(caminho, servico.baseDir) === ultimo, () => servico[metodo]());
    assert.strictEqual(legivel(resultado, servico.baseDir), ultimo);
    assert.strictEqual(consultas.length, candidatos.length + 1);
    assert.strictEqual(consultas[0], path.join(os.tmpdir(), 'sumiu', 'ferramenta.exe'));
  });

  test(`${metodo} sem variáveis de ambiente usa só o que sobra do caminho`, () => {
    const servico = novoServico();
    servico[memoria] = null;
    const tirar = ['LOCALAPPDATA', 'USERPROFILE', 'PROGRAMFILES', 'PROGRAMFILES(X86)'];
    const { consultas } = comAmbiente('win32', () => false, () => {
      for (const chave of tirar) delete process.env[chave];
      return servico[metodo]();
    });
    const lidas = consultas.map((c) => legivel(c, servico.baseDir));
    const esperadas = candidatos.map((c) => c.replace(/^(LOCAL|PERFIL|PROGRAMAS86|PROGRAMAS)\//, ''));
    assert.deepStrictEqual(lidas, esperadas);
  });
}

for (const [metodo, memoria, , , ferramenta] of FERRAMENTAS) {
  test(`${metodo} no Mac: ferramenta nativa, depois a baixada, depois a de dentro do pacote; ignora o caminho guardado e não guarda nada`, () => {
    const servico = novoServico();
    servico[memoria] = '/guardado';
    macNativo.achados.set(ferramenta, '/nativa');
    ferramentasLocais.achados.set(ferramenta, '/baixada');
    assert.strictEqual(comAmbiente('darwin', () => true, () => servico[metodo]()).resultado, '/nativa');
    macNativo.achados.clear();
    assert.strictEqual(comAmbiente('darwin', () => true, () => servico[metodo]()).resultado, '/baixada');
    ferramentasLocais.achados.clear();
    const { resultado, consultas } = comAmbiente('darwin', () => true, () => servico[metodo]());
    assert.strictEqual(resultado, path.join(RECURSOS_FALSOS, 'bin', ferramenta));
    assert.deepStrictEqual(consultas, []);
    assert.strictEqual(servico[memoria], '/guardado');
  });
}

test('os getters adbPath e scrcpyPath refazem a busca a cada leitura e os setters só trocam o guardado', () => {
  const servico = novoServico();
  servico._adbPath = null;
  const { resultado } = comAmbiente('win32', () => false, () => [servico.adbPath, servico.adbPath, servico.scrcpyPath]);
  assert.deepStrictEqual(resultado.map((c) => legivel(c, servico.baseDir)), ['BASE/platform-tools/adb.exe', 'BASE/platform-tools/adb.exe', 'BASE/scrcpy/scrcpy.exe']);
  servico.adbPath = '/trocado/adb';
  servico.scrcpyPath = '/trocado/scrcpy';
  assert.strictEqual(servico._adbPath, '/trocado/adb');
  assert.strictEqual(servico._scrcpyPath, '/trocado/scrcpy');
});

function servicoComAdb() {
  const servico = novoServico();
  Object.defineProperty(servico, 'adbPath', { value: ADB, writable: true });
  return servico;
}

test('getConnectedDevices: id só com IP é Wi-Fi, sem model usa o device, sem os dois usa o id, e a primeira linha sempre é cabeçalho', async () => {
  const servico = servicoComAdb();
  respostas.comandos = [];
  respostas.responder = () => ({
    stdout: [
      '192.0.2.20 device',
      '  \t  ',
      'AAA device device:lynx',
      'BBB offline model:Pixel_7_Pro',
      'CCC device model:X device:y',
      '* daemon not running',
      'DDD',
      '',
    ].join('\n'),
  });
  assert.deepStrictEqual(await servico.getConnectedDevices(), [
    { id: 'AAA', status: 'device', name: 'lynx', type: 'usb' },
    { id: 'BBB', status: 'offline', name: 'Pixel 7 Pro', type: 'usb' },
    { id: 'CCC', status: 'device', name: 'X', type: 'usb' },
  ]);
  respostas.responder = () => ({ stdout: 'cabecalho\n192.0.2.2 device\nEEE device\n' });
  assert.deepStrictEqual(await servico.getConnectedDevices(), [
    { id: '192.0.2.2', status: 'device', name: '192.0.2.2', type: 'wifi' },
    { id: 'EEE', status: 'device', name: 'EEE', type: 'usb' },
  ]);
});

test('getConnectedDevices soma os aparelhos do iPhone depois dos do adb, na ordem', async () => {
  const servico = servicoComAdb();
  servico.getIosDevices = async () => [{ id: 'ios-1' }, { id: 'ios-2' }];
  respostas.responder = () => ({ stdout: 'x\nAAA device\n' });
  assert.deepStrictEqual((await servico.getConnectedDevices()).map(({ id }) => id), ['AAA', 'ios-1', 'ios-2']);
});

test('autoPairUsbToWireless: sem inet no wlan0 usa o IP do dhcp; já conectado é sucesso; erro na resposta do connect é falha', async () => {
  const servico = servicoComAdb();
  const semTempo = global.setTimeout;
  global.setTimeout = (callback) => semTempo(callback, 0);
  try {
    respostas.comandos = [];
    respostas.responder = (comando) => {
      if (comando.includes('getprop')) return { stdout: '192.0.2.9\n' };
      if (comando.includes('connect')) return { stdout: 'already connected to 192.0.2.9:5555' };
      return { stdout: 'sem inet' };
    };
    assert.deepStrictEqual(await servico.autoPairUsbToWireless('R5'), {
      success: true, ip: '192.0.2.9', deviceId: '192.0.2.9:5555', message: 'Android conectado por Wi-Fi em 192.0.2.9:5555',
    });
    assert.deepStrictEqual(respostas.comandos, [
      'ADB -s R5 shell ip -f inet addr show wlan0',
      'ADB -s R5 shell getprop dhcp.wlan0.ipaddress',
      'ADB -s R5 tcpip 5555',
      'ADB connect 192.0.2.9:5555',
    ]);
    const respostasDoConnect = [
      ['connected to 192.0.2.9:5555 error', 'connected to 192.0.2.9:5555 error'],
      ['', 'Não foi possível conectar por Wi-Fi.'],
      ['no route to host', 'no route to host'],
    ];
    for (const [saida, erro] of respostasDoConnect) {
      respostas.responder = (comando) => (comando.includes('connect') ? { stdout: saida } : { stdout: 'inet 192.0.2.9/24' });
      assert.deepStrictEqual(await servico.autoPairUsbToWireless('R5'), { success: false, error: erro }, saida);
    }
    respostas.responder = () => ({ stdout: 'inet 192.0.2.256/24' });
    const alto = await servico.autoPairUsbToWireless('R5');
    assert.strictEqual(alto.success, false);
    assert.match(alto.error, /mesma rede Wi-Fi/);
  } finally {
    global.setTimeout = semTempo;
  }
});

test('autoPairUsbToWireless: texto que não é string pede o aparelho, e sem o adb avisa em português', async () => {
  const servico = servicoComAdb();
  const pedido = { success: false, error: 'Selecione um dispositivo Android conectado por USB.' };
  assert.deepStrictEqual(await servico.autoPairUsbToWireless(), pedido);
  assert.deepStrictEqual(await servico.autoPairUsbToWireless(42), pedido);
  assert.deepStrictEqual(await servico.autoPairUsbToWireless(''), pedido);
  const semAdb = novoServico();
  Object.defineProperty(semAdb, 'adbPath', { value: path.join(os.tmpdir(), 'sem-adb-nenhum'), writable: true });
  assert.deepStrictEqual(await semAdb.autoPairUsbToWireless('R5'), { success: false, error: 'ADB não encontrado.' });
});

test('autoPairUsbToWireless: aparelho que começa com ios- recusa antes de procurar o adb', async () => {
  const semAdb = novoServico();
  let lidas = 0;
  Object.defineProperty(semAdb, 'adbPath', { get() { lidas++; return ADB; } });
  const { platform, success } = await semAdb.autoPairUsbToWireless('ios-0001');
  assert.deepStrictEqual([platform, success, lidas], ['ios', false, 0]);
  await semAdb.autoPairUsbToWireless('  ');
  assert.strictEqual(lidas, 0);
  await semAdb.autoPairUsbToWireless('R5');
  assert.strictEqual(lidas, 1);
});

test('connectWifi e pairWirelessDevice: com erro e saída vazia usam a mensagem do erro padrão, e pair devolve a saída tirando os espaços', async () => {
  const servico = servicoComAdb();
  respostas.responder = () => ({ erro: 'x', stdout: '', stderr: 'timeout do adb' });
  assert.deepStrictEqual(await servico.connectWifi('192.0.2.4'), { success: false, error: 'timeout do adb' });
  assert.deepStrictEqual(await servico.pairWirelessDevice('192.0.2.4', '1', '2'), { success: false, error: 'timeout do adb' });
  respostas.responder = () => ({ stdout: '  pareado  \n' });
  assert.deepStrictEqual(await servico.pairWirelessDevice('192.0.2.4', '1', '2'), { success: true, message: 'pareado' });
  assert.deepStrictEqual(await servico.connectWifi('192.0.2.4'), { success: true, message: 'pareado' });
  await assert.rejects(servico.connectWifi(undefined), TypeError);
});
