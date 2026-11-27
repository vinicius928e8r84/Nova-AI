'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const { corpoComAProva, lerArgumentos, planejar, registroDaRevisao, secaoDaProva } = require('../registrar-na-pr');

const REGISTRAR_NA_PR = path.join(__dirname, '..', 'registrar-na-pr.js');
const HEAD = 'a'.repeat(40);
const OUTRO = 'b'.repeat(40);
const DESCRICAO = 'Corrige o botão do iPhone que mostrava Parar transmissão em vez de Abrir controle depois do patch.';
const NOTA = 'Rodei o app no Mac e abri o cartão do iPhone: o botão mostrou Abrir controle.';
const CORPO = `${DESCRICAO}\nAtenção: BAIXA\n`;
const REVISAO_PRONTA = `Veredito: CLEAN\nHead: ${HEAD}\nAutor: agente-a\nRevisor: agente-b\nRisco: BAIXA\n`;
const PR = { head: HEAD, corpo: CORPO, rotulos: [], arquivos: [], registros: [], autor: 'dono' };
const NO_JSON = valor => JSON.parse(JSON.stringify(valor));

function erroDe(argumentos) {
  try {
    lerArgumentos(argumentos);
  } catch (erro) {
    return { nome: erro.constructor.name, mensagem: erro.message };
  }
  return null;
}

test('lerArgumentos: sem comando ou com --help em qualquer lugar pede a ajuda', () => {
  for (const argumentos of [[], ['--help'], ['-h'], ['conferir', '--help'], ['revisao', '--pr', '3', '--help'], ['x', '--help']]) {
    assert.deepEqual(lerArgumentos(argumentos), { ajuda: true }, argumentos.join(' '));
  }
});

test('lerArgumentos: erros de uso são ErroDeUso com a mensagem que diz o conserto', () => {
  const uso = (argumentos, mensagem) => assert.deepEqual(erroDe(argumentos), { nome: 'ErroDeUso', mensagem }, argumentos.join(' '));
  uso(['x'], 'comando desconhecido: x');
  uso(['conferir'], '--pr <número> é obrigatório');
  uso(['conferir', '--pr', 'x'], '--pr <número> é obrigatório');
  uso(['conferir', '--pr', ''], '--pr <número> é obrigatório');
  uso(['conferir', '--pr'], '--pr precisa de um valor');
  uso(['conferir', '--pr', '--head', 'x'], '--pr precisa de um valor');
  uso(['conferir', 'pr', '12'], 'opção desconhecida: pr');
  uso(['conferir', '--pr', '12', '--nada', 'x'], 'opção desconhecida: --nada');
  uso(['conferir', '--pr', '12', '--publicar', '--head'], '--head precisa de um valor');
  uso(['revisao', '--pr', '12', '--head', HEAD, '--autor', 'a', '--revisor', 'b'], 'revisao pede --risco');
  uso(['revisao', '--pr', '12', '--head', HEAD, '--autor', 'a'], 'revisao pede --revisor, --risco');
  uso(['revisao', '--pr', '12', '--autor', 'a', '--revisor', 'b', '--risco', 'alta'], 'revisao pede --head');
  uso(['revisao', '--pr', '12', '--head', '  ', '--autor', 'a', '--revisor', 'b', '--risco', 'alta'], 'revisao pede --head');
  uso(['revisao', '--pr', '12'], 'revisao pede --head, --autor, --revisor, --risco');
  uso(['revisao', '--pr', '12', '--head', HEAD, '--autor', 'a', '--revisor', 'b', '--risco', 'x'], '--risco é baixa, média, alta');
  uso(['prova', '--pr', '12', '--head', HEAD, '--nota', 'n.md'], 'prova pede --cobertura');
  uso(['prova', '--pr', '12'], 'prova pede --head, --cobertura, --nota');
  uso(['prova', '--pr', '12', '--head', HEAD, '--cobertura', 'meia', '--nota', 'n.md'], '--cobertura é total ou parcial');
});

