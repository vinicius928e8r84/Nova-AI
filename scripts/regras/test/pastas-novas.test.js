'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { criar, temEslint } = require('./auxiliar');
const { classificar } = require('../risco');
const { casaAlgum } = require('../globs');
const configuracao = require('../configuracao.json');

function tentar(regra, arquivos, base = {}) {
  const repo = criar(base);
  repo.escrever(arquivos);
  const resultado = repo.rodar('--regra', regra);
  repo.limpar();
  return resultado;
}

const idsDe = caminho => classificar([{ caminho, adicionadas: [] }]).motivos.map(motivo => motivo.id);

const ATENCAO_ALTA = {
  'iphone/**': ['iphone/README.md', 'iphone/camera/Tweak.x', 'iphone/modelo/Makefile', 'iphone/modelo/models.json', 'iphone/proxy/tool/Upstream.m', 'iphone/idioma/novalanguage/main.m', 'iphone/idioma/test/rodar.sh'],
  'interface/controle-do-celular/**': ['interface/controle-do-celular/aplicar.py', 'interface/controle-do-celular/README.md', 'interface/controle-do-celular/iphone/proxy-parse.js', 'interface/controle-do-celular/localizacao-pela-proxy/aplicar-geo.py'],
  'interface/dist/**': ['interface/dist/index-Dun7lr2S.patched.js'],
  'interface/sequestro-de-camera/**': ['interface/sequestro-de-camera/patch_bundle.py', 'interface/sequestro-de-camera/patch_transmissao.py'],
  'test/iphone/**': ['test/iphone/novamodel.test.cjs', 'test/iphone/locale-helper.test.cjs', 'test/iphone/modal/integracao.js', 'test/iphone/package.json'],
  'test/cam-live/**': ['test/cam-live/harness.js', 'test/cam-live/controles-independentes.test.cjs', 'test/cam-live/fixtures/tiny.jpg'],
  'distribuicao/**': ['distribuicao/empacotar-python.py', 'distribuicao/preparar-pacote.py', 'distribuicao/README.md'],
};

for (const [glob, caminhos] of Object.entries(ATENCAO_ALTA)) {
  test(`atenção ALTA: ${glob}`, () => {
    for (const caminho of caminhos) assert.equal(classificar([{ caminho, adicionadas: [] }]).alta, true, caminho);
  });
}

test('atenção ALTA: o glob de cada grupo é o que o classifica, no grupo certo', () => {
  assert.ok(idsDe('iphone/modelo/Makefile').includes('ponte-do-iphone'));
  assert.ok(idsDe('test/iphone/novamodel.test.cjs').includes('ponte-do-iphone'));
  assert.ok(idsDe('interface/sequestro-de-camera/patch_bundle.py').includes('ponte-do-iphone'));
  assert.ok(idsDe('distribuicao/README.md').includes('atualizacao-e-dependencias'));
  assert.ok(!idsDe('distribuicao/README.md').includes('ponte-do-iphone'));
});

test('atenção ALTA: as pastas novas que não são da ponte nem da atualização continuam fora', () => {
  const comuns = [
    'interface/traducao/preparar.py', 'interface/traducao/LEIA-ME.md', 'test/foto-em-video/teste-movimento.cjs', 'test/navegador/ferramenta-ausente.cjs',
    'docs/guia/README.md', 'docs/historico.md', 'docs/pesquisas/nota-10-global-spoof/README.md', 'app/test/ajuda/x.js', 'test/outra/x.js', 'interface/outra/x.js',
  ];
  for (const caminho of comuns) assert.equal(classificar([{ caminho, adicionadas: [] }]).alta, false, caminho);
});

test('atenção ALTA: nenhum caminho de MAC/ saiu', () => {
  const antigos = ['MAC/integracao-iphone/x', 'MAC/proxy-iphone/x', 'MAC/controle-celular-plataformas/x', 'MAC/integracao-sequestro-cam/x', 'MAC/integracao-camlive/x', 'MAC/distribuicao/x', 'MAC/encerramento-nova/x'];
  for (const caminho of antigos) assert.equal(classificar([{ caminho, adicionadas: [] }]).alta, true, caminho);
});

const isento = caminho => casaAlgum(configuracao.ignorarCodigo, caminho);

test('isenção: o bundle reescrito, as fixtures do CAM LIVE, reservas e backup nas pastas novas', () => {
  const isentos = [
    'interface/dist/index-Dun7lr2S.patched.js', 'test/cam-live/fixtures/tiny.jpg', 'test/cam-live/fixtures/a.js',
    'iphone/modelo/reservas/20261127/a.js', 'interface/controle-do-celular/reservas/1/a.js', 'distribuicao/reservas/1/a.sh',
    'interface/traducao/backup-pt/a.js', 'iphone/idioma/backup-1/a.sh', 'distribuicao/backup-1/a.py',
  ];
  for (const caminho of isentos) assert.equal(isento(caminho), true, caminho);
});

