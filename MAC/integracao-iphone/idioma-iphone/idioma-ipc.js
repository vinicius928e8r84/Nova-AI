'use strict';
// Idioma do aparelho pelo app: lê e grava o idioma do iPhone pelo helper
// `nova-locale` (que por sua vez usa CFPreferences — o store que manda).
//
// Regras de segurança deste módulo:
//  * Nunca usa sudo. O caminho provado (CFPreferences como `mobile`) não
//    precisa de root, e o respring é `kill -9` no SpringBoard.
//  * Idioma no domínio GLOBAL muda o Accept-Language que os sites recebem —
//    com IP dos EUA isso é incoerência. Por isso aplicar global exige
//    `confirmGlobal: true`; sem isso o módulo NÃO executa nada e devolve o
//    motivo. Nada é aplicado em silêncio.
//  * Nada de shell: os argumentos vão como lista para o ssh/execFile. O tag e o
//    domínio são validados antes, para não virar argumento estranho.
//  * Toda resposta devolve o que o APARELHO confirmou (leitura de volta no
//    store), não o que foi pedido.

const HELPER = '/var/jb/usr/bin/nova-locale';
const TAG_RE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const BUNDLE_RE = /^[A-Za-z0-9][A-Za-z0-9.-]{2,120}$/;
const LOCALE_RE = /^[A-Za-z]{2,3}(_[A-Za-z0-9]{2,8})*$/;

const NOMES = {
    'pt-BR': 'Português (Brasil)', 'pt-PT': 'Português (Portugal)', 'en-US': 'Inglês (EUA)',
    'en-GB': 'Inglês (Reino Unido)', 'es-ES': 'Espanhol (Espanha)', 'es-MX': 'Espanhol (México)',
    'fr-FR': 'Francês', 'de-DE': 'Alemão', 'it-IT': 'Italiano', 'ja-JP': 'Japonês',
    'ko-KR': 'Coreano', 'zh-Hans': 'Chinês (simplificado)', 'ru-RU': 'Russo', 'ar-SA': 'Árabe'
};

const AVISO_GLOBAL = 'Idioma do aparelho inteiro muda o Accept-Language que os sites recebem; '
    + 'com IP dos EUA isso fica incoerente com a localização.';
const AVISO_RESPRING = 'A interface do iPhone só muda com respring (~10 s), e o respring derruba o CAM LIVE: '
    + 'reconecte a câmera depois.';
const AVISO_APPS = (n) => `${n} app(s) tinham idioma próprio e foram ajustados para seguir o aparelho inteiro.`;
const AVISO_CAM_LIVE = 'O CAM LIVE caiu junto com o respring: reconecte a câmera.';
const AVISO_DISCO = 'O arquivo em disco ainda está com o idioma antigo: um desligamento limpo pode voltar a ele. '
    + 'Faça o respring e, se quiser garantia, repita o salvar depois do respring.';

function dominioValido(domain) {
    return domain === 'global' || BUNDLE_RE.test(String(domain || ''));
}

/** Lê o formato `chave=valor` que o helper imprime e junta os avisos repetidos. */
function lerSaida(texto) {
    const out = { warnings: [] };
    for (const linha of String(texto || '').split(/\r?\n/)) {
        const i = linha.indexOf('=');
        if (i <= 0) continue;
        const k = linha.slice(0, i).trim();
        const v = linha.slice(i + 1).trim();
        if (k === 'warn') { if (v) out.warnings.push(v); continue; }
        if (k === 'error') { out.error = v; continue; }
        out[k] = v;
    }
    return out;
}

function comando(sub, args) {
    return [HELPER, 'language', sub, ...args, '--format', 'lines'];
}

