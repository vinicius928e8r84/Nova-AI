const os = require('os');
const net = require('net');
const { exec, execFile } = require('child_process');

const PORTA_DO_ADB_SEM_FIO = 5555;
const ESPERA_ENTRE_ABRIR_A_PORTA_E_CONECTAR_EM_MS = 1000;
const LIMITE_DO_COMANDO_EM_MS = 15000;
const LIMITE_DO_MDNS_EM_MS = 4000;
const LIMITE_DE_CADA_ENDERECO_EM_MS = 250;
const ENDERECOS_POR_VEZ = 35;
const ULTIMO_ENDERECO_DA_SUBREDE = 254;
const MAIOR_NUMERO_DE_UM_IP = 255;
const AVISO_DE_IP_NAO_ACHADO = 'Não foi possível detectar o IP. Conecte o Android e este computador à mesma rede Wi-Fi.';

const primeiroPreenchido = (...valores) => valores.find(Boolean);
const saidaDiz = (saida, texto) => Boolean(saida) && saida.includes(texto);
const textoDoErroDoAdb = (erro, saida, erroPadrao) => (erroPadrao || saida || erro.message).trim();
const textoDaSaida = (saida) => (saida || '').trim();

function executarAdb(adb, argumentos) {
  return new Promise((resolve, reject) => {
    execFile(adb, argumentos, { encoding: 'utf8', timeout: LIMITE_DO_COMANDO_EM_MS }, (erro, saida, erroPadrao) => {
      if (erro) reject(new Error(textoDoErroDoAdb(erro, saida, erroPadrao)));
      else resolve(textoDaSaida(saida));
    });
  });
}

function conectarWifi(adb, enderecoIp) {
  return new Promise((resolve) => {
    const alvo = enderecoIp.includes(':') ? enderecoIp : `${enderecoIp}:${PORTA_DO_ADB_SEM_FIO}`;
    exec(`"${adb}" connect ${alvo}`, (erro, saida, erroPadrao) => {
      if (erro || saidaDiz(saida, 'failed')) {
        console.error('[PhysicalMobile] Connect Wi-Fi failed:', saida || erroPadrao);
        resolve({ success: false, error: primeiroPreenchido(saida, erroPadrao, 'Connection timeout. Ensure Wireless Debugging is ON.') });
        return;
      }
      console.info('[PhysicalMobile] Connected to Wi-Fi device:', saida);
      resolve({ success: true, message: saida.trim() });
    });
  });
}

function parearPorCodigo(adb, ip, porta, codigoDePareamento) {
  return new Promise((resolve) => {
    exec(`"${adb}" pair ${ip}:${porta} ${codigoDePareamento}`, (erro, saida, erroPadrao) => {
      if (erro || saidaDiz(saida, 'Failed')) {
        resolve({ success: false, error: primeiroPreenchido(saida, erroPadrao, 'Pairing failed. Check pairing code and port.') });
        return;
      }
      resolve({ success: true, message: saida.trim() });
    });
  });
}

function recusarPareamentoPorFio(aparelho) {
  if (String(aparelho).startsWith('ios-')) {
    return { success: false, platform: 'ios', error: 'Wireless Switch é exclusivo para Android. Nesta versão, mantenha o iPhone conectado por USB.' };
  }
  if (typeof aparelho !== 'string' || !aparelho.trim()) {
    return { success: false, error: 'Selecione um dispositivo Android conectado por USB.' };
  }
  return null;
}

async function ipDoWifiDoAparelho(adb, aparelho) {
  const saida = await executarAdb(adb, ['-s', aparelho, 'shell', 'ip', '-f', 'inet', 'addr', 'show', 'wlan0']);
  const achado = saida.match(/inet\s+(\d+\.\d+\.\d+\.\d+)/);
  if (achado) return achado[1];
  return executarAdb(adb, ['-s', aparelho, 'shell', 'getprop', 'dhcp.wlan0.ipaddress']);
}

const ehIpValido = (ip) => /^\d+\.\d+\.\d+\.\d+$/.test(ip) && ip.split('.').every((parte) => Number(parte) <= MAIOR_NUMERO_DE_UM_IP);
const esperar = (milissegundos) => new Promise((resolve) => setTimeout(resolve, milissegundos));

function conectouPorWifi(resposta) {
  const disseConectado = /\b(?:already )?connected to\b/i.test(resposta);
  return disseConectado && !/failed|unable|cannot|error/i.test(resposta);
}

