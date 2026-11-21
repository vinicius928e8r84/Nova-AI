'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { criar, linhas, LINHA_DE_BASE } = require('./auxiliar');

const VERIFICAR = path.join(__dirname, '..', 'verificar.js');
const B = '//';

function rodarEm(repo, ...args) {
  const { codigo, saida } = repo.rodar(...args);
  return { codigo, saida: saida.split(repo.raiz).join('<raiz>') };
}

function cenas() {
  const repo = criar({ 'app/grande.js': linhas(1200), 'app/limpo.js': 'const a = 1;\n', 'app/sumido.js': 'const s = 1;\n' }, { 'app/grande.js': 1200 });
  const saidas = {};
  const rodar = (nome, ...args) => { saidas[nome] = rodarEm(repo, ...args); };
  try {
    rodar('ajuda', '--help');
    rodar('ajuda curta', '-h', '--x');
    rodar('lista', '--lista');
    rodar('bandeira desconhecida', '--x');
    rodar('regra sem valor', '--regra');
    rodar('regra seguida de bandeira', '--regra', '--lista');
    rodar('regra desconhecida', '--regra', 'nao-existe');
    rodar('criar e atualizar juntas', '--criar-linha-de-base', '--atualizar-linha-de-base');
    rodar('sem base', '--base', '000');
    rodar('base que não existe', '--base', 'nao-existe');
    repo.escrever({ 'app/limpo.js': 'const a = 2;\n' });
    rodar('tudo limpo em duas regras', '--regra', 'sem-segredo', '--regra', 'sem-comentario-novo');
    const todas = rodarEm(repo).saida.trim().split('\n');
    saidas['sem --regra roda todas'] = { linhasDeRegra: todas.filter(linha => /^[✓✗] /.test(linha)).length, ultima: todas[todas.length - 1] };
    const comentarios = Array.from({ length: 11 }, (_, i) => `const c${i} = ${i}; ${B} nota ${i}`).join('\n');
    repo.escrever({
      'app/a.js': `${comentarios}\n`,
      'app/instalador.exe': 'x',
      'app/electron/preload.js': 'const p = 1;\n',
      'app/b.js': "const cp = require('child_process');\nipcMain.handle('x', () => 1);\n",
      'app/c.md': "require('child_process')\n",
      'app/d.js': 'const k = safeStorage;\nautoUpdater.check();\nfs.rmSync(x);\n',
      'app/e.js': 'firebase.init();\n',
      'app/f.js': "require('ssh2');\n",
      'app/grande.js': linhas(1100),
      'app/sumido.js': null,
    });
    rodar('falhas, achados cortados em 10 e risco ALTA com resumo', '--regra', 'sem-comentario-novo', '--regra', 'sem-binario-nem-lixo', '--regra', 'limite-de-linhas');
    rodar('criar linha de base que já existe', '--criar-linha-de-base');
    rodar('criar linha de base de regra sem linha de base', '--criar-linha-de-base', '--regra', 'sem-segredo');
    rodar('atualizar a linha de base de linhas', '--atualizar-linha-de-base', '--regra', 'limite-de-linhas');
    saidas['linha de base depois de atualizar'] = JSON.parse(fs.readFileSync(path.join(repo.raiz, LINHA_DE_BASE), 'utf8'));
    repo.git('checkout', '-q', '--orphan', 'vazio');
    repo.git('rm', '-rf', '-q', '.');
    repo.git('commit', '-q', '--allow-empty', '-m', 'vazio');
    repo.git('checkout', '-q', '-f', 'ramo');
    repo.git('merge', '-q', '--allow-unrelated-histories', 'vazio', '-m', 'junta a base vazia');
    rodar('base sem linha de base avisa', '--base', 'vazio', '--regra', 'limite-de-linhas');
  } finally {
    repo.limpar();
  }
  const fora = fs.mkdtempSync(path.join(os.tmpdir(), 'verificar-fora-'));
  try {
    const r = spawnSync(process.execPath, [VERIFICAR, '--raiz', fora], { encoding: 'utf8', env: { ...process.env, REGRAS_BASE: '' } });
    saidas['raiz fora do git'] = { codigo: r.status, saida: `${r.stdout}${r.stderr}`.split(fora).join('<fora>') };
  } finally {
    fs.rmSync(fora, { recursive: true, force: true });
  }
  return saidas;
}

module.exports = { cenas };
