'use strict';

const path = require('path');
const fs = require('fs');
const { VAULT_DIR, IMAGES_DIR } = require('./inventory-banco');
const { avisarSeFalhar, copiarUltimoMovimento, copiarLancamentoDeReposicao, sincronizar } = require('./inventory-nuvem');

const SEM_CATEGORIA = new Set(['', null, undefined, '0', 0]);

const PUXAR_CATEGORIAS = {
    consulta: supabase => supabase.from('categories').select('*'),
    sql: `
                            INSERT OR REPLACE INTO categories (id, name, description, template_json)
                            VALUES (?, ?, ?, ?)
                        `,
    valores: c => [
        c.id,
        c.name,
        c.description,
        typeof c.template_json === 'string' ? c.template_json : JSON.stringify(c.template_json || c.template || {})
    ],
};

const PUXAR_PRODUTOS = {
    consulta: supabase => supabase
        .from('products')
        .select('*'),
    sql: `
                            INSERT OR REPLACE INTO products (id, sku, name, category_id, quantity, min_stock_alert, cost_price, sell_price, image_path, custom_attributes, created_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `,
    valores: p => [
        p.id,
        p.sku,
        p.name,
        p.category_id,
        p.quantity,
        p.min_stock_alert,
        p.cost_price,
        p.sell_price,
        p.image_path,
        typeof p.custom_attributes === 'string' ? p.custom_attributes : JSON.stringify(p.custom_attributes || {}),
        p.created_at
    ],
};

const COLUNAS_DO_PRODUTO = `
                    SELECT p.id, p.sku, p.name, p.category_id, p.quantity, 
                           p.min_stock_alert as minStockAlert, 
                           p.cost_price as costPrice, 
                           p.sell_price as sellPrice, 
                           p.image_path, p.custom_attributes, p.created_at, `;

const LISTA_DE_PRODUTOS = COLUNAS_DO_PRODUTO + `
                           c.name as category_name 
                    FROM products p 
                    LEFT JOIN categories c ON p.category_id = c.id
                `;

const BUSCA_DE_PRODUTOS = COLUNAS_DO_PRODUTO + `
                           c.name as category_name
                    FROM products p
                    LEFT JOIN categories c ON p.category_id = c.id
                    WHERE `;

const NOVO_PRODUTO = `
                        INSERT INTO products (sku, name, category_id, quantity, min_stock_alert, cost_price, sell_price, image_path, custom_attributes)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `;

const NOVO_MOVIMENTO = `
                            INSERT INTO stock_movements (product_id, change_qty, reason, user_role)
                            VALUES (?, ?, ?, ?)
                        `;

const NOVO_LANCAMENTO = `
                            INSERT INTO ledger (type, amount, category, notes)
                            VALUES (?, ?, ?, ?)
                        `;

const PRODUTO_DO_DONO = `
                            UPDATE products 
                            SET sku = ?, name = ?, category_id = ?, quantity = ?, min_stock_alert = ?, cost_price = ?, sell_price = ?, image_path = ?, custom_attributes = ?
                            WHERE id = ?
                        `;

const categoriaDoBanco = categoryId => (SEM_CATEGORIA.has(categoryId) ? null : Number(categoryId));
const valorOuAtual = (novo, atual) => (novo !== undefined ? novo : atual);
const notasDaReposicao = (nome, unidades) => `Restock for ${nome} (${unidades} units)`;

function gravarImagem(imageBase64, sku) {
    const ext = imageBase64.substring("data:image/".length, imageBase64.indexOf(";base64"));
    const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, "");
    const filename = `img_${sku}_${Date.now()}.${ext}`;
    const fullPath = path.join(IMAGES_DIR, filename);
    fs.writeFileSync(fullPath, Buffer.from(cleanBase64, 'base64'));
    return path.relative(VAULT_DIR, fullPath).replace(/\\/g, '/');
}

function apagarImagem(relativo) {
    const fullPath = path.join(VAULT_DIR, relativo);
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
}

