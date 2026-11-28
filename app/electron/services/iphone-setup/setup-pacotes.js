const fs = require('fs');
const path = require('path');
const { aspas, comando } = require('./setup-ssh');

const VERSAO_DA_PONTE_DA_CAMERA = '0.1-39';
const MODELO_COM_PONTE_DA_CAMERA = 'iPhone10,2';
const IOS_COM_PONTE_DA_CAMERA = '16.7.16';
const LETRAS_DO_AVISO_DE_ERRO = 120;
const TENTATIVAS_DO_HANDSHAKE = 20;
const ESPERA_DO_HANDSHAKE_EM_MS = 500;
const COMANDO_DO_ESTADO_DO_HELPER = 'cat /var/tmp/nova-locale-status.json 2>/dev/null || true';
const AVISO_SEM_CAMERA = 'Ponte de câmera não instalada: este modelo/iOS ainda não foi validado.';
const COM_SUDO = "sudo -S -p '' ";

const textoDoErro = (erro) => String((erro && erro.message) || erro).slice(0, LETRAS_DO_AVISO_DE_ERRO);
const entradaDaSenha = (senha, vezes) => (senha + '\n').repeat(vezes);
const doPacoteDoNova = (nome) => path.join(__dirname, nome);

function enviarArquivo(cliente, local, remoto) {
  return new Promise((resolve, reject) => cliente.sftp((erro, sftp) => {
    if (erro) return reject(erro);
    sftp.fastPut(local, remoto, (falha) => {
      sftp.end();
      if (falha) reject(falha);
      else resolve();
    });
  }));
}

async function versaoInstalada(cliente, pacote) {
  const saida = await comando(cliente, "/var/jb/usr/bin/dpkg-query -W -f='${Version}' " + pacote + ' 2>/dev/null || true');
  return saida.trim();
}

async function instalarDeb(cliente, senha, local, remoto) {
  await enviarArquivo(cliente, local, remoto);
  await comando(cliente, COM_SUDO + '/var/jb/usr/bin/dpkg -i ' + remoto, entradaDaSenha(senha, 1));
}

async function cameraEstaAtualizada(cliente, atual) {
  if (!atual) return false;
  const comparacao = await comando(cliente, '/var/jb/usr/bin/dpkg --compare-versions ' + aspas(atual) + ' ge ' + aspas(VERSAO_DA_PONTE_DA_CAMERA) + ' && echo yes || echo no');
  return comparacao.trim() === 'yes';
}

async function instalarPonteDaCamera(cliente, senha) {
  const atual = await versaoInstalada(cliente, 'com.aquiles.obsgraph-bridge');
  if (await cameraEstaAtualizada(cliente, atual)) return 'Ponte de câmera ' + atual + ' já instalada e atualizada.';
  const pacote = doPacoteDoNova('camera.deb');
  if (!fs.existsSync(pacote)) throw new Error('Pacote de câmera ausente no Nova. A conexão SSH já foi preparada.');
  await instalarDeb(cliente, senha, pacote, '/var/mobile/NovaAI-OBSGraphBridge.deb');
  return 'Ponte de câmera ' + VERSAO_DA_PONTE_DA_CAMERA + ' instalada.';
}

async function reiniciarMidiaDoAparelho(cliente, senha) {
  try {
    await comando(cliente, COM_SUDO + '/var/jb/bin/launchctl kickstart -k system/com.apple.mediaserverd', entradaDaSenha(senha, 1));
    return ' Serviço de mídia reiniciado — a ponte já está carregada.';
  } catch (erro) {
    return ' Não consegui reiniciar o mediaserverd: ' + textoDoErro(erro);
  }
}

async function instalarCamera(cliente, senha, modelo, versao) {
  if (modelo !== MODELO_COM_PONTE_DA_CAMERA || versao !== IOS_COM_PONTE_DA_CAMERA) return AVISO_SEM_CAMERA;
  const instalada = await instalarPonteDaCamera(cliente, senha);
  return instalada + (await reiniciarMidiaDoAparelho(cliente, senha));
}

async function instalarModelo(cliente, senha) {
  const pacote = doPacoteDoNova('novamodel.deb');
  if (!fs.existsSync(pacote)) return '';
  const atual = await versaoInstalada(cliente, 'com.aquiles.novamodel');
  if (atual) return ' Spoofing de modelo (novamodel ' + atual + ') já instalado.';
  await instalarDeb(cliente, senha, pacote, '/var/mobile/NovaAI-Novamodel.deb');
  return ' Spoofing de modelo (novamodel) instalado.';
}

async function instalarIdioma(cliente, senha) {
  const pacote = doPacoteDoNova('com.aquiles.novalanguage_0.2-3.deb');
  if (!fs.existsSync(pacote)) return '';
  const atual = await versaoInstalada(cliente, 'com.aquiles.novalanguage');
  if (atual) return ' Idioma do aparelho (novalanguage ' + atual + ') já instalado.';
  try {
    await instalarDeb(cliente, senha, pacote, '/var/mobile/novalanguage.deb');
    return ' Idioma do aparelho (novalanguage) instalado.';
  } catch (erro) {
    return ' Não consegui instalar o novalanguage: ' + textoDoErro(erro);
  }
}

