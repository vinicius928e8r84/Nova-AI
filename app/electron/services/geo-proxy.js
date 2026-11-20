'use strict';
/**
 * geo-proxy.js — resolve a localização (lat/lon/cidade/fuso) do IP de saída
 * de um proxy SOCKS5, e também geolocaliza um IP já conhecido.
 *
 * Módulo puro (sem Electron) para poder ser testado direto com node:
 *   node teste-geo.cjs "socks5://host:porta:usuario:senha"
 */
const https = require('https');

const GEO_BASE = 'https://ipwho.is';
const UA = 'nova-geo/1.0';

const ESQUEMAS = ['socks5', 'socks5h', 'socks4', 'socks4a', 'http', 'https'];
const PORTAS_HTTP = [1000, 3128, 8000, 8080, 8888];
const PORTA_HTTPS = 1001;

const HOST = '([^:/@\\s]+)';
const PORTA = '(\\d{1,5})';
const USUARIO = '([^:@\\s]+)';
const FORMATOS = [
  { re: new RegExp(`^${USUARIO}:(.*)@${HOST}:${PORTA}$`), ordem: ['user', 'pass', 'host', 'port'], decodifica: true },
  { re: new RegExp(`^${HOST}:${PORTA}:${USUARIO}:(.+)$`), ordem: ['host', 'port', 'user', 'pass'] },
  { re: new RegExp(`^${HOST}:${PORTA}@${USUARIO}:(.+)$`), ordem: ['host', 'port', 'user', 'pass'] },
  { re: new RegExp(`^${HOST}:${PORTA}$`), ordem: ['host', 'port'] }
];

function esquemaPelaPorta(port) {
  if (PORTAS_HTTP.includes(port)) return 'http';
  if (port === PORTA_HTTPS) return 'https';
  return 'socks5';
}

function decodificarSeguro(texto) {
  try {
    return decodeURIComponent(texto);
  } catch {
    return texto;
  }
}

function parseProxy(raw) {
  let s = String(raw || '').trim();
  if (s.length >= 2 && /^["'`]/.test(s) && /["'`]$/.test(s)) s = s.slice(1, -1).trim();
  s = s.replace(/\/+$/, '');
  if (!s) return null;

  let scheme = null;
  const comEsquema = s.match(/^([A-Za-z][A-Za-z0-9+.-]*):\/\/(.*)$/);
  if (comEsquema) {
    scheme = comEsquema[1].toLowerCase();
    if (!ESQUEMAS.includes(scheme)) return null;
    s = comEsquema[2];
  }

  for (const formato of FORMATOS) {
    const m = s.match(formato.re);
    if (!m) continue;
    const campos = {};
    formato.ordem.forEach((nome, i) => { campos[nome] = m[i + 1]; });
    const port = Number(campos.port);
    if (!(port > 0 && port <= 65535)) return null;
    const user = campos.user && formato.decodifica ? decodificarSeguro(campos.user) : campos.user;
    const pass = campos.pass && formato.decodifica ? decodificarSeguro(campos.pass) : campos.pass;
    return {
      scheme: scheme || esquemaPelaPorta(port),
      host: campos.host,
      port,
      user: user || null,
      pass: pass || null,
      schemeGuessed: !scheme
    };
  }
  return null;
}

function agentFor(parsed) {
  const auth = parsed.user
    ? `${encodeURIComponent(parsed.user)}:${encodeURIComponent(parsed.pass || '')}@`
    : '';
  const destino = `${auth}${parsed.host}:${parsed.port}`;
  if (parsed.scheme === 'http' || parsed.scheme === 'https') {
    const { HttpsProxyAgent } = require('https-proxy-agent');
    return new HttpsProxyAgent(`${parsed.scheme}://${destino}`);
  }
  const { SocksProxyAgent } = require('socks-proxy-agent');
  const scheme = parsed.scheme.startsWith('socks4') ? 'socks4' : 'socks5';
  return new SocksProxyAgent(`${scheme}://${destino}`);
}

function getJson(url, agent, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { agent, timeout: timeoutMs, headers: { 'User-Agent': UA } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error(`resposta não-JSON (HTTP ${res.statusCode})`));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout na consulta de geolocalização')));
    req.on('error', reject);
  });
}

function normalize(data) {
  if (!data || data.success === false) {
    throw new Error((data && data.message) || 'geolocalização falhou');
  }
  return {
    ip: data.ip || null,
    city: data.city || null,
    region: data.region || null,
    country: data.country || null,
    countryCode: data.country_code || null,
    lat: data.latitude,
    lon: data.longitude,
    timezone: (data.timezone && data.timezone.id) || null,
    isp: (data.connection && data.connection.isp) || null
  };
}

/** Consulta a geo *através* do proxy (devolve o IP de saída e a geo dele). */
async function throughProxy(proxy) {
  const parsed = parseProxy(proxy);
  if (!parsed) throw new Error('Proxy inválido: não achei host e porta na string');
  const data = await getJson(`${GEO_BASE}/`, agentFor(parsed));
  return normalize(data);
}

/** Geolocaliza um IP já conhecido (sem proxy). */
async function byIp(ip) {
  const clean = String(ip || '').trim();
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(clean) && !/^[0-9a-f:]+$/i.test(clean)) {
    throw new Error(`IP inválido: ${clean || '(vazio)'}`);
  }
  const data = await getJson(`${GEO_BASE}/${encodeURIComponent(clean)}`);
  return normalize(data);
}

module.exports = { parseProxy, agentFor, throughProxy, byIp, normalize };