async function passarParaWifi(adb, aparelho) {
  const ip = await ipDoWifiDoAparelho(adb, aparelho);
  if (!ehIpValido(ip)) return { success: false, error: AVISO_DE_IP_NAO_ACHADO };
  await executarAdb(adb, ['-s', aparelho, 'tcpip', String(PORTA_DO_ADB_SEM_FIO)]);
  await esperar(ESPERA_ENTRE_ABRIR_A_PORTA_E_CONECTAR_EM_MS);
  const resposta = await executarAdb(adb, ['connect', `${ip}:${PORTA_DO_ADB_SEM_FIO}`]);
  if (!conectouPorWifi(resposta)) return { success: false, error: resposta || 'Não foi possível conectar por Wi-Fi.' };
  return { success: true, ip, deviceId: `${ip}:${PORTA_DO_ADB_SEM_FIO}`, message: `Android conectado por Wi-Fi em ${ip}:${PORTA_DO_ADB_SEM_FIO}` };
}

async function parearPorFioParaWifi(adb, aparelho) {
  try {
    return await passarParaWifi(adb, aparelho);
  } catch (erro) {
    return { success: false, error: `Não foi possível ativar a conexão Wi-Fi: ${erro.message}` };
  }
}

function enderecosDoMdns(saida) {
  const achados = (saida || '').split('\n').map((linha) => linha.match(/(\d+\.\d+\.\d+\.\d+):(\d+)/));
  return achados.filter(Boolean).map((achado) => achado[0]);
}

function descobrirPeloMdns(adb) {
  return new Promise((resolve) => {
    exec(`"${adb}" mdns services`, { timeout: LIMITE_DO_MDNS_EM_MS }, (erro, saida) => resolve(enderecosDoMdns(saida)));
  });
}

const ehIpv4DeFora = (interfaceDeRede) => interfaceDeRede.family === 'IPv4' && !interfaceDeRede.internal;

function subredesDaMaquina() {
  return Object.values(os.networkInterfaces()).flat()
    .filter(ehIpv4DeFora)
    .map((interfaceDeRede) => interfaceDeRede.address.split('.'))
    .filter((partes) => partes.length === 4)
    .map((partes) => `${partes[0]}.${partes[1]}.${partes[2]}`);
}

function enderecoAceitaConexao(ip) {
  return new Promise((resolve) => {
    const soquete = new net.Socket();
    soquete.setTimeout(LIMITE_DE_CADA_ENDERECO_EM_MS);
    soquete.on('connect', () => {
      soquete.destroy();
      resolve(ip);
    });
    soquete.on('timeout', () => { soquete.destroy(); resolve(null); });
    soquete.on('error', () => { soquete.destroy(); resolve(null); });
    soquete.connect(PORTA_DO_ADB_SEM_FIO, ip);
  });
}

function enderecosDaSubrede(subrede) {
  return Array.from({ length: ULTIMO_ENDERECO_DA_SUBREDE }, (vazio, posicao) => `${subrede}.${posicao + 1}`);
}

async function varrerSubrede(subrede) {
  const enderecos = enderecosDaSubrede(subrede);
  const abertos = [];
  for (let inicio = 0; inicio < enderecos.length; inicio += ENDERECOS_POR_VEZ) {
    const lote = enderecos.slice(inicio, inicio + ENDERECOS_POR_VEZ);
    abertos.push(...await Promise.all(lote.map(enderecoAceitaConexao)));
  }
  return abertos.filter(Boolean).map((ip) => `${ip}:${PORTA_DO_ADB_SEM_FIO}`);
}

function semRepetir(enderecos) {
  return enderecos.filter((endereco, posicao) => enderecos.indexOf(endereco) === posicao);
}

function conectarAoAlvo(adb, alvo) {
  return new Promise((resolve) => {
    exec(`"${adb}" connect ${alvo}`, (erro, saida) => resolve(!erro && !saida.includes('failed')));
  });
}

async function procurarEnderecos(adb) {
  const peloMdns = await descobrirPeloMdns(adb);
  const subredes = subredesDaMaquina();
  const pelaVarredura = subredes.length > 0 ? await varrerSubrede(subredes[0]) : [];
  return semRepetir([...peloMdns, ...pelaVarredura]);
}

async function varrerEConectar(adb) {
  const descobertos = await procurarEnderecos(adb);
  let conectados = 0;
  for (const alvo of descobertos) {
    if (await conectarAoAlvo(adb, alvo)) conectados++;
  }
  return { discoveredIps: descobertos, connectedCount: conectados };
}

module.exports = { conectarWifi, parearPorCodigo, recusarPareamentoPorFio, parearPorFioParaWifi, varrerEConectar };
