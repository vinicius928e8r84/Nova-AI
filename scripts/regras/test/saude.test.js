'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('child_process');
const path = require('path');
const { criar } = require('./auxiliar');
const regra = require('../regra-saude');
const { medirJs } = require('../analisador/medir-js');
const { FerramentaAusente, rodarOPython } = require('../analisador/medir');
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
  for (const caminho of ['app/electron/main.js', 'app/x.mjs', 'iphone/a/b.cjs', 'app/wake_word_bg.py', 'app/electron/dist/x.js', 'vendor/x.js', 'iphone/x/reservas/a.js']) {
    assert.equal(regra.seAplica(CONFIG, caminho), true, caminho);
  }
  for (const caminho of ['app/dist/assets/a.js', 'interface/dist/a.js', 'backup-antes-traducao/a.js', 'app/electron/pwa/marked.min.js', 'a.css', 'a.json', 'a.ts']) {
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

const repositorio = () => criar(BASE);
const executar = (repo, ...args) => repo.rodar('--regra', 'saude-do-codigo', ...args);

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

test('passa: arquivo que já tinha pontos na branch-alvo, tocado sem piorar', () => {
  const r = semRepo(repo => repo.escrever({ 'app/a.js': `${DOIS_PONTOS}const z = 1;\n` }));
  assert.equal(r.codigo, 0, r.saida);
});

test('falha: um ponto a mais que a branch-alvo, com a função, o antes e o conserto', () => {
  const r = semRepo(repo => repo.escrever({ 'app/a.js': TRES_PONTOS }));
  assert.equal(r.codigo, 1, r.saida);
  assert.match(r.saida, /app\/a\.js: 3 ponto\(s\) acima dos limites; o teto é 2, a medida dele na branch-alvo\. o que piorou em relação à base:/);
  assert.match(r.saida, /app\/a\.js:1: decidir \(linha 1\): 3 ponto\(s\); eram 2 na base — complexidade 11 \(limite 8\)/);
  assert.match(r.saida, /Conserto: Refatore de verdade/);
});

test('passa sem editar lista nenhuma: quem melhora passa, e o teto seguinte é a medida nova', () => {
  const repo = repositorio();
  repo.escrever({ 'app/a.js': UM_PONTO });
  const melhora = executar(repo);
  repo.guardar('melhora');
  repo.git('branch', '-f', 'main', 'HEAD');
  repo.escrever({ 'app/a.js': DOIS_PONTOS });
  const volta = executar(repo);
  repo.limpar();
  assert.equal(melhora.codigo, 0, melhora.saida);
  assert.doesNotMatch(melhora.saida, /linha de base/);
  assert.equal(volta.codigo, 1, volta.saida);
  assert.match(volta.saida, /app\/a\.js: 2 ponto\(s\) acima dos limites; o teto é 1/);
});

test('falha: o Python que piora', () => {
  const r = semRepo(repo => repo.escrever({ 'app/b.py': PY_COM_SEIS }));
  assert.equal(r.codigo, 1, r.saida);
  assert.match(r.saida, /app\/b\.py: 2 ponto\(s\) acima dos limites; o teto é 1/);
});

test('falha: arquivo novo nasce dentro dos limites', () => {
  const r = semRepo(repo => repo.escrever({ 'app/nova.js': js('function nova(a, b, c, d, e) {', '  return a;', '}') }));
  assert.equal(r.codigo, 1, r.saida);
  assert.match(r.saida, /app\/nova\.js: 1 ponto\(s\) acima dos limites; o teto é 0, a medida dele na branch-alvo \(arquivo novo nasce dentro dos limites/);
});

test('falha: cópia de um arquivo ruim também é arquivo novo e não leva o teto', () => {
  const r = semRepo(repo => repo.escrever({ 'app/copia.js': DOIS_PONTOS }));
  assert.equal(r.codigo, 1, r.saida);
  assert.match(r.saida, /app\/copia\.js: 2 ponto\(s\)[^\n]*o teto é 0/);
});

test('falha: a folga que sobrou num arquivo não vai para um arquivo novo, mesmo com o total igual', () => {
  const r = semRepo(repo => repo.escrever({ 'app/a.js': UM_PONTO, 'app/nova.js': js('function nova(a, b, c, d, e) {', '  return a;', '}') }));
  assert.equal(r.codigo, 1, r.saida);
  assert.match(r.saida, /app\/nova\.js: 1 ponto\(s\)[^\n]*o teto é 0/);
});

test('falha: nem de um arquivo para outro que já tinha pontos na branch-alvo', () => {
  const r = semRepo(repo => repo.escrever({ 'app/a.js': UM_PONTO, 'app/b.py': PY_COM_SEIS }));
  assert.equal(r.codigo, 1, r.saida);
  assert.match(r.saida, /app\/b\.py: 2 ponto\(s\)[^\n]*o teto é 1/);
});

test('falha: arquivo que cabia nos limites na branch-alvo e passa a ter pontos', () => {
  const repo = criar({ 'app/limpo.js': js('function limpo(a) {', '  return a;', '}') });
  repo.escrever({ 'app/limpo.js': js('function limpo(a, b, c, d, e) {', '  return a;', '}') });
  const r = executar(repo);
  repo.limpar();
  assert.equal(r.codigo, 1, r.saida);
  assert.match(r.saida, /app\/limpo\.js: 1 ponto\(s\)[^\n]*o teto é 0/);
});

test('git mv leva o teto: o arquivo movido passa igual e encolhido, e falha se piora', () => {
  const repo = repositorio();
  repo.git('mv', 'app/a.js', 'app/movida.js');
  const igual = executar(repo);
  repo.escrever({ 'app/movida.js': UM_PONTO });
  const melhora = executar(repo);
  repo.escrever({ 'app/movida.js': TRES_PONTOS });
  const piora = executar(repo);
  repo.limpar();
  assert.equal(igual.codigo, 0, igual.saida);
  assert.equal(melhora.codigo, 0, melhora.saida);
  assert.equal(piora.codigo, 1, piora.saida);
  assert.match(piora.saida, /app\/movida\.js: 3 ponto\(s\) acima dos limites; o teto é 2/);
});

test('arquivo que a mudança não toca nunca é medido', () => {
  const repo = criar({ ...BASE, 'app/velho.js': TRES_PONTOS });
  repo.escrever({ 'app/a.js': `${DOIS_PONTOS}const z = 1;\n` });
  const r = executar(repo);
  repo.limpar();
  assert.equal(r.codigo, 0, r.saida);
});

test('apagar um arquivo ruim passa', () => {
  const r = semRepo(repo => repo.escrever({ 'app/a.js': null }));
  assert.equal(r.codigo, 0, r.saida);
});

test('falha: arquivo novo no caminho de um arquivo apagado não herda o teto', () => {
  const repo = criar({ 'app/b.py': PY_COM_CINCO, 'app/a.js': DOIS_PONTOS });
  repo.git('rm', '-q', 'app/a.js');
  repo.guardar('apaga');
  repo.git('branch', '-f', 'main', 'HEAD');
  repo.escrever({ 'app/a.js': DOIS_PONTOS });
  const r = executar(repo);
  repo.limpar();
  assert.equal(r.codigo, 1, r.saida);
  assert.match(r.saida, /app\/a\.js: 2 ponto\(s\)[^\n]*o teto é 0/);
});

test('o que configuracao.json isenta não é medido, nem leva teto ao sair da isenção', () => {
  const repo = criar({ 'interface/dist/a.js': TRES_PONTOS });
  repo.escrever({ 'app/dist/assets/novo.js': TRES_PONTOS });
  const isento = executar(repo);
  repo.git('mv', 'interface/dist/a.js', 'app/saiu.js');
  const saiu = executar(repo);
  repo.limpar();
  assert.equal(isento.codigo, 0, isento.saida);
  assert.equal(saiu.codigo, 1, saiu.saida);
  assert.match(saiu.saida, /app\/saiu\.js: 3 ponto\(s\)[^\n]*o teto é 0/);
});

const SEM_ACORN = "const M = require('module'); const resolver = M._resolveFilename; M._resolveFilename = function (nome, ...resto) { if (nome === 'acorn') throw new Error('Cannot find module'); return resolver.call(this, nome, ...resto); };\n";

function rodarSemFerramenta(exige, ferramenta) {
  const repo = repositorio();
  repo.escrever({ 'app/b.py': PY_COM_SEIS, 'app/b.js': `${DOIS_PONTOS}const z = 1;\n`, 'sem-acorn.js': SEM_ACORN });
  const env = { ...process.env, REGRAS_EXIGE_FERRAMENTAS: exige };
  const argumentos = [VERIFICAR, '--raiz', repo.raiz, '--base', 'main', '--regra', 'saude-do-codigo'];
  if (ferramenta === 'python') env.PYTHON = path.join(repo.raiz, 'sem-python');
  else argumentos.unshift('--require', path.join(repo.raiz, 'sem-acorn.js'));
  const resultado = spawnSync(process.execPath, argumentos, { encoding: 'utf8', env });
  repo.limpar();
  return { codigo: resultado.status, saida: `${resultado.stdout}${resultado.stderr}` };
}

const rodarSemPython = exige => rodarSemFerramenta(exige, 'python');

test('sem Python: no CI (REGRAS_EXIGE_FERRAMENTAS) falha e diz o que fazer; fora dele, avisa e pula', () => {
  const noCi = rodarSemPython('1');
  assert.equal(noCi.codigo, 1, noCi.saida);
  assert.match(noCi.saida, /instale o Python 3 ou aponte PYTHON=/);
  const local = rodarSemPython('');
  assert.equal(local.codigo, 0, local.saida);
  assert.match(local.saida, /aviso: .*regra saude-do-codigo pulada/);
});

test('sem acorn: no CI falha e diz o que instalar; fora dele, avisa e pula', () => {
  const noCi = rodarSemFerramenta('1', 'acorn');
  assert.equal(noCi.codigo, 1, noCi.saida);
  assert.match(noCi.saida, /npm ci --prefix scripts\/regras\/analisador/);
  const local = rodarSemFerramenta('', 'acorn');
  assert.equal(local.codigo, 0, local.saida);
  assert.match(local.saida, /aviso: .*regra saude-do-codigo pulada/);
});

test('o Python lê o stdin em UTF-8 mesmo quando o sistema usa outra página de código (Windows até o Python 3.14)', () => {
  const medidor = path.join(__dirname, '..', 'analisador', 'medir_py.py');
  const comoNoWindows = `import io, sys, runpy; sys.stdin = io.TextIOWrapper(sys.stdin.buffer, encoding='cp1252'); runpy.run_path(${JSON.stringify(medidor)}, run_name='__main__')`;
  const resultado = spawnSync(process.env.PYTHON || 'python3', ['-I', '-c', comoNoWindows], {
    input: JSON.stringify({ 'a.py': "x = 'Á'\n" }), encoding: 'utf8',
  });
  assert.equal(resultado.status, 0, resultado.stderr);
  assert.ok(JSON.parse(resultado.stdout)['a.py'].unidades);
});

test('Python que sai com erro sem traceback (alias da Store, stub do xcode-select) vira ferramenta ausente', () => {
  assert.throws(() => rodarOPython({ 'a.py': 'x = 1\n' }, { PYTHON: process.execPath }), FerramentaAusente);
});
