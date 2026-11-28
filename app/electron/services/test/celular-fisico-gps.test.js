'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { palco, SUBSTITUTOS, novoServico, limparOPalco } = require('./celular-fisico-iphone.palco');

test.after(limparOPalco);

const UDID = '00008120-ABCD';
const ID_DO_IPHONE = `ios-${UDID}`;
const ID_DO_ANDROID = 'R58M123ABC';
const IDEVICESETLOCATION = '/ferramentas/idevicesetlocation';
const PYMOBILEDEVICE3 = '/ferramentas/pymobiledevice3';
const SEM_IMAGEM = 'O iPhone precisa da imagem de desenvolvedor montada. Instale pymobiledevice3 (pip install pymobiledevice3) e tente de novo.';

const geo = { chamadas: [], byIp: null, throughProxy: null };
SUBSTITUTOS['./geo-proxy'] = {
  byIp: async (ip) => { geo.chamadas.push(['byIp', ip]); return geo.byIp(ip); },
  throughProxy: async (proxy) => { geo.chamadas.push(['throughProxy', proxy]); return geo.throughProxy(proxy); },
};
const ferramentas = { gps: { idevicesetlocation: IDEVICESETLOCATION, pymobiledevice3: PYMOBILEDEVICE3 }, consultadas: [] };
SUBSTITUTOS['./tool-paths'].gpsTool = (nome) => { ferramentas.consultadas.push(nome); return ferramentas.gps[nome]; };

const LOCALIZACAO = { ip: '203.0.113.7', city: 'Recife', region: 'Pernambuco', country: 'Brazil', countryCode: 'BR', lat: -8.05, lon: -34.9, timezone: 'America/Recife', isp: 'Provedor Teste' };

function servicoDoIphone({ fusos = ['America/Sao_Paulo'], proxyCheck } = {}) {
  geo.chamadas = [];
  ferramentas.consultadas = [];
  ferramentas.gps = { idevicesetlocation: IDEVICESETLOCATION, pymobiledevice3: PYMOBILEDEVICE3 };
  geo.byIp = async () => LOCALIZACAO;
  geo.throughProxy = async () => LOCALIZACAO;
  const servico = novoServico();
  const leituras = [...fusos];
  servico.fusosLidos = 0;
  servico.iosDeviceTimeZone = async () => {
    servico.fusosLidos++;
    return leituras.length > 1 ? leituras.shift() : leituras[0];
  };
  if (proxyCheck) servico.iosProxyCheck = proxyCheck;
  return servico;
}

const aoExecutar = (resposta) => palco.reiniciar(resposta);
const execucoes = () => palco.chamadas.filter((chamada) => chamada.tipo === 'execFile');

async function esperarComRelogioFalso(t, promessa) {
  let terminou = false;
  const resultado = promessa.finally(() => { terminou = true; });
  const passos = [];
  for (;;) {
    await new Promise((resolver) => setImmediate(resolver));
    if (terminou) break;
    t.mock.timers.tick(500);
    passos.push(500);
  }
  return { resposta: await resultado, passos: passos.length };
}

test('geoFromProxy: o iPhone com IP de saida consulta esse IP e marca via aparelho', async () => {
  const servico = servicoDoIphone({ proxyCheck: async (id) => ({ success: true, ip: ` 203.0.113.7 `, id }) });
  assert.deepStrictEqual(await servico.geoFromProxy(ID_DO_IPHONE, 'socks5://x:1'), { success: true, via: 'aparelho', ...LOCALIZACAO });
  assert.deepStrictEqual(geo.chamadas, [['byIp', '203.0.113.7']]);
});

test('geoFromProxy: sem IP de saida usa a proxy salva (sem os espacos), e o Android nem pergunta ao aparelho', async () => {
  const consultas = [];
  const proxyCheck = async (id) => { consultas.push(id); return { success: false }; };
  const servico = servicoDoIphone({ proxyCheck });
  assert.deepStrictEqual(await servico.geoFromProxy(ID_DO_IPHONE, '  socks5://x:1  '), { success: true, via: 'proxy', ...LOCALIZACAO });
  assert.deepStrictEqual(await servico.geoFromProxy(ID_DO_ANDROID, 'socks5://y:2'), { success: true, via: 'proxy', ...LOCALIZACAO });
  assert.deepStrictEqual(geo.chamadas, [['throughProxy', 'socks5://x:1'], ['throughProxy', 'socks5://y:2']]);
  assert.deepStrictEqual(consultas, [ID_DO_IPHONE]);
});

