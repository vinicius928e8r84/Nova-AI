'use strict';

const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');

const CAMPOS_DA_COPIA = {
    stock_movements: ['id', 'product_id', 'change_qty', 'reason', 'user_role', 'created_at'],
    ledger: ['id', 'type', 'amount', 'category', 'notes', 'created_at'],
    khata_transactions: ['id', 'customer_id', 'type', 'amount', 'notes', 'date', 'created_at'],
    khata_customers: ['id', 'name', 'phone', 'balance', 'created_at'],
};

const ULTIMO_MOVIMENTO = 'SELECT * FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT 1';
const LANCAMENTO_DE_REPOSICAO = "SELECT * FROM ledger WHERE category = 'Inventory Restock' AND notes = ?";
const SEM_NUVEM = { success: true, configured: false, authenticated: false, email: null };
const SEM_SESSAO = { success: true, configured: true, authenticated: false, email: null };

const copiaDaLinha = (tabela, linha) => Object.fromEntries(CAMPOS_DA_COPIA[tabela].map(campo => [campo, linha[campo]]));

function avisarSeFalhar(consulta, mensagem) {
    consulta.then(({ error }) => {
        if (error) console.error(mensagem, error.message);
    });
}

function copiarParaANuvem(supabase, tabela, linha, mensagem) {
    if (linha) avisarSeFalhar(supabase.from(tabela).insert(copiaDaLinha(tabela, linha)), mensagem);
}

function copiarUltimoMovimento(gerente, productId, mensagem) {
    const movement = gerente.db.prepare(ULTIMO_MOVIMENTO).get(productId);
    copiarParaANuvem(gerente.supabase, 'stock_movements', movement, mensagem);
}

function copiarLancamentoDeReposicao(gerente, notas, mensagem) {
    const ledger = gerente.db.prepare(LANCAMENTO_DE_REPOSICAO).get(notas);
    copiarParaANuvem(gerente.supabase, 'ledger', ledger, mensagem);
}

function gravarLinhas(db, sql, linhas, valores) {
    const insertOrReplace = db.prepare(sql);
    const transaction = db.transaction(() => {
        for (const linha of linhas) insertOrReplace.run(...valores(linha));
    });
    transaction();
}

async function trazerDaNuvem(gerente, { consulta, sql, valores, aoRecusar }) {
    const { data, error } = await consulta(gerente.supabase);
    if (!error && data) return gravarLinhas(gerente.db, sql, data, valores);
    if (error && aoRecusar) console.error(aoRecusar, error.message);
}

async function sincronizar(gerente, puxadas, mensagem) {
    try {
        if (!gerente.supabase) return;
        for (const puxada of puxadas) await trazerDaNuvem(gerente, puxada);
    } catch (err) {
        console.error(mensagem, err.message);
    }
}

function armazenamentoNoBanco(gerente) {
    return {
        getItem: (key) => {
            try {
                const row = gerente.db.prepare('SELECT value FROM inventory_settings WHERE key = ?').get(key);
                return row ? row.value : null;
            } catch (e) {
                return null;
            }
        },
        setItem: (key, value) => {
            try {
                gerente.db.prepare('INSERT OR REPLACE INTO inventory_settings (key, value) VALUES (?, ?)')
                    .run(key, value);
            } catch (e) {}
        },
        removeItem: (key) => {
            try {
                gerente.db.prepare('DELETE FROM inventory_settings WHERE key = ?').run(key);
            } catch (e) {}
        }
    };
}

const valorConfigurado = linha => Boolean(linha && linha.value);

function ligarNuvem(gerente) {
    const urlRow = gerente.db.prepare("SELECT value FROM inventory_settings WHERE key = 'supabase_url'").get();
    const keyRow = gerente.db.prepare("SELECT value FROM inventory_settings WHERE key = 'supabase_key'").get();
    if (!valorConfigurado(urlRow) || !valorConfigurado(keyRow)) {
        console.info('[Inventory] Supabase cloud is not configured.');
        gerente.supabase = null;
        return false;
    }
    gerente.supabase = createClient(urlRow.value, keyRow.value, {
        auth: {
            storage: armazenamentoNoBanco(gerente),
            autoRefreshToken: true,
            persistSession: true,
            detectSessionInUrl: false
        },
        realtime: {
            transport: ws
        }
    });
    console.info('[Inventory] Supabase client initialized successfully.');
    return true;
}

