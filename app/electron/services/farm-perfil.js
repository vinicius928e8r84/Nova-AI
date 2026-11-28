'use strict';

const crypto = require('crypto');

const MOBILE_UAS = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 14; CPH2573) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 12; Redmi Note 12 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/122.0.6261.89 Mobile/15E148 Safari/604.1',
];

const IDIOMA_PADRAO = 'en-US';
const IDIOMA_POR_PAIS = {
  US: 'en-US',
  GB: 'en-GB',
  PK: 'ur-PK',
  FR: 'fr-FR',
  DE: 'de-DE',
  CA: 'en-CA',
  AU: 'en-AU',
  IN: 'hi-IN',
  AE: 'ar-AE',
  SA: 'ar-SA',
};

const NUCLEOS = ['4', '6', '8', '12', '16'];
const MEMORIAS = ['4', '8', '12', '16', '32'];
const NOME_ANTIGO_DO_DISPOSITIVO = 'USER-PC-X6NAGE1';
const MAC_ANTIGO = '00-1B-21-29-FE-FA';
const RESOLUCAO_ANTIGA = 'Based on User-Agent';

const placa = (vendor, renderer) => ({ vendor, renderer });
const placasDaNvidia = renderers => renderers.map(renderer => placa('Google Inc. (NVIDIA)', renderer));

const HARDWARE_DO_WINDOWS = {
  platformStr: 'Win32',
  placas: placasDaNvidia([
    'NVIDIA GeForce RTX 3060',
    'NVIDIA GeForce RTX 4070',
    'NVIDIA GeForce RTX 3080',
    'Intel(R) Iris(R) Xe Graphics',
    'AMD Radeon(TM) RX 6700 XT',
    'NVIDIA GeForce GTX 1660 Super',
  ]),
};

const HARDWARE_POR_PLATAFORMA = {
  mac: { platformStr: 'MacIntel', placas: [placa('Apple Inc.', 'Apple M1')] },
  linux: {
    platformStr: 'Linux x86_64',
    placas: [placa('Intel Open Source Technology Center', 'Mesa DRI Intel(R) HD Graphics 520 (Skylake GT2)')],
  },
  android: {
    platformStr: 'Linux aarch64',
    placas: [
      placa('Google Inc. (Qualcomm)', 'Adreno (TM) 750'),
      placa('Google Inc. (Qualcomm)', 'Adreno (TM) 740'),
      placa('Google Inc. (ARM)', 'Mali-G715 MC10'),
      placa('Google Inc. (ARM)', 'Mali-G720 MC12'),
      placa('Google Inc. (ARM)', 'Mali-G68 MC4'),
    ],
  },
  ios: { platformStr: 'iPhone', placas: [placa('Apple Inc.', 'Apple GPU')] },
};

const RESOLUCAO_DO_CELULAR = { screenResolution: '412x915', windowMode: 'custom' };
const RESOLUCAO_PADRAO_DO_DESKTOP = { screenResolution: '1920x1080', windowMode: 'maximized' };
const RESOLUCAO_PADRAO_POR_PLATAFORMA = {
  android: RESOLUCAO_DO_CELULAR,
  ios: RESOLUCAO_DO_CELULAR,
  mac: { screenResolution: '1440x900', windowMode: 'custom' },
};

const DISPOSITIVOS_DE_MIDIA = [
  { id: 'virtualCamId', rotulo: 'virtualCamLabel', marcas: ['HD Camera', 'Integrated Webcam', 'USB Camera', 'FaceTime HD Camera', 'FHD Web Camera'] },
  {
    id: 'virtualMicId',
    rotulo: 'virtualMicLabel',
    marcas: ['Microphone (Realtek High Definition Audio)', 'Internal Microphone', 'Microphone (USB Audio Device)', 'Built-in Microphone'],
  },
  {
    id: 'virtualSpeakerId',
    rotulo: 'virtualSpeakerLabel',
    marcas: ['Speakers (Realtek High Definition Audio)', 'Internal Speakers', 'Headphones (Realtek High Definition Audio)', 'Built-in Output'],
  },
];

