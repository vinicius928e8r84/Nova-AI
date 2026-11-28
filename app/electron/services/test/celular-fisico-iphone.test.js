'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PREFIXO_DO_SSH = [
  '-p', '2222', 'OPCOES-DO-SSH', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-o', 'StrictHostKeyChecking=accept-new', 'mobile@127.0.0.1',
];
const PREFIXO_DO_SCP = [
  '-P', '2222', 'OPCOES-DO-SSH', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-o', 'StrictHostKeyChecking=accept-new',
];
const NOVAPROXY = '/var/jb/usr/bin/novaproxy ';
const ID_DO_IPHONE = 'ios-00008120-ABCD';
const PERFIL_DO_ARQUIVO_DE_IDIOMAS = '/var/mobile/Library/Preferences/.GlobalPreferences.plist';

const palco = {
  chamadas: [],
  responder: () => ({}),
  ferramentasDoIphone: true,
  aparelhos: [],
  janelas: [],
  ponte: { rodando: false, iniciadas: 0 },
  plist: { gravacoes: [], primeiroIdioma: 'pt-BR' },
  reiniciar(responder = () => ({})) {
    this.chamadas = [];
    this.responder = responder;
  },
};

function responderChamada(chamada, callback) {
  palco.chamadas.push(chamada);
  const { erro = null, stdout = '', stderr = '' } = palco.responder(chamada) || {};
  callback(erro ? Object.assign(new Error(erro), { stderr }) : null, stdout, stderr);
}

class JanelaFalsa {
  constructor(opcoes) {
    Object.assign(this, { opcoes, destruida: false, focos: 0, enderecos: [], ouvintes: new Map(), fechadas: 0 });
    palco.janelas.push(this);
  }
  isDestroyed() { return this.destruida; }
  focus() { this.focos++; }
  loadURL(endereco) { this.enderecos.push(endereco); }
  on(evento, ouvinte) { this.ouvintes.set(evento, ouvinte); }
  close() {
    this.fechadas++;
    if (palco.falhaAoFechar) throw new Error('não fechou');
  }
}

const SUBSTITUTOS = {
  child_process: { execFile: (arquivo, argumentos, opcoes, callback) => responderChamada({ tipo: 'execFile', arquivo, argumentos, opcoes }, callback) },
  ws: function WebSocket() {},
  axios: {},
  electron: { BrowserWindow: JanelaFalsa },
  './mac-native': { tool: () => null },
  './iphone-ssh': { sshOptions: () => ['OPCOES-DO-SSH'], migrateLegacy: () => {} },
  './tool-paths': {
    execSsh: (argumentos, opcoes, callback) => responderChamada({ tipo: 'ssh', argumentos, opcoes }, callback),
    scp: () => 'SCP',
  },
  './ios-tools': {
    tool: (nome) => `FERRAMENTA-${nome}`,
    has: () => palco.ferramentasDoIphone,
  },
  './ios-devices': { listar: async () => { if (palco.aparelhos instanceof Error) throw palco.aparelhos; return palco.aparelhos; } },
  './ios-bridge': {
    PORT: 8765,
    isRunning: () => palco.ponte.rodando,
    start: () => { palco.ponte.iniciadas++; },
  },
  './plist-prefs': {
    aplicarIdiomaLocale: async (...argumentos) => { palco.plist.gravacoes.push(argumentos); },
    lerPrimeiroIdioma: async (arquivo) => { palco.chamadas.push({ tipo: 'plist', arquivo }); return palco.plist.primeiroIdioma; },
  },
};

const carregadorOriginal = Module._load;
Module._load = function (pedido, ...resto) {
  return Object.prototype.hasOwnProperty.call(SUBSTITUTOS, pedido) ? SUBSTITUTOS[pedido] : carregadorOriginal.call(this, pedido, ...resto);
};
process.env.NOVA_SMOKE_TEST = '1';
for (const nivel of ['log', 'info', 'warn', 'error']) console[nivel] = () => {};
const caminhoDoServico = path.resolve(__dirname, '../physicalMobileService.js');
delete require.cache[caminhoDoServico];
const Servico = require(caminhoDoServico);

const pastasCriadas = [];
test.after(() => {
  Module._load = carregadorOriginal;
  for (const pasta of pastasCriadas) fs.rmSync(pasta, { recursive: true, force: true });
});

function novoServico() {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'celular-fisico-iphone-'));
  pastasCriadas.push(pasta);
  Object.assign(palco, { aparelhos: [], janelas: [], falhaAoFechar: false, ferramentasDoIphone: true });
  Object.assign(palco.ponte, { rodando: false, iniciadas: 0 });
  Object.assign(palco.plist, { gravacoes: [], primeiroIdioma: 'pt-BR' });
  palco.reiniciar();
  return new Servico(null, { getPath: () => pasta });
}

const comandoDoSsh = (chamada) => chamada.argumentos.at(-1);
const respostaDoSsh = (porComando) => (chamada) => (chamada.tipo === 'ssh' ? porComando(comandoDoSsh(chamada)) : {});
const soSsh = () => palco.chamadas.filter((chamada) => chamada.tipo === 'ssh');
const comandosDoSsh = () => soSsh().map(comandoDoSsh);

async function esperarComRelogioFalso(t, promessa, passoEmMs) {
  let terminou = false;
  const resultado = promessa.finally(() => { terminou = true; });
  let passos = 0;
  for (;;) {
    await new Promise((resolver) => setImmediate(resolver));
    if (terminou) break;
    t.mock.timers.tick(passoEmMs);
    passos++;
  }
  return { resposta: await resultado, passos };
}

