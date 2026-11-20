'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { criar, linhas, LINHA_DE_BASE } = require('./auxiliar');
const regra = require('../regra-saude');
const { medirJs } = require('../analisador/medir-js');
const { rodarOPython } = require('../analisador/medir');
const { pontuar } = require('../analisador/pontos');

const RAIZ = path.resolve(__dirname, '..', '..', '..');
const VERIFICAR = path.join(__dirname, '..', 'verificar.js');
const CONFIG = require('../configuracao.json');

const js = (...linhas) => `${linhas.join('\n')}\n`;
const py = js;
const unidadeJs = (fonte, nome) => medirJs(fonte).unidades.find(unidade => unidade.nome === nome);
const medidaJs = (fonte, nome, campo) => unidadeJs(fonte, nome)[campo];
const medirPy = fonte => rodarOPython({ 'a.py': fonte })['a.py'];
const unidadePy = (fonte, nome) => medirPy(fonte).unidades.find(unidade => unidade.nome === nome);
const pontosDe = medicao => pontuar(medicao).map(({ unidade, medida, pontos }) => `${unidade} ${medida} ${pontos}`);
const pontosDasFuncoes = medicao => pontosDe(medicao).filter(pontos => !pontos.startsWith('null media'));
const nomesECc = fonte => medirJs(fonte).unidades.map(({ nome, cc }) => [nome, cc]);
const corpo = n => Array.from({ length: n }, (_, i) => `  const v${i} = ${i};`);
const TRINTA_IFS = Array.from({ length: 30 }, (_, i) => `    if (a === ${i}) return ${i};`);
const comTrintaIfs = () => [...TRINTA_IFS, '    return a;'];

const TODOS_OS_DESVIOS = js(
  'function escolher(a, b, lista) {',
  '  if (a) return 1;',
  '  const x = a ? b : null;',
  '  const y = a && b;',
  '  const z = a ?? b;',
  '  const w = a?.b;',
  '  for (const item of lista) b(item);',
  '  try { b(); } catch { b(); }',
  '  switch (a) { case 1: break; default: break; }',
  '  return [x, y, z, w];',
  '}',
);

test('complexidade: if, ?:, &&, ??, ?., laço, catch e case somam um cada; 9 passa um ponto do limite 8', () => {
  assert.equal(medidaJs(TODOS_OS_DESVIOS, 'escolher', 'cc'), 9);
  assert.deepEqual(pontosDasFuncoes(medirJs(TODOS_OS_DESVIOS)), ['escolher complexidade 1']);
});

test('o callback dentro de uma função com nome conta nela; a seta curta lá dentro não é função à parte', () => {
  assert.equal(medidaJs(js('function f(lista) {', '  return lista.map(x => {', '    if (x) return 1;', '    return x ? 2 : 3;', '  });', '}'), 'f', 'cc'), 3);
  const curtas = js('function f(l) {', '  const dobro = x => (x ? 2 : 0);', '  const soma = (a, b) =>', '    a + b;', '  return l.map(dobro).reduce(soma);', '}');
  assert.deepEqual(nomesECc(curtas), [['f', 2]]);
});

test('a função com nome dentro de outra é medida à parte, e as linhas dela saem das do pai', () => {
  const aninhada = js('function fora() {', '  function dentro(a) {', '    if (a) return 1;', '    return 2;', '  }', '  return dentro;', '}');
  assert.deepEqual(medirJs(aninhada).unidades.map(({ nome, cc, linhas }) => [nome, cc, linhas]), [['fora', 1, 3], ['dentro', 2, 4]]);
});

test('linhas por função: 69 cabem, 70 passam um ponto', () => {
  assert.deepEqual(pontosDe(medirJs(js('function longa() {', ...corpo(67), '}'))), []);
  assert.deepEqual(pontosDe(medirJs(js('function longa() {', ...corpo(68), '}'))), ['longa linhas 1']);
});