test('lerArgumentos: devolve só o que foi dito, com veredito CLEAN e ensaio por padrão, e normaliza risco e head', () => {
  assert.deepEqual(NO_JSON(lerArgumentos(['conferir', '--pr', '12'])), { comando: 'conferir', veredito: 'CLEAN', publicar: false, pr: '12' });
  assert.deepEqual(NO_JSON(lerArgumentos(['conferir', '--pr', '12', '--publicar', '--repo', 'a/b', '--head', ` ${HEAD.toUpperCase()} `])), {
    comando: 'conferir', veredito: 'CLEAN', publicar: true, pr: '12', repo: 'a/b', head: HEAD,
  });
  assert.deepEqual(NO_JSON(lerArgumentos(['revisao', '--pr', '12', '--head', HEAD, '--autor', 'a', '--revisor', 'b', '--risco', ' média '])), {
    comando: 'revisao', veredito: 'CLEAN', publicar: false, pr: '12', head: HEAD, autor: 'a', revisor: 'b', risco: 'MÉDIA',
  });
  assert.deepEqual(NO_JSON(lerArgumentos(['revisao', '--pr', '12', '--head', HEAD, '--autor', 'a', '--revisor', 'b', '--risco', 'alta', '--veredito', 'MUDANÇAS', '--nota', 'n.md', '--publicar'])), {
    comando: 'revisao', veredito: 'MUDANÇAS', publicar: true, pr: '12', head: HEAD, autor: 'a', revisor: 'b', risco: 'ALTA', nota: 'n.md',
  });
  assert.deepEqual(NO_JSON(lerArgumentos(['prova', '--pr', '12', '--head', HEAD, '--cobertura', 'parcial', '--nota', 'n.md'])), {
    comando: 'prova', veredito: 'CLEAN', publicar: false, pr: '12', head: HEAD, cobertura: 'parcial', nota: 'n.md',
  });
});

test('registroDaRevisao e secaoDaProva: o texto que vai para a PR, com a nota aparada depois de uma linha em branco', () => {
  const opcoes = { veredito: 'CLEAN', head: HEAD, autor: 'a', revisor: 'b', risco: 'ALTA' };
  assert.equal(registroDaRevisao(opcoes, '  nota\n'), `Registro de revisão independente\n\nVeredito: CLEAN\nHead: ${HEAD}\nAutor: a\nRevisor: b\nRisco: ALTA\n\nnota`);
  assert.equal(registroDaRevisao(opcoes, ''), `Registro de revisão independente\n\nVeredito: CLEAN\nHead: ${HEAD}\nAutor: a\nRevisor: b\nRisco: ALTA`);
  assert.equal(registroDaRevisao({ ...opcoes, veredito: 'MUDANÇAS' }, undefined).split('\n')[2], 'Veredito: MUDANÇAS');
  assert.equal(secaoDaProva(HEAD, 'nota  \n', 'total'), `## Prova real\n\nPROVADO 100% REAL\nHead: ${HEAD}\n\nnota`);
  assert.equal(secaoDaProva(HEAD, '', 'parcial'), `## Prova real\n\nBLOQUEADA-iPhone\nHead: ${HEAD}`);
  assert.equal(secaoDaProva(HEAD, undefined, 'total'), `## Prova real\n\nPROVADO 100% REAL\nHead: ${HEAD}`);
  assert.equal(secaoDaProva(HEAD, 'x', undefined), `## Prova real\n\nPROVADO 100% REAL\nHead: ${HEAD}\n\nx`);
});