test('iosSsh monta o ssh do iPhone com chave, porta 2222, sem perguntas e limite de 12 s, e devolve saída e erro como texto', async () => {
  const servico = novoServico();
  palco.reiniciar(() => ({ stdout: 'saída do aparelho' }));
  assert.deepStrictEqual(await servico.iosSsh('uname -a'), { ok: true, stdout: 'saída do aparelho', error: null });
  assert.deepStrictEqual(palco.chamadas, [{ tipo: 'ssh', argumentos: [...PREFIXO_DO_SSH, 'uname -a'], opcoes: { timeout: 12000 } }]);

  palco.reiniciar(() => ({ erro: 'Connection refused', stderr: 'ssh: connect to host refused' }));
  assert.deepStrictEqual(await servico.iosSsh('x'), { ok: false, stdout: '', error: 'ssh: connect to host refused' });
  palco.reiniciar(() => ({ erro: 'quebrou' }));
  assert.deepStrictEqual(await servico.iosSsh('x'), { ok: false, stdout: '', error: 'quebrou' });
});

test('iosDeviceTimeZone lê o fuso do link do aparelho e devolve nulo se o ssh falha ou a saída não é um fuso', async () => {
  const servico = novoServico();
  palco.reiniciar(respostaDoSsh(() => ({ stdout: '/var/db/timezone/zoneinfo/America/Sao_Paulo\n' })));
  assert.strictEqual(await servico.iosDeviceTimeZone(), 'America/Sao_Paulo');
  assert.deepStrictEqual(comandosDoSsh(), ['readlink /var/db/timezone/localtime']);
  palco.reiniciar(respostaDoSsh(() => ({ stdout: 'outra coisa' })));
  assert.strictEqual(await servico.iosDeviceTimeZone(), null);
  palco.reiniciar(respostaDoSsh(() => ({ erro: 'sem rota' })));
  assert.strictEqual(await servico.iosDeviceTimeZone(), null);
});

test('iosProxyRun roda o novaproxy pelo ssh com o limite pedido (30 s por padrão) e tira os espaços da saída', async () => {
  const servico = novoServico();
  palco.reiniciar(() => ({ stdout: '  on upstream=a  \n' }));
  assert.deepStrictEqual(await servico.iosProxyRun('proxy status'), { ok: true, stdout: 'on upstream=a', error: null });
  assert.deepStrictEqual(await servico.iosProxyRun('proxy clear', 15000), { ok: true, stdout: 'on upstream=a', error: null });
  assert.deepStrictEqual(palco.chamadas, [
    { tipo: 'ssh', argumentos: [...PREFIXO_DO_SSH, `${NOVAPROXY}proxy status`], opcoes: { timeout: 30000 } },
    { tipo: 'ssh', argumentos: [...PREFIXO_DO_SSH, `${NOVAPROXY}proxy clear`], opcoes: { timeout: 15000 } },
  ]);
  palco.reiniciar(() => ({ erro: 'falhou', stderr: '  a regra falhou \n' }));
  assert.deepStrictEqual(await servico.iosProxyRun('x'), { ok: false, stdout: '', error: 'a regra falhou' });
  palco.reiniciar(() => ({ erro: 'falhou' }));
  assert.deepStrictEqual(await servico.iosProxyRun('x'), { ok: false, stdout: '', error: 'falhou' });
});

test('iosProxyError troca os três erros conhecidos por orientação e devolve o resto como veio', () => {
  const servico = novoServico();
  const instalar = 'O novaproxy ainda não está instalado no iPhone. Rode o instalador uma vez.';
  const sudo = 'A regra de sudo do novaproxy não está ativa no iPhone. Reinstale o pacote.';
  const terminal = 'O sudo do iPhone exige terminal. Reinstale o pacote (a regra NOPASSWD não entrou).';
  const casos = [
    ['bash: novaproxy: No such file or directory', instalar], ['sh: command not found', instalar], ['NOT FOUND', instalar],
    ['sudo: a password is required', sudo], ['Password is required', sudo],
    ['sudo: you must have a tty to run sudo', terminal], ['requiretty', terminal],
    ['  erro qualquer  ', 'erro qualquer'], ['', 'Falha ao falar com o proxy do iPhone.'], [null, 'Falha ao falar com o proxy do iPhone.'],
  ];
  for (const [bruto, esperado] of casos) assert.strictEqual(servico.iosProxyError(bruto), esperado, String(bruto));
});

test('o proxy do iPhone só vale para iPhone, e liga, limpa, lê e confere pelo novaproxy com os limites de cada um', async () => {
  const servico = novoServico();
  const SO_IPHONE = { success: false, error: 'O proxy está disponível apenas para iPhone.' };
  for (const id of ['android-1', '', undefined, null]) {
    assert.deepStrictEqual(await servico.iosProxySet(id, 'p'), SO_IPHONE);
    assert.deepStrictEqual(await servico.iosProxyClear(id), SO_IPHONE);
    assert.deepStrictEqual(await servico.iosProxyStatus(id), SO_IPHONE);
    assert.deepStrictEqual(await servico.iosProxyCheck(id), SO_IPHONE);
  }
  assert.deepStrictEqual(palco.chamadas, []);

  assert.deepStrictEqual(await servico.iosProxySet(ID_DO_IPHONE, '   '), { success: false, error: 'Proxy vazio.' });
  assert.deepStrictEqual(await servico.iosProxySet(ID_DO_IPHONE, undefined), { success: false, error: 'Proxy vazio.' });
  assert.deepStrictEqual(palco.chamadas, []);

  palco.reiniciar(() => ({ stdout: 'ok\n' }));
  assert.deepStrictEqual(await servico.iosProxySet(ID_DO_IPHONE, " user:pa'ss@host:80 "), { success: true, message: 'ok' });
  assert.deepStrictEqual(await servico.iosProxyClear(ID_DO_IPHONE), { success: true, message: 'ok' });
  assert.deepStrictEqual(await servico.iosProxyCheck(ID_DO_IPHONE), { success: true, ip: 'ok' });
  assert.deepStrictEqual(palco.chamadas.map((c) => [comandoDoSsh(c), c.opcoes.timeout]), [
    [`${NOVAPROXY}proxy set 'user:pa'\\''ss@host:80'`, 30000],
    [`${NOVAPROXY}proxy clear`, 15000],
    [`${NOVAPROXY}proxy check`, 40000],
  ]);

  palco.reiniciar(() => ({ erro: 'x', stderr: 'bash: novaproxy: command not found' }));
  const naoInstalado = { success: false, error: 'O novaproxy ainda não está instalado no iPhone. Rode o instalador uma vez.' };
  assert.deepStrictEqual(await servico.iosProxySet(ID_DO_IPHONE, 'p'), naoInstalado);
  assert.deepStrictEqual(await servico.iosProxyClear(ID_DO_IPHONE), naoInstalado);
  assert.deepStrictEqual(await servico.iosProxyStatus(ID_DO_IPHONE), naoInstalado);
  assert.deepStrictEqual(await servico.iosProxyCheck(ID_DO_IPHONE), naoInstalado);
});

