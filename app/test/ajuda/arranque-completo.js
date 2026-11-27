'use strict';
const { carregarMain } = require('./carregar-main');

function servidorHttpFalso() {
  return {
    createServer: () => ({ listen: (porta, endereco, quandoOuvir) => { if (quandoOuvir) quandoOuvir(); }, on: () => {}, close: () => {} }),
  };
}

function processoFilhoInerte() {
  const fluxo = { on: () => {} };
  return { pid: 0, stdout: fluxo, stderr: fluxo, stdin: { write: () => {}, end: () => {} }, on: () => {}, once: () => {}, kill: () => {}, unref: () => {} };
}

function processosInertes() {
  const proibido = (nome) => () => { throw new Error(`main.js tentou ${nome} um processo de verdade no arranque completo`); };
  return { spawn: processoFilhoInerte, exec: proibido('exec'), execFile: proibido('execFile'), execSync: proibido('execSync'), spawnSync: proibido('spawnSync'), fork: proibido('fork') };
}

function carregarComArranqueCompleto(opcoes = {}) {
  const temporizadores = [];
  const originais = { setTimeout: global.setTimeout, setInterval: global.setInterval };
  const registrar = (tipo) => (funcao, espera) => {
    temporizadores.push({ tipo, espera, funcao });
    return { unref() {}, ref() {} };
  };
  global.setTimeout = registrar('timeout');
  global.setInterval = registrar('interval');
  try {
    const main = carregarMain({ ...opcoes, arranqueCompleto: true, modulos: { http: servidorHttpFalso(), child_process: processosInertes(), ...opcoes.modulos } });
    return { main, temporizadores };
  } finally {
    global.setTimeout = originais.setTimeout;
    global.setInterval = originais.setInterval;
  }
}

module.exports = { carregarComArranqueCompleto };
