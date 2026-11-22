'use strict';

const { avisarSeFalhar, copiaDaLinha, copiarParaANuvem, copiarUltimoMovimento, sincronizar, trazerDaNuvem } = require('./inventory-nuvem');

const FORMAS_DE_FIADO = new Set(['Credit', 'Udhaar']);
const SEPARADOR_DO_RECIBO = '----------------------------------------------';

const PUXAR_VENDAS = {
    consulta: supabase => supabase.from('transactions').select('*'),
    sql: `
                            INSERT OR REPLACE INTO transactions (id, type, total_amount, payment_method, created_at)
                            VALUES (?, ?, ?, ?, ?)
                        `,
    valores: t => [t.id, t.type, t.total_amount, t.payment_method, t.created_at],
};

const PUXAR_ITENS_DAS_VENDAS = {
    consulta: supabase => supabase.from('transaction_items').select('*'),
    sql: `
                            INSERT OR REPLACE INTO transaction_items (id, transaction_id, product_id, quantity, price)
                            VALUES (?, ?, ?, ?, ?)
                        `,
    valores: ti => [ti.id, ti.transaction_id, ti.product_id, ti.quantity, ti.price],
};

const PUXAR_MOVIMENTOS = {
    consulta: supabase => supabase.from('stock_movements').select('*'),
    sql: `
                            INSERT OR REPLACE INTO stock_movements (id, product_id, change_qty, reason, user_role, created_at)
                            VALUES (?, ?, ?, ?, ?, ?)
                        `,
    valores: sm => [sm.id, sm.product_id, sm.change_qty, sm.reason, sm.user_role, sm.created_at],
};

const PUXAR_LANCAMENTOS = {
    consulta: supabase => supabase.from('ledger').select('*'),
    sql: `
                            INSERT OR REPLACE INTO ledger (id, type, amount, category, notes, created_at)
                            VALUES (?, ?, ?, ?, ?, ?)
                        `,
    valores: l => [l.id, l.type, l.amount, l.category, l.notes, l.created_at],
};

const PUXAR_CLIENTES_DO_KHATA = {
    consulta: supabase => supabase.from('khata_customers').select('*').order('name', { ascending: true }),
    sql: `
                            INSERT OR REPLACE INTO khata_customers (id, name, phone, balance, created_at)
                            VALUES (?, ?, ?, ?, ?)
                        `,
    valores: c => [c.id, c.name, c.phone, c.balance, c.created_at],
    aoRecusar: '[Inventory Sync] Failed to get khata customers from Supabase:',
};

const puxarLancamentosDoKhata = customerId => ({
    consulta: supabase => supabase.from('khata_transactions').select('*').eq('customer_id', customerId).order('date', { ascending: true }),
    sql: `
                            INSERT OR REPLACE INTO khata_transactions (id, customer_id, type, amount, notes, date, created_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?)
                        `,
    valores: tx => [tx.id, tx.customer_id, tx.type, tx.amount, tx.notes, tx.date, tx.created_at],
    aoRecusar: '[Inventory Sync] Failed to fetch khata transactions from Supabase:',
});

const ITENS_DA_VENDA = `
                        SELECT ti.*, p.name, p.sku 
                        FROM transaction_items ti
                        LEFT JOIN products p ON ti.product_id = p.id
                        WHERE ti.transaction_id = ?
                    `;

const LISTA_DE_MOVIMENTOS = `
                    SELECT sm.*, p.name as product_name, p.sku 
                    FROM stock_movements sm
                    LEFT JOIN products p ON sm.product_id = p.id
                    ORDER BY sm.created_at DESC
                `;

const LANCAMENTO_DA_VENDA = "SELECT * FROM ledger WHERE (category = 'POS Sale' OR category = 'POS Sale (Udhaar)') AND notes = ?";
const LANCAMENTO_DO_KHATA_COM_DATA = `INSERT INTO khata_transactions (customer_id, type, amount, notes, date) VALUES (?, ?, ?, ?, ?)`;
const LANCAMENTO_DO_KHATA_SEM_DATA = `INSERT INTO khata_transactions (customer_id, type, amount, notes) VALUES (?, ?, ?, ?)`;

