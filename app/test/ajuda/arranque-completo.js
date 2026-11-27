'use strict';
const { carregarMain } = require('./carregar-main');

function servidorHttpFalso() {
  return {
    createServer: () => ({ listen: (porta, endereco, quandoOuvir) => { if (quandoOuvir) quandoOuvir(); }, on: () => {}, close: () => {} }),
  };
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
    const main = carregarMain({ ...opcoes, arranqueCompleto: true, modulos: { http: servidorHttpFalso(), ...opcoes.modulos } });
    return { main, temporizadores };
  } finally {
    global.setTimeout = originais.setTimeout;
    global.setInterval = originais.setInterval;
  }
}

module.exports = { carregarComArranqueCompleto };
