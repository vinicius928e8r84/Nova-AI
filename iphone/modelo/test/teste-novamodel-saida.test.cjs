'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PASTA = path.join(__dirname, '..');
const SCRIPT = path.join(__dirname, 'teste-novamodel.cjs');
const TWEAK_CERTO = 'chavesDoMobileGestalt = [NSSet setWithObjects:@"ProductType", @"HWModelStr", @"ModelNumber", @"ProductName", @"MarketingProductName", nil];';
const REFERENCIA = ['iPhone14,5', 'iPhone14,4', 'iPhone14,2', 'iPhone14,3', 'iPhone14,7', 'iPhone14,8', 'iPhone15,2', 'iPhone15,3',
  'iPhone15,4', 'iPhone15,5', 'iPhone16,1', 'iPhone16,2', 'iPhone10,1', 'iPhone10,2', 'iPhone10,4', 'iPhone10,5'];
const BANCO_CERTO = JSON.stringify({ version: 1, models: REFERENCIA.map((productType, i) => ({ productType, name: `Modelo ${i}` })) });

function rodarEm({ banco = BANCO_CERTO, copia = banco, tweak = TWEAK_CERTO }) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'novamodel-'));
  const escrever = (relativo, texto) => {
    fs.mkdirSync(path.dirname(path.join(raiz, relativo)), { recursive: true });
    fs.writeFileSync(path.join(raiz, relativo), texto);
  };
  escrever('test/teste-novamodel.cjs', fs.readFileSync(SCRIPT));
  escrever('models.json', banco);
  escrever('layout/usr/share/novamodel/models.json', copia);
  escrever('GanchosMobileGestalt.m', tweak);
  const r = spawnSync(process.execPath, [path.join(raiz, 'test', 'teste-novamodel.cjs')], { encoding: 'utf8' });
  fs.rmSync(raiz, { recursive: true, force: true });
  return { codigo: r.status, saida: r.stdout.split('\n'), erros: r.stderr.split('\n').filter((linha) => !linha.startsWith('    at ')) };
}

test('o banco de verdade da pasta passa inteiro', () => {
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', cwd: PASTA });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(r.stderr, '');
  assert.match(r.stdout, /\nTodos os testes passaram\.\n$/);
});

test('tudo certo: cinco ✅ e a linha final', () => {
  assert.deepStrictEqual(rodarEm({}), {
    codigo: 0,
    saida: [
      '✅ models.json: 16 modelos, productTypes únicos e válidos',
      '✅ layout/usr/share/novamodel/models.json idêntico a models.json',
      '✅ control file: contrato { enabled, productType, name } correto',
      '✅ GanchosMobileGestalt.m: whitelist MG = ProductType, HWModelStr, ModelNumber, ProductName, MarketingProductName',
      '✅ banco cobre todos os ProductTypes de referência da spec',
      '', 'Todos os testes passaram.', '',
    ],
    erros: [''],
  });
});

test('modelos ruins: cada problema na ordem, versão errada e cópia diferente', () => {
  const modelos = [
    ...REFERENCIA.map((productType) => ({ productType, name: 'ok' })),
    0, '', { productType: 'iPad8,1', name: '  ' }, { productType: 'iPhone14,5', name: 7 }, { name: 'sem tipo' },
  ];
  const banco = JSON.stringify({ version: 2, models: modelos });
  assert.deepStrictEqual(rodarEm({ banco, copia: `${banco}\n` }), {
    codigo: 1,
    saida: [
      '✅ models.json: 21 modelos, productTypes únicos e válidos',
      '✅ control file: contrato { enabled, productType, name } correto',
      '✅ banco cobre todos os ProductTypes de referência da spec', '',
    ],
    erros: [
      '❌ models.json: version deve ser 1',
      '❌ productType inválido: 0', '❌ name inválido para 0',
      '❌ productType inválido: ""', '❌ name inválido para ',
      '❌ productType inválido: "iPad8,1"', '❌ name inválido para iPad8,1',
      '❌ name inválido para iPhone14,5', '❌ productType duplicado: iPhone14,5',
      '❌ productType inválido: undefined',
      '❌ layout/usr/share/novamodel/models.json difere de models.json',
      '', 'Falhou: 1 erro(s).', '',
    ],
  });
});

test('banco que não é JSON, sem models ou curto para no primeiro teste e quebra no último', () => {
  for (const [banco, mensagem] of [
    ['{', '❌ models.json não é JSON válido: '],
    ['{"version":1}', '❌ models.json: "models" deve ser um array com vários modelos'],
    ['{"version":1,"models":[1,2,3]}', '❌ models.json: "models" deve ser um array com vários modelos'],
  ]) {
    const r = rodarEm({ banco });
    assert.strictEqual(r.codigo, 1, banco);
    assert.ok(r.erros[0].startsWith(mensagem), r.erros[0]);
    assert.ok(!r.saida.some((linha) => linha.includes('models.json:')), banco);
    assert.ok(!r.saida.includes('Todos os testes passaram.'), banco);
  }
  const quatro = JSON.stringify({ version: 1, models: REFERENCIA.slice(0, 4).map((productType) => ({ productType, name: 'x' })) });
  assert.strictEqual(rodarEm({ banco: quatro }).saida[0], '✅ models.json: 4 modelos, productTypes únicos e válidos');
});

test('JSON null derruba o script antes de qualquer linha', () => {
  const r = rodarEm({ banco: 'null' });
  assert.strictEqual(r.codigo, 1);
  assert.deepStrictEqual(r.saida, ['']);
  assert.ok(r.erros.some((linha) => linha.startsWith("TypeError: Cannot read properties of null (reading 'version')")), r.erros.join('\n'));
});

test('GanchosMobileGestalt.m sem whitelist, com chave faltando e com chave a mais; spec incompleta', () => {
  const semWhitelist = rodarEm({ tweak: 'nada aqui' });
  assert.ok(semWhitelist.erros.includes('❌ GanchosMobileGestalt.m: não encontrei o whitelist chavesDoMobileGestalt'));
  const tweak = 'chavesDoMobileGestalt = [NSSet setWithObjects:@"Extra", @"ProductType", @"ModelNumber", @"Outra", @"ProductName", nil];';
  const banco = JSON.stringify({ version: 1, models: REFERENCIA.slice(2).map((productType) => ({ productType, name: 'x' })) });
  const r = rodarEm({ tweak, banco });
  assert.deepStrictEqual(r.erros, [
    '❌ GanchosMobileGestalt.m: chave MG HWModelStr ausente do whitelist',
    '❌ GanchosMobileGestalt.m: chave MG MarketingProductName ausente do whitelist',
    '❌ GanchosMobileGestalt.m: chave MG Extra fora da spec no whitelist',
    '❌ GanchosMobileGestalt.m: chave MG Outra fora da spec no whitelist',
    '❌ Banco sem productTypes da spec: iPhone14,5, iPhone14,4',
    '', 'Falhou: 1 erro(s).', '',
  ]);
  assert.ok(!r.saida.some((linha) => linha.startsWith('✅ GanchosMobileGestalt.m')));
});