test('geoFromProxy: IP de saida que nao e IPv4, resposta sem sucesso ou erro do aparelho caem na proxy salva', async () => {
  const respostas = [{ success: true, ip: 'nao-e-ip' }, { success: true, ip: '1.2.3' }, { success: true }, null, { success: false, ip: '1.2.3.4' }];
  for (const resposta of respostas) {
    const servico = servicoDoIphone({ proxyCheck: async () => resposta });
    assert.strictEqual((await servico.geoFromProxy(ID_DO_IPHONE, 'socks5://x:1')).via, 'proxy', JSON.stringify(resposta));
  }
  const servico = servicoDoIphone({ proxyCheck: async () => { throw new Error('ssh caiu'); } });
  assert.strictEqual((await servico.geoFromProxy(ID_DO_IPHONE, 'socks5://x:1')).via, 'proxy');
});

test('geoFromProxy: sem IP e sem proxy salva pede para salvar a proxy, sem consultar nada', async () => {
  const servico = servicoDoIphone({ proxyCheck: async () => ({ success: false }) });
  const esperado = { success: false, error: 'Sem proxy configurado. Salve a proxy primeiro.' };
  for (const proxy of ['', '   ', null, undefined]) assert.deepStrictEqual(await servico.geoFromProxy(ID_DO_IPHONE, proxy), esperado, String(proxy));
  assert.deepStrictEqual(await servico.geoFromProxy(null, null), esperado);
  assert.deepStrictEqual(geo.chamadas, []);
});

test('geoFromProxy: a falha da consulta volta como erro em texto, pela mensagem ou pelo proprio valor', async () => {
  const servico = servicoDoIphone({ proxyCheck: async () => ({ success: true, ip: '203.0.113.7' }) });
  geo.byIp = async () => { throw new Error('IP inválido: x'); };
  assert.deepStrictEqual(await servico.geoFromProxy(ID_DO_IPHONE, ''), { success: false, error: 'IP inválido: x' });
  geo.byIp = () => Promise.reject('texto solto');
  assert.deepStrictEqual(await servico.geoFromProxy(ID_DO_IPHONE, ''), { success: false, error: 'texto solto' });
  geo.throughProxy = async () => { throw new Error('timeout na consulta de geolocalização'); };
  const semIp = servicoDoIphone({ proxyCheck: async () => ({ success: false }) });
  geo.throughProxy = async () => { throw new Error('timeout na consulta de geolocalização'); };
  assert.deepStrictEqual(await semIp.geoFromProxy(ID_DO_IPHONE, 'socks5://x:1'), { success: false, error: 'timeout na consulta de geolocalização' });
});

test('os caminhos do idevicesetlocation e do pymobiledevice3 vem do tool-paths pelo nome', () => {
  const servico = servicoDoIphone();
  assert.strictEqual(servico.idevicesetlocationPath(), IDEVICESETLOCATION);
  assert.strictEqual(servico.pymobiledevice3Path(), PYMOBILEDEVICE3);
  assert.deepStrictEqual(ferramentas.consultadas, ['idevicesetlocation', 'pymobiledevice3']);
});

test('mountDeveloperImage monta com o pymobiledevice3 (180 s, sem janela) e devolve se deu certo; sem a ferramenta devolve false', async () => {
  const servico = servicoDoIphone();
  aoExecutar(() => ({}));
  assert.strictEqual(await servico.mountDeveloperImage(UDID), true);
  aoExecutar(() => ({ erro: 'falhou' }));
  assert.strictEqual(await servico.mountDeveloperImage(UDID), false);
  assert.deepStrictEqual(execucoes().map((c) => [c.arquivo, c.argumentos, c.opcoes]), [
    [PYMOBILEDEVICE3, ['mounter', 'auto-mount', '--udid', UDID], { timeout: 180000, windowsHide: true }],
  ]);
  ferramentas.gps.pymobiledevice3 = null;
  aoExecutar(() => ({}));
  assert.strictEqual(await servico.mountDeveloperImage(UDID), false);
  assert.deepStrictEqual(execucoes(), []);
});