test('corpoComAProva: a seção entra no fim do corpo ou troca a que já existe, até o título de nível igual ou menor', () => {
  const casos = [
    ['', '\n\n## Prova real\n\nX\n'],
    [undefined, '\n\n## Prova real\n\nX\n'],
    ['texto', 'texto\n\n## Prova real\n\nX\n'],
    ['texto\n\n\n', 'texto\n\n## Prova real\n\nX\n'],
    ['a\r\n## Prova real\r\nvelha\r\n## Outra\r\nfim', 'a\n## Prova real\n\nX\n\n## Outra\nfim'],
    ['## Prova real\nvelha', '## Prova real\n\nX\n'],
    ['# Prova real\nv\n## Sub\nx\n# Fim\nz', '## Prova real\n\nX\n\n# Fim\nz'],
    ['## prova REAL ##\nv\n### detalhe\nw\n## B\nz', '## Prova real\n\nX\n\n## B\nz'],
    ['## **Prova real**\nv', '## Prova real\n\nX\n'],
    ['## A\n## Prova real\n## Prova real\nsegunda', '## A\n## Prova real\n\nX\n\n## Prova real\nsegunda'],
    ['<!-- ## Prova real -->\ntexto', '<!-- ## Prova real -->\ntexto\n\n## Prova real\n\nX\n'],
    ['```\n## Prova real\nx\n```\nresto', '```\n## Prova real\nx\n```\nresto\n\n## Prova real\n\nX\n'],
    ['~~~\n## Prova real\n~~~~\n## Prova real\nfim', '~~~\n## Prova real\n~~~~\n## Prova real\n\nX\n'],
    ['```\nx\n```\n## Prova real\nvelha', '```\nx\n```\n## Prova real\n\nX\n'],
    ['````\nx\n```\n## Prova real\n````\n## Prova real\nvelha', '````\nx\n```\n## Prova real\n````\n## Prova real\n\nX\n'],
    ['x\n<!--\n## Prova real\n-->\n## Prova real\nvelha\n<!-- ## Fim -->\n## Fim\n', 'x\n<!--\n## Prova real\n-->\n## Prova real\n\nX\n\n## Fim\n'],
    ['## Prova real\nv\n\n```\n## Fim\n```\nainda', '## Prova real\n\nX\n'],
  ];
  for (const [corpo, esperado] of casos) assert.equal(corpoComAProva(corpo, '## Prova real\n\nX'), esperado, JSON.stringify(corpo));
});

test('planejar conferir: o plano é só o que o check diria agora', () => {
  const plano = planejar({ comando: 'conferir' }, PR, '');
  assert.deepEqual(Object.keys(plano), ['depois']);
  assert.equal(plano.depois.ok, false);
  assert.match(plano.depois.mensagem, /^✗ O registro da PR não vale para o head a{40}:\n {4}- nenhum comentário ou revisão/);
  assert.equal(planejar({ comando: 'conferir' }, { ...PR, registros: [REVISAO_PRONTA] }, '').depois.ok, true);
});

test('planejar revisao: recusa head de outro commit, head curto e registro que o check não aceitaria', () => {
  const opcoes = { comando: 'revisao', veredito: 'CLEAN', head: HEAD, autor: 'agente-a', revisor: 'agente-b', risco: 'BAIXA' };
  assert.deepEqual(planejar({ ...opcoes, head: OUTRO }, PR, ''), {
    recusa: `a revisão é do commit ${OUTRO}, e o head da PR agora é ${HEAD}: um commit novo muda o head, e o que valia para o anterior não vale. Revise o head novo (\`git diff bbbbbbbb..aaaaaaaa\` mostra o que mudou).`,
  });
  assert.deepEqual(planejar({ ...opcoes, head: 'abc' }, PR, ''), { recusa: '--head pede o SHA inteiro, de 40 caracteres (`git rev-parse HEAD`); veio "abc"' });
  assert.deepEqual(planejar({ ...opcoes, revisor: 'AGENTE-A' }, PR, ''), { recusa: 'o check não aceitaria este registro: o revisor do registro é o próprio autor (agente-a)' });
  assert.deepEqual(planejar(opcoes, { ...PR, autor: 'Agente-B' }, ''), { recusa: 'o check não aceitaria este registro: o revisor do registro (agente-b) é quem abriu a PR' });
});

test('planejar revisao: o registro bom vira comentário e o check é conferido com ele junto dos que já existiam', () => {
  const opcoes = { comando: 'revisao', veredito: 'CLEAN', head: HEAD, autor: 'agente-a', revisor: 'agente-b', risco: 'BAIXA' };
  const plano = planejar(opcoes, PR, 'nota da revisão\n');
  assert.equal(plano.comentario, `Registro de revisão independente\n\nVeredito: CLEAN\nHead: ${HEAD}\nAutor: agente-a\nRevisor: agente-b\nRisco: BAIXA\n\nnota da revisão`);
  assert.deepEqual(plano.depois, { ok: true, mensagem: `registro da PR ok no head ${HEAD}: atenção BAIXA, revisão CLEAN` });
  const comRegistroRuim = planejar(opcoes, { ...PR, registros: [`Veredito: MUDANÇAS\nHead: ${HEAD}\nAutor: x\nRevisor: y\nRisco: BAIXA`] }, '');
  assert.match(comRegistroRuim.recusa, /^o check não aceitaria este registro: um registro de revisão deste head tem o veredito MUDANÇAS/);
});

