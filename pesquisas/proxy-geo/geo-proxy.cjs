#!/usr/bin/env node
/**
 * geo-proxy.cjs — descobre a localização (lat/lon/cidade/fuso) do IP de saída
 * de um proxy SOCKS5, consultando o ipwho.is *através do proxy*.
 *
 * Uso:
 *   node geo-proxy.cjs                                  # sem proxy (IP da máquina)
 *   node geo-proxy.cjs "socks5://host:porta"            # proxy sem autenticação
 *   node geo-proxy.cjs "socks5://host:porta:user:pass"  # formato do Nova
 *   node geo-proxy.cjs "socks5://user:pass@host:porta"  # formato URL padrão
 *
 * Saída: uma linha JSON com ip, city, region, country, lat, lon, timezone.
 */
'use strict';

const https = require('https');
const path = require('path');

const APP_MODULES = '/Applications/Nova AI Mac.app/Contents/Resources/app/node_modules';

function loadAgent() {
  for (const base of [APP_MODULES, path.resolve(__dirname, '../../node_modules')]) {
    try {
      return require(path.join(base, 'socks-proxy-agent')).SocksProxyAgent;
    } catch {}
  }
  throw new Error('socks-proxy-agent não encontrado (instale com npm i socks-proxy-agent).');
}

/**
 * Aceita os dois formatos usados no Nova e no resto do mundo.
 * sock five?://host:porta:user:pass  |  socks5://user:pass@host:porta  |  host:porta
 */
function toAgentUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (s.includes('@')) return s.replace(/^socks5h?:\/\//i, 'socks5://');

  const m = s.match(/^(?:socks5h?:\/\/)?([^:/\s]+):(\d+)(?::([^:\s]+):([^:\s]+))?$/i);
  if (!m) throw new Error('Formato de proxy não reconhecido: use socks5://host:porta:usuario:senha');
  const [, host, port, user, pass] = m;
  const auth = user ? `${encodeURIComponent(user)}:${encodeURIComponent(pass)}@` : '';
  return `socks5://${auth}${host}:${port}`;
}

function getJson(url, agent, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { agent, timeout: timeoutMs, headers: { 'User-Agent': 'nova-geo/1.0' } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(`resposta não-JSON (HTTP ${res.statusCode}): ${body.slice(0, 120)}`));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout ao consultar o ipwho.is')));
    req.on('error', reject);
  });
}

async function main() {
  const raw = process.argv[2] || process.env.NOVA_PROXY || '';
  const agentUrl = toAgentUrl(raw);
  let agent;
  if (agentUrl) {
    const SocksProxyAgent = loadAgent();
    agent = new SocksProxyAgent(agentUrl);
  }

  const data = await getJson('https://ipwho.is/', agent);
  if (!data || data.success === false) {
    throw new Error(`ipwho.is falhou: ${(data && data.message) || 'sem detalhes'}`);
  }

  const out = {
    via: agentUrl ? 'proxy' : 'direto',
    ip: data.ip,
    city: data.city,
    region: data.region,
    country: data.country,
    country_code: data.country_code,
    lat: data.latitude,
    lon: data.longitude,
    timezone: (data.timezone && data.timezone.id) || null,
    utc_offset: (data.timezone && data.timezone.utc) || null
  };
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error('ERRO:', e.message);
  process.exit(1);
});
