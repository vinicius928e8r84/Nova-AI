'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');

const caminhoDoModulo = path.join(__dirname, '..', 'iphone-ssh.js');
const carregadorOriginal = Module._load;
const consoleOriginal = { log: console.log, error: console.error };

let electron;
let diario;

Module._load = function (pedido, ...resto) {
  if (pedido !== 'electron') return carregadorOriginal.call(this, pedido, ...resto);
  if (electron instanceof Error) throw electron;
  return electron;
};
test.after(() => { Module._load = carregadorOriginal; });

function comAmbiente({ home, userData, smoke, electronFalso = new Error('fora do Electron') }, acao) {
  const antes = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, NOVA_USER_DATA: process.env.NOVA_USER_DATA, NOVA_SMOKE_TEST: process.env.NOVA_SMOKE_TEST };
  const definir = (nome, valor) => { if (valor === undefined) delete process.env[nome]; else process.env[nome] = valor; };
  definir('HOME', home);
  definir('USERPROFILE', home);
  definir('NOVA_USER_DATA', userData);
  definir('NOVA_SMOKE_TEST', smoke);
  electron = electronFalso;
  diario = [];
  Object.assign(console, { log: (...p) => diario.push(`log ${p.join(' ')}`), error: (...p) => diario.push(`error ${p.join(' ')}`) });
  delete require.cache[caminhoDoModulo];
  try { return acao(require(caminhoDoModulo)); } finally {
    Object.assign(console, consoleOriginal);
    for (const [nome, valor] of Object.entries(antes)) definir(nome, valor);
  }
}

const permissao = (octal) => (process.platform === 'win32' ? 'sem-modo' : octal);
const modoDe = (estado) => permissao((estado.mode & 0o777).toString(8));
const nulo = process.platform === 'win32' ? 'NUL' : '/dev/null';
const casaDoTeste = path.resolve('/h');
const padrao = path.join(casaDoTeste, 'Library', 'Application Support', 'nova_dsktp');

function arvore(raiz) {
  const itens = {};
  const visitar = (pasta) => {
    for (const nome of fs.readdirSync(pasta).sort()) {
      const completo = path.join(pasta, nome);
      const relativo = path.relative(raiz, completo).split(path.sep).join('/');
      const estado = fs.statSync(completo);
      if (estado.isDirectory()) { itens[`${relativo}/`] = modoDe(estado); visitar(completo); continue; }
      itens[relativo] = `${modoDe(estado)} ${fs.readFileSync(completo, 'utf8')}`;
    }
  };
  visitar(raiz);
  return itens;
}

function palco(arquivos = {}) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'iphone-ssh-'));
  for (const [relativo, texto] of Object.entries(arquivos)) {
    const completo = path.join(raiz, relativo);
    fs.mkdirSync(path.dirname(completo), { recursive: true });
    fs.writeFileSync(completo, texto);
    fs.chmodSync(completo, 0o644);
    for (let pasta = path.dirname(completo); pasta !== raiz; pasta = path.dirname(pasta)) fs.chmodSync(pasta, 0o755);
  }
  return { raiz, home: path.join(raiz, 'home'), userData: path.join(raiz, 'ud'), limpar: () => fs.rmSync(raiz, { recursive: true, force: true }) };
}

const KNOWN_HOSTS_ANTIGO = '[127.0.0.1]:2222 ssh-ed25519 AAAA1\ngithub.com ssh-rsa BBBB\n[127.0.0.1]:2222 ecdsa CCCC\n[127.0.0.1]:22222 x DDDD\n';

test('appDataDir: NOVA_USER_DATA, depois o userData do Electron, depois o padrão do Mac', () => {
  const casos = [
    [{ userData: '/u/d', electronFalso: { app: { getPath: () => '/nunca' } } }, '/u/d'],
    [{ electronFalso: { app: { getPath: (nome) => `/electron/${nome}` } } }, '/electron/userData'],
    [{ electronFalso: { app: { getPath: '/não é função' } } }, padrao],
    [{ electronFalso: { app: null } }, padrao],
    [{ electronFalso: null }, padrao],
    [{}, padrao],
    [{ electronFalso: { app: { getPath: () => '' } } }, ''],
    [{ electronFalso: { app: { getPath: () => { throw new Error('cedo demais'); } } } }, padrao],
  ];
  for (const [ambiente, esperado] of casos) {
    assert.strictEqual(comAmbiente({ home: casaDoTeste, ...ambiente }, (ssh) => ssh.appDataDir()), esperado, JSON.stringify(ambiente));
  }
});

test('paths e sshOptions sem alvo usam a pasta do app', () => {
  const r = comAmbiente({ home: casaDoTeste, userData: '/sem espaco/../ud' }, (ssh) => [ssh.paths(), ssh.sshOptions()]);
  const dir = path.join('/ud', 'iphone-ssh');
  assert.deepStrictEqual(r[0], { dir, key: path.join(dir, 'id_iphone'), publicKey: path.join(dir, 'id_iphone.pub'), knownHosts: path.join(dir, 'known_hosts') });
  assert.deepStrictEqual(r[1], ['-i', '/ud/iphone-ssh/id_iphone', '-o', 'IdentitiesOnly=yes', '-o', 'UserKnownHostsFile=/ud/iphone-ssh/known_hosts', '-o', `GlobalKnownHostsFile=${nulo}`]);
});

