const fs = require('fs');
const path = require('path');
const plistPrefs = require('./plist-prefs');
const { ehIphone, lerFusoDoIphone, argumentosDoScp, copiarComScp } = require('./iphone-comando');

const ESTADO_DO_AJUDANTE_NO_APARELHO = '/var/tmp/nova-locale-status.json';
const COMANDO_DO_AJUDANTE_NO_APARELHO = '/var/tmp/nova-locale.cmd';
const PREFERENCIAS_GLOBAIS_NO_APARELHO = '/var/mobile/Library/Preferences/.GlobalPreferences.plist';
const PREFERENCIAS_ENVIADAS_AO_APARELHO = '/var/tmp/nova-gp.plist';
const AJUDANTE_ESTA_INSTALADO = 'test -f /var/jb/Library/LaunchDaemons/com.aquiles.novalocale.plist && test -f /var/jb/usr/libexec/nova-locale.sh && echo ok';
const MILISSEGUNDOS_ENTRE_LEITURAS_DO_ESTADO = 1200;
const LIMITE_DA_ESPERA_AO_APLICAR_EM_MS = 25000;
const LIMITE_DA_ESPERA_AO_REVERTER_EM_MS = 20000;
const FUSO_PERMITIDO = /^[A-Za-z0-9_+\/-]+$/;

const falhaPorExcecao = (erro) => ({ success: false, error: String(erro.message || erro) });

async function lerEstadoDoAjudanteDeFuso(servico) {
  const resposta = await servico.iosSsh(`cat ${ESTADO_DO_AJUDANTE_NO_APARELHO} 2>/dev/null`);
  try {
    return JSON.parse(String(resposta.stdout || '').trim());
  } catch (erro) {
    return null;
  }
}

async function ajudanteDeFusoInstalado(servico) {
  const resposta = await servico.iosSsh(AJUDANTE_ESTA_INSTALADO);
  return !!(resposta.ok && /ok/.test(resposta.stdout));
}

async function montarPlistDeIdioma(servico, idioma, locale) {
  const local = path.join(servico.baseDir, 'nova-globalprefs.plist');
  await copiarComScp(argumentosDoScp(PREFERENCIAS_GLOBAIS_NO_APARELHO, local, 'from'));
  await plistPrefs.aplicarIdiomaLocale(local, idioma, locale);
  await copiarComScp(argumentosDoScp(PREFERENCIAS_ENVIADAS_AO_APARELHO, local, 'to'));
  return local;
}

async function lerIdiomaDoAparelho(servico) {
  const local = path.join(servico.baseDir, 'nova-globalprefs-check.plist');
  await copiarComScp(argumentosDoScp(PREFERENCIAS_GLOBAIS_NO_APARELHO, local, 'from'));
  return plistPrefs.lerPrimeiroIdioma(local);
}

async function enviarComandoAoAjudanteDeFuso(servico, campos) {
  await servico.iosSsh(`rm -f ${ESTADO_DO_AJUDANTE_NO_APARELHO}`);
  const local = path.join(servico.baseDir, 'nova-locale.cmd');
  fs.writeFileSync(local, Object.entries(campos).map(([campo, valor]) => `${campo}=${valor}`).join('\n') + '\n');
  await copiarComScp(argumentosDoScp(COMANDO_DO_AJUDANTE_NO_APARELHO, local, 'to'));
}

async function esperarEstadoDoAjudanteDeFuso(servico, limiteEmMs = LIMITE_DA_ESPERA_AO_APLICAR_EM_MS) {
  const inicio = Date.now();
  while (Date.now() - inicio < limiteEmMs) {
    await new Promise((resolve) => setTimeout(resolve, MILISSEGUNDOS_ENTRE_LEITURAS_DO_ESTADO));
    const estado = await lerEstadoDoAjudanteDeFuso(servico);
    if (estado && typeof estado.ok === 'boolean') return estado;
  }
  return null;
}

async function pedirFusoAoAjudante(servico, fuso) {
  const fusoAntes = await lerFusoDoIphone(servico);
  if (fusoAntes === fuso) return { success: true, timezone: fuso, message: 'fuso já estava certo' };
  await enviarComandoAoAjudanteDeFuso(servico, { action: 'apply', tz: fuso });
  const estado = await esperarEstadoDoAjudanteDeFuso(servico);
  const fusoAtual = await lerFusoDoIphone(servico);
  console.info(`[Locale] tz pedido=${fuso} aparelho=${fusoAtual} status=${estado && estado.message}`);
  if (fusoAtual === fuso) return { success: true, timezone: fusoAtual, message: 'fuso aplicado' };
  return { success: false, error: `fuso ${fusoAtual || '?'} ≠ ${fuso}`, timezone: fusoAtual };
}

async function aplicarFusoNoIphone(servico, idDoAparelho, fuso) {
  if (!ehIphone(idDoAparelho)) return { success: false, error: 'Só para iPhone.' };
  if (!(await ajudanteDeFusoInstalado(servico))) return { success: false, error: 'helper-not-installed', language: null };
  const permitido = fuso && FUSO_PERMITIDO.test(fuso) ? fuso : '';
  if (!permitido) return { success: false, error: 'sem fuso para aplicar' };
  try {
    return await pedirFusoAoAjudante(servico, permitido);
  } catch (erro) {
    return falhaPorExcecao(erro);
  }
}

function respostaDaReversao(estado) {
  if (estado && estado.ok) return { success: true, message: estado.message };
  return { success: false, error: (estado && estado.message) || 'helper não respondeu' };
}

async function reverterFusoDoIphone(servico, idDoAparelho) {
  if (!ehIphone(idDoAparelho)) return { success: true };
  if (!(await ajudanteDeFusoInstalado(servico))) return { success: false, error: 'helper-not-installed' };
  try {
    await enviarComandoAoAjudanteDeFuso(servico, { action: 'revert' });
    return respostaDaReversao(await esperarEstadoDoAjudanteDeFuso(servico, LIMITE_DA_ESPERA_AO_REVERTER_EM_MS));
  } catch (erro) {
    return falhaPorExcecao(erro);
  }
}

module.exports = {
  lerEstadoDoAjudanteDeFuso, ajudanteDeFusoInstalado, montarPlistDeIdioma, lerIdiomaDoAparelho, enviarComandoAoAjudanteDeFuso,
  esperarEstadoDoAjudanteDeFuso, aplicarFusoNoIphone, reverterFusoDoIphone,
};