const vendaFiada = (paymentMethod, customerId) => FORMAS_DE_FIADO.has(paymentMethod) && customerId;

function totalDaVenda(db, items) {
    let totalVal = 0;
    for (const item of items) {
        const prod = db.prepare('SELECT sell_price, quantity, name FROM products WHERE id = ?').get(item.productId);
        if (!prod) throw new Error(`Product ID ${item.productId} not found`);
        if (prod.quantity < item.quantity) throw new Error(`Not enough stock for ${prod.name}. Available: ${prod.quantity}`);
        totalVal += prod.sell_price * item.quantity;
    }
    return totalVal;
}

function baixarItemDoEstoque(db, txId, item) {
    const prod = db.prepare('SELECT sell_price, quantity, name FROM products WHERE id = ?').get(item.productId);
    const newQty = prod.quantity - item.quantity;
    db.prepare('UPDATE products SET quantity = ? WHERE id = ?').run(newQty, item.productId);
    db.prepare(`
                            INSERT INTO transaction_items (transaction_id, product_id, quantity, price)
                            VALUES (?, ?, ?, ?)
                        `).run(txId, item.productId, item.quantity, prod.sell_price);
    db.prepare(`
                            INSERT INTO stock_movements (product_id, change_qty, reason, user_role)
                            VALUES (?, ?, ?, ?)
                        `).run(item.productId, -item.quantity, 'SALE', 'cashier');
}

function lancarFiadoNoKhata(db, customerId, finalAmount, txId) {
    db.prepare(`
                            INSERT INTO khata_transactions (customer_id, type, amount, notes)
                            VALUES (?, 'GIVE', ?, ?)
                        `).run(customerId, finalAmount, `POS Bill checkout (Invoice #${txId})`);
    db.prepare(`
                            UPDATE khata_customers SET balance = balance + ? WHERE id = ?
                        `).run(finalAmount, customerId);
}

function registrarVenda(db, { items, paymentMethod, discount, customerId }) {
    const finalAmount = Math.max(0, totalDaVenda(db, items) - (discount || 0));
    const txRes = db.prepare(`
                        INSERT INTO transactions (type, total_amount, payment_method, customer_id)
                        VALUES ('OUT', ?, ?, ?)
                    `).run(finalAmount, paymentMethod, customerId || null);
    const txId = txRes.lastInsertRowid;
    for (const item of items) baixarItemDoEstoque(db, txId, item);
    if (vendaFiada(paymentMethod, customerId)) lancarFiadoNoKhata(db, customerId, finalAmount, txId);
    const ledgerCategory = FORMAS_DE_FIADO.has(paymentMethod) ? 'POS Sale (Udhaar)' : 'POS Sale';
    db.prepare(`
                        INSERT INTO ledger (type, amount, category, notes)
                        VALUES ('REVENUE', ?, ?, ?)
                    `).run(finalAmount, ledgerCategory, `Sale invoice #${txId}`);
    return txId;
}

function espelharItensDaVenda(gerente, invoiceId, txItems) {
    const dbItems = txItems.map(item => ({
        id: item.id,
        transaction_id: invoiceId,
        product_id: item.product_id,
        quantity: item.quantity,
        price: item.price
    }));
    avisarSeFalhar(gerente.supabase.from('transaction_items').insert(dbItems), '[Inventory Sync] Transaction items sync failed:');
}

function espelharCabecalhoDaVenda(gerente, invoiceId) {
    const tx = gerente.db.prepare('SELECT * FROM transactions WHERE id = ?').get(invoiceId);
    const txItems = gerente.db.prepare('SELECT * FROM transaction_items WHERE transaction_id = ?').all(invoiceId);
    gerente.supabase.from('transactions').insert({
        id: invoiceId,
        type: 'OUT',
        total_amount: tx.total_amount,
        payment_method: tx.payment_method,
        customer_id: tx.customer_id,
        created_at: tx.created_at
    }).then(({ error }) => {
        if (error) console.error('[Inventory Sync] Transaction sync failed:', error.message);
        espelharItensDaVenda(gerente, invoiceId, txItems);
    });
}