const SEMENTES_DE_RUIDO = [
  { campo: 'canvasNoiseSeed', sortear: () => Math.floor(Math.random() * 200) + 1 },
  { campo: 'webglNoiseSeed', sortear: () => Math.floor(Math.random() * 200) + 1 },
  { campo: 'audioNoiseSeed', sortear: () => parseFloat((Math.random() * 0.0001).toFixed(8)) },
];

const MEDIDA_DO_CELULAR = { width: 412, height: 915 };
const MEDIDA_DA_JANELA_SEM_TELA = { width: 1280, height: 720 };
const MEDIDA_DA_TELA_COM_FALHA = { width: 1920, height: 1080 };
const MEDIDA_PADRAO_POR_PLATAFORMA = {
  android: MEDIDA_DO_CELULAR,
  ios: MEDIDA_DO_CELULAR,
  mac: { width: 1440, height: 900 },
  linux: { width: 1366, height: 768 },
};
const MEDIDA_PADRAO_DO_WINDOWS = { width: 1920, height: 1080 };

const daTabela = (tabela, chave, padrao) => (Object.prototype.hasOwnProperty.call(tabela, chave) ? tabela[chave] : padrao);
const sortearDe = lista => lista[Math.floor(Math.random() * lista.length)];
const ausenteOuAuto = valor => !valor || valor === 'Auto';
const semValor = valor => valor === undefined || valor === null;
const doisDigitos = numero => String(numero).padStart(2, '0');

function idiomaDoPais(codigoDoPais) {
  return IDIOMA_POR_PAIS[String(codigoDoPais).toUpperCase()] || IDIOMA_PADRAO;
}

function escolherPlaca(placas) {
  return placas.length > 1 ? sortearDe(placas) : placas[0];
}

function completarNucleos(perfil) {
  if (ausenteOuAuto(perfil.cpuCores)) perfil.cpuCores = sortearDe(NUCLEOS);
}

function completarMemoria(perfil) {
  if (ausenteOuAuto(perfil.ramSize)) perfil.ramSize = sortearDe(MEMORIAS);
}

function faltaHardwareGrafico(perfil) {
  return !perfil.platformStr || !perfil.webglVendor || !perfil.webglRenderer;
}

function completarHardwareGrafico(perfil, plataforma) {
  if (!faltaHardwareGrafico(perfil)) return;
  const hardware = daTabela(HARDWARE_POR_PLATAFORMA, plataforma, HARDWARE_DO_WINDOWS);
  perfil.platformStr = hardware.platformStr;
  const { vendor, renderer } = escolherPlaca(hardware.placas);
  perfil.webglVendor = vendor;
  perfil.webglRenderer = renderer;
}

function completarNomeDoDispositivo(perfil) {
  if (perfil.deviceName && perfil.deviceName !== NOME_ANTIGO_DO_DISPOSITIVO) return;
  const sufixo = Math.random().toString(36).substring(2, 9).toUpperCase();
  perfil.deviceName = `LAPTOP-${sufixo}`;
}

function byteEmHexadecimal() {
  return Math.floor(Math.random() * 256).toString(16).padStart(2, '0').toUpperCase();
}

function completarEnderecoMac(perfil) {
  if (perfil.macAddress && perfil.macAddress !== MAC_ANTIGO) return;
  perfil.macAddress = `00-1B-21-${byteEmHexadecimal()}-${byteEmHexadecimal()}-${byteEmHexadecimal()}`;
}

function completarResolucao(perfil, plataforma) {
  if (perfil.screenResolution && perfil.screenResolution !== RESOLUCAO_ANTIGA) return;
  const padrao = daTabela(RESOLUCAO_PADRAO_POR_PLATAFORMA, plataforma, RESOLUCAO_PADRAO_DO_DESKTOP);
  perfil.screenResolution = padrao.screenResolution;
  perfil.windowMode = padrao.windowMode;
}

function completarSementesDeRuido(perfil) {
  for (const { campo, sortear } of SEMENTES_DE_RUIDO) {
    if (semValor(perfil[campo])) perfil[campo] = sortear();
  }
}

function completarDispositivosDeMidia(perfil) {
  for (const { id, rotulo, marcas } of DISPOSITIVOS_DE_MIDIA) {
    if (!perfil[id]) perfil[id] = crypto.randomBytes(32).toString('hex');
    if (!perfil[rotulo]) perfil[rotulo] = sortearDe(marcas);
  }
}

