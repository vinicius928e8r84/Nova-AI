const SINAIS_DE_SESSAO_RECUSADA = ['AUTH_KEY_UNREGISTERED', '401'];
const CAMPOS_DO_PROXY_MTPROTO = ['proxyIp', 'proxyPort', 'proxySecret'];
const CAMPOS_DO_PROXY_SOCKS = ['proxyIp', 'proxyPort'];

const PERFIS_DE_APARELHO = new Map([
    [6, { deviceModel: 'Samsung SM-S908B', systemVersion: 'Android 13', appVersion: '10.14.0' }],
    [2040, { deviceModel: 'Desktop', systemVersion: 'Windows 11', appVersion: '4.16.2' }],
    [2496, { deviceModel: 'WebK', systemVersion: 'Chrome/120.0.0.0', appVersion: '2.0.0' }],
]);
const PERFIL_PADRAO = { deviceModel: 'Nova Desktop Assistant', systemVersion: 'Windows 11', appVersion: '1.0.11' };

const camposPreenchidos = (dados, campos) => campos.every((campo) => dados[campo]);
const sessaoRecusada = (erro) => SINAIS_DE_SESSAO_RECUSADA.some((sinal) => erro.message.includes(sinal));

function opcoesDoPerfil(apiId) {
    const perfil = PERFIS_DE_APARELHO.get(parseInt(apiId)) || PERFIL_PADRAO;
    return { connectionRetries: 5, ...perfil, useWSS: true };
}

function proxyMtproto(ajustes) {
    if (!camposPreenchidos(ajustes, CAMPOS_DO_PROXY_MTPROTO)) return null;
    return { ip: ajustes.proxyIp, port: parseInt(ajustes.proxyPort), MTProxy: true, secret: ajustes.proxySecret };
}

function proxySocks(ajustes) {
    if (!camposPreenchidos(ajustes, CAMPOS_DO_PROXY_SOCKS)) return null;
    const proxy = { ip: ajustes.proxyIp, port: parseInt(ajustes.proxyPort), socksType: ajustes.proxyType === 'socks4' ? 4 : 5 };
    if (ajustes.proxyUsername) proxy.username = ajustes.proxyUsername;
    if (ajustes.proxyPassword) proxy.password = ajustes.proxyPassword;
    return proxy;
}

function proxyDosAjustes(ajustes) {
    if (!ajustes.useProxy) return null;
    return ajustes.proxyType === 'mtproto' ? proxyMtproto(ajustes) : proxySocks(ajustes);
}

function aplicarProxy(opcoes, ajustes) {
    const proxy = proxyDosAjustes(ajustes);
    if (!proxy) return;
    opcoes.proxy = proxy;
    const tipo = proxy.MTProxy ? 'MTProto' : `SOCKS${proxy.socksType}`;
    console.info(`[Telegram] Connecting via ${tipo} proxy: ${ajustes.proxyIp}:${ajustes.proxyPort}`);
}

module.exports = { camposPreenchidos, sessaoRecusada, opcoesDoPerfil, aplicarProxy };
