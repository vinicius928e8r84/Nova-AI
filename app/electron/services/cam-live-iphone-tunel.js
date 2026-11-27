'use strict';
const crypto = require('crypto');
const iphoneSsh = require('./iphone-ssh');

const entreAspas = (texto) => "'" + String(texto).replace(/'/g, "'\\''") + "'";

function caminhoDoSsh() {
  return require('./tool-paths').exigirOpenssh('ssh');
}

function argumentosDoSsh(forward) {
  return ['-p', '2222', ...iphoneSsh.sshOptions(), '-v', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=5', '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=5', '-o', 'ServerAliveCountMax=2', '-N', '-R', forward, 'mobile@127.0.0.1'];
}

function motivoDoEncerramento(stderr) {
  const ocupado = stderr.includes('remote port forwarding failed') || stderr.includes('remote forward failure');
  return ocupado
    ? 'O endereço de câmera do iPhone está ocupado por outra transmissão. Encerre-a antes de iniciar o CAM LIVE.'
    : 'O túnel USB foi encerrado. Reconecte o iPhone em PHONE CONTROL.';
}

class AberturaDoTunel {
  constructor(servico, child, resolve, reject) {
    this.servico = servico; this.child = child; this.resolve = resolve; this.reject = reject;
    this.confirmed = false; this.settled = false; this.stderr = '';
  }
  observar() {
    const child = this.child;
    this.timer = setTimeout(() => this.falhar(new Error('O túnel USB não confirmou a conexão. Use Conectar em PHONE CONTROL.')), 8000);
    child.stderr.on('data', (bytes) => this.receberErro(bytes));
    child.once('error', () => this.falhar(new Error('Não foi possível iniciar o túnel SSH por USB. Use Conectar em PHONE CONTROL.')));
    child.once('exit', () => this.aoSair());
  }
  fechar() {
    if (this.servico.tunnel === this.child) this.servico.tunnel = null;
    try { this.child.kill(); } catch (_) {}
  }
  falhar(error) {
    if (!this.settled) {
      this.settled = true; clearTimeout(this.timer); this.fechar(); this.reject(error);
    } else if (this.confirmed) {
      this.fechar(); this.servico._fail(error, this.servico.generation);
    }
  }
  receberErro(bytes) {
    this.stderr = (this.stderr + bytes.toString()).slice(-4096);
    if (!this.settled && this.stderr.includes('remote forward success')) {
      this.confirmed = true; this.settled = true; clearTimeout(this.timer); this.resolve();
    }
  }
  aoSair() {
    if (this.child.novaAbort) return;
    this.falhar(new Error(motivoDoEncerramento(this.stderr)));
  }
}

function abrirRedirecionamento(servico, args) {
  return new Promise((resolve, reject) => {
    const child = servico.spawnProcess(caminhoDoSsh(), args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    child.novaAbort = false; servico.tunnel = child;
    new AberturaDoTunel(servico, child, resolve, reject).observar();
  });
}

function socketAceito(resposta) {
  if (!resposta?.ok) return false;
  return String(resposta.stdout || '').includes('ok');
}

async function exigirSocketUnix(servico, socketPath) {
  const check = await servico.mobile.iosSsh(`chmod 666 ${entreAspas(socketPath)} && test -S ${entreAspas(socketPath)} && echo ok`);
  if (!socketAceito(check)) throw new Error('O iPhone não aceitou o socket Unix.');
}

function abandonarSocketUnix(servico, socketPath) {
  const tunnel = servico.tunnel;
  if (tunnel) {
    tunnel.novaAbort = true;
    try { tunnel.kill(); } catch (__) {}
    servico.tunnel = null;
  }
  servico.mobile.iosSsh(`rm -f ${entreAspas(socketPath)}`).catch(() => {});
  servico.socketPath = null;
}

async function redirecionamentoCamuflado(servico, localPort) {
  const socketPath = `/var/tmp/.nb-${crypto.randomBytes(4).toString('hex')}.sock`;
  servico.socketPath = socketPath;
  try {
    await servico._openForward(argumentosDoSsh(`${socketPath}:127.0.0.1:${localPort}`));
    await exigirSocketUnix(servico, socketPath);
    return { type: 'unix', path: socketPath };
  } catch (_) {
    abandonarSocketUnix(servico, socketPath);
    return servico._tcpForward(localPort);
  }
}

async function abrirPortaTcp(servico, localPort) {
  const port = 20000 + crypto.randomInt(0, 20000);
  await servico._openForward(argumentosDoSsh(`127.0.0.1:${port}:127.0.0.1:${localPort}`));
  servico.remotePort = port;
  return { type: 'tcp', port };
}

async function redirecionamentoTcp(servico, localPort, attempts = 3) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try { return await abrirPortaTcp(servico, localPort); } catch (error) { lastError = error; }
  }
  throw lastError || new Error('Não foi possível abrir o túnel do iPhone.');
}

function tunelVivo(tunnel) {
  if (!tunnel) return false;
  return tunnel.exitCode == null && tunnel.signalCode == null;
}

function aguardarSaidaDoTunel(tunnel) {
  if (!tunelVivo(tunnel)) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timeout);
      tunnel.removeListener('exit', done);
      resolve();
    };
    const timeout = setTimeout(done, 1500);
    tunnel.once('exit', done);
    tunnel.kill();
  });
}

async function apagarSocket(servico, socketPath) {
  if (!socketPath) return;
  try { await servico.getMobileService?.()?.iosSsh(`rm -f ${entreAspas(socketPath)}`); } catch (_) {}
}

module.exports = { abrirRedirecionamento, redirecionamentoCamuflado, redirecionamentoTcp, aguardarSaidaDoTunel, apagarSocket };
