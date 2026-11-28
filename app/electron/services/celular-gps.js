'use strict';
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const AVISO_SEM_PROXY = 'Sem proxy configurado. Salve a proxy primeiro.';
const AVISO_SEM_IMAGEM_DE_DESENVOLVEDOR = 'O iPhone precisa da imagem de desenvolvedor montada. Instale pymobiledevice3 (pip install pymobiledevice3) e tente de novo.';
const AVISO_SEM_FERRAMENTA = 'idevicesetlocation não encontrado neste computador.';
const AVISO_DE_FALHA_NO_IPHONE = 'Falha ao aplicar a localização no iPhone.';
const NOTA_DA_IMAGEM_QUE_SAIU = 'GPS simulado removido junto com a imagem de desenvolvedor.';
const ENDERECO_IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const IMAGEM_DE_DESENVOLVEDOR_AUSENTE = /developer disk image|invalid service/i;
const PREFIXO_DO_IPHONE = /^ios-/;
const VOLTAS_DA_ESPERA_DO_FUSO = 4;
const PAUSA_DA_ESPERA_DO_FUSO_MS = 2000;
const TEMPO_DA_MONTAGEM_MS = 180000;
const TEMPO_DE_APLICAR_MS = 30000;
const TEMPO_DE_RESETAR_MS = 20000;
const LIMITE_DO_ERRO_NO_LOG = 160;
const LIMITE_DO_ERRO_NA_RESPOSTA = 300;
const PROVEDORES_DE_LOCAL_DE_TESTE = ['gps', 'network', 'fused'];
const MATAR_O_LACO = 'pkill -f nova_gps_loop 2>/dev/null; true';
const LACO_NO_APARELHO = '/data/local/tmp/nova_gps_loop.sh';
const COORDENADAS_NO_APARELHO = '/data/local/tmp/nova_spoof.json';
const HORA_NO_APARELHO = '$(date +%s%3N)';

const ehIphone = (deviceId) => String(deviceId || '').startsWith('ios-');
const udidDoIphone = (deviceId) => String(deviceId || '').replace(PREFIXO_DO_IPHONE, '');
const falhaDaConsulta = (erro) => ({ success: false, error: String(erro.message || erro) });
const pausar = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

async function ipDeSaidaDoIphone(servico, deviceId) {
  if (!ehIphone(deviceId)) return null;
  try {
    const resposta = await servico.iosProxyCheck(deviceId);
    const bruto = resposta && resposta.success ? String(resposta.ip || '').trim() : '';
    return ENDERECO_IPV4.test(bruto) ? bruto : null;
  } catch (_) {
    return null;
  }
}

async function localizarPeloIp(geo, ip) {
  try {
    const g = await geo.byIp(ip);
    console.info(`[Geo] via aparelho: ${g.ip} ${g.city}/${g.countryCode} ${g.lat},${g.lon}`);
    return { success: true, via: 'aparelho', ...g };
  } catch (e) {
    return falhaDaConsulta(e);
  }
}

async function localizarPelaProxySalva(geo, proxy) {
  if (!proxy) {
    console.info('[Geo] sem IP de saída e sem proxy salvo');
    return { success: false, error: AVISO_SEM_PROXY };
  }
  try {
    const g = await geo.throughProxy(proxy);
    console.info(`[Geo] via proxy: ${g.ip} ${g.city}/${g.countryCode} ${g.lat},${g.lon}`);
    return { success: true, via: 'proxy', ...g };
  } catch (e) {
    return falhaDaConsulta(e);
  }
}

async function localizarPelaSaidaDoProxy(servico, deviceId, proxy) {
  const geo = require('./geo-proxy');
  const proxySalva = String(proxy || '').trim();
  const ip = await ipDeSaidaDoIphone(servico, deviceId);
  return ip ? localizarPeloIp(geo, ip) : localizarPelaProxySalva(geo, proxySalva);
}

