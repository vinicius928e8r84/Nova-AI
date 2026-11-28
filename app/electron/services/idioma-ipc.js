'use strict';

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

const TEMPO_DA_VERIFICACAO_EM_MS = 8000;
const VALIDADE_DA_VERIFICACAO_EM_MS = 60000;
const TEMPO_DE_LER_EM_MS = 20000;
const TEMPO_DE_GRAVAR_EM_MS = 25000;
const TEMPO_COM_RESPRING_EM_MS = 60000;
const TEMPO_DE_LISTAR_APPS_EM_MS = 30000;
const TEMPO_DO_RESPRING_EM_MS = 40000;
const AVISO_HELPER_V2 = 'o helper do iPhone é antigo (v2, só fuso): falta a versão com "language get/set". Rode o Conectar para atualizar o helper.';
const AVISO_HELPER_AUSENTE = 'o helper nova-locale não está instalado no iPhone.';
const FALTA_O_SCRIPT = /nova-locale\.sh: No such file|no such file.*nova-locale\.sh/i;
const AVISO_APPS_PROPRIOS = (n) => `${n} app(s) têm idioma próprio e, sem limpar, continuam no idioma deles.`;
const ERRO_NAO_CONFIRMOU = 'o aparelho não confirmou a gravação no store';
const erroDeDominio = () => ({ success: false, error: 'domínio inválido' });

const textoDoCampo = (resposta, campo) => String((resposta ? resposta[campo] : '') || '').trim();
const appsComIdiomaProprio = (saida) => Number(saida.apps_com_idioma_proprio || 0);
const nomeDoIdioma = (idioma) => (idioma ? (NOMES[idioma] || null) : null);
const tempoDoComando = (respring) => (respring ? TEMPO_COM_RESPRING_EM_MS : TEMPO_DE_GRAVAR_EM_MS);
const temAviso = (avisos, padrao) => avisos.some((aviso) => padrao.test(aviso));
const listaSeparadaPorVirgula = (texto) => (texto ? String(texto).split(',').filter(Boolean) : []);

function comandoDeVerificacao() {
    return [HELPER_BASH, '-c',
        `F=${HELPER_SCRIPT}; test -f $F || { echo FALTA; exit 0; }; `
        + `grep -q 'cmd_language' $F && { echo OK; exit 0; }; `
        + `V=$(sed -n 's/^HELPER_VERSION=//p' $F | head -1 | tr -dc '0-9'); `
        + `[ -n "$V" ] && [ "$V" -ge 3 ] && { echo OK; exit 0; }; echo V2`];
}

function veredictoDoHelper(saida, erro) {
    if (saida === 'OK') return { ok: true };
    if (saida === 'V2') return { ok: false, error: AVISO_HELPER_V2 };
    return { ok: false, error: traduzirErro(erro) || AVISO_HELPER_AUSENTE };
}

function criarVerificadorDoHelper(exec) {
    let veredicto = null;
    let verificadoEm = 0;
    return async (timeoutMs = TEMPO_DA_VERIFICACAO_EM_MS) => {
        const agora = Date.now();
        if (veredicto !== null && agora - verificadoEm < VALIDADE_DA_VERIFICACAO_EM_MS) return veredicto;
        const resposta = await exec(comandoDeVerificacao(), timeoutMs);
        veredicto = veredictoDoHelper(textoDoCampo(resposta, 'stdout'), textoDoCampo(resposta, 'stderr'));
        verificadoEm = agora;
        return veredicto;
    };
}

async function executarComAtalho(exec, cmd, timeoutMs) {
    const resposta = await exec(cmd, timeoutMs);
    if (!resposta || resposta.code === 0) return resposta;
    if (!FALTA_O_SCRIPT.test(String(resposta.stderr || ''))) return resposta;
    return exec([HELPER_ATALHO, ...cmd.slice(2)], timeoutMs);
}

function traduzirErroDaSaida(saida, stderr) {
    const bruto = saida.error || stderr;
    if (bruto) saida.error = traduzirErro(bruto);
}

function registrarCodigoDeFalha(saida, codigo) {
    if (typeof codigo !== 'number' || codigo === 0) return;
    if (!saida.error) saida.error = `o helper saiu com código ${codigo}`;
}