test('aninhamento: if, for, if e while dão 4, um ponto; o else if fica no nível do if; o switch aninha', () => {
  const funda = js('function funda(a) {', '  if (a) {', '    for (const b of a) {', '      if (b) {', '        while (b.c) b.c--;', '      }', '    }', '  }', '}');
  assert.equal(medidaJs(funda, 'funda', 'aninhamento'), 4);
  assert.deepEqual(pontosDasFuncoes(medirJs(funda)), ['funda aninhamento 1']);
  const cadeia = js('function rota(a) {', '  if (a === 1) return 1;', '  else if (a === 2) return 2;', '  else if (a === 3) return 3;', '  else return 4;', '}');
  assert.equal(medidaJs(cadeia, 'rota', 'aninhamento'), 1);
  const escolha = js('function escolher(a, b) {', '  if (a) {', '    switch (b) {', '      case 1:', '        if (a > 1) return 1;', '        break;', '      default:', '        break;', '    }', '  }', '  return 0;', '}');
  assert.equal(medirJs(escolha).unidades[0].aninhamento, 3);
});

test('blocos aninhados (Bumpy Road): o segundo bloco com lógica aninhada é um ponto', () => {
  const esburacada = js('function estrada(a, b) {', '  if (a) {', '    if (b) a();', '  }', '  for (const c of b) {', '    if (c) b(c);', '  }', '}');
  assert.equal(medidaJs(esburacada, 'estrada', 'blocos'), 2);
  assert.deepEqual(pontosDasFuncoes(medirJs(esburacada)), ['estrada blocos 1']);
});

test('no Nova o ternário conta como nível na estrada esburacada, mas não no aninhamento', () => {
  const comTernario = js('function estrada(a, b) {', '  if (a) {', '    a(b ? 1 : 2);', '  }', '  for (const c of b) {', '    if (c) b(c);', '  }', '}');
  assert.deepEqual(['blocos', 'aninhamento'].map(campo => medidaJs(comTernario, 'estrada', campo)), [2, 2]);
  assert.deepEqual(pontosDasFuncoes(medirJs(comTernario)), ['estrada blocos 1']);
  const soltos = js('function soltos(a, b) {', '  const x = a ? 1 : 2;', '  const y = b ? 3 : 4;', '  return x + y;', '}');
  assert.equal(medidaJs(soltos, 'soltos', 'blocos'), 0);
  assert.equal(medidaJs(js('function f(a, b) {', '  return a ? (b ? 1 : 2) : 3;', '}'), 'f', 'blocos'), 1);
  const comIfExp = py('def estrada(a, b):', '    if a:', '        a(1 if b else 2)', '    for c in b:', '        if c:', '            b(c)');
  assert.deepEqual(['blocos', 'aninhamento'].map(campo => unidadePy(comIfExp, 'estrada')[campo]), [2, 2]);
});

test('condições: cada && ou || além do primeiro é um ponto; o callback e o ?? não contam', () => {
  const condicoes = js(
    'function decidir(a, b, c, d) {',
    '  if (a && b || c) return 1;',
    '  if (a && b && c && d) return 2;',
    '  if (a && [b, c].some(x => x && d)) return 3;',
    '  return a || b ? c : d;',
    '}',
  );
  assert.deepEqual(medidaJs(condicoes, 'decidir', 'condicoes'), [2, 3]);
  assert.deepEqual(pontosDasFuncoes(medirJs(condicoes)).filter(p => p.includes('operadores')), ['decidir operadores 1', 'decidir operadores 2']);
  assert.deepEqual(medirJs(js('function f(a, b, c, d) {', '  if ((a ?? b) && c || d) return 1;', '  return 0;', '}')).unidades[0].condicoes, [2]);
});

test('argumentos: quatro cabem, cinco passam um', () => {
  assert.deepEqual(pontosDe(medirJs(js('function cinco(a, b, c, d, e) {', '  return [a, b, c, d, e];', '}'))), ['cinco argumentos 1']);
  assert.deepEqual(pontosDe(medirJs(js('function quatro(a, b, c, d) {', '  return [a, b, c, d];', '}'))), []);
});

test('||=, &&= e ??= são desvios; += não', () => {
  assert.deepEqual(nomesECc(js('function padroes(a, b, c) {', '  a ||= 1;', '  b &&= 2;', '  c ??= 3;', '  a += 1;', '  return [a, b, c];', '}')), [['padroes', 4]]);
});

