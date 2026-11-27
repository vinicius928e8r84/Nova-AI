'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const portao = require('../../ci/portao-dos-testes');

const RAIZ = path.join(__dirname, '..', '..', '..');
const SCRIPT = path.join(RAIZ, 'scripts', 'ci', 'portao-dos-testes.js');
const PASTA_DOS_WORKFLOWS = path.join(RAIZ, '.github', 'workflows');
const lerWorkflow = nome => fs.readFileSync(path.join(PASTA_DOS_WORKFLOWS, nome), 'utf8');
const WORKFLOW = fs.readdirSync(PASTA_DOS_WORKFLOWS).map(lerWorkflow).join('\n');

const LISTA = {
  grupos: [
    { nome: 'app', job: 'testes', arquivos: ['app/test/**/*.test.js'] },
    { nome: 'iphone', job: 'testes', arquivos: ['test/a/rodando.cjs'] },
  ],
  fora: [
    { arquivos: ['test/a/pede-mac.cjs'], motivo: 'chama o clang do Mac', issue: 7 },
    { arquivos: ['**/*.palco.js'], motivo: 'auxiliar dos testes de cena, não roda sozinho' },
  ],
};

const arquivosDe = (...extras) => ['app/test/a.test.js', 'test/a/rodando.cjs', 'test/a/pede-mac.cjs', 'app/test/b.palco.js', 'app/src/lib.js', ...extras];
const problemasDe = (lista, arquivos) => portao.conferir(lista, arquivos);

test('arquivo de teste é o que tem nome de teste ou mora em pasta de teste', () => {
  const sim = ['x/a.test.js', 'x/a.test.cjs', 'x/test/a.cjs', 'x/tests/a.js', 'x/teste/a.sh', 'x/testes/a/b.py', 'x/teste-a.js', 'x/a_test.m', 'x/test_a.py', 'x/a.spec.js'];
  const nao = ['x/a.js', 'x/test/dados.json', 'x/test/fixtures/a.js', 'x/test/a/fixtures/b.js', 'x/leia-me.md', 'x/testador.js', 'x/contesto.js', 'x/test/README.md'];
  assert.deepEqual(portao.arquivosDeTeste([...sim, ...nao]), sim);
});

test('teste novo fora de todo grupo e da lista de fora deixa o portão vermelho', () => {
  assert.deepEqual(problemasDe(LISTA, arquivosDe()), []);
  const problemas = problemasDe(LISTA, arquivosDe('test/b/novo.test.cjs'));
  assert.equal(problemas.length, 1);
  assert.match(problemas[0], /test\/b\/novo\.test\.cjs/);
  assert.match(problemas[0], /nenhum grupo/);
});

test('teste dentro de pasta já coberta por um glob não precisa de linha nova', () => {
  assert.deepEqual(problemasDe(LISTA, arquivosDe('app/test/sub/c.test.js')), []);
});

test('arquivo em grupo e em fora ao mesmo tempo é problema', () => {
  const nosDois = { ...LISTA, fora: [...LISTA.fora, { arquivos: ['test/a/rodando.cjs'], motivo: 'roda e está fora ao mesmo tempo' }] };
  assert.match(problemasDe(nosDois, arquivosDe()).join('\n'), /test\/a\/rodando\.cjs.*mais de um lugar/);
});

test('arquivo em dois grupos é problema', () => {
  const doisGrupos = { ...LISTA, grupos: [...LISTA.grupos, { nome: 'copia', job: 'testes', arquivos: ['app/test/*.test.js'] }] };
  assert.match(problemasDe(doisGrupos, arquivosDe()).join('\n'), /app\/test\/a\.test\.js.*mais de um lugar.*app, copia/);
});

test('entrada de fora sem motivo, ou com motivo vazio, é problema', () => {
  for (const motivo of [undefined, '', '   ']) {
    const lista = { ...LISTA, fora: [{ arquivos: ['test/a/pede-mac.cjs'], motivo }, LISTA.fora[1]] };
    assert.match(problemasDe(lista, arquivosDe()).join('\n'), /sem motivo/);
  }
});

test('glob que não casa nenhum arquivo é problema, nos grupos e em fora', () => {
  const grupo = { ...LISTA, grupos: [...LISTA.grupos, { nome: 'velho', job: 'testes', arquivos: ['test/some/**/*.test.js'] }] };
  assert.match(problemasDe(grupo, arquivosDe()).join('\n'), /test\/some.*não casa nenhum arquivo/);
  const fora = { ...LISTA, fora: [...LISTA.fora, { arquivos: ['test/some/x.cjs'], motivo: 'foi apagado' }] };
  assert.match(problemasDe(fora, arquivosDe()).join('\n'), /test\/some\/x\.cjs.*não casa nenhum arquivo/);
});