test('iosProxyStatus lê ligado, endereço, Wi-Fi e daemon da linha do novaproxy e usa padrões quando faltam', async () => {
  const servico = novoServico();
  const linhaCompleta = 'on upstream=host:80 wifi=enabled daemon=running';
  palco.reiniciar(() => ({ stdout: linhaCompleta }));
  assert.deepStrictEqual(await servico.iosProxyStatus(ID_DO_IPHONE), {
    success: true, on: true, upstream: 'host:80', wifi: 'enabled', daemon: true, raw: linhaCompleta,
  });
  assert.deepStrictEqual(palco.chamadas.map((c) => c.opcoes.timeout), [15000]);
  palco.reiniciar(() => ({ stdout: 'off daemon=stopped' }));
  assert.deepStrictEqual(await servico.iosProxyStatus(ID_DO_IPHONE), {
    success: true, on: false, upstream: '', wifi: 'unknown', daemon: false, raw: 'off daemon=stopped',
  });
  palco.reiniciar(() => ({ stdout: 'online' }));
  assert.strictEqual((await servico.iosProxyStatus(ID_DO_IPHONE)).on, false);
});

test('o banco de modelos do iPhone sai do arquivo do serviço, e aplicar, limpar e ler passam pelo ssh do serviço', async () => {
  const servico = novoServico();
  const banco = servico.getIosModels();
  assert.strictEqual(banco.success, true);
  assert.ok(banco.models.length >= 13);
  const modelo = banco.models.find((m) => m.productType === 'iPhone15,4');
  assert.ok(modelo);

  const comandos = [];
  servico.iosSsh = async (comando) => { comandos.push(comando); return { ok: true, stdout: '{"real":"iPhone10,2","active":"iPhone15,4","enabled":true}', error: null }; };
  assert.deepStrictEqual(await servico.applyIOSModel(ID_DO_IPHONE, 'iPhone15,4'), { success: true, applied: { productType: 'iPhone15,4', name: modelo.name } });
  assert.deepStrictEqual(await servico.clearIOSModel(ID_DO_IPHONE), { success: true });
  assert.deepStrictEqual(await servico.getIOSModel(ID_DO_IPHONE), { success: true, real: 'iPhone10,2', active: 'iPhone15,4', enabled: true });
  assert.deepStrictEqual(comandos, [
    '/var/jb/usr/bin/novamodel set iPhone15,4', '/var/jb/usr/bin/novamodel clear', '/var/jb/usr/bin/novamodel status',
  ]);
});

test('o modelo do iPhone recusa o que não é iPhone, o tipo inválido e o modelo fora do banco, e repassa o erro do ssh', async () => {
  const servico = novoServico();
  const SO_IPHONE = { success: false, error: 'O modelo é aplicável apenas ao iPhone.' };
  for (const id of ['android-1', '', undefined]) {
    assert.deepStrictEqual(await servico.applyIOSModel(id, 'iPhone15,4'), SO_IPHONE);
    assert.deepStrictEqual(await servico.clearIOSModel(id), SO_IPHONE);
    assert.deepStrictEqual(await servico.getIOSModel(id), SO_IPHONE);
  }
  assert.deepStrictEqual(await servico.applyIOSModel(ID_DO_IPHONE, 'x; rm -rf'), { success: false, error: 'productType inválido.' });
  assert.deepStrictEqual(await servico.applyIOSModel(ID_DO_IPHONE, 42), { success: false, error: 'productType inválido.' });
  assert.deepStrictEqual(await servico.applyIOSModel(ID_DO_IPHONE, 'Nope9,9'), { success: false, error: 'Modelo "Nope9,9" não está no banco iOS.' });
  assert.deepStrictEqual(palco.chamadas, []);

  servico.iosSsh = async () => ({ ok: false, stdout: '', error: 'command not found' });
  assert.deepStrictEqual(await servico.applyIOSModel(ID_DO_IPHONE, 'iPhone15,4'), { success: false, error: 'command not found' });
  assert.deepStrictEqual(await servico.clearIOSModel(ID_DO_IPHONE), { success: false, error: 'command not found' });
  assert.deepStrictEqual(await servico.getIOSModel(ID_DO_IPHONE), { success: false, error: 'command not found' });
  servico.iosSsh = async () => ({ ok: true, stdout: 'lixo', error: null });
  assert.deepStrictEqual(await servico.getIOSModel(ID_DO_IPHONE), { success: false, error: 'Status inválido do novamodel.', raw: 'lixo' });
});

