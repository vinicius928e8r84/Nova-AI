'use strict';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const JPEG = 'data:image/jpeg;base64,/9j/4AAQ';

const NUVEM_CONFIGURADA = "INSERT INTO inventory_settings (key, value) VALUES ('supabase_url', 'https://loja.supabase.co'), ('supabase_key', 'chave-anon');";

const SMTP_COMPLETO = {
  auto_backup: 'true', smtp_sender: 'loja@exemplo.com', smtp_password: 'senha-de-app', smtp_receiver: 'dono@exemplo.com',
  smtp_host: 'smtp.exemplo.com', smtp_port: '587',
};

const TABELAS_DA_NUVEM = {
  categories: { data: [{ id: 7, name: 'Bebidas', description: 'frias', template_json: '{"litros":1}' }, { id: 8, name: 'Doces', description: null, template: { peso: 'g' } }, { id: 9, name: 'Outros', description: '', template_json: { cor: 'azul' } }], error: null },
  products: { data: [{ id: 40, sku: 'N-40', name: 'Suco de uva', category_id: 7, quantity: 3, min_stock_alert: 5, cost_price: 2, sell_price: 4.5, image_path: null, custom_attributes: '{"sabor":"uva"}', created_at: '2026-01-01 10:00:00' }, { id: 41, sku: 'N-41', name: 'Bala', category_id: 8, quantity: 100, min_stock_alert: 10, cost_price: 0.1, sell_price: 0.25, image_path: 'inventory/product_images/bala.png', custom_attributes: { cor: 'verde' }, created_at: '2026-01-02 10:00:00' }, { id: 42, sku: 'N-42', name: 'Sem atributos', category_id: null, quantity: 0, min_stock_alert: 1, cost_price: 1, sell_price: 2, image_path: null, custom_attributes: null, created_at: '2026-01-03 10:00:00' }], error: null },
  transactions: { data: [{ id: 90, type: 'OUT', total_amount: 9, payment_method: 'Cash', created_at: '2026-02-01 09:00:00' }], error: null },
  transaction_items: { data: [{ id: 91, transaction_id: 90, product_id: 40, quantity: 2, price: 4.5 }], error: null },
  stock_movements: { data: [{ id: 70, product_id: 40, change_qty: -2, reason: 'SALE', user_role: 'cashier', created_at: '2026-02-01 09:00:00' }], error: null },
  ledger: { data: [{ id: 60, type: 'REVENUE', amount: 9, category: 'POS Sale', notes: 'Sale invoice #90', created_at: '2026-02-01 09:00:00' }], error: null },
  shop_profile: { data: { id: 5, name: 'Loja da Nuvem', type: 'Mercado', details: 'centro', contact: '0300' }, error: null },
  khata_customers: { data: [{ id: 30, name: 'Zeca', phone: '0301', balance: 12, created_at: '2026-03-01 08:00:00' }, { id: 31, name: 'Ana', phone: null, balance: 0, created_at: '2026-03-02 08:00:00' }], error: null },
  khata_transactions: { data: [{ id: 80, customer_id: 30, type: 'GIVE', amount: 12, notes: 'fiado', date: '2026-03-01 08:00:00', created_at: '2026-03-01 08:00:00' }], error: null },
};

const iniciar = (palco, gerente, whatsapp) => gerente.init(palco.whatsapp(whatsapp));

const produto = (sku, extras = {}) => ({ sku, name: 'Produto ' + sku, categoryId: '', quantity: 10, minStockAlert: 2, costPrice: 1.5, sellPrice: 3, ...extras });

async function chamarTodos(palco, pedidos) {
  for (const [canal, ...argumentos] of pedidos) await palco.chamar(canal, ...argumentos);
}

async function montarLoja(palco) {
  await chamarTodos(palco, [
    ['inventory:add-category', { name: 'Mercearia', description: 'secos', template: { peso: 'kg' } }],
    ['inventory:add-product', produto('A-1', { categoryId: 1, quantity: 5, minStockAlert: 3 })],
    ['inventory:add-product', produto('B-2', { categoryId: '1', quantity: 0, customAttributes: { cor: 'azul' } })],
    ['inventory:add-product', produto('C-3', { categoryId: 0, imageBase64: PNG, sellPrice: 10 })],
    ['inventory:add-khata-customer', { name: 'Bilal', phone: '0300', balance: 0 }],
  ]);
}