function montarImagemDeDesenvolvedor(servico, udid) {
  return new Promise((resolver) => {
    const bin = servico.pymobiledevice3Path();
    if (!bin) return resolver(false);
    execFile(bin, ['mounter', 'auto-mount', '--udid', udid], { timeout: TEMPO_DA_MONTAGEM_MS, windowsHide: true }, (err) => resolver(!err));
  });
}

function textoDoErroDoIdevicesetlocation(err, stdout, stderr) {
  const saida = [String(stderr || '').trim(), String(stdout || '').trim()].filter(Boolean).join('\n');
  return saida || (err && err.message) || '';
}

function rodarIdevicesetlocation(servico, udid, args, timeout = TEMPO_DE_APLICAR_MS) {
  return new Promise((resolver) => {
    const bin = servico.idevicesetlocationPath();
    if (!bin) return resolver({ ok: false, err: AVISO_SEM_FERRAMENTA });
    execFile(bin, ['--udid', udid, ...args], { timeout, windowsHide: true }, (err, stdout, stderr) => {
      resolver({ ok: !err, out: String(stdout || ''), err: textoDoErroDoIdevicesetlocation(err, stdout, stderr) });
    });
  });
}

async function esperarOFusoMudar(servico, fusoAntes) {
  let fuso = fusoAntes;
  for (let volta = 0; volta < VOLTAS_DA_ESPERA_DO_FUSO; volta++) {
    await pausar(PAUSA_DA_ESPERA_DO_FUSO_MS);
    const lido = await servico.iosDeviceTimeZone();
    if (!lido) continue;
    fuso = lido;
    if (lido !== fusoAntes) break;
  }
  return fuso;
}

async function aplicarGpsNoIphone(servico, deviceId, latitude, longitude) {
  const udid = udidDoIphone(deviceId);
  const fusoAntes = await servico.iosDeviceTimeZone();
  if (!(await servico.mountDeveloperImage(udid))) return { success: false, error: AVISO_SEM_IMAGEM_DE_DESENVOLVEDOR };
  const r = await servico.runIdevicesetlocation(udid, ['--', String(latitude), String(longitude)]);
  if (!r.ok) {
    console.info(`[Geo] iPhone falhou: ${(r.err || '').slice(0, LIMITE_DO_ERRO_NO_LOG)}`);
    return { success: false, error: (r.err || AVISO_DE_FALHA_NO_IPHONE).slice(0, LIMITE_DO_ERRO_NA_RESPOSTA) };
  }
  const timezone = await esperarOFusoMudar(servico, fusoAntes);
  console.info(`[Geo] iPhone GPS aplicado: ${latitude}, ${longitude} (fuso ${timezone || '?'})`);
  return { success: true, latitude, longitude, timezone, timezoneBefore: fusoAntes };
}

async function removerGpsDoIphone(servico, deviceId) {
  const r = await servico.runIdevicesetlocation(udidDoIphone(deviceId), ['reset'], TEMPO_DE_RESETAR_MS);
  if (!r.ok && IMAGEM_DE_DESENVOLVEDOR_AUSENTE.test(r.err)) return { success: true, note: NOTA_DA_IMAGEM_QUE_SAIU };
  if (!r.ok) return { success: false, error: (r.err || '').slice(0, LIMITE_DO_ERRO_NA_RESPOSTA) };
  return { success: true };
}

function scriptDoLacoDeGps(latitude, longitude) {
  return `#!/system/bin/sh
# Nova GPS Spoof Loop — nova_gps_loop
LAT="${latitude}"
LNG="${longitude}"
while true; do
  # Inject via platform cmd (Android 8+ / rooted)
  cmd location set-test-provider-enabled gps true 2>/dev/null
  cmd location set-test-provider-location gps --lat $LAT --lng $LNG --accuracy 3.0 --altitude 50 --speed 0.0 --bearing 0.0 --time ${HORA_NO_APARELHO} 2>/dev/null
  cmd location set-test-provider-enabled network true 2>/dev/null
  cmd location set-test-provider-location network --lat $LAT --lng $LNG --accuracy 20.0 --altitude 50 --speed 0.0 --bearing 0.0 --time ${HORA_NO_APARELHO} 2>/dev/null
  cmd location set-test-provider-enabled fused true 2>/dev/null
  cmd location set-test-provider-location fused --lat $LAT --lng $LNG --accuracy 1.0 --altitude 50 --speed 0.0 --bearing 0.0 --time ${HORA_NO_APARELHO} 2>/dev/null
  sleep 2
done
`;
}