test('isenção: o resto das pastas novas continua cobrado', () => {
  const cobrados = [
    'interface/controle-do-celular/iphone/aplicar-botao-iphone.py', 'interface/traducao/dist/a.js', 'interface/index-Dun7lr2S.patched.js',
    'test/cam-live/harness.js', 'test/cam-live/sub/fixtures/a.js', 'test/iphone/fixtures/a.js', 'test/iphone/reservas/a.js', 'iphone/camera/Tweak.x',
    'docs/guia/reservas/a.js', 'docs/pesquisas/backup-1/a.js', 'app/test/reservas/a.js', 'app/electron/services/iphone/reservas/a.js',
  ];
  for (const caminho of cobrados) assert.equal(isento(caminho), false, caminho);
});

test('isenção nas regras de linha: comentário novo passa nos lugares isentos e falha no resto', () => {
  const comentario = '// por que\n';
  const passam = ['interface/dist/index-Dun7lr2S.patched.js', 'test/cam-live/fixtures/a.js', 'iphone/modelo/reservas/1/a.js', 'interface/traducao/backup-pt/a.js', 'distribuicao/reservas/1/a.js'];
  const ok = tentar('sem-comentario-novo', Object.fromEntries(passam.map(caminho => [caminho, comentario])));
  assert.equal(ok.codigo, 0, ok.saida);
  const falham = ['interface/controle-do-celular/a.js', 'iphone/camera/a.js', 'test/cam-live/a.js', 'test/iphone/fixtures/a.js', 'interface/traducao/dist/a.js'];
  const ruim = tentar('sem-comentario-novo', Object.fromEntries(falham.map(caminho => [caminho, comentario])));
  assert.equal(ruim.codigo, 1, ruim.saida);
  for (const caminho of falham) assert.ok(ruim.saida.includes(caminho), ruim.saida);
});

test('isenção no tamanho em linhas: o bundle grande de interface/dist/ passa e o de outra pasta falha', () => {
  const grande = Array.from({ length: 1200 }, (_, i) => `const v${i} = ${i};`).join('\n') + '\n';
  const ok = tentar('limite-de-linhas', { 'interface/dist/index-Dun7lr2S.patched.js': grande, 'test/cam-live/fixtures/grande.js': grande });
  assert.equal(ok.codigo, 0, ok.saida);
  const ruim = tentar('limite-de-linhas', { 'interface/controle-do-celular/grande.js': grande });
  assert.equal(ruim.codigo, 1, ruim.saida);
});

test('isenção no ESLint: o bundle, as fixtures, reservas e backup das pastas novas não são cobrados', { skip: !temEslint }, () => {
  const sujo = 'const naoUsada = 1;\n';
  const ok = tentar('eslint-nas-linhas-novas', {
    'interface/dist/index-Dun7lr2S.patched.js': sujo, 'test/cam-live/fixtures/a.js': sujo, 'iphone/modelo/reservas/1/a.js': sujo,
    'interface/traducao/backup-pt/a.js': sujo, 'distribuicao/reservas/1/a.js': sujo,
  });
  assert.equal(ok.codigo, 0, ok.saida);
  const ruim = tentar('eslint-nas-linhas-novas', { 'interface/controle-do-celular/a.js': sujo, 'test/cam-live/a.js': sujo });
  assert.equal(ruim.codigo, 1, ruim.saida);
});

test('isenção na regra de binário: a cópia guardada em reservas das pastas novas passa', () => {
  const base = { 'app/a.js': 'const a = 1;\n' };
  const copia = 'const a = 1;\n';
  const ok = tentar('sem-binario-nem-lixo', {
    'iphone/modelo/reservas/20261127/a.js.antes-patch': copia, 'interface/controle-do-celular/reservas/1/b.js.antes-patch': copia, 'distribuicao/reservas/1/c.js.antes-patch': copia,
  }, base);
  assert.equal(ok.codigo, 0, ok.saida);
  const ruim = tentar('sem-binario-nem-lixo', { 'test/iphone/reservas/a.js.antes-patch': copia, 'docs/guia/reservas/b.js.antes-patch': copia }, base);
  assert.equal(ruim.codigo, 1, ruim.saida);
  for (const caminho of ['test/iphone/reservas/a.js.antes-patch', 'docs/guia/reservas/b.js.antes-patch']) assert.ok(ruim.saida.includes(caminho), ruim.saida);
});

test('licença de imprimir: iphone/, interface/ e distribuicao/ podem imprimir; o resto de fora do app não', () => {
  const imprime = 'console.log(1);\n';
  const ok = tentar('sem-depuracao-esquecida', { 'iphone/proxy/a.js': imprime, 'interface/controle-do-celular/a.js': imprime, 'distribuicao/a.js': imprime, 'test/a.js': imprime });
  assert.equal(ok.codigo, 0, ok.saida);
  const ruim = tentar('sem-depuracao-esquecida', { 'docs/guia/a.js': imprime, 'app/electron/a.js': imprime });
  assert.equal(ruim.codigo, 1, ruim.saida);
  for (const caminho of ['docs/guia/a.js', 'app/electron/a.js']) assert.ok(ruim.saida.includes(caminho), ruim.saida);
});

test('licença de imprimir: MAC/ continua podendo', () => {
  const r = tentar('sem-depuracao-esquecida', { 'MAC/integracao-iphone/a.js': 'console.log(1);\n' });
  assert.equal(r.codigo, 0, r.saida);
});
