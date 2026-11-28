'use strict';
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { marcarCaminhos } = require('./caminhos-do-palco');

const PASTA_DO_SETUP = path.join(__dirname, '..', 'iphone-setup');
const SENHA = 'senha-de-teste';
const UDID = 'a'.repeat(40);
const ID_DO_IPHONE = `ios-${UDID}`;
const CHAVE_DO_SERVIDOR = Buffer.from('chave-do-servidor-usb').toString('base64');
const IMPRESSAO_DO_SERVIDOR = crypto.createHash('sha256').update(Buffer.from('chave-do-servidor-usb')).digest('hex');
const CHAVE_PUBLICA_DO_NOVA = 'ssh-ed25519 AAAAChaveDoNova Nova AI USB';
const VERSAO_DO_HELPER = /^HELPER_VERSION=(\d+)/m.exec(fs.readFileSync(path.join(PASTA_DO_SETUP, 'nova-locale.sh'), 'utf8'))[1];
const ARQUIVOS_DOS_PACOTES = {
  camera: 'camera.deb', novamodel: 'novamodel.deb', novalanguage: 'com.aquiles.novalanguage_0.2-3.deb', novaproxy: 'novaproxy.deb',
};

const AMBIENTE_PADRAO = {
  aparelhos: UDID,
  modelo: 'iPhone10,2',
  versaoDoIos: '16.7.16',
  portaAberta: true,
  portaAbreDepoisDoProcesso: false,
  abrirOpenssh: () => 'ssh',
  conexao: 'pronta',
  impressaoPrefixada: null,
  pacotes: ['camera', 'novamodel', 'novalanguage', 'novaproxy'],
  semHelperDeFuso: false,
  versoes: { camera: '', novamodel: '', novalanguage: '', novaproxy: '' },
  cameraAtualizada: 'no',
  chaveLocal: 'ausente',
  chaveDoServidor: `ssh-ed25519 ${CHAVE_DO_SERVIDOR} root@iphone\n`,
  iosSshOk: true,
  catvnc: false,
  estadoDoHelper: () => JSON.stringify({ ok: true, message: `pronto v${VERSAO_DO_HELPER}` }),
  regras: [],
};

function respostasPadrao(ambiente) {
  const instalado = (nome) => ({ saida: ambiente.versoes[nome] });
  return [
    [/^test -d \/var\/jb && command -v sudo/, () => ({})],
    [/^umask 077; mkdir -p ~\/\.ssh/, () => ({})],
    [/ssh_host_ed25519_key\.pub/, () => ({ saida: ambiente.chaveDoServidor })],
    [/dpkg-query -W -f='\$\{Version\}' com\.aquiles\.obsgraph-bridge/, () => instalado('camera')],
    [/dpkg --compare-versions/, () => ({ saida: ambiente.cameraAtualizada })],
    [/dpkg-query -W -f='\$\{Version\}' com\.aquiles\.novamodel/, () => instalado('novamodel')],
    [/dpkg-query -W -f='\$\{Version\}' com\.aquiles\.novalanguage/, () => instalado('novalanguage')],
    [/dpkg-query -W -f='\$\{Version\}' com\.aquiles\.novaproxy/, () => instalado('novaproxy')],
    [/cat \/var\/tmp\/nova-locale-status\.json/, () => ({ saida: ambiente.estadoDoHelper() })],
    [/^\/var\/jb\/usr\/bin\/dpkg-query -W 2>/, () => ({ saida: ambiente.catvnc ? 'com.charlessoft.catvnc 1.0\n' : 'bash 5.2\n' })],
  ];
}

function copiarPastaDoSetup(destino, ambiente) {
  fs.mkdirSync(destino, { recursive: true });
  for (const nome of fs.readdirSync(PASTA_DO_SETUP)) {
    if (/\.(js|sh|plist)$/.test(nome)) fs.copyFileSync(path.join(PASTA_DO_SETUP, nome), path.join(destino, nome));
  }
  for (const pacote of ambiente.pacotes) fs.writeFileSync(path.join(destino, ARQUIVOS_DOS_PACOTES[pacote]), pacote);
  if (ambiente.semHelperDeFuso) fs.rmSync(path.join(destino, 'nova-locale.sh'));
}

let raizDaCena = null;

function mascarar(texto) {
  const semSenha = String(texto).split(SENHA).join('SENHA');
  return raizDaCena ? marcarCaminhos(semSenha, [[raizDaCena, 'RAIZ']]) : semSenha;
}