test('migrateLegacy: move chave e .pub, herda só as linhas do túnel USB', () => {
  const p = palco({ 'home/.ssh/id_iphone': 'privada', 'home/.ssh/id_iphone.pub': 'publica', 'home/.ssh/known_hosts': KNOWN_HOSTS_ANTIGO });
  const r = comAmbiente(p, (ssh) => ssh.migrateLegacy());
  assert.deepStrictEqual(r, { dir: path.join(p.userData, 'iphone-ssh'), key: path.join(p.userData, 'iphone-ssh', 'id_iphone'), publicKey: path.join(p.userData, 'iphone-ssh', 'id_iphone.pub'), knownHosts: path.join(p.userData, 'iphone-ssh', 'known_hosts') });
  assert.deepStrictEqual(arvore(p.raiz), {
    'home/': permissao('755'), 'home/.ssh/': permissao('755'), 'home/.ssh/known_hosts': `${permissao('644')} ${KNOWN_HOSTS_ANTIGO}`,
    'ud/': permissao('700'), 'ud/iphone-ssh/': permissao('700'), 'ud/iphone-ssh/id_iphone': `${permissao('600')} privada`, 'ud/iphone-ssh/id_iphone.pub': `${permissao('644')} publica`,
    'ud/iphone-ssh/known_hosts': `${permissao('600')} [127.0.0.1]:2222 ssh-ed25519 AAAA1\n[127.0.0.1]:2222 ecdsa CCCC\n`,
  });
  assert.deepStrictEqual(diario, [`log [iPhone SSH] chave movida de ~/.ssh para ${r.key}`]);
  p.limpar();
});

test('migrateLegacy: chave do app e known_hosts do app já existentes ficam como estão', () => {
  const p = palco({ 'home/.ssh/id_iphone': 'antiga', 'home/.ssh/known_hosts': KNOWN_HOSTS_ANTIGO, 'ud/iphone-ssh/id_iphone': 'nova', 'ud/iphone-ssh/known_hosts': 'pin' });
  comAmbiente(p, (ssh) => ssh.migrateLegacy());
  const t = arvore(p.raiz);
  assert.deepStrictEqual([t['home/.ssh/id_iphone'], t['ud/iphone-ssh/id_iphone'], t['ud/iphone-ssh/known_hosts']], [`${permissao('644')} antiga`, `${permissao('644')} nova`, `${permissao('644')} pin`]);
  assert.deepStrictEqual(diario, []);
  p.limpar();
});

test('migrateLegacy: chave sem .pub, known_hosts antigo sem túnel e sem nada antigo', () => {
  const p = palco({ 'home/.ssh/id_iphone': 'so-privada', 'home/.ssh/known_hosts': 'github.com ssh-rsa B\n' });
  comAmbiente(p, (ssh) => ssh.migrateLegacy());
  assert.deepStrictEqual(Object.keys(arvore(path.join(p.userData))).sort(), ['iphone-ssh/', 'iphone-ssh/id_iphone']);
  const vazio = palco();
  comAmbiente(vazio, (ssh) => ssh.migrateLegacy());
  assert.deepStrictEqual(arvore(vazio.raiz), { 'ud/': permissao('700'), 'ud/iphone-ssh/': permissao('700') });
  assert.deepStrictEqual(diario, []);
  p.limpar();
  vazio.limpar();
});

test('migrateLegacy: smoke test e pasta que não dá para criar não mexem em nada', () => {
  const p = palco({ 'home/.ssh/id_iphone': 'privada', 'ud': 'arquivo no lugar da pasta' });
  const antes = arvore(p.raiz);
  const smoke = comAmbiente({ ...p, smoke: '1' }, (ssh) => ssh.migrateLegacy());
  assert.strictEqual(smoke.key, path.join(p.userData, 'iphone-ssh', 'id_iphone'));
  const semPasta = comAmbiente(p, (ssh) => ssh.migrateLegacy());
  assert.strictEqual(semPasta.dir, path.join(p.userData, 'iphone-ssh'));
  assert.deepStrictEqual(arvore(p.raiz), antes);
  assert.deepStrictEqual(diario, []);
  p.limpar();
});

test('migrateLegacy: falha ao mover avisa e ainda herda o known_hosts', () => {
  const p = palco({ 'home/.ssh/id_iphone': 'privada', 'home/.ssh/known_hosts': KNOWN_HOSTS_ANTIGO });
  const renomearOriginal = fs.renameSync;
  const lerOriginal = fs.readFileSync;
  fs.renameSync = () => { throw new Error('EXDEV: outro disco'); };
  try { comAmbiente(p, (ssh) => ssh.migrateLegacy()); } finally { fs.renameSync = renomearOriginal; }
  assert.deepStrictEqual(diario, ['error [iPhone SSH] não foi possível mover a chave de ~/.ssh: EXDEV: outro disco']);
  assert.ok(fs.existsSync(path.join(p.userData, 'iphone-ssh', 'known_hosts')));
  fs.rmSync(path.join(p.userData, 'iphone-ssh', 'known_hosts'));
  fs.readFileSync = (arquivo, ...resto) => {
    if (String(arquivo).endsWith('known_hosts')) throw new Error('EACCES');
    return lerOriginal(arquivo, ...resto);
  };
  try { comAmbiente(p, (ssh) => ssh.migrateLegacy()); } finally { fs.readFileSync = lerOriginal; }
  assert.ok(!fs.existsSync(path.join(p.userData, 'iphone-ssh', 'known_hosts')));
  assert.ok(fs.existsSync(path.join(p.userData, 'iphone-ssh', 'id_iphone')));
  p.limpar();
});
