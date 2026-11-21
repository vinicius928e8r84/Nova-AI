'use strict';

const { execFileSync } = require('child_process');

const CHECK_DO_SERVIDOR = 'CodeScene Code Health Review (main)';
const PRIMEIRA_PR_COBRADA = 38;
const ROTULO_DE_REFATORACAO = 'refatoracao';
const TITULO_DE_REFATORACAO = /refatora/i;
const E_DO_CODESCENE = check => /^codescene/i.test(check.name) || /^codescene/i.test(check.app || '');
const PRAZO_PADRAO_S = 600;
const INTERVALO_S = 20;

const AJUDA = `uso: PR_NUMERO=… PR_TITULO=… PR_ROTULOS='["…"]' PR_HEAD=<sha> GITHUB_REPOSITORY=dono/repo GH_TOKEN=… node scripts/ci/codescene-na-refatoracao.js

Passo "CodeScene na refatoração" do job "Regras de revisão". A PR de número ${PRIMEIRA_PR_COBRADA} ou maior, ou com "refatora" no
título, ou com o rótulo ${ROTULO_DE_REFATORACAO}, só passa com o CodeScene em success no head. Cada check do CodeScene que existir no head
conta (o do servidor antigo, "${CHECK_DO_SERVIDOR}", e o da nuvem); vale a rodada mais nova de cada um.
O do servidor antigo é obrigatório: se não terminar em PM_PRAZO_CODESCENE_S segundos (padrão ${PRAZO_PADRAO_S}), falha dizendo isso.
O da nuvem só reprova se aparecer reprovado: se não apareceu depois da espera, a PR não fica travada por ele.`;

function cobranca({ numero, titulo, rotulos }) {
  if (numero >= PRIMEIRA_PR_COBRADA) return { cobra: true, motivo: `a PR #${numero} é a #${PRIMEIRA_PR_COBRADA} ou posterior` };
  if (rotulos.includes(ROTULO_DE_REFATORACAO)) return { cobra: true, motivo: `a PR #${numero} tem o rótulo ${ROTULO_DE_REFATORACAO}` };
  if (TITULO_DE_REFATORACAO.test(titulo)) return { cobra: true, motivo: `o título da PR #${numero} cita refatoração` };
  return { cobra: false, motivo: `a PR #${numero} é anterior à #${PRIMEIRA_PR_COBRADA} e não é de refatoração: isenta` };
}

function ultimaRodadaPorCheck(checkRuns) {
  const ultimas = new Map();
  for (const check of checkRuns.filter(E_DO_CODESCENE).sort((a, b) => a.id - b.id)) ultimas.set(`${check.app}/${check.name}`, check);
  return [...ultimas.values()];
}

function situacaoDoCheck(checkRuns) {
  const ultimas = ultimaRodadaPorCheck(checkRuns);
  const servidor = ultimas.some(check => check.name === CHECK_DO_SERVIDOR);
  const reprovada = ultimas.find(check => check.status === 'completed' && check.conclusion !== 'success');
  if (reprovada) return { estado: 'reprovou', conclusao: reprovada.conclusion, nome: reprovada.name };
  const pendente = ultimas.find(check => check.status !== 'completed');
  if (pendente) return { estado: 'rodando', nome: pendente.name };
  return servidor ? { estado: 'passou' } : { estado: 'ausente', nome: CHECK_DO_SERVIDOR };
}

const SEM_RESPOSTA = { ausente: 'ainda não reportou', rodando: 'ainda não terminou' };

function veredito(situacao, pr) {
  if (situacao.estado === 'passou') return { ok: true, mensagem: `✓ CodeScene em success no head ${pr.head.slice(0, 7)} da PR #${pr.numero}` };
  return {
    ok: false,
    mensagem: `✗ o check "${situacao.nome}" do head ${pr.head.slice(0, 7)} da PR #${pr.numero} está em ${situacao.conclusao}, não em success. `
      + 'Conserto: refatore até a nota de cada arquivo tocado não cair (o check diz qual); nunca desligue o gate.',
  };
}

function semResposta(situacao, pr, prazoS) {
  return {
    ok: false,
    mensagem: `✗ o check "${situacao.nome}" do head ${pr.head.slice(0, 7)} da PR #${pr.numero} ${SEM_RESPOSTA[situacao.estado]} em ${prazoS} s. `
      + 'Quando o CodeScene reportar, rode este job de novo (ou edite o corpo da PR).',
  };
}

async function conferir(pr, portas, prazoS = PRAZO_PADRAO_S) {
  const { cobra, motivo } = cobranca(pr);
  if (!cobra) return { ok: true, mensagem: `${motivo}; o check do CodeScene não é exigido aqui` };
  const limite = portas.agora() + prazoS * 1000;
  for (;;) {
    const situacao = situacaoDoCheck(await portas.lerChecks(pr.head));
    if (!(situacao.estado in SEM_RESPOSTA)) return veredito(situacao, pr);
    if (portas.agora() >= limite) return semResposta(situacao, pr, prazoS);
    portas.avisar(`CodeScene ${SEM_RESPOSTA[situacao.estado]}; confiro de novo em ${INTERVALO_S} s`);
    await portas.dormir(INTERVALO_S);
  }
}

function lerChecksPeloGh(repo) {
  return sha => execFileSync('gh', ['api', `repos/${repo}/commits/${sha}/check-runs?per_page=100`,
    '--jq', '.check_runs[] | {id, name, status, conclusion, app: .app.slug}'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    .split('\n').filter(Boolean).map(linha => JSON.parse(linha));
}

function problemaDoAmbiente(env) {
  if (!/^[1-9][0-9]*$/.test(env.PR_NUMERO || '')) return `PR_NUMERO inválido: ${env.PR_NUMERO}`;
  if (!/^[0-9a-f]{40}$/.test(env.PR_HEAD || '')) return `PR_HEAD não é um SHA inteiro: ${env.PR_HEAD}`;
  return env.GITHUB_REPOSITORY ? null : 'falta GITHUB_REPOSITORY';
}

function prDoAmbiente(env) {
  const problema = problemaDoAmbiente(env);
  if (problema) throw new Error(problema);
  return { numero: Number(env.PR_NUMERO), titulo: env.PR_TITULO || '', rotulos: JSON.parse(env.PR_ROTULOS || '[]'), head: env.PR_HEAD };
}

async function principal(argv, env) {
  if (argv.includes('--help')) {
    console.log(AJUDA);
    return 0;
  }
  const pr = prDoAmbiente(env);
  const portas = {
    lerChecks: lerChecksPeloGh(env.GITHUB_REPOSITORY),
    dormir: segundos => new Promise(resolver => setTimeout(resolver, segundos * 1000)),
    agora: () => Date.now(),
    avisar: texto => console.log(texto),
  };
  const { ok, mensagem } = await conferir(pr, portas, Number(env.PM_PRAZO_CODESCENE_S || PRAZO_PADRAO_S));
  console.log(mensagem);
  return ok ? 0 : 1;
}

module.exports = { CHECK_DO_SERVIDOR, PRIMEIRA_PR_COBRADA, cobranca, situacaoDoCheck, conferir };

if (require.main === module) {
  principal(process.argv.slice(2), process.env).then(codigo => process.exit(codigo), erro => {
    console.log(`error: ${erro.message}\nhelp: node scripts/ci/codescene-na-refatoracao.js --help`);
    process.exit(1);
  });
}
