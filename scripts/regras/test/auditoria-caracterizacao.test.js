'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { criar } = require('./auxiliar');
const auditoria = require('../auditoria');

const CLI = path.join(__dirname, '..', 'auditoria.js');
const NPM_FALSO = [
  '#!/usr/bin/env node',
  "const fs = require('fs');",
  "const path = require('path');",
  "fs.appendFileSync(process.env.NPM_LOG, `${process.argv.slice(2).join(' ')} @ ${path.basename(process.cwd())}\\n`);",
  "const trava = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));",
  "if (trava.semJson) { process.stderr.write('npm ERR! sem json\\nsegunda linha\\n'); process.exit(1); }",
  'process.stdout.write(JSON.stringify(trava.auditoria));',
  '',
].join('\n');
const PACOTE = '{"name":"x"}\n';
const trava = (auditoriaFalsa, extra = {}) => `${JSON.stringify({ auditoria: auditoriaFalsa, ...extra })}\n`;
const vazia = trava({ vulnerabilities: {} });
const COM_VELHA = trava({ vulnerabilities: { velho: { severity: 'high', range: '<1.0.0', via: [{ title: 'antiga' }] } } });
const COM_LEVE = trava({ vulnerabilities: { velho: { severity: 'high', via: [] }, leve: { severity: 'moderate', via: [{ title: 'leve' }] } } });
const COM_NOVAS = trava({
  vulnerabilities: {
    velho: { severity: 'high', range: '<1.0.0', via: [{ title: 'antiga' }] },
    novo: { severity: 'critical', range: '<2.0.0', via: [{ title: 'A' }, 'texto-solto', { title: 'B' }, { semTitulo: 1 }, { title: 'C' }, { title: 'D' }] },
    semfaixa: { severity: 'high' },
    medio: { severity: 'moderate', via: [{ title: 'M' }] },
  },
});

const PREFIXO_DO_TEMPORARIO = 'auditoria-';

function rodarCli(repo, argumentos, { ambiente = {} } = {}) {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'auditoria-cara-'));
  const bin = path.join(pasta, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'npm'), NPM_FALSO, { mode: 0o755 });
  const registro = path.join(pasta, 'chamadas.log');
  fs.writeFileSync(registro, '');
  const privado = path.join(pasta, 'tmp');
  fs.mkdirSync(privado);
  try {
    const resultado = spawnSync(process.execPath, [CLI, '--raiz', repo.raiz, ...argumentos], {
      encoding: 'utf8',
      env: { ...process.env, ...ambiente, PATH: `${bin}${path.delimiter}${process.env.PATH}`, NPM_LOG: registro, TMPDIR: privado },
    });
    const normalizar = texto => texto.split(privado).join('<tmp>').replace(new RegExp(`<tmp>/${PREFIXO_DO_TEMPORARIO}[A-Za-z0-9]{6}`, 'g'), '<aud>');
    return {
      codigo: resultado.status,
      saida: normalizar(resultado.stdout).trim().split('\n'),
      erro: resultado.stderr,
      chamadas: fs.readFileSync(registro, 'utf8').trim().split('\n').filter(Boolean),
      sobrou: fs.readdirSync(privado).length,
    };
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
}

function cenario(base, ramo, argumentos = ['--base', 'main'], opcoes = {}) {
  const repo = criar(base);
  try {
    repo.escrever(ramo);
    repo.git('add', '-A');
    return rodarCli(repo, argumentos, opcoes);
  } finally {
    repo.limpar();
  }
}

const CONSERTO = 'Conserto: atualize ou troque o pacote para uma versão sem a falha (npm audit mostra qual); a mudança não pode introduzir vulnerabilidade alta ou crítica.';
const AUDIT = 'audit --json --package-lock-only --omit=dev';

test('auditoria: identidade e texto da ajuda', () => {
  assert.deepEqual(Object.keys(auditoria).sort(), ['main', 'novasAltas', 'rodar']);
  const linhas = [];
  const original = console.log;
  console.log = texto => linhas.push(texto);
  try {
    assert.equal(auditoria.main(['--help']), 0);
  } finally {
    console.log = original;
  }
  assert.equal(linhas.length, 1);
  assert.equal(crypto.createHash('sha256').update(linhas[0]).digest('hex'), '36fc45a66c7721d2c077dc50f5b30da4cbc754e18358f5e5304ada7efb34c39b');
});

