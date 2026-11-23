'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { classificar, resumo } = require('../risco');

const CONFIGURACAO = {
  caminhos: [
    { id: 'regras', motivo: 'mexe nas regras', globs: ['scripts/regras/**'] },
    { id: 'preload', motivo: 'mexe no preload', globs: [{ glob: '**/preload.js' }] },
    { id: 'tudo-js', motivo: 'qualquer js', globs: ['*.js'] },
  ],
  extensoesDoConteudo: ['js', 'py'],
  conteudo: [
    { id: 'ipc', motivo: 'registra IPC', padrao: 'ipcMain\\.(handle|on)\\(' },
    { id: 'processo', motivo: 'executa processo', padrao: 'child_process' },
  ],
};

const ARQUIVOS = [
  { caminho: 'scripts/regras/x.js', adicionadas: ['IPCMAIN.HANDLE("a")', 'require("child_process")'] },
  { caminho: 'app/preload.js', adicionadas: null },
  { caminho: 'README.md', adicionadas: ['ipcMain.on("x")'] },
  { caminho: 'a.py' },
  { caminho: 'b.py', adicionadas: ['x', 'y = "child_process"'] },
  { caminho: 'docs/x.md', adicionadas: null },
];

const motivo = (arquivo, id, texto, tipo) => ({ arquivo, id, motivo: texto, tipo });
const DIFF_AUSENTE = 'o GitHub não devolveu o diff deste arquivo, então o conteúdo sensível não pôde ser conferido';

test('classificar lista os motivos por arquivo, caminho antes do conteúdo', () => {
  assert.deepStrictEqual(classificar(ARQUIVOS, CONFIGURACAO), {
    alta: true,
    motivos: [
      motivo('scripts/regras/x.js', 'regras', 'mexe nas regras', 'caminho'),
      motivo('scripts/regras/x.js', 'tudo-js', 'qualquer js', 'caminho'),
      motivo('scripts/regras/x.js', 'ipc', 'registra IPC', 'conteudo'),
      motivo('scripts/regras/x.js', 'processo', 'executa processo', 'conteudo'),
      motivo('app/preload.js', 'preload', 'mexe no preload', 'caminho'),
      motivo('app/preload.js', 'tudo-js', 'qualquer js', 'caminho'),
      motivo('app/preload.js', 'diff-ausente', DIFF_AUSENTE, 'conteudo'),
      motivo('b.py', 'processo', 'executa processo', 'conteudo'),
    ],
  });
});

test('classificar sem motivo não é alta', () => {
  assert.deepStrictEqual(classificar([{ caminho: 'a.md', adicionadas: ['child_process'] }, { caminho: 'c.py', adicionadas: [] }], CONFIGURACAO), { alta: false, motivos: [] });
  assert.deepStrictEqual(classificar([], CONFIGURACAO), { alta: false, motivos: [] });
});

test('classificar usa caminhos-sensiveis.json por padrão', () => {
  const { alta, motivos } = classificar([{ caminho: 'scripts/regras/risco.js', adicionadas: [] }]);
  assert.strictEqual(alta, true);
  assert.ok(motivos.every(m => m.arquivo === 'scripts/regras/risco.js' && m.tipo === 'caminho'));
});

test('resumo tira repetidos, corta no limite e conta o resto', () => {
  const motivos = classificar(ARQUIVOS, CONFIGURACAO).motivos;
  const repetidos = [...motivos, motivos[0], { ...motivos[1], motivo: 'outro texto' }];
  assert.deepStrictEqual(resumo(repetidos, 3), [
    'scripts/regras/x.js (regras: mexe nas regras)',
    'scripts/regras/x.js (tudo-js: outro texto)',
    'scripts/regras/x.js (ipc: registra IPC)',
    '… e mais 5',
  ]);
  assert.strictEqual(resumo(repetidos).length, 8);
  assert.deepStrictEqual(resumo([]), []);
});
