'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');

const caminhoDoModulo = path.join(__dirname, '..', 'mac-native.js');
const carregadorOriginal = Module._load;

let cena;

function execFileFalso(arquivo, args, opcoes, retorno) {
  cena.chamadas.push({ arquivo, args, opcoes });
  const erro = cena.falha ? new Error(cena.falha) : null;
  retorno(erro, cena.saida);
}

const clipboardFalso = {
  readText: () => { cena.chamadas.push('clipboard:read'); return 'anterior'; },
  writeText: (texto) => { cena.chamadas.push(`clipboard:write:${texto}`); },
};

const DUBLES = {
  child_process: () => ({ execFile: execFileFalso }),
  electron: () => ({ clipboard: clipboardFalso }),
  playwright: () => ({ chromium: { executablePath: () => cena.playwright } }),
  './platform-utils': () => ({ findBundledChromiumExecutable: (raizes) => { cena.chamadas.push({ raizes }); return cena.embutido; } }),
};

Module._load = function (pedido, ...resto) {
  if (Object.hasOwn(DUBLES, pedido)) return DUBLES[pedido]();
  return carregadorOriginal.call(this, pedido, ...resto);
};
test.after(() => { Module._load = carregadorOriginal; });

function carregar() {
  delete require.cache[caminhoDoModulo];
  return require(caminhoDoModulo);
}

function novaCena(extra = {}) {
  cena = { chamadas: [], saida: '  feito \n', falha: null, playwright: null, embutido: null, ...extra };
  return carregar();
}

const motivo = (promessa) => promessa.then(() => 'ok', (erro) => `${erro.constructor.name}: ${erro.message}`);

const TECLAS = ['enter', 'Cmd+C', 'ctrl+shift+t', 'alt+F4', 'ALT+TAB', 'a', 'F12', 'option+left', 'meta+z', 'hyper+a', 'ctrl+', 'abc', 'shift+"', 'constructor', 'constructor+a'];

const ESPERADO_DAS_TECLAS = [
  'tell application "System Events" to key code 36',
  'tell application "System Events" to keystroke "c" using {command down}',
  'tell application "System Events" to keystroke "t" using {command down,shift down}',
  'tell application "System Events" to keystroke "w" using {command down}',
  'tell application "System Events" to key code 48 using {command down}',
  'tell application "System Events" to keystroke "a"',
  'tell application "System Events" to key code 111',
  'tell application "System Events" to key code 123 using {option down}',
  'tell application "System Events" to keystroke "z" using {command down}',
  'Error: Unknown key modifier',
  'Error: Unknown key: ctrl+',
  'Error: Unknown key: abc',
  'tell application "System Events" to keystroke "\\"" using {shift down}',
  'tell application "System Events" to key code function Object() { [native code] }',
  'tell application "System Events" to keystroke "a" using {function Object() { [native code] }}',
];

test('pressKey: script do osascript por tecla, atalhos do Windows e erros', async () => {
  const modulo = novaCena();
  const obtido = [];
  for (const tecla of TECLAS) {
    cena.chamadas = [];
    const resultado = await modulo.pressKey(tecla).catch((erro) => `${erro.constructor.name}: ${erro.message}`);
    if (typeof resultado === 'string') { obtido.push(resultado); continue; }
    assert.deepStrictEqual(resultado, { success: true, key: tecla });
    assert.strictEqual(cena.chamadas.length, 1);
    assert.strictEqual(cena.chamadas[0].arquivo, '/usr/bin/osascript');
    assert.deepStrictEqual(cena.chamadas[0].opcoes, { timeout: 15000 });
    assert.strictEqual(cena.chamadas[0].args[0], '-e');
    obtido.push(cena.chamadas[0].args[1]);
  }
  assert.deepStrictEqual(obtido, ESPERADO_DAS_TECLAS);
  assert.strictEqual(await motivo(modulo.pressKey(5)), 'TypeError: key.toLowerCase is not a function');
});

test('run: junta as opções, apara a saída e rejeita com o erro do execFile', async () => {
  const modulo = novaCena();
  assert.strictEqual(await modulo.run('/bin/x', ['a'], { cwd: '/tmp', timeout: 3 }), 'feito');
  assert.deepStrictEqual(cena.chamadas, [{ arquivo: '/bin/x', args: ['a'], opcoes: { timeout: 3, cwd: '/tmp' } }]);
  assert.strictEqual(await modulo.run('/bin/y'), 'feito');
  assert.deepStrictEqual(cena.chamadas[1], { arquivo: '/bin/y', args: [], opcoes: { timeout: 15000 } });
  cena.falha = 'caiu';
  assert.strictEqual(await motivo(modulo.apple('beep')), 'Error: caiu');
  assert.deepStrictEqual(cena.chamadas[2].args, ['-e', 'beep']);
  assert.strictEqual(modulo.quote(12), '"12"');
});

test('typeText: cola pelo Cmd+V, Enter opcional e devolve a área de transferência', async () => {
  const modulo = novaCena();
  const resumo = () => cena.chamadas.map((chamada) => (typeof chamada === 'string' ? chamada : chamada.args[1]));
  assert.deepStrictEqual(await modulo.typeText('oi'), { success: true, typed: 'oi', enterPressed: false });
  assert.deepStrictEqual(resumo(), ['clipboard:read', 'clipboard:write:oi', 'tell application "System Events" to keystroke "v" using {command down}', 'clipboard:write:anterior']);
  cena.chamadas = [];
  assert.deepStrictEqual(await modulo.typeText(42, 'sim'), { success: true, typed: 42, enterPressed: true });
  assert.deepStrictEqual(resumo(), ['clipboard:read', 'clipboard:write:42', 'tell application "System Events" to keystroke "v" using {command down}', 'tell application "System Events" to key code 36', 'clipboard:write:anterior']);
  cena.chamadas = [];
  cena.falha = 'sem permissão';
  assert.strictEqual(await motivo(modulo.typeText('x', true)), 'Error: sem permissão');
  assert.deepStrictEqual(resumo().slice(-1), ['clipboard:write:anterior']);
});