test('nomes: o invólucro do módulo é transparente; métodos e funções atribuídas levam o nome', () => {
  const nomes = js(
    '(function () {', '  function noModulo() {', '    return 1;', '  }', '  class Fila {', '    andar() {', '      return 2;', '    }', '  }',
    '  const objeto = {', '    guardar() {', '      return 3;', '    },', '  };', '  objeto.ler = function () {', '    return 4;', '  };',
    '  return [noModulo, Fila, objeto];', '})();',
  );
  assert.deepEqual(medirJs(nomes).unidades.map(unidade => unidade.nome), ['noModulo', 'andar', 'guardar', 'objeto.ler']);
});

test('fora de uma função com nome, cada callback é medido à parte e leva um nome que se acha', () => {
  assert.deepEqual(nomesECc(js("test('guarda o tema', async ({ a }) => {", ...comTrintaIfs(), '});')), [["test('guarda o tema')", 31]]);
  assert.deepEqual(nomesECc(js("botao.addEventListener('click', function (a) {", ...comTrintaIfs(), '});')), [["addEventListener('click')", 31]]);
  assert.deepEqual(nomesECc(js('p.then(function depoisDoPedido(a) {', ...comTrintaIfs(), '});')), [['depoisDoPedido', 31]]);
  assert.deepEqual(nomesECc(js('module.exports = (a) => {', ...comTrintaIfs(), '};')), [['module.exports', 31]]);
  assert.deepEqual(nomesECc(js('exports.ler = function (a) {', ...comTrintaIfs(), '};')), [['exports.ler', 31]]);
  assert.deepEqual(nomesECc(js('export default (a) => {', ...comTrintaIfs(), '};')), [['default', 31]]);
  assert.deepEqual(nomesECc(js('class Leitor {', '  ler = (a) => {', ...comTrintaIfs(), '  };', '}')), [['ler', 31]]);
  const tabela = js('const tabela = {', '  ler: (a) => {', ...comTrintaIfs(), '  },', '  gravar: function (a) {', ...comTrintaIfs(), '  },', '};');
  assert.deepEqual(nomesECc(tabela), [['ler', 31], ['gravar', 31]]);
});

test('o código solto no topo do arquivo é medido e pontua como uma função, sem entrar na média', () => {
  const solto = TRINTA_IFS.map(linha => linha.replace('return', 'gravar(').replace(';', ');'));
  assert.equal(medirJs(js('const a = ler();', ...solto)).topo.cc, 31);
  assert.deepEqual(pontosDe(medirJs(js('const a = ler();', ...solto))), ['(topo do arquivo) complexidade 23']);
  assert.equal(medirJs(js('(async () => {', '  const a = ler();', ...solto, '})();')).topo.cc, 31);
  const tabela = js('const PASSOS = {', ...Array.from({ length: 12 }, (_, i) => `  p${i}: (a) => (a ? ${i} : 0),`), '};');
  assert.equal(medirJs(tabela).topo.cc, 1);
  const pyTopo = py('import sys', ...Array.from({ length: 10 }, (_, i) => [`if sys.argv[${i}]:`, '    pass']).flat());
  assert.deepEqual(pontosDe(medirPy(pyTopo)), ['(topo do arquivo) complexidade 3']);
});

test('média do arquivo: 4,0 é um ponto, uma vez por arquivo; abaixo de 4 não pontua', () => {
  const media = js(
    'function a(x) {', '  if (x) return 1;', '  if (x > 1) return 2;', '  return x ? 3 : 4;', '}',
    'function b(x) {', '  if (x) return 1;', '  if (x > 1) return 2;', '  return x ? 3 : 4;', '}',
  );
  assert.deepEqual(pontosDe(medirJs(media)), ['null media 1']);
  assert.deepEqual(pontosDe(medirJs(`${media}function c(x) {\n  return x;\n}\n`)), []);
});

test('o arquivo que não se lê pontua, em JavaScript e em Python', () => {
  assert.deepEqual(pontosDe(medirJs('function (')), ['null leitura 1']);
  assert.deepEqual(pontosDe(medirPy('def (:\n')), ['null leitura 1']);
});

