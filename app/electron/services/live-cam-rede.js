'use strict';

const ADAPTADORES_VIRTUAIS = [
    'vethernet', 'virtual', 'vmnet', 'vmware', 'vbox', 'virtualbox',
    'hyper-v', 'wsl', 'radmin', 'hamachi', 'tap', 'tun', 'docker',
    'loopback', 'teredo', 'npcap', 'tailscale', 'zerotier', 'wireguard',
    'nordlynx', 'openvpn', 'anyconnect', 'forticlient', 'cisco', 'p2p', 'bridge', 'pseudo'
];

const ADAPTADORES_FISICOS = [
    'wi-fi', 'wifi', 'wireless', 'wlan', 'ethernet', 'eth', 'en0', 'en1', 'lan', 'local area connection'
];

const PONTOS_DE_PARTIDA = 50;
const PONTOS_DO_TIPO_DE_ADAPTADOR = 100;

const contemAlguma = (nome, palavras) => palavras.some(palavra => nome.includes(palavra));

function tipoDoAdaptador(nome) {
    const minusculo = nome.toLowerCase();
    return {
        isVirtual: contemAlguma(minusculo, ADAPTADORES_VIRTUAIS),
        isPhysical: contemAlguma(minusculo, ADAPTADORES_FISICOS)
    };
}

const ehIpv4Externo = iface => iface.family === 'IPv4' && !iface.internal;

const ehLoopbackOuLinkLocal = endereco => endereco.startsWith('127.') || endereco.startsWith('169.254.');

function ehFaixaPrivada172(endereco) {
    const segundoOcteto = parseInt(endereco.split('.')[1], 10);
    return segundoOcteto >= 16 && segundoOcteto <= 31;
}

function pontosDaFaixa172(endereco, isVirtual) {
    if (!ehFaixaPrivada172(endereco)) {
        return 0;
    }
    return isVirtual ? -80 : 10;
}

const PONTOS_POR_FAIXA = [
    { prefixo: '192.168.', pontos: endereco => (endereco.startsWith('192.168.56.') ? -60 : 60) },
    { prefixo: '10.', pontos: (endereco, isVirtual) => (isVirtual || endereco.startsWith('10.5.') ? -80 : 20) },
    { prefixo: '172.', pontos: pontosDaFaixa172 }
];

function pontosDaFaixa(endereco, isVirtual) {
    const faixa = PONTOS_POR_FAIXA.find(({ prefixo }) => endereco.startsWith(prefixo));
    return faixa ? faixa.pontos(endereco, isVirtual) : 0;
}

function pontuacaoDoEndereco(endereco, adaptador) {
    let pontos = PONTOS_DE_PARTIDA + pontosDaFaixa(endereco, adaptador.isVirtual);
    if (adaptador.isVirtual) {
        pontos -= PONTOS_DO_TIPO_DE_ADAPTADOR;
    }
    if (adaptador.isPhysical) {
        pontos += PONTOS_DO_TIPO_DE_ADAPTADOR;
    }
    return pontos;
}

function candidatosDoAdaptador(nome, enderecos) {
    const adaptador = tipoDoAdaptador(nome);
    return enderecos
        .filter(ehIpv4Externo)
        .map(iface => iface.address)
        .filter(endereco => !ehLoopbackOuLinkLocal(endereco))
        .map(endereco => ({
            ip: endereco,
            name: nome,
            score: pontuacaoDoEndereco(endereco, adaptador),
            isVirtual: adaptador.isVirtual
        }));
}

function enderecosPorPreferencia(interfaces) {
    const candidatos = Object.keys(interfaces).flatMap(nome => candidatosDoAdaptador(nome, interfaces[nome]));
    return candidatos.sort((a, b) => b.score - a.score);
}

module.exports = { enderecosPorPreferencia };