test('grupo sem nome, sem job ou repetido é problema', () => {
  const semJob = { ...LISTA, grupos: [{ nome: 'app', arquivos: ['app/test/**/*.test.js'] }, LISTA.grupos[1]] };
  assert.match(problemasDe(semJob, arquivosDe()).join('\n'), /app.*job/);
  const repetido = { ...LISTA, grupos: [LISTA.grupos[0], { ...LISTA.grupos[1], nome: 'app' }] };
  assert.match(problemasDe(repetido, arquivosDe()).join('\n'), /app.*repetido/);
});

test('arquivosDoGrupo devolve os arquivos do grupo, ordenados', () => {
  const arquivos = arquivosDe('app/test/sub/c.test.js');
  assert.deepEqual(portao.arquivosDoGrupo(LISTA.grupos[0], arquivos), ['app/test/a.test.js', 'app/test/sub/c.test.js']);
});

test('arquivosDoJob junta os grupos do job na ordem da lista', () => {
  assert.deepEqual(portao.arquivosDoJob(LISTA, 'testes', arquivosDe()), [['app', ['app/test/a.test.js']], ['iphone', ['test/a/rodando.cjs']]]);
  assert.deepEqual(portao.arquivosDoJob(LISTA, 'regras', arquivosDe()), []);
});

const lista = portao.carregarLista();
const versionados = portao.arquivosDoRepositorio();

test('a lista do repositório cobre todo arquivo de teste do repositório', () => {
  assert.deepEqual(portao.conferir(lista, versionados), []);
});

test('os testes que passam e ninguém rodava estão num grupo', () => {
  const queNinguemRodava = [
    'interface/controle-do-celular/iphone/test/botao.test.cjs',
    'test/iphone/botao-servico.test.cjs',
    'test/iphone/windows-hide.test.cjs',
    'test/iphone/android-install.cjs',
    'test/iphone/chave-de-host.cjs',
    'test/iphone/ios-tools-windows.cjs',
    'test/iphone/routing.cjs',
    'test/iphone/wireless.cjs',
    'test/iphone/teste-geo.cjs',
  ];
  const rodados = new Set(lista.grupos.flatMap(grupo => portao.arquivosDoGrupo(grupo, versionados)));
  assert.deepEqual(queNinguemRodava.filter(arquivo => !rodados.has(arquivo)), []);
});

test('os cinco que falham no Windows ficam em fora, cada um com motivo e issue', () => {
  const cinco = [
    'test/cam-live/iphone-media.cjs',
    'test/iphone/relay.cjs',
    'test/foto-em-video/teste-motor-local.cjs',
    'test/foto-em-video/teste-movimento.cjs',
    'test/navegador/navegador.cjs',
  ];
  for (const arquivo of cinco) {
    const entrada = lista.fora.find(item => item.arquivos.includes(arquivo));
    assert.ok(entrada, `${arquivo} precisa estar em fora`);
    assert.ok(Number.isInteger(entrada.issue) && entrada.issue > 0, `${arquivo} precisa da issue que diz se pede um Mac ou está quebrado`);
    assert.ok(entrada.motivo.trim().length >= 20, `${arquivo} precisa de motivo escrito`);
  }
});

test('o workflow lê os grupos da lista e não repete nome de teste', () => {
  assert.doesNotMatch(WORKFLOW, /node --test/);
  assert.doesNotMatch(WORKFLOW, /\.cjs/);
  const jobs = new Set(lista.grupos.map(grupo => grupo.job));
  for (const job of jobs) assert.match(WORKFLOW, new RegExp(`node scripts/ci/portao-dos-testes\\.js --job ${job}\\b`), `o workflow precisa rodar o job ${job} da lista`);
});

const TESTES_DO_MAC = [
  'iphone/proxy/tool/test/parse_test.m',
  'iphone/proxy/tool/test/upstream_test.m',
  'iphone/proxy/tool/test/rodar.sh',
  'iphone/idioma/test/rodar.sh',
  'iphone/idioma/test/teste-novalanguage.sh',
  'iphone/idioma/test/teste-helper.sh',
];
const gruposDoMac = () => lista.grupos.filter(grupo => grupo.job === 'mac');
const arquivosDosGruposDoMac = () => new Set(gruposDoMac().flatMap(grupo => portao.arquivosDoGrupo(grupo, versionados)));

test('os testes do Mac do proxy e do idioma estão num grupo do job mac', () => {
  const noMac = arquivosDosGruposDoMac();
  assert.deepEqual(TESTES_DO_MAC.filter(arquivo => !noMac.has(arquivo)), []);
});

test('nenhum teste em Objective-C ou shell do iPhone fica de fora do job mac', () => {
  const noMac = arquivosDosGruposDoMac();
  const doIphone = portao.arquivosDeTeste(versionados).filter(arquivo => arquivo.startsWith('iphone/') && /\.(m|sh)$/.test(arquivo));
  assert.ok(doIphone.length >= TESTES_DO_MAC.length);
  assert.deepEqual(doIphone.filter(arquivo => !noMac.has(arquivo)), []);
});