const PASSOS_DA_ESPECIFICACAO = [
  completarNucleos,
  completarMemoria,
  completarHardwareGrafico,
  completarNomeDoDispositivo,
  completarEnderecoMac,
  completarResolucao,
  completarSementesDeRuido,
  completarDispositivosDeMidia,
];

function completarEspecificacoes(perfil) {
  if (!perfil) return;
  const plataforma = perfil.platform || 'android';
  for (const passo of PASSOS_DA_ESPECIFICACAO) passo(perfil, plataforma);
}

function medidaDaTelaPrincipal() {
  try {
    const telaPrincipal = require('electron').screen.getPrimaryDisplay();
    if (!telaPrincipal || !telaPrincipal.bounds) return MEDIDA_DA_JANELA_SEM_TELA;
    return { width: telaPrincipal.bounds.width || 1920, height: telaPrincipal.bounds.height || 1080 };
  } catch (erro) {
    console.error('[Farm] Failed to get screen size for maximized window:', erro);
    return MEDIDA_DA_TELA_COM_FALHA;
  }
}

function medidaDaResolucao(resolucao) {
  const partes = resolucao.split('x');
  return { width: parseInt(partes[0]) || 1280, height: parseInt(partes[1]) || 720 };
}

function medidaSemResolucao(plataforma) {
  return daTabela(MEDIDA_PADRAO_POR_PLATAFORMA, plataforma, MEDIDA_PADRAO_DO_WINDOWS);
}

function medidaDaJanelaNormal(perfil, plataforma) {
  if (perfil.screenResolution && perfil.screenResolution.includes('x')) return medidaDaResolucao(perfil.screenResolution);
  return medidaSemResolucao(plataforma);
}

function ehCelular(plataforma) {
  return plataforma === 'android' || plataforma === 'ios';
}

function tamanhoDaJanela(perfil) {
  const plataforma = perfil.platform || 'windows';
  if (perfil.windowMode !== 'maximized') return { ...medidaDaJanelaNormal(perfil, plataforma), maximized: false };
  if (ehCelular(plataforma)) return { ...MEDIDA_DO_CELULAR, maximized: false };
  return { ...medidaDaTelaPrincipal(), maximized: true };
}

function numeroDoPerfil(perfil) {
  if (!perfil || !perfil.id) return 0;
  const encontrado = perfil.id.match(/^profile_(\d+)$/);
  return encontrado ? parseInt(encontrado[1], 10) : 0;
}

function proximoNumeroDePerfil(perfis) {
  if (!perfis || perfis.length === 0) return 1;
  return Math.max(...perfis.map(numeroDoPerfil)) + 1;
}

function montarPerfilNovo(identidade, indiceDoUserAgent) {
  const perfil = {
    ...identidade,
    ua: MOBILE_UAS[indiceDoUserAgent % MOBILE_UAS.length],
    proxy: '',
    email: '',
    status: 'idle',
    battery: Math.floor(Math.random() * 50) + 40,
    anonymityScore: Math.floor(Math.random() * 30) + 65,
    lastRun: null,
    platform: 'android',
    timezone: 'optimal',
    locale: 'optimal',
    latitude: null,
    longitude: null,
    canvasNoise: true,
    webglNoise: true,
    audioNoise: true,
  };
  completarEspecificacoes(perfil);
  return perfil;
}

const idDoPerfil = numero => `profile_${doisDigitos(numero)}`;
const nomePadraoDoPerfil = numero => `Profile ${doisDigitos(numero)}`;

function perfilPadrao(indice) {
  const numero = indice + 1;
  return montarPerfilNovo({ id: idDoPerfil(numero), name: nomePadraoDoPerfil(numero) }, indice);
}

function perfilAdicionado(numero, nome, navegador, indiceDoUserAgent) {
  const identidade = { id: idDoPerfil(numero), name: nome || nomePadraoDoPerfil(numero), browser: navegador || 'chrome' };
  return montarPerfilNovo(identidade, indiceDoUserAgent);
}

module.exports = {
  completarEspecificacoes,
  tamanhoDaJanela,
  idiomaDoPais,
  proximoNumeroDePerfil,
  idDoPerfil,
  perfilPadrao,
  perfilAdicionado,
};