async function obterCategorias(gerente) {
    await sincronizar(gerente, [PUXAR_CATEGORIAS], '[Inventory Sync] Category sync failed:');
    return gerente.tentar(() => {
        const categories = gerente.db.prepare('SELECT * FROM categories').all();
        return { success: true, categories };
    });
}

async function adicionarCategoria(gerente, { name, description, template }) {
    return gerente.tentar(() => {
        const templateStr = JSON.stringify(template || {});
        const res = gerente.db.prepare('INSERT INTO categories (name, description, template_json) VALUES (?, ?, ?)')
            .run(name, description, templateStr);
        const catId = res.lastInsertRowid;
        if (gerente.supabase) {
            avisarSeFalhar(gerente.supabase.from('categories').insert({
                id: catId,
                name,
                description,
                template_json: template || {}
            }), '[Inventory Sync] Category insert sync failed:');
        }
        return { success: true, id: catId };
    });
}

async function apagarCategoria(gerente, id) {
    return gerente.tentar(() => {
        gerente.db.prepare('DELETE FROM categories WHERE id = ?').run(id);
        if (gerente.supabase) {
            avisarSeFalhar(gerente.supabase.from('categories').delete().eq('id', id), '[Inventory Sync] Category delete sync failed:');
        }
        return { success: true };
    });
}

async function obterProdutos(gerente) {
    await sincronizar(gerente, [PUXAR_PRODUTOS], '[Inventory Sync] Product sync failed:');
    return gerente.tentar(() => {
        const products = gerente.db.prepare(LISTA_DE_PRODUTOS).all();
        return { success: true, products };
    });
}

function registrarEstoqueInicial(db, productId, produto) {
    const { name, quantity, costPrice } = produto;
    db.prepare(NOVO_MOVIMENTO).run(productId, quantity, 'RESTOCK', 'owner');
    const totalCost = costPrice * quantity;
    db.prepare(NOVO_LANCAMENTO).run('EXPENSE', totalCost, 'Inventory Restock', `Initial stock for ${name} (${quantity} units)`);
}

function inserirProduto(db, produto, { dbCategoryId, imagePath }) {
    const { sku, name, quantity, minStockAlert, costPrice, sellPrice, customAttributes } = produto;
    const insertRes = db.prepare(NOVO_PRODUTO)
        .run(sku, name, dbCategoryId, quantity, minStockAlert, costPrice, sellPrice, imagePath, JSON.stringify(customAttributes || {}));
    const productId = insertRes.lastInsertRowid;
    if (quantity > 0) registrarEstoqueInicial(db, productId, produto);
    return productId;
}

function espelharProdutoNovo(gerente, prodId, produto, { dbCategoryId, imagePath }) {
    const { sku, name, quantity, minStockAlert, costPrice, sellPrice, customAttributes } = produto;
    avisarSeFalhar(gerente.supabase.from('products').insert({
        id: prodId,
        sku,
        name,
        category_id: dbCategoryId,
        quantity,
        min_stock_alert: minStockAlert,
        cost_price: costPrice,
        sell_price: sellPrice,
        image_path: imagePath,
        custom_attributes: customAttributes || {}
    }), '[Inventory Sync] Product insert sync failed:');
    if (quantity > 0) {
        copiarUltimoMovimento(gerente, prodId, '[Inventory Sync] Stock movement sync failed:');
        copiarLancamentoDeReposicao(gerente, `Initial stock for ${name} (${quantity} units)`, '[Inventory Sync] Ledger restock sync failed:');
    }
}

async function adicionarProduto(gerente, productData) {
    const { sku, categoryId, imageBase64 } = productData;
    return gerente.tentar(() => {
        const dbCategoryId = categoriaDoBanco(categoryId);
        const gravado = { dbCategoryId, imagePath: imageBase64 ? gravarImagem(imageBase64, sku) : null };
        const transaction = gerente.db.transaction(() => inserirProduto(gerente.db, productData, gravado));
        const prodId = transaction();
        if (gerente.supabase) espelharProdutoNovo(gerente, prodId, productData, gravado);
        gerente.agendarBackup();
        return { success: true, id: prodId };
    });
}