test('o job mac executa os dois rodar.sh com bash e só eles', () => {
  assert.deepEqual(portao.arquivosDoJob(lista, 'mac', versionados), [['mac-do-iphone', ['iphone/idioma/test/rodar.sh', 'iphone/proxy/tool/test/rodar.sh'], 'bash']]);
});

test('grupo com executar só pode executar arquivo que ele mesmo cobre', () => {
  const grupo = { nome: 'mac', job: 'mac', com: 'bash', arquivos: ['t/a/rodar.sh', 't/a/x_test.m'], executar: ['t/a/rodar.sh', 't/b/rodar.sh'] };
  const arquivos = ['t/a/rodar.sh', 't/a/x_test.m', 't/b/rodar.sh'];
  assert.match(problemasDe({ grupos: [grupo], fora: [] }, arquivos).join('\n'), /mac.*executa t\/b\/rodar\.sh.*não cobre/);
  assert.deepEqual(problemasDe({ grupos: [{ ...grupo, executar: ['t/a/rodar.sh'] }], fora: [] }, arquivos.slice(0, 2)), []);
});

test('rodar.sh novo de outra pasta do iPhone é executado pelo job mac, mas só depois de coberto pelo grupo', () => {
  const novo = 'iphone/modelo/test/rodar.sh';
  const [, executados] = portao.arquivosDoJob(lista, 'mac', [...versionados, novo])[0];
  assert.ok(executados.includes(novo));
  assert.match(portao.conferir(lista, [...versionados, novo]).join('\n'), /iphone\/modelo\/test\/rodar\.sh/);
});

test('grupo com executar sem com é problema', () => {
  const grupo = { nome: 'mac', job: 'mac', arquivos: ['t/a/rodar.sh'], executar: ['t/a/rodar.sh'] };
  assert.match(problemasDe({ grupos: [grupo], fora: [] }, ['t/a/rodar.sh']).join('\n'), /mac.*sem com/);
});

test('rodar o job entrega o programa do grupo a quem executa', () => {
  const chamadas = [];
  const rodar = (arquivos, com) => chamadas.push([arquivos, com]) && 0;
  portao.rodarGrupos([['a', ['x.cjs']], ['mac', ['y.sh'], 'bash']], rodar, () => {});
  assert.deepEqual(chamadas, [[['x.cjs'], undefined], [['y.sh'], 'bash']]);
});

test('o workflow do Mac roda o job mac num macos-latest só quando o iPhone ou ele mesmo mudam', () => {
  const texto = lerWorkflow('mac-iphone.yml');
  assert.match(texto, /runs-on: macos-latest/);
  assert.match(texto, /node scripts\/ci\/portao-dos-testes\.js --job mac\b/);
  const paths = texto.match(/^ {4}paths:\r?\n((?: {6}- .+\r?\n)+)/m);
  assert.ok(paths, 'o gatilho pull_request precisa de paths');
  const caminhos = paths[1].split(/\r?\n/).filter(Boolean).map(linha => linha.replace(/^ +- /, '').replace(/^'|'$/g, ''));
  assert.deepEqual(caminhos.sort(), ['.github/workflows/mac-iphone.yml', 'iphone/**']);
});

test('o teste do portão roda no job das regras', () => {
  const regras = portao.arquivosDoJob(lista, 'regras', versionados).flatMap(([, arquivos]) => arquivos);
  assert.ok(regras.includes('scripts/regras/test/portao-dos-testes.test.js'));
});

test('--listar mostra os grupos do job sem rodar nada', () => {
  const saida = spawnSync(process.execPath, [SCRIPT, '--listar', '--job', 'regras'], { cwd: RAIZ, encoding: 'utf8' });
  assert.equal(saida.status, 0, saida.stderr);
  assert.match(saida.stdout, /regras/);
  assert.match(saida.stdout, /scripts\/regras\/test\/portao-dos-testes\.test\.js/);
});

test('job que não existe na lista falha com o motivo', () => {
  const saida = spawnSync(process.execPath, [SCRIPT, '--job', 'nenhum'], { cwd: RAIZ, encoding: 'utf8' });
  assert.equal(saida.status, 1);
  assert.match(saida.stderr, /nenhum grupo.*job nenhum/);
});

test('rodar o job devolve falha se um grupo falha, e roda os outros mesmo assim', () => {
  const execucoes = [];
  const rodar = arquivos => {
    execucoes.push(arquivos);
    return arquivos[0] === 'ruim.cjs' ? 1 : 0;
  };
  const grupos = [['a', ['ruim.cjs']], ['b', ['bom.cjs']]];
  assert.equal(portao.rodarGrupos(grupos, rodar, () => {}), 1);
  assert.deepEqual(execucoes, [['ruim.cjs'], ['bom.cjs']]);
  assert.equal(portao.rodarGrupos([['b', ['bom.cjs']]], rodar, () => {}), 0);
});

test('grupo que não achou arquivo nenhum falha em vez de passar vazio', () => {
  assert.equal(portao.rodarGrupos([['vazio', []]], () => 0, () => {}), 1);
});
