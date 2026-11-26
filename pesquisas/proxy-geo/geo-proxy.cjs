#!/usr/bin/env node
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

function agenteDoProxy(agentUrl) {
  if (!agentUrl) return undefined;
  const SocksProxyAgent = loadAgent();
  return new SocksProxyAgent(agentUrl);
}

function conferirResposta(data) {
  if (!data || data.success === false) {
    throw new Error(`ipwho.is falhou: ${data?.message || 'sem detalhes'}`);
  }
}

function localizacao(data, agentUrl) {
  return {
    via: agentUrl ? 'proxy' : 'direto',
    ip: data.ip,
    city: data.city,
    region: data.region,
    country: data.country,
    country_code: data.country_code,
    lat: data.latitude,
    lon: data.longitude,
    timezone: data.timezone?.id || null,
    utc_offset: data.timezone?.utc || null
  };
}

async function main() {
  const agentUrl = toAgentUrl(process.argv[2] || process.env.NOVA_PROXY || '');
  const data = await getJson('https://ipwho.is/', agenteDoProxy(agentUrl));
  conferirResposta(data);
  const out = localizacao(data, agentUrl);
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error('ERRO:', e.message);
  process.exit(1);
});