async function chamarLeituras(palco) {
  await chamarTodos(palco, [
    ['inventory:get-categories'], ['inventory:get-products'], ['inventory:get-transactions'], ['inventory:get-movements'],
    ['inventory:get-ledger'], ['inventory:get-shop-profile'], ['inventory:get-khata-customers'], ['inventory:get-khata-transactions', 30],
  ]);
}

const CENAS_DE_INICIO = [
  {
    nome: 'início local: tabelas, PINs padrão e configurações',
    rodar: async (palco, gerente) => {
      iniciar(palco, gerente);
      await chamarTodos(palco, [
        ['inventory:get-vault-dir'],
        ['inventory:check-pin', { role: 'owner', pin: '1234' }],
        ['inventory:check-pin', { role: 'cashier', pin: 1234 }],
        ['inventory:check-pin', { role: 'gerente', pin: '1' }],
        ['inventory:update-pin', { role: 'cashier', oldPin: '9999', newPin: '1111' }],
        ['inventory:update-pin', { role: 'cashier', oldPin: '1234', newPin: '1111' }],
        ['inventory:check-pin', { role: 'cashier', pin: '1111' }],
        ['inventory:get-settings'],
        ['inventory:save-settings', { tema: 'escuro', limite: 5, ligado: true }],
        ['inventory:save-settings', null],
        ['inventory:get-settings'],
        ['inventory:check-pin'],
        ['inventory:update-pin', { role: 'owner', oldPin: '1234', newPin: true }],
      ]);
    },
  },
  {
    nome: 'início com o banco que não abre',
    cenario: { falhaAoAbrir: true },
    rodar: async (palco, gerente) => {
      iniciar(palco, gerente);
      await palco.chamar('inventory:get-vault-dir');
    },
  },
  {
    nome: 'vault de desenvolvimento quando a pasta do app tem Nova_Vault',
    preparar: palco => palco.semearPasta('app/Nova_Vault'),
    rodar: async (palco, gerente) => {
      iniciar(palco, gerente);
      await palco.chamar('inventory:get-vault-dir');
    },
  },
  {
    nome: 'app empacotado usa Documentos mesmo com Nova_Vault no app',
    cenario: { empacotado: true },
    preparar: palco => palco.semearPasta('app/Nova_Vault'),
    rodar: async (palco, gerente) => {
      iniciar(palco, gerente);
      await palco.chamar('inventory:get-vault-dir');
    },
  },
  {
    nome: 'migração: tabela de vendas antiga com CHECK e sem customer_id',
    preparar: palco => palco.semear(`
      CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT UNIQUE, pin_hash TEXT NOT NULL);
      INSERT INTO users (role, pin_hash) VALUES ('owner', 'x');
      CREATE TABLE transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT CHECK(type IN ('IN', 'OUT')), total_amount REAL NOT NULL, payment_method TEXT CHECK(payment_method IN ('Cash', 'Card', 'Mobile')), created_at TIMESTAMP DEFAULT '2025-01-01');
      INSERT INTO transactions (type, total_amount, payment_method) VALUES ('OUT', 10, 'Cash'), ('IN', 0, 'Card');
      CREATE TABLE transaction_items (id INTEGER PRIMARY KEY AUTOINCREMENT, transaction_id INTEGER REFERENCES transactions(id) ON DELETE CASCADE, product_id INTEGER, quantity INTEGER NOT NULL, price REAL NOT NULL);
      INSERT INTO transaction_items (transaction_id, product_id, quantity, price) VALUES (1, 1, 2, 5);
    `),
    rodar: async (palco, gerente) => {
      iniciar(palco, gerente);
      await palco.chamar('inventory:get-transactions');
    },
  },
  {
    nome: 'migração: itens da venda apontando para transactions_old',
    preparar: palco => palco.semear(`
      PRAGMA legacy_alter_table = ON;
      CREATE TABLE transactions_old (id INTEGER PRIMARY KEY);
      CREATE TABLE transaction_items (id INTEGER PRIMARY KEY AUTOINCREMENT, transaction_id INTEGER REFERENCES transactions_old(id), product_id INTEGER, quantity INTEGER NOT NULL, price REAL NOT NULL);
      INSERT INTO transaction_items (transaction_id, product_id, quantity, price) VALUES (4, 2, 1, 7.5);
    `),
    rodar: (palco, gerente) => iniciar(palco, gerente),
  },
];

