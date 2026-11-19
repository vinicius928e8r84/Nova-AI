const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

function executar(comando, argumentos) {
  return new Promise((resolve, reject) => {
    execFile(comando, argumentos, { timeout: 120000 }, (erro, stdout, stderr) => {
      if (erro) return reject(new Error((stderr || erro.message).trim()));
      resolve(stdout || '');
    });
  });
}

function aspasShell(texto) {
  return `'${String(texto).replace(/'/g, "'\\''")}'`;
}

function aspasAppleScript(texto) {
  return String(texto).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function instalarPkg(arquivo, run) {
  try {
    await run('/usr/sbin/installer', ['-pkg', arquivo, '-target', 'CurrentUserHomeDirectory']);
    return 'pkg instalado para o usuário';
  } catch (_) {
    const comando = `/usr/sbin/installer -pkg ${aspasShell(arquivo)} -target /`;
    await run('/usr/bin/osascript', ['-e', `do shell script "${aspasAppleScript(comando)}" with administrator privileges`]);
    return 'pkg instalado com senha de administrador';
  }
}

function pontoDeMontagem(saida) {
  const linha = saida.split('\n').reverse().find(l => l.includes('/Volumes/'));
  return linha ? linha.slice(linha.indexOf('/Volumes/')).trim() : null;
}

async function instalarDmg(arquivo, run, { casa, listar }) {
  const montagem = pontoDeMontagem(await run('/usr/bin/hdiutil', ['attach', '-nobrowse', '-readonly', arquivo]));
  if (!montagem) throw new Error('dmg sem ponto de montagem');
  try {
    const app = listar(montagem).find(nome => nome.endsWith('.app'));
    if (!app) throw new Error('dmg sem .app');
    const destino = path.join(casa, 'Applications');
    fs.mkdirSync(destino, { recursive: true });
    await run('/usr/bin/ditto', [path.join(montagem, app), path.join(destino, app)]);
    return `${app} copiado para ~/Applications`;
  } finally {
    await run('/usr/bin/hdiutil', ['detach', montagem]).catch(() => {});
  }
}

async function instalarNoMac(arquivo, { run = executar, casa = os.homedir(), listar = fs.readdirSync } = {}) {
  const extensao = path.extname(arquivo).toLowerCase();
  if (extensao === '.pkg') return instalarPkg(arquivo, run);
  if (extensao === '.dmg') return instalarDmg(arquivo, run, { casa, listar });
  await run('/usr/bin/open', [arquivo]);
  return 'arquivo aberto';
}

module.exports = { instalarNoMac };
