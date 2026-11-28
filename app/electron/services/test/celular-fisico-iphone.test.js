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

const comStdout = (stdout) => () => ({ stdout });
const comFalha = (stderr) => () => ({ erro: 'falhou', stderr });
const semResposta = () => ({});

async function emSerie(itens, funcao) {
  const obtidos = [];
  for (const item of itens) obtidos.push(await funcao(item));
  return obtidos;
}

async function conferirCasos(casos, chamar) {
  const obtidos = await emSerie(casos, (caso) => {
    palco.reiniciar(caso.resposta);
    return chamar(caso);
  });
  assert.deepStrictEqual(obtidos, casos.map((caso) => caso.esperado));
}

const mensagemDaRejeicao = (promessa) => promessa.then(() => null, (erro) => erro.message);
const DOS_QUATRO_DO_PROXY = (servico, id) => Promise.all([servico.iosProxySet(id, 'p'), servico.iosProxyClear(id), servico.iosProxyStatus(id), servico.iosProxyCheck(id)]);
const DOS_TRES_DO_MODELO = (servico, id) => Promise.all([servico.applyIOSModel(id, 'iPhone15,4'), servico.clearIOSModel(id), servico.getIOSModel(id)]);

test('iosSsh monta o ssh do iPhone com chave, porta 2222, sem perguntas e limite de 12 s, e devolve saída e erro como texto', async () => {
  const servico = novoServico();
  palco.reiniciar(comStdout('saída do aparelho'));
  assert.deepStrictEqual(await servico.iosSsh('uname -a'), { ok: true, stdout: 'saída do aparelho', error: null });
  assert.deepStrictEqual(palco.chamadas, [{ tipo: 'ssh', argumentos: [...PREFIXO_DO_SSH, 'uname -a'], opcoes: { timeout: 12000 } }]);
  await conferirCasos([
    { resposta: comFalha('ssh: connect to host refused'), esperado: { ok: false, stdout: '', error: 'ssh: connect to host refused' } },
    { resposta: () => ({ erro: 'quebrou' }), esperado: { ok: false, stdout: '', error: 'quebrou' } },
  ], () => servico.iosSsh('x'));
});

const LEITURAS_PELO_SSH = [
  {
    nome: 'iosDeviceTimeZone lê o fuso do link do aparelho e devolve nulo se o ssh falha ou a saída não é um fuso',
    metodo: 'iosDeviceTimeZone',
    comando: 'readlink /var/db/timezone/localtime',
    casos: [[comStdout('/var/db/timezone/zoneinfo/America/Sao_Paulo\n'), 'America/Sao_Paulo'], [comStdout('outra coisa'), null], [() => ({ erro: 'sem rota' }), null]],
  },
  {
    nome: 'o estado do ajudante de fuso é lido do arquivo do aparelho, e nulo se não for JSON ou o ssh falhar',
    metodo: 'iosLocaleStatus',
    comando: 'cat /var/tmp/nova-locale-status.json 2>/dev/null',
    casos: [[comStdout(' {"ok":true,"message":"feito"} \n'), { ok: true, message: 'feito' }], [comStdout('lixo'), null], [() => ({ erro: 'sem rota' }), null]],
  },
  {
    nome: 'o ajudante de fuso só está pronto se os dois arquivos existem e o ssh respondeu',
    metodo: 'iosLocaleHelperReady',
    comando: 'test -f /var/jb/Library/LaunchDaemons/com.aquiles.novalocale.plist && test -f /var/jb/usr/libexec/nova-locale.sh && echo ok',
    casos: [[comStdout('ok\n'), true], [comStdout(''), false], [() => ({ erro: 'x', stdout: 'ok' }), false]],
  },
];

for (const leitura of LEITURAS_PELO_SSH) {
  test(leitura.nome, async () => {
    const servico = novoServico();
    await conferirCasos(leitura.casos.map(([resposta, esperado]) => ({ resposta: respostaDoSsh(resposta), esperado })), () => servico[leitura.metodo]());
    assert.deepStrictEqual(comandosDoSsh(), [leitura.comando]);
  });
}