const CENAS_DA_LOJA = [
  {
    nome: 'categorias e produtos sem nuvem',
    rodar: async (palco, gerente) => {
      iniciar(palco, gerente);
      await montarLoja(palco);
      await chamarTodos(palco, [
        ['inventory:add-category', { name: 'Mercearia', description: 'repetida' }],
        ['inventory:add-category', { name: 'Limpeza' }],
        ['inventory:add-product', produto('A-1')],
        ['inventory:add-product', produto('F-6', { categoryId: 9 })],
        ['inventory:add-product', produto('D-4', { categoryId: null, imageBase64: JPEG, customAttributes: null })],
        ['inventory:add-product', produto('E-5', { categoryId: '0', quantity: undefined })],
        ['inventory:add-product', produto('G-7', { categoryId: '0', quantity: 1 })],
        ['inventory:get-categories'],
        ['inventory:get-products'],
        ['inventory:update-product', { id: 1, data: { quantity: 9 }, role: 'cashier' }],
        ['inventory:update-product', { id: 1, data: { quantity: 4 }, role: 'cashier' }],
        ['inventory:update-product', { id: 1, data: { quantity: 4 }, role: 'cashier' }],
        ['inventory:update-product', { id: 3, data: { imageBase64: JPEG, quantity: 12, costPrice: 2, name: 'Novo nome' }, role: 'owner' }],
        ['inventory:update-product', { id: 3, data: { categoryId: '', quantity: 1 } }],
        ['inventory:update-product', { id: 3, data: { categoryId: '1', sku: 'C-33', minStockAlert: 0, sellPrice: 11, customAttributes: { lote: 2 } } }],
        ['inventory:update-product', { id: 3, data: { categoryId: 0, costPrice: 0, quantity: 5 } }],
        ['inventory:update-product', { id: 1, data: { categoryId: '0' } }],
        ['inventory:update-product', { id: 1, data: { categoryId: '1' } }],
        ['inventory:update-product', { id: 4, data: { imageBase64: PNG, sku: 'D-44' }, role: 'owner' }],
        ['inventory:update-product', { id: 99, data: {} }],
        ['inventory:update-product', { id: 2, data: { quantity: null, minStockAlert: null, costPrice: null, sellPrice: null }, role: 'owner' }],
        ['inventory:update-product', { id: 1, data: { sku: 'C-33' } }],
        ['inventory:run-audit-check', [{ productId: 1, count: 4 }, { productId: 2, count: 3 }, { productId: 77, count: 1 }, { productId: 3, count: 0 }]],
        ['inventory:run-audit-check', null],
        ['inventory:delete-product', 3],
        ['inventory:delete-product', 4],
        ['inventory:delete-product', 50],
        ['inventory:delete-category', 2],
        ['inventory:get-products'],
        ['inventory:get-movements'],
        ['inventory:get-ledger'],
      ]);
    },
  },
  {
    nome: 'busca aproximada por nome e SKU',
    rodar: async (palco, gerente) => {
      iniciar(palco, gerente);
      await chamarTodos(palco, [
        ['inventory:add-product', produto('COLA-2L', { name: 'Coca Cola 2L', customAttributes: { tipo: 'refrigerante' } })],
        ['inventory:add-product', produto('PEPSI', { name: 'Pepsi lata' })],
        ['inventory:add-product', produto('SAB-01', { name: 'Sabonete' })],
        ['inventory:add-product', produto('X', { name: 'X' })],
        ['inventory:add-product', produto('COL-3', { name: 'Colgate' })],
        ['inventory:add-product', produto('COL-4', { name: 'Colher' })],
        ['inventory:add-product', produto('COL-5', { name: 'Coleira' })],
        ['inventory:add-product', produto('COL-6', { name: 'Colchão' })],
        ['inventory:add-product', produto('KS-9', { name: 'Kit Sopa' })],
        ['inventory:fuzzy-query', 'sopa de legumes caseira grande quente'],
        ['inventory:fuzzy-query', 'coca cola'],
        ['inventory:fuzzy-query', 'col'],
        ['inventory:fuzzy-query', 'refrigerante'],
        ['inventory:fuzzy-query', 'sab-01'],
        ['inventory:fuzzy-query', 'a b'],
        ['inventory:fuzzy-query', '   '],
        ['inventory:fuzzy-query', 'X X'],
        ['inventory:fuzzy-query', 12345],
      ]);
    },
  },
  {
    nome: 'venda no caixa, fiado, despesas e relatórios',
    rodar: async (palco, gerente) => {
      iniciar(palco, gerente);
      await montarLoja(palco);
      await chamarTodos(palco, [
        ['inventory:checkout', { items: [{ productId: 1, quantity: 2 }, { productId: 3, quantity: 1 }], paymentMethod: 'Cash', discount: 1 }],
        ['inventory:checkout', { items: [{ productId: 3, quantity: 2 }], paymentMethod: 'Credit', discount: 0, customerId: 1 }],
        ['inventory:checkout', { items: [{ productId: 3, quantity: 1 }], paymentMethod: 'Udhaar', customerId: 1 }],
        ['inventory:checkout', { items: [{ productId: 3, quantity: 1 }], paymentMethod: 'Udhaar' }],
        ['inventory:checkout', { items: [{ productId: 1, quantity: 1 }], paymentMethod: 'Card', discount: 50 }],
        ['inventory:checkout', { items: [{ productId: 1, quantity: 99 }], paymentMethod: 'Cash' }],
        ['inventory:checkout', { items: [{ productId: 3, quantity: 5 }], paymentMethod: 'Cash' }],
        ['inventory:checkout', { items: [{ productId: 404, quantity: 1 }], paymentMethod: 'Cash' }],
        ['inventory:checkout', { items: [], paymentMethod: 'Mobile' }],
        ['inventory:checkout', { paymentMethod: 'Cash' }],
        ['inventory:add-expense', { amount: 30, category: 'Aluguel', notes: 'novembro' }],
        ['inventory:add-expense', { amount: 5, category: null }],
        ['inventory:get-transactions'],
        ['inventory:get-movements'],
        ['inventory:get-ledger'],
        ['inventory:get-khata-customers'],
        ['inventory:get-khata-transactions', 1],
      ]);
    },
  },
  {
    nome: 'khata: clientes, lançamentos e exclusão',
    rodar: async (palco, gerente) => {
      iniciar(palco, gerente);
      await chamarTodos(palco, [
        ['inventory:add-khata-customer', { name: 'Ali', phone: '0300' }],
        ['inventory:add-khata-customer', { name: 'Sara', phone: '0301', balance: 40 }],
        ['inventory:add-khata-customer', { name: null, phone: '0302' }],
        ['inventory:add-khata-transaction', { customerId: 2, type: 'GET', amount: 15, notes: 'pagou' }],
        ['inventory:add-khata-transaction', { customerId: 2, type: 'GIVE', amount: 5, notes: 'leite', date: '2026-11-01' }],
        ['inventory:add-khata-transaction', { customerId: 1, type: 'GIVE', amount: 2.5, notes: null }],
        ['inventory:add-khata-transaction', { customerId: 1, type: 'TROCA', amount: 1, notes: 'inválido' }],
        ['inventory:add-khata-transaction', { customerId: 99, type: 'GET', amount: 1, notes: 'sem cliente' }],
        ['inventory:get-khata-customers'],
        ['inventory:get-khata-transactions', 2],
        ['inventory:delete-khata-customer', 1],
        ['inventory:delete-khata-customer', 1],
        ['inventory:get-khata-customers'],
        ['inventory:add-khata-transaction'],
      ]);
    },
  },
  {
    nome: 'perfil da loja e recibo no WhatsApp',
    rodar: async (palco, gerente) => {
      iniciar(palco, gerente, { pronto: true });
      const recibo = { invoiceId: 12, items: [{ name: 'Chá', quantity: 2, price: 3.5 }, { name: 'Pão', quantity: 1, price: 2 }], total: 8, discount: 1, paymentMethod: 'Cash' };
      await chamarTodos(palco, [
        ['inventory:get-shop-profile'],
        ['inventory:send-whatsapp-receipt', { ...recibo, customerPhone: '0300-1234567' }],
        ['inventory:save-shop-profile', { name: 'Loja do Bairro', type: 'Mercado', details: 'rua 1', contact: '0300' }],
        ['inventory:save-shop-profile', { name: 'Loja Nova', type: 'Padaria', details: null, contact: null }],
        ['inventory:get-shop-profile'],
        ['inventory:send-whatsapp-receipt', { ...recibo, discount: 0, customerPhone: ' +92 300 7654321 ' }],
        ['inventory:send-whatsapp-receipt', { ...recibo, discount: undefined, customerPhone: 3001112222 }],
        ['inventory:send-whatsapp-receipt', { ...recibo, total: '8', customerPhone: '0' }],
        ['inventory:save-shop-profile', { name: null, type: 'x' }],
      ]);
    },
  },
  {
    nome: 'recibo sem WhatsApp e com envio que falha',
    rodar: async (palco, gerente) => {
      iniciar(palco, gerente, null);
      await palco.chamar('inventory:send-whatsapp-receipt', { invoiceId: 1, items: [], total: 0, discount: 0, paymentMethod: 'Cash', customerPhone: '1' });
      palco.trocarWhatsApp({ falha: 'sessão caiu' });
      await palco.chamar('inventory:send-whatsapp-receipt', { invoiceId: 1, items: [], total: 0, discount: 0, paymentMethod: 'Cash', customerPhone: '1' });
    },
  },
];