function espelharEstoqueVendido(gerente, items) {
    for (const item of items) {
        const prod = gerente.db.prepare('SELECT quantity FROM products WHERE id = ?').get(item.productId);
        avisarSeFalhar(gerente.supabase.from('products').update({ quantity: prod.quantity }).eq('id', item.productId), '[Inventory Sync] Stock sync failed:');
        copiarUltimoMovimento(gerente, item.productId, '[Inventory Sync] Stock movement checkout sync failed:');
    }
}

function espelharSaldoDoCliente(gerente, customerId, mensagem) {
    const customer = gerente.db.prepare('SELECT balance FROM khata_customers WHERE id = ?').get(customerId);
    if (customer) {
        avisarSeFalhar(gerente.supabase.from('khata_customers').update({ balance: customer.balance }).eq('id', customerId), mensagem);
    }
}

function espelharFiado(gerente, customerId, invoiceId) {
    const khataTx = gerente.db.prepare('SELECT * FROM khata_transactions WHERE customer_id = ? AND notes LIKE ? ORDER BY id DESC LIMIT 1')
        .get(customerId, `%Invoice #${invoiceId}%`);
    copiarParaANuvem(gerente.supabase, 'khata_transactions', khataTx, '[Inventory Sync] Khata POS transaction sync failed:');
    espelharSaldoDoCliente(gerente, customerId, '[Inventory Sync] Customer POS balance sync failed:');
}

function espelharReceitaDaVenda(gerente, invoiceId) {
    const ledgerEntry = gerente.db.prepare(LANCAMENTO_DA_VENDA).get(`Sale invoice #${invoiceId}`);
    if (ledgerEntry) {
        avisarSeFalhar(gerente.supabase.from('ledger').insert({ ...copiaDaLinha('ledger', ledgerEntry), type: 'REVENUE' }), '[Inventory Sync] Ledger entry sync failed:');
    }
}

function espelharVenda(gerente, invoiceId, { items, paymentMethod, customerId }) {
    espelharCabecalhoDaVenda(gerente, invoiceId);
    espelharEstoqueVendido(gerente, items);
    if (vendaFiada(paymentMethod, customerId)) espelharFiado(gerente, customerId, invoiceId);
    espelharReceitaDaVenda(gerente, invoiceId);
}

async function fecharVenda(gerente, { items, paymentMethod, discount, customerId }) {
    const venda = { items, paymentMethod, discount, customerId };
    return gerente.tentar(() => {
        const transaction = gerente.db.transaction(() => registrarVenda(gerente.db, venda));
        const invoiceId = transaction();
        if (gerente.supabase) espelharVenda(gerente, invoiceId, venda);
        for (const item of items) {
            gerente.checkLowStockAlert(item.productId);
        }
        gerente.agendarBackup();
        return { success: true, invoiceId };
    });
}

async function obterVendas(gerente) {
    await sincronizar(gerente, [PUXAR_VENDAS, PUXAR_ITENS_DAS_VENDAS], '[Inventory Sync] Transactions sync failed:');
    return gerente.tentar(() => {
        const txs = gerente.db.prepare('SELECT * FROM transactions ORDER BY created_at DESC').all();
        for (const tx of txs) {
            tx.items = gerente.db.prepare(ITENS_DA_VENDA).all(tx.id);
        }
        return { success: true, transactions: txs };
    });
}

async function obterMovimentos(gerente) {
    await sincronizar(gerente, [PUXAR_MOVIMENTOS], '[Inventory Sync] Movements sync failed:');
    return gerente.tentar(() => {
        const movements = gerente.db.prepare(LISTA_DE_MOVIMENTOS).all();
        return { success: true, movements };
    });
}

async function obterLancamentos(gerente) {
    await sincronizar(gerente, [PUXAR_LANCAMENTOS], '[Inventory Sync] Ledger sync failed:');
    return gerente.tentar(() => {
        const ledger = gerente.db.prepare('SELECT * FROM ledger ORDER BY created_at DESC').all();
        return { success: true, ledger };
    });
}