function createHandlers({ exec, deviceId = 'ios-1' }) {
    if (typeof exec !== 'function') throw new Error('exec obrigatório');

    // exec(cmd: string[], timeoutMs: number) -> Promise<{ code, stdout, stderr }>
    async function rodar(cmd, timeoutMs) {
        const r = await exec(cmd, timeoutMs);
        const saida = lerSaida((r && r.stdout) || '');
        if (r && r.stderr && !saida.error) {
            const err = String(r.stderr).trim();
            if (err) saida.error = err;
        }
        if (r && typeof r.code === 'number' && r.code !== 0 && !saida.error) {
            saida.error = `o helper saiu com código ${r.code}`;
        }
        return saida;
    }

    async function getLanguage({ domain = 'global' } = {}) {
        if (!dominioValido(domain)) return { success: false, error: 'domínio inválido' };
        const s = await rodar(comando('get', ['--domain', domain]), 20000);
        if (s.error) return { success: false, error: s.error, domain };
        const avisos = [];
        if (domain === 'global' && s.diskMatches === 'no') avisos.push(AVISO_DISCO);
        const appsProprios = Number(s.apps_com_idioma_proprio || 0);
        if (domain === 'global' && appsProprios > 0) {
            avisos.push(`${appsProprios} app(s) têm idioma próprio e, sem limpar, continuam no idioma deles.`);
        }
        return {
            success: true,
            domain,
            appsComIdiomaProprio: appsProprios,
            language: s.language || null,
            nome: s.language ? (NOMES[s.language] || null) : null,
            locale: s.locale || null,
            override: s.override === 'yes',
            disco: s.disk || null,
            discoCombina: s.diskMatches === 'yes',
            avisos
        };
    }

    async function applyLanguage({ tag, domain = 'global', respring = false, locale = null,
        confirmGlobal = false, limparApps = true } = {}) {
        if (!TAG_RE.test(String(tag || ''))) {
            return { success: false, error: 'idioma inválido: informe algo como pt-BR ou en-US' };
        }
        if (!dominioValido(domain)) return { success: false, error: 'domínio inválido' };
        if (locale && !LOCALE_RE.test(String(locale))) {
            return { success: false, error: 'locale inválido: informe algo como pt_BR' };
        }
        // Global muda o que os sites recebem: exige confirmação explícita.
        if (domain === 'global' && confirmGlobal !== true) {
            return {
                success: false,
                precisaConfirmar: true,
                avisos: [AVISO_GLOBAL, AVISO_RESPRING],
                error: 'confirmar antes de aplicar no aparelho inteiro'
            };
        }

        // "Aparelho inteiro": o global precisa de duas coisas para alcançar todos
        // os apps — derivar o AppleLocale do idioma (senão fica texto em pt com
        // data americana) e limpar o idioma próprio de quem tiver um.
        const args = ['--domain', domain];
        if (locale) args.push('--locale', String(locale));
        else if (domain === 'global') args.push('--locale', 'auto');
        if (domain === 'global') args.push(limparApps === false ? '--no-clear-apps' : '--clear-apps');
        if (respring) args.push('--respring');

        const s = await rodar(comando('set', [tag, ...args]), respring ? 60000 : 25000);
        const avisos = [...(s.warnings || [])];
        const appsLimpos = s.clearedApps ? String(s.clearedApps).split(',').filter(Boolean) : [];
        if (appsLimpos.length && !avisos.some((a) => /idioma próprio/.test(a))) avisos.push(AVISO_APPS(appsLimpos.length));
        if (domain === 'global' && !avisos.some((a) => a.includes('Accept-Language'))) avisos.unshift(AVISO_GLOBAL);
        if (respring) {
            if (!avisos.some((a) => /CAM LIVE/.test(a))) avisos.push(AVISO_CAM_LIVE);
        } else {
            avisos.push(AVISO_RESPRING);
        }

        const confirmado = s.confirmed === 'yes';
        // A mensagem semântica vale mais que "o helper saiu com código N".
        if (!confirmado) {
            return {
                success: false,
                domain,
                pedido: tag,
                aplicado: s.language || null,
                confirmed: false,
                respring: !!respring,
                avisos,
                error: (s.error && !/saiu com código/.test(s.error))
                    ? s.error
                    : 'o aparelho não confirmou a gravação no store'
            };
        }
        if (s.error) return { success: false, error: s.error, avisos };
        return {
            success: confirmado,
            domain,
            escopo: domain === 'global' ? 'aparelho' : 'app',
            appsLimpos,
            localeAuto: s.localeAuto === 'yes',
            pedido: tag,
            aplicado: s.language || null,
            confirmed: confirmado,
            locale: s.locale || null,
            respring: !!respring,
            avisos,
            error: confirmado ? null : 'o aparelho não confirmou a gravação no store'
        };
    }

    async function revertLanguage({ domain = 'global', respring = false } = {}) {
        if (!dominioValido(domain)) return { success: false, error: 'domínio inválido' };
        const args = ['--domain', domain];
        if (respring) args.push('--respring');
        const s = await rodar(comando('revert', args), respring ? 60000 : 25000);
        const avisos = [...(s.warnings || [])];
        if (respring) {
            if (!avisos.some((a) => /CAM LIVE/.test(a))) avisos.push(AVISO_CAM_LIVE);
        } else {
            avisos.push(AVISO_RESPRING);
        }
        if (s.error) return { success: false, error: s.error, avisos };
        const appsProprios = Number(s.apps_com_idioma_proprio || 0);
        if (domain === 'global' && appsProprios > 0) {
            avisos.push(`${appsProprios} app(s) têm idioma próprio e, sem limpar, continuam no idioma deles.`);
        }
        return {
            success: true,
            domain,
            appsComIdiomaProprio: appsProprios,
            language: s.language || null,
            override: s.override === 'yes',
            backup: s.revertido_de_backup || null,
            respring: !!respring,
            avisos
        };
    }

    async function listarApps() {
        const s = await rodar([HELPER, 'language', 'apps', '--format', 'lines'], 30000);
        if (s.error) return { success: false, error: s.error };
        const apps = s.apps ? String(s.apps).split(',').filter(Boolean) : [];
        return { success: true, count: apps.length, apps };
    }

    async function respring() {
        const s = await rodar([HELPER, 'respring'], 40000);
        if (s.error) return { success: false, error: s.error };
        return { success: s.respring === 'ok', avisos: [...(s.warnings || []), AVISO_RESPRING] };
    }

    return { getLanguage, applyLanguage, revertLanguage, listarApps, respring, deviceId };
}