test('auditoria: novasAltas só devolve alta ou crítica que a base não tinha, com no máximo três títulos', () => {
  const ramo = JSON.parse(COM_NOVAS).auditoria;
  assert.deepEqual(auditoria.novasAltas(null, ramo), [
    { nome: 'velho', severidade: 'high', intervalo: '<1.0.0', titulos: ['antiga'] },
    { nome: 'novo', severidade: 'critical', intervalo: '<2.0.0', titulos: ['A', 'B', 'C'] },
    { nome: 'semfaixa', severidade: 'high', intervalo: undefined, titulos: [] },
  ]);
  assert.deepEqual(auditoria.novasAltas(JSON.parse(COM_VELHA).auditoria, ramo).map(achado => achado.nome), ['novo', 'semfaixa']);
  assert.deepEqual(auditoria.novasAltas(ramo, ramo), []);
  assert.deepEqual(auditoria.novasAltas({}, {}), []);
  assert.deepEqual(auditoria.novasAltas(undefined, undefined), []);
  assert.deepEqual(auditoria.novasAltas(null, ramo, ['moderate']).map(achado => achado.nome), ['medio']);
});

test('auditoria: rodar devolve 2 para uso errado, imprime o erro e devolve 0 para a ajuda', () => {
  const linhas = [];
  const original = console.log;
  console.log = texto => linhas.push(texto);
  try {
    assert.equal(auditoria.rodar(['--x']), 2);
    assert.equal(auditoria.rodar(['--help']), 0);
  } finally {
    console.log = original;
  }
  assert.equal(linhas[0], 'error: bandeira desconhecida: --x');
  assert.equal(linhas.length, 2);
  assert.ok(linhas[1].startsWith('uso: node scripts/regras/auditoria.js'));
});

test('auditoria: sem mudança de trava, sem base e com a base vinda do ambiente', () => {
  const sem = cenario({ 'app/a.js': 'const a = 1;\n' }, { 'app/a.js': 'const a = 2;\n' });
  assert.deepEqual([sem.codigo, sem.saida, sem.chamadas], [0, ['auditoria: nenhuma trava de pacotes mudou; nada a auditar'], []]);
  const vazio = cenario({ 'app/a.js': 'const a = 1;\n' }, { 'app/a.js': 'const a = 2;\n' }, ['--base', '0000000']);
  assert.deepEqual([vazio.codigo, vazio.saida], [0, ['aviso: sem base de comparação; nada foi auditado']]);
  const doAmbiente = cenario({ 'app/a.js': 'const a = 1;\n' }, { 'app/a.js': 'const a = 2;\n' }, [], { ambiente: { REGRAS_BASE: 'main' } });
  assert.deepEqual([doAmbiente.codigo, doAmbiente.saida], [0, ['auditoria: nenhuma trava de pacotes mudou; nada a auditar']]);
  const apagada = cenario({ 'app/package.json': PACOTE, 'app/package-lock.json': COM_VELHA }, { 'app/package-lock.json': null });
  assert.deepEqual([apagada.codigo, apagada.saida, apagada.chamadas], [0, ['auditoria: nenhuma trava de pacotes mudou; nada a auditar'], []]);
});

test('auditoria: trava mudada sem vulnerabilidade nova passa, audita a base e o ramo e limpa o temporário', () => {
  const base = { 'app/package.json': PACOTE, 'app/package-lock.json': COM_VELHA };
  const r = cenario(base, { 'app/package-lock.json': COM_LEVE });
  assert.deepEqual([r.codigo, r.saida, r.sobrou], [0, ['auditoria ok: app/package-lock.json não introduz vulnerabilidade high/critical'], 0]);
  assert.deepEqual(r.chamadas, [`${AUDIT} @ base-0`, `${AUDIT} @ ramo-0`]);
});

test('auditoria: vulnerabilidade nova alta ou crítica falha, com no máximo três títulos, e o resto não conta', () => {
  const base = { 'app/package.json': PACOTE, 'app/package-lock.json': COM_VELHA };
  const r = cenario(base, { 'app/package-lock.json': COM_NOVAS });
  assert.equal(r.codigo, 1);
  assert.deepEqual(r.saida, [
    '✗ app/package-lock.json: novo (critical, <2.0.0) A; B; C',
    '✗ app/package-lock.json: semfaixa (high) ',
    CONSERTO,
  ]);
  assert.equal(r.sobrou, 0);
});