function trocarImagem(current, data) {
    if (!data.imageBase64) return current.image_path;
    if (current.image_path) apagarImagem(current.image_path);
    return gravarImagem(data.imageBase64, data.sku || current.sku);
}

function ajustarEstoqueNoCaixa(db, { id, current, data }) {
    db.prepare(`
                            UPDATE products SET quantity = ? WHERE id = ?
                        `).run(data.quantity, id);
    const qtyDiff = data.quantity - current.quantity;
    if (qtyDiff !== 0) db.prepare(NOVO_MOVIMENTO).run(id, qtyDiff, qtyDiff > 0 ? 'RETURN' : 'ADJUSTMENT', 'cashier');
}

function registrarMudancaDoDono(db, { id, current, data }, qtyDiff) {
    db.prepare(NOVO_MOVIMENTO).run(id, qtyDiff, qtyDiff > 0 ? 'RESTOCK' : 'DAMAGE_WRITE_OFF', 'owner');
    if (qtyDiff > 0) {
        const addCost = (data.costPrice || current.cost_price) * qtyDiff;
        db.prepare(NOVO_LANCAMENTO).run('EXPENSE', addCost, 'Inventory Restock', notasDaReposicao(data.name || current.name, qtyDiff));
    }
}

function atualizarComoDono(db, mudanca, imagePath) {
    const { id, current, data } = mudanca;
    const dbCategoryId = data.categoryId !== undefined ? categoriaDoBanco(data.categoryId) : current.category_id;
    db.prepare(PRODUTO_DO_DONO).run(
        data.sku || current.sku,
        data.name || current.name,
        dbCategoryId,
        valorOuAtual(data.quantity, current.quantity),
        valorOuAtual(data.minStockAlert, current.min_stock_alert),
        valorOuAtual(data.costPrice, current.cost_price),
        valorOuAtual(data.sellPrice, current.sell_price),
        imagePath,
        data.customAttributes ? JSON.stringify(data.customAttributes) : current.custom_attributes,
        id
    );
    const qtyDiff = valorOuAtual(data.quantity, current.quantity) - current.quantity;
    if (qtyDiff !== 0) registrarMudancaDoDono(db, mudanca, qtyDiff);
}

function gravarAtualizacao(db, { id, data, role }, current) {
    const imagePath = trocarImagem(current, data);
    const mudanca = { id, current, data };
    if (role === 'cashier') return ajustarEstoqueNoCaixa(db, mudanca);
    return atualizarComoDono(db, mudanca, imagePath);
}

function espelharProdutoAtualizado(gerente, id) {
    const updated = gerente.db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    if (!updated) return;
    avisarSeFalhar(gerente.supabase.from('products').update({
        sku: updated.sku,
        name: updated.name,
        category_id: updated.category_id,
        quantity: updated.quantity,
        min_stock_alert: updated.min_stock_alert,
        cost_price: updated.cost_price,
        sell_price: updated.sell_price,
        image_path: updated.image_path,
        custom_attributes: JSON.parse(updated.custom_attributes || '{}')
    }).eq('id', id), '[Inventory Sync] Product update sync failed:');
}

function espelharAtualizacao(gerente, id, current, data) {
    espelharProdutoAtualizado(gerente, id);
    const qtyDiff = valorOuAtual(data.quantity, current.quantity) - current.quantity;
    if (qtyDiff === 0) return;
    copiarUltimoMovimento(gerente, id, '[Inventory Sync] Stock movement update sync failed:');
    if (qtyDiff > 0) {
        copiarLancamentoDeReposicao(gerente, notasDaReposicao(data.name || current.name, qtyDiff), '[Inventory Sync] Ledger restock update sync failed:');
    }
}

async function atualizarProduto(gerente, { id, data, role }) {
    return gerente.tentar(() => {
        const current = gerente.db.prepare('SELECT * FROM products WHERE id = ?').get(id);
        if (!current) return { success: false, error: 'Product not found' };
        const transaction = gerente.db.transaction(() => gravarAtualizacao(gerente.db, { id, data, role }, current));
        transaction();
        if (gerente.supabase) espelharAtualizacao(gerente, id, current, data);
        gerente.checkLowStockAlert(id);
        gerente.agendarBackup();
        return { success: true };
    });
}