async function lancarDespesa(gerente, { amount, category, notes }) {
    return gerente.tentar(() => {
        const res = gerente.db.prepare(`
                    INSERT INTO ledger (type, amount, category, notes)
                    VALUES ('EXPENSE', ?, ?, ?)
                `).run(amount, category, notes);
        const ledgerId = res.lastInsertRowid;
        if (gerente.supabase) {
            avisarSeFalhar(gerente.supabase.from('ledger').insert({
                id: ledgerId,
                type: 'EXPENSE',
                amount,
                category,
                notes
            }), '[Inventory Sync] Expense sync failed:');
        }
        return { success: true };
    });
}

function contatoNoWhatsApp(customerPhone) {
    let targetPhone = String(customerPhone).trim().replace(/\D/g, '');
    if (targetPhone.startsWith('0')) {
        targetPhone = '92' + targetPhone.substring(1);
    }
    return targetPhone + '@c.us';
}

function textoDoRecibo(shopName, { invoiceId, items, total, discount, paymentMethod }) {
    let itemsList = '';
    for (const item of items) {
        itemsList += `• *${item.name}* (x${item.quantity}) — Rs. ${(item.price * item.quantity).toFixed(2)}\n`;
    }
    return `🧾 *RECEIPT: ${shopName.toUpperCase()}*\n` +
        `${SEPARADOR_DO_RECIBO}\n` +
        `*Invoice ID:* #${invoiceId}\n` +
        `*Date:* ${new Date().toLocaleString()}\n` +
        `*Payment:* ${paymentMethod}\n` +
        `${SEPARADOR_DO_RECIBO}\n` +
        `*Items:* \n${itemsList}` +
        `${SEPARADOR_DO_RECIBO}\n` +
        (discount > 0 ? `*Discount:* Rs. ${discount.toFixed(2)}\n` : '') +
        `*Grand Total:* *Rs. ${total.toFixed(2)}*\n` +
        `${SEPARADOR_DO_RECIBO}\n` +
        `*Shukriya! Hamari shop par aane ke liye.* 🙏\n` +
        `Nova Desktop Assistant`;
}

async function enviarRecibo(gerente, { invoiceId, items, total, discount, paymentMethod, customerPhone }) {
    return gerente.tentarAssincrono(async () => {
        const wm = gerente.whatsapp();
        if (!wm) return { success: false, error: 'WhatsApp client is not running or connected' };
        const profile = gerente.db.prepare('SELECT name FROM shop_profile LIMIT 1').get();
        const shopName = profile ? profile.name : 'Nova Store';
        const targetJid = contatoNoWhatsApp(customerPhone);
        const msg = textoDoRecibo(shopName, { invoiceId, items, total, discount, paymentMethod });
        await wm.sendReply(targetJid, msg, true);
        return { success: true };
    });
}

async function obterClientesDoKhata(gerente) {
    return gerente.tentarAssincrono(async () => {
        if (gerente.supabase) await trazerDaNuvem(gerente, PUXAR_CLIENTES_DO_KHATA);
        const customers = gerente.db.prepare('SELECT * FROM khata_customers ORDER BY name ASC').all();
        return { success: true, customers };
    });
}

function inserirClienteDoKhata(db, name, phone, balance) {
    const res = db.prepare(`
                        INSERT INTO khata_customers (name, phone, balance)
                        VALUES (?, ?, ?)
                    `).run(name, phone, balance);
    const customerId = res.lastInsertRowid;
    if (balance > 0) {
        db.prepare(`
                            INSERT INTO khata_transactions (customer_id, type, amount, notes)
                            VALUES (?, 'GIVE', ?, ?)
                        `).run(customerId, balance, 'Starting Balance (Pehla Udhaar)');
    }
    return customerId;
}