test('iosProxyRun roda o novaproxy pelo ssh com o limite pedido (30 s por padrão) e tira os espaços da saída', async () => {
  const servico = novoServico();
  palco.reiniciar(comStdout('  on upstream=a  \n'));
  const saida = { ok: true, stdout: 'on upstream=a', error: null };
  assert.deepStrictEqual(await emSerie([['proxy status'], ['proxy clear', 15000]], ([args, limite]) => servico.iosProxyRun(args, limite)), [saida, saida]);
  assert.deepStrictEqual(palco.chamadas, [
    { tipo: 'ssh', argumentos: [...PREFIXO_DO_SSH, `${NOVAPROXY}proxy status`], opcoes: { timeout: 30000 } },
    { tipo: 'ssh', argumentos: [...PREFIXO_DO_SSH, `${NOVAPROXY}proxy clear`], opcoes: { timeout: 15000 } },
  ]);
  await conferirCasos([
    { resposta: comFalha('  a regra falhou \n'), esperado: { ok: false, stdout: '', error: 'a regra falhou' } },
    { resposta: () => ({ erro: 'falhou' }), esperado: { ok: false, stdout: '', error: 'falhou' } },
  ], () => servico.iosProxyRun('x'));
});

test('iosProxyError troca os três erros conhecidos por orientação e devolve o resto como veio', () => {
  const servico = novoServico();
  const instalar = 'O novaproxy ainda não está instalado no iPhone. Rode o instalador uma vez.';
  const sudo = 'A regra de sudo do novaproxy não está ativa no iPhone. Reinstale o pacote.';
  const terminal = 'O sudo do iPhone exige terminal. Reinstale o pacote (a regra NOPASSWD não entrou).';
  const padrao = 'Falha ao falar com o proxy do iPhone.';
  const casos = [
    ['bash: novaproxy: No such file or directory', instalar], ['sh: command not found', instalar], ['NOT FOUND', instalar],
    ['sudo: a password is required', sudo], ['Password is required', sudo],
    ['sudo: you must have a tty to run sudo', terminal], ['requiretty', terminal],
    ['  erro qualquer  ', 'erro qualquer'], ['', padrao], [null, padrao],
  ];
  assert.deepStrictEqual(casos.map(([bruto]) => servico.iosProxyError(bruto)), casos.map(([, esperado]) => esperado));
});

const GUARDAS_DE_IPHONE = [
  { nome: 'o proxy', ids: ['android-1', '', undefined, null], chamar: DOS_QUATRO_DO_PROXY, quantas: 4, aviso: 'O proxy está disponível apenas para iPhone.' },
  { nome: 'o modelo', ids: ['android-1', '', undefined], chamar: DOS_TRES_DO_MODELO, quantas: 3, aviso: 'O modelo é aplicável apenas ao iPhone.' },
];

for (const guarda of GUARDAS_DE_IPHONE) {
  test(`${guarda.nome} do iPhone só vale para iPhone e não chama o ssh para outro aparelho`, async () => {
    const servico = novoServico();
    const respostas = await emSerie(guarda.ids, (id) => guarda.chamar(servico, id));
    assert.deepStrictEqual(respostas, guarda.ids.map(() => Array(guarda.quantas).fill({ success: false, error: guarda.aviso })));
    assert.deepStrictEqual(palco.chamadas, []);
  });
}

test('o proxy do iPhone recusa o proxy vazio sem chamar o ssh', async () => {
  const servico = novoServico();
  const respostas = await emSerie(['   ', undefined], (proxy) => servico.iosProxySet(ID_DO_IPHONE, proxy));
  assert.deepStrictEqual(respostas, Array(2).fill({ success: false, error: 'Proxy vazio.' }));
  assert.deepStrictEqual(palco.chamadas, []);
});

test('o proxy do iPhone liga, limpa e confere pelo novaproxy, com a citação do endereço e o limite de cada um', async () => {
  const servico = novoServico();
  palco.reiniciar(comStdout('ok\n'));
  const respostas = [
    await servico.iosProxySet(ID_DO_IPHONE, " user:pa'ss@host:80 "),
    await servico.iosProxyClear(ID_DO_IPHONE),
    await servico.iosProxyCheck(ID_DO_IPHONE),
  ];
  assert.deepStrictEqual(respostas, [{ success: true, message: 'ok' }, { success: true, message: 'ok' }, { success: true, ip: 'ok' }]);
  assert.deepStrictEqual(palco.chamadas.map((c) => [comandoDoSsh(c), c.opcoes.timeout]), [
    [`${NOVAPROXY}proxy set 'user:pa'\\''ss@host:80'`, 30000],
    [`${NOVAPROXY}proxy clear`, 15000],
    [`${NOVAPROXY}proxy check`, 40000],
  ]);
});

test('o proxy do iPhone troca o erro do ssh pela orientação quando o novaproxy não está instalado', async () => {
  const servico = novoServico();
  palco.reiniciar(comFalha('bash: novaproxy: command not found'));
  const naoInstalado = { success: false, error: 'O novaproxy ainda não está instalado no iPhone. Rode o instalador uma vez.' };
  assert.deepStrictEqual(await DOS_QUATRO_DO_PROXY(servico, ID_DO_IPHONE), Array(4).fill(naoInstalado));
});