function criarRede(ambiente, diario) {
  return {
    connect: (opcoes) => {
      const soquete = new EventEmitter();
      soquete.setTimeout = () => {};
      soquete.destroy = () => {};
      diario.portas.push(opcoes.port);
      process.nextTick(() => soquete.emit(ambiente.portaAberta ? 'connect' : 'error', new Error('recusada')));
      return soquete;
    },
  };
}

function criarProcessos(ambiente, diario) {
  const chaveLocal = () => path.join(ambiente.pastaDoSsh, 'id_iphone');
  const respostaDoExecFile = (arquivo, argumentos) => {
    if (arquivo === 'FERRAMENTA-idevice_id') return ambiente.aparelhos;
    if (arquivo === 'FERRAMENTA-ideviceinfo') return argumentos.at(-1) === 'ProductType' ? ambiente.modelo : ambiente.versaoDoIos;
    if (arquivo === 'SSH-KEYGEN') {
      fs.writeFileSync(chaveLocal(), 'privada');
      fs.writeFileSync(`${chaveLocal()}.pub`, `${CHAVE_PUBLICA_DO_NOVA}\n`);
    }
    return '';
  };
  return {
    execFile: (arquivo, argumentos, opcoes, callback) => {
      diario.ferramentas.push({ arquivo, argumentos, opcoes });
      process.nextTick(callback, null, respostaDoExecFile(arquivo, argumentos), '');
    },
    spawn: (arquivo, argumentos, opcoes) => {
      diario.processos.push({ arquivo, argumentos, opcoes });
      if (ambiente.portaAbreDepoisDoProcesso) ambiente.portaAberta = true;
      return Object.assign(new EventEmitter(), { unref: () => {} });
    },
  };
}

function criarResposta(ambiente) {
  const regras = [...ambiente.regras, ...respostasPadrao(ambiente)];
  return (comando) => {
    const regra = regras.find(([padrao]) => padrao.test(comando));
    return { saida: '', erro: '', codigo: 0, ...(regra ? regra[1](comando) : {}) };
  };
}

function criarCliente(ambiente, diario) {
  return class ClienteFalso {
    constructor() {
      this.ouvintes = {};
      diario.clientes.push(this);
    }
    on(evento, ouvinte) { this.ouvintes[evento] = ouvinte; return this; }
    connect(opcoes) {
      const { password, hostVerifier, ...resto } = opcoes;
      diario.conexoes.push({ ...resto, senhaInformada: password === SENHA });
      const aceita = hostVerifier(ambiente.impressaoDoServidor || IMPRESSAO_DO_SERVIDOR);
      diario.impressoes.push(aceita);
      process.nextTick(() => this.concluirConexao(aceita));
    }
    concluirConexao(aceita) {
      if (!aceita || ambiente.conexao === 'erro') return this.ouvintes.error(new Error('recusado'));
      if (ambiente.conexao === 'queda') return this.ouvintes.close();
      this.ouvintes.ready();
    }
    exec(comando, callback) {
      const fluxo = Object.assign(new EventEmitter(), { stderr: new EventEmitter(), close: () => {} });
      fluxo.end = (entrada) => {
        diario.comandos.push({ comando: mascarar(comando), entrada: mascarar(entrada) });
        const { saida, erro, codigo } = criarResposta(ambiente)(comando);
        setImmediate(() => {
          if (saida) fluxo.emit('data', saida);
          if (erro) fluxo.stderr.emit('data', erro);
          fluxo.emit('close', codigo);
        });
      };
      callback(null, fluxo);
    }
    sftp(callback) {
      const envio = {
        fastPut: (local, remoto, concluir) => {
          diario.envios.push({ arquivo: path.basename(local), remoto });
          const erro = (ambiente.falhaNoEnvio || (() => null))(remoto);
          concluir(erro ? new Error(erro) : null);
        },
        end: () => diario.fimDoSftp++,
      };
      callback(null, envio);
    }
    end() { diario.encerrados++; }
  };
}

function criarSubstitutos(ambiente, diario) {
  return {
    child_process: criarProcessos(ambiente, diario),
    net: criarRede(ambiente, diario),
    './node_modules/ssh2': { Client: criarCliente(ambiente, diario) },
    '../tool-paths': {
      exigirOpenssh: (nome) => { diario.openssh.push(nome); return ambiente.abrirOpenssh(nome); },
      sshKeygen: () => 'SSH-KEYGEN',
    },
    '../ios-tools': { tool: (nome) => `FERRAMENTA-${nome}` },
    '../iphone-ssh': {
      paths: () => ({ dir: ambiente.pastaDoSsh, key: path.join(ambiente.pastaDoSsh, 'id_iphone'), knownHosts: path.join(ambiente.pastaDoSsh, 'known_hosts') }),
    },
  };
}