const alertaDeEstoque = (nome, whatsapp) => ({
  nome,
  rodar: async (palco, gerente) => {
    iniciar(palco, gerente, whatsapp);
    await montarLoja(palco);
    await chamarTodos(palco, [
      ['inventory:update-product', { id: 1, data: { quantity: 4 }, role: 'cashier' }],
      ['inventory:checkout', { items: [{ productId: 1, quantity: 1 }, { productId: 3, quantity: 1 }], paymentMethod: 'Cash' }],
      ['inventory:update-product', { id: 2, data: { quantity: 1 }, role: 'owner' }],
    ]);
  },
});

const CENAS_DE_ALERTA = [
  alertaDeEstoque('alerta de estoque baixo com WhatsApp pronto', { pronto: true }),
  alertaDeEstoque('alerta de estoque baixo com WhatsApp que não está pronto', { pronto: false }),
  alertaDeEstoque('alerta de estoque baixo com WhatsApp sem cliente', { semCliente: true }),
  alertaDeEstoque('alerta de estoque baixo com envio que falha', { falha: 'sem internet' }),
  alertaDeEstoque('alerta de estoque baixo sem WhatsApp', null),
];

const CENAS_DA_NUVEM = [
  {
    nome: 'nuvem: chaves, estado, login, cadastro e saída',
    cenario: { nuvem: { getSession: { data: { session: { user: { email: 'dono@loja.com' } } }, error: null } } },
    rodar: async (palco, gerente) => {
      iniciar(palco, gerente);
      await chamarTodos(palco, [
        ['inventory:get-cloud-status'],
        ['inventory:activate-cloud', { email: 'dono@loja.com', password: 'x' }],
        ['inventory:save-cloud-keys', { url: 'https://loja.supabase.co', key: 'chave-anon' }],
        ['inventory:get-cloud-status'],
        ['inventory:activate-cloud', { email: 'dono@loja.com', password: 'segredo' }],
      ]);
      palco.armazenamento.setItem('sb-token', 'abc');
      palco.anotar('armazenamento.getItem', palco.armazenamento.getItem('sb-token'), palco.armazenamento.getItem('ausente'));
      palco.armazenamento.removeItem('sb-token');
      palco.anotar('armazenamento.getItem', palco.armazenamento.getItem('sb-token'));
      palco.armazenamento.setItem('sb-outro', 'def');
      palco.cenario.nuvem.signInWithPassword = { data: null, error: { message: 'Invalid login credentials' } };
      palco.cenario.nuvem.getSession = { data: { session: null }, error: { message: 'expirada' } };
      await chamarTodos(palco, [
        ['inventory:activate-cloud', { email: 'novo@loja.com', password: 'segredo' }],
        ['inventory:get-cloud-status'],
      ]);
      palco.cenario.nuvem.signUp = { data: null, error: { message: 'Signups not allowed' } };
      palco.cenario.nuvem.getSession = new Error('fetch failed');
      await chamarTodos(palco, [
        ['inventory:activate-cloud', { email: 'novo@loja.com', password: 'segredo' }],
        ['inventory:get-cloud-status'],
        ['inventory:disconnect-cloud'],
        ['inventory:get-cloud-status'],
        ['inventory:disconnect-cloud'],
      ]);
      palco.cenario.nuvem.signInWithPassword = new Error('rede fora');
      await chamarTodos(palco, [
        ['inventory:save-cloud-keys', { url: 'https://loja.supabase.co', key: 'k2' }],
        ['inventory:activate-cloud', { email: 'a@b.c', password: '1' }],
        ['inventory:save-cloud-keys', { url: '', key: 'k3' }],
        ['inventory:save-cloud-keys', { url: 'https://loja.supabase.co', key: '' }],
        ['inventory:save-cloud-keys', { url: undefined, key: 'k3' }],
        ['inventory:activate-cloud'],
      ]);
      palco.armazenamento.setItem('sb-x', undefined);
      palco.anotar('armazenamento.getItem', palco.armazenamento.getItem(undefined));
    },
  },
  {
    nome: 'nuvem: cliente que não é criado',
    cenario: { nuvem: { falhaAoCriar: true } },
    preparar: palco => palco.semear(NUVEM_CONFIGURADA.replace('INSERT', 'CREATE TABLE inventory_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT')),
    rodar: async (palco, gerente) => {
      iniciar(palco, gerente);
      await chamarTodos(palco, [['inventory:get-cloud-status'], ['inventory:activate-cloud', { email: 'a@b.c', password: '1' }], ['inventory:disconnect-cloud']]);
    },
  },
  {
    nome: 'nuvem: espelhamento das escritas',
    rodar: async (palco, gerente) => {
      iniciar(palco, gerente, { pronto: true });
      await palco.chamar('inventory:save-cloud-keys', { url: 'https://loja.supabase.co', key: 'chave-anon' });
      await montarLoja(palco);
      await chamarTodos(palco, [
        ['inventory:update-product', { id: 1, data: { quantity: 8, costPrice: 2 }, role: 'owner' }],
        ['inventory:update-product', { id: 1, data: { quantity: 6 }, role: 'cashier' }],
        ['inventory:update-product', { id: 1, data: { name: 'Só o nome' }, role: 'owner' }],
        ['inventory:checkout', { items: [{ productId: 1, quantity: 1 }], paymentMethod: 'Cash', discount: 0 }],
        ['inventory:checkout', { items: [{ productId: 3, quantity: 2 }], paymentMethod: 'Credit', customerId: 1 }],
        ['inventory:checkout', { items: [{ productId: 3, quantity: 1 }], paymentMethod: 'Udhaar', customerId: 77 }],
        ['inventory:add-expense', { amount: 12, category: 'Luz', notes: 'conta' }],
        ['inventory:save-shop-profile', { name: 'Loja', type: 'Mercado', details: 'x', contact: 'y' }],
        ['inventory:add-khata-customer', { name: 'Hina', phone: '0303', balance: 25 }],
        ['inventory:add-khata-transaction', { customerId: 2, type: 'GET', amount: 5, notes: 'parcela' }],
        ['inventory:delete-khata-customer', 2],
        ['inventory:delete-product', 2],
        ['inventory:delete-category', 1],
      ]);
    },
  },
  {
    nome: 'nuvem: escritas recusadas pela nuvem',
    cenario: { nuvem: { recusa: ['categories', 'products', 'stock_movements', 'ledger', 'transactions', 'transaction_items', 'khata_transactions', 'khata_customers', 'shop_profile'] } },
    preparar: palco => palco.semear('CREATE TABLE inventory_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);' + NUVEM_CONFIGURADA),
    rodar: async (palco, gerente) => {
      iniciar(palco, gerente);
      await montarLoja(palco);
      await chamarTodos(palco, [
        ['inventory:update-product', { id: 1, data: { quantity: 9 }, role: 'owner' }],
        ['inventory:update-product', { id: 1, data: { quantity: 2 }, role: 'owner' }],
        ['inventory:checkout', { items: [{ productId: 1, quantity: 1 }], paymentMethod: 'Credit', customerId: 1 }],
        ['inventory:add-expense', { amount: 1, category: 'x', notes: 'y' }],
        ['inventory:save-shop-profile', { name: 'Loja', type: 'Mercado' }],
        ['inventory:add-khata-customer', { name: 'Hina', phone: '0303', balance: 25 }],
        ['inventory:add-khata-transaction', { customerId: 2, type: 'GIVE', amount: 5, notes: 'z' }],
        ['inventory:delete-khata-customer', 2],
        ['inventory:delete-product', 2],
        ['inventory:delete-category', 1],
      ]);
    },
  },
  {
    nome: 'nuvem: saída no meio da sincronização da venda',
    rodar: async (palco, gerente) => {
      iniciar(palco, gerente);
      await palco.chamar('inventory:save-cloud-keys', { url: 'https://loja.supabase.co', key: 'chave-anon' });
      await montarLoja(palco);
      const venda = palco.canais.get('inventory:checkout')({}, { items: [{ productId: 1, quantity: 1 }], paymentMethod: 'Cash' });
      const saida = palco.canais.get('inventory:disconnect-cloud')({});
      palco.anotar('retornos', await venda, await saida);
      await palco.esperarTudo();
    },
  },
  {
    nome: 'nuvem: leitura que sobrescreve o banco local',
    cenario: { nuvem: { tabelas: TABELAS_DA_NUVEM } },
    preparar: palco => palco.semear('CREATE TABLE inventory_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);' + NUVEM_CONFIGURADA),
    rodar: async (palco, gerente) => {
      iniciar(palco, gerente);
      await chamarLeituras(palco);
      palco.cenario.nuvem.tabelas = { ...TABELAS_DA_NUVEM, shop_profile: { data: null, error: null }, khata_customers: { data: null, error: { message: 'RLS' } }, khata_transactions: { data: null, error: { message: 'RLS' } }, transactions: { data: null, error: { message: 'x' } } };
      await chamarLeituras(palco);
      const recusadoComDados = linhas => ({ data: linhas, error: { message: 'parcial' } });
      palco.cenario.nuvem.tabelas = {
        categories: recusadoComDados([{ id: 70, name: 'Recusada', description: null, template_json: '{}' }]),
        products: recusadoComDados([{ id: 71, sku: 'R-1', name: 'Recusado', quantity: 1, min_stock_alert: 1, cost_price: 1, sell_price: 1, custom_attributes: '{}' }]),
        transactions: { data: null, error: null },
        transaction_items: recusadoComDados([{ id: 72, transaction_id: 90, product_id: 40, quantity: 9, price: 9 }]),
        stock_movements: recusadoComDados([{ id: 73, product_id: 40, change_qty: 9, reason: 'R', user_role: 'owner', created_at: 'x' }]),
        ledger: recusadoComDados([{ id: 74, type: 'EXPENSE', amount: 9, category: 'c', notes: 'n', created_at: 'x' }]),
        shop_profile: recusadoComDados({ id: 75, name: 'Recusada', type: 't' }),
        khata_customers: { data: null, error: null },
        khata_transactions: { data: [{ id: 76, customer_id: 30, type: 'GET', amount: 1, notes: 'n', date: 'x', created_at: 'x' }], error: { message: 'parcial' } },
      };
      await chamarLeituras(palco);
    },
  },
  {
    nome: 'nuvem: leitura com dados que o banco recusa',
    cenario: { nuvem: { tabelas: {
      categories: { data: [{ id: 1, name: null }], error: null },
      products: { data: [{ id: 1, sku: null }], error: null },
      transactions: { data: [{ id: 1, total_amount: null }], error: null },
      transaction_items: { data: [{ id: 1, quantity: null }], error: null },
      stock_movements: { data: [{ id: 1, reason: null }], error: null },
      ledger: { data: [{ id: 1, amount: null }], error: null },
      shop_profile: { data: { id: 1, name: null }, error: null },
      khata_customers: { data: [{ id: 1, name: null }], error: null },
      khata_transactions: { data: [{ id: 1, amount: null }], error: null },
    } } },
    preparar: palco => palco.semear('CREATE TABLE inventory_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);' + NUVEM_CONFIGURADA),
    rodar: async (palco, gerente) => {
      iniciar(palco, gerente);
      await chamarLeituras(palco);
    },
  },
  ...['categories', 'products', 'transactions', 'transaction_items', 'stock_movements', 'ledger', 'shop_profile', 'khata_customers', 'khata_transactions'].map(tabela => ({
    nome: 'nuvem: rede cai ao ler ' + tabela,
    cenario: { nuvem: { quebra: tabela, tabelas: TABELAS_DA_NUVEM } },
    preparar: palco => palco.semear('CREATE TABLE inventory_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);' + NUVEM_CONFIGURADA),
    rodar: async (palco, gerente) => {
      iniciar(palco, gerente);
      await chamarLeituras(palco);
      await montarLoja(palco);
    },
  })),
];