test('iosRun roda o ideviceinstaller com limite de 25 s e sem janela, e devolve saída e erro como texto', async () => {
  const servico = novoServico();
  palco.reiniciar(() => ({ stdout: 'a,b' }));
  assert.deepStrictEqual(await servico.iosRun(['list']), { ok: true, stdout: 'a,b', error: null });
  assert.deepStrictEqual(palco.chamadas, [
    { tipo: 'execFile', arquivo: 'FERRAMENTA-ideviceinstaller', argumentos: ['list'], opcoes: { timeout: 25000, windowsHide: true } },
  ]);
  palco.reiniciar(() => ({ erro: 'falhou', stderr: 'sem aparelho' }));
  assert.deepStrictEqual(await servico.iosRun(['list']), { ok: false, stdout: '', error: 'sem aparelho' });
  palco.reiniciar(() => ({ erro: 'falhou' }));
  assert.deepStrictEqual(await servico.iosRun(['list']), { ok: false, stdout: '', error: 'falhou' });
});

test('getIosDevices devolve a lista de iPhones, e lista vazia sem as duas ferramentas ou se listar falha', async () => {
  const servico = novoServico();
  palco.aparelhos = [{ id: 'ios-1', name: 'iPhone' }];
  assert.deepStrictEqual(await servico.getIosDevices(), [{ id: 'ios-1', name: 'iPhone' }]);
  palco.aparelhos = new Error('quebrou');
  assert.deepStrictEqual(await servico.getIosDevices(), []);
  palco.aparelhos = [{ id: 'ios-1' }];
  palco.ferramentasDoIphone = false;
  assert.deepStrictEqual(await servico.getIosDevices(), []);
});

test('iosPrepared olha o arquivo de chaves do aparelho na pasta do serviço e dá falso sem arquivo ou com arquivo quebrado', () => {
  const servico = novoServico();
  const arquivo = path.join(servico.baseDir, 'iphone-hosts.json');
  assert.strictEqual(servico.iosPrepared('u1'), false);
  fs.writeFileSync(arquivo, JSON.stringify({ u1: 'f'.repeat(64), u2: '' }));
  assert.strictEqual(servico.iosPrepared('u1'), true);
  assert.strictEqual(servico.iosPrepared('u2'), false);
  assert.strictEqual(servico.iosPrepared('u3'), false);
  fs.writeFileSync(arquivo, 'null');
  assert.strictEqual(servico.iosPrepared('u1'), false);
  fs.writeFileSync(arquivo, '{quebrado');
  assert.strictEqual(servico.iosPrepared('u1'), false);
});

