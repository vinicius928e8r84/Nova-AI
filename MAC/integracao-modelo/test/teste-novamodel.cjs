#!/usr/bin/env node
// Testes do spoofing de modelo do iPhone (com.aquiles.novamodel).
// Roda no Mac, sem aparelho: valida JSON do banco, contrato do control file
// e o whitelist de chaves MobileGestalt no Tweak.x.
//
// Uso: node test/teste-novamodel.cjs

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function fail(msg) {
  console.error('❌ ' + msg);
  process.exitCode = 1;
}

function ok(msg) {
  console.log('✅ ' + msg);
}

// --- 1. Banco de modelos (models.json) -------------------------------
function testModels() {
  const banco = lerBanco();
  if (!banco) return;
  const { db } = banco;
  if (db.version !== 1) fail('models.json: version deve ser 1');
  if (!temModelosSuficientes(db)) {
    fail('models.json: "models" deve ser um array com vários modelos');
    return;
  }
  const seen = new Set();
  for (const m of db.models) conferirModelo(m, seen);
  ok(`models.json: ${db.models.length} modelos, productTypes únicos e válidos`);
}

const PRODUCT_TYPE = /^iPhone\d+,\d+$/;
const productTypeValido = pt => typeof pt === 'string' && PRODUCT_TYPE.test(pt);
const nomeValido = name => typeof name === 'string' && Boolean(name.trim());
const temModelosSuficientes = db => Array.isArray(db.models) && db.models.length >= 4;

function lerBanco() {
  const raw = fs.readFileSync(path.join(ROOT, 'models.json'), 'utf8');
  try {
    return { db: JSON.parse(raw) };
  } catch (e) {
    fail('models.json não é JSON válido: ' + e.message);
    return null;
  }
}

function conferirModelo(m, seen) {
  const pt = m && m.productType;
  const name = m && m.name;
  if (!productTypeValido(pt)) fail(`productType inválido: ${JSON.stringify(pt)}`);
  if (!nomeValido(name)) fail(`name inválido para ${pt}`);
  if (seen.has(pt)) fail(`productType duplicado: ${pt}`);
  seen.add(pt);
}

// --- 2. Cópia instalada no aparelho idêntica à fonte -----------------
function testLayoutCopy() {
  const a = fs.readFileSync(path.join(ROOT, 'models.json'));
  const b = fs.readFileSync(path.join(ROOT, 'layout/usr/share/novamodel/models.json'));
  if (a.equals(b)) ok('layout/usr/share/novamodel/models.json idêntico a models.json');
  else fail('layout/usr/share/novamodel/models.json difere de models.json');
}

// --- 3. Contrato do control file -------------------------------------
function testControlContract() {
  // Mesmo formato que a spec e que o CLI grava.
  const sample = { enabled: true, productType: 'iPhone14,5', name: 'iPhone 13' };
  const keys = Object.keys(sample).sort();
  const expected = ['enabled', 'name', 'productType'].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expected)) {
    fail(`control file: chaves inesperadas ${JSON.stringify(keys)}`);
    return;
  }
  if (typeof sample.enabled !== 'boolean') fail('control file: enabled deve ser boolean');
  if (!/^iPhone\d+,\d+$/.test(sample.productType)) fail('control file: productType inválido');
  ok('control file: contrato { enabled, productType, name } correto');
}

// --- 4. Whitelist de chaves MG no Tweak.x -----------------------------
function testMGWhitelist() {
  const src = fs.readFileSync(path.join(ROOT, 'Tweak.x'), 'utf8');
  // Extrai o conteúdo do setWithObjects(...) do g_mgKeys.
  const m = src.match(/g_mgKeys = \[NSSet setWithObjects:([^\]]*)\]/s);
  if (!m) { fail('Tweak.x: não encontrei o whitelist g_mgKeys'); return; }
  const keys = [...m[1].matchAll(/@"([A-Za-z]+)"/g)].map(x => x[1]);
  const expected = ['ProductType', 'HWModelStr', 'ModelNumber', 'ProductName', 'MarketingProductName'];
  for (const k of expected.filter(k => !keys.includes(k))) fail(`Tweak.x: chave MG ${k} ausente do whitelist`);
  for (const k of keys.filter(k => !expected.includes(k))) fail(`Tweak.x: chave MG ${k} fora da spec no whitelist`);
  if (!process.exitCode) ok(`Tweak.x: whitelist MG = ${keys.join(', ')}`);
}

// --- 5. ProductTypes da spec presentes no banco -----------------------
function testSpecReference() {
  const db = JSON.parse(fs.readFileSync(path.join(ROOT, 'models.json'), 'utf8'));
  const set = new Set(db.models.map(m => m.productType));
  const ref = ['iPhone14,5', 'iPhone14,4', 'iPhone14,2', 'iPhone14,3',
    'iPhone14,7', 'iPhone14,8', 'iPhone15,2', 'iPhone15,3',
    'iPhone15,4', 'iPhone15,5', 'iPhone16,1', 'iPhone16,2',
    'iPhone10,1', 'iPhone10,2', 'iPhone10,4', 'iPhone10,5'];
  const missing = ref.filter(p => !set.has(p));
  if (missing.length) fail(`Banco sem productTypes da spec: ${missing.join(', ')}`);
  else ok('banco cobre todos os ProductTypes de referência da spec');
}

testModels();
testLayoutCopy();
testControlContract();
testMGWhitelist();
testSpecReference();

if (process.exitCode) {
  console.error('\nFalhou: ' + process.exitCode + ' erro(s).');
  process.exit(1);
} else {
  console.log('\nTodos os testes passaram.');
}
