'use strict';
const https = require('https');

const GEO_BASE = 'https://ipwho.is';
const UA = 'nova-geo/1.0';

const ESQUEMAS = ['socks5', 'socks5h', 'socks4', 'socks4a', 'http', 'https'];
const PORTAS_HTTP = [1000, 3128, 8000, 8080, 8888];
const PORTA_HTTPS = 1001;
const MAIOR_PORTA = 65535;

const ENTRE_ASPAS = /^["'`][\s\S]*["'`]$/;
const BARRAS_FINAIS = /\/+$/;
const ESQUEMA_URL = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/(.*)$/;

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

function limparColagem(raw) {
  const texto = String(raw || '').trim();
  const semAspas = ENTRE_ASPAS.test(texto) ? texto.slice(1, -1).trim() : texto;
  return semAspas.replace(BARRAS_FINAIS, '');
}

function separarEsquema(texto) {
  const comEsquema = texto.match(ESQUEMA_URL);
  if (!comEsquema) return { scheme: null, endereco: texto };
  return { scheme: comEsquema[1].toLowerCase(), endereco: comEsquema[2] };
}

function esquemaRecusado(scheme) {
  return scheme !== null && !ESQUEMAS.includes(scheme);
}

function portaValida(port) {
  return port > 0 && port <= MAIOR_PORTA;
}

function casarFormato(endereco) {
  for (const formato of FORMATOS) {
    const m = endereco.match(formato.re);
    if (m) return { formato, campos: Object.fromEntries(formato.ordem.map((nome, i) => [nome, m[i + 1]])) };
  }
  return null;
}

function credencial(valor, decodifica) {
  if (!valor) return null;
  return decodifica ? decodificarSeguro(valor) : valor;
}

function montarProxy(scheme, { formato, campos }) {
  const port = Number(campos.port);
  if (!portaValida(port)) return null;
  return {
    scheme: scheme || esquemaPelaPorta(port),
    host: campos.host,
    port,
    user: credencial(campos.user, formato.decodifica),
    pass: credencial(campos.pass, formato.decodifica),
    schemeGuessed: !scheme
  };
}

function parseProxy(raw) {
  const colado = limparColagem(raw);
  if (!colado) return null;
  const { scheme, endereco } = separarEsquema(colado);
  if (esquemaRecusado(scheme)) return null;
  const casado = casarFormato(endereco);
  return casado ? montarProxy(scheme, casado) : null;
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

const textoOuNulo = (valor) => valor || null;
const campoDoObjeto = (objeto, campo) => textoOuNulo(objeto && objeto[campo]);
const consultaFalhou = (data) => !data || data.success === false;
const mensagemDaFalha = (data) => (data && data.message) || 'geolocalização falhou';

function normalize(data) {
  if (consultaFalhou(data)) throw new Error(mensagemDaFalha(data));
  return {
    ip: textoOuNulo(data.ip),
    city: textoOuNulo(data.city),
    region: textoOuNulo(data.region),
    country: textoOuNulo(data.country),
    countryCode: textoOuNulo(data.country_code),
    lat: data.latitude,
    lon: data.longitude,
    timezone: campoDoObjeto(data.timezone, 'id'),
    isp: campoDoObjeto(data.connection, 'isp')
  };
}

async function throughProxy(proxy) {
  const parsed = parseProxy(proxy);
  if (!parsed) throw new Error('Proxy inválido: não achei host e porta na string');
  const data = await getJson(`${GEO_BASE}/`, agentFor(parsed));
  return normalize(data);
}

async function byIp(ip) {
  const clean = String(ip || '').trim();
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(clean) && !/^[0-9a-f:]+$/i.test(clean)) {
    throw new Error(`IP inválido: ${clean || '(vazio)'}`);
  }
  const data = await getJson(`${GEO_BASE}/${encodeURIComponent(clean)}`);
  return normalize(data);
}

module.exports = { parseProxy, agentFor, throughProxy, byIp, normalize };
