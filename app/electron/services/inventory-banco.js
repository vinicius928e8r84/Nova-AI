'use strict';

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const isDev = !app.isPackaged && process.env.NODE_ENV !== 'production';
const devVaultPath = path.join(app.getAppPath(), 'Nova_Vault');
const prodVaultPath = path.join(app.getPath('documents'), 'Nova_Vault');

const VAULT_DIR = (isDev && fs.existsSync(devVaultPath)) ? devVaultPath : prodVaultPath;
const INVENTORY_DIR = path.join(VAULT_DIR, 'inventory');
const IMAGES_DIR = path.join(INVENTORY_DIR, 'product_images');
const DB_PATH = path.join(INVENTORY_DIR, 'inventory.db');

const TABELAS_ANTES_DOS_ACESSOS = [`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                role TEXT UNIQUE CHECK(role IN ('owner', 'cashier')),
                pin_hash TEXT NOT NULL
            );
        `];

const TABELAS_DEPOIS_DOS_ACESSOS = [`
            CREATE TABLE IF NOT EXISTS categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                description TEXT,
                template_json TEXT DEFAULT '{}'
            );
        `, `
            CREATE TABLE IF NOT EXISTS products (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sku TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
                quantity INTEGER DEFAULT 0,
                min_stock_alert INTEGER DEFAULT 5,
                cost_price REAL NOT NULL,
                sell_price REAL NOT NULL,
                image_path TEXT,
                custom_attributes TEXT DEFAULT '{}',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `, `
            CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type TEXT CHECK(type IN ('IN', 'OUT')),
                total_amount REAL NOT NULL,
                payment_method TEXT CHECK(payment_method IN ('Cash', 'Card', 'Mobile')),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `, `
            CREATE TABLE IF NOT EXISTS transaction_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                transaction_id INTEGER REFERENCES transactions(id) ON DELETE CASCADE,
                product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
                quantity INTEGER NOT NULL,
                price REAL NOT NULL
            );
        `, `
            CREATE TABLE IF NOT EXISTS stock_movements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
                change_qty INTEGER NOT NULL,
                reason TEXT NOT NULL,
                user_role TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `, `
            CREATE TABLE IF NOT EXISTS ledger (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type TEXT CHECK(type IN ('REVENUE', 'EXPENSE')),
                amount REAL NOT NULL,
                category TEXT NOT NULL,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `, `
            CREATE TABLE IF NOT EXISTS shop_profile (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                type TEXT NOT NULL,
                details TEXT,
                contact TEXT
            );
        `, `
            CREATE TABLE IF NOT EXISTS inventory_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        `, `
            CREATE TABLE IF NOT EXISTS khata_customers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                phone TEXT,
                balance REAL DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `, `
            CREATE TABLE IF NOT EXISTS khata_transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                customer_id INTEGER REFERENCES khata_customers(id) ON DELETE CASCADE,
                type TEXT CHECK(type IN ('GIVE', 'GET')),
                amount REAL NOT NULL,
                notes TEXT,
                date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `];

const VENDAS_SEM_RESTRICAO_DE_PAGAMENTO = `
                        CREATE TABLE transactions (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            type TEXT CHECK(type IN ('IN', 'OUT')),
                            total_amount REAL NOT NULL,
                            payment_method TEXT,
                            customer_id INTEGER REFERENCES khata_customers(id) ON DELETE SET NULL,
                            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                        );
                    `;

const COPIAR_VENDAS_COM_CLIENTE = `
                            INSERT INTO transactions (id, type, total_amount, payment_method, customer_id, created_at)
                            SELECT id, type, total_amount, payment_method, customer_id, created_at FROM transactions_old;
                        `;

const COPIAR_VENDAS_SEM_CLIENTE = `
                            INSERT INTO transactions (id, type, total_amount, payment_method, customer_id, created_at)
                            SELECT id, type, total_amount, payment_method, NULL, created_at FROM transactions_old;
                        `;

const ITENS_DA_VENDA = `
                        CREATE TABLE transaction_items (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            transaction_id INTEGER REFERENCES transactions(id) ON DELETE CASCADE,
                            product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
                            quantity INTEGER NOT NULL,
                            price REAL NOT NULL
                        );
                    `;