test('iosProxyStatus lê ligado, endereço, Wi-Fi e daemon da linha do novaproxy e usa padrões quando faltam', async () => {
  const servico = novoServico();
  const linhaCompleta = 'on upstream=host:80 wifi=enabled daemon=running';
  await conferirCasos([
    { resposta: comStdout(linhaCompleta), esperado: { success: true, on: true, upstream: 'host:80', wifi: 'enabled', daemon: true, raw: linhaCompleta } },
    { resposta: comStdout('off daemon=stopped'), esperado: { success: true, on: false, upstream: '', wifi: 'unknown', daemon: false, raw: 'off daemon=stopped' } },
    { resposta: comStdout('online'), esperado: { success: true, on: false, upstream: '', wifi: 'unknown', daemon: false, raw: 'online' } },
  ], () => servico.iosProxyStatus(ID_DO_IPHONE));
  assert.deepStrictEqual(palco.chamadas.map((c) => c.opcoes.timeout), [15000]);
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
  assert.deepStrictEqual(await DOS_TRES_DO_MODELO(servico, ID_DO_IPHONE), [
    { success: true, applied: { productType: 'iPhone15,4', name: modelo.name } },
    { success: true },
    { success: true, real: 'iPhone10,2', active: 'iPhone15,4', enabled: true },
  ]);
  assert.deepStrictEqual(comandos, [
    '/var/jb/usr/bin/novamodel set iPhone15,4', '/var/jb/usr/bin/novamodel clear', '/var/jb/usr/bin/novamodel status',
  ]);
});

test('o modelo do iPhone recusa o tipo inválido e o modelo fora do banco antes de chamar o ssh', async () => {
  const servico = novoServico();
  const respostas = await emSerie(['x; rm -rf', 42, 'Nope9,9'], (tipo) => servico.applyIOSModel(ID_DO_IPHONE, tipo));
  assert.deepStrictEqual(respostas, [
    { success: false, error: 'productType inválido.' },
    { success: false, error: 'productType inválido.' },
    { success: false, error: 'Modelo "Nope9,9" não está no banco iOS.' },
  ]);
  assert.deepStrictEqual(palco.chamadas, []);
});

test('o modelo do iPhone repassa o erro do ssh e recusa o status que não é JSON', async () => {
  const servico = novoServico();
  servico.iosSsh = async () => ({ ok: false, stdout: '', error: 'command not found' });
  assert.deepStrictEqual(await DOS_TRES_DO_MODELO(servico, ID_DO_IPHONE), Array(3).fill({ success: false, error: 'command not found' }));
  servico.iosSsh = async () => ({ ok: true, stdout: 'lixo', error: null });
  assert.deepStrictEqual(await servico.getIOSModel(ID_DO_IPHONE), { success: false, error: 'Status inválido do novamodel.', raw: 'lixo' });
});

test('iosRun roda o ideviceinstaller com limite de 25 s e sem janela, e devolve saída e erro como texto', async () => {
  const servico = novoServico();
  palco.reiniciar(comStdout('a,b'));
  assert.deepStrictEqual(await servico.iosRun(['list']), { ok: true, stdout: 'a,b', error: null });
  assert.deepStrictEqual(palco.chamadas, [
    { tipo: 'execFile', arquivo: 'FERRAMENTA-ideviceinstaller', argumentos: ['list'], opcoes: { timeout: 25000, windowsHide: true } },
  ]);
  await conferirCasos([
    { resposta: comFalha('sem aparelho'), esperado: { ok: false, stdout: '', error: 'sem aparelho' } },
    { resposta: () => ({ erro: 'falhou' }), esperado: { ok: false, stdout: '', error: 'falhou' } },
  ], () => servico.iosRun(['list']));
});

test('getIosDevices devolve a lista de iPhones, e lista vazia sem as duas ferramentas ou se listar falha', async () => {
  const servico = novoServico();
  const cenarios = [
    { aparelhos: [{ id: 'ios-1', name: 'iPhone' }], ferramentasDoIphone: true, esperado: [{ id: 'ios-1', name: 'iPhone' }] },
    { aparelhos: new Error('quebrou'), ferramentasDoIphone: true, esperado: [] },
    { aparelhos: [{ id: 'ios-1' }], ferramentasDoIphone: false, esperado: [] },
  ];
  const obtidos = await emSerie(cenarios, (cenario) => {
    Object.assign(palco, { aparelhos: cenario.aparelhos, ferramentasDoIphone: cenario.ferramentasDoIphone });
    return servico.getIosDevices();
  });
  assert.deepStrictEqual(obtidos, cenarios.map((cenario) => cenario.esperado));
});

