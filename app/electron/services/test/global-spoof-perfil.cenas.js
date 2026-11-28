'use strict';

const desktop = { id: 'desktop' };
const iphone = { id: 'iphone-15', ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' };
const android = { id: 'pixel-8', ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8)' };

const regional = { timezone: 'America/Sao_Paulo', language: 'pt-BR', lat: -23.55, lng: -46.63, utcOffset: -3 };

const perfilIncompleto = { id: 'profile_01', name: 'Fixo', ua: 'Mozilla/5.0 (X11; Linux x86_64) do perfil', timezone: 'Europe/Lisbon', locale: 'pt-PT' };

const perfilCompleto = {
  id: 'profile_01', name: 'Completo', ua: 'Mozilla/5.0 (Windows NT 10.0) do completo', platform: 'windows', timezone: 'Europe/Lisbon', locale: 'pt-PT',
  platformStr: 'Win32', cpuCores: '12', ramSize: '16', webglVendor: 'Google Inc. (AMD)', webglRenderer: 'AMD Radeon RX 6600',
  deviceName: 'LAPTOP-FIXO', macAddress: '00-1B-21-AA-BB-CC', screenResolution: '1366x768', windowMode: 'custom',
  canvasNoiseSeed: 7, webglNoiseSeed: 9, audioNoiseSeed: 0.5,
  virtualCamId: 'cam_id_x', virtualMicId: 'mic_id_x', virtualSpeakerId: 'spk_id_x',
  virtualCamLabel: 'Cam Um', virtualMicLabel: 'Mic Dois', virtualSpeakerLabel: 'Spk Tres',
};

const farmQueGrava = (perfis) => ({ perfis, grava: true });
const farmQueNaoGrava = (perfis) => ({ perfis, grava: false });

const nomeLivre = (extras = {}) => ({ profile: 'Meu perfil', device: desktop, regional, ...extras });
const doPerfil = (id, extras = {}) => ({ profile: id, device: desktop, regional, ...extras });

module.exports = [
  { nome: 'nome livre sem arquivo nem farm cria o profile_01 e abre com ele', plataforma: 'win32', registrarDispositivo: true, ajustes: nomeLivre() },
  { nome: 'nome livre em iPhone com proxy de usuário e senha, navegador firefox e latitude do regional', plataforma: 'win32', registrarDispositivo: true, ajustes: nomeLivre({ device: iphone, browser: 'firefox', proxy: { user: 'ana', pass: 'segredo', ip: '203.0.113.5', port: 8080 } }) },
  { nome: 'nome livre em Android com proxy sem usuário e sem regional', plataforma: 'win32', registrarDispositivo: true, ajustes: nomeLivre({ device: android, regional: undefined, proxy: { ip: '203.0.113.6', port: 3128 } }) },
  { nome: 'nome livre com o arquivo cheio: o número é o maior mais um e ids fora do padrão contam zero', plataforma: 'win32', perfis: [{ id: 'profile_03', name: 'a' }, { id: 'sem-padrao', name: 'b' }, { name: 'sem id' }, { id: 'profile_07', name: 'c' }], ajustes: nomeLivre() },
  { nome: 'nome livre com o arquivo cheio de ids fora do padrão começa no profile_01', plataforma: 'win32', perfis: [{ id: 'abc', name: 'a' }, { name: 'sem id' }], ajustes: nomeLivre() },
  { nome: 'nome livre com o arquivo quebrado recomeça a lista só com o perfil novo', plataforma: 'win32', arquivoBruto: '{quebrado', ajustes: nomeLivre() },
  { nome: 'nome livre com o arquivo vazio de perfis grava a lista com o perfil novo', plataforma: 'win32', arquivoBruto: '[]', ajustes: nomeLivre() },
  { nome: 'nome livre com o farm que grava: o perfil entra na lista do farm e a abertura usa o perfil gravado', plataforma: 'win32', registrarDispositivo: true, farm: farmQueGrava([{ id: 'profile_02', name: 'do farm' }]), ajustes: nomeLivre() },
  { nome: 'nome livre com o farm que não grava no arquivo: o perfil entra na lista do farm e a abertura cai no perfil temporário', plataforma: 'win32', registrarDispositivo: true, farm: farmQueNaoGrava([]), ajustes: nomeLivre() },
  { nome: 'profile_NN com campos faltando é regravado completo e o user agent do perfil vale para o dispositivo', plataforma: 'win32', registrarDispositivo: true, perfis: [perfilIncompleto], ajustes: doPerfil('profile_01', { device: android }) },
  { nome: 'profile_NN completo deixa o arquivo exatamente como estava', plataforma: 'win32', registrarDispositivo: true, arquivoBruto: JSON.stringify([perfilCompleto]), ajustes: doPerfil('profile_01', { device: iphone }) },
  { nome: 'profile_NN completo sem user agent não muda o do dispositivo', plataforma: 'win32', registrarDispositivo: true, arquivoBruto: JSON.stringify([{ ...perfilCompleto, ua: '' }]), ajustes: doPerfil('profile_01', { device: iphone }) },
  { nome: 'com dois perfis só o escolhido é completado', plataforma: 'win32', arquivoBruto: JSON.stringify([perfilCompleto, { id: 'profile_02', name: 'Segundo', platform: 'android' }]), ajustes: doPerfil('profile_02', { device: android }) },
  { nome: 'com dois perfis o escolhido completo não mexe no outro incompleto', plataforma: 'win32', arquivoBruto: JSON.stringify([perfilCompleto, { id: 'profile_02', name: 'Segundo' }]), ajustes: doPerfil('profile_01') },
  { nome: 'profile_NN que não está no arquivo abre com perfil temporário de desktop', plataforma: 'win32', registrarDispositivo: true, perfis: [perfilCompleto], ajustes: doPerfil('profile_09') },
  { nome: 'profile_NN que não está no arquivo abre com perfil temporário de iPhone', plataforma: 'darwin', registrarDispositivo: true, perfis: [perfilCompleto], ajustes: doPerfil('profile_09', { device: iphone }) },
  { nome: 'profile_NN que não está no arquivo abre com perfil temporário de Android', plataforma: 'win32', registrarDispositivo: true, perfis: [perfilCompleto], ajustes: doPerfil('profile_09', { device: android }) },
  { nome: 'profile_NN com o arquivo quebrado abre com perfil temporário', plataforma: 'win32', arquivoBruto: '{quebrado', ajustes: doPerfil('profile_01') },
  { nome: 'Default em desktop com user agent próprio mantém o user agent', plataforma: 'win32', registrarDispositivo: true, ajustes: { profile: 'Default', device: { id: 'desktop', ua: 'UA do dispositivo' }, regional } },
  { nome: 'sem profile nos ajustes abre como Default', plataforma: 'win32', registrarDispositivo: true, ajustes: { device: desktop, regional } },
  { nome: 'sem dispositivo nos ajustes abre com o dispositivo de desktop', plataforma: 'win32', ajustes: { profile: 'Default' } },
  { nome: 'dispositivo sem id lança TypeError ao montar o perfil temporário', plataforma: 'win32', ajustes: { profile: 'Default', device: { ua: 'x' } } },
  { nome: 'a lista de perfis sem arquivo só tem o Default', plataforma: 'win32', semAbrir: true, listar: true, ajustes: {} },
  { nome: 'a lista de perfis completa os campos que faltam e põe o Default na frente', plataforma: 'win32', semAbrir: true, listar: true, perfis: [perfilCompleto, { id: 'profile_02', name: 'Vazio' }, { id: 'profile_03', name: 'Com e-mail', email: 'a@example.com', platform: 'ios', proxy: 'p:1', anonymityScore: 90 }], ajustes: {} },
  { nome: 'a lista de perfis com o arquivo quebrado só tem o Default', plataforma: 'win32', semAbrir: true, listar: true, arquivoBruto: '{quebrado', ajustes: {} },
  { nome: 'a lista de perfis com o arquivo que não é lista só tem o Default', plataforma: 'win32', semAbrir: true, listar: true, arquivoBruto: '{"id":"profile_01"}', ajustes: {} },
  { nome: 'a lista de perfis com o arquivo vazio de perfis só tem o Default', plataforma: 'win32', semAbrir: true, listar: true, arquivoBruto: '[]', ajustes: {} },
];
