/**
 * Nova Inventory Manager Service (Backend)
 * Handles local SQLite database CRUD, Double-Entry Audit Logs, 
 * Role-Based Access controls, and Backup operations.
 */

'use strict';

const { app, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');

const isDev = !app.isPackaged && process.env.NODE_ENV !== 'production';
const devVaultPath = path.join(app.getAppPath(), 'Nova_Vault');
const prodVaultPath = path.join(app.getPath('documents'), 'Nova_Vault');

// Use project root directory in development if it exists, otherwise use Documents directory for production safety
const VAULT_DIR = (isDev && fs.existsSync(devVaultPath)) ? devVaultPath : prodVaultPath;
const INVENTORY_DIR = path.join(VAULT_DIR, 'inventory');
const IMAGES_DIR = path.join(INVENTORY_DIR, 'product_images');
const DB_PATH = path.join(INVENTORY_DIR, 'inventory.db');

class InventoryManager {
    constructor() {
        this.db = null;
        this.supabase = null;
    }

    init(getWhatsAppManager) {
        console.log('[Inventory] Initializing Nova Inventory Vault...');
        this.getWhatsAppManager = getWhatsAppManager;
        
        // Ensure directories exist
        if (!fs.existsSync(VAULT_DIR)) fs.mkdirSync(VAULT_DIR, { recursive: true });
        if (!fs.existsSync(INVENTORY_DIR)) fs.mkdirSync(INVENTORY_DIR, { recursive: true });
        if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });

        try {
            this.db = new Database(DB_PATH);
            this.db.pragma('journal_mode = WAL');
            this.createTables();
            this.initSupabase();
            this.registerIPCHandlers();
            console.log('[Inventory] Database initialized successfully.');
        } catch (err) {
            console.error('[Inventory] Database initialization failed:', err);
        }
    }

    initSupabase() {
        try {
            const urlRow = this.db.prepare("SELECT value FROM inventory_settings WHERE key = 'supabase_url'").get();
            const keyRow = this.db.prepare("SELECT value FROM inventory_settings WHERE key = 'supabase_key'").get();
            
            if (!urlRow || !keyRow || !urlRow.value || !keyRow.value) {
                console.log('[Inventory] Supabase cloud is not configured.');
                this.supabase = null;
                return false;
            }

            const self = this;
            const sqliteStorage = {
                getItem: (key) => {
                    try {
                        const row = self.db.prepare('SELECT value FROM inventory_settings WHERE key = ?').get(key);
                        return row ? row.value : null;
                    } catch (e) {
                        return null;
                    }
                },
                setItem: (key, value) => {
                    try {
                        self.db.prepare('INSERT OR REPLACE INTO inventory_settings (key, value) VALUES (?, ?)')
                            .run(key, value);
                    } catch (e) {}
                },
                removeItem: (key) => {
                    try {
                        self.db.prepare('DELETE FROM inventory_settings WHERE key = ?').run(key);
                    } catch (e) {}
                }
            };

            this.supabase = createClient(urlRow.value, keyRow.value, {
                auth: {
                    storage: sqliteStorage,
                    autoRefreshToken: true,
                    persistSession: true,
                    detectSessionInUrl: false
                },
                realtime: {
                    transport: ws
                }
            });
            console.log('[Inventory] Supabase client initialized successfully.');
            return true;
        } catch (err) {
            console.error('[Inventory] Supabase initialization failed:', err.message);
            this.supabase = null;
            return false;
        }
    }

    hashPIN(pin) {
        return crypto.createHash('sha256').update(String(pin)).digest('hex');
    }

    checkLowStockAlert(productId) {
        try {
            const product = this.db.prepare('SELECT name, sku, quantity, min_stock_alert FROM products WHERE id = ?').get(productId);
            if (product && product.quantity <= product.min_stock_alert) {
                const wm = this.getWhatsAppManager ? this.getWhatsAppManager() : null;
                if (wm && wm.client && wm.isReady) {
                    const alertMsg = `⚠️ *[NOVA INVENTORY ALERT]*\n\nBhai, *${product.name}* (SKU: \`${product.sku}\`) ka stock khatam ho raha hai!\n\n*Current Stock:* ${product.quantity} units left (Min threshold: ${product.min_stock_alert}).\n\nMeherbani kar ke naya order kar dein!`;
                    wm.sendToOwner(alertMsg).catch(err => {
                        console.error('[Inventory] Failed to send low-stock alert via WhatsApp:', err.message);
                    });
                }
            }
        } catch (err) {
            console.error('[Inventory] Low stock check failed:', err.message);
        }
    }

    async runAutoEmailBackup() {
        try {
            const autoBackup = this.db.prepare("SELECT value FROM inventory_settings WHERE key = 'auto_backup'").get();
            if (!autoBackup || autoBackup.value !== 'true') return;

            const sender = this.db.prepare("SELECT value FROM inventory_settings WHERE key = 'smtp_sender'").get();
            const password = this.db.prepare("SELECT value FROM inventory_settings WHERE key = 'smtp_password'").get();
            const host = this.db.prepare("SELECT value FROM inventory_settings WHERE key = 'smtp_host'").get();
            const port = this.db.prepare("SELECT value FROM inventory_settings WHERE key = 'smtp_port'").get();
            const receiver = this.db.prepare("SELECT value FROM inventory_settings WHERE key = 'smtp_receiver'").get();

            if (!sender || !password || !receiver) {
                console.warn('[Inventory] Auto-backup skipped: SMTP settings are incomplete.');
                return;
            }

            const archiver = require('archiver');
            const backupFile = path.join(INVENTORY_DIR, `nova_inventory_autobackup_${Date.now()}.zip`);
            const output = fs.createWriteStream(backupFile);
            const archive = archiver('zip', { zlib: { level: 9 } });

            const completePromise = new Promise((resolve, reject) => {
                output.on('close', () => resolve(backupFile));
                archive.on('error', (err) => reject(err));
            });

            archive.pipe(output);
            
            this.db.close();
            archive.file(DB_PATH, { name: 'inventory.db' });
            archive.directory(IMAGES_DIR, 'product_images');
            
            await archive.finalize();
            await completePromise;

            this.db = new Database(DB_PATH);
            this.db.pragma('journal_mode = WAL');

            const nodemailer = require('nodemailer');
            const transporter = nodemailer.createTransport({
                host: host ? host.value : 'smtp.gmail.com',
                port: port ? Number(port.value) : 465,
                secure: port ? Number(port.value) === 465 : true,
                auth: {
                    user: sender.value,
                    pass: password.value
                }
            });

            const mailOptions = {
                from: sender.value,
                to: receiver.value,
                subject: `Nova Inventory Auto-Backup — ${new Date().toLocaleDateString()}`,
                text: `Nova Desktop Assistant has generated an automatic backup of your inventory database and product images.\n\nTimestamp: ${new Date().toLocaleString()}\nFile: ${path.basename(backupFile)}`,
                attachments: [
                    {
                        filename: path.basename(backupFile),
                        path: backupFile
                    }
                ]
            };

            await transporter.sendMail(mailOptions);
            console.log('[Inventory] Auto-backup email sent successfully to:', receiver.value);

            fs.unlinkSync(backupFile);
        } catch (err) {
            console.error('[Inventory] Auto-backup failed:', err.message);
            try {
                if (!this.db) {
                    this.db = new Database(DB_PATH);
                    this.db.pragma('journal_mode = WAL');
                }
            } catch (_) {}
        }
    }

    createTables() {
        // 1. Users table for Owner & Cashier access
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                role TEXT UNIQUE CHECK(role IN ('owner', 'cashier')),
                pin_hash TEXT NOT NULL
            );
        `);

        // Insert default owner PIN '1234' and cashier PIN '0000' if not set
        const userCount = this.db.prepare('SELECT count(*) as count FROM users').get();
        if (userCount.count === 0) {
            this.db.prepare('INSERT INTO users (role, pin_hash) VALUES (?, ?)')
                .run('owner', this.hashPIN('1234'));
            this.db.prepare('INSERT INTO users (role, pin_hash) VALUES (?, ?)')
                .run('cashier', this.hashPIN('0000'));
            console.log('[Inventory] Inserted default credentials (Owner: 1234, Cashier: 0000).');
        }

        // 2. Categories
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                description TEXT,
                template_json TEXT DEFAULT '{}'
            );
        `);

        // 3. Products
        this.db.exec(`
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
        `);

        // 4. Transactions (Sales and restocking transactions)
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type TEXT CHECK(type IN ('IN', 'OUT')),
                total_amount REAL NOT NULL,
                payment_method TEXT CHECK(payment_method IN ('Cash', 'Card', 'Mobile')),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 5. Transaction Items
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS transaction_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                transaction_id INTEGER REFERENCES transactions(id) ON DELETE CASCADE,
                product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
                quantity INTEGER NOT NULL,
                price REAL NOT NULL
            );
        `);

        // 6. Immutable Stock Movements (Audit Trail Log)
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS stock_movements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
                change_qty INTEGER NOT NULL,
                reason TEXT NOT NULL,
                user_role TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 7. Finance Ledger (Daily Income / Expenses log)
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS ledger (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type TEXT CHECK(type IN ('REVENUE', 'EXPENSE')),
                amount REAL NOT NULL,
                category TEXT NOT NULL,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 8. Shop Profile Table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS shop_profile (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                type TEXT NOT NULL,
                details TEXT,
                contact TEXT
            );
        `);

        // 9. Inventory Settings Table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS inventory_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        `);

        // 10. Khata Customers Table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS khata_customers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                phone TEXT,
                balance REAL DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 11. Khata Transactions Table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS khata_transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                customer_id INTEGER REFERENCES khata_customers(id) ON DELETE CASCADE,
                type TEXT CHECK(type IN ('GIVE', 'GET')),
                amount REAL NOT NULL,
                notes TEXT,
                date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 12. Migrate transactions table to support Credit/Udhaar and customer_id
        try {
            const tableInfo = this.db.pragma("table_info(transactions)");
            const hasCustomerId = tableInfo.some(col => col.name === 'customer_id');
            if (!hasCustomerId) {
                console.log('[Migration] Adding customer_id column to transactions table...');
                this.db.exec("ALTER TABLE transactions ADD COLUMN customer_id INTEGER REFERENCES khata_customers(id) ON DELETE SET NULL;");
            }
        } catch (e) {
            console.error('[Migration] Failed to add customer_id column:', e.message);
        }

        // Test if check constraint on payment_method restricts Credit/Udhaar
        try {
            this.db.prepare("INSERT INTO transactions (type, total_amount, payment_method) VALUES ('OUT', 0, 'Credit')").run();
            this.db.exec("DELETE FROM transactions WHERE total_amount = 0 AND payment_method = 'Credit'");
        } catch (e) {
            console.log('[Migration] Migrating transactions table to drop payment_method check constraint...');
            try {
                this.db.transaction(() => {
                    this.db.exec("PRAGMA foreign_keys=OFF;");
                    this.db.exec("ALTER TABLE transactions RENAME TO transactions_old;");
                    this.db.exec(`
                        CREATE TABLE transactions (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            type TEXT CHECK(type IN ('IN', 'OUT')),
                            total_amount REAL NOT NULL,
                            payment_method TEXT,
                            customer_id INTEGER REFERENCES khata_customers(id) ON DELETE SET NULL,
                            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                        );
                    `);
                    const oldTableInfo = this.db.pragma("table_info(transactions_old)");
                    const oldHasCustId = oldTableInfo.some(col => col.name === 'customer_id');
                    if (oldHasCustId) {
                        this.db.exec(`
                            INSERT INTO transactions (id, type, total_amount, payment_method, customer_id, created_at)
                            SELECT id, type, total_amount, payment_method, customer_id, created_at FROM transactions_old;
                        `);
                    } else {
                        this.db.exec(`
                            INSERT INTO transactions (id, type, total_amount, payment_method, customer_id, created_at)
                            SELECT id, type, total_amount, payment_method, NULL, created_at FROM transactions_old;
                        `);
                    }
                    this.db.exec("DROP TABLE transactions_old;");
                    this.db.exec("PRAGMA foreign_keys=ON;");
                })();
                console.log('[Migration] transactions table migrated successfully.');
            } catch (migrationError) {
                console.error('[Migration] Critical failure migrating transactions table:', migrationError.message);
            }
        }

        // 13. Migrate transaction_items table to fix foreign key referencing transactions_old
        try {
            const tableSql = this.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='transaction_items'").get();
            if (tableSql && tableSql.sql.includes('transactions_old')) {
                console.log('[Migration] Migrating transaction_items table to fix transactions_old reference...');
                this.db.transaction(() => {
                    this.db.exec("PRAGMA foreign_keys=OFF;");
                    this.db.exec("ALTER TABLE transaction_items RENAME TO transaction_items_old;");
                    this.db.exec(`
                        CREATE TABLE transaction_items (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            transaction_id INTEGER REFERENCES transactions(id) ON DELETE CASCADE,
                            product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
                            quantity INTEGER NOT NULL,
                            price REAL NOT NULL
                        );
                    `);
                    this.db.exec(`
                        INSERT INTO transaction_items (id, transaction_id, product_id, quantity, price)
                        SELECT id, transaction_id, product_id, quantity, price FROM transaction_items_old;
                    `);
                    this.db.exec("DROP TABLE transaction_items_old;");
                    this.db.exec("PRAGMA foreign_keys=ON;");
                })();
                console.log('[Migration] transaction_items table migrated successfully.');
            }
        } catch (e) {
            console.error('[Migration] Failed to migrate transaction_items table:', e.message);
        }
    }

    registerIPCHandlers() {
        // --- CLOUD SYNC & AUTHENTICATION HANDLERS ---
        ipcMain.handle('inventory:save-cloud-keys', async (e, { url, key }) => {
            try {
                this.db.prepare("INSERT OR REPLACE INTO inventory_settings (key, value) VALUES ('supabase_url', ?)")
                    .run(url);
                this.db.prepare("INSERT OR REPLACE INTO inventory_settings (key, value) VALUES ('supabase_key', ?)")
                    .run(key);
                
                const success = this.initSupabase();
                return { success };
            } catch (err) {
                return { success: false, error: err.message };
            }
        });

        ipcMain.handle('inventory:get-cloud-status', async () => {
            try {
                if (!this.supabase) {
                    this.initSupabase();
                }
                if (!this.supabase) {
                    return { success: true, configured: false, authenticated: false, email: null };
                }
                const { data: { session }, error } = await this.supabase.auth.getSession();
                if (error || !session) {
                    return { success: true, configured: true, authenticated: false, email: null };
                }
                return { 
                    success: true, 
                    configured: true, 
                    authenticated: true, 
                    email: session.user.email 
                };
            } catch (err) {
                return { success: false, error: err.message };
            }
        });

        ipcMain.handle('inventory:activate-cloud', async (e, { email, password }) => {
            console.log('[Inventory] activate-cloud handler triggered for:', email);
            try {
                if (!this.supabase) {
                    console.log('[Inventory] Supabase not initialized, running initSupabase...');
                    this.initSupabase();
                }
                if (!this.supabase) {
                    console.log('[Inventory] Supabase initialization failed.');
                    return { success: false, error: 'Supabase cloud client is not configured. Please save your URL and Key first.' };
                }

                console.log('[Inventory] Attempting signInWithPassword to Supabase...');
                // Try to sign in the owner
                const { data, error } = await this.supabase.auth.signInWithPassword({
                    email,
                    password
                });

                if (error) {
                    console.log('[Inventory] signInWithPassword failed:', error.message);
                    console.log('[Inventory] Attempting signUp fallback...');
                    // Try signup fallback for a new cloud account registration
                    const { data: signUpData, error: signUpError } = await this.supabase.auth.signUp({
                        email,
                        password
                    });
                    
                    if (signUpError) {
                        console.error('[Inventory] signUp fallback failed:', signUpError.message);
                        return { success: false, error: 'Authentication failed: ' + error.message + ' (Signup fallback: ' + signUpError.message + ')' };
                    }
                    
                    console.log('[Inventory] signUp fallback successful, email:', signUpData.user.email);
                    return { success: true, email: signUpData.user.email, message: 'Nova conta na nuvem registrada!' };
                }

                console.log('[Inventory] signInWithPassword successful, email:', data.user.email);
                return { success: true, email: data.user.email };
            } catch (err) {
                console.error('[Inventory] Exception in activate-cloud:', err);
                return { success: false, error: err.message };
            }
        });

        ipcMain.handle('inventory:disconnect-cloud', async () => {
            try {
                if (this.supabase) {
                    await this.supabase.auth.signOut();
                }
                this.db.prepare("DELETE FROM inventory_settings WHERE key = 'supabase_url'").run();
                this.db.prepare("DELETE FROM inventory_settings WHERE key = 'supabase_key'").run();
                // Clear all supabase stored auth tokens (they start with sb-)
                this.db.prepare("DELETE FROM inventory_settings WHERE key LIKE 'sb-%'").run();
                this.supabase = null;
                return { success: true };
            } catch (err) {
                return { success: false, error: err.message };
            }
        });

        // --- AUTHENTICATION ---
        ipcMain.handle('inventory:check-pin', async (e, { role, pin }) => {
            try {
                const user = this.db.prepare('SELECT pin_hash FROM users WHERE role = ?').get(role);
                if (!user) return { success: false, error: 'User role not found' };
                const match = (user.pin_hash === this.hashPIN(pin));
                return { success: match };
            } catch (err) {
                return { success: false, error: err.message };
            }
        });

        ipcMain.handle('inventory:update-pin', async (e, { role, oldPin, newPin }) => {
            try {
                // To change owner's PIN or cashier's PIN, we verify the owner's current PIN
                const owner = this.db.prepare('SELECT pin_hash FROM users WHERE role = ?').get('owner');
                if (!owner) return { success: false, error: 'Owner account not found' };
                if (owner.pin_hash !== this.hashPIN(oldPin)) return { success: false, error: 'Incorrect Owner PIN (Current PIN)' };

                this.db.prepare('UPDATE users SET pin_hash = ? WHERE role = ?')
                    .run(this.hashPIN(newPin), role);
                return { success: true };
            } catch (err) {
                return { success: false, error: err.message };
            }
        });

        // --- CATEGORIES ---
        ipcMain.handle('inventory:get-categories', async () => {
            try {
                if (this.supabase) {
                    const { data, error } = await this.supabase.from('categories').select('*');
                    if (!error && data) {
                        const insertOrReplace = this.db.prepare(`
                            INSERT OR REPLACE INTO categories (id, name, description, template_json)
                            VALUES (?, ?, ?, ?)
                        `);
                        const transaction = this.db.transaction(() => {
                            for (const c of data) {
                                insertOrReplace.run(
                                    c.id,
                                    c.name,
                                    c.description,
                                    typeof c.template_json === 'string' ? c.template_json : JSON.stringify(c.template_json || c.template || {})
                                );
                            }
                        });
                        transaction();
                    }
                }
            } catch (err) {
                console.error('[Inventory Sync] Category sync failed:', err.message);
            }

            try {
                const categories = this.db.prepare('SELECT * FROM categories').all();
                return { success: true, categories };
            } catch (err) {
                return { success: false, error: err.message };
            }
        });

        ipcMain.handle('inventory:add-category', async (e, { name, description, template }) => {
            try {
                const templateStr = JSON.stringify(template || {});
                const res = this.db.prepare('INSERT INTO categories (name, description, template_json) VALUES (?, ?, ?)')
                    .run(name, description, templateStr);
                const catId = res.lastInsertRowid;
                
                if (this.supabase) {
                    this.supabase.from('categories').insert({
                        id: catId,
                        name,
                        description,
                        template_json: template || {}
                    }).then(({ error }) => {
                        if (error) console.error('[Inventory Sync] Category insert sync failed:', error.message);
                    });
                }

                return { success: true, id: catId };
            } catch (err) {
                return { success: false, error: err.message };
            }
        });

        ipcMain.handle('inventory:delete-category', async (e, id) => {
            try {
                this.db.prepare('DELETE FROM categories WHERE id = ?').run(id);
                
                if (this.supabase) {
                    this.supabase.from('categories').delete().eq('id', id).then(({ error }) => {
                        if (error) console.error('[Inventory Sync] Category delete sync failed:', error.message);
                    });
                }

                return { success: true };
            } catch (err) {
                return { success: false, error: err.message };
            }
        });

        ipcMain.handle('inventory:get-vault-dir', () => {
            return VAULT_DIR;
        });

        // --- PRODUCTS ---
        ipcMain.handle('inventory:get-products', async () => {
            try {
                if (this.supabase) {
                    const { data, error } = await this.supabase
                        .from('products')
                        .select('*');
                    
                    if (!error && data) {
                        const insertOrReplace = this.db.prepare(`
                            INSERT OR REPLACE INTO products (id, sku, name, category_id, quantity, min_stock_alert, cost_price, sell_price, image_path, custom_attributes, created_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `);
                        
                        const transaction = this.db.transaction(() => {
                            for (const p of data) {
                                insertOrReplace.run(
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
                                );
                            }
                        });
                        transaction();
                    }
                }
            } catch (err) {
                console.error('[Inventory Sync] Product sync failed:', err.message);
            }

            try {
                const products = this.db.prepare(`
                    SELECT p.id, p.sku, p.name, p.category_id, p.quantity, 
                           p.min_stock_alert as minStockAlert, 
                           p.cost_price as costPrice, 
                           p.sell_price as sellPrice, 
                           p.image_path, p.custom_attributes, p.created_at, 
                           c.name as category_name 
                    FROM products p 
                    LEFT JOIN categories c ON p.category_id = c.id
                `).all();
                return { success: true, products };
            } catch (err) {
                return { success: false, error: err.message };
            }
        });

        ipcMain.handle('inventory:add-product', async (e, productData) => {
            const { sku, name, categoryId, quantity, minStockAlert, costPrice, sellPrice, imageBase64, customAttributes } = productData;
            
            try {
                const dbCategoryId = (categoryId === '' || categoryId === null || categoryId === undefined || categoryId === '0' || categoryId === 0) ? null : Number(categoryId);
                let imagePath = null;
                if (imageBase64) {
                    const ext = imageBase64.substring("data:image/".length, imageBase64.indexOf(";base64"));
                    const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, "");
                    const filename = `img_${sku}_${Date.now()}.${ext}`;
                    const fullPath = path.join(IMAGES_DIR, filename);
                    fs.writeFileSync(fullPath, Buffer.from(cleanBase64, 'base64'));
                    imagePath = path.relative(VAULT_DIR, fullPath).replace(/\\/g, '/');
                }

                const transaction = this.db.transaction(() => {
                    // 1. Insert product
                    const insertRes = this.db.prepare(`
                        INSERT INTO products (sku, name, category_id, quantity, min_stock_alert, cost_price, sell_price, image_path, custom_attributes)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `).run(sku, name, dbCategoryId, quantity, minStockAlert, costPrice, sellPrice, imagePath, JSON.stringify(customAttributes || {}));
                    
                    const productId = insertRes.lastInsertRowid;

                    // 2. Log initial stock movement
                    if (quantity > 0) {
                        this.db.prepare(`
                            INSERT INTO stock_movements (product_id, change_qty, reason, user_role)
                            VALUES (?, ?, ?, ?)
                        `).run(productId, quantity, 'RESTOCK', 'owner');

                        // 3. Log initial expense in ledger
                        const totalCost = costPrice * quantity;
                        this.db.prepare(`
                            INSERT INTO ledger (type, amount, category, notes)
                            VALUES (?, ?, ?, ?)
                        `).run('EXPENSE', totalCost, 'Inventory Restock', `Initial stock for ${name} (${quantity} units)`);
                    }

                    return productId;
                });

                const prodId = transaction();

                if (this.supabase) {
                    this.supabase.from('products').insert({
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
                    }).then(({ error }) => {
                        if (error) console.error('[Inventory Sync] Product insert sync failed:', error.message);
                    });

                    if (quantity > 0) {
                        const movement = this.db.prepare('SELECT * FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT 1').get(prodId);
                        if (movement) {
                            this.supabase.from('stock_movements').insert({
                                id: movement.id,
                                product_id: movement.product_id,
                                change_qty: movement.change_qty,
                                reason: movement.reason,
                                user_role: movement.user_role,
                                created_at: movement.created_at
                            }).then(({ error }) => {
                                if (error) console.error('[Inventory Sync] Stock movement sync failed:', error.message);
                            });
                        }

                        const ledger = this.db.prepare("SELECT * FROM ledger WHERE category = 'Inventory Restock' AND notes = ?").get(`Initial stock for ${name} (${quantity} units)`);
                        if (ledger) {
                            this.supabase.from('ledger').insert({
                                id: ledger.id,
                                type: ledger.type,
                                amount: ledger.amount,
                                category: ledger.category,
                                notes: ledger.notes,
                                created_at: ledger.created_at
                            }).then(({ error }) => {
                                if (error) console.error('[Inventory Sync] Ledger restock sync failed:', error.message);
                            });
                        }
                    }
                }

                this.runAutoEmailBackup().catch(err => console.error('[Inventory] Auto-backup error:', err));
                return { success: true, id: prodId };
            } catch (err) {
                return { success: false, error: err.message };
            }
        });

        ipcMain.handle('inventory:update-product', async (e, { id, data, role }) => {
            try {
                const current = this.db.prepare('SELECT * FROM products WHERE id = ?').get(id);
                if (!current) return { success: false, error: 'Product not found' };

                const transaction = this.db.transaction(() => {
                    let imagePath = current.image_path;
                    if (data.imageBase64) {
                        // Delete old image if exists
                        if (current.image_path) {
                            const oldPath = path.join(VAULT_DIR, current.image_path);
                            if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
                        }

                        const ext = data.imageBase64.substring("data:image/".length, data.imageBase64.indexOf(";base64"));
                        const cleanBase64 = data.imageBase64.replace(/^data:image\/\w+;base64,/, "");
                        const filename = `img_${data.sku || current.sku}_${Date.now()}.${ext}`;
                        const fullPath = path.join(IMAGES_DIR, filename);
                        fs.writeFileSync(fullPath, Buffer.from(cleanBase64, 'base64'));
                        imagePath = path.relative(VAULT_DIR, fullPath).replace(/\\/g, '/');
                    }

                    // Strict validation: cashier cannot edit pricing or details, only adjust stock (if allowed via returns/counts)
                    if (role === 'cashier') {
                        // Cashier is only updating stock from POS sales or refunds
                        this.db.prepare(`
                            UPDATE products SET quantity = ? WHERE id = ?
                        `).run(data.quantity, id);
                        
                        const qtyDiff = data.quantity - current.quantity;
                        if (qtyDiff !== 0) {
                            this.db.prepare(`
                                INSERT INTO stock_movements (product_id, change_qty, reason, user_role)
                                VALUES (?, ?, ?, ?)
                            `).run(id, qtyDiff, qtyDiff > 0 ? 'RETURN' : 'ADJUSTMENT', 'cashier');
                        }
                    } else {
                        // Owner updates everything
                        let dbCategoryId = current.category_id;
                        if (data.categoryId !== undefined) {
                            dbCategoryId = (data.categoryId === '' || data.categoryId === null || data.categoryId === undefined || data.categoryId === '0' || data.categoryId === 0) ? null : Number(data.categoryId);
                        }

                        this.db.prepare(`
                            UPDATE products 
                            SET sku = ?, name = ?, category_id = ?, quantity = ?, min_stock_alert = ?, cost_price = ?, sell_price = ?, image_path = ?, custom_attributes = ?
                            WHERE id = ?
                        `).run(
                            data.sku || current.sku,
                            data.name || current.name,
                            dbCategoryId,
                            data.quantity !== undefined ? data.quantity : current.quantity,
                            data.minStockAlert !== undefined ? data.minStockAlert : current.min_stock_alert,
                            data.costPrice !== undefined ? data.costPrice : current.cost_price,
                            data.sellPrice !== undefined ? data.sellPrice : current.sell_price,
                            imagePath,
                            data.customAttributes ? JSON.stringify(data.customAttributes) : current.custom_attributes,
                            id
                        );

                        const qtyDiff = (data.quantity !== undefined ? data.quantity : current.quantity) - current.quantity;
                        if (qtyDiff !== 0) {
                            this.db.prepare(`
                                INSERT INTO stock_movements (product_id, change_qty, reason, user_role)
                                VALUES (?, ?, ?, ?)
                            `).run(id, qtyDiff, qtyDiff > 0 ? 'RESTOCK' : 'DAMAGE_WRITE_OFF', 'owner');

                            if (qtyDiff > 0) {
                                const addCost = (data.costPrice || current.cost_price) * qtyDiff;
                                this.db.prepare(`
                                    INSERT INTO ledger (type, amount, category, notes)
                                    VALUES (?, ?, ?, ?)
                                `).run('EXPENSE', addCost, 'Inventory Restock', `Restock for ${data.name || current.name} (${qtyDiff} units)`);
                            }
                        }
                    }
                });

                transaction();

                if (this.supabase) {
                    const updated = this.db.prepare('SELECT * FROM products WHERE id = ?').get(id);
                    if (updated) {
                        this.supabase.from('products').update({
                            sku: updated.sku,
                            name: updated.name,
                            category_id: updated.category_id,
                            quantity: updated.quantity,
                            min_stock_alert: updated.min_stock_alert,
                            cost_price: updated.cost_price,
                            sell_price: updated.sell_price,
                            image_path: updated.image_path,
                            custom_attributes: JSON.parse(updated.custom_attributes || '{}')
                        }).eq('id', id).then(({ error }) => {
                            if (error) console.error('[Inventory Sync] Product update sync failed:', error.message);
                        });
                    }

                    const qtyDiff = (data.quantity !== undefined ? data.quantity : current.quantity) - current.quantity;
                    if (qtyDiff !== 0) {
                        const movement = this.db.prepare('SELECT * FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT 1').get(id);
                        if (movement) {
                            this.supabase.from('stock_movements').insert({
                                id: movement.id,
                                product_id: movement.product_id,
                                change_qty: movement.change_qty,
                                reason: movement.reason,
                                user_role: movement.user_role,
                                created_at: movement.created_at
                            }).then(({ error }) => {
                                if (error) console.error('[Inventory Sync] Stock movement update sync failed:', error.message);
                            });
                        }

                        if (qtyDiff > 0) {
                            const restockNotes = `Restock for ${data.name || current.name} (${qtyDiff} units)`;
                            const ledger = this.db.prepare("SELECT * FROM ledger WHERE category = 'Inventory Restock' AND notes = ?").get(restockNotes);
                            if (ledger) {
                                this.supabase.from('ledger').insert({
                                    id: ledger.id,
                                    type: ledger.type,
                                    amount: ledger.amount,
                                    category: ledger.category,
                                    notes: ledger.notes,
                                    created_at: ledger.created_at
                                }).then(({ error }) => {
                                    if (error) console.error('[Inventory Sync] Ledger restock update sync failed:', error.message);
                                });
                            }
                        }
                    }
                }

                this.checkLowStockAlert(id);
                this.runAutoEmailBackup().catch(err => console.error('[Inventory] Auto-backup error:', err));
                return { success: true };
            } catch (err) {
                return { success: false, error: err.message };
            }
        });

        ipcMain.handle('inventory:delete-product', async (e, id) => {
            try {
                const current = this.db.prepare('SELECT image_path FROM products WHERE id = ?').get(id);
                if (current && current.image_path) {
                    const fullPath = path.join(VAULT_DIR, current.image_path);
                    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
                }
                this.db.prepare('DELETE FROM products WHERE id = ?').run(id);

                if (this.supabase) {
                    this.supabase.from('products').delete().eq('id', id).then(({ error }) => {
                        if (error) console.error('[Inventory Sync] Product delete sync failed:', error.message);
                    });
                }

                return { success: true };
            } catch (err) {
                return { success: false, error: err.message };
            }
        });

        // --- CHECKOUT (POS Sales Checkout) ---
        ipcMain.handle('inventory:checkout', async (e, { items, paymentMethod, discount, customerId }) => {
            try {
                const transaction = this.db.transaction(() => {
                    let totalVal = 0;
                    
                    // 1. Calculate total sale amount
                    for (const item of items) {
                        const prod = this.db.prepare('SELECT sell_price, quantity, name FROM products WHERE id = ?').get(item.productId);
                        if (!prod) throw new Error(`Product ID ${item.productId} not found`);
                        if (prod.quantity < item.quantity) throw new Error(`Not enough stock for ${prod.name}. Available: ${prod.quantity}`);
                        totalVal += prod.sell_price * item.quantity;
                    }

                    const finalAmount = Math.max(0, totalVal - (discount || 0));

                    // 2. Create Transaction record
                    const txRes = this.db.prepare(`
                        INSERT INTO transactions (type, total_amount, payment_method, customer_id)
                        VALUES ('OUT', ?, ?, ?)
                    `).run(finalAmount, paymentMethod, customerId || null);
                    const txId = txRes.lastInsertRowid;

                    // 3. Update products quantity, record stock movements and transaction items
                    for (const item of items) {
                        const prod = this.db.prepare('SELECT sell_price, quantity, name FROM products WHERE id = ?').get(item.productId);
                        const newQty = prod.quantity - item.quantity;
                        
                        this.db.prepare('UPDATE products SET quantity = ? WHERE id = ?').run(newQty, item.productId);
                        
                        this.db.prepare(`
                            INSERT INTO transaction_items (transaction_id, product_id, quantity, price)
                            VALUES (?, ?, ?, ?)
                        `).run(txId, item.productId, item.quantity, prod.sell_price);

                        this.db.prepare(`
                            INSERT INTO stock_movements (product_id, change_qty, reason, user_role)
                            VALUES (?, ?, ?, ?)
                        `).run(item.productId, -item.quantity, 'SALE', 'cashier');
                    }

                    // If payment method is Credit/Udhaar, log in Digital Khata as a GIVE transaction
                    if ((paymentMethod === 'Credit' || paymentMethod === 'Udhaar') && customerId) {
                        this.db.prepare(`
                            INSERT INTO khata_transactions (customer_id, type, amount, notes)
                            VALUES (?, 'GIVE', ?, ?)
                        `).run(customerId, finalAmount, `POS Bill checkout (Invoice #${txId})`);

                        this.db.prepare(`
                            UPDATE khata_customers SET balance = balance + ? WHERE id = ?
                        `).run(finalAmount, customerId);
                    }

                    // 4. Log revenue in the finance ledger
                    const ledgerCategory = (paymentMethod === 'Credit' || paymentMethod === 'Udhaar') ? 'POS Sale (Udhaar)' : 'POS Sale';
                    this.db.prepare(`
                        INSERT INTO ledger (type, amount, category, notes)
                        VALUES ('REVENUE', ?, ?, ?)
                    `).run(finalAmount, ledgerCategory, `Sale invoice #${txId}`);

                    return txId;
                });

                const invoiceId = transaction();
                 
                if (this.supabase) {
                    const tx = this.db.prepare('SELECT * FROM transactions WHERE id = ?').get(invoiceId);
                    const txItems = this.db.prepare('SELECT * FROM transaction_items WHERE transaction_id = ?').all(invoiceId);
                    
                    this.supabase.from('transactions').insert({
                        id: invoiceId,
                        type: 'OUT',
                        total_amount: tx.total_amount,
                        payment_method: tx.payment_method,
                        customer_id: tx.customer_id,
                        created_at: tx.created_at
                    }).then(({ error }) => {
                        if (error) console.error('[Inventory Sync] Transaction sync failed:', error.message);
                        
                        const dbItems = txItems.map(item => ({
                            id: item.id,
                            transaction_id: invoiceId,
                            product_id: item.product_id,
                            quantity: item.quantity,
                            price: item.price
                        }));
                        this.supabase.from('transaction_items').insert(dbItems).then(({ error: itemErr }) => {
                            if (itemErr) console.error('[Inventory Sync] Transaction items sync failed:', itemErr.message);
                        });
                    });

                    // Sync products quantities and movements
                    for (const item of items) {
                        const prod = this.db.prepare('SELECT quantity FROM products WHERE id = ?').get(item.productId);
                        this.supabase.from('products').update({ quantity: prod.quantity }).eq('id', item.productId).then(({ error }) => {
                            if (error) console.error('[Inventory Sync] Stock sync failed:', error.message);
                        });
                        
                        const movement = this.db.prepare('SELECT * FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT 1').get(item.productId);
                        if (movement) {
                            this.supabase.from('stock_movements').insert({
                                id: movement.id,
                                product_id: movement.product_id,
                                change_qty: movement.change_qty,
                                reason: movement.reason,
                                user_role: movement.user_role,
                                created_at: movement.created_at
                            }).then(({ error }) => {
                                if (error) console.error('[Inventory Sync] Stock movement checkout sync failed:', error.message);
                            });
                        }
                    }

                    // Sync Khata POS transaction and balance if Credit/Udhaar
                    if ((paymentMethod === 'Credit' || paymentMethod === 'Udhaar') && customerId) {
                        const khataTx = this.db.prepare('SELECT * FROM khata_transactions WHERE customer_id = ? AND notes LIKE ? ORDER BY id DESC LIMIT 1')
                            .get(customerId, `%Invoice #${invoiceId}%`);
                        if (khataTx) {
                            this.supabase.from('khata_transactions').insert({
                                id: khataTx.id,
                                customer_id: khataTx.customer_id,
                                type: khataTx.type,
                                amount: khataTx.amount,
                                notes: khataTx.notes,
                                date: khataTx.date,
                                created_at: khataTx.created_at
                            }).then(({ error }) => {
                                if (error) console.error('[Inventory Sync] Khata POS transaction sync failed:', error.message);
                            });
                        }
                        const customer = this.db.prepare('SELECT balance FROM khata_customers WHERE id = ?').get(customerId);
                        if (customer) {
                            this.supabase.from('khata_customers').update({ balance: customer.balance }).eq('id', customerId).then(({ error }) => {
                                if (error) console.error('[Inventory Sync] Customer POS balance sync failed:', error.message);
                            });
                        }
                    }

                    // Sync ledger entry
                    const ledgerEntry = this.db.prepare("SELECT * FROM ledger WHERE (category = 'POS Sale' OR category = 'POS Sale (Udhaar)') AND notes = ?").get(`Sale invoice #${invoiceId}`);
                    if (ledgerEntry) {
                        this.supabase.from('ledger').insert({
                            id: ledgerEntry.id,
                            type: 'REVENUE',
                            amount: ledgerEntry.amount,
                            category: ledgerEntry.category,
                            notes: ledgerEntry.notes,
                            created_at: ledgerEntry.created_at
                        }).then(({ error }) => {
                            if (error) console.error('[Inventory Sync] Ledger entry sync failed:', error.message);
                        });
                    }
                }

                // Check low stock alerts after transaction commits
                for (const item of items) {
                    this.checkLowStockAlert(item.productId);
                }
                 
                // Trigger auto email backup
                this.runAutoEmailBackup().catch(err => console.error('[Inventory] Auto-backup error:', err));

                return { success: true, invoiceId };
            } catch (err) {
                return { success: false, error: err.message };
            }
        });

        // --- REPORTING & LEDGER ---
        ipcMain.handle('inventory:get-transactions', async () => {
            try {
                if (this.supabase) {
                    const { data, error } = await this.supabase.from('transactions').select('*');
                    if (!error && data) {
                        const insertOrReplace = this.db.prepare(`
                            INSERT OR REPLACE INTO transactions (id, type, total_amount, payment_method, created_at)
                            VALUES (?, ?, ?, ?, ?)
                        `);
                        const transaction = this.db.transaction(() => {
                            for (const t of data) {
                                insertOrReplace.run(
                                    t.id,
                                    t.type,
                                    t.total_amount,
                                    t.payment_method,
                                    t.created_at
                                );
                            }
                        });
                        transaction();
                    }

                    const { data: items, error: itemsErr } = await this.supabase.from('transaction_items').select('*');
                    if (!itemsErr && items) {
                        const insertOrReplace = this.db.prepare(`
                            INSERT OR REPLACE INTO transaction_items (id, transaction_id, product_id, quantity, price)
                            VALUES (?, ?, ?, ?, ?)
                        `);
                        const transaction = this.db.transaction(() => {
                            for (const ti of items) {
                                insertOrReplace.run(
                                    ti.id,
                                    ti.transaction_id,
                                    ti.product_id,
                                    ti.quantity,
                                    ti.price
                                );
                            }
                        });
                        transaction();
                    }
                }
            } catch (err) {
                console.error('[Inventory Sync] Transactions sync failed:', err.message);
            }

            try {
                const txs = this.db.prepare('SELECT * FROM transactions ORDER BY created_at DESC').all();
                for (const tx of txs) {
                    tx.items = this.db.prepare(`
                        SELECT ti.*, p.name, p.sku 
                        FROM transaction_items ti
                        LEFT JOIN products p ON ti.product_id = p.id
                        WHERE ti.transaction_id = ?
                    `).all(tx.id);
                }
                return { success: true, transactions: txs };
            } catch (err) {
                return { success: false, error: err.message };
            }
        });

        ipcMain.handle('inventory:get-movements', async () => {
            try {
                if (this.supabase) {
                    const { data, error } = await this.supabase.from('stock_movements').select('*');
                    if (!error && data) {
                        const insertOrReplace = this.db.prepare(`
                            INSERT OR REPLACE INTO stock_movements (id, product_id, change_qty, reason, user_role, created_at)
                            VALUES (?, ?, ?, ?, ?, ?)
                        `);
                        const transaction = this.db.transaction(() => {
                            for (const sm of data) {
                                insertOrReplace.run(
                                    sm.id,
                                    sm.product_id,
                                    sm.change_qty,
                                    sm.reason,
                                    sm.user_role,
                                    sm.created_at
                                );
                            }
                        });
                        transaction();
                    }
                }
            } catch (err) {
                console.error('[Inventory Sync] Movements sync failed:', err.message);
            }

            try {
                const movements = this.db.prepare(`
                    SELECT sm.*, p.name as product_name, p.sku 
                    FROM stock_movements sm
                    LEFT JOIN products p ON sm.product_id = p.id
                    ORDER BY sm.created_at DESC
                `).all();
                return { success: true, movements };
            } catch (err) {
                return { success: false, error: err.message };
            }
        });

        ipcMain.handle('inventory:get-ledger', async () => {
            try {
                if (this.supabase) {
                    const { data, error } = await this.supabase.from('ledger').select('*');
                    if (!error && data) {
                        const insertOrReplace = this.db.prepare(`
                            INSERT OR REPLACE INTO ledger (id, type, amount, category, notes, created_at)
                            VALUES (?, ?, ?, ?, ?, ?)
                        `);
                        const transaction = this.db.transaction(() => {
                            for (const l of data) {
                                insertOrReplace.run(
                                    l.id,
                                    l.type,
                                    l.amount,
                                    l.category,
                                    l.notes,
                                    l.created_at
                                );
                            }
                        });
                        transaction();
                    }
                }
            } catch (err) {
                console.error('[Inventory Sync] Ledger sync failed:', err.message);
            }

            try {
                const ledger = this.db.prepare('SELECT * FROM ledger ORDER BY created_at DESC').all();
                return { success: true, ledger };
            } catch (err) {
                return { success: false, error: err.message };
            }
        });

        ipcMain.handle('inventory:add-expense', async (e, { amount, category, notes }) => {
            try {
                const res = this.db.prepare(`
                    INSERT INTO ledger (type, amount, category, notes)
                    VALUES ('EXPENSE', ?, ?, ?)
                `).run(amount, category, notes);
                const ledgerId = res.lastInsertRowid;
                
                if (this.supabase) {
                    this.supabase.from('ledger').insert({
                        id: ledgerId,
                        type: 'EXPENSE',
                        amount,
                        category,
                        notes
                    }).then(({ error }) => {
                        if (error) console.error('[Inventory Sync] Expense sync failed:', error.message);
                    });
                }

                return { success: true };
            } catch (err) {
                return { success: false, error: err.message };
            }
        });

        // --- BLIND CYCLE AUDITS ---
        ipcMain.handle('inventory:run-audit-check', async (e, counts) => {
            // counts: [{productId: 1, count: 12}, {productId: 2, count: 15}]
            try {
                const discrepancies = [];
                for (const item of counts) {
                    const prod = this.db.prepare('SELECT name, quantity, sku FROM products WHERE id = ?').get(item.productId);
                    if (prod) {
                        const diff = item.count - prod.quantity;
                        if (diff !== 0) {
                            discrepancies.push({
                                productId: item.productId,
                                sku: prod.sku,
                                name: prod.name,
                                expected: prod.quantity,
                                counted: item.count,
                                difference: diff
                            });
                        }
                    }
                }
                return { success: true, discrepancies };
            } catch (err) {
                return { success: false, error: err.message };
            }
        });

        // --- VISUAL PRODUCT RECOGNITION FUZZY QUERY ---
        ipcMain.handle('inventory:fuzzy-query', async (e, query) => {
            console.log('[Inventory] fuzzy-query received query:', query);
            try {
                const words = String(query).trim().split(/\s+/).filter(w => w.length > 1);
                if (words.length === 0) return { success: true, products: [] };

                const conditions = [];
                const params = [];
                for (const word of words) {
                    conditions.push('p.name LIKE ? OR p.sku LIKE ? OR p.custom_attributes LIKE ?');
                    const pTerm = `%${word}%`;
                    params.push(pTerm, pTerm, pTerm);
                }

                const queryStr = `
                    SELECT p.id, p.sku, p.name, p.category_id, p.quantity, 
                           p.min_stock_alert as minStockAlert, 
                           p.cost_price as costPrice, 
                           p.sell_price as sellPrice, 
                           p.image_path, p.custom_attributes, p.created_at, 
                           c.name as category_name
                    FROM products p
                    LEFT JOIN categories c ON p.category_id = c.id
                    WHERE ${conditions.join(' OR ')}
                `;

                const candidates = this.db.prepare(queryStr).all(...params);

                // Helper to calculate string similarity (Dice's coefficient)
                const getStringSimilarity = (str1, str2) => {
                    const s1 = String(str1).toLowerCase().replace(/[^a-z0-9]/g, '');
                    const s2 = String(str2).toLowerCase().replace(/[^a-z0-9]/g, '');
                    
                    if (s1 === s2) return 1.0;
                    if (s1.length < 2 || s2.length < 2) return 0.0;
                    
                    const getBigrams = (str) => {
                        const bigrams = new Set();
                        for (let i = 0; i < str.length - 1; i++) {
                            bigrams.add(str.slice(i, i + 2));
                        }
                        return bigrams;
                    };
                    
                    const b1 = getBigrams(s1);
                    const b2 = getBigrams(s2);
                    
                    let intersection = 0;
                    for (const bigram of b1) {
                        if (b2.has(bigram)) {
                            intersection++;
                        }
                    }
                    
                    return (2.0 * intersection) / (b1.size + b2.size);
                };

                const scoredProducts = candidates.map(p => {
                    const nameSim = getStringSimilarity(query, p.name);
                    const skuSim = getStringSimilarity(query, p.sku);
                    const maxSim = Math.max(nameSim, skuSim);
                    return { ...p, similarity: maxSim };
                });

                // Sort by similarity descending
                scoredProducts.sort((a, b) => b.similarity - a.similarity);

                // Filter out very low matches and limit to 5
                const products = scoredProducts.filter(p => p.similarity > 0.1).slice(0, 5);

                console.log(`[Inventory] fuzzy-query found ${products.length} ranked results.`);
                return { success: true, products };
            } catch (err) {
                console.error('[Inventory] fuzzy-query error:', err.message);
                return { success: false, error: err.message };
            }
        });

        // --- BACKUP ZIP ENGINE ---
        ipcMain.handle('inventory:create-zip-backup', async () => {
            try {
                const archiver = require('archiver');
                const backupFile = path.join(INVENTORY_DIR, `nova_inventory_backup_${Date.now()}.zip`);
                const output = fs.createWriteStream(backupFile);
                const archive = archiver('zip', { zlib: { level: 9 } });

                const completePromise = new Promise((resolve, reject) => {
                    output.on('close', () => resolve(backupFile));
                    archive.on('error', (err) => reject(err));
                });

                archive.pipe(output);
                // add sqlite file (safely close database connection first, copy it, reopen it)
                this.db.close();
                archive.file(DB_PATH, { name: 'inventory.db' });
                archive.directory(IMAGES_DIR, 'product_images');
                
                await archive.finalize();
                const zipPath = await completePromise;

                // Re-open DB
                this.db = new Database(DB_PATH);
                this.db.pragma('journal_mode = WAL');

                return { success: true, zipPath };
            } catch (err) {
                // Recover DB if closed
                try {
                    this.db = new Database(DB_PATH);
                    this.db.pragma('journal_mode = WAL');
                } catch (_) {}
                return { success: false, error: err.message };
            }
        });

        ipcMain.handle('inventory:restore-zip-backup', async () => {
            try {
                const { canceled, filePaths } = await dialog.showOpenDialog({
                    title: 'Select Nova Inventory Backup ZIP',
                    filters: [
                        { name: 'ZIP Archives', extensions: ['zip'] }
                    ],
                    properties: ['openFile']
                });

                if (canceled || filePaths.length === 0) {
                    return { success: false, error: 'Restore cancelled by user' };
                }

                const zipPath = filePaths[0];

                // 1. Close current DB connection safely
                if (this.db) {
                    this.db.close();
                    this.db = null;
                }

                // 2. Extract using powershell Expand-Archive to a temp directory
                const tempExtractDir = path.join(INVENTORY_DIR, `temp_restore_${Date.now()}`);
                if (!fs.existsSync(tempExtractDir)) fs.mkdirSync(tempExtractDir, { recursive: true });

                const { exec } = require('child_process');
                const cmd = `powershell -NoProfile -Command "Expand-Archive -Path '${zipPath.replace(/'/g, "''")}' -DestinationPath '${tempExtractDir.replace(/'/g, "''")}' -Force"`;

                await new Promise((resolve, reject) => {
                    const extract = process.platform === 'darwin'
                        ? (callback) => require('child_process').execFile('/usr/bin/ditto',['-x','-k',zipPath,tempExtractDir],callback)
                        : (callback) => exec(cmd,callback);
                    extract((err, stdout, stderr) => {
                        if (err) {
                            reject(new Error(stderr || err.message));
                        } else {
                            resolve(stdout);
                        }
                    });
                });

                // Check if inventory.db exists in tempExtractDir
                const tempDbPath = path.join(tempExtractDir, 'inventory.db');
                if (!fs.existsSync(tempDbPath)) {
                    // Clean up temp dir
                    fs.rmSync(tempExtractDir, { recursive: true, force: true });
                    // Reopen database
                    this.db = new Database(DB_PATH);
                    this.db.pragma('journal_mode = WAL');
                    return { success: false, error: 'Invalid backup file: inventory.db not found' };
                }

                // Copy inventory.db to DB_PATH (overwrite)
                fs.copyFileSync(tempDbPath, DB_PATH);

                // Copy product_images folder
                const tempImagesDir = path.join(tempExtractDir, 'product_images');
                if (fs.existsSync(tempImagesDir)) {
                    const files = fs.readdirSync(tempImagesDir);
                    for (const file of files) {
                        const src = path.join(tempImagesDir, file);
                        const dest = path.join(IMAGES_DIR, file);
                        fs.copyFileSync(src, dest);
                    }
                }

                // Clean up tempExtractDir
                fs.rmSync(tempExtractDir, { recursive: true, force: true });

                // Re-open DB
                this.db = new Database(DB_PATH);
                this.db.pragma('journal_mode = WAL');

                return { success: true };
            } catch (err) {
                // Try to recover DB
                if (!this.db) {
                    try {
                        this.db = new Database(DB_PATH);
                        this.db.pragma('journal_mode = WAL');
                    } catch (_) {}
                }
                return { success: false, error: err.message };
            }
        });

        // --- SHOP PROFILE ---
        ipcMain.handle('inventory:get-shop-profile', async () => {
            try {
                if (this.supabase) {
                    const { data, error } = await this.supabase.from('shop_profile').select('*').limit(1).maybeSingle();
                    if (!error && data) {
                        this.db.prepare("DELETE FROM shop_profile").run();
                        this.db.prepare(`
                            INSERT INTO shop_profile (id, name, type, details, contact)
                            VALUES (?, ?, ?, ?, ?)
                        `).run(data.id, data.name, data.type, data.details, data.contact);
                    }
                }
            } catch (err) {
                console.error('[Inventory Sync] Shop profile sync failed:', err.message);
            }

            try {
                const profile = this.db.prepare('SELECT * FROM shop_profile LIMIT 1').get();
                return { success: true, profile: profile || null };
            } catch (err) {
                return { success: false, error: err.message };
            }
        });

        ipcMain.handle('inventory:save-shop-profile', async (e, { name, type, details, contact }) => {
            try {
                const existing = this.db.prepare('SELECT id FROM shop_profile LIMIT 1').get();
                let profileId;
                if (existing) {
                    this.db.prepare('UPDATE shop_profile SET name = ?, type = ?, details = ?, contact = ? WHERE id = ?')
                        .run(name, type, details, contact, existing.id);
                    profileId = existing.id;
                } else {
                    const res = this.db.prepare('INSERT INTO shop_profile (name, type, details, contact) VALUES (?, ?, ?, ?)')
                        .run(name, type, details, contact);
                    profileId = res.lastInsertRowid;
                }

                if (this.supabase) {
                    this.supabase.from('shop_profile').upsert({
                        id: profileId,
                        name,
                        type,
                        details,
                        contact
                    }).then(({ error }) => {
                        if (error) console.error('[Inventory Sync] Shop profile upsert failed:', error.message);
                    });
                }

                return { success: true };
            } catch (err) {
                return { success: false, error: err.message };
            }
        });

        // --- SETTINGS ---
        ipcMain.handle('inventory:get-settings', async () => {
            try {
                const rows = this.db.prepare('SELECT * FROM inventory_settings').all();
                const settings = {};
                for (const row of rows) {
                    settings[row.key] = row.value;
                }
                return { success: true, settings };
            } catch (err) {
                return { success: false, error: err.message };
            }
        });

        ipcMain.handle('inventory:save-settings', async (e, settings) => {
            try {
                const transaction = this.db.transaction(() => {
                    const stmt = this.db.prepare('INSERT OR REPLACE INTO inventory_settings (key, value) VALUES (?, ?)');
                    for (const key in settings) {
                        stmt.run(key, String(settings[key]));
                    }
                });
                transaction();
                return { success: true };
            } catch (err) {
                return { success: false, error: err.message };
            }
        });

        // --- SEND WHATSAPP RECEIPT ---
        ipcMain.handle('inventory:send-whatsapp-receipt', async (e, { invoiceId, items, total, discount, paymentMethod, customerPhone }) => {
            try {
                const wm = this.getWhatsAppManager ? this.getWhatsAppManager() : null;
                if (!wm) return { success: false, error: 'WhatsApp client is not running or connected' };

                const profile = this.db.prepare('SELECT name FROM shop_profile LIMIT 1').get();
                const shopName = profile ? profile.name : 'Nova Store';

                let targetPhone = String(customerPhone).trim().replace(/\D/g, '');
                if (targetPhone.startsWith('0')) {
                    targetPhone = '92' + targetPhone.substring(1);
                }
                const targetJid = targetPhone + '@c.us';

                const separator = '----------------------------------------------';
                let itemsList = '';
                for (const item of items) {
                    itemsList += `• *${item.name}* (x${item.quantity}) — Rs. ${(item.price * item.quantity).toFixed(2)}\n`;
                }

                const msg = `🧾 *RECEIPT: ${shopName.toUpperCase()}*\n` +
                            `${separator}\n` +
                            `*Invoice ID:* #${invoiceId}\n` +
                            `*Date:* ${new Date().toLocaleString()}\n` +
                            `*Payment:* ${paymentMethod}\n` +
                            `${separator}\n` +
                            `*Items:* \n${itemsList}` +
                            `${separator}\n` +
                            (discount > 0 ? `*Discount:* Rs. ${discount.toFixed(2)}\n` : '') +
                            `*Grand Total:* *Rs. ${total.toFixed(2)}*\n` +
                            `${separator}\n` +
                            `*Shukriya! Hamari shop par aane ke liye.* 🙏\n` +
                            `Nova Desktop Assistant`;

                await wm.sendReply(targetJid, msg, true);
                return { success: true };
            } catch (err) {
                return { success: false, error: err.message };
            }
        });

        // --- DIGITAL KHATA HANDLERS ---
        ipcMain.handle('inventory:get-khata-customers', async () => {
            try {
                let customers = [];
                if (this.supabase) {
                    const { data, error } = await this.supabase.from('khata_customers').select('*').order('name', { ascending: true });
                    if (!error && data) {
                        const insertOrReplace = this.db.prepare(`
                            INSERT OR REPLACE INTO khata_customers (id, name, phone, balance, created_at)
                            VALUES (?, ?, ?, ?, ?)
                        `);
                        const transaction = this.db.transaction(() => {
                            for (const c of data) {
                                insertOrReplace.run(c.id, c.name, c.phone, c.balance, c.created_at);
                            }
                        });
                        transaction();
                    } else if (error) {
                        console.error('[Inventory Sync] Failed to get khata customers from Supabase:', error.message);
                    }
                }
                customers = this.db.prepare('SELECT * FROM khata_customers ORDER BY name ASC').all();
                return { success: true, customers };
            } catch (err) {
                return { success: false, error: err.message };
            }
        });

        ipcMain.handle('inventory:add-khata-customer', async (e, { name, phone, balance = 0 }) => {
            try {
                const transaction = this.db.transaction(() => {
                    const res = this.db.prepare(`
                        INSERT INTO khata_customers (name, phone, balance)
                        VALUES (?, ?, ?)
                    `).run(name, phone, balance);
                    const customerId = res.lastInsertRowid;

                    if (balance > 0) {
                        this.db.prepare(`
                            INSERT INTO khata_transactions (customer_id, type, amount, notes)
                            VALUES (?, 'GIVE', ?, ?)
                        `).run(customerId, balance, 'Starting Balance (Pehla Udhaar)');
                    }
                    return customerId;
                });

                const customerId = transaction();

                if (this.supabase) {
                    const customer = this.db.prepare('SELECT * FROM khata_customers WHERE id = ?').get(customerId);
                    this.supabase.from('khata_customers').insert({
                        id: customer.id,
                        name: customer.name,
                        phone: customer.phone,
                        balance: customer.balance,
                        created_at: customer.created_at
                    }).then(({ error }) => {
                        if (error) console.error('[Inventory Sync] Failed to insert customer to Supabase:', error.message);
                        
                        if (balance > 0) {
                            const firstTx = this.db.prepare('SELECT * FROM khata_transactions WHERE customer_id = ? ORDER BY id ASC LIMIT 1').get(customerId);
                            if (firstTx) {
                                this.supabase.from('khata_transactions').insert({
                                    id: firstTx.id,
                                    customer_id: firstTx.customer_id,
                                    type: firstTx.type,
                                    amount: firstTx.amount,
                                    notes: firstTx.notes,
                                    date: firstTx.date,
                                    created_at: firstTx.created_at
                                }).then(({ error: txErr }) => {
                                    if (txErr) console.error('[Inventory Sync] Failed to insert starting transaction to Supabase:', txErr.message);
                                });
                            }
                        }
                    });
                }

                return { success: true, customerId };
            } catch (err) {
                return { success: false, error: err.message };
            }
        });

        ipcMain.handle('inventory:add-khata-transaction', async (e, { customerId, type, amount, notes, date }) => {
            try {
                const transaction = this.db.transaction(() => {
                    const res = this.db.prepare(
                        date 
                            ? `INSERT INTO khata_transactions (customer_id, type, amount, notes, date) VALUES (?, ?, ?, ?, ?)`
                            : `INSERT INTO khata_transactions (customer_id, type, amount, notes) VALUES (?, ?, ?, ?)`
                    ).run(customerId, type, amount, notes, ...(date ? [date] : []));
                    const txId = res.lastInsertRowid;

                    const balanceDiff = type === 'GIVE' ? amount : -amount;
                    this.db.prepare('UPDATE khata_customers SET balance = balance + ? WHERE id = ?')
                        .run(balanceDiff, customerId);

                    return txId;
                });

                const txId = transaction();

                if (this.supabase) {
                    const tx = this.db.prepare('SELECT * FROM khata_transactions WHERE id = ?').get(txId);
                    const customer = this.db.prepare('SELECT * FROM khata_customers WHERE id = ?').get(customerId);

                    this.supabase.from('khata_transactions').insert({
                        id: tx.id,
                        customer_id: tx.customer_id,
                        type: tx.type,
                        amount: tx.amount,
                        notes: tx.notes,
                        date: tx.date,
                        created_at: tx.created_at
                    }).then(({ error }) => {
                        if (error) console.error('[Inventory Sync] Failed to sync khata transaction to Supabase:', error.message);
                        
                        this.supabase.from('khata_customers').update({ balance: customer.balance }).eq('id', customerId).then(({ error: custErr }) => {
                            if (custErr) console.error('[Inventory Sync] Failed to sync customer balance to Supabase:', custErr.message);
                        });
                    });
                }

                return { success: true, txId };
            } catch (err) {
                return { success: false, error: err.message };
            }
        });

        ipcMain.handle('inventory:get-khata-transactions', async (e, customerId) => {
            try {
                if (this.supabase) {
                    const { data, error } = await this.supabase.from('khata_transactions').select('*').eq('customer_id', customerId).order('date', { ascending: true });
                    if (!error && data) {
                        const insertOrReplace = this.db.prepare(`
                            INSERT OR REPLACE INTO khata_transactions (id, customer_id, type, amount, notes, date, created_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?)
                        `);
                        const transaction = this.db.transaction(() => {
                            for (const tx of data) {
                                insertOrReplace.run(tx.id, tx.customer_id, tx.type, tx.amount, tx.notes, tx.date, tx.created_at);
                            }
                        });
                        transaction();
                    } else if (error) {
                        console.error('[Inventory Sync] Failed to fetch khata transactions from Supabase:', error.message);
                    }
                }
                const txs = this.db.prepare('SELECT * FROM khata_transactions WHERE customer_id = ? ORDER BY date DESC, id DESC').all(customerId);
                return { success: true, transactions: txs };
            } catch (err) {
                return { success: false, error: err.message };
            }
        });

        ipcMain.handle('inventory:delete-khata-customer', async (e, customerId) => {
            try {
                this.db.prepare('DELETE FROM khata_customers WHERE id = ?').run(customerId);

                if (this.supabase) {
                    this.supabase.from('khata_customers').delete().eq('id', customerId).then(({ error }) => {
                        if (error) console.error('[Inventory Sync] Failed to delete customer from Supabase:', error.message);
                    });
                }
                return { success: true };
            } catch (err) {
                return { success: false, error: err.message };
            }
        });
    }
}

const inventoryManager = new InventoryManager();
module.exports = { inventoryManager };
