'use strict';

const desktop = { id: 'desktop' };
const iphone = { id: 'iphone-15', ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' };
const android = { id: 'pixel-8', ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8)' };

const regionalCompleto = {
  timezone: 'America/Sao_Paulo', language: 'pt-BR', lat: -23.55, lng: -46.63, utcOffset: -3,
  ip: '203.0.113.30', isp: 'Vivo "Fibra"', org: 'Telefonica Brasil S.A.', asn: 'AS18881',
  country: 'Brazil', countryCode: 'BR', region: 'Sao Paulo', city: 'Sao "Paulo"', gmtLabel: 'GMT-0300 (Brasilia Standard Time)',
};

const perfilCompleto = {
  platform: 'windows', timezone: 'Europe/Lisbon', locale: 'pt-PT', locationMode: 'custom', latitude: 0, longitude: -9.14,
  platformStr: 'Win32', cpuCores: '12', ramSize: '16', webglVendor: 'Google Inc. (AMD)', webglRenderer: 'AMD Radeon RX 6600',
  doNotTrack: '1', portScanProtection: 'disable',
  canvasNoise: false, webglNoise: false, audioNoise: false, webglImageNoise: false, clientRectsNoise: false, speechVoicesNoise: false,
  canvasNoiseSeed: 7, webglNoiseSeed: 9, audioNoiseSeed: 0.5,
  virtualCamId: 'cam_id_x', virtualMicId: 'mic_id_x', virtualSpeakerId: 'spk_id_x',
  virtualCamLabel: 'Cam "Um"', virtualMicLabel: 'Mic "Dois"', virtualSpeakerLabel: 'Spk "Tres"',
};

const perfilVazio = {
  timezone: 'Europe/Lisbon', locale: 'pt-PT', platformStr: '', webglVendor: '', webglRenderer: '', cpuCores: '', ramSize: '',
  portScanProtection: '', canvasNoiseSeed: 0, webglNoiseSeed: 0, audioNoiseSeed: 0, virtualCamId: '', virtualMicId: '',
  virtualSpeakerId: '', virtualCamLabel: '', virtualMicLabel: '', virtualSpeakerLabel: '',
};

module.exports = [
  { nome: 'Default com o regional completo da interface', plataforma: 'win32', ajustes: { profile: 'Default', device: desktop, regional: regionalCompleto } },
  { nome: 'Default com o regional optimal', plataforma: 'win32', ajustes: { profile: 'Default', device: desktop, regional: { timezone: 'optimal', utcOffset: 4, language: 'optimal' } } },
  { nome: 'Default com regional vazio', plataforma: 'win32', ajustes: { profile: 'Default', device: desktop, regional: {} } },
  { nome: 'Default em iPhone', plataforma: 'win32', ajustes: { profile: 'Default', device: iphone, regional: regionalCompleto } },
  { nome: 'Default em Android', plataforma: 'darwin', ajustes: { profile: 'Default', device: android, regional: regionalCompleto } },
  { nome: 'perfil completo com valores próprios e aspas', plataforma: 'win32', perfil: perfilCompleto, ajustes: { profile: 'profile_01', device: desktop, regional: regionalCompleto } },
  { nome: 'perfil de proxy, resolução própria e núcleos automáticos', plataforma: 'win32', perfil: { ...perfilCompleto, proxy: 'user:pass@203.0.113.1:8080', screenResolution: '1366x768', browser: 'chrome', cpuCores: 'Auto', ramSize: 'Auto' }, ajustes: { profile: 'profile_01', device: desktop, regional: regionalCompleto } },
  { nome: 'perfil Android', plataforma: 'win32', perfil: { platform: 'android', timezone: 'Asia/Tokyo', locale: 'ja-JP' }, ajustes: { profile: 'profile_01', device: android, regional: regionalCompleto } },
  { nome: 'perfil iOS com valores próprios', plataforma: 'darwin', perfil: { ...perfilCompleto, platform: 'ios', platformStr: 'iPhone', webglVendor: 'Apple Inc.', webglRenderer: 'Apple GPU' }, ajustes: { profile: 'profile_01', device: iphone, regional: regionalCompleto } },
  { nome: 'perfil Mac', plataforma: 'darwin', perfil: { platform: 'mac', timezone: 'America/New_York', locale: 'en-US' }, ajustes: { profile: 'profile_01', device: desktop, regional: regionalCompleto } },
  { nome: 'perfil com campos vazios', plataforma: 'win32', perfil: perfilVazio, ajustes: { profile: 'profile_01', device: desktop, regional: regionalCompleto } },
  { nome: 'perfil Android com campos vazios', plataforma: 'win32', perfil: { ...perfilVazio, platform: 'android' }, ajustes: { profile: 'profile_01', device: android, regional: regionalCompleto } },
  { nome: 'perfil iOS com campos vazios', plataforma: 'win32', perfil: { ...perfilVazio, platform: 'ios' }, ajustes: { profile: 'profile_01', device: iphone, regional: regionalCompleto } },
  { nome: 'perfil no horário de verão do hemisfério sul, sem regional', plataforma: 'win32', perfil: { timezone: 'Australia/Sydney', locale: 'en-AU' }, ajustes: { profile: 'profile_01', device: desktop, regional: undefined } },
];
