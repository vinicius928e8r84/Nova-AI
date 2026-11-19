'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');
const Module = require('module');

test('automateBrowser consulta o CDP em localhost:9222 por axios', async () => {
    process.env.NOVA_SMOKE_TEST = '1';
    const chamadas = [];
    const axiosFalso = { get: async (url) => { chamadas.push(url); return { data: [] }; } };
    const carregarOriginal = Module._load;
    Module._load = function (pedido, ...resto) {
        if (pedido === 'axios') return axiosFalso;
        if (pedido === 'ws') return function WebSocket() {};
        return carregarOriginal.call(this, pedido, ...resto);
    };
    const execOriginal = childProcess.exec;
    childProcess.exec = (cmd, opcoes, cb) => { (typeof opcoes === 'function' ? opcoes : cb || (() => {}))(null, '', ''); return { on() {} }; };
    const existsOriginal = fs.existsSync;
    const setTimeoutOriginal = global.setTimeout;
    global.setTimeout = (fn, ms, ...a) => setTimeoutOriginal(fn, 0, ...a);
    const servicePath = require.resolve('../electron/services/physicalMobileService');
    delete require.cache[servicePath];
    try {
        const Servico = require(servicePath);
        const base = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-axios-'));
        const servico = new Servico(null, { getPath: () => base });
        fs.existsSync = (p) => String(p).endsWith('adb') || String(p).endsWith('adb.exe') || existsOriginal(p);
        await servico.automateBrowser('emulator-5554', 'https://example.com', 'x');
        assert.deepStrictEqual(chamadas, ['http://localhost:9222/json']);
    } finally {
        fs.existsSync = existsOriginal;
        global.setTimeout = setTimeoutOriginal;
        childProcess.exec = execOriginal;
        delete require.cache[servicePath];
        Module._load = carregarOriginal;
    }
});
