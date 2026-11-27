'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),Module=require('node:module');
const services=path.resolve(__dirname,'../../app/electron/services');
const originalLoad=Module._load;
Module._load=function(request,...rest){if(request==='ws')return{WebSocketServer:class{},WebSocket:class{}};if(request==='axios')return{};return originalLoad.call(this,request,...rest);};
test.after(()=>{Module._load=originalLoad;});
process.resourcesPath=path.join(require('node:os').tmpdir(),'nova-sem-ios-tools-'+process.pid);
const iosTools=require(path.join(services,'ios-tools.js'));
const Service=require(path.join(services,'physicalMobileService.js'));
test('ios-tools: tool lança, tryTool/has/available não lançam',()=>{
 assert.throws(()=>iosTools.tool('idevice_id'),/ausente/);
 assert.equal(iosTools.tryTool('idevice_id'),null);
 assert.equal(iosTools.has('iproxy'),false);
 assert.equal(iosTools.available(),false);
});
test('getIosDevices devolve [] sem ferramenta',async()=>{
 assert.deepEqual(await Service.prototype.getIosDevices.call({}),[]);
});
test('getStatus não rejeita e mantém a lista Android pelo getConnectedDevices real',async()=>{
 const fs=require('node:fs'),os=require('node:os');
 const windows=process.platform==='win32';
 const adb=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'adb-falso-')),windows?'adb.cmd':'adb');
 const roteiro=windows?'@echo off\r\necho List of devices attached\r\necho android1 device model:Pixel_7 device:panther\r\n':'#!/bin/sh\necho "List of devices attached"\necho "android1 device model:Pixel_7 device:panther"\n';
 fs.writeFileSync(adb,roteiro,{mode:0o755});
 const fake={adbPath:adb,scrcpyPath:'/x/scrcpy',runningStreams:new Map(),iosPrepared:()=>false};
 for(const nome of ['getConnectedDevices','getIosDevices'])fake[nome]=Service.prototype[nome];
 const st=await Service.prototype.getStatus.call(fake);
 assert.deepEqual(st.devices.map(d=>d.id),['android1']);
});
test('ios-bridge.start não sobe nada sem ferramenta',()=>{
 const bridge=require(path.join(services,'ios-bridge.js'));
 const r=bridge.start();assert.equal(r.ok,false);assert.equal(bridge.isRunning(),false);
});
test('com ferramentas presentes, tool/has/available seguem o caminho de sempre',()=>{
 const fs=require('node:fs'),os=require('node:os');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ios-ok-'));const bin=path.join(root,'ios-tools','bin');fs.mkdirSync(bin,{recursive:true});
 for(const n of ['iproxy','idevice_id','ideviceinfo']){fs.writeFileSync(path.join(bin,n),'#!/bin/sh\n',{mode:0o755});}
 const prev=process.resourcesPath;process.resourcesPath=root;
 try{assert.equal(iosTools.tool('iproxy'),path.join(bin,'iproxy'));assert.equal(iosTools.available(),true);}finally{process.resourcesPath=prev;}
});