test('Python: def aninhado conta no pai; elif soma e não aninha; método leva a classe; self e cls não contam', () => {
  const aninhada = py('def fora(a):', '    def dentro(b):', '        if b:', '            return 1', '        return 2', '    if a:', '        return dentro(a)', '    return 0');
  assert.deepEqual(medirPy(aninhada).unidades.map(({ nome, cc }) => [nome, cc]), [['fora', 3]]);
  const cadeia = py('def rota(a):', '    if a == 1:', '        return 1', '    elif a == 2:', '        return 2', '    elif a == 3 and a or a:', '        return 3', '    return 4');
  assert.deepEqual(['cc', 'aninhamento', 'condicoes'].map(campo => unidadePy(cadeia, 'rota')[campo]), [6, 1, [2]]);
  const classe = py(
    'class Fila:', '    def __init__(self, a, b, c, d, *resto, **nomeados):', '        self.a = [x for x in a if x if b]',
    '    @classmethod', '    def criar(cls, a):', '        return cls(a, 1, 2, 3)',
  );
  assert.deepEqual(medirPy(classe).unidades.map(({ nome, argumentos, cc }) => [nome, argumentos, cc]), [['Fila.__init__', 6, 4], ['Fila.criar', 1, 1]]);
  assert.deepEqual(pontosDasFuncoes(medirPy(classe)), ['Fila.__init__ argumentos 2']);
});

test('Python: 601 linhas de código passam dois do limite 599; comentário e linha em branco não contam', () => {
  assert.deepEqual(pontosDe(medirPy(py(...Array.from({ length: 601 }, (_, i) => `v${i} = ${i}`)))), ['null tamanho 2']);
  assert.deepEqual(pontosDe(medirPy(py('# comentário', '', ...Array.from({ length: 599 }, (_, i) => `v${i} = ${i}`)))), []);
});

test('mede JS e Python de código; fica de fora o que configuracao.json isenta', () => {
  for (const caminho of ['app/electron/main.js', 'app/x.mjs', 'MAC/a/b.cjs', 'app/wake_word_bg.py', 'app/electron/dist/x.js', 'vendor/x.js']) {
    assert.equal(regra.seAplica(CONFIG, caminho), true, caminho);
  }
  for (const caminho of ['app/dist/assets/a.js', 'MAC/x/dist/a.js', 'MAC/x/reservas/a.js', 'backup-antes-traducao/a.js', 'app/electron/pwa/marked.min.js', 'a.css', 'a.json', 'a.ts']) {
    assert.equal(regra.seAplica(CONFIG, caminho), false, caminho);
  }
});

const COMMIT_DA_PR_24 = 'bbf8b805547fe6379a0000fa4ad2c3bc99fe0666';
const temOCommit = () => spawnSync('git', ['cat-file', '-e', `${COMMIT_DA_PR_24}^{commit}`], { cwd: RAIZ }).status === 0;

test('calibração: python-runtime.test.js da PR 24 (CodeScene 9,84, só Bumpy Road em antigoMac) dá só blocos aninhados em antigoMac', { skip: !temOCommit() && 'sem o histórico da PR 24 (clone raso)' }, () => {
  const fonte = execFileSync('git', ['show', `${COMMIT_DA_PR_24}:app/test/python-runtime.test.js`], { cwd: RAIZ, encoding: 'utf8' });
  assert.deepEqual(pontosDe(medirJs(fonte)), ['antigoMac blocos 1']);
});

const SIMPLES = ['um', 'dois', 'tres'].flatMap(nome => [`function ${nome}() {`, '  return 1;', '}']);
const ramos = condicoes => js('function decidir(a, b) {', ...condicoes.map((c, i) => `  if (${c}) return ${i};`), '  return b;', '}', ...SIMPLES);
const NOVE_DESVIOS = ['a', 'b', 'a > 1', 'b > 1', 'a > 2', 'b > 2', 'a > 3', 'b > 3', 'a > 4'];
const DOIS_PONTOS = ramos(NOVE_DESVIOS);
const TRES_PONTOS = ramos([...NOVE_DESVIOS, 'b > 4']);
const UM_PONTO = ramos(NOVE_DESVIOS.slice(0, 8));
const PY_COM_CINCO = py('def gravar(a, b, c, d, e):', '    return a');
const PY_COM_SEIS = py('def gravar(a, b, c, d, e, f):', '    return a');
const BASE = { 'app/a.js': DOIS_PONTOS, 'app/b.py': PY_COM_CINCO };
const FOLGA = { 'app/a.js': 2, 'app/b.py': 1 };

const repositorio = () => criar(BASE, {}, FOLGA);
const executar = (repo, ...args) => repo.rodar('--regra', 'saude-do-codigo', ...args);
const saude = repo => JSON.parse(fs.readFileSync(path.join(repo.raiz, LINHA_DE_BASE), 'utf8'))['saude-do-codigo'];

