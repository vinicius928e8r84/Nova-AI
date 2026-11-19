'use strict';
// A chave SSH do iPhone pertence ao app, não ao ~/.ssh do Mac.
//
// Antes: todos os serviços usavam `~/.ssh/id_iphone`, compartilhado com o
// usuário do macOS (qualquer processo/agente com acesso ao home podia usar).
// Agora: fica em <userData>/iphone-ssh/ com 0600 e cada chamada ssh/scp usa
// `-i` explícito + IdentitiesOnly, sem cair em outras chaves do agente.
//
// `migrateLegacy()` move a chave existente de ~/.ssh na primeira execução
// (chamada uma vez, no boot, por physicalMobileService). `paths()` é puro:
// só calcula caminhos, não cria nada.
const fs = require('fs');
const os = require('os');
const path = require('path');

function appDataDir() {
  if (process.env.NOVA_USER_DATA) return process.env.NOVA_USER_DATA;
  try {
    const electron = require('electron');
    if (electron && electron.app && typeof electron.app.getPath === 'function') return electron.app.getPath('userData');
  } catch (_) { /* fora do Electron (testes) */ }
  return path.join(os.homedir(), 'Library', 'Application Support', 'nova_dsktp');
}

function paths() {
  const dir = path.join(appDataDir(), 'iphone-ssh');
  return {
    dir,
    key: path.join(dir, 'id_iphone'),
    publicKey: path.join(dir, 'id_iphone.pub'),
    knownHosts: path.join(dir, 'known_hosts')
  };
}

// Opções para ssh/scp: chave do app, sem outras identidades, known_hosts do app.
function sshOptions(target) {
  const p = target || paths();
  // `UserKnownHostsFile` e lido pelo parser de config do ssh, que separa por
  // ESPACO: sem as aspas, "…/Application Support/…" virava o caminho
  // "…/Library/Application" e o ssh lia outro arquivo (chave de host velha) —
  // o app entao recusava com "Senha aceita, mas a chave de acesso nao foi
  // validada. Verifique conflitos de chave SSH neste Mac."
  const toolPaths = require('./tool-paths');
  const key = toolPaths.posixPath(p.key);
  const known = toolPaths.posixPath(p.knownHosts);
  const knownHosts = /\s/.test(known) ? '"' + known + '"' : known;
  return ['-i', key, '-o', 'IdentitiesOnly=yes', '-o', 'UserKnownHostsFile=' + knownHosts, '-o', 'GlobalKnownHostsFile=' + toolPaths.nullDevice()];
}

function migrateLegacy() {
  const p = paths();
  if (process.env.NOVA_SMOKE_TEST === '1') return p;
  try { fs.mkdirSync(p.dir, { recursive: true, mode: 0o700 }); } catch (_) { return p; }
  const legacyKey = path.join(os.homedir(), '.ssh', 'id_iphone');
  try {
    if (!fs.existsSync(p.key) && fs.existsSync(legacyKey)) {
      fs.renameSync(legacyKey, p.key);
      if (fs.existsSync(legacyKey + '.pub')) fs.renameSync(legacyKey + '.pub', p.publicKey);
      try { fs.chmodSync(p.key, 0o600); } catch (_) {}
      console.log('[iPhone SSH] chave movida de ~/.ssh para', p.key);
    }
  } catch (e) {
    console.error('[iPhone SSH] não foi possível mover a chave de ~/.ssh:', e.message);
  }
  // known_hosts do app: herda a linha [127.0.0.1]:2222 do known_hosts antigo.
  try {
    if (!fs.existsSync(p.knownHosts)) {
      const legacyKnown = path.join(os.homedir(), '.ssh', 'known_hosts');
      if (fs.existsSync(legacyKnown)) {
        const lines = fs.readFileSync(legacyKnown, 'utf8').split('\n').filter(line => line.startsWith('[127.0.0.1]:2222 '));
        if (lines.length) fs.writeFileSync(p.knownHosts, lines.join('\n') + '\n', { mode: 0o600 });
      }
    }
  } catch (_) { /* sem known_hosts antigo: o próximo Conectar grava o pin */ }
  return p;
}

module.exports = { appDataDir, paths, sshOptions, migrateLegacy };
