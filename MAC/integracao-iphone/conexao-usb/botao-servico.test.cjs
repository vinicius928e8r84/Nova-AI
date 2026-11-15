const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// O getStatus marca o iPhone preparado como "streaming" para o cartão trocar de botão.
process.env.NOVA_SMOKE_TEST = '1';
const APP = process.env.NOVA_APP || '/Applications/Nova AI Mac.app/Contents/Resources/app';
const PhysicalMobileService = require(path.join(APP, 'electron/services/physicalMobileService.js'));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-pins-'));
const service = new PhysicalMobileService(null, { getPath: () => dir });
service.ensureTools = () => {};
service.getConnectedDevices = async () => ([
  { id: 'ios-47F4FC34C3ACF770EB4E3561CAD85FCARDCAC298', status: 'device', name: 'iPhone 8 Plus (iOS 16.7.16)', type: 'usb', ios: true },
  { id: 'R58M123ABC', status: 'device', name: 'SM G998B', type: 'usb' },
]);
const IOS_ID = 'ios-47F4FC34C3ACF770EB4E3561CAD85FCARDCAC298';
const UDID = IOS_ID.slice(4);

(async () => {
  // Sem pin salvo: iPhone ainda mostra "Conectar" (streaming falso).
  let status = await service.getStatus();
  assert.equal(status.devices.find((d) => d.id === IOS_ID).streaming, false);

  // Depois do Conectar (pin gravado), o iPhone vira "Abrir controle"; Android não muda.
  const pinsFile = path.join(dir, 'physical_mobile', 'iphone-hosts.json');
  fs.mkdirSync(path.dirname(pinsFile), { recursive: true });
  fs.writeFileSync(pinsFile, JSON.stringify({ [UDID]: 'f'.repeat(64) }));
  status = await service.getStatus();
  assert.equal(status.devices.find((d) => d.id === IOS_ID).streaming, true);
  assert.equal(status.devices.find((d) => d.id === 'R58M123ABC').streaming, false);
  assert.equal(service.iosPrepared(UDID), true);
  assert.equal(service.iosPrepared('outro-udid'), false);

  // Arquivo corrompido não pode derrubar o painel.
  fs.writeFileSync(pinsFile, '{quebrado');
  assert.equal(service.iosPrepared(UDID), false);

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('OK: iPhone preparado aparece como streaming (cartão "Abrir controle"); Android e estado sem pin continuam iguais.');
})().catch((error) => { console.error(error); process.exit(1); });
