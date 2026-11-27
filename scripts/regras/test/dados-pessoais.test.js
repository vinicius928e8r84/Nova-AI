'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const regra = require('../regra-dados-pessoais');
const { criar } = require('./auxiliar');

const NL = '\n';
const BARRA = '\\';
const EMAIL_PESSOAL = ['fulana', 'provedor.com'].join('@');
const OUTRO_EMAIL_PESSOAL = ['outra', 'provedor.com'].join('@');
const IP_PRIVADO = ['10', '9', '8', '7'].join('.');
const IP_DO_TAILNET = ['100', '64', '1', '2'].join('.');
const IP_PUBLICO = ['198', '18', '0', '9'].join('.');
const NOME_NO_WINDOWS = ['C:', 'Users', 'fulano'].join(BARRA);
const NOME_NO_MAC = ['', 'Users', 'fulano'].join('/');
const LISTA_DE_NOMES = ['# nomes que não podem aparecer', '', 'Beltrano', 'Fulana da Silva', 'João', ''].join(NL);

function casaTemporaria() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dados-pessoais-'));
}

function escreverLista(caminho, texto = LISTA_DE_NOMES) {
  fs.mkdirSync(path.dirname(caminho), { recursive: true });
  fs.writeFileSync(caminho, texto);
  return caminho;
}

function contexto(arquivos, { env = {}, excecoes = [] } = {}) {
  const casa = casaTemporaria();
  const avisos = [];
  const acrescentadas = new Map();
  const lidos = new Map();
  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    const buffer = Buffer.isBuffer(conteudo) ? conteudo : Buffer.from(conteudo);
    const binario = buffer.includes(0);
    lidos.set(caminho, { buffer, binario, texto: binario ? null : buffer.toString('utf8') });
    acrescentadas.set(caminho, new Set(binario ? [] : buffer.toString('utf8').split(NL).map((_, i) => i + 1)));
  }
  return {
    avisos,
    casa,
    ctx: {
      config: { dadosPessoais: { excecoes } },
      arquivos: Object.keys(arquivos).map(caminho => ({ status: 'A', caminho })),
      mudancas: { acrescentadas },
      ler: caminho => lidos.get(caminho) || null,
      env: { HOME: casa, USERPROFILE: casa, ...env },
      aviso: texto => avisos.push(texto),
    },
  };
}

function verificar(arquivos, opcoes) {
  const montado = contexto(arquivos, opcoes);
  const achados = regra.verificar(montado.ctx);
  fs.rmSync(montado.casa, { recursive: true, force: true });
  return { achados, avisos: montado.avisos };
}

const achadosDe = (texto, nome = 'a.md') => verificar({ [nome]: texto }).achados;

function comLista(texto, listaDeNomes = LISTA_DE_NOMES) {
  const montado = contexto({ 'a.md': texto });
  montado.ctx.env.FREIOS_NOMES = escreverLista(path.join(montado.casa, 'fora', 'lista.txt'), listaDeNomes);
  const achados = regra.verificar(montado.ctx);
  fs.rmSync(montado.casa, { recursive: true, force: true });
  return achados;
}

test('e-mail pessoal falha com o arquivo e a linha', () => {
  const achados = achadosDe(`oi${NL}fale com ${EMAIL_PESSOAL}${NL}`);
  assert.deepEqual(achados.map(a => [a.arquivo, a.linha]), [['a.md', 2]]);
});

test('o valor não aparece no achado e o tipo aparece', () => {
  const [achado] = achadosDe(EMAIL_PESSOAL);
  assert.ok(!achado.detalhe.includes('fulana'));
  assert.match(achado.detalhe, /e-mail/);
});

test('noreply passa', () => {
  const linhas = [
    ['12345+fulano', 'users.noreply.github.com'].join('@'),
    'noreply@github.com',
    'Co-Authored-By: Alguem <noreply@anthropic.com>',
    'no-reply@servico.com.br',
  ];
  assert.deepEqual(achadosDe(linhas.join(NL)), []);
});

