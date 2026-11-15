'use strict';
// Teste do spoofing de modelo do iPhone (novamodel), com mock do SSH.
//
// Roda sem o app instalado: stub dos módulos `ws`, `axios` e `./mac-native` (não usados
// pelos métodos de modelo) para conseguir carregar physicalMobileService, e `iosSsh`
// substituído por um mock. Valida também o módulo puro ios-modelo.js (comandos + parse).
//
//   node MAC/integracao-modelo-app/novamodel.test.cjs

const assert = require('assert');
const path = require('path');
const os = require('os');
const Module = require('module');

// Stubs de dependências pesadas/ausentes fora do app (não exercitadas aqui).
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'ws') return function WebSocket() {};
  if (request === 'axios') return { get: async () => { throw new Error('axios não usado no teste'); } };
  if (request === './mac-native') return { tool: () => null };
  return origLoad.apply(this, arguments);
};

process.env.NOVA_SMOKE_TEST = '1';

const iosModelo = require('../integracao-iphone/ios-modelo');
const PhysicalMobileService = require('../integracao-iphone/physicalMobileService.patched');

let passed = 0;
function ok(cond, label) {
  assert.ok(cond, label);
  passed += 1;
  console.log('  ✓', label);
}

async function main() {
  // ── 1. módulo puro: comandos e validação ──────────────────────
  console.log('ios-modelo (puro)');
  ok(iosModelo.buildSet('iPhone14,5') === '/var/jb/usr/bin/novamodel set iPhone14,5', 'buildSet');
  ok(iosModelo.buildClear() === '/var/jb/usr/bin/novamodel clear', 'buildClear');
  ok(iosModelo.buildStatus() === '/var/jb/usr/bin/novamodel status', 'buildStatus');
  ok(iosModelo.isValidProductType('iPhone14,5'), 'productType válido');
  ok(!iosModelo.isValidProductType('iPhone14,5; rm -rf /'), 'productType com shell é rejeitado');
  ok(!iosModelo.isValidProductType(''), 'productType vazio é rejeitado');

  const st = iosModelo.parseStatus('{"real":"iPhone10,2","active":"iPhone14,5","enabled":true}');
  ok(st && st.real === 'iPhone10,2' && st.active === 'iPhone14,5' && st.enabled === true, 'parseStatus JSON');
  ok(iosModelo.parseStatus('') === null, 'parseStatus vazio → null');
  ok(iosModelo.parseStatus('não é json') === null, 'parseStatus inválido → null');

  const models = JSON.parse(require('fs').readFileSync(path.join(__dirname, '..', 'integracao-iphone', 'iosModels.json'), 'utf8')).models;
  ok(iosModelo.findModel(models, 'iPhone14,5') !== null, 'findModel encontra iPhone 13');
  ok(iosModelo.findModel(models, 'Nope9,9') === null, 'findModel rejeita desconhecido');

  // ── 2. fluxos do módulo com mock de SSH ───────────────────────
  console.log('ios-modelo (fluxos com mock sshFn)');
  const callsPuro = [];
  const sshFn = async (cmd) => {
    callsPuro.push(cmd);
    if (cmd.includes(' status')) return { ok: true, stdout: '{"real":"iPhone10,2","active":"iPhone14,5","enabled":true}' };
    return { ok: true, stdout: '' };
  };

  const rApply = await iosModelo.applyModel(sshFn, 'iPhone14,5');
  ok(rApply.success && rApply.productType === 'iPhone14,5', 'applyModel aplica');
  ok(callsPuro[0] === '/var/jb/usr/bin/novamodel set iPhone14,5', 'comando set correto');

  const rClear = await iosModelo.clearModel(sshFn);
  ok(rClear.success, 'clearModel limpa');
  ok(callsPuro[1] === '/var/jb/usr/bin/novamodel clear', 'comando clear correto');

  const rGet = await iosModelo.getModel(sshFn);
  ok(rGet.success && rGet.active === 'iPhone14,5' && rGet.real === 'iPhone10,2', 'getModel parseia status');
  ok(callsPuro[2] === '/var/jb/usr/bin/novamodel status', 'comando status correto');

  const rBad = await iosModelo.applyModel(sshFn, 'iPhone14,5; rm -rf /');
  ok(!rBad.success, 'applyModel rejeita productType malicioso');

  // ── 3. métodos do serviço (mock de iosSsh) ────────────────────
  console.log('physicalMobileService (applyIOSModel/clearIOSModel/getIOSModel)');
  const svc = new PhysicalMobileService(null, { getPath: () => os.tmpdir() });

  const calls = [];
  svc.iosSsh = async (cmd) => {
    calls.push(cmd);
    if (cmd.includes(' status')) return { ok: true, stdout: '{"real":"iPhone10,2","active":"iPhone15,4","enabled":true}' };
    if (cmd.includes(' clear')) return { ok: true, stdout: '' };
    return { ok: true, stdout: '' };
  };

  const rList = svc.getIosModels();
  ok(rList.success && Array.isArray(rList.models) && rList.models.length >= 13, 'getIosModels carrega o banco');
  ok(rList.models.some((m) => m.productType === 'iPhone14,5'), 'banco contém iPhone 13');

  const rApplySvc = await svc.applyIOSModel('ios-00008120-ABCD', 'iPhone15,4');
  ok(rApplySvc.success && rApplySvc.applied && rApplySvc.applied.productType === 'iPhone15,4' && rApplySvc.applied.name === 'iPhone 15', 'applyIOSModel aplica no iPhone (applied.name)');
  ok(calls[0] === '/var/jb/usr/bin/novamodel set iPhone15,4', 'applyIOSModel usa iosSsh com set');

  const rApplyAndroid = await svc.applyIOSModel('android-123', 'iPhone15,4');
  ok(!rApplyAndroid.success, 'applyIOSModel recusa Android');

  const rApplyDesconhecido = await svc.applyIOSModel('ios-00008120-ABCD', 'Nope9,9');
  ok(!rApplyDesconhecido.success, 'applyIOSModel recusa modelo fora do banco');

  const rClearSvc = await svc.clearIOSModel('ios-00008120-ABCD');
  ok(rClearSvc.success, 'clearIOSModel limpa');
  ok(calls[1] === '/var/jb/usr/bin/novamodel clear', 'clearIOSModel usa iosSsh com clear');

  const rGetSvc = await svc.getIOSModel('ios-00008120-ABCD');
  ok(rGetSvc.success && rGetSvc.active === 'iPhone15,4', 'getIOSModel devolve status ativo');
  ok(calls[2] === '/var/jb/usr/bin/novamodel status', 'getIOSModel usa iosSsh com status');

  // ── 4. falha de SSH vira erro claro ───────────────────────────
  console.log('physicalMobileService (falha de SSH)');
  const svc2 = new PhysicalMobileService(null, { getPath: () => os.tmpdir() });
  svc2.iosSsh = async () => ({ ok: false, stdout: '', error: 'command not found' });

  const rApplyFalha = await svc2.applyIOSModel('ios-00008120-ABCD', 'iPhone14,5');
  ok(!rApplyFalha.success, 'applyIOSModel propaga falha do SSH');

  const rGetFalha = await svc2.getIOSModel('ios-00008120-ABCD');
  ok(!rGetFalha.success && rGetFalha.error, 'getIOSModel propaga falha com erro');

  console.log(`\n${passed} verificações passaram.`);
}

main().catch((e) => {
  console.error('\nFALHOU:', e && e.message ? e.message : e);
  process.exitCode = 1;
});
