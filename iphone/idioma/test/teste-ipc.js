'use strict';

const idioma = require('../../../app/electron/services/idioma-ipc.js');

let fails = 0;
function ok(nome, cond, extra) {
    if (!cond) { fails++; console.log(`FALHA [${nome}] ${extra || ''}`); }
}

const chamadaDoHelper = (cmd) => Array.isArray(cmd) && [idioma.HELPER_BASH, '-c'].every((parte, i) => cmd[i] === parte);
const comecaCom = (cmd, ...partes) => partes.every((parte, i) => cmd[i] === parte);
const incluiTudo = (cmd, ...partes) => partes.every((parte) => cmd.includes(parte));
const valorDe = (cmd, flag) => cmd[cmd.indexOf(flag) + 1];

function fakeExec(respostas = [], helperVersao = 'OK') {
    const chamadas = [];
    const fn = async (cmd, timeoutMs) => {
        if (chamadaDoHelper(cmd)) {
            chamadas.push({ cmd, timeoutMs, helper: helperVersao });
            return { code: 0, stdout: helperVersao + '\n', stderr: '' };
        }
        chamadas.push({ cmd, timeoutMs });
        const r = respostas.shift() || { code: 0, stdout: '', stderr: '' };
        return r;
    };
    fn.chamadas = chamadas;
    fn.reais = () => chamadas.filter((c) => !c.helper);
    return fn;
}

const SAIDA_GET = 'apps_com_idioma_proprio=3\ndomain=global\nlanguage=pt-BR\nlocale=pt_BR\nok=yes\noverride=yes\ndiskMatches=no\n';
const SAIDA_SET_OK = 'clearedApps=com.a:es-ES,com.b:pt-BR\nclearedCount=2\nconfirmed=yes\ndomain=global\nlanguage=pt-BR\nlocale=pt_BR\nlocaleAuto=yes\nok=yes\noverride=yes\nrequested=pt-BR\nsynced=yes\ndiskMatches=no\n';
const SAIDA_SET_UNICO = 'confirmed=no\ndomain=global\nlanguage=en-US\nok=yes\nrequested=pt-BR\n';

function comHandlers(respostas, helperVersao) {
    const exec = fakeExec(respostas, helperVersao);
    return { exec, h: idioma.createHandlers({ exec }) };
}

async function cenaGet() {
    const { exec, h } = comHandlers([{ code: 0, stdout: SAIDA_GET, stderr: '' }]);
    const r = await h.getLanguage({});
    ok('get', r.success === true, JSON.stringify(r));
    ok('get-language', r.language === 'pt-BR', r.language);
    ok('get-nome', r.nome === 'Português (Brasil)', r.nome);
    ok('get-apps-proprios', r.appsComIdiomaProprio === 3, JSON.stringify(r));
    ok('get-avisa-apps', r.avisos.some((a) => /idioma próprio/.test(a)), JSON.stringify(r.avisos));
    ok('get-disco', r.discoCombina === false && r.avisos.some((a) => /desligamento limpo/.test(a)), JSON.stringify(r.avisos));
    const cmd = exec.reais()[0].cmd;
    ok('get-comando', comecaCom(cmd, idioma.HELPER_BASH, idioma.HELPER_SCRIPT, 'language', 'get')
        && incluiTudo(cmd, '--domain', 'global', 'lines'), cmd.join(' '));
    ok('get-sem-sudo', !cmd.join(' ').includes('sudo'), cmd.join(' '));
}

async function cenaGlobalSemConfirmar() {
    const { exec, h } = comHandlers([]);
    const r = await h.applyLanguage({ tag: 'en-US', domain: 'global' });
    ok('global-sem-confirmar', r.success === false && r.precisaConfirmar === true, JSON.stringify(r));
    ok('global-sem-confirmar-nao-executa', exec.chamadas.length === 0, `${exec.chamadas.length} chamada(s)`);
    ok('global-sem-confirmar-avisa', r.avisos.some((a) => /Accept-Language/.test(a)), JSON.stringify(r.avisos));
}

