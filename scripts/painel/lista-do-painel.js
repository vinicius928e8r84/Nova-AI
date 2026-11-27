'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const PREFIXO = 'Nova-AI/';
const POR_PAGINA = 100;
const GRUPOS = ['produto', 'ferramenta', 'teste'];

const AJUDA = `uso: node scripts/painel/lista-do-painel.js [--analise <id>] [--json]

Lê no painel (o CodeScene local, projeto 2) a lista de cada arquivo com nota e imprime em Markdown,
da pior nota para a melhor, separada em produto, ferramenta e teste, com quantos estão abaixo de 10.
Sem --analise, lê a análise mais nova. O token nunca é impresso.

Variáveis: PAINEL_URL (padrão http://localhost:3003), PAINEL_PROJETO (padrão 2),
PAINEL_CHAVE (caminho do arquivo do token; padrão ~/.codescene/nova-ai-token).`;

const PADROES_DE_TESTE = [
  /(^|\/)(test|tests|teste|testes|__tests__)\//,
  /\.(test|spec)\.[^/]+$/,
  /(^|\/)test_[^/]+\.py$/,
  /_test\.[^/]+$/,
  /(^|\/)teste-[^/]+$/,
];

const PADROES_DE_FERRAMENTA = [
  /^(scripts|app\/scripts|docs\/pesquisas)\//,
  /^(iphone|interface|distribuicao)\/.+\.py$/,
];

function grupoDe(caminho) {
  if (PADROES_DE_TESTE.some(padrao => padrao.test(caminho))) return 'teste';
  if (PADROES_DE_FERRAMENTA.some(padrao => padrao.test(caminho))) return 'ferramenta';
  return 'produto';
}

function semPrefixo(caminho) {
  return caminho.startsWith(PREFIXO) ? caminho.slice(PREFIXO.length) : caminho;
}

function notaDe(arquivo) {
  const nota = arquivo.code_health && arquivo.code_health.current_score;
  return typeof nota === 'number' ? nota : null;
}

function pioresPrimeiro(a, b) {
  return a.nota - b.nota || b.linhas - a.linhas || a.caminho.localeCompare(b.caminho);
}

function montarLista(arquivos) {
  const grupos = Object.fromEntries(GRUPOS.map(grupo => [grupo, []]));
  const semNota = [];
  for (const arquivo of arquivos) {
    const caminho = semPrefixo(arquivo.path);
    const nota = notaDe(arquivo);
    if (nota === null) {
      semNota.push(caminho);
      continue;
    }
    grupos[grupoDe(caminho)].push({ caminho, nota, linhas: arquivo.lines_of_code, hotspot: Boolean(arquivo.hotspot) });
  }
  for (const grupo of GRUPOS) grupos[grupo].sort(pioresPrimeiro);
  return { grupos, semNota: semNota.sort() };
}

const abaixoDe10 = itens => itens.filter(item => item.nota < 10).length;
const nota = valor => valor.toFixed(2).replace('.', ',');
const milhar = valor => valor.toLocaleString('pt-BR');

function tabelaDoGrupo(nome, itens) {
  const titulo = `### ${nome[0].toUpperCase()}${nome.slice(1)}: ${itens.length} arquivos com nota, ${abaixoDe10(itens)} abaixo de 10`;
  const linhas = itens.map((item, i) => `| ${i + 1} | ${nota(item.nota)} | ${milhar(item.linhas)} | ${item.hotspot ? 'sim' : ''} | \`${item.caminho}\` |`);
  return [titulo, '', '| # | Nota | Linhas | Hotspot | Arquivo |', '| --- | --- | --- | --- | --- |', ...linhas].join('\n');
}