function espelharPrimeiroLancamento(gerente, customerId) {
    const firstTx = gerente.db.prepare('SELECT * FROM khata_transactions WHERE customer_id = ? ORDER BY id ASC LIMIT 1').get(customerId);
    copiarParaANuvem(gerente.supabase, 'khata_transactions', firstTx, '[Inventory Sync] Failed to insert starting transaction to Supabase:');
}

function espelharClienteNovo(gerente, customerId, balance) {
    const customer = gerente.db.prepare('SELECT * FROM khata_customers WHERE id = ?').get(customerId);
    gerente.supabase.from('khata_customers').insert(copiaDaLinha('khata_customers', customer)).then(({ error }) => {
        if (error) console.error('[Inventory Sync] Failed to insert customer to Supabase:', error.message);
        if (balance > 0) espelharPrimeiroLancamento(gerente, customerId);
    });
}

async function adicionarClienteDoKhata(gerente, { name, phone, balance = 0 }) {
    return gerente.tentar(() => {
        const transaction = gerente.db.transaction(() => inserirClienteDoKhata(gerente.db, name, phone, balance));
        const customerId = transaction();
        if (gerente.supabase) espelharClienteNovo(gerente, customerId, balance);
        return { success: true, customerId };
    });
}

function inserirLancamentoDoKhata(db, { customerId, type, amount, notes, date }) {
    const res = db.prepare(
        date ? LANCAMENTO_DO_KHATA_COM_DATA : LANCAMENTO_DO_KHATA_SEM_DATA
    ).run(customerId, type, amount, notes, ...(date ? [date] : []));
    const txId = res.lastInsertRowid;
    const balanceDiff = type === 'GIVE' ? amount : -amount;
    db.prepare('UPDATE khata_customers SET balance = balance + ? WHERE id = ?')
        .run(balanceDiff, customerId);
    return txId;
}

function espelharLancamentoDoKhata(gerente, txId, customerId) {
    const tx = gerente.db.prepare('SELECT * FROM khata_transactions WHERE id = ?').get(txId);
    const customer = gerente.db.prepare('SELECT * FROM khata_customers WHERE id = ?').get(customerId);
    gerente.supabase.from('khata_transactions').insert(copiaDaLinha('khata_transactions', tx)).then(({ error }) => {
        if (error) console.error('[Inventory Sync] Failed to sync khata transaction to Supabase:', error.message);
        avisarSeFalhar(gerente.supabase.from('khata_customers').update({ balance: customer.balance }).eq('id', customerId), '[Inventory Sync] Failed to sync customer balance to Supabase:');
    });
}

async function lancarNoKhata(gerente, { customerId, type, amount, notes, date }) {
    return gerente.tentar(() => {
        const transaction = gerente.db.transaction(() => inserirLancamentoDoKhata(gerente.db, { customerId, type, amount, notes, date }));
        const txId = transaction();
        if (gerente.supabase) espelharLancamentoDoKhata(gerente, txId, customerId);
        return { success: true, txId };
    });
}

async function obterLancamentosDoKhata(gerente, customerId) {
    return gerente.tentarAssincrono(async () => {
        if (gerente.supabase) await trazerDaNuvem(gerente, puxarLancamentosDoKhata(customerId));
        const txs = gerente.db.prepare('SELECT * FROM khata_transactions WHERE customer_id = ? ORDER BY date DESC, id DESC').all(customerId);
        return { success: true, transactions: txs };
    });
}

async function apagarClienteDoKhata(gerente, customerId) {
    return gerente.tentar(() => {
        gerente.db.prepare('DELETE FROM khata_customers WHERE id = ?').run(customerId);
        if (gerente.supabase) {
            avisarSeFalhar(gerente.supabase.from('khata_customers').delete().eq('id', customerId), '[Inventory Sync] Failed to delete customer from Supabase:');
        }
        return { success: true };
    });
}

module.exports = {
    fecharVenda,
    obterVendas,
    obterMovimentos,
    obterLancamentos,
    lancarDespesa,
    enviarRecibo,
    obterClientesDoKhata,
    adicionarClienteDoKhata,
    lancarNoKhata,
    obterLancamentosDoKhata,
    apagarClienteDoKhata,
};