async function cenaGlobalConfirmado() {
    const { exec, h } = comHandlers([{ code: 0, stdout: SAIDA_SET_OK, stderr: '' }]);
    const r = await h.applyLanguage({ tag: 'pt-BR', domain: 'global', confirmGlobal: true });
    ok('global-confirmado', r.success === true && r.aplicado === 'pt-BR' && r.confirmed === true, JSON.stringify(r));
    const cmd = exec.reais()[0].cmd;
    ok('global-cmd', cmd.slice(2, 4).join(' ') === 'language set', cmd.join(' '));
    ok('global-cmd-tag', cmd[4] === 'pt-BR', cmd.join(' '));
    ok('global-cmd-dominio', cmd.includes('--domain') && valorDe(cmd, '--domain') === 'global', cmd.join(' '));
    ok('global-cmd-sem-respring-padrao', !cmd.includes('--respring'), cmd.join(' '));
    ok('global-avisa-respring', r.avisos.some((a) => /CAM LIVE/.test(a)), JSON.stringify(r.avisos));
    ok('global-escopo', r.escopo === 'aparelho', JSON.stringify(r));
    ok('global-limpa-apps', cmd.includes('--clear-apps'), cmd.join(' '));
    ok('global-locale-auto', cmd.includes('--locale') && valorDe(cmd, '--locale') === 'auto', cmd.join(' '));
    ok('global-apps-limpos', Array.isArray(r.appsLimpos) && r.appsLimpos.length === 2, JSON.stringify(r.appsLimpos));
    ok('global-avisa-apps', r.avisos.some((a) => /idioma próprio/.test(a)), JSON.stringify(r.avisos));
    ok('global-avisa-accept', r.avisos.some((a) => /Accept-Language/.test(a)), JSON.stringify(r.avisos));
}

async function cenaAppEspecifico() {
    const { exec, h } = comHandlers([{ code: 0, stdout: 'confirmed=yes\ndomain=com.apple.Preferences\nlanguage=en-US\nok=yes\noverride=yes\n', stderr: '' }]);
    const r = await h.applyLanguage({ tag: 'en-US', domain: 'com.apple.Preferences' });
    ok('app-ok', r.success === true && r.aplicado === 'en-US', JSON.stringify(r));
    ok('app-sem-aviso-global', !r.avisos.some((a) => /Accept-Language/.test(a)), JSON.stringify(r.avisos));
    const cmd = exec.reais()[0].cmd;
    ok('app-cmd-bundle', valorDe(cmd, '--domain') === 'com.apple.Preferences', cmd.join(' '));
}

async function cenaRespring() {
    const { exec, h } = comHandlers([{ code: 0, stdout: 'confirmed=yes\nlanguage=pt-BR\nok=yes\n', stderr: '' }]);
    const r = await h.applyLanguage({ tag: 'pt-BR', domain: 'global', confirmGlobal: true, respring: true });
    ok('respring-flag', exec.reais()[0].cmd.includes('--respring'), exec.reais()[0].cmd.join(' '));
    ok('respring-diz-que-respingou', r.respring === true, JSON.stringify(r));
    ok('respring-avisa-camlive', r.avisos.some((a) => /CAM LIVE/.test(a)), JSON.stringify(r.avisos));
}

async function cenaEntradaInvalida() {
    const { exec, h } = comHandlers([]);
    const r1 = await h.applyLanguage({ tag: 'pt BR; rm -rf /', domain: 'global', confirmGlobal: true });
    const r2 = await h.applyLanguage({ tag: 'pt-BR', domain: '../../etc/passwd' });
    ok('tag-invalido', r1.success === false, JSON.stringify(r1));
    ok('dominio-invalido', r2.success === false, JSON.stringify(r2));
    ok('invalido-nao-executa', exec.chamadas.length === 0, `${exec.chamadas.length} chamada(s)`);
}

async function cenaNaoConfirmado() {
    const { h } = comHandlers([{ code: 1, stdout: SAIDA_SET_UNICO, stderr: '' }]);
    const r = await h.applyLanguage({ tag: 'pt-BR', domain: 'global', confirmGlobal: true });
    ok('nao-confirmado', r.success === false && /não confirmou/.test(r.error || ''), JSON.stringify(r));
}

async function cenaHelperAusente() {
    const { h } = comHandlers([{ code: 3, stdout: 'error=novalanguage não instalado em /var/jb/usr/bin/novalanguage\n', stderr: '' }]);
    const r = await h.getLanguage({});
    ok('helper-ausente', r.success === false && /com\.aquiles\.novalanguage/.test(r.error || ''), JSON.stringify(r));
}

async function cenaReverter() {
    const { exec, h } = comHandlers([{ code: 0, stdout: 'language=\nok=yes\noverride=no\nrevertido_de_backup=/var/mobile/x.orig\n', stderr: '' }]);
    const r = await h.revertLanguage({ domain: 'global' });
    ok('revert', r.success === true && r.override === false, JSON.stringify(r));
    ok('revert-backup', r.backup === '/var/mobile/x.orig', r.backup);
    ok('revert-cmd', exec.reais()[0].cmd.includes('revert'), exec.reais()[0].cmd.join(' '));
}

async function cenaReverterSemBackup() {
    const { h } = comHandlers([{ code: 5, stdout: 'error=sem backup de idioma para global\n', stderr: '' }]);
    const r = await h.revertLanguage({});
    ok('revert-sem-backup', r.success === false && /sem backup/.test(r.error || ''), JSON.stringify(r));
}

