'use strict';
//

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

    let helperOk = null;
    let helperOkEm = 0;

    async function verificarHelper(timeoutMs = 8000) {
        const agora = Date.now();
        if (helperOk !== null && agora - helperOkEm < 60000) return helperOk;
        const cmd = [HELPER_BASH, '-c',
            `F=${HELPER_SCRIPT}; test -f $F || { echo FALTA; exit 0; }; `
            + `grep -q 'cmd_language' $F && { echo OK; exit 0; }; `
            + `V=$(sed -n 's/^HELPER_VERSION=//p' $F | head -1 | tr -dc '0-9'); `
            + `[ -n "$V" ] && [ "$V" -ge 3 ] && { echo OK; exit 0; }; echo V2`];
        const r = await exec(cmd, timeoutMs);
        const saida = String((r && r.stdout) || '').trim();
        const erro = String((r && r.stderr) || '').trim();
        helperOk = saida === 'OK'
            ? { ok: true }
            : saida === 'V2'
                ? { ok: false, error: 'o helper do iPhone é antigo (v2, só fuso): falta a versão com "language get/set". Rode o Conectar para atualizar o helper.' }
                : { ok: false, error: traduzirErro(erro) || 'o helper nova-locale não está instalado no iPhone.' };
        helperOkEm = agora;
        return helperOk;
    }

    async function rodar(cmd, timeoutMs) {
        let r = await exec(cmd, timeoutMs);
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

    async function applyLanguage({ tag, language, domain = 'global', respring = false, locale = null,
        confirmGlobal = false, limparApps = true } = {}) {
        if (!tag) tag = language;
        if (!TAG_RE.test(String(tag || ''))) {
            return { success: false, error: 'idioma inválido: informe algo como pt-BR ou en-US' };
        }
        if (!dominioValido(domain)) return { success: false, error: 'domínio inválido' };
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

function register(app, ipcMain, options = {}) {
    const exec = options.exec || executarNoAparelho;
    const h = createHandlers({ exec });

    ipcMain.handle('spoofer:get-language', async (_e, args) => h.getLanguage(args || {}));
    ipcMain.handle('spoofer:apply-language', async (_e, args) => h.applyLanguage(args || {}));
    ipcMain.handle('spoofer:set-language', async (_e, args) => h.applyLanguage(args || {}));
    ipcMain.handle('spoofer:revert-language', async (_e, args) => h.revertLanguage(args || {}));
    ipcMain.handle('spoofer:list-language-apps', async () => h.listarApps());
    ipcMain.handle('spoofer:respring-iphone', async () => h.respring());
    if (app && app.log) app.log('idioma: IPCs spoofer:{get,apply,revert}-language registrados');
    return h;
}

function executarNoAparelho(cmd, timeoutMs = 25000) {
    return new Promise((resolve) => {
        const cita = (c) => "'" + String(c).replace(/'/g, "'\\''") + "'";
        const seguro = cmd.map((c) => String(c));
        let sshOptions = [];
        try { sshOptions = require('./iphone-ssh').sshOptions(); } catch { }
        const args = ['-p', '2222', ...sshOptions,
            '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-o', 'StrictHostKeyChecking=accept-new',
            'mobile@127.0.0.1', seguro.map(cita).join(' ')];
        require('./tool-paths').execSsh(args, { timeout: timeoutMs }, (err, stdout, stderr) => {
            resolve({ code: err ? (err.code || 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || '') });
        });
    });
}

module.exports = { createHandlers, register, lerSaida, dominioValido, TAG_RE, NOMES,
    AVISO_GLOBAL, AVISO_RESPRING, AVISO_CAM_LIVE, AVISO_APPS, AVISO_DISCO, HELPER,
    HELPER_BASH, HELPER_SCRIPT, traduzirErro, executarNoAparelho };