function rodarERecolher(preparar, ...args) {
  const repo = repositorio();
  preparar(repo);
  const r = executar(repo, ...args);
  return { ...r, repo };
}

function semRepo(preparar, ...args) {
  const { repo, ...r } = rodarERecolher(preparar, ...args);
  repo.limpar();
  return r;
}

test('passa: arquivo da linha de base tocado sem piorar', () => {
  const r = semRepo(repo => repo.escrever({ 'app/a.js': `${DOIS_PONTOS}const z = 1;\n` }));
  assert.equal(r.codigo, 0, r.saida);
});

test('falha: um ponto a mais que a linha de base, com a função, o antes e o conserto', () => {
  const r = semRepo(repo => repo.escrever({ 'app/a.js': TRES_PONTOS }));
  assert.equal(r.codigo, 1, r.saida);
  assert.match(r.saida, /app\/a\.js: 3 ponto\(s\) acima dos limites; a linha de base permite 2\. o que piorou em relação à base:/);
  assert.match(r.saida, /app\/a\.js:1: decidir \(linha 1\): 3 ponto\(s\); eram 2 na base — complexidade 11 \(limite 8\)/);
  assert.match(r.saida, /Conserto: Refatore de verdade/);
});

test('passa: quem só melhora passa, e a regra avisa que a linha de base pode descer', () => {
  const r = semRepo(repo => repo.escrever({ 'app/a.js': UM_PONTO }));
  assert.equal(r.codigo, 0, r.saida);
  assert.match(r.saida, /aviso: saude-do-codigo: a linha de base pode descer: app\/a\.js 2 → 1/);
});

test('falha: o Python que piora', () => {
  const r = semRepo(repo => repo.escrever({ 'app/b.py': PY_COM_SEIS }));
  assert.equal(r.codigo, 1, r.saida);
  assert.match(r.saida, /app\/b\.py: 2 ponto\(s\) acima dos limites; a linha de base permite 1/);
});

