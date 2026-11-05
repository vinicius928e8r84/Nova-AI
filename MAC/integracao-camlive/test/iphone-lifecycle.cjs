'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
const {CamLiveIphone}=require('../cam-live-iphone');
const tinyJpeg=require('node:fs').readFileSync(require('node:path').join(__dirname,'fixtures/tiny.jpg'));
const ready={version:'0.1-38',hooksReady:true,faulted:false,enabled:false,photoPrepareHookReady:true,photoStillHookReady:true,photoPortRemapHookReady:true};
function adts(data){const n=data.length+7;return Buffer.concat([Buffer.from([255,241,80,64|(n>>11),(n>>3)&255,((n&7)<<5)|31,252]),data]);}
function setup({state=ready,devices=[{id:'ios-a',ios:true,name:'iPhone teste'}],tunnelFail=false,encoderFail=false,control:initialControl={mode:'observe'}}={}){
 const commands=[],events=[],children=[];let current={...state};let control=initialControl;const deviceNow=()=>Math.floor(Date.now()/1000);
 const mobile={getIosDevices:async()=>devices,iosSsh:async cmd=>{commands.push(cmd);if(cmd.includes('date +%s'))return{ok:true,stdout:JSON.stringify(control)+'\n'+deviceNow()+'\n'};if(cmd==='cat /var/tmp/obs-graph-bridge-control.json')return{ok:true,stdout:JSON.stringify(control)};if(cmd.startsWith('cat '))return{ok:true,stdout:JSON.stringify(current)};if(cmd.includes('"mode":"inject"')){current.enabled=true;const match=cmd.match(/novaCamLiveSession":"([a-f0-9]+)"/);control={novaCamLiveSession:match&&match[1]};};if(cmd.includes('"mode":"observe"'))current.enabled=false;return{ok:true,stdout:''};}};
 const spawnProcess=(file,args)=>{const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{child.killed=true;queueMicrotask(()=>child.emit('exit',0));};children.push(child);queueMicrotask(()=>{if(file==='/usr/bin/ssh'){child.stderr.write(tunnelFail?'remote port forwarding failed for listen port 18999':'remote forward success for: listen 127.0.0.1:18999');if(tunnelFail)child.emit('exit',255);}else if(encoderFail)child.emit('error',new Error('mock'));else child.emit('spawn');});return child;};
 const service=new CamLiveIphone({getMobileService:()=>mobile,send:(name,data)=>events.push({name,data}),ffmpegPath:'/bundled/ffmpeg',spawnProcess});
 return{service,commands,events,children,current};
}
test('aparelhos ambíguos, seleção incorreta e ponte antiga não escrevem controle',async()=>{
 for(const options of [{devices:[]},{devices:[{id:'ios-a'},{id:'ios-b'}]},{state:{...ready,version:'0.1-30'}},{state:{...ready,enabled:true},control:{mode:'inject',expiresAt:Math.floor(Date.now()/1000)+60}}]){
  const {service,commands,children}=setup(options);const r=await service.start({sampleRate:48000});assert.equal(r.ok,false);assert.equal(children.length,0);assert(!commands.some(c=>c.includes('printf')));
 }
 const {service}=setup();assert.equal((await service.start({deviceId:'ios-b'})).ok,false);
});
test('falha no túnel não muda controle alheio e fecha HTTP/child',async()=>{
 const {service,commands,children}=setup({tunnelFail:true});const result=await service.start();assert.equal(result.ok,false);assert.match(result.error,/ocupada/);assert.equal(service.media,null);assert(children.every(c=>c.killed));assert(!commands.some(c=>c.includes('printf')));
});
test('falha no encoder limpa túnel sem escrever observe',async()=>{
 const {service,commands,children}=setup({encoderFail:true});assert.equal((await service.start()).ok,false);assert.equal(service.media,null);assert(children.every(c=>c.killed));assert(!commands.some(c=>c.includes('printf')));
});
test('só ativa depois de JPEG + PCM + AAC, confirma e para apenas seu controle',async()=>{
 const {service,commands,events,children}=setup();
 assert.equal((await service.start({sampleRate:48000})).ok,true);assert.equal(service.snapshot().status,'Aguardando fonte');assert(!commands.some(c=>c.includes('printf')));
 assert.equal(service.frame(tinyJpeg).ok,true);await new Promise(r=>setImmediate(r));assert(!commands.some(c=>c.includes('printf')));
 assert.equal((await service.pcm({data:Buffer.alloc(4096),sampleRate:48000})).ok,true);
 children[1].stdout.write(adts(Buffer.from([1,2,3])));await new Promise(r=>setTimeout(r,10));assert.equal(service.active,true);assert(events.some(e=>e.data.status==='AO VIVO'));
 const inject=commands.find(c=>c.includes('"mode":"inject"'));assert.match(inject,/"appIDs":\["com.apple.camera"\]/);assert.match(inject,/"continuous":false/);assert.match(inject,/novaCamLiveSession/);
 await service.stop();assert.equal(service.media,null);assert(children.every(c=>c.killed));assert(commands.some(c=>c.startsWith('if grep -Fq')&&c.includes('"mode":"observe"')));
});
test('stale source observa e não mantém transmissão ativa; perda do túnel termina',async()=>{
 const {service,children,events}=setup();await service.start();service.frame(tinyJpeg);await service.pcm({data:Buffer.alloc(4096),sampleRate:48000});children[1].stdout.write(adts(Buffer.from([1])));await new Promise(r=>setTimeout(r,10));
 service.media.frameAt=Date.now()-3000;await service._heartbeat(service.generation);assert.equal(service.active,false);assert.equal(service.status,'Aguardando fonte');
 children[0].emit('exit',1);await new Promise(r=>setTimeout(r,10));assert.equal(service.running,false);assert(events.some(e=>e.data.finished&&e.data.error));
});
test('PCM tem limites e backpressure explícita',async()=>{
 const {service}=setup();await service.start();assert.equal((await service.pcm({data:Buffer.alloc(4096),sampleRate:44100})).ok,false);assert.equal((await service.pcm({data:Buffer.alloc(65538),sampleRate:48000})).ok,false);service.pcmBlocked=true;assert.equal((await service.pcm({data:Buffer.alloc(100),sampleRate:48000})).backpressure,true);await service.stop();
});

test('status enabled com lease expirado não bloqueia o início',async()=>{
 const {service}=setup({state:{...ready,enabled:true},control:{mode:'inject',expiresAt:Math.floor(Date.now()/1000)-3600}});
 const result=await service.start({sampleRate:48000});assert.equal(result.ok,true);await service.stop();
});
