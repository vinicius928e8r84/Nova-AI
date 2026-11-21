'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const raiz=path.resolve(__dirname,'../../..');
const arquivos=[
 'app/electron/services/ios-camera.js',
 'app/electron/services/cam-live-iphone.js',
 'app/electron/services/ios-bridge.js',
 'app/electron/services/idioma-ipc.js',
 'app/electron/services/physicalMobileService.js',
 'MAC/integracao-iphone/ios-camera.js',
 'MAC/integracao-camlive/cam-live-iphone.js',
];
for(const rel of arquivos){
 test('ssh do iPhone usa accept-new com BatchMode e ConnectTimeout: '+rel,()=>{
  const texto=fs.readFileSync(path.join(raiz,rel),'utf8');
  const opcoes=[...texto.matchAll(/'(StrictHostKeyChecking|BatchMode|ConnectTimeout)=([^']+)'/g)].map(m=>m[1]+'='+m[2]);
  assert.ok(opcoes.includes('StrictHostKeyChecking=accept-new'),'falta accept-new');
  assert.ok(!opcoes.includes('StrictHostKeyChecking=yes'),'ainda tem =yes');
  assert.ok(opcoes.includes('BatchMode=yes'));
  assert.ok(opcoes.some(o=>/^ConnectTimeout=\d+$/.test(o)));
 });
}