test('planejar revisao: veredito que não é CLEAN é publicado sem a recusa e o check diz que ele não vale', () => {
  const plano = planejar({ comando: 'revisao', veredito: 'MUDANÇAS', head: HEAD, autor: 'agente-a', revisor: 'agente-a', risco: 'ALTA' }, PR, '');
  assert.match(plano.comentario, /^Registro de revisão independente\n\nVeredito: MUDANÇAS\n/);
  assert.equal(plano.depois.ok, false);
  assert.match(plano.depois.mensagem, /veredito MUDANÇAS, não CLEAN/);
});

test('planejar prova: a seção total entra no corpo e o check é conferido com o corpo novo', () => {
  const opcoes = { comando: 'prova', head: HEAD, cobertura: 'total' };
  const plano = planejar(opcoes, { ...PR, registros: [REVISAO_PRONTA], corpo: `${DESCRICAO}\nAtenção: ALTA\n` }, NOTA);
  assert.equal(plano.secao, `## Prova real\n\nPROVADO 100% REAL\nHead: ${HEAD}\n\n${NOTA}`);
  assert.equal(plano.corpo, `${DESCRICAO}\nAtenção: ALTA\n\n${plano.secao}\n`);
  assert.deepEqual(plano.depois, { ok: true, mensagem: `registro da PR ok no head ${HEAD}: atenção ALTA, revisão CLEAN, PROVADO 100% REAL` });
});

test('planejar prova: recusa head de outro commit, nota parcial dita como total e prova que o check não aceitaria', () => {
  const opcoes = { comando: 'prova', head: HEAD, cobertura: 'total' };
  assert.deepEqual(planejar({ ...opcoes, head: OUTRO }, PR, NOTA), {
    recusa: `a prova é do commit ${OUTRO}, e o head da PR agora é ${HEAD}: um commit novo muda o head, e o que valia para o anterior não vale. Prove o head novo (\`git diff bbbbbbbb..aaaaaaaa\` mostra o que mudou).`,
  });
  assert.deepEqual(planejar(opcoes, PR, 'ficou NÃO COBERTO o iPhone nesta rodada'), {
    recusa: 'a nota diz NAO COBERTO, e isso é cobertura parcial: prove o que falta ou rode com --cobertura parcial (escreve BLOQUEADA-iPhone, sem PROVADO 100% REAL)',
  });
  assert.deepEqual(planejar(opcoes, PR, 'curta'), {
    recusa: 'o check não aceitaria esta prova: a seção "Prova real" não explica o que foi provado no app (escreva ao menos 40 caracteres sobre o que rodou e o que apareceu)',
  });
  assert.deepEqual(planejar(opcoes, PR, ''), {
    recusa: 'o check não aceitaria esta prova: a seção "Prova real" não explica o que foi provado no app (escreva ao menos 40 caracteres sobre o que rodou e o que apareceu)',
  });
});

test('planejar prova: a parcial escreve BLOQUEADA-iPhone, não é recusada e deixa o check vermelho se a atenção é ALTA', () => {
  const opcoes = { comando: 'prova', head: HEAD, cobertura: 'parcial' };
  const plano = planejar(opcoes, { ...PR, registros: [REVISAO_PRONTA], corpo: `${DESCRICAO}\nAtenção: ALTA\n` }, 'o iPhone ficou NÃO COBERTO nesta rodada');
  assert.equal(plano.secao, `## Prova real\n\nBLOQUEADA-iPhone\nHead: ${HEAD}\n\no iPhone ficou NÃO COBERTO nesta rodada`);
  assert.equal(plano.depois.ok, false);
  assert.match(plano.depois.mensagem, /a seção "Prova real" diz BLOQUEADA: prova parcial não vale como PROVADO 100% REAL/);
  assert.equal(planejar(opcoes, { ...PR, registros: [REVISAO_PRONTA] }, NOTA).depois.ok, true);
});