test('endereços de exemplo passam', () => {
  const linhas = ['a@example.com', 'b@sub.example.org', 'c@exemplo.com', 'd@exemplo.com.br', 'e@host.test', 'f@x.example', 'git@github.com:dono/repo.git'];
  assert.deepEqual(achadosDe(linhas.join(NL)), []);
});

test('o que só parece e-mail passa', () => {
  const linhas = ['npm i pacote@1.2.3', "import '@escopo/pacote'", 'foo@latest', 'imagem@sha256:abc', 'a @ b.com'];
  assert.deepEqual(achadosDe(linhas.join(NL)), []);
});

test('domínio de exemplo em maiúscula passa e e-mail pessoal em maiúscula falha', () => {
  assert.deepEqual(achadosDe('A@EXAMPLE.COM'), []);
  assert.equal(achadosDe(EMAIL_PESSOAL.toUpperCase()).length, 1);
});

test('IP fora das faixas de exemplo falha', () => {
  for (const ip of [IP_PRIVADO, IP_PUBLICO]) {
    assert.equal(achadosDe(`servidor em ${ip}${NL}`).length, 1, ip);
  }
});

test('IP da tailnet falha sem mostrar o valor', () => {
  const [achado] = achadosDe(`ssh ${IP_DO_TAILNET}${NL}`);
  assert.match(achado.detalhe, /IP/);
  assert.ok(!achado.detalhe.includes(IP_DO_TAILNET));
});

test('IP dentro de URL com porta falha', () => {
  assert.equal(achadosDe(`http://${IP_PRIVADO}:8080/x`).length, 1);
});

test('IP no fim da frase falha', () => {
  assert.equal(achadosDe(`o servidor é ${IP_PRIVADO}.`).length, 1);
});

test('loopback, zero, máscara e documentação passam', () => {
  const ips = ['127.0.0.1', '127.1.2.3', '0.0.0.0', '192.0.2.7', '198.51.100.7', '203.0.113.250', '255.255.255.0'];
  for (const ip of ips) assert.deepEqual(achadosDe(`host ${ip}${NL}`), [], ip);
});

test('o que só parece IP passa', () => {
  const linhas = ['versao 1.2.3', `v${IP_PRIVADO}`, `${IP_PRIVADO}.4`, '300.1.1.1', '1.2.3.999', '2025.11.27.1'];
  assert.deepEqual(achadosDe(linhas.join(NL)), []);
});

test('os IPs neutros que o repositório usa nos testes passam', () => {
  for (const ip of ['1.2.3.4', '5.6.7.8', '8.8.8.8', '9.9.9.9']) assert.deepEqual(achadosDe(`proxy ${ip}:8000${NL}`), [], ip);
});

test('versão de navegador no user-agent não é IP, mas IP com zeros só no fim continua falhando', () => {
  assert.deepEqual(achadosDe('AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'), []);
  assert.equal(achadosDe(`rede ${IP_PRIVADO.split('.').slice(0, 3).join('.')}.0${NL}`).length, 1);
});

test('o identificador de contato do WhatsApp não é e-mail', () => {
  assert.deepEqual(achadosDe(['1234567890@c.us', '1234567890-1600000000@g.us', '1234567890@s.whatsapp.net'].join(NL)), []);
});

test('caminho de usuário no Windows e no Mac falha', () => {
  for (const caminho of [NOME_NO_WINDOWS, `${NOME_NO_MAC}/pasta`, NOME_NO_WINDOWS.replaceAll(BARRA, '/')]) {
    assert.equal(achadosDe(`abra ${caminho}${NL}`).length, 1, caminho);
  }
});

test('barra dobrada de JSON e de string falha', () => {
  assert.equal(achadosDe(NOME_NO_WINDOWS.replaceAll(BARRA, BARRA + BARRA)).length, 1);
});

test('o nome do usuário não aparece no achado', () => {
  const [achado] = achadosDe(NOME_NO_WINDOWS);
  assert.ok(!achado.detalhe.includes('fulano'));
});

test('marcadores no lugar do nome passam', () => {
  const nomes = ['<usuário>', '<nome>', '$USER', '${USER}', '%USERNAME%', '$env:USERNAME', '*', '...', '[nome]'];
  for (const nome of nomes) {
    const texto = `C:${BARRA}Users${BARRA}${nome} e /Users/${nome}/x`;
    assert.deepEqual(achadosDe(texto), [], nome);
  }
});