const COPIAR_ITENS_DA_VENDA = `
                        INSERT INTO transaction_items (id, transaction_id, product_id, quantity, price)
                        SELECT id, transaction_id, product_id, quantity, price FROM transaction_items_old;
                    `;

function inserirAcessosPadrao(db, hashPIN) {
    const userCount = db.prepare('SELECT count(*) as count FROM users').get();
    if (userCount.count !== 0) return;
    db.prepare('INSERT INTO users (role, pin_hash) VALUES (?, ?)')
        .run('owner', hashPIN('1234'));
    db.prepare('INSERT INTO users (role, pin_hash) VALUES (?, ?)')
        .run('cashier', hashPIN('0000'));
    console.info('[Inventory] Inserted default credentials (Owner: 1234, Cashier: 0000).');
}

const temColuna = (db, tabela, coluna) => db.pragma(`table_info(${tabela})`).some(col => col.name === coluna);

function acrescentarClienteNasVendas(db) {
    try {
        if (!temColuna(db, 'transactions', 'customer_id')) {
            console.info('[Migration] Adding customer_id column to transactions table...');
            db.exec("ALTER TABLE transactions ADD COLUMN customer_id INTEGER REFERENCES khata_customers(id) ON DELETE SET NULL;");
        }
    } catch (e) {
        console.error('[Migration] Failed to add customer_id column:', e.message);
    }
}

function vendasAceitamFiado(db) {
    try {
        db.prepare("INSERT INTO transactions (type, total_amount, payment_method) VALUES ('OUT', 0, 'Credit')").run();
        db.exec("DELETE FROM transactions WHERE total_amount = 0 AND payment_method = 'Credit'");
        return true;
    } catch (e) {
        return false;
    }
}

function recriarTabela(db, antiga, recriar) {
    db.transaction(() => {
        db.exec("PRAGMA foreign_keys=OFF;");
        db.exec(`ALTER TABLE ${antiga} RENAME TO ${antiga}_old;`);
        recriar();
        db.exec(`DROP TABLE ${antiga}_old;`);
        db.exec("PRAGMA foreign_keys=ON;");
    })();
}

function recriarVendasSemRestricao(db) {
    db.exec(VENDAS_SEM_RESTRICAO_DE_PAGAMENTO);
    db.exec(temColuna(db, 'transactions_old', 'customer_id') ? COPIAR_VENDAS_COM_CLIENTE : COPIAR_VENDAS_SEM_CLIENTE);
}

function liberarFiadoNasVendas(db) {
    if (vendasAceitamFiado(db)) return;
    console.info('[Migration] Migrating transactions table to drop payment_method check constraint...');
    try {
        recriarTabela(db, 'transactions', () => recriarVendasSemRestricao(db));
        console.info('[Migration] transactions table migrated successfully.');
    } catch (migrationError) {
        console.error('[Migration] Critical failure migrating transactions table:', migrationError.message);
    }
}

function corrigirItensDaVenda(db) {
    try {
        const tableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='transaction_items'").get();
        if (!tableSql || !tableSql.sql.includes('transactions_old')) return;
        console.info('[Migration] Migrating transaction_items table to fix transactions_old reference...');
        recriarTabela(db, 'transaction_items', () => {
            db.exec(ITENS_DA_VENDA);
            db.exec(COPIAR_ITENS_DA_VENDA);
        });
        console.info('[Migration] transaction_items table migrated successfully.');
    } catch (e) {
        console.error('[Migration] Failed to migrate transaction_items table:', e.message);
    }
}

function criarTabelas(db, hashPIN) {
    for (const sql of TABELAS_ANTES_DOS_ACESSOS) db.exec(sql);
    inserirAcessosPadrao(db, hashPIN);
    for (const sql of TABELAS_DEPOIS_DOS_ACESSOS) db.exec(sql);
    acrescentarClienteNasVendas(db);
    liberarFiadoNasVendas(db);
    corrigirItensDaVenda(db);
}

module.exports = { VAULT_DIR, INVENTORY_DIR, IMAGES_DIR, DB_PATH, criarTabelas };
