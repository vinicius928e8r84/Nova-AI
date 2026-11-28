const { execFile } = require('child_process');
const iphoneSsh = require('./iphone-ssh');

const PORTA_DO_SSH_DO_IPHONE = '2222';
const DESTINO_DO_SSH_DO_IPHONE = 'mobile@127.0.0.1';
const OPCOES_SEM_PERGUNTAS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-o', 'StrictHostKeyChecking=accept-new'];
const LIMITE_DO_SSH_EM_MS = 12000;
const LIMITE_DO_IDEVICEINSTALLER_EM_MS = 25000;
const LIMITE_DO_SCP_EM_MS = 30000;
const LETRAS_DO_ERRO_DO_SCP = 200;
const COMANDO_DO_FUSO_DO_APARELHO = 'readlink /var/db/timezone/localtime';
const FUSO_NO_LINK = /zoneinfo\/(.+)$/;

const ehIphone = (idDoAparelho) => String(idDoAparelho || '').startsWith('ios-');

const respostaDoComando = (erro, stdout, stderr) => ({
  ok: !erro, stdout: String(stdout || ''), error: erro ? (String(stderr) || erro.message) : null,
});

function argumentosDeConexao(opcaoDaPorta) {
  return [opcaoDaPorta, PORTA_DO_SSH_DO_IPHONE, ...iphoneSsh.sshOptions(), ...OPCOES_SEM_PERGUNTAS];
}

function executarNoIphoneComLimite(comando, limiteEmMs, montarResposta) {
  return new Promise((resolve) => {
    const argumentos = [...argumentosDeConexao('-p'), DESTINO_DO_SSH_DO_IPHONE, comando];
    require('./tool-paths').execSsh(argumentos, { timeout: limiteEmMs }, (erro, stdout, stderr) => {
      resolve(montarResposta(erro, stdout, stderr));
    });
  });
}

const executarNoIphone = (comando) => executarNoIphoneComLimite(comando, LIMITE_DO_SSH_EM_MS, respostaDoComando);

async function lerFusoDoIphone(servico) {
  const resposta = await servico.iosSsh(COMANDO_DO_FUSO_DO_APARELHO);
  const achado = resposta.ok ? String(resposta.stdout || '').trim().match(FUSO_NO_LINK) : null;
  return achado ? achado[1].trim() : null;
}

function argumentosDoScp(remoto, local, sentido) {
  const base = argumentosDeConexao('-P');
  const noAparelho = `${DESTINO_DO_SSH_DO_IPHONE}:${remoto}`;
  return sentido === 'from' ? [...base, noAparelho, local] : [...base, local, noAparelho];
}

function copiarComScp(argumentos) {
  return new Promise((resolve, reject) => {
    execFile(require('./tool-paths').scp(), argumentos, { timeout: LIMITE_DO_SCP_EM_MS, windowsHide: true }, (erro, stdout, stderr) => {
      if (erro) return reject(new Error(String(stderr || erro.message).slice(0, LETRAS_DO_ERRO_DO_SCP)));
      resolve(true);
    });
  });
}

function executarIdeviceinstaller(argumentos) {
  return new Promise((resolve) => {
    const ferramenta = require('./ios-tools').tool('ideviceinstaller');
    execFile(ferramenta, argumentos, { timeout: LIMITE_DO_IDEVICEINSTALLER_EM_MS, windowsHide: true }, (erro, stdout, stderr) => {
      resolve(respostaDoComando(erro, stdout, stderr));
    });
  });
}

module.exports = {
  ehIphone, executarNoIphone, executarNoIphoneComLimite, lerFusoDoIphone, argumentosDoScp, copiarComScp, executarIdeviceinstaller,
};