test('pastas genéricas do sistema passam', () => {
  assert.deepEqual(achadosDe(`C:${BARRA}Users${BARRA}Public e /Users/Shared e C:/Users/Default`), []);
  assert.deepEqual(achadosDe(`/Users/runner/work/repo e C:${BARRA}Users${BARRA}runneradmin`), []);
});

test('til e variável do perfil passam', () => {
  assert.deepEqual(achadosDe(`cd ~/worktrees e %USERPROFILE%${BARRA}worktrees`), []);
});

test('o que só parece caminho passa', () => {
  const linhas = ['src/Users/Lista.tsx', 'fetch(`/users/${id}`)', "import x from './Users/lista'"];
  assert.deepEqual(achadosDe(linhas.join(NL)), []);
});

test('nome da lista falha sem mostrar o nome', () => {
  const achados = comLista(`obrigado, Beltrano!${NL}`);
  assert.deepEqual(achados.map(a => [a.arquivo, a.linha]), [['a.md', 1]]);
  assert.ok(!achados[0].detalhe.includes('Beltrano'));
});

test('a lista ignora maiúscula e acento', () => {
  assert.equal(comLista('fala do JOAO').length, 1);
  assert.equal(comLista('fala da fulana da silva').length, 1);
});

test('só a palavra inteira conta', () => {
  assert.deepEqual(comLista('Beltranopolis e Joaozinho'), []);
});

test('comentário e linha vazia da lista não viram nome', () => {
  assert.deepEqual(comLista('nomes que não podem aparecer, texto qualquer'), []);
});

test('a lista padrão fica em ~/.config/freios/nomes.txt', () => {
  const montado = contexto({ 'a.md': 'oi Beltrano' });
  escreverLista(path.join(montado.casa, '.config', 'freios', 'nomes.txt'));
  const achados = regra.verificar(montado.ctx);
  fs.rmSync(montado.casa, { recursive: true, force: true });
  assert.equal(achados.length, 1);
  assert.deepEqual(montado.avisos, []);
});

test('a variável FREIOS_NOMES vence a lista padrão', () => {
  const montado = contexto({ 'a.md': 'oi Beltrano e Cicrano' });
  escreverLista(path.join(montado.casa, '.config', 'freios', 'nomes.txt'));
  montado.ctx.env.FREIOS_NOMES = escreverLista(path.join(montado.casa, 'outra.txt'), `Cicrano${NL}`);
  const achados = regra.verificar(montado.ctx);
  fs.rmSync(montado.casa, { recursive: true, force: true });
  assert.equal(achados.length, 1);
});

test('sem lista avisa e pula só os nomes', () => {
  const { achados, avisos } = verificar({ 'a.md': `oi Beltrano e ${EMAIL_PESSOAL}` });
  assert.equal(achados.length, 1);
  assert.equal(avisos.length, 1);
  assert.match(avisos[0], /FREIOS_NOMES/);
  assert.match(avisos[0], /nomes\.txt/);
});

test('lista apontada que não existe também avisa', () => {
  const { achados, avisos } = verificar({ 'a.md': 'oi' }, { env: { FREIOS_NOMES: path.join(os.tmpdir(), 'nada-aqui.txt') } });
  assert.deepEqual([achados, avisos.length], [[], 1]);
});

test('arquivo binário fica fora', () => {
  const dados = Buffer.concat([Buffer.from([0, 0]), Buffer.from(EMAIL_PESSOAL), Buffer.from([0])]);
  assert.deepEqual(verificar({ 'a.dat': dados }).achados, []);
});

test('vários tipos na mesma linha são achados separados', () => {
  assert.equal(achadosDe(`${EMAIL_PESSOAL} ${IP_PRIVADO} ${NOME_NO_MAC}`).length, 3);
});