async function rodar(exec, cmd, timeoutMs) {
    const resposta = await executarComAtalho(exec, cmd, timeoutMs);
    const saida = lerSaida(resposta ? resposta.stdout : '');
    traduzirErroDaSaida(saida, textoDoCampo(resposta, 'stderr'));
    registrarCodigoDeFalha(saida, resposta ? resposta.code : undefined);
    return saida;
}

function avisosDoGet(domain, saida) {
    if (domain !== 'global') return [];
    const avisos = [];
    if (saida.diskMatches === 'no') avisos.push(AVISO_DISCO);
    const apps = appsComIdiomaProprio(saida);
    if (apps > 0) avisos.push(AVISO_APPS_PROPRIOS(apps));
    return avisos;
}

function resultadoDoGet(domain, saida) {
    return {
        success: true,
        domain,
        appsComIdiomaProprio: appsComIdiomaProprio(saida),
        language: saida.language || null,
        nome: nomeDoIdioma(saida.language),
        locale: saida.locale || null,
        override: saida.override === 'yes',
        disco: saida.disk || null,
        discoCombina: saida.diskMatches === 'yes',
        avisos: avisosDoGet(domain, saida)
    };
}

async function getLanguage({ exec, verificarHelper }, { domain = 'global' } = {}) {
    if (!dominioValido(domain)) return erroDeDominio();
    const helper = await verificarHelper();
    if (!helper.ok) return { success: false, error: helper.error, domain };
    const saida = await rodar(exec, comando('get', ['--domain', domain]), TEMPO_DE_LER_EM_MS);
    if (saida.error) return { success: false, error: saida.error, domain };
    return resultadoDoGet(domain, saida);
}

function recusaDoPedido({ tag, domain, confirmGlobal }) {
    if (!TAG_RE.test(String(tag || ''))) {
        return { success: false, error: 'idioma inválido: informe algo como pt-BR ou en-US' };
    }
    if (!dominioValido(domain)) return erroDeDominio();
    if (domain === 'global' && confirmGlobal !== true) {
        return {
            success: false,
            precisaConfirmar: true,
            avisos: [AVISO_GLOBAL, AVISO_RESPRING],
            error: 'confirmar antes de aplicar no aparelho inteiro'
        };
    }
    return null;
}

function argumentosDoSet({ domain, locale, limparApps, respring }) {
    const args = ['--domain', domain];
    if (locale) args.push('--locale', String(locale));
    else if (domain === 'global') args.push('--locale', 'auto');
    if (domain === 'global') args.push(limparApps === false ? '--no-clear-apps' : '--clear-apps');
    if (respring) args.push('--respring');
    return args;
}

function acrescentarAvisoDeRespring(avisos, respring) {
    if (!respring) {
        avisos.push(AVISO_RESPRING);
        return;
    }
    if (!temAviso(avisos, /CAM LIVE/)) avisos.push(AVISO_CAM_LIVE);
}

function avisosDoSet({ saida, domain, respring, appsLimpos }) {
    const avisos = [...saida.warnings];
    if (appsLimpos.length && !temAviso(avisos, /idioma próprio/)) avisos.push(AVISO_APPS(appsLimpos.length));
    if (domain === 'global' && !avisos.some((aviso) => aviso.includes('Accept-Language'))) avisos.unshift(AVISO_GLOBAL);
    acrescentarAvisoDeRespring(avisos, respring);
    return avisos;
}

function resultadoNaoConfirmado({ saida, domain, tag, respring, avisos }) {
    const temErroDoHelper = saida.error && !/saiu com código/.test(saida.error);
    return {
        success: false,
        domain,
        pedido: tag,
        aplicado: saida.language || null,
        confirmed: false,
        respring: !!respring,
        avisos,
        error: temErroDoHelper ? saida.error : ERRO_NAO_CONFIRMOU
    };
}

function resultadoConfirmado({ saida, domain, tag, respring, avisos, appsLimpos }) {
    return {
        success: true,
        domain,
        escopo: domain === 'global' ? 'aparelho' : 'app',
        appsLimpos,
        localeAuto: saida.localeAuto === 'yes',
        pedido: tag,
        aplicado: saida.language || null,
        confirmed: true,
        locale: saida.locale || null,
        respring: !!respring,
        avisos,
        error: null
    };
}

