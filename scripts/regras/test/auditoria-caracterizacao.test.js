'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { criar } = require('./auxiliar');

const AUDITORIA = path.join(__dirname, '..', 'auditoria.js');
const NPM_FALSO = `#!/usr/bin/env node
const fs = require('fs');
const trava = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
fs.appendFileSync(process.env.NPM_FALSO_LOG, require('path').basename(process.cwd()) + ' ' + process.argv.slice(2).join(' ') + '\\n');
if (trava.saida === 'nao-json') { process.stderr.write('registro fora do ar\\nsegunda linha\\n'); process.exit(1); }
process.stdout.write(JSON.stringify(trava.saida));
`;

const vulneravel = (severity, extra = {}) => ({ severity, via: [], ...extra });
const trava = (vulnerabilities, mais = {}) => `${JSON.stringify({ saida: { vulnerabilities, ...mais } })}\n`;
const ANTIGA = { velho: vulneravel('high') };
const PACOTE = '{"name":"x"}\n';

function palco(t) {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'auditoria-palco-'));
  const bin = path.join(pasta, 'bin');
  const tmp = path.join(pasta, 'tmp');
  fs.mkdirSync(bin);
  fs.mkdirSync(tmp);
  fs.writeFileSync(path.join(bin, 'npm'), NPM_FALSO, { mode: 0o755 });
  const log = path.join(pasta, 'npm.log');
  fs.writeFileSync(log, '');
  t.after(() => fs.rmSync(pasta, { recursive: true, force: true }));
  const rodar = (raiz, ...args) => {
    const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, TMPDIR: tmp, NPM_FALSO_LOG: log, REGRAS_BASE: '' };
    const r = spawnSync(process.execPath, [AUDITORIA, ...args, '--raiz', raiz], { encoding: 'utf8', env });
    const sobras = fs.readdirSync(tmp).filter(nome => nome.startsWith('auditoria-')).length;
    return { codigo: r.status, saida: r.stdout.split(tmp).join('<tmp>').replace(/auditoria-\w+/g, 'auditoria-X'), chamadas: fs.readFileSync(log, 'utf8'), sobras };
  };
  return { rodar };
}

const semNpmNoWindows = { skip: process.platform === 'win32' && 'o npm falso é um script com #!, que o Windows não executa' };

test('auditoria: ajuda, bandeira desconhecida, sem base e sem trava mudada', semNpmNoWindows, t => {
  const { rodar } = palco(t);
  const repo = criar({ 'app/a.js': 'const a = 1;\n' });
  t.after(repo.limpar);
  repo.escrever({ 'app/a.js': 'const a = 2;\n' });
  repo.guardar('ramo');
  const ajuda = rodar(repo.raiz, '--help');
  assert.equal(ajuda.codigo, 0);
  assert.match(ajuda.saida, /^uso: node scripts\/regras\/auditoria\.js \[--base <ref>\] \[--raiz <pasta>\]\n\n/);
  assert.match(ajuda.saida, /severidade high ou critical que a mudança introduz/);
  assert.deepEqual(rodar(repo.raiz, '--x'), { codigo: 2, saida: 'error: bandeira desconhecida: --x\n', chamadas: '', sobras: 0 });
  assert.deepEqual(rodar(repo.raiz, '--base', '000'), { codigo: 0, saida: 'aviso: sem base de comparação; nada foi auditado\n', chamadas: '', sobras: 0 });
  assert.deepEqual(rodar(repo.raiz, '--base', 'nao-existe'), {
    codigo: 2, saida: 'error: a base nao-existe não é um commit deste repositório; use --base <ref> ou REGRAS_BASE (no CI, fetch-depth: 0)\n', chamadas: '', sobras: 0,
  });
  assert.deepEqual(rodar(repo.raiz, '--base', 'main'), { codigo: 0, saida: 'auditoria: nenhuma trava de pacotes mudou; nada a auditar\n', chamadas: '', sobras: 0 });
});

