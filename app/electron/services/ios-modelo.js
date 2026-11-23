'use strict';
//
//

const NOVAMODEL = '/var/jb/usr/bin/novamodel';
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

function findModel(models, productType) {
  return (models || []).find((m) => m.productType === productType) || null;
}

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
