'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const { criar } = require('./auxiliar');
const { comparar, soTiraComentario } = require('../so-tira-comentario');
const { arquivosSoComComentarioRemovido, conferir } = require('../registro-da-pr');

const COM_PYTHON = spawnSync(process.env.PYTHON || 'python3', ['-I', '-c', 'import ast']).status === 0;
const comPython = { skip: COM_PYTHON ? false : 'sem python3 (aponte PYTHON=)' };

const HEAD = 'a'.repeat(40);
const DESCRICAO = 'Apaga comentário de prosa de app/electron sem mexer em uma linha de código do aplicativo.';
const REVISAO = `Veredito: CLEAN\nHead: ${HEAD}\nAutor: agente-a\nRevisor: agente-b\nRisco: BAIXA\n`;

test('JavaScript: tirar comentário de linha, de bloco e do fim da linha deixa o código igual', () => {
  const antes = '// cabeça\nconst a = "http://x//y"; // fim\n/* bloco\n   de duas linhas */\nconst b = /\/\//.test(a);\n';
  const depois = 'const a = "http://x//y";\nconst b = /\/\//.test(a);\n';
  assert.deepEqual(comparar('app/a.js', antes, depois), { ok: true, saiu: 3 });
});

test('JavaScript: mudar uma linha de código, mesmo junto com o comentário, não passa', () => {
  const r = comparar('app/a.js', '// nota\nconst a = 1;\n', 'const a = 2;\n');
  assert.equal(r.ok, false);
  assert.match(r.motivo, /o código mudou/);
});

test('JavaScript: tirar a quebra de linha que um comentário carregava (ASI) não passa', () => {
  const antes = 'function f() {\n  return /*\n*/ 1;\n}\n';
  const depois = 'function f() {\n  return 1;\n}\n';
  assert.equal(comparar('app/a.js', antes, depois).ok, false);
});

test('JavaScript: tirar diretiva de ferramenta, shebang ou licença não passa', () => {
  for (const diretiva of ['// @ts-ignore', '/* eslint-disable no-console */', '/*! © 2026 Nova */', '// istanbul ignore next', '//# sourceMappingURL=a.js.map']) {
    const r = comparar('app/a.js', `${diretiva}\nconst a = 1;\n`, 'const a = 1;\n');
    assert.equal(r.ok, false, diretiva);
  }
  assert.equal(comparar('app/a.js', '#!/usr/bin/env node\nconst a = 1;\n', 'const a = 1;\n').ok, false);
});

test('JavaScript: acrescentar ou trocar um comentário não passa', () => {
  assert.equal(comparar('app/a.js', 'const a = 1;\n', '// novo\nconst a = 1;\n').ok, false);
  assert.equal(comparar('app/a.js', '// um\nconst a = 1;\n', '// dois\nconst a = 1;\n').ok, false);
});

test('JavaScript: o que parece comentário dentro de string, template e regex não é tirado', () => {
  const antes = 'const a = `// ${1} /* x */`;\nconst b = "/* y */"; // nota\n';
  assert.deepEqual(comparar('app/a.js', antes, 'const a = `// ${1} /* x */`;\nconst b = "/* y */";\n'), { ok: true, saiu: 1 });
  assert.equal(comparar('app/a.js', antes, 'const a = `// ${1} `;\nconst b = "/* y */";\n').ok, false);
});

test('Python: tirar # e docstring deixa o programa igual; mudar o código não passa', comPython, () => {
  const antes = '"""Módulo."""\n\n\ndef f(x):\n    """Soma."""\n    # nota\n    return x + 1  # fim\n';
  const depois = 'def f(x):\n    return x + 1\n';
  assert.deepEqual(comparar('app/a.py', antes, depois), { ok: true, saiu: 4 });
  assert.equal(comparar('app/a.py', antes, depois.replace('+ 1', '+ 2')).ok, false);
});

test('Python: tirar a docstring de um arquivo que usa __doc__ não passa; diretiva tampouco', comPython, () => {
  assert.equal(comparar('app/a.py', '"""Uso."""\nprint(__doc__)\n', 'print(__doc__)\n').ok, false);
  assert.equal(comparar('app/a.py', 'x = 1  # noqa: E501\n', 'x = 1\n').ok, false);
  assert.equal(comparar('app/a.py', 'x = 1  # type: ignore\n', 'x = 1\n').ok, false);
});