async function executar(argumentos, { rotas = {}, ambiente = {}, cwd } = {}) {
  const pedidos = [];
  const cabecalhos = [];
  const servidor = http.createServer((pedido, resposta) => {
    let corpo = '';
    pedido.on('data', pedaco => { corpo += pedaco; });
    pedido.on('end', () => {
      const endereco = new URL(pedido.url, 'http://x');
      const rota = `${pedido.method} ${endereco.pathname.replace('/repos/dono/repo/', '')}${endereco.search}`;
      pedidos.push(corpo ? { rota, corpo: JSON.parse(corpo) } : { rota });
      cabecalhos.push({ accept: pedido.headers.accept, autorizacao: pedido.headers.authorization, tipo: pedido.headers['content-type'] });
      const conteudo = rotas[rota];
      resposta.statusCode = conteudo === undefined ? 404 : 200;
      resposta.end(conteudo === undefined || conteudo === null ? '' : JSON.stringify(conteudo));
    });
  });
  await new Promise(pronto => servidor.listen(0, '127.0.0.1', pronto));
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'registrar-na-pr-'));
  try {
    const filho = spawn(process.execPath, [REGISTRAR_NA_PR, ...argumentos], {
      cwd: cwd || pasta,
      env: { PATH: process.env.PATH, GITHUB_API_URL: `http://127.0.0.1:${servidor.address().port}`, GITHUB_TOKEN: 'token-de-teste', GITHUB_WORKSPACE: pasta, ...ambiente },
    });
    let saida = '';
    filho.stdout.on('data', pedaco => { saida += pedaco; });
    filho.stderr.on('data', pedaco => { saida += pedaco; });
    const codigo = await new Promise(pronto => filho.on('close', pronto));
    return { codigo, linhas: saida.split('\n'), pedidos, cabecalhos };
  } finally {
    servidor.close();
    fs.rmSync(pasta, { recursive: true, force: true });
  }
}

const PR_NO_GITHUB = { body: CORPO, labels: [], head: { sha: HEAD }, base: { ref: 'main' }, number: 7, user: { login: 'dono' } };
const LEITURA = {
  'GET pulls/7': PR_NO_GITHUB,
  'GET issues/7/comments?per_page=100&page=1': [],
  'GET pulls/7/reviews?per_page=100&page=1': [],
  'GET pulls/7/files?per_page=100&page=1': [],
};
const ROTA_DA_EXECUCAO = `GET actions/workflows/registro-da-pr.yml/runs?head_sha=${HEAD}&per_page=20`;
const REVISAR = ['revisao', '--pr', '7', '--repo', 'dono/repo', '--head', HEAD, '--autor', 'agente-a', '--revisor', 'agente-b', '--risco', 'baixa'];
const COMENTARIO = ['    Registro de revisão independente', '    ', '    Veredito: CLEAN', `    Head: ${HEAD}`, '    Autor: agente-a', '    Revisor: agente-b', '    Risco: BAIXA'];
const rotasLidas = pedidos => pedidos.map(pedido => pedido.rota);
const CHAMADAS_DE_LEITURA = Object.keys(LEITURA);

function comNota(texto, corpo) {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'registrar-na-pr-nota-'));
  const arquivo = path.join(pasta, 'nota.md');
  fs.writeFileSync(arquivo, texto);
  const limpar = () => fs.rmSync(pasta, { recursive: true, force: true });
  return Promise.resolve(corpo(arquivo)).finally(limpar);
}

test('registrar-na-pr.js: --help e sem argumentos imprimem a ajuda e saem com 0', async () => {
  for (const argumentos of [['--help'], []]) {
    const { codigo, linhas, pedidos } = await executar(argumentos);
    assert.equal(codigo, 0);
    assert.equal(linhas[0], 'uso: node scripts/regras/registrar-na-pr.js <comando> --pr <número> [opções]');
    assert.ok(linhas.includes('  conferir   diz o que o check "Registro da PR" diria agora'));
    assert.ok(linhas.includes('  --repo       <dono/repo> (padrão: $GITHUB_REPOSITORY, senão o remoto origin)'));
    assert.deepEqual(pedidos, []);
  }
});

