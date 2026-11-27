'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { EventEmitter } = require('events');

const ADB = process.execPath;
const ESPERADO = path.join(__dirname, 'celular-fisico-adb.esperado.json');

const registrador = {
  comandos: [],
  responder: () => ({}),
  limpar(responder = () => ({})) {
    this.comandos = [];
    this.responder = responder;
  },
};

function normalizar(texto, base) {
  let saida = String(texto).split(`"${ADB}"`).join('ADB').split(ADB).join('ADB');
  if (base) saida = saida.split(base).join('BASE').replace(/BASE[\\/\w.]*/g, trecho => trecho.replace(/\\/g, '/'));
  return saida;
}

function responderCom(comando, callback) {
  const { erro = null, stdout = '', stderr = '' } = registrador.responder(comando) || {};
  callback(erro ? Object.assign(new Error(erro), { stderr }) : null, stdout, stderr);
}

const processosFalsos = {
  exec(comando, opcoes, callback) {
    const cb = typeof opcoes === 'function' ? opcoes : callback;
    const texto = normalizar(comando, registrador.base);
    registrador.comandos.push(texto);
    if (cb) responderCom(texto, cb);
  },
  execFile(arquivo, argumentos, opcoes, callback) {
    const texto = [normalizar(arquivo), ...argumentos].join(' ');
    registrador.comandos.push(texto);
    responderCom(texto, callback);
  },
  spawn(arquivo, argumentos) {
    registrador.comandos.push([normalizar(arquivo), ...argumentos].join(' '));
    return Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
  },
};

const carregadorOriginal = Module._load;
Module._load = function (pedido, ...resto) {
  if (pedido === 'child_process') return processosFalsos;
  if (pedido === 'ws') return function WebSocket() {};
  if (pedido === 'axios') return { get: async () => { throw new Error('axios fora do teste'); } };
  if (pedido === './mac-native') return { tool: () => null };
  return carregadorOriginal.call(this, pedido, ...resto);
};
process.env.NOVA_SMOKE_TEST = '1';
for (const nivel of ['log', 'warn', 'error']) console[nivel] = () => {};
const caminhoDoServico = path.resolve(__dirname, '../physicalMobileService.js');
delete require.cache[caminhoDoServico];
const Servico = require(caminhoDoServico);
Module._load = carregadorOriginal;

const pastasCriadas = [];
test.after(() => { for (const pasta of pastasCriadas) fs.rmSync(pasta, { recursive: true, force: true }); });

function novoServico({ comAdb = true } = {}) {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'celular-fisico-'));
  pastasCriadas.push(pasta);
  const servico = new Servico(null, { getPath: () => pasta });
  Object.defineProperty(servico, 'adbPath', { value: comAdb ? ADB : path.join(pasta, 'sem-adb'), writable: true });
  servico.getIosDevices = async () => [];
  registrador.base = servico.baseDir;
  return servico;
}

function comTempoInstantaneo(fn) {
  const original = global.setTimeout;
  global.setTimeout = (callback, ...resto) => original(callback, 0, ...resto.slice(1));
  return Promise.resolve().then(fn).finally(() => { global.setTimeout = original; });
}

function comSorteFixa(fn) {
  const aleatorioOriginal = Math.random;
  const agoraOriginal = Date.now;
  let semente = 12345;
  Math.random = () => {
    semente = (semente * 1103515245 + 12345) % 2147483648;
    return semente / 2147483648;
  };
  Date.now = () => 1700000000000;
  return Promise.resolve().then(fn).finally(() => {
    Math.random = aleatorioOriginal;
    Date.now = agoraOriginal;
  });
}

test('getConnectedDevices: lê "adb devices -l" e separa USB de Wi-Fi', async () => {
  const servico = novoServico();
  registrador.limpar(() => ({
    stdout: [
      'List of devices attached',
      '* daemon started successfully',
      'R5CT123ABC     device usb:1-1 product:e3qxxx model:SM_S928B device:e3q transport_id:1',
      '192.168.0.20:5555 device product:sunfish device:sunfish transport_id:2',
      'emulator-5554  unauthorized transport_id:3',
      'solto',
      '',
    ].join('\n'),
  }));
  const aparelhos = await servico.getConnectedDevices();
  assert.deepStrictEqual(registrador.comandos, ['ADB devices -l']);
  assert.deepStrictEqual(aparelhos, [
    { id: 'R5CT123ABC', status: 'device', name: 'SM S928B', type: 'usb' },
    { id: '192.168.0.20:5555', status: 'device', name: 'sunfish', type: 'wifi' },
    { id: 'emulator-5554', status: 'unauthorized', name: 'emulator-5554', type: 'usb' },
  ]);
});

