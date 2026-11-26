'use strict';

const { ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { exec, execFile } = require('child_process');
const Database = require('better-sqlite3');
const { VAULT_DIR, INVENTORY_DIR, IMAGES_DIR, DB_PATH, criarTabelas } = require('./inventory-banco');
const nuvem = require('./inventory-nuvem');
const produtos = require('./inventory-produtos');
const vendas = require('./inventory-vendas');

const AJUSTES_DO_SMTP = ['smtp_sender', 'smtp_password', 'smtp_host', 'smtp_port', 'smtp_receiver'];

const whatsappPronto = wm => Boolean(wm && wm.client && wm.isReady);

function textoDoAlerta(product) {
    return `⚠️ *[NOVA INVENTORY ALERT]*\n\nBhai, *${product.name}* (SKU: \`${product.sku}\`) ka stock khatam ho raha hai!\n\n*Current Stock:* ${product.quantity} units left (Min threshold: ${product.min_stock_alert}).\n\nMeherbani kar ke naya order kar dein!`;
}

async function enviarBackupPorEmail({ sender, password, host, port, receiver }, backupFile) {
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
    console.info('[Inventory] Auto-backup email sent successfully to:', receiver.value);
}

function extrairZip(zipPath, tempExtractDir) {
    const cmd = `powershell -NoProfile -Command "Expand-Archive -Path '${zipPath.replace(/'/g, "''")}' -DestinationPath '${tempExtractDir.replace(/'/g, "''")}' -Force"`;
    return new Promise((resolve, reject) => {
        const extract = process.platform === 'darwin'
            ? (callback) => execFile('/usr/bin/ditto', ['-x', '-k', zipPath, tempExtractDir], callback)
            : (callback) => exec(cmd, callback);
        extract((err, stdout, stderr) => {
            if (err) {
                reject(new Error(stderr || err.message));
            } else {
                resolve(stdout);
            }
        });
    });
}

function copiarImagensDoBackup(tempExtractDir) {
    const tempImagesDir = path.join(tempExtractDir, 'product_images');
    if (!fs.existsSync(tempImagesDir)) return;
    for (const file of fs.readdirSync(tempImagesDir)) {
        fs.copyFileSync(path.join(tempImagesDir, file), path.join(IMAGES_DIR, file));
    }
}

class InventoryManager {
    constructor() {
        this.db = null;
        this.supabase = null;
    }

    init(getWhatsAppManager) {
        console.info('[Inventory] Initializing Nova Inventory Vault...');
        this.getWhatsAppManager = getWhatsAppManager;
        for (const pasta of [VAULT_DIR, INVENTORY_DIR, IMAGES_DIR]) {
            if (!fs.existsSync(pasta)) fs.mkdirSync(pasta, { recursive: true });
        }
        try {
            this.reabrirBanco();
            this.createTables();
            this.initSupabase();
            this.registerIPCHandlers();
            console.info('[Inventory] Database initialized successfully.');
        } catch (err) {
            console.error('[Inventory] Database initialization failed:', err);
        }
    }

    reabrirBanco() {
        this.db = new Database(DB_PATH);
        this.db.pragma('journal_mode = WAL');
    }

    initSupabase() {
        return nuvem.iniciarNuvem(this);
    }

    hashPIN(pin) {
        return crypto.createHash('sha256').update(String(pin)).digest('hex');
    }

    whatsapp() {
        return this.getWhatsAppManager ? this.getWhatsAppManager() : null;
    }

    tentar(fazer) {
        try {
            return fazer();
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    async tentarAssincrono(fazer) {
        try {
            return await fazer();
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    agendarBackup() {
        this.runAutoEmailBackup().catch(err => console.error('[Inventory] Auto-backup error:', err));
    }

    avisarEstoqueBaixo(product) {
        const wm = this.whatsapp();
        if (!whatsappPronto(wm)) return;
        wm.sendToOwner(textoDoAlerta(product)).catch(err => {
            console.error('[Inventory] Failed to send low-stock alert via WhatsApp:', err.message);
        });
    }

    checkLowStockAlert(productId) {
        try {
            const product = this.db.prepare('SELECT name, sku, quantity, min_stock_alert FROM products WHERE id = ?').get(productId);
            if (product && product.quantity <= product.min_stock_alert) this.avisarEstoqueBaixo(product);
        } catch (err) {
            console.error('[Inventory] Low stock check failed:', err.message);
        }
    }

    lerAjuste(chave) {
        return this.db.prepare('SELECT value FROM inventory_settings WHERE key = ?').get(chave);
    }

    ajustesDoBackupPorEmail() {
        const autoBackup = this.lerAjuste('auto_backup');
        if (!autoBackup || autoBackup.value !== 'true') return null;
        const [sender, password, host, port, receiver] = AJUSTES_DO_SMTP.map(chave => this.lerAjuste(chave));
        if (![sender, password, receiver].every(Boolean)) {
            console.warn('[Inventory] Auto-backup skipped: SMTP settings are incomplete.');
            return null;
        }
        return { sender, password, host, port, receiver };
    }

    async compactarVault(nome) {
        const archiver = require('archiver');
        const backupFile = path.join(INVENTORY_DIR, nome);
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
        return await completePromise;
    }

    async runAutoEmailBackup() {
        try {
            const ajustes = this.ajustesDoBackupPorEmail();
            if (!ajustes) return;
            const backupFile = await this.compactarVault(`nova_inventory_autobackup_${Date.now()}.zip`);
            this.reabrirBanco();
            await enviarBackupPorEmail(ajustes, backupFile);
            fs.unlinkSync(backupFile);
        } catch (err) {
            console.error('[Inventory] Auto-backup failed:', err.message);
            try {
                if (!this.db) this.reabrirBanco();
            } catch (_) {}
        }
    }

    createTables() {
        criarTabelas(this.db, pin => this.hashPIN(pin));
    }

    async verificarPin({ role, pin }) {
        return this.tentar(() => {
            const user = this.db.prepare('SELECT pin_hash FROM users WHERE role = ?').get(role);
            if (!user) return { success: false, error: 'User role not found' };
            const match = (user.pin_hash === this.hashPIN(pin));
            return { success: match };
        });
    }

    async trocarPin({ role, oldPin, newPin }) {
        return this.tentar(() => {
            const owner = this.db.prepare('SELECT pin_hash FROM users WHERE role = ?').get('owner');
            if (!owner) return { success: false, error: 'Owner account not found' };
            if (owner.pin_hash !== this.hashPIN(oldPin)) return { success: false, error: 'Incorrect Owner PIN (Current PIN)' };
            this.db.prepare('UPDATE users SET pin_hash = ? WHERE role = ?')
                .run(this.hashPIN(newPin), role);
            return { success: true };
        });
    }

    async criarBackupZip() {
        try {
            const zipPath = await this.compactarVault(`nova_inventory_backup_${Date.now()}.zip`);
            this.reabrirBanco();
            return { success: true, zipPath };
        } catch (err) {
            try {
                this.reabrirBanco();
            } catch (_) {}
            return { success: false, error: err.message };
        }
    }

    fecharBanco() {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
    }

    async restaurarDoZip(zipPath) {
        this.fecharBanco();
        const tempExtractDir = path.join(INVENTORY_DIR, `temp_restore_${Date.now()}`);
        if (!fs.existsSync(tempExtractDir)) fs.mkdirSync(tempExtractDir, { recursive: true });
        await extrairZip(zipPath, tempExtractDir);
        const tempDbPath = path.join(tempExtractDir, 'inventory.db');
        const valido = fs.existsSync(tempDbPath);
        if (valido) {
            fs.copyFileSync(tempDbPath, DB_PATH);
            copiarImagensDoBackup(tempExtractDir);
        }
        fs.rmSync(tempExtractDir, { recursive: true, force: true });
        this.reabrirBanco();
        return valido ? { success: true } : { success: false, error: 'Invalid backup file: inventory.db not found' };
    }

    async restaurarBackupZip() {
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
            return await this.restaurarDoZip(filePaths[0]);
        } catch (err) {
            if (!this.db) {
                try {
                    this.reabrirBanco();
                } catch (_) {}
            }
            return { success: false, error: err.message };
        }
    }

    gravarPerfilDaNuvem(data) {
        this.db.prepare("DELETE FROM shop_profile").run();
        this.db.prepare(`
                            INSERT INTO shop_profile (id, name, type, details, contact)
                            VALUES (?, ?, ?, ?, ?)
                        `).run(data.id, data.name, data.type, data.details, data.contact);
    }

    async sincronizarPerfil() {
        try {
            if (!this.supabase) return;
            const { data, error } = await this.supabase.from('shop_profile').select('*').limit(1).maybeSingle();
            if (!error && data) this.gravarPerfilDaNuvem(data);
        } catch (err) {
            console.error('[Inventory Sync] Shop profile sync failed:', err.message);
        }
    }

    async obterPerfil() {
        await this.sincronizarPerfil();
        return this.tentar(() => {
            const profile = this.db.prepare('SELECT * FROM shop_profile LIMIT 1').get();
            return { success: true, profile: profile || null };
        });
    }

    gravarPerfil({ name, type, details, contact }) {
        const existing = this.db.prepare('SELECT id FROM shop_profile LIMIT 1').get();
        if (existing) {
            this.db.prepare('UPDATE shop_profile SET name = ?, type = ?, details = ?, contact = ? WHERE id = ?')
                .run(name, type, details, contact, existing.id);
            return existing.id;
        }
        const res = this.db.prepare('INSERT INTO shop_profile (name, type, details, contact) VALUES (?, ?, ?, ?)')
            .run(name, type, details, contact);
        return res.lastInsertRowid;
    }

    async salvarPerfil({ name, type, details, contact }) {
        return this.tentar(() => {
            const profileId = this.gravarPerfil({ name, type, details, contact });
            if (this.supabase) {
                nuvem.avisarSeFalhar(this.supabase.from('shop_profile').upsert({
                    id: profileId,
                    name,
                    type,
                    details,
                    contact
                }), '[Inventory Sync] Shop profile upsert failed:');
            }
            return { success: true };
        });
    }

    async obterAjustes() {
        return this.tentar(() => {
            const rows = this.db.prepare('SELECT * FROM inventory_settings').all();
            const settings = {};
            for (const row of rows) {
                settings[row.key] = row.value;
            }
            return { success: true, settings };
        });
    }

    async salvarAjustes(settings) {
        return this.tentar(() => {
            const transaction = this.db.transaction(() => {
                const stmt = this.db.prepare('INSERT OR REPLACE INTO inventory_settings (key, value) VALUES (?, ?)');
                for (const key in settings) {
                    stmt.run(key, String(settings[key]));
                }
            });
            transaction();
            return { success: true };
        });
    }

    registerIPCHandlers() {
        ipcMain.handle('inventory:save-cloud-keys', (e, dados) => nuvem.salvarChavesDaNuvem(this, dados));
        ipcMain.handle('inventory:get-cloud-status', () => nuvem.estadoDaNuvem(this));
        ipcMain.handle('inventory:activate-cloud', (e, dados) => nuvem.ativarNuvem(this, dados));
        ipcMain.handle('inventory:disconnect-cloud', () => nuvem.desligarNuvem(this));
        ipcMain.handle('inventory:check-pin', (e, dados) => this.verificarPin(dados));
        ipcMain.handle('inventory:update-pin', (e, dados) => this.trocarPin(dados));
        ipcMain.handle('inventory:get-categories', () => produtos.obterCategorias(this));
        ipcMain.handle('inventory:add-category', (e, dados) => produtos.adicionarCategoria(this, dados));
        ipcMain.handle('inventory:delete-category', (e, id) => produtos.apagarCategoria(this, id));
        ipcMain.handle('inventory:get-vault-dir', () => VAULT_DIR);
        ipcMain.handle('inventory:get-products', () => produtos.obterProdutos(this));
        ipcMain.handle('inventory:add-product', (e, productData) => produtos.adicionarProduto(this, productData));
        ipcMain.handle('inventory:update-product', (e, dados) => produtos.atualizarProduto(this, dados));
        ipcMain.handle('inventory:delete-product', (e, id) => produtos.apagarProduto(this, id));
        ipcMain.handle('inventory:checkout', (e, dados) => vendas.fecharVenda(this, dados));
        ipcMain.handle('inventory:get-transactions', () => vendas.obterVendas(this));
        ipcMain.handle('inventory:get-movements', () => vendas.obterMovimentos(this));
        ipcMain.handle('inventory:get-ledger', () => vendas.obterLancamentos(this));
        ipcMain.handle('inventory:add-expense', (e, dados) => vendas.lancarDespesa(this, dados));
        ipcMain.handle('inventory:run-audit-check', (e, counts) => produtos.conferirContagem(this, counts));
        ipcMain.handle('inventory:fuzzy-query', (e, query) => produtos.buscaAproximada(this, query));
        ipcMain.handle('inventory:create-zip-backup', () => this.criarBackupZip());
        ipcMain.handle('inventory:restore-zip-backup', () => this.restaurarBackupZip());
        ipcMain.handle('inventory:get-shop-profile', () => this.obterPerfil());
        ipcMain.handle('inventory:save-shop-profile', (e, dados) => this.salvarPerfil(dados));
        ipcMain.handle('inventory:get-settings', () => this.obterAjustes());
        ipcMain.handle('inventory:save-settings', (e, settings) => this.salvarAjustes(settings));
        ipcMain.handle('inventory:send-whatsapp-receipt', (e, dados) => vendas.enviarRecibo(this, dados));
        ipcMain.handle('inventory:get-khata-customers', () => vendas.obterClientesDoKhata(this));
        ipcMain.handle('inventory:add-khata-customer', (e, dados) => vendas.adicionarClienteDoKhata(this, dados));
        ipcMain.handle('inventory:add-khata-transaction', (e, dados) => vendas.lancarNoKhata(this, dados));
        ipcMain.handle('inventory:get-khata-transactions', (e, customerId) => vendas.obterLancamentosDoKhata(this, customerId));
        ipcMain.handle('inventory:delete-khata-customer', (e, customerId) => vendas.apagarClienteDoKhata(this, customerId));
    }
}

const inventoryManager = new InventoryManager();
module.exports = { inventoryManager };
