const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const original = Module._load;
Module._load = function(name, parent, main) {
 if (name === 'ws' || name === 'axios') return {};
 return original.call(this, name, parent, main);
};
const Service = require(process.argv[2] || path.join(__dirname, '..', '..', 'app', 'electron', 'services', 'physicalMobileService.js'));
const s = Object.create(Service.prototype);
let adbCalls = 0;
s.resolveAdbPath = () => { adbCalls++; return '/missing-adb'; };
s.iosCamera = () => ({status:async()=>({installed:false,platform:'ios',error:'iPhone desconectado'}),install:async()=>({success:false,platform:'ios',error:'iPhone desconectado'})});
(async()=>{
 const result = await s.installCamSpoofer('ios-test');
 assert.equal(result.platform, 'ios', 'iPhone deve usar a integração iOS, nunca procurar um APK');
 assert.equal(adbCalls, 0, 'Nenhuma chamada ADB para iPhone');
 assert.equal((await s.getCamSpoofStatus('ios-test')).platform,'ios');
 console.log('PASS: CAM HIJACK iPhone não usa APK/ADB');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
