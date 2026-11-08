'use strict';
// Teste do módulo identidade-ipc.js no Mac: nenhum ssh, nenhum aparelho.
// O serviço, o idioma, a geo e a loja são falsos e registram a ordem exata das
// chamadas — é isso que prova o "Salvar tudo" e o "Restaurar celular".

const identidade = require('../identidade-ipc.js');

let fails = 0;
const ok = (nome, cond, extra) => { if (!cond) { fails++; console.log(`FALHA [${nome}] ${extra || ''}`); } };

// ── fakes ────────────────────────────────────────────────────────────────────
function fakeService(opts = {}) {
    const chamadas = [];
    const reg = (nome, resp = { success: true }) => async (...args) => {
        chamadas.push({ nome, args });
        if (opts.falhar === nome) return { success: false, error: `falha simulada em ${nome}` };
        return typeof resp === 'function' ? resp(...args) : resp;
    };
    const s = {
        applyIOSModel: reg('applyIOSModel'),
        clearIOSModel: reg('clearIOSModel'),
        iosProxySet: reg('iosProxySet'),
        iosProxyClear: reg('iosProxyClear'),
        iosSetLocation: reg('iosSetLocation', (id, la, lo) => ({ success: true, latitude: la, longitude: lo, timezone: 'America/Chicago' })),
        iosStopLocation: reg('iosStopLocation'),
        iosApplyLocale: reg('iosApplyLocale'),
        iosRevertLocale: reg('iosRevertLocale'),
        stopCamSpoof: reg('stopCamSpoof'),
        languageForCountry: (cc) => ({ language: cc === 'BR' ? 'pt-BR' : 'en-US', locale: cc === 'BR' ? 'pt_BR' : 'en_US' })
    };
    s.chamadas = chamadas;
    s.ordem = () => chamadas.map((c) => c.nome);
    return s;
}

function fakeLanguage(opts = {}) {
    const chamadas = [];
    return {
        chamadas,
        async applyLanguage(args) {
            chamadas.push({ nome: 'applyLanguage', args });
            if (opts.falharApply) return { success: false, error: 'falha simulada no idioma' };
            return { success: true, aplicado: args.tag, confirmed: true, escopo: 'aparelho', avisos: ['idioma global muda o Accept-Language'] };
        },
        async revertLanguage(args) {
            chamadas.push({ nome: 'revertLanguage', args });
            return { success: true, language: 'en-US', override: false, avisos: [] };
        },
        async respring() {
            chamadas.push({ nome: 'respring' });
            return { success: true, avisos: [] };
        }
    };
}

function fakeGeo(opts = {}) {
    return {
        parseProxy: (s) => (opts.invalida ? null : (/^socks5:\/\/.+:\d+/.test(String(s)) ? { scheme: 'socks5' } : null)),
        async throughProxy() {
            if (opts.falhar) throw new Error('proxy recusou');
            return { ip: '72.217.16.159', city: 'Phoenix', region: 'Arizona', country: 'United States',
                countryCode: 'US', lat: 33.4483757, lon: -112.0740433, timezone: 'America/Phoenix', isp: 'X' };
        }
    };
}

function memoriaLoja(inicial = []) {
    let dados = { versao: 1, modelos: JSON.parse(JSON.stringify(inicial)) };
    return {
        ler: () => JSON.parse(JSON.stringify(dados)),
        gravar: (d) => { dados = JSON.parse(JSON.stringify(d)); },
        get dados() { return dados; }
    };
}

const PROXY_OK = 'socks5://premium-residential.evomi.com:1002:user:senha_country-US_lifetime-1440';

function criar(opts = {}) {
    const service = fakeService(opts.service);
    const language = fakeLanguage(opts.language);
    const store = opts.store || memoriaLoja();
    const id = identidade.createIdentidade({
        service, language, geo: opts.geo || fakeGeo(opts.geoOpts), store,
        deviceId: 'ios-1', agora: () => '2026-11-08T18:00:00.000Z'
    });
    return { id, service, language, store };
}