test('getConnectedDevices: erro, saída vazia ou adb ausente viram lista vazia', async () => {
  const servico = novoServico();
  servico.getIosDevices = async () => [{ id: 'ios-1' }];
  registrador.limpar(() => ({ erro: 'adb caiu', stdout: 'List of devices attached\nX device' }));
  assert.deepStrictEqual(await servico.getConnectedDevices(), [{ id: 'ios-1' }]);
  registrador.limpar(() => ({ stdout: '' }));
  assert.deepStrictEqual(await servico.getConnectedDevices(), [{ id: 'ios-1' }]);
  const semAdb = novoServico({ comAdb: false });
  registrador.limpar();
  assert.deepStrictEqual(await semAdb.getConnectedDevices(), []);
  assert.deepStrictEqual(registrador.comandos, []);
});

test('restartAdbServer: kill-server, espera e start-server', async () => {
  const servico = novoServico();
  registrador.limpar();
  const certo = await comTempoInstantaneo(() => servico.restartAdbServer());
  assert.deepStrictEqual(registrador.comandos, ['ADB kill-server', 'ADB start-server']);
  assert.deepStrictEqual(certo, { success: true, message: 'Servidor ADB reiniciado com sucesso.' });
  registrador.limpar(comando => (comando.endsWith('start-server') ? { erro: 'porta ocupada' } : { erro: 'sem servidor' }));
  const errado = await comTempoInstantaneo(() => servico.restartAdbServer());
  assert.deepStrictEqual(errado, { success: false, error: 'porta ocupada' });
  registrador.limpar();
  assert.deepStrictEqual(await novoServico({ comAdb: false }).restartAdbServer(), { success: false, error: 'ADB not found.' });
  assert.deepStrictEqual(registrador.comandos, []);
});

test('pairWirelessDevice: "adb pair ip:porta código" e "Failed" na saída é falha', async () => {
  const servico = novoServico();
  registrador.limpar(() => ({ stdout: 'Successfully paired to 192.168.0.20:37000 [guid=adb-X]\n' }));
  const certo = await servico.pairWirelessDevice('192.168.0.20', '37000', '123456');
  assert.deepStrictEqual(registrador.comandos, ['ADB pair 192.168.0.20:37000 123456']);
  assert.deepStrictEqual(certo, { success: true, message: 'Successfully paired to 192.168.0.20:37000 [guid=adb-X]' });
  registrador.limpar(() => ({ stdout: 'Failed: Wrong password or connection was dropped.' }));
  assert.deepStrictEqual(await servico.pairWirelessDevice('192.168.0.20', '37000', '000000'),
    { success: false, error: 'Failed: Wrong password or connection was dropped.' });
  registrador.limpar(() => ({ erro: 'x', stderr: 'adb: unknown host' }));
  assert.deepStrictEqual(await servico.pairWirelessDevice('h', '1', '2'), { success: false, error: 'adb: unknown host' });
  registrador.limpar(() => ({ erro: 'x' }));
  assert.deepStrictEqual(await servico.pairWirelessDevice('h', '1', '2'),
    { success: false, error: 'Pairing failed. Check pairing code and port.' });
  assert.deepStrictEqual(await novoServico({ comAdb: false }).pairWirelessDevice('h', '1', '2'), { success: false, error: 'ADB not found.' });
});

test('connectWifi: põe :5555 quando falta porta e "failed" na saída é falha', async () => {
  const servico = novoServico();
  registrador.limpar(() => ({ stdout: 'connected to 192.168.0.20:5555\n' }));
  assert.deepStrictEqual(await servico.connectWifi('192.168.0.20'), { success: true, message: 'connected to 192.168.0.20:5555' });
  assert.deepStrictEqual(await servico.connectWifi('192.168.0.20:40001'), { success: true, message: 'connected to 192.168.0.20:5555' });
  assert.deepStrictEqual(registrador.comandos, ['ADB connect 192.168.0.20:5555', 'ADB connect 192.168.0.20:40001']);
  registrador.limpar(() => ({ stdout: 'failed to connect to 192.168.0.20:5555' }));
  assert.deepStrictEqual(await servico.connectWifi('192.168.0.20'), { success: false, error: 'failed to connect to 192.168.0.20:5555' });
  registrador.limpar(() => ({ erro: 'x' }));
  assert.deepStrictEqual(await servico.connectWifi('192.168.0.20'),
    { success: false, error: 'Connection timeout. Ensure Wireless Debugging is ON.' });
  assert.deepStrictEqual(await novoServico({ comAdb: false }).connectWifi('1.2.3.4'), { success: false, error: 'ADB tools missing.' });
});

