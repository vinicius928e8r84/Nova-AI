'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');
const Module = require('module');

function substituir(alvo, nome, criarDuble) {
    const original = alvo[nome];
    alvo[nome] = criarDuble(original);
    return () => { alvo[nome] = original; };
}

function carregadorComDubles(dubles) {
    return (carregarOriginal) => function (...pedido) {
        if (Object.hasOwn(dubles, pedido[0])) return dubles[pedido[0]];
        return carregarOriginal.apply(this, pedido);
    };
}

function execQueSempreConclui(...argumentos) {
    const concluir = argumentos.findLast(a => typeof a === 'function');
    if (concluir) concluir(null, '', '');
    return { on() {} };
}

function setTimeoutSemEspera(setTimeoutOriginal) {
    return (funcao, ...atrasoEArgumentos) => setTimeoutOriginal(funcao, 0, ...atrasoEArgumentos.slice(1));
}

function adbSempreEncontrado(existsOriginal) {
    return (caminho) => /adb(\.exe)?$/.test(String(caminho)) || existsOriginal(caminho);
}

function axiosQueRegistra(chamadas) {
    return { get: async (url) => { chamadas.push(url); return { data: [] }; } };
}

test('automateBrowser consulta o CDP em localhost:9222 por axios', async () => {
    process.env.NOVA_SMOKE_TEST = '1';
    const chamadas = [];
    const restauracoes = [
        substituir(Module, '_load', carregadorComDubles({ axios: axiosQueRegistra(chamadas), ws: function WebSocket() {} })),
        substituir(childProcess, 'exec', () => execQueSempreConclui),
        substituir(global, 'setTimeout', setTimeoutSemEspera)
    ];
    const servicePath = require.resolve('../electron/services/physicalMobileService');
    delete require.cache[servicePath];
    try {
        const Servico = require(servicePath);
        const base = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-axios-'));
        const servico = new Servico(null, { getPath: () => base });
        restauracoes.push(substituir(fs, 'existsSync', adbSempreEncontrado));
        await servico.automateBrowser('emulator-5554', 'https://example.com', 'x');
        assert.deepStrictEqual(chamadas, ['http://localhost:9222/json']);
    } finally {
        delete require.cache[servicePath];
        restauracoes.reverse().forEach(restaurar => restaurar());
    }
});