test('git: só entram os arquivos modificados de JavaScript ou Python que ficam iguais sem o comentário; scripts/regras nunca', () => {
  const repo = criar({ 'app/a.js': '// nota\nconst a = 1;\n', 'app/b.js': '// nota\nconst b = 1;\n', 'scripts/regras/c.js': '// nota\nconst c = 1;\n', 'app/d.sh': '# nota\necho 1\n' });
  repo.escrever({ 'app/a.js': 'const a = 1;\n', 'app/b.js': 'const b = 2;\n', 'scripts/regras/c.js': 'const c = 1;\n', 'app/d.sh': 'echo 1\n' });
  repo.guardar('muda');
  const desde = repo.git('rev-parse', 'main');
  const aprovados = soTiraComentario(repo.raiz, desde, 'HEAD');
  repo.limpar();
  assert.deepEqual([...aprovados], ['app/a.js']);
});

test('registro: lê o repositório da PR com origin/<base> e o head, como no Actions', () => {
  const repo = criar({ 'app/a.js': '// nota\nconst a = 1;\n' });
  repo.git('update-ref', 'refs/remotes/origin/main', 'main');
  repo.escrever({ 'app/a.js': 'const a = 1;\n' });
  repo.guardar('tira');
  const pr = { number: 1, base: { ref: 'main' }, head: { sha: repo.git('rev-parse', 'HEAD') } };
  const aprovados = arquivosSoComComentarioRemovido({ GITHUB_WORKSPACE: repo.raiz, PYTHON: process.env.PYTHON }, pr);
  repo.limpar();
  assert.deepEqual([...aprovados], ['app/a.js']);
});

test('registro: sem repositório legível, ninguém é aprovado (fica ALTA, como antes)', () => {
  const pr = { number: 1, base: { ref: 'main' }, head: { sha: 'f'.repeat(40) } };
  assert.equal(arquivosSoComComentarioRemovido({ GITHUB_WORKSPACE: '/nao/existe' }, pr).size, 0);
});

test('registro: arquivo sensível que só perde comentário não conta como ALTA; o que mexe no código continua', () => {
  const sensivel = { caminho: 'app/electron/services/cdp-shim.js', adicionadas: ['const a = 1;'] };
  const outro = { caminho: 'app/electron/services/ytdlp-manager.js', adicionadas: ['const b = 1;'] };
  const base = { head: HEAD, rotulos: [], registros: [REVISAO], corpo: `${DESCRICAO}\n\nAtenção: BAIXA\n` };
  const so = new Set([sensivel.caminho]);
  assert.equal(conferir({ ...base, arquivos: [sensivel], semComentario: so }).ok, true);
  assert.equal(conferir({ ...base, arquivos: [sensivel] }).ok, false);
  const misto = conferir({ ...base, arquivos: [sensivel, outro], semComentario: so });
  assert.equal(misto.ok, false);
  assert.match(misto.mensagem, /ytdlp-manager\.js/);
});

test('registro: o revisor que diz Risco: ALTA ainda exige a prova, mesmo com o arquivo só perdendo comentário', () => {
  const sensivel = { caminho: 'app/electron/services/cdp-shim.js', adicionadas: ['const a = 1;'] };
  const revisao = REVISAO.replace('Risco: BAIXA', 'Risco: ALTA');
  const r = conferir({ head: HEAD, rotulos: [], registros: [revisao], corpo: `${DESCRICAO}\n\nAtenção: BAIXA\n`, arquivos: [sensivel], semComentario: new Set([sensivel.caminho]) });
  assert.equal(r.ok, false);
  assert.match(r.mensagem, /Prova real/);
});

test('JavaScript: bloco de várias linhas com asteriscos sai; a diretiva dentro dele não deixa sair', () => {
  const prosa = ['/**', ' * Faz a conta.', ' * Soma os dois.', ' */', 'const a = 1;', ''].join('\n');
  assert.equal(comparar('app/a.js', prosa, 'const a = 1;\n').ok, true);
  const licenca = ['/**', ' * Faz a conta.', ' * @license MIT', ' */', 'const a = 1;', ''].join('\n');
  assert.equal(comparar('app/a.js', licenca, 'const a = 1;\n').ok, false);
});