test('runIdevicesetlocation junta stderr e stdout no erro, cai na mensagem do erro, e avisa quando falta a ferramenta', async () => {
  const servico = servicoDoIphone();
  const casos = [
    [{ stdout: 'ok\n' }, { ok: true, out: 'ok\n', err: 'ok' }],
    [{}, { ok: true, out: '', err: '' }],
    [{ stdout: 'saida', stderr: ' aviso ' }, { ok: true, out: 'saida', err: 'aviso\nsaida' }],
    [{ erro: 'quebrou', stderr: 'detalhe', stdout: '' }, { ok: false, out: '', err: 'detalhe' }],
    [{ erro: 'quebrou' }, { ok: false, out: '', err: 'quebrou' }],
  ];
  const obtidos = [];
  for (const [resposta] of casos) {
    aoExecutar(() => resposta);
    obtidos.push(await servico.runIdevicesetlocation(UDID, ['reset']));
  }
  assert.deepStrictEqual(obtidos, casos.map(([, esperado]) => esperado));
  assert.deepStrictEqual(execucoes()[0], { tipo: 'execFile', arquivo: IDEVICESETLOCATION, argumentos: ['--udid', UDID, 'reset'], opcoes: { timeout: 30000, windowsHide: true } });
  aoExecutar(() => ({}));
  await servico.runIdevicesetlocation(UDID, ['--', '1', '2'], 5000);
  assert.deepStrictEqual(execucoes()[0].opcoes, { timeout: 5000, windowsHide: true });
  assert.deepStrictEqual(execucoes()[0].argumentos, ['--udid', UDID, '--', '1', '2']);
  ferramentas.gps.idevicesetlocation = null;
  assert.deepStrictEqual(await servico.runIdevicesetlocation(UDID, ['reset']), { ok: false, err: 'idevicesetlocation não encontrado neste computador.' });
});

test('iosSetLocation: sem imagem de desenvolvedor montada nao aplica nada e explica o que instalar', async () => {
  const servico = servicoDoIphone();
  servico.mountDeveloperImage = async (udid) => { servico.montadoPara = udid; return false; };
  assert.deepStrictEqual(await servico.iosSetLocation(ID_DO_IPHONE, 1, 2), { success: false, error: SEM_IMAGEM });
  assert.strictEqual(servico.montadoPara, UDID);
  assert.deepStrictEqual(execucoes(), []);
});

test('iosSetLocation: a falha do idevicesetlocation volta cortada em 300 caracteres', async () => {
  const servico = servicoDoIphone();
  servico.mountDeveloperImage = async () => true;
  aoExecutar(() => ({ erro: 'x', stderr: 'e'.repeat(400) }));
  assert.deepStrictEqual(await servico.iosSetLocation(ID_DO_IPHONE, 1, 2), { success: false, error: 'e'.repeat(300) });
});

test('iosSetLocation: aplica as coordenadas como texto e espera o fuso mudar em ate 4 voltas de 2 s', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const servico = servicoDoIphone({ fusos: ['America/Sao_Paulo', 'America/Sao_Paulo', 'America/Recife'] });
  servico.mountDeveloperImage = async () => true;
  aoExecutar(() => ({}));
  const { resposta } = await esperarComRelogioFalso(t, servico.iosSetLocation(ID_DO_IPHONE, -8.05, -34.9));
  assert.deepStrictEqual(resposta, { success: true, latitude: -8.05, longitude: -34.9, timezone: 'America/Recife', timezoneBefore: 'America/Sao_Paulo' });
  assert.deepStrictEqual(execucoes().map((c) => [c.arquivo, c.argumentos, c.opcoes]), [[IDEVICESETLOCATION, ['--udid', UDID, '--', '-8.05', '-34.9'], { timeout: 30000, windowsHide: true }]]);
  assert.strictEqual(servico.fusosLidos, 3);
});

test('iosSetLocation: o fuso que nao muda em 4 voltas fica o de antes, e o fuso ilegivel nao troca o ultimo lido', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const igual = servicoDoIphone({ fusos: ['America/Sao_Paulo'] });
  igual.mountDeveloperImage = async () => true;
  aoExecutar(() => ({}));
  const primeiro = await esperarComRelogioFalso(t, igual.iosSetLocation(ID_DO_IPHONE, 1, 2));
  assert.deepStrictEqual(primeiro.resposta, { success: true, latitude: 1, longitude: 2, timezone: 'America/Sao_Paulo', timezoneBefore: 'America/Sao_Paulo' });
  assert.strictEqual(igual.fusosLidos, 5);
  const ilegivel = servicoDoIphone({ fusos: ['Asia/Tokyo', null] });
  ilegivel.mountDeveloperImage = async () => true;
  const segundo = await esperarComRelogioFalso(t, ilegivel.iosSetLocation(ID_DO_IPHONE, 1, 2));
  assert.deepStrictEqual(segundo.resposta, { success: true, latitude: 1, longitude: 2, timezone: 'Asia/Tokyo', timezoneBefore: 'Asia/Tokyo' });
  const semFusoAntes = servicoDoIphone({ fusos: [null, 'Europe/Lisbon'] });
  semFusoAntes.mountDeveloperImage = async () => true;
  const terceiro = await esperarComRelogioFalso(t, semFusoAntes.iosSetLocation(ID_DO_IPHONE, 1, 2));
  assert.deepStrictEqual(terceiro.resposta, { success: true, latitude: 1, longitude: 2, timezone: 'Europe/Lisbon', timezoneBefore: null });
  assert.strictEqual(semFusoAntes.fusosLidos, 2);
});

