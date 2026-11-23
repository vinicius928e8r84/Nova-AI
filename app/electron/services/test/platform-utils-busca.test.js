'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { findBundledChromiumExecutable, findBundledBinDir, getChromiumCandidateSubpaths } = require('../platform-utils');

const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-platform-utils-'));
test.after(() => fs.rmSync(raiz, { recursive: true, force: true }));

const criarArquivo = (...partes) => {
  const arquivo = path.join(raiz, ...partes);
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  fs.writeFileSync(arquivo, '');
  return arquivo;
};

const [primeiroCandidato, ...outrosCandidatos] = getChromiumCandidateSubpaths();
const ultimoCandidato = outrosCandidatos.at(-1) || primeiroCandidato;

const contandoExistsSync = (fn) => {
  const original = fs.existsSync;
  const vistos = [];
  fs.existsSync = (caminho) => { vistos.push(caminho); return original(caminho); };
  try { return { resultado: fn(), vistos }; } finally { fs.existsSync = original; }
};

test('findBundledChromiumExecutable pula pasta vazia, ausente e que não é pasta, e acha na seguinte', () => {
  const arquivoComum = criarArquivo('nao-e-pasta');
  const exe = criarArquivo('b', 'chromium-1000', ultimoCandidato);
  criarArquivo('b', 'firefox-2000', primeiroCandidato);
  const dirs = [null, '', path.join(raiz, 'ausente'), arquivoComum, path.join(raiz, 'b')];
  const { resultado, vistos } = contandoExistsSync(() => findBundledChromiumExecutable(dirs));
  assert.strictEqual(resultado, exe);
  const esperados = [path.join(raiz, 'ausente'), arquivoComum, path.join(raiz, 'b'),
    ...getChromiumCandidateSubpaths().map((sub) => path.join(raiz, 'b', 'chromium-1000', sub))];
  assert.deepStrictEqual(vistos, esperados);
});

test('findBundledChromiumExecutable cai para a revisão menor quando a maior não tem executável', () => {
  fs.mkdirSync(path.join(raiz, 'c', 'chromium-1300'), { recursive: true });
  fs.mkdirSync(path.join(raiz, 'c', 'chromium-abc'), { recursive: true });
  const exe = criarArquivo('c', 'chromium-999', primeiroCandidato);
  const { resultado, vistos } = contandoExistsSync(() => findBundledChromiumExecutable([path.join(raiz, 'c')]));
  assert.strictEqual(resultado, exe);
  assert.deepStrictEqual(vistos.slice(1, 1 + getChromiumCandidateSubpaths().length),
    getChromiumCandidateSubpaths().map((sub) => path.join(raiz, 'c', 'chromium-1300', sub)));
  assert.strictEqual(vistos.at(-1), exe);
});

test('findBundledChromiumExecutable para na primeira pasta que tem executável', () => {
  const primeiro = criarArquivo('d1', 'chromium-1', primeiroCandidato);
  criarArquivo('d2', 'chromium-2', primeiroCandidato);
  assert.strictEqual(findBundledChromiumExecutable([path.join(raiz, 'd1'), path.join(raiz, 'd2')]), primeiro);
});

test('findBundledChromiumExecutable devolve null sem executável', () => {
  fs.mkdirSync(path.join(raiz, 'e', 'chromium-5'), { recursive: true });
  assert.strictEqual(findBundledChromiumExecutable([]), null);
  assert.strictEqual(findBundledChromiumExecutable([path.join(raiz, 'e'), undefined]), null);
});

const comResourcesPath = (valor, fn) => {
  const antes = process.resourcesPath;
  process.resourcesPath = valor;
  try { return fn(); } finally { process.resourcesPath = antes; }
};

const binDoCodigo = path.join(__dirname, '..', '..', '..', 'bin');

test('findBundledBinDir prefere resources/bin do app empacotado', () => {
  fs.mkdirSync(path.join(raiz, 'recursos', 'bin'), { recursive: true });
  assert.strictEqual(comResourcesPath(path.join(raiz, 'recursos'), findBundledBinDir), path.join(raiz, 'recursos', 'bin'));
});

test('findBundledBinDir sem resources/bin cai no bin do código ou em null', () => {
  const esperado = fs.existsSync(binDoCodigo) ? binDoCodigo : null;
  assert.strictEqual(comResourcesPath(path.join(raiz, 'sem-bin'), findBundledBinDir), esperado);
  assert.strictEqual(comResourcesPath(undefined, findBundledBinDir), esperado);
  const { vistos } = contandoExistsSync(() => comResourcesPath('', findBundledBinDir));
  assert.deepStrictEqual(vistos, [binDoCodigo]);
});
