'use strict';

const { execFile } = require('child_process');

const OPCOES_DA_CONSULTA = { timeout: 6000, windowsHide: true };

function consultar(ferramenta, argumentos, aoTerminar) {
    execFile(require('./ios-tools').tool(ferramenta), argumentos, { ...OPCOES_DA_CONSULTA }, aoTerminar);
}

function listarUdids() {
    return new Promise((resolve) => {
        consultar('idevice_id', ['-l'], (err, stdout) => {
            if (err || !stdout) return resolve([]);
            resolve(String(stdout).split('\n').map(s => s.trim()).filter(Boolean));
        });
    });
}

function lerInformacao(udid, chave) {
    return new Promise((resolve) => {
        consultar('ideviceinfo', ['-u', udid, '-k', chave], (err, stdout) => {
            resolve(err || !stdout ? '' : String(stdout).trim());
        });
    });
}

async function descreverAparelho(udid) {
    const nome = await lerInformacao(udid, 'DeviceName') || 'iPhone';
    const versao = await lerInformacao(udid, 'ProductVersion');
    return { id: 'ios-' + udid, status: 'device', name: nome + (versao ? ' (iOS ' + versao + ')' : ''), type: 'usb', ios: true };
}

function descreverNaOrdemDeChegada(udids) {
    return new Promise((resolve) => {
        const aparelhos = [];
        for (const udid of udids) {
            descreverAparelho(udid).then((aparelho) => {
                aparelhos.push(aparelho);
                if (aparelhos.length === udids.length) resolve(aparelhos);
            });
        }
    });
}

async function listar() {
    const udids = await listarUdids();
    return udids.length ? descreverNaOrdemDeChegada(udids) : [];
}

module.exports = { listar };
