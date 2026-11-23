const assert=require('node:assert/strict');
const Module=require('node:module');
const cp=require('node:child_process');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
let install;
const mock={...cp,
 exec:(cmd,options,callback)=>{install=cmd;callback(null,'Success\n','');},
 execFile:(file,args,options,callback)=>{install={file,args};callback(null,'Success\n','');}
};
const load=Module._load;
Module._load=function(name,parent,main){if(name==='child_process')return mock;if(name==='ws'||name==='axios')return {};return load.call(this,name,parent,main);};
process.resourcesPath=fs.mkdtempSync(path.join(os.tmpdir(),'nova-recursos-'));
fs.writeFileSync(path.join(process.resourcesPath,'nova-cam-spoofer.apk'),'apk de teste');
const Service=require(process.argv[2]||path.join(__dirname,'..','..','..','app','electron','services','physicalMobileService.js'));
(async()=>{
 const service=Object.create(Service.prototype);service.resolveAdbPath=()=>process.execPath;
 const result=await service.installCamSpoofer('ANDROID-USB-TEST');
 assert.equal(result.success,true,result.error);
 const expected=path.join(process.resourcesPath,'nova-cam-spoofer.apk');
 if(typeof install==='string')assert.ok(install.includes(expected),install);else assert.ok(install.args.includes(expected));
 console.log('PASS: fluxo Android encontra o APK empacotado e encaminha a instalação para ADB');
})().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>fs.rmSync(process.resourcesPath,{recursive:true,force:true}));