test('disconnectDevice: recusa iPhone e devolve sucesso mesmo com erro do adb', async () => {
  const servico = novoServico();
  registrador.limpar(() => ({ erro: 'no such device' }));
  assert.deepStrictEqual(await servico.disconnectDevice('192.168.0.20:5555'), { success: true });
  assert.deepStrictEqual(registrador.comandos, ['ADB disconnect 192.168.0.20:5555']);
  registrador.limpar();
  assert.deepStrictEqual(await servico.disconnectDevice('ios-0001'),
    { success: false, error: 'iPhone é conexão USB — desconecte o cabo para desconectar.' });
  assert.deepStrictEqual(await novoServico({ comAdb: false }).disconnectDevice('X'), { success: false });
  assert.deepStrictEqual(registrador.comandos, []);
});

test('autoPairUsbToWireless: IP do wlan0, tcpip 5555 e connect', async () => {
  const servico = novoServico();
  registrador.limpar(comando => {
    if (comando.includes(' ip -f inet')) return { stdout: '3: wlan0\n    inet 192.168.0.31/24 brd 192.168.0.255 scope global wlan0\n' };
    if (comando.includes('connect')) return { stdout: 'connected to 192.168.0.31:5555' };
    return { stdout: '' };
  });
  const certo = await comTempoInstantaneo(() => servico.autoPairUsbToWireless('R5CT123ABC'));
  assert.deepStrictEqual(registrador.comandos, [
    'ADB -s R5CT123ABC shell ip -f inet addr show wlan0',
    'ADB -s R5CT123ABC tcpip 5555',
    'ADB connect 192.168.0.31:5555',
  ]);
  assert.deepStrictEqual(certo, { success: true, ip: '192.168.0.31', deviceId: '192.168.0.31:5555', message: 'Android conectado por Wi-Fi em 192.168.0.31:5555' });

  registrador.limpar(comando => (comando.includes('getprop') ? { stdout: '192.168.0.300\n' } : { stdout: 'sem inet' }));
  const ipRuim = await servico.autoPairUsbToWireless('R5CT123ABC');
  assert.deepStrictEqual(registrador.comandos, [
    'ADB -s R5CT123ABC shell ip -f inet addr show wlan0',
    'ADB -s R5CT123ABC shell getprop dhcp.wlan0.ipaddress',
  ]);
  assert.strictEqual(ipRuim.success, false);
  assert.match(ipRuim.error, /mesma rede Wi-Fi/);

  registrador.limpar(comando => {
    if (comando.includes(' ip -f inet')) return { stdout: 'inet 10.0.0.5/24' };
    if (comando.includes('connect')) return { stdout: 'failed to connect to 10.0.0.5:5555' };
    return {};
  });
  const semConexao = await comTempoInstantaneo(() => servico.autoPairUsbToWireless('R5CT123ABC'));
  assert.deepStrictEqual(semConexao, { success: false, error: 'failed to connect to 10.0.0.5:5555' });

  registrador.limpar(() => ({ erro: 'x', stderr: 'device offline' }));
  assert.deepStrictEqual(await servico.autoPairUsbToWireless('R5CT123ABC'),
    { success: false, error: 'Não foi possível ativar a conexão Wi-Fi: device offline' });

  registrador.limpar();
  assert.strictEqual((await servico.autoPairUsbToWireless('ios-0001')).platform, 'ios');
  assert.deepStrictEqual(await servico.autoPairUsbToWireless('  '), { success: false, error: 'Selecione um dispositivo Android conectado por USB.' });
  assert.deepStrictEqual(registrador.comandos, []);
});