test('falha: arquivo novo nasce dentro dos limites', () => {
  const r = semRepo(repo => repo.escrever({ 'app/nova.js': js('function nova(a, b, c, d, e) {', '  return a;', '}') }));
  assert.equal(r.codigo, 1, r.saida);
  assert.match(r.saida, /app\/nova\.js: 1 ponto\(s\) acima dos limites; a linha de base permite 0 \(arquivo novo nasce dentro dos limites/);
});

test('falha: cópia de um arquivo ruim também é arquivo novo', () => {
  const r = semRepo(repo => repo.escrever({ 'app/copia.js': DOIS_PONTOS }));
  assert.equal(r.codigo, 1, r.saida);
  assert.match(r.saida, /app\/copia\.js: 2 ponto\(s\)[^\n]*permite 0/);
});

test('falha: a folga que sobrou num arquivo não vai para um arquivo novo, mesmo com o total igual', () => {
  const r = semRepo(repo => {
    repo.escrever({ 'app/a.js': UM_PONTO, 'app/nova.js': js('function nova(a, b, c, d, e) {', '  return a;', '}') });
    repo.lista({}, { 'app/a.js': 1, 'app/b.py': 1, 'app/nova.js': 1 });
  });
  assert.equal(r.codigo, 1, r.saida);
  assert.match(r.saida, /saude-do-codigo app\/nova\.js entrou na linha de base, que só desce/);
});

test('falha: nem de um arquivo para outro que já está na linha de base', () => {
  const r = semRepo(repo => {
    repo.escrever({ 'app/a.js': UM_PONTO, 'app/b.py': PY_COM_SEIS });
    repo.lista({}, { 'app/a.js': 1, 'app/b.py': 2 });
  });
  assert.equal(r.codigo, 1, r.saida);
  assert.match(r.saida, /saude-do-codigo app\/b\.py: a linha de base subiu de 1 para 2/);
});

test('falha: subir a linha de base à mão', () => {
  const r = semRepo(repo => {
    repo.escrever({ 'app/a.js': TRES_PONTOS });
    repo.lista({}, { 'app/a.js': 3, 'app/b.py': 1 });
  });
  assert.equal(r.codigo, 1, r.saida);
  assert.match(r.saida, /app\/a\.js: a linha de base subiu de 2 para 3/);
});

test('falha: baixar a linha de base abaixo do que o arquivo tem', () => {
  const r = semRepo(repo => {
    repo.escrever({ 'app/a.js': `${DOIS_PONTOS}const z = 1;\n` });
    repo.lista({}, { 'app/a.js': 1, 'app/b.py': 1 });
  });
  assert.equal(r.codigo, 1, r.saida);
  assert.match(r.saida, /app\/a\.js: 2 ponto\(s\) acima dos limites; a linha de base permite 1/);
});

test('git mv leva a folga: a entrada vai para o nome novo com --atualizar-linha-de-base', () => {
  const { repo, ...antes } = rodarERecolher(r => r.git('mv', 'app/a.js', 'app/movida.js'));
  assert.equal(antes.codigo, 1, antes.saida);
  assert.match(antes.saida, /o arquivo veio de app\/a\.js: leve a entrada para o nome novo/);
  const atualizar = repo.rodar('--atualizar-linha-de-base', '--regra', 'saude-do-codigo');
  assert.equal(atualizar.codigo, 0, atualizar.saida);
  assert.deepEqual(saude(repo), { 'app/b.py': 1, 'app/movida.js': 2 });
  const depois = executar(repo);
  repo.limpar();
  assert.equal(depois.codigo, 0, depois.saida);
});

test('arquivo que a mudança não toca nunca é medido', () => {
  const repo = criar({ ...BASE, 'app/velho.js': TRES_PONTOS }, {}, FOLGA);
  repo.escrever({ 'app/a.js': `${DOIS_PONTOS}const z = 1;\n` });
  const r = executar(repo);
  repo.limpar();
  assert.equal(r.codigo, 0, r.saida);
});

test('apagar um arquivo da linha de base passa e avisa que a entrada pode sair', () => {
  const r = semRepo(repo => repo.escrever({ 'app/a.js': null }));
  assert.equal(r.codigo, 0, r.saida);
  assert.match(r.saida, /app\/a\.js não existe mais neste caminho; a entrada dele pode sair/);
});

test('falha: arquivo novo no caminho de uma entrada velha não herda a folga', () => {
  const repo = criar({ 'app/b.py': PY_COM_CINCO }, {}, { 'app/a.js': 2, 'app/b.py': 1 });
  repo.escrever({ 'app/a.js': DOIS_PONTOS });
  const r = executar(repo);
  repo.limpar();
  assert.equal(r.codigo, 1, r.saida);
  assert.match(r.saida, /app\/a\.js: arquivo novo não herda folga/);
  assert.match(r.saida, /app\/a\.js: 2 ponto\(s\)[^\n]*permite 0/);
});

test('o que configuracao.json isenta não é medido', () => {
  const r = semRepo(repo => repo.escrever({ 'app/dist/novo.js': TRES_PONTOS }));
  assert.equal(r.codigo, 0, r.saida);
});

test('falha: o ramo sem a chave saude-do-codigo na linha de base', () => {
  const r = semRepo(repo => repo.escrever({ [LINHA_DE_BASE]: '{"arquivos": {}}\n' }));
  assert.equal(r.codigo, 1, r.saida);
  assert.match(r.saida, /falta a chave "saude-do-codigo"/);
});

test('a primeira linha de base: a base sem a chave não tem com o que comparar', () => {
  const repo = criar(BASE, {}, null);
  repo.escrever({ [LINHA_DE_BASE]: `${JSON.stringify({ arquivos: {}, 'saude-do-codigo': FOLGA })}\n`, 'app/a.js': `${DOIS_PONTOS}const z = 1;\n` });
  const r = executar(repo);
  repo.limpar();
  assert.equal(r.codigo, 0, r.saida);
  assert.match(r.saida, /main ainda não tem a linha de base de saude-do-codigo/);
});

function rodarSemPython(exige) {
  const repo = repositorio();
  repo.escrever({ 'app/b.py': PY_COM_SEIS });
  const resultado = spawnSync(process.execPath, [VERIFICAR, '--raiz', repo.raiz, '--base', 'main', '--regra', 'saude-do-codigo'], {
    encoding: 'utf8', env: { ...process.env, PYTHON: path.join(repo.raiz, 'sem-python'), REGRAS_EXIGE_FERRAMENTAS: exige },
  });
  repo.limpar();
  return { codigo: resultado.status, saida: `${resultado.stdout}${resultado.stderr}` };
}

test('sem Python: no CI (REGRAS_EXIGE_FERRAMENTAS) falha e diz o que fazer; fora dele, avisa e pula', () => {
  const noCi = rodarSemPython('1');
  assert.equal(noCi.codigo, 1, noCi.saida);
  assert.match(noCi.saida, /instale o Python 3 ou aponte PYTHON=/);
  const local = rodarSemPython('');
  assert.equal(local.codigo, 0, local.saida);
  assert.match(local.saida, /aviso: .*regra saude-do-codigo pulada/);
});

test('--criar-linha-de-base --regra saude-do-codigo cria só a chave que falta e não toca a do limite de linhas', () => {
  const repo = repositorio();
  repo.escrever({ [LINHA_DE_BASE]: '{"arquivos": {"app/grande.js": 1200}}\n', 'app/grande.js': linhas(1200) });
  const criou = repo.rodar('--criar-linha-de-base', '--regra', 'saude-do-codigo');
  const dados = JSON.parse(fs.readFileSync(path.join(repo.raiz, LINHA_DE_BASE), 'utf8'));
  const outraVez = repo.rodar('--criar-linha-de-base', '--regra', 'saude-do-codigo');
  const semLinhaDeBase = repo.rodar('--criar-linha-de-base', '--regra', 'sem-segredo');
  repo.limpar();
  assert.equal(criou.codigo, 0, criou.saida);
  assert.deepEqual(dados, { arquivos: { 'app/grande.js': 1200 }, 'saude-do-codigo': FOLGA });
  assert.equal(outraVez.codigo, 2, outraVez.saida);
  assert.match(outraVez.saida, /já tem a linha de base de saude-do-codigo; ela só encolhe/);
  assert.equal(semLinhaDeBase.codigo, 2, semLinhaDeBase.saida);
  assert.match(semLinhaDeBase.saida, /sem-segredo não tem linha de base/);
});

test('--atualizar-linha-de-base baixa a entrada que melhorou, tira a que zerou e recusa subir', () => {
  const repo = repositorio();
  repo.escrever({ 'app/a.js': UM_PONTO, 'app/b.py': js('def gravar(a):', '    return a') });
  assert.equal(repo.rodar('--atualizar-linha-de-base', '--regra', 'saude-do-codigo').codigo, 0);
  assert.deepEqual(saude(repo), { 'app/a.js': 1 });
  repo.escrever({ 'app/a.js': TRES_PONTOS });
  const subir = repo.rodar('--atualizar-linha-de-base', '--regra', 'saude-do-codigo');
  repo.limpar();
  assert.equal(subir.codigo, 1, subir.saida);
  assert.match(subir.saida, /app\/a\.js: 3 ponto\(s\), mais que os 1 da linha de base de saude-do-codigo[^]*nada foi atualizado/);
});

test('--atualizar-linha-de-base da saúde só mexe no que a mudança toca: a folga dos outros arquivos fica', () => {
  const repo = criar({ ...BASE, 'app/c.js': DOIS_PONTOS }, {}, { ...FOLGA, 'app/c.js': 3 });
  repo.escrever({ 'app/a.js': UM_PONTO });
  const r = repo.rodar('--atualizar-linha-de-base', '--regra', 'saude-do-codigo');
  const depois = saude(repo);
  repo.limpar();
  assert.equal(r.codigo, 0, r.saida);
  assert.deepEqual(depois, { 'app/a.js': 1, 'app/b.py': 1, 'app/c.js': 3 });
});

test('--atualizar-linha-de-base do limite de linhas mantém a chave saude-do-codigo', () => {
  const repo = criar({ ...BASE, 'app/grande.js': linhas(1200) }, { 'app/grande.js': 1200 }, FOLGA);
  repo.escrever({ 'app/grande.js': linhas(1100) });
  const r = repo.rodar('--atualizar-linha-de-base', '--regra', 'limite-de-linhas');
  const dados = JSON.parse(fs.readFileSync(path.join(repo.raiz, LINHA_DE_BASE), 'utf8'));
  repo.limpar();
  assert.equal(r.codigo, 0, r.saida);
  assert.deepEqual(dados, { arquivos: { 'app/grande.js': 1100 }, 'saude-do-codigo': FOLGA });
});
