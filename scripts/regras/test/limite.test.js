'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
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

test('passa: arquivo que já passava do limite na branch-alvo e que a mudança não aumenta', () => {
  const repo = criar({ 'app/grande.js': linhas(1200) });
  repo.escrever({ 'app/grande.js': linhas(1200).replace('v5 = 5', 'v5 = 50') });
  const r = executar(repo);
  repo.limpar();
  assert.equal(r.codigo, 0, r.saida);
});

test('falha: arquivo que já passava do limite e cresce, com o teto igual ao tamanho na branch-alvo', () => {
  const repo = criar({ 'app/grande.js': linhas(1200) });
  repo.escrever({ 'app/grande.js': linhas(1201) });
  const r = executar(repo);
  repo.limpar();
  assert.equal(r.codigo, 1);
  assert.match(r.saida, /app\/grande\.js: 1201 linhas; o teto é 1200, o tamanho dele na branch-alvo: arquivo grande não pode crescer \(1 linhas a mais\)/);
});

test('encolher passa sem editar nenhuma lista, e o teto seguinte é o tamanho novo', () => {
  const repo = criar({ 'app/grande.js': linhas(1200) });
  repo.escrever({ 'app/grande.js': linhas(1100) });
  const encolheu = executar(repo);
  repo.guardar('encolhe');
  repo.git('branch', '-f', 'main', 'HEAD');
  repo.escrever({ 'app/grande.js': linhas(1150) });
  const voltou = executar(repo);
  repo.limpar();
  assert.equal(encolheu.codigo, 0, encolheu.saida);
  assert.doesNotMatch(encolheu.saida, /linha de base/);
  assert.equal(voltou.codigo, 1, voltou.saida);
  assert.match(voltou.saida, /1150 linhas; o teto é 1100/);
});

test('arquivo que cai para 1000 linhas passa, e crescer de novo acima do limite falha', () => {
  const repo = criar({ 'app/grande.js': linhas(1200) });
  repo.escrever({ 'app/grande.js': linhas(1000) });
  const cabe = executar(repo);
  repo.guardar('cabe');
  repo.git('branch', '-f', 'main', 'HEAD');
  repo.escrever({ 'app/grande.js': linhas(1001) });
  const cresce = executar(repo);
  repo.limpar();
  assert.equal(cabe.codigo, 0, cabe.saida);
  assert.equal(cresce.codigo, 1, cresce.saida);
  assert.match(cresce.saida, /app\/grande\.js: 1001 linhas, 1 acima do limite de 1000/);
});

test('falha: arquivo que cabia no limite na branch-alvo e passa dele', () => {
  const repo = criar({ 'app/medio.js': linhas(900) });
  repo.escrever({ 'app/medio.js': linhas(1100) });
  const r = executar(repo);
  repo.limpar();
  assert.equal(r.codigo, 1);
  assert.match(r.saida, /app\/medio\.js: 1100 linhas, 100 acima do limite de 1000/);
});

test('git mv leva o teto: o arquivo grande renomeado passa igual e encolhido, e falha se cresce', () => {
  const repo = criar({ 'app/grande.js': linhas(1200) });
  repo.git('mv', 'app/grande.js', 'app/outro.js');
  const igual = executar(repo);
  repo.escrever({ 'app/outro.js': linhas(1150) });
  const encolhido = executar(repo);
  repo.escrever({ 'app/outro.js': linhas(1201) });
  const cresce = executar(repo);
  repo.limpar();
  assert.equal(igual.codigo, 0, igual.saida);
  assert.equal(encolhido.codigo, 0, encolhido.saida);
  assert.equal(cresce.codigo, 1, cresce.saida);
  assert.match(cresce.saida, /app\/outro\.js: 1201 linhas; o teto é 1200/);
});

test('falha: cópia de um arquivo grande não leva o teto, nem a do que já estava na pasta isenta', () => {
  const grande = linhas(1200);
  const repo = criar({ 'app/grande.js': grande, 'MAC/x/dist/velho.js': linhas(1300) });
  repo.escrever({ 'app/copia.js': grande });
  const copia = executar(repo);
  repo.git('mv', 'MAC/x/dist/velho.js', 'app/velho.js');
  const daIsencao = executar(repo);
  repo.limpar();
  assert.equal(copia.codigo, 1, copia.saida);
  assert.match(copia.saida, /app\/copia\.js: 1200 linhas, 200 acima do limite de 1000/);
  assert.equal(daIsencao.codigo, 1, daIsencao.saida);
  assert.match(daIsencao.saida, /app\/velho\.js: 1300 linhas, 300 acima do limite de 1000/);
});

test('arquivo que a mudança apaga não é cobrado', () => {
  const repo = criar({ 'app/grande.js': linhas(1200) });
  repo.escrever({ 'app/grande.js': null });
  const r = executar(repo);
  repo.limpar();
  assert.equal(r.codigo, 0, r.saida);
});

test('não há lista a editar: a linha de base e as bandeiras dela não existem mais', () => {
  const repo = criar({ 'app/grande.js': linhas(1200) });
  const completo = repo.rodar();
  const atualizar = repo.rodar('--atualizar-linha-de-base');
  const criou = repo.rodar('--criar-linha-de-base');
  repo.limpar();
  assert.equal(completo.codigo, 0, completo.saida);
  assert.equal(atualizar.codigo, 2, atualizar.saida);
  assert.match(atualizar.saida, /bandeira desconhecida: --atualizar-linha-de-base/);
  assert.equal(criou.codigo, 2, criou.saida);
});

test('ignora dist, lock e dado; o resto não', () => {
  const grande = linhas(1500);
  const repo = criar({ 'app/grande.js': grande });
  repo.escrever({
    'app/dist/assets/bundle.js': grande,
    'app/package-lock.json': grande,
    'app/dados.json': grande,
  });
  const aceita = executar(repo);
  assert.equal(aceita.codigo, 0, aceita.saida);
  repo.escrever({ 'app/outra-copia.js': grande });
  const recusa = executar(repo);
  repo.limpar();
  assert.equal(recusa.codigo, 1);
  assert.match(recusa.saida, /app\/outra-copia\.js: 1500 linhas/);
});

test('reservas/ não é mais isenta do limite de linhas, no MAC nem nas pastas novas', () => {
  const repo = criar();
  repo.escrever({ 'MAC/x/reservas/20261115/grande.js': linhas(1500), 'iphone/x/reservas/1/grande.js': linhas(1500) });
  const r = executar(repo);
  repo.limpar();
  assert.equal(r.codigo, 1);
  for (const nome of ['MAC/x/reservas/20261115/grande.js', 'iphone/x/reservas/1/grande.js']) assert.ok(r.saida.includes(nome), r.saida);
});

test('a marca de gerado não isenta arquivo novo nem arquivo grande', () => {
  const repo = criar({ 'app/grande.js': linhas(1200) });
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
  const repo = criar({ 'app/grande.js': linhas(1200) });
  repo.escrever({ 'app/outro.js': 'const a = 1;\n' });
  const r = executar(repo);
  repo.limpar();
  assert.equal(r.codigo, 0, r.saida);
});
