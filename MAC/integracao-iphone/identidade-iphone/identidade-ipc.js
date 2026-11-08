'use strict';
// "Salvar" único e "Restaurar celular" para a identidade simulada do iPhone.
//
// O painel tem um botão só (Salvar) que empurra tudo para o aparelho de uma vez,
// e um botão que devolve o iPhone ao normal. Este módulo é o encadeamento: ele
// NÃO implementa modelo/proxy/GPS/idioma — chama o que já existe no app, na
// ordem certa, valida tudo ANTES de tocar no aparelho e devolve passo por passo
// o que aconteceu (nunca diz "salvo" sem conferir).
//
// Regras:
//  * validação antes de qualquer chamada: proxy, latitude/longitude, modelo,
//    idioma. Se algo está inválido, nada é aplicado.
//  * latitude/longitude começam VAZIAS na tela; se o campo estiver vazio, as
//    coordenadas vêm da proxy (geo real do IP de saída). Se você digitar, vale
//    o que você digitou.
//  * idioma: se você escolher, vale o escolhido; se não, vem do país da proxy
//    (mapa que o app já tem em `languageForCountry`).
//  * nada de sudo, nada de shell: só métodos do serviço e o módulo de idioma.
//  * restaurar = desligar os sistemas: modelo, proxy, GPS, idioma e injeção de
//    câmera; o aviso de que o iPhone volta ao IP e ao GPS reais vai na resposta.

const NOME_ARQUIVO = 'identidade-modelos.json';
const VERSAO_ARQUIVO = 1;

const ehNumero = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));

/** Coordenadas válidas: número, faixa real e sem string vazia. */
function validarCoordenadas(latitude, longitude) {
    const temLat = latitude !== undefined && latitude !== null && String(latitude).trim() !== '';
    const temLon = longitude !== undefined && longitude !== null && String(longitude).trim() !== '';
    if (!temLat && !temLon) return { ok: true, vazio: true, latitude: null, longitude: null };
    if (!temLat || !temLon) {
        return { ok: false, erro: 'preencha latitude e longitude, ou deixe as duas vazias para usar a proxy' };
    }
    if (!ehNumero(latitude) || !ehNumero(longitude)) {
        return { ok: false, erro: 'latitude e longitude precisam ser números (ex.: 32.7254134 e -97.3208492)' };
    }
    const lat = Number(latitude);
    const lon = Number(longitude);
    if (lat < -90 || lat > 90) return { ok: false, erro: 'latitude fora da faixa -90 a 90' };
    if (lon < -180 || lon > 180) return { ok: false, erro: 'longitude fora da faixa -180 a 180' };
    return { ok: true, vazio: false, latitude: lat, longitude: lon };
}

/** Loja simples em arquivo JSON, com injeção para teste (nunca no aparelho). */
function criarLoja(fs, caminho) {
    return {
        ler() {
            try {
                const bruto = fs.readFileSync(caminho, 'utf8');
                const dados = JSON.parse(bruto);
                if (!dados || !Array.isArray(dados.modelos)) return { versao: VERSAO_ARQUIVO, modelos: [] };
                return { versao: dados.versao || VERSAO_ARQUIVO, modelos: dados.modelos };
            } catch {
                // arquivo ausente ou corrompido: começa vazio em vez de derrubar o app
                return { versao: VERSAO_ARQUIVO, modelos: [] };
            }
        },
        gravar(dados) {
            fs.writeFileSync(caminho, JSON.stringify({ versao: VERSAO_ARQUIVO, ...dados }, null, 2),
                { encoding: 'utf8', mode: 0o600 });
            // O perfil guarda a proxy COM senha: 600 sempre, mesmo se o arquivo já
            // existia com permissão mais aberta (os outros JSONs do app são 644).
            try { fs.chmodSync(caminho, 0o600); } catch { /* sistema de arquivos sem chmod */ }
        },
        caminho
    };
}

