'use strict';
// Teste do módulo idioma-ipc.js no Mac: nenhum ssh, nenhum aparelho.
// O `exec` é falso e registra exatamente os argumentos recebidos, para provar
// que nada é aplicado em silêncio e que não existe chamada com sudo.

const idioma = require('../idioma-ipc.js');

let fails = 0;
function ok(nome, cond, extra) {
    if (!cond) { fails++; console.log(`FALHA [${nome}] ${extra || ''}`); }
}

// exec falso: devolve o que for programado e guarda os comandos
function fakeExec(respostas = []) {
    const chamadas = [];
    const fn = async (cmd, timeoutMs) => {
        chamadas.push({ cmd, timeoutMs });
        const r = respostas.shift() || { code: 0, stdout: '', stderr: '' };
        return r;
    };
    fn.chamadas = chamadas;
    return fn;
}

const SAIDA_GET = 'domain=global\nlanguage=pt-BR\nlocale=pt_BR\nok=yes\noverride=yes\ndiskMatches=no\n';
const SAIDA_SET_OK = 'confirmed=yes\ndomain=global\nlanguage=pt-BR\nlocale=pt_BR\nok=yes\noverride=yes\nrequested=pt-BR\nsynced=yes\ndiskMatches=no\n';
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
        ok('get-disco', r.discoCombina === false && r.avisos.some((a) => /desligamento limpo/.test(a)), JSON.stringify(r.avisos));
        const cmd = exec.chamadas[0].cmd;
        ok('get-comando', cmd[0] === '/var/jb/usr/bin/nova-locale' && cmd[1] === 'language' && cmd[2] === 'get'
            && cmd.includes('--domain') && cmd.includes('global') && cmd.includes('lines'), cmd.join(' '));
        ok('get-sem-sudo', !cmd.join(' ').includes('sudo'), cmd.join(' '));
    }

    // 2) aplicar no global SEM confirmação: não executa nada
    {
        const exec = fakeExec([]);
        const h = idioma.createHandlers({ exec });
        const r = await h.applyLanguage({ tag: 'en-US', domain: 'global' });
        ok('global-sem-confirmar', r.success === false && r.precisaConfirmar === true, JSON.stringify(r));
        ok('global-sem-confirmar-nao-executa', exec.chamadas.length === 0, `${exec.chamadas.length} chamada(s)`);
        ok('global-sem-confirmar-avisa', r.avisos.some((a) => /Accept-Language/.test(a)), JSON.stringify(r.avisos));
    }

    // 3) aplicar no global COM confirmação: executa e devolve o que o aparelho confirmou
    {
        const exec = fakeExec([{ code: 0, stdout: SAIDA_SET_OK, stderr: '' }]);
        const h = idioma.createHandlers({ exec });
        const r = await h.applyLanguage({ tag: 'pt-BR', domain: 'global', confirmGlobal: true });
        ok('global-confirmado', r.success === true && r.aplicado === 'pt-BR' && r.confirmed === true, JSON.stringify(r));
        const cmd = exec.chamadas[0].cmd;
        ok('global-cmd', cmd.slice(0, 3).join(' ') === '/var/jb/usr/bin/nova-locale language set', cmd.join(' '));
        ok('global-cmd-tag', cmd[3] === 'pt-BR', cmd.join(' '));
        ok('global-cmd-dominio', cmd.includes('--domain') && cmd[cmd.indexOf('--domain') + 1] === 'global', cmd.join(' '));
        ok('global-cmd-sem-respring-padrao', !cmd.includes('--respring'), cmd.join(' '));
        ok('global-avisa-respring', r.avisos.some((a) => /CAM LIVE/.test(a)), JSON.stringify(r.avisos));
        ok('global-avisa-accept', r.avisos.some((a) => /Accept-Language/.test(a)), JSON.stringify(r.avisos));
    }

    // 4) idioma por app: sem aviso de Accept-Language, com o bundle no comando
    {
        const exec = fakeExec([{ code: 0, stdout: 'confirmed=yes\ndomain=com.apple.Preferences\nlanguage=en-US\nok=yes\noverride=yes\n', stderr: '' }]);
        const h = idioma.createHandlers({ exec });
        const r = await h.applyLanguage({ tag: 'en-US', domain: 'com.apple.Preferences' });
        ok('app-ok', r.success === true && r.aplicado === 'en-US', JSON.stringify(r));
        ok('app-sem-aviso-global', !r.avisos.some((a) => /Accept-Language/.test(a)), JSON.stringify(r.avisos));
        const cmd = exec.chamadas[0].cmd;
        ok('app-cmd-bundle', cmd[cmd.indexOf('--domain') + 1] === 'com.apple.Preferences', cmd.join(' '));
    }

    // 5) com respring pedido, a flag vai junto e não pede para rodar depois
    {
        const exec = fakeExec([{ code: 0, stdout: 'confirmed=yes\nlanguage=pt-BR\nok=yes\n', stderr: '' }]);
        const h = idioma.createHandlers({ exec });
        const r = await h.applyLanguage({ tag: 'pt-BR', domain: 'global', confirmGlobal: true, respring: true });
        ok('respring-flag', exec.chamadas[0].cmd.includes('--respring'), exec.chamadas[0].cmd.join(' '));
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
        ok('helper-ausente', r.success === false && /novalanguage não instalado/.test(r.error || ''), JSON.stringify(r));
    }

    // 9) revert
    {
        const exec = fakeExec([{ code: 0, stdout: 'language=\nok=yes\noverride=no\nrevertido_de_backup=/var/mobile/x.orig\n', stderr: '' }]);
        const h = idioma.createHandlers({ exec });
        const r = await h.revertLanguage({ domain: 'global' });
        ok('revert', r.success === true && r.override === false, JSON.stringify(r));
        ok('revert-backup', r.backup === '/var/mobile/x.orig', r.backup);
        ok('revert-cmd', exec.chamadas[0].cmd.includes('revert'), exec.chamadas[0].cmd.join(' '));
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
        const linha = exec.chamadas[0].cmd.join(' ');
        ok('sem-sudo', !/sudo|su -c|sh -c/.test(linha), linha);
        ok('argv-separado', Array.isArray(exec.chamadas[0].cmd) && exec.chamadas[0].cmd.every((x) => typeof x === 'string'), linha);
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
