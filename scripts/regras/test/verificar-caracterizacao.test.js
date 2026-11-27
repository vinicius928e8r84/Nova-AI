'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { criar, linhas } = require('./auxiliar');

const VERIFICAR = path.join(__dirname, '..', 'verificar.js');
const SO_LIMITE = ['--regra', 'limite-de-linhas'];

function executar(argumentos, ambiente = {}) {
  const resultado = spawnSync(process.execPath, [VERIFICAR, ...argumentos], {
    encoding: 'utf8', env: { ...process.env, REGRAS_EXIGE_FERRAMENTAS: '', ...ambiente },
  });
  return { codigo: resultado.status, linhas: `${resultado.stdout}${resultado.stderr}`.split('\n') };
}

function comRepositorio(arquivosDaBase, corpo) {
  const repo = criar(arquivosDaBase);
  try {
    return corpo(repo);
  } finally {
    repo.limpar();
  }
}

const saida = resultado => resultado.saida.split('\n');

test('verificar --help: imprime o uso e sai com 0', () => {
  const resultado = executar(['--help']);
  assert.equal(resultado.codigo, 0);
  assert.equal(resultado.linhas[0], 'uso: node scripts/regras/verificar.js [--raiz <pasta>] [--base <ref>] [--regra <id>]... [--lista]');
  assert.ok(resultado.linhas.includes('  --regra <id>                 roda só esta regra (pode repetir)'));
  assert.ok(resultado.linhas.includes('Sai com 0 se tudo passa, 1 se alguma regra falha, 2 em erro de uso.'));
});

test('verificar --lista: uma linha por regra, na ordem em que rodam', () => {
  const resultado = executar(['--lista']);
  assert.equal(resultado.codigo, 0);
  const ids = resultado.linhas.filter(Boolean).map(linha => linha.split(':')[0]);
  assert.deepEqual(ids, [
    'sem-comentario-novo', 'teto-de-comentarios', 'limite-de-linhas', 'sem-segredo', 'sem-dado-pessoal', 'sem-binario-nem-lixo',
    'sem-depuracao-esquecida', 'sintaxe-valida', 'eslint-nas-linhas-novas', 'saude-do-codigo', 'autoria', 'limite-de-tamanho',
    'sem-config-do-codescene',
  ]);
  assert.equal(resultado.linhas[2], 'limite-de-linhas: Arquivo de código com no máximo 1000 linhas');
});

test('verificar: erro de uso sai com 2 e aponta a ajuda', () => {
  const ajuda = 'help: node scripts/regras/verificar.js --help';
  assert.deepEqual(executar(['--nada']).linhas.slice(0, 2), ['error: bandeira desconhecida: --nada', ajuda]);
  assert.equal(executar(['--nada']).codigo, 2);
  assert.deepEqual(executar(['--base']).linhas.slice(0, 2), ['error: --base precisa de um valor', ajuda]);
  assert.deepEqual(executar(['--regra', '--lista']).linhas.slice(0, 2), ['error: --regra precisa de um valor', ajuda]);
  assert.deepEqual(executar(['--regra', 'inexistente']).linhas.slice(0, 2), ['error: regra desconhecida: inexistente', ajuda]);
});

test('verificar: pasta que não é repositório, base que não é commit e repositório sem base', () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'verificar-sem-git-'));
  try {
    const semGit = executar(['--raiz', pasta]);
    assert.equal(semGit.codigo, 2);
    assert.equal(semGit.linhas[0], `error: ${path.resolve(pasta)} não é um repositório git`);
    assert.equal(semGit.linhas[1], 'help: node scripts/regras/verificar.js --help');
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  comRepositorio({ 'a.js': linhas(1) }, repo => {
    const semCommit = executar(['--raiz', repo.raiz, '--base', 'nao-existe']);
    assert.equal(semCommit.codigo, 2);
    assert.equal(semCommit.linhas[0], 'error: a base nao-existe não é um commit deste repositório; use --base <ref> ou REGRAS_BASE (no CI, fetch-depth: 0)');
    const base = executar(['--raiz', repo.raiz, '--base', '0'.repeat(40)]);
    assert.equal(base.codigo, 0);
    assert.equal(base.linhas[0], 'aviso: sem base de comparação (primeiro push de uma branch); nada foi conferido');
  });
});

test('verificar: a base vem de REGRAS_BASE quando --base não é dita', () => {
  comRepositorio({ 'a.js': linhas(1) }, repo => {
    const resultado = executar(['--raiz', repo.raiz, ...SO_LIMITE], { REGRAS_BASE: 'main' });
    assert.equal(resultado.codigo, 0);
    assert.ok(resultado.linhas.includes('regras ok (1) em main..HEAD'));
  });
});

test('verificar: regra que passa imprime o visto, o risco e o resumo, e sai com 0', () => {
  comRepositorio({ 'a.js': linhas(3) }, repo => {
    repo.escrever({ 'a.js': linhas(4) });
    repo.guardar('mexe');
    const resultado = repo.rodar(...SO_LIMITE);
    assert.equal(resultado.codigo, 0);
    assert.deepEqual(saida(resultado), ['✓ limite-de-linhas', 'risco: nenhum caminho sensível mudou', 'regras ok (1) em main..HEAD', '']);
  });
});