async function cenaRespringSozinho() {
    const { h } = comHandlers([{ code: 0, stdout: 'respring=ok\nwarn=respring derruba o CAM LIVE; reconecte a câmera depois\n', stderr: '' }]);
    const r = await h.respring();
    ok('respring', r.success === true, JSON.stringify(r));
    ok('respring-aviso', r.avisos.some((a) => /CAM LIVE/.test(a)), JSON.stringify(r.avisos));
}

async function cenaSemShell() {
    const { exec, h } = comHandlers([]);
    await h.getLanguage({ domain: 'com.apple.mobilesafari' });
    const linha = exec.reais()[0].cmd.join(' ');
    ok('sem-sudo', !/sudo|su -c|sh -c/.test(linha), linha);
    ok('argv-separado', Array.isArray(exec.reais()[0].cmd) && exec.reais()[0].cmd.every((x) => typeof x === 'string'), linha);
}

async function cenaSemLimparApps() {
    const { exec, h } = comHandlers([{ code: 0, stdout: 'confirmed=yes\nlanguage=pt-BR\nok=yes\n', stderr: '' }]);
    await h.applyLanguage({ tag: 'pt-BR', domain: 'global', confirmGlobal: true, limparApps: false });
    ok('limparApps-false', exec.reais()[0].cmd.includes('--no-clear-apps'), exec.reais()[0].cmd.join(' '));
    ok('limparApps-false-sem-clear', !exec.reais()[0].cmd.includes('--clear-apps'), exec.reais()[0].cmd.join(' '));
}

async function cenaListarApps() {
    const { exec, h } = comHandlers([{ code: 0, stdout: 'apps=com.a,com.b,com.c\ncount=3\nok=yes\n', stderr: '' }]);
    const r = await h.listarApps();
    ok('lista-apps', r.success && r.count === 3 && r.apps.length === 3, JSON.stringify(r));
    ok('lista-apps-cmd', exec.reais()[0].cmd.includes('apps'), exec.reais()[0].cmd.join(' '));
}

async function cenaTraduzirErro() {
    ok('traduz-helper-antigo', /ajuda|antigo|v2/i.test(idioma.traduzirErro('language: subcomando desconhecido')), idioma.traduzirErro('subcomando desconhecido'));
    ok('traduz-sem-helper', /reinstale|não está nesse caminho/i.test(idioma.traduzirErro("zsh:1: no such file or directory: /var/jb/usr/bin/nova-locale")), 'x');
    ok('traduz-sem-pacote', /com\.aquiles\.novalanguage/.test(idioma.traduzirErro('error=novalanguage não instalado em /var/jb/usr/bin/novalanguage')), 'x');
    ok('traduz-outro', idioma.traduzirErro('erro qualquer') === 'erro qualquer', idioma.traduzirErro('erro qualquer'));
}

async function cenaHelperAntigo() {
    const { exec, h } = comHandlers([], 'V2');
    const r = await h.getLanguage({});
    ok('v2-recusa', r.success === false && /antigo \(v2/.test(r.error || ''), JSON.stringify(r));
    ok('v2-sem-chamada-real', exec.reais().length === 0, JSON.stringify(exec.chamadas.map((c) => c.helper)));
    const r2 = await h.applyLanguage({ tag: 'pt-BR', domain: 'global', confirmGlobal: true });
    ok('v2-recusa-aplicar', r2.success === false && exec.reais().length === 0, JSON.stringify(r2));
    const r3 = await h.respring();
    ok('v2-recusa-respring', r3.success === false && exec.reais().length === 0, JSON.stringify(r3));
}

async function cenaHelperFalta() {
    const { exec, h } = comHandlers([], 'FALTA');
    const r = await h.getLanguage({});
    ok('helper-falta', r.success === false && /não está instalado/.test(r.error || ''), JSON.stringify(r));
    ok('helper-falta-sem-chamada', exec.reais().length === 0, 'x');
}

async function cenaLerSaida() {
    const s = idioma.lerSaida('lixo\nwarn=um\nwarn=dois\nerror=foo\nlanguage=pt-BR\n');
    ok('parser-warns', s.warnings.length === 2, JSON.stringify(s.warnings));
    ok('parser-error', s.error === 'foo', s.error);
    ok('parser-language', s.language === 'pt-BR', s.language);
}

const CENAS = [
    cenaGet, cenaGlobalSemConfirmar, cenaGlobalConfirmado, cenaAppEspecifico, cenaRespring, cenaEntradaInvalida,
    cenaNaoConfirmado, cenaHelperAusente, cenaReverter, cenaReverterSemBackup, cenaRespringSozinho, cenaSemShell,
    cenaSemLimparApps, cenaListarApps, cenaTraduzirErro, cenaHelperAntigo, cenaHelperFalta, cenaLerSaida,
];

(async () => {
    for (const cena of CENAS) await cena();
    console.log(fails ? `${fails} FALHA(S) NO IPC` : 'IPC DE IDIOMA: TODOS OS TESTES PASSARAM');
    process.exit(fails ? 1 : 0);
})();
