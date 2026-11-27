'use strict';
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const timersPromises = require('node:timers/promises');
const path = require('path');

const CAMINHO_DO_SHUTDOWN = path.join(__dirname, '..', 'nova-shutdown.js');
const DONO = '11111111-2222-3333-4444-555555555555';
const UID_DO_USUARIO = 501;
const INICIO = 'Fri Nov 27 10:00:00 2026';
const PASTA_DOS_HELPERS = '/Apps/Nova.app/Contents/Frameworks/';

function processo(pid, pai, comando, extras = {}) {
  return { pid, pai, comando, uid: UID_DO_USUARIO, estado: 'S', inicio: INICIO, dono: false, ...extras };
}

function linhaDoPs(item) {
  return `${item.pid} ${item.pai} ${item.uid} ${item.estado} ${item.inicio} ${item.comando}`;
}

function linhaDoEnv(item) {
  const marca = item.dono ? ` NOVA_PROCESS_OWNER=${DONO}` : ' OUTRA=1';
  return `${item.pid} ${item.comando}${marca}`;
}

function psFalso(ambiente) {
  return (comando, argumentos, opcoes) => {
    ambiente.registro.push(['ps', argumentos.slice(0, argumentos[0] === 'eww' ? 3 : 2).join(' '), `timeout=${opcoes.timeout} maxBuffer=${opcoes.maxBuffer} LC_ALL=${opcoes.env?.LC_ALL ?? '(sem)'}`]);
    if (argumentos[0] === 'eww') {
      if (ambiente.falhaDoEnv) throw Object.assign(new Error('ps falhou'), ambiente.falhaDoEnv);
      const pedidos = argumentos[2].split(',').map(Number);
      return ambiente.tabela.filter(item => pedidos.includes(item.pid)).map(linhaDoEnv).join('\n') + '\n';
    }
    return ambiente.tabela.map(linhaDoPs).join('\n') + '\n';
  };
}

function sinalFalso(ambiente) {
  return (pid, sinal) => {
    ambiente.registro.push(['kill', pid, sinal]);
    const item = ambiente.tabela.find(candidato => candidato.pid === pid);
    if (!item || item.fantasma) throw Object.assign(new Error('no such process'), { code: 'ESRCH' });
    if (item.recusa) throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
    if (!item.imortal && ambiente.sinaisQueMatam.includes(sinal)) ambiente.tabela.splice(ambiente.tabela.indexOf(item), 1);
  };
}

function paraRegistro(valor) {
  if (valor instanceof Error) return { erro: valor.constructor.name, mensagem: valor.message };
  if (Array.isArray(valor)) return valor.map(paraRegistro);
  return valor;
}

function substituir(alvo, chave, valor) {
  const existia = Object.prototype.hasOwnProperty.call(alvo, chave);
  const antes = alvo[chave];
  alvo[chave] = valor;
  return () => { if (existia) alvo[chave] = antes; else delete alvo[chave]; };
}

function carregarLimpeza() {
  delete require.cache[CAMINHO_DO_SHUTDOWN];
  return require(CAMINHO_DO_SHUTDOWN).createProcessCleanup(PASTA_DOS_HELPERS);
}

async function encenar(cena) {
  const ambiente = { registro: [], tabela: cena.tabela(process.pid).map(item => ({ ...item })), falhaDoEnv: null, agora: 1000000, sinaisQueMatam: ['SIGTERM', 'SIGKILL'] };
  const restaurar = [
    substituir(childProcess, 'execFileSync', psFalso(ambiente)),
    substituir(crypto, 'randomUUID', () => DONO),
    substituir(process, 'getuid', () => UID_DO_USUARIO),
    substituir(process, 'kill', sinalFalso(ambiente)),
    substituir(process.env, 'NOVA_PROCESS_OWNER', undefined),
    substituir(Date, 'now', () => ambiente.agora),
    substituir(timersPromises, 'setTimeout', async (ms) => { ambiente.agora += ms; }),
  ];
  const consoleAntes = console.error;
  console.error = (...partes) => ambiente.registro.push(['console.error', ...partes.map(paraRegistro)]);
  try {
    const limpeza = carregarLimpeza();
    await cena.roteiro({ limpeza, ambiente });
  } finally {
    console.error = consoleAntes;
    restaurar.reverse().forEach(volta => volta());
    delete require.cache[CAMINHO_DO_SHUTDOWN];
  }
  return ambiente.registro.map(evento => evento.map(parte => (parte === process.pid ? 'NOVA' : parte)));
}

module.exports = { encenar, processo, PASTA_DOS_HELPERS };