function comRedeFalsa(interfaces, abertos, fn) {
  const interfacesOriginal = os.networkInterfaces;
  const socketOriginal = net.Socket;
  const tentativas = [];
  class SocketFalso extends EventEmitter {
    setTimeout(ms) { this.limite = ms; }
    destroy() { this.destruido = true; }
    connect(porta, ip) {
      tentativas.push(`${ip}:${porta}`);
      process.nextTick(() => this.emit(abertos.includes(ip) ? 'connect' : (ip.endsWith('.9') ? 'timeout' : 'error'), new Error('recusado')));
    }
  }
  os.networkInterfaces = () => interfaces;
  net.Socket = SocketFalso;
  return Promise.resolve().then(fn).then(resultado => ({ resultado, tentativas })).finally(() => {
    os.networkInterfaces = interfacesOriginal;
    net.Socket = socketOriginal;
  });
}

test('scanWifiDevices: mdns, varredura da primeira sub-rede na porta 5555 e connect em cada achado', async () => {
  const servico = novoServico();
  registrador.limpar(comando => {
    if (comando.endsWith('mdns services')) {
      return { stdout: 'List of discovered mdns services\nadb-X\t_adb-tls-connect._tcp\t192.168.7.40:41235\nadb-Y\t_adb._tcp\t192.168.7.20:5555\nadb-X\t_adb-tls-connect._tcp\t192.168.7.40:41235\n' };
    }
    if (comando.includes('connect 192.168.7.5:5555')) return { stdout: 'failed to connect to 192.168.7.5:5555' };
    if (comando.includes('connect 192.168.7.40')) return { erro: 'x', stdout: '' };
    if (comando.includes('devices -l')) return { stdout: 'List of devices attached\n192.168.7.20:5555 device model:Pixel_8\n' };
    return { stdout: 'connected' };
  });
  const interfaces = {
    lo: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
    en0: [{ family: 'IPv6', internal: false, address: 'fe80::1' }, { family: 'IPv4', internal: false, address: '192.168.7.33' }],
    en1: [{ family: 'IPv4', internal: false, address: '10.1.2.3' }],
  };
  const { resultado, tentativas } = await comRedeFalsa(interfaces, ['192.168.7.5', '192.168.7.20', '192.168.7.200'], () => servico.scanWifiDevices());
  assert.strictEqual(tentativas.length, 254);
  assert.strictEqual(tentativas[0], '192.168.7.1:5555');
  assert.strictEqual(tentativas[253], '192.168.7.254:5555');
  assert.ok(!tentativas.some(alvo => alvo.startsWith('10.')));
  assert.deepStrictEqual(registrador.comandos, [
    'ADB mdns services',
    'ADB connect 192.168.7.40:41235',
    'ADB connect 192.168.7.20:5555',
    'ADB connect 192.168.7.5:5555',
    'ADB connect 192.168.7.200:5555',
    'ADB devices -l',
  ]);
  assert.deepStrictEqual(resultado, {
    success: true,
    discoveredIps: ['192.168.7.40:41235', '192.168.7.20:5555', '192.168.7.5:5555', '192.168.7.200:5555'],
    connectedCount: 2,
    devices: [{ id: '192.168.7.20:5555', status: 'device', name: 'Pixel 8', type: 'wifi' }],
  });
});

test('scanWifiDevices: sem interface só usa o mdns, com uma só varre a dela, e sem adb não roda nada', async () => {
  const servico = novoServico();
  registrador.limpar(comando => (comando.endsWith('mdns services') ? { erro: 'mdns desligado' } : { stdout: '' }));
  const { resultado, tentativas } = await comRedeFalsa({ lo: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }] }, [], () => servico.scanWifiDevices());
  assert.deepStrictEqual(tentativas, []);
  assert.deepStrictEqual(registrador.comandos, ['ADB mdns services', 'ADB devices -l']);
  assert.deepStrictEqual(resultado, { success: true, discoveredIps: [], connectedCount: 0, devices: [] });
  registrador.limpar(() => ({ stdout: '' }));
  const umaInterface = await comRedeFalsa({ wlan0: [{ family: 'IPv4', internal: false, address: '10.0.5.7' }] }, ['10.0.5.9'], () => servico.scanWifiDevices());
  assert.strictEqual(umaInterface.tentativas.length, 254);
  assert.strictEqual(umaInterface.tentativas[0], '10.0.5.1:5555');
  assert.deepStrictEqual(umaInterface.resultado.discoveredIps, ['10.0.5.9:5555']);
  assert.deepStrictEqual(registrador.comandos, ['ADB mdns services', 'ADB connect 10.0.5.9:5555', 'ADB devices -l']);
  registrador.limpar();
  assert.deepStrictEqual(await novoServico({ comAdb: false }).scanWifiDevices(), { success: false, error: 'ADB not found.' });
  assert.deepStrictEqual(registrador.comandos, []);
});