test('auditoria: trava nova, na raiz ou em duas pastas, audita só o ramo ou cada trava na sua ordem', () => {
  const nova = cenario({ 'app/a.js': 'x\n' }, { 'novo/package.json': PACOTE, 'novo/package-lock.json': COM_NOVAS });
  assert.equal(nova.codigo, 1);
  assert.deepEqual(nova.chamadas, [`${AUDIT} @ ramo-0`]);
  assert.deepEqual(nova.saida.map(linha => linha.split(':')[0]), ['✗ novo/package-lock.json', '✗ novo/package-lock.json', '✗ novo/package-lock.json', 'Conserto']);
  const raiz = cenario({ 'package.json': PACOTE, 'package-lock.json': vazia }, { 'package-lock.json': COM_LEVE });
  assert.deepEqual([raiz.codigo, raiz.saida], [1, ['✗ package-lock.json: velho (high) ', CONSERTO]]);
  const duas = cenario(
    { 'a/package.json': PACOTE, 'a/package-lock.json': vazia, 'b/package.json': PACOTE, 'b/package-lock.json': vazia },
    { 'a/package-lock.json': COM_VELHA, 'b/package-lock.json': COM_LEVE },
  );
  assert.deepEqual(duas.chamadas, [`${AUDIT} @ base-0`, `${AUDIT} @ ramo-0`, `${AUDIT} @ base-1`, `${AUDIT} @ ramo-1`]);
  assert.deepEqual(duas.saida, ['✗ a/package-lock.json: velho (high, <1.0.0) antiga', '✗ b/package-lock.json: velho (high) ', CONSERTO]);
});

test('auditoria: trava renomeada é comparada com a trava e o package.json do lugar antigo', () => {
  const base = { 'velho/package.json': PACOTE, 'velho/package-lock.json': COM_VELHA };
  const r = cenario(base, { 'velho/package.json': null, 'velho/package-lock.json': null, 'novo/package.json': PACOTE, 'novo/package-lock.json': COM_VELHA });
  assert.deepEqual([r.codigo, r.saida], [0, ['auditoria ok: novo/package-lock.json não introduz vulnerabilidade high/critical']]);
  assert.deepEqual(r.chamadas, [`${AUDIT} @ base-0`, `${AUDIT} @ ramo-0`]);
});

test('auditoria: o npm que não responde JSON, que dá erro ou sem package.json vira "error:" e código 1', () => {
  const base = { 'app/package.json': PACOTE, 'app/package-lock.json': COM_VELHA };
  const semJson = cenario(base, { 'app/package-lock.json': trava({}, { semJson: true }) });
  assert.deepEqual([semJson.codigo, semJson.saida], [1, ['error: o npm audit não produziu JSON em <aud>/ramo-0: npm ERR! sem json']]);
  const baseSemJson = cenario({ 'app/package.json': PACOTE, 'app/package-lock.json': trava({}, { semJson: true }) }, { 'app/package-lock.json': COM_VELHA });
  assert.deepEqual(baseSemJson.saida, ['error: o npm audit não produziu JSON em <aud>/base-0: npm ERR! sem json']);
  const resumo = cenario(base, { 'app/package-lock.json': trava({ error: { summary: 'registro fora', code: 'E404' } }) });
  assert.deepEqual([resumo.codigo, resumo.saida], [1, ['error: o npm audit falhou: registro fora']]);
  const codigo = cenario(base, { 'app/package-lock.json': trava({ error: { code: 'E404' } }) });
  assert.deepEqual(codigo.saida, ['error: o npm audit falhou: E404']);
  const semPacote = cenario({ 'app/package-lock.json': COM_VELHA }, { 'app/package-lock.json': COM_LEVE });
  assert.equal(semPacote.codigo, 1);
  assert.match(semPacote.saida[0], /^error: ENOENT: no such file or directory, open '.*app\/package\.json'$/);
});

test('auditoria: bandeira desconhecida e base que não existe devolvem 2, e --help devolve 0 pelo CLI', () => {
  const desconhecida = cenario({ 'a.js': 'x\n' }, {}, ['--x']);
  assert.deepEqual([desconhecida.codigo, desconhecida.saida], [2, ['error: bandeira desconhecida: --x']]);
  const inexistente = cenario({ 'a.js': 'x\n' }, {}, ['--base', 'nao-existe']);
  assert.equal(inexistente.codigo, 2);
  assert.match(inexistente.saida[0], /^error: a base nao-existe não é um commit deste repositório/);
  const ajuda = cenario({ 'a.js': 'x\n' }, {}, ['--help']);
  assert.equal(ajuda.codigo, 0);
  assert.ok(ajuda.saida[0].startsWith('uso: node scripts/regras/auditoria.js [--base <ref>] [--raiz <pasta>]'));
});