const restauracao = (nome, cenario) => ({
  nome,
  cenario,
  rodar: async (palco, gerente) => {
    iniciar(palco, gerente);
    await montarLoja(palco);
    await palco.chamar('inventory:restore-zip-backup');
    await palco.chamar('inventory:create-zip-backup');
    palco.proximoDialogo = { canceled: false, filePaths: [palco.ultimoZip()] };
    await chamarTodos(palco, [
      ['inventory:delete-product', 3],
      ['inventory:add-product', produto('DEPOIS', { imageBase64: PNG })],
      ['inventory:restore-zip-backup'],
      ['inventory:get-products'],
    ]);
    palco.proximoDialogo = { canceled: false, filePaths: [] };
    await palco.chamar('inventory:restore-zip-backup');
    palco.proximoDialogo = { canceled: true, filePaths: ['x.zip'] };
    await palco.chamar('inventory:restore-zip-backup');
  },
});

const CENAS_DE_BACKUP = [
  restauracao('backup em zip e restauração no Mac', { plataforma: 'darwin' }),
  restauracao("backup em zip e restauração no Windows (caminho com ')", { plataforma: 'win32', pastaComApostrofo: true }),
  restauracao('restauração com extração que falha', { plataforma: 'darwin', extracaoFalha: 'arquivo corrompido' }),
  restauracao('restauração com extração que falha sem stderr', { plataforma: 'win32', extracaoFalha: 'sem-stderr' }),
  {
    nome: 'restauração de zip sem inventory.db',
    cenario: { plataforma: 'darwin' },
    rodar: async (palco, gerente) => {
      iniciar(palco, gerente);
      await montarLoja(palco);
      palco.proximoDialogo = { canceled: false, filePaths: [palco.zipSoComImagens()] };
      await chamarTodos(palco, [['inventory:restore-zip-backup'], ['inventory:get-products']]);
    },
  },
  {
    nome: 'backup em zip que falha',
    cenario: { zipFalha: true },
    rodar: async (palco, gerente) => {
      iniciar(palco, gerente);
      await montarLoja(palco);
      await chamarTodos(palco, [['inventory:create-zip-backup'], ['inventory:get-products']]);
    },
  },
];

