'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { criar, linhas } = require('./auxiliar');

const executar = (repo, ...args) => repo.rodar('--regra', 'limite-de-linhas', ...args);

test('passa: arquivo novo com exatamente 1000 linhas', () => {
  const repo = criar();
  repo.escrever({ 'app/novo.js': linhas(1000) });
  const r = executar(repo);
  repo.limpar();
  assert.equal(r.codigo, 0, r.saida);
});

test('falha: arquivo novo com 1001 linhas', () => {
  const repo = criar();
  repo.escrever({ 'app/novo.js': linhas(1001) });
  const r = executar(repo);
  repo.limpar();
  assert.equal(r.codigo, 1);
  assert.match(r.saida, /app\/novo\.js: 1001 linhas, 1 acima do limite de 1000/);
});

test('passa: arquivo grande da linha de base que a mudança não aumenta', () => {
  const repo = criar({ 'app/grande.js': linhas(1200) }, { 'app/grande.js': 1200 });
  repo.escrever({ 'app/grande.js': linhas(1200).replace('v5 = 5', 'v5 = 50') });
  const r = executar(repo);
  repo.limpar();
  assert.equal(r.codigo, 0, r.saida);
});

test('falha: arquivo grande da linha de base que cresce', () => {
  const repo = criar({ 'app/grande.js': linhas(1200) }, { 'app/grande.js': 1200 });
  repo.escrever({ 'app/grande.js': linhas(1201) });
  const r = executar(repo);
  repo.limpar();
  assert.equal(r.codigo, 1);
  assert.match(r.saida, /1201 linhas; a linha de base o deixa em 1200/);
});

test('falha: subir a linha de base à mão para o arquivo poder crescer', () => {
  const repo = criar({ 'app/grande.js': linhas(1200) }, { 'app/grande.js': 1200 });
  repo.escrever({ 'app/grande.js': linhas(1300) });
  repo.lista({ 'app/grande.js': 1300 });
  const r = executar(repo);
  repo.limpar();
  assert.equal(r.codigo, 1);
  assert.match(r.saida, /a linha de base subiu de 1200 para 1300/);
});

test('falha: listar na linha de base um arquivo novo acima do limite', () => {
  const repo = criar();
  repo.escrever({ 'app/novo.js': linhas(1100) });
  repo.lista({ 'app/novo.js': 1100 });
  const r = executar(repo);
  repo.limpar();
  assert.equal(r.codigo, 1);
  assert.match(r.saida, /entrou na linha de base, que só encolhe/);
});

test('encolher exige baixar a linha de base, e --atualizar-linha-de-base a baixa', () => {
  const repo = criar({ 'app/grande.js': linhas(1200) }, { 'app/grande.js': 1200 });
  repo.escrever({ 'app/grande.js': linhas(1100) });
  const antes = executar(repo);
  assert.equal(antes.codigo, 1);
  assert.match(antes.saida, /tem 1100 linhas e a linha de base do ramo diz 1200/);
  assert.equal(repo.rodar('--atualizar-linha-de-base').codigo, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(repo.raiz, 'scripts/regras/linha-de-base.json'), 'utf8')).arquivos, { 'app/grande.js': 1100 });
  const depois = executar(repo);
  repo.limpar();
  assert.equal(depois.codigo, 0, depois.saida);
});

test('arquivo que cai para 1000 linhas sai da lista', () => {
  const repo = criar({ 'app/grande.js': linhas(1200) }, { 'app/grande.js': 1200 });
  repo.escrever({ 'app/grande.js': linhas(1000) });
  assert.equal(executar(repo).codigo, 1);
  assert.equal(repo.rodar('--atualizar-linha-de-base').codigo, 0);
  const depois = executar(repo);
  repo.limpar();
  assert.equal(depois.codigo, 0, depois.saida);
});

test('--atualizar-linha-de-base recusa subir', () => {
  const repo = criar({ 'app/grande.js': linhas(1200) }, { 'app/grande.js': 1200 });
  repo.escrever({ 'app/grande.js': linhas(1250) });
  const r = repo.rodar('--atualizar-linha-de-base');
  repo.limpar();
  assert.equal(r.codigo, 1);
  assert.match(r.saida, /nada foi atualizado/);
});

test('arquivo grande renomeado herda o teto do nome antigo', () => {
  const repo = criar({ 'app/grande.js': linhas(1200) }, { 'app/grande.js': 1200 });
  repo.git('mv', 'app/grande.js', 'app/outro.js');
  const r = executar(repo);
  assert.equal(r.codigo, 1);
  assert.match(r.saida, /app\/grande\.js: o arquivo não existe mais neste caminho/);
  assert.equal(repo.rodar('--atualizar-linha-de-base').codigo, 0);
  const depois = executar(repo);
  repo.limpar();
  assert.equal(depois.codigo, 0, depois.saida);
});

test('ignora dist, lock e dado; reservas aceita cópia mas o resto não', () => {
  const grande = linhas(1500);
  const repo = criar({ 'app/grande.js': grande }, { 'app/grande.js': 1500 });
  repo.escrever({
    'app/dist/assets/bundle.js': grande,
    'app/package-lock.json': grande,
    'app/dados.json': grande,
    'MAC/x/reservas/20261115/grande.js': grande,
  });
  const aceita = executar(repo);
  assert.equal(aceita.codigo, 0, aceita.saida);
  repo.escrever({ 'app/outra-copia.js': grande });
  const recusa = executar(repo);
  repo.limpar();
  assert.equal(recusa.codigo, 1);
  assert.match(recusa.saida, /app\/outra-copia\.js: 1500 linhas/);
});

test('a marca de gerado não isenta arquivo novo nem arquivo da linha de base', () => {
  const repo = criar({ 'app/grande.js': linhas(1200) }, { 'app/grande.js': 1200 });
  repo.escrever({ 'app/grande.js': `// DO NOT EDIT\n${linhas(1300)}`, 'app/novo.js': `'@generated';\n${linhas(3000)}` });
  const r = executar(repo);
  repo.limpar();
  assert.equal(r.codigo, 1);
  assert.match(r.saida, /arquivo grande não pode crescer/);
  assert.match(r.saida, /app\/novo\.js: 3001 linhas/);
});

test('pastas com nome de dist, vendor ou reservas fora do lugar previsto não escapam do limite', () => {
  const repo = criar();
  repo.escrever({ 'app/electron/services/vendor/x.js': linhas(1500), 'app/electron/dist/y.js': linhas(1500), 'app/reservas/z.js': linhas(1500) });
  const r = executar(repo);
  repo.limpar();
  assert.equal(r.codigo, 1);
  for (const nome of ['vendor/x.js', 'dist/y.js', 'app/reservas/z.js']) assert.ok(r.saida.includes(nome), r.saida);
});

test('arquivo que não foi tocado não é cobrado', () => {
  const repo = criar({ 'app/grande.js': linhas(1200) }, {});
  repo.escrever({ 'app/outro.js': 'const a = 1;\n' });
  const r = executar(repo);
  repo.limpar();
  assert.equal(r.codigo, 0, r.saida);
});