function resultadoDoSet({ saida, domain, tag, respring }) {
    const appsLimpos = listaSeparadaPorVirgula(saida.clearedApps);
    const avisos = avisosDoSet({ saida, domain, respring, appsLimpos });
    const contexto = { saida, domain, tag, respring, avisos, appsLimpos };
    if (saida.confirmed !== 'yes') return resultadoNaoConfirmado(contexto);
    if (saida.error) return { success: false, error: saida.error, avisos };
    return resultadoConfirmado(contexto);
}

async function applyLanguage({ exec, verificarHelper }, pedido = {}) {
    const { domain = 'global', respring = false, locale = null, confirmGlobal = false, limparApps = true } = pedido;
    const tag = pedido.tag || pedido.language;
    const recusa = recusaDoPedido({ tag, domain, confirmGlobal });
    if (recusa) return recusa;
    const helper = await verificarHelper();
    if (!helper.ok) return { success: false, error: helper.error, avisos: [] };
    if (locale && !LOCALE_RE.test(String(locale))) {
        return { success: false, error: 'locale inválido: informe algo como pt_BR' };
    }
    const args = argumentosDoSet({ domain, locale, limparApps, respring });
    const saida = await rodar(exec, comando('set', [tag, ...args]), tempoDoComando(respring));
    return resultadoDoSet({ saida, domain, tag, respring });
}

function resultadoDoRevert({ saida, domain, respring, avisos }) {
    const apps = appsComIdiomaProprio(saida);
    if (domain === 'global' && apps > 0) avisos.push(AVISO_APPS_PROPRIOS(apps));
    return {
        success: true,
        domain,
        appsComIdiomaProprio: apps,
        language: saida.language || null,
        override: saida.override === 'yes',
        backup: saida.revertido_de_backup || null,
        respring: !!respring,
        avisos
    };
}

async function revertLanguage({ exec, verificarHelper }, { domain = 'global', respring = false } = {}) {
    if (!dominioValido(domain)) return erroDeDominio();
    const helper = await verificarHelper();
    if (!helper.ok) return { success: false, error: helper.error, avisos: [] };
    const args = respring ? ['--domain', domain, '--respring'] : ['--domain', domain];
    const saida = await rodar(exec, comando('revert', args), tempoDoComando(respring));
    const avisos = [...saida.warnings];
    acrescentarAvisoDeRespring(avisos, respring);
    if (saida.error) return { success: false, error: saida.error, avisos };
    return resultadoDoRevert({ saida, domain, respring, avisos });
}

async function listarApps({ exec, verificarHelper }) {
    const helper = await verificarHelper();
    if (!helper.ok) return { success: false, error: helper.error };
    const saida = await rodar(exec, [HELPER_BASH, HELPER_SCRIPT, 'language', 'apps', '--format', 'lines'], TEMPO_DE_LISTAR_APPS_EM_MS);
    if (saida.error) return { success: false, error: saida.error };
    const apps = listaSeparadaPorVirgula(saida.apps);
    return { success: true, count: apps.length, apps };
}

async function reiniciarInterface({ exec, verificarHelper }) {
    const helper = await verificarHelper();
    if (!helper.ok) return { success: false, error: helper.error };
    const saida = await rodar(exec, [HELPER_BASH, HELPER_SCRIPT, 'respring'], TEMPO_DO_RESPRING_EM_MS);
    if (saida.error) return { success: false, error: saida.error };
    return { success: saida.respring === 'ok', avisos: [...saida.warnings, AVISO_RESPRING] };
}

function createHandlers({ exec, deviceId = 'ios-1' }) {
    if (typeof exec !== 'function') throw new Error('exec obrigatório');
    const verificarHelper = criarVerificadorDoHelper(exec);
    const contexto = { exec, verificarHelper };
    return {
        getLanguage: (pedido) => getLanguage(contexto, pedido),
        applyLanguage: (pedido) => applyLanguage(contexto, pedido),
        revertLanguage: (pedido) => revertLanguage(contexto, pedido),
        listarApps: () => listarApps(contexto),
        respring: () => reiniciarInterface(contexto),
        verificarHelper,
        deviceId
    };
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
