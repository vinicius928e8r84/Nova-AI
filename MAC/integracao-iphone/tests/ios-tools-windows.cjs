'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),os=require('node:os'),{spawnSync}=require('node:child_process');
const raiz=path.resolve(__dirname,'../../..');
const iosTools=require(path.join(raiz,'app/electron/services/ios-tools.js'));
test('dicaUsbmuxd só responde no Windows e com erro de usbmuxd',()=>{
 const erro='ERROR: Unable to retrieve device list!';
 assert.match(iosTools.dicaUsbmuxd(erro,'win32'),/Apple Devices/);
 assert.match(iosTools.dicaUsbmuxd('Could not connect to usbmuxd','win32'),/iTunes/);
 assert.equal(iosTools.dicaUsbmuxd(erro,'darwin'),null);
 assert.equal(iosTools.dicaUsbmuxd('outro erro','win32'),null);
 assert.equal(iosTools.dicaUsbmuxd(undefined,'win32'),null);
});
test('ios-devices.listar avisa e devolve [] quando idevice_id falha por usbmuxd',async()=>{
 const caminho=path.join(raiz,'app/electron/services/ios-devices.js');
 const cp=require('node:child_process'),original=cp.execFile,avisos=[];
 const aviso=console.warn;console.warn=(m)=>avisos.push(m);
 const toolsId=require.resolve(path.join(raiz,'app/electron/services/ios-tools.js'));
 const anterior=require.cache[toolsId].exports;
 require.cache[toolsId].exports={...anterior,tool:()=>'idevice_id',dicaUsbmuxd:(e)=>anterior.dicaUsbmuxd(e,'win32')};
 cp.execFile=(f,a,o,cb)=>cb(new Error('saiu 255'),'','ERROR: Unable to retrieve device list!');
 delete require.cache[caminho];
 try{assert.deepEqual(await require(caminho).listar(),[]);}finally{cp.execFile=original;console.warn=aviso;require.cache[toolsId].exports=anterior;delete require.cache[caminho];}
 assert.equal(avisos.length,1);assert.match(avisos[0],/Apple Devices/);
});
test('receita copia os 4 .exe e só as DLLs fora do Windows',()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'receita-'));
 const mingw=path.join(tmp,'mingw64'),falso=path.join(tmp,'falso'),destino=path.join(tmp,'saida');
 fs.mkdirSync(path.join(mingw,'bin'),{recursive:true});fs.mkdirSync(falso);
 for(const n of ['iproxy','idevice_id','ideviceinfo','ideviceinstaller'])fs.writeFileSync(path.join(mingw,'bin',n+'.exe'),n);
 fs.writeFileSync(path.join(mingw,'bin','libusbmuxd-2.0.dll'),'dll');
 fs.writeFileSync(path.join(falso,'ldd'),`#!/bin/sh\necho "\\tlibusbmuxd-2.0.dll => ${mingw}/bin/libusbmuxd-2.0.dll (0x1)"\necho "\\tntdll.dll => /c/windows/SYSTEM32/ntdll.dll (0x2)"\n`,{mode:0o755});
 const r=spawnSync('bash',[path.join(raiz,'MAC/integracao-iphone/distribuicao/empacotar-ferramentas-windows.sh'),destino],{env:{...process.env,PATH:falso+':'+process.env.PATH,MINGW_PREFIX:mingw,NOVA_INSTALAR_PACOTES:'0'},encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);
 assert.deepEqual(fs.readdirSync(path.join(destino,'bin')).sort(),['idevice_id.exe','ideviceinfo.exe','ideviceinstaller.exe','iproxy.exe','libusbmuxd-2.0.dll']);
 assert.ok(fs.existsSync(path.join(destino,'manifest.sha256')));
});
test('receita falha se faltar um .exe',()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'receita-'));fs.mkdirSync(path.join(tmp,'bin'));
 const r=spawnSync('bash',[path.join(raiz,'MAC/integracao-iphone/distribuicao/empacotar-ferramentas-windows.sh'),path.join(tmp,'o')],{env:{...process.env,MINGW_PREFIX:tmp,NOVA_INSTALAR_PACOTES:'0'},encoding:'utf8'});
 assert.notEqual(r.status,0);assert.match(r.stderr,/Falta/);
});