test('iosPrepared olha o arquivo de chaves do aparelho na pasta do serviço e dá falso sem arquivo ou com arquivo quebrado', () => {
  const servico = novoServico();
  const arquivo = path.join(servico.baseDir, 'iphone-hosts.json');
  const chaves = JSON.stringify({ u1: 'f'.repeat(64), u2: '' });
  const passos = [
    [null, 'u1', false], [chaves, 'u1', true], [chaves, 'u2', false], [chaves, 'u3', false], ['null', 'u1', false], ['{quebrado', 'u1', false],
  ];
  const obtidos = passos.map(([conteudo, udid]) => {
    if (conteudo !== null) fs.writeFileSync(arquivo, conteudo);
    return servico.iosPrepared(udid);
  });
  assert.deepStrictEqual(obtidos, passos.map(([, , esperado]) => esperado));
});

const abrirConsole = async (servico, id = ID_DO_IPHONE) => {
  await servico.iosStartStream(id);
  return palco.janelas[palco.janelas.length - 1];
};

test('o console do iPhone abre uma janela com o endereço da ponte e sobe a ponte se ela está parada', async () => {
  const servico = novoServico();
  const aberto = await servico.iosStartStream(ID_DO_IPHONE);
  assert.deepStrictEqual(aberto, { success: true, message: 'Controle do iPhone aberto. Se pedir senha, use a do CatVNC (Ajustes > CatVNC).' });
  const [janela] = palco.janelas;
  assert.deepStrictEqual(janela.opcoes, {
    width: 1100, height: 820, title: 'iPhone Console', backgroundColor: '#050a10', webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  assert.deepStrictEqual([janela.enderecos, palco.ponte.iniciadas], [['http://127.0.0.1:8765/'], 1]);
  palco.ponte.rodando = true;
  await abrirConsole(servico, 'ios-outro');
  assert.strictEqual(palco.ponte.iniciadas, 1);
});

test('o console do iPhone foca a janela que o aparelho já tem e abre uma por aparelho', async () => {
  const servico = novoServico();
  const janela = await abrirConsole(servico);
  assert.deepStrictEqual(await servico.iosStartStream(ID_DO_IPHONE), { success: true, message: 'iPhone Console já estava aberto — trazido pra frente.' });
  assert.deepStrictEqual([janela.focos, palco.janelas.length], [1, 1]);
  await abrirConsole(servico, 'ios-outro');
  assert.strictEqual(palco.janelas.length, 2);
});

test('o console do iPhone fecha a janela do aparelho e abre outra depois que ela fechou ou foi destruída', async () => {
  const servico = novoServico();
  const primeira = await abrirConsole(servico);
  assert.deepStrictEqual(await servico.iosStopStream(ID_DO_IPHONE), { success: true });
  primeira.ouvintes.get('closed')();
  const segunda = await abrirConsole(servico);
  assert.deepStrictEqual([primeira.fechadas, palco.janelas.length], [1, 2]);
  segunda.destruida = true;
  const terceira = await abrirConsole(servico);
  assert.notStrictEqual(terceira, segunda);
  assert.deepStrictEqual([segunda.fechadas, palco.janelas.length], [0, 3]);
});

test('parar o console sem janela, com janela destruída ou que não fecha dá sucesso', async () => {
  const servico = novoServico();
  assert.deepStrictEqual(await servico.iosStopStream(ID_DO_IPHONE), { success: true });
  const janela = await abrirConsole(servico);
  janela.destruida = true;
  assert.deepStrictEqual(await servico.iosStopStream(ID_DO_IPHONE), { success: true });
  assert.strictEqual(janela.fechadas, 0);
  janela.destruida = false;
  palco.falhaAoFechar = true;
  assert.deepStrictEqual(await servico.iosStopStream(ID_DO_IPHONE), { success: true });
  assert.strictEqual(janela.fechadas, 1);
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

test('iosControlApp abre pelo uiopen nos três nomes da ação e recusa o que tem espaço no começo', async () => {
  const servico = novoServico();
  palco.reiniciar(respostaDoSsh(semResposta));
  const acoes = ['launch', 'open', 'start', 'LAUNCH', ' open'];
  const respostas = await emSerie(acoes, (acao) => servico.iosControlApp(ID_DO_IPHONE, 'com.whatsapp', acao));
  const aberto = { success: true };
  assert.deepStrictEqual(respostas, [aberto, aberto, aberto, aberto, { success: false, error: 'Ação não suportada no iOS:  open' }]);
});

test('iosControlApp troca o nome de app do Android pelo do iPhone e deixa os outros como estão', async () => {
  const servico = novoServico();
  const apelidos = {
    'com.whatsapp.w4b': 'net.whatsapp.Whatsapp', 'com.instagram.android': 'com.burbn.instagram', 'com.android.chrome': 'com.apple.mobilesafari',
    'com.facebook.katana': 'com.facebook.Facebook', 'com.google.android.youtube': 'com.google.ios.youtube', 'com.tencent.mm': 'com.tencent.xinWeChat',
    'com.zhiliaoapp.musically': 'com.zhiliaoapp.musically', 'com.exemplo.sem.apelido': 'com.exemplo.sem.apelido',
  };
  palco.reiniciar(respostaDoSsh(semResposta));
  await emSerie(Object.keys(apelidos), (origem) => servico.iosControlApp(ID_DO_IPHONE, origem, 'open'));
  assert.deepStrictEqual(comandosDoSsh(), Object.values(apelidos).map((destino) => `uiopen --bundleid ${JSON.stringify(destino)}`));
  palco.reiniciar(respostaDoSsh(comFalha('não abriu')));
  assert.deepStrictEqual(await servico.iosControlApp(ID_DO_IPHONE, 'com.x', 'open'), { success: false, error: 'não abriu' });
});

test('iosControlApp lista os apps do ideviceinstaller, com o que vier mesmo se o comando falhou', async () => {
  const servico = novoServico();
  const saida = ['CFBundleIdentifier, CFBundleVersion, CFBundleDisplayName', '"com.a.um", "1.0", "App Um"', '', '   ', '"com.b.dois", "2"', ',"x","y"', 'com.c.tres'].join('\n');
  await conferirCasos([
    {
      resposta: comStdout(saida),
      esperado: { success: true, apps: [{ packageName: 'com.a.um', name: 'App Um' }, { packageName: 'com.b.dois', name: 'com.b.dois' }, { packageName: 'com.c.tres', name: 'com.c.tres' }] },
    },
    { resposta: comFalha('sem aparelho'), esperado: { success: false, error: 'sem aparelho', apps: [] } },
    { resposta: () => ({ erro: 'falhou', stdout: 'com.parcial,1,Parcial' }), esperado: { success: true, apps: [{ packageName: 'com.parcial', name: 'Parcial' }] } },
  ], () => servico.iosControlApp(ID_DO_IPHONE, null, 'list'));
  assert.deepStrictEqual(palco.chamadas.map((c) => c.argumentos), [['list']]);
});

test('iosControlApp desinstala pelo pacote do iPhone, nos dois nomes da ação, e repassa o erro', async () => {
  const servico = novoServico();
  palco.reiniciar(semResposta);
  const respostas = await emSerie(['uninstall', 'remove'], (acao) => servico.iosControlApp(ID_DO_IPHONE, 'com.android.chrome', acao));
  assert.deepStrictEqual(respostas, [{ success: true }, { success: true }]);
  assert.deepStrictEqual(palco.chamadas.map((c) => c.argumentos), [['uninstall', 'com.apple.mobilesafari'], ['uninstall', 'com.apple.mobilesafari']]);
  await conferirCasos([{ resposta: comFalha('não saiu'), esperado: { success: false, error: 'não saiu' } }], () => servico.iosControlApp(ID_DO_IPHONE, 'com.x', 'uninstall'));
});

test('iosControlApp recusa ação desconhecida ou vazia, e trata nomes herdados do objeto como pacote comum', async () => {
  const servico = novoServico();
  palco.reiniciar(semResposta);
  const casos = [['stop', 'stop'], [undefined, ''], ['constructor', 'constructor'], ['toString', 'tostring']];
  const respostas = await emSerie(casos, ([acao]) => servico.iosControlApp(ID_DO_IPHONE, 'com.x', acao));
  assert.deepStrictEqual(respostas, casos.map(([, escrita]) => ({ success: false, error: `Ação não suportada no iOS: ${escrita}` })));
  assert.deepStrictEqual(palco.chamadas, []);
  await servico.iosControlApp(ID_DO_IPHONE, 'constructor', 'open');
  assert.deepStrictEqual(comandosDoSsh(), ['uiopen --bundleid "function Object() { [native code] }"']);
});

test('iosAutomateBrowser abre a URL com https quando falta o esquema, busca no Google se só há texto e recusa o vazio', async () => {
  const servico = novoServico();
  palco.reiniciar(semResposta);
  const casos = [
    [['exemplo.com/a b', 'ignorado'], 'https://exemplo.com/a b'],
    [['http://exemplo.com', undefined], 'http://exemplo.com'],
    [['tel:123', undefined], 'https://tel:123'],
    [['', 'café com leite'], 'https://www.google.com/search?q=caf%C3%A9%20com%20leite'],
    [[undefined, 'a&b'], 'https://www.google.com/search?q=a%26b'],
  ];
  const respostas = await emSerie(casos, ([[url, busca]]) => servico.iosAutomateBrowser(ID_DO_IPHONE, url, busca));
  assert.deepStrictEqual(respostas, Array(casos.length).fill({ success: true }));
  assert.deepStrictEqual(comandosDoSsh(), casos.map(([, aberto]) => `uiopen ${JSON.stringify(aberto)}`));
});

test('iosToggleSetting roda o atalho Nova de Wi-Fi ou Bluetooth ligado ou desligado', async () => {
  const servico = novoServico();
  palco.reiniciar(semResposta);
  const casos = [['wifi', true, 'Nova WiFi On'], ['WiFi', false, 'Nova WiFi Off'], ['bluetooth', true, 'Nova BT On'], ['BLUETOOTH', 0, 'Nova BT Off']];
  const respostas = await emSerie(casos, ([ajuste, ligar]) => servico.iosToggleSetting(ID_DO_IPHONE, ajuste, ligar));
  assert.deepStrictEqual(respostas, Array(casos.length).fill({ success: true }));
  assert.deepStrictEqual(comandosDoSsh(), casos.map(([, , atalho]) => `uiopen ${JSON.stringify(`shortcuts://run-shortcut?name=${encodeURIComponent(atalho)}`)}`));
});

const RECUSAS_DE_ATALHO = [
  {
    nome: 'iosAutomateBrowser recusa o pedido vazio sem chamar o ssh e repassa o erro do ssh',
    chamar: (servico, ...argumentos) => servico.iosAutomateBrowser(ID_DO_IPHONE, ...argumentos),
    recusados: [['', ''], []],
    recusa: { success: false, error: 'Sem URL.' },
    aceito: ['a.com'],
  },
  {
    nome: 'iosToggleSetting recusa o ajuste que não conhece sem chamar o ssh e repassa o erro do ssh',
    chamar: (servico, ...argumentos) => servico.iosToggleSetting(ID_DO_IPHONE, ...argumentos),
    recusados: [['nfc', true], [undefined, true]],
    recusa: { success: false, error: 'Unsupported setting.' },
    aceito: ['wifi', true],
  },
];

for (const recusa of RECUSAS_DE_ATALHO) {
  test(recusa.nome, async () => {
    const servico = novoServico();
    palco.reiniciar(semResposta);
    const recusados = await emSerie(recusa.recusados, (argumentos) => recusa.chamar(servico, ...argumentos));
    assert.deepStrictEqual(recusados, recusa.recusados.map(() => recusa.recusa));
    assert.deepStrictEqual(palco.chamadas, []);
    await conferirCasos([{ resposta: comFalha('não abriu'), esperado: { success: false, error: 'não abriu' } }], () => recusa.chamar(servico, ...recusa.aceito));
  });
}

test('iosScpBase monta os argumentos do scp para baixar do aparelho e, nos outros casos, para subir', () => {
  const servico = novoServico();
  const baixar = [...PREFIXO_DO_SCP, 'mobile@127.0.0.1:/remoto/a', '/local/a'];
  const subir = [...PREFIXO_DO_SCP, '/local/a', 'mobile@127.0.0.1:/remoto/a'];
  const sentidos = ['from', 'to', undefined];
  assert.deepStrictEqual(sentidos.map((sentido) => servico.iosScpBase('/remoto/a', '/local/a', sentido)), [baixar, subir, subir]);
});

test('iosScp roda o scp com limite de 30 s e sem janela, e rejeita com os 200 primeiros caracteres do erro', async () => {
  const servico = novoServico();
  palco.reiniciar(semResposta);
  assert.strictEqual(await servico.iosScp(['a', 'b']), true);
  assert.deepStrictEqual(palco.chamadas, [{ tipo: 'execFile', arquivo: 'SCP', argumentos: ['a', 'b'], opcoes: { timeout: 30000, windowsHide: true } }]);
  const casos = [
    { resposta: comFalha('x'.repeat(300)), esperado: 'x'.repeat(200) },
    { resposta: () => ({ erro: 'falhou sem texto' }), esperado: 'falhou sem texto' },
  ];
  await conferirCasos(casos, () => mensagemDaRejeicao(servico.iosScp(['a'])));
});

test('iosBuildLocalePlist baixa o plist, grava idioma e locale e sobe de volta, e para no erro do scp', async () => {
  const servico = novoServico();
  palco.reiniciar(semResposta);
  const local = path.join(servico.baseDir, 'nova-globalprefs.plist');
  assert.strictEqual(await servico.iosBuildLocalePlist('pt-BR', 'pt_BR'), local);
  assert.deepStrictEqual(palco.plist.gravacoes, [[local, 'pt-BR', 'pt_BR']]);
  assert.deepStrictEqual(palco.chamadas.map((c) => c.argumentos), [
    [...PREFIXO_DO_SCP, `mobile@127.0.0.1:${PERFIL_DO_ARQUIVO_DE_IDIOMAS}`, local],
    [...PREFIXO_DO_SCP, local, 'mobile@127.0.0.1:/var/tmp/nova-gp.plist'],
  ]);
  palco.reiniciar((chamada) => (chamada.tipo === 'execFile' ? { erro: 'x', stderr: 'sem scp' } : {}));
  assert.strictEqual(await mensagemDaRejeicao(servico.iosBuildLocalePlist('pt-BR', 'pt_BR')), 'sem scp');
  assert.strictEqual(palco.plist.gravacoes.length, 1);
});

test('iosPlistLanguage baixa o plist para a pasta do serviço e devolve o primeiro idioma', async () => {
  const servico = novoServico();
  palco.reiniciar(semResposta);
  assert.strictEqual(await servico.iosPlistLanguage(), 'pt-BR');
  const verificacao = path.join(servico.baseDir, 'nova-globalprefs-check.plist');
  assert.deepStrictEqual(palco.chamadas.map((c) => c.argumentos || c.arquivo), [
    [...PREFIXO_DO_SCP, `mobile@127.0.0.1:${PERFIL_DO_ARQUIVO_DE_IDIOMAS}`, verificacao], verificacao,
  ]);
});

test('iosSendLocaleCommand apaga o estado antigo, grava o comando em linhas campo=valor e sobe pelo scp', async () => {
  const servico = novoServico();
  palco.reiniciar(semResposta);
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
  const casos = [
    { resposta: respostaDoSsh(() => ({ stdout: JSON.stringify(leituras.shift()) })), limite: undefined, esperado: { resposta: { ok: false, message: 'recusou' }, passos: 4 } },
    { resposta: respostaDoSsh(comStdout('')), limite: 5000, esperado: { resposta: null, passos: 5 } },
    { resposta: respostaDoSsh(comStdout('')), limite: undefined, esperado: { resposta: null, passos: 21 } },
  ];
  const obtidos = await emSerie(casos, (caso) => {
    palco.reiniciar(caso.resposta);
    return esperarComRelogioFalso(t, servico.iosWaitLocaleStatus(caso.limite), 1200);
  });
  assert.deepStrictEqual(obtidos, casos.map((caso) => caso.esperado));
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

async function aplicarFusoComRelogio(t, servico, ajudante, fuso) {
  palco.reiniciar(ajudanteDeFuso(ajudante));
  return (await esperarComRelogioFalso(t, servico.iosApplyLocale(ID_DO_IPHONE, fuso), 1200)).resposta;
}

async function reverterFusoComRelogio(t, servico, ajudante) {
  palco.reiniciar(ajudanteDeFuso(ajudante));
  return esperarComRelogioFalso(t, servico.iosRevertLocale(ID_DO_IPHONE), 1200);
}

test('iosApplyLocale só vale para iPhone e para um fuso de caracteres permitidos', async () => {
  const servico = novoServico();
  palco.reiniciar(ajudanteDeFuso());
  assert.deepStrictEqual(await servico.iosApplyLocale('android-1', 'America/Sao_Paulo'), { success: false, error: 'Só para iPhone.' });
  assert.deepStrictEqual(palco.chamadas, []);
  const respostas = await emSerie([undefined, '', 'com espaço', 'a;b', 'x\ny'], (fuso) => servico.iosApplyLocale(ID_DO_IPHONE, fuso));
  assert.deepStrictEqual(respostas, Array(5).fill({ success: false, error: 'sem fuso para aplicar' }));
});

test('iosApplyLocale responde sem mandar comando quando o ajudante falta ou o fuso já está certo', async () => {
  const servico = novoServico();
  const comandos = [];
  const casos = [
    { resposta: ajudanteDeFuso({ instalado: false }), fuso: 'America/Sao_Paulo', esperado: { success: false, error: 'helper-not-installed', language: null } },
    { resposta: ajudanteDeFuso({ fusos: ['Etc/GMT+5'] }), fuso: 'Etc/GMT+5', esperado: { success: true, timezone: 'Etc/GMT+5', message: 'fuso já estava certo' } },
  ];
  await conferirCasos(casos, async (caso) => {
    const resposta = await servico.iosApplyLocale(ID_DO_IPHONE, caso.fuso);
    comandos.push(comandosDoSsh().map((comando) => comando.slice(0, 12)));
    return resposta;
  });
  assert.deepStrictEqual(comandos, [['test -f /var'], ['test -f /var', 'readlink /va']]);
  assert.deepStrictEqual(palco.chamadas.filter((c) => c.tipo === 'execFile'), []);
});

test('iosApplyLocale manda o comando, espera o ajudante e confere o fuso do aparelho depois', async (t) => {
  const servico = novoServico();
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const casos = [
    { ajudante: { fusos: ['UTC', 'Asia/Tokyo'] }, esperado: { success: true, timezone: 'Asia/Tokyo', message: 'fuso aplicado' } },
    { ajudante: { fusos: ['UTC', 'UTC'] }, esperado: { success: false, error: 'fuso UTC ≠ Asia/Tokyo', timezone: 'UTC' } },
  ];
  const respostas = [];
  for (const caso of casos) {
    respostas.push(await aplicarFusoComRelogio(t, servico, caso.ajudante, 'Asia/Tokyo'));
    assert.strictEqual(fs.readFileSync(path.join(servico.baseDir, 'nova-locale.cmd'), 'utf8'), 'action=apply\ntz=Asia/Tokyo\n');
  }
  assert.deepStrictEqual(respostas, casos.map((caso) => caso.esperado));
  assert.deepStrictEqual(comandosDoSsh().map((c) => c.slice(0, 12)), ['test -f /var', 'readlink /va', 'rm -f /var/t', 'cat /var/tmp', 'readlink /va']);
});

test('iosApplyLocale devolve o erro do scp e mostra ? quando o aparelho não diz o fuso', async (t) => {
  const servico = novoServico();
  palco.reiniciar((chamada) => (chamada.tipo === 'execFile' ? { erro: 'x', stderr: 'sem scp' } : ajudanteDeFuso({ fusos: ['UTC'] })(chamada)));
  assert.deepStrictEqual(await servico.iosApplyLocale(ID_DO_IPHONE, 'Asia/Tokyo'), { success: false, error: 'sem scp' });

  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  palco.reiniciar(respostaDoSsh((comando) => {
    if (comando === AJUDANTE_PRONTO) return { stdout: 'ok' };
    return comando.startsWith('readlink') ? { erro: 'sem rota' } : { stdout: '{"ok":true}' };
  }));
  const resposta = await esperarComRelogioFalso(t, servico.iosApplyLocale(ID_DO_IPHONE, 'Asia/Tokyo'), 1200);
  assert.deepStrictEqual(resposta.resposta, { success: false, error: 'fuso ? ≠ Asia/Tokyo', timezone: null });
});

test('iosRevertLocale só trabalha para iPhone com o ajudante instalado', async () => {
  const servico = novoServico();
  assert.deepStrictEqual(await emSerie(['android-1', undefined], (id) => servico.iosRevertLocale(id)), Array(2).fill({ success: true }));
  palco.reiniciar(ajudanteDeFuso({ instalado: false }));
  assert.deepStrictEqual(await servico.iosRevertLocale(ID_DO_IPHONE), { success: false, error: 'helper-not-installed' });
});

test('iosRevertLocale manda o comando de reverter e devolve a mensagem do ajudante, ou o motivo de não ter dado certo', async (t) => {
  const servico = novoServico();
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const casos = [
    { estado: { ok: true, message: 'revertido' }, esperado: { resposta: { success: true, message: 'revertido' }, passos: 1 } },
    { estado: { ok: false, message: 'recusou' }, esperado: { resposta: { success: false, error: 'recusou' }, passos: 1 } },
    { estado: { ok: false }, esperado: { resposta: { success: false, error: 'helper não respondeu' }, passos: 1 } },
    { estado: null, esperado: { resposta: { success: false, error: 'helper não respondeu' }, passos: 17 } },
  ];
  const obtidos = await emSerie(casos, (caso) => reverterFusoComRelogio(t, servico, { estado: caso.estado }));
  assert.deepStrictEqual(obtidos, casos.map((caso) => caso.esperado));
  assert.strictEqual(fs.readFileSync(path.join(servico.baseDir, 'nova-locale.cmd'), 'utf8'), 'action=revert\n');
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
  assert.deepStrictEqual(nomes.filter((nome) => typeof servico[nome] !== 'function'), []);
});
