'use strict';
// Teste do módulo idioma-ipc.js no Mac: nenhum ssh, nenhum aparelho.
// O `exec` é falso e registra exatamente os argumentos recebidos, para provar
// que nada é aplicado em silêncio e que não existe chamada com sudo.

const idioma = require('../../../../app/electron/services/idioma-ipc.js');

let fails = 0;
function ok(nome, cond, extra) {
    if (!cond) { fails++; console.log(`FALHA [${nome}] ${extra || ''}`); }
}

// exec falso: devolve o que for programado e guarda os comandos
function fakeExec(respostas = [], helperVersao = 'OK') {
    const chamadas = [];
    const fn = async (cmd, timeoutMs) => {
        // primeira chamada de cada handler é a checagem de versão do helper
        if (Array.isArray(cmd) && cmd[0] === idioma.HELPER_BASH && cmd[1] === '-c') {
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

(async () => {
    // 1) ler o idioma atual
    {
        const exec = fakeExec([{ code: 0, stdout: SAIDA_GET, stderr: '' }]);
        const h = idioma.createHandlers({ exec });
        const r = await h.getLanguage({});
        ok('get', r.success === true, JSON.stringify(r));
        ok('get-language', r.language === 'pt-BR', r.language);
        ok('get-nome', r.nome === 'Português (Brasil)', r.nome);
        ok('get-apps-proprios', r.appsComIdiomaProprio === 3, JSON.stringify(r));
        ok('get-avisa-apps', r.avisos.some((a) => /idioma próprio/.test(a)), JSON.stringify(r.avisos));
        ok('get-disco', r.discoCombina === false && r.avisos.some((a) => /desligamento limpo/.test(a)), JSON.stringify(r.avisos));
        const cmd = exec.reais()[0].cmd;
        ok('get-comando', cmd[0] === idioma.HELPER_BASH && cmd[1] === idioma.HELPER_SCRIPT
            && cmd[2] === 'language' && cmd[3] === 'get'
            && cmd.includes('--domain') && cmd.includes('global') && cmd.includes('lines'), cmd.join(' '));
        ok('get-sem-sudo', !cmd.join(' ').includes('sudo'), cmd.join(' '));
    }

    // 2) aplicar no global SEM confirmação: não executa nada
    {
        const exec = fakeExec([]);
        const h = idioma.createHandlers({ exec });
        const r = await h.applyLanguage({ tag: 'en-US', domain: 'global' });
        ok('global-sem-confirmar', r.success === false && r.precisaConfirmar === true, JSON.stringify(r));
        ok('global-sem-confirmar-nao-executa', exec.chamadas.length === 0, `${exec.chamadas.length} chamada(s)`);  // nem checagem de helper
        ok('global-sem-confirmar-avisa', r.avisos.some((a) => /Accept-Language/.test(a)), JSON.stringify(r.avisos));
    }

    // 3) aplicar no global COM confirmação: executa e devolve o que o aparelho confirmou
    {
        const exec = fakeExec([{ code: 0, stdout: SAIDA_SET_OK, stderr: '' }]);
        const h = idioma.createHandlers({ exec });
        const r = await h.applyLanguage({ tag: 'pt-BR', domain: 'global', confirmGlobal: true });
        ok('global-confirmado', r.success === true && r.aplicado === 'pt-BR' && r.confirmed === true, JSON.stringify(r));
        const cmd = exec.reais()[0].cmd;
        ok('global-cmd', cmd.slice(2, 4).join(' ') === 'language set', cmd.join(' '));
        ok('global-cmd-tag', cmd[4] === 'pt-BR', cmd.join(' '));
        ok('global-cmd-dominio', cmd.includes('--domain') && cmd[cmd.indexOf('--domain') + 1] === 'global', cmd.join(' '));
        ok('global-cmd-sem-respring-padrao', !cmd.includes('--respring'), cmd.join(' '));
        ok('global-avisa-respring', r.avisos.some((a) => /CAM LIVE/.test(a)), JSON.stringify(r.avisos));
        ok('global-escopo', r.escopo === 'aparelho', JSON.stringify(r));
        ok('global-limpa-apps', exec.reais()[0].cmd.includes('--clear-apps'), exec.reais()[0].cmd.join(' '));
        ok('global-locale-auto', exec.reais()[0].cmd.includes('--locale')
            && exec.reais()[0].cmd[exec.reais()[0].cmd.indexOf('--locale') + 1] === 'auto', exec.reais()[0].cmd.join(' '));
        ok('global-apps-limpos', Array.isArray(r.appsLimpos) && r.appsLimpos.length === 2, JSON.stringify(r.appsLimpos));
        ok('global-avisa-apps', r.avisos.some((a) => /idioma próprio/.test(a)), JSON.stringify(r.avisos));
        ok('global-avisa-accept', r.avisos.some((a) => /Accept-Language/.test(a)), JSON.stringify(r.avisos));
    }

    // 4) idioma por app: sem aviso de Accept-Language, com o bundle no comando
    {
        const exec = fakeExec([{ code: 0, stdout: 'confirmed=yes\ndomain=com.apple.Preferences\nlanguage=en-US\nok=yes\noverride=yes\n', stderr: '' }]);
        const h = idioma.createHandlers({ exec });
        const r = await h.applyLanguage({ tag: 'en-US', domain: 'com.apple.Preferences' });
        ok('app-ok', r.success === true && r.aplicado === 'en-US', JSON.stringify(r));
        ok('app-sem-aviso-global', !r.avisos.some((a) => /Accept-Language/.test(a)), JSON.stringify(r.avisos));
        const cmd = exec.reais()[0].cmd;
        ok('app-cmd-bundle', cmd[cmd.indexOf('--domain') + 1] === 'com.apple.Preferences', cmd.join(' '));
    }

    // 5) com respring pedido, a flag vai junto e não pede para rodar depois
    {
        const exec = fakeExec([{ code: 0, stdout: 'confirmed=yes\nlanguage=pt-BR\nok=yes\n', stderr: '' }]);
        const h = idioma.createHandlers({ exec });
        const r = await h.applyLanguage({ tag: 'pt-BR', domain: 'global', confirmGlobal: true, respring: true });
        ok('respring-flag', exec.reais()[0].cmd.includes('--respring'), exec.reais()[0].cmd.join(' '));
        ok('respring-diz-que-respingou', r.respring === true, JSON.stringify(r));
        ok('respring-avisa-camlive', r.avisos.some((a) => /CAM LIVE/.test(a)), JSON.stringify(r.avisos));
    }

    // 6) tag inválido e domínio inválido não executam nada
    {
        const exec = fakeExec([]);
        const h = idioma.createHandlers({ exec });
        const r1 = await h.applyLanguage({ tag: 'pt BR; rm -rf /', domain: 'global', confirmGlobal: true });
        const r2 = await h.applyLanguage({ tag: 'pt-BR', domain: '../../etc/passwd' });
        ok('tag-invalido', r1.success === false, JSON.stringify(r1));
        ok('dominio-invalido', r2.success === false, JSON.stringify(r2));
        ok('invalido-nao-executa', exec.chamadas.length === 0, `${exec.chamadas.length} chamada(s)`);
    }

    // 7) aparelho não confirmou → success false
    {
        const exec = fakeExec([{ code: 1, stdout: SAIDA_SET_UNICO, stderr: '' }]);
        const h = idioma.createHandlers({ exec });
        const r = await h.applyLanguage({ tag: 'pt-BR', domain: 'global', confirmGlobal: true });
        ok('nao-confirmado', r.success === false && /não confirmou/.test(r.error || ''), JSON.stringify(r));
    }

    // 8) erro do aparelho (helper não instalado) é repassado com texto claro
    {
        const exec = fakeExec([{ code: 3, stdout: 'error=novalanguage não instalado em /var/jb/usr/bin/novalanguage\n', stderr: '' }]);
        const h = idioma.createHandlers({ exec });
        const r = await h.getLanguage({});
        ok('helper-ausente', r.success === false && /com\.aquiles\.novalanguage/.test(r.error || ''), JSON.stringify(r));
    }

    // 9) revert
    {
        const exec = fakeExec([{ code: 0, stdout: 'language=\nok=yes\noverride=no\nrevertido_de_backup=/var/mobile/x.orig\n', stderr: '' }]);
        const h = idioma.createHandlers({ exec });
        const r = await h.revertLanguage({ domain: 'global' });
        ok('revert', r.success === true && r.override === false, JSON.stringify(r));
        ok('revert-backup', r.backup === '/var/mobile/x.orig', r.backup);
        ok('revert-cmd', exec.reais()[0].cmd.includes('revert'), exec.reais()[0].cmd.join(' '));
    }

    // 10) revert sem backup → erro do aparelho
    {
        const exec = fakeExec([{ code: 5, stdout: 'error=sem backup de idioma para global\n', stderr: '' }]);
        const h = idioma.createHandlers({ exec });
        const r = await h.revertLanguage({});
        ok('revert-sem-backup', r.success === false && /sem backup/.test(r.error || ''), JSON.stringify(r));
    }

    // 11) respring solto
    {
        const exec = fakeExec([{ code: 0, stdout: 'respring=ok\nwarn=respring derruba o CAM LIVE; reconecte a câmera depois\n', stderr: '' }]);
        const h = idioma.createHandlers({ exec });
        const r = await h.respring();
        ok('respring', r.success === true, JSON.stringify(r));
        ok('respring-aviso', r.avisos.some((a) => /CAM LIVE/.test(a)), JSON.stringify(r.avisos));
    }

    // 12) nenhum comando em nenhum teste usou sudo ou shell
    {
        const exec = fakeExec([]);
        const h = idioma.createHandlers({ exec });
        await h.getLanguage({ domain: 'com.apple.mobilesafari' });
        const linha = exec.reais()[0].cmd.join(' ');
        ok('sem-sudo', !/sudo|su -c|sh -c/.test(linha), linha);
        ok('argv-separado', Array.isArray(exec.reais()[0].cmd) && exec.reais()[0].cmd.every((x) => typeof x === 'string'), linha);
    }

    // 12b) limparApps:false é respeitado; app domain não limpa nada
    {
        const exec = fakeExec([{ code: 0, stdout: 'confirmed=yes\nlanguage=pt-BR\nok=yes\n', stderr: '' }]);
        const h = idioma.createHandlers({ exec });
        await h.applyLanguage({ tag: 'pt-BR', domain: 'global', confirmGlobal: true, limparApps: false });
        ok('limparApps-false', exec.reais()[0].cmd.includes('--no-clear-apps'), exec.reais()[0].cmd.join(' '));
        ok('limparApps-false-sem-clear', !exec.reais()[0].cmd.includes('--clear-apps'), exec.reais()[0].cmd.join(' '));
    }

    // 12c) lista de apps com idioma próprio
    {
        const exec = fakeExec([{ code: 0, stdout: 'apps=com.a,com.b,com.c\ncount=3\nok=yes\n', stderr: '' }]);
        const h = idioma.createHandlers({ exec });
        const r = await h.listarApps();
        ok('lista-apps', r.success && r.count === 3 && r.apps.length === 3, JSON.stringify(r));
        ok('lista-apps-cmd', exec.reais()[0].cmd.includes('apps'), exec.reais()[0].cmd.join(' '));
    }

    // 12d) mensagens de erro traduzidas (o usuário não deve ver zsh cru)
    {
        ok('traduz-helper-antigo', /ajuda|antigo|v2/i.test(idioma.traduzirErro('language: subcomando desconhecido')), idioma.traduzirErro('subcomando desconhecido'));
        ok('traduz-sem-helper', /reinstale|não está nesse caminho/i.test(idioma.traduzirErro("zsh:1: no such file or directory: /var/jb/usr/bin/nova-locale")), 'x');
        ok('traduz-sem-pacote', /com\.aquiles\.novalanguage/.test(idioma.traduzirErro('error=novalanguage não instalado em /var/jb/usr/bin/novalanguage')), 'x');
        ok('traduz-outro', idioma.traduzirErro('erro qualquer') === 'erro qualquer', idioma.traduzirErro('erro qualquer'));
    }

    // 12e) helper v2: NÃO chama o helper (evita o laço do daemon) e explica
    {
        const exec = fakeExec([], 'V2');
        const h = idioma.createHandlers({ exec });
        const r = await h.getLanguage({});
        ok('v2-recusa', r.success === false && /antigo \(v2/.test(r.error || ''), JSON.stringify(r));
        ok('v2-sem-chamada-real', exec.reais().length === 0, JSON.stringify(exec.chamadas.map((c) => c.helper)));
        const r2 = await h.applyLanguage({ tag: 'pt-BR', domain: 'global', confirmGlobal: true });
        ok('v2-recusa-aplicar', r2.success === false && exec.reais().length === 0, JSON.stringify(r2));
        const r3 = await h.respring();
        ok('v2-recusa-respring', r3.success === false && exec.reais().length === 0, JSON.stringify(r3));
    }

    // 12f) helper ausente
    {
        const exec = fakeExec([], 'FALTA');
        const h = idioma.createHandlers({ exec });
        const r = await h.getLanguage({});
        ok('helper-falta', r.success === false && /não está instalado/.test(r.error || ''), JSON.stringify(r));
        ok('helper-falta-sem-chamada', exec.reais().length === 0, 'x');
    }

    // 13) parser de saída tolera lixo e junta avisos repetidos
    {
        const s = idioma.lerSaida('lixo\nwarn=um\nwarn=dois\nerror=foo\nlanguage=pt-BR\n');
        ok('parser-warns', s.warnings.length === 2, JSON.stringify(s.warnings));
        ok('parser-error', s.error === 'foo', s.error);
        ok('parser-language', s.language === 'pt-BR', s.language);
    }

    console.log(fails ? `${fails} FALHA(S) NO IPC` : 'IPC DE IDIOMA: TODOS OS TESTES PASSARAM');
    process.exit(fails ? 1 : 0);
})();