/** Registra os handlers no app. `app` só é usado para o canal de log. */
function register(app, ipcMain, options = {}) {
    const exec = options.exec || executarNoAparelho;
    const h = createHandlers({ exec });

    ipcMain.handle('spoofer:get-language', async (_e, args) => h.getLanguage(args || {}));
    // `set-language` é alias: o Frontend pediu esse nome antes do contrato fechar.
    ipcMain.handle('spoofer:apply-language', async (_e, args) => h.applyLanguage(args || {}));
    ipcMain.handle('spoofer:set-language', async (_e, args) => h.applyLanguage(args || {}));
    ipcMain.handle('spoofer:revert-language', async (_e, args) => h.revertLanguage(args || {}));
    ipcMain.handle('spoofer:list-language-apps', async () => h.listarApps());
    ipcMain.handle('spoofer:respring-iphone', async () => h.respring());
    if (app && app.log) app.log('idioma: IPCs spoofer:{get,apply,revert}-language registrados');
    return h;
}

/**
 * Execução real: ssh para o túnel do app, como `mobile`, sem sudo.
 * Cada argumento vai entre aspas simples individualmente e argumento com aspas
 * é recusado — o ssh remoto é uma string, então nada de interpolar valor solto.
 */
function executarNoAparelho(cmd, timeoutMs = 25000) {
    return new Promise((resolve) => {
        const seguro = cmd.map((c) => String(c));
        if (seguro.some((c) => c.includes("'"))) {
            resolve({ code: 64, stdout: '', stderr: 'argumento inválido' });
            return;
        }
        let sshOptions = [];
        try { sshOptions = require('./iphone-ssh').sshOptions(); } catch { /* usa o padrão */ }
        const args = ['-p', '2222', ...sshOptions,
            '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-o', 'StrictHostKeyChecking=accept-new',
            'mobile@127.0.0.1', seguro.map((c) => `'${c}'`).join(' ')];
        require('child_process').execFile('/usr/bin/ssh', args, { timeout: timeoutMs }, (err, stdout, stderr) => {
            resolve({ code: err ? (err.code || 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || '') });
        });
    });
}

module.exports = { createHandlers, register, lerSaida, dominioValido, TAG_RE, NOMES,
    AVISO_GLOBAL, AVISO_RESPRING, AVISO_CAM_LIVE, AVISO_APPS, AVISO_DISCO, HELPER };