test('só as linhas acrescentadas são conferidas', () => {
  const montado = contexto({ 'a.md': `${EMAIL_PESSOAL}${NL}oi${NL}${OUTRO_EMAIL_PESSOAL}${NL}` });
  montado.ctx.mudancas.acrescentadas.set('a.md', new Set([3]));
  const achados = regra.verificar(montado.ctx);
  fs.rmSync(montado.casa, { recursive: true, force: true });
  assert.deepEqual(achados.map(a => a.linha), [3]);
});

test('exceção com motivo libera o arquivo', () => {
  const excecoes = [{ glob: 'docs/exemplo.md', motivo: 'exemplo de saída de uma ferramenta' }];
  assert.deepEqual(verificar({ 'docs/exemplo.md': EMAIL_PESSOAL }, { excecoes }).achados, []);
  assert.equal(verificar({ 'docs/outro.md': EMAIL_PESSOAL }, { excecoes }).achados.length, 1);
});

test('o conserto diz como resolver', () => {
  for (const trecho of ['configuracao.json', 'nomes.txt', 'FREIOS_NOMES', '<usuário>', 'example.com', '192.0.2']) {
    assert.ok(regra.conserto.includes(trecho), trecho);
  }
});

test('a configuração só tem exceção com glob e motivo', () => {
  const { excecoes } = require('../configuracao.json').dadosPessoais;
  for (const excecao of excecoes) assert.ok(excecao.glob && excecao.motivo, JSON.stringify(excecao));
});

const AMBIENTE_SEM_LISTA = ['FREIOS_NOMES', 'HOME', 'USERPROFILE'];

function rodarSemLista(repo) {
  const casa = casaTemporaria();
  const guardado = Object.fromEntries(AMBIENTE_SEM_LISTA.map(nome => [nome, process.env[nome]]));
  delete process.env.FREIOS_NOMES;
  process.env.HOME = casa;
  process.env.USERPROFILE = casa;
  try {
    return repo.rodar('--regra', 'sem-dado-pessoal');
  } finally {
    for (const [nome, valor] of Object.entries(guardado)) {
      if (valor === undefined) delete process.env[nome];
      else process.env[nome] = valor;
    }
    fs.rmSync(casa, { recursive: true, force: true });
  }
}

test('na PR: dado que já estava na base passa', () => {
  const repo = criar({ 'a.md': `${EMAIL_PESSOAL}${NL}` });
  repo.escrever({ 'b.md': `oi${NL}` });
  const r = rodarSemLista(repo);
  repo.limpar();
  assert.equal(r.codigo, 0, r.saida);
});

test('na PR: dado novo reprova com o conserto e sem mostrar o valor', () => {
  const repo = criar({ 'a.md': `oi${NL}` });
  repo.escrever({ 'a.md': `oi${NL}${EMAIL_PESSOAL}${NL}` });
  const r = rodarSemLista(repo);
  repo.limpar();
  assert.equal(r.codigo, 1);
  assert.match(r.saida, /a\.md:2/);
  assert.match(r.saida, /Conserto:/);
  assert.ok(!r.saida.includes('fulana'));
});

test('na PR: trocar o dado da base por outro reprova', () => {
  const repo = criar({ 'a.md': `${EMAIL_PESSOAL}${NL}` });
  repo.escrever({ 'a.md': `${OUTRO_EMAIL_PESSOAL}${NL}` });
  const r = rodarSemLista(repo);
  repo.limpar();
  assert.equal(r.codigo, 1, r.saida);
});

test('na PR: tirar o dado passa', () => {
  const repo = criar({ 'a.md': `${EMAIL_PESSOAL}${NL}` });
  repo.escrever({ 'a.md': `oi${NL}` });
  const r = rodarSemLista(repo);
  repo.limpar();
  assert.equal(r.codigo, 0, r.saida);
});

test('na PR: sem a lista de nomes avisa e não derruba a PR', () => {
  const repo = criar();
  repo.escrever({ 'a.md': `oi${NL}` });
  const r = rodarSemLista(repo);
  repo.limpar();
  assert.equal(r.codigo, 0, r.saida);
  assert.match(r.saida, /aviso: .*FREIOS_NOMES/);
});

test('a regra está registrada em verificar.js', () => {
  const { REGRAS } = require('../verificar');
  assert.ok(REGRAS.some(item => item.id === regra.id));
});