function createIdentidade({ service, language, geo, store, deviceId = 'ios-1', agora = () => new Date().toISOString() }) {
    const agoraISO = () => String(agora());
    if (!service) throw new Error('service obrigatório');

    const log = [];
    const anotar = (m) => { log.push(m); if (log.length > 200) log.shift(); };

    async function geoDaProxy(proxy) {
        const bruto = String(proxy || '').trim();
        if (!bruto) return { success: false, error: 'informe a proxy para buscar as coordenadas' };
        if (!geo || typeof geo.throughProxy !== 'function') {
            return { success: false, error: 'geolocalização indisponível' };
        }
        try {
            const g = await geo.throughProxy(bruto);
            return {
                success: true,
                ip: g.ip, cidade: g.city, regiao: g.region, pais: g.country, paisCodigo: g.countryCode,
                latitude: g.lat, longitude: g.lon, fuso: g.timezone, isp: g.isp
            };
        } catch (e) {
            return { success: false, error: `não consegui falar com a proxy: ${e.message || e}` };
        }
    }

    // ── Salvar tudo ────────────────────────────────────────────────────────────
    async function salvarTudo(pedido = {}) {
        const { modelo, proxy, latitude, longitude, idioma, respring = false, confirmarIdiomaGlobal = true } = pedido;
        const passos = [];
        const avisos = [];
        const falhar = (passo, erro) => ({ success: false, erro, passoQueFalhou: passo, passos, avisos });

        // 1) validação — nada é aplicado se algo estiver errado
        const modeloLimpo = String(modelo || '').trim();
        const proxyLimpo = String(proxy || '').trim();
        if (!modeloLimpo && !proxyLimpo && !ehNumero(latitude) && !idioma) {
            return falhar('validacao', 'preencha pelo menos modelo, proxy, coordenadas ou idioma');
        }
        if (proxyLimpo && geo && typeof geo.parseProxy === 'function' && !geo.parseProxy(proxyLimpo)) {
            return falhar('validacao', 'proxy inválida: cole no formato host:porta:usuario:senha ou use o seletor de tipo');
        }
        const coords = validarCoordenadas(latitude, longitude);
        if (!coords.ok) return falhar('validacao', coords.erro);

        // 2) de onde vêm as coordenadas e o idioma
        let coordsFinal = coords.vazio ? null : { latitude: coords.latitude, longitude: coords.longitude };
        let paisCodigo = null;
        if (proxyLimpo) {
            const g = await geoDaProxy(proxyLimpo);
            if (g.success) {
                paisCodigo = g.paisCodigo || null;
                if (!coordsFinal) {
                    coordsFinal = { latitude: g.latitude, longitude: g.longitude, daProxy: true, cidade: g.cidade };
                    anotar(`coordenadas vieram da proxy: ${g.latitude}, ${g.longitude} (${g.cidade})`);
                }
            } else if (!coordsFinal) {
                return falhar('proxy', `${g.error} — sem coordenadas digitadas, não há como definir o GPS`);
            }
        }

        let idiomaFinal = idioma ? String(idioma) : null;
        if (!idiomaFinal && paisCodigo && typeof service.languageForCountry === 'function') {
            idiomaFinal = service.languageForCountry(paisCodigo).language;
            avisos.push(`idioma escolhido pelo país da proxy (${paisCodigo}): ${idiomaFinal}`);
        }
        if (idiomaFinal === 'keep') idiomaFinal = null;

        // 3) modelo
        if (modeloLimpo) {
            const r = await service.applyIOSModel(deviceId, modeloLimpo);
            passos.push({ passo: 'modelo', ok: !!(r && r.success), detalhe: (r && (r.message || r.error)) || null });
            if (!(r && r.success)) return falhar('modelo', (r && r.error) || 'não consegui aplicar o modelo');
        }

        // 4) proxy
        if (proxyLimpo) {
            const r = await service.iosProxySet(deviceId, proxyLimpo);
            passos.push({ passo: 'proxy', ok: !!(r && r.success), detalhe: (r && (r.message || r.error)) || null });
            if (!(r && r.success)) return falhar('proxy', (r && r.error) || 'não consegui aplicar a proxy');
        }

        // 5) GPS (digitado ou da proxy)
        if (coordsFinal) {
            const r = await service.iosSetLocation(deviceId, coordsFinal.latitude, coordsFinal.longitude);
            passos.push({
                passo: 'gps', ok: !!(r && r.success),
                detalhe: (r && (r.message || r.error)) || `${coordsFinal.latitude}, ${coordsFinal.longitude}`,
                latitude: coordsFinal.latitude, longitude: coordsFinal.longitude, daProxy: !!coordsFinal.daProxy
            });
            if (!(r && r.success)) return falhar('gps', (r && r.error) || 'não consegui aplicar a localização');
        }

        // 6) idioma (aparelho inteiro)
        if (idiomaFinal && language && typeof language.applyLanguage === 'function') {
            const r = await language.applyLanguage({
                tag: idiomaFinal, domain: 'global', respring: false,
                confirmGlobal: confirmarIdiomaGlobal === true
            });
            passos.push({ passo: 'idioma', ok: !!(r && r.success), detalhe: (r && (r.aplicado || r.error)) || null });
            if (r && Array.isArray(r.avisos)) avisos.push(...r.avisos);
            if (!(r && r.success)) return falhar('idioma', (r && r.error) || 'não consegui aplicar o idioma');
        }

        // 7) respring: NÃO acontece por padrão. O usuário decidiu que o Salvar não
        // pode derrubar o CAM LIVE; então o idioma fica gravado no store e vale
        // para todo app aberto daqui em diante, mas a interface atual do iPhone
        // só muda num reinício/respring que ele mesmo provocar.
        if (respring && idiomaFinal && language && typeof language.respring === 'function') {
            const r = await language.respring();
            passos.push({ passo: 'respring', ok: !!(r && r.success), detalhe: 'respring pedido explicitamente' });
            avisos.push('O CAM LIVE caiu com o respring: reconecte a câmera.');
        } else if (idiomaFinal) {
            passos.push({ passo: 'respring', ok: true, pulado: true, detalhe: 'não reiniciado de propósito (CAM LIVE preservado)' });
            avisos.push('Idioma gravado no aparelho inteiro. A interface do iPhone muda no próximo reinício ou respring; '
                + 'o CAM LIVE continua funcionando agora.');
        }

        return {
            success: true,
            passos,
            avisos: [...new Set(avisos)],
            resultado: {
                modelo: modeloLimpo || null,
                proxy: proxyLimpo || null,
                latitude: coordsFinal ? coordsFinal.latitude : null,
                longitude: coordsFinal ? coordsFinal.longitude : null,
                coordsDaProxy: !!(coordsFinal && coordsFinal.daProxy),
                idioma: idiomaFinal || null,
                paisDaProxy: paisCodigo
            }
        };
    }

    // ── Restaurar celular (sem os sistemas rodando) ────────────────────────────
    async function restaurarCelular(pedido = {}) {
        // respring=false por padrão: desfazer não pode derrubar o CAM LIVE.
        // Câmera: o usuário respondeu que "Restaurar" NÃO encerra o CAM LIVE,
        // então nem a injeção nem a transmissão são tocadas por padrão. Só com
        // pararCamera / pararCamLive explícitos.
        const { idioma = true, respring = false, pararCamLive = false, pararCamera = false } = pedido;
        const passos = [];
        const avisos = [];
        const tentar = async (passo, fn) => {
            let r;
            try { r = await fn(); } catch (e) { r = { success: false, error: e.message || String(e) }; }
            const ok = !!(r && r.success !== false && !(r && r.error && !r.success));
            const detalhe = (r && (r.message || r.error || r.note)) || null;
            passos.push({ passo, ok, detalhe });
            return ok;
        };

        // Ordem: proxy primeiro (tira a saída falsa), depois o resto.
        if (pararCamera) await tentar('camera', () => service.stopCamSpoof(deviceId));
        if (pararCamLive && typeof service.iosStopStream === 'function') {
            await tentar('cam-live', () => service.iosStopStream(deviceId));
        }
        await tentar('proxy', () => service.iosProxyClear(deviceId));
        await tentar('gps', () => service.iosStopLocation(deviceId));
        await tentar('modelo', () => service.clearIOSModel(deviceId));
        if (idioma && language && typeof language.revertLanguage === 'function') {
            const r = await language.revertLanguage({ domain: 'global', respring: false });
            passos.push({ passo: 'idioma', ok: !!(r && r.success), detalhe: (r && (r.error || r.language)) || null });
            if (r && Array.isArray(r.avisos)) avisos.push(...r.avisos);
            if (r && r.success && r.override === false) avisos.push('Idioma voltou ao valor de antes do primeiro Salvar.');
        }
        await tentar('fuso', () => service.iosRevertLocale(deviceId));

        if (respring && language && typeof language.respring === 'function') {
            const r = await language.respring();
            passos.push({ passo: 'respring', ok: !!(r && r.success) });
            avisos.push('O CAM LIVE caiu com o respring: reconecte a câmera.');
        } else {
            passos.push({ passo: 'respring', ok: true, pulado: true, detalhe: 'não reiniciado (CAM LIVE preservado)' });
            avisos.push('A interface do iPhone volta ao idioma anterior no próximo reinício; o CAM LIVE segue no ar.');
        }

        const falhou = passos.filter((p) => !p.ok).map((p) => p.passo);
        return {
            success: falhou.length === 0,
            passos,
            avisos: [...new Set([
                'O iPhone volta ao IP e ao GPS reais; se a proxy saiu, o Safari sai pela operadora.',
                'O CAM LIVE e a injeção de câmera NÃO foram mexidos (só saem com pararCamera/pararCamLive).',
                ...avisos
            ])],
            naoRevertido: falhou,
            error: falhou.length ? `não consegui reverter: ${falhou.join(', ')}` : null
        };
    }

    // ── Registrar modelo (snapshot para reusar depois) ─────────────────────────
    /** Nome pronto para o popup (o usuário pode trocar). Ex.: "iPhone 15 · Fort Worth · 08/11 18:20". */
    function sugerirNome(extra = {}) {
        const modelo = String(extra.modelo || '').trim();
        const cidade = String(extra.cidade || '').trim();
        const agora = agoraISO();
        const dia = agora.slice(8, 10), mes = agora.slice(5, 7), hora = agora.slice(11, 16);
        const partes = [modelo || 'iPhone', cidade || null, `${dia}/${mes} ${hora}`].filter(Boolean);
        return { success: true, nome: partes.join(' · ').replace(/ ·  · /g, ' · ') };
    }

    async function registrarModelo(pedido = {}) {
        const nome = String(pedido.nome || '').trim();
        if (nome.length < 2) return { success: false, error: 'dê um nome ao modelo registrado (mínimo 2 letras)', precisaNome: true };
        const modelo = String(pedido.modelo || '').trim();
        if (!modelo) return { success: false, error: 'escolha o modelo do aparelho antes de registrar' };
        const proxy = String(pedido.proxy || '').trim();
        const coords = validarCoordenadas(pedido.latitude, pedido.longitude);
        if (!coords.ok) return { success: false, error: coords.erro };

        const dados = store.ler();
        // "Registra tudo": o perfil guarda o conjunto da identidade — modelo,
        // proxy, idioma e coordenadas — mais o que ajuda a achar depois (cidade,
        // fuso, país). Coordenada vazia fica marcada: ao aplicar, vem da proxy.
        const registro = {
            nome,
            modelo,
            proxy: proxy || null,
            latitude: coords.vazio ? null : coords.latitude,
            longitude: coords.vazio ? null : coords.longitude,
            coordsDaProxy: !!coords.vazio && !!proxy,
            idioma: pedido.idioma && pedido.idioma !== 'keep' ? String(pedido.idioma) : null,
            fuso: pedido.fuso ? String(pedido.fuso) : null,
            cidade: pedido.cidade ? String(pedido.cidade) : null,
            paisCodigo: pedido.paisCodigo ? String(pedido.paisCodigo).toUpperCase() : null,
            registradoEm: agora()
        };
        registro.completo = !!(registro.modelo && registro.proxy && registro.idioma
            && (registro.latitude !== null || registro.coordsDaProxy));
        const idx = dados.modelos.findIndex((m) => String(m.nome).toLowerCase() === nome.toLowerCase());
        const substituiu = idx >= 0;
        // Já existe com esse nome: NÃO sobrescreve sem você confirmar no popup.
        if (substituiu && pedido.substituir !== true) {
            return {
                success: false, jaExiste: true, nomeExistente: dados.modelos[idx].nome,
                error: `já existe um modelo chamado "${dados.modelos[idx].nome}". Confirme para substituir ou escolha outro nome.`
            };
        }
        if (substituiu) dados.modelos[idx] = registro;
        else dados.modelos.push(registro);
        try {
            store.gravar(dados);
        } catch (e) {
            return { success: false, error: `não consegui gravar o arquivo de modelos: ${e.message}` };
        }
        return {
            success: true, registro, substituiu, total: dados.modelos.length,
            // A lista pode mostrar o que falta, em vez de fingir perfil completo.
            faltando: [
                !registro.modelo && 'modelo', !registro.proxy && 'proxy',
                !registro.idioma && 'idioma',
                registro.latitude === null && !registro.coordsDaProxy && 'latitude/longitude'
            ].filter(Boolean)
        };
    }

    function listarModelos() {
        const dados = store.ler();
        return { success: true, total: dados.modelos.length, modelos: dados.modelos };
    }

    async function removerModelo({ nome } = {}) {
        const alvo = String(nome || '').trim().toLowerCase();
        if (!alvo) return { success: false, error: 'informe o nome do modelo' };
        const dados = store.ler();
        const antes = dados.modelos.length;
        dados.modelos = dados.modelos.filter((m) => String(m.nome).toLowerCase() !== alvo);
        if (dados.modelos.length === antes) return { success: false, error: 'esse modelo não está registrado' };
        store.gravar(dados);
        return { success: true, total: dados.modelos.length };
    }

    /** Aplica um modelo registrado: é o Salvar com o que estava guardado. */
    async function aplicarModeloRegistrado({ nome, respring } = {}) {
        const alvo = String(nome || '').trim().toLowerCase();
        const registro = listarModelos().modelos.find((m) => String(m.nome).toLowerCase() === alvo);
        if (!registro) return { success: false, error: 'modelo registrado não encontrado' };
        return salvarTudo({
            modelo: registro.modelo, proxy: registro.proxy,
            latitude: registro.latitude, longitude: registro.longitude,
            idioma: registro.idioma || undefined, respring
        });
    }

    /** Idioma que combina com o país da proxy (só sugere; aplicar é no Salvar). */
    async function idiomaDaProxy(proxy) {
        const g = await geoDaProxy(proxy);
        if (!g.success) return g;
        const cc = g.paisCodigo;
        if (!cc || typeof service.languageForCountry !== 'function') {
            return { success: false, error: 'não consegui descobrir o país da proxy' };
        }
        const { language: tag, locale } = service.languageForCountry(cc);
        return { success: true, paisCodigo: cc, pais: g.pais || null, idioma: tag, locale, cidade: g.cidade || null };
    }

    return {
        salvarTudo, restaurarCelular, registrarModelo, listarModelos, removerModelo,
        idiomaDaProxy, sugerirNome,
        aplicarModeloRegistrado, geoDaProxy, validarCoordenadas, log, deviceId
    };
}

