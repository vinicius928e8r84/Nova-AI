const fs = require('fs');
const path = require('path');

const doAmbiente = (nome) => process.env[nome] || '';
const dosRecursos = () => process.resourcesPath || '';

function candidatosDoAdb(baseDir) {
  return [
    path.join(__dirname, '..', '..', 'resources', 'bin', 'adb.exe'),
    path.join(__dirname, '..', '..', 'resources', 'platform-tools', 'adb.exe'),
    path.join(process.cwd(), 'resources', 'bin', 'adb.exe'),
    path.join(process.cwd(), 'resources', 'platform-tools', 'adb.exe'),
    path.join(dosRecursos(), 'bin', 'adb.exe'),
    path.join(dosRecursos(), 'platform-tools', 'adb.exe'),
    path.join(baseDir, 'platform-tools', 'adb.exe'),
    path.join(baseDir, 'adb.exe'),
    path.join(__dirname, '..', 'resources', 'bin', 'adb.exe'),
    path.join(__dirname, '..', 'resources', 'platform-tools', 'adb.exe'),
    path.join(doAmbiente('LOCALAPPDATA'), 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
    path.join(doAmbiente('USERPROFILE'), 'AppData', 'Local', 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
    path.join(doAmbiente('PROGRAMFILES'), 'Android', 'platform-tools', 'adb.exe'),
    path.join(doAmbiente('PROGRAMFILES(X86)'), 'Android', 'platform-tools', 'adb.exe'),
    path.join(doAmbiente('USERPROFILE'), 'platform-tools', 'adb.exe'),
    'C:\\platform-tools\\adb.exe',
    'C:\\Android\\platform-tools\\adb.exe',
    'C:\\Android\\Sdk\\platform-tools\\adb.exe',
    path.join(doAmbiente('PROGRAMFILES'), 'BlueStacks_nxt', 'HD-Adb.exe'),
    path.join(doAmbiente('PROGRAMFILES'), 'Nox', 'bin', 'nox_adb.exe'),
    path.join(doAmbiente('PROGRAMFILES'), 'LDPlayer', 'LDPlayer9', 'adb.exe'),
  ];
}

function candidatosDoScrcpy(baseDir) {
  return [
    path.join(__dirname, '..', '..', 'resources', 'bin', 'scrcpy.exe'),
    path.join(__dirname, '..', '..', 'resources', 'scrcpy', 'scrcpy.exe'),
    path.join(process.cwd(), 'resources', 'bin', 'scrcpy.exe'),
    path.join(process.cwd(), 'resources', 'scrcpy', 'scrcpy.exe'),
    path.join(dosRecursos(), 'bin', 'scrcpy.exe'),
    path.join(dosRecursos(), 'scrcpy', 'scrcpy.exe'),
    path.join(baseDir, 'scrcpy', 'scrcpy.exe'),
    path.join(baseDir, 'scrcpy.exe'),
    path.join(__dirname, '..', 'resources', 'bin', 'scrcpy.exe'),
    path.join(__dirname, '..', 'resources', 'scrcpy', 'scrcpy.exe'),
    path.join(doAmbiente('PROGRAMFILES'), 'scrcpy', 'scrcpy.exe'),
    path.join(doAmbiente('LOCALAPPDATA'), 'Programs', 'scrcpy', 'scrcpy.exe'),
    path.join(doAmbiente('USERPROFILE'), 'scrcpy', 'scrcpy.exe'),
    'C:\\scrcpy\\scrcpy.exe',
  ];
}

function ferramentaDoMac(nome, baseDir) {
  const nativa = require('./mac-native').tool(nome);
  if (nativa) return nativa;
  const baixada = require('./android-tools').localToolPath(baseDir, nome);
  if (baixada) return baixada;
  return path.join(dosRecursos(), 'bin', nome);
}

function resolverFerramenta({ nome, baseDir, lembrado, candidatos, padrao }) {
  if (process.platform === 'darwin') return { caminho: ferramentaDoMac(nome, baseDir), lembrar: false };
  if (lembrado && fs.existsSync(lembrado)) return { caminho: lembrado, lembrar: false };
  const achado = candidatos.find((candidato) => fs.existsSync(candidato));
  if (achado) return { caminho: achado, lembrar: true };
  return { caminho: padrao, lembrar: false };
}

function caminhoDoAdb(baseDir, lembrado) {
  const padrao = path.join(baseDir, 'platform-tools', 'adb.exe');
  return resolverFerramenta({ nome: 'adb', baseDir, lembrado, candidatos: candidatosDoAdb(baseDir), padrao });
}

function caminhoDoScrcpy(baseDir, lembrado) {
  const padrao = path.join(baseDir, 'scrcpy', 'scrcpy.exe');
  return resolverFerramenta({ nome: 'scrcpy', baseDir, lembrado, candidatos: candidatosDoScrcpy(baseDir), padrao });
}

module.exports = { caminhoDoAdb, caminhoDoScrcpy };
