'use strict';
// ios-modelo.js — módulo puro (sem Electron/ws/axios) do spoofing de modelo do iPhone.
//
// Constrói os comandos do CLI `novamodel` (/var/jb/usr/bin/novamodel) e interpreta o
// JSON de status. O SSH é injetado como função (sshFn) para poder ser mockado nos
// testes — o serviço físico passa `this.iosSsh` (túnel USB 2222 → mobile@127.0.0.1).
//
// Contrato (fonte da verdade: NOVA-AI-MODELO-SPOOF-SPEC.md):
//   novamodel set <productType>   → aplica o modelo
//   novamodel clear               → restaura o real
//   novamodel status              → imprime JSON { real, active, enabled }

const NOVAMODEL = '/var/jb/usr/bin/novamodel';
// productType aceita letras/dígitos/vírgula (ex.: iPhone14,5). Nada de shell injection.
const PRODUCT_TYPE_RE = /^[A-Za-z0-9][A-Za-z0-9,]*$/;

function buildSet(productType) {
  return `${NOVAMODEL} set ${productType}`;
}

function buildClear() {
  return `${NOVAMODEL} clear`;
}

function buildStatus() {
  return `${NOVAMODEL} status`;
}

function isValidProductType(productType) {
  return typeof productType === 'string' && PRODUCT_TYPE_RE.test(productType);
}

// Interpreta o JSON de `novamodel status` → { real, active, enabled }.
function parseStatus(stdout) {
  const raw = String(stdout || '').trim();
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    return { real: obj.real || null, active: obj.active || null, enabled: !!obj.enabled };
  } catch (_) {
    return null;
  }
}

// Procura um modelo no banco (array de { productType, name }).
function findModel(models, productType) {
  return (models || []).find((m) => m.productType === productType) || null;
}

// Fluxos completos; sshFn(cmd) → { ok, stdout, error } (mesmo formato de iosSsh).
async function applyModel(sshFn, productType) {
  if (!isValidProductType(productType)) {
    return { success: false, error: 'productType inválido.' };
  }
  const r = await sshFn(buildSet(productType));
  if (!r.ok) return { success: false, error: r.error || 'Falha ao aplicar o modelo.' };
  return { success: true, productType };
}

async function clearModel(sshFn) {
  const r = await sshFn(buildClear());
  if (!r.ok) return { success: false, error: r.error || 'Falha ao limpar o modelo.' };
  return { success: true };
}

async function getModel(sshFn) {
  const r = await sshFn(buildStatus());
  if (!r.ok) return { success: false, error: r.error || 'Falha ao ler o status.' };
  const status = parseStatus(r.stdout);
  if (!status) return { success: false, error: 'Status inválido do novamodel.', raw: r.stdout };
  return Object.assign({ success: true }, status);
}

module.exports = {
  NOVAMODEL,
  buildSet,
  buildClear,
  buildStatus,
  isValidProductType,
  parseStatus,
  findModel,
  applyModel,
  clearModel,
  getModel
};
