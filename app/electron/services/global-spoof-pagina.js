'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { ANTES_DAS_VARIAVEIS, DEPOIS_DAS_VARIAVEIS } = require('./global-spoof-pagina-ambiente');
const { TEXTO_DA_MIDIA } = require('./global-spoof-pagina-midia');

const RUIDOS = ['canvasNoise', 'webglNoise', 'audioNoise', 'webglImageNoise', 'clientRectsNoise', 'speechVoicesNoise'];

const PADROES_DO_PERFIL = {
  canvasNoiseSeed: 42,
  webglNoiseSeed: 88,
  audioNoiseSeed: 0.0000001,
  virtualCamId: 'mock_cam_id',
  virtualCamLabel: 'HD Camera',
  virtualMicId: 'mock_mic_id',
  virtualMicLabel: 'Microphone',
  virtualSpeakerId: 'mock_speaker_id',
  virtualSpeakerLabel: 'Speakers',
  portScanProtection: 'enable',
};

const FAMILIAS = {
  desktop: { platformStr: 'Win32', gpuVendor: 'Google Inc. (NVIDIA)', gpuRenderer: 'NVIDIA GeForce RTX 3060' },
  iphone: { platformStr: 'iPhone', gpuVendor: 'Apple Inc.', gpuRenderer: 'Apple GPU' },
  android: { platformStr: 'Linux armv8l', gpuVendor: 'Google Inc. (Qualcomm)', gpuRenderer: 'Adreno (TM) 750' },
};

const CAMPOS_DA_FAMILIA = [
  ['platformStr', 'platformStr'],
  ['gpuVendor', 'webglVendor'],
  ['gpuRenderer', 'webglRenderer'],
];

const NUMEROS_DO_PERFIL = [
  ['cpuCores', 'cpuCores'],
  ['ramSize', 'ramSize'],
];

const CRU = 'cru';
const TEXTO = 'texto';
const ESCAPADO = 'escapado';

const VARIAVEIS_DO_SCRIPT = [
  ['canvasNoise', CRU], ['webglNoise', CRU], ['audioNoise', CRU], ['webglImageNoise', CRU],
  ['clientRectsNoise', CRU], ['speechVoicesNoise', CRU],
  ['platformStr', ESCAPADO], ['cpuCores', CRU], ['ramSize', CRU], ['gpuVendor', ESCAPADO], ['gpuRenderer', ESCAPADO],
  ['doNotTrack', TEXTO], ['portScanProtection', TEXTO],
  ['canvasNoiseSeed', CRU], ['webglNoiseSeed', CRU], ['audioNoiseSeed', CRU],
  ['virtualCamId', TEXTO], ['virtualCamLabel', ESCAPADO], ['virtualMicId', TEXTO], ['virtualMicLabel', ESCAPADO],
  ['virtualSpeakerId', TEXTO], ['virtualSpeakerLabel', ESCAPADO],
  null,
  ['tTimezone', ESCAPADO], ['tOffset', CRU], ['tLat', CRU], ['tLng', CRU], ['tIP', TEXTO], ['tISP', ESCAPADO],
  ['tOrg', ESCAPADO], ['tASN', TEXTO], ['tCountry', ESCAPADO], ['tCC', TEXTO], ['tRegion', ESCAPADO],
  ['tCity', ESCAPADO], ['tGMT', ESCAPADO], ['tLocale', TEXTO], ['tLocales', CRU],
  ['d', CRU], ['w', CRU], ['h', CRU], ['cW', CRU], ['cH', CRU], ['m', CRU],
  ['devId', TEXTO], ['grpId', TEXTO],
];

const FORMATOS = {
  [CRU]: (valor) => `${valor}`,
  [TEXTO]: (valor) => `"${valor}"`,
  [ESCAPADO]: (valor) => `"${valor.replace(/"/g, '\\"')}"`,
};

function familiaDoAparelho(isMobile, device) {
  if (!isMobile) return FAMILIAS.desktop;
  return device.id && device.id.includes('iphone') ? FAMILIAS.iphone : FAMILIAS.android;
}

function numeroDoPerfil(valor) {
  return valor && valor !== 'Auto' ? parseInt(valor) : 8;
}

function valorDoPerfil(perfil, chave) {
  return perfil[chave] || PADROES_DO_PERFIL[chave];
}

function valoresDoPerfil({ perfil, device, isMobile }) {
  const valores = {};
  for (const chave of RUIDOS) valores[chave] = perfil[chave] !== false;
  for (const chave of Object.keys(PADROES_DO_PERFIL)) valores[chave] = valorDoPerfil(perfil, chave);
  for (const [nome, chave] of CAMPOS_DA_FAMILIA) valores[nome] = perfil[chave] || familiaDoAparelho(isMobile, device)[nome];
  for (const [nome, chave] of NUMEROS_DO_PERFIL) valores[nome] = numeroDoPerfil(perfil[chave]);
  valores.doNotTrack = perfil.doNotTrack;
  return valores;
}

function valoresDoAparelho({ device, isMobile, tela }) {
  const sorteadoDoDispositivo = crypto.randomBytes(32).toString('hex');
  const sorteadoDoGrupo = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
  return {
    d: JSON.stringify(device),
    w: tela.winW,
    h: tela.winH,
    cW: tela.camW,
    cH: tela.camH,
    m: isMobile,
    devId: sorteadoDoDispositivo,
    grpId: sorteadoDoGrupo,
  };
}

function linhaDaVariavel(entrada, valores) {
  if (!entrada) return '';
  const [nome, formato] = entrada;
  return `var _${nome} = ${FORMATOS[formato](valores[nome])};`;
}

function montarTextoDaPagina({ perfil, device, isMobile, tela, identidade }) {
  const valores = {
    ...valoresDoPerfil({ perfil, device, isMobile }),
    ...identidade,
    tLocales: JSON.stringify(identidade.tLocales),
    ...valoresDoAparelho({ device, isMobile, tela }),
  };
  const variaveis = VARIAVEIS_DO_SCRIPT.map((entrada) => linhaDaVariavel(entrada, valores)).join('\n');
  return ANTES_DAS_VARIAVEIS + variaveis + '\n' + DEPOIS_DAS_VARIAVEIS + TEXTO_DA_MIDIA;
}

function gravarExtensao(pasta, texto) {
  const manifest = {
    manifest_version: 3,
    name: 'Nova Stealth Injector',
    version: '4.0',
    content_scripts: [{
      matches: ['<all_urls>'],
      js: ['inject.js'],
      run_at: 'document_start',
      world: 'MAIN',
      all_frames: true,
      match_about_blank: true,
      match_origin_as_fallback: true,
    }],
  };
  if (!fs.existsSync(pasta)) fs.mkdirSync(pasta, { recursive: true });
  fs.writeFileSync(path.join(pasta, 'manifest.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(pasta, 'inject.js'), texto);
}

module.exports = { montarTextoDaPagina, gravarExtensao };
