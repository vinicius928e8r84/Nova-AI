const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const original = Module._load;
let calls = [], fail = false;
Module._load = function(name, parent, main) {
 if (name === 'ws' || name === 'axios') return {};
 if (name === 'child_process') return {execFile(file,args,options,cb) {
  calls.push(args);
  if (fail) return cb(new Error('device not found'), '', 'device not found');
  cb(null, args.includes('ip') ? 'inet 192.168.1.22/24' : 'connected to 192.168.1.22:5555', '');
 }, exec(){throw new Error('Shell/ADB must not run for iPhone');}};
 return original.call(this, name, parent, main);
};
const Service = require(process.argv[2] || path.join(__dirname, '..', '..', '..', 'app', 'electron', 'services', 'physicalMobileService.js'));
const s = Object.create(Service.prototype);
s.resolveAdbPath = () => { calls.push('resolveAdb'); return process.execPath; };
(async()=>{
 const ios = await s.autoPairUsbToWireless('ios-test');
 assert.equal(ios.success, false);
 assert.equal(calls.length, 0, 'iPhone must never reach ADB');
 assert.match(ios.error, /Android/);
 const android = await s.autoPairUsbToWireless('android-test');
 assert.equal(android.success, true);
 assert.equal(android.deviceId, '192.168.1.22:5555');
 fail = true;
 const disconnected = await s.autoPairUsbToWireless('android-test');
 assert.equal(disconnected.success, false);
 assert.match(disconnected.error, /device not found/);
 console.log('PASS: iPhone bypasses ADB; Android Wi-Fi connects; disconnect returns a handled error');
})().catch(e=>{console.error(e);process.exitCode=1;});