test('auditoria: trava mudada, movida, nova e apagada; só a vulnerabilidade alta nova falha, na ordem das travas', semNpmNoWindows, t => {
  const { rodar } = palco(t);
  const repo = criar({
    'app/package.json': PACOTE, 'app/package-lock.json': trava(ANTIGA),
    'velha/package.json': PACOTE, 'velha/package-lock.json': trava(ANTIGA),
    'some/package.json': PACOTE, 'some/package-lock.json': trava(ANTIGA),
    'semjson/package-lock.json': trava(ANTIGA),
  });
  t.after(repo.limpar);
  repo.git('mv', 'velha', 'nova');
  repo.escrever({
    'app/package-lock.json': trava({
      ...ANTIGA,
      critico: vulneravel('critical', { range: '<2.0.0', via: ['dep', { title: 'execução remota' }, { title: '' }, { title: 'b' }, { title: 'c' }, { title: 'd' }] }),
      leve: vulneravel('moderate'),
    }),
    'nova/package-lock.json': trava({ ...ANTIGA, outro: vulneravel('high', { via: undefined }) }),
    'nasceu/package.json': PACOTE,
    'nasceu/package-lock.json': trava({ nascido: vulneravel('high') }),
    'some/package-lock.json': null,
    'semjson/package.json': PACOTE,
    'semjson/package-lock.json': trava({ ...ANTIGA, baixo: vulneravel('low') }),
  });
  repo.guardar('ramo');
  const r = rodar(repo.raiz, '--base', 'main');
  assert.equal(r.codigo, 1);
  assert.equal(r.saida, [
    '✗ app/package-lock.json: critico (critical, <2.0.0) execução remota; b; c',
    '✗ nasceu/package-lock.json: nascido (high) ',
    '✗ nova/package-lock.json: outro (high) ',
    '✗ semjson/package-lock.json: velho (high) ',
    'Conserto: atualize ou troque o pacote para uma versão sem a falha (npm audit mostra qual); a mudança não pode introduzir vulnerabilidade alta ou crítica.',
    '',
  ].join('\n'));
  const auditar = 'audit --json --package-lock-only --omit=dev';
  assert.equal(r.chamadas, [`base-0 ${auditar}`, `ramo-0 ${auditar}`, `ramo-1 ${auditar}`, `base-2 ${auditar}`, `ramo-2 ${auditar}`, `ramo-3 ${auditar}`, ''].join('\n'));
  assert.equal(r.sobras, 0);
});

test('auditoria: nada novo passa; npm com erro ou sem JSON falha e deixa a pasta temporária', semNpmNoWindows, t => {
  const { rodar } = palco(t);
  const repo = criar({ 'app/package.json': PACOTE, 'app/package-lock.json': trava(ANTIGA) });
  t.after(repo.limpar);
  repo.escrever({ 'app/package-lock.json': trava({ ...ANTIGA, leve: vulneravel('low') }) });
  repo.guardar('ramo');
  assert.deepEqual(rodar(repo.raiz, '--base', 'main'), {
    codigo: 0, saida: 'auditoria ok: app/package-lock.json não introduz vulnerabilidade high/critical\n',
    chamadas: 'base-0 audit --json --package-lock-only --omit=dev\nramo-0 audit --json --package-lock-only --omit=dev\n', sobras: 0,
  });
  repo.escrever({ 'app/package-lock.json': trava({}, { error: { code: 'ENOAUDIT' } }) });
  repo.guardar('erro sem resumo');
  assert.equal(rodar(repo.raiz, '--base', 'main').saida, 'error: o npm audit falhou: ENOAUDIT\n');
  repo.escrever({ 'app/package-lock.json': trava({}, { error: { code: 'E', summary: 'registro recusou' } }) });
  repo.guardar('erro com resumo');
  const comResumo = rodar(repo.raiz, '--base', 'main');
  assert.deepEqual([comResumo.codigo, comResumo.saida, comResumo.sobras], [1, 'error: o npm audit falhou: registro recusou\n', 2]);
  repo.escrever({ 'app/package-lock.json': '{"saida":"nao-json"}\n' });
  repo.guardar('sem json');
  const semJson = rodar(repo.raiz, '--base', 'main');
  assert.deepEqual([semJson.codigo, semJson.saida, semJson.sobras], [1, 'error: o npm audit não produziu JSON em <tmp>/auditoria-X/ramo-0: registro fora do ar\n', 3]);
});
