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

// O helper no aparelho está em /var/jb/usr/libexec/nova-locale.sh, executado pelo
// /var/jb/bin/bash (é o que o launchd faz). A rota /var/jb/usr/bin/nova-locale é
// tentada como reserva, para o caso de o instalador criar um atalho.
const HELPER_BASH = '/var/jb/bin/bash';
const HELPER_SCRIPT = '/var/jb/usr/libexec/nova-locale.sh';
const HELPER_ATALHO = '/var/jb/usr/bin/nova-locale';
const HELPER = HELPER_SCRIPT;
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
    return [HELPER_BASH, HELPER_SCRIPT, 'language', sub, ...args, '--format', 'lines'];
}

/** Mensagens que o usuário entende, no lugar do erro cru do shell. */
function traduzirErro(bruto) {
    const e = String(bruto || '');
    if (/no such file or directory.*nova-locale|nova-locale: No such file/i.test(e)) {
        return 'o helper do iPhone (nova-locale) não está nesse caminho; reinstale o helper pelo Conectar.';
    }
    if (/subcomando desconhecido/i.test(e)) {
        return 'o helper instalado no iPhone é antigo (v2, só fuso): falta a versão com "language get/set".';
    }
    if (/novalanguage não instalado/i.test(e)) {
        return 'o pacote de idioma (com.aquiles.novalanguage) não está instalado no iPhone.';
    }
    return e.trim();
}

function createHandlers({ exec, deviceId = 'ios-1' }) {
    if (typeof exec !== 'function') throw new Error('exec obrigatório');

    // cache da checagem: o helper só aceita subcomando a partir da v3 (v4 no
    // aparelho). Com a v2 instalada, chamar "language …" entra no laço do daemon
    // e o processo fica girando — por isso a checagem vem antes.
    let helperOk = null;
    let helperOkEm = 0;

    async function verificarHelper(timeoutMs = 8000) {
        const agora = Date.now();
        if (helperOk !== null && agora - helperOkEm < 60000) return helperOk;
        const cmd = [HELPER_BASH, '-c',
            `test -f ${HELPER_SCRIPT} && grep -q 'language get' ${HELPER_SCRIPT} && echo V4 || `
            + `{ test -f ${HELPER_SCRIPT} && echo V2 || echo FALTA; }`];
        const r = await exec(cmd, timeoutMs);
        const saida = String((r && r.stdout) || '').trim();
        const erro = String((r && r.stderr) || '').trim();
        helperOk = saida === 'V4'
            ? { ok: true }
            : saida === 'V2'
                ? { ok: false, error: 'o helper do iPhone é antigo (v2, só fuso): falta a versão com "language get/set". Rode o Conectar para atualizar o helper.' }
                : { ok: false, error: traduzirErro(erro) || 'o helper nova-locale não está instalado no iPhone.' };
        helperOkEm = agora;
        return helperOk;
    }

    // exec(cmd: string[], timeoutMs: number) -> Promise<{ code, stdout, stderr }>
    async function rodar(cmd, timeoutMs) {
        let r = await exec(cmd, timeoutMs);
        // Reserva: se o caminho com bash+script não existe, tenta o atalho.
        if (r && r.code !== 0 && /nova-locale\.sh: No such file|no such file.*nova-locale\.sh/i.test(String(r.stderr || ''))) {
            r = await exec([HELPER_ATALHO, ...cmd.slice(2)], timeoutMs);
        }
        const saida = lerSaida((r && r.stdout) || '');
        if (r && r.stderr && !saida.error) {
            const err = String(r.stderr).trim();
            if (err) saida.error = traduzirErro(err);
        } else if (saida.error) {
            saida.error = traduzirErro(saida.error);
        }
        if (r && typeof r.code === 'number' && r.code !== 0 && !saida.error) {
            saida.error = `o helper saiu com código ${r.code}`;
        }
        return saida;
    }

    async function getLanguage({ domain = 'global' } = {}) {
        if (!dominioValido(domain)) return { success: false, error: 'domínio inválido' };
        const h = await verificarHelper();
        if (!h.ok) return { success: false, error: h.error, domain };
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
        // Global muda o que os sites recebem: exige confirmação explícita.
        if (domain === 'global' && confirmGlobal !== true) {
            return {
                success: false,
                precisaConfirmar: true,
                avisos: [AVISO_GLOBAL, AVISO_RESPRING],
                error: 'confirmar antes de aplicar no aparelho inteiro'
            };
        }

        const h = await verificarHelper();
        if (!h.ok) return { success: false, error: h.error, avisos: [] };
        if (locale && !LOCALE_RE.test(String(locale))) {
            return { success: false, error: 'locale inválido: informe algo como pt_BR' };
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
        const h = await verificarHelper();
        if (!h.ok) return { success: false, error: h.error, avisos: [] };
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
        const h = await verificarHelper();
        if (!h.ok) return { success: false, error: h.error };
        const s = await rodar([HELPER_BASH, HELPER_SCRIPT, 'language', 'apps', '--format', 'lines'], 30000);
        if (s.error) return { success: false, error: s.error };
        const apps = s.apps ? String(s.apps).split(',').filter(Boolean) : [];
        return { success: true, count: apps.length, apps };
    }

    async function respring() {
        const h = await verificarHelper();
        if (!h.ok) return { success: false, error: h.error };
        const s = await rodar([HELPER_BASH, HELPER_SCRIPT, 'respring'], 40000);
        if (s.error) return { success: false, error: s.error };
        return { success: s.respring === 'ok', avisos: [...(s.warnings || []), AVISO_RESPRING] };
    }

    return { getLanguage, applyLanguage, revertLanguage, listarApps, respring, verificarHelper, deviceId };
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
        // Cada argumento vai entre aspas simples, com aspas internas escapadas
        // pelo idioma padrão do shell (' -> '\''). Sem interpolar nada solto.
        const cita = (c) => "'" + String(c).replace(/'/g, "'\\''") + "'";
        const seguro = cmd.map((c) => String(c));
        let sshOptions = [];
        try { sshOptions = require('./iphone-ssh').sshOptions(); } catch { /* usa o padrão */ }
        const args = ['-p', '2222', ...sshOptions,
            '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-o', 'StrictHostKeyChecking=accept-new',
            'mobile@127.0.0.1', seguro.map(cita).join(' ')];
        require('child_process').execFile('/usr/bin/ssh', args, { timeout: timeoutMs }, (err, stdout, stderr) => {
            resolve({ code: err ? (err.code || 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || '') });
        });
    });
}

module.exports = { createHandlers, register, lerSaida, dominioValido, TAG_RE, NOMES,
    AVISO_GLOBAL, AVISO_RESPRING, AVISO_CAM_LIVE, AVISO_APPS, AVISO_DISCO, HELPER,
    HELPER_BASH, HELPER_SCRIPT, traduzirErro, executarNoAparelho };
