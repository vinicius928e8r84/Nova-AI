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

/**
 * Aceita os dois formatos usados no Nova e o formato URL padrão:
 *   socks5://host:porta:usuario:senha   (formato do painel do iPhone)
 *   socks5://usuario:senha@host:porta   (formato URL)
 *   host:porta
 */
function parseProxy(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;

  let m = s.match(/^(socks5h?|socks4):\/\/([^:@/\s]+):([^@/\s]+)@([^:/\s]+):(\d+)$/i);
  if (m) {
    return {
      scheme: m[1].toLowerCase(),
      host: m[4],
      port: Number(m[5]),
      user: decodeURIComponent(m[2]),
      pass: decodeURIComponent(m[3])
    };
  }

  m = s.match(/^(socks5h?|socks4):\/\/([^:/\s]+):(\d+)(?::([^:\s]+):(.+))?$/i);
  if (m) {
    return {
      scheme: m[1].toLowerCase(),
      host: m[2],
      port: Number(m[3]),
      user: m[4] || null,
      pass: m[5] || null
    };
  }

  m = s.match(/^([^:/\s]+):(\d+)$/);
  if (m) {
    return { scheme: 'socks5', host: m[1], port: Number(m[2]), user: null, pass: null };
  }

  return null;
}

function agentFor(parsed) {
  const { SocksProxyAgent } = require('socks-proxy-agent');
  const auth = parsed.user
    ? `${encodeURIComponent(parsed.user)}:${encodeURIComponent(parsed.pass || '')}@`
    : '';
  const scheme = parsed.scheme.startsWith('socks4') ? 'socks4' : 'socks5';
  return new SocksProxyAgent(`${scheme}://${auth}${parsed.host}:${parsed.port}`);
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
  if (!parsed) throw new Error('Proxy inválido: use socks5://host:porta:usuario:senha');
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

module.exports = { parseProxy, throughProxy, byIp, normalize };
