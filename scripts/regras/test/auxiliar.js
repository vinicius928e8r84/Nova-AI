'use strict';

const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const VERIFICAR = path.join(__dirname, '..', 'verificar.js');
const LINHA_DE_BASE = 'scripts/regras/linha-de-base.json';

const linhas = quantas => Array.from({ length: quantas }, (_, i) => `const v${i} = ${i};`).join('\n') + '\n';

const comoLinhaDeBase = (arquivos, saude) => `${JSON.stringify(saude === null ? { arquivos, comentarios: {} } : { arquivos, 'saude-do-codigo': saude, comentarios: {} })}\n`;

function criar(arquivosDaBase = {}, listaDaBase = {}, saudeDaBase = {}) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'regras-teste-'));
  const git = (...args) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: raiz, encoding: 'utf8', stdio: 'pipe' }).trim();
  const escrever = arquivos => {
    for (const [arquivo, texto] of Object.entries(arquivos)) {
      const completo = path.join(raiz, arquivo);
      if (texto === null) {
        fs.rmSync(completo);
        continue;
      }
      fs.mkdirSync(path.dirname(completo), { recursive: true });
      fs.writeFileSync(completo, texto);
    }
  };
  const guardar = mensagem => {
    git('add', '-A');
    git('commit', '-q', '--allow-empty', '-m', mensagem);
  };
  git('init', '-q', '-b', 'main');
  escrever({ ...arquivosDaBase, [LINHA_DE_BASE]: comoLinhaDeBase(listaDaBase, saudeDaBase) });
  guardar('base');
  git('checkout', '-q', '-b', 'ramo');
  const rodar = (...args) => {
    const resultado = spawnSync(process.execPath, [VERIFICAR, '--raiz', raiz, '--base', 'main', ...args], {
      encoding: 'utf8', env: { ...process.env, REGRAS_EXIGE_FERRAMENTAS: '' },
    });
    return { codigo: resultado.status, saida: `${resultado.stdout}${resultado.stderr}` };
  };
  const lista = (obj, saude = saudeDaBase) => escrever({ [LINHA_DE_BASE]: comoLinhaDeBase(obj, saude) });
  return { raiz, git, escrever, guardar, rodar, lista, limpar: () => fs.rmSync(raiz, { recursive: true, force: true }) };
}

const temEslint = Boolean(process.env.ESLINT_BIN);

module.exports = { criar, linhas, temEslint, LINHA_DE_BASE };