function criarExecutavel(arquivo, modo = 0o755) {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  fs.writeFileSync(arquivo, '');
  fs.chmodSync(arquivo, modo);
  return arquivo;
}

function comAmbiente({ resources, home, pathDoSistema }, acao) {
  const antes = { resources: process.resourcesPath, home: process.env.HOME, path: process.env.PATH };
  const existsOriginal = fs.existsSync;
  fs.existsSync = (p) => String(p).startsWith(path.dirname(home)) && existsOriginal(p);
  process.env.HOME = home;
  process.env.PATH = pathDoSistema;
  if (resources) process.resourcesPath = resources; else delete process.resourcesPath;
  try { return acao(); } finally {
    fs.existsSync = existsOriginal;
    process.env.HOME = antes.home;
    process.env.PATH = antes.path;
    if (antes.resources === undefined) delete process.resourcesPath; else process.resourcesPath = antes.resources;
  }
}

test('tool: primeira pasta com o executável, resources/bin antes do PATH', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mac-native-'));
  const modulo = novaCena();
  const noPath = criarExecutavel(path.join(base, 'p2', 'nova-ferramenta-de-teste'));
  criarExecutavel(path.join(base, 'p1', 'nova-ferramenta-de-teste'), 0o644);
  const ambiente = { resources: path.join(base, 'res'), home: path.join(base, 'home'), pathDoSistema: `${path.join(base, 'p1')}::${path.join(base, 'p2')}` };
  assert.strictEqual(comAmbiente(ambiente, () => modulo.tool('nova-ferramenta-de-teste')), noPath);
  const emResources = criarExecutavel(path.join(base, 'res', 'bin', 'nova-ferramenta-de-teste'));
  assert.strictEqual(comAmbiente(ambiente, () => modulo.tool('nova-ferramenta-de-teste')), emResources);
  assert.strictEqual(comAmbiente({ ...ambiente, pathDoSistema: '' }, () => modulo.tool('nada-disso')), null);
  fs.rmSync(base, { recursive: true, force: true });
});

test('browser: ordem de procura, Firefox minúsculo, reserva só para o Chrome', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mac-native-'));
  const ambiente = { resources: path.join(base, 'res'), home: path.join(base, 'home'), pathDoSistema: '' };
  const app = (raiz, nome, exe = nome) => path.join(raiz, `${nome}.app`, 'Contents', 'MacOS', exe);
  const modulo = novaCena({ embutido: '' });
  const naHome = criarExecutavel(app(path.join(base, 'home', 'Applications'), 'Google Chrome for Testing'));
  assert.strictEqual(comAmbiente(ambiente, () => modulo.browser()), naHome);
  const embutido = criarExecutavel(app(path.join(base, 'res', 'browsers', 'chrome'), 'Google Chrome'));
  assert.strictEqual(comAmbiente(ambiente, () => modulo.browser('desconhecido')), naHome);
  assert.strictEqual(comAmbiente(ambiente, () => modulo.browser()), embutido);
  const instalado = criarExecutavel(app(path.join(base, 'home', 'Applications'), 'Google Chrome'));
  assert.strictEqual(comAmbiente(ambiente, () => modulo.browser()), instalado);
  assert.strictEqual(comAmbiente(ambiente, () => modulo.browser('firefox')), null);
  const firefox = criarExecutavel(app(path.join(base, 'res', 'browsers', 'firefox'), 'Firefox', 'firefox'));
  assert.strictEqual(comAmbiente(ambiente, () => modulo.browser('firefox')), firefox);
  assert.deepStrictEqual(cena.chamadas, []);
  fs.rmSync(path.join(base, 'res'), { recursive: true, force: true });
  fs.rmSync(path.join(base, 'home'), { recursive: true, force: true });
  cena.embutido = path.join(base, 'chromium');
  assert.strictEqual(comAmbiente(ambiente, () => modulo.browser('chrome')), cena.embutido);
  assert.deepStrictEqual(cena.chamadas, [{ raizes: [path.join(base, 'res', 'browsers'), path.resolve(__dirname, '..', '..', '..', 'browsers')] }]);
  cena.embutido = null;
  cena.playwright = criarExecutavel(path.join(base, 'playwright', 'chrome'));
  assert.strictEqual(comAmbiente(ambiente, () => modulo.browser('chrome')), cena.playwright);
  cena.playwright = path.join(base, 'nao-existe');
  assert.strictEqual(comAmbiente(ambiente, () => modulo.browser('chrome')), null);
  assert.strictEqual(comAmbiente({ ...ambiente, resources: null }, () => modulo.browser('chrome')), null);
  assert.deepStrictEqual(cena.chamadas.at(-1), { raizes: [path.resolve(__dirname, '..', '..', '..', 'browsers')] });
  assert.throws(() => comAmbiente(ambiente, () => modulo.browser('toString')), TypeError);
  fs.rmSync(base, { recursive: true, force: true });
});