test('o console do iPhone abre uma janela por aparelho, foca a que já existe, sobe a ponte se parada e some da lista ao fechar', async () => {
  const servico = novoServico();
  const aberto = await servico.iosStartStream(ID_DO_IPHONE);
  assert.deepStrictEqual(aberto, { success: true, message: 'Controle do iPhone aberto. Se pedir senha, use a do CatVNC (Ajustes > CatVNC).' });
  assert.strictEqual(palco.ponte.iniciadas, 1);
  const [janela] = palco.janelas;
  assert.deepStrictEqual(janela.opcoes, {
    width: 1100, height: 820, title: 'iPhone Console', backgroundColor: '#050a10', webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  assert.deepStrictEqual(janela.enderecos, ['http://127.0.0.1:8765/']);

  palco.ponte.rodando = true;
  assert.deepStrictEqual(await servico.iosStartStream(ID_DO_IPHONE), { success: true, message: 'iPhone Console já estava aberto — trazido pra frente.' });
  assert.strictEqual(janela.focos, 1);
  assert.strictEqual(palco.janelas.length, 1);
  assert.strictEqual(palco.ponte.iniciadas, 1);

  await servico.iosStartStream('ios-outro');
  assert.strictEqual(palco.janelas.length, 2);

  assert.deepStrictEqual(await servico.iosStopStream(ID_DO_IPHONE), { success: true });
  assert.strictEqual(janela.fechadas, 1);
  janela.ouvintes.get('closed')();
  await servico.iosStartStream(ID_DO_IPHONE);
  assert.strictEqual(palco.janelas.length, 3);
  janela.destruida = true;
  assert.deepStrictEqual(await servico.iosStopStream(ID_DO_IPHONE), { success: true });
  assert.strictEqual(janela.fechadas, 1);
});

test('o console do iPhone abre outra janela se a anterior foi destruída, e parar sem janela ou com janela que não fecha dá sucesso', async () => {
  const servico = novoServico();
  assert.deepStrictEqual(await servico.iosStopStream(ID_DO_IPHONE), { success: true });
  await servico.iosStartStream(ID_DO_IPHONE);
  palco.janelas[0].destruida = true;
  await servico.iosStartStream(ID_DO_IPHONE);
  assert.strictEqual(palco.janelas.length, 2);
  palco.falhaAoFechar = true;
  assert.deepStrictEqual(await servico.iosStopStream(ID_DO_IPHONE), { success: true });
  assert.strictEqual(palco.janelas[1].fechadas, 1);
});

test('o console do iPhone devolve o erro de quem falha ao abrir a janela', async () => {
  const servico = novoServico();
  SUBSTITUTOS['./ios-bridge'].start = () => { throw new Error('porta ocupada'); };
  try {
    assert.deepStrictEqual(await servico.iosStartStream(ID_DO_IPHONE), { success: false, error: 'porta ocupada' });
  } finally {
    SUBSTITUTOS['./ios-bridge'].start = () => { palco.ponte.iniciadas++; };
  }
});

test('iosControlApp troca o nome de app do Android pelo do iPhone e abre pelo uiopen, nos três nomes da ação', async () => {
  const servico = novoServico();
  palco.reiniciar(respostaDoSsh(() => ({})));
  for (const acao of ['launch', 'open', 'start', 'LAUNCH', ' open']) {
    const esperado = acao.trim() === acao ? { success: true } : { success: false, error: 'Ação não suportada no iOS:  open' };
    assert.deepStrictEqual(await servico.iosControlApp(ID_DO_IPHONE, 'com.whatsapp', acao), esperado, acao);
  }
  const apelidos = {
    'com.whatsapp.w4b': 'net.whatsapp.Whatsapp', 'com.instagram.android': 'com.burbn.instagram', 'com.android.chrome': 'com.apple.mobilesafari',
    'com.facebook.katana': 'com.facebook.Facebook', 'com.google.android.youtube': 'com.google.ios.youtube', 'com.tencent.mm': 'com.tencent.xinWeChat',
    'com.zhiliaoapp.musically': 'com.zhiliaoapp.musically', 'com.exemplo.sem.apelido': 'com.exemplo.sem.apelido',
  };
  palco.reiniciar(respostaDoSsh(() => ({})));
  for (const origem of Object.keys(apelidos)) await servico.iosControlApp(ID_DO_IPHONE, origem, 'open');
  assert.deepStrictEqual(comandosDoSsh(), Object.values(apelidos).map((destino) => `uiopen --bundleid ${JSON.stringify(destino)}`));
  palco.reiniciar(respostaDoSsh(() => ({ erro: 'sem sessão', stderr: 'não abriu' })));
  assert.deepStrictEqual(await servico.iosControlApp(ID_DO_IPHONE, 'com.x', 'open'), { success: false, error: 'não abriu' });
});

test('iosControlApp lista os apps do ideviceinstaller e desinstala pelo pacote, nos dois nomes da ação', async () => {
  const servico = novoServico();
  const saida = ['CFBundleIdentifier, CFBundleVersion, CFBundleDisplayName', '"com.a.um", "1.0", "App Um"', '', '   ', '"com.b.dois", "2"', ',"x","y"', 'com.c.tres'].join('\n');
  palco.reiniciar(() => ({ stdout: saida }));
  assert.deepStrictEqual(await servico.iosControlApp(ID_DO_IPHONE, null, 'list'), {
    success: true,
    apps: [{ packageName: 'com.a.um', name: 'App Um' }, { packageName: 'com.b.dois', name: 'com.b.dois' }, { packageName: 'com.c.tres', name: 'com.c.tres' }],
  });
  assert.deepStrictEqual(palco.chamadas.map((c) => c.argumentos), [['list']]);

  palco.reiniciar(() => ({ erro: 'falhou', stderr: 'sem aparelho' }));
  assert.deepStrictEqual(await servico.iosControlApp(ID_DO_IPHONE, null, 'list'), { success: false, error: 'sem aparelho', apps: [] });
  palco.reiniciar(() => ({ erro: 'falhou', stdout: 'com.parcial,1,Parcial' }));
  assert.deepStrictEqual(await servico.iosControlApp(ID_DO_IPHONE, null, 'list'), { success: true, apps: [{ packageName: 'com.parcial', name: 'Parcial' }] });

  palco.reiniciar(() => ({}));
  for (const acao of ['uninstall', 'remove']) assert.deepStrictEqual(await servico.iosControlApp(ID_DO_IPHONE, 'com.android.chrome', acao), { success: true });
  assert.deepStrictEqual(palco.chamadas.map((c) => c.argumentos), [['uninstall', 'com.apple.mobilesafari'], ['uninstall', 'com.apple.mobilesafari']]);
  palco.reiniciar(() => ({ erro: 'falhou', stderr: 'não saiu' }));
  assert.deepStrictEqual(await servico.iosControlApp(ID_DO_IPHONE, 'com.x', 'uninstall'), { success: false, error: 'não saiu' });
});

test('iosControlApp recusa ação desconhecida ou vazia, e trata nomes herdados do objeto como pacote comum', async () => {
  const servico = novoServico();
  palco.reiniciar(() => ({}));
  assert.deepStrictEqual(await servico.iosControlApp(ID_DO_IPHONE, 'com.x', 'stop'), { success: false, error: 'Ação não suportada no iOS: stop' });
  assert.deepStrictEqual(await servico.iosControlApp(ID_DO_IPHONE, 'com.x', undefined), { success: false, error: 'Ação não suportada no iOS: ' });
  assert.deepStrictEqual(await servico.iosControlApp(ID_DO_IPHONE, 'com.x', 'constructor'), { success: false, error: 'Ação não suportada no iOS: constructor' });
  assert.deepStrictEqual(await servico.iosControlApp(ID_DO_IPHONE, 'com.x', 'toString'), { success: false, error: 'Ação não suportada no iOS: tostring' });
  assert.deepStrictEqual(palco.chamadas, []);
  await servico.iosControlApp(ID_DO_IPHONE, 'constructor', 'open');
  assert.deepStrictEqual(comandosDoSsh(), ['uiopen --bundleid "function Object() { [native code] }"']);
});

test('iosAutomateBrowser abre a URL com https quando falta o esquema, busca no Google se só há texto e recusa o vazio', async () => {
  const servico = novoServico();
  palco.reiniciar(() => ({}));
  const casos = [
    [['exemplo.com/a b', 'ignorado'], 'https://exemplo.com/a b'],
    [['http://exemplo.com', undefined], 'http://exemplo.com'],
    [['tel:123', undefined], 'https://tel:123'],
    [['', 'café com leite'], 'https://www.google.com/search?q=caf%C3%A9%20com%20leite'],
    [[undefined, 'a&b'], 'https://www.google.com/search?q=a%26b'],
  ];
  for (const [[url, busca], aberto] of casos) {
    assert.deepStrictEqual(await servico.iosAutomateBrowser(ID_DO_IPHONE, url, busca), { success: true }, aberto);
  }
  assert.deepStrictEqual(comandosDoSsh(), casos.map(([, aberto]) => `uiopen ${JSON.stringify(aberto)}`));
  palco.reiniciar(() => ({}));
  assert.deepStrictEqual(await servico.iosAutomateBrowser(ID_DO_IPHONE, '', ''), { success: false, error: 'Sem URL.' });
  assert.deepStrictEqual(await servico.iosAutomateBrowser(ID_DO_IPHONE), { success: false, error: 'Sem URL.' });
  assert.deepStrictEqual(palco.chamadas, []);
  palco.reiniciar(() => ({ erro: 'sem sessão', stderr: 'não abriu' }));
  assert.deepStrictEqual(await servico.iosAutomateBrowser(ID_DO_IPHONE, 'a.com'), { success: false, error: 'não abriu' });
});

test('iosToggleSetting roda o atalho Nova de Wi-Fi ou Bluetooth ligado ou desligado, e recusa o resto', async () => {
  const servico = novoServico();
  palco.reiniciar(() => ({}));
  const casos = [
    ['wifi', true, 'Nova WiFi On'], ['WiFi', false, 'Nova WiFi Off'], ['bluetooth', true, 'Nova BT On'], ['BLUETOOTH', 0, 'Nova BT Off'],
  ];
  for (const [ajuste, ligar, atalho] of casos) assert.deepStrictEqual(await servico.iosToggleSetting(ID_DO_IPHONE, ajuste, ligar), { success: true }, atalho);
  assert.deepStrictEqual(comandosDoSsh(), casos.map(([, , atalho]) => `uiopen ${JSON.stringify(`shortcuts://run-shortcut?name=${encodeURIComponent(atalho)}`)}`));
  palco.reiniciar(() => ({}));
  assert.deepStrictEqual(await servico.iosToggleSetting(ID_DO_IPHONE, 'nfc', true), { success: false, error: 'Unsupported setting.' });
  assert.deepStrictEqual(await servico.iosToggleSetting(ID_DO_IPHONE, undefined, true), { success: false, error: 'Unsupported setting.' });
  assert.deepStrictEqual(palco.chamadas, []);
  palco.reiniciar(() => ({ erro: 'sem sessão', stderr: 'não abriu' }));
  assert.deepStrictEqual(await servico.iosToggleSetting(ID_DO_IPHONE, 'wifi', true), { success: false, error: 'não abriu' });
});

test('o ajudante de fuso: ler o estado, ver se está instalado e montar os argumentos do scp nos dois sentidos', async () => {
  const servico = novoServico();
  palco.reiniciar(respostaDoSsh(() => ({ stdout: ' {"ok":true,"message":"feito"} \n' })));
  assert.deepStrictEqual(await servico.iosLocaleStatus(), { ok: true, message: 'feito' });
  assert.deepStrictEqual(comandosDoSsh(), ['cat /var/tmp/nova-locale-status.json 2>/dev/null']);
  palco.reiniciar(respostaDoSsh(() => ({ stdout: 'lixo' })));
  assert.strictEqual(await servico.iosLocaleStatus(), null);
  palco.reiniciar(respostaDoSsh(() => ({ erro: 'sem rota' })));
  assert.strictEqual(await servico.iosLocaleStatus(), null);

  palco.reiniciar(respostaDoSsh(() => ({ stdout: 'ok\n' })));
  assert.strictEqual(await servico.iosLocaleHelperReady(), true);
  assert.deepStrictEqual(comandosDoSsh(), ['test -f /var/jb/Library/LaunchDaemons/com.aquiles.novalocale.plist && test -f /var/jb/usr/libexec/nova-locale.sh && echo ok']);
  palco.reiniciar(respostaDoSsh(() => ({ stdout: '' })));
  assert.strictEqual(await servico.iosLocaleHelperReady(), false);
  palco.reiniciar(respostaDoSsh(() => ({ erro: 'x', stdout: 'ok' })));
  assert.strictEqual(await servico.iosLocaleHelperReady(), false);

  assert.deepStrictEqual(servico.iosScpBase('/remoto/a', '/local/a', 'from'), [...PREFIXO_DO_SCP, 'mobile@127.0.0.1:/remoto/a', '/local/a']);
  assert.deepStrictEqual(servico.iosScpBase('/remoto/a', '/local/a', 'to'), [...PREFIXO_DO_SCP, '/local/a', 'mobile@127.0.0.1:/remoto/a']);
  assert.deepStrictEqual(servico.iosScpBase('/remoto/a', '/local/a'), [...PREFIXO_DO_SCP, '/local/a', 'mobile@127.0.0.1:/remoto/a']);
});

test('iosScp roda o scp com limite de 30 s e sem janela, e rejeita com os 200 primeiros caracteres do erro', async () => {
  const servico = novoServico();
  palco.reiniciar(() => ({}));
  assert.strictEqual(await servico.iosScp(['a', 'b']), true);
  assert.deepStrictEqual(palco.chamadas, [{ tipo: 'execFile', arquivo: 'SCP', argumentos: ['a', 'b'], opcoes: { timeout: 30000, windowsHide: true } }]);
  palco.reiniciar(() => ({ erro: 'falhou', stderr: 'x'.repeat(300) }));
  await assert.rejects(servico.iosScp(['a']), (erro) => erro.message === 'x'.repeat(200));
  palco.reiniciar(() => ({ erro: 'falhou sem texto' }));
  await assert.rejects(servico.iosScp(['a']), { message: 'falhou sem texto' });
});

test('o idioma do aparelho: baixar o plist, gravar idioma e locale, subir de volta, e ler o primeiro idioma', async () => {
  const servico = novoServico();
  palco.reiniciar(() => ({}));
  const local = path.join(servico.baseDir, 'nova-globalprefs.plist');
  assert.strictEqual(await servico.iosBuildLocalePlist('pt-BR', 'pt_BR'), local);
  assert.deepStrictEqual(palco.plist.gravacoes, [[local, 'pt-BR', 'pt_BR']]);
  assert.deepStrictEqual(palco.chamadas.map((c) => c.argumentos), [
    [...PREFIXO_DO_SCP, `mobile@127.0.0.1:${PERFIL_DO_ARQUIVO_DE_IDIOMAS}`, local],
    [...PREFIXO_DO_SCP, local, 'mobile@127.0.0.1:/var/tmp/nova-gp.plist'],
  ]);

  palco.reiniciar(() => ({}));
  assert.strictEqual(await servico.iosPlistLanguage(), 'pt-BR');
  const verificacao = path.join(servico.baseDir, 'nova-globalprefs-check.plist');
  assert.deepStrictEqual(palco.chamadas.map((c) => c.argumentos || c.arquivo), [
    [...PREFIXO_DO_SCP, `mobile@127.0.0.1:${PERFIL_DO_ARQUIVO_DE_IDIOMAS}`, verificacao], verificacao,
  ]);
  palco.reiniciar((chamada) => (chamada.tipo === 'execFile' ? { erro: 'x', stderr: 'sem scp' } : {}));
  await assert.rejects(servico.iosBuildLocalePlist('pt-BR', 'pt_BR'), { message: 'sem scp' });
  assert.strictEqual(palco.plist.gravacoes.length, 1);
});

test('iosSendLocaleCommand apaga o estado antigo, grava o comando em linhas campo=valor e sobe pelo scp', async () => {
  const servico = novoServico();
  palco.reiniciar(() => ({}));
  await servico.iosSendLocaleCommand({ action: 'apply', tz: 'America/Sao_Paulo' });
  const local = path.join(servico.baseDir, 'nova-locale.cmd');
  assert.strictEqual(fs.readFileSync(local, 'utf8'), 'action=apply\ntz=America/Sao_Paulo\n');
  assert.deepStrictEqual(palco.chamadas.map((c) => c.argumentos), [
    [...PREFIXO_DO_SSH, 'rm -f /var/tmp/nova-locale-status.json'],
    [...PREFIXO_DO_SCP, local, 'mobile@127.0.0.1:/var/tmp/nova-locale.cmd'],
  ]);
});

test('iosWaitLocaleStatus consulta a cada 1,2 s até o estado trazer ok verdadeiro ou falso, e desiste no limite com nulo', async (t) => {
  const servico = novoServico();
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const leituras = [null, { mensagem: 'sem ok' }, { ok: 'sim' }, { ok: false, message: 'recusou' }];
  palco.reiniciar(respostaDoSsh(() => ({ stdout: JSON.stringify(leituras.shift()) })));
  const resposta = await esperarComRelogioFalso(t, servico.iosWaitLocaleStatus(), 1200);
  assert.deepStrictEqual(resposta, { resposta: { ok: false, message: 'recusou' }, passos: 4 });

  palco.reiniciar(respostaDoSsh(() => ({ stdout: '' })));
  const desistiu = await esperarComRelogioFalso(t, servico.iosWaitLocaleStatus(5000), 1200);
  assert.deepStrictEqual(desistiu, { resposta: null, passos: 5 });
  assert.strictEqual(soSsh().length, 5);
  palco.reiniciar(respostaDoSsh(() => ({ stdout: '' })));
  const padrao = await esperarComRelogioFalso(t, servico.iosWaitLocaleStatus(), 1200);
  assert.deepStrictEqual(padrao, { resposta: null, passos: 21 });
});

const AJUDANTE_PRONTO = 'test -f /var/jb/Library/LaunchDaemons/com.aquiles.novalocale.plist && test -f /var/jb/usr/libexec/nova-locale.sh && echo ok';

function ajudanteDeFuso({ instalado = true, fusos = [], estado = { ok: true, message: 'feito' } } = {}) {
  const leituras = [...fusos];
  return respostaDoSsh((comando) => {
    if (comando === AJUDANTE_PRONTO) return { stdout: instalado ? 'ok' : '' };
    if (comando === 'readlink /var/db/timezone/localtime') return { stdout: `/var/db/timezone/zoneinfo/${leituras.shift()}` };
    if (comando.startsWith('cat /var/tmp/nova-locale-status')) return { stdout: JSON.stringify(estado) };
    return {};
  });
}

test('iosApplyLocale só vale para iPhone, com o ajudante instalado e um fuso de caracteres permitidos', async () => {
  const servico = novoServico();
  palco.reiniciar(ajudanteDeFuso());
  assert.deepStrictEqual(await servico.iosApplyLocale('android-1', 'America/Sao_Paulo'), { success: false, error: 'Só para iPhone.' });
  assert.deepStrictEqual(palco.chamadas, []);
  for (const fuso of [undefined, '', 'com espaço', 'a;b', 'x\ny']) {
    assert.deepStrictEqual(await servico.iosApplyLocale(ID_DO_IPHONE, fuso), { success: false, error: 'sem fuso para aplicar' }, String(fuso));
  }
  palco.reiniciar(ajudanteDeFuso({ instalado: false }));
  assert.deepStrictEqual(await servico.iosApplyLocale(ID_DO_IPHONE, 'America/Sao_Paulo'), { success: false, error: 'helper-not-installed', language: null });
  assert.deepStrictEqual(comandosDoSsh(), [AJUDANTE_PRONTO]);
});

test('iosApplyLocale não faz nada se o fuso já está certo, e senão manda o comando e confere o fuso do aparelho depois', async (t) => {
  const servico = novoServico();
  palco.reiniciar(ajudanteDeFuso({ fusos: ['Etc/GMT+5'] }));
  assert.deepStrictEqual(await servico.iosApplyLocale(ID_DO_IPHONE, 'Etc/GMT+5'), { success: true, timezone: 'Etc/GMT+5', message: 'fuso já estava certo' });
  assert.deepStrictEqual(palco.chamadas.filter((c) => c.tipo === 'execFile'), []);

  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  palco.reiniciar(ajudanteDeFuso({ fusos: ['UTC', 'Asia/Tokyo'] }));
  const aplicado = await esperarComRelogioFalso(t, servico.iosApplyLocale(ID_DO_IPHONE, 'Asia/Tokyo'), 1200);
  assert.deepStrictEqual(aplicado.resposta, { success: true, timezone: 'Asia/Tokyo', message: 'fuso aplicado' });
  assert.strictEqual(fs.readFileSync(path.join(servico.baseDir, 'nova-locale.cmd'), 'utf8'), 'action=apply\ntz=Asia/Tokyo\n');
  assert.deepStrictEqual(comandosDoSsh().map((c) => c.slice(0, 12)), [
    'test -f /var', 'readlink /va', 'rm -f /var/t', 'cat /var/tmp', 'readlink /va',
  ]);

  palco.reiniciar(ajudanteDeFuso({ fusos: ['UTC', 'UTC'] }));
  const diferente = await esperarComRelogioFalso(t, servico.iosApplyLocale(ID_DO_IPHONE, 'Asia/Tokyo'), 1200);
  assert.deepStrictEqual(diferente.resposta, { success: false, error: 'fuso UTC ≠ Asia/Tokyo', timezone: 'UTC' });
});

test('iosApplyLocale devolve o erro do scp e mostra ? quando o aparelho não diz o fuso', async (t) => {
  const servico = novoServico();
  palco.reiniciar((chamada) => (chamada.tipo === 'execFile' ? { erro: 'x', stderr: 'sem scp' } : ajudanteDeFuso({ fusos: ['UTC'] })(chamada)));
  assert.deepStrictEqual(await servico.iosApplyLocale(ID_DO_IPHONE, 'Asia/Tokyo'), { success: false, error: 'sem scp' });

  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const semFuso = respostaDoSsh((comando) => {
    if (comando === AJUDANTE_PRONTO) return { stdout: 'ok' };
    if (comando.startsWith('readlink')) return { erro: 'sem rota' };
    return { stdout: '{"ok":true}' };
  });
  palco.reiniciar(semFuso);
  const resposta = await esperarComRelogioFalso(t, servico.iosApplyLocale(ID_DO_IPHONE, 'Asia/Tokyo'), 1200);
  assert.deepStrictEqual(resposta.resposta, { success: false, error: 'fuso ? ≠ Asia/Tokyo', timezone: null });
});

test('iosRevertLocale manda o comando de reverter e devolve a mensagem do ajudante, ou o motivo de não ter dado certo', async (t) => {
  const servico = novoServico();
  assert.deepStrictEqual(await servico.iosRevertLocale('android-1'), { success: true });
  assert.deepStrictEqual(await servico.iosRevertLocale(undefined), { success: true });
  palco.reiniciar(ajudanteDeFuso({ instalado: false }));
  assert.deepStrictEqual(await servico.iosRevertLocale(ID_DO_IPHONE), { success: false, error: 'helper-not-installed' });

  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  palco.reiniciar(ajudanteDeFuso({ estado: { ok: true, message: 'revertido' } }));
  const revertido = await esperarComRelogioFalso(t, servico.iosRevertLocale(ID_DO_IPHONE), 1200);
  assert.deepStrictEqual(revertido, { resposta: { success: true, message: 'revertido' }, passos: 1 });
  assert.strictEqual(fs.readFileSync(path.join(servico.baseDir, 'nova-locale.cmd'), 'utf8'), 'action=revert\n');

  palco.reiniciar(ajudanteDeFuso({ estado: { ok: false, message: 'recusou' } }));
  assert.deepStrictEqual((await esperarComRelogioFalso(t, servico.iosRevertLocale(ID_DO_IPHONE), 1200)).resposta, { success: false, error: 'recusou' });
  palco.reiniciar(ajudanteDeFuso({ estado: { ok: false } }));
  assert.deepStrictEqual((await esperarComRelogioFalso(t, servico.iosRevertLocale(ID_DO_IPHONE), 1200)).resposta, { success: false, error: 'helper não respondeu' });
  palco.reiniciar(ajudanteDeFuso({ estado: null }));
  const semResposta = await esperarComRelogioFalso(t, servico.iosRevertLocale(ID_DO_IPHONE), 1200);
  assert.deepStrictEqual(semResposta, { resposta: { success: false, error: 'helper não respondeu' }, passos: 17 });
  palco.reiniciar((chamada) => (chamada.tipo === 'execFile' ? { erro: 'x', stderr: 'sem scp' } : ajudanteDeFuso()(chamada)));
  assert.deepStrictEqual(await servico.iosRevertLocale(ID_DO_IPHONE), { success: false, error: 'sem scp' });
});

test('a fachada do celular físico segue com os nomes do iPhone que o resto do app chama', () => {
  const servico = novoServico();
  const nomes = [
    'iosSsh', 'iosDeviceTimeZone', 'iosProxyRun', 'iosProxyError', 'iosProxySet', 'iosProxyClear', 'iosProxyStatus', 'iosProxyCheck',
    'getIosModels', 'applyIOSModel', 'clearIOSModel', 'getIOSModel', 'iosRun', 'getIosDevices', 'iosPrepared', 'iosStartStream', 'iosStopStream',
    'iosControlApp', 'iosAutomateBrowser', 'iosToggleSetting', 'iosLocaleStatus', 'iosLocaleHelperReady', 'iosScp', 'iosScpBase',
    'iosBuildLocalePlist', 'iosSendLocaleCommand', 'iosWaitLocaleStatus', 'iosPlistLanguage', 'iosApplyLocale', 'iosRevertLocale',
  ];
  for (const nome of nomes) assert.strictEqual(typeof servico[nome], 'function', nome);
});