function prepararChaveLocal(ambiente) {
  const chave = path.join(ambiente.pastaDoSsh, 'id_iphone');
  fs.mkdirSync(ambiente.pastaDoSsh, { recursive: true });
  const modos = {
    ausente: () => {},
    completa: () => { fs.writeFileSync(chave, 'privada'); fs.writeFileSync(`${chave}.pub`, `${CHAVE_PUBLICA_DO_NOVA}\n`); },
    semPublica: () => fs.writeFileSync(chave, 'privada'),
    publicaInvalida: () => { fs.writeFileSync(chave, 'privada'); fs.writeFileSync(`${chave}.pub`, 'ecdsa-sha2 AAAA\n'); },
  };
  modos[ambiente.chaveLocal]();
}

function acelerarEsperasCurtas() {
  const original = global.setTimeout;
  global.setTimeout = (funcao, espera, ...resto) => original(funcao, espera < 5000 ? 0 : espera, ...resto);
  return () => { global.setTimeout = original; };
}

function lerArquivos(ambiente, servico) {
  const ler = (arquivo) => (fs.existsSync(arquivo) ? fs.readFileSync(arquivo, 'utf8') : null);
  return {
    chavesDosAparelhos: ler(path.join(servico.baseDir, 'iphone-hosts.json')),
    conhecidos: ler(path.join(ambiente.pastaDoSsh, 'known_hosts')),
    chavePrivadaExiste: fs.existsSync(path.join(ambiente.pastaDoSsh, 'id_iphone')),
  };
}

function paraRegistro(valor) {
  if (valor instanceof Error) return { erro: valor.constructor.name, mensagem: mascarar(valor.message) };
  if (Array.isArray(valor)) return valor.map(paraRegistro);
  if (valor && typeof valor === 'object') return Object.fromEntries(Object.entries(valor).map(([chave, item]) => [chave, paraRegistro(item)]));
  return typeof valor === 'string' ? mascarar(valor) : valor === undefined ? null : valor;
}

async function encenar(cena) {
  const ambiente = { ...AMBIENTE_PADRAO, ...(cena.ambiente || {}) };
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'iphone-setup-'));
  raizDaCena = raiz;
  ambiente.pastaDoSsh = path.join(raiz, 'ssh');
  const pastaDoSetup = path.join(raiz, 'services', 'iphone-setup');
  copiarPastaDoSetup(pastaDoSetup, ambiente);
  prepararChaveLocal(ambiente);
  const diario = {
    portas: [], ferramentas: [], processos: [], conexoes: [], impressoes: [], comandos: [], envios: [], openssh: [], consultasAoServico: [],
    clientes: [], encerrados: 0, fimDoSftp: 0,
  };
  const servico = {
    baseDir: path.join(raiz, 'physical_mobile'),
    iosSsh: async (comando) => { diario.consultasAoServico.push(comando); return { ok: ambiente.iosSshOk }; },
  };
  fs.mkdirSync(servico.baseDir, { recursive: true });
  if (ambiente.chavesDosAparelhos) fs.writeFileSync(path.join(servico.baseDir, 'iphone-hosts.json'), ambiente.chavesDosAparelhos);
  const substitutos = criarSubstitutos(ambiente, diario);
  const carregador = Module._load;
  Module._load = function (pedido, ...resto) {
    return Object.prototype.hasOwnProperty.call(substitutos, pedido) ? substitutos[pedido] : carregador.call(this, pedido, ...resto);
  };
  const restaurarTempo = acelerarEsperasCurtas();
  const consoleAntes = console.info;
  console.info = () => {};
  const registro = {};
  try {
    for (const nome of Object.keys(require.cache)) if (nome.startsWith(pastaDoSetup)) delete require.cache[nome];
    const setup = require(path.join(pastaDoSetup, 'setup.js'));
    registro.cena = await cena.roteiro({ setup, servico, ambiente });
  } finally {
    restaurarTempo();
    console.info = consoleAntes;
    Module._load = carregador;
  }
  const { clientes, ...resto } = diario;
  const resultado = { ...registro, ...resto, clientesCriados: clientes.length, arquivos: lerArquivos(ambiente, servico) };
  const registroFinal = paraRegistro(resultado);
  raizDaCena = null;
  fs.rmSync(raiz, { recursive: true, force: true });
  return registroFinal;
}

async function tentar(funcao) {
  try {
    return { resultado: await funcao() };
  } catch (erro) {
    return { erro };
  }
}

module.exports = {
  encenar, tentar, SENHA, UDID, ID_DO_IPHONE, IMPRESSAO_DO_SERVIDOR, CHAVE_DO_SERVIDOR, VERSAO_DO_HELPER,
};