test('toggleSetting: svc com su, cai para sem su no erro e recusa o desconhecido', async () => {
  const servico = novoServico();
  registrador.limpar();
  assert.deepStrictEqual(await servico.toggleSetting('R5', 'wifi', true), { success: true });
  assert.deepStrictEqual(await servico.toggleSetting('R5', 'bluetooth', false), { success: true });
  assert.deepStrictEqual(registrador.comandos, ['ADB -s R5 shell su -c "svc wifi enable"', 'ADB -s R5 shell su -c "svc bluetooth disable"']);
  registrador.limpar(comando => (comando.includes('su -c') ? { erro: 'su: not found' } : {}));
  assert.deepStrictEqual(await servico.toggleSetting('R5', 'wifi', false), { success: true });
  assert.deepStrictEqual(registrador.comandos, ['ADB -s R5 shell su -c "svc wifi disable"', 'ADB -s R5 shell svc wifi disable']);
  registrador.limpar(() => ({ erro: 'x', stderr: 'permission denied' }));
  assert.deepStrictEqual(await servico.toggleSetting('R5', 'bluetooth', true), { success: false, error: 'permission denied' });
  registrador.limpar();
  assert.deepStrictEqual(await servico.toggleSetting('R5', 'nfc', true), { success: false, error: 'Unsupported setting.' });
  assert.deepStrictEqual(await novoServico({ comAdb: false }).toggleSetting('R5', 'wifi', true), { success: false, error: 'ADB missing.' });
  assert.deepStrictEqual(registrador.comandos, []);
});

test('controlApp: monkey para abrir, su para parar e limpar, e só parar e limpar têm plano B', async () => {
  const servico = novoServico();
  registrador.limpar();
  for (const acao of ['start', 'stop', 'clear']) assert.deepStrictEqual(await servico.controlApp('R5', 'com.app', acao), { success: true });
  assert.deepStrictEqual(registrador.comandos, [
    'ADB -s R5 shell monkey -p com.app -c android.intent.category.LAUNCHER 1',
    'ADB -s R5 shell su -c "am force-stop com.app"',
    'ADB -s R5 shell su -c "pm clear com.app"',
  ]);
  registrador.limpar(comando => (comando.includes('su -c') || comando.includes('monkey') ? { erro: 'falhou' } : {}));
  assert.deepStrictEqual(await servico.controlApp('R5', 'com.app', 'start'), { success: false });
  assert.deepStrictEqual(await servico.controlApp('R5', 'com.app', 'clear'), { success: true });
  assert.deepStrictEqual(registrador.comandos, [
    'ADB -s R5 shell monkey -p com.app -c android.intent.category.LAUNCHER 1',
    'ADB -s R5 shell su -c "pm clear com.app"',
    'ADB -s R5 shell am force-stop com.app',
  ]);
  registrador.limpar();
  assert.deepStrictEqual(await servico.controlApp('R5', 'com.app', 'outra'), { success: true });
  assert.deepStrictEqual(registrador.comandos, ['ADB -s R5 ']);
});

test('adbRootExec e adbPush: su primeiro, shell direto no erro', async () => {
  const servico = novoServico();
  registrador.limpar(() => ({ stdout: '14\n' }));
  assert.deepStrictEqual(await servico.adbRootExec('R5', 'getprop ro.build.version.release'), { success: true, output: '14\n' });
  registrador.limpar(comando => (comando.includes('su -c') ? { erro: 'su' } : { stdout: 'saida' }));
  assert.deepStrictEqual(await servico.adbRootExec('R5', 'id'), { success: true, output: 'saida' });
  registrador.limpar(() => ({ erro: 'offline' }));
  assert.deepStrictEqual(await servico.adbRootExec('R5', 'id'), { success: false, output: '' });
  assert.deepStrictEqual(registrador.comandos, ['ADB -s R5 shell su -c "id"', 'ADB -s R5 shell id']);
  registrador.limpar(() => ({ erro: 'offline' }));
  assert.deepStrictEqual(await servico.adbPush('R5', '/tmp/a b', '/data/local/tmp/a'), { success: false });
  assert.deepStrictEqual(registrador.comandos, ['ADB -s R5 push "/tmp/a b" /data/local/tmp/a']);
});