async function ligarLocalSimuladoNoAndroid(servico, deviceId) {
  await servico.adbRootExec(deviceId, MATAR_O_LACO);
  await pausar(300);
  await servico.adbRootExec(deviceId, 'settings put secure mock_location 1');
  await servico.adbRootExec(deviceId, 'settings put global development_settings_enabled 1');
}

async function enviarLacoDeGps(servico, deviceId, latitude, longitude) {
  const caminho = path.join(servico.baseDir, 'nova_gps_loop.sh');
  fs.writeFileSync(caminho, scriptDoLacoDeGps(latitude, longitude).replace(/\r\n/g, '\n'));
  await servico.adbPush(deviceId, caminho, LACO_NO_APARELHO);
  await servico.adbRootExec(deviceId, `chmod +x ${LACO_NO_APARELHO}`);
  await servico.adbRootExec(deviceId, `nohup sh ${LACO_NO_APARELHO} >/data/local/tmp/nova_gps.log 2>&1 &`);
}

function lerCoordenadasGravadas(caminho) {
  try {
    return JSON.parse(fs.readFileSync(caminho, 'utf8'));
  } catch (_) {
    return {};
  }
}

async function enviarCoordenadas(servico, deviceId, latitude, longitude) {
  const caminho = path.join(servico.baseDir, 'nova_spoof.json');
  const cfg = lerCoordenadasGravadas(caminho);
  cfg.latitude = latitude; cfg.longitude = longitude; cfg.altitude = 50.0;
  fs.writeFileSync(caminho, JSON.stringify(cfg, null, 2));
  await servico.adbPush(deviceId, caminho, COORDENADAS_NO_APARELHO);
}

async function aplicarGpsNoAndroid(servico, deviceId, latitude, longitude) {
  try {
    console.info(`[Spoofer] Setting persistent fake GPS: ${latitude}, ${longitude}`);
    await ligarLocalSimuladoNoAndroid(servico, deviceId);
    await enviarLacoDeGps(servico, deviceId, latitude, longitude);
    await enviarCoordenadas(servico, deviceId, latitude, longitude);
    console.info(`[Spoofer] ✅ GPS loop started: ${latitude}, ${longitude}`);
    return { success: true, latitude, longitude };
  } catch (err) {
    console.error('[Spoofer] GPS error:', err);
    return { success: false, error: err.message };
  }
}

async function definirLocalizacaoFalsa(servico, deviceId, latitude, longitude) {
  if (ehIphone(deviceId)) return servico.iosSetLocation(deviceId, latitude, longitude);
  return aplicarGpsNoAndroid(servico, deviceId, latitude, longitude);
}

async function pararLocalizacaoFalsa(servico, deviceId) {
  if (ehIphone(deviceId)) return servico.iosStopLocation(deviceId);
  await servico.adbRootExec(deviceId, MATAR_O_LACO);
  for (const provedor of PROVEDORES_DE_LOCAL_DE_TESTE) {
    await servico.adbRootExec(deviceId, `cmd location set-test-provider-enabled ${provedor} false 2>/dev/null; true`);
  }
  return { success: true };
}

module.exports = {
  localizarPelaSaidaDoProxy, montarImagemDeDesenvolvedor, rodarIdevicesetlocation, aplicarGpsNoIphone, removerGpsDoIphone,
  definirLocalizacaoFalsa, pararLocalizacaoFalsa,
};
