'use strict';

const WORKFLOW = 'registro-da-pr.yml';

function cliente(env) {
  return async (metodo, caminho, corpo) => {
    const resposta = await fetch(`${env.GITHUB_API_URL || 'https://api.github.com'}/repos/${env.GITHUB_REPOSITORY}/${caminho}`, {
      method: metodo,
      headers: { accept: 'application/vnd.github+json', 'content-type': 'application/json', ...(env.GITHUB_TOKEN ? { authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}) },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    if (!resposta.ok) throw new Error(`o GitHub respondeu ${resposta.status} a ${metodo} ${caminho}`);
    const texto = await resposta.text();
    return texto ? JSON.parse(texto) : null;
  };
}

async function execucaoDoCheck(pedir, head) {
  const { workflow_runs: execucoes } = await pedir('GET', `actions/workflows/${WORKFLOW}/runs?head_sha=${head}&per_page=20`);
  return execucoes.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] || null;
}

const semExecucao = ({ numero, repo }) => '  O check "Registro da PR" não tem execução neste head, e um comentário não cria uma. Se a PR acabou de receber '
  + 'um commit ou uma edição, espere um minuto e confira de novo. Senão, feche e reabra a PR (o head não muda, e a revisão e a prova continuam valendo): '
  + `gh pr close ${numero} -R ${repo} && gh pr reopen ${numero} -R ${repo}`;

async function rodarDeNovo(pedir, pr, qual) {
  const execucao = await execucaoDoCheck(pedir, pr.head);
  if (!execucao) return semExecucao(qual);
  if (execucao.status !== 'completed') return `  O check já está rodando neste head (execução ${execucao.id}).`;
  await pedir('POST', `actions/runs/${execucao.id}/rerun`);
  return `  Check rodando de novo (execução ${execucao.id}): ${execucao.html_url || ''}`.trimEnd();
}

module.exports = { cliente, execucaoDoCheck, rodarDeNovo, semExecucao };
