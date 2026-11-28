const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { aspas, executar, comando } = require('./setup-ssh');

const ARQUIVO_DAS_IMPRESSOES = 'iphone-hosts.json';
const SERVIDOR_NO_ARQUIVO_DE_CONHECIDOS = '[127.0.0.1]:2222 ';
const CHAVE_PUBLICA_ACEITA = /^ssh-(ed25519|rsa) [A-Za-z0-9+/=]+(?: .*)?$/;
const COMANDO_DA_CHAVE_DO_SERVIDOR = 'cat /var/jb/etc/ssh/ssh_host_ed25519_key.pub 2>/dev/null || cat /etc/ssh/ssh_host_ed25519_key.pub';

function lerImpressoesConhecidas(servico) {
  const arquivo = path.join(servico.baseDir, ARQUIVO_DAS_IMPRESSOES);
  const impressoes = fs.existsSync(arquivo) ? JSON.parse(fs.readFileSync(arquivo, 'utf8')) : {};
  return { arquivo, impressoes };
}

function gravarImpressao(conhecidas, udid, impressao) {
  conhecidas.impressoes[udid] = impressao;
  fs.writeFileSync(conhecidas.arquivo, JSON.stringify(conhecidas.impressoes, null, 2), { mode: 0o600 });
}

function caminhosDoSsh() {
  try {
    return require('../iphone-ssh').paths();
  } catch (erro) {
    const pasta = path.join(os.homedir(), '.ssh');
    return { dir: pasta, key: path.join(pasta, 'id_iphone'), knownHosts: path.join(pasta, 'known_hosts') };
  }
}

async function prepararChaveLocal() {
  const caminhos = caminhosDoSsh();
  fs.mkdirSync(caminhos.dir, { recursive: true, mode: 0o700 });
  const chave = caminhos.key;
  if (!fs.existsSync(chave)) await executar(require('../tool-paths').sshKeygen(), ['-t', 'ed25519', '-N', '', '-f', chave, '-C', 'Nova AI USB']);
  if (!fs.existsSync(chave + '.pub')) throw new Error('A chave SSH existente não possui arquivo público. Nenhuma chave foi substituída.');
  const publica = fs.readFileSync(chave + '.pub', 'utf8').trim();
  if (!CHAVE_PUBLICA_ACEITA.test(publica)) throw new Error('Formato de chave pública não suportado.');
  return { arquivoDeConhecidos: caminhos.knownHosts, publica };
}

function autorizarChaveNoAparelho(cliente, publica) {
  return comando(cliente, 'umask 077; mkdir -p ~/.ssh; touch ~/.ssh/authorized_keys; grep -qxF ' + aspas(publica) + ' ~/.ssh/authorized_keys || printf "%s\\n" ' + aspas(publica) + ' >> ~/.ssh/authorized_keys');
}

async function conferirChaveDoServidor(cliente, impressao) {
  const campos = (await comando(cliente, COMANDO_DA_CHAVE_DO_SERVIDOR)).trim().split(/\s+/);
  if (campos[0] !== 'ssh-ed25519' || !campos[1]) throw new Error('Não foi possível verificar a chave pública SSH do aparelho.');
  const calculada = crypto.createHash('sha256').update(Buffer.from(campos[1], 'base64')).digest('hex');
  if (calculada !== impressao) throw new Error('A chave pública não corresponde ao servidor USB autenticado.');
  return campos;
}

function registrarServidorConhecido(arquivo, campos) {
  const linha = SERVIDOR_NO_ARQUIVO_DE_CONHECIDOS + campos.slice(0, 2).join(' ');
  const anterior = fs.existsSync(arquivo) ? fs.readFileSync(arquivo, 'utf8') : '';
  const quebra = anterior && !anterior.endsWith('\n') ? '\n' : '';
  if (!anterior.includes(linha)) fs.appendFileSync(arquivo, quebra + linha + '\n', { mode: 0o600 });
}

async function confiarNoAparelho(cliente, impressao, chaveLocal) {
  await autorizarChaveNoAparelho(cliente, chaveLocal.publica);
  const campos = await conferirChaveDoServidor(cliente, impressao);
  registrarServidorConhecido(chaveLocal.arquivoDeConhecidos, campos);
}

module.exports = { lerImpressoesConhecidas, gravarImpressao, prepararChaveLocal, confiarNoAparelho };