async function apagarProduto(gerente, id) {
    return gerente.tentar(() => {
        const current = gerente.db.prepare('SELECT image_path FROM products WHERE id = ?').get(id);
        if (current && current.image_path) apagarImagem(current.image_path);
        gerente.db.prepare('DELETE FROM products WHERE id = ?').run(id);
        if (gerente.supabase) {
            avisarSeFalhar(gerente.supabase.from('products').delete().eq('id', id), '[Inventory Sync] Product delete sync failed:');
        }
        return { success: true };
    });
}

function divergenciaDaContagem(db, item) {
    const prod = db.prepare('SELECT name, quantity, sku FROM products WHERE id = ?').get(item.productId);
    if (!prod) return null;
    const diff = item.count - prod.quantity;
    if (diff === 0) return null;
    return {
        productId: item.productId,
        sku: prod.sku,
        name: prod.name,
        expected: prod.quantity,
        counted: item.count,
        difference: diff
    };
}

async function conferirContagem(gerente, counts) {
    return gerente.tentar(() => {
        const discrepancies = [];
        for (const item of counts) {
            const divergencia = divergenciaDaContagem(gerente.db, item);
            if (divergencia) discrepancies.push(divergencia);
        }
        return { success: true, discrepancies };
    });
}

const soLetrasENumeros = texto => String(texto).toLowerCase().replace(/[^a-z0-9]/g, '');

function paresDeLetras(texto) {
    const bigrams = new Set();
    for (let i = 0; i < texto.length - 1; i++) {
        bigrams.add(texto.slice(i, i + 2));
    }
    return bigrams;
}

function semelhanca(str1, str2) {
    const s1 = soLetrasENumeros(str1);
    const s2 = soLetrasENumeros(str2);
    if (s1 === s2) return 1.0;
    if (s1.length < 2 || s2.length < 2) return 0.0;
    const b1 = paresDeLetras(s1);
    const b2 = paresDeLetras(s2);
    const intersection = [...b1].filter(bigram => b2.has(bigram)).length;
    return (2.0 * intersection) / (b1.size + b2.size);
}

function candidatosDaBusca(db, words) {
    const conditions = [];
    const params = [];
    for (const word of words) {
        conditions.push('p.name LIKE ? OR p.sku LIKE ? OR p.custom_attributes LIKE ?');
        const pTerm = `%${word}%`;
        params.push(pTerm, pTerm, pTerm);
    }
    return db.prepare(BUSCA_DE_PRODUTOS + `${conditions.join(' OR ')}
                `).all(...params);
}

function ordenarPorSemelhanca(query, candidates) {
    const scoredProducts = candidates.map(p => {
        const nameSim = semelhanca(query, p.name);
        const skuSim = semelhanca(query, p.sku);
        return { ...p, similarity: Math.max(nameSim, skuSim) };
    });
    scoredProducts.sort((a, b) => b.similarity - a.similarity);
    return scoredProducts.filter(p => p.similarity > 0.1).slice(0, 5);
}

function buscarParecidos(gerente, query) {
    const words = String(query).trim().split(/\s+/).filter(w => w.length > 1);
    if (words.length === 0) return { success: true, products: [] };
    const products = ordenarPorSemelhanca(query, candidatosDaBusca(gerente.db, words));
    console.info(`[Inventory] fuzzy-query found ${products.length} ranked results.`);
    return { success: true, products };
}

async function buscaAproximada(gerente, query) {
    console.info('[Inventory] fuzzy-query received query:', query);
    try {
        return buscarParecidos(gerente, query);
    } catch (err) {
        console.error('[Inventory] fuzzy-query error:', err.message);
        return { success: false, error: err.message };
    }
}

module.exports = {
    obterCategorias,
    adicionarCategoria,
    apagarCategoria,
    obterProdutos,
    adicionarProduto,
    atualizarProduto,
    apagarProduto,
    conferirContagem,
    buscaAproximada,
};
