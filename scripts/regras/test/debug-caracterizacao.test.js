'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { verificar } = require('../regra-debug');

const JS = [
  'console.log("a");',
  '// console.log("comentário")',
  'const s = "console.log(dentro do texto)";',
  'console["log"]("colchete");',
  "const t = 'console[\"log\"]';",
  '/* bloco que começa aqui console.log(',
  '   e continua */ console.debug(1); /* fim',
  ' ainda */ debugger;',
  'it.only("x", () => {});',
  'const modelo = `console.trace(${1})`;',
  'console . dir(x);',
  'console.error("pode");',
  'x = 1; // debugger',
  '/*',
  'debugger no meio do comentário',
  'console.log no fim */ y = 2;',
].join('\n');

const PY = [
  'breakpoint()',
  '# breakpoint()',
  'import pdb',
  'pdb.set_trace()',
  's = "breakpoint()"',
  'from pdb import set_trace',
  '"""',
  'pdb.set_trace() dentro da docstring',
  '"""',
  'print("ok")',
].join('\n');

const todas = texto => new Set(texto.split('\n').map((_, i) => i + 1));

const ARQUIVOS = {
  'app/a.js': { texto: JS, novas: new Set([16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 40]) },
  'app/b.py': { texto: PY, novas: todas(PY) },
  'app/c.ts': { texto: 'console.log(1);\ndebugger;\n', novas: new Set([1]) },
  'scripts/ferramenta.js': { texto: JS, novas: todas(JS) },
  'scripts/ferramenta.py': { texto: PY, novas: new Set([1, 3]) },
  'app/dist/assets/bundle.js': { texto: 'console.log(1);\n', novas: new Set([1]) },
  'app/sem-novas.js': { texto: 'console.log(1);\n', novas: new Set() },
  'app/fora-do-mapa.js': { texto: 'console.log(1);\n' },
  'app/leia.md': { texto: 'console.log(1);\n', novas: new Set([1]) },
  'app/script.sh': { texto: 'console.log(1)\n', novas: new Set([1]) },
  'app/binario.js': { binario: true, novas: new Set([1]) },
  'app/sumiu.js': { sumiu: true, novas: new Set([1]) },
};

function ctxDe(lidos) {
  return {
    arquivos: Object.keys(ARQUIVOS).map(caminho => ({ caminho, status: 'M' })),
    config: { ignorarCodigo: ['app/dist/assets/**'], consolePermitidoEm: ['scripts/'] },
    mudancas: { acrescentadas: new Map(Object.entries(ARQUIVOS).filter(([, a]) => a.novas).map(([caminho, a]) => [caminho, a.novas])) },
    ler(caminho) {
      lidos.push(caminho);
      const arquivo = ARQUIVOS[caminho];
      if (arquivo.sumiu) return null;
      return arquivo.binario ? { binario: true } : { texto: arquivo.texto, binario: false };
    },
  };
}

test('depuração: achados por linha nova, na ordem, sem comentário nem texto, e console liberado em scripts/', () => {
  const lidos = [];
  const achados = verificar(ctxDe(lidos)).map(({ arquivo, linha, detalhe }) => `${arquivo}:${linha} ${detalhe}`);
  assert.deepEqual(lidos, ['app/a.js', 'app/b.py', 'app/c.ts', 'scripts/ferramenta.js', 'scripts/ferramenta.py', 'app/binario.js', 'app/sumiu.js']);
  assert.deepEqual(achados, [
    'app/a.js:1 console.log novo',
    'app/a.js:4 console.log novo',
    'app/a.js:5 console.log novo',
    'app/a.js:7 console.log novo',
    'app/a.js:8 debugger novo',
    'app/a.js:9 .only esquecido em teste novo',
    'app/a.js:11 console.log novo',
    'app/b.py:1 breakpoint() novo',
    'app/b.py:3 import pdb novo',
    'app/b.py:4 pdb.set_trace() novo',
    'app/b.py:5 breakpoint() novo',
    'app/b.py:6 import pdb novo',
    'app/b.py:8 pdb.set_trace() novo',
    'app/c.ts:1 console.log novo',
    'scripts/ferramenta.js:8 debugger novo',
    'scripts/ferramenta.js:9 .only esquecido em teste novo',
    'scripts/ferramenta.py:1 breakpoint() novo',
    'scripts/ferramenta.py:3 import pdb novo',
  ]);
});
