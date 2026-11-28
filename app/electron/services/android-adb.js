const fs = require('fs');
const { exec } = require('child_process');

const ehWifi = (id) => id.includes(':') || /^\d+\.\d+\.\d+\.\d+/.test(id);

function nomeDoAparelho(linha, id) {
  const modelo = linha.match(/model:(\S+)/);
  if (modelo) return modelo[1].replace(/_/g, ' ');
  const dispositivo = linha.match(/device:(\S+)/);
  return dispositivo ? dispositivo[1] : id;
}

function lerAparelho(linha) {
  const [id, status] = linha.split(/\s+/);
  return { id, status, name: nomeDoAparelho(linha, id), type: ehWifi(id) ? 'wifi' : 'usb' };
}

const ehLinhaDeAparelho = (linha) => Boolean(linha) && !linha.startsWith('*');
const temIdEStatus = (linha) => linha.split(/\s+/).length >= 2;

function lerAparelhosDoAdb(saida) {
  return saida.split('\n').slice(1).map((linha) => linha.trim())
    .filter(ehLinhaDeAparelho)
    .filter(temIdEStatus)
    .map(lerAparelho);
}

function listarAparelhosAdb(adb) {
  if (!fs.existsSync(adb)) return Promise.resolve([]);
  return new Promise((resolve) => {
    exec(`"${adb}" devices -l`, (erro, saida) => resolve(erro || !saida ? [] : lerAparelhosDoAdb(saida)));
  });
}

module.exports = { listarAparelhosAdb };
