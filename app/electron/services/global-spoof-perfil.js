'use strict';

const fs = require('fs');
const path = require('path');
const { completarEspecificacoes, proximoNumeroDePerfil, idDoPerfil } = require('./farm-perfil');

const USER_AGENT_DO_WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const PREFIXO_DO_ID_DO_FARM = 'profile_';
const PERFIL_SEM_ESCOLHA = 'Default';
const BATERIA_MINIMA = 40;
const PONTOS_DE_ANONIMATO_MINIMOS = 65;
const ANONIMATO_PADRAO_DA_LISTA = 75;

const caminhoDosPerfis = (app) => path.join(app.getPath('userData'), 'farm_profiles.json');
const perfilSemEscolha = () => ({ id: PERFIL_SEM_ESCOLHA, name: PERFIL_SEM_ESCOLHA, email: '', platform: 'windows', proxy: '' });

function ehNomeLivre(nome) {
  if (!nome) return false;
  return !nome.startsWith(PREFIXO_DO_ID_DO_FARM) && nome !== PERFIL_SEM_ESCOLHA;
}

function lerPerfisDoArquivo(arquivo) {
  if (!fs.existsSync(arquivo)) return [];
  try {
    return JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  } catch (erro) {
    return [];
  }
}

function textoDoProxy(proxy) {
  if (!proxy) return '';
  const credenciais = proxy.user ? `${proxy.user}:${proxy.pass}@` : '';
  return `${credenciais}${proxy.ip}:${proxy.port}`;
}

function montarPerfilDeNomeLivre(id, nome, device, settings) {
  const perfil = {
    id,
    name: nome,
    browser: settings.browser || 'chrome',
    ua: device.ua || USER_AGENT_DO_WINDOWS,
    proxy: textoDoProxy(settings.proxy),
    email: '',
    status: 'idle',
    battery: Math.floor(Math.random() * 50) + BATERIA_MINIMA,
    anonymityScore: Math.floor(Math.random() * 30) + PONTOS_DE_ANONIMATO_MINIMOS,
    lastRun: null,
    platform: device.id !== 'desktop' ? 'android' : 'windows',
    timezone: 'optimal',
    locale: 'optimal',
    latitude: settings.regional ? settings.regional.lat : null,
    longitude: settings.regional ? settings.regional.lng : null,
    canvasNoise: true,
    webglNoise: true,
    audioNoise: true,
  };
  completarEspecificacoes(perfil);
  return perfil;
}

function perfisConhecidos(browserFarmService, arquivo) {
  if (browserFarmService) return browserFarmService.profiles || [];
  return lerPerfisDoArquivo(arquivo);
}

function guardarPerfilNovo(browserFarmService, perfil, perfis, arquivo) {
  if (browserFarmService) {
    browserFarmService.profiles.push(perfil);
    browserFarmService._saveProfiles();
    return;
  }
  perfis.push(perfil);
  fs.writeFileSync(arquivo, JSON.stringify(perfis, null, 2));
}

function criarPerfilDeNomeLivre({ app, browserFarmService }, nome, device, settings) {
  const arquivo = caminhoDosPerfis(app);
  const perfis = perfisConhecidos(browserFarmService, arquivo);
  const id = idDoPerfil(proximoNumeroDePerfil(perfis));
  const perfil = montarPerfilDeNomeLivre(id, nome, device, settings);
  guardarPerfilNovo(browserFarmService, perfil, perfis, arquivo);
  return id;
}

function regravarSeFaltavaEspecificacao(perfil, perfis, arquivo) {
  const antes = JSON.stringify(perfil);
  completarEspecificacoes(perfil);
  if (JSON.stringify(perfil) === antes) return;
  try {
    fs.writeFileSync(arquivo, JSON.stringify(perfis, null, 2));
  } catch (erro) {}
}

function carregarPerfilSalvo(app, id) {
  if (!id || id === PERFIL_SEM_ESCOLHA) return null;
  const arquivo = caminhoDosPerfis(app);
  const perfis = lerPerfisDoArquivo(arquivo);
  const perfil = perfis.find((candidato) => candidato.id === id);
  if (!perfil) return null;
  console.info(`[GlobalSpoof] Loaded active profile config: ${perfil.name} (${perfil.id})`);
  regravarSeFaltavaEspecificacao(perfil, perfis, arquivo);
  return perfil;
}

function plataformaDoDispositivo(device) {
  if (device.id === 'desktop') return 'windows';
  return device.id.includes('iphone') ? 'ios' : 'android';
}

function criarPerfilTemporario(device) {
  const perfil = {
    id: 'temp_launch_' + Math.random().toString(36).substring(2, 9),
    name: 'Temporary Profile',
    platform: plataformaDoDispositivo(device),
    ua: device.ua || USER_AGENT_DO_WINDOWS,
    proxy: '',
    canvasNoise: true,
    webglNoise: true,
    audioNoise: true,
  };
  completarEspecificacoes(perfil);
  return perfil;
}

const resumoDoPerfil = (item) => ({
  id: item.id,
  name: item.name,
  email: item.email || '',
  platform: item.platform || 'android',
  proxy: item.proxy || '',
  anonymityScore: item.anonymityScore || ANONIMATO_PADRAO_DA_LISTA,
});

function listarPerfis(app) {
  const arquivo = caminhoDosPerfis(app);
  if (!fs.existsSync(arquivo)) return [perfilSemEscolha()];
  try {
    const lista = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
    return [perfilSemEscolha(), ...lista.map(resumoDoPerfil)];
  } catch (erro) {
    return [perfilSemEscolha()];
  }
}

module.exports = { caminhoDosPerfis, ehNomeLivre, criarPerfilDeNomeLivre, carregarPerfilSalvo, criarPerfilTemporario, listarPerfis, textoDoProxy };