test('iosStopLocation: reseta com 20 s de limite, aceita a imagem que ja saiu e devolve o erro cortado em 300', async () => {
  const servico = servicoDoIphone();
  const casos = [
    [{}, { success: true }],
    [{ erro: 'x', stderr: 'Device is locked' }, { success: false, error: 'Device is locked' }],
    [{ erro: 'x', stderr: 'The Developer Disk Image is not mounted' }, { success: true, note: 'GPS simulado removido junto com a imagem de desenvolvedor.' }],
    [{ erro: 'x', stderr: 'could not find developer disk image' }, { success: true, note: 'GPS simulado removido junto com a imagem de desenvolvedor.' }],
    [{ erro: 'x', stderr: 'Invalid Service' }, { success: true, note: 'GPS simulado removido junto com a imagem de desenvolvedor.' }],
    [{ erro: 'x', stderr: 'e'.repeat(400) }, { success: false, error: 'e'.repeat(300) }],
    [{ erro: '' }, { success: true }],
  ];
  const obtidos = [];
  for (const [resposta] of casos) {
    aoExecutar(() => resposta);
    obtidos.push(await servico.iosStopLocation(ID_DO_IPHONE));
  }
  assert.deepStrictEqual(obtidos, casos.map(([, esperado]) => esperado));
  assert.deepStrictEqual(execucoes()[0], { tipo: 'execFile', arquivo: IDEVICESETLOCATION, argumentos: ['--udid', UDID, 'reset'], opcoes: { timeout: 20000, windowsHide: true } });
});

function servicoDoAndroid() {
  const servico = novoServico();
  servico.comandosNoAparelho = [];
  servico.arquivosEnviados = [];
  servico.adbRootExec = async (id, comando) => {
    servico.comandosNoAparelho.push([id, comando]);
    if (servico.falharEm && comando.includes(servico.falharEm)) throw new Error('adb caiu');
    return { output: '' };
  };
  servico.adbPush = async (id, local, remoto) => {
    servico.arquivosEnviados.push({ id, local, remoto, conteudo: fs.readFileSync(local, 'utf8') });
    return { success: true };
  };
  return servico;
}

const HORA = '$(date +%s%3N)';
const SCRIPT_DO_LACO = (lat, lng) => `#!/system/bin/sh
# Nova GPS Spoof Loop — nova_gps_loop
LAT="${lat}"
LNG="${lng}"
while true; do
  # Inject via platform cmd (Android 8+ / rooted)
  cmd location set-test-provider-enabled gps true 2>/dev/null
  cmd location set-test-provider-location gps --lat $LAT --lng $LNG --accuracy 3.0 --altitude 50 --speed 0.0 --bearing 0.0 --time ${HORA} 2>/dev/null
  cmd location set-test-provider-enabled network true 2>/dev/null
  cmd location set-test-provider-location network --lat $LAT --lng $LNG --accuracy 20.0 --altitude 50 --speed 0.0 --bearing 0.0 --time ${HORA} 2>/dev/null
  cmd location set-test-provider-enabled fused true 2>/dev/null
  cmd location set-test-provider-location fused --lat $LAT --lng $LNG --accuracy 1.0 --altitude 50 --speed 0.0 --bearing 0.0 --time ${HORA} 2>/dev/null
  sleep 2
done
`;