function resumo(lista) {
  const todos = GRUPOS.flatMap(grupo => lista.grupos[grupo]);
  const linhas = GRUPOS.map(grupo => {
    const itens = lista.grupos[grupo];
    return `| ${grupo} | ${itens.length} | ${abaixoDe10(itens)} | ${milhar(itens.reduce((soma, item) => soma + item.linhas, 0))} |`;
  });
  const total = `| **total** | **${todos.length}** | **${abaixoDe10(todos)}** | **${milhar(todos.reduce((soma, item) => soma + item.linhas, 0))}** |`;
  return ['| Grupo | Com nota | Abaixo de 10 | Linhas |', '| --- | --- | --- | --- |', ...linhas, total].join('\n');
}

function formatarMarkdown(lista, analise) {
  const cabecalho = `Análise ${analise.id} do painel, de ${analise.data}, sobre o commit \`${analise.commit.slice(0, 7)}\` (\`${analise.commit}\`).`;
  const semNota = lista.semNota.length
    ? `### Sem nota: ${lista.semNota.length} arquivos\n\n${lista.semNota.map(caminho => `- \`${caminho}\``).join('\n')}`
    : '### Sem nota: nenhum arquivo';
  return [cabecalho, resumo(lista), ...GRUPOS.map(grupo => tabelaDoGrupo(grupo, lista.grupos[grupo])), semNota].join('\n\n') + '\n';
}

function lerChave(arquivo) {
  try {
    return fs.readFileSync(arquivo, 'utf8').trim();
  } catch {
    throw new Error(`não consegui ler o arquivo do token em ${arquivo}`);
  }
}

function clienteDoPainel({ url, projeto, chave }) {
  return async rota => {
    const resposta = await fetch(`${url}/api/v2/projects/${projeto}${rota}`, { headers: { Authorization: `Bearer ${chave}`, Accept: 'application/json' } });
    if (!resposta.ok) throw new Error(`o painel respondeu ${resposta.status} em ${rota}`);
    return resposta.json();
  };
}

async function lerAnalise(pedir, id) {
  const analise = await pedir(`/analyses/${id}`);
  const revisao = (analise.analysis_repo_revisions || [])[0] || {};
  return { id: analise.id, data: analise.readable_analysis_time, commit: revisao.revision || '?' };
}

async function lerArquivos(pedir, id) {
  const arquivos = [];
  for (let pagina = 1, ultima = 1; pagina <= ultima; pagina++) {
    const resposta = await pedir(`/analyses/${id}/files?page_size=${POR_PAGINA}&page=${pagina}`);
    ultima = resposta.max_pages;
    arquivos.push(...resposta.files);
  }
  return arquivos;
}

function lerArgumentos(argv) {
  const opcoes = { analise: 'latest', json: false, ajuda: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--analise') opcoes.analise = argv[++i];
    else if (argv[i] === '--json') opcoes.json = true;
    else if (argv[i] === '--help' || argv[i] === '-h') opcoes.ajuda = true;
    else throw new Error(`argumento desconhecido: ${argv[i]}`);
  }
  return opcoes;
}

async function principal(argv, ambiente) {
  const opcoes = lerArgumentos(argv);
  if (opcoes.ajuda) return `${AJUDA}\n`;
  const pedir = clienteDoPainel({
    url: ambiente.PAINEL_URL || 'http://localhost:3003',
    projeto: ambiente.PAINEL_PROJETO || '2',
    chave: lerChave(ambiente.PAINEL_CHAVE || path.join(os.homedir(), '.codescene', 'nova-ai-token')),
  });
  const analise = await lerAnalise(pedir, opcoes.analise);
  const lista = montarLista(await lerArquivos(pedir, analise.id));
  return opcoes.json ? `${JSON.stringify({ analise, ...lista }, null, 2)}\n` : formatarMarkdown(lista, analise);
}

if (require.main === module) {
  principal(process.argv.slice(2), process.env).then(
    saida => process.stdout.write(saida),
    erro => {
      process.stderr.write(`erro: ${erro.message}\n`);
      process.exit(1);
    },
  );
}

module.exports = { grupoDe, montarLista, formatarMarkdown, lerArgumentos };