test('registrar-na-pr.js: erro de uso imprime a mensagem e a ajuda e sai com 2, sem falar com o GitHub', async () => {
  const { codigo, linhas, pedidos } = await executar(['x']);
  assert.equal(codigo, 2);
  assert.deepEqual(linhas.slice(0, 3), ['comando desconhecido: x', '', 'uso: node scripts/regras/registrar-na-pr.js <comando> --pr <número> [opções]']);
  assert.deepEqual(pedidos, []);
  const semRepositorio = await executar(['conferir', '--pr', '7']);
  assert.equal(semRepositorio.codigo, 2);
  assert.equal(semRepositorio.linhas[0], 'não sei qual é o repositório: passe --repo <dono/repo>');
});

test('registrar-na-pr.js: o repositório vem de --repo, do GITHUB_REPOSITORY ou do remoto origin', async () => {
  const pedidoDoCorpo = { ...LEITURA, [ROTA_DA_EXECUCAO]: { workflow_runs: [{ id: 1, created_at: '2026-01-01', status: 'completed' }] } };
  const doAmbiente = await executar(['conferir', '--pr', '7'], { rotas: pedidoDoCorpo, ambiente: { GITHUB_REPOSITORY: 'dono/repo' } });
  assert.equal(doAmbiente.codigo, 1);
  assert.equal(rotasLidas(doAmbiente.pedidos)[0], 'GET pulls/7');
  for (const url of ['https://github.com/dono/repo.git', 'git@github.com:dono/repo.git', 'https://github.com/dono/repo']) {
    const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'registrar-na-pr-remoto-'));
    try {
      execFileSync('git', ['init', '-q'], { cwd: pasta });
      execFileSync('git', ['remote', 'add', 'origin', url], { cwd: pasta });
      const doRemoto = await executar(['conferir', '--pr', '7'], { rotas: pedidoDoCorpo, cwd: pasta });
      assert.equal(doRemoto.codigo, 1, url);
      assert.equal(rotasLidas(doRemoto.pedidos)[0], 'GET pulls/7', url);
    } finally {
      fs.rmSync(pasta, { recursive: true, force: true });
    }
  }
});

test('registrar-na-pr.js conferir: diz o que o check diria; sem execução do check avisa e sai com 2 se o GitHub falha', async () => {
  const comExecucao = await executar(['conferir', '--pr', '7', '--repo', 'dono/repo'], { rotas: { ...LEITURA, [ROTA_DA_EXECUCAO]: { workflow_runs: [{ id: 1, created_at: '2026-01-01' }] } } });
  assert.equal(comExecucao.codigo, 1);
  assert.equal(comExecucao.linhas[0], `✗ O registro da PR não vale para o head ${HEAD}:`);
  assert.equal(comExecucao.linhas[4], '');
  assert.equal(comExecucao.linhas.length, 5);
  assert.deepEqual(rotasLidas(comExecucao.pedidos), [...CHAMADAS_DE_LEITURA, ROTA_DA_EXECUCAO]);
  const semExecucao = await executar(['conferir', '--pr', '7', '--repo', 'dono/repo'], { rotas: { ...LEITURA, [ROTA_DA_EXECUCAO]: { workflow_runs: [] } } });
  assert.equal(semExecucao.codigo, 1);
  assert.equal(semExecucao.linhas[4], '  O check "Registro da PR" não tem execução neste head, e um comentário não cria uma. Se a PR acabou de receber um commit ou uma edição, espere um minuto e confira de novo. Senão, feche e reabra a PR (o head não muda, e a revisão e a prova continuam valendo): gh pr close 7 -R dono/repo && gh pr reopen 7 -R dono/repo');
  const falhou = await executar(['conferir', '--pr', '9', '--repo', 'dono/repo'], { rotas: LEITURA });
  assert.deepEqual(falhou.linhas, ['✗ o GitHub respondeu 404 a pulls/9', '']);
  assert.equal(falhou.codigo, 2);
});

test('registrar-na-pr.js revisao: sem --publicar é ensaio, mostra o comentário recuado e a nota, e não escreve nada', async () => {
  await comNota(`${NOTA}\n`, async nota => {
    const resultado = await executar([...REVISAR, '--nota', nota], { rotas: { ...LEITURA, [ROTA_DA_EXECUCAO]: { workflow_runs: [{ id: 1, created_at: '2026-01-01', status: 'completed' }] } } });
    assert.equal(resultado.codigo, 0);
    assert.deepEqual(resultado.linhas, [
      'O comentário da PR 7 (ensaio: nada foi publicado; repita com --publicar):', '', ...COMENTARIO, '    ', `    ${NOTA}`, '',
      'Com isso publicado, o check diz:', `registro da PR ok no head ${HEAD}: atenção BAIXA, revisão CLEAN`, '',
    ]);
    assert.deepEqual(rotasLidas(resultado.pedidos), [...CHAMADAS_DE_LEITURA, ROTA_DA_EXECUCAO]);
  });
});

