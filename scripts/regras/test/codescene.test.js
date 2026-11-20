'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CHECK_DO_SERVIDOR, cobranca, situacaoDoCheck, conferir } = require('../../ci/codescene-na-refatoracao');

const HEAD = 'a'.repeat(40);
const pr = (numero, titulo = 'Algo', rotulos = []) => ({ numero, titulo, rotulos, head: HEAD });
const servidor = (id, status, conclusion = null) => ({ id, name: CHECK_DO_SERVIDOR, status, conclusion, app: 'codescene-perpetualminer-vinicius' });
const nuvem = (id, status, conclusion = null) => ({ id, name: 'CodeScene PR Review', status, conclusion, app: 'codescene-cloud' });

test('cobrança: número, título e rótulo', () => {
  assert.equal(cobranca(pr(37)).cobra, false);
  assert.equal(cobranca(pr(38)).cobra, true);
  assert.equal(cobranca(pr(99)).cobra, true);
  assert.equal(cobranca(pr(10, 'Refatoração do painel')).cobra, true);
  assert.equal(cobranca(pr(10, 'refatoracao do painel')).cobra, true);
  assert.equal(cobranca(pr(10, 'Corrige botão', ['refatoracao'])).cobra, true);
  assert.equal(cobranca(pr(10, 'Corrige botão', ['bug'])).cobra, false);
});

test('situação: ausente, rodando, passou e reprovou', () => {
  assert.equal(situacaoDoCheck([]).estado, 'ausente');
  assert.equal(situacaoDoCheck([{ ...servidor(1, 'completed', 'success'), name: 'Regras de revisão', app: 'github-actions' }]).estado, 'ausente');
  assert.equal(situacaoDoCheck([servidor(1, 'queued')]).estado, 'rodando');
  assert.equal(situacaoDoCheck([servidor(1, 'completed', 'success')]).estado, 'passou');
  for (const c of ['failure', 'neutral', 'cancelled', 'timed_out', 'skipped']) assert.equal(situacaoDoCheck([servidor(1, 'completed', c)]).estado, 'reprovou');
  assert.equal(situacaoDoCheck([servidor(1, 'completed', 'failure'), servidor(2, 'completed', 'success')]).estado, 'passou');
});

test('situação: o check da nuvem conta quando existe e não trava quando não existe', () => {
  assert.equal(situacaoDoCheck([servidor(1, 'completed', 'success'), nuvem(2, 'completed', 'failure')]).estado, 'reprovou');
  assert.equal(situacaoDoCheck([servidor(1, 'completed', 'success'), nuvem(2, 'in_progress')]).estado, 'rodando');
  assert.equal(situacaoDoCheck([servidor(1, 'completed', 'success'), nuvem(2, 'completed', 'success')]).estado, 'passou');
  assert.equal(situacaoDoCheck([servidor(1, 'completed', 'success')]).estado, 'passou');
  assert.equal(situacaoDoCheck([nuvem(1, 'completed', 'success')]).estado, 'ausente');
});

function portasCom(respostas) {
  const estado = { agora: 0, lidas: 0 };
  return {
    estado,
    portas: {
      lerChecks: async () => respostas[Math.min(estado.lidas++, respostas.length - 1)],
      dormir: async s => { estado.agora += s * 1000; },
      agora: () => estado.agora,
      avisar: () => {},
    },
  };
}

test('espera: passa quando o check chega, reprova no prazo e isenta PR antiga', async () => {
  let { portas, estado } = portasCom([[], [servidor(1, 'in_progress')], [servidor(1, 'completed', 'success')]]);
  assert.equal((await conferir(pr(40), portas, 600)).ok, true);
  assert.equal(estado.lidas, 3);

  ({ portas, estado } = portasCom([[]]));
  const r = await conferir(pr(40), portas, 600);
  assert.equal(r.ok, false);
  assert.match(r.mensagem, /ainda não reportou em 600 s/);
  assert.equal(estado.agora, 600000);

  ({ portas } = portasCom([[servidor(1, 'completed', 'success'), nuvem(2, 'completed', 'failure')]]));
  assert.match((await conferir(pr(40), portas, 600)).mensagem, /CodeScene PR Review.*failure/);

  ({ portas, estado } = portasCom([[servidor(1, 'completed', 'failure')]]));
  assert.equal((await conferir(pr(10), portas, 600)).ok, true);
  assert.equal(estado.lidas, 0);
});
