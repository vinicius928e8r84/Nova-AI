'use strict';

const crypto = require('crypto');

const CPUS = ['4', '6', '8', '12', '16'];
const MEMORIAS = ['4', '8', '12', '16', '32'];
const GPUS_DO_ANDROID = [
  { vendor: 'Google Inc. (Qualcomm)', renderer: 'Adreno (TM) 750' },
  { vendor: 'Google Inc. (Qualcomm)', renderer: 'Adreno (TM) 740' },
  { vendor: 'Google Inc. (ARM)', renderer: 'Mali-G715 MC10' },
  { vendor: 'Google Inc. (ARM)', renderer: 'Mali-G720 MC12' },
  { vendor: 'Google Inc. (ARM)', renderer: 'Mali-G68 MC4' }
];
const GPUS_DO_WINDOWS = [
  'NVIDIA GeForce RTX 3060',
  'NVIDIA GeForce RTX 4070',
  'NVIDIA GeForce RTX 3080',
  'Intel(R) Iris(R) Xe Graphics',
  'AMD Radeon(TM) RX 6700 XT',
  'NVIDIA GeForce GTX 1660 Super'
];
const CAMERAS = ['HD Camera', 'Integrated Webcam', 'USB Camera', 'FaceTime HD Camera', 'FHD Web Camera'];
const MICROFONES = ['Microphone (Realtek High Definition Audio)', 'Internal Microphone', 'Microphone (USB Audio Device)', 'Built-in Microphone'];
const ALTO_FALANTES = ['Speakers (Realtek High Definition Audio)', 'Internal Speakers', 'Headphones (Realtek High Definition Audio)', 'Built-in Output'];
const NOME_DE_FABRICA = 'USER-PC-X6NAGE1';
const MAC_DE_FABRICA = '00-1B-21-29-FE-FA';
const RESOLUCAO_PELO_UA = 'Based on User-Agent';

const sortear = lista => lista[Math.floor(Math.random() * lista.length)];
const ehAutomatico = valor => !valor || valor === 'Auto';
const faltaValor = valor => valor === undefined || valor === null;
const byteAleatorio = () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0').toUpperCase();
const faltaGrafico = p => !p.platformStr || !p.webglVendor || !p.webglRenderer;

function graficosDoAndroid() {
  const platformStr = 'Linux aarch64';
  const gpu = sortear(GPUS_DO_ANDROID);
  return { platformStr, webglVendor: gpu.vendor, webglRenderer: gpu.renderer };
}

const GRAFICOS_POR_PLATAFORMA = new Map([
  ['mac', () => ({ platformStr: 'MacIntel', webglVendor: 'Apple Inc.', webglRenderer: 'Apple M1' })],
  ['linux', () => ({ platformStr: 'Linux x86_64', webglVendor: 'Intel Open Source Technology Center', webglRenderer: 'Mesa DRI Intel(R) HD Graphics 520 (Skylake GT2)' })],
  ['android', graficosDoAndroid],
  ['ios', () => ({ platformStr: 'iPhone', webglVendor: 'Apple Inc.', webglRenderer: 'Apple GPU' })],
]);
const graficosDoWindows = () => ({ platformStr: 'Win32', webglVendor: 'Google Inc. (NVIDIA)', webglRenderer: sortear(GPUS_DO_WINDOWS) });

const TELA_DO_CELULAR = { screenResolution: '412x915', windowMode: 'custom' };
const TELAS_POR_PLATAFORMA = new Map([
  ['android', TELA_DO_CELULAR],
  ['ios', TELA_DO_CELULAR],
  ['mac', { screenResolution: '1440x900', windowMode: 'custom' }],
]);
const TELA_DO_COMPUTADOR = { screenResolution: '1920x1080', windowMode: 'maximized' };

const SEMENTES = [
  ['canvasNoiseSeed', () => Math.floor(Math.random() * 200) + 1],
  ['webglNoiseSeed', () => Math.floor(Math.random() * 200) + 1],
  ['audioNoiseSeed', () => parseFloat((Math.random() * 0.0001).toFixed(8))],
];

const DISPOSITIVOS_VIRTUAIS = [
  ['virtualCamId', 'virtualCamLabel', CAMERAS],
  ['virtualMicId', 'virtualMicLabel', MICROFONES],
  ['virtualSpeakerId', 'virtualSpeakerLabel', ALTO_FALANTES],
];

function garantirHardware(p) {
  if (ehAutomatico(p.cpuCores)) p.cpuCores = sortear(CPUS);
  if (ehAutomatico(p.ramSize)) p.ramSize = sortear(MEMORIAS);
}

function garantirGraficos(p, platform) {
  if (!faltaGrafico(p)) return;
  const graficos = GRAFICOS_POR_PLATAFORMA.get(platform) || graficosDoWindows;
  Object.assign(p, graficos());
}

function garantirIdentidade(p) {
  if (!p.deviceName || p.deviceName === NOME_DE_FABRICA) {
    p.deviceName = `LAPTOP-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;
  }
  if (!p.macAddress || p.macAddress === MAC_DE_FABRICA) {
    p.macAddress = `00-1B-21-${byteAleatorio()}-${byteAleatorio()}-${byteAleatorio()}`;
  }
}

function garantirTela(p, platform) {
  if (p.screenResolution && p.screenResolution !== RESOLUCAO_PELO_UA) return;
  Object.assign(p, TELAS_POR_PLATAFORMA.get(platform) || TELA_DO_COMPUTADOR);
}

function garantirSementes(p) {
  for (const [campo, sortearSemente] of SEMENTES) {
    if (faltaValor(p[campo])) p[campo] = sortearSemente();
  }
}

function garantirDispositivos(p) {
  for (const [campoDoId, campoDoRotulo, marcas] of DISPOSITIVOS_VIRTUAIS) {
    if (!p[campoDoId]) p[campoDoId] = crypto.randomBytes(32).toString('hex');
    if (!p[campoDoRotulo]) p[campoDoRotulo] = sortear(marcas);
  }
}

function ensureProfileStealthSpecs(p) {
  if (!p) return;
  const platform = p.platform || 'android';
  garantirHardware(p);
  garantirGraficos(p, platform);
  garantirIdentidade(p);
  garantirTela(p, platform);
  garantirSementes(p);
  garantirDispositivos(p);
}

function numeroDoPerfil(p) {
  if (!p || !p.id) return 0;
  const match = p.id.match(/^profile_(\d+)$/);
  return match ? parseInt(match[1], 10) : 0;
}

function proximoNumeroDePerfil(profiles) {
  if (!profiles || profiles.length === 0) return 1;
  const nums = profiles.map(numeroDoPerfil).filter(n => !isNaN(n));
  return nums.length > 0 ? Math.max(...nums) + 1 : 1;
}

module.exports = { ensureProfileStealthSpecs, proximoNumeroDePerfil };