function iniciarNuvem(gerente) {
    try {
        return ligarNuvem(gerente);
    } catch (err) {
        console.error('[Inventory] Supabase initialization failed:', err.message);
        gerente.supabase = null;
        return false;
    }
}

async function salvarChavesDaNuvem(gerente, { url, key }) {
    return gerente.tentar(() => {
        gerente.db.prepare("INSERT OR REPLACE INTO inventory_settings (key, value) VALUES ('supabase_url', ?)")
            .run(url);
        gerente.db.prepare("INSERT OR REPLACE INTO inventory_settings (key, value) VALUES ('supabase_key', ?)")
            .run(key);
        const success = gerente.initSupabase();
        return { success };
    });
}

async function sessaoDaNuvem(gerente) {
    if (!gerente.supabase) gerente.initSupabase();
    if (!gerente.supabase) return { ...SEM_NUVEM };
    const { data: { session }, error } = await gerente.supabase.auth.getSession();
    if (error || !session) return { ...SEM_SESSAO };
    return { success: true, configured: true, authenticated: true, email: session.user.email };
}

async function estadoDaNuvem(gerente) {
    return gerente.tentarAssincrono(() => sessaoDaNuvem(gerente));
}

function prepararNuvemParaEntrar(gerente) {
    if (!gerente.supabase) {
        console.info('[Inventory] Supabase not initialized, running initSupabase...');
        gerente.initSupabase();
    }
    if (gerente.supabase) return true;
    console.info('[Inventory] Supabase initialization failed.');
    return false;
}

async function cadastrarNaNuvem(gerente, credenciais, error) {
    console.info('[Inventory] signInWithPassword failed:', error.message);
    console.info('[Inventory] Attempting signUp fallback...');
    const { data: signUpData, error: signUpError } = await gerente.supabase.auth.signUp(credenciais);
    if (signUpError) {
        console.error('[Inventory] signUp fallback failed:', signUpError.message);
        return { success: false, error: 'Authentication failed: ' + error.message + ' (Signup fallback: ' + signUpError.message + ')' };
    }
    console.info('[Inventory] signUp fallback successful, email:', signUpData.user.email);
    return { success: true, email: signUpData.user.email, message: 'Nova conta na nuvem registrada!' };
}

async function entrarNaNuvem(gerente, email, password) {
    if (!prepararNuvemParaEntrar(gerente)) {
        return { success: false, error: 'Supabase cloud client is not configured. Please save your URL and Key first.' };
    }
    console.info('[Inventory] Attempting signInWithPassword to Supabase...');
    const { data, error } = await gerente.supabase.auth.signInWithPassword({ email, password });
    if (error) return cadastrarNaNuvem(gerente, { email, password }, error);
    console.info('[Inventory] signInWithPassword successful, email:', data.user.email);
    return { success: true, email: data.user.email };
}

async function ativarNuvem(gerente, { email, password }) {
    console.info('[Inventory] activate-cloud handler triggered for:', email);
    try {
        return await entrarNaNuvem(gerente, email, password);
    } catch (err) {
        console.error('[Inventory] Exception in activate-cloud:', err);
        return { success: false, error: err.message };
    }
}

async function sairDaNuvem(gerente) {
    if (gerente.supabase) {
        await gerente.supabase.auth.signOut();
    }
    gerente.db.prepare("DELETE FROM inventory_settings WHERE key = 'supabase_url'").run();
    gerente.db.prepare("DELETE FROM inventory_settings WHERE key = 'supabase_key'").run();
    gerente.db.prepare("DELETE FROM inventory_settings WHERE key LIKE 'sb-%'").run();
    gerente.supabase = null;
    return { success: true };
}

async function desligarNuvem(gerente) {
    return gerente.tentarAssincrono(() => sairDaNuvem(gerente));
}

module.exports = {
    CAMPOS_DA_COPIA,
    avisarSeFalhar,
    copiaDaLinha,
    copiarParaANuvem,
    copiarUltimoMovimento,
    copiarLancamentoDeReposicao,
    trazerDaNuvem,
    sincronizar,
    iniciarNuvem,
    salvarChavesDaNuvem,
    estadoDaNuvem,
    ativarNuvem,
    desligarNuvem,
};