test('setSpoofLocation no Android: mata o laco antigo, liga o local simulado, grava o script e o json, envia os dois e roda o laco', async () => {
  const servico = servicoDoAndroid();
  assert.deepStrictEqual(await servico.setSpoofLocation(ID_DO_ANDROID, -8.05, -34.9), { success: true, latitude: -8.05, longitude: -34.9 });
  assert.deepStrictEqual(servico.comandosNoAparelho.map(([, comando]) => comando), [
    'pkill -f nova_gps_loop 2>/dev/null; true',
    'settings put secure mock_location 1',
    'settings put global development_settings_enabled 1',
    'chmod +x /data/local/tmp/nova_gps_loop.sh',
    'nohup sh /data/local/tmp/nova_gps_loop.sh >/data/local/tmp/nova_gps.log 2>&1 &',
  ]);
  assert.ok(servico.comandosNoAparelho.every(([id]) => id === ID_DO_ANDROID));
  assert.deepStrictEqual(servico.arquivosEnviados.map(({ id, local, remoto }) => [id, path.relative(servico.baseDir, local), remoto]), [
    [ID_DO_ANDROID, 'nova_gps_loop.sh', '/data/local/tmp/nova_gps_loop.sh'],
    [ID_DO_ANDROID, 'nova_spoof.json', '/data/local/tmp/nova_spoof.json'],
  ]);
  assert.strictEqual(servico.arquivosEnviados[0].conteudo, SCRIPT_DO_LACO(-8.05, -34.9));
  assert.strictEqual(servico.arquivosEnviados[1].conteudo, JSON.stringify({ latitude: -8.05, longitude: -34.9, altitude: 50 }, null, 2));
});

test('setSpoofLocation no Android: guarda os outros campos do nova_spoof.json e refaz o arquivo quando ele esta quebrado', async () => {
  const servico = servicoDoAndroid();
  fs.writeFileSync(path.join(servico.baseDir, 'nova_spoof.json'), JSON.stringify({ model: 'Pixel Teste', latitude: 1, altitude: 3 }));
  await servico.setSpoofLocation(ID_DO_ANDROID, '10.5', '20.5');
  assert.deepStrictEqual(JSON.parse(servico.arquivosEnviados[1].conteudo), { model: 'Pixel Teste', latitude: '10.5', longitude: '20.5', altitude: 50 });
  assert.match(servico.arquivosEnviados[0].conteudo, /^LAT="10.5"$/m);
  fs.writeFileSync(path.join(servico.baseDir, 'nova_spoof.json'), '{quebrado');
  await servico.setSpoofLocation(ID_DO_ANDROID, 3, 4);
  assert.deepStrictEqual(JSON.parse(servico.arquivosEnviados[3].conteudo), { latitude: 3, longitude: 4, altitude: 50 });
});

test('setSpoofLocation no Android: o erro do adb volta em texto e o iPhone vai pelo GPS do iPhone', async () => {
  const servico = servicoDoAndroid();
  servico.falharEm = 'mock_location';
  assert.deepStrictEqual(await servico.setSpoofLocation(ID_DO_ANDROID, 1, 2), { success: false, error: 'adb caiu' });
  assert.deepStrictEqual(servico.arquivosEnviados, []);
  const iphone = servicoDoAndroid();
  iphone.iosSetLocation = async (...argumentos) => ({ success: true, via: 'ios', argumentos });
  assert.deepStrictEqual(await iphone.setSpoofLocation(ID_DO_IPHONE, 1, 2), { success: true, via: 'ios', argumentos: [ID_DO_IPHONE, 1, 2] });
  assert.deepStrictEqual(iphone.comandosNoAparelho, []);
});

test('stopFakeGPS no Android mata o laco e desliga os tres provedores de teste; no iPhone reseta o GPS do iPhone', async () => {
  const servico = servicoDoAndroid();
  assert.deepStrictEqual(await servico.stopFakeGPS(ID_DO_ANDROID), { success: true });
  assert.deepStrictEqual(servico.comandosNoAparelho, [
    [ID_DO_ANDROID, 'pkill -f nova_gps_loop 2>/dev/null; true'],
    [ID_DO_ANDROID, 'cmd location set-test-provider-enabled gps false 2>/dev/null; true'],
    [ID_DO_ANDROID, 'cmd location set-test-provider-enabled network false 2>/dev/null; true'],
    [ID_DO_ANDROID, 'cmd location set-test-provider-enabled fused false 2>/dev/null; true'],
  ]);
  const iphone = servicoDoAndroid();
  iphone.iosStopLocation = async (id) => ({ success: true, via: 'ios', id });
  assert.deepStrictEqual(await iphone.stopFakeGPS(ID_DO_IPHONE), { success: true, via: 'ios', id: ID_DO_IPHONE });
  assert.deepStrictEqual(iphone.comandosNoAparelho, []);
});