test('registrar-na-pr.js revisao --publicar: grava a revisão da PR no head e manda rodar de novo a execução mais recente', async () => {
  const execucoes = [{ id: 1, created_at: '2026-01-01', status: 'completed', html_url: 'http://x/1' }, { id: 2, created_at: '2026-02-01', status: 'completed', html_url: 'http://x/2' }];
  const resultado = await executar([...REVISAR, '--publicar'], {
    rotas: { ...LEITURA, [ROTA_DA_EXECUCAO]: { workflow_runs: execucoes }, 'POST pulls/7/reviews': {}, 'POST actions/runs/2/rerun': null },
  });
  assert.equal(resultado.codigo, 0);
  assert.deepEqual(resultado.linhas, [
    'O comentário da PR 7:', '', ...COMENTARIO, '', 'Registro publicado como revisão da PR (o evento de revisão já roda o check).',
    'Com isso publicado, o check diz:', `registro da PR ok no head ${HEAD}: atenção BAIXA, revisão CLEAN`, '  Check rodando de novo (execução 2): http://x/2', '',
  ]);
  assert.deepEqual(resultado.cabecalhos[4], { accept: 'application/vnd.github+json', autorizacao: 'Bearer token-de-teste', tipo: 'application/json' });
  assert.deepEqual(resultado.pedidos.slice(4), [
    { rota: 'POST pulls/7/reviews', corpo: { commit_id: HEAD, event: 'COMMENT', body: `Registro de revisão independente\n\nVeredito: CLEAN\nHead: ${HEAD}\nAutor: agente-a\nRevisor: agente-b\nRisco: BAIXA` } },
    { rota: ROTA_DA_EXECUCAO },
    { rota: 'POST actions/runs/2/rerun' },
  ]);
});

test('registrar-na-pr.js revisao --publicar: execução em andamento não é repetida, e sem execução diz como criar uma', async () => {
  const andando = await executar([...REVISAR, '--publicar'], {
    rotas: { ...LEITURA, [ROTA_DA_EXECUCAO]: { workflow_runs: [{ id: 3, created_at: '2026-02-01', status: 'in_progress' }] }, 'POST pulls/7/reviews': {} },
  });
  assert.equal(andando.codigo, 0);
  assert.equal(andando.linhas[andando.linhas.length - 2], '  O check já está rodando neste head (execução 3).');
  assert.ok(!rotasLidas(andando.pedidos).some(rota => rota.includes('rerun')));
  const sem = await executar([...REVISAR, '--publicar'], { rotas: { ...LEITURA, [ROTA_DA_EXECUCAO]: { workflow_runs: [] }, 'POST pulls/7/reviews': {} } });
  assert.match(sem.linhas[sem.linhas.length - 2], /^ {2}O check "Registro da PR" não tem execução neste head, e um comentário não cria uma\..* gh pr close 7 -R dono\/repo && gh pr reopen 7 -R dono\/repo$/);
});

test('registrar-na-pr.js revisao: head que não é o da PR, head curto e revisor igual ao autor não publicam e saem com 1', async () => {
  const recusa = async (argumentos, mensagem) => {
    const resultado = await executar([...argumentos, '--publicar'], { rotas: LEITURA });
    assert.equal(resultado.codigo, 1);
    assert.equal(resultado.linhas[0], `✗ Nada foi publicado na PR 7: ${mensagem}`);
    assert.deepEqual(rotasLidas(resultado.pedidos), CHAMADAS_DE_LEITURA);
  };
  await recusa(REVISAR.map(valor => (valor === HEAD ? OUTRO : valor)), `a revisão é do commit ${OUTRO}, e o head da PR agora é ${HEAD}: um commit novo muda o head, e o que valia para o anterior não vale. Revise o head novo (\`git diff bbbbbbbb..aaaaaaaa\` mostra o que mudou).`);
  await recusa(REVISAR.map(valor => (valor === HEAD ? 'abc' : valor)), '--head pede o SHA inteiro, de 40 caracteres (`git rev-parse HEAD`); veio "abc"');
  await recusa(REVISAR.map(valor => (valor === 'agente-b' ? 'Agente-A' : valor)), 'o check não aceitaria este registro: o revisor do registro é o próprio autor (agente-a)');
});