(async () => {
    // 1) nada preenchido
    {
        const { id, service } = criar();
        const r = await id.salvarTudo({});
        ok('vazio-recusa', r.success === false, JSON.stringify(r));
        ok('vazio-sem-chamadas', service.chamadas.length === 0, service.ordem().join(','));
    }

    // 2) proxy inválida
    {
        const { id, service } = criar({ geoOpts: { invalida: true } });
        const r = await id.salvarTudo({ proxy: 'lixo', modelo: 'iPhone15,4' });
        ok('proxy-invalida', r.success === false && /proxy inválida/.test(r.erro || ''), JSON.stringify(r));
        ok('proxy-invalida-sem-chamadas', service.chamadas.length === 0, service.ordem().join(','));
    }

    // 3) coordenadas
    {
        const { id } = criar();
        const casos = [
            [{ latitude: 91, longitude: 0 }, 'latitude fora'],
            [{ latitude: 0, longitude: -181 }, 'longitude fora'],
            [{ latitude: 10 }, 'preencha latitude e longitude'],
            [{ latitude: 'abc', longitude: '1' }, 'precisam ser números']
        ];
        for (const [coords, msg] of casos) {
            const r = await id.salvarTudo({ modelo: 'iPhone15,4', ...coords });
            ok(`coords:${msg}`, r.success === false && String(r.erro || '').includes(msg), JSON.stringify(r));
        }
        const v = id.validarCoordenadas('', ' ');
        ok('coords-vazias-ok', v.ok === true && v.vazio === true, JSON.stringify(v));
    }

    // 4) Salvar tudo com coordenadas DIGITADAS: ordem e valores
    {
        const { id, service, language } = criar();
        const r = await id.salvarTudo({
            modelo: 'iPhone15,4', proxy: PROXY_OK,
            latitude: '40.7128', longitude: '-74.0060', idioma: 'en-US'
        });
        ok('salvar-ok', r.success === true, JSON.stringify(r));
        ok('salvar-ordem', service.ordem().join('>') === 'applyIOSModel>iosProxySet>iosSetLocation', service.ordem().join('>'));
        const gps = service.chamadas.find((c) => c.nome === 'iosSetLocation');
        ok('salvar-gps-digitado', gps.args[1] === 40.7128 && gps.args[2] === -74.006, JSON.stringify(gps.args));
        ok('salvar-nao-inventou-idpais', r.resultado.idioma === 'en-US', JSON.stringify(r.resultado));
        ok('salvar-idioma-uma-vez', language.chamadas.filter((c) => c.nome === 'applyLanguage').length === 1, JSON.stringify(language.chamadas));
        ok('salvar-idioma-global', language.chamadas[0].args.domain === 'global', JSON.stringify(language.chamadas[0].args));
        ok('salvar-respring', language.chamadas.some((c) => c.nome === 'respring'), JSON.stringify(language.chamadas.map((c) => c.nome)));
        ok('salvar-passos', r.passos.map((p) => p.passo).join(',') === 'modelo,proxy,gps,idioma,respring', r.passos.map((p) => p.passo).join(','));
        ok('salvar-avisa-camlive', r.avisos.some((a) => /CAM LIVE/.test(a)), JSON.stringify(r.avisos));
    }

    // 5) coordenadas VAZIAS → vêm da proxy
    {
        const { id, service } = criar();
        const r = await id.salvarTudo({ modelo: 'iPhone15,4', proxy: PROXY_OK, latitude: '', longitude: '' });
        const gps = service.chamadas.find((c) => c.nome === 'iosSetLocation');
        ok('vazio-usa-proxy', r.success && gps.args[1] === 33.4483757 && gps.args[2] === -112.0740433, JSON.stringify(gps.args));
        ok('vazio-marca-origem', r.resultado.coordsDaProxy === true, JSON.stringify(r.resultado));
        ok('vazio-idioma-do-pais', r.resultado.idioma === 'en-US', JSON.stringify(r.resultado));
        ok('vazio-avisa-idioma', r.avisos.some((a) => /país da proxy/.test(a)), JSON.stringify(r.avisos));
    }

    // 6) proxy sem geo e sem coordenadas digitadas → não aplica GPS chutado
    {
        const { id, service } = criar({ geoOpts: { falhar: true } });
        const r = await id.salvarTudo({ modelo: 'iPhone15,4', proxy: PROXY_OK });
        ok('geo-falhou-erro', r.success === false && r.passoQueFalhou === 'proxy', JSON.stringify(r));
        ok('geo-falhou-sem-gps', !service.ordem().includes('iosSetLocation'), service.ordem().join(','));
    }

    // 7) falha no proxy para o fluxo e diz o que rodou
    {
        const { id, service, language } = criar({ service: { falhar: 'iosProxySet' } });
        const r = await id.salvarTudo({ modelo: 'iPhone15,4', proxy: PROXY_OK, idioma: 'en-US' });
        ok('falha-proxy', r.success === false && r.passoQueFalhou === 'proxy', JSON.stringify(r));
        ok('falha-proxy-nao-gps', !service.ordem().includes('iosSetLocation'), service.ordem().join(','));
        ok('falha-proxy-nao-idioma', language.chamadas.length === 0, JSON.stringify(language.chamadas));
        ok('falha-proxy-mostra-rodou', r.passos.length === 2, JSON.stringify(r.passos));
    }

    // 8) idioma explícito 'keep' não aplica idioma
    {
        const { id, language } = criar();
        const r = await id.salvarTudo({ modelo: 'iPhone15,4', idioma: 'keep' });
        ok('idioma-keep', r.success === true && language.chamadas.length === 0, JSON.stringify(language.chamadas));
    }

    // 9) Restaurar celular: ordem e avisos
    {
        const { id, service, language } = criar();
        const r = await id.restaurarCelular({});
        ok('restaurar-ok', r.success === true, JSON.stringify(r));
        ok('restaurar-ordem', service.ordem().join('>') === 'stopCamSpoof>iosProxyClear>iosStopLocation>clearIOSModel>iosRevertLocale',
            service.ordem().join('>'));
        ok('restaurar-idioma', language.chamadas.some((c) => c.nome === 'revertLanguage'), JSON.stringify(language.chamadas));
        ok('restaurar-respring', language.chamadas.some((c) => c.nome === 'respring'), JSON.stringify(language.chamadas));
        ok('restaurar-avisa-ip-real', r.avisos.some((a) => /IP e ao GPS reais/.test(a)), JSON.stringify(r.avisos));
        ok('restaurar-nada-pendente', Array.isArray(r.naoRevertido) && r.naoRevertido.length === 0, JSON.stringify(r.naoRevertido));
    }

    // 10) Restaurar com uma etapa falhando: continua e reporta
    {
        const { id } = criar({ service: { falhar: 'iosStopLocation' } });
        const r = await id.restaurarCelular({});
        ok('restaurar-parcial', r.success === false && r.naoRevertido.includes('gps'), JSON.stringify(r.naoRevertido));
        ok('restaurar-parcial-continua', r.passos.some((p) => p.passo === 'modelo' && p.ok), JSON.stringify(r.passos));
    }

    // 11) Registrar modelo
    {
        const { id, store } = criar();
        ok('registrar-sem-nome', (await id.registrarModelo({ modelo: 'iPhone15,4' })).success === false);
        ok('registrar-sem-modelo', (await id.registrarModelo({ nome: 'Casa' })).success === false);
        const r1 = await id.registrarModelo({ nome: 'Casa', modelo: 'iPhone15,4', proxy: PROXY_OK, latitude: 32.72, longitude: -97.32, idioma: 'en-US' });
        ok('registrar-ok', r1.success && r1.total === 1, JSON.stringify(r1));
        ok('registrar-gravou', store.dados.modelos.length === 1, JSON.stringify(store.dados));
        const r2 = await id.registrarModelo({ nome: 'casa', modelo: 'iPhone14,2' });
        ok('registrar-substitui', r2.substituiu === true && store.dados.modelos.length === 1, JSON.stringify(r2));
        const lista = id.listarModelos();
        ok('listar', lista.total === 1 && lista.modelos[0].modelo === 'iPhone14,2', JSON.stringify(lista));
        ok('remover', (await id.removerModelo({ nome: 'CASA' })).success === true && id.listarModelos().total === 0);
        ok('remover-inexistente', (await id.removerModelo({ nome: 'nao-existe' })).success === false);
    }

    // 12) Aplicar modelo registrado reusa o Salvar tudo
    {
        const store = memoriaLoja([{ nome: 'Casa', modelo: 'iPhone15,4', proxy: PROXY_OK, latitude: 32.72, longitude: -97.32, idioma: 'en-US' }]);
        const { id, service, language } = criar({ store });
        const r = await id.aplicarModeloRegistrado({ nome: 'casa' });
        ok('aplicar-registrado', r.success === true, JSON.stringify(r));
        ok('aplicar-registrado-ordem', service.ordem().join('>') === 'applyIOSModel>iosProxySet>iosSetLocation', service.ordem().join('>'));
        ok('aplicar-registrado-idioma', language.chamadas[0].args.tag === 'en-US', JSON.stringify(language.chamadas[0].args));
        const r2 = await id.aplicarModeloRegistrado({ nome: 'inexistente' });
        ok('aplicar-registrado-inexistente', r2.success === false, JSON.stringify(r2));
    }

    // 13) Loja com arquivo corrompido ou que não grava
    {
        const fsRuim = { readFileSync: () => '{lixo', writeFileSync: () => { throw new Error('disco cheio'); } };
        const store = identidade.criarLoja(fsRuim, '/tmp/nao-existe.json');
        ok('loja-corrompida', store.ler().modelos.length === 0, JSON.stringify(store.ler()));
        const { id } = criar({ store });
        const r = await id.registrarModelo({ nome: 'Casa', modelo: 'iPhone15,4' });
        ok('loja-sem-gravar', r.success === false && /não consegui gravar/.test(r.error || ''), JSON.stringify(r));
    }

    // 14) Nenhuma chamada pede sudo/shell
    {
        const { id, service } = criar();
        await id.salvarTudo({ modelo: 'iPhone15,4', proxy: PROXY_OK, latitude: 1, longitude: 2, idioma: 'en-US' });
        const tudo = JSON.stringify(service.chamadas) + JSON.stringify(service.chamadas);
        ok('sem-sudo', !/sudo|sh -c|bash -c/.test(tudo), tudo.slice(0, 200));
    }

    // 15) geoDaProxy devolve o que a tela precisa para preencher lat/lon
    {
        const { id } = criar();
        const g = await id.geoDaProxy(PROXY_OK);
        ok('geo-campos', g.success && Number(g.latitude) === 33.4483757 && g.cidade === 'Phoenix' && g.fuso === 'America/Phoenix', JSON.stringify(g));
        const g2 = await id.geoDaProxy('');
        ok('geo-sem-proxy', g2.success === false, JSON.stringify(g2));
    }

    console.log(fails ? `${fails} FALHA(S) NA IDENTIDADE` : 'IDENTIDADE (SALVAR/RASTREAR/RESTAURAR): TODOS OS TESTES PASSARAM');
    process.exit(fails ? 1 : 0);
})();