test('verificar: regra que falha lista cada achado com arquivo e linha, o conserto e a contagem, e sai com 1', () => {
  comRepositorio({ 'a.js': linhas(3) }, repo => {
    repo.escrever({ 'grande.js': linhas(1001) });
    repo.guardar('arquivo grande');
    const resultado = repo.rodar(...SO_LIMITE);
    const texto = saida(resultado);
    assert.equal(resultado.codigo, 1);
    assert.equal(texto[0], 'risco: nenhum caminho sensível mudou');
    assert.equal(texto[2], '✗ limite-de-linhas — Arquivo de código com no máximo 1000 linhas');
    assert.equal(texto[3], '    grande.js: 1001 linhas, 1 acima do limite de 1000; arquivo novo, ou que na branch-alvo cabia no limite, tem de caber nele');
    assert.match(texto[4], /^ {2}Conserto: Divida o arquivo por responsabilidade em módulos menores/);
    assert.equal(texto[6], 'error: 1 regra(s) falharam em main..HEAD');
  });
});

function achadosDeDepuracao(quantos) {
  return comRepositorio({ 'app/a.js': 'const um = 1;\n' }, repo => {
    repo.escrever({ 'app/a.js': Array.from({ length: quantos }, () => 'console.log(1);').join('\n') + '\n' });
    repo.guardar('depurações');
    const resultado = repo.rodar('--regra', 'sem-depuracao-esquecida');
    return { codigo: resultado.codigo, texto: saida(resultado) };
  });
}

test('verificar: até dez achados no mesmo arquivo saem todos, com a linha de cada um', () => {
  const { codigo, texto } = achadosDeDepuracao(10);
  assert.equal(codigo, 1);
  assert.equal(texto.filter(linha => /^ {4}app\/a\.js:\d+: /.test(linha)).length, 10);
  assert.ok(texto.some(linha => linha.startsWith('    app/a.js:1: ')));
  assert.ok(!texto.some(linha => linha.includes('… e mais')));
});

test('verificar: com onze ou doze achados no mesmo arquivo saem dez e a contagem do resto', () => {
  const onze = achadosDeDepuracao(11);
  assert.equal(onze.texto.filter(linha => /^ {4}app\/a\.js:\d+: /.test(linha)).length, 10);
  assert.ok(onze.texto.includes('    app/a.js: … e mais 1'));
  assert.ok(achadosDeDepuracao(12).texto.includes('    app/a.js: … e mais 2'));
});

test('verificar: sem --regra roda as treze regras e cada falha vem agrupada pelo arquivo', () => {
  comRepositorio({ 'a.js': linhas(1) }, repo => {
    repo.escrever({ 'grande.js': linhas(1001) });
    repo.guardar('arquivo grande');
    const resultado = repo.rodar();
    assert.equal(resultado.codigo, 1);
    const texto = saida(resultado);
    assert.ok(texto.includes('✓ sem-segredo'));
    assert.ok(texto.some(linha => linha.startsWith('✗ limite-de-linhas')));
    assert.ok(texto.some(linha => /^error: \d+ regra\(s\) falharam em main\.\.HEAD$/.test(linha)));
  });
});

test('verificar: linha acrescentada que registra canal IPC em arquivo de código é risco ALTA, com o motivo', () => {
  comRepositorio({ 'a.js': 'const um = 1;\n' }, repo => {
    repo.escrever({ 'a.js': "const um = 1;\nipcMain.handle('canal', () => 1);\n" });
    repo.guardar('canal novo');
    const texto = saida(repo.rodar(...SO_LIMITE));
    assert.ok(texto.includes('risco: ALTA — a PR precisa de "Atenção: ALTA" e da seção Prova real:'));
    assert.ok(texto.includes('  a.js (ipc: registra canal IPC ou muda a segurança da janela)'));
  });
});

test('verificar: a mesma linha em arquivo que não é código, ou que já existia na base, não é risco', () => {
  const canal = "ipcMain.handle('canal', () => 1);\n";
  comRepositorio({ 'velho.js': `${canal}const um = 1;\n`, 'nota.md': 'texto\n' }, repo => {
    repo.escrever({ 'velho.js': `${canal}const um = 1;\nconst dois = 2;\n`, 'nota.md': `texto\n${canal}` });
    repo.guardar('só mexe fora do canal');
    const texto = saida(repo.rodar(...SO_LIMITE));
    assert.ok(texto.includes('risco: nenhum caminho sensível mudou'));
  });
});

test('verificar: arquivo apagado não conta para o risco, e o de caminho sensível conta mesmo sem linha nova', () => {
  comRepositorio({ 'velho.js': "ipcMain.handle('canal', () => 1);\n", 'app/electron/preload.js': 'const um = 1;\n' }, repo => {
    repo.escrever({ 'velho.js': null });
    repo.guardar('apaga o canal');
    assert.ok(saida(repo.rodar(...SO_LIMITE)).includes('risco: nenhum caminho sensível mudou'));
    repo.escrever({ 'app/electron/preload.js': 'const um = 1;\nconst dois = 2;\n' });
    repo.guardar('mexe no preload');
    const texto = saida(repo.rodar(...SO_LIMITE));
    assert.ok(texto.includes('  app/electron/preload.js (ipc-e-preload: processo principal, preload e canais IPC)'));
  });
});

test('verificar: arquivo que só perde comentário não entra no risco, e o resumo diz quantos são', () => {
  comRepositorio({ 'app/electron/preload.js': "// canal\nipcMain.handle('canal', () => 1);\n" }, repo => {
    repo.escrever({ 'app/electron/preload.js': "ipcMain.handle('canal', () => 1);\n" });
    repo.guardar('tira o comentário');
    const texto = saida(repo.rodar(...SO_LIMITE));
    assert.ok(texto.includes('1 arquivo(s) só tiram comentário (o código fica igual) e não entram na classificação de risco'));
    assert.ok(texto.includes('risco: nenhum caminho sensível mudou'));
  });
});