test('banco do spoofer: marcas e modelos de spooferDatabase.json', () => {
  const servico = novoServico();
  const { success, brands } = servico.getSpooferModels();
  assert.strictEqual(success, true);
  assert.deepStrictEqual(Object.keys(brands), ['Samsung', 'Google', 'OnePlus', 'Xiaomi', 'Vivo', 'Realme', 'Infinix', 'OPPO', 'Motorola']);
  assert.deepStrictEqual(Object.values(brands).map(modelos => modelos.length), [14, 11, 5, 6, 4, 4, 4, 3, 2]);
  assert.deepStrictEqual(brands.Samsung[0], { model: 'SM-S928B', name: 'Galaxy S24 Ultra' });
});

function luhnValido(numero) {
  const soma = [...numero].reverse().reduce((total, digito, posicao) => {
    let valor = Number(digito);
    if (posicao % 2 === 1) {
      valor *= 2;
      if (valor > 9) valor -= 9;
    }
    return total + valor;
  }, 0);
  return soma % 10 === 0;
}

test('geradores do spoofer: IMEI sai com 15 dígitos e Luhn certo, com prefixo de 14, TAC de 8 ou sem prefixo', () => {
  const servico = novoServico();
  assert.strictEqual(servico.generateIMEI('35265210123456'), '352652101234567');
  assert.strictEqual(servico.generateIMEI('49015420323751'), '490154203237518');
  for (let vez = 0; vez < 50; vez++) {
    const comTac = servico.generateIMEI('35265210');
    assert.match(comTac, /^35265210\d{7}$/);
    assert.ok(luhnValido(comTac), comTac);
    const semPrefixo = servico.generateIMEI();
    assert.match(semPrefixo, /^35\d{13}$/);
    assert.ok(luhnValido(semPrefixo), semPrefixo);
  }
  assert.match(servico.generateMAC(), /^02(:[0-9a-f]{2}){5}$/);
  assert.match(servico.generateSerial('R5CT'), /^R5CT[0-9A-Z]{1,8}$/);
  assert.match(servico.generateSerial(), /^RND1/);
  assert.match(servico.generateAndroidId(), /^[0-9a-f]{16}$/);
  assert.match(servico.generateGAID(), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});

test('applySpoofProfile: marca ou modelo desconhecido não roda adb', async () => {
  const servico = novoServico();
  registrador.limpar();
  assert.deepStrictEqual(await servico.applySpoofProfile('R5', 'Nokia', 'X'), { success: false, error: 'Brand "Nokia" not found.' });
  assert.deepStrictEqual(await servico.applySpoofProfile('R5', 'samsung', 'SM-X'), { success: false, error: 'Model "SM-X" not found.' });
  assert.deepStrictEqual(registrador.comandos, []);
  assert.deepStrictEqual(await servico.applySpoofProfile('R5', null, 'X'), { success: false, error: "Cannot read properties of null (reading 'toLowerCase')" });
});

function lerArquivosDoModulo(servico) {
  const pasta = path.join(servico.baseDir, 'nova_magisk_module');
  const arquivos = {};
  for (const nome of ['module.prop', 'system.prop', 'service.sh']) arquivos[nome] = fs.readFileSync(path.join(pasta, nome), 'utf8');
  arquivos['nova_spoof.json'] = JSON.parse(fs.readFileSync(path.join(servico.baseDir, 'nova_spoof.json'), 'utf8'));
  return arquivos;
}

async function aplicarComSorteFixa(servico, responder, ...argumentos) {
  registrador.limpar(responder);
  const resultado = await comSorteFixa(() => comTempoInstantaneo(() => servico.applySpoofProfile(...argumentos)));
  return { resultado, comandos: registrador.comandos };
}

const respostaDoAparelho = zigotoRodando => comando => {
  if (comando.includes('getprop ro.build.version.release')) return { stdout: '13\n' };
  if (comando.includes('getprop ro.build.version.sdk')) return { stdout: '33\n' };
  if (comando.includes('getprop init.svc.zygote')) return { stdout: zigotoRodando(comando) ? 'running\n' : 'restarting\n' };
  return { stdout: '' };
};

test('applySpoofProfile: sequência inteira de comandos adb, arquivos do módulo Magisk e resposta', async () => {
  const servico = novoServico();
  let checagens = 0;
  const { resultado, comandos } = await aplicarComSorteFixa(servico, respostaDoAparelho(() => ++checagens >= 2), 'R5', 'SAMSUNG', 'SM-S928B');
  const obtido = { comandos, arquivos: lerArquivosDoModulo(servico), resultado };
  if (process.env.ATUALIZAR_ESPERADO === '1') fs.writeFileSync(ESPERADO, `${JSON.stringify(obtido, null, 2)}\n`);
  const esperado = JSON.parse(fs.readFileSync(ESPERADO, 'utf8'));
  assert.deepStrictEqual(obtido.resultado, esperado.resultado);
  assert.deepStrictEqual(obtido.arquivos, esperado.arquivos);
  assert.deepStrictEqual(obtido.comandos, esperado.comandos);
});

test('applySpoofProfile: o que a sequência garante, lido direto', async () => {
  const servico = novoServico();
  let checagens = 0;
  const { resultado, comandos } = await aplicarComSorteFixa(servico, respostaDoAparelho(() => ++checagens >= 2), 'R5', 'SAMSUNG', 'SM-S928B');
  assert.strictEqual(resultado.success, true);
  assert.match(resultado.applied.imei, /^\d{15}$/);
  assert.ok(luhnValido(resultado.applied.imei));
  assert.ok(['35265210', '35386910', '35617210', '35913410', '35265211'].includes(resultado.applied.imei.slice(0, 8)));
  assert.deepStrictEqual([resultado.applied.android_version, resultado.applied.security_patch], ['13', '2021-05-05']);
  assert.strictEqual(resultado.applied.model, 'Galaxy S24 Ultra');
  assert.deepStrictEqual(comandos.slice(0, 5), [
    'ADB -s R5 shell su -c "getprop ro.build.version.release"',
    'ADB -s R5 shell su -c "getprop ro.build.version.sdk"',
    'ADB -s R5 shell su -c "getprop ro.build.version.security_patch"',
    'ADB -s R5 shell su -c "getprop ro.build.version.incremental"',
    'ADB -s R5 shell su -c "getprop ro.build.id"',
  ]);
  assert.strictEqual(comandos[5], 'ADB -s R5 shell su -c "resetprop "ro.product.model" "SM-S928B" 2>/dev/null; true"');
  assert.strictEqual(comandos.filter(c => c.includes('resetprop "')).length, 51 + 10);
  assert.strictEqual(comandos.filter(c => c.includes('resetprop -p')).length, 10);
  assert.deepStrictEqual(comandos.filter(c => c.includes(' push ')), [
    'ADB -s R5 push "BASE/nova_magisk_module/module.prop" /data/local/tmp/nova_magisk_module/module.prop',
    'ADB -s R5 push "BASE/nova_magisk_module/system.prop" /data/local/tmp/nova_magisk_module/system.prop',
    'ADB -s R5 push "BASE/nova_magisk_module/service.sh" /data/local/tmp/nova_magisk_module/service.sh',
    'ADB -s R5 push "BASE/nova_spoof.json" /data/local/tmp/nova_spoof.json',
  ]);
  assert.strictEqual(comandos.filter(c => c.includes('getprop init.svc.zygote')).length, 2);
  assert.ok(comandos.indexOf('ADB -s R5 shell su -c "setprop ctl.restart zygote 2>/dev/null; true"') < comandos.findIndex(c => c.includes('init.svc.zygote')));
  assert.match(comandos[comandos.length - 1], /^ADB -s R5 shell su -c "log -t NOVA_SPOOF -p i "NOVA SPOOF ✓ \| Galaxy S24 Ultra \| IMEI: 35\d{13}" 2>\/dev\/null; true"$/);
  const arquivos = lerArquivosDoModulo(servico);
  assert.match(arquivos['system.prop'], /^ro\.product\.model=SM-S928B\n/);
  assert.strictEqual(arquivos['system.prop'].trimEnd().split('\n').length, 51 + 22);
  assert.match(arquivos['system.prop'], /\ngsm\.sim\.operator\.alpha=T-Mobile US\n/);
  assert.ok(!comandos.some(c => c.includes('gsm.sim.operator.alpha')));
  assert.match(arquivos['system.prop'], /\nro\.build\.version\.release=13\n/);
  assert.match(arquivos['module.prop'], /^id=nova_spoof\n/);
  assert.strictEqual(arquivos['nova_spoof.json'].sim_operator, 'T-Mobile US');
  assert.strictEqual(arquivos['nova_spoof.json'].imei, resultado.applied.imei);
});

test('applySpoofProfile: zigoto que não volta consulta 20 vezes e ainda devolve sucesso', async () => {
  const servico = novoServico();
  const { resultado, comandos } = await aplicarComSorteFixa(servico, respostaDoAparelho(() => false), 'R5', 'Google', servico.getSpooferDatabase().brands.Google[0].model);
  assert.strictEqual(resultado.success, true);
  assert.strictEqual(comandos.filter(c => c.includes('getprop init.svc.zygote')).length, 20);
  assert.deepStrictEqual([resultado.applied.android_version, resultado.applied.security_patch], ['13', '2021-05-05']);
  assert.ok(['35396210', '35396211', '35396212', '35396213', '35396214'].includes(resultado.applied.imei.slice(0, 8)));
  assert.match(resultado.applied.imei, /^\d{15}$/);
  assert.ok(luhnValido(resultado.applied.imei));
});

test('applySpoofProfile: IMEI escolhido e aparelho sem resposta caem nos padrões do Android 11', async () => {
  const servico = novoServico();
  const { resultado, comandos } = await aplicarComSorteFixa(servico, () => ({ erro: 'offline' }), 'R5', 'Samsung', 'SM-S928B', '490154203237518');
  assert.strictEqual(resultado.success, true);
  assert.strictEqual(resultado.applied.imei, '490154203237518');
  assert.deepStrictEqual([resultado.applied.android_version, resultado.applied.security_patch], ['11', '2021-05-05']);
  assert.ok(comandos.includes('ADB -s R5 shell resetprop "ro.build.id" "RQ2A.210505.003" 2>/dev/null; true'));
  assert.strictEqual(comandos.filter(c => c.includes('getprop init.svc.zygote')).length, 40);
});

async function comRecursosDoPacote(arquivosDoFrida, fn) {
  const recursos = fs.mkdtempSync(path.join(os.tmpdir(), 'celular-fisico-recursos-'));
  pastasCriadas.push(recursos);
  fs.mkdirSync(path.join(recursos, 'frida'));
  for (const nome of arquivosDoFrida) fs.writeFileSync(path.join(recursos, 'frida', nome), '');
  const resourcesPathOriginal = process.resourcesPath;
  process.resourcesPath = recursos;
  Module._load = function (pedido, ...resto) {
    if (pedido === 'child_process') return processosFalsos;
    return carregadorOriginal.call(this, pedido, ...resto);
  };
  try {
    return await fn(recursos);
  } finally {
    Module._load = carregadorOriginal;
    process.resourcesPath = resourcesPathOriginal;
  }
}

test('fridaInject: no app empacotado lê o script de process.resourcesPath e inicia o frida sem erro', async () => {
  const servico = novoServico();
  servico.app.isPackaged = true;
  registrador.limpar();
  await comRecursosDoPacote(['nova_camera_inject.js'], async recursos => {
    const resultado = await comTempoInstantaneo(() => servico.fridaInject('R5', 'tiktok'));
    assert.deepStrictEqual(resultado, {
      success: true,
      message: '⚡ Frida injected into tiktok (com.zhiliaoapp.musically). Camera replaced!',
      package: 'com.zhiliaoapp.musically',
    });
    const script = path.join(recursos, 'frida', 'nova_camera_inject.js');
    assert.deepStrictEqual(registrador.comandos.slice(-2), [
      'ADB -s R5 forward tcp:27042 tcp:27042',
      `frida -U -f com.zhiliaoapp.musically -l ${script} --runtime=v8`,
    ]);
  });
});

test('fridaInject: com o frida-server no pacote empurra para o aparelho; sem o script devolve o erro dos recursos', async () => {
  const servico = novoServico();
  servico.app.isPackaged = true;
  registrador.limpar();
  await comRecursosDoPacote(['nova_camera_inject.js', 'frida-server'], async recursos => {
    const resultado = await comTempoInstantaneo(() => servico.fridaInject('R5', 'com.exemplo.app'));
    assert.strictEqual(resultado.success, true);
    assert.strictEqual(resultado.package, 'com.exemplo.app');
    assert.strictEqual(registrador.comandos[0], `ADB -s R5 push "${path.join(recursos, 'frida', 'frida-server')}" /data/local/tmp/frida-server`);
  });
  registrador.limpar();
  await comRecursosDoPacote([], async () => {
    assert.deepStrictEqual(await servico.fridaInject('R5', 'tiktok'), { success: false, error: 'Frida script not found. Resources missing.' });
    assert.deepStrictEqual(registrador.comandos, []);
  });
});