/** Registra os IPCs. `service` é o physicalMobileService do app; `language` é o módulo de idioma. */
function register(app, ipcMain, options = {}) {
    const fs = options.fs || require('fs');
    const path = options.path || require('path');
    const os = options.os || require('os');
    const service = options.service || (app && app.physicalMobileService);
    const language = options.language || require('./idioma-ipc').createHandlers({
        exec: require('./idioma-ipc').executarNoAparelho
    });
    const geo = options.geo || require('./geo-proxy');
    // userData já é a pasta de dados do app (onde ficam chats.json, memories.json…).
    const arquivo = options.arquivo || path.join(app.getPath('userData'), NOME_ARQUIVO);
    const store = criarLoja(fs, arquivo);

    const id = createIdentidade({
        service, language, geo, store,
        deviceId: options.deviceId || 'ios-1',
        agora: options.agora
    });

    ipcMain.handle('spoofer:salvar-tudo', async (_e, args) => id.salvarTudo(args || {}));
    ipcMain.handle('spoofer:restaurar-celular', async (_e, args) => id.restaurarCelular(args || {}));
    ipcMain.handle('spoofer:revert-all', async (_e, args) => id.restaurarCelular(args || {}));  // alias
    ipcMain.handle('spoofer:registrar-modelo', async (_e, args) => id.registrarModelo(args || {}));
    ipcMain.handle('spoofer:listar-modelos-registrados', async () => id.listarModelos());
    ipcMain.handle('spoofer:remover-modelo-registrado', async (_e, args) => id.removerModelo(args || {}));
    ipcMain.handle('spoofer:aplicar-modelo-registrado', async (_e, args) => id.aplicarModeloRegistrado(args || {}));
    ipcMain.handle('spoofer:coords-da-proxy', async (_e, args) => id.geoDaProxy((args || {}).proxy));
    ipcMain.handle('spoofer:validar-coordenadas', async (_e, args) => validarCoordenadas((args || {}).latitude, (args || {}).longitude));
    ipcMain.handle('spoofer:idioma-da-proxy', async (_e, args) => id.idiomaDaProxy((args || {}).proxy));
    ipcMain.handle('spoofer:sugerir-nome-modelo', async (_e, args) => id.sugerirNome(args || {}));

    return { id, arquivo };
}

module.exports = {
    createIdentidade, register, validarCoordenadas, criarLoja, NOME_ARQUIVO, VERSAO_ARQUIVO
};
