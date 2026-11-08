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

const SCHEMES = ['socks5', 'socks5h', 'socks4', 'socks4a', 'http', 'https'];

/** Sem esquema na string, a porta é a pista (mesma regra do novaproxy no iPhone). */
function schemeForPort(port) {
  if ([1000, 3128, 8080, 8888, 8000].includes(port)) return 'http';
  if (port === 1001) return 'https';
  return 'socks5';
}

/**
 * Extrai só o necessário (esquema, host, porta, usuário, senha) e ignora o resto
 * do enfeite. Aceita, nesta ordem de prioridade:
 *   esquema://host:porta:usuario:senha    (painel da Evomi)
 *   esquema://usuario:senha@host:porta    (URL)
 *   esquema://host:porta@usuario:senha    (ordem invertida da Evomi)
 *   esquema://host:porta
 *   (sem esquema) as mesmas quatro formas terminando em host:porta
 * Esquemas: socks5, socks5h, socks4, socks4a, http, https.
 * Devolve null só quando não há host:porta utilizável.
 */
function parseProxy(raw) {
  let s = String(raw || '').trim();
  if (!s) return null;
  if (s.length >= 2 && /^["'`]/.test(s) && /["'`]$/.test(s)) s = s.slice(1, -1).trim();
  s = s.replace(/\/+$/, '');
  if (!s) return null;

  let scheme = null;
  const sm = s.match(/^([A-Za-z][A-Za-z0-9+.-]*):\/\/(.*)$/);
  if (sm) {
    scheme = sm[1].toLowerCase();
    if (!SCHEMES.includes(scheme)) return null;
    s = sm[2];
  }

  const H = '([A-Za-z0-9._-]{3,})';
  const U = '([^:@\\s]+)';
  let host = null, port = 0, user = null, pass = null, m;
  const reEvomi = new RegExp(`^${H}:(\\d{1,5}):${U}:(.+)$`);
  const reUrl = new RegExp(`^${U}:(.*)@${H}:(\\d{1,5})$`);
  const reInverted = new RegExp(`^${H}:(\\d{1,5})@${U}:(.+)$`);
  const reHostPort = new RegExp(`^${H}:(\\d{1,5})$`);

  if ((m = s.match(reEvomi))) {
    host = m[1]; port = Number(m[2]); user = m[3]; pass = m[4];
  } else if ((m = s.match(reUrl))) {
    user = m[1]; pass = m[2]; host = m[3]; port = Number(m[4]);
  } else if ((m = s.match(reInverted))) {
    host = m[1]; port = Number(m[2]); user = m[3]; pass = m[4];
  } else if ((m = s.match(reHostPort))) {
    host = m[1]; port = Number(m[2]);
  } else {
    return null;
  }

  if (!(port > 0 && port <= 65535)) return null;
  const guessed = !scheme;
  if (!scheme) scheme = schemeForPort(port);
  return { scheme, host, port, user: user || null, pass: pass || null, schemeGuessed: guessed };
}

function agentFor(parsed) {
  const auth = parsed.user
    ? `${encodeURIComponent(parsed.user)}:${encodeURIComponent(parsed.pass || '')}@`
    : '';
  const url = `${parsed.scheme}://${auth}${parsed.host}:${parsed.port}`;
  if (parsed.scheme === 'http') {
    const { HttpProxyAgent } = require('http-proxy-agent');
    return new HttpProxyAgent(url);
  }
  if (parsed.scheme === 'https') {
    const { HttpsProxyAgent } = require('https-proxy-agent');
    return new HttpsProxyAgent(url);
  }
  const { SocksProxyAgent } = require('socks-proxy-agent');
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

module.exports = { parseProxy, throughProxy, byIp, normalize };