function versaoDoHelperDeFuso(arquivo) {
  try {
    const achado = /^HELPER_VERSION=(\d+)[ \t]*$/m.exec(fs.readFileSync(arquivo, 'utf8'));
    return achado ? achado[1] : null;
  } catch (erro) {
    return null;
  }
}

const limitesDoHandshake = (opcoes) => ({
  tentativas: (opcoes && opcoes.tries) || TENTATIVAS_DO_HANDSHAKE,
  espera: (opcoes && opcoes.delayMs) || ESPERA_DO_HANDSHAKE_EM_MS,
});

async function lerEstadoDoHelperDeFuso(cliente) {
  try {
    return await comando(cliente, COMANDO_DO_ESTADO_DO_HELPER);
  } catch (erro) {
    return '';
  }
}

async function esperarHelperDeFuso(cliente, versao, opcoes) {
  if (!versao) return true;
  const { tentativas, espera } = limitesDoHandshake(opcoes);
  const esperado = new RegExp('"message":"pronto v' + versao + '"');
  for (let tentativa = 0; tentativa < tentativas; tentativa++) {
    if (esperado.test(await lerEstadoDoHelperDeFuso(cliente))) return true;
    if (tentativa < tentativas - 1) await new Promise((resolve) => setTimeout(resolve, espera));
  }
  return false;
}

async function enviarHelperDeFuso(cliente, senha) {
  const script = doPacoteDoNova('nova-locale.sh');
  const servico = doPacoteDoNova('com.aquiles.novalocale.plist');
  if (!fs.existsSync(script) || !fs.existsSync(servico)) return ' Helper nova-locale ausente no Nova.';
  await enviarArquivo(cliente, script, '/var/mobile/nova-locale.sh');
  await enviarArquivo(cliente, servico, '/var/mobile/com.aquiles.novalocale.plist');
  await comando(cliente, COM_SUDO + 'mkdir -p /var/jb/usr/libexec /var/jb/Library/LaunchDaemons', entradaDaSenha(senha, 1));
  await comando(cliente, COM_SUDO + 'mv /var/mobile/nova-locale.sh /var/jb/usr/libexec/nova-locale.sh && ' + COM_SUDO + 'chmod 755 /var/jb/usr/libexec/nova-locale.sh', entradaDaSenha(senha, 2));
  await comando(cliente, COM_SUDO + 'mv /var/mobile/com.aquiles.novalocale.plist /var/jb/Library/LaunchDaemons/ && ' + COM_SUDO + 'chown root:wheel /var/jb/Library/LaunchDaemons/com.aquiles.novalocale.plist', entradaDaSenha(senha, 2));
  await comando(cliente, COM_SUDO + '/var/jb/bin/launchctl bootstrap system /var/jb/Library/LaunchDaemons/com.aquiles.novalocale.plist 2>/dev/null || ' + COM_SUDO + '/var/jb/bin/launchctl kickstart -k system/com.aquiles.novalocale 2>/dev/null || true', entradaDaSenha(senha, 2));
  const versao = versaoDoHelperDeFuso(script);
  if (await esperarHelperDeFuso(cliente, versao)) return ' Fuso/idioma (nova-locale' + (versao ? ' v' + versao : '') + ') atualizado.';
  return ' nova-locale: arquivos enviados, mas o serviço não confirmou a versão v' + versao + '. Rode o Conectar de novo.';
}

async function instalarHelperDeFuso(cliente, senha) {
  try {
    return await enviarHelperDeFuso(cliente, senha);
  } catch (erro) {
    return ' nova-locale não atualizado: ' + textoDoErro(erro);
  }
}

async function instalarProxy(cliente, senha) {
  try {
    const atual = await versaoInstalada(cliente, 'com.aquiles.novaproxy');
    if (atual) return ' Proxy do iPhone (novaproxy ' + atual + ') já instalado.';
    const pacote = doPacoteDoNova('novaproxy.deb');
    if (!fs.existsSync(pacote)) return ' Pacote novaproxy ausente no Nova.';
    await instalarDeb(cliente, senha, pacote, '/var/mobile/novaproxy.deb');
    return ' Proxy do iPhone (novaproxy) instalado.';
  } catch (erro) {
    return ' novaproxy não instalado: ' + textoDoErro(erro);
  }
}

async function instalarPacotesDoNova(cliente, senha, aparelho) {
  let resumo = await instalarCamera(cliente, senha, aparelho.modelo, aparelho.versao);
  resumo += await instalarModelo(cliente, senha);
  resumo += await instalarIdioma(cliente, senha);
  resumo += await instalarHelperDeFuso(cliente, senha);
  resumo += await instalarProxy(cliente, senha);
  return resumo;
}

async function catvncInstalado(cliente) {
  const lista = await comando(cliente, '/var/jb/usr/bin/dpkg-query -W 2>/dev/null || true');
  return /catvnc/i.test(lista);
}

module.exports = { instalarPacotesDoNova, catvncInstalado, versaoDoHelperDeFuso, esperarHelperDeFuso };