test('registrar-na-pr.js prova: ensaio mostra a seção e o check; --publicar grava o corpo novo com PATCH', async () => {
  const provar = ['prova', '--pr', '7', '--repo', 'dono/repo', '--head', HEAD, '--cobertura', 'total'];
  const secao = ['    ## Prova real', '    ', '    PROVADO 100% REAL', `    Head: ${HEAD}`, '    ', `    ${NOTA}`];
  await comNota(`${NOTA}\n`, async nota => {
    const ensaio = await executar([...provar, '--nota', nota], { rotas: LEITURA });
    assert.equal(ensaio.codigo, 1);
    assert.deepEqual(ensaio.linhas.slice(0, 10), ['A seção que entra no corpo da PR 7 (ensaio: nada foi publicado; repita com --publicar):', '', ...secao, '', 'Com isso publicado, o check diz:']);
    assert.equal(ensaio.linhas[10], `✗ O registro da PR não vale para o head ${HEAD}:`);
    assert.deepEqual(rotasLidas(ensaio.pedidos), CHAMADAS_DE_LEITURA);
    const publicada = await executar([...provar, '--nota', nota, '--publicar'], { rotas: { ...LEITURA, 'PATCH pulls/7': {} } });
    assert.equal(publicada.codigo, 1);
    assert.deepEqual(publicada.linhas.slice(0, 10), ['A seção que entra no corpo da PR 7:', '', ...secao, '', 'Corpo gravado (a edição do corpo dispara o check).']);
    assert.deepEqual(publicada.pedidos.slice(4), [{ rota: 'PATCH pulls/7', corpo: { body: `${CORPO}\n## Prova real\n\nPROVADO 100% REAL\nHead: ${HEAD}\n\n${NOTA}\n` } }]);
  });
});

test('registrar-na-pr.js prova: parcial escreve BLOQUEADA-iPhone; nota que diz NÃO COBERTO como total é recusada', async () => {
  await comNota(`${NOTA}\n`, async nota => {
    const parcial = await executar(['prova', '--pr', '7', '--repo', 'dono/repo', '--head', HEAD, '--cobertura', 'parcial', '--nota', nota, '--publicar'], { rotas: { ...LEITURA, 'PATCH pulls/7': {} } });
    assert.equal(parcial.linhas[2], '    ## Prova real');
    assert.equal(parcial.linhas[4], '    BLOQUEADA-iPhone');
    assert.deepEqual(parcial.pedidos[4].corpo, { body: `${CORPO}\n## Prova real\n\nBLOQUEADA-iPhone\nHead: ${HEAD}\n\n${NOTA}\n` });
  });
  await comNota('Ficou NÃO COBERTO o iPhone nesta rodada.\n', async nota => {
    const suja = await executar(['prova', '--pr', '7', '--repo', 'dono/repo', '--head', HEAD, '--cobertura', 'total', '--nota', nota, '--publicar'], { rotas: LEITURA });
    assert.equal(suja.codigo, 1);
    assert.equal(suja.linhas[0], '✗ Nada foi publicado na PR 7: a nota diz NAO COBERTO, e isso é cobertura parcial: prove o que falta ou rode com --cobertura parcial (escreve BLOQUEADA-iPhone, sem PROVADO 100% REAL)');
    assert.deepEqual(rotasLidas(suja.pedidos), CHAMADAS_DE_LEITURA);
  });
});

test('registrar-na-pr.js: nota que não existe sai com 2 antes de falar com o GitHub', async () => {
  const resultado = await executar([...REVISAR, '--nota', path.join(os.tmpdir(), 'nota-que-nao-existe-l19.md')], { rotas: LEITURA });
  assert.equal(resultado.codigo, 2);
  assert.match(resultado.linhas[0], /^✗ ENOENT: no such file or directory, open '.*nota-que-nao-existe-l19\.md'$/);
  assert.deepEqual(resultado.pedidos, []);
});