const backupPorEmail = (nome, configuracoes, cenario = {}) => ({
  nome,
  cenario,
  rodar: async (palco, gerente) => {
    iniciar(palco, gerente);
    await palco.chamar('inventory:save-settings', configuracoes);
    await montarLoja(palco);
    await chamarTodos(palco, [
      ['inventory:checkout', { items: [{ productId: 1, quantity: 1 }], paymentMethod: 'Cash' }],
      ['inventory:update-product', { id: 1, data: { quantity: 7 }, role: 'owner' }],
      ['inventory:get-products'],
    ]);
  },
});

const CENAS_DE_EMAIL = [
  backupPorEmail('backup automático por e-mail com SMTP completo', SMTP_COMPLETO),
  backupPorEmail('backup automático por e-mail na porta 465 padrão', { auto_backup: 'true', smtp_sender: 'a@b.c', smtp_password: 'p', smtp_receiver: 'd@e.f' }),
  backupPorEmail('backup automático na porta 465 escrita', { ...SMTP_COMPLETO, smtp_port: '465' }),
  backupPorEmail('backup automático com SMTP incompleto', { auto_backup: 'true', smtp_sender: 'a@b.c', smtp_receiver: 'd@e.f' }),
  backupPorEmail('backup automático desligado', { ...SMTP_COMPLETO, auto_backup: 'false' }),
  backupPorEmail('backup automático com e-mail que falha', SMTP_COMPLETO, { emailFalha: 'auth failed' }),
  backupPorEmail('backup automático com zip que falha', SMTP_COMPLETO, { zipFalha: true }),
];

module.exports = [...CENAS_DE_INICIO, ...CENAS_DA_LOJA, ...CENAS_DE_ALERTA, ...CENAS_DA_NUVEM, ...CENAS_DE_BACKUP, ...CENAS_DE_EMAIL];
