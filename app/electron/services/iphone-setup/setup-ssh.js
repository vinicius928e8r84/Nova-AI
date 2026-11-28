const { Client } = require('./node_modules/ssh2');
const net = require('net');
const { execFile, spawn } = require('child_process');

const ENDERECO_DO_TUNEL = '127.0.0.1';
const PORTA_DO_TUNEL = 2222;
const PORTA_DO_SSH_NO_APARELHO = '22';
const USUARIO_DO_APARELHO = 'mobile';
const LIMITE_DA_FERRAMENTA_EM_MS = 15000;
const LIMITE_DO_COMANDO_EM_MS = 90000;
const LIMITE_DA_CONEXAO_EM_MS = 15000;
const LIMITE_DA_PORTA_AO_PREPARAR_EM_MS = 1000;
const LIMITE_DA_PORTA_AO_GARANTIR_EM_MS = 800;
const ESPERA_ENTRE_CONSULTAS_AO_PREPARAR_EM_MS = 100;
const ESPERA_ENTRE_CONSULTAS_AO_GARANTIR_EM_MS = 700;
const CONSULTAS_AO_PREPARAR = 20;
const CONSULTAS_AO_GARANTIR = 12;

let ultimoIproxy;

const aspas = (texto) => "'" + String(texto).replace(/'/g, "'\\''") + "'";
const esperar = (milissegundos) => new Promise((resolve) => setTimeout(resolve, milissegundos));

const executar = (arquivo, argumentos) => new Promise((resolve, reject) => {
  execFile(arquivo, argumentos, { timeout: LIMITE_DA_FERRAMENTA_EM_MS, windowsHide: true }, (erro, saida) => (erro ? reject(erro) : resolve(String(saida).trim())));
});

function portaDoTunelAberta(limiteEmMs) {
  return new Promise((resolve) => {
    const soquete = net.connect({ host: ENDERECO_DO_TUNEL, port: PORTA_DO_TUNEL, timeout: limiteEmMs });
    const concluir = (aberta) => {
      try { soquete.destroy(); } catch (erro) {}
      resolve(aberta);
    };
    soquete.once('connect', () => concluir(true));
    soquete.once('error', () => concluir(false));
    soquete.once('timeout', () => concluir(false));
  });
}

async function abrirTunelDoAparelho(udid) {
  if (await portaDoTunelAberta(LIMITE_DA_PORTA_AO_PREPARAR_EM_MS)) return;
  ultimoIproxy = spawn(require('../ios-tools').tool('iproxy'), ['-u', udid, String(PORTA_DO_TUNEL), PORTA_DO_SSH_NO_APARELHO], { stdio: 'ignore', windowsHide: true });
  ultimoIproxy.on('error', () => {});
  for (let consulta = 0; consulta < CONSULTAS_AO_PREPARAR && !(await portaDoTunelAberta(LIMITE_DA_PORTA_AO_PREPARAR_EM_MS)); consulta++) {
    await esperar(ESPERA_ENTRE_CONSULTAS_AO_PREPARAR_EM_MS);
  }
}

function subirIproxyDestacado() {
  try {
    const processo = spawn(require('../ios-tools').tool('iproxy'), [String(PORTA_DO_TUNEL), PORTA_DO_SSH_NO_APARELHO], { stdio: 'ignore', detached: true, windowsHide: true });
    processo.unref();
  } catch (erro) {}
}

async function garantirTunelDoAparelho() {
  if (await portaDoTunelAberta(LIMITE_DA_PORTA_AO_GARANTIR_EM_MS)) return true;
  subirIproxyDestacado();
  for (let consulta = 0; consulta < CONSULTAS_AO_GARANTIR; consulta++) {
    await esperar(ESPERA_ENTRE_CONSULTAS_AO_GARANTIR_EM_MS);
    if (await portaDoTunelAberta(LIMITE_DA_PORTA_AO_GARANTIR_EM_MS)) return true;
  }
  return false;
}

const mensagemDaFalhaDoComando = (textoDeErro) => {
  if (textoDeErro.includes('password')) return 'Senha administrativa recusada pelo iPhone.';
  return textoDeErro.trim() || 'Comando não concluído no iPhone.';
};

function comando(cliente, texto, entrada) {
  return new Promise((resolve, reject) => cliente.exec(texto, (erro, fluxo) => {
    if (erro) return reject(erro);
    let saida = '';
    let textoDeErro = '';
    const prazo = setTimeout(() => {
      fluxo.close();
      reject(new Error('O iPhone demorou demais para responder.'));
    }, LIMITE_DO_COMANDO_EM_MS);
    fluxo.on('data', (dados) => { saida += dados; });
    fluxo.stderr.on('data', (dados) => { textoDeErro += dados; });
    fluxo.on('close', (codigo) => {
      clearTimeout(prazo);
      if (codigo === 0) resolve(saida);
      else reject(new Error(mensagemDaFalhaDoComando(textoDeErro)));
    });
    fluxo.end(entrada || '');
  }));
}

function conectarPorSsh(cliente, senha, impressoesConhecidas, udid) {
  let impressao;
  return new Promise((resolve, reject) => {
    let concluido = false;
    const concluir = (acao, argumento) => {
      if (concluido) return;
      concluido = true;
      acao(argumento);
    };
    cliente.on('error', () => concluir(reject, new Error('Não foi possível autenticar. Confira a senha SSH, o jailbreak ativo e o OpenSSH no Sileo.')));
    cliente.on('close', () => concluir(reject, new Error('A conexão SSH caiu antes de terminar. Reconecte o iPhone em PHONE CONTROL e tente de novo.')));
    cliente.on('ready', () => concluir(resolve));
    cliente.connect({
      host: ENDERECO_DO_TUNEL,
      port: PORTA_DO_TUNEL,
      username: USUARIO_DO_APARELHO,
      password: senha,
      readyTimeout: LIMITE_DA_CONEXAO_EM_MS,
      algorithms: { serverHostKey: ['ssh-ed25519'] },
      hostHash: 'sha256',
      hostVerifier: (hash) => {
        impressao = hash;
        return !impressoesConhecidas[udid] || impressoesConhecidas[udid] === hash;
      },
    });
  }).then(() => impressao);
}

const criarClienteSsh = () => new Client();

module.exports = { aspas, executar, comando, abrirTunelDoAparelho, garantirTunelDoAparelho, conectarPorSsh, criarClienteSsh };
