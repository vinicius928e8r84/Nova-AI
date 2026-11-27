'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
const {CamLiveIphone}=require('../../app/electron/services/cam-live-iphone');
const tinyJpeg=require('node:fs').readFileSync(require('node:path').join(__dirname,'fixtures/tiny.jpg'));
const ready={version:'0.1-39',hooksReady:true,faulted:false,enabled:false,photoPrepareHookReady:true,photoStillHookReady:true,photoPortRemapHookReady:true};
function adts(data){const n=data.length+7;return Buffer.concat([Buffer.from([255,241,80,64|(n>>11),(n>>3)&255,((n&7)<<5)|31,252]),data]);}
function setup({state=ready,devices=[{id:'ios-a',ios:true,name:'iPhone teste'}],tunnelFail=false,unixFail=false,encoderFail=false}={}){
 const commands=[],events=[],children=[];const current={...state};
 const mobile={getIosDevices:async()=>devices,iosSsh:async cmd=>{commands.push(cmd);if(cmd.startsWith('chmod 666'))return{ok:!unixFail,stdout:unixFail?'':'ok'};if(cmd.startsWith('rm -f'))return{ok:true,stdout:''};if(cmd.startsWith('cat '))return{ok:true,stdout:JSON.stringify(current)};return{ok:true,stdout:''};}};
 const spawnProcess=(file,args)=>{const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{child.killed=true;queueMicrotask(()=>child.emit('exit',0));};children.push(child);queueMicrotask(()=>{if(file===require('../../app/electron/services/tool-paths').ssh()){child.stderr.write(tunnelFail?'remote forward failure for listen /var/tmp/.nb-00000000.sock':'remote forward success for: listen /var/tmp/.nb-1234abcd.sock');if(tunnelFail)child.emit('exit',255);}else if(encoderFail)child.emit('error',new Error('mock'));else child.emit('spawn');});return child;};
 const service=new CamLiveIphone({getMobileService:()=>mobile,send:(name,data)=>events.push({name,data}),ffmpegPath:'/bundled/ffmpeg',spawnProcess});
 return{service,commands,events,children,current};
}
test('aparelhos ambíguos, seleção incorreta e ponte antiga não abrem túnel',async()=>{
 for(const options of [{devices:[]},{devices:[{id:'ios-a'},{id:'ios-b'}]},{state:{...ready,version:'0.1-30'}},{state:{...ready,version:'0.1-38'}}]){
  const {service,commands,children}=setup(options);const r=await service.start({sampleRate:48000});assert.equal(r.ok,false);assert.equal(children.length,0);assert(!commands.some(c=>c.includes('printf')));
 }
 const {service}=setup();assert.equal((await service.start({deviceId:'ios-b'})).ok,false);
});
test('falha no túnel não escreve controle e fecha HTTP/child',async()=>{
 const {service,commands,children}=setup({tunnelFail:true});const result=await service.start();assert.equal(result.ok,false);assert.match(result.error,/ocupad/);assert.equal(service.media,null);assert(children.every(c=>c.killed));assert(!commands.some(c=>c.includes('printf')));
});
test('falha no encoder limpa túnel sem escrever controle',async()=>{
 const {service,commands,children}=setup({encoderFail:true});assert.equal((await service.start()).ok,false);assert.equal(service.media,null);assert(children.every(c=>c.killed));assert(!commands.some(c=>c.includes('printf')));
});
test('CAM LIVE sobe em socket Unix com token e o sequestro usa esse endereço',async()=>{
 const {service,commands}=setup();
 assert.equal((await service.start({sampleRate:48000})).ok,true);
 assert.equal(service.transport.type,'unix');
 assert.match(service.frameUrl,/^http:\/\/127\.0\.0\.1\/s\/[0-9a-f]{32}\/frame\.jpg$/);
 const endpoint=service.mediaEndpoint();assert.equal(endpoint.url,service.frameUrl);assert.match(endpoint.socket,/^\/var\/tmp\/\.nb-[0-9a-f]{8}\.sock$/);
 assert(commands.some(c=>c.startsWith('chmod 666')),'deve liberar o socket para o mediaserverd');
 let wrote=0;await service.setCameraEnabled(true,async()=>{wrote++;});
 assert.equal(wrote,1);assert.equal(service.cameraEnabled,true);
 assert.equal(service.frame(tinyJpeg).ok,true);await service.pcm({data:Buffer.alloc(4096),sampleRate:48000});
 const paused=service.snapshot();assert.equal(paused.transport,'unix');
 await service.setCameraEnabled(false,async()=>{wrote++;});
 assert.equal(wrote,2);assert.equal(service.cameraEnabled,false);
 assert.notEqual(service.media,null);
 await service.stop();assert.equal(service.media,null);
 assert(commands.some(c=>c.startsWith('rm -f')&&c.includes('.nb-')),'socket Unix deve ser removido');
});
test('sem socket Unix cai para porta aleatória com o mesmo token',async()=>{
 const {service}=setup({unixFail:true});
 assert.equal((await service.start({sampleRate:48000})).ok,true);
 assert.equal(service.transport.type,'tcp');assert(service.transport.port>=20000&&service.transport.port<40000);
 assert.match(service.frameUrl,new RegExp(`^http://127\\.0\\.0\\.1:${service.transport.port}/s/[0-9a-f]{32}/frame\\.jpg$`));
 assert.equal(service.mediaEndpoint().socket,null);
 await service.stop();
});
test('fonte parada desliga o AO VIVO; perda do túnel encerra a sessão',async()=>{
 const {service,children,events}=setup();await service.start();service.frame(tinyJpeg);await service.pcm({data:Buffer.alloc(4096),sampleRate:48000});children[1].stdout.write(adts(Buffer.from([1])));await new Promise(r=>setTimeout(r,20));
 assert.equal(service.active,true);
 service.media.frameAt=Date.now()-3000;service._updateSource(service.generation);assert.equal(service.active,false);assert.equal(service.status,'Aguardando fonte');
 children[0].emit('exit',1);await new Promise(r=>setTimeout(r,20));assert.equal(service.running,false);assert(events.some(e=>e.data.finished&&e.data.error));
});
test('PCM tem limites e backpressure explícita',async()=>{
 const {service}=setup();await service.start();assert.equal((await service.pcm({data:Buffer.alloc(4096),sampleRate:44100})).ok,false);assert.equal((await service.pcm({data:Buffer.alloc(65538),sampleRate:48000})).ok,false);service.pcmBlocked=true;assert.equal((await service.pcm({data:Buffer.alloc(100),sampleRate:48000})).backpressure,true);await service.stop();
});
