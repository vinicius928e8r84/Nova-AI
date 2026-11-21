'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const navegador = require('./browser-manager.palco');
const estoque = require('./inventory-manager.palco');

const TEMPORARIA = 'C:\\Users\\nova\\AppData\\Local\\Temp';
const APP_NO_WINDOWS = 'C:\\Nova\\app';
const comBarraInvertidaDupla = texto => JSON.stringify(texto).slice(1, -1);

test('browser-manager: diário com separador do Windows sai com a barra gravada', () => {
  const raiz = TEMPORARIA + '\\navegador-abc';
  const normalizar = navegador.normalizador([[APP_NO_WINDOWS, '<app>'], [raiz, '<raiz>']], '\\');
  const diario = normalizar([
    'Downloads em "' + raiz + '\\downloads"',
    { pasta: raiz + '\\userData\\browser-data', navegadores: APP_NO_WINDOWS + '\\browsers' },
    '{"arquivo":"' + comBarraInvertidaDupla(raiz + '\\downloads\\page-1.pdf') + '"}',
  ]);
  assert.deepStrictEqual(diario, [
    'Downloads em "<raiz>/downloads"',
    { pasta: '<raiz>/userData/browser-data', navegadores: '<app>/browsers' },
    '{"arquivo":"<raiz>/downloads/page-1.pdf"}',
  ]);
});

test('inventory-manager: diário com separador do Windows sai com a barra gravada', () => {
  const raiz = TEMPORARIA + "\\invent'ario-abc";
  const banco = raiz + '\\documents\\Nova_Vault\\inventory\\inventory.db';
  const diario = estoque.normalizar(['db.abrir', banco, "VACUUM INTO '" + banco.replace(/'/g, "''") + "'"], raiz, '\\');
  assert.deepStrictEqual(diario, [
    'db.abrir',
    '<raiz>/documents/Nova_Vault/inventory/inventory.db',
    "VACUUM INTO '<raiz>/documents/Nova_Vault/inventory/inventory.db'",
  ]);
});

test('lista de arquivos com separador do Windows sai com a barra gravada', () => {
  const raiz = TEMPORARIA + '\\inventario-abc';
  const imagem = raiz + '\\documents\\Nova_Vault\\inventory\\product_images\\foto.png';
  assert.strictEqual(navegador.relativoEmPosix(raiz, imagem, path.win32), 'documents/Nova_Vault/inventory/product_images/foto.png');
  assert.strictEqual(estoque.relativoEmPosix(raiz, imagem, path.win32), 'documents/Nova_Vault/inventory/product_images/foto.png');
});
