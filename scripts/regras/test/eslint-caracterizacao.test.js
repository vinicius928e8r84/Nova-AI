'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { verificar } = require('../regra-eslint');

const CONFIGURACAO = path.join(__dirname, '..', 'eslint.config.mjs');
const FALSO = `const fs = require('fs');
const path = require('path');
const pasta = __dirname;
fs.appendFileSync(path.join(pasta, 'chamadas.txt'), JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }) + '\\n');
process.stderr.write(fs.readFileSync(path.join(pasta, 'erro.txt'), 'utf8'));
process.stdout.write(fs.readFileSync(path.join(pasta, 'saida.txt'), 'utf8'));
`;

function eslintFalso({ saida, erro = '' }) {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'eslint-falso-'));
  fs.writeFileSync(path.join(pasta, 'eslint.js'), FALSO);
  fs.writeFileSync(path.join(pasta, 'saida.txt'), saida);
  fs.writeFileSync(path.join(pasta, 'erro.txt'), erro);
  const chamadas = () => {
    const arquivo = path.join(pasta, 'chamadas.txt');
    return fs.existsSync(arquivo) ? fs.readFileSync(arquivo, 'utf8').trim().split('\n').map(linha => JSON.parse(linha)) : [];
  };
  return { bin: path.join(pasta, 'eslint.js'), chamadas, limpar: () => fs.rmSync(pasta, { recursive: true, force: true }) };
}

const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-do-eslint-'));
test.after(() => fs.rmSync(raiz, { recursive: true, force: true }));

function ctxDe(env, arquivos) {
  const avisos = [];
  const ctx = {
    raiz,
    env,
    arquivos: arquivos.map(([caminho, status = 'M']) => ({ caminho, status })),
    config: { ignorarCodigo: ['app/dist/assets/**'] },
    mudancas: {
      copias: new Set(['app/copia.js']),
      acrescentadas: new Map([
        ['app/a.js', new Set([2, 5])], ['app/b.mjs', new Set([1])], ['app/c.cjs', new Set([3])], ['app/vazio.js', new Set()],
        ['app/x.ts', new Set([1])], ['app/copia.js', new Set([1])], ['app/dist/assets/bundle.js', new Set([1])], ['app/apagado.js', new Set([1])],
        ['app/fora.js', new Set([1])],
      ]),
    },
    aviso: mensagem => avisos.push(mensagem),
  };
  return { ctx, avisos };
}

const TODOS = [['app/a.js'], ['app/b.mjs'], ['app/c.cjs'], ['app/vazio.js'], ['app/sem-novas.js'], ['app/x.ts'], ['app/copia.js'],
  ['app/dist/assets/bundle.js'], ['app/apagado.js', 'D'], ['app/leia.md']];

test('eslint: só JS com linha nova vai para o ESLint, e só a linha nova vira achado', () => {
  const relatorio = [
    { filePath: path.join(raiz, 'app', 'a.js'), messages: [
      { line: 1, message: 'velho', ruleId: 'no-undef' }, { line: 2, message: "'x' is not defined.", ruleId: 'no-undef' },
      { line: 5, message: 'Parsing error: Unexpected token', ruleId: null },
    ] },
    { filePath: path.join(raiz, 'app', 'c.cjs'), messages: [{ line: 3, message: 'Expected === and instead saw ==.', ruleId: 'eqeqeq' }] },
    { filePath: path.join(raiz, 'app', 'b.mjs'), messages: [] },
    { filePath: path.join(raiz, 'app', 'nao-pedido.js'), messages: [{ line: 1, message: 'fora', ruleId: 'x' }] },
  ];
  const falso = eslintFalso({ saida: JSON.stringify(relatorio) });
  const { ctx, avisos } = ctxDe({ ESLINT_BIN: falso.bin }, TODOS);
  assert.deepEqual(verificar(ctx), [
    { arquivo: 'app/a.js', linha: 2, detalhe: "'x' is not defined. (no-undef)" },
    { arquivo: 'app/a.js', linha: 5, detalhe: 'Parsing error: Unexpected token' },
    { arquivo: 'app/c.cjs', linha: 3, detalhe: 'Expected === and instead saw ==. (eqeqeq)' },
  ]);
  assert.deepEqual(avisos, []);
  const [chamada, ...outras] = falso.chamadas();
  assert.deepEqual(outras, []);
  assert.deepEqual(chamada.args, ['--config', CONFIGURACAO, '--format', 'json', '--no-warn-ignored', '--', 'app/a.js', 'app/b.mjs', 'app/c.cjs']);
  assert.equal(chamada.cwd, fs.realpathSync(raiz));
  falso.limpar();
});

test('eslint: nada a conferir não chama o ESLint', () => {
  const falso = eslintFalso({ saida: '[]' });
  const { ctx } = ctxDe({ ESLINT_BIN: falso.bin }, TODOS.slice(3));
  assert.deepEqual(verificar(ctx), []);
  assert.deepEqual(falso.chamadas(), []);
  falso.limpar();
});

test('eslint: saída que não é JSON vira um achado com as três primeiras linhas', () => {
  const falso = eslintFalso({ saida: '\n  Oops\nsaida 2\n', erro: '  erro 1 \n\nerro 2\n' });
  const { ctx } = ctxDe({ ESLINT_BIN: falso.bin }, [['app/a.js']]);
  assert.deepEqual(verificar(ctx), [{ arquivo: '(eslint)', detalhe: 'o ESLint não produziu relatório: erro 1 | erro 2 | Oops' }]);
  falso.limpar();
});

test('eslint: sem ESLINT_BIN nem npx avisa, ou falha quando a ferramenta é exigida', () => {
  const anterior = process.env.PATH;
  process.env.PATH = '';
  try {
    const semExigir = ctxDe({}, [['app/a.js']]);
    assert.deepEqual(verificar(semExigir.ctx), []);
    assert.deepEqual(semExigir.avisos, ['ESLint não está instalado: regra pulada (defina ESLINT_BIN ou rode npm i -g eslint@9)']);
    const exigindo = ctxDe({ REGRAS_EXIGE_FERRAMENTAS: '1' }, [['app/a.js']]);
    assert.deepEqual(verificar(exigindo.ctx), [{ arquivo: '(eslint)', detalhe: 'ESLint não está instalado (defina ESLINT_BIN)' }]);
    assert.deepEqual(exigindo.avisos, []);
  } finally {
    process.env.PATH = anterior;
  }
});
